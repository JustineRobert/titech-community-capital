// ============================================================================
// backend/models/IdempotencyKey.js
// TITech Community Capital LTD
// Compatibility / Request Idempotency Model
// ============================================================================
//
// IMPORTANT ARCHITECTURAL NOTE
//
// This model exists for non-financial/general API idempotency compatibility.
//
// Financial operations SHOULD use:
//     backend/models/idempotencyRecord.model.js
//
// That model owns the stronger financial lifecycle:
//     PROCESSING
//     COMPLETED
//     FAILED
//     RECOVERY_REQUIRED
//
// DO NOT create a second independent financial idempotency boundary here.
//
// This model is appropriate for lightweight request deduplication where no
// financial mutation occurs.
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

const MAX_KEY_LENGTH = 255;
const MAX_TENANT_ID_LENGTH = 128;
const MAX_REQUEST_ID_LENGTH = 128;
const MAX_ENDPOINT_LENGTH = 512;
const MAX_PAYLOAD_HASH_LENGTH = 128;
const MAX_EXTRA_KEYS = 50;
const MAX_EXTRA_PAYLOAD_BYTES = 64 * 1024;

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

function normalizeOptionalString(
  value,
  fieldName,
  maxLength
) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  return normalizeRequiredString(
    value,
    fieldName,
    maxLength
  );
}

function estimatePayloadBytes(value) {
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
// Metadata
// =============================================================================

const metadataSchema = new Schema(
  {
    requestId: {
      type: String,
      trim: true,
      maxlength: MAX_REQUEST_ID_LENGTH,
      immutable: true,
    },

    endpoint: {
      type: String,
      trim: true,
      maxlength: MAX_ENDPOINT_LENGTH,
      immutable: true,
    },

    payloadHash: {
      type: String,
      trim: true,
      maxlength: MAX_PAYLOAD_HASH_LENGTH,
      immutable: true,
    },

    /**
     * Restricted auxiliary metadata.
     *
     * Never use this for:
     *   - credentials
     *   - access tokens
     *   - refresh tokens
     *   - passwords
     *   - payment PINs
     *   - raw identity documents
     */
    extra: {
      type: Schema.Types.Mixed,
      default: undefined,
      immutable: true,
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

const idempotencyKeySchema = new Schema(
  {
    // -------------------------------------------------------------------------
    // Tenant
    // -------------------------------------------------------------------------

    tenantId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      maxlength: MAX_TENANT_ID_LENGTH,
      index: true,
    },

    // -------------------------------------------------------------------------
    // Request identity
    // -------------------------------------------------------------------------

    /**
     * Authenticated principal / caller identity.
     *
     * This was absent from the legacy model, but it is important because an
     * idempotency key generally belongs to a caller, not merely to a tenant.
     */
    principalId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      maxlength: 128,
      index: true,
    },

    key: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      minlength: 1,
      maxlength: MAX_KEY_LENGTH,
    },

    /**
     * Hash/fingerprint of the logical request.
     *
     * Same key + different payload should be rejected by the service layer.
     */
    payloadHash: {
      type: String,
      trim: true,
      maxlength: MAX_PAYLOAD_HASH_LENGTH,
      immutable: true,
    },

    // -------------------------------------------------------------------------
    // Metadata
    // -------------------------------------------------------------------------

    metadata: {
      type: metadataSchema,
      default: undefined,
      immutable: true,
    },

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    /**
     * Lightweight records do not execute financial recovery themselves.
     *
     * READY = key acquired / reserved
     * COMPLETED = request has completed
     * FAILED = request definitively failed
     */
    status: {
      type: String,
      enum: [
        'READY',
        'COMPLETED',
        'FAILED',
      ],
      default: 'READY',
      required: true,
      immutable: false,
      index: true,
    },

    createdAt: {
      type: Date,
      required: true,
      default: Date.now,
      immutable: true,
      index: true,
    },

    completedAt: {
      type: Date,
      default: null,
    },

    // -------------------------------------------------------------------------
    // Retention
    // -------------------------------------------------------------------------

    /**
     * TTL applies to the record's retention lifecycle.
     *
     * The service should set this only after the request reaches a terminal
     * state.
     */
    expiresAt: {
      type: Date,
      default: null,
      index: true,
    },

    // -------------------------------------------------------------------------
    // Legacy soft-delete compatibility
    // -------------------------------------------------------------------------

    /**
     * Kept only for compatibility with older consumers.
     *
     * New code should prefer terminal state + TTL instead of soft deletion.
     */
    isDeleted: {
      type: Boolean,
      default: false,
      immutable: false,
      index: true,
    },
  },
  {
    timestamps: true,

    versionKey: '__v',

    strict: true,
    strictQuery: true,
    minimize: false,

    collection: 'idempotency_keys',
  }
);

// =============================================================================
// Indexes
// =============================================================================

/**
 * Core uniqueness boundary:
 *
 *     tenant + principal + key
 *
 * This is deliberately different from the legacy global `key` uniqueness.
 */
idempotencyKeySchema.index(
  {
    tenantId: 1,
    principalId: 1,
    key: 1,
  },
  {
    unique: true,
    name: 'uq_idempotency_key_tenant_principal_key',
  }
);

idempotencyKeySchema.index(
  {
    tenantId: 1,
    status: 1,
    createdAt: -1,
  },
  {
    name: 'idx_idempotency_key_tenant_status_created',
  }
);

idempotencyKeySchema.index(
  {
    tenantId: 1,
    principalId: 1,
    createdAt: -1,
  },
  {
    name: 'idx_idempotency_key_tenant_principal_created',
  }
);

idempotencyKeySchema.index(
  {
    tenantId: 1,
    'metadata.requestId': 1,
  },
  {
    sparse: true,
    name: 'idx_idempotency_key_tenant_request',
  }
);

/**
 * TTL is sparse and only works once expiresAt receives a value.
 */
idempotencyKeySchema.index(
  {
    expiresAt: 1,
  },
  {
    expireAfterSeconds: 0,
    sparse: true,
    name: 'ttl_idempotency_key_expires_at',
  }
);

// =============================================================================
// Validation
// =============================================================================

idempotencyKeySchema.pre(
  'validate',
  function validateIdempotencyKey(next) {
    try {
      normalizeRequiredString(
        this.tenantId,
        'tenantId',
        MAX_TENANT_ID_LENGTH
      );

      normalizeRequiredString(
        this.principalId,
        'principalId',
        128
      );

      normalizeRequiredString(
        this.key,
        'key',
        MAX_KEY_LENGTH
      );

      if (this.payloadHash) {
        normalizeRequiredString(
          this.payloadHash,
          'payloadHash',
          MAX_PAYLOAD_HASH_LENGTH
        );
      }

      if (
        this.metadata?.extra !== undefined &&
        this.metadata?.extra !== null
      ) {
        const extraKeys =
          typeof this.metadata.extra === 'object'
            ? Object.keys(
                this.metadata.extra
              ).length
            : 0;

        if (
          extraKeys > MAX_EXTRA_KEYS
        ) {
          throw new RangeError(
            `metadata.extra cannot contain more than ${MAX_EXTRA_KEYS} keys.`
          );
        }

        if (
          estimatePayloadBytes(
            this.metadata.extra
          ) > MAX_EXTRA_PAYLOAD_BYTES
        ) {
          throw new RangeError(
            'metadata.extra exceeds the maximum permitted payload size.'
          );
        }
      }

      if (
        this.status === 'COMPLETED' &&
        !this.completedAt
      ) {
        this.completedAt = new Date();
      }

      if (
        this.completedAt &&
        this.completedAt < this.createdAt
      ) {
        throw new Error(
          'completedAt cannot be earlier than createdAt.'
        );
      }

      if (
        this.expiresAt &&
        this.expiresAt <= this.createdAt
      ) {
        throw new Error(
          'expiresAt must be later than createdAt.'
        );
      }

      return next();
    } catch (error) {
      return next(error);
    }
  }
);

// =============================================================================
// Static helpers
// =============================================================================

/**
 * Acquire a lightweight idempotency key.
 *
 * For financial operations use:
 *     IdempotencyRecord.acquire(...)
 *
 * instead.
 */
idempotencyKeySchema.statics.acquire =
  async function ({
    tenantId,
    principalId,
    key,
    requestId = null,
    endpoint = null,
    payloadHash = null,
    extra = null,
    expiresAt = null,
    session = null,
  } = {}) {
    const normalizedTenantId =
      normalizeRequiredString(
        tenantId,
        'tenantId',
        MAX_TENANT_ID_LENGTH
      );

    const normalizedPrincipalId =
      normalizeRequiredString(
        principalId,
        'principalId',
        128
      );

    const normalizedKey =
      normalizeRequiredString(
        key,
        'key',
        MAX_KEY_LENGTH
      );

    const document =
      new this({
        tenantId:
          normalizedTenantId,

        principalId:
          normalizedPrincipalId,

        key:
          normalizedKey,

        payloadHash:
          normalizeOptionalString(
            payloadHash,
            'payloadHash',
            MAX_PAYLOAD_HASH_LENGTH
          ),

        metadata: {
          requestId:
            normalizeOptionalString(
              requestId,
              'requestId',
              MAX_REQUEST_ID_LENGTH
            ),

          endpoint:
            normalizeOptionalString(
              endpoint,
              'endpoint',
              MAX_ENDPOINT_LENGTH
            ),

          payloadHash:
            normalizeOptionalString(
              payloadHash,
              'metadata.payloadHash',
              MAX_PAYLOAD_HASH_LENGTH
            ),

          extra,
        },

        status: 'READY',

        expiresAt:
          expiresAt
            ? new Date(expiresAt)
            : null,
      });

    try {
      await document.save(
        session
          ? { session }
          : undefined
      );

      return {
        acquired: true,
        record: document,
      };
    } catch (error) {
      if (
        error?.code === 11000
      ) {
        const existingQuery =
          this.findOne({
            tenantId:
              normalizedTenantId,
            principalId:
              normalizedPrincipalId,
            key:
              normalizedKey,
          });

        if (session) {
          existingQuery.session(session);
        }

        const existing =
          await existingQuery.exec();

        if (!existing) {
          throw error;
        }

        if (
          existing.payloadHash &&
          payloadHash &&
          existing.payloadHash !==
            payloadHash
        ) {
          const conflict =
            new Error(
              'Idempotency key was already used with a different payload.'
            );

          conflict.code =
            'IDEMPOTENCY_PAYLOAD_MISMATCH';

          conflict.statusCode = 409;

          throw conflict;
        }

        return {
          acquired: false,
          record: existing,
        };
      }

      throw error;
    }
  };

/**
 * Find one key using the complete tenant/principal identity.
 */
idempotencyKeySchema.statics.findByKey =
  async function (
    tenantId,
    principalId,
    key,
    {
      session = null,
    } = {}
  ) {
    const query = this.findOne({
      tenantId,
      principalId,
      key,
    });

    if (session) {
      query.session(session);
    }

    return query.exec();
  };

/**
 * Mark the lightweight record completed.
 */
idempotencyKeySchema.statics.complete =
  async function (
    recordId,
    {
      expiresAt = null,
      session = null,
    } = {}
  ) {
    const options = {
      new: true,
    };

    if (session) {
      options.session = session;
    }

    const record =
      await this.findOneAndUpdate(
        {
          _id: recordId,
          status: 'READY',
        },
        {
          $set: {
            status: 'COMPLETED',
            completedAt: new Date(),
            expiresAt,
          },
        },
        options
      );

    if (!record) {
      throw new Error(
        'Idempotency key is no longer in READY state.'
      );
    }

    return record;
  };

/**
 * Mark the lightweight record failed.
 */
idempotencyKeySchema.statics.fail =
  async function (
    recordId,
    {
      expiresAt = null,
      session = null,
    } = {}
  ) {
    const options = {
      new: true,
    };

    if (session) {
      options.session = session;
    }

    const record =
      await this.findOneAndUpdate(
        {
          _id: recordId,
          status: 'READY',
        },
        {
          $set: {
            status: 'FAILED',
            completedAt: new Date(),
            expiresAt,
          },
        },
        options
      );

    if (!record) {
      throw new Error(
        'Idempotency key is no longer in READY state.'
      );
    }

    return record;
  };

// =============================================================================
// JSON
// =============================================================================

idempotencyKeySchema.set(
  'toJSON',
  {
    transform(
      doc,
      ret
    ) {
      delete ret.__v;

      // Fingerprints should not normally be exposed.
      delete ret.payloadHash;

      return ret;
    },
  }
);

// =============================================================================
// Model
// =============================================================================

const IdempotencyKey =
  mongoose.models.IdempotencyKey ||
  mongoose.model(
    'IdempotencyKey',
    idempotencyKeySchema
  );

export default IdempotencyKey;