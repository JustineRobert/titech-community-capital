'use strict';

/**
 * ============================================================================
 * TITech Community Capital
 * Billing Operation Model / Repository
 * ============================================================================
 *
 * File:
 *
 *   backend/modules/models/BillingOperation.js
 *
 * Persistent coordination and idempotency model for tenant billing operations.
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 *
 * - Persistent idempotency
 * - Atomic operation creation
 * - Duplicate operation protection
 * - Atomic worker claiming
 * - Claim lease management
 * - Expired claim recovery
 * - Operation state tracking
 * - Result persistence
 * - Failure persistence
 * - Retry coordination
 * - Optimistic concurrency support
 *
 * Supported Operation Types
 * ----------------------------------------------------------------------------
 *
 * - subscription_renewal
 * - invoice_generation
 * - subscription_proration
 * - invoice_payment
 * - payment_recovery
 * - payment_callback
 * - webhook
 * - billing_retry
 * - custom
 *
 * Operation Lifecycle
 * ----------------------------------------------------------------------------
 *
 *                     ┌──────────────┐
 *                     │   pending    │
 *                     └──────┬───────┘
 *                            │
 *                            ▼
 *                     ┌──────────────┐
 *                     │   claimed    │
 *                     └──────┬───────┘
 *                            │
 *                            ▼
 *                     ┌──────────────┐
 *                     │  processing  │
 *                     └───┬─────┬────┘
 *                         │     │
 *                  success│     │failure
 *                         │     │
 *                         ▼     ▼
 *                  ┌────────┐ ┌────────┐
 *                  │succeeded│ │ failed │
 *                  └────────┘ └────┬───┘
 *                                  │
 *                                  ▼
 *                           recovery_required
 *
 * Atomicity
 * ----------------------------------------------------------------------------
 *
 * operationKey has a database-level UNIQUE index.
 *
 * This guarantees that repeated queue jobs, API retries, webhook replays,
 * concurrent workers, and process restarts cannot independently create
 * multiple billing operations for the same deterministic business operation.
 *
 * Architecture
 * ----------------------------------------------------------------------------
 *
 * This module exports:
 *
 *   - BillingOperationModel
 *   - BillingOperationRepository
 *   - BillingOperationError
 *   - createBillingOperationRepository()
 *
 * The repository can wrap:
 *
 *   - A Mongoose model
 *   - A compatible db repository
 *   - A custom persistence adapter
 *
 * No existing folder architecture needs to change.
 *
 * ============================================================================
 */

const crypto = require('crypto');

/**
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

const OPERATION_STATUSES = Object.freeze({
  PENDING: 'pending',
  CLAIMED: 'claimed',
  PROCESSING: 'processing',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  RECOVERY_REQUIRED: 'recovery_required',
  CANCELLED: 'cancelled',
});

const TERMINAL_STATUSES = Object.freeze([
  OPERATION_STATUSES.SUCCEEDED,
  OPERATION_STATUSES.CANCELLED,
]);

const CLAIMABLE_STATUSES = Object.freeze([
  OPERATION_STATUSES.PENDING,
  OPERATION_STATUSES.FAILED,
  OPERATION_STATUSES.RECOVERY_REQUIRED,
]);

const ACTIVE_STATUSES = Object.freeze([
  OPERATION_STATUSES.CLAIMED,
  OPERATION_STATUSES.PROCESSING,
]);

const DEFAULT_OPERATION_TYPES = Object.freeze([
  'subscription_renewal',
  'invoice_generation',
  'subscription_proration',
  'invoice_payment',
  'payment_recovery',
  'payment_callback',
  'webhook',
  'billing_retry',
  'custom',
]);

/**
 * ============================================================================
 * ERROR TYPES
 * ============================================================================
 */

class BillingOperationError extends Error {
  constructor(
    message,
    {
      code = 'BILLING_OPERATION_ERROR',
      statusCode = 400,
      details = undefined,
      cause = undefined,
    } = {}
  ) {
    super(message);

    this.name = 'BillingOperationError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;

    if (cause) {
      this.cause = cause;
    }

    Error.captureStackTrace?.(
      this,
      BillingOperationError
    );
  }
}

/**
 * ============================================================================
 * MONGOOSE SCHEMA FACTORY
 * ============================================================================
 *
 * The schema factory intentionally accepts mongoose as an argument.
 *
 * This prevents the repository abstraction from forcing mongoose as a hard
 * dependency in environments where db.* provides another persistence adapter.
 *
 * Usage:
 *
 * const mongoose = require('mongoose');
 *
 * const BillingOperation =
 *   createBillingOperationModel(mongoose);
 *
 * ============================================================================
 */

function createBillingOperationSchema(
  mongoose,
  {
    collection = 'billing_operations',
    timestamps = false,
  } = {}
) {
  if (!mongoose?.Schema) {
    throw new BillingOperationError(
      'A valid mongoose instance is required to create the BillingOperation schema.',
      {
        code: 'MONGOOSE_REQUIRED',
        statusCode: 500,
      }
    );
  }

  const { Schema } = mongoose;

  const BillingOperationSchema =
    new Schema(
      {
        /**
         * Stable application-level identifier.
         *
         * This is intentionally separate from MongoDB _id so existing
         * services can consistently use entity.id.
         */
        id: {
          type: String,
          required: true,
          immutable: true,
          default: () => crypto.randomUUID(),
          index: true,
        },

        /**
         * Deterministic business operation key.
         *
         * This is the authoritative persistent idempotency key.
         */
        operationKey: {
          type: String,
          required: true,
          trim: true,
          immutable: true,
          unique: true,
          index: true,
        },

        operationType: {
          type: String,
          required: true,
          trim: true,
          index: true,
          default: 'custom',
        },

        /**
         * Tenant ownership.
         */
        tenantId: {
          type: String,
          required: false,
          index: true,
        },

        /**
         * Related subscription.
         */
        subscriptionId: {
          type: String,
          required: false,
          index: true,
        },

        /**
         * Related invoice.
         */
        invoiceId: {
          type: String,
          required: false,
          index: true,
        },

        /**
         * Optional provider/payment reference.
         */
        paymentId: {
          type: String,
          required: false,
          index: true,
        },

        status: {
          type: String,
          required: true,
          enum: Object.values(
            OPERATION_STATUSES
          ),
          default: OPERATION_STATUSES.PENDING,
          index: true,
        },

        /**
         * Optional finer-grained application state.
         *
         * status answers:
         *
         *   What is the durable operation lifecycle state?
         *
         * state answers:
         *
         *   Where inside the business workflow is execution?
         */
        state: {
          type: String,
          required: false,
          default: 'created',
          index: true,
        },

        /**
         * Number of successful claims.
         */
        attemptCount: {
          type: Number,
          required: true,
          default: 0,
          min: 0,
        },

        maxAttempts: {
          type: Number,
          required: true,
          default: 3,
          min: 1,
        },

        /**
         * Random ownership token returned to the worker that successfully
         * claimed the operation.
         *
         * complete() and fail() can require this token, preventing an expired
         * or superseded worker from finalizing another worker's operation.
         */
        claimToken: {
          type: String,
          required: false,
          default: null,
          index: true,
        },

        claimedBy: {
          type: String,
          required: false,
          default: null,
          index: true,
        },

        claimedAt: {
          type: Date,
          required: false,
          default: null,
          index: true,
        },

        /**
         * Lease expiration.
         *
         * If a worker crashes or becomes unavailable, another worker can
         * reclaim the operation after this timestamp.
         */
        claimExpiresAt: {
          type: Date,
          required: false,
          default: null,
          index: true,
        },

        processingStartedAt: {
          type: Date,
          required: false,
          default: null,
        },

        completedAt: {
          type: Date,
          required: false,
          default: null,
          index: true,
        },

        failedAt: {
          type: Date,
          required: false,
          default: null,
          index: true,
        },

        /**
         * Hash of normalized request/business input.
         *
         * Useful for detecting accidental reuse of an operation key for a
         * different business payload.
         */
        requestHash: {
          type: String,
          required: false,
          default: null,
          index: true,
        },

        /**
         * Persisted successful result.
         *
         * Keep this bounded at the application layer. Large financial payloads
         * should be referenced rather than duplicated.
         */
        result: {
          type: Schema.Types.Mixed,
          required: false,
          default: null,
        },

        /**
         * Stable reference for lightweight recovery.
         *
         * Examples:
         *
         * invoiceId
         * invoiceNumber
         * paymentId
         * subscriptionId
         */
        resultReference: {
          type: String,
          required: false,
          default: null,
          index: true,
        },

        /**
         * Sanitized failure information.
         */
        error: {
          message: {
            type: String,
            required: false,
            default: null,
          },

          code: {
            type: String,
            required: false,
            default: null,
            index: true,
          },

          details: {
            type: Schema.Types.Mixed,
            required: false,
            default: null,
          },
        },

        failureCode: {
          type: String,
          required: false,
          default: null,
          index: true,
        },

        /**
         * Application metadata.
         *
         * Must never contain payment credentials, access tokens, or raw
         * sensitive authentication material.
         */
        metadata: {
          type: Schema.Types.Mixed,
          required: true,
          default: {},
        },

        /**
         * Optimistic concurrency/version marker.
         */
        version: {
          type: Number,
          required: true,
          default: 1,
          min: 1,
        },

        createdAt: {
          type: Date,
          required: true,
          default: Date.now,
          immutable: true,
          index: true,
        },

        updatedAt: {
          type: Date,
          required: true,
          default: Date.now,
        },
      },
      {
        collection,
        timestamps,
        minimize: false,
        strict: true,
        versionKey: false,
      }
    );

  /**
   * ==========================================================================
   * INDEXES
   * ==========================================================================
   */

  /**
   * Primary atomic idempotency guarantee.
   */
  BillingOperationSchema.index(
    {
      operationKey: 1,
    },
    {
      unique: true,
      name: 'uniq_billing_operation_key',
    }
  );

  /**
   * Efficient worker scans.
   */
  BillingOperationSchema.index(
    {
      status: 1,
      claimExpiresAt: 1,
    },
    {
      name: 'billing_operation_claim_scan',
    }
  );

  /**
   * Tenant operational history.
   */
  BillingOperationSchema.index(
    {
      tenantId: 1,
      operationType: 1,
      createdAt: -1,
    },
    {
      name: 'billing_operation_tenant_history',
    }
  );

  /**
   * Subscription renewal history.
   */
  BillingOperationSchema.index(
    {
      subscriptionId: 1,
      operationType: 1,
      createdAt: -1,
    },
    {
      name: 'billing_operation_subscription_history',
    }
  );

  /**
   * Invoice/payment recovery lookup.
   */
  BillingOperationSchema.index(
    {
      invoiceId: 1,
      operationType: 1,
      status: 1,
    },
    {
      name: 'billing_operation_invoice_lookup',
    }
  );

  /**
   * Payment lookup.
   */
  BillingOperationSchema.index(
    {
      paymentId: 1,
      createdAt: -1,
    },
    {
      name: 'billing_operation_payment_lookup',
    }
  );

  return BillingOperationSchema;
}

/**
 * ============================================================================
 * MONGOOSE MODEL FACTORY
 * ============================================================================
 */

function createBillingOperationModel(
  mongoose,
  options = {}
) {
  if (!mongoose?.model) {
    throw new BillingOperationError(
      'A valid mongoose instance is required.',
      {
        code: 'MONGOOSE_REQUIRED',
        statusCode: 500,
      }
    );
  }

  const modelName =
    options.modelName ||
    'BillingOperation';

  /**
   * Prevent OverwriteModelError during hot reload/test environments.
   */
  if (
    mongoose.models?.[
      modelName
    ]
  ) {
    return mongoose.models[
      modelName
    ];
  }

  const schema =
    createBillingOperationSchema(
      mongoose,
      options
    );

  return mongoose.model(
    modelName,
    schema
  );
}

/**
 * ============================================================================
 * REPOSITORY
 * ============================================================================
 */

class BillingOperationRepository {
  constructor(
    persistence,
    {
      logger = console,

      defaultMaxAttempts = 3,

      defaultClaimLeaseMs =
        5 * 60 * 1000,

      strictRequestHash = true,

      clock = () => new Date(),
    } = {}
  ) {
    if (!persistence) {
      throw new BillingOperationError(
        'BillingOperation persistence dependency is required.',
        {
          code:
            'BILLING_OPERATION_PERSISTENCE_REQUIRED',
          statusCode: 500,
        }
      );
    }

    this.persistence =
      persistence;

    this.logger =
      logger || console;

    this.defaultMaxAttempts =
      this.normalizePositiveInteger(
        defaultMaxAttempts,
        3
      );

    this.defaultClaimLeaseMs =
      this.normalizePositiveInteger(
        defaultClaimLeaseMs,
        5 * 60 * 1000
      );

    this.strictRequestHash =
      strictRequestHash !== false;

    this.clock =
      typeof clock === 'function'
        ? clock
        : () => new Date();
  }

  /**
   * ==========================================================================
   * BASIC REPOSITORY API
   * ==========================================================================
   */

  async create(
    payload = {}
  ) {
    const entity =
      this.buildOperationEntity(
        payload
      );

    try {
      const created =
        await this.persistence.create(
          entity
        );

      return this.normalizeEntity(
        created || entity
      );
    } catch (error) {
      if (
        this.isDuplicateKeyError(
          error
        )
      ) {
        throw new BillingOperationError(
          'Billing operation already exists.',
          {
            code:
              'BILLING_OPERATION_EXISTS',
            statusCode: 409,
            details: {
              operationKey:
                entity.operationKey,
            },
            cause: error,
          }
        );
      }

      throw error;
    }
  }

  async findOne(
    query = {}
  ) {
    const result =
      await this.persistence.findOne(
        query
      );

    return this.normalizeEntity(
      result
    );
  }

  async findById(
    id
  ) {
    this.assertRequired(
      id,
      'id'
    );

    const result =
      await this.persistence.findById(
        id
      );

    return this.normalizeEntity(
      result
    );
  }

  async update(
    id,
    updates = {}
  ) {
    this.assertRequired(
      id,
      'id'
    );

    const existing =
      await this.findById(
        id
      );

    if (!existing) {
      return null;
    }

    const next =
      this.buildUpdatedEntity(
        existing,
        updates
      );

    const result =
      await this.persistence.update(
        id,
        next
      );

    return this.normalizeEntity(
      result || next
    );
  }

  /**
   * Repository-compatible findOneAndUpdate.
   *
   * Native Mongo/Mongoose adapters will receive the atomic query directly.
   *
   * Simpler repositories fall back to findOne + update.
   */
  async findOneAndUpdate(
    query = {},
    updates = {},
    options = {}
  ) {
    if (
      typeof this.persistence
        .findOneAndUpdate ===
      'function'
    ) {
      const result =
        await this.persistence
          .findOneAndUpdate(
            query,
            updates,
            options
          );

      return this.normalizeEntity(
        result
      );
    }

    const existing =
      await this.findOne(
        query
      );

    if (!existing) {
      return null;
    }

    return this.update(
      existing.id ||
      existing._id,
      updates
    );
  }

  /**
   * ==========================================================================
   * ATOMIC CREATE OR GET
   * ==========================================================================
   *
   * Preferred implementation:
   *
   * MongoDB:
   *
   * findOneAndUpdate(
   *   { operationKey },
   *   { $setOnInsert: entity },
   *   { upsert: true, new: true }
   * )
   *
   * The database unique index remains the final concurrency authority.
   */

  async createOrGet(
    payload = {}
  ) {
    const entity =
      this.buildOperationEntity(
        payload
      );

    /**
     * Native atomic upsert path.
     */
    if (
      typeof this.persistence
        .findOneAndUpdate ===
      'function'
    ) {
      try {
        const existingBefore =
          await this.findOne({
            operationKey:
              entity.operationKey,
          });

        if (existingBefore) {
          this.assertRequestHashCompatible(
            existingBefore,
            entity.requestHash
          );

          return {
            operation:
              existingBefore,

            created:
              false,
          };
        }

        const result =
          await this.persistence
            .findOneAndUpdate(
              {
                operationKey:
                  entity.operationKey,
              },
              {
                $setOnInsert:
                  entity,
              },
              {
                upsert: true,
                new: true,
                returnDocument: 'after',
              }
            );

        const operation =
          this.normalizeEntity(
            result
          );

        this.assertRequestHashCompatible(
          operation,
          entity.requestHash
        );

        /**
         * If the persistence layer exposes no metadata describing whether
         * an insert occurred, perform a deterministic ownership check.
         *
         * createdAt equality is not treated as a financial correctness
         * guarantee; the operationKey unique index remains authoritative.
         */
        const created =
          operation?.id === entity.id;

        return {
          operation,
          created,
        };
      } catch (error) {
        if (
          this.isDuplicateKeyError(
            error
          )
        ) {
          const existing =
            await this.findOne({
              operationKey:
                entity.operationKey,
            });

          if (!existing) {
            throw error;
          }

          this.assertRequestHashCompatible(
            existing,
            entity.requestHash
          );

          return {
            operation:
              existing,

            created:
              false,
          };
        }

        throw error;
      }
    }

    /**
     * Generic repository fallback.
     *
     * The unique database index still protects concurrent create attempts.
     */
    const existing =
      await this.findOne({
        operationKey:
          entity.operationKey,
      });

    if (existing) {
      this.assertRequestHashCompatible(
        existing,
        entity.requestHash
      );

      return {
        operation:
          existing,

        created:
          false,
      };
    }

    try {
      const created =
        await this.create(
          entity
        );

      return {
        operation:
          created,

        created:
          true,
      };
    } catch (error) {
      if (
        error?.code !==
          'BILLING_OPERATION_EXISTS' &&
        !this.isDuplicateKeyError(
          error
        )
      ) {
        throw error;
      }

      const duplicate =
        await this.findOne({
          operationKey:
            entity.operationKey,
        });

      if (!duplicate) {
        throw error;
      }

      this.assertRequestHashCompatible(
        duplicate,
        entity.requestHash
      );

      return {
        operation:
          duplicate,

        created:
          false,
      };
    }
  }

  /**
   * ==========================================================================
   * CLAIM
   * ==========================================================================
   *
   * Atomically claims an operation when:
   *
   * - it is pending
   * - it is retryable
   * - it is recovery_required
   * - its existing lease has expired
   *
   * A successful claim returns:
   *
   * {
   *   claimed: true,
   *   claimToken,
   *   operation
   * }
   *
   * A duplicate worker receives:
   *
   * {
   *   claimed: false,
   *   reason: 'already_claimed' | 'already_completed' | ...
   *   operation
   * }
   */

  async claim(
    {
      operationKey,
      operationType = 'custom',
      tenantId = null,
      subscriptionId = null,
      invoiceId = null,
      paymentId = null,
      requestHash = null,
      metadata = {},
      maxAttempts = undefined,
      claimedBy = null,
      leaseMs = undefined,
    } = {}
  ) {
    this.assertRequired(
      operationKey,
      'operationKey'
    );

    const normalizedRequestHash =
      requestHash ||
      null;

    const {
      operation:
        initialOperation,
    } =
      await this.createOrGet({
        operationKey,
        operationType,
        tenantId,
        subscriptionId,
        invoiceId,
        paymentId,
        requestHash:
          normalizedRequestHash,
        metadata,
        maxAttempts,
      });

    this.assertRequestHashCompatible(
      initialOperation,
      normalizedRequestHash
    );

    if (
      initialOperation.status ===
      OPERATION_STATUSES.SUCCEEDED
    ) {
      return {
        claimed: false,

        reason:
          'already_completed',

        operation:
          initialOperation,

        claimToken:
          null,
      };
    }

    if (
      initialOperation.status ===
      OPERATION_STATUSES.CANCELLED
    ) {
      return {
        claimed: false,

        reason:
          'cancelled',

        operation:
          initialOperation,

        claimToken:
          null,
      };
    }

    const now =
      this.now();

    const leaseDuration =
      this.normalizePositiveInteger(
        leaseMs,
        this.defaultClaimLeaseMs
      );

    const claimExpiresAt =
      new Date(
        now.getTime() +
        leaseDuration
      );

    const claimToken =
      crypto.randomUUID();

    const maximumAttempts =
      this.normalizePositiveInteger(
        maxAttempts,
        initialOperation.maxAttempts ||
          this.defaultMaxAttempts
      );

    /**
     * Claim query.
     *
     * The version is included as an additional protection when available.
     *
     * Atomic persistence adapters should evaluate this query inside the
     * database operation.
     */
    const query = {
      operationKey,

      $or: [
        {
          status: {
            $in:
              CLAIMABLE_STATUSES,
          },

          attemptCount: {
            $lt:
              maximumAttempts,
          },
        },

        {
          status: {
            $in:
              ACTIVE_STATUSES,
          },

          claimExpiresAt: {
            $lte: now,
          },

          attemptCount: {
            $lt:
              maximumAttempts,
          },
        },
      ],
    };

    const setFields = {
      status:
        OPERATION_STATUSES.CLAIMED,

      state:
        'claimed',

      claimToken,

      claimedBy:
        claimedBy || null,

      claimedAt:
        now,

      claimExpiresAt,

      completedAt:
        null,

      updatedAt:
        now,
    };

    let claimedOperation =
      null;

    /**
     * Native atomic update path.
     */
    if (
      typeof this.persistence
        .findOneAndUpdate ===
      'function'
    ) {
      claimedOperation =
        this.normalizeEntity(
          await this.persistence
            .findOneAndUpdate(
              query,
              {
                $set:
                  setFields,

                $inc: {
                  attemptCount: 1,
                  version: 1,
                },
              },
              {
                new: true,
                returnDocument:
                  'after',
              }
            )
        );
    } else {
      /**
       * Generic compatibility fallback.
       *
       * The unique operationKey prevents duplicate records.
       *
       * For strict multi-worker atomicity, the persistence adapter should
       * expose findOneAndUpdate or equivalent compare-and-set semantics.
       */
      const current =
        await this.findOne({
          operationKey,
        });

      if (
        current &&
        this.canClaimOperation(
          current,
          now,
          maximumAttempts
        )
      ) {
        claimedOperation =
          await this.update(
            current.id ||
            current._id,
            {
              ...current,
              ...setFields,

              attemptCount:
                Number(
                  current.attemptCount || 0
                ) + 1,

              version:
                Number(
                  current.version || 0
                ) + 1,
            }
          );
      }
    }

    if (claimedOperation) {
      return {
        claimed: true,

        reason:
          'claimed',

        operation:
          claimedOperation,

        claimToken,
      };
    }

    const current =
      await this.findOne({
        operationKey,
      });

    if (!current) {
      throw new BillingOperationError(
        'Billing operation disappeared during claim processing.',
        {
          code:
            'BILLING_OPERATION_CLAIM_LOST',
          statusCode: 409,
          details: {
            operationKey,
          },
        }
      );
    }

    if (
      current.status ===
      OPERATION_STATUSES.SUCCEEDED
    ) {
      return {
        claimed: false,

        reason:
          'already_completed',

        operation:
          current,

        claimToken:
          null,
      };
    }

    if (
      ACTIVE_STATUSES.includes(
        current.status
      ) &&
      current.claimExpiresAt &&
      new Date(
        current.claimExpiresAt
      ) > now
    ) {
      return {
        claimed: false,

        reason:
          'already_claimed',

        operation:
          current,

        claimToken:
          null,
      };
    }

    if (
      Number(
        current.attemptCount || 0
      ) >=
      Number(
        current.maxAttempts ||
          maximumAttempts
      )
    ) {
      return {
        claimed: false,

        reason:
          'max_attempts_exceeded',

        operation:
          current,

        claimToken:
          null,
      };
    }

    return {
      claimed: false,

      reason:
        'not_claimable',

      operation:
        current,

      claimToken:
        null,
    };
  }

  /**
   * ==========================================================================
   * MARK PROCESSING
   * ==========================================================================
   */

  async markProcessing(
    operationId,
    {
      claimToken,
      state = 'processing',
    } = {}
  ) {
    this.assertRequired(
      operationId,
      'operationId'
    );

    this.assertRequired(
      claimToken,
      'claimToken'
    );

    const now =
      this.now();

    const query = {
      $and: [
        this.idQuery(
          operationId
        ),

        {
          status:
            OPERATION_STATUSES.CLAIMED,
        },

        {
          claimToken,
        },

        {
          claimExpiresAt: {
            $gt: now,
          },
        },
      ],
    };

    const updates = {
      $set: {
        status:
          OPERATION_STATUSES.PROCESSING,

        state,

        processingStartedAt:
          now,

        updatedAt:
          now,
      },

      $inc: {
        version: 1,
      },
    };

    const updated =
      await this.atomicFindOneAndUpdate(
        query,
        updates
      );

    if (!updated) {
      throw new BillingOperationError(
        'Billing operation could not be transitioned to processing.',
        {
          code:
            'BILLING_OPERATION_PROCESSING_CLAIM_INVALID',
          statusCode: 409,
          details: {
            operationId,
          },
        }
      );
    }

    return updated;
  }

  /**
   * ==========================================================================
   * COMPLETE
   * ==========================================================================
   */

  async complete(
    operationId,
    {
      claimToken = null,
      result = null,
      resultReference = null,
      state = 'completed',
      metadata = undefined,
    } = {}
  ) {
    this.assertRequired(
      operationId,
      'operationId'
    );

    const now =
      this.now();

    const ownershipQuery =
      claimToken
        ? {
            $or: [
              {
                claimToken,
              },

              {
                status:
                  OPERATION_STATUSES.SUCCEEDED,
              },
            ],
          }
        : {};

    const query = {
      $and: [
        this.idQuery(
          operationId
        ),

        ownershipQuery,
      ],
    };

    const setFields = {
      status:
        OPERATION_STATUSES.SUCCEEDED,

      state,

      result:
        this.cloneSafe(
          result
        ),

      resultReference:
        resultReference ||
        this.extractResultReference(
          result
        ),

      completedAt:
        now,

      failedAt:
        null,

      failureCode:
        null,

      error: {
        message:
          null,

        code:
          null,

        details:
          null,
      },

      claimToken:
        null,

      claimedBy:
        null,

      claimExpiresAt:
        null,

      updatedAt:
        now,
    };

    if (
      metadata !== undefined
    ) {
      setFields.metadata =
        this.cloneSafe(
          metadata
        );
    }

    const updated =
      await this.atomicFindOneAndUpdate(
        query,
        {
          $set:
            setFields,

          $inc: {
            version: 1,
          },
        }
      );

    if (updated) {
      return updated;
    }

    /**
     * Idempotent completion fallback.
     */
    const existing =
      await this.findById(
        operationId
      );

    if (
      existing?.status ===
      OPERATION_STATUSES.SUCCEEDED
    ) {
      return existing;
    }

    throw new BillingOperationError(
      'Billing operation completion failed because the claim is no longer valid.',
      {
        code:
          'BILLING_OPERATION_COMPLETE_CLAIM_INVALID',
        statusCode: 409,
        details: {
          operationId,
        },
      }
    );
  }

  /**
   * ==========================================================================
   * FAIL
   * ==========================================================================
   */

  async fail(
    operationId,
    error,
    {
      claimToken = null,
      failureCode = null,
      recoverable = true,
      state = null,
      metadata = undefined,
    } = {}
  ) {
    this.assertRequired(
      operationId,
      'operationId'
    );

    const now =
      this.now();

    const sanitizedError =
      this.normalizeError(
        error
      );

    const targetStatus =
      recoverable
        ? OPERATION_STATUSES.FAILED
        : OPERATION_STATUSES.RECOVERY_REQUIRED;

    const ownershipQuery =
      claimToken
        ? {
            claimToken,
          }
        : {};

    const query = {
      $and: [
        this.idQuery(
          operationId
        ),

        {
          status: {
            $in:
              ACTIVE_STATUSES,
          },
        },

        ownershipQuery,
      ],
    };

    const setFields = {
      status:
        targetStatus,

      state:
        state ||
        (
          recoverable
            ? 'failed'
            : 'recovery_required'
        ),

      failedAt:
        now,

      failureCode:
        failureCode ||
        sanitizedError.code ||
        'BILLING_OPERATION_FAILED',

      error:
        sanitizedError,

      claimToken:
        null,

      claimedBy:
        null,

      claimExpiresAt:
        null,

      updatedAt:
        now,
    };

    if (
      metadata !== undefined
    ) {
      setFields.metadata =
        this.cloneSafe(
          metadata
        );
    }

    const updated =
      await this.atomicFindOneAndUpdate(
        query,
        {
          $set:
            setFields,

          $inc: {
            version: 1,
          },
        }
      );

    if (updated) {
      return updated;
    }

    /**
     * Idempotent failure fallback.
     */
    const existing =
      await this.findById(
        operationId
      );

    if (
      existing &&
      (
        existing.status ===
          OPERATION_STATUSES.FAILED ||
        existing.status ===
          OPERATION_STATUSES.RECOVERY_REQUIRED
      )
    ) {
      return existing;
    }

    throw new BillingOperationError(
      'Billing operation failure could not be persisted because the claim is no longer valid.',
      {
        code:
          'BILLING_OPERATION_FAIL_CLAIM_INVALID',
        statusCode: 409,
        details: {
          operationId,
        },
      }
    );
  }

  /**
   * ==========================================================================
   * RELEASE EXPIRED CLAIMS
   * ==========================================================================
   *
   * Releases operations abandoned by crashed workers.
   *
   * Expired operations become:
   *
   * pending
   *
   * when retry attempts remain.
   *
   * Otherwise:
   *
   * recovery_required
   */

  async releaseExpiredClaims(
    {
      limit = 1000,
    } = {}
  ) {
    const now =
      this.now();

    const normalizedLimit =
      this.normalizePositiveInteger(
        limit,
        1000
      );

    const query = {
      status: {
        $in:
          ACTIVE_STATUSES,
      },

      claimExpiresAt: {
        $lte: now,
      },
    };

    const expired =
      await this.findMany(
        query,
        {
          limit:
            normalizedLimit,
        }
      );

    const released = [];
    const recoveryRequired = [];

    for (
      const operation of expired
    ) {
      try {
        const attempts =
          Number(
            operation.attemptCount || 0
          );

        const maxAttempts =
          Number(
            operation.maxAttempts ||
              this.defaultMaxAttempts
          );

        const shouldRecover =
          attempts >=
          maxAttempts;

        const queryForUpdate = {
          $and: [
            this.idQuery(
              operation.id ||
              operation._id
            ),

            {
              status: {
                $in:
                  ACTIVE_STATUSES,
              },
            },

            {
              claimExpiresAt: {
                $lte: now,
              },
            },
          ],
        };

        const updated =
          await this.atomicFindOneAndUpdate(
            queryForUpdate,
            {
              $set: {
                status:
                  shouldRecover
                    ? OPERATION_STATUSES
                        .RECOVERY_REQUIRED
                    : OPERATION_STATUSES
                        .PENDING,

                state:
                  shouldRecover
                    ? 'claim_expired_max_attempts'
                    : 'claim_expired_released',

                claimToken:
                  null,

                claimedBy:
                  null,

                claimedAt:
                  null,

                claimExpiresAt:
                  null,

                failureCode:
                  shouldRecover
                    ? 'CLAIM_LEASE_EXPIRED_MAX_ATTEMPTS'
                    : operation.failureCode,

                updatedAt:
                  now,
              },

              $inc: {
                version: 1,
              },
            }
          );

        if (!updated) {
          continue;
        }

        if (shouldRecover) {
          recoveryRequired.push(
            updated
          );
        } else {
          released.push(
            updated
          );
        }
      } catch (error) {
        this.logWarn(
          'Failed releasing expired billing operation claim.',
          {
            operationId:
              operation.id ||
              operation._id,

            error:
              error?.message,
          }
        );
      }
    }

    return {
      scanned:
        expired.length,

      released,

      recoveryRequired,

      timestamp:
        now,
    };
  }

  /**
   * ==========================================================================
   * ENTITY HELPERS
   * ==========================================================================
   */

  buildOperationEntity(
    payload = {}
  ) {
    this.assertRequired(
      payload.operationKey,
      'operationKey'
    );

    const now =
      this.now();

    const operationType =
      String(
        payload.operationType ||
          'custom'
      )
        .trim()
        .toLowerCase();

    const maxAttempts =
      this.normalizePositiveInteger(
        payload.maxAttempts,
        this.defaultMaxAttempts
      );

    return {
      id:
        payload.id ||
        crypto.randomUUID(),

      operationKey:
        String(
          payload.operationKey
        ).trim(),

      operationType,

      tenantId:
        this.normalizeNullableString(
          payload.tenantId
        ),

      subscriptionId:
        this.normalizeNullableString(
          payload.subscriptionId
        ),

      invoiceId:
        this.normalizeNullableString(
          payload.invoiceId
        ),

      paymentId:
        this.normalizeNullableString(
          payload.paymentId
        ),

      status:
        payload.status ||
        OPERATION_STATUSES.PENDING,

      state:
        payload.state ||
        'created',

      attemptCount:
        Number(
          payload.attemptCount || 0
        ),

      maxAttempts,

      claimToken:
        payload.claimToken ||
        null,

      claimedBy:
        payload.claimedBy ||
        null,

      claimedAt:
        payload.claimedAt ||
        null,

      claimExpiresAt:
        payload.claimExpiresAt ||
        null,

      processingStartedAt:
        payload.processingStartedAt ||
        null,

      completedAt:
        payload.completedAt ||
        null,

      failedAt:
        payload.failedAt ||
        null,

      requestHash:
        payload.requestHash ||
        null,

      result:
        payload.result !== undefined
          ? this.cloneSafe(
              payload.result
            )
          : null,

      resultReference:
        payload.resultReference ||
        null,

      error:
        payload.error
          ? this.normalizeError(
              payload.error
            )
          : {
              message:
                null,

              code:
                null,

              details:
                null,
            },

      failureCode:
        payload.failureCode ||
        null,

      metadata:
        this.cloneSafe(
          payload.metadata ||
            {}
        ),

      version:
        Number(
          payload.version || 1
        ),

      createdAt:
        payload.createdAt ||
        now,

      updatedAt:
        payload.updatedAt ||
        now,
    };
  }

  buildUpdatedEntity(
    existing,
    updates = {}
  ) {
    const next = {
      ...existing,
      ...updates,

      id:
        existing.id,

      operationKey:
        existing.operationKey,

      createdAt:
        existing.createdAt,

      updatedAt:
        this.now(),

      version:
        Number(
          existing.version || 0
        ) + 1,
    };

    return this.normalizeEntity(
      next
    );
  }

  normalizeEntity(
    entity
  ) {
    if (!entity) {
      return null;
    }

    /**
     * Mongoose documents.
     */
    if (
      typeof entity.toObject ===
      'function'
    ) {
      entity =
        entity.toObject();
    }

    const normalized = {
      ...entity,
    };

    if (
      !normalized.id &&
      normalized._id
    ) {
      normalized.id =
        String(
          normalized._id
        );
    }

    return normalized;
  }

  /**
   * ==========================================================================
   * PERSISTENCE HELPERS
   * ==========================================================================
   */

  async atomicFindOneAndUpdate(
    query,
    updates
  ) {
    if (
      typeof this.persistence
        .findOneAndUpdate ===
      'function'
    ) {
      return this.normalizeEntity(
        await this.persistence
          .findOneAndUpdate(
            query,
            updates,
            {
              new: true,
              returnDocument:
                'after',
            }
          )
      );
    }

    /**
     * Generic fallback.
     *
     * This preserves compatibility but cannot independently manufacture
     * atomic compare-and-set behavior if the underlying persistence adapter
     * only exposes read + update.
     */
    const existing =
      await this.findOne(
        query
      );

    if (!existing) {
      return null;
    }

    const next =
      this.applyMongoStyleUpdates(
        existing,
        updates
      );

    return this.update(
      existing.id ||
      existing._id,
      next
    );
  }

  async findMany(
    query = {},
    {
      limit = undefined,
    } = {}
  ) {
    if (
      typeof this.persistence.find ===
      'function'
    ) {
      let result =
        await this.persistence.find(
          query
        );

      if (
        Array.isArray(
          result
        )
      ) {
        if (
          Number.isFinite(
            Number(limit)
          )
        ) {
          result =
            result.slice(
              0,
              Number(limit)
            );
        }

        return result.map(
          (item) =>
            this.normalizeEntity(
              item
            )
        );
      }

      /**
       * Some query builders expose .limit().
       */
      if (
        result &&
        typeof result.limit ===
          'function'
      ) {
        if (
          Number.isFinite(
            Number(limit)
          )
        ) {
          result =
            result.limit(
              Number(limit)
            );
        }

        const resolved =
          await result;

        return Array.isArray(
          resolved
        )
          ? resolved.map(
              (item) =>
                this.normalizeEntity(
                  item
                )
            )
          : [];
      }

      return [];
    }

    throw new BillingOperationError(
      'Billing operation persistence does not support find().',
      {
        code:
          'BILLING_OPERATION_FIND_UNSUPPORTED',
        statusCode: 500,
      }
    );
  }

  applyMongoStyleUpdates(
    entity,
    updates = {}
  ) {
    const result = {
      ...entity,
    };

    if (updates.$set) {
      Object.assign(
        result,
        updates.$set
      );
    }

    if (updates.$inc) {
      for (
        const [
          key,
          value,
        ] of Object.entries(
          updates.$inc
        )
      ) {
        result[key] =
          Number(
            result[key] || 0
          ) +
          Number(value);
      }
    }

    /**
     * Plain update compatibility.
     */
    if (
      !updates.$set &&
      !updates.$inc
    ) {
      Object.assign(
        result,
        updates
      );
    }

    return result;
  }

  idQuery(
    operationId
  ) {
    return {
      $or: [
        {
          id:
            String(
              operationId
            ),
        },

        {
          _id:
            operationId,
        },
      ],
    };
  }

  /**
   * ==========================================================================
   * CLAIMABILITY
   * ==========================================================================
   */

  canClaimOperation(
    operation,
    now,
    maximumAttempts
  ) {
    if (!operation) {
      return false;
    }

    if (
      TERMINAL_STATUSES.includes(
        operation.status
      )
    ) {
      return false;
    }

    const attempts =
      Number(
        operation.attemptCount || 0
      );

    const maxAttempts =
      Number(
        operation.maxAttempts ||
          maximumAttempts ||
          this.defaultMaxAttempts
      );

    if (
      attempts >=
      maxAttempts
    ) {
      return false;
    }

    if (
      CLAIMABLE_STATUSES.includes(
        operation.status
      )
    ) {
      return true;
    }

    if (
      ACTIVE_STATUSES.includes(
        operation.status
      )
    ) {
      if (
        !operation.claimExpiresAt
      ) {
        return false;
      }

      return (
        new Date(
          operation.claimExpiresAt
        ).getTime() <=
        now.getTime()
      );
    }

    return false;
  }

  /**
   * ==========================================================================
   * REQUEST HASH VALIDATION
   * ==========================================================================
   */

  assertRequestHashCompatible(
    operation,
    requestHash
  ) {
    if (
      !this.strictRequestHash ||
      !requestHash ||
      !operation
    ) {
      return;
    }

    if (
      operation.requestHash &&
      operation.requestHash !==
        requestHash
    ) {
      throw new BillingOperationError(
        'The billing operation key was reused with a different request payload.',
        {
          code:
            'BILLING_OPERATION_REQUEST_HASH_CONFLICT',

          statusCode:
            409,

          details: {
            operationKey:
              operation.operationKey,
          },
        }
      );
    }
  }

  /**
   * ==========================================================================
   * RESULT REFERENCES
   * ==========================================================================
   */

  extractResultReference(
    result
  ) {
    if (
      !result ||
      typeof result !==
        'object'
    ) {
      return null;
    }

    return (
      result.invoiceReference ||
      result.invoiceNumber ||
      result.invoiceId ||
      result.paymentId ||
      result.subscriptionId ||
      result.id ||
      null
    );
  }

  /**
   * ==========================================================================
   * ERROR NORMALIZATION
   * ==========================================================================
   */

  normalizeError(
    error
  ) {
    if (!error) {
      return {
        message:
          'Unknown billing operation error',

        code:
          'UNKNOWN_ERROR',

        details:
          null,
      };
    }

    if (
      typeof error ===
      'string'
    ) {
      return {
        message:
          error,

        code:
          'BILLING_OPERATION_ERROR',

        details:
          null,
      };
    }

    return {
      message:
        String(
          error.message ||
            'Billing operation failed'
        ).slice(
          0,
          2000
        ),

      code:
        error.code ||
        error.name ||
        'BILLING_OPERATION_ERROR',

      details:
        this.sanitizeErrorDetails(
          error.details
        ),
    };
  }

  sanitizeErrorDetails(
    details
  ) {
    if (
      details ===
        undefined ||
      details ===
        null
    ) {
      return null;
    }

    return this.cloneSafe(
      details
    );
  }

  /**
   * ==========================================================================
   * VALIDATION
   * ==========================================================================
   */

  assertRequired(
    value,
    field
  ) {
    if (
      value ===
        undefined ||
      value ===
        null ||
      value ===
        ''
    ) {
      throw new BillingOperationError(
        `${field} is required.`,
        {
          code:
            'BILLING_OPERATION_REQUIRED_FIELD',
          statusCode: 400,
          details: {
            field,
          },
        }
      );
    }
  }

  normalizePositiveInteger(
    value,
    fallback
  ) {
    if (
      value ===
        undefined ||
      value ===
        null
    ) {
      return fallback;
    }

    const number =
      Number(value);

    if (
      !Number.isInteger(
        number
      ) ||
      number <= 0
    ) {
      return fallback;
    }

    return number;
  }

  normalizeNullableString(
    value
  ) {
    if (
      value ===
        undefined ||
      value ===
        null ||
      value ===
        ''
    ) {
      return null;
    }

    return String(
      value
    ).trim();
  }

  cloneSafe(
    value
  ) {
    if (
      value ===
        undefined
    ) {
      return undefined;
    }

    if (
      value ===
      null
    ) {
      return null;
    }

    if (
      typeof value !==
      'object'
    ) {
      return value;
    }

    try {
      return JSON.parse(
        JSON.stringify(
          value
        )
      );
    } catch {
      return {};
    }
  }

  now() {
    const value =
      this.clock();

    const date =
      value instanceof Date
        ? value
        : new Date(
            value
          );

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return new Date();
    }

    return date;
  }

  /**
   * ==========================================================================
   * ERROR DETECTION
   * ==========================================================================
   */

  isDuplicateKeyError(
    error
  ) {
    return Boolean(
      error &&
      (
        error.code ===
          11000 ||
        error.code ===
          'DUPLICATE_KEY' ||
        error.code ===
          'BILLING_OPERATION_EXISTS' ||
        /duplicate.*key/i.test(
          error.message ||
            ''
        )
      )
    );
  }

  /**
   * ==========================================================================
   * LOGGING
   * ==========================================================================
   */

  logWarn(
    message,
    context = {}
  ) {
    try {
      if (
        typeof this.logger?.warn ===
        'function'
      ) {
        this.logger.warn(
          message,
          context
        );
      }
    } catch {
      // Logging must never affect billing operation persistence.
    }
  }
}

/**
 * ============================================================================
 * REPOSITORY FACTORY
 * ============================================================================
 *
 * Supports:
 *
 *   createBillingOperationRepository(
 *     db.billingOperations
 *   )
 *
 * or:
 *
 *   createBillingOperationRepository(
 *     BillingOperationModel
 *   )
 *
 * ============================================================================
 */

function createBillingOperationRepository(
  persistence,
  options = {}
) {
  return new BillingOperationRepository(
    persistence,
    options
  );
}

/**
 * ============================================================================
 * EXPORTS
 * ============================================================================
 *
 * Default export preserves simple usage:
 *
 *   const BillingOperation =
 *     require('./models/BillingOperation');
 *
 * Named properties provide:
 *
 *   const {
 *     BillingOperationRepository,
 *     createBillingOperationModel,
 *   } = require('./models/BillingOperation');
 *
 * ============================================================================
 */

module.exports =
  BillingOperationRepository;

module.exports.BillingOperationRepository =
  BillingOperationRepository;

module.exports.BillingOperationError =
  BillingOperationError;

module.exports.createBillingOperationRepository =
  createBillingOperationRepository;

module.exports.createBillingOperationSchema =
  createBillingOperationSchema;

module.exports.createBillingOperationModel =
  createBillingOperationModel;

module.exports.OPERATION_STATUSES =
  OPERATION_STATUSES;

module.exports.TERMINAL_STATUSES =
  TERMINAL_STATUSES;

module.exports.CLAIMABLE_STATUSES =
  CLAIMABLE_STATUSES;

module.exports.ACTIVE_STATUSES =
  ACTIVE_STATUSES;

module.exports.DEFAULT_OPERATION_TYPES =
  DEFAULT_OPERATION_TYPES;