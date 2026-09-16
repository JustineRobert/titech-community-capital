// ============================================================================
// backend/models/idempotencyRecord.model.js
// TITech Community Capital LTD
// Enterprise Financial Idempotency Record
// ============================================================================
//
// Purpose
//   Durable, tenant-aware idempotency state machine for financial operations.
//
// Core invariant
//
//   A unique business identity:
//
//       tenant
//         +
//       principal
//         +
//       idempotency key
//
//   identifies ONE logical financial operation.
//
// Duplicate requests MUST NOT execute the underlying financial mutation more
// than once.
//
// Architectural boundary
//
//   IdempotencyRecord
//        = request/operation execution state
//
//   Transaction
//        = canonical financial transaction
//
//   LedgerEntry
//        = accounting representation
//
// This model does NOT replace Transaction or LedgerEntry.
//
// IMPORTANT
//   - PROCESSING records are protected by a processing lease.
//   - TTL retention is applied only to terminal records.
//   - RECOVERY_REQUIRED is NOT treated as failure.
//   - Financial reconciliation remains authoritative over idempotency data.
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

const IDEMPOTENCY_STATUSES = Object.freeze([
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'RECOVERY_REQUIRED',
]);

const IDEMPOTENCY_RESULT_TYPES = Object.freeze([
  'SUCCESS',
  'CLIENT_ERROR',
  'SERVER_ERROR',
  'RECOVERED_SUCCESS',
  'RECOVERED_FAILURE',
  'RECOVERY_REQUIRED',
]);

const TERMINAL_STATUSES = Object.freeze([
  'COMPLETED',
  'FAILED',
]);

const RECOVERED_RESULT_TYPES = Object.freeze([
  'RECOVERED_SUCCESS',
  'RECOVERED_FAILURE',
]);

const MAX_TENANT_ID_LENGTH = 128;
const MAX_PRINCIPAL_ID_LENGTH = 128;
const MAX_DEVICE_ID_LENGTH = 128;
const MAX_IDEMPOTENCY_KEY_LENGTH = 255;
const MAX_FINGERPRINT_LENGTH = 128;
const MAX_OPERATION_LENGTH = 150;
const MAX_RESOURCE_LENGTH = 255;
const MAX_TRANSACTION_ID_LENGTH = 128;
const MAX_ERROR_CODE_LENGTH = 128;

const MAX_RESPONSE_BODY_BYTES = 1024 * 1024;
const MAX_RESPONSE_METADATA_KEYS = 50;

// =============================================================================
// Utility
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
    value === undefined ||
    value === null ||
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

function isValidHttpStatus(value) {
  return (
    value === null ||
    value === undefined ||
    (
      Number.isInteger(value) &&
      value >= 100 &&
      value <= 599
    )
  );
}

function isTerminalStatus(status) {
  return TERMINAL_STATUSES.includes(status);
}

function isValidStatusResultCombination(
  status,
  resultType
) {
  if (!resultType) {
    return (
      status === 'PROCESSING' ||
      status === 'RECOVERY_REQUIRED'
    );
  }

  if (status === 'COMPLETED') {
    return (
      resultType === 'SUCCESS' ||
      resultType === 'RECOVERED_SUCCESS'
    );
  }

  if (status === 'FAILED') {
    return (
      resultType === 'CLIENT_ERROR' ||
      resultType === 'SERVER_ERROR' ||
      resultType === 'RECOVERED_FAILURE'
    );
  }

  if (status === 'RECOVERY_REQUIRED') {
    return (
      resultType === 'RECOVERY_REQUIRED'
    );
  }

  return false;
}

function estimatePayloadBytes(value) {
  if (value === null || value === undefined) {
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
// Response schema
// =============================================================================
//
// The response is part of replay semantics.
//
// Do NOT persist:
//   - passwords
//   - refresh tokens
//   - access tokens
//   - authorization headers
//   - payment credentials
//   - raw KYC documents
//   - unnecessary sensitive PII
//
// =============================================================================

const responseSchema = new Schema(
  {
    body: {
      type: Schema.Types.Mixed,
      default: null,
    },

    contentType: {
      type: String,
      trim: true,
      maxlength: 128,
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

const idempotencyRecordSchema = new Schema(
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
    // Authenticated principal
    // -------------------------------------------------------------------------

    principalId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      maxlength: MAX_PRINCIPAL_ID_LENGTH,
      index: true,
    },

    // -------------------------------------------------------------------------
    // Originating device
    // -------------------------------------------------------------------------

    deviceId: {
      type: String,
      default: null,
      immutable: true,
      trim: true,
      maxlength: MAX_DEVICE_ID_LENGTH,
    },

    // -------------------------------------------------------------------------
    // Idempotency identity
    // -------------------------------------------------------------------------

    idempotencyKey: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      minlength: 1,
      maxlength: MAX_IDEMPOTENCY_KEY_LENGTH,
    },

    // -------------------------------------------------------------------------
    // Request fingerprint
    // -------------------------------------------------------------------------

    requestFingerprint: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      minlength: 1,
      maxlength: MAX_FINGERPRINT_LENGTH,
    },

    // -------------------------------------------------------------------------
    // Logical operation
    // -------------------------------------------------------------------------

    operation: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      minlength: 1,
      maxlength: MAX_OPERATION_LENGTH,
    },

    // -------------------------------------------------------------------------
    // Logical resource
    // -------------------------------------------------------------------------

    resource: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      minlength: 1,
      maxlength: MAX_RESOURCE_LENGTH,
    },

    // -------------------------------------------------------------------------
    // Canonical financial transaction
    // -------------------------------------------------------------------------

    /**
     * Kept as String for compatibility with the existing application.
     *
     * If Transaction._id is standardized as ObjectId across the application,
     * migrate this field together with the transaction/idempotency repositories.
     */
    transactionId: {
      type: String,
      default: null,
      trim: true,
      maxlength: MAX_TRANSACTION_ID_LENGTH,
      index: true,
    },

    // -------------------------------------------------------------------------
    // Lifecycle state
    // -------------------------------------------------------------------------

    status: {
      type: String,
      required: true,
      enum: IDEMPOTENCY_STATUSES,
      default: 'PROCESSING',
      uppercase: true,
      trim: true,
      index: true,
    },

    resultType: {
      type: String,
      enum: IDEMPOTENCY_RESULT_TYPES,
      default: null,
      uppercase: true,
      trim: true,
    },

    // -------------------------------------------------------------------------
    // HTTP replay response
    // -------------------------------------------------------------------------

    httpStatus: {
      type: Number,
      default: null,
      min: 100,
      max: 599,
      validate: {
        validator: isValidHttpStatus,
        message: 'httpStatus must be between 100 and 599.',
      },
    },

    response: {
      type: responseSchema,
      default: undefined,
    },

    /**
     * Backward-compatible field name.
     *
     * New application code should prefer `response.body`.
     */
    responseBody: {
      type: Schema.Types.Mixed,
      default: null,
    },

    // -------------------------------------------------------------------------
    // Error
    // -------------------------------------------------------------------------

    errorCode: {
      type: String,
      default: null,
      trim: true,
      maxlength: MAX_ERROR_CODE_LENGTH,
    },

    errorMessage: {
      type: String,
      default: null,
      trim: true,
      maxlength: 1000,
    },

    // -------------------------------------------------------------------------
    // Processing lifecycle
    // -------------------------------------------------------------------------

    processingStartedAt: {
      type: Date,
      required: true,
      default: Date.now,
      immutable: true,
      index: true,
    },

    lastProcessingHeartbeatAt: {
      type: Date,
      default: null,
      index: true,
    },

    /**
     * Hard lease deadline for active processing.
     *
     * A worker must renew this while the financial operation is running.
     */
    processingLeaseExpiresAt: {
      type: Date,
      default: null,
      index: true,
    },

    // -------------------------------------------------------------------------
    // Completion
    // -------------------------------------------------------------------------

    completedAt: {
      type: Date,
      default: null,
    },

    // -------------------------------------------------------------------------
    // Recovery
    // -------------------------------------------------------------------------

    recoveryRequiredAt: {
      type: Date,
      default: null,
      index: true,
    },

    recoveryResolvedAt: {
      type: Date,
      default: null,
    },

    recoveryResultType: {
      type: String,
      enum: [
        ...RECOVERED_RESULT_TYPES,
        null,
      ],
      default: null,
    },

    // -------------------------------------------------------------------------
    // Retention
    // -------------------------------------------------------------------------

    /**
     * TTL is deliberately separate from operation expiry.
     *
     * This field remains null while PROCESSING or RECOVERY_REQUIRED.
     * It becomes populated only after the record reaches a terminal state and
     * is safe for retention cleanup.
     */
    retentionExpiresAt: {
      type: Date,
      default: null,
      index: true,
    },

    // -------------------------------------------------------------------------
    // Operational trace
    // -------------------------------------------------------------------------

    correlationId: {
      type: String,
      default: null,
      trim: true,
      maxlength: 128,
      index: true,
      immutable: true,
    },

    requestId: {
      type: String,
      default: null,
      trim: true,
      maxlength: 128,
      index: true,
      immutable: true,
    },

    // -------------------------------------------------------------------------
    // Audit actor
    // -------------------------------------------------------------------------

    createdBy: {
      type: String,
      default: null,
      trim: true,
      maxlength: 128,
      immutable: true,
    },
  },
  {
    timestamps: true,

    /**
     * Direct document updates are required for controlled state transitions,
     * therefore Mongoose versioning is retained.
     */
    versionKey: '__v',

    strict: true,
    strictQuery: true,
    minimize: false,
  }
);

// =============================================================================
// Unique business identity
// =============================================================================

idempotencyRecordSchema.index(
  {
    tenantId: 1,
    principalId: 1,
    idempotencyKey: 1,
  },
  {
    unique: true,
    name: 'uq_idempotency_tenant_principal_key',
  }
);

// =============================================================================
// Operational indexes
// =============================================================================

idempotencyRecordSchema.index(
  {
    tenantId: 1,
    status: 1,
    createdAt: -1,
  },
  {
    name: 'idx_idempotency_tenant_status_created',
  }
);

idempotencyRecordSchema.index(
  {
    tenantId: 1,
    status: 1,
    processingLeaseExpiresAt: 1,
  },
  {
    name: 'idx_idempotency_processing_lease',
  }
);

idempotencyRecordSchema.index(
  {
    status: 1,
    recoveryRequiredAt: 1,
  },
  {
    name: 'idx_idempotency_recovery_queue',
  }
);

idempotencyRecordSchema.index(
  {
    tenantId: 1,
    transactionId: 1,
  },
  {
    name: 'idx_idempotency_tenant_transaction',
  }
);

idempotencyRecordSchema.index(
  {
    tenantId: 1,
    correlationId: 1,
    createdAt: -1,
  },
  {
    sparse: true,
    name: 'idx_idempotency_tenant_correlation',
  }
);

idempotencyRecordSchema.index(
  {
    tenantId: 1,
    requestId: 1,
    createdAt: -1,
  },
  {
    sparse: true,
    name: 'idx_idempotency_tenant_request',
  }
);

// =============================================================================
// TTL INDEX
// =============================================================================
//
// CRITICAL:
//
// Never TTL PROCESSING records.
// Never TTL RECOVERY_REQUIRED records.
//
// Only terminal records populate retentionExpiresAt.
//
// MongoDB TTL cleanup is asynchronous and is a retention mechanism, NOT a
// correctness mechanism.
//
// =============================================================================

idempotencyRecordSchema.index(
  {
    retentionExpiresAt: 1,
  },
  {
    expireAfterSeconds: 0,
    sparse: true,
    name: 'ttl_idempotency_retention',
  }
);

// =============================================================================
// Validation
// =============================================================================

idempotencyRecordSchema.pre(
  'validate',
  function validateIdempotencyRecord(next) {
    try {
      if (!this.tenantId?.trim()) {
        throw new Error(
          'tenantId is required.'
        );
      }

      if (!this.principalId?.trim()) {
        throw new Error(
          'principalId is required.'
        );
      }

      if (!this.idempotencyKey?.trim()) {
        throw new Error(
          'idempotencyKey is required.'
        );
      }

      if (!this.requestFingerprint?.trim()) {
        throw new Error(
          'requestFingerprint is required.'
        );
      }

      if (!this.operation?.trim()) {
        throw new Error(
          'operation is required.'
        );
      }

      if (!this.resource?.trim()) {
        throw new Error(
          'resource is required.'
        );
      }

      if (
        !isValidStatusResultCombination(
          this.status,
          this.resultType
        )
      ) {
        throw new Error(
          `Invalid status/resultType combination: ` +
          `${this.status}/${this.resultType}`
        );
      }

      // -----------------------------------------------------------------------
      // Processing state
      // -----------------------------------------------------------------------

      if (this.status === 'PROCESSING') {
        if (!this.processingStartedAt) {
          throw new Error(
            'PROCESSING records require processingStartedAt.'
          );
        }

        if (!this.processingLeaseExpiresAt) {
          throw new Error(
            'PROCESSING records require processingLeaseExpiresAt.'
          );
        }

        if (
          this.completedAt ||
          this.recoveryRequiredAt ||
          this.recoveryResolvedAt
        ) {
          throw new Error(
            'PROCESSING records cannot contain completion/recovery timestamps.'
          );
        }

        if (this.retentionExpiresAt) {
          throw new Error(
            'PROCESSING records cannot have retentionExpiresAt.'
          );
        }
      }

      // -----------------------------------------------------------------------
      // Completion state
      // -----------------------------------------------------------------------

      if (this.status === 'COMPLETED') {
        if (!this.completedAt) {
          throw new Error(
            'COMPLETED records require completedAt.'
          );
        }

        if (!this.resultType) {
          throw new Error(
            'COMPLETED records require resultType.'
          );
        }

        if (this.retentionExpiresAt === null) {
          // Allowed before terminal transition helper sets retention.
          // This is intentionally not rejected here to allow controlled
          // construction followed by transition logic.
        }
      }

      // -----------------------------------------------------------------------
      // Failure state
      // -----------------------------------------------------------------------

      if (this.status === 'FAILED') {
        if (!this.resultType) {
          throw new Error(
            'FAILED records require resultType.'
          );
        }

        if (
          !this.errorCode &&
          !this.errorMessage &&
          this.resultType !== 'RECOVERED_FAILURE'
        ) {
          throw new Error(
            'FAILED records should identify the failure.'
          );
        }
      }

      // -----------------------------------------------------------------------
      // Recovery state
      // -----------------------------------------------------------------------

      if (this.status === 'RECOVERY_REQUIRED') {
        if (!this.recoveryRequiredAt) {
          throw new Error(
            'RECOVERY_REQUIRED requires recoveryRequiredAt.'
          );
        }

        if (this.recoveryResolvedAt) {
          throw new Error(
            'Unresolved recovery cannot contain recoveryResolvedAt.'
          );
        }

        if (this.recoveryResultType) {
          throw new Error(
            'Unresolved recovery cannot contain recoveryResultType.'
          );
        }

        if (this.retentionExpiresAt) {
          throw new Error(
            'RECOVERY_REQUIRED records cannot have retentionExpiresAt.'
          );
        }

        if (this.resultType !== 'RECOVERY_REQUIRED') {
          throw new Error(
            'RECOVERY_REQUIRED requires resultType=RECOVERY_REQUIRED.'
          );
        }
      }

      // -----------------------------------------------------------------------
      // Response size
      // -----------------------------------------------------------------------

      const replayBody =
        this.response?.body ??
        this.responseBody;

      if (
        estimatePayloadBytes(replayBody) >
        MAX_RESPONSE_BODY_BYTES
      ) {
        throw new RangeError(
          'Persisted idempotency response exceeds the maximum allowed size.'
        );
      }

      if (
        this.httpStatus !== null &&
        this.httpStatus !== undefined &&
        !isValidHttpStatus(this.httpStatus)
      ) {
        throw new RangeError(
          'httpStatus must be between 100 and 599.'
        );
      }

      return next();
    } catch (error) {
      return next(error);
    }
  }
);

// =============================================================================
// State-transition statics
// =============================================================================

/**
 * Claim a new idempotency operation.
 *
 * The unique tenant/principal/key index is the final concurrency boundary.
 *
 * Returns:
 *   {
 *     acquired: boolean,
 *     record
 *   }
 */
idempotencyRecordSchema.statics.acquire =
  async function ({
    tenantId,
    principalId,
    deviceId = null,
    idempotencyKey,
    requestFingerprint,

    operation,
    resource,

    correlationId = null,
    requestId = null,
    createdBy = null,

    transactionId = null,

    leaseMs = 60_000,

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
        MAX_PRINCIPAL_ID_LENGTH
      );

    const normalizedKey =
      normalizeRequiredString(
        idempotencyKey,
        'idempotencyKey',
        MAX_IDEMPOTENCY_KEY_LENGTH
      );

    const normalizedFingerprint =
      normalizeRequiredString(
        requestFingerprint,
        'requestFingerprint',
        MAX_FINGERPRINT_LENGTH
      );

    const normalizedOperation =
      normalizeRequiredString(
        operation,
        'operation',
        MAX_OPERATION_LENGTH
      );

    const normalizedResource =
      normalizeRequiredString(
        resource,
        'resource',
        MAX_RESOURCE_LENGTH
      );

    if (
      !Number.isInteger(leaseMs) ||
      leaseMs <= 0 ||
      leaseMs > 24 * 60 * 60 * 1000
    ) {
      throw new RangeError(
        'leaseMs must be between 1ms and 24 hours.'
      );
    }

    const now = new Date();

    const document = new this({
      tenantId: normalizedTenantId,
      principalId: normalizedPrincipalId,
      deviceId: normalizeOptionalString(
        deviceId,
        'deviceId',
        MAX_DEVICE_ID_LENGTH
      ),

      idempotencyKey: normalizedKey,
      requestFingerprint: normalizedFingerprint,

      operation: normalizedOperation,
      resource: normalizedResource,

      transactionId:
        normalizeOptionalString(
          transactionId,
          'transactionId',
          MAX_TRANSACTION_ID_LENGTH
        ),

      status: 'PROCESSING',

      resultType: null,

      processingStartedAt: now,
      lastProcessingHeartbeatAt: now,
      processingLeaseExpiresAt:
        new Date(now.getTime() + leaseMs),

      correlationId:
        normalizeOptionalString(
          correlationId,
          'correlationId',
          128
        ),

      requestId:
        normalizeOptionalString(
          requestId,
          'requestId',
          128
        ),

      createdBy:
        normalizeOptionalString(
          createdBy,
          'createdBy',
          128
        ),
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
      if (error?.code === 11000) {
        const existingQuery = this.findOne({
          tenantId: normalizedTenantId,
          principalId: normalizedPrincipalId,
          idempotencyKey: normalizedKey,
        });

        if (session) {
          existingQuery.session(session);
        }

        const existing =
          await existingQuery.exec();

        if (!existing) {
          throw error;
        }

        /**
         * Same idempotency identity with a different request body is a
         * semantic conflict and MUST NOT replay the previous operation.
         */
        if (
          existing.requestFingerprint !==
          normalizedFingerprint
        ) {
          const conflict = new Error(
            'Idempotency key was already used with a different request fingerprint.'
          );

          conflict.code =
            'IDEMPOTENCY_FINGERPRINT_MISMATCH';

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
 * Renew a processing lease.
 *
 * Uses an atomic status + lease predicate so two workers cannot accidentally
 * renew a record that has already transitioned to another state.
 */
idempotencyRecordSchema.statics.heartbeat =
  async function (
    recordId,
    {
      leaseMs = 60_000,
      session = null,
      now = new Date(),
    } = {}
  ) {
    if (
      !Number.isInteger(leaseMs) ||
      leaseMs <= 0
    ) {
      throw new RangeError(
        'leaseMs must be a positive integer.'
      );
    }

    const filter = {
      _id: recordId,
      status: 'PROCESSING',
    };

    const update = {
      $set: {
        lastProcessingHeartbeatAt: now,
        processingLeaseExpiresAt:
          new Date(
            now.getTime() + leaseMs
          ),
      },
    };

    const options = {
      new: true,
    };

    if (session) {
      options.session = session;
    }

    return this.findOneAndUpdate(
      filter,
      update,
      options
    );
  };

/**
 * Complete a successful operation atomically.
 */
idempotencyRecordSchema.statics.complete =
  async function (
    recordId,
    {
      httpStatus = 200,
      responseBody = null,
      contentType = 'application/json',

      transactionId = null,

      retentionExpiresAt = null,

      session = null,
      completedAt = new Date(),
    } = {}
  ) {
    if (
      !Number.isInteger(httpStatus) ||
      httpStatus < 100 ||
      httpStatus > 599
    ) {
      throw new RangeError(
        'httpStatus must be between 100 and 599.'
      );
    }

    if (
      estimatePayloadBytes(responseBody) >
      MAX_RESPONSE_BODY_BYTES
    ) {
      throw new RangeError(
        'responseBody exceeds the maximum allowed size.'
      );
    }

    const update = {
      $set: {
        status: 'COMPLETED',

        resultType: 'SUCCESS',

        httpStatus,

        response: {
          body: responseBody,
          contentType,
        },

        responseBody,

        completedAt,

        processingLeaseExpiresAt: null,
        lastProcessingHeartbeatAt:
          completedAt,

        transactionId:
          transactionId ?? undefined,

        retentionExpiresAt,
      },
      $unset: {
        errorCode: 1,
        errorMessage: 1,
        recoveryRequiredAt: 1,
        recoveryResolvedAt: 1,
        recoveryResultType: 1,
      },
    };

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
          status: 'PROCESSING',
        },
        update,
        options
      );

    if (!record) {
      throw new Error(
        'Idempotency record is no longer in PROCESSING state.'
      );
    }

    return record;
  };

/**
 * Complete a failed operation atomically.
 */
idempotencyRecordSchema.statics.fail =
  async function (
    recordId,
    {
      resultType = 'SERVER_ERROR',
      httpStatus = 500,
      errorCode = null,
      errorMessage = null,
      responseBody = null,
      contentType = 'application/json',

      retentionExpiresAt = null,

      session = null,
      completedAt = new Date(),
    } = {}
  ) {
    if (
      ![
        'CLIENT_ERROR',
        'SERVER_ERROR',
      ].includes(resultType)
    ) {
      throw new Error(
        'fail() requires CLIENT_ERROR or SERVER_ERROR.'
      );
    }

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
          status: 'PROCESSING',
        },
        {
          $set: {
            status: 'FAILED',

            resultType,

            httpStatus,

            errorCode:
              errorCode
                ? String(errorCode).trim()
                : null,

            errorMessage:
              errorMessage
                ? String(errorMessage).trim()
                : null,

            response: {
              body: responseBody,
              contentType,
            },

            responseBody,

            completedAt,

            processingLeaseExpiresAt: null,

            retentionExpiresAt,
          },

          $unset: {
            recoveryRequiredAt: 1,
            recoveryResolvedAt: 1,
            recoveryResultType: 1,
          },
        },
        options
      );

    if (!record) {
      throw new Error(
        'Idempotency record is no longer in PROCESSING state.'
      );
    }

    return record;
  };

/**
 * Mark an abandoned processing operation as requiring reconciliation.
 *
 * This must only succeed after its processing lease has expired.
 */
idempotencyRecordSchema.statics.markRecoveryRequired =
  async function (
    recordId,
    {
      session = null,
      now = new Date(),
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
          status: 'PROCESSING',
          processingLeaseExpiresAt: {
            $lte: now,
          },
        },
        {
          $set: {
            status: 'RECOVERY_REQUIRED',
            resultType: 'RECOVERY_REQUIRED',
            recoveryRequiredAt: now,
          },

          $unset: {
            processingLeaseExpiresAt: 1,
            lastProcessingHeartbeatAt: 1,
          },
        },
        options
      );

    if (!record) {
      return null;
    }

    return record;
  };

/**
 * Resolve a recovery operation after reconciliation with the canonical
 * Transaction/ledger state.
 *
 * Financial reconciliation must determine whether the mutation actually
 * committed. Do not infer success from application process state alone.
 */
idempotencyRecordSchema.statics.resolveRecovery =
  async function (
    recordId,
    {
      recoveredSuccessfully,
      transactionId = null,

      httpStatus =
        recoveredSuccessfully
          ? 200
          : 500,

      responseBody = null,
      contentType = 'application/json',

      retentionExpiresAt = null,

      session = null,
      resolvedAt = new Date(),
    } = {}
  ) {
    if (
      typeof recoveredSuccessfully !== 'boolean'
    ) {
      throw new TypeError(
        'recoveredSuccessfully must be a boolean.'
      );
    }

    const resultType =
      recoveredSuccessfully
        ? 'RECOVERED_SUCCESS'
        : 'RECOVERED_FAILURE';

    const status =
      recoveredSuccessfully
        ? 'COMPLETED'
        : 'FAILED';

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
          status: 'RECOVERY_REQUIRED',
        },
        {
          $set: {
            status,
            resultType,

            httpStatus,

            response: {
              body: responseBody,
              contentType,
            },

            responseBody,

            transactionId:
              transactionId ?? undefined,

            recoveryResolvedAt:
              resolvedAt,

            recoveryResultType:
              resultType,

            completedAt:
              resolvedAt,

            retentionExpiresAt,
          },

          $unset: {
            recoveryRequiredAt: 1,
          },
        },
        options
      );

    if (!record) {
      throw new Error(
        'Idempotency record is no longer awaiting recovery.'
      );
    }

    return record;
  };

// =============================================================================
// Lookup statics
// =============================================================================

/**
 * Retrieve by business idempotency identity.
 */
idempotencyRecordSchema.statics.findByIdentity =
  async function (
    tenantId,
    principalId,
    idempotencyKey,
    {
      session = null,
    } = {}
  ) {
    const query = this.findOne({
      tenantId,
      principalId,
      idempotencyKey,
    });

    if (session) {
      query.session(session);
    }

    return query.exec();
  };

/**
 * Retrieve by canonical financial transaction.
 */
idempotencyRecordSchema.statics.findByTransaction =
  async function (
    tenantId,
    transactionId,
    {
      session = null,
    } = {}
  ) {
    const query = this.find({
      tenantId,
      transactionId,
    })
      .sort({
        createdAt: -1,
        _id: -1,
      });

    if (session) {
      query.session(session);
    }

    return query.exec();
  };

/**
 * Find operations requiring recovery.
 */
idempotencyRecordSchema.statics.findRecoveryCandidates =
  async function (
    {
      limit = 100,
      session = null,
    } = {}
  ) {
    const numericLimit = Math.min(
      Math.max(Number(limit) || 100, 1),
      500
    );

    const query = this.find({
      status: 'RECOVERY_REQUIRED',
    })
      .sort({
        recoveryRequiredAt: 1,
        _id: 1,
      })
      .limit(numericLimit);

    if (session) {
      query.session(session);
    }

    return query.exec();
  };

/**
 * Find processing records whose lease has expired.
 *
 * These records are candidates for transition to RECOVERY_REQUIRED.
 */
idempotencyRecordSchema.statics.findExpiredProcessing =
  async function (
    {
      tenantId = null,
      limit = 100,
      now = new Date(),
      session = null,
    } = {}
  ) {
    const filter = {
      status: 'PROCESSING',
      processingLeaseExpiresAt: {
        $lte: now,
      },
    };

    if (tenantId) {
      filter.tenantId = tenantId;
    }

    const numericLimit = Math.min(
      Math.max(Number(limit) || 100, 1),
      500
    );

    const query = this.find(filter)
      .sort({
        processingLeaseExpiresAt: 1,
        _id: 1,
      })
      .limit(numericLimit);

    if (session) {
      query.session(session);
    }

    return query.exec();
  };

// =============================================================================
// Read helpers
// =============================================================================

idempotencyRecordSchema.methods.isProcessing =
  function () {
    return this.status === 'PROCESSING';
  };

idempotencyRecordSchema.methods.isTerminal =
  function () {
    return isTerminalStatus(this.status);
  };

idempotencyRecordSchema.methods.isRecoveryRequired =
  function () {
    return this.status === 'RECOVERY_REQUIRED';
  };

idempotencyRecordSchema.methods.isLeaseExpired =
  function (
    referenceDate = new Date()
  ) {
    if (!this.processingLeaseExpiresAt) {
      return false;
    }

    return (
      referenceDate >=
      this.processingLeaseExpiresAt
    );
  };

idempotencyRecordSchema.methods.canReplay =
  function () {
    return (
      this.status === 'COMPLETED' ||
      this.status === 'FAILED'
    );
  };

idempotencyRecordSchema.methods.getReplayResponse =
  function () {
    if (!this.canReplay()) {
      return null;
    }

    return {
      status: this.httpStatus,
      resultType: this.resultType,
      body:
        this.response?.body ??
        this.responseBody ??
        null,
      contentType:
        this.response?.contentType ??
        'application/json',
    };
  };

// =============================================================================
// JSON serialization
// =============================================================================

idempotencyRecordSchema.set(
  'toJSON',
  {
    transform(
      doc,
      ret
    ) {
      delete ret.__v;

      /**
       * Do not expose request fingerprint or internal processing data through
       * generic API serialization.
       */
      delete ret.requestFingerprint;
      delete ret.processingLeaseExpiresAt;
      delete ret.lastProcessingHeartbeatAt;

      return ret;
    },
  }
);

// =============================================================================
// Model
// =============================================================================

const IdempotencyRecord =
  mongoose.models.IdempotencyRecord ||
  mongoose.model(
    'IdempotencyRecord',
    idempotencyRecordSchema
  );

// =============================================================================
// Exports
// =============================================================================

export default IdempotencyRecord;

export {
  IDEMPOTENCY_STATUSES,
  IDEMPOTENCY_RESULT_TYPES,
  TERMINAL_STATUSES,
};