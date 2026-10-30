// controllers/authController.js
// ============================================================================
// Authentication Controller
// - Access tokens (JWT) with payload: { user: { id, email, role } }.
// - Opaque refresh tokens stored hashed in DB (RefreshToken model).
// - Rotation on refresh; reuse detection revokes all user tokens.
// - Admin and user session management.
// ============================================================================

import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import logger from '../utils/logger.js';
import { User } from '../models/User.js';
import RefreshToken from '../models/RefreshToken.js';
import TenantInvitation from '../models/TenantInvitation.js';
import { normalizeRole as normalizeCanonicalRole } from '../security/rbacPolicy.js';

const require = createRequire(import.meta.url);
const canonicalLegalContent = require('../../shared/legal/legalDocuments.json');
// Enable only in a later change that integrates and tests canonical legal acceptance persistence.
const CANONICAL_LEGAL_ACCEPTANCE_INTEGRATION_READY = false;

const ACCESS_TOKEN_EXP = process.env.ACCESS_TOKEN_EXP || '15m';
const ACCESS_TOKEN_SECRET =
  process.env.JWT_ACCESS_SECRET ||
  process.env.ACCESS_TOKEN_SECRET ||
  process.env.JWT_SECRET;

const REFRESH_TOKEN_DAYS = parseInt(process.env.REFRESH_TOKEN_DAYS || '30', 10);
const NODE_ENV = String(process.env.NODE_ENV || 'development').trim().toLowerCase();
const ALLOW_IN_MEMORY_AUTH_FALLBACK =
  NODE_ENV !== 'production' &&
  String(process.env.TITECH_ALLOW_IN_MEMORY_AUTH_FALLBACK || '').trim().toLowerCase() === 'true';

function authStoreUnavailable(res) {
  return res.status(503).json({
    success: false,
    message: 'Authentication service is temporarily unavailable.',
    code: 'AUTH_STORE_UNAVAILABLE',
  });
}
const REFRESH_COOKIE_NAME = 'refreshToken';
const REFRESH_COOKIE_PATH = '/api/auth';

const JWT_ISSUER = process.env.JWT_ISSUER || undefined;
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || undefined;

// ----------------------------------------------------------------------------
// Utilities
// ----------------------------------------------------------------------------

const FALLBACK_USERS = new Map();
const FALLBACK_REFRESH_TOKENS = new Map();

function randomTokenString() {
  return crypto.randomBytes(64).toString('hex');
}
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}
function isMongoConnected() {
  return mongoose.connection?.readyState === 1;
}
function createFallbackUserRecord(values = {}) {
  const rawId = values._id || values.id || new mongoose.Types.ObjectId().toString();
  const userId = String(rawId);
  const email = normalizeEmail(values.email);
  const now = new Date();
  const user = {
    _id: userId,
    id: userId,
    name: values.name || 'User',
    email,
    phone: values.phone || null,
    role: values.role || 'user',
    status: values.status || 'active',
    isActive: values.isActive !== false,
    isVerified: Boolean(values.isVerified),
    password: values.password,
    failedLoginAttempts: values.failedLoginAttempts || 0,
    lockUntil: values.lockUntil || null,
    lastLogin: values.lastLogin || now,
    security: values.security || {},
    createdAt: values.createdAt || now,
    updatedAt: values.updatedAt || now,
    save: async function () {
      this.updatedAt = new Date();
      return this;
    },
    matchPassword: async function (enteredPassword) {
      if (!this.password) return false;
      return bcrypt.compare(enteredPassword, this.password);
    },
    bumpFailedLogin: async function (threshold = 5, lockMinutes = 15) {
      if (this.isLocked()) return;
      this.failedLoginAttempts += 1;
      if (this.failedLoginAttempts >= threshold) {
        this.lockUntil = new Date(Date.now() + lockMinutes * 60 * 1000);
        this.status = 'locked';
      }
      await this.save();
    },
    resetFailedLogin: async function () {
      this.failedLoginAttempts = 0;
      this.lockUntil = null;
      if (this.status === 'locked') this.status = 'active';
      await this.save();
    },
    isLocked: function () {
      return Boolean(this.lockUntil && this.lockUntil > Date.now());
    },
  };
  return user;
}
async function findFallbackUserByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  return FALLBACK_USERS.get(normalizedEmail) || null;
}
async function findFallbackUserById(userId) {
  const normalizedUserId = String(userId);
  return [...FALLBACK_USERS.values()].find(
    (user) => String(user._id) === normalizedUserId
  ) || null;
}
async function saveFallbackUser(user) {
  const normalizedEmail = normalizeEmail(user.email);
  FALLBACK_USERS.set(normalizedEmail, user);
  return user;
}
async function createFallbackRefreshToken(userId, deviceInfo = {}, familyId = null) {
  const token = randomTokenString();
  const tokenHash = hashToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);
  const dbEntry = {
    id: RefreshToken.generatePublicId(),
    userId,
    familyId: familyId || RefreshToken.generateTokenFamilyId(),
    tokenHash,
    deviceInfo,
    createdAt: now,
    lastUsedAt: now,
    expiresAt,
    revokedAt: null,
    revokedReason: null,
    replacedBy: null,
  };
  FALLBACK_REFRESH_TOKENS.set(tokenHash, dbEntry);
  return { token, dbEntry };
}

function setRefreshCookie(res, token) {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'Strict' : 'Lax',
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000,
  });
}

function clearRefreshCookie(res) {
  const isProd = process.env.NODE_ENV === 'production';
  res.clearCookie(REFRESH_COOKIE_NAME, {
    path: REFRESH_COOKIE_PATH,
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'Strict' : 'Lax',
  });
}

function generateAccessToken(user) {
  // user can be a Mongoose document; use normalized primitives.
  const userId = user._id?.toString?.() || user.id || String(user);
  const tenantId = user.tenantId?.toString?.() || user.tenantId || null;
  const payload = {
    sub: userId,
    id: userId,
    userId,
    tenantId,
    role: normalizeCanonicalRole(user.role) || 'member',
    securityVersion: Number(user.security?.securityVersion || 1),
    sessionVersion: Number(user.sessionMetrics?.sessionVersion || 1),
    user: {
      id: userId,
      email: user.email,
      name: user.name,
      role: normalizeCanonicalRole(user.role) || 'member',
      tenantId,
      securityVersion: Number(user.security?.securityVersion || 1),
      sessionVersion: Number(user.sessionMetrics?.sessionVersion || 1),
    },
  };
  const options = {
    expiresIn: ACCESS_TOKEN_EXP,
    ...(JWT_ISSUER ? { issuer: JWT_ISSUER } : {}),
    ...(JWT_AUDIENCE ? { audience: JWT_AUDIENCE } : {}),
  };
  return jwt.sign(payload, ACCESS_TOKEN_SECRET, options);
}

async function createRefreshToken(userId, deviceInfo = {}, { session = null, familyId = null } = {}) {
  if (!isMongoConnected()) {
    if (!ALLOW_IN_MEMORY_AUTH_FALLBACK) {
      const error = new Error('MongoDB is required for persistent authentication sessions.');
      error.code = 'AUTH_STORE_UNAVAILABLE';
      throw error;
    }

    return createFallbackRefreshToken(userId, deviceInfo, familyId);
  }

  const token = randomTokenString();
  const tokenHash = hashToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);

  const refreshTokenRecord = {
    id: RefreshToken.generatePublicId(),
    userId,
    tokenHash,
    deviceInfo,
    createdAt: now,
    lastUsedAt: now,
    expiresAt,
    revokedAt: null,
    revokedReason: null,
    replacedBy: null,
  };

  // Refresh rotation must persist the replacement inside the same MongoDB
  // transaction that consumes the previous token. Login/registration creates
  // a new token family and intentionally omit `familyId` so the model default
  // creates a new family; refresh passes the existing family explicitly.
  if (familyId) {
    refreshTokenRecord.familyId = familyId;
  }

  const created = await RefreshToken.create(
    [refreshTokenRecord],
    session ? { session } : {},
  );
  const dbEntry = Array.isArray(created) ? created[0] : created;

  return { token, dbEntry };
}

// ----------------------------------------------------------------------------
// Public endpoints
// ----------------------------------------------------------------------------

/**
 * POST /api/auth/register
 */
async function register(req, res) {
  try {
    // Production registration stays fail-closed until the canonical legal
    // publication workflow is approved and acceptance persistence is integrated
    // with the existing audited legal subsystem. Do not attach the legacy,
    // unmounted legacy legal service to the canonical auth flow.
    const publicationApproved = canonicalLegalContent.status === 'approved';
    const acceptanceIntegrationReady =
      canonicalLegalContent.acceptanceIntegrationStatus === 'verified' &&
      canonicalLegalContent.productionRegistrationEnabled === true &&
      CANONICAL_LEGAL_ACCEPTANCE_INTEGRATION_READY === true;

    if (NODE_ENV === 'production' && !publicationApproved) {
      return res.status(503).json({
        success: false,
        code: 'LEGAL_PUBLICATION_BLOCKED',
        message: 'Account creation is unavailable until the Terms of Service and Privacy Policy are reviewed and approved for publication.',
      });
    }

    if (NODE_ENV === 'production' && !acceptanceIntegrationReady) {
      return res.status(503).json({
        success: false,
        code: 'LEGAL_ACCEPTANCE_INTEGRATION_BLOCKED',
        message: 'Account creation is unavailable until legal acceptance is persisted and audited through the canonical legal subsystem.',
      });
    }

    if (!isMongoConnected() && !ALLOW_IN_MEMORY_AUTH_FALLBACK) {
      return authStoreUnavailable(res);
    }

    const {
      email,
      password,
      name,
      fullName,
      firstName,
      lastName,
      phoneNumber,
      tenantInviteCode,
      deviceInfo = {},
    } = req.body;

    const normalizedName = (name || fullName || `${firstName || ''} ${lastName || ''}`)
      .trim();
    const normalizedEmail = normalizeEmail(email);
    const normalizedPhone = phoneNumber?.trim() || req.body.phone?.trim();

    if (!normalizedEmail || !password || !normalizedName) {
      return res.status(400).json({
        success: false,
        message: 'Name, email and password are required',
      });
    }

    if (!tenantInviteCode) {
      return res.status(400).json({
        success: false,
        message: 'A tenant invitation code is required',
      });
    }

    const existing = isMongoConnected()
      ? await User.findOne({ email: normalizedEmail })
      : await findFallbackUserByEmail(normalizedEmail);

    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Email already registered',
      });
    }

    let tenantInvitation = null;
    let tenantId = null;

    if (tenantInviteCode) {
      if (!isMongoConnected()) {
        return res.status(503).json({
          success: false,
          message: 'Tenant invitations are temporarily unavailable',
        });
      }

      const codeHash = hashToken(tenantInviteCode);
      const now = new Date();
      tenantInvitation = await TenantInvitation.findOneAndUpdate(
        {
          codeHash,
          revokedAt: null,
          expiresAt: { $gt: now },
          $expr: { $lt: ['$uses', '$maxUses'] },
        },
        { $inc: { uses: 1 } },
        { new: true }
      );

      if (!tenantInvitation) {
        return res.status(400).json({
          success: false,
          message: 'Tenant invite code is invalid, expired, or already used',
        });
      }

      tenantId = tenantInvitation.tenantId;
    }

    let user;
    try {
      if (isMongoConnected()) {
        user = await User.create({
          name: normalizedName,
          email: normalizedEmail,
          password,
          phone: normalizedPhone,
          tenantId,
        });
      } else {
        const hashedPassword = await bcrypt.hash(password, 12);
        user = createFallbackUserRecord({
          name: normalizedName,
          email: normalizedEmail,
          password: hashedPassword,
          phone: normalizedPhone,
          tenantId,
        });
        await saveFallbackUser(user);
      }

    } catch (error) {
      if (user) {
        try {
          if (isMongoConnected()) {
            await User.deleteOne({ _id: user._id });
          } else {
            FALLBACK_USERS.delete(normalizedEmail);
          }
        } catch (cleanupError) {
          logger.error('[AuthController] Registration rollback could not remove the provisional user record.', {
            code: cleanupError?.code || 'REGISTRATION_USER_ROLLBACK_FAILED',
          });
        }
      }

      if (tenantInvitation) {
        try {
          await TenantInvitation.updateOne(
            { _id: tenantInvitation._id, uses: { $gt: 0 } },
            { $inc: { uses: -1 } }
          );
        } catch (invitationRollbackError) {
          logger.error('[AuthController] Registration rollback could not restore the tenant invitation use count.', {
            code: invitationRollbackError?.code || 'REGISTRATION_INVITATION_ROLLBACK_FAILED',
          });
        }
      }

      throw error;
    }

    if (tenantId) {
      try {
        const WalletService = require('../services/walletService');
        if (WalletService?.createWallet) {
          await WalletService.createWallet({
            userId: user._id,
            tenantId,
          });
        }
      } catch (err) {
        logger.warn('[AuthController] Wallet creation failed', { error: err.message, userId: user._id, tenantId });
      }
    }

    return res.status(201).json({
      success: true,
      message: 'User registered successfully. Verify your email before signing in.',
      verificationRequired: true,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: normalizeCanonicalRole(user.role) || 'member',
        tenantId: user.tenantId || null,
      },
    });
  } catch (err) {
    console.error('[AuthController] register error', err);

    return res.status(500).json({
      success: false,
      message: 'Registration failed',
    });
  }
}

async function createTenantInvitation(req, res) {
    const userId = req.user?._id || req.user?.id;
    const tenantId = req.user?.tenantId;

    if (
      !userId ||
      !tenantId ||
      !mongoose.Types.ObjectId.isValid(userId) ||
      !mongoose.Types.ObjectId.isValid(tenantId)
    ) {
      return res.status(403).json({
        success: false,
        message: 'An authenticated tenant administrator is required',
      });
    }

    const requestedMaxUses = Number(req.body?.maxUses ?? 1);
    const maxUses = Number.isInteger(requestedMaxUses)
      ? requestedMaxUses
      : 0;
    const expiresInHours = Number(req.body?.expiresInHours ?? 72);

    if (
      maxUses < 1 ||
      maxUses > 1000 ||
      !Number.isInteger(expiresInHours) ||
      expiresInHours < 1 ||
      expiresInHours > 720
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invitation limits are invalid',
      });
    }

    const code = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

    await TenantInvitation.create({
      tenantId,
      createdBy: userId,
      codeHash: hashToken(code),
      expiresAt,
      maxUses,
    });

    return res.status(201).json({
      success: true,
      invitation: {
        code,
        expiresAt,
        maxUses,
      },
    });
}

/**
 * async function register(req, res) {
  try {
    const { email, password, name, deviceInfo } = req.body;

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: 'Email already registered' });

    const user = new User({ name, email, password });
    await user.save();

    const accessToken = generateAccessToken(user);
    const { token: refreshToken } = await createRefreshToken(user._id, {
      ip: req.ip,
      ua: req.get('User-Agent'),
      ...(deviceInfo || {}),
    });

    setRefreshCookie(res, refreshToken);

    return res.status(201).json({
      message: 'User registered',
      token: accessToken,
      user: { id: user._id, email: user.email, name: user.name, role: user.role },
    });
  } catch (err) {
    console.error('[AuthController] register error', err);
    return res.status(500).json({ message: 'Registration failed' });
  }
}
 */
/**
 * const normalizedEmail = email.trim().toLowerCase();

// ✅ Valid
async function checkUser(email) {
  return await User.findOne({ email });
}

if (existing) {
  return res.status(409).json({
    message: 'Email already registered',
  });
}

const user = await User.create({
  name,
  email: normalizedEmail,
  password,
});

 */

/**
 * POST /api/auth/login
 */
async function login(req, res) {
  try {
    const { email, password, deviceInfo } = req.body;

    if (!isMongoConnected() && !ALLOW_IN_MEMORY_AUTH_FALLBACK) {
      return authStoreUnavailable(res);
    }

    let user = isMongoConnected()
      ? await User.findOne({ email: normalizeEmail(email) }).select('+password').exec()
      : await findFallbackUserByEmail(email);

    if (!user) {
      return res.status(401).json({
        message: 'Invalid credentials',
      });
    }

    if (user.status === 'disabled') {
      return res.status(403).json({
        message: 'Account disabled',
      });
    }

    if (user.isVerified === false) {
      return res.status(403).json({
        success: false,
        code: 'EMAIL_VERIFICATION_REQUIRED',
        message: 'Verify your email address before signing in.',
      });
    }

    if (user.status === 'suspended' || user.status === 'locked') {
      return res.status(423).json({
        message:
          user.status === 'locked'
            ? 'Account temporarily locked due to failed login attempts'
            : 'Account suspended',
      });
    }

    if (typeof user.isLocked === 'function' && user.isLocked()) {
      return res.status(423).json({
        message: 'Account temporarily locked due to failed login attempts',
      });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      if (typeof user.bumpFailedLogin === 'function') {
        await user.bumpFailedLogin();
      }
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (typeof user.resetFailedLogin === 'function') {
      await user.resetFailedLogin();
    }

    user.lastLogin = new Date();
    user.security = user.security || {};
    user.security.lastLoginAt = new Date();
    user.security.lastLoginIp = req.ip;
    user.security.lastLoginUserAgent = req.get('User-Agent');
    await user.save();

    const accessToken = generateAccessToken(user);
    const { token: refreshToken } = await createRefreshToken(user._id, {
      ip: req.ip,
      ua: req.get('User-Agent'),
      ...(deviceInfo || {}),
    });

    setRefreshCookie(res, refreshToken);

    return res.status(200).json({
      message: 'Login successful',
      token: accessToken,
      user: { id: user._id, email: user.email, name: user.name, role: user.role },
    });
  } catch (err) {
    console.error('[AuthController] login error', {
      code: err?.code || 'AUTH_LOGIN_INTERNAL_ERROR',
      name: err?.name || 'Error',
      message: String(err?.message || 'Login failed').slice(0, 240),
      requestId: req.requestId || null,
      correlationId: req.correlationId || req.get('x-correlation-id') || null,
    });
    return res.status(500).json({ message: 'Login failed' });
  }
}

/**
 * POST /api/auth/refresh
 *
 * Enterprise Refresh Token Rotation
 * ---------------------------------
 * Features:
 * - Opaque refresh tokens
 * - Token rotation
 * - Reuse detection
 * - Session tracking
 * - User validation
 * - Audit logging
 * - Transaction safety
 * - Token family support
 */

async function createRefreshSession() {
  const session = await RefreshToken.startSession();

  try {
    session.startTransaction();
    return { session, transactionAvailable: true };
  } catch (error) {
    try {
      await session.endSession();
    } catch {
      // Preserve the transaction-start failure as the primary error.
    }

    const unavailable = new Error(
      'Refresh-token rotation requires MongoDB transaction support.',
      { cause: error },
    );
    unavailable.code = 'AUTH_TRANSACTION_UNAVAILABLE';
    throw unavailable;
  }
}

function isTransactionUnavailableError(error) {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === 'AUTH_TRANSACTION_UNAVAILABLE' ||
    error?.code === 20 ||
    /transaction numbers are only allowed|replica set|mongos|transactions are not supported/.test(message);
}

async function refresh(req, res) {
  let session;

  try {
    // Refresh tokens are accepted only from the HttpOnly cookie. A browser-
    // readable body token would undermine the intended session boundary.
    const presentedToken = req.cookies?.[REFRESH_COOKIE_NAME];

    if (!presentedToken) {
      return res.status(401).json({
        success: false,
        message: 'Missing refresh token',
        code: 'REFRESH_TOKEN_MISSING',
      });
    }

    const presentedHash = hashToken(presentedToken);

    if (!isMongoConnected() && !ALLOW_IN_MEMORY_AUTH_FALLBACK) {
      return authStoreUnavailable(res);
    }

    if (!isMongoConnected()) {
      const dbToken = FALLBACK_REFRESH_TOKENS.get(presentedHash);
      if (!dbToken) {
        return res.status(401).json({ success: false, message: 'Invalid refresh token', code: 'REFRESH_TOKEN_INVALID' });
      }
      if (dbToken.revokedAt) {
        if (dbToken.revokedReason === 'rotated' && dbToken.familyId) {
          for (const candidate of FALLBACK_REFRESH_TOKENS.values()) {
            if (candidate.familyId === dbToken.familyId && !candidate.revokedAt) {
              candidate.revokedAt = new Date();
              candidate.revokedReason = 'refresh_token_reuse';
            }
          }
          return res.status(401).json({ success: false, message: 'Refresh token reuse detected. The affected session family has been revoked.', code: 'TOKEN_REUSE_DETECTED' });
        }
        return res.status(401).json({ success: false, message: 'Refresh token is no longer active.', code: 'REFRESH_TOKEN_REVOKED' });
      }
      if (dbToken.expiresAt <= new Date()) {
        dbToken.revokedAt = new Date();
        dbToken.revokedReason = 'session_expired';
        return res.status(401).json({ success: false, message: 'Refresh token expired', code: 'REFRESH_TOKEN_EXPIRED' });
      }
      const fallbackUser = await findFallbackUserById(dbToken.userId);
      if (!fallbackUser) {
        return res.status(401).json({ success: false, message: 'User not found', code: 'USER_NOT_FOUND' });
      }
      if (fallbackUser.status === 'disabled' || fallbackUser.status === 'suspended') {
        dbToken.revokedAt = new Date();
        dbToken.revokedReason = 'account_disabled';
        return res.status(403).json({ success: false, message: 'Account disabled', code: 'ACCOUNT_DISABLED' });
      }
      const {
        token: newRefreshToken,
        dbEntry: newDbToken,
      } = await createRefreshToken(fallbackUser._id, dbToken.deviceInfo, { familyId: dbToken.familyId });
      dbToken.revokedAt = new Date();
      dbToken.revokedReason = 'rotated';
      dbToken.replacedBy = newDbToken.id;
      dbToken.replacedAt = new Date();
      const accessToken = generateAccessToken(fallbackUser);
      setRefreshCookie(res, newRefreshToken);
      return res.status(200).json({ success: true, token: accessToken, expiresIn: ACCESS_TOKEN_EXP });
    }

    ({ session } = await createRefreshSession());

    const dbTokenQuery = RefreshToken.findOne({ tokenHash: presentedHash });
    dbTokenQuery.session(session);
    const dbToken = await dbTokenQuery.exec();

    if (!dbToken) {
      if (typeof session.inTransaction === 'function' && session.inTransaction()) {
        await session.abortTransaction();
      }

      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token',
        code: 'REFRESH_TOKEN_INVALID',
      });
    }

    /**
     * Reuse Detection
     */
    if (dbToken.revokedAt) {
      // Only a token previously consumed by rotation is evidence of reuse.
      // A deliberately logged-out or administratively revoked cookie is not
      // automatically classified as theft.
      if (dbToken.revokedReason === 'rotated') {
        const now = new Date();
        await RefreshToken.updateMany(
          {
            userId: dbToken.userId,
            familyId: dbToken.familyId,
            revokedAt: null,
          },
          {
            $set: {
              revokedAt: now,
              revokedReason: 'refresh_token_reuse',
              reuseDetectedAt: now,
            },
          },
          { session },
        );

        await session.commitTransaction();

        console.warn('[SECURITY] Refresh token reuse detected', {
          userId: String(dbToken.userId),
          familyId: dbToken.familyId || null,
        });

        return res.status(401).json({
          success: false,
          message: 'Refresh token reuse detected. The affected session family has been revoked.',
          code: 'TOKEN_REUSE_DETECTED',
        });
      }

      if (session.inTransaction()) await session.abortTransaction();
      return res.status(401).json({
        success: false,
        message: 'Refresh token is no longer active.',
        code: 'REFRESH_TOKEN_REVOKED',
      });
    }

    /**
     * Expiration Check
     */
    if (dbToken.expiresAt <= new Date()) {
      dbToken.revokedAt = new Date();
      dbToken.revokedReason = 'session_expired';

      await dbToken.save({ session });
      await session.commitTransaction();

      return res.status(401).json({
        success: false,
        message: 'Refresh token expired',
        code: 'REFRESH_TOKEN_EXPIRED',
      });
    }

    /**
     * User Validation
     */
    const userQuery = User.findById(dbToken.userId);
    userQuery.session(session);
    const user = await userQuery.exec();

    if (!user) {
      if (typeof session.inTransaction === 'function' && session.inTransaction()) {
        await session.abortTransaction();
      }

      return res.status(401).json({
        success: false,
        message: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    if (
      user.status === 'disabled' ||
      user.status === 'suspended'
    ) {
      await RefreshToken.updateMany(
        {
          userId: user._id,
          revokedAt: null,
        },
        {
          $set: {
            revokedAt: new Date(),
            revokedReason: 'account_disabled',
          },
        },
        { session }
      );

      await session.commitTransaction();

      return res.status(403).json({
        success: false,
        message: 'Account disabled',
        code: 'ACCOUNT_DISABLED',
      });
    }

    /**
     * Create Replacement Token
     */
    const {
      token: newRefreshToken,
      dbEntry: newDbToken,
    } = await createRefreshToken(
      user._id,
      dbToken.deviceInfo,
      {
        session,
        familyId: dbToken.familyId,
      },
    );

    /**
     * Consume the old token through a conditional update in the same
     * transaction as replacement insertion. The predicate is the one-time
     * use guard; a concurrent request cannot independently rotate this token.
     */
    const rotatedAt = new Date();
    const consumed = await RefreshToken.updateOne(
      {
        _id: dbToken._id,
        revokedAt: null,
        expiresAt: { $gt: rotatedAt },
      },
      {
        $set: {
          revokedAt: rotatedAt,
          revokedReason: 'rotated',
          replacedBy: newDbToken.id,
          replacedAt: rotatedAt,
          lastUsedAt: rotatedAt,
        },
      },
      { session },
    );

    if (consumed.matchedCount !== 1) {
      await session.abortTransaction();
      return res.status(401).json({
        success: false,
        message: 'Refresh token was already consumed or expired.',
        code: 'REFRESH_TOKEN_ALREADY_CONSUMED',
      });
    }

    await session.commitTransaction();

    /**
     * Issue New Access Token
     */
    const accessToken = generateAccessToken(user);

    /**
     * Set Cookie
     */
    setRefreshCookie(res, newRefreshToken);

    /**
     * Security Audit Event
     */
    console.info(
      `[AUTH] Refresh token rotated successfully`,
      {
        userId: user._id,
        sessionId: newDbToken.id,
        ip: req.ip,
        userAgent:
          req.headers?.['user-agent'] ||
          req.get?.('User-Agent') ||
          null,
      }
    );

    return res.status(200).json({
      success: true,
      token: accessToken,
      expiresIn: ACCESS_TOKEN_EXP,
    });
  } catch (error) {
    console.error(
      '[AuthController] refresh error',
      error
    );

    if (session && typeof session.inTransaction === 'function' && session.inTransaction()) {
      try {
        await session.abortTransaction();
      } catch {
        // Keep the original failure as the returned diagnostic.
      }
    }

    if (isTransactionUnavailableError(error)) {
      return res.status(503).json({
        success: false,
        message: 'Secure session rotation is unavailable until MongoDB transaction support is restored.',
        code: 'AUTH_TRANSACTION_UNAVAILABLE',
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Refresh failed',
      code: 'REFRESH_FAILED',
    });
  } finally {
    if (session) {
      try {
        await session.endSession();
      } catch {
        // A cleanup failure must not replace the primary response/result.
      }
    }
  }
}
/**
 * POST /api/auth/logout
 * Revokes current refresh token, clears cookie.
 */
async function logout(req, res) {
  // Clear the HttpOnly cookie only when there is no session to present or the
  // authoritative store confirms revocation. On persistence failure, preserve
  // it for a retry; the frontend blocks session restoration while pending.
  const presented = req.cookies?.[REFRESH_COOKIE_NAME];

  if (!presented) {
    clearRefreshCookie(res);
    return res.status(200).json({
      success: true,
      code: 'NO_SERVER_SESSION_PRESENT',
      serverRevocationConfirmed: false,
    });
  }

  const presentedHash = hashToken(presented);

  if (!isMongoConnected()) {
    if (!ALLOW_IN_MEMORY_AUTH_FALLBACK) {
      // Preserve the HttpOnly cookie so the client can retry revocation after
      // persistence recovers. The frontend records a non-secret pending-logout
      // marker and will not restore this cookie as an authenticated session.
      return res.status(503).json({
        success: false,
        code: 'AUTH_SESSION_REVOCATION_UNCONFIRMED',
        message: 'Local sign-out completed, but server-side session revocation could not be confirmed.',
        serverRevocationConfirmed: false,
      });
    }

    const fallbackToken = FALLBACK_REFRESH_TOKENS.get(presentedHash);
    if (!fallbackToken) {
      clearRefreshCookie(res);
      return res.status(200).json({
        success: true,
        code: 'NO_SERVER_SESSION_PRESENT',
        serverRevocationConfirmed: false,
      });
    }
    if (fallbackToken.revokedAt) {
      clearRefreshCookie(res);
      return res.status(200).json({
        success: true,
        code: 'SESSION_ALREADY_REVOKED',
        serverRevocationConfirmed: true,
      });
    }

    fallbackToken.revokedAt = new Date();
    fallbackToken.revokedReason = 'user_logout';
    clearRefreshCookie(res);
    return res.status(200).json({
      success: true,
      code: 'SERVER_SESSION_REVOKED',
      serverRevocationConfirmed: true,
    });
  }

  try {
    const dbToken = await RefreshToken.findOne({ tokenHash: presentedHash }).exec();

    if (!dbToken) {
      // The authoritative store returned no record for this opaque token. It
      // cannot be refreshed through this record, so discard the cookie while
      // explicitly avoiding any claim that a persistent revocation occurred.
      clearRefreshCookie(res);
      return res.status(200).json({
        success: true,
        code: 'NO_SERVER_SESSION_PRESENT',
        serverRevocationConfirmed: false,
      });
    }

    if (dbToken.revokedAt) {
      clearRefreshCookie(res);
      return res.status(200).json({
        success: true,
        code: 'SESSION_ALREADY_REVOKED',
        serverRevocationConfirmed: true,
      });
    }

    const revokedAt = new Date();
    const result = await RefreshToken.updateOne(
      {
        _id: dbToken._id,
        revokedAt: null,
      },
      {
        $set: {
          revokedAt,
          revokedReason: 'user_logout',
        },
      },
    );

    if (result.matchedCount === 1) {
      clearRefreshCookie(res);
      console.info('[AUTH] Server refresh session revoked', {
        userId: String(dbToken.userId),
        sessionId: dbToken.id || null,
      });
      return res.status(200).json({
        success: true,
        code: 'SERVER_SESSION_REVOKED',
        serverRevocationConfirmed: true,
      });
    }

    // A concurrent logout may already have revoked the row. Confirm the
    // authoritative state instead of assuming the update succeeded.
    const refreshed = await RefreshToken.findById(dbToken._id).exec();
    if (refreshed?.revokedAt) {
      clearRefreshCookie(res);
      return res.status(200).json({
        success: true,
        code: 'SESSION_ALREADY_REVOKED',
        serverRevocationConfirmed: true,
      });
    }

    return res.status(503).json({
      success: false,
      code: 'AUTH_SESSION_REVOCATION_UNCONFIRMED',
      message: 'Server-side session revocation could not be confirmed.',
      serverRevocationConfirmed: false,
    });
  } catch (error) {
    // Never log the raw token or token digest.
    console.error('[AuthController] logout persistence failure', {
      code: error?.code || 'AUTH_SESSION_REVOCATION_UNCONFIRMED',
      name: error?.name || 'Error',
    });
    return res.status(503).json({
      success: false,
      code: 'AUTH_SESSION_REVOCATION_UNCONFIRMED',
      message: 'Local sign-out completed, but server-side session revocation could not be confirmed.',
      serverRevocationConfirmed: false,
    });
  }
}

/**
 * POST /api/auth/logout-all
 * Atomically revokes persistent refresh sessions and advances the user's
 * authoritative session/security versions so already-issued access JWTs fail.
 */
async function logoutAll(req, res) {
  const rawUserId = req.user?._id?.toString?.() || req.user?.id;

  if (!rawUserId) {
    clearRefreshCookie(res);
    return res.status(401).json({
      success: false,
      code: 'AUTH_REQUIRED',
      message: 'Authentication is required to revoke all sessions.',
    });
  }

  if (!isMongoConnected()) {
    return res.status(503).json({
      success: false,
      code: 'AUTH_SESSION_REVOCATION_UNCONFIRMED',
      message: 'Server-side session revocation could not be confirmed.',
    });
  }

  let session;
  try {
    session = await RefreshToken.startSession();
    session.startTransaction();

    const user = await User.findById(rawUserId).session(session).exec();
    if (!user || user.deletedAt) {
      await session.abortTransaction();
      return res.status(401).json({
        success: false,
        code: 'AUTH_REQUIRED',
        message: 'The authenticated account is no longer available.',
      });
    }

    const revokedAt = new Date();
    await RefreshToken.updateMany(
      {
        userId: user._id,
        revokedAt: null,
      },
      {
        $set: {
          revokedAt,
          revokedReason: 'user_logout_all',
        },
      },
      { session },
    );

    // Explicitly initialize missing legacy values at 1, then increment, so
    // old tokens with implicit version 1 cannot survive this operation.
    user.security = user.security || {};
    user.sessionMetrics = user.sessionMetrics || {};
    user.security.securityVersion = Number(user.security.securityVersion || 1) + 1;
    user.sessionMetrics.sessionVersion = Number(user.sessionMetrics.sessionVersion || 1) + 1;
    await user.save({ session });

    await session.commitTransaction();
    // Clear the current browser credential only after the authoritative
    // refresh records and token-version revocation commit successfully.
    clearRefreshCookie(res);

    console.info('[AUTH] All server sessions revoked', {
      userId: String(user._id),
      at: revokedAt.toISOString(),
    });

    return res.status(200).json({
      success: true,
      code: 'SERVER_SESSIONS_REVOKED',
      serverRevocationConfirmed: true,
      reauthenticationRequired: true,
    });
  } catch (error) {
    if (session && typeof session.inTransaction === 'function' && session.inTransaction()) {
      try {
        await session.abortTransaction();
      } catch {
        // Keep the original failure as the primary error.
      }
    }

    const transactionUnavailable = isTransactionUnavailableError(error);
    console.error('[AuthController] logoutAll persistence failure', {
      code: transactionUnavailable ? 'AUTH_TRANSACTION_UNAVAILABLE' : (error?.code || 'AUTH_SESSION_REVOCATION_UNCONFIRMED'),
      name: error?.name || 'Error',
    });

    return res.status(503).json({
      success: false,
      code: transactionUnavailable ? 'AUTH_TRANSACTION_UNAVAILABLE' : 'AUTH_SESSION_REVOCATION_UNCONFIRMED',
      message: 'Server-side session revocation could not be confirmed.',
      serverRevocationConfirmed: false,
    });
  } finally {
    if (session) {
      try {
        await session.endSession();
      } catch {
        // Cleanup failure must not alter the transaction result.
      }
    }
  }
}

/**
 * GET /api/auth/me
 */
async function me(req, res) {
  try {
    if (!req.user) return res.status(401).json({ message: 'Not authenticated' });
    const user = req.user;
    return res.status(200).json({
      id: user._id,
      email: user.email,
      name: user.name,
      role: user.role,
      // include other non-sensitive fields if needed
    });
  } catch (err) {
    console.error('[AuthController] me error', err);
    return res.status(500).json({ message: 'Failed to fetch profile' });
  }
}

/**
 * GET /api/auth/sessions
 * Lists refresh token sessions for authenticated user (basic).
 */
async function listSessions(req, res) {
  try {
    const userId = req.user._id?.toString?.() || req.user.id;
    const sessions = await RefreshToken.find({ userId })
      .select('id createdAt lastUsedAt expiresAt revokedAt revokedReason deviceInfo replacedBy')
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({ sessions });
  } catch (err) {
    console.error('[AuthController] listSessions error', err);
    return res.status(500).json({ message: 'Failed to list sessions' });
  }
}

/**
 * DELETE /api/auth/sessions/:id
 * Revokes a specific session belonging to the authenticated user.
 */
async function revokeSession(req, res) {
  try {
    const userId = req.user._id?.toString?.() || req.user.id;
    const { id } = req.params;

    const token = await RefreshToken.findOne({ id });
    if (!token) return res.status(404).json({ message: 'Session not found' });
    if (String(token.userId) !== String(userId)) {
      return res.status(403).json({ message: "Cannot revoke another user's session" });
    }
    if (!token.revokedAt) {
      token.revokedAt = new Date();
      token.revokedReason = 'user_revoked';
      await token.save();
    }

    return res.status(204).end();
  } catch (err) {
    console.error('[AuthController] revokeSession error', err);
    return res.status(500).json({ message: 'Failed to revoke session' });
  }
}

// ----------------------------------------------------------------------------
// Admin-only session views/actions
// ----------------------------------------------------------------------------

/**
 * GET /api/auth/admin/sessions
 * Lists all sessions (admin).
 */
async function adminListSessions(req, res) {
  try {
    const sessions = await RefreshToken.find({})
      .select('id userId createdAt lastUsedAt expiresAt revokedAt revokedReason deviceInfo replacedBy')
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({ sessions });
  } catch (err) {
    console.error('[AuthController] adminListSessions error', err);
    return res.status(500).json({ message: 'Failed to list sessions' });
  }
}


/**
 * DELETE /api/auth/admin/sessions/:id
 * Revokes a session by ID (admin).
 */
async function adminRevokeSession(req, res) {
  try {
    const { id } = req.params;
    const token = await RefreshToken.findOne({ id });
    if (!token) return res.status(404).json({ message: 'Session not found' });

    if (!token.revokedAt) {
      token.revokedAt = new Date();
      token.revokedReason = 'admin_revoked';
      await token.save();
    }

    return res.status(204).end();
  } catch (err) {
    console.error('[AuthController] adminRevokeSession error', err);
    return res.status(500).json({ message: 'Failed to revoke session (admin)' });
  }
}

// ----------------------------------------------------------------------------
// Helpers exposed for router-level usage if needed (optional)
// ----------------------------------------------------------------------------

async function findUserByEmail(email) {
  // Must explicitly select password field since it has select: false in schema
  return User.findOne({ email }).select('+password');
}
async function getUserById(userId) {
  if (!isMongoConnected()) {
    const key = String(userId);
    return FALLBACK_USERS.get(key) || null;
  }
  return User.findById(userId);
}

export {
  // public
  register,
  login,
  refresh,
  logout,
  logoutAll,
  me,

  // user sessions
  listSessions,
  revokeSession,

  // admin sessions
  adminListSessions,
  adminRevokeSession,
  createTenantInvitation,

  // helpers
  findUserByEmail,
  getUserById,
};