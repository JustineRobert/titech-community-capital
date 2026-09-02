"use strict";

/**
 * =============================================================================
 * TITech Community Capital
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/models/PasswordResetToken.js
 *
 * Purpose:
 *   Enterprise-grade password-reset token persistence model.
 *
 * Security Model:
 *   - NEVER stores plaintext password-reset tokens.
 *   - Stores only a SHA-256/HMAC-derived token hash.
 *   - Token hashes are unique.
 *   - Token hashes are never returned by default.
 *   - MongoDB TTL removes expired records asynchronously.
 *   - Application-level expiry validation remains mandatory.
 *   - Tokens are single-use.
 *   - Atomic consumption is supported for concurrent requests.
 *   - Token lifecycle supports used/revoked/soft-deleted states.
 *   - Multi-tenant isolation is supported.
 *   - Request and consumption audit metadata is supported.
 *   - Metadata is constrained and protected against obvious secret leakage.
 *
 * IMPORTANT:
 *   The plaintext token MUST NEVER be persisted anywhere in this model.
 *
 * =============================================================================
 */

const mongoose = require("mongoose");

const { Schema } = mongoose;

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

/**
 * TITech currently standardizes tokenHash persistence as a 64-character
 * lowercase hexadecimal cryptographic digest.
 *
 * Examples:
 *   SHA-256(rawToken)
 *   HMAC-SHA256(rawToken)
 *
 * The actual cryptographic operation belongs to the service layer.
 */
const TOKEN_HASH_LENGTH = 64;

const IP_MAX_LENGTH = 64;
const USER_AGENT_MAX_LENGTH = 1024;
const REQUEST_ID_MAX_LENGTH = 128;
const REASON_MAX_LENGTH = 256;

const METADATA_MAX_KEYS = 50;
const METADATA_MAX_DEPTH = 3;
const METADATA_MAX_SERIALIZED_BYTES = 8192;

/**
 * Metadata keys that must never be persisted.
 *
 * This is intentionally defensive rather than exhaustive.
 */
const FORBIDDEN_METADATA_KEY_PATTERN =
  /^(password|passwd|passcode|token|accesstoken|refreshtoken|authorization|cookie|secret|secretkey|clientsecret|privatekey|otp|pin|apikey|api_key|credential|credentials)$/i;

/**
 * =============================================================================
 * Validation Utilities
 * =============================================================================
 */

/**
 * Safely determine whether a value is a plain object.
 */
function isPlainObject(value) {
  if (value === null || typeof value !== "object") {
    return false;
  }

  if (Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

/**
 * Recursively inspect metadata for suspicious credential-like keys.
 */
function containsForbiddenMetadataKey(value, depth = 0) {
  if (depth > METADATA_MAX_DEPTH) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.some((item) =>
      containsForbiddenMetadataKey(item, depth + 1)
    );
  }

  if (!isPlainObject(value)) {
    return false;
  }

  return Object.entries(value).some(([key, childValue]) => {
    if (FORBIDDEN_METADATA_KEY_PATTERN.test(key)) {
      return true;
    }

    return containsForbiddenMetadataKey(childValue, depth + 1);
  });
}

/**
 * Validate metadata without attempting to guarantee that arbitrary
 * application metadata can never contain sensitive information.
 */
function validateMetadata(value) {
  if (value == null) {
    return true;
  }

  if (!isPlainObject(value)) {
    return false;
  }

  const keys = Object.keys(value);

  if (keys.length > METADATA_MAX_KEYS) {
    return false;
  }

  if (containsForbiddenMetadataKey(value)) {
    return false;
  }

  try {
    const serialized = JSON.stringify(value);

    if (!serialized) {
      return true;
    }

    return (
      Buffer.byteLength(serialized, "utf8") <=
      METADATA_MAX_SERIALIZED_BYTES
    );
  } catch (_error) {
    return false;
  }
}

/**
 * Normalize an optional ObjectId filter.
 *
 * The actual service layer remains responsible for authorization.
 */
function isValidObjectId(value) {
  return (
    value == null ||
    value instanceof mongoose.Types.ObjectId ||
    mongoose.isValidObjectId(value)
  );
}

/**
 * =============================================================================
 * PasswordResetToken Schema
 * =============================================================================
 */

const PasswordResetTokenSchema = new Schema(
  {
    /**
     * -------------------------------------------------------------------------
     * User
     * -------------------------------------------------------------------------
     */

    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
      index: true,
    },

    /**
     * -------------------------------------------------------------------------
     * Tenant Context
     * -------------------------------------------------------------------------
     *
     * TITech is multi-tenant.
     *
     * tenantId is intentionally retained on the token itself so token
     * operations can be scoped independently of User document resolution.
     */
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Tenant",
      default: null,
      immutable: true,
      index: true,
    },

    /**
     * -------------------------------------------------------------------------
     * Token Purpose
     * -------------------------------------------------------------------------
     *
     * Explicit purpose prevents this collection from becoming a generic
     * credential-token store.
     */

    purpose: {
      type: String,
      enum: ["password_reset"],
      required: true,
      default: "password_reset",
      immutable: true,
      index: true,
    },

    /**
     * -------------------------------------------------------------------------
     * Token Hash
     * -------------------------------------------------------------------------
     *
     * NEVER store the plaintext reset token.
     *
     * Recommended service-layer implementation:
     *
     *   crypto
     *     .createHash("sha256")
     *     .update(rawToken)
     *     .digest("hex");
     *
     * Or HMAC-SHA256 where the architecture specifically requires it.
     *
     * The persisted representation MUST be:
     *
     *   - 64 characters
     *   - lowercase hexadecimal
     */

    tokenHash: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      lowercase: true,
      minlength: TOKEN_HASH_LENGTH,
      maxlength: TOKEN_HASH_LENGTH,
      match: /^[a-f0-9]{64}$/,
      unique: true,
      index: true,
      select: false,
    },

    /**
     * -------------------------------------------------------------------------
     * Expiration
     * -------------------------------------------------------------------------
     *
     * TTL deletion is performed asynchronously by MongoDB.
     *
     * Therefore application-level validation MUST always check:
     *
     *   expiresAt > now
     */

    expiresAt: {
      type: Date,
      required: true,
      immutable: true,
      index: true,
      expires: 0,
      validate: {
        validator(value) {
          return value instanceof Date && !Number.isNaN(value.getTime());
        },
        message: "expiresAt must be a valid Date",
      },
    },

    /**
     * -------------------------------------------------------------------------
     * Consumption State
     * -------------------------------------------------------------------------
     */

    used: {
      type: Boolean,
      default: false,
      index: true,
    },

    usedAt: {
      type: Date,
      default: null,
    },

    /**
     * -------------------------------------------------------------------------
     * Consumption Audit
     * -------------------------------------------------------------------------
     *
     * These fields are optional but useful during security investigations.
     */

    consumedIp: {
      type: String,
      trim: true,
      maxlength: IP_MAX_LENGTH,
      default: null,
    },

    consumedUserAgent: {
      type: String,
      trim: true,
      maxlength: USER_AGENT_MAX_LENGTH,
      default: null,
    },

    consumedRequestId: {
      type: String,
      trim: true,
      maxlength: REQUEST_ID_MAX_LENGTH,
      default: null,
    },

    /**
     * -------------------------------------------------------------------------
     * Revocation
     * -------------------------------------------------------------------------
     */

    revoked: {
      type: Boolean,
      default: false,
      index: true,
    },

    revokedAt: {
      type: Date,
      default: null,
    },

    revocationReason: {
      type: String,
      trim: true,
      maxlength: REASON_MAX_LENGTH,
      default: null,
    },

    /**
     * -------------------------------------------------------------------------
     * Request Audit Information
     * -------------------------------------------------------------------------
     */

    requestIp: {
      type: String,
      trim: true,
      maxlength: IP_MAX_LENGTH,
      default: null,
    },

    userAgent: {
      type: String,
      trim: true,
      maxlength: USER_AGENT_MAX_LENGTH,
      default: null,
    },

    requestId: {
      type: String,
      trim: true,
      maxlength: REQUEST_ID_MAX_LENGTH,
      default: null,
    },

    /**
     * -------------------------------------------------------------------------
     * Metadata
     * -------------------------------------------------------------------------
     *
     * NEVER use metadata as a secret container.
     *
     * The validator rejects common credential-like field names and also limits
     * size/depth.
     */

    metadata: {
      type: Schema.Types.Mixed,
      default: undefined,
      validate: {
        validator: validateMetadata,
        message:
          "metadata contains invalid structure, forbidden secret-like keys, or exceeds security limits",
      },
    },

    /**
     * -------------------------------------------------------------------------
     * Soft Delete
     * -------------------------------------------------------------------------
     *
     * NOTE:
     * MongoDB TTL deletion remains the final physical cleanup mechanism.
     * Therefore soft deletion is mainly useful before TTL expiration and for
     * application-level lifecycle semantics.
     */

    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },

    deletedAt: {
      type: Date,
      default: null,
    },

    deleteReason: {
      type: String,
      trim: true,
      maxlength: REASON_MAX_LENGTH,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    minimize: true,
    strict: true,
    collection: "password_reset_tokens",
  }
);

/**
 * =============================================================================
 * Indexes
 * =============================================================================
 */

/**
 * Active-token lookup by user.
 */
PasswordResetTokenSchema.index({
  user: 1,
  used: 1,
  revoked: 1,
  isDeleted: 1,
  expiresAt: 1,
});

/**
 * Tenant-aware operational/security queries.
 */
PasswordResetTokenSchema.index({
  tenantId: 1,
  user: 1,
  createdAt: -1,
});

/**
 * Security investigations by request origin.
 */
PasswordResetTokenSchema.index({
  requestIp: 1,
  createdAt: -1,
});

/**
 * Security investigations by request ID.
 */
PasswordResetTokenSchema.index({
  requestId: 1,
  createdAt: -1,
});

/**
 * Operational queries for recent revocations.
 */
PasswordResetTokenSchema.index({
  revoked: 1,
  revokedAt: -1,
});

/**
 * Operational queries for recent use.
 */
PasswordResetTokenSchema.index({
  used: 1,
  usedAt: -1,
});

/**
 * IMPORTANT:
 *
 * tokenHash is already unique via:
 *
 *   unique: true
 *
 * This is appropriate because the persisted value is a cryptographic digest.
 *
 * The service layer remains responsible for generating cryptographically
 * random plaintext reset tokens before hashing them.
 */

/**
 * =============================================================================
 * Query Helpers
 * =============================================================================
 */

/**
 * Return only active, usable reset tokens.
 */
PasswordResetTokenSchema.query.active = function () {
  return this.where({
    used: false,
    revoked: false,
    isDeleted: false,
    expiresAt: { $gt: new Date() },
  });
};

/**
 * Return tokens belonging to a specific user.
 */
PasswordResetTokenSchema.query.forUser = function (userId) {
  return this.where({
    user: userId,
  });
};

/**
 * Return tokens belonging to a specific tenant.
 */
PasswordResetTokenSchema.query.forTenant = function (tenantId) {
  return this.where({
    tenantId,
  });
};

/**
 * Return tokens belonging to a specific tenant + user pair.
 */
PasswordResetTokenSchema.query.forTenantUser = function (
  tenantId,
  userId
) {
  return this.where({
    tenantId,
    user: userId,
  });
};

/**
 * =============================================================================
 * Instance Methods
 * =============================================================================
 */

/**
 * Determine whether this token is expired.
 */
PasswordResetTokenSchema.methods.isExpired = function () {
  return (
    !(this.expiresAt instanceof Date) ||
    this.expiresAt.getTime() <= Date.now()
  );
};

/**
 * Determine whether the token is currently usable.
 *
 * MongoDB TTL deletion is asynchronous, so this is mandatory at the
 * application layer.
 */
PasswordResetTokenSchema.methods.isUsable = function () {
  return (
    !this.used &&
    !this.revoked &&
    !this.isDeleted &&
    !this.isExpired()
  );
};

/**
 * Mark a token as consumed.
 *
 * IMPORTANT:
 * For the actual production password-reset endpoint, prefer the static
 * consumeAtomically() method to prevent concurrent consumption.
 */
PasswordResetTokenSchema.methods.markUsed = function (audit = {}) {
  if (this.used) {
    return Promise.reject(
      new Error("Password reset token has already been used")
    );
  }

  if (this.revoked || this.isDeleted) {
    return Promise.reject(
      new Error("Password reset token is no longer usable")
    );
  }

  if (this.isExpired()) {
    return Promise.reject(
      new Error("Password reset token has expired")
    );
  }

  this.used = true;
  this.usedAt = new Date();

  if (audit.ip != null) {
    this.consumedIp = audit.ip;
  }

  if (audit.userAgent != null) {
    this.consumedUserAgent = audit.userAgent;
  }

  if (audit.requestId != null) {
    this.consumedRequestId = audit.requestId;
  }

  return this.save();
};

/**
 * Revoke a token.
 */
PasswordResetTokenSchema.methods.revoke = function (
  reason = "revoked"
) {
  this.revoked = true;
  this.revokedAt = new Date();
  this.revocationReason = reason || "revoked";

  return this.save();
};

/**
 * Soft-delete a token.
 */
PasswordResetTokenSchema.methods.softDelete = function (
  reason = "deleted"
) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deleteReason = reason || "deleted";

  return this.save();
};

/**
 * =============================================================================
 * Static Methods
 * =============================================================================
 */

/**
 * Find an active reset token by hash.
 *
 * Optional scoping:
 *
 *   {
 *     tenantId,
 *     userId,
 *     session
 *   }
 *
 * tokenHash is explicitly selected because it is select:false by default.
 */
PasswordResetTokenSchema.statics.findActiveByHash = function (
  tokenHash,
  options = {}
) {
  if (
    typeof tokenHash !== "string" ||
    !/^[a-f0-9]{64}$/i.test(tokenHash)
  ) {
    return null;
  }

  const filter = {
    purpose: "password_reset",
    tokenHash: tokenHash.toLowerCase(),
    used: false,
    revoked: false,
    isDeleted: false,
    expiresAt: { $gt: new Date() },
  };

  if (options.tenantId != null) {
    filter.tenantId = options.tenantId;
  }

  if (options.userId != null) {
    filter.user = options.userId;
  }

  if (options.session) {
    return this.findOne(filter)
      .session(options.session)
      .select("+tokenHash");
  }

  return this.findOne(filter).select("+tokenHash");
};

/**
 * Atomically consume a reset token.
 *
 * This is the preferred production mechanism.
 *
 * The filter itself enforces:
 *
 *   unused
 *   not revoked
 *   not deleted
 *   not expired
 *   correct purpose
 *
 * Therefore concurrent requests cannot successfully consume the same token.
 */
PasswordResetTokenSchema.statics.consumeAtomically = function (
  tokenHash,
  options = {}
) {
  if (
    typeof tokenHash !== "string" ||
    !/^[a-f0-9]{64}$/i.test(tokenHash)
  ) {
    return Promise.resolve(null);
  }

  const now = new Date();

  const filter = {
    purpose: "password_reset",
    tokenHash: tokenHash.toLowerCase(),
    used: false,
    revoked: false,
    isDeleted: false,
    expiresAt: { $gt: now },
  };

  if (options.tenantId != null) {
    filter.tenantId = options.tenantId;
  }

  if (options.userId != null) {
    filter.user = options.userId;
  }

  const set = {
    used: true,
    usedAt: now,
  };

  /**
   * Persist only safe audit fields supplied by the caller.
   */
  if (options.ip != null) {
    set.consumedIp = options.ip;
  }

  if (options.userAgent != null) {
    set.consumedUserAgent = options.userAgent;
  }

  if (options.requestId != null) {
    set.consumedRequestId = options.requestId;
  }

  const query = this.findOneAndUpdate(
    filter,
    {
      $set: set,
    },
    {
      new: true,
      runValidators: true,
      returnDocument: "after",
    }
  );

  if (options.session) {
    query.session(options.session);
  }

  return query.select("+tokenHash");
};

/**
 * Revoke all active password-reset tokens for a user.
 *
 * Used when:
 *
 *   - A new reset request is created.
 *   - A password has already been changed.
 *   - An account is locked.
 *   - Suspicious activity is detected.
 *   - Administrative security action occurs.
 */
PasswordResetTokenSchema.statics.revokeActiveForUser = function (
  userId,
  reason = "superseded",
  options = {}
) {
  const filter = {
    user: userId,
    purpose: "password_reset",
    used: false,
    revoked: false,
    isDeleted: false,
    expiresAt: { $gt: new Date() },
  };

  if (options.tenantId != null) {
    filter.tenantId = options.tenantId;
  }

  const update = {
    $set: {
      revoked: true,
      revokedAt: new Date(),
      revocationReason: reason || "superseded",
    },
  };

  const query = this.updateMany(filter, update);

  if (options.session) {
    query.session(options.session);
  }

  return query;
};

/**
 * Revoke ALL active tokens for a tenant.
 *
 * Useful during tenant-wide security incidents or controlled maintenance.
 */
PasswordResetTokenSchema.statics.revokeActiveForTenant = function (
  tenantId,
  reason = "tenant_security_event",
  options = {}
) {
  const filter = {
    tenantId,
    purpose: "password_reset",
    used: false,
    revoked: false,
    isDeleted: false,
    expiresAt: { $gt: new Date() },
  };

  const update = {
    $set: {
      revoked: true,
      revokedAt: new Date(),
      revocationReason:
        reason || "tenant_security_event",
    },
  };

  const query = this.updateMany(filter, update);

  if (options.session) {
    query.session(options.session);
  }

  return query;
};

/**
 * =============================================================================
 * Validation Hooks
 * =============================================================================
 */

/**
 * Validate ObjectId fields before persistence.
 */
PasswordResetTokenSchema.pre("validate", function (next) {
  if (!isValidObjectId(this.user)) {
    this.invalidate("user", "user must be a valid ObjectId");
  }

  if (!isValidObjectId(this.tenantId)) {
    this.invalidate(
      "tenantId",
      "tenantId must be a valid ObjectId"
    );
  }

  /**
   * Lifecycle consistency.
   */

  if (this.used && !this.usedAt) {
    this.usedAt = new Date();
  }

  if (!this.used && this.usedAt) {
    this.invalidate(
      "usedAt",
      "usedAt must be empty while token is unused"
    );
  }

  if (this.used) {
    /**
     * Once a token is consumed, it should never silently become usable again.
     */
    if (this.expiresAt && this.expiresAt.getTime() <= Date.now()) {
      /**
       * An already-used expired token is fine.
       * No invalidation is required.
       */
    }
  }

  if (this.revoked && !this.revokedAt) {
    this.revokedAt = new Date();
  }

  if (!this.revoked && this.revokedAt) {
    this.invalidate(
      "revokedAt",
      "revokedAt must be empty while token is not revoked"
    );
  }

  if (!this.revoked && this.revocationReason) {
    this.invalidate(
      "revocationReason",
      "revocationReason must be empty while token is not revoked"
    );
  }

  if (this.isDeleted && !this.deletedAt) {
    this.deletedAt = new Date();
  }

  if (!this.isDeleted && this.deletedAt) {
    this.invalidate(
      "deletedAt",
      "deletedAt must be empty while token is not deleted"
    );
  }

  if (!this.isDeleted && this.deleteReason) {
    this.invalidate(
      "deleteReason",
      "deleteReason must be empty while token is not deleted"
    );
  }

  /**
   * A token belongs to exactly one explicit purpose.
   */
  if (this.purpose !== "password_reset") {
    this.invalidate(
      "purpose",
      'purpose must be "password_reset"'
    );
  }

  next();
});

/**
 * =============================================================================
 * Query Middleware
 * =============================================================================
 *
 * Normal application queries must not accidentally surface soft-deleted
 * records.
 *
 * Administrative/security repositories can opt in with:
 *
 *   .setOptions({ includeDeleted: true })
 *
 * The explicit option keeps privileged access deliberate.
 */

PasswordResetTokenSchema.pre(/^find/, function (next) {
  const options = this.getOptions();

  if (!options.includeDeleted) {
    this.where({
      isDeleted: false,
    });
  }

  next();
});

/**
 * =============================================================================
 * Serialization Protection
 * =============================================================================
 *
 * Defense in depth:
 *
 *   1. tokenHash is select:false
 *   2. tokenHash is explicitly removed from JSON serialization
 *
 * This protects against accidental response serialization when an internal
 * operation explicitly selected +tokenHash.
 */
PasswordResetTokenSchema.methods.toJSON = function () {
  const obj = this.toObject();

  delete obj.tokenHash;

  return obj;
};

/**
 * =============================================================================
 * Model Export
 * =============================================================================
 */

module.exports =
  mongoose.models.PasswordResetToken ||
  mongoose.model(
    "PasswordResetToken",
    PasswordResetTokenSchema
  );