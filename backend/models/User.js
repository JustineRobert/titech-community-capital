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
 *   Identity, authentication, authorization, security, KYC/AML, MFA,
 *   mobile-money, referrals and tenant-aware user persistence.
 *
 * Security invariants:
 *   - Native ESM.
 *   - Passwords are bcrypt-hashed before persistence.
 *   - Password reset and verification tokens are stored as SHA-256 hashes.
 *   - Sensitive authentication fields use select:false.
 *   - Tenant identity remains ObjectId(ref: "Tenant").
 *   - Email identity is globally unique.
 *   - Referral identity is unique when present.
 *   - No authoritative financial balance is stored on User.
 *   - Legacy bonus is not a financial ledger.
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
  "member",
  "guest",
  "group_admin",
  "tenant_admin",
  "platform_admin",
  "user",
  "admin",
  "super_admin",
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

  return value.trim().replace(/\s+/g, " ");
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

function isBcryptHash(value) {
  return (
    typeof value === "string" &&
    /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(value)
  );
}

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

function isPasswordFieldPath(path) {
  return (
    typeof path === "string" &&
    (
      path === "password" ||
      path.endsWith(".password")
    )
  );
}

/**
 * Recursively find password field paths in update documents and aggregation
 * update pipelines. The recursive check is defensive: a password field can
 * otherwise be hidden inside nested replacement or expression objects.
 */
function collectPasswordMutationPaths(
  value,
  prefix = "",
  visited = new Set(),
  paths = []
) {
  if (
    value === null ||
    typeof value !== "object"
  ) {
    return paths;
  }

  if (visited.has(value)) {
    return paths;
  }

  visited.add(value);

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      collectPasswordMutationPaths(
        value[index],
        `${prefix}[${index}]`,
        visited,
        paths
      );
    }

    return paths;
  }

  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (isPasswordFieldPath(key) || isPasswordFieldPath(path)) {
      paths.push(path);
    }

    collectPasswordMutationPaths(
      child,
      path,
      visited,
      paths
    );
  }

  return paths;
}

function pipelineContainsPasswordUpdate(updatePipeline) {
  return (
    Array.isArray(updatePipeline) &&
    collectPasswordMutationPaths(updatePipeline).length > 0
  );
}

function getPasswordMutationLocations(update) {
  if (
    !update ||
    typeof update !== "object"
  ) {
    return [];
  }

  return collectPasswordMutationPaths(update);
}

/**
 * Only top-level replacement and $set password assignments are supported by
 * the hashing middleware. Other password operators are rejected.
 */
function extractPasswordFromUpdate(update) {
  if (
    !update ||
    typeof update !== "object" ||
    Array.isArray(update)
  ) {
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
    !Array.isArray(update.$set) &&
    typeof update.$set.password === "string"
  ) {
    return update.$set.password;
  }

  return undefined;
}

function pathsOverlap(left, right) {
  return (
    left === right ||
    left.startsWith(`${right}.`) ||
    right.startsWith(`${left}.`)
  );
}

/**
 * Prevent password middleware from creating conflicting updates to the
 * security/session fields it manages itself.
 */
function assertPasswordMetadataPathsAvailable(update) {
  const protectedPaths = [
    "security.lastPasswordChange",
    "security.securityVersion",
    "sessionMetrics.sessionVersion",
  ];

  for (const [operator, payload] of Object.entries(update)) {
    if (
      !operator.startsWith("$") ||
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload)
    ) {
      continue;
    }

    for (const path of Object.keys(payload)) {
      const overlaps = protectedPaths.some(
        (protectedPath) =>
          pathsOverlap(path, protectedPath)
      );

      if (!overlaps) {
        continue;
      }

      /**
       * A caller-supplied increment of the version fields is allowed. The
       * middleware will add its own increment to the requested amount.
       */
      if (
        operator === "$inc" &&
        (
          path === "security.securityVersion" ||
          path === "sessionMetrics.sessionVersion"
        )
      ) {
        continue;
      }

      throw new Error(
        `Password updates cannot directly modify ${path}; ` +
        "the password security middleware owns this field."
      );
    }
  }
}

/**
 * Prepare a newly inserted user password. This is shared by insertMany
 * middleware so it does not persist plaintext passwords without save hooks.
 */
async function prepareInsertedPassword(document) {
  if (
    !document ||
    typeof document !== "object"
  ) {
    throw new TypeError(
      "User insertMany entries must be objects."
    );
  }

  if (
    typeof document.password !== "string" ||
    document.password.length === 0
  ) {
    throw new Error(
      "A password must be supplied when inserting a user."
    );
  }

  if (!isBcryptHash(document.password)) {
    if (!isStrongPassword(document.password)) {
      throw new Error(
        "Password must be 12-128 characters and contain uppercase, " +
        "lowercase, number and special character."
      );
    }

    document.password = await bcrypt.hash(
      document.password,
      SALT_ROUNDS
    );
  }

  const now = new Date();

  const security =
    document.security &&
    typeof document.security === "object"
      ? document.security
      : {};

  security.lastPasswordChange =
    security.lastPasswordChange || now;

  security.securityVersion =
    Number(security.securityVersion || 1) + 1;

  document.security = security;

  const sessionMetrics =
    document.sessionMetrics &&
    typeof document.sessionMetrics === "object"
      ? document.sessionMetrics
      : {};

  sessionMetrics.sessionVersion =
    Number(sessionMetrics.sessionVersion || 1) + 1;

  document.sessionMetrics = sessionMetrics;
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
          "Password must be 12-128 characters and contain uppercase, " +
          "lowercase, number and special character",
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

    role: {
      type: String,
      enum: USER_ROLES,
      default: "member",
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
     * Canonical email verification field.
     * Do not introduce a duplicate isEmailVerified field.
     */
    isVerified: {
      type: Boolean,
      default: false,
      index: true,
    },

    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Tenant",
      required: false,
      index: true,
      default: null,
    },

    profile: {
      type: profileSchema,
      default: () => ({}),
    },

    kyc: {
      type: kycSchema,
      default: () => ({}),
    },

    aml: {
      type: amlSchema,
      default: () => ({}),
    },

    mfa: {
      type: mfaSchema,
      default: () => ({}),
    },

    mobileMoney: {
      type: mobileMoneySchema,
      default: () => ({}),
    },

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
      // Index declared once below with an explicit schema index.
    },

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
      // Index declared once below with an explicit schema index.
    },

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

    referralCode: {
      type: String,
      sparse: true,
      trim: true,
      uppercase: true,
      maxlength: 64,
      index: true,
      set: normalizeReferralCode,
    },

    /**
     * Legacy compatibility only.
     * This is not an authoritative financial balance.
     */
    bonus: {
      type: Number,
      default: 0,
      min: 0,
      immutable: false,
    },

    referrals: {
      type: referralsSchema,
      default: () => ({}),
    },

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

    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },

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
      this.deletedAt == null &&
      !this.isCurrentlyLocked()
    );
  }
);

/**
 * ============================================================================
 * DOCUMENT PASSWORD HASHING
 * ============================================================================
 *
 * Preferred workflow:
 *
 *   const user = new User(...);
 *   user.password = newPassword;
 *   await user.save();
 */

userSchema.pre("save", async function passwordHashMiddleware() {
  if (!this.isModified("password")) {
    return;
  }

  if (
    typeof this.password !== "string" ||
    this.password.length === 0
  ) {
    throw new Error("Password cannot be empty.");
  }

  const previousPasswordHash = this.isNew
    ? null
    : this.get("password", null);

  const alreadyHashed = isBcryptHash(this.password);

  if (!alreadyHashed && !isStrongPassword(this.password)) {
    throw new Error(
      "Password must be 12-128 characters and contain uppercase, " +
      "lowercase, number and special character."
    );
  }

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
    this.password = await bcrypt.hash(
      this.password,
      SALT_ROUNDS
    );
  }

  if (!this.security) {
    this.security = {};
  }

  this.security.lastPasswordChange = new Date();

  this.security.securityVersion =
    Number(this.security.securityVersion || 1) + 1;

  if (!this.sessionMetrics) {
    this.sessionMetrics = {};
  }

  this.sessionMetrics.sessionVersion =
    Number(this.sessionMetrics.sessionVersion || 1) + 1;
});

/**
 * ============================================================================
 * insertMany PASSWORD SAFEGUARD
 * ============================================================================
 *
 * Mongoose insertMany() does not run the normal save middleware for each
 * inserted document. This hook hashes and validates passwords explicitly.
 */

userSchema.pre(
  "insertMany",
  function hashInsertManyPasswords(next, documents) {
    (async () => {
      if (!Array.isArray(documents)) {
        throw new TypeError(
          "insertMany requires an array of user documents."
        );
      }

      for (const document of documents) {
        await prepareInsertedPassword(document);
      }
    })().then(
      () => next(),
      (error) => next(error)
    );
  }
);

/**
 * ============================================================================
 * QUERY PASSWORD HASHING
 * ============================================================================
 *
 * Supported:
 *   User.findOneAndUpdate(...)
 *   User.findByIdAndUpdate(...)
 *   User.updateOne(...)
 *
 * This middleware:
 *   - requires a single, unambiguous password assignment;
 *   - validates plaintext password strength;
 *   - bcrypt-hashes plaintext before persistence;
 *   - updates security/session versions;
 *   - rejects conflicting updates to middleware-owned metadata.
 *
 * Password-history-sensitive changes should use the document save workflow.
 */

async function passwordQueryUpdateMiddleware() {
  const originalUpdate = this.getUpdate();

  if (!originalUpdate) {
    return;
  }

  if (Array.isArray(originalUpdate)) {
    if (pipelineContainsPasswordUpdate(originalUpdate)) {
      throw new Error(
        "Pipeline password updates are not permitted. " +
        "Use document password assignment or a supported single-user update."
      );
    }

    return;
  }

  const passwordLocations =
    getPasswordMutationLocations(originalUpdate);

  if (passwordLocations.length === 0) {
    return;
  }

  const supportedLocation =
    passwordLocations.length === 1 &&
    (
      passwordLocations[0] === "password" ||
      passwordLocations[0] === "$set.password"
    );

  if (!supportedLocation) {
    throw new Error(
      "Password updates must use one top-level password assignment " +
      "or $set.password. Other password update operators are not permitted."
    );
  }

  const suppliedPassword =
    extractPasswordFromUpdate(originalUpdate);

  if (
    typeof suppliedPassword !== "string" ||
    suppliedPassword.length === 0
  ) {
    throw new Error(
      "Password updates must supply a non-empty string."
    );
  }

  const hashedPassword = isBcryptHash(suppliedPassword)
    ? suppliedPassword
    : await (async () => {
        if (!isStrongPassword(suppliedPassword)) {
          throw new Error(
            "Password must be 12-128 characters and contain uppercase, " +
            "lowercase, number and special character."
          );
        }

        return bcrypt.hash(
          suppliedPassword,
          SALT_ROUNDS
        );
      })();

  /**
   * Clone the outer update object so middleware does not mutate caller-owned
   * objects unexpectedly.
   */
  let update = {
    ...originalUpdate,
  };

  const hasAtomicOperators =
    Object.keys(update).some(
      (key) => key.startsWith("$")
    );

  if (!hasAtomicOperators) {
    /**
     * Normalize a replacement-style update into a $set operation, preserving
     * other submitted fields while allowing safe password processing.
     */
    update = {
      $set: {
        ...update,
      },
    };
  } else {
    /**
     * Normalize any mixed direct-field/operator update into an atomic update.
     */
    const directFields = {};

    for (const [key, value] of Object.entries(update)) {
      if (!key.startsWith("$")) {
        directFields[key] = value;
        delete update[key];
      }
    }

    if (Object.keys(directFields).length > 0) {
      const existingSet =
        update.$set &&
        typeof update.$set === "object" &&
        !Array.isArray(update.$set)
          ? update.$set
          : {};

      for (const key of Object.keys(directFields)) {
        if (hasOwn(existingSet, key)) {
          throw new Error(
            `Ambiguous query update: ${key} appears both directly and in $set.`
          );
        }
      }

      update.$set = {
        ...directFields,
        ...existingSet,
      };
    }
  }

  if (
    !update.$set ||
    typeof update.$set !== "object" ||
    Array.isArray(update.$set)
  ) {
    update.$set = {};
  }

  if (
    update.$inc !== undefined &&
    (
      update.$inc === null ||
      typeof update.$inc !== "object" ||
      Array.isArray(update.$inc)
    )
  ) {
    throw new TypeError(
      "The $inc update operator must be an object."
    );
  }

  assertPasswordMetadataPathsAvailable(update);

  update.$set.password = hashedPassword;
  update.$set["security.lastPasswordChange"] = new Date();

  update.$inc =
    update.$inc &&
    typeof update.$inc === "object" &&
    !Array.isArray(update.$inc)
      ? { ...update.$inc }
      : {};

  for (const path of [
    "security.securityVersion",
    "sessionMetrics.sessionVersion",
  ]) {
    const existingIncrement =
      update.$inc[path] === undefined
        ? 0
        : Number(update.$inc[path]);

    if (!Number.isFinite(existingIncrement)) {
      throw new TypeError(
        `The $inc value for ${path} must be a finite number.`
      );
    }

    update.$inc[path] =
      existingIncrement + 1;
  }

  this.setUpdate(update);
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
 * REJECT UNSAFE MULTI-DOCUMENT / REPLACEMENT PASSWORD UPDATES
 * ============================================================================
 *
 * Password changes through these operations are rejected because the model
 * cannot safely run its single-user password workflow for an arbitrary number
 * of documents or replacement payloads.
 */

async function rejectUnsafePasswordMutationMiddleware() {
  const update = this.getUpdate();

  if (!update) {
    return;
  }

  const passwordLocations =
    getPasswordMutationLocations(update);

  if (passwordLocations.length > 0) {
    throw new Error(
      "Password changes through updateMany, replaceOne or " +
      "findOneAndReplace are not permitted. Use the supported " +
      "single-user password workflow."
    );
  }
}

userSchema.pre(
  "updateMany",
  rejectUnsafePasswordMutationMiddleware
);

userSchema.pre(
  "replaceOne",
  rejectUnsafePasswordMutationMiddleware
);

userSchema.pre(
  "findOneAndReplace",
  rejectUnsafePasswordMutationMiddleware
);

/**
 * ============================================================================
 * bulkWrite PASSWORD SAFEGUARD
 * ============================================================================
 *
 * bulkWrite bypasses the ordinary per-document save lifecycle. Password
 * writes through bulkWrite are rejected rather than risking plaintext storage
 * or silently bypassing password/session metadata updates.
 */

userSchema.pre(
  "bulkWrite",
  function rejectBulkWritePasswordMutation(next, operations) {
    try {
      if (!Array.isArray(operations)) {
        throw new TypeError(
          "bulkWrite operations must be an array."
        );
      }

      for (const operation of operations) {
        if (!operation || typeof operation !== "object") {
          continue;
        }

        const insertDocument =
          operation.insertOne?.document;

        if (
          insertDocument &&
          getPasswordMutationLocations(insertDocument).length > 0
        ) {
          throw new Error(
            "User passwords cannot be inserted through bulkWrite. " +
            "Use User.create(), save() or the supported insertMany() workflow."
          );
        }

        const updateDocuments = [
          operation.updateOne?.update,
          operation.updateMany?.update,
          operation.replaceOne?.replacement,
        ].filter(Boolean);

        for (const update of updateDocuments) {
          if (
            getPasswordMutationLocations(update).length > 0
          ) {
            throw new Error(
              "Password mutations through bulkWrite are not permitted."
            );
          }
        }
      }

      return next();
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * ============================================================================
 * FIELD NORMALIZATION
 * ============================================================================
 */

userSchema.pre(
  "validate",
  function normalizeUserFields() {
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
        normalizeReferralCode(this.referralCode);
    }
  }
);

/**
 * ============================================================================
 * PASSWORD METHODS
 * ============================================================================
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

userSchema.methods.isPasswordPreviouslyUsed =
  async function isPasswordPreviouslyUsed(plainPassword) {
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
      new Date(Date.now() + RESET_TOKEN_TTL_MS);

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
      new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);

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
      this.resetPasswordExpires.getTime() <= Date.now()
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
      this.verificationTokenExpires.getTime() <= Date.now()
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

    this.security.passwordResetAt = new Date();
  };

userSchema.methods.clearVerificationToken =
  function clearVerificationToken() {
    this.verificationToken = null;
    this.verificationTokenExpires = null;

    if (!this.security) {
      this.security = {};
    }

    this.security.emailVerifiedAt = new Date();
  };

/**
 * ============================================================================
 * ACCOUNT LOCKING
 * ============================================================================
 */

userSchema.methods.isCurrentlyLocked =
  function isCurrentlyLocked() {
    return Boolean(
      this.lockUntil instanceof Date &&
      this.lockUntil.getTime() > Date.now()
    );
  };

userSchema.methods.bumpFailedLogin =
  async function bumpFailedLogin(
    threshold = DEFAULT_LOGIN_THRESHOLD,
    lockMinutes = DEFAULT_LOCK_MINUTES
  ) {
    const normalizedThreshold = Math.max(
      1,
      Number.parseInt(threshold, 10) ||
        DEFAULT_LOGIN_THRESHOLD
    );

    const normalizedLockMinutes = Math.max(
      1,
      Number.parseInt(lockMinutes, 10) ||
        DEFAULT_LOCK_MINUTES
    );

    if (this.isCurrentlyLocked()) {
      return this;
    }

    this.failedLoginAttempts =
      Number(this.failedLoginAttempts || 0) + 1;

    if (!this.security) {
      this.security = {};
    }

    this.security.lastFailedLoginAt = new Date();

    if (
      this.failedLoginAttempts >=
      normalizedThreshold
    ) {
      this.lockUntil =
        new Date(
          Date.now() +
          normalizedLockMinutes * 60 * 1000
        );

      this.status = "locked";

      this.security.securityVersion =
        Number(this.security.securityVersion || 1) + 1;

      if (!this.sessionMetrics) {
        this.sessionMetrics = {};
      }

      this.sessionMetrics.sessionVersion =
        Number(this.sessionMetrics.sessionVersion || 1) + 1;
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

    this.security.lastFailedLoginAt = null;

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
  async function recordSuccessfulLogin(metadata = {}) {
    const now = new Date();

    this.lastLogin = now;

    if (!this.security) {
      this.security = {};
    }

    this.security.lastLoginAt = now;

    if (metadata.ip) {
      this.security.lastLoginIp =
        String(metadata.ip).slice(0, MAX_IP_LENGTH);
    }

    if (metadata.userAgent) {
      this.security.lastLoginUserAgent =
        String(metadata.userAgent).slice(
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
      Number(this.sessionMetrics.sessionVersion || 1) + 1;

    this.sessionMetrics.activeSessions = 0;
    this.sessionMetrics.lastSessionRevokedAt = new Date();

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

    this.security.emailVerifiedAt = new Date();

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

    return String(this.tenantId) === String(tenantId);
  };

/**
 * ============================================================================
 * REFERRAL HELPERS
 * ============================================================================
 *
 * These methods update referral statistics only. They do not issue financial
 * rewards or maintain an authoritative reward balance.
 */

userSchema.methods.recordReferral =
  async function recordReferral() {
    if (!this.referrals) {
      this.referrals = {};
    }

    this.referrals.totalReferrals =
      Number(this.referrals.totalReferrals || 0) + 1;

    this.referrals.pendingReferrals =
      Number(this.referrals.pendingReferrals || 0) + 1;

    this.referrals.lastReferralAt = new Date();

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
      Number(this.referrals.successfulReferrals || 0) + 1;

    this.referrals.pendingReferrals = Math.max(
      0,
      Number(this.referrals.pendingReferrals || 0) - 1
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
 * Find a user by normalized email, excluding soft-deleted accounts by default.
 *
 * Options:
 *   includeDeleted
 *   includePassword
 *   includeMfaSecrets
 *   includePasswordHistory
 */
userSchema.statics.findByEmail =
  function findByEmail(email, options = {}) {
    const query = {
      email: normalizeEmail(email),
    };

    if (options.includeDeleted !== true) {
      query.deletedAt = null;
    }

    let operation = this.findOne(query);

    if (options.includePassword === true) {
      operation = operation.select("+password");
    }

    if (options.includeMfaSecrets === true) {
      operation = operation.select(
        "+mfa.secret +mfa.backupCodes"
      );
    }

    if (options.includePasswordHistory === true) {
      operation = operation.select("+passwordHistory");
    }

    return operation;
  };

userSchema.statics.findByReferralCode =
  function findByReferralCode(referralCode) {
    return this.findOne({
      referralCode: normalizeReferralCode(referralCode),
      deletedAt: null,
      isActive: true,
      status: "active",
    });
  };

/**
 * tenantId is an ObjectId and is deliberately not stringified before querying.
 */
userSchema.statics.findTenantUser =
  function findTenantUser(tenantId, userId) {
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

userSchema.statics.findActiveUsers =
  function findActiveUsers(tenantId = null) {
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
 * A caller must provide non-empty authentication criteria.
 * Unscoped authentication lookups return no document.
 */
userSchema.statics.authenticationProjection =
  function authenticationProjection(filter = {}, options = {}) {
    const safeFilter =
      filter &&
      typeof filter === "object" &&
      !Array.isArray(filter) &&
      Object.keys(filter).length > 0
        ? { ...filter }
        : { _id: null };

    let operation = this.findOne(safeFilter).select(
      "+password +mfa.secret +mfa.backupCodes"
    );

    if (options.includePasswordHistory === true) {
      operation = operation.select("+passwordHistory");
    }

    if (options.includeDeleted !== true) {
      operation = operation.where({
        deletedAt: null,
      });
    }

    return operation;
  };

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
      filter.email = normalizeEmail(email);
    }

    if (tenantId) {
      if (!isValidObjectId(tenantId)) {
        return this.findOne({
          _id: null,
        });
      }

      filter.tenantId = tenantId;
    }

    if (!filter._id && !filter.email) {
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
 * Email identity is globally unique.
 * Referral codes are globally unique when supplied.
 * Token-expiry indexes are each declared exactly once below.
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

userSchema.index(
  {
    resetPasswordExpires: 1,
  },
  {
    name: "idx_user_reset_password_expires",
  }
);

userSchema.index(
  {
    verificationTokenExpires: 1,
  },
  {
    name: "idx_user_verification_token_expires",
  }
);

/**
 * ============================================================================
 * MODEL EXPORT
 * ============================================================================
 *
 * Canonical native ESM export.
 *
 * CommonJS consumers should be migrated to:
 *
 *   import User from "../models/User.js";
 *
 * or:
 *
 *   import { User, USER_ROLES } from "../models/User.js";
 */

export const User =
  mongoose.models.User ||
  mongoose.model("User", userSchema);

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
    verificationTokenTtlMs: VERIFICATION_TOKEN_TTL_MS,
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