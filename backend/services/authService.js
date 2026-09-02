// ============================================================================
// TITech Community Capital
// Enterprise Authentication Service
// File: backend/services/authService.js
// Production Grade
// ============================================================================

"use strict";

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const EventEmitter = require("events");

const logger = require("../utils/logger");
const metrics = require("./metricsService");

let User;
let Tenant;
let AuditLog;
let NotificationService;
let WalletService;

try {
  User = require("../models/User");
} catch (_) {}

try {
  Tenant = require("../models/Tenant");
} catch (_) {}

try {
  AuditLog =
    require("../models/AuditLog");
} catch (_) {}

try {
  NotificationService =
    require("./notificationService");
} catch (_) {}

try {
  WalletService =
    require("./walletService");
} catch (_) {}

const ACCESS_TOKEN_SECRET =
  process.env.JWT_SECRET ||
  process.env.ACCESS_TOKEN_SECRET;

const REFRESH_TOKEN_SECRET =
  process.env.JWT_REFRESH_SECRET ||
  process.env.REFRESH_TOKEN_SECRET;

const ACCESS_TOKEN_EXPIRES =
  process.env.JWT_EXPIRES_IN ||
  "1h";

const REFRESH_TOKEN_EXPIRES =
  process.env.JWT_REFRESH_EXPIRES_IN ||
  "30d";

const BCRYPT_ROUNDS =
  Number(
    process.env.BCRYPT_ROUNDS ||
      12
  );

class AuthService extends EventEmitter {
  constructor() {
    super();

    this.refreshTokens =
      new Map();
  }

  // ===========================================================================
  // Registration
  // ===========================================================================

  async register(payload) {
    const {
      email,
      password,
      firstName,
      lastName,
      phoneNumber,
      role = "member",
      tenantId,
      metadata = {},
    } = payload;

    try {
      const existing =
        await User.findOne({
          $or: [
            { email },
            {
              phoneNumber,
            },
          ],
        });

      if (existing) {
        throw new Error(
          "User already exists"
        );
      }

      const hashedPassword =
        await bcrypt.hash(
          password,
          BCRYPT_ROUNDS
        );

      const user =
        await User.create({
          email:
            email?.toLowerCase(),
          password:
            hashedPassword,
          firstName,
          lastName,
          phoneNumber,
          role,
          tenant:
            tenantId,
          status:
            "ACTIVE",
          emailVerified:
            false,
          phoneVerified:
            false,
          metadata,
        });

      if (
        WalletService?.createWallet
      ) {
        try {
          await WalletService.createWallet(
            {
              userId:
                user._id,
              tenantId,
            }
          );
        } catch (err) {
          logger.warn(
            "Wallet creation failed",
            {
              userId:
                user._id,
              error:
                err.message,
            }
          );
        }
      }

      metrics.increment(
        "auth.register.success"
      );

      await this.audit(
        "USER_REGISTERED",
        user,
        metadata
      );

      this.emit(
        "user.registered",
        user
      );

      return {
        user:
          this.sanitizeUser(
            user
          ),
        tokens:
          await this.generateTokens(
            user
          ),
      };
    } catch (error) {
      metrics.increment(
        "auth.register.failed"
      );

      logger.error(
        "Registration failed",
        {
          email,
          error:
            error.message,
        }
      );

      throw error;
    }
  }

  // ===========================================================================
  // Login
  // ===========================================================================

  async login(payload) {
    const {
      email,
      password,
      tenantId,
      metadata = {},
    } = payload;

    try {
      const user =
        await User.findOne({
          email:
            email.toLowerCase(),
        }).select(
          "+password"
        );

      if (!user) {
        throw new Error(
          "Invalid credentials"
        );
      }

      if (
        user.status !==
        "ACTIVE"
      ) {
        throw new Error(
          "Account disabled"
        );
      }

      if (
        tenantId &&
        String(
          user.tenant
        ) !==
          String(
            tenantId
          )
      ) {
        throw new Error(
          "Invalid tenant"
        );
      }

      const valid =
        await bcrypt.compare(
          password,
          user.password
        );

      if (!valid) {
        throw new Error(
          "Invalid credentials"
        );
      }

      user.lastLoginAt =
        new Date();

      await user.save();

      const tokens =
        await this.generateTokens(
          user
        );

      metrics.increment(
        "auth.login.success"
      );

      await this.audit(
        "USER_LOGIN",
        user,
        metadata
      );

      this.emit(
        "user.login",
        user
      );

      return {
        user:
          this.sanitizeUser(
            user
          ),
        tokens,
      };
    } catch (error) {
      metrics.increment(
        "auth.login.failed"
      );

      logger.error(
        "Login failed",
        {
          email,
          error:
            error.message,
        }
      );

      throw error;
    }
  }

  // ===========================================================================
  // Refresh Token
  // ===========================================================================

  async refreshToken(
    refreshToken
  ) {
    try {
      const payload =
        jwt.verify(
          refreshToken,
          REFRESH_TOKEN_SECRET
        );

      const stored =
        this.refreshTokens.get(
          payload.jti
        );

      if (
        !stored ||
        stored !==
          refreshToken
      ) {
        throw new Error(
          "Invalid refresh token"
        );
      }

      const user =
        await User.findById(
          payload.sub
        );

      if (!user) {
        throw new Error(
          "User not found"
        );
      }

      return this.generateTokens(
        user
      );
    } catch (error) {
      logger.error(
        "Refresh token failed",
        {
          error:
            error.message,
        }
      );

      throw error;
    }
  }

  // ===========================================================================
  // Logout
  // ===========================================================================

  async logout(
    refreshToken
  ) {
    try {
      const payload =
        jwt.decode(
          refreshToken
        );

      if (
        payload?.jti
      ) {
        this.refreshTokens.delete(
          payload.jti
        );
      }

      metrics.increment(
        "auth.logout.success"
      );

      return {
        success: true,
      };
    } catch (error) {
      logger.error(
        "Logout failed",
        {
          error:
            error.message,
        }
      );

      throw error;
    }
  }

  // ===========================================================================
  // Password Change
  // ===========================================================================

  async changePassword({
    userId,
    oldPassword,
    newPassword,
  }) {
    const user =
      await User.findById(
        userId
      ).select(
        "+password"
      );

    if (!user) {
      throw new Error(
        "User not found"
      );
    }

    const valid =
      await bcrypt.compare(
        oldPassword,
        user.password
      );

    if (!valid) {
      throw new Error(
        "Invalid password"
      );
    }

    user.password =
      await bcrypt.hash(
        newPassword,
        BCRYPT_ROUNDS
      );

    user.passwordChangedAt =
      new Date();

    await user.save();

    await this.audit(
      "PASSWORD_CHANGED",
      user
    );

    metrics.increment(
      "auth.password.changed"
    );

    return {
      success: true,
    };
  }

  // ===========================================================================
  // Reset Password
  // ===========================================================================

  async createPasswordResetToken(
    email
  ) {
    const user =
      await User.findOne({
        email:
          email.toLowerCase(),
      });

    if (!user) {
      return;
    }

    const token =
      crypto.randomBytes(
        32
      ).toString("hex");

    user.passwordResetToken =
      crypto
        .createHash(
          "sha256"
        )
        .update(token)
        .digest("hex");

    user.passwordResetExpires =
      Date.now() +
      1000 *
        60 *
        30;

    await user.save();

    if (
      NotificationService?.send
    ) {
      await NotificationService.send(
        {
          userId:
            user._id,
          type:
            "PASSWORD_RESET",
          token,
        }
      );
    }

    return token;
  }

  // ===========================================================================
  // Generate Tokens
  // ===========================================================================

  async generateTokens(
    user
  ) {
    const jti =
      crypto.randomUUID();

    const payload = {
      sub:
        String(user._id),
      tenantId:
        String(
          user.tenant
        ),
      role:
        user.role,
      email:
        user.email,
    };

    const accessToken =
      jwt.sign(
        payload,
        ACCESS_TOKEN_SECRET,
        {
          expiresIn:
            ACCESS_TOKEN_EXPIRES,
          jwtid: jti,
        }
      );

    const refreshToken =
      jwt.sign(
        payload,
        REFRESH_TOKEN_SECRET,
        {
          expiresIn:
            REFRESH_TOKEN_EXPIRES,
          jwtid: jti,
        }
      );

    this.refreshTokens.set(
      jti,
      refreshToken
    );

    return {
      accessToken,
      refreshToken,
      expiresIn:
        ACCESS_TOKEN_EXPIRES,
      tokenType:
        "Bearer",
    };
  }

  // ===========================================================================
  // Verify Access Token
  // ===========================================================================

  verifyAccessToken(
    token
  ) {
    return jwt.verify(
      token,
      ACCESS_TOKEN_SECRET
    );
  }

  // ===========================================================================
  // Verify Refresh Token
  // ===========================================================================

  verifyRefreshToken(
    token
  ) {
    return jwt.verify(
      token,
      REFRESH_TOKEN_SECRET
    );
  }

  // ===========================================================================
  // User Sanitizer
  // ===========================================================================

  sanitizeUser(user) {
    const obj =
      user.toObject
        ? user.toObject()
        : { ...user };

    delete obj.password;
    delete obj.passwordResetToken;
    delete obj.passwordResetExpires;

    return obj;
  }

  // ===========================================================================
  // Audit
  // ===========================================================================

  async audit(
    action,
    user,
    metadata = {}
  ) {
    try {
      if (
        !AuditLog
      ) {
        return;
      }

      await AuditLog.create({
        action,
        tenant:
          user.tenant,
        user:
          user._id,
        metadata,
        createdAt:
          new Date(),
      });
    } catch (error) {
      logger.error(
        "Audit failed",
        {
          action,
          error:
            error.message,
        }
      );
    }
  }

  // ===========================================================================
  // Health
  // ===========================================================================

  async health() {
    return {
      service:
        "auth-service",
      status:
        "healthy",
      refreshTokens:
        this.refreshTokens
          .size,
      uptime:
        process.uptime(),
      timestamp:
        new Date().toISOString(),
    };
  }
}

module.exports =
  new AuthService();