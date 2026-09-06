"use strict";

/**
 * =============================================================================
 * TITech Community Capital
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/services/passwordResetService.js
 *
 * Purpose:
 *   Enterprise password-reset orchestration service.
 *
 * Security Architecture:
 *
 *   Password Reset Request
 *        |
 *        v
 *   Generate cryptographically random token
 *        |
 *        v
 *   SHA-256 token hash
 *        |
 *        v
 *   Revoke previous active tokens
 *        |
 *        v
 *   Persist ONLY tokenHash
 *        |
 *        v
 *   Deliver raw token through approved channel
 *
 *   Password Reset
 *        |
 *        v
 *   Validate password policy
 *        |
 *        v
 *   Resolve user + tenant context
 *        |
 *        v
 *   Hash submitted token
 *        |
 *        v
 *   MongoDB transaction
 *        |
 *        +---- Atomically consume token
 *        |
 *        +---- Change password
 *        |
 *        +---- Update passwordResetAt
 *        |
 *        v
 *   Commit
 *        |
 *        v
 *   Invalidate sessions / refresh tokens
 *
 * Security Requirements:
 *   - Plaintext reset tokens are NEVER persisted.
 *   - Plaintext tokens are NEVER logged.
 *   - Reset tokens are cryptographically random.
 *   - Only SHA-256 token hashes are stored.
 *   - Tokens are single-use.
 *   - Token consumption is atomic.
 *   - Password update and token consumption are transactional.
 *   - Existing active reset tokens are revoked when a new one is created.
 *   - Expiration is verified at application level.
 *   - Password strength is validated using deterministic rules + zxcvbn.
 *   - Current password reuse is rejected.
 *   - Tenant context is preserved where available.
 *   - Session invalidation happens after successful password reset.
 *   - Reset tokens are not exposed in logs.
 *
 * IMPORTANT:
 *   MongoDB transactions require a replica set or MongoDB sharded deployment.
 *   Production TITech deployments should run MongoDB in a transaction-capable
 *   configuration.
 *
 * =============================================================================
 */

const crypto = require("crypto");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const zxcvbn = require("zxcvbn");

const PasswordResetToken = require("../models/PasswordResetToken");
const User = require("../models/User");
const logger = require("../utils/logger");

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const DEFAULT_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

const DEFAULT_BCRYPT_ROUNDS = 12;

const DEFAULT_RESET_TOKEN_BYTES = 32;

const RAW_TOKEN_LENGTH = DEFAULT_RESET_TOKEN_BYTES * 2;

const MIN_PASSWORD_LENGTH = 12;
const REQUIRED_ZXCVBN_SCORE = 3;

const METADATA_MAX_KEYS = 20;

/**
 * Common passwords.
 *
 * zxcvbn already contains a substantially larger dictionary, but these are
 * cheap explicit checks and make the policy easy to understand.
 */
const COMMON_PASSWORDS = new Set([
  "password",
  "123456",
  "123456789",
  "qwerty",
  "welcome",
  "12345678",
  "abc123",
  "111111",
  "password123",
  "admin",
  "admin123",
  "letmein",
  "iloveyou",
]);

/**
 * =============================================================================
 * Utility Functions
 * =============================================================================
 */

/**
 * Generate a cryptographically secure plaintext reset token.
 *
 * This value may be sent to the user but MUST NEVER be persisted.
 */
function generateResetToken() {
  return crypto
    .randomBytes(DEFAULT_RESET_TOKEN_BYTES)
    .toString("hex");
}

/**
 * Hash a plaintext reset token.
 *
 * The PasswordResetToken model expects a 64-character lowercase SHA-256 digest.
 */
function hashResetToken(token) {
  if (typeof token !== "string") {
    throw new TypeError("Reset token must be a string");
  }

  const normalizedToken = token.trim();

  if (
    normalizedToken.length !== RAW_TOKEN_LENGTH ||
    !/^[a-f0-9]+$/i.test(normalizedToken)
  ) {
    throw new Error("Invalid password reset token format");
  }

  return crypto
    .createHash("sha256")
    .update(normalizedToken, "utf8")
    .digest("hex");
}

/**
 * Backward-compatible alias for existing imports.
 */
const HASH_TOKEN = hashResetToken;

/**
 * Safely return the user's email local-part.
 */
function getEmailLocalPart(email) {
  if (typeof email !== "string") {
    return "";
  }

  const normalized = email.trim().toLowerCase();

  if (!normalized.includes("@")) {
    return "";
  }

  return normalized.split("@")[0].trim();
}

/**
 * Determine whether a value is a valid MongoDB ObjectId.
 */
function isValidObjectId(value) {
  return mongoose.isValidObjectId(value);
}

/**
 * Normalize optional audit metadata.
 */
function sanitizeMetadata(metadata = {}) {
  if (
    !metadata ||
    typeof metadata !== "object" ||
    Array.isArray(metadata)
  ) {
    return {};
  }

  const allowedKeys = [
    "source",
    "channel",
    "locale",
    "deliveryProvider",
    "tenantId",
  ];

  const result = {};

  for (const key of allowedKeys) {
    if (
      Object.prototype.hasOwnProperty.call(metadata, key) &&
      metadata[key] != null
    ) {
      const value = String(metadata[key]);

      if (value.length <= 256) {
        result[key] = value;
      }
    }
  }

  return Object.fromEntries(
    Object.entries(result).slice(0, METADATA_MAX_KEYS)
  );
}

/**
 * =============================================================================
 * Password Validation
 * =============================================================================
 */

/**
 * Enterprise password validator.
 *
 * Requirements:
 *   - At least 12 characters.
 *   - Uppercase.
 *   - Lowercase.
 *   - Numeric character.
 *   - Special character.
 *   - Not in known common-password list.
 *   - Does not contain email local-part.
 *   - zxcvbn score >= 3.
 */
function validatePasswordEnterprise(password, context = {}) {
  if (typeof password !== "string") {
    return {
      valid: false,
      score: 0,
      entropy: 0,
      guesses: 0,
      feedback: {
        warning: "Password must be a string",
        suggestions: [],
      },
      rules: {
        minLength: false,
        hasUpperCase: false,
        hasLowerCase: false,
        hasNumber: false,
        hasSpecialChar: false,
        notCommonPassword: false,
        noUserInfo: false,
      },
      message: "Password does not meet security requirements",
    };
  }

  const emailLocalPart = getEmailLocalPart(context.email);

  const result = zxcvbn(password, [
    context.email || "",
    context.name || "",
    emailLocalPart || "",
  ]);

  const normalizedPassword = password.toLowerCase();

  const rules = {
    minLength: password.length >= MIN_PASSWORD_LENGTH,

    hasUpperCase: /[A-Z]/.test(password),

    hasLowerCase: /[a-z]/.test(password),

    hasNumber: /[0-9]/.test(password),

    hasSpecialChar:
      /[!@#$%^&*()_+\-={}[\]:";'<>?,./|\\`~]/.test(password),

    notCommonPassword:
      !COMMON_PASSWORDS.has(normalizedPassword),

    noUserInfo:
      !emailLocalPart ||
      !normalizedPassword.includes(emailLocalPart),
  };

  const allRulesPassed = Object.values(rules).every(Boolean);

  const adaptiveValid =
    result.score >= REQUIRED_ZXCVBN_SCORE;

  const valid = allRulesPassed && adaptiveValid;

  return {
    valid,
    score: result.score,
    entropy: result.guesses,
    guesses: result.guesses,
    feedback: result.feedback,
    rules,
    message: valid
      ? null
      : buildPasswordErrorMessage(rules, result),
  };
}

/**
 * Build a deterministic and user-friendly password error.
 */
function buildPasswordErrorMessage(rules, result) {
  if (!rules.minLength) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }

  if (!rules.hasUpperCase) {
    return "Password must contain at least one uppercase letter";
  }

  if (!rules.hasLowerCase) {
    return "Password must contain at least one lowercase letter";
  }

  if (!rules.hasNumber) {
    return "Password must contain at least one number";
  }

  if (!rules.hasSpecialChar) {
    return "Password must contain at least one special character";
  }

  if (!rules.notCommonPassword) {
    return "Password is too common";
  }

  if (!rules.noUserInfo) {
    return "Password must not contain personal information";
  }

  if (result.score < REQUIRED_ZXCVBN_SCORE) {
    return "Password is too weak. Use a longer or more unpredictable password.";
  }

  return "Password does not meet security requirements";
}

/**
 * Backward-compatible password validator.
 */
const validatePasswordStrength = (password, context = {}) =>
  validatePasswordEnterprise(password, context);

/**
 * =============================================================================
 * Password Reset Service
 * =============================================================================
 */

class PasswordResetService {
  constructor(config = {}) {
    this.tokenTTL =
      Number.isFinite(config.tokenTTL) && config.tokenTTL > 0
        ? config.tokenTTL
        : DEFAULT_TOKEN_TTL_MS;

    this.bcryptRounds =
      Number.isInteger(config.bcryptRounds) &&
      config.bcryptRounds >= 10 &&
      config.bcryptRounds <= 15
        ? config.bcryptRounds
        : DEFAULT_BCRYPT_ROUNDS;

    this.emailService = config.emailService || null;

    this.sessionService = config.sessionService || null;

    /**
     * Enforce transaction usage by default.
     *
     * Set to false only for explicitly controlled environments where MongoDB
     * transactions are unavailable. This is NOT recommended for production.
     */
    this.requireTransactions =
      config.requireTransactions !== false;
  }

  /**
   * ===========================================================================
   * Create Password Reset Token
   * ===========================================================================
   *
   * Creates a new one-time reset token and revokes previous active tokens.
   *
   * @param {Object} user
   * @param {Object} options
   * @returns {Object}
   */
  async createResetToken(user, options = {}) {
    // Backward-compatible service contract: accept either a User object or
    // an ObjectId. The database remains the authoritative source of identity.
    if (user && !user._id && isValidObjectId(user)) {
      user = await User.findById(user).select(
        "_id email name tenantId"
      );
    }

    if (!user || !user._id) {
      throw new Error("A valid user is required");
    }

    if (!user.email) {
      throw new Error("User email is required for password reset");
    }

    const userId = user._id;

    const tenantId =
      options.tenantId ||
      user.tenantId ||
      null;

    if (
      tenantId != null &&
      !isValidObjectId(tenantId)
    ) {
      throw new Error("Invalid tenant context");
    }

    const rawToken = generateResetToken();

    const tokenHash = HASH_TOKEN(rawToken);

    const expiresAt = new Date(
      Date.now() + this.tokenTTL
    );

    let tokenRecord;

    try {
      /**
       * Revoke previous active reset tokens first.
       */
      await PasswordResetToken.revokeActiveForUser(
        userId,
        "superseded_by_new_request",
        {
          tenantId,
        }
      );

      tokenRecord = await PasswordResetToken.create({
        user: userId,
        tenantId,

        purpose: "password_reset",

        tokenHash,

        expiresAt,

        requestIp: options.requestIp || null,

        userAgent: options.userAgent || null,

        requestId: options.requestId || null,

        metadata: sanitizeMetadata(options.metadata),
      });

      logger.info(
        "[PasswordResetService] Password reset token created",
        {
          userId,
          tenantId,
          tokenId: tokenRecord._id,
          expiresAt,
          requestId: options.requestId || null,
        }
      );

      /**
       * Deliver plaintext token ONLY through the configured delivery service.
       *
       * Never log rawToken.
       */
      if (this.emailService) {
        try {
          const frontendUrl =
            process.env.FRONTEND_URL;

          if (!frontendUrl) {
            throw new Error(
              "FRONTEND_URL is not configured"
            );
          }

          const resetUrl =
            `${frontendUrl.replace(/\/+$/, "")}` +
            `/reset-password?token=${encodeURIComponent(rawToken)}`;

          await this.emailService.sendPasswordReset(
            user.email,
            {
              userId,
              name:
                user.name ||
                getEmailLocalPart(user.email) ||
                "User",
              token: rawToken,
              frontendResetUrl: resetUrl,
              expiresInHours:
                this.tokenTTL /
                (60 * 60 * 1000),
            }
          );

          logger.info(
            "[PasswordResetService] Password reset delivery completed",
            {
              userId,
              tokenId: tokenRecord._id,
              expiresAt,
            }
          );
        } catch (deliveryError) {
          /**
           * Do not leave an active token when delivery failed.
           */
          await PasswordResetToken.findOneAndUpdate(
            {
              _id: tokenRecord._id,
              used: false,
              revoked: false,
            },
            {
              $set: {
                revoked: true,
                revokedAt: new Date(),
                revocationReason:
                  "delivery_failed",
              },
            }
          );

          logger.error(
            "[PasswordResetService] Password reset delivery failed",
            {
              error: deliveryError.message,
              userId,
              tokenId: tokenRecord._id,
            }
          );

          throw deliveryError;
        }
      } else {
        logger.warn(
          "[PasswordResetService] No password reset email service configured",
          {
            userId,
            tokenId: tokenRecord._id,
          }
        );
      }

      /**
       * The raw token is returned strictly for orchestration/testing
       * compatibility. Controllers must NEVER log or expose it except through
       * the intended reset delivery channel.
       */
      return {
        success: true,
        token: rawToken,
        tokenId: tokenRecord._id,
        expiresAt,
      };
    } catch (error) {
      /**
       * Never include the raw token in logs or thrown error messages.
       */
      logger.error(
        "[PasswordResetService] Error creating reset token",
        {
          error: error.message,
          userId,
          tenantId,
        }
      );

      throw error;
    }
  }

  /**
   * ===========================================================================
   * Reset Password
   * ===========================================================================
   *
   * Atomically:
   *
   *   1. Consumes reset token.
   *   2. Updates password.
   *   3. Updates passwordResetAt.
   *
   * The transaction prevents:
   *
   *   - password updated + token still reusable
   *   - token consumed + password update failed
   *
   * @param {String} userId
   * @param {String} token
   * @param {String} newPassword
   * @param {Object} options
   */
  async resetPassword(
    userId,
    token,
    newPassword,
    options = {}
  ) {
    if (!userId || !token || !newPassword) {
      throw new Error(
        "User ID, reset token, and new password are required"
      );
    }

    if (!isValidObjectId(userId)) {
      throw new Error("Invalid user ID");
    }

    /**
     * Password validation is deliberately performed before database mutation.
     */
    const userForPasswordCheck =
      await User.findById(userId)
        .select(
          "_id email name password tenantId"
        )
        .lean();

    if (!userForPasswordCheck) {
      /**
       * Avoid revealing unnecessary account state details.
       */
      throw new Error(
        "Unable to complete password reset"
      );
    }

    const passwordStrength =
      validatePasswordEnterprise(
        newPassword,
        {
          email: userForPasswordCheck.email,
          name: userForPasswordCheck.name,
        }
      );

    if (!passwordStrength.valid) {
      logger.warn(
        "[PasswordResetService] Password policy rejected",
        {
          userId,
          score: passwordStrength.score,
          rules: passwordStrength.rules,
        }
      );

      throw new Error(
        passwordStrength.message
      );
    }

    /**
     * Prevent immediate password reuse.
     */
    if (userForPasswordCheck.password) {
      const isSamePassword =
        await bcrypt.compare(
          newPassword,
          userForPasswordCheck.password
        );

      if (isSamePassword) {
        throw new Error(
          "New password must be different from the current password"
        );
      }
    }

    const tokenHash = HASH_TOKEN(token);

    const tenantId =
      options.tenantId ||
      userForPasswordCheck.tenantId ||
      null;

    let session = null;

    try {
      /**
       * -----------------------------------------------------------------------
       * Transaction
       * -----------------------------------------------------------------------
       */

      const useTransaction =
        this.requireTransactions &&
        process.env.NODE_ENV !== "test";

      if (useTransaction) {
        session = await mongoose.startSession();
      }

      let resetResult = null;

      const executeReset = async (transactionSession = null) => {
        /**
         * Consume token atomically.
         *
         * No separate "find token -> mark used" race window exists.
         */
        const consumedToken =
          await PasswordResetToken.consumeAtomically(
            tokenHash,
            {
              userId,
              tenantId,
              session: transactionSession,
              ip: options.requestIp || null,
              userAgent:
                options.userAgent || null,
              requestId:
                options.requestId || null,
            }
          );

        if (!consumedToken) {
          logger.warn(
            "[PasswordResetService] Invalid, expired, revoked, or already-used reset token",
            {
              userId,
              tenantId,
              requestId:
                options.requestId || null,
            }
          );

          throw new Error(
            "Invalid or expired password reset token"
          );
        }

        /**
         * Strong password hash.
         */
        const passwordHash =
          await bcrypt.hash(
            newPassword,
            this.bcryptRounds
          );

        /**
         * Update password ONLY after successful atomic token consumption,
         * inside the same transaction.
         */
        const updatedUser =
          await User.findOneAndUpdate(
            {
              _id: userId,
            },
            {
              $set: {
                password: passwordHash,
                passwordResetAt: new Date(),
                passwordResetAttempts: 0,
              },
            },
            {
              new: true,
              runValidators: true,
              session: transactionSession,
            }
          ).select(
            "_id email tenantId"
          );

        if (!updatedUser) {
          throw new Error(
            "Unable to complete password reset"
          );
        }

        /**
         * Revoke any other active reset tokens.
         *
         * The just-consumed token is already used and therefore excluded.
         */
        await PasswordResetToken.revokeActiveForUser(
          userId,
          "password_successfully_changed",
          {
            tenantId,
            session: transactionSession,
          }
        );

        resetResult = {
          user: updatedUser,
          tokenId: consumedToken._id,
          attemptsMade: 1,
        };
      };

      if (useTransaction) {
        await session.withTransaction(() =>
          executeReset(session)
        );
      } else {
        // Controlled test/development path for standalone MongoDB. Production
        // retains transaction-backed atomicity by default.
        await executeReset(null);
      }

      /**
       * -----------------------------------------------------------------------
       * Post-transaction security controls
       * -----------------------------------------------------------------------
       */

      if (
        this.sessionService &&
        typeof this.sessionService
          .invalidateUserSessions ===
          "function"
      ) {
        try {
          await this.sessionService.invalidateUserSessions(
            userId
          );

          logger.info(
            "[PasswordResetService] User sessions invalidated",
            {
              userId,
            }
          );
        } catch (sessionError) {
          /**
           * Password reset has already committed.
           *
           * Session invalidation failure must be treated as a security
           * incident / follow-up operation, not as a reason to pretend the
           * password reset failed.
           */
          logger.error(
            "[PasswordResetService] Session invalidation failed after password reset",
            {
              error: sessionError.message,
              userId,
            }
          );
        }
      }

      logger.info(
        "[PasswordResetService] Password reset successfully completed",
        {
          userId,
          tenantId,
          tokenId: resetResult.tokenId,
          requestId:
            options.requestId || null,
        }
      );

      return {
        success: true,
        message:
          "Password reset successfully. Please login with your new password.",
        user: {
          id: resetResult.user._id,
          email: resetResult.user.email,
        },
      };
    } catch (error) {
      logger.error(
        "[PasswordResetService] Password reset failed",
        {
          error: error.message,
          userId,
          tenantId,
          requestId:
            options.requestId || null,
        }
      );

      throw error;
    } finally {
      if (session) {
        await session.endSession();
      }
    }
  }

  /**
   * ===========================================================================
   * Verify Reset Token
   * ===========================================================================
   *
   * Read-only validation used by the frontend before displaying the final
   * password-change form.
   */
  async verifyResetToken(
    userId,
    token,
    options = {}
  ) {
    if (!userId || !token) {
      return {
        valid: false,
        reason: "Invalid token",
      };
    }

    if (!isValidObjectId(userId)) {
      return {
        valid: false,
        reason: "Invalid token",
      };
    }

    try {
      const tokenHash =
        HASH_TOKEN(token);

      const tenantId =
        options.tenantId || null;

      const tokenRecord =
        await PasswordResetToken.findActiveByHash(
          tokenHash,
          {
            userId,
            tenantId,
          }
        );

      if (!tokenRecord) {
        return {
          valid: false,
          reason: "Invalid or expired token",
        };
      }

      const remainingMs =
        tokenRecord.expiresAt.getTime() -
        Date.now();

      if (remainingMs <= 0) {
        return {
          valid: false,
          reason: "Token expired",
          expiresAt: tokenRecord.expiresAt,
        };
      }

      return {
        valid: true,
        expiresAt: tokenRecord.expiresAt,
        remainingMinutes: Math.ceil(
          remainingMs / (60 * 1000)
        ),
      };
    } catch (error) {
      /**
       * Do not return implementation details to callers.
       */
      logger.warn(
        "[PasswordResetService] Reset-token verification failed",
        {
          error: error.message,
          userId,
        }
      );

      return {
        valid: false,
        reason: "Invalid or expired token",
      };
    }
  }

  /**
   * ===========================================================================
   * Cleanup Expired Tokens
   * ===========================================================================
   *
   * MongoDB TTL already performs physical cleanup.
   *
   * This method remains useful as an explicit maintenance operation and for
   * installations where operators want deterministic cleanup jobs.
   */
  async cleanupExpiredTokens() {
    try {
      const result =
        await PasswordResetToken.deleteMany({
          expiresAt: {
            $lte: new Date(),
          },
        });

      const deletedCount =
        result.deletedCount || 0;

      logger.info(
        "[PasswordResetService] Expired reset tokens cleanup completed",
        {
          deletedCount,
        }
      );

      return deletedCount;
    } catch (error) {
      logger.error(
        "[PasswordResetService] Expired reset token cleanup failed",
        {
          error: error.message,
        }
      );

      throw error;
    }
  }

  /**
   * ===========================================================================
   * Get Reset Status
   * ===========================================================================
   *
   * Administrative/application status only.
   *
   * Does not expose token hashes or plaintext tokens.
   */
  async getResetStatus(
    userId,
    options = {}
  ) {
    if (!isValidObjectId(userId)) {
      throw new Error("Invalid user ID");
    }

    try {
      const filter = {
        user: userId,
        purpose: "password_reset",
        used: false,
        revoked: false,
        isDeleted: false,
        expiresAt: {
          $gt: new Date(),
        },
      };

      if (options.tenantId != null) {
        filter.tenantId =
          options.tenantId;
      }

      const pendingToken =
        await PasswordResetToken.findOne(
          filter,
          {
            expiresAt: 1,
          }
        ).sort({
          createdAt: -1,
        });

      return {
        hasPendingReset: Boolean(
          pendingToken
        ),
        expiresAt:
          pendingToken?.expiresAt ||
          null,
      };
    } catch (error) {
      logger.error(
        "[PasswordResetService] Error getting reset status",
        {
          error: error.message,
          userId,
        }
      );

      throw error;
    }
  }
}

/**
 * =============================================================================
 * Exports
 * =============================================================================
 */

module.exports = PasswordResetService;

/**
 * Optional named exports retained for compatibility with existing imports.
 */
module.exports.validatePasswordEnterprise =
  validatePasswordEnterprise;

module.exports.validatePasswordStrength =
  validatePasswordStrength;

module.exports.HASH_TOKEN =
  HASH_TOKEN;

module.exports.hashResetToken =
  hashResetToken;