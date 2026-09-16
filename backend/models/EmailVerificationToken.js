// ============================================================================
// backend/models/EmailVerificationToken.js
// TITech Community Capital LTD
// Enterprise Email Verification Token Model
// ============================================================================
//
// Purpose
//   Durable record of email-verification challenges.
//
// Security model
//   - Store ONLY a cryptographic hash of the verification token.
//   - Never persist the raw token.
//   - Token consumption is atomic.
//   - Used tokens cannot be reused.
//   - Expiration is enforced by application logic.
//   - MongoDB TTL is retention cleanup only.
//   - Tenant isolation is explicit.
//   - Generic JSON serialization does not expose tokenHash.
//
// Recommended flow
//
//   random token
//        │
//        ├── send raw token to email
//        │
//        └── hash token
//              │
//              ▼
//       EmailVerificationToken
//
// Verification:
//
//   hash(submittedToken)
//            │
//            ▼
//       find + atomically consume
//            │
//       ┌────┴────┐
//       │         │
//    success    reject
//
// Module format
//   ESM.
//
// ============================================================================

import mongoose from 'mongoose';

const { Schema } = mongoose;

// =============================================================================
// Constants
// =============================================================================

const MAX_TOKEN_HASH_LENGTH = 128;
const MAX_IP_ADDRESS_LENGTH = 128;
const MAX_METADATA_KEYS = 30;
const MAX_METADATA_BYTES = 16 * 1024;

const TOKEN_STATUSES = Object.freeze([
  'ACTIVE',
  'USED',
  'REVOKED',
]);

// =============================================================================
// Helpers
// =============================================================================

function normalizeRequiredString(
  value,
  fieldName,
  maxLength
) {
  if (typeof value !== 'string') {
    throw new TypeError(
      `${fieldName} must be a string.`
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new Error(
      `${fieldName} is required.`
    );
  }

  if (normalized.length > maxLength) {
    throw new RangeError(
      `${fieldName} exceeds maximum length of ${maxLength}.`
    );
  }

  return normalized;
}

function estimateBytes(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return 0;
  }

  try {
    return Buffer.byteLength(
      JSON.stringify(value),
      'utf8'
    );
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

// =============================================================================
// Metadata schema
// =============================================================================

const metadataSchema = new Schema(
  {
    userAgent: {
      type: String,
      trim: true,
      maxlength: 1000,
    },

    requestId: {
      type: String,
      trim: true,
      maxlength: 128,
    },

    correlationId: {
      type: String,
      trim: true,
      maxlength: 128,
    },

    /**
     * Provider/message reference only.
     * Never store the email contents or authentication secrets here.
     */
    providerReference: {
      type: String,
      trim: true,
      maxlength: 256,
    },

    extra: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
  },
  {
    _id: false,
    id: false,
    strict: true,
    minimize: false,
  }
);

// =============================================================================
// Schema
// =============================================================================

const emailVerificationTokenSchema = new Schema(
  {
    // -------------------------------------------------------------------------
    // Tenant
    // -------------------------------------------------------------------------

    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      immutable: true,
      index: true,
    },

    // -------------------------------------------------------------------------
    // User
    // -------------------------------------------------------------------------

    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
      index: true,
    },

    // -------------------------------------------------------------------------
    // Secret representation
    // -------------------------------------------------------------------------

    /**
     * Only the hash is persisted.
     *
     * The raw verification token must never be stored in MongoDB.
     */
    tokenHash: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      minlength: 32,
      maxlength: MAX_TOKEN_HASH_LENGTH,
      select: false,
    },

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    status: {
      type: String,
      required: true,
      enum: TOKEN_STATUSES,
      default: 'ACTIVE',
      uppercase: true,
      trim: true,
      index: true,
    },

    expiresAt: {
      type: Date,
      required: true,
      immutable: true,
      index: true,
    },

    usedAt: {
      type: Date,
      default: null,
    },

    revokedAt: {
      type: Date,
      default: null,
    },

    revokedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    // -------------------------------------------------------------------------
    // Request context
    // -------------------------------------------------------------------------

    requestIp: {
      type: String,
      trim: true,
      maxlength: MAX_IP_ADDRESS_LENGTH,
    },

    metadata: {
      type: metadataSchema,
      default: undefined,
    },

    // -------------------------------------------------------------------------
    // Operational timestamps
    // -------------------------------------------------------------------------

    createdAt: {
      type: Date,
      required: true,
      default: Date.now,
      immutable: true,
    },

    updatedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    timestamps: true,

    /**
     * Versioning is useful for administrative lifecycle changes.
     */
    versionKey: '__v',

    strict: true,
    strictQuery: true,
    minimize: false,

    collection: 'email_verification_tokens',

    toJSON: {
      transform(doc, ret) {
        ret.id = ret._id?.toString();

        delete ret._id;
        delete ret.__v;

        /**
         * Never expose a token hash through ordinary API serialization.
         */
        delete ret.tokenHash;

        return ret;
      },
    },
  }
);

// =============================================================================
// Indexes
// =============================================================================

/**
 * One hash should not be accepted twice for the same tenant/user.
 */
emailVerificationTokenSchema.index(
  {
    tenantId: 1,
    user: 1,
    tokenHash: 1,
  },
  {
    unique: true,
    name: 'uq_email_token_tenant_user_hash',
  }
);

/**
 * Fast active-token lookup.
 */
emailVerificationTokenSchema.index(
  {
    tenantId: 1,
    user: 1,
    status: 1,
    expiresAt: 1,
  },
  {
    name: 'idx_email_token_tenant_user_status_expiry',
  }
);

/**
 * Operational cleanup/revocation queries.
 */
emailVerificationTokenSchema.index(
  {
    tenantId: 1,
    user: 1,
    createdAt: -1,
  },
  {
    name: 'idx_email_token_tenant_user_created',
  }
);

/**
 * TTL cleanup.
 *
 * Application logic MUST check expiresAt explicitly before accepting the token.
 */
emailVerificationTokenSchema.index(
  {
    expiresAt: 1,
  },
  {
    expireAfterSeconds: 0,
    name: 'ttl_email_verification_expires',
  }
);

// =============================================================================
// Validation
// =============================================================================

emailVerificationTokenSchema.pre(
  'validate',
  function validateEmailToken(next) {
    try {
      if (!this.tenantId) {
        throw new Error(
          'tenantId is required.'
        );
      }

      if (!this.user) {
        throw new Error(
          'user is required.'
        );
      }

      normalizeRequiredString(
        this.tokenHash,
        'tokenHash',
        MAX_TOKEN_HASH_LENGTH
      );

      if (
        this.expiresAt <= this.createdAt
      ) {
        throw new Error(
          'expiresAt must be later than createdAt.'
        );
      }

      // -----------------------------------------------------------------------
      // Lifecycle consistency
      // -----------------------------------------------------------------------

      if (
        this.status === 'USED'
      ) {
        if (!this.usedAt) {
          throw new Error(
            'USED tokens require usedAt.'
          );
        }

        if (this.revokedAt) {
          throw new Error(
            'USED tokens cannot also be revoked.'
          );
        }
      }

      if (
        this.status === 'REVOKED'
      ) {
        if (!this.revokedAt) {
          throw new Error(
            'REVOKED tokens require revokedAt.'
          );
        }

        if (this.usedAt) {
          throw new Error(
            'REVOKED tokens cannot contain usedAt.'
          );
        }
      }

      if (
        this.status === 'ACTIVE' &&
        (
          this.usedAt ||
          this.revokedAt ||
          this.revokedBy
        )
      ) {
        throw new Error(
          'ACTIVE tokens cannot contain used/revocation state.'
        );
      }

      // -----------------------------------------------------------------------
      // Metadata safety
      // -----------------------------------------------------------------------

      if (
        this.metadata?.extra
      ) {
        if (
          Object.keys(
            this.metadata.extra
          ).length >
          MAX_METADATA_KEYS
        ) {
          throw new RangeError(
            `metadata.extra cannot contain more than ${MAX_METADATA_KEYS} keys.`
          );
        }

        if (
          estimateBytes(
            this.metadata.extra
          ) >
          MAX_METADATA_BYTES
        ) {
          throw new RangeError(
            'metadata.extra exceeds the maximum permitted size.'
          );
        }
      }

      return next();
    } catch (error) {
      return next(error);
    }
  }
);

// =============================================================================
// Atomic token consumption
// =============================================================================
//
// This is the critical security boundary.
//
// Do NOT:
//
//   find token
//      ↓
//   check used=false
//      ↓
//   set used=true
//      ↓
//   save
//
// because two concurrent requests can both pass the check.
//
// Instead:
//
//   findOneAndUpdate({
//      status: ACTIVE,
//      expiresAt: > now
//   }, {
//      $set: USED
//   })
//
// MongoDB performs this atomically.
//
// =============================================================================

emailVerificationTokenSchema.statics.consume =
  async function (
    tenantId,
    userId,
    tokenHash,
    {
      session = null,
      consumedAt = new Date(),
    } = {}
  ) {
    if (!tenantId) {
      throw new Error(
        'tenantId is required.'
      );
    }

    if (!userId) {
      throw new Error(
        'userId is required.'
      );
    }

    const normalizedHash =
      normalizeRequiredString(
        tokenHash,
        'tokenHash',
        MAX_TOKEN_HASH_LENGTH
      );

    const query = {
      tenantId,
      user: userId,
      tokenHash:
        normalizedHash,
      status: 'ACTIVE',
      expiresAt: {
        $gt: consumedAt,
      },
    };

    const update = {
      $set: {
        status: 'USED',
        usedAt: consumedAt,
      },
    };

    const options = {
      new: true,
    };

    if (session) {
      options.session = session;
    }

    const token =
      await this.findOneAndUpdate(
        query,
        update,
        options
      );

    return token;
  };

// =============================================================================
// Static creation helper
// =============================================================================

emailVerificationTokenSchema.statics.createToken =
  async function ({
    tenantId,
    userId,
    tokenHash,
    expiresAt,
    requestIp = null,
    metadata = null,
    session = null,
  } = {}) {
    if (!tenantId) {
      throw new Error(
        'tenantId is required.'
      );
    }

    if (!userId) {
      throw new Error(
        'userId is required.'
      );
    }

    if (!expiresAt) {
      throw new Error(
        'expiresAt is required.'
      );
    }

    const document =
      new this({
        tenantId,
        user: userId,

        tokenHash:
          normalizeRequiredString(
            tokenHash,
            'tokenHash',
            MAX_TOKEN_HASH_LENGTH
          ),

        expiresAt:
          new Date(expiresAt),

        requestIp,

        metadata,
      });

    await document.save(
      session
        ? { session }
        : undefined
    );

    return document;
  };

// =============================================================================
// Revoke token
// =============================================================================

emailVerificationTokenSchema.statics.revoke =
  async function (
    tenantId,
    userId,
    tokenHash,
    {
      revokedBy = null,
      session = null,
      revokedAt = new Date(),
    } = {}
  ) {
    const options = {
      new: true,
    };

    if (session) {
      options.session = session;
    }

    const token =
      await this.findOneAndUpdate(
        {
          tenantId,
          user: userId,
          tokenHash,
          status: 'ACTIVE',
        },
        {
          $set: {
            status: 'REVOKED',
            revokedAt,
            revokedBy,
          },
        },
        options
      );

    return token;
  };

// =============================================================================
// Find active token for user
// =============================================================================

emailVerificationTokenSchema.statics.findActiveForUser =
  async function (
    tenantId,
    userId,
    {
      session = null,
      now = new Date(),
    } = {}
  ) {
    const query =
      this.findOne({
        tenantId,
        user: userId,
        status: 'ACTIVE',
        expiresAt: {
          $gt: now,
        },
      })
        .sort({
          createdAt: -1,
        })
        .select(
          '+tokenHash'
        );

    if (session) {
      query.session(
        session
      );
    }

    return query.exec();
  };

// =============================================================================
// Read helpers
// =============================================================================

emailVerificationTokenSchema.methods.isExpired =
  function (
    referenceDate = new Date()
  ) {
    return (
      referenceDate >=
      this.expiresAt
    );
  };

emailVerificationTokenSchema.methods.isUsable =
  function (
    referenceDate = new Date()
  ) {
    return (
      this.status === 'ACTIVE' &&
      !this.isExpired(
        referenceDate
      )
    );
  };

// =============================================================================
// Model
// =============================================================================

const EmailVerificationToken =
  mongoose.models.EmailVerificationToken ||
  mongoose.model(
    'EmailVerificationToken',
    emailVerificationTokenSchema
  );

export default EmailVerificationToken;

export {
  TOKEN_STATUSES,
};