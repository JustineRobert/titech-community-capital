// controllers/authController.js
// ============================================================================
// Authentication Controller
// - Access tokens (JWT) with payload: { user: { id, email, role } }.
// - Opaque refresh tokens stored hashed in DB (RefreshToken model).
// - Rotation on refresh; reuse detection revokes all user tokens.
// - Admin and user session management.
// ============================================================================

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');

const ACCESS_TOKEN_EXP = process.env.ACCESS_TOKEN_EXP || '15m';
const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || process.env.JWT_SECRET;

const REFRESH_TOKEN_DAYS = parseInt(process.env.REFRESH_TOKEN_DAYS || '30', 10);
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
async function saveFallbackUser(user) {
  const normalizedEmail = normalizeEmail(user.email);
  FALLBACK_USERS.set(normalizedEmail, user);
  return user;
}
async function createFallbackRefreshToken(userId, deviceInfo = {}) {
  const token = randomTokenString();
  const tokenHash = hashToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);
  const dbEntry = {
    id: crypto.randomUUID(),
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
    role: user.role,
    user: {
      id: userId,
      email: user.email,
      role: user.role,
      tenantId,
    },
  };
  const options = {
    expiresIn: ACCESS_TOKEN_EXP,
    ...(JWT_ISSUER ? { issuer: JWT_ISSUER } : {}),
    ...(JWT_AUDIENCE ? { audience: JWT_AUDIENCE } : {}),
  };
  return jwt.sign(payload, ACCESS_TOKEN_SECRET, options);
}

async function createRefreshToken(userId, deviceInfo = {}) {
  if (!isMongoConnected()) {
    return createFallbackRefreshToken(userId, deviceInfo);
  }

  const token = randomTokenString();
  const tokenHash = hashToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);

  const dbEntry = await RefreshToken.create({
    id: crypto.randomUUID(),
    userId,
    tokenHash,
    deviceInfo,
    createdAt: now,
    lastUsedAt: now,
    expiresAt,
    revokedAt: null,
    revokedReason: null,
    replacedBy: null,
  });

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
    const {
      email,
      password,
      name,
      fullName,
      firstName,
      lastName,
      phoneNumber,
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

    const existing = isMongoConnected()
      ? await User.findOne({ email: normalizedEmail })
      : await findFallbackUserByEmail(normalizedEmail);

    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Email already registered',
      });
    }

    const tenantHeader = req.headers['x-tenant-id'];
    const tenantId =
      tenantHeader &&
      mongoose.Types.ObjectId.isValid(tenantHeader)
        ? tenantHeader
        : null;

    let user;
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

    const accessToken = generateAccessToken(user);

    const { token: refreshToken } =
      await createRefreshToken(user._id, {
        ip: req.ip,
        ua:
          req.headers?.['user-agent'] ||
          req.get?.('User-Agent') ||
          null,
        ...deviceInfo,
      });

    setRefreshCookie(res, refreshToken);

    return res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token: accessToken,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
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
    console.error('[AuthController] login error', err);
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
  // In test environments or when transactions are not supported by the server,
  // avoid creating sessions to prevent "Transaction numbers are only allowed"
  // errors on standalone Mongo instances. Tests typically run against a
  // lightweight Mongo that doesn't support transactions.
  if (process.env.NODE_ENV === 'test') {
    return { session: null, transactionAvailable: false };
  }

  const session = await RefreshToken.startSession();
  let transactionAvailable = true;

  try {
    session.startTransaction();
  } catch (err) {
    transactionAvailable = false;
  }

  return { session, transactionAvailable };
}

async function refresh(req, res) {
  let session;
  let transactionAvailable = false;

  try {
    const presentedToken =
      req.cookies?.[REFRESH_COOKIE_NAME] ||
      req.body?.refreshToken;

    if (!presentedToken) {
      return res.status(401).json({
        success: false,
        message: 'Missing refresh token',
        code: 'REFRESH_TOKEN_MISSING',
      });
    }

    const presentedHash = hashToken(presentedToken);

    if (!isMongoConnected()) {
      const dbToken = FALLBACK_REFRESH_TOKENS.get(presentedHash);
      if (!dbToken) {
        return res.status(401).json({ success: false, message: 'Invalid refresh token', code: 'REFRESH_TOKEN_INVALID' });
      }
      if (dbToken.revokedAt) {
        return res.status(401).json({ success: false, message: 'Refresh token reuse detected. All sessions have been revoked.', code: 'TOKEN_REUSE_DETECTED' });
      }
      if (dbToken.expiresAt <= new Date()) {
        dbToken.revokedAt = new Date();
        dbToken.revokedReason = 'expired';
        return res.status(401).json({ success: false, message: 'Refresh token expired', code: 'REFRESH_TOKEN_EXPIRED' });
      }
      const user = await findFallbackUserByEmail((await findFallbackUserById(dbToken.userId))?.email || '');
      const fallbackUser = await findFallbackUserById(dbToken.userId);
      if (!fallbackUser) {
        return res.status(401).json({ success: false, message: 'User not found', code: 'USER_NOT_FOUND' });
      }
      if (fallbackUser.status === 'disabled' || fallbackUser.status === 'suspended') {
        dbToken.revokedAt = new Date();
        dbToken.revokedReason = 'account_disabled';
        return res.status(403).json({ success: false, message: 'Account disabled', code: 'ACCOUNT_DISABLED' });
      }
      const { token: newRefreshToken } = await createRefreshToken(fallbackUser._id, dbToken.deviceInfo);
      dbToken.revokedAt = new Date();
      dbToken.revokedReason = 'rotated';
      dbToken.replacedBy = newRefreshToken ? newRefreshToken : null;
      const accessToken = generateAccessToken(fallbackUser);
      setRefreshCookie(res, newRefreshToken);
      return res.status(200).json({ success: true, token: accessToken, expiresIn: ACCESS_TOKEN_EXP });
    }

    ({ session, transactionAvailable } = await createRefreshSession());
    const sessionOptions = transactionAvailable ? { session } : {};

    const dbTokenQuery = RefreshToken.findOne({ tokenHash: presentedHash });
    if (transactionAvailable) {
      dbTokenQuery.session(session);
    }
    const dbToken = await dbTokenQuery.exec();

    if (!dbToken) {
      if (
        transactionAvailable &&
        typeof session.inTransaction === 'function' &&
        session.inTransaction()
      ) {
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
      await RefreshToken.updateMany(
        {
          userId: dbToken.userId,
          revokedAt: null,
        },
        {
          $set: {
            revokedAt: new Date(),
            revokedReason: 'reuse_detected',
          },
        },
        transactionAvailable ? { session } : {}
      );

      if (transactionAvailable) {
        await session.commitTransaction();
      }

      console.warn(
        `[SECURITY] Refresh token reuse detected for user ${dbToken.userId}`
      );

      return res.status(401).json({
        success: false,
        message:
          'Refresh token reuse detected. All sessions have been revoked.',
        code: 'TOKEN_REUSE_DETECTED',
      });
    }

    /**
     * Expiration Check
     */
    if (dbToken.expiresAt <= new Date()) {
      dbToken.revokedAt = new Date();
      dbToken.revokedReason = 'expired';

      await dbToken.save(transactionAvailable ? { session } : {});

      if (transactionAvailable) {
        await session.commitTransaction();
      }

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
    if (transactionAvailable) {
      userQuery.session(session);
    }
    const user = await userQuery.exec();

    if (!user) {
      if (
        transactionAvailable &&
        typeof session.inTransaction === 'function' &&
        session.inTransaction()
      ) {
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
        transactionAvailable ? { session } : {}
      );

      if (transactionAvailable) {
        await session.commitTransaction();
      }

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
      dbToken.deviceInfo
    );

    /**
     * Rotate Existing Token
     */
    dbToken.revokedAt = new Date();
    dbToken.revokedReason = 'rotated';
    dbToken.replacedBy = newDbToken.id;
    dbToken.lastUsedAt = new Date();

    await dbToken.save(transactionAvailable ? { session } : {});

    /**
     * Update New Session Metadata
     */
    newDbToken.lastUsedAt = new Date();
    await newDbToken.save(transactionAvailable ? { session } : {});

    if (transactionAvailable) {
      await session.commitTransaction();
    }

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

    if (session && transactionAvailable && typeof session.inTransaction === 'function' && session.inTransaction()) {
      await session.abortTransaction();
    }

    return res.status(500).json({
      success: false,
      message: 'Refresh failed',
      code: 'REFRESH_FAILED',
    });
  } finally {
    if (session) {
      session.endSession();
    }
  }
}
/**
 * POST /api/auth/logout
 * Revokes current refresh token, clears cookie.
 */
async function logout(req, res) {
  try {
    const presented = req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refreshToken;

    if (presented) {
      const presentedHash = hashToken(presented);

      try {
        if (!isMongoConnected()) {
          const dbToken = FALLBACK_REFRESH_TOKENS.get(presentedHash);
          if (dbToken && !dbToken.revokedAt) {
            dbToken.revokedAt = new Date();
            dbToken.revokedReason = 'logout';
          }
        } else {
          const dbToken = await RefreshToken.findOne({ tokenHash: presentedHash });
          if (dbToken && !dbToken.revokedAt) {
            await RefreshToken.updateOne(
              {
                _id: dbToken._id,
                revokedAt: null,
              },
              {
                $set: {
                  revokedAt: new Date(),
                  revokedReason: 'logout',
                },
              }
            );
          }
        }
      } catch (_) {
        // ignore errors in token lookup
      }
    }

    clearRefreshCookie(res);
    return res.status(204).end();
  } catch (err) {
    console.error('[AuthController] logout error', err);
    return res.status(500).json({ message: 'Logout failed' });
  }
}

/**
 * POST /api/auth/logout-all
 * Revokes all refresh tokens for authenticated user.
 */
async function logoutAll(req, res) {
  try {
    if (!req.user?.id && !req.user?._id) {
      return res.status(401).json({ message: 'Not authenticated' });
    }
    const userId = req.user._id?.toString?.() || req.user.id;
    await RefreshToken.updateMany(
      { userId, revokedAt: null },
      { $set: { revokedAt: new Date(), revokedReason: 'user_logout_all' } }
    );
    clearRefreshCookie(res);
    return res.status(204).end();
  } catch (err) {
    console.error('[AuthController] logoutAll error', err);
    return res.status(500).json({ message: 'Logout all failed' });
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

module.exports = {
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

  // helpers
  findUserByEmail,
  getUserById,
};