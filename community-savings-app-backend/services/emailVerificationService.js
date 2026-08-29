"use strict";

/**
 * =============================================================================
 * TITech Community Capital
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/services/emailVerificationService.js
 *
 * Purpose:
 *   Enterprise email-verification lifecycle service.
 *
 * Security Architecture:
 *
 *   Registration / Verification Request
 *        |
 *        v
 *   Generate cryptographically secure random token
 *        |
 *        v
 *   SHA-256(token)
 *        |
 *        v
 *   Revoke previous active verification tokens
 *        |
 *        v
 *   Persist ONLY tokenHash
 *        |
 *        v
 *   Deliver plaintext token through approved email service
 *
 *   Verification
 *        |
 *        v
 *   Validate token format
 *        |
 *        v
 *   Resolve tenant + user
 *        |
 *        v
 *   Atomic token consumption + User.emailVerified update
 *        |
 *        v
 *   Commit transaction
 *
 * Security Guarantees:
 *   - Plaintext tokens are NEVER persisted.
 *   - Plaintext tokens are NEVER logged.
 *   - SHA-256 token hashes are persisted.
 *   - Tokens are cryptographically random.
 *   - Tokens are single-use.
 *   - Expiration is validated at application level.
 *   - Token consumption is concurrency-safe.
 *   - User verification and token consumption are transactional.
 *   - Previous active tokens are revoked when a new token is issued.
 *   - Delivery failure revokes the newly-created token.
 *   - Tenant context can be enforced.
 *   - Request metadata is preserved without storing secrets.
 *
 * MongoDB transaction requirement:
 *   Production MongoDB must support transactions via replica set or sharding.
 *
 * =============================================================================
 */

const crypto = require("crypto");
const mongoose = require("mongoose");

const EmailVerificationToken = require("../models/EmailVerificationToken");
const User = require("../models/User");
const logger = require("../utils/logger");

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const DEFAULT_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const DEFAULT_TOKEN_BYTES = 32;

const RAW_TOKEN_LENGTH = DEFAULT_TOKEN_BYTES * 2;

const TOKEN_HASH_LENGTH = 64;

const DEFAULT_RESEND_THROTTLE_MS =
  5 * 60 * 1000; // 5 minutes

const DEFAULT_MAX_RESEND_ATTEMPTS = 5;

const DEFAULT_RESEND_WINDOW_MS =
  24 * 60 * 60 * 1000; // 24 hours

/**
 * =============================================================================
 * Utility Functions
 * =============================================================================
 */

/**
 * Generate cryptographically secure random verification token.
 *
 * The plaintext value must never be persisted or logged.
 */
function generateVerificationToken() {
  return crypto
    .randomBytes(DEFAULT_TOKEN_BYTES)
    .toString("hex");
}

/**
 * Hash a plaintext verification token.
 *
 * Persistence format:
 *   SHA-256 -> lowercase hexadecimal -> 64 chars.
 */
function hashVerificationToken(token) {
  if (typeof token !== "string") {
    throw new TypeError(
      "Verification token must be a string"
    );
  }

  const normalizedToken = token.trim();

  if (
    normalizedToken.length !== RAW_TOKEN_LENGTH ||
    !/^[a-f0-9]+$/i.test(normalizedToken)
  ) {
    throw new Error(
      "Invalid verification token format"
    );
  }

  return crypto
    .createHash("sha256")
    .update(normalizedToken, "utf8")
    .digest("hex");
}

/**
 * Backward-compatible alias.
 */
const HASH_TOKEN = hashVerificationToken;

/**
 * ObjectId validation.
 */
function isValidObjectId(value) {
  return mongoose.isValidObjectId(value);
}

/**
 * Sanitize optional audit metadata.
 *
 * Never accept arbitrary secrets into metadata.
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
      Object.prototype.hasOwnProperty.call(
        metadata,
        key
      ) &&
      metadata[key] != null
    ) {
      const value = String(metadata[key]);

      if (value.length <= 256) {
        result[key] = value;
      }
    }
  }

  return result;
}

/**
 * Normalize frontend URL.
 */
function buildVerificationUrl(
  frontendUrl,
  userId,
  token
) {
  if (!frontendUrl) {
    throw new Error(
      "FRONTEND_URL is not configured"
    );
  }

  const baseUrl =
    String(frontendUrl).replace(/\/+$/, "");

  return (
    `${baseUrl}/verify-email` +
    `?token=${encodeURIComponent(token)}` +
    `&id=${encodeURIComponent(String(userId))}`
  );
}

/**
 * =============================================================================
 * EmailVerificationService
 * =============================================================================
 */

class EmailVerificationService {
  constructor(config = {}) {
    this.tokenTTL =
      Number.isFinite(config.tokenTTL) &&
      config.tokenTTL > 0
        ? config.tokenTTL
        : DEFAULT_TOKEN_TTL_MS;

    this.resendThrottleTime =
      Number.isFinite(
        config.resendThrottleTime
      ) &&
      config.resendThrottleTime >= 0
        ? config.resendThrottleTime
        : DEFAULT_RESEND_THROTTLE_MS;

    this.maxResendAttempts =
      Number.isInteger(
        config.maxResendAttempts
      ) &&
      config.maxResendAttempts > 0
        ? config.maxResendAttempts
        : DEFAULT_MAX_RESEND_ATTEMPTS;

    this.resendWindowMs =
      Number.isFinite(
        config.resendWindowMs
      ) &&
      config.resendWindowMs > 0
        ? config.resendWindowMs
        : DEFAULT_RESEND_WINDOW_MS;

    this.emailService =
      config.emailService || null;

    this.requireTransactions =
      config.requireTransactions !== false;
  }

  /**
   * ===========================================================================
   * Generate Verification Token + Send Email
   * ===========================================================================
   *
   * @param {Object} user
   * @param {boolean} isResend
   * @param {Object} options
   *
   * @returns {Object}
   *
   * {
   *   success,
   *   token,       // delivery/orchestration only
   *   tokenId,
   *   expiresAt
   * }
   */
  async generateTokenAndSend(
    user,
    isResend = false,
    options = {}
  ) {
    if (!user || !user._id) {
      throw new Error(
        "A valid user is required"
      );
    }

    if (!user.email) {
      throw new Error(
        "User email is required"
      );
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
      throw new Error(
        "Invalid tenant context"
      );
    }

    try {
      /**
       * Never issue another token for an already verified address.
       */
      if (user.emailVerified === true) {
        logger.warn(
          "[EmailVerificationService] Verification requested for already verified email",
          {
            userId,
            tenantId,
          }
        );

        throw new Error(
          "Email already verified"
        );
      }

      /**
       * -----------------------------------------------------------------------
       * Resend throttling
       * -----------------------------------------------------------------------
       *
       * This is an application-level control.
       *
       * A production deployment should additionally enforce:
       *
       *   - IP rate limiting
       *   - account/user rate limiting
       *   - reverse-proxy/WAF controls
       *   - abuse monitoring
       */
      if (isResend) {
        const throttleSince = new Date(
          Date.now() -
            this.resendThrottleTime
        );

        const recentToken =
          await EmailVerificationToken.findOne(
            {
              user: userId,
              ...(tenantId != null
                ? { tenantId }
                : {}),
              createdAt: {
                $gte: throttleSince,
              },
            }
          ).sort({
            createdAt: -1,
          });

        if (recentToken) {
          const elapsed =
            Date.now() -
            recentToken.createdAt.getTime();

          const waitSeconds = Math.max(
            1,
            Math.ceil(
              (this.resendThrottleTime -
                elapsed) /
                1000
            )
          );

          logger.warn(
            "[EmailVerificationService] Verification resend throttled",
            {
              userId,
              tenantId,
              waitSeconds,
            }
          );

          throw new Error(
            `Please wait ${waitSeconds} seconds before requesting another verification email.`
          );
        }

        /**
         * Count recent verification requests.
         *
         * This is intentionally used as a secondary abuse-control measure,
         * not as the core token security mechanism.
         */
        const windowStart =
          new Date(
            Date.now() -
              this.resendWindowMs
          );

        const resendCount =
          await EmailVerificationToken.countDocuments(
            {
              user: userId,
              ...(tenantId != null
                ? { tenantId }
                : {}),
              createdAt: {
                $gte: windowStart,
              },
            }
          );

        if (
          resendCount >=
          this.maxResendAttempts
        ) {
          logger.warn(
            "[EmailVerificationService] Maximum verification resend attempts exceeded",
            {
              userId,
              tenantId,
              resendCount,
            }
          );

          throw new Error(
            "Maximum verification email attempts exceeded. Please contact support."
          );
        }
      }

      /**
       * -----------------------------------------------------------------------
       * Generate token
       * -----------------------------------------------------------------------
       */
      const rawToken =
        generateVerificationToken();

      const tokenHash =
        HASH_TOKEN(rawToken);

      const expiresAt = new Date(
        Date.now() + this.tokenTTL
      );

      /**
       * -----------------------------------------------------------------------
       * Supersede previous active tokens
       * -----------------------------------------------------------------------
       *
       * The service deliberately does not rely on multiple simultaneously
       * active verification links.
       *
       * Only the most recently issued active token should remain usable.
       */
      await this.revokeActiveTokensForUser(
        userId,
        "superseded_by_new_verification_request",
        {
          tenantId,
          requestId:
            options.requestId,
        }
      );

      /**
       * -----------------------------------------------------------------------
       * Persist hash only
       * -----------------------------------------------------------------------
       */
      const record =
        await EmailVerificationToken.create({
          user: userId,

          ...(tenantId != null
            ? { tenantId }
            : {}),

          tokenHash,

          expiresAt,

          isResend: Boolean(isResend),

          ipAddress:
            options.requestIp || null,

          userAgent:
            options.userAgent || null,

          requestId:
            options.requestId || null,

          metadata:
            sanitizeMetadata(
              options.metadata
            ),
        });

      logger.info(
        "[EmailVerificationService] Verification token created",
        {
          userId,
          tenantId,
          tokenId: record._id,
          expiresAt,
          isResend: Boolean(isResend),
          requestId:
            options.requestId || null,
        }
      );

      /**
       * -----------------------------------------------------------------------
       * Email delivery
       * -----------------------------------------------------------------------
       */
      if (this.emailService) {
        try {
          const frontendVerifyUrl =
            buildVerificationUrl(
              process.env.FRONTEND_URL,
              userId,
              rawToken
            );

          await this.emailService.sendVerificationEmail(
            user.email,
            {
              userId,
              name:
                user.name ||
                String(user.email)
                  .split("@")[0],

              /**
               * Raw token exists only for delivery.
               * NEVER log this value.
               */
              token: rawToken,

              frontendVerifyUrl,

              expiresInHours:
                this.tokenTTL /
                (60 * 60 * 1000),
            }
          );

          logger.info(
            "[EmailVerificationService] Verification email sent",
            {
              userId,
              tenantId,
              tokenId: record._id,
            }
          );
        } catch (deliveryError) {
          /**
           * Do not leave an active verification credential if delivery failed.
           */
          await this.revokeToken(
            record._id,
            "delivery_failed"
          );

          logger.error(
            "[EmailVerificationService] Verification email delivery failed",
            {
              userId,
              tenantId,
              tokenId: record._id,
              error:
                deliveryError.message,
            }
          );

          throw deliveryError;
        }
      } else {
        logger.warn(
          "[EmailVerificationService] Email service not configured",
          {
            userId,
            tenantId,
            tokenId: record._id,
          }
        );
      }

      /**
       * The raw token is returned for compatibility with existing orchestration.
       *
       * Controllers should NOT return this directly to the client in production
       * registration flows. It should be delivered through the email channel.
       */
      return {
        success: true,
        token: rawToken,
        tokenId: record._id,
        expiresAt,
      };
    } catch (error) {
      logger.error(
        "[EmailVerificationService] Failed to generate verification token",
        {
          userId,
          tenantId,
          error: error.message,
        }
      );

      throw error;
    }
  }

  /**
   * ===========================================================================
   * Verify Token
   * ===========================================================================
   *
   * Atomically:
   *
   *   1. Consume verification token.
   *   2. Set User.emailVerified = true.
   *
   * @param {String} userId
   * @param {String} token
   * @param {Object} options
   */
  async verifyToken(
    userId,
    token,
    options = {}
  ) {
    if (!userId || !token) {
      throw new Error(
        "User ID and verification token are required"
      );
    }

    if (!isValidObjectId(userId)) {
      throw new Error(
        "Invalid verification request"
      );
    }

    let session = null;

    const tenantId =
      options.tenantId || null;

    try {
      /**
       * Resolve user first so that:
       *
       * - already verified users are handled cleanly
       * - tenant context can be checked
       * - email state is known
       */
      const userBeforeVerification =
        await User.findById(userId)
          .select(
            "_id email name emailVerified emailVerifiedAt tenantId"
          )
          .lean();

      if (!userBeforeVerification) {
        throw new Error(
          "Unable to complete email verification"
        );
      }

      if (
        tenantId != null &&
        userBeforeVerification.tenantId != null &&
        String(
          userBeforeVerification.tenantId
        ) !== String(tenantId)
      ) {
        throw new Error(
          "Unable to complete email verification"
        );
      }

      /**
       * Idempotent behavior:
       *
       * If the user is already verified, do not attempt to reuse a token.
       */
      if (
        userBeforeVerification.emailVerified ===
        true
      ) {
        return {
          success: true,
          alreadyVerified: true,
          user: {
            id: userBeforeVerification._id,
            email:
              userBeforeVerification.email,
          },
          message:
            "Email is already verified",
        };
      }

      const tokenHash =
        HASH_TOKEN(token);

      /**
       * -----------------------------------------------------------------------
       * Start transaction
       * -----------------------------------------------------------------------
       */
      session =
        await mongoose.startSession();

      let verifiedUser = null;
      let consumedToken = null;

      await session.withTransaction(
        async () => {
          /**
           * Atomic token consumption.
           *
           * The EmailVerificationToken model should expose:
           *
           *   consumeAtomically()
           *
           * with the same semantic contract as PasswordResetToken.
           */
          if (
            typeof EmailVerificationToken
              .consumeAtomically ===
            "function"
          ) {
            consumedToken =
              await EmailVerificationToken.consumeAtomically(
                tokenHash,
                {
                  userId,
                  tenantId,
                  session,
                  ip:
                    options.requestIp ||
                    null,
                  userAgent:
                    options.userAgent ||
                    null,
                  requestId:
                    options.requestId ||
                    null,
                }
              );
          } else {
            /**
             * Compatibility fallback.
             *
             * This still performs a conditional atomic update, which is safer
             * than find() -> save().
             *
             * For full TITech enterprise consistency, add consumeAtomically()
             * to EmailVerificationToken.js.
             */
            const now = new Date();

            const filter = {
              user: userId,
              tokenHash,
              used: false,
              expiresAt: {
                $gt: now,
              },
              ...(tenantId != null
                ? { tenantId }
                : {}),
            };

            const update = {
              $set: {
                used: true,
                verifiedAt: now,
              },
            };

            if (
              options.requestId !=
              null
            ) {
              update.$set.verifiedRequestId =
                options.requestId;
            }

            if (
              options.requestIp !=
              null
            ) {
              update.$set.verificationIp =
                options.requestIp;
            }

            if (
              options.userAgent !=
              null
            ) {
              update.$set.verificationUserAgent =
                options.userAgent;
            }

            consumedToken =
              await EmailVerificationToken.findOneAndUpdate(
                filter,
                update,
                {
                  new: true,
                  session,
                  runValidators: true,
                }
              );
          }

          if (!consumedToken) {
            logger.warn(
              "[EmailVerificationService] Invalid, expired, revoked, or already-used verification token",
              {
                userId,
                tenantId,
              }
            );

            throw new Error(
              "Invalid or expired verification token"
            );
          }

          /**
           * Verify user email only after successful token consumption.
           */
          verifiedUser =
            await User.findOneAndUpdate(
              {
                _id: userId,
                emailVerified: {
                  $ne: true,
                },
              },
              {
                $set: {
                  emailVerified: true,
                  emailVerifiedAt:
                    new Date(),
                },
              },
              {
                new: true,
                session,
                runValidators: true,
              }
            ).select(
              "_id email name tenantId emailVerified emailVerifiedAt"
            );

          if (!verifiedUser) {
            /**
             * Transaction will roll back token consumption.
             */
            throw new Error(
              "Unable to complete email verification"
            );
          }

          /**
           * Revoke any other active verification tokens.
           *
           * This prevents older links from remaining valid after successful
           * verification.
           */
          await this.revokeActiveTokensForUser(
            userId,
            "email_successfully_verified",
            {
              tenantId,
              session,
              excludeTokenId:
                consumedToken._id,
            }
          );
        }
      );

      logger.info(
        "[EmailVerificationService] Email verification completed",
        {
          userId,
          tenantId,
          tokenId:
            consumedToken?._id,
          requestId:
            options.requestId || null,
        }
      );

      return {
        success: true,
        user: {
          id: verifiedUser._id,
          email: verifiedUser.email,
        },
        message:
          "Email verified successfully",
      };
    } catch (error) {
      logger.error(
        "[EmailVerificationService] Email verification failed",
        {
          userId,
          tenantId,
          error: error.message,
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
   * Resend Verification Email
   * ===========================================================================
   */
  async resendVerificationEmail(
    userId,
    options = {}
  ) {
    if (!userId) {
      throw new Error(
        "User ID is required"
      );
    }

    if (!isValidObjectId(userId)) {
      throw new Error(
        "Invalid user ID"
      );
    }

    try {
      const user =
        await User.findById(userId)
          .select(
            "_id email name emailVerified tenantId"
          );

      if (!user) {
        throw new Error(
          "Unable to process verification request"
        );
      }

      logger.info(
        "[EmailVerificationService] Verification resend requested",
        {
          userId,
          tenantId:
            options.tenantId ||
            user.tenantId ||
            null,
          requestId:
            options.requestId || null,
        }
      );

      return this.generateTokenAndSend(
        user,
        true,
        options
      );
    } catch (error) {
      logger.error(
        "[EmailVerificationService] Verification resend failed",
        {
          userId,
          error: error.message,
        }
      );

      throw error;
    }
  }

  /**
   * ===========================================================================
   * Check Email Verification Status
   * ===========================================================================
   */
  async isEmailVerified(
    userId
  ) {
    if (!isValidObjectId(userId)) {
      return false;
    }

    try {
      const user =
        await User.findById(
          userId
        ).select(
          "emailVerified"
        );

      return (
        user?.emailVerified === true
      );
    } catch (error) {
      logger.error(
        "[EmailVerificationService] Failed to check email verification status",
        {
          userId,
          error: error.message,
        }
      );

      throw error;
    }
  }

  /**
   * ===========================================================================
   * Verify Token Without Consuming It
   * ===========================================================================
   *
   * Useful for frontend UX before displaying the final verification screen.
   *
   * This endpoint MUST NOT be treated as proof that verification has completed.
   */
  async validateToken(
    userId,
    token,
    options = {}
  ) {
    if (
      !userId ||
      !token ||
      !isValidObjectId(userId)
    ) {
      return {
        valid: false,
        reason: "Invalid verification token",
      };
    }

    try {
      const tokenHash =
        HASH_TOKEN(token);

      let tokenRecord = null;

      if (
        typeof EmailVerificationToken
          .findActiveByHash ===
        "function"
      ) {
        tokenRecord =
          await EmailVerificationToken.findActiveByHash(
            tokenHash,
            {
              userId,
              tenantId:
                options.tenantId ||
                null,
            }
          );
      } else {
        tokenRecord =
          await EmailVerificationToken.findOne(
            {
              user: userId,
              tokenHash,
              used: false,
              expiresAt: {
                $gt: new Date(),
              },
              ...(options.tenantId
                ? {
                    tenantId:
                      options.tenantId,
                  }
                : {}),
            }
          );
      }

      if (!tokenRecord) {
        return {
          valid: false,
          reason:
            "Invalid or expired verification token",
        };
      }

      const remainingMs =
        tokenRecord.expiresAt.getTime() -
        Date.now();

      if (remainingMs <= 0) {
        return {
          valid: false,
          reason: "Token expired",
          expiresAt:
            tokenRecord.expiresAt,
        };
      }

      return {
        valid: true,
        expiresAt:
          tokenRecord.expiresAt,
        remainingMinutes:
          Math.ceil(
            remainingMs /
              (60 * 1000)
          ),
      };
    } catch (error) {
      logger.warn(
        "[EmailVerificationService] Verification-token validation failed",
        {
          userId,
          error: error.message,
        }
      );

      return {
        valid: false,
        reason:
          "Invalid or expired verification token",
      };
    }
  }

  /**
   * ===========================================================================
   * Revoke Active Tokens For User
   * ===========================================================================
   */
  async revokeActiveTokensForUser(
    userId,
    reason = "revoked",
    options = {}
  ) {
    const filter = {
      user: userId,
      used: false,
      ...(options.tenantId != null
        ? {
            tenantId:
              options.tenantId,
          }
        : {}),
    };

    if (options.excludeTokenId) {
      filter._id = {
        $ne: options.excludeTokenId,
      };
    }

    /**
     * Prefer model-level lifecycle implementation when available.
     */
    if (
      typeof EmailVerificationToken
        .revokeActiveForUser ===
      "function"
    ) {
      return EmailVerificationToken.revokeActiveForUser(
        userId,
        reason,
        {
          tenantId:
            options.tenantId ||
            null,
          session:
            options.session ||
            null,
          excludeTokenId:
            options.excludeTokenId ||
            null,
        }
      );
    }

    const update = {
      $set: {
        used: true,
        revocationReason: reason,
        revokedAt: new Date(),
      },
    };

    const query =
      EmailVerificationToken.updateMany(
        filter,
        update
      );

    if (options.session) {
      query.session(
        options.session
      );
    }

    return query;
  }

  /**
   * ===========================================================================
   * Revoke Individual Token
   * ===========================================================================
   */
  async revokeToken(
    tokenId,
    reason = "revoked"
  ) {
    if (!tokenId) {
      return null;
    }

    try {
      if (
        typeof EmailVerificationToken
          .findOneAndUpdate ===
        "function"
      ) {
        return EmailVerificationToken.findOneAndUpdate(
          {
            _id: tokenId,
            used: false,
          },
          {
            $set: {
              revoked: true,
              revokedAt:
                new Date(),
              revocationReason:
                reason,
            },
          },
          {
            new: true,
          }
        );
      }

      return null;
    } catch (error) {
      logger.error(
        "[EmailVerificationService] Failed to revoke verification token",
        {
          tokenId,
          error: error.message,
        }
      );

      throw error;
    }
  }

  /**
   * ===========================================================================
   * Cleanup Expired Tokens
   * ===========================================================================
   *
   * MongoDB TTL should perform automatic cleanup.
   * This method remains available for operational maintenance.
   */
  async cleanupExpiredTokens() {
    try {
      const result =
        await EmailVerificationToken.deleteMany(
          {
            expiresAt: {
              $lte: new Date(),
            },
          }
        );

      const deletedCount =
        result.deletedCount || 0;

      logger.info(
        "[EmailVerificationService] Expired verification-token cleanup completed",
        {
          deletedCount,
        }
      );

      return deletedCount;
    } catch (error) {
      logger.error(
        "[EmailVerificationService] Expired verification-token cleanup failed",
        {
          error: error.message,
        }
      );

      throw error;
    }
  }

  /**
   * ===========================================================================
   * Get Verification Status
   * ===========================================================================
   */
  async getVerificationStatus(
    userId,
    options = {}
  ) {
    if (!isValidObjectId(userId)) {
      throw new Error(
        "Invalid user ID"
      );
    }

    try {
      const user =
        await User.findById(userId)
          .select(
            "emailVerified emailVerifiedAt tenantId"
          )
          .lean();

      if (!user) {
        throw new Error(
          "User not found"
        );
      }

      const filter = {
        user: userId,
        used: false,
        expiresAt: {
          $gt: new Date(),
        },
      };

      if (options.tenantId != null) {
        filter.tenantId =
          options.tenantId;
      }

      const pendingToken =
        await EmailVerificationToken.findOne(
          filter,
          {
            expiresAt: 1,
          }
        ).sort({
          createdAt: -1,
        });

      return {
        verified:
          user.emailVerified === true,

        verifiedAt:
          user.emailVerifiedAt ||
          null,

        pendingToken:
          Boolean(pendingToken),

        expiresAt:
          pendingToken?.expiresAt ||
          null,
      };
    } catch (error) {
      logger.error(
        "[EmailVerificationService] Failed to get verification status",
        {
          userId,
          error: error.message,
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

module.exports =
  EmailVerificationService;

module.exports.hashVerificationToken =
  hashVerificationToken;

module.exports.HASH_TOKEN =
  HASH_TOKEN;

module.exports.generateVerificationToken =
  generateVerificationToken;