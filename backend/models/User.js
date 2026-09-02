"use strict";

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
 *            ├── Authentication
 *            ├── Authorization
 *            ├── Security
 *            ├── KYC / AML
 *            ├── MFA
 *            ├── Mobile Money
 *            ├── Referral
 *            └── Audit Metadata
 *
 * SECURITY PRINCIPLES
 * ----------------------------------------------------------------------------
 * - Passwords are never returned by default.
 * - Passwords are hashed using bcrypt.
 * - Password reset tokens are stored only as SHA-256 hashes.
 * - Email verification tokens are stored only as SHA-256 hashes.
 * - MFA secrets and backup codes are protected with select:false.
 * - Tenant isolation is represented directly on the user.
 * - Referral counters are server-controlled.
 * - Sensitive authentication fields are excluded from JSON serialization.
 * - Authentication state transitions are explicit.
 * - Password changes update security metadata.
 * - Duplicate email/referral identifiers are prevented by indexes.
 * - No financial balance is stored directly on User.
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * Financial balances MUST NOT be implemented on this model.
 * Use Savings / Account / Ledger / Transaction models for financial state.
 *
 * ============================================================================
 */

const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const validator = require("validator");

const { Schema } = mongoose;

/**
 * ============================================================================
 * CONFIGURATION
 * ============================================================================
 */

const DEFAULT_BCRYPT_ROUNDS = 12;

const MIN_BCRYPT_ROUNDS = 10;

const MAX_BCRYPT_ROUNDS = 15;

const PASSWORD_HISTORY_LIMIT = 5;

const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const DEFAULT_LOGIN_THRESHOLD = 5;

const DEFAULT_LOCK_MINUTES = 15;

const MAX_NAME_LENGTH = 100;

const MAX_EMAIL_LENGTH = 254;

/**
 * Never allow an accidentally invalid environment value to weaken hashing.
 */
const configuredBcryptRounds = Number.parseInt(
  process.env.BCRYPT_ROUNDS || DEFAULT_BCRYPT_ROUNDS,
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

const USER_ROLES = Object.freeze([
  "user",
  "admin",
  "group_admin",
]);

const USER_STATUSES = Object.freeze([
  "pending",
  "active",
  "disabled",
  "suspended",
  "locked",
]);

const KYC_LEVELS = Object.freeze([
  "none",
  "basic",
  "enhanced",
  "full",
]);

const KYC_STATUSES = Object.freeze([
  "pending",
  "approved",
  "rejected",
  "expired",
]);

const AML_RISK_RATINGS = Object.freeze([
  "low",
  "medium",
  "high",
  "critical",
]);

const MOBILE_MONEY_PROVIDERS = Object.freeze([
  "mtn",
  "airtel",
  "other",
]);

/**
 * ============================================================================
 * NORMALIZATION HELPERS
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
    .update(String(token))
    .digest("hex");
}

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value);
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
 * NOTE:
 * Encryption at rest for MFA secrets should additionally be handled at the
 * application/security infrastructure layer where supported.
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
      maxlength: 128,
      default: null,
    },

    lastLoginUserAgent: {
      type: String,
      trim: true,
      maxlength: 1024,
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
      unique: true,
      index: true,
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
      minlength: 8,
      select: false,
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
            /^\+?[1-9]\d{1,14}$/.test(value)
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
     * EMAIL VERIFICATION
     * ========================================================================
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
     * PASSWORD RESET
     * ========================================================================
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
     * User is the owner of the referral identity only.
     *
     * Referral reward issuance MUST be handled by:
     *
     *   Referral
     *       ↓
     *   ReferralReward
     *       ↓
     *   ReferralRewardService
     *       ↓
     *   Transaction / Ledger
     *
     * Do not use `bonus` as the authoritative financial ledger.
     */

    referralCode: {
      type: String,
      unique: true,
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
       * Financial applications should NOT use this field as the authoritative
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
         * Never expose authentication/security secrets.
         */
        delete ret.password;
        delete ret.resetPasswordToken;
        delete ret.resetPasswordExpires;
        delete ret.verificationToken;
        delete ret.verificationTokenExpires;
        delete ret.failedLoginAttempts;
        delete ret.lockUntil;
        delete ret.passwordHistory;

        if (ret.mfa) {
          delete ret.mfa.secret;
          delete ret.mfa.backupCodes;
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

        if (ret.mfa) {
          delete ret.mfa.secret;
          delete ret.mfa.backupCodes;
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

userSchema.virtual("isLocked").get(function () {
  return Boolean(
    this.lockUntil &&
    this.lockUntil.getTime() > Date.now()
  );
});

userSchema.virtual("isSoftDeleted").get(function () {
  return Boolean(this.deletedAt);
});

userSchema.virtual("requiresKyc").get(function () {
  return (
    this.kyc &&
    this.kyc.level !== "none" &&
    this.kyc.status !== "approved"
  );
});

/**
 * ============================================================================
 * PASSWORD HASHING
 * ============================================================================
 *
 * Save-based password changes are hashed here.
 */

userSchema.pre("save", async function passwordHashMiddleware(next) {
  if (!this.isModified("password")) {
    return next();
  }

  try {
    if (!this.password) {
      return next(
        new Error("Password cannot be empty.")
      );
    }

    /**
     * Prevent accidentally hashing an already hashed password.
     *
     * bcrypt hashes normally begin with:
     *
     * $2a$
     * $2b$
     * $2y$
     */
    const alreadyHashed =
      /^\$2[aby]\$\d{2}\$/.test(
        this.password
      );

    if (alreadyHashed) {
      return next();
    }

    const previousPasswordHash =
      this.isNew
        ? null
        : this.get("password", null);

    const hashedPassword =
      await bcrypt.hash(
        this.password,
        SALT_ROUNDS
      );

    if (
      previousPasswordHash &&
      previousPasswordHash !== hashedPassword
    ) {
      this.passwordHistory.push({
        hash: previousPasswordHash,
        changedAt: new Date(),
      });
    }

    if (
      this.passwordHistory.length >
      PASSWORD_HISTORY_LIMIT
    ) {
      this.passwordHistory =
        this.passwordHistory.slice(
          -PASSWORD_HISTORY_LIMIT
        );
    }

    this.password =
      hashedPassword;

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
});

/**
 * ============================================================================
 * QUERY UPDATE PASSWORD HASHING
 * ============================================================================
 *
 * Supports:
 *
 *   User.findOneAndUpdate(...)
 *
 * without allowing plaintext passwords to reach MongoDB.
 *
 * IMPORTANT:
 * Password history is intentionally not modified here because query
 * middleware cannot safely reconstruct the complete previous document without
 * an additional database read.
 *
 * Password-history-sensitive changes should use:
 *
 *   user.password = newPassword;
 *   await user.save();
 */

userSchema.pre(
  "findOneAndUpdate",
  async function passwordUpdateMiddleware(next) {
    const update = this.getUpdate();

    if (!update) {
      return next();
    }

    const password =
      update.password ||
      update.$set?.password;

    if (
      typeof password !== "string" ||
      password.length === 0
    ) {
      return next();
    }

    try {
      const alreadyHashed =
        /^\$2[aby]\$\d{2}\$/.test(
          password
        );

      if (!alreadyHashed) {
        const hashed =
          await bcrypt.hash(
            password,
            SALT_ROUNDS
          );

        if (update.password) {
          update.password = hashed;
        }

        if (update.$set?.password) {
          update.$set.password = hashed;
        }
      }

      const now = new Date();

      update.$set =
        update.$set || {};

      update.$set[
        "security.lastPasswordChange"
      ] = now;

      update.$inc =
        update.$inc || {};

      update.$inc[
        "security.securityVersion"
      ] = 1;

      update.$inc[
        "sessionMetrics.sessionVersion"
      ] = 1;

      this.setUpdate(update);

      return next();
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * ============================================================================
 * EMAIL NORMALIZATION
 * ============================================================================
 */

userSchema.pre("validate", function normalizeUserFields(next) {
  if (this.email) {
    this.email =
      normalizeEmail(this.email);
  }

  if (this.name) {
    this.name =
      normalizeName(this.name);
  }

  if (this.phone) {
    this.phone =
      normalizePhone(this.phone);
  }

  if (this.referralCode) {
    this.referralCode =
      normalizeReferralCode(
        this.referralCode
      );
  }

  next();
});

/**
 * ============================================================================
 * PASSWORD METHODS
 * ============================================================================
 */

/**
 * Compare a supplied password against the stored bcrypt hash.
 *
 * Because password has select:false, callers must explicitly load it:
 *
 *   User.findOne(...).select("+password")
 */
userSchema.methods.matchPassword =
  async function matchPassword(
    enteredPassword
  ) {
    if (
      typeof enteredPassword !==
        "string" ||
      !enteredPassword ||
      !this.password
    ) {
      return false;
    }

    return bcrypt.compare(
      enteredPassword,
      this.password
    );
  };

/**
 * Check whether a password hash has already been used.
 */
userSchema.methods.isPasswordPreviouslyUsed =
  async function isPasswordPreviouslyUsed(
    plainPassword
  ) {
    if (
      typeof plainPassword !==
        "string" ||
      !plainPassword
    ) {
      return false;
    }

    const history =
      this.passwordHistory || [];

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
      crypto
        .randomBytes(32)
        .toString("hex");

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
      crypto
        .randomBytes(32)
        .toString("hex");

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

    return (
      this.resetPasswordExpires.getTime() >
        Date.now() &&
      crypto.timingSafeEqual(
        Buffer.from(
          this.resetPasswordToken,
          "hex"
        ),
        Buffer.from(
          hashToken(token),
          "hex"
        )
      )
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

    return (
      this.verificationTokenExpires.getTime() >
        Date.now() &&
      crypto.timingSafeEqual(
        Buffer.from(
          this.verificationToken,
          "hex"
        ),
        Buffer.from(
          hashToken(token),
          "hex"
        )
      )
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
      this.lockUntil.getTime() >
        Date.now()
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

    if (
      this.isCurrentlyLocked()
    ) {
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
       * Security-version increment invalidates authentication sessions.
       */
      this.security.securityVersion =
        Number(
          this.security.securityVersion ||
            1
        ) + 1;

      if (!this.sessionMetrics) {
        this.sessionMetrics = {};
      }

      this.sessionMetrics.sessionVersion =
        Number(
          this.sessionMetrics.sessionVersion ||
            1
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

    if (
      this.status === "locked"
    ) {
      this.status = "active";
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

    this.security.lastLoginAt =
      now;

    if (metadata.ip) {
      this.security.lastLoginIp =
        String(metadata.ip).slice(
          0,
          128
        );
    }

    if (metadata.userAgent) {
      this.security.lastLoginUserAgent =
        String(
          metadata.userAgent
        ).slice(
          0,
          1024
        );
    }

    this.failedLoginAttempts = 0;
    this.lockUntil = null;

    if (
      this.status === "locked"
    ) {
      this.status = "active";
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
        this.sessionMetrics.sessionVersion ||
          1
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
  function belongsToTenant(
    tenantId
  ) {
    if (
      !this.tenantId ||
      !tenantId
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
        this.referrals.successfulReferrals ||
          0
      ) + 1;

    this.referrals.pendingReferrals =
      Math.max(
        0,
        Number(
          this.referrals.pendingReferrals ||
            0
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

userSchema.statics.findByEmail =
  function findByEmail(
    email,
    options = {}
  ) {
    const query = {
      email: normalizeEmail(email),
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

    return operation;
  };

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
    });
  };

userSchema.statics.findTenantUser =
  function findTenantUser(
    tenantId,
    userId
  ) {
    if (
      !isValidObjectId(
        tenantId
      ) ||
      !isValidObjectId(
        userId
      )
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
      query.tenantId = tenantId;
    }

    return this.find(query);
  };

/**
 * ============================================================================
 * SAFE AUTHENTICATION PROJECTION
 * ============================================================================
 */

userSchema.statics.authenticationProjection =
  function authenticationProjection() {
    return this.findOne()
      .select(
        "+password +mfa.secret +mfa.backupCodes"
      );
  };

/**
 * ============================================================================
 * INDEXES
 * ============================================================================
 *
 * IMPORTANT:
 *
 * `email: unique:true` creates a global email uniqueness constraint.
 *
 * This is intentional unless TITech explicitly permits the same email address
 * in multiple tenants.
 *
 * If tenant-scoped email identity is required, remove the global unique email
 * index and use:
 *
 *   { tenantId: 1, email: 1 } unique
 *
 * instead.
 * ============================================================================
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

userSchema.index({
  tenantId: 1,
  status: 1,
  isActive: 1,
  name: 1,
});

userSchema.index({
  tenantId: 1,
  email: 1,
});

userSchema.index({
  tenantId: 1,
  role: 1,
  status: 1,
});

userSchema.index({
  tenantId: 1,
  deletedAt: 1,
});

userSchema.index({
  tenantId: 1,
  isVerified: 1,
  createdAt: -1,
});

userSchema.index({
  "kyc.status": 1,
  "kyc.level": 1,
});

userSchema.index({
  "aml.riskRating": 1,
  "aml.reviewRequired": 1,
});

userSchema.index({
  status: 1,
  lockUntil: 1,
});

userSchema.index({
  lastLogin: -1,
});

userSchema.index({
  createdAt: -1,
});

/**
 * Token expiry lookup indexes.
 */
userSchema.index({
  resetPasswordExpires: 1,
});

userSchema.index({
  verificationTokenExpires: 1,
});

/**
 * ============================================================================
 * MODEL EXPORT
 * ============================================================================
 */

module.exports =
  mongoose.models.User ||
  mongoose.model(
    "User",
    userSchema
  );

/**
 * ============================================================================
 * EXPORTED CONSTANTS
 * ============================================================================
 *
 * Expose immutable constants without exposing secrets.
 * ============================================================================
 */

module.exports.USER_ROLES =
  USER_ROLES;

module.exports.USER_STATUSES =
  USER_STATUSES;

module.exports.KYC_LEVELS =
  KYC_LEVELS;

module.exports.KYC_STATUSES =
  KYC_STATUSES;

module.exports.AML_RISK_RATINGS =
  AML_RISK_RATINGS;

module.exports.MOBILE_MONEY_PROVIDERS =
  MOBILE_MONEY_PROVIDERS;