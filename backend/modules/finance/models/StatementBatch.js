'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Finance Core - Statement Batch Model
 * ============================================================================
 *
 * Durable batch coordination record for statement processing.
 *
 * Purpose
 * ----------------------------------------------------------------------------
 *
 * • Group related statement-processing operations
 * • Maintain durable processing counts
 * • Coordinate concurrent workers
 * • Track lifecycle state
 * • Support retry/recovery
 * • Provide audit-friendly batch metadata
 * • Maintain tenant isolation
 *
 * Financial Rule
 * ----------------------------------------------------------------------------
 *
 * A batch is an orchestration object.
 *
 * It is NOT a ledger transaction.
 * It MUST NOT mutate account balances.
 * It MUST NOT replace the Ledger Engine.
 *
 * ============================================================================
 */

const mongoose = require('mongoose');

const {
    Schema
} = mongoose;

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const BATCH_STATUS = Object.freeze({

    CREATED: 'CREATED',

    PROCESSING: 'PROCESSING',

    COMPLETED: 'COMPLETED',

    PARTIAL: 'PARTIAL',

    FAILED: 'FAILED',

    RELEASED: 'RELEASED',

    CANCELLED: 'CANCELLED'
});

const BATCH_TYPES = Object.freeze({

    STATEMENT_IMPORT: 'STATEMENT_IMPORT',

    STATEMENT_PROCESSING: 'STATEMENT_PROCESSING',

    PROVIDER_RECONCILIATION: 'PROVIDER_RECONCILIATION',

    SETTLEMENT: 'SETTLEMENT',

    MANUAL: 'MANUAL'
});

const ALLOWED_TRANSITIONS = Object.freeze({

    CREATED: new Set([
        BATCH_STATUS.PROCESSING,
        BATCH_STATUS.CANCELLED,
        BATCH_STATUS.FAILED
    ]),

    PROCESSING: new Set([
        BATCH_STATUS.COMPLETED,
        BATCH_STATUS.PARTIAL,
        BATCH_STATUS.FAILED,
        BATCH_STATUS.RELEASED,
        BATCH_STATUS.CANCELLED
    ]),

    PARTIAL: new Set([
        BATCH_STATUS.PROCESSING,
        BATCH_STATUS.COMPLETED,
        BATCH_STATUS.FAILED
    ]),

    FAILED: new Set([
        BATCH_STATUS.PROCESSING,
        BATCH_STATUS.RELEASED
    ]),

    RELEASED: new Set([
        BATCH_STATUS.PROCESSING,
        BATCH_STATUS.CANCELLED
    ]),

    COMPLETED: new Set(),

    CANCELLED: new Set()
});

/**
 * ============================================================================
 * Schema
 * ============================================================================
 */

const StatementBatchSchema =
    new Schema(
        {
            /**
             * Tenant boundary.
             */
            tenantId: {
                type: String,
                required: true,
                immutable: true,
                trim: true,
                maxlength: 256,
                index: true
            },

            /**
             * Durable externally-correlatable batch identity.
             */
            batchId: {
                type: String,
                required: true,
                immutable: true,
                trim: true,
                maxlength: 256
            },

            /**
             * Deterministic coordination key.
             *
             * The same tenant cannot own two active/identical logical batches
             * under the same batchKey.
             */
            batchKey: {
                type: String,
                required: true,
                immutable: true,
                trim: true,
                maxlength: 512
            },

            /**
             * Idempotency identity for batch creation.
             */
            idempotencyKey: {
                type: String,
                required: true,
                immutable: true,
                trim: true,
                maxlength: 512
            },

            /**
             * Batch type.
             */
            type: {
                type: String,
                enum: Object.values(
                    BATCH_TYPES
                ),
                default:
                    BATCH_TYPES.STATEMENT_PROCESSING,
                required: true,
                immutable: true,
                uppercase: true
            },

            /**
             * Provider identity.
             */
            provider: {
                type: String,
                trim: true,
                uppercase: true,
                immutable: true,
                maxlength: 128
            },

            providerBatchId: {
                type: String,
                trim: true,
                immutable: true,
                maxlength: 256
            },

            /**
             * Lifecycle.
             */
            status: {
                type: String,
                enum: Object.values(
                    BATCH_STATUS
                ),
                default:
                    BATCH_STATUS.CREATED,
                required: true,
                index: true
            },

            /**
             * Durable processing counters.
             */
            expectedCount: {
                type: Number,
                min: 0,
                default: 0
            },

            processedCount: {
                type: Number,
                min: 0,
                default: 0
            },

            succeededCount: {
                type: Number,
                min: 0,
                default: 0
            },

            failedCount: {
                type: Number,
                min: 0,
                default: 0
            },

            skippedCount: {
                type: Number,
                min: 0,
                default: 0
            },

            duplicateCount: {
                type: Number,
                min: 0,
                default: 0
            },

            retryCount: {
                type: Number,
                min: 0,
                default: 0
            },

            /**
             * Optional aggregate amount metadata.
             *
             * These fields are informational only and are NOT ledger balances.
             */
            totalAmount: {
                type: Schema.Types.Decimal128,
                default: 0
            },

            successfulAmount: {
                type: Schema.Types.Decimal128,
                default: 0
            },

            failedAmount: {
                type: Schema.Types.Decimal128,
                default: 0
            },

            /**
             * Processing context.
             */
            correlationId: {
                type: String,
                trim: true,
                immutable: true,
                maxlength: 256
            },

            requestId: {
                type: String,
                trim: true,
                immutable: true,
                maxlength: 256
            },

            pipelineId: {
                type: String,
                trim: true,
                immutable: true,
                maxlength: 256
            },

            statementTraceId: {
                type: String,
                trim: true,
                immutable: true,
                maxlength: 256
            },

            /**
             * Worker ownership.
             */
            workerId: {
                type: String,
                trim: true,
                maxlength: 256
            },

            claimToken: {
                type: String,
                trim: true,
                maxlength: 256
            },

            leaseExpiresAt: {
                type: Date
            },

            lastHeartbeatAt: {
                type: Date
            },

            /**
             * Lifecycle timestamps.
             */
            createdAt: {
                type: Date,
                default: Date.now,
                immutable: true
            },

            startedAt: {
                type: Date
            },

            completedAt: {
                type: Date
            },

            failedAt: {
                type: Date
            },

            releasedAt: {
                type: Date
            },

            cancelledAt: {
                type: Date
            },

            /**
             * Error information.
             */
            lastError: {
                code: {
                    type: String,
                    maxlength: 256
                },

                message: {
                    type: String,
                    maxlength: 2000
                },

                stage: {
                    type: String,
                    maxlength: 128
                },

                retryable: {
                    type: Boolean,
                    default: false
                },

                occurredAt: {
                    type: Date
                }
            },

            /**
             * Operational metadata only.
             */
            metadata: {
                type: Schema.Types.Mixed,
                default: {}
            },

            /**
             * Optimistic version independent of Mongo's __v.
             */
            version: {
                type: Number,
                min: 1,
                default: 1
            }
        },
        {
            timestamps: true,
            strict: true,
            minimize: false,
            optimisticConcurrency: true,
            versionKey: '__v'
        }
    );

/**
 * ============================================================================
 * Indexes
 * ============================================================================
 */

/**
 * One logical batch key per tenant.
 */
StatementBatchSchema.index(
    {
        tenantId: 1,
        batchKey: 1
    },
    {
        unique: true,
        name:
            'uq_statement_batch_tenant_batch_key'
    }
);

/**
 * One idempotency key per tenant.
 */
StatementBatchSchema.index(
    {
        tenantId: 1,
        idempotencyKey: 1
    },
    {
        unique: true,
        name:
            'uq_statement_batch_tenant_idempotency'
    }
);

/**
 * External batch identity should also be unique.
 */
StatementBatchSchema.index(
    {
        tenantId: 1,
        batchId: 1
    },
    {
        unique: true,
        name:
            'uq_statement_batch_tenant_batch_id'
    }
);

/**
 * Provider reconciliation lookup.
 */
StatementBatchSchema.index(
    {
        tenantId: 1,
        provider: 1,
        providerBatchId: 1
    },
    {
        unique: true,
        sparse: true,
        name:
            'uq_statement_batch_provider_batch'
    }
);

/**
 * Work queue lookup.
 */
StatementBatchSchema.index(
    {
        tenantId: 1,
        status: 1,
        createdAt: 1
    },
    {
        name:
            'ix_statement_batch_status_created'
    }
);

/**
 * Lease recovery.
 */
StatementBatchSchema.index(
    {
        status: 1,
        leaseExpiresAt: 1
    },
    {
        name:
            'ix_statement_batch_lease'
    }
);

/**
 * Provider/date reporting.
 */
StatementBatchSchema.index(
    {
        tenantId: 1,
        provider: 1,
        createdAt: -1
    },
    {
        name:
            'ix_statement_batch_provider_created'
    }
);

/**
 ============================================================================
 * State Validation
 * ============================================================================
 */

StatementBatchSchema.statics.isValidTransition =
    function isValidTransition(
        from,
        to
    ) {

        return Boolean(
            ALLOWED_TRANSITIONS[from]?.has(
                to
            )
        );
    };

/**
 * ============================================================================
 * Counter Integrity Validation
 * ============================================================================
 *
 * Prevent negative counters and impossible combinations.
 * ============================================================================
 */

StatementBatchSchema.pre(
    'validate',
    function validateCounters(next) {

        const counters = [

            'expectedCount',

            'processedCount',

            'succeededCount',

            'failedCount',

            'skippedCount',

            'duplicateCount',

            'retryCount'
        ];

        for (
            const field
            of counters
        ) {

            if (
                !Number.isFinite(
                    this[field]
                ) ||
                this[field] < 0
            ) {

                return next(
                    new Error(
                        `${field} must be a non-negative number`
                    )
                );
            }
        }

        if (
            this.processedCount >
            this.expectedCount
        ) {

            return next(
                new Error(
                    'processedCount cannot exceed expectedCount'
                )
            );
        }

        const resolvedCount =
            this.succeededCount +
            this.failedCount +
            this.skippedCount +
            this.duplicateCount;

        if (
            resolvedCount >
            this.processedCount
        ) {

            return next(
                new Error(
                    'Resolved batch counters cannot exceed processedCount'
                )
            );
        }

        next();
    }
);

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

StatementBatchSchema.statics.STATUS =
    BATCH_STATUS;

StatementBatchSchema.statics.TYPES =
    BATCH_TYPES;

StatementBatchSchema.statics.ALLOWED_TRANSITIONS =
    ALLOWED_TRANSITIONS;

const StatementBatch =
    mongoose.models.StatementBatch ||
    mongoose.model(
        'StatementBatch',
        StatementBatchSchema
    );

module.exports =
    StatementBatch;