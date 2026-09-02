"use strict";

/**
 * ============================================================================
 * TITech Community Capital
 * Enterprise Refresh Token Model
 * ============================================================================
 *
 * File:
 *   backend/models/RefreshToken.js
 *
 * Purpose:
 *   Persistent server-side state for opaque refresh-token sessions.
 *
 * Security Model:
 *
 *   Raw refresh tokens are NEVER persisted.
 *   Only SHA-256 token digests are stored.
 *
 *   Refresh lifecycle:
 *
 *      raw refresh token
 *             |
 *             v
 *        SHA-256 hash
 *             |
 *             v
 *        tokenHash lookup
 *             |
 *             v
 *        atomic rotation
 *             |
 *             +----------------------+
 *             |                      |
 *             v                      v
 *         success                 failure
 *             |                      |
 *             v                      v
 *       replacement             reuse detection
 *                                  |
 *                                  v
 *                           revoke token family
 *
 * Token families:
 *
 *   Token A
 *      |
 *      +--> Token B
 *              |
 *              +--> Token C
 *                      |
 *                      +--> Token D
 *
 * Every rotated token remains in the same family.
 *
 * A previously rotated token must never become active again.
 *
 * IMPORTANT:
 *
 * This model DOES NOT:
 *
 *   - issue JWT access tokens;
 *   - issue raw refresh tokens;
 *   - set cookies;
 *   - validate passwords;
 *   - perform MFA;
 *   - authenticate users;
 *   - decide authentication policy;
 *   - send authentication responses.
 *
 * Those responsibilities belong to the authentication/session service and
 * controller layer.
 *
 * The canonical refresh endpoint remains:
 *
 *   POST /refresh
 *
 * Any legacy endpoint such as /refresh-token should delegate into the same
 * authentication service rather than implementing a second refresh flow.
 *
 * MULTI-TENANT SECURITY:
 *
 * Tenant identity must originate from trusted server-side authentication or
 * administrative context. It must never be trusted from arbitrary client
 * query/body/header input.
 *
 * TRANSACTION MODEL:
 *
 * The authentication service should preferably execute:
 *
 *   1. Resolve and validate the presented refresh token.
 *   2. Atomically consume/rotate the current token.
 *   3. Persist the replacement token.
 *   4. Commit the transaction.
 *   5. Issue the new access/refresh credentials.
 *
 * Replaying a previously consumed token must be treated as a security event
 * and should revoke the complete token family.
 *
 * ============================================================================
 */

const crypto = require("crypto");
const mongoose = require("mongoose");

const { Schema } = mongoose;

// ============================================================================
// Constants
// ============================================================================

const TOKEN_HASH_ALGORITHM = "sha256";

const TOKEN_ID_BYTES = 16;
const TOKEN_FAMILY_BYTES = 16;

const PUBLIC_ID_LENGTH = TOKEN_ID_BYTES * 2;
const TOKEN_FAMILY_LENGTH = TOKEN_FAMILY_BYTES * 2;
const TOKEN_HASH_LENGTH = 64;

const MAX_REASON_LENGTH = 128;
const MAX_DEVICE_NAME_LENGTH = 256;
const MAX_DEVICE_ID_LENGTH = 256;
const MAX_USER_AGENT_LENGTH = 2048;
const MAX_IP_LENGTH = 128;
const MAX_ISSUED_BY_LENGTH = 128;

const PUBLIC_ID_PATTERN =
  /^[a-f0-9]{32}$/;

const TOKEN_FAMILY_PATTERN =
  /^[a-f0-9]{32}$/;

const TOKEN_HASH_PATTERN =
  /^[a-f0-9]{64}$/;

// ============================================================================
// Security Reasons
// ============================================================================

const REVOCATION_REASONS = Object.freeze([
  "rotated",
  "user_revoked",
  "user_logout",
  "user_logout_all",
  "admin_revoked",
  "device_revoked",
  "security_revoked",
  "refresh_token_reuse",
  "session_expired",
  "account_disabled",
  "account_deleted",
  "tenant_disabled",
  "password_changed",
  "mfa_reset",
  "unspecified",
]);

// ============================================================================
// Issuance Sources
// ============================================================================

const ISSUED_BY_VALUES = Object.freeze([
  "password_login",
  "refresh_rotation",
  "mfa_login",
  "passwordless_login",
  "admin_session",
  "system",
  "unknown",
]);

// ============================================================================
// Immutable Security Helpers
// ============================================================================

function generatePublicId() {
  return crypto
    .randomBytes(TOKEN_ID_BYTES)
    .toString("hex");
}

function generateTokenFamilyId() {
  return crypto
    .randomBytes(TOKEN_FAMILY_BYTES)
    .toString("hex");
}

/**
 * Hash a raw refresh token.
 *
 * The raw token must never be written to:
 *
 *   - MongoDB;
 *   - logs;
 *   - audit records;
 *   - metrics;
 *   - traces;
 *   - error messages.
 */
function hashToken(rawToken) {
  if (
    typeof rawToken !== "string" ||
    rawToken.length === 0
  ) {
    throw new TypeError(
      "A non-empty refresh token is required."
    );
  }

  return crypto
    .createHash(TOKEN_HASH_ALGORITHM)
    .update(rawToken, "utf8")
    .digest("hex");
}

/**
 * Constant-time digest comparison.
 *
 * MongoDB hash lookup is normally preferred. This helper exists for callers
 * that have already loaded a candidate digest and require an explicit
 * constant-time comparison.
 */
function hashesEqual(left, right) {
  if (
    typeof left !== "string" ||
    typeof right !== "string"
  ) {
    return false;
  }

  if (
    !TOKEN_HASH_PATTERN.test(left) ||
    !TOKEN_HASH_PATTERN.test(right)
  ) {
    return false;
  }

  const leftBuffer =
    Buffer.from(left, "utf8");

  const rightBuffer =
    Buffer.from(right, "utf8");

  if (
    leftBuffer.length !==
    rightBuffer.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    leftBuffer,
    rightBuffer
  );
}

/**
 * Normalize bounded string input.
 */
function normalizeString(
  value,
  maxLength
) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const normalized =
    String(value)
      .trim()
      .slice(0, maxLength);

  return normalized || null;
}

/**
 * Normalize a revocation/security reason.
 */
function normalizeReason(reason) {
  const normalized =
    normalizeString(
      reason,
      MAX_REASON_LENGTH
    );

  if (!normalized) {
    return "unspecified";
  }

  return REVOCATION_REASONS.includes(
    normalized
  )
    ? normalized
    : "unspecified";
}

/**
 * Normalize an issuance source.
 */
function normalizeIssuedBy(value) {
  const normalized =
    normalizeString(
      value,
      MAX_ISSUED_BY_LENGTH
    );

  if (!normalized) {
    return "unknown";
  }

  return ISSUED_BY_VALUES.includes(
    normalized
  )
    ? normalized
    : "unknown";
}

/**
 * Normalize date input.
 */
function normalizeDate(value) {
  if (!value) {
    return null;
  }

  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  return date;
}

/**
 * Validate an ObjectId.
 */
function isValidObjectId(value) {
  return mongoose.isValidObjectId(
    value
  );
}

/**
 * Return a query that can never match.
 *
 * Used instead of accepting malformed identifiers and accidentally producing
 * broad database queries.
 */
function impossibleQuery() {
  return {
    _id: null,
  };
}

// ============================================================================
// Device Information
// ============================================================================

const DeviceInfoSchema =
  new Schema(
    {
      ip: {
        type: String,
        default: null,
        trim: true,
        maxlength: MAX_IP_LENGTH,
      },

      ua: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_USER_AGENT_LENGTH,
      },

      name: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_DEVICE_NAME_LENGTH,
      },

      deviceId: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_DEVICE_ID_LENGTH,
      },
    },
    {
      _id: false,
      versionKey: false,
      strict: true,
    }
  );

// ============================================================================
// Refresh Token Schema
// ============================================================================

const RefreshTokenSchema =
  new Schema(
    {
      // ----------------------------------------------------------------------
      // Public record identifier.
      //
      // This is NOT the refresh token.
      // ----------------------------------------------------------------------

      id: {
        type: String,
        required: true,
        unique: true,
        index: true,
        immutable: true,
        default: generatePublicId,
        minlength: PUBLIC_ID_LENGTH,
        maxlength: PUBLIC_ID_LENGTH,
        match: PUBLIC_ID_PATTERN,
      },

      // ----------------------------------------------------------------------
      // User ownership.
      // ----------------------------------------------------------------------

      userId: {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true,
        immutable: true,
        index: true,
      },

      // ----------------------------------------------------------------------
      // Tenant ownership.
      //
      // Null is allowed for installations that have not enabled tenant
      // scoping. When tenant-aware authentication is enabled, services must
      // always enforce tenant consistency.
      // ----------------------------------------------------------------------

      tenantId: {
        type: Schema.Types.ObjectId,
        ref: "Tenant",
        default: null,
        immutable: true,
        index: true,
      },

      // ----------------------------------------------------------------------
      // SHA-256 digest of the raw refresh token.
      //
      // NEVER return this through an API.
      // NEVER log this field.
      // NEVER expose this field in normal queries.
      // ----------------------------------------------------------------------

      tokenHash: {
        type: String,
        required: true,
        unique: true,
        index: true,
        immutable: true,
        select: false,
        minlength: TOKEN_HASH_LENGTH,
        maxlength: TOKEN_HASH_LENGTH,
        match: TOKEN_HASH_PATTERN,
      },

      // ----------------------------------------------------------------------
      // Rotation family.
      // ----------------------------------------------------------------------

      familyId: {
        type: String,
        required: true,
        index: true,
        immutable: true,
        default: generateTokenFamilyId,
        minlength: TOKEN_FAMILY_LENGTH,
        maxlength: TOKEN_FAMILY_LENGTH,
        match: TOKEN_FAMILY_PATTERN,
      },

      // ----------------------------------------------------------------------
      // Lifecycle timestamps.
      // ----------------------------------------------------------------------

      createdAt: {
        type: Date,
        required: true,
        immutable: true,
        default: Date.now,
        index: true,
      },

      lastUsedAt: {
        type: Date,
        required: true,
        default: Date.now,
        index: true,
      },

      expiresAt: {
        type: Date,
        required: true,
        index: true,
      },

      // ----------------------------------------------------------------------
      // Revocation state.
      // ----------------------------------------------------------------------

      revokedAt: {
        type: Date,
        default: null,
        index: true,
      },

      revokedReason: {
        type: String,
        default: null,
        trim: true,
        maxlength: MAX_REASON_LENGTH,
        enum: [
          null,
          ...REVOCATION_REASONS,
        ],
      },

      // ----------------------------------------------------------------------
      // Rotation lineage.
      //
      // replacedBy references the public id of the replacement token record.
      //
      // It NEVER contains a raw refresh token.
      // ----------------------------------------------------------------------

      replacedBy: {
        type: String,
        default: null,
        maxlength: PUBLIC_ID_LENGTH,
        match:
          PUBLIC_ID_PATTERN,
        index: true,
      },

      replacedAt: {
        type: Date,
        default: null,
      },

      // ----------------------------------------------------------------------
      // Reuse detection.
      // ----------------------------------------------------------------------

      reuseDetectedAt: {
        type: Date,
        default: null,
        index: true,
      },

      reuseDetectedReason: {
        type: String,
        default: null,
        trim: true,
        maxlength: MAX_REASON_LENGTH,
      },

      // ----------------------------------------------------------------------
      // Device/session metadata.
      // ----------------------------------------------------------------------

      deviceInfo: {
        type: DeviceInfoSchema,
        default: () => ({}),
      },

      // ----------------------------------------------------------------------
      // Issuance source.
      // ----------------------------------------------------------------------

      issuedBy: {
        type: String,
        default: "password_login",
        trim: true,
        maxlength:
          MAX_ISSUED_BY_LENGTH,
        enum: ISSUED_BY_VALUES,
      },

      // ----------------------------------------------------------------------
      // Most recent request metadata.
      // ----------------------------------------------------------------------

      lastUsedIp: {
        type: String,
        default: null,
        trim: true,
        maxlength: MAX_IP_LENGTH,
      },

      lastUsedUserAgent: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_USER_AGENT_LENGTH,
      },
    },
    {
      versionKey: false,
      timestamps: false,
      strict: true,

      // ----------------------------------------------------------------------
      // Security-safe JSON representation.
      // ----------------------------------------------------------------------

      toJSON: {
        transform(doc, ret) {
          ret.id =
            ret.id ||
            ret._id?.toString?.();

          delete ret._id;
          delete ret.tokenHash;

          return ret;
        },
      },

      toObject: {
        transform(doc, ret) {
          ret.id =
            ret.id ||
            ret._id?.toString?.();

          delete ret._id;
          delete ret.tokenHash;

          return ret;
        },
      },
    }
  );

// ============================================================================
// Schema Validation
// ============================================================================

RefreshTokenSchema.pre(
  "validate",
  function validateRefreshToken(
    next
  ) {
    const validationError =
      new mongoose.Error.ValidationError(
        this
      );

    // ------------------------------------------------------------------------
    // Expiration must occur after creation.
    // ------------------------------------------------------------------------

    if (
      this.expiresAt &&
      this.createdAt &&
      this.expiresAt <=
        this.createdAt
    ) {
      validationError.addError(
        "expiresAt",
        new mongoose.Error.ValidatorError(
          {
            path: "expiresAt",
            message:
              "expiresAt must be later than createdAt.",
          }
        )
      );
    }

    // ------------------------------------------------------------------------
    // lastUsedAt cannot precede creation.
    // ------------------------------------------------------------------------

    if (
      this.lastUsedAt &&
      this.createdAt &&
      this.lastUsedAt <
        this.createdAt
    ) {
      validationError.addError(
        "lastUsedAt",
        new mongoose.Error.ValidatorError(
          {
            path: "lastUsedAt",
            message:
              "lastUsedAt cannot precede createdAt.",
          }
        )
      );
    }

    // ------------------------------------------------------------------------
    // Rotation lineage must be internally consistent.
    // ------------------------------------------------------------------------

    if (
      this.replacedBy &&
      !this.replacedAt
    ) {
      validationError.addError(
        "replacedAt",
        new mongoose.Error.ValidatorError(
          {
            path: "replacedAt",
            message:
              "replacedAt is required when replacedBy is set.",
          }
        )
      );
    }

    if (
      this.replacedAt &&
      !this.replacedBy
    ) {
      validationError.addError(
        "replacedBy",
        new mongoose.Error.ValidatorError(
          {
            path: "replacedBy",
            message:
              "replacedBy is required when replacedAt is set.",
          }
        )
      );
    }

    // ------------------------------------------------------------------------
    // A rotated token must be revoked.
    // ------------------------------------------------------------------------

    if (
      this.replacedBy &&
      !this.revokedAt
    ) {
      validationError.addError(
        "revokedAt",
        new mongoose.Error.ValidatorError(
          {
            path: "revokedAt",
            message:
              "A rotated token must be revoked.",
          }
        )
      );
    }

    // ------------------------------------------------------------------------
    // Reuse detection must correspond to revocation.
    // ------------------------------------------------------------------------

    if (
      this.reuseDetectedAt &&
      !this.revokedAt
    ) {
      validationError.addError(
        "revokedAt",
        new mongoose.Error.ValidatorError(
          {
            path: "revokedAt",
            message:
              "Reuse detection requires token revocation.",
          }
        )
      );
    }

    // ------------------------------------------------------------------------
    // Reuse detection should have a reason.
    // ------------------------------------------------------------------------

    if (
      this.reuseDetectedAt &&
      !this.reuseDetectedReason
    ) {
      validationError.addError(
        "reuseDetectedReason",
        new mongoose.Error.ValidatorError(
          {
            path:
              "reuseDetectedReason",
            message:
              "Reuse detection requires a reason.",
          }
        )
      );
    }

    if (
      Object.keys(
        validationError.errors
      ).length > 0
    ) {
      return next(
        validationError
      );
    }

    return next();
  }
);

// ============================================================================
// Indexes
// ============================================================================

// -----------------------------------------------------------------------------
// Active sessions for a user.
// -----------------------------------------------------------------------------

RefreshTokenSchema.index({
  userId: 1,
  revokedAt: 1,
  expiresAt: 1,
});

// -----------------------------------------------------------------------------
// Tenant-scoped active sessions.
// -----------------------------------------------------------------------------

RefreshTokenSchema.index({
  tenantId: 1,
  revokedAt: 1,
  expiresAt: 1,
});

// -----------------------------------------------------------------------------
// User + tenant session operations.
// -----------------------------------------------------------------------------

RefreshTokenSchema.index({
  tenantId: 1,
  userId: 1,
  revokedAt: 1,
  expiresAt: 1,
});

// -----------------------------------------------------------------------------
// Token-family security operations.
// -----------------------------------------------------------------------------

RefreshTokenSchema.index({
  familyId: 1,
  revokedAt: 1,
});

// -----------------------------------------------------------------------------
// User + token-family operations.
// -----------------------------------------------------------------------------

RefreshTokenSchema.index({
  userId: 1,
  familyId: 1,
});

// -----------------------------------------------------------------------------
// Device session management.
// -----------------------------------------------------------------------------

RefreshTokenSchema.index({
  userId: 1,
  "deviceInfo.deviceId": 1,
  revokedAt: 1,
});

// -----------------------------------------------------------------------------
// Tenant + device session management.
// -----------------------------------------------------------------------------

RefreshTokenSchema.index({
  tenantId: 1,
  userId: 1,
  "deviceInfo.deviceId": 1,
  revokedAt: 1,
});

// -----------------------------------------------------------------------------
// Recently active sessions.
// -----------------------------------------------------------------------------

RefreshTokenSchema.index({
  userId: 1,
  lastUsedAt: -1,
});

// -----------------------------------------------------------------------------
// Rotation lineage.
// -----------------------------------------------------------------------------

RefreshTokenSchema.index({
  replacedBy: 1,
});

// -----------------------------------------------------------------------------
// Security incident lookup.
// -----------------------------------------------------------------------------

RefreshTokenSchema.index({
  reuseDetectedAt: 1,
});

// -----------------------------------------------------------------------------
// MongoDB TTL cleanup.
//
// MongoDB removes the record after expiresAt.
//
// Important:
// TTL cleanup is eventual rather than an authorization mechanism.
// Authentication queries MUST always check expiresAt explicitly.
// -----------------------------------------------------------------------------

RefreshTokenSchema.index(
  {
    expiresAt: 1,
  },
  {
    expireAfterSeconds: 0,
    name:
      "refresh_token_expiration_ttl",
  }
);

// ============================================================================
// Instance Methods
// ============================================================================

/**
 * Determine whether the token is currently usable.
 *
 * This method is intentionally strict:
 *
 *   - must not be revoked;
 *   - must have a valid expiration;
 *   - expiration must be in the future.
 */
RefreshTokenSchema.methods.isActive =
  function isActive(
    now = new Date()
  ) {
    return (
      !this.revokedAt &&
      this.expiresAt instanceof Date &&
      !Number.isNaN(
        this.expiresAt.getTime()
      ) &&
      this.expiresAt > now
    );
  };

/**
 * Determine whether the token has expired.
 */
RefreshTokenSchema.methods.isExpired =
  function isExpired(
    now = new Date()
  ) {
    return (
      !this.expiresAt ||
      this.expiresAt <= now
    );
  };

/**
 * Determine whether the token has been rotated.
 */
RefreshTokenSchema.methods.isRotated =
  function isRotated() {
    return (
      this.revokedReason ===
        "rotated" ||
      Boolean(this.replacedBy)
  );
};

/**
 * Determine whether reuse has been detected.
 */
RefreshTokenSchema.methods.hasReuseDetection =
  function hasReuseDetection() {
    return Boolean(
      this.reuseDetectedAt
    );
};

/**
 * Determine whether this token is terminal.
 *
 * Terminal states cannot become active again.
 */
RefreshTokenSchema.methods.isTerminal =
  function isTerminal() {
    return Boolean(
      this.revokedAt ||
      this.replacedBy ||
      this.reuseDetectedAt
    );
  };

/**
 * Revoke this token atomically.
 *
 * Idempotent:
 * If already revoked, the current document is returned.
 */
RefreshTokenSchema.methods.revoke =
  async function revoke(
    reason = "user_revoked"
  ) {
    if (this.revokedAt) {
      return this;
    }

    const now =
      new Date();

    const updated =
      await this.constructor.findOneAndUpdate(
        {
          _id: this._id,
          revokedAt: null,
        },
        {
          $set: {
            revokedAt: now,
            revokedReason:
              normalizeReason(reason),
          },
        },
        {
          new: true,
        }
      );

    return updated || this;
  };

// ============================================================================
// Statics: Token Lookup
// ============================================================================

/**
 * Find a token record by public id.
 */
RefreshTokenSchema.statics.findByPublicId =
  function findByPublicId(
    id
  ) {
    if (
      typeof id !== "string" ||
      !PUBLIC_ID_PATTERN.test(id)
    ) {
      return null;
    }

    return this.findOne({
      id,
    });
  };

/**
 * Find a token by raw refresh token.
 *
 * SECURITY:
 *
 * The raw token is transformed immediately into a SHA-256 digest.
 *
 * The query explicitly selects tokenHash because tokenHash is select:false.
 */
RefreshTokenSchema.statics.findByRawToken =
  function findByRawToken(
    rawToken
  ) {
    if (
      typeof rawToken !== "string" ||
      rawToken.length === 0
    ) {
      return null;
    }

    const tokenHash =
      hashToken(rawToken);

    return this.findOne({
      tokenHash,
    }).select(
      "+tokenHash"
    );
  };

/**
 * Tenant-scoped raw token lookup.
 */
RefreshTokenSchema.statics.findByRawTokenForTenant =
  function findByRawTokenForTenant(
    rawToken,
    tenantId
  ) {
    if (
      typeof rawToken !== "string" ||
      rawToken.length === 0
    ) {
      return null;
    }

    if (
      !isValidObjectId(
        tenantId
      )
    ) {
      return null;
    }

    const tokenHash =
      hashToken(rawToken);

    return this.findOne({
      tokenHash,
      tenantId,
    }).select(
      "+tokenHash"
    );
  };

// ============================================================================
// Statics: Active Sessions
// ============================================================================

/**
 * Find active sessions for a user.
 */
RefreshTokenSchema.statics.findActiveByUser =
  function findActiveByUser(
    userId,
    options = {}
  ) {
    if (
      !isValidObjectId(
        userId
      )
    ) {
      return this.find(
        impossibleQuery()
      );
    }

    const query = {
      userId,
      revokedAt: null,
      expiresAt: {
        $gt: new Date(),
      },
    };

    if (
      options.tenantId !==
      undefined
    ) {
      if (
        !isValidObjectId(
          options.tenantId
        )
      ) {
        return this.find(
          impossibleQuery()
        );
      }

      query.tenantId =
        options.tenantId;
    }

    return this.find(query)
      .sort({
        lastUsedAt: -1,
        createdAt: -1,
      });
  };

/**
 * Find active sessions for a tenant.
 */
RefreshTokenSchema.statics.findActiveByTenant =
  function findActiveByTenant(
    tenantId
  ) {
    if (
      !isValidObjectId(
        tenantId
      )
    ) {
      return this.find(
        impossibleQuery()
      );
    }

    return this.find({
      tenantId,
      revokedAt: null,
      expiresAt: {
        $gt: new Date(),
      },
    }).sort({
      lastUsedAt: -1,
      createdAt: -1,
    });
  };

/**
 * Find active sessions belonging to a token family.
 */
RefreshTokenSchema.statics.findActiveByFamily =
  function findActiveByFamily(
    familyId,
    options = {}
  ) {
    if (
      typeof familyId !== "string" ||
      !TOKEN_FAMILY_PATTERN.test(
        familyId
      )
    ) {
      return this.find(
        impossibleQuery()
      );
    }

    const query = {
      familyId,
      revokedAt: null,
      expiresAt: {
        $gt: new Date(),
      },
    };

    if (
      options.tenantId !==
      undefined
    ) {
      if (
        !isValidObjectId(
          options.tenantId
        )
      ) {
        return this.find(
          impossibleQuery()
        );
      }

      query.tenantId =
        options.tenantId;
    }

    return this.find(query)
      .sort({
        createdAt: -1,
      });
  };

// ============================================================================
// Statics: Atomic Revocation
// ============================================================================

/**
 * Atomically revoke a session by public id.
 */
RefreshTokenSchema.statics.revokeById =
  async function revokeById(
    id,
    reason = "user_revoked"
  ) {
    if (
      typeof id !== "string" ||
      !PUBLIC_ID_PATTERN.test(id)
    ) {
      return null;
    }

    return this.findOneAndUpdate(
      {
        id,
        revokedAt: null,
      },
      {
        $set: {
          revokedAt: new Date(),
          revokedReason:
            normalizeReason(reason),
        },
      },
      {
        new: true,
      }
    );
  };

/**
 * Tenant-scoped atomic revocation.
 */
RefreshTokenSchema.statics.revokeByIdForTenant =
  async function revokeByIdForTenant(
    id,
    tenantId,
    reason = "admin_revoked"
  ) {
    if (
      typeof id !== "string" ||
      !PUBLIC_ID_PATTERN.test(id) ||
      !isValidObjectId(
        tenantId
      )
    ) {
      return null;
    }

    return this.findOneAndUpdate(
      {
        id,
        tenantId,
        revokedAt: null,
      },
      {
        $set: {
          revokedAt: new Date(),
          revokedReason:
            normalizeReason(reason),
        },
      },
      {
        new: true,
      }
    );
  };

/**
 * Revoke all active sessions for a user.
 */
RefreshTokenSchema.statics.revokeAllForUser =
  function revokeAllForUser(
    userId,
    reason = "user_logout_all",
    options = {}
  ) {
    if (
      !isValidObjectId(
        userId
      )
    ) {
      return {
        acknowledged: false,
        matchedCount: 0,
        modifiedCount: 0,
      };
    }

    const query = {
      userId,
      revokedAt: null,
      expiresAt: {
        $gt: new Date(),
      },
    };

    if (
      options.tenantId !==
      undefined
    ) {
      if (
        !isValidObjectId(
          options.tenantId
        )
      ) {
        return {
          acknowledged: false,
          matchedCount: 0,
          modifiedCount: 0,
        };
      }

      query.tenantId =
        options.tenantId;
    }

    return this.updateMany(
      query,
      {
        $set: {
          revokedAt: new Date(),
          revokedReason:
            normalizeReason(reason),
        },
      }
    );
  };

/**
 * Revoke all active tokens in a family.
 *
 * This is the primary persistence operation used after refresh-token reuse
 * detection.
 */
RefreshTokenSchema.statics.revokeFamily =
  function revokeFamily(
    familyId,
    reason = "refresh_token_reuse",
    options = {}
  ) {
    if (
      typeof familyId !== "string" ||
      !TOKEN_FAMILY_PATTERN.test(
        familyId
      )
    ) {
      return {
        acknowledged: false,
        matchedCount: 0,
        modifiedCount: 0,
      };
    }

    const query = {
      familyId,
      revokedAt: null,
    };

    if (
      options.tenantId !==
      undefined
    ) {
      if (
        !isValidObjectId(
          options.tenantId
        )
      ) {
        return {
          acknowledged: false,
          matchedCount: 0,
          modifiedCount: 0,
        };
      }

      query.tenantId =
        options.tenantId;
    }

    return this.updateMany(
      query,
      {
        $set: {
          revokedAt: new Date(),
          revokedReason:
            normalizeReason(reason),
        },
      }
    );
  };

// ============================================================================
// Statics: Atomic Rotation
// ============================================================================

/**
 * Atomically consume an active refresh token.
 *
 * Compare-and-set semantics:
 *
 *   active
 *      |
 *      +---- request A ----> rotated
 *      |
 *      +---- request B ----> rejected
 *
 * MongoDB guarantees that only one update can satisfy:
 *
 *   revokedAt: null
 *   expiresAt: { $gt: now }
 *
 * for the same document.
 *
 * IMPORTANT:
 *
 * This operation consumes the current token. The authentication service must
 * create the replacement token as part of the same MongoDB transaction when
 * transaction support is available.
 */
RefreshTokenSchema.statics.markRotated =
  async function markRotated(
    tokenId,
    replacementId
  ) {
    if (
      typeof tokenId !== "string" ||
      !PUBLIC_ID_PATTERN.test(
        tokenId
      ) ||
      typeof replacementId !==
        "string" ||
      !PUBLIC_ID_PATTERN.test(
        replacementId
      )
    ) {
      throw new TypeError(
        "Valid tokenId and replacementId are required."
      );
    }

    if (
      tokenId === replacementId
    ) {
      throw new TypeError(
        "A token cannot replace itself."
      );
    }

    const now =
      new Date();

    return this.findOneAndUpdate(
      {
        id: tokenId,
        revokedAt: null,
        expiresAt: {
          $gt: now,
        },
      },
      {
        $set: {
          revokedAt: now,
          revokedReason: "rotated",
          replacedBy: replacementId,
          replacedAt: now,
          lastUsedAt: now,
        },
      },
      {
        new: true,
      }
    );
  };

/**
 * Tenant-scoped atomic rotation.
 */
RefreshTokenSchema.statics.markRotatedForTenant =
  async function markRotatedForTenant(
    tokenId,
    replacementId,
    tenantId
  ) {
    if (
      typeof tokenId !== "string" ||
      !PUBLIC_ID_PATTERN.test(
        tokenId
      ) ||
      typeof replacementId !==
        "string" ||
      !PUBLIC_ID_PATTERN.test(
        replacementId
      ) ||
      !isValidObjectId(
        tenantId
      )
    ) {
      throw new TypeError(
        "Valid tokenId, replacementId and tenantId are required."
      );
    }

    if (
      tokenId === replacementId
    ) {
      throw new TypeError(
        "A token cannot replace itself."
      );
    }

    const now =
      new Date();

    return this.findOneAndUpdate(
      {
        id: tokenId,
        tenantId,
        revokedAt: null,
        expiresAt: {
          $gt: now,
        },
      },
      {
        $set: {
          revokedAt: now,
          revokedReason: "rotated",
          replacedBy: replacementId,
          replacedAt: now,
          lastUsedAt: now,
        },
      },
      {
        new: true,
      }
    );
  };

// ============================================================================
// Statics: Reuse Detection
// ============================================================================

/**
 * Record refresh-token reuse.
 *
 * This operation records the incident against the consumed/replayed token.
 *
 * The authentication service should then revoke the complete token family.
 *
 * Example:
 *
 *   await RefreshToken.markReuseDetected(
 *     token.id,
 *     "refresh_token_reuse"
 *   );
 *
 *   await RefreshToken.revokeFamily(
 *     token.familyId,
 *     "refresh_token_reuse"
 *   );
 */
RefreshTokenSchema.statics.markReuseDetected =
  async function markReuseDetected(
    tokenId,
    reason = "refresh_token_reuse"
  ) {
    if (
      typeof tokenId !== "string" ||
      !PUBLIC_ID_PATTERN.test(
        tokenId
      )
    ) {
      return null;
    }

    const now =
      new Date();

    return this.findOneAndUpdate(
      {
        id: tokenId,
        revokedAt: {
          $ne: null,
        },
        reuseDetectedAt: null,
      },
      {
        $set: {
          reuseDetectedAt: now,
          reuseDetectedReason:
            normalizeReason(reason),
        },
      },
      {
        new: true,
      }
    );
  };

/**
 * Atomically record reuse and ensure the token is revoked.
 *
 * This is useful when the service discovers a replayed token that somehow
 * reached a state where revokedAt is not yet set.
 */
RefreshTokenSchema.statics.recordReuseAndRevoke =
  async function recordReuseAndRevoke(
    tokenId,
    reason = "refresh_token_reuse"
  ) {
    if (
      typeof tokenId !== "string" ||
      !PUBLIC_ID_PATTERN.test(
        tokenId
      )
    ) {
      return null;
    }

    const now =
      new Date();

    const normalizedReason =
      normalizeReason(reason);

    return this.findOneAndUpdate(
      {
        id: tokenId,
      },
      {
        $set: {
          revokedAt: now,
          revokedReason:
            normalizedReason,
          reuseDetectedAt: now,
          reuseDetectedReason:
            normalizedReason,
        },
      },
      {
        new: true,
      }
    );
  };

// ============================================================================
// Statics: Session Activity
// ============================================================================

/**
 * Update session activity only if the token remains active.
 */
RefreshTokenSchema.statics.touch =
  function touch(
    tokenId,
    metadata = {}
  ) {
    if (
      typeof tokenId !== "string" ||
      !PUBLIC_ID_PATTERN.test(
        tokenId
      )
    ) {
      return null;
    }

    const update = {
      lastUsedAt: new Date(),
    };

    if (
      metadata.ip !== undefined
    ) {
      update.lastUsedIp =
        normalizeString(
          metadata.ip,
          MAX_IP_LENGTH
        );
    }

    if (
      metadata.userAgent !== undefined
    ) {
      update.lastUsedUserAgent =
        normalizeString(
          metadata.userAgent,
          MAX_USER_AGENT_LENGTH
        );
    }

    return this.findOneAndUpdate(
      {
        id: tokenId,
        revokedAt: null,
        expiresAt: {
          $gt: new Date(),
        },
      },
      {
        $set: update,
      },
      {
        new: true,
      }
    );
  };

/**
 * Tenant-scoped activity update.
 */
RefreshTokenSchema.statics.touchForTenant =
  function touchForTenant(
    tokenId,
    tenantId,
    metadata = {}
  ) {
    if (
      typeof tokenId !== "string" ||
      !PUBLIC_ID_PATTERN.test(
        tokenId
      ) ||
      !isValidObjectId(
        tenantId
      )
    ) {
      return null;
    }

    const update = {
      lastUsedAt: new Date(),
    };

    if (
      metadata.ip !== undefined
    ) {
      update.lastUsedIp =
        normalizeString(
          metadata.ip,
          MAX_IP_LENGTH
        );
    }

    if (
      metadata.userAgent !== undefined
    ) {
      update.lastUsedUserAgent =
        normalizeString(
          metadata.userAgent,
          MAX_USER_AGENT_LENGTH
        );
    }

    return this.findOneAndUpdate(
      {
        id: tokenId,
        tenantId,
        revokedAt: null,
        expiresAt: {
          $gt: new Date(),
        },
      },
      {
        $set: update,
      },
      {
        new: true,
      }
    );
  };

// ============================================================================
// Statics: Device Sessions
// ============================================================================

/**
 * Find active sessions for a specific device.
 */
RefreshTokenSchema.statics.findActiveByDevice =
  function findActiveByDevice(
    userId,
    deviceId,
    options = {}
  ) {
    if (
      !isValidObjectId(
        userId
      ) ||
      !deviceId
    ) {
      return this.find(
        impossibleQuery()
      );
    }

    const query = {
      userId,
      "deviceInfo.deviceId":
        String(deviceId),
      revokedAt: null,
      expiresAt: {
        $gt: new Date(),
      },
    };

    if (
      options.tenantId !==
      undefined
    ) {
      if (
        !isValidObjectId(
          options.tenantId
        )
      ) {
        return this.find(
          impossibleQuery()
        );
      }

      query.tenantId =
        options.tenantId;
    }

    return this.find(query)
      .sort({
        lastUsedAt: -1,
      });
  };

/**
 * Revoke all sessions for a device.
 */
RefreshTokenSchema.statics.revokeDevice =
  function revokeDevice(
    userId,
    deviceId,
    reason = "device_revoked",
    options = {}
  ) {
    if (
      !isValidObjectId(
        userId
      ) ||
      !deviceId
    ) {
      return {
        acknowledged: false,
        matchedCount: 0,
        modifiedCount: 0,
      };
    }

    const query = {
      userId,
      "deviceInfo.deviceId":
        String(deviceId),
      revokedAt: null,
      expiresAt: {
        $gt: new Date(),
      },
    };

    if (
      options.tenantId !==
      undefined
    ) {
      if (
        !isValidObjectId(
          options.tenantId
        )
      ) {
        return {
          acknowledged: false,
          matchedCount: 0,
          modifiedCount: 0,
        };
      }

      query.tenantId =
        options.tenantId;
    }

    return this.updateMany(
      query,
      {
        $set: {
          revokedAt: new Date(),
          revokedReason:
            normalizeReason(reason),
        },
      }
    );
  };

// ============================================================================
// Statics: Account / Tenant Security
// ============================================================================

/**
 * Revoke every session for a tenant.
 *
 * Intended for controlled administrative/security workflows.
 */
RefreshTokenSchema.statics.revokeAllForTenant =
  function revokeAllForTenant(
    tenantId,
    reason = "tenant_disabled"
  ) {
    if (
      !isValidObjectId(
        tenantId
      )
    ) {
      return {
        acknowledged: false,
        matchedCount: 0,
        modifiedCount: 0,
      };
    }

    return this.updateMany(
      {
        tenantId,
        revokedAt: null,
      },
      {
        $set: {
          revokedAt: new Date(),
          revokedReason:
            normalizeReason(reason),
        },
      }
    );
  };

/**
 * Revoke every session for a user, including already-expiring sessions.
 *
 * Unlike revokeAllForUser(), this intentionally does not require expiresAt
 * to be in the future. It is useful for account-security events where every
 * persisted session record should be transitioned to revoked state.
 */
RefreshTokenSchema.statics.revokeEverySessionForUser =
  function revokeEverySessionForUser(
    userId,
    reason = "security_revoked",
    options = {}
  ) {
    if (
      !isValidObjectId(
        userId
      )
    ) {
      return {
        acknowledged: false,
        matchedCount: 0,
        modifiedCount: 0,
      };
    }

    const query = {
      userId,
      revokedAt: null,
    };

    if (
      options.tenantId !==
      undefined
    ) {
      if (
        !isValidObjectId(
          options.tenantId
        )
      ) {
        return {
          acknowledged: false,
          matchedCount: 0,
          modifiedCount: 0,
        };
      }

      query.tenantId =
        options.tenantId;
    }

    return this.updateMany(
      query,
      {
        $set: {
          revokedAt: new Date(),
          revokedReason:
            normalizeReason(reason),
        },
      }
    );
  };

// ============================================================================
// Statics: Housekeeping
// ============================================================================

/**
 * Explicitly purge expired records.
 *
 * MongoDB TTL remains the primary automatic cleanup mechanism.
 *
 * Authentication must NEVER depend on TTL deletion.
 */
RefreshTokenSchema.statics.purgeExpired =
  function purgeExpired(
    before = new Date()
  ) {
    const normalized =
      normalizeDate(before) ||
      new Date();

    return this.deleteMany({
      expiresAt: {
        $lt: normalized,
      },
    });
  };

/**
 * Backwards-compatible cleanup method.
 *
 * Only expired + revoked records are removed.
 */
RefreshTokenSchema.statics.purgeExpiredRevoked =
  function purgeExpiredRevoked(
    before = new Date()
  ) {
    const normalized =
      normalizeDate(before) ||
      new Date();

    return this.deleteMany({
      expiresAt: {
        $lt: normalized,
      },
      revokedAt: {
        $ne: null,
      },
    });
  };

// ============================================================================
// Security Helpers
// ============================================================================

RefreshTokenSchema.statics.hashToken =
  hashToken;

RefreshTokenSchema.statics.hashesEqual =
  hashesEqual;

RefreshTokenSchema.statics.generatePublicId =
  generatePublicId;

RefreshTokenSchema.statics.generateTokenFamilyId =
  generateTokenFamilyId;

// Expose immutable constants to internal services/tests without exposing
// secrets or mutable configuration.
RefreshTokenSchema.statics.REVOCATION_REASONS =
  REVOCATION_REASONS;

RefreshTokenSchema.statics.ISSUED_BY_VALUES =
  ISSUED_BY_VALUES;

// ============================================================================
// Model
// ============================================================================

module.exports =
  mongoose.models.RefreshToken ||
  mongoose.model(
    "RefreshToken",
    RefreshTokenSchema
  );