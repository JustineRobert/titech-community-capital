/**
 * backend/models/PasswordResetToken.js
 * TITech Community Capital — Password Reset Token Model
 *
 * Architectural role:
 * - Persists short-lived, single-use password-reset token state.
 * - Stores only a cryptographic digest of the plaintext reset token.
 * - Provides controlled lookup, atomic consumption, revocation, and
 *   retention-oriented lifecycle operations.
 *
 * Important boundaries:
 * - The plaintext reset token MUST NEVER be persisted.
 * - Cryptographically secure token generation belongs to the service layer.
 * - Token hashing belongs to the service layer.
 * - Password changes themselves belong to the authentication/account service.
 * - Email/SMS delivery belongs to the notification/messaging service.
 * - Rate limiting, brute-force protection, account lockout, and identity
 *   verification belong to the authentication/security service.
 * - Tenant authorization remains a service/repository responsibility.
 * - This model is not a session, refresh-token, API-key, or generic credential
 *   store.
 *
 * Security principles:
 * - Native ESM only.
 * - Only SHA-256/HMAC-derived 64-character hexadecimal digests are persisted.
 * - tokenHash is select:false and excluded from serialization.
 * - Expiration is checked at application level in addition to MongoDB TTL.
 * - Consumption is atomic and single-use.
 * - Revocation is monotonic.
 * - Generic destructive/mutation queries are blocked.
 * - Network/device context is stored only as application-generated hashes.
 * - Metadata is bounded and credential-like keys are redacted.
 * - Optimistic concurrency is enabled.
 *
 * Module format:
 * - Native ECMAScript Modules (ESM)
 *
 * Persistence:
 * - MongoDB collection: password_reset_tokens
 *
 * Compatibility note:
 * - tenantId is represented as String to match the newer TITech tenancy
 *   boundary. Existing installations using Tenant ObjectIds require an
 *   explicit data migration before adopting this schema.
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

/* ==========================================================================
 * Constants
 * ========================================================================== */

export const PASSWORD_RESET_PURPOSE =
  'password_reset';

export const TOKEN_HASH_LENGTH = 64;

export const TOKEN_HASH_PATTERN =
  /^[a-f0-9]{64}$/;

export const METADATA_MAX_KEYS = 50;
export const METADATA_MAX_DEPTH = 4;
export const METADATA_MAX_ARRAY_LENGTH = 50;
export const METADATA_MAX_SERIALIZED_BYTES = 8 * 1024;

const MAX_TENANT_ID_LENGTH = 128;
const MAX_FINGERPRINT_LENGTH = 256;
const MAX_REQUEST_ID_LENGTH = 256;
const MAX_REASON_LENGTH = 256;

const FORBIDDEN_METADATA_KEY_PATTERN =
  /^(password|passwd|passcode|token|accesstoken|access_token|refreshtoken|refresh_token|idtoken|id_token|authorization|cookie|set-cookie|secret|secretkey|clientsecret|privatekey|otp|totp|pin|apikey|api_key|credential|credentials)$/i;

/* ==========================================================================
 * Validation helpers
 * ========================================================================== */

function isPlainObject(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return (
    prototype === Object.prototype ||
    prototype === null
  );
}

function containsForbiddenMetadataKey(
  value,
  depth = 0,
) {
  if (depth > METADATA_MAX_DEPTH) {
    return true;
  }

  if (Array.isArray(value)) {
    if (
      value.length >
      METADATA_MAX_ARRAY_LENGTH
    ) {
      return true;
    }

    return value.some((item) =>
      containsForbiddenMetadataKey(
        item,
        depth + 1,
      ),
    );
  }

  if (!isPlainObject(value)) {
    return false;
  }

  const keys = Object.keys(value);

  if (keys.length > METADATA_MAX_KEYS) {
    return true;
  }

  return Object.entries(value).some(
    ([key, childValue]) => {
      if (
        FORBIDDEN_METADATA_KEY_PATTERN.test(
          key,
        )
      ) {
        return true;
      }

      return containsForbiddenMetadataKey(
        childValue,
        depth + 1,
      );
    },
  );
}

function sanitizeMetadata(
  value,
  depth = 0,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return {};
  }

  if (depth > METADATA_MAX_DEPTH) {
    return '[TRUNCATED]';
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, METADATA_MAX_ARRAY_LENGTH)
      .map((item) =>
        sanitizeMetadata(
          item,
          depth + 1,
        ),
      );
  }

  if (isPlainObject(value)) {
    const output = {};
    const entries = Object.entries(value)
      .slice(0, METADATA_MAX_KEYS);

    for (const [key, childValue] of entries) {
      if (
        FORBIDDEN_METADATA_KEY_PATTERN.test(
          key,
        )
      ) {
        output[key] = '[REDACTED]';
      } else {
        output[key] = sanitizeMetadata(
          childValue,
          depth + 1,
        );
      }
    }

    if (
      Object.keys(value).length >
      METADATA_MAX_KEYS
    ) {
      output._truncatedKeys = true;
    }

    return output;
  }

  return `[UNSERIALIZABLE:${typeof value}]`;
}

function validateMetadata(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return true;
  }

  if (!isPlainObject(value)) {
    return false;
  }

  if (
    Object.keys(value).length >
    METADATA_MAX_KEYS
  ) {
    return false;
  }

  if (
    containsForbiddenMetadataKey(value)
  ) {
    return false;
  }

  try {
    const serialized =
      JSON.stringify(value);

    if (!serialized) {
      return true;
    }

    return (
      Buffer.byteLength(
        serialized,
        'utf8',
      ) <= METADATA_MAX_SERIALIZED_BYTES
    );
  } catch {
    return false;
  }
}

function normalizeTenantId(value) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return null;
  }

  const normalized =
    String(value).trim();

  if (!normalized) {
    return null;
  }

  return normalized.slice(
    0,
    MAX_TENANT_ID_LENGTH,
  );
}

function normalizeHash(value) {
  if (
    typeof value !== 'string'
  ) {
    throw new TypeError(
      'tokenHash must be a string.',
    );
  }

  const normalized =
    value.trim().toLowerCase();

  if (
    !TOKEN_HASH_PATTERN.test(
      normalized,
    )
  ) {
    throw new TypeError(
      'tokenHash must be a 64-character lowercase hexadecimal digest.',
    );
  }

  return normalized;
}

function normalizeNullableString(
  value,
  maxLength,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const normalized =
    String(value).trim();

  if (!normalized) {
    return null;
  }

  return normalized.slice(
    0,
    maxLength,
  );
}

function normalizeDate(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return new Date();
  }

  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    throw new TypeError(
      'Invalid date.',
    );
  }

  return date;
}

function normalizeAuditFingerprint(
  value,
) {
  return normalizeNullableString(
    value,
    MAX_FINGERPRINT_LENGTH,
  );
}

function isExpiredDate(
  expiresAt,
) {
  return (
    !(expiresAt instanceof Date) ||
    expiresAt.getTime() <= Date.now()
  );
}

/* ==========================================================================
 * Schema
 * ========================================================================== */

const PasswordResetTokenSchema =
  new Schema(
    {
      /*
       * ----------------------------------------------------------------------
       * User
       * ----------------------------------------------------------------------
       */

      user: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        immutable: true,
        index: true,
      },

      /*
       * ----------------------------------------------------------------------
       * Tenant
       * ----------------------------------------------------------------------
       */

      tenantId: {
        type: String,
        default: null,
        immutable: true,
        trim: true,
        maxlength: MAX_TENANT_ID_LENGTH,
        index: true,
      },

      /*
       * ----------------------------------------------------------------------
       * Purpose
       * ----------------------------------------------------------------------
       */

      purpose: {
        type: String,
        enum: [PASSWORD_RESET_PURPOSE],
        required: true,
        immutable: true,
        default: PASSWORD_RESET_PURPOSE,
        index: true,
      },

      /*
       * ----------------------------------------------------------------------
       * Cryptographic token digest
       * ----------------------------------------------------------------------
       *
       * NEVER persist the plaintext reset token.
       */

      tokenHash: {
        type: String,
        required: true,
        immutable: true,
        trim: true,
        lowercase: true,
        minlength: TOKEN_HASH_LENGTH,
        maxlength: TOKEN_HASH_LENGTH,
        match: [
          TOKEN_HASH_PATTERN,
          'tokenHash must be a 64-character hexadecimal digest.',
        ],
        unique: true,
        index: true,
        select: false,
      },

      /*
       * ----------------------------------------------------------------------
       * Expiration / TTL
       * ----------------------------------------------------------------------
       *
       * MongoDB TTL is cleanup only. Application-level expiration checks
       * remain mandatory.
       */

      expiresAt: {
        type: Date,
        required: true,
        immutable: true,
        index: true,
      },

      /*
       * ----------------------------------------------------------------------
       * Consumption state
       * ----------------------------------------------------------------------
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

      /*
       * ----------------------------------------------------------------------
       * Consumption context
       * ----------------------------------------------------------------------
       *
       * These fields are privacy-preserving hashes/fingerprints generated by
       * the authentication/security service.
       */

      consumedIpHash: {
        type: String,
        default: null,
        trim: true,
        maxlength: MAX_FINGERPRINT_LENGTH,
        select: false,
      },

      consumedUserAgentHash: {
        type: String,
        default: null,
        trim: true,
        maxlength: MAX_FINGERPRINT_LENGTH,
        select: false,
      },

      consumedDeviceIdHash: {
        type: String,
        default: null,
        trim: true,
        maxlength: MAX_FINGERPRINT_LENGTH,
        select: false,
      },

      consumedRequestId: {
        type: String,
        default: null,
        trim: true,
        maxlength: MAX_REQUEST_ID_LENGTH,
      },

      /*
       * ----------------------------------------------------------------------
       * Revocation
       * ----------------------------------------------------------------------
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
        default: null,
        trim: true,
        maxlength: MAX_REASON_LENGTH,
      },

      /*
       * ----------------------------------------------------------------------
       * Request context
       * ----------------------------------------------------------------------
       */

      requestIpHash: {
        type: String,
        default: null,
        trim: true,
        maxlength: MAX_FINGERPRINT_LENGTH,
        select: false,
      },

      requestUserAgentHash: {
        type: String,
        default: null,
        trim: true,
        maxlength: MAX_FINGERPRINT_LENGTH,
        select: false,
      },

      requestId: {
        type: String,
        default: null,
        trim: true,
        maxlength: MAX_REQUEST_ID_LENGTH,
        index: true,
      },

      /*
       * ----------------------------------------------------------------------
       * Metadata
       * ----------------------------------------------------------------------
       */

      metadata: {
        type: Schema.Types.Mixed,
        default: undefined,
        select: false,
        validate: {
          validator: validateMetadata,
          message:
            'metadata contains an invalid structure, forbidden secret-like keys, or exceeds security limits.',
        },
      },

      /*
       * ----------------------------------------------------------------------
       * Administrative soft-delete state
       * ----------------------------------------------------------------------
       *
       * This is separate from TTL expiration. TTL is physical retention
       * cleanup; isDeleted is an application lifecycle state.
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
        default: null,
        trim: true,
        maxlength: MAX_REASON_LENGTH,
      },
    },
    {
      timestamps: true,

      optimisticConcurrency: true,

      versionKey: '__v',

      minimize: true,

      strict: 'throw',

      collection:
        'password_reset_tokens',

      toJSON: {
        virtuals: true,
        versionKey: false,

        transform(doc, ret) {
          ret.id =
            ret._id.toString();

          delete ret._id;
          delete ret.__v;

          delete ret.tokenHash;

          delete ret.requestIpHash;
          delete ret.requestUserAgentHash;

          delete ret.consumedIpHash;
          delete ret.consumedUserAgentHash;
          delete ret.consumedDeviceIdHash;

          delete ret.metadata;

          return ret;
        },
      },

      toObject: {
        virtuals: true,
        versionKey: false,

        transform(doc, ret) {
          ret.id =
            ret._id.toString();

          delete ret._id;
          delete ret.__v;

          return ret;
        },
      },
    },
  );

/* ==========================================================================
 * Indexes
 * ========================================================================== */

/**
 * The unique tokenHash index prevents duplicate persisted digests.
 */
PasswordResetTokenSchema.index(
  {
    tokenHash: 1,
  },
  {
    unique: true,
    name: 'password_reset_token_hash_unique',
  },
);

/**
 * Active-token lookup by tenant/user.
 */
PasswordResetTokenSchema.index({
  tenantId: 1,
  user: 1,
  used: 1,
  revoked: 1,
  isDeleted: 1,
  expiresAt: 1,
});

/**
 * User security/revocation investigation.
 */
PasswordResetTokenSchema.index({
  tenantId: 1,
  user: 1,
  createdAt: -1,
});

/**
 * Request tracing.
 */
PasswordResetTokenSchema.index({
  tenantId: 1,
  requestId: 1,
  createdAt: -1,
});

/**
 * Revocation history.
 */
PasswordResetTokenSchema.index({
  tenantId: 1,
  revoked: 1,
  revokedAt: -1,
});

/**
 * Consumption history.
 */
PasswordResetTokenSchema.index({
  tenantId: 1,
  used: 1,
  usedAt: -1,
});

/**
 * Expiration operations.
 */
PasswordResetTokenSchema.index({
  tenantId: 1,
  expiresAt: 1,
});

/**
 * IMPORTANT:
 *
 * Do not attach expires: 0 to expiresAt in the field definition unless
 * automatic physical deletion has been explicitly approved for the
 * organization's authentication-token retention policy.
 *
 * TTL deletion is asynchronous and must never be treated as application
 * authorization.
 */

/* ==========================================================================
 * Virtuals
 * ========================================================================== */

PasswordResetTokenSchema.virtual(
  'id',
).get(function getId() {
  return this._id.toString();
});

/* ==========================================================================
 * Instance lifecycle methods
 * ========================================================================== */

PasswordResetTokenSchema.methods.isExpired =
  function isExpired() {
    return isExpiredDate(
      this.expiresAt,
    );
  };

PasswordResetTokenSchema.methods.isUsable =
  function isUsable() {
    return (
      this.used === false &&
      this.revoked === false &&
      this.isDeleted === false &&
      !this.isExpired()
    );
  };

/**
 * Non-atomic convenience method.
 *
 * Production password-reset consumption should use consumeAtomically().
 */
PasswordResetTokenSchema.methods.markUsed =
  async function markUsed({
    ipHash = null,
    userAgentHash = null,
    deviceIdHash = null,
    requestId = null,
  } = {}) {
    if (this.used) {
      throw new Error(
        'Password reset token has already been used.',
      );
    }

    if (this.revoked) {
      throw new Error(
        'Password reset token has been revoked.',
      );
    }

    if (this.isDeleted) {
      throw new Error(
        'Password reset token is no longer active.',
      );
    }

    if (this.isExpired()) {
      throw new Error(
        'Password reset token has expired.',
      );
    }

    const now = new Date();

    this.used = true;
    this.usedAt = now;

    this.consumedIpHash =
      normalizeAuditFingerprint(
        ipHash,
      );

    this.consumedUserAgentHash =
      normalizeAuditFingerprint(
        userAgentHash,
      );

    this.consumedDeviceIdHash =
      normalizeAuditFingerprint(
        deviceIdHash,
      );

    this.consumedRequestId =
      normalizeNullableString(
        requestId,
        MAX_REQUEST_ID_LENGTH,
      );

    await this.save();

    return this;
  };

PasswordResetTokenSchema.methods.revoke =
  async function revoke(
    reason = 'revoked',
  ) {
    if (this.used) {
      throw new Error(
        'A used password reset token cannot be revoked as an active token.',
      );
    }

    if (!this.revoked) {
      this.revoked = true;
      this.revokedAt = new Date();
      this.revocationReason =
        normalizeNullableString(
          reason,
          MAX_REASON_LENGTH,
        ) ?? 'revoked';

      await this.save();
    }

    return this;
  };

PasswordResetTokenSchema.methods.softDelete =
  async function softDelete(
    reason = 'deleted',
  ) {
    if (!this.isDeleted) {
      this.isDeleted = true;
      this.deletedAt = new Date();
      this.deleteReason =
        normalizeNullableString(
          reason,
          MAX_REASON_LENGTH,
        ) ?? 'deleted';

      await this.save();
    }

    return this;
  };

/* ==========================================================================
 * Static lookup methods
 * ========================================================================== */

/**
 * Find a currently usable token by cryptographic digest.
 *
 * The tokenHash remains excluded from the returned projection.
 */
PasswordResetTokenSchema.statics.findActiveByHash =
  function findActiveByHash(
    tokenHash,
    {
      tenantId = undefined,
      userId = undefined,
      session = undefined,
    } = {},
  ) {
    let normalizedHash;

    try {
      normalizedHash =
        normalizeHash(tokenHash);
    } catch {
      return null;
    }

    const filter = {
      purpose:
        PASSWORD_RESET_PURPOSE,

      tokenHash:
        normalizedHash,

      used: false,
      revoked: false,
      isDeleted: false,

      expiresAt: {
        $gt: new Date(),
      },
    };

    if (
      tenantId !== undefined &&
      tenantId !== null
    ) {
      filter.tenantId =
        normalizeTenantId(
          tenantId,
        );
    }

    if (userId !== undefined) {
      filter.user =
        userId;
    }

    let query =
      this.findOne(filter);

    if (session) {
      query = query.session(
        session,
      );
    }

    return query;
  };

/**
 * Find active reset tokens for a user.
 */
PasswordResetTokenSchema.statics.findActiveForUser =
  function findActiveForUser(
    userId,
    {
      tenantId = undefined,
      session = undefined,
    } = {},
  ) {
    const filter = {
      user: userId,

      purpose:
        PASSWORD_RESET_PURPOSE,

      used: false,
      revoked: false,
      isDeleted: false,

      expiresAt: {
        $gt: new Date(),
      },
    };

    if (
      tenantId !== undefined &&
      tenantId !== null
    ) {
      filter.tenantId =
        normalizeTenantId(
          tenantId,
        );
    }

    let query =
      this.find(filter)
        .sort({
          createdAt: -1,
          _id: -1,
        });

    if (session) {
      query = query.session(
        session,
      );
    }

    return query;
  };

/**
 * Atomically consume exactly one reset token.
 *
 * This is the preferred production operation.
 *
 * The filter requires:
 * - correct token purpose
 * - unused
 * - not revoked
 * - not deleted
 * - not expired
 *
 * Therefore concurrent requests cannot both consume the same token.
 */
PasswordResetTokenSchema.statics.consumeAtomically =
  async function consumeAtomically(
    tokenHash,
    {
      tenantId = undefined,
      userId = undefined,
      ipHash = null,
      userAgentHash = null,
      deviceIdHash = null,
      requestId = null,
      session = undefined,
    } = {},
  ) {
    let normalizedHash;

    try {
      normalizedHash =
        normalizeHash(tokenHash);
    } catch {
      return null;
    }

    const now = new Date();

    const filter = {
      purpose:
        PASSWORD_RESET_PURPOSE,

      tokenHash:
        normalizedHash,

      used: false,
      revoked: false,
      isDeleted: false,

      expiresAt: {
        $gt: now,
      },
    };

    if (
      tenantId !== undefined &&
      tenantId !== null
    ) {
      filter.tenantId =
        normalizeTenantId(
          tenantId,
        );
    }

    if (userId !== undefined) {
      filter.user =
        userId;
    }

    const update = {
      $set: {
        used: true,
        usedAt: now,

        consumedIpHash:
          normalizeAuditFingerprint(
            ipHash,
          ),

        consumedUserAgentHash:
          normalizeAuditFingerprint(
            userAgentHash,
          ),

        consumedDeviceIdHash:
          normalizeAuditFingerprint(
            deviceIdHash,
          ),

        consumedRequestId:
          normalizeNullableString(
            requestId,
            MAX_REQUEST_ID_LENGTH,
          ),
      },
    };

    let query =
      this.findOneAndUpdate(
        filter,
        update,
        {
          new: true,
          runValidators: true,
          returnDocument: 'after',

          /**
           * Internal controlled mutation.
           */
          allowPasswordResetTokenMutation:
            true,

          ...(session
            ? { session }
            : {}),
        },
      );

    /**
     * Explicitly exclude tokenHash even though the filter necessarily uses it.
     */
    query = query.select(
      '-tokenHash',
    );

    return query.exec();
  };

/**
 * Revoke all active reset tokens for a user.
 *
 * Typical callers:
 * - a new password reset is issued;
 * - the password changes;
 * - suspicious authentication activity is detected;
 * - account security state changes.
 */
PasswordResetTokenSchema.statics.revokeActiveForUser =
  async function revokeActiveForUser(
    userId,
    {
      tenantId = undefined,
      reason = 'superseded',
      session = undefined,
    } = {},
  ) {
    const filter = {
      user: userId,

      purpose:
        PASSWORD_RESET_PURPOSE,

      used: false,
      revoked: false,
      isDeleted: false,

      expiresAt: {
        $gt: new Date(),
      },
    };

    if (
      tenantId !== undefined &&
      tenantId !== null
    ) {
      filter.tenantId =
        normalizeTenantId(
          tenantId,
        );
    }

    const update = {
      $set: {
        revoked: true,
        revokedAt: new Date(),

        revocationReason:
          normalizeNullableString(
            reason,
            MAX_REASON_LENGTH,
          ) ?? 'superseded',
      },
    };

    const query =
      this.updateMany(
        filter,
        update,
        {
          runValidators: true,

          /**
           * Internal controlled mutation.
           */
          allowPasswordResetTokenMutation:
            true,

          ...(session
            ? { session }
            : {}),
        },
      );

    return query.exec();
  };

/**
 * Revoke all active reset tokens for a tenant.
 */
PasswordResetTokenSchema.statics.revokeActiveForTenant =
  async function revokeActiveForTenant(
    tenantId,
    {
      reason = 'tenant_security_event',
      session = undefined,
    } = {},
  ) {
    const normalizedTenantId =
      normalizeTenantId(
        tenantId,
      );

    if (!normalizedTenantId) {
      throw new TypeError(
        'tenantId is required.',
      );
    }

    const update = {
      $set: {
        revoked: true,
        revokedAt: new Date(),

        revocationReason:
          normalizeNullableString(
            reason,
            MAX_REASON_LENGTH,
          ) ??
          'tenant_security_event',
      },
    };

    const query =
      this.updateMany(
        {
          tenantId:
            normalizedTenantId,

          purpose:
            PASSWORD_RESET_PURPOSE,

          used: false,
          revoked: false,
          isDeleted: false,

          expiresAt: {
            $gt: new Date(),
          },
        },
        update,
        {
          runValidators: true,

          allowPasswordResetTokenMutation:
            true,

          ...(session
            ? { session }
            : {}),
        },
      );

    return query.exec();
  };

/* ==========================================================================
 * Controlled maintenance
 * ========================================================================== */

/**
 * Administrative cleanup helper for already-expired records when TTL has
 * not yet physically removed them.
 *
 * This is intentionally separate from normal authentication operations.
 */
PasswordResetTokenSchema.statics.findExpired =
  function findExpired({
    tenantId = undefined,
    session = undefined,
  } = {}) {
    const filter = {
      purpose:
        PASSWORD_RESET_PURPOSE,

      expiresAt: {
        $lte: new Date(),
      },
    };

    if (
      tenantId !== undefined &&
      tenantId !== null
    ) {
      filter.tenantId =
        normalizeTenantId(
          tenantId,
        );
    }

    let query =
      this.find(filter).sort({
        expiresAt: 1,
        _id: 1,
      });

    if (session) {
      query = query.session(
        session,
      );
    }

    return query;
  };

/* ==========================================================================
 * Validation middleware
 * ========================================================================== */

PasswordResetTokenSchema.pre(
  'validate',
  function validatePasswordResetToken(
    next,
  ) {
    try {
      if (
        !mongoose.isValidObjectId(
          this.user,
        )
      ) {
        this.invalidate(
          'user',
          'user must be a valid ObjectId.',
        );
      }

      if (this.tenantId !== null) {
        const normalizedTenantId =
          normalizeTenantId(
            this.tenantId,
          );

        if (!normalizedTenantId) {
          this.invalidate(
            'tenantId',
            'tenantId must be a valid non-empty identifier.',
          );
        } else {
          this.tenantId =
            normalizedTenantId;
        }
      }

      if (
        this.purpose !==
        PASSWORD_RESET_PURPOSE
      ) {
        this.invalidate(
          'purpose',
          'Invalid password-reset token purpose.',
        );
      }

      if (
        this.used &&
        !this.usedAt
      ) {
        this.usedAt =
          new Date();
      }

      if (
        !this.used &&
        this.usedAt
      ) {
        this.invalidate(
          'usedAt',
          'usedAt must be null while the token is unused.',
        );
      }

      if (
        this.revoked &&
        !this.revokedAt
      ) {
        this.revokedAt =
          new Date();
      }

      if (
        !this.revoked &&
        this.revokedAt
      ) {
        this.invalidate(
          'revokedAt',
          'revokedAt must be null while the token is not revoked.',
        );
      }

      if (
        this.isDeleted &&
        !this.deletedAt
      ) {
        this.deletedAt =
          new Date();
      }

      if (
        !this.isDeleted &&
        this.deletedAt
      ) {
        this.invalidate(
          'deletedAt',
          'deletedAt must be null while the token is not deleted.',
        );
      }

      if (
        this.used &&
        this.revoked
      ) {
        /**
         * A previously used token may later be administratively revoked.
         * Do not reject this state because it is useful for security history.
         */
      }

      next();
    } catch (error) {
      next(error);
    }
  },
);

/* ==========================================================================
 * Mutation protection
 * ========================================================================== */

/**
 * Hard deletion is not exposed through normal application operations.
 *
 * MongoDB TTL/approved retention infrastructure remains responsible for
 * physical lifecycle cleanup.
 */
PasswordResetTokenSchema.pre(
  [
    'deleteOne',
    'deleteMany',
    'findOneAndDelete',
    'findByIdAndDelete',
  ],
  function preventHardDelete(
    next,
  ) {
    next(
      new mongoose.Error.MongooseError(
        'PasswordResetToken hard deletion is disabled.',
      ),
    );
  },
);

/**
 * Prevent generic updates from bypassing:
 * - single-use guarantees;
 * - revocation state;
 * - expiry checks;
 * - tenant boundaries;
 * - immutable token identity.
 */
PasswordResetTokenSchema.pre(
  [
    'updateOne',
    'updateMany',
    'findOneAndUpdate',
    'findByIdAndUpdate',
    'replaceOne',
  ],
  function preventGenericMutation(
    next,
  ) {
    const options =
      this.getOptions();

    if (
      options.allowPasswordResetTokenMutation ===
      true
    ) {
      return next();
    }

    next(
      new mongoose.Error.MongooseError(
        'Generic PasswordResetToken mutations are disabled. Use controlled lifecycle methods.',
      ),
    );
  },
);

PasswordResetTokenSchema.pre(
  'bulkWrite',
  function preventBulkWrite(
    next,
  ) {
    next(
      new mongoose.Error.MongooseError(
        'bulkWrite is disabled for PasswordResetToken.',
      ),
    );
  },
);

/* ==========================================================================
 * Model export
 * ========================================================================== */

const PasswordResetToken =
  mongoose.models.PasswordResetToken ||
  mongoose.model(
    'PasswordResetToken',
    PasswordResetTokenSchema,
  );

export default PasswordResetToken;

export {
  PasswordResetTokenSchema,
  sanitizeMetadata,
  validateMetadata,
};