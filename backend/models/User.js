/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise User Model
 * ============================================================================
 *
 * File:
 *   backend/models/User.js
 *
 * Purpose:
 *   Enterprise identity, authentication, authorization, security, KYC/AML,
 *   MFA, mobile-money, referral and tenant-aware user persistence.
 *
 * Architecture:
 *
 *   Tenant
 *      │
 *      └── User
 *           ├── Authentication
 *           ├── Authorization
 *           ├── Security
 *           ├── KYC / AML
 *           ├── MFA
 *           ├── Mobile Money
 *           ├── Referral
 *           └── Audit Metadata
 *
 * SECURITY PRINCIPLES
 * ----------------------------------------------------------------------------
 * - Native ESM; compatible with package.json "type": "module".
 * - Passwords are never returned by default.
 * - Passwords are hashed using bcrypt.
 * - Password reset and verification tokens are stored only as SHA-256 hashes.
 * - MFA secrets and backup codes are protected with select:false.
 * - Tenant isolation is represented directly on the user.
 * - Referral counters are server-controlled.
 * - Sensitive authentication fields are excluded from JSON serialization.
 * - Authentication state transitions are explicit.
 * - Password changes update security/session metadata.
 * - Duplicate email/referral identifiers are prevented by indexes.
 * - No financial balance is stored directly on User.
 * - User.bonus is retained only for legacy compatibility and is NOT a ledger.
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * Financial balances MUST NOT be implemented on this model.
 *
 * Use:
 *   Savings / Account / Ledger / Transaction
 *
 * for authoritative financial state.
 *
 * Password reset architecture:
 * ----------------------------------------------------------------------------
 * TITech may use the dedicated PasswordResetToken model/service for modern
 * reset-token lifecycle management.
 *
 * The legacy User reset-token fields/methods are intentionally retained for
 * backward compatibility with existing consumers and migration paths.
 *
 * Email verification:
 * ----------------------------------------------------------------------------
 * `isVerified` is the canonical user field.
 *
 * `security.emailVerifiedAt` stores the verification timestamp.
 *
 * Do not introduce a second `isEmailVerified` field.
 *
 * Tenant identity:
 * ----------------------------------------------------------------------------
 * `tenantId` remains Schema.Types.ObjectId(ref: "Tenant").
 *
 * Services/controllers must preserve ObjectId semantics when querying MongoDB.
 *
 * ============================================================================
 */

import mongoose from "mongoose";
import bcrypt from "bcrypt";
import crypto from "node:crypto";
import validator from "validator";

const { Schema } = mongoose;

/**
 * ============================================================================
 * CONFIGURATION
 * ============================================================================
 */

const DEFAULT_BCRYPT_ROUNDS = 12;
const MIN_BCRYPT_ROUNDS = 10;
const MAX_BCRYPT_ROUNDS = 15;

const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 128;
const PASSWORD_HISTORY_LIMIT = 5;

const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;
const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const DEFAULT_LOGIN_THRESHOLD = 5;
const DEFAULT_LOCK_MINUTES = 15;

const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;

const MAX_IP_LENGTH = 128;
const MAX_USER_AGENT_LENGTH = 1024;

/**
 * Never allow an invalid environment value to weaken password hashing.
 */
const configuredBcryptRounds = Number.parseInt(
  process.env.BCRYPT_ROUNDS || String(DEFAULT_BCRYPT_ROUNDS),
  10
);

const SALT_ROUNDS = Math.min(
  MAX_BCRYPT_ROUNDS,
  Math.max(
    MIN_BCRYPT_ROUNDS,
    Number.isFinite(configuredBcryptRounds)
      ? configuredBcryptRounds
      : DEFAULT_BCRYPT_ROUNDS
  )
);

/**
 * ============================================================================
 * ENUMS
 * ============================================================================
 */

export const USER_ROLES = Object.freeze([
  "user",
  "admin",
  "group_admin",
]);

export const USER_STATUSES = Object.freeze([
  "pending",
  "active",
  "disabled",
  "suspended",
  "locked",
]);

export const KYC_LEVELS = Object.freeze([
  "none",
  "basic",
  "enhanced",
  "full",
]);

export const KYC_STATUSES = Object.freeze([
  "pending",
  "approved",
  "rejected",
  "expired",
]);

export const AML_RISK_RATINGS = Object.freeze([
  "low",
  "medium",
  "high",
  "critical",
]);

export const MOBILE_MONEY_PROVIDERS = Object.freeze([
  "mtn",
  "airtel",
  "other",
]);

/**
 * ============================================================================
 * NORMALIZATION / SECURITY HELPERS
 * ============================================================================
 */

function normalizeEmail(value) {
  if (typeof value !== "string") {
    return value;
  }

  return value.trim().toLowerCase();
}

function normalizeName(value) {
  if (typeof value !== "string") {
    return value;
  }

  return value
    .trim()
    .replace(/\s+/g, " ");
}

function normalizePhone(value) {
  if (typeof value !== "string") {
    return value;
  }

  return value.trim();
}

function normalizeReferralCode(value) {
  if (typeof value !== "string") {
    return value;
  }

  return value.trim().toUpperCase();
}

function hashToken(token) {
  return crypto
    .createHash("sha256")
    .update(String(token), "utf8")
    .digest("hex");
}

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value);
}

/**
 * bcrypt hashes currently supported by this model.
 *
 * $2a$...
 * $2b$...
 * $2y$...
 */
function isBcryptHash(value) {
  return (
    typeof value === "string" &&
    /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(value)
  );
}

/**
 * Strong application-level password validation.
 *
 * Existing authentication endpoints should continue to apply their own
 * request-level password policy. This schema validation prevents obviously
 * weak passwords from being persisted through direct model usage.
 *
 * Bcrypt hashes are explicitly accepted because save/query middleware may
 * encounter an already-hashed internal value.
 */
function isStrongPassword(value) {
  if (typeof value !== "string") {
    return false;
  }

  if (isBcryptHash(value)) {
    return true;
  }

  if (
    value.length < PASSWORD_MIN_LENGTH ||
    value.length > PASSWORD_MAX_LENGTH
  ) {
    return false;
  }

  return (
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /\d/.test(value) &&
    /[^A-Za-z0-9]/.test(value)
  );
}

/**
 * Constant-time comparison for SHA-256 token hashes.
 */
function safeTokenCompare(storedHash, suppliedTokenHash) {
  if (
    typeof storedHash !== "string" ||
    typeof suppliedTokenHash !== "string"
  ) {
    return false;
  }

  if (
    !/^[a-f0-9]{64}$/i.test(storedHash) ||
    !/^[a-f0-9]{64}$/i.test(suppliedTokenHash)
  ) {
    return false;
  }

  const stored = Buffer.from(storedHash, "hex");
  const supplied = Buffer.from(suppliedTokenHash, "hex");

  if (stored.length !== supplied.length) {
    return false;
  }

  return crypto.timingSafeEqual(stored, supplied);
}

function hasOwn(object, property) {
  return Object.prototype.hasOwnProperty.call(object, property);
}

function maskMobileMoneyAccount(value) {
  if (typeof value !== "string" || value.length === 0) {
    return value;
  }

  if (value.length <= 4) {
    return "****";
  }

  return `****${value.slice(-4)}`;
}

/**
 * Query updates must never be able to bypass password hashing through an
 * aggregation/update pipeline.
 */
function pipelineContainsPasswordUpdate(updatePipeline) {
  if (!Array.isArray(updatePipeline)) {
    return false;
  }

  for (const stage of updatePipeline) {
    if (!stage || typeof stage !== "object") {
      continue;
    }

    const setOperation = stage.$set || stage.$addFields;

    if (
      setOperation &&
      typeof setOperation === "object" &&
      hasOwn(setOperation, "password")
    ) {
      return true;
    }

    if (
      stage.$replaceWith &&
      typeof stage.$replaceWith === "object" &&
      hasOwn(stage.$replaceWith, "password")
    ) {
      return true;
    }

    if (
      stage.$replaceRoot &&
      typeof stage.$replaceRoot === "object"
    ) {
      const replacement = stage.$replaceRoot.newRoot;

      if (
        replacement &&
        typeof replacement === "object" &&
        hasOwn(replacement, "password")
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Normalize query-update password location.
 */
function extractPasswordFromUpdate(update) {
  if (!update || typeof update !== "object" || Array.isArray(update)) {
    return undefined;
  }

  if (
    hasOwn(update, "password") &&
    typeof update.password === "string"
  ) {
    return update.password;
  }

  if (
    update.$set &&
    typeof update.$set === "object" &&
    typeof update.$set.password === "string"
  ) {
    return update.$set.password;
  }

  return undefined;
}

/**
 * ============================================================================
 * PROFILE SCHEMA
 * ============================================================================
 */

const profileSchema = new Schema(
  {
    address: {
      type: String,
      trim: true,
      maxlength: 200,
    },

    city: {
      type: String,
      trim: true,
      maxlength: 100,
    },

    country: {
      type: String,
      trim: true,
      maxlength: 100,
    },

    occupation: {
      type: String,
      trim: true,
      maxlength: 100,
    },

    avatar: {
      type: String,
      trim: true,
      maxlength: 2048,
      validate: {
        validator(value) {
          return (
            !value ||
            validator.isURL(value, {
              require_protocol: true,
              protocols: ["http", "https"],
            })
          );
        },
        message: "Avatar must be a valid HTTP/HTTPS URL",
      },
    },
  },
  {
    _id: false,
  }
);

/**
 * ============================================================================
 * KYC SCHEMA
 * ============================================================================
 */

const kycSchema = new Schema(
  {
    level: {
      type: String,
      enum: KYC_LEVELS,
      default: "none",
    },

    status: {
      type: String,
      enum: KYC_STATUSES,
      default: "pending",
    },

    verifiedAt: {
      type: Date,
      default: null,
    },

    verifiedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    verificationReference: {
      type: String,
      trim: true,
      maxlength: 200,
      default: null,
    },

    rejectionReason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },

    expiresAt: {
      type: Date,
      default: null,
    },
  },
  {
    _id: false,
  }
);

/**
 * ============================================================================
 * AML SCHEMA
 * ============================================================================
 */

const amlSchema = new Schema(
  {
    riskRating: {
      type: String,
      enum: AML_RISK_RATINGS,
      default: "low",
    },

    score: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    lastScreenedAt: {
      type: Date,
      default: null,
    },

    screeningReference: {
      type: String,
      trim: true,
      maxlength: 200,
      default: null,
    },

    reviewRequired: {
      type: Boolean,
      default: false,
    },

    reviewedAt: {
      type: Date,
      default: null,
    },

    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    _id: false,
  }
);

/**
 * ============================================================================
 * MFA SCHEMA
 * ============================================================================
 *
 * Sensitive values intentionally use select:false.
 *
 * Encryption-at-rest for MFA secrets should additionally be handled by the
 * security/application infrastructure where supported.
 */

const mfaSchema = new Schema(
  {
    enabled: {
      type: Boolean,
      default: false,
    },

    method: {
      type: String,
      enum: ["totp"],
      default: "totp",
    },

    secret: {
      type: String,
      select: false,
      default: null,
    },

    backupCodes: [
      {
        type: String,
        select: false,
      },
    ],

    enrolledAt: {
      type: Date,
      default: null,
    },

    lastVerifiedAt: {
      type: Date,
      default: null,
    },
  },
  {
    _id: false,
  }
);

/**
 * ============================================================================
 * MOBILE MONEY SCHEMA
 * ============================================================================
 */

const mobileMoneySchema = new Schema(
  {
    provider: {
      type: String,
      enum: MOBILE_MONEY_PROVIDERS,
      default: null,
    },

    accountNumber: {
      type: String,
      trim: true,
      maxlength: 32,
      default: null,
    },

    verified: {
      type: Boolean,
      default: false,
    },

    verifiedAt: {
      type: Date,
      default: null,
    },
  },
  {
    _id: false,
  }
);

/**
 * ============================================================================
 * SECURITY SCHEMA
 * ============================================================================
 */

const securitySchema = new Schema(
  {
    lastPasswordChange: {
      type: Date,
      default: null,
    },

    lastLoginIp: {
      type: String,
      trim: true,
      maxlength: MAX_IP_LENGTH,
      default: null,
    },

    lastLoginUserAgent: {
      type: String,
      trim: true,
      maxlength: MAX_USER_AGENT_LENGTH,
      default: null,
    },

    lastLoginAt: {
      type: Date,
      default: null,
    },

    lastFailedLoginAt: {
      type: Date,
      default: null,
    },

    passwordResetAt: {
      type: Date,
      default: null,
    },

    emailVerifiedAt: {
      type: Date,
      default: null,
    },

    securityVersion: {
      type: Number,
      default: 1,
      min: 1,
    },
  },
  {
    _id: false,
  }
);

/**
 * ============================================================================
 * PASSWORD HISTORY SCHEMA
 * ============================================================================
 */

const passwordHistorySchema = new Schema(
  {
    hash: {
      type: String,
      required: true,
      select: false,
    },

    changedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    _id: false,
  }
);

/**
 * ============================================================================
 * SESSION METRICS SCHEMA
 * ============================================================================
 */

const sessionMetricsSchema = new Schema(
  {
    activeSessions: {
      type: Number,
      default: 0,
      min: 0,
    },

    lastRefreshAt: {
      type: Date,
      default: null,
    },

    lastSessionRevokedAt: {
      type: Date,
      default: null,
    },

    sessionVersion: {
      type: Number,
      default: 1,
      min: 1,
    },
  },
  {
    _id: false,
  }
);

/**
 * ============================================================================
 * REFERRAL SCHEMA
 * ============================================================================
 */

const referralsSchema = new Schema(
  {
    totalReferrals: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalBonusEarned: {
      type: Number,
      default: 0,
      min: 0,
    },

    successfulReferrals: {
      type: Number,
      default: 0,
      min: 0,
    },

    pendingReferrals: {
      type: Number,
      default: 0,
      min: 0,
    },

    lastReferralAt: {
      type: Date,
      default: null,
    },
  },
  {
    _id: false,
  }
);

/**
 * ============================================================================
 * USER SCHEMA
 * ============================================================================
 */

const userSchema = new Schema(
  {
    /**
     * ========================================================================
     * BASIC INFORMATION
     * ========================================================================
     */

    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      minlength: 2,
      maxlength: MAX_NAME_LENGTH,
      set: normalizeName,
    },

    email: {
      type: String,
      required: [true, "Email is required"],
      trim: true,
      lowercase: true,
      maxlength: MAX_EMAIL_LENGTH,
      set: normalizeEmail,
      validate: {
        validator(value) {
          return validator.isEmail(value);
        },
        message: "Please provide a valid email address",
      },
    },

    password: {
      type: String,
      required: [true, "Password is required"],
      select: false,
      validate: {
        validator(value) {
          return (
            typeof value === "string" &&
            isStrongPassword(value)
          );
        },
        message:
          "Password must be 12-128 characters and contain uppercase, lowercase, number and special character",
      },
    },

    phone: {
      type: String,
      trim: true,
      sparse: true,
      set: normalizePhone,
      validate: {
        validator(value) {
          return (
            !value ||
            /^\+[1-9]\d{1,14}$/.test(value)
          );
        },
        message: "Phone must be in valid E.164 format",
      },
    },

    /**
     * ========================================================================
     * AUTHORIZATION
     * ========================================================================
     */

    role: {
      type: String,
      enum: USER_ROLES,
      default: "user",
      index: true,
    },

    status: {
      type: String,
      enum: USER_STATUSES,
      default: "active",
      index: true,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    /**
     * Canonical email verification state.
     *
     * Do not add a second `isEmailVerified` field.
     */
    isVerified: {
      type: Boolean,
      default: false,
      index: true,
    },

    /**
     * ========================================================================
     * TENANT
     * ========================================================================
     */

    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Tenant",
      required: false,
      index: true,
      default: null,
    },

    /**
     * ========================================================================
     * PROFILE
     * ========================================================================
     */

    profile: {
      type: profileSchema,
      default: () => ({}),
    },

    /**
     * ========================================================================
     * KYC / AML
     * ========================================================================
     */

    kyc: {
      type: kycSchema,
      default: () => ({}),
    },

    aml: {
      type: amlSchema,
      default: () => ({}),
    },

    /**
     * ========================================================================
     * MFA
     * ========================================================================
     */

    mfa: {
      type: mfaSchema,
      default: () => ({}),
    },

    /**
     * ========================================================================
     * MOBILE MONEY
     * ========================================================================
     */

    mobileMoney: {
      type: mobileMoneySchema,
      default: () => ({}),
    },

    /**
     * ========================================================================
     * EMAIL VERIFICATION TOKENS
     * ========================================================================
     *
     * Legacy-compatible User-level token mechanism.
     *
     * Modern verification flows may use a dedicated token service/model.
     */

    verificationToken: {
      type: String,
      default: null,
      select: false,
      index: true,
    },

    verificationTokenExpires: {
      type: Date,
      default: null,
      select: false,
      index: true,
    },

    /**
     * ========================================================================
     * PASSWORD RESET TOKENS
     * ========================================================================
     *
     * Legacy-compatible User-level reset mechanism.
     *
     * The dedicated PasswordResetToken model remains preferred for modern
     * lifecycle management where already integrated.
     */

    resetPasswordToken: {
      type: String,
      default: null,
      select: false,
      index: true,
    },

    resetPasswordExpires: {
      type: Date,
      default: null,
      select: false,
      index: true,
    },

    /**
     * ========================================================================
     * SECURITY
     * ========================================================================
     */

    failedLoginAttempts: {
      type: Number,
      default: 0,
      min: 0,
    },

    lockUntil: {
      type: Date,
      default: null,
      index: true,
    },

    lastLogin: {
      type: Date,
      default: null,
      index: true,
    },

    security: {
      type: securitySchema,
      default: () => ({}),
    },

    passwordHistory: {
      type: [passwordHistorySchema],
      default: [],
    },

    sessionMetrics: {
      type: sessionMetricsSchema,
      default: () => ({}),
    },

    /**
     * ========================================================================
     * REFERRALS
     * ========================================================================
     *
     * User owns referral identity/statistics only.
     *
     * Referral financial rewards MUST be issued through:
     *
     *   Referral
     *      ↓
     *   ReferralReward
     *      ↓
     *   ReferralRewardService
     *      ↓
     *   Transaction / Ledger
     *
     * Do not use `bonus` as an authoritative financial balance.
     */

    referralCode: {
      type: String,
      sparse: true,
      trim: true,
      uppercase: true,
      maxlength: 64,
      index: true,
      set: normalizeReferralCode,
    },

    bonus: {
      type: Number,
      default: 0,
      min: 0,

      /**
       * Legacy compatibility field.
       *
       * Financial applications must NOT use this as the authoritative
       * reward balance.
       */
      immutable: false,
    },

    referrals: {
      type: referralsSchema,
      default: () => ({}),
    },

    /**
     * ========================================================================
     * AUDIT
     * ========================================================================
     */

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    /**
     * ========================================================================
     * SOFT DELETE
     * ========================================================================
     */

    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },

    /**
     * ========================================================================
     * MODEL VERSION
     * ========================================================================
     */

    schemaVersion: {
      type: Number,
      default: 2,
      min: 1,
    },
  },
  {
    timestamps: true,
    versionKey: "__v",
    optimisticConcurrency: true,
    strict: true,

    toJSON: {
      virtuals: true,

      transform(doc, ret) {
        ret.id = ret._id
          ? ret._id.toString()
          : undefined;

        delete ret._id;
        delete ret.__v;

        /**
         * Authentication/security secrets.
         */
        delete ret.password;
        delete ret.resetPasswordToken;
        delete ret.resetPasswordExpires;
        delete ret.verificationToken;
        delete ret.verificationTokenExpires;
        delete ret.failedLoginAttempts;
        delete ret.lockUntil;
        delete ret.passwordHistory;

        /**
         * Security telemetry should not be exposed by generic user JSON.
         *
         * Administrative/security endpoints should explicitly project it.
         */
        delete ret.security;
        delete ret.sessionMetrics;

        /**
         * MFA secrets.
         */
        if (ret.mfa) {
          delete ret.mfa.secret;
          delete ret.mfa.backupCodes;
        }

        /**
         * Mobile-money account numbers are masked in public JSON.
         */
        if (
          ret.mobileMoney &&
          typeof ret.mobileMoney.accountNumber === "string"
        ) {
          ret.mobileMoney.accountNumber =
            maskMobileMoneyAccount(
              ret.mobileMoney.accountNumber
            );
        }

        return ret;
      },
    },

    toObject: {
      virtuals: true,

      transform(doc, ret) {
        ret.id = ret._id
          ? ret._id.toString()
          : undefined;

        delete ret._id;
        delete ret.__v;

        delete ret.password;
        delete ret.resetPasswordToken;
        delete ret.resetPasswordExpires;
        delete ret.verificationToken;
        delete ret.verificationTokenExpires;
        delete ret.failedLoginAttempts;
        delete ret.lockUntil;
        delete ret.passwordHistory;

        delete ret.security;
        delete ret.sessionMetrics;

        if (ret.mfa) {
          delete ret.mfa.secret;
          delete ret.mfa.backupCodes;
        }

        if (
          ret.mobileMoney &&
          typeof ret.mobileMoney.accountNumber === "string"
        ) {
          ret.mobileMoney.accountNumber =
            maskMobileMoneyAccount(
              ret.mobileMoney.accountNumber
            );
        }

        return ret;
      },
    },
  }
);

/**
 * ============================================================================
 * VIRTUALS
 * ============================================================================
 */

userSchema.virtual("isLocked").get(function isLocked() {
  return Boolean(
    this.lockUntil &&
      this.lockUntil instanceof Date &&
      this.lockUntil.getTime() > Date.now()
  );
});

userSchema.virtual("isSoftDeleted").get(function isSoftDeleted() {
  return Boolean(this.deletedAt);
});

userSchema.virtual("requiresKyc").get(function requiresKyc() {
  return Boolean(
    this.kyc &&
      this.kyc.level !== "none" &&
      this.kyc.status !== "approved"
  );
});

userSchema.virtual("isAuthenticationAllowed").get(
  function isAuthenticationAllowed() {
    return Boolean(
      this.isActive === true &&
        this.status === "active" &&
        this.deletedAt === null &&
        !this.isCurrentlyLocked()
    );
  }
);

/**
 * ============================================================================
 * PASSWORD HASHING
 * ============================================================================
 *
 * Handles direct document password changes:
 *
 *   user.password = newPassword;
 *   await user.save();
 *
 * Password-history-sensitive operations should use the document workflow.
 */

userSchema.pre(
  "save",
  async function passwordHashMiddleware(next) {
    if (!this.isModified("password")) {
      return next();
    }

    try {
      if (
        typeof this.password !== "string" ||
        this.password.length === 0
      ) {
        return next(
          new Error("Password cannot be empty.")
        );
      }

      const previousPasswordHash = this.isNew
        ? null
        : this.get("password", null);

      const alreadyHashed = isBcryptHash(this.password);

      /**
       * Password history records the previous hash.
       *
       * `password` is select:false, therefore callers that require robust
       * password-history tracking on existing documents should load:
       *
       *   .select("+password +passwordHistory")
       */
      if (
        previousPasswordHash &&
        previousPasswordHash !== this.password
      ) {
        this.passwordHistory =
          this.passwordHistory || [];

        this.passwordHistory.push({
          hash: previousPasswordHash,
          changedAt: new Date(),
        });

        if (
          this.passwordHistory.length >
          PASSWORD_HISTORY_LIMIT
        ) {
          this.passwordHistory =
            this.passwordHistory.slice(
              -PASSWORD_HISTORY_LIMIT
            );
        }
      }

      if (!alreadyHashed) {
        this.password =
          await bcrypt.hash(
            this.password,
            SALT_ROUNDS
          );
      }

      if (!this.security) {
        this.security = {};
      }

      this.security.lastPasswordChange =
        new Date();

      this.security.securityVersion =
        Number(
          this.security.securityVersion || 1
        ) + 1;

      /**
       * Password changes invalidate active sessions.
       */
      if (!this.sessionMetrics) {
        this.sessionMetrics = {};
      }

      this.sessionMetrics.sessionVersion =
        Number(
          this.sessionMetrics.sessionVersion || 1
        ) + 1;

      return next();
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * ============================================================================
 * QUERY PASSWORD HASHING
 * ============================================================================
 *
 * Supports:
 *
 *   User.findOneAndUpdate(...)
 *   User.updateOne(...)
 *
 * without allowing plaintext passwords to reach MongoDB.
 *
 * IMPORTANT:
 * ---------------------------------------------------------------------------
 * Password history is not modified here because query middleware cannot safely
 * reconstruct the complete previous document without an additional read.
 *
 * Password-history-sensitive changes should use the document workflow.
 */

async function passwordQueryUpdateMiddleware(next) {
  try {
    const update = this.getUpdate();

    if (!update) {
      return next();
    }

    /**
     * Password updates through aggregation/update pipelines are intentionally
     * rejected because they cannot be safely transformed here without risking
     * plaintext persistence.
     */
    if (Array.isArray(update)) {
      if (pipelineContainsPasswordUpdate(update)) {
        return next(
          new Error(
            "Pipeline password updates are not permitted. Use document password assignment or a supported update method."
          )
        );
      }

      return next();
    }

    const password = extractPasswordFromUpdate(update);

    if (
      typeof password !== "string" ||
      password.length === 0
    ) {
      return next();
    }

    if (!isBcryptHash(password)) {
      const hashed = await bcrypt.hash(
        password,
        SALT_ROUNDS
      );

      if (hasOwn(update, "password")) {
        update.password = hashed;
      }

      if (
        update.$set &&
        typeof update.$set === "object" &&
        hasOwn(update.$set, "password")
      ) {
        update.$set.password = hashed;
      }
    }

    const now = new Date();

    update.$set =
      update.$set &&
      typeof update.$set === "object" &&
      !Array.isArray(update.$set)
        ? update.$set
        : {};

    update.$set["security.lastPasswordChange"] = now;

    update.$inc =
      update.$inc &&
      typeof update.$inc === "object" &&
      !Array.isArray(update.$inc)
        ? update.$inc
        : {};

    update.$inc["security.securityVersion"] =
      Number(
        update.$inc["security.securityVersion"] || 0
      ) + 1;

    update.$inc["sessionMetrics.sessionVersion"] =
      Number(
        update.$inc["sessionMetrics.sessionVersion"] || 0
      ) + 1;

    this.setUpdate(update);

    return next();
  } catch (error) {
    return next(error);
  }
}

userSchema.pre(
  "findOneAndUpdate",
  passwordQueryUpdateMiddleware
);

userSchema.pre(
  "updateOne",
  passwordQueryUpdateMiddleware
);

/**
 * ============================================================================
 * FIELD NORMALIZATION
 * ============================================================================
 */

userSchema.pre(
  "validate",
  function normalizeUserFields(next) {
    if (this.email) {
      this.email = normalizeEmail(this.email);
    }

    if (this.name) {
      this.name = normalizeName(this.name);
    }

    if (this.phone) {
      this.phone = normalizePhone(this.phone);
    }

    if (this.referralCode) {
      this.referralCode =
        normalizeReferralCode(
          this.referralCode
        );
    }

    return next();
  }
);

/**
 * ============================================================================
 * PASSWORD METHODS
 * ============================================================================
 */

/**
 * Compare a supplied password against the stored bcrypt hash.
 *
 * Because password is select:false, callers must explicitly load it:
 *
 *   User.findOne(...).select("+password")
 */
userSchema.methods.matchPassword =
  async function matchPassword(enteredPassword) {
    if (
      typeof enteredPassword !== "string" ||
      !enteredPassword ||
      !this.password
    ) {
      return false;
    }

    try {
      return await bcrypt.compare(
        enteredPassword,
        this.password
      );
    } catch {
      return false;
    }
  };

/**
 * Check whether a supplied plaintext password appears in recent password
 * history.
 */
userSchema.methods.isPasswordPreviouslyUsed =
  async function isPasswordPreviouslyUsed(
    plainPassword
  ) {
    if (
      typeof plainPassword !== "string" ||
      !plainPassword
    ) {
      return false;
    }

    const history = this.passwordHistory || [];

    for (const record of history) {
      if (
        record &&
        record.hash &&
        await bcrypt.compare(
          plainPassword,
          record.hash
        )
      ) {
        return true;
      }
    }

    return false;
  };

/**
 * ============================================================================
 * RESET TOKEN
 * ============================================================================
 */

userSchema.methods.generateResetToken =
  function generateResetToken() {
    const rawToken =
      crypto.randomBytes(32).toString("hex");

    this.resetPasswordToken =
      hashToken(rawToken);

    this.resetPasswordExpires =
      new Date(
        Date.now() +
          RESET_TOKEN_TTL_MS
      );

    return rawToken;
  };

/**
 * ============================================================================
 * EMAIL VERIFICATION TOKEN
 * ============================================================================
 */

userSchema.methods.generateVerificationToken =
  function generateVerificationToken() {
    const rawToken =
      crypto.randomBytes(32).toString("hex");

    this.verificationToken =
      hashToken(rawToken);

    this.verificationTokenExpires =
      new Date(
        Date.now() +
          VERIFICATION_TOKEN_TTL_MS
      );

    return rawToken;
  };

/**
 * ============================================================================
 * TOKEN VALIDATION
 * ============================================================================
 */

userSchema.methods.isResetTokenValid =
  function isResetTokenValid(token) {
    if (
      !token ||
      !this.resetPasswordToken ||
      !this.resetPasswordExpires
    ) {
      return false;
    }

    if (
      !(this.resetPasswordExpires instanceof Date) ||
      this.resetPasswordExpires.getTime() <=
        Date.now()
    ) {
      return false;
    }

    return safeTokenCompare(
      this.resetPasswordToken,
      hashToken(token)
    );
  };

userSchema.methods.isVerificationTokenValid =
  function isVerificationTokenValid(token) {
    if (
      !token ||
      !this.verificationToken ||
      !this.verificationTokenExpires
    ) {
      return false;
    }

    if (
      !(this.verificationTokenExpires instanceof Date) ||
      this.verificationTokenExpires.getTime() <=
        Date.now()
    ) {
      return false;
    }

    return safeTokenCompare(
      this.verificationToken,
      hashToken(token)
    );
  };

/**
 * ============================================================================
 * TOKEN CONSUMPTION
 * ============================================================================
 */

userSchema.methods.clearResetToken =
  function clearResetToken() {
    this.resetPasswordToken = null;
    this.resetPasswordExpires = null;

    if (!this.security) {
      this.security = {};
    }

    this.security.passwordResetAt =
      new Date();
  };

userSchema.methods.clearVerificationToken =
  function clearVerificationToken() {
    this.verificationToken = null;
    this.verificationTokenExpires = null;

    if (!this.security) {
      this.security = {};
    }

    this.security.emailVerifiedAt =
      new Date();
  };

/**
 * ============================================================================
 * ACCOUNT LOCKING
 * ============================================================================
 */

userSchema.methods.isCurrentlyLocked =
  function isCurrentlyLocked() {
    return Boolean(
      this.lockUntil &&
        this.lockUntil instanceof Date &&
        this.lockUntil.getTime() > Date.now()
    );
  };

userSchema.methods.bumpFailedLogin =
  async function bumpFailedLogin(
    threshold = DEFAULT_LOGIN_THRESHOLD,
    lockMinutes = DEFAULT_LOCK_MINUTES
  ) {
    const normalizedThreshold =
      Math.max(
        1,
        Number.parseInt(
          threshold,
          10
        ) || DEFAULT_LOGIN_THRESHOLD
      );

    const normalizedLockMinutes =
      Math.max(
        1,
        Number.parseInt(
          lockMinutes,
          10
        ) || DEFAULT_LOCK_MINUTES
      );

    if (this.isCurrentlyLocked()) {
      return this;
    }

    this.failedLoginAttempts =
      Number(
        this.failedLoginAttempts || 0
      ) + 1;

    if (!this.security) {
      this.security = {};
    }

    this.security.lastFailedLoginAt =
      new Date();

    if (
      this.failedLoginAttempts >=
      normalizedThreshold
    ) {
      this.lockUntil =
        new Date(
          Date.now() +
            normalizedLockMinutes *
              60 *
              1000
        );

      this.status = "locked";

      /**
       * Locking invalidates existing authentication sessions.
       */
      this.security.securityVersion =
        Number(
          this.security.securityVersion || 1
        ) + 1;

      if (!this.sessionMetrics) {
        this.sessionMetrics = {};
      }

      this.sessionMetrics.sessionVersion =
        Number(
          this.sessionMetrics.sessionVersion || 1
        ) + 1;
    }

    await this.save({
      validateBeforeSave: false,
    });

    return this;
  };

userSchema.methods.resetFailedLogin =
  async function resetFailedLogin() {
    this.failedLoginAttempts = 0;
    this.lockUntil = null;

    if (this.status === "locked") {
      this.status = "active";
      this.isActive = true;
    }

    if (!this.security) {
      this.security = {};
    }

    this.security.lastFailedLoginAt =
      null;

    await this.save({
      validateBeforeSave: false,
    });

    return this;
  };

/**
 * ============================================================================
 * LOGIN SUCCESS
 * ============================================================================
 */

userSchema.methods.recordSuccessfulLogin =
  async function recordSuccessfulLogin(
    metadata = {}
  ) {
    const now = new Date();

    this.lastLogin = now;

    if (!this.security) {
      this.security = {};
    }

    this.security.lastLoginAt = now;

    if (metadata.ip) {
      this.security.lastLoginIp =
        String(metadata.ip).slice(
          0,
          MAX_IP_LENGTH
        );
    }

    if (metadata.userAgent) {
      this.security.lastLoginUserAgent =
        String(
          metadata.userAgent
        ).slice(
          0,
          MAX_USER_AGENT_LENGTH
        );
    }

    this.failedLoginAttempts = 0;
    this.lockUntil = null;

    if (this.status === "locked") {
      this.status = "active";
      this.isActive = true;
    }

    await this.save({
      validateBeforeSave: false,
    });

    return this;
  };

/**
 * ============================================================================
 * SESSION INVALIDATION
 * ============================================================================
 */

userSchema.methods.invalidateSessions =
  async function invalidateSessions() {
    if (!this.sessionMetrics) {
      this.sessionMetrics = {};
    }

    this.sessionMetrics.sessionVersion =
      Number(
        this.sessionMetrics.sessionVersion || 1
      ) + 1;

    this.sessionMetrics.activeSessions = 0;

    this.sessionMetrics.lastSessionRevokedAt =
      new Date();

    await this.save({
      validateBeforeSave: false,
    });

    return this;
  };

/**
 * ============================================================================
 * EMAIL VERIFICATION
 * ============================================================================
 */

userSchema.methods.markEmailVerified =
  async function markEmailVerified() {
    this.isVerified = true;

    this.verificationToken = null;
    this.verificationTokenExpires = null;

    if (!this.security) {
      this.security = {};
    }

    this.security.emailVerifiedAt =
      new Date();

    await this.save({
      validateBeforeSave: false,
    });

    return this;
  };

/**
 * ============================================================================
 * ACCOUNT STATUS HELPERS
 * ============================================================================
 */

userSchema.methods.disableAccount =
  async function disableAccount() {
    this.status = "disabled";
    this.isActive = false;

    await this.invalidateSessions();

    return this;
  };

userSchema.methods.enableAccount =
  async function enableAccount() {
    this.status = "active";
    this.isActive = true;

    this.lockUntil = null;
    this.failedLoginAttempts = 0;

    return this.save({
      validateBeforeSave: false,
    });
  };

userSchema.methods.suspendAccount =
  async function suspendAccount() {
    this.status = "suspended";
    this.isActive = false;

    await this.invalidateSessions();

    return this;
  };

/**
 * ============================================================================
 * SOFT DELETE
 * ============================================================================
 */

userSchema.methods.softDelete =
  async function softDelete() {
    this.deletedAt = new Date();
    this.status = "disabled";
    this.isActive = false;

    await this.invalidateSessions();

    return this;
  };

/**
 * ============================================================================
 * TENANT CHECK
 * ============================================================================
 */

userSchema.methods.belongsToTenant =
  function belongsToTenant(tenantId) {
    if (
      !this.tenantId ||
      !tenantId ||
      !isValidObjectId(tenantId)
    ) {
      return false;
    }

    return (
      String(this.tenantId) ===
      String(tenantId)
    );
  };

/**
 * ============================================================================
 * REFERRAL HELPERS
 * ============================================================================
 *
 * These methods update referral statistics only.
 *
 * They do NOT issue financial rewards.
 */

userSchema.methods.recordReferral =
  async function recordReferral() {
    if (!this.referrals) {
      this.referrals = {};
    }

    this.referrals.totalReferrals =
      Number(
        this.referrals.totalReferrals || 0
      ) + 1;

    this.referrals.pendingReferrals =
      Number(
        this.referrals.pendingReferrals || 0
      ) + 1;

    this.referrals.lastReferralAt =
      new Date();

    await this.save({
      validateBeforeSave: false,
    });

    return this;
  };

userSchema.methods.recordSuccessfulReferral =
  async function recordSuccessfulReferral() {
    if (!this.referrals) {
      this.referrals = {};
    }

    this.referrals.successfulReferrals =
      Number(
        this.referrals.successfulReferrals || 0
      ) + 1;

    this.referrals.pendingReferrals =
      Math.max(
        0,
        Number(
          this.referrals.pendingReferrals || 0
        ) - 1
      );

    await this.save({
      validateBeforeSave: false,
    });

    return this;
  };

/**
 * ============================================================================
 * STATIC HELPERS
 * ============================================================================
 */

/**
 * Find by normalized email while excluding soft-deleted accounts by default.
 *
 * options:
 *   includeDeleted: true
 *   includePassword: true
 *   includeMfaSecrets: true
 *   includePasswordHistory: true
 */
userSchema.statics.findByEmail =
  function findByEmail(
    email,
    options = {}
  ) {
    const normalizedEmail =
      normalizeEmail(email);

    const query = {
      email: normalizedEmail,
    };

    if (options.includeDeleted !== true) {
      query.deletedAt = null;
    }

    let operation = this.findOne(query);

    if (options.includePassword === true) {
      operation = operation.select(
        "+password"
      );
    }

    if (options.includeMfaSecrets === true) {
      operation = operation.select(
        "+mfa.secret +mfa.backupCodes"
      );
    }

    if (
      options.includePasswordHistory === true
    ) {
      operation = operation.select(
        "+passwordHistory"
      );
    }

    return operation;
  };

/**
 * Find active referral owner.
 */
userSchema.statics.findByReferralCode =
  function findByReferralCode(
    referralCode
  ) {
    return this.findOne({
      referralCode:
        normalizeReferralCode(
          referralCode
        ),
      deletedAt: null,
      isActive: true,
      status: "active",
    });
  };

/**
 * Tenant-scoped user lookup.
 *
 * tenantId remains an ObjectId value and is deliberately not stringified
 * before being passed to MongoDB.
 */
userSchema.statics.findTenantUser =
  function findTenantUser(
    tenantId,
    userId
  ) {
    if (
      !isValidObjectId(tenantId) ||
      !isValidObjectId(userId)
    ) {
      return this.findOne({
        _id: null,
      });
    }

    return this.findOne({
      _id: userId,
      tenantId,
      deletedAt: null,
    });
  };

/**
 * Find active users.
 */
userSchema.statics.findActiveUsers =
  function findActiveUsers(
    tenantId = null
  ) {
    const query = {
      isActive: true,
      status: "active",
      deletedAt: null,
    };

    if (tenantId) {
      if (!isValidObjectId(tenantId)) {
        return this.findOne({
          _id: null,
        });
      }

      query.tenantId = tenantId;
    }

    return this.find(query);
  };

/**
 * ============================================================================
 * SAFE AUTHENTICATION PROJECTION
 * ============================================================================
 *
 * IMPORTANT:
 * ---------------------------------------------------------------------------
 * The old implementation performed `findOne()` with no filter, which could
 * accidentally return an arbitrary user.
 *
 * The new implementation requires a caller-supplied authentication criteria.
 *
 * Examples:
 *
 *   User.authenticationProjection({
 *     email,
 *     tenantId
 *   });
 *
 *   User.authenticationProjection({
 *     _id: userId,
 *     tenantId
 *   });
 *
 * The no-filter behavior deliberately resolves to no document rather than
 * silently returning the first User in the database.
 */
userSchema.statics.authenticationProjection =
  function authenticationProjection(
    filter = {},
    options = {}
  ) {
    const safeFilter =
      filter &&
      typeof filter === "object" &&
      !Array.isArray(filter) &&
      Object.keys(filter).length > 0
        ? { ...filter }
        : { _id: null };

    let operation =
      this.findOne(safeFilter)
        .select(
          "+password +mfa.secret +mfa.backupCodes"
        );

    if (options.includePasswordHistory === true) {
      operation = operation.select(
        "+passwordHistory"
      );
    }

    if (options.includeDeleted !== true) {
      operation = operation.where({
        deletedAt: null,
      });
    }

    return operation;
  };

/**
 * Explicit convenience helper for login/authentication flows.
 *
 * This keeps authentication reads expressive and tenant-safe without allowing
 * an accidental unscoped query.
 */
userSchema.statics.findForAuthentication =
  function findForAuthentication({
    email,
    tenantId = null,
    userId = null,
  } = {}) {
    const filter = {};

    if (userId && isValidObjectId(userId)) {
      filter._id = userId;
    }

    if (email) {
      filter.email =
        normalizeEmail(email);
    }

    if (tenantId) {
      if (!isValidObjectId(tenantId)) {
        return this.findOne({
          _id: null,
        });
      }

      filter.tenantId = tenantId;
    }

    if (
      !filter._id &&
      !filter.email
    ) {
      return this.findOne({
        _id: null,
      });
    }

    return this.authenticationProjection(
      filter,
      {
        includePasswordHistory: true,
      }
    );
  };

/**
 * ============================================================================
 * INDEXES
 * ============================================================================
 *
 * Email uniqueness:
 * ---------------------------------------------------------------------------
 * The authoritative email index is GLOBAL:
 *
 *   email -> unique
 *
 * This is intentional and preserves the existing identity model.
 *
 * If TITech later decides that one email may exist independently in multiple
 * tenants, the migration MUST:
 *
 *   1. remove the global unique index;
 *   2. create `{ tenantId: 1, email: 1 }` unique;
 *   3. update authentication semantics;
 *   4. update all identity/recovery workflows.
 */

/**
 * Global email identity.
 */
userSchema.index(
  {
    email: 1,
  },
  {
    unique: true,
    name: "uq_user_email",
  }
);

/**
 * Global referral identity.
 */
userSchema.index(
  {
    referralCode: 1,
  },
  {
    unique: true,
    sparse: true,
    name: "uq_user_referral_code",
  }
);

/**
 * Tenant dashboards / member administration.
 */
userSchema.index({
  tenantId: 1,
  status: 1,
  isActive: 1,
  name: 1,
});

/**
 * Tenant + email lookup support.
 *
 * This is non-unique because global email uniqueness is authoritative.
 */
userSchema.index({
  tenantId: 1,
  email: 1,
});

/**
 * Tenant authorization queries.
 */
userSchema.index({
  tenantId: 1,
  role: 1,
  status: 1,
});

/**
 * Tenant soft-delete filtering.
 */
userSchema.index({
  tenantId: 1,
  deletedAt: 1,
});

/**
 * Tenant verified-user reporting.
 */
userSchema.index({
  tenantId: 1,
  isVerified: 1,
  createdAt: -1,
});

/**
 * KYC work queues.
 */
userSchema.index({
  "kyc.status": 1,
  "kyc.level": 1,
});

/**
 * AML review queues.
 */
userSchema.index({
  "aml.riskRating": 1,
  "aml.reviewRequired": 1,
});

/**
 * Authentication lock checks.
 */
userSchema.index({
  status: 1,
  lockUntil: 1,
});

/**
 * Last-login analytics.
 */
userSchema.index({
  lastLogin: -1,
});

/**
 * User creation reporting.
 */
userSchema.index({
  createdAt: -1,
});

/**
 * Legacy User-level reset-token expiry lookup.
 */
userSchema.index({
  resetPasswordExpires: 1,
});

/**
 * Legacy User-level verification-token expiry lookup.
 */
userSchema.index({
  verificationTokenExpires: 1,
});

/**
 * ============================================================================
 * MODEL EXPORT
 * ============================================================================
 *
 * Native ESM export contract.
 *
 * This is the canonical User model.
 *
 * Do NOT add createRequire()/require() compatibility logic here.
 *
 * Legacy CommonJS consumers should be migrated to:
 *
 *   import User from "../models/User.js";
 *
 * or:
 *
 *   import {
 *     User,
 *     USER_ROLES
 *   } from "../models/User.js";
 */

export const User =
  mongoose.models.User ||
  mongoose.model(
    "User",
    userSchema
  );

export default User;

/**
 * ============================================================================
 * EXPORTED MODEL METADATA
 * ============================================================================
 */

export const USER_MODEL_METADATA =
  Object.freeze({
    modelName: "User",
    schemaVersion: 2,
    tenantField: "tenantId",
    tenantFieldType: "ObjectId",
    canonicalVerificationField: "isVerified",
    passwordHashAlgorithm: "bcrypt",
    bcryptRounds: SALT_ROUNDS,
    passwordHistoryLimit: PASSWORD_HISTORY_LIMIT,
    resetTokenTtlMs: RESET_TOKEN_TTL_MS,
    verificationTokenTtlMs:
      VERIFICATION_TOKEN_TTL_MS,
    globalEmailUniqueness: true,
    financialStateAuthority: false,
  });

export {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_HISTORY_LIMIT,
  RESET_TOKEN_TTL_MS,
  VERIFICATION_TOKEN_TTL_MS,
  SALT_ROUNDS,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  normalizeReferralCode,
  hashToken,
  isValidObjectId,
  isBcryptHash,
};