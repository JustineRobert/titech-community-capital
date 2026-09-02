'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Statement Processing Operation Model
 * ============================================================================
 *
 * Distributed idempotency and processing-coordination record.
 *
 * Purpose
 * ----------------------------------------------------------------------------
 *
 * Prevent two workers from processing the same statement concurrently.
 *
 * This model does NOT contain the financial statement itself.
 *
 * It contains coordination state only.
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

const OPERATION_STATUS = Object.freeze({

    CLAIMED: 'CLAIMED',

    PROCESSING: 'PROCESSING',

    COMPLETED: 'COMPLETED',

    FAILED: 'FAILED',

    RELEASED: 'RELEASED'
});

const ALLOWED_TRANSITIONS = Object.freeze({

    CLAIMED: new Set([
        OPERATION_STATUS.PROCESSING,
        OPERATION_STATUS.COMPLETED,
        OPERATION_STATUS.FAILED,
        OPERATION_STATUS.RELEASED
    ]),

    PROCESSING: new Set([
        OPERATION_STATUS.COMPLETED,
        OPERATION_STATUS.FAILED,
        OPERATION_STATUS.RELEASED
    ]),

    COMPLETED: new Set(),

    FAILED: new Set([
        OPERATION_STATUS.PROCESSING,
        OPERATION_STATUS.RELEASED
    ]),

    RELEASED: new Set([
        OPERATION_STATUS.CLAIMED
    ])
});

/**
 * ============================================================================
 * Schema
 * ============================================================================
 */

const StatementProcessingOperationSchema =
    new Schema(
        {
            tenantId: {
                type: String,
                required: true,
                trim: true,
                immutable: true
            },

            operationKey: {
                type: String,
                required: true,
                trim: true,
                immutable: true,
                maxlength: 512
            },

            idempotencyKey: {
                type: String,
                required: true,
                trim: true,
                immutable: true,
                maxlength: 512
            },

            statementId: {
                type: String,
                trim: true,
                immutable: true,
                maxlength: 256
            },

            provider: {
                type: String,
                trim: true,
                uppercase: true,
                immutable: true,
                maxlength: 128
            },

            providerStatementId: {
                type: String,
                trim: true,
                immutable: true,
                maxlength: 256
            },

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

            status: {
                type: String,
                enum: Object.values(
                    OPERATION_STATUS
                ),
                default:
                    OPERATION_STATUS.CLAIMED,
                required: true,
                index: true
            },

            claimToken: {
                type: String,
                required: true,
                trim: true,
                immutable: true,
                maxlength: 256
            },

            leaseExpiresAt: {
                type: Date,
                required: true
            },

            attemptCount: {
                type: Number,
                default: 1,
                min: 1
            },

            lastHeartbeatAt: {
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

            resultId: {
                type: String,
                trim: true,
                maxlength: 256
            },

            error: {
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
                }
            },

            metadata: {
                type: Schema.Types.Mixed,
                default: {}
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

StatementProcessingOperationSchema.index(
    {
        tenantId: 1,
        operationKey: 1
    },
    {
        unique: true,
        name:
            'uq_statement_operation_tenant_key'
    }
);

StatementProcessingOperationSchema.index(
    {
        tenantId: 1,
        idempotencyKey: 1
    },
    {
        unique: true,
        name:
            'uq_statement_operation_tenant_idempotency'
    }
);

StatementProcessingOperationSchema.index(
    {
        status: 1,
        leaseExpiresAt: 1
    },
    {
        name:
            'ix_statement_operation_lease'
    }
);

StatementProcessingOperationSchema.index(
    {
        tenantId: 1,
        createdAt: -1
    },
    {
        name:
            'ix_statement_operation_created'
    }
);

/**
 * ============================================================================
 * State Transition Validation
 * ============================================================================
 */

StatementProcessingOperationSchema.statics
    .isValidTransition =
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
 * Model
 * ============================================================================
 */

const StatementProcessingOperation =
    mongoose.models.StatementProcessingOperation ||
    mongoose.model(
        'StatementProcessingOperation',
        StatementProcessingOperationSchema
    );

StatementProcessingOperation.OPERATION_STATUS =
    OPERATION_STATUS;

StatementProcessingOperation.ALLOWED_TRANSITIONS =
    ALLOWED_TRANSITIONS;

module.exports =
    StatementProcessingOperation;