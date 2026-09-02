'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Distributed Transaction Record
 * ============================================================================
 *
 * File:
 *   backend/modules/transactions/models/DistributedTransactionRecord.js
 *
 * Purpose
 * -------
 * Persistent coordination state for distributed payment/financial sagas.
 *
 * Supports:
 *   • Ledger
 *   • Wallet
 *   • Airtel Money
 *   • MTN MoMo
 *   • Settlement
 *   • Reconciliation
 *   • Notifications
 *   • External providers
 *
 * Responsibilities
 * ----------------
 * • Durable saga state
 * • Tenant isolation
 * • Transaction identity
 * • Correlation/request propagation
 * • Operation lifecycle persistence
 * • Completed-operation persistence
 * • Compensation state
 * • Retry state
 * • Failure state
 * • Recovery queries
 * • Optimistic concurrency
 * • Operational diagnostics
 *
 * IMPORTANT
 * ---------
 * This model is NOT the financial ledger.
 *
 * It stores workflow coordination state only.
 *
 * Financial truth remains in the immutable double-entry ledger.
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

const MODEL_NAME =
    'DistributedTransactionRecord';

const COLLECTION_NAME =
    'distributed_transaction_records';


const TRANSACTION_STATES = Object.freeze({

    CREATED:
        'CREATED',

    RUNNING:
        'RUNNING',

    COMMITTED:
        'COMMITTED',

    ROLLING_BACK:
        'ROLLING_BACK',

    ROLLED_BACK:
        'ROLLED_BACK',

    COMPENSATION_FAILED:
        'COMPENSATION_FAILED',

    FAILED:
        'FAILED',

    ABORTED:
        'ABORTED'

});


const OPERATION_STATES = Object.freeze({

    PENDING:
        'PENDING',

    RUNNING:
        'RUNNING',

    COMPLETED:
        'COMPLETED',

    FAILED:
        'FAILED',

    COMPENSATING:
        'COMPENSATING',

    COMPENSATED:
        'COMPENSATED',

    COMPENSATION_FAILED:
        'COMPENSATION_FAILED'

});


const COMPENSATION_STATES = Object.freeze({

    NOT_REQUIRED:
        'NOT_REQUIRED',

    PENDING:
        'PENDING',

    RUNNING:
        'RUNNING',

    COMPLETED:
        'COMPLETED',

    PARTIAL:
        'PARTIAL',

    FAILED:
        'FAILED'

});


const RETRY_STATES = Object.freeze({

    IDLE:
        'IDLE',

    WAITING:
        'WAITING',

    RUNNING:
        'RUNNING',

    EXHAUSTED:
        'EXHAUSTED'

});


/**
 * ============================================================================
 * Validation Helpers
 * ============================================================================
 */

function isValidIdentifier(value) {

    if (
        typeof value !== 'string'
    ) {
        return false;
    }

    const normalized =
        value.trim();

    return (
        normalized.length > 0 &&
        normalized.length <= 256
    );

}


function isValidDateValue(value) {

    if (
        value === undefined ||
        value === null
    ) {
        return true;
    }

    const date =
        value instanceof Date
            ? value
            : new Date(value);

    return !Number.isNaN(
        date.getTime()
    );

}


/**
 * ============================================================================
 * Failure Schema
 * ============================================================================
 *
 * Sensitive details must never be persisted here.
 * Store structured operational information, not raw secrets/provider bodies.
 * ============================================================================
 */

const FailureSchema =
    new Schema({

        code: {

            type:
                String,

            trim:
                true,

            maxlength:
                128

        },

        category: {

            type:
                String,

            trim:
                true,

            uppercase:
                true,

            maxlength:
                128

        },

        message: {

            type:
                String,

            trim:
                true,

            maxlength:
                2000

        },

        retryable: {

            type:
                Boolean,

            default:
                false

        },

        operationId: {

            type:
                String,

            trim:
                true,

            maxlength:
                128

        },

        provider: {

            type:
                String,

            trim:
                true,

            uppercase:
                true,

            maxlength:
                128

        },

        occurredAt: {

            type:
                Date,

            default:
                Date.now,

            immutable:
                true

        },

        metadata: {

            type:
                Schema.Types.Mixed,

            default:
                undefined

        }

    }, {

        _id:
            false,

        id:
            false,

        strict:
            true

    });


/**
 * ============================================================================
 * Retry State Schema
 * ============================================================================
 */

const RetryStateSchema =
    new Schema({

        state: {

            type:
                String,

            enum:
                Object.values(
                    RETRY_STATES
                ),

            default:
                RETRY_STATES.IDLE

        },

        attempts: {

            type:
                Number,

            default:
                0,

            min:
                0

        },

        maxAttempts: {

            type:
                Number,

            default:
                0,

            min:
                0

        },

        lastAttemptAt: {

            type:
                Date

        },

        nextAttemptAt: {

            type:
                Date,

            index:
                true

        },

        lastError: {

            type:
                FailureSchema,

            default:
                undefined

        }

    }, {

        _id:
            false,

        id:
            false,

        strict:
            true

    });


/**
 * ============================================================================
 * Operation Schema
 * ============================================================================
 *
 * The operation definition remains durable so a worker can recover and
 * understand what was being executed.
 * ============================================================================
 */

const OperationSchema =
    new Schema({

        operationId: {

            type:
                String,

            required:
                true,

            trim:
                true,

            maxlength:
                128

        },

        name: {

            type:
                String,

            required:
                true,

            trim:
                true,

            maxlength:
                256

        },

        state: {

            type:
                String,

            enum:
                Object.values(
                    OPERATION_STATES
                ),

            default:
                OPERATION_STATES.PENDING

        },

        timeoutMs: {

            type:
                Number,

            default:
                60000,

            min:
                1

        },

        maxRetries: {

            type:
                Number,

            default:
                0,

            min:
                0

        },

        retryable: {

            type:
                Boolean,

            default:
                true

        },

        idempotencyKey: {

            type:
                String,

            trim:
                true,

            maxlength:
                512

        },

        metadata: {

            type:
                Schema.Types.Mixed,

            default:
                () => ({})

        },

        startedAt: {

            type:
                Date

        },

        completedAt: {

            type:
                Date

        },

        failedAt: {

            type:
                Date

        },

        compensatedAt: {

            type:
                Date

        },

        attemptCount: {

            type:
                Number,

            default:
                0,

            min:
                0

        },

        lastAttemptAt: {

            type:
                Date

        },

        nextAttemptAt: {

            type:
                Date

        },

        resultSummary: {

            type:
                Schema.Types.Mixed,

            default:
                undefined

        },

        failure: {

            type:
                FailureSchema,

            default:
                undefined

        },

        compensationFailure: {

            type:
                FailureSchema,

            default:
                undefined

        }

    }, {

        _id:
            false,

        id:
            false,

        strict:
            true

    });


/**
 * ============================================================================
 * Completed Operation Schema
 * ============================================================================
 *
 * Kept separately as a durable execution record.
 * ============================================================================
 */

const CompletedOperationSchema =
    new Schema({

        operationId: {

            type:
                String,

            required:
                true,

            trim:
                true,

            maxlength:
                128

        },

        operationName: {

            type:
                String,

            required:
                true,

            trim:
                true,

            maxlength:
                256

        },

        completedAt: {

            type:
                Date,

            required:
                true,

            immutable:
                true

        },

        attemptCount: {

            type:
                Number,

            default:
                1,

            min:
                1

        },

        durationMs: {

            type:
                Number,

            min:
                0

        },

        resultSummary: {

            type:
                Schema.Types.Mixed,

            default:
                undefined

        }

    }, {

        _id:
            false,

        id:
            false,

        strict:
            true

    });


/**
 * ============================================================================
 * Execution History Schema
 * ============================================================================
 *
 * Bounded execution history for operational recovery/diagnostics.
 * ============================================================================
 */

const ExecutionHistorySchema =
    new Schema({

        type: {

            type:
                String,

            required:
                true,

            trim:
                true,

            maxlength:
                128

        },

        operationId: {

            type:
                String,

            trim:
                true,

            maxlength:
                128

        },

        operation: {

            type:
                String,

            trim:
                true,

            maxlength:
                256

        },

        state: {

            type:
                String,

            trim:
                true,

            uppercase:
                true,

            maxlength:
                128

        },

        success: {

            type:
                Boolean

        },

        attempt: {

            type:
                Number,

            min:
                0

        },

        durationMs: {

            type:
                Number,

            min:
                0

        },

        retryable: {

            type:
                Boolean

        },

        error: {

            type:
                FailureSchema,

            default:
                undefined

        },

        occurredAt: {

            type:
                Date,

            default:
                Date.now,

            immutable:
                true

        }

    }, {

        _id:
            false,

        id:
            false,

        strict:
            true

    });


/**
 * ============================================================================
 * Main Schema
 * ============================================================================
 */

const DistributedTransactionRecordSchema =
    new Schema({

        /**
         * ---------------------------------------------------------------------
         * Tenant Boundary
         * ---------------------------------------------------------------------
         */

        tenantId: {

            type:
                String,

            required:
                true,

            trim:
                true,

            maxlength:
                256,

            immutable:
                true,

            index:
                true,

            validate: {

                validator:
                    isValidIdentifier,

                message:
                    'tenantId is required'

            }

        },


        /**
         * ---------------------------------------------------------------------
         * Saga Identity
         * ---------------------------------------------------------------------
         */

        transactionId: {

            type:
                String,

            required:
                true,

            trim:
                true,

            maxlength:
                128,

            immutable:
                true,

            index:
                true,

            unique:
                true,

            default:
                () =>
                    cryptoRandomId()

        },


        /**
         * ---------------------------------------------------------------------
         * Correlation Identity
         * ---------------------------------------------------------------------
         */

        correlationId: {

            type:
                String,

            required:
                true,

            trim:
                true,

            maxlength:
                256,

            immutable:
                true,

            index:
                true

        },

        requestId: {

            type:
                String,

            trim:
                true,

            maxlength:
                256,

            immutable:
                true

        },

        idempotencyKey: {

            type:
                String,

            trim:
                true,

            maxlength:
                512,

            immutable:
                true

        },


        /**
         * ---------------------------------------------------------------------
         * Saga State
         * ---------------------------------------------------------------------
         */

        state: {

            type:
                String,

            enum:
                Object.values(
                    TRANSACTION_STATES
                ),

            required:
                true,

            default:
                TRANSACTION_STATES.CREATED,

            index:
                true

        },


        /**
         * ---------------------------------------------------------------------
         * Compensation State
         * ---------------------------------------------------------------------
         */

        compensationState: {

            type:
                String,

            enum:
                Object.values(
                    COMPENSATION_STATES
                ),

            default:
                COMPENSATION_STATES.NOT_REQUIRED,

            index:
                true

        },


        /**
         * ---------------------------------------------------------------------
         * Retry State
         * ---------------------------------------------------------------------
         */

        retryState: {

            type:
                RetryStateSchema,

            default:
                () => ({})

        },


        /**
         * ---------------------------------------------------------------------
         * Saga Operations
         * ---------------------------------------------------------------------
         */

        operations: {

            type:
                [OperationSchema],

            default:
                []

        },


        /**
         * ---------------------------------------------------------------------
         * Completed Operations
         * ---------------------------------------------------------------------
         */

        completedOperations: {

            type:
                [CompletedOperationSchema],

            default:
                []

        },


        /**
         * ---------------------------------------------------------------------
         * Execution History
         * ---------------------------------------------------------------------
         */

        executionHistory: {

            type:
                [ExecutionHistorySchema],

            default:
                []

        },


        /**
         * ---------------------------------------------------------------------
         * Failure
         * ---------------------------------------------------------------------
         */

        failure: {

            type:
                FailureSchema,

            default:
                undefined

        },


        /**
         * ---------------------------------------------------------------------
         * Compensation Failures
         * ---------------------------------------------------------------------
         */

        compensationFailures: {

            type:
                [FailureSchema],

            default:
                []

        },


        /**
         * ---------------------------------------------------------------------
         * Execution Metrics
         * ---------------------------------------------------------------------
         */

        operationCount: {

            type:
                Number,

            default:
                0,

            min:
                0

        },

        completedOperationCount: {

            type:
                Number,

            default:
                0,

            min:
                0

        },

        failedOperationCount: {

            type:
                Number,

            default:
                0,

            min:
                0

        },

        compensationFailureCount: {

            type:
                Number,

            default:
                0,

            min:
                0

        },

        durationMs: {

            type:
                Number,

            min:
                0

        },


        /**
         * ---------------------------------------------------------------------
         * Workflow Timestamps
         * ---------------------------------------------------------------------
         */

        startedAt: {

            type:
                Date

        },

        finishedAt: {

            type:
                Date

        },

        rollbackStartedAt: {

            type:
                Date

        },

        rollbackFinishedAt: {

            type:
                Date

        },

        lastHeartbeatAt: {

            type:
                Date

        },

        nextRecoveryAt: {

            type:
                Date,

            index:
                true

        },


        /**
         * ---------------------------------------------------------------------
         * Recovery Metadata
         * ---------------------------------------------------------------------
         */

        workerId: {

            type:
                String,

            trim:
                true,

            maxlength:
                256

        },

        leaseExpiresAt: {

            type:
                Date,

            index:
                true

        },

        recoveryAttempts: {

            type:
                Number,

            default:
                0,

            min:
                0

        },


        /**
         * ---------------------------------------------------------------------
         * Business Context
         * ---------------------------------------------------------------------
         */

        provider: {

            type:
                String,

            trim:
                true,

            uppercase:
                true,

            maxlength:
                128,

            immutable:
                true

        },

        operationType: {

            type:
                String,

            trim:
                true,

            uppercase:
                true,

            maxlength:
                128,

            immutable:
                true

        },

        aggregateType: {

            type:
                String,

            trim:
                true,

            uppercase:
                true,

            maxlength:
                128,

            immutable:
                true

        },

        aggregateId: {

            type:
                String,

            trim:
                true,

            maxlength:
                256,

            immutable:
                true

        },


        /**
         * ---------------------------------------------------------------------
         * Metadata
         * ---------------------------------------------------------------------
         */

        metadata: {

            type:
                Schema.Types.Mixed,

            default:
                () => ({})

        }

    }, {

        collection:
            COLLECTION_NAME,

        strict:
            true,

        timestamps:
            true,

        versionKey:
            'version',

        optimisticConcurrency:
            true,

        minimize:
            false,

        toJSON: {

            virtuals:
                false,

            transform(
                doc,
                ret
            ) {

                delete ret.__v;

                return ret;

            }

        }

    });


/**
 * ============================================================================
 * Random ID Helper
 * ============================================================================
 */

function cryptoRandomId() {

    return require('crypto')
        .randomUUID();

}


/**
 * ============================================================================
 * Pre-Validation Consistency
 * ============================================================================
 */

DistributedTransactionRecordSchema.pre(
    'validate',
    function validateConsistency(
        next
    ) {

        this.operationCount =
            Array.isArray(
                this.operations
            )
                ? this.operations.length
                : 0;


        this.completedOperationCount =
            Array.isArray(
                this.completedOperations
            )
                ? this.completedOperations.length
                : 0;


        this.compensationFailureCount =
            Array.isArray(
                this.compensationFailures
            )
                ? this.compensationFailures.length
                : 0;


        this.failedOperationCount =
            Array.isArray(
                this.operations
            )
                ? this.operations.filter(
                    operation =>
                        operation.state ===
                        OPERATION_STATES.FAILED ||
                        operation.state ===
                        OPERATION_STATES.COMPENSATION_FAILED
                ).length
                : 0;


        if (
            this.state ===
            TRANSACTION_STATES.COMMITTED
        ) {

            this.finishedAt =
                this.finishedAt ||
                new Date();

        }


        if (
            this.state ===
            TRANSACTION_STATES.ROLLING_BACK
        ) {

            this.compensationState =
                COMPENSATION_STATES.RUNNING;

        }


        if (
            this.state ===
            TRANSACTION_STATES.ROLLED_BACK
        ) {

            this.compensationState =
                COMPENSATION_STATES.COMPLETED;

            this.rollbackFinishedAt =
                this.rollbackFinishedAt ||
                new Date();

        }


        if (
            this.state ===
            TRANSACTION_STATES.COMPENSATION_FAILED
        ) {

            this.compensationState =
                COMPENSATION_STATES.FAILED;

        }


        next();

    }
);


/**
 * ============================================================================
 * Valid State Transition Guard
 * ============================================================================
 */

const ALLOWED_TRANSITIONS = Object.freeze({

    CREATED: [

        'RUNNING',

        'ABORTED'

    ],

    RUNNING: [

        'COMMITTED',

        'ROLLING_BACK',

        'FAILED',

        'ABORTED'

    ],

    ROLLING_BACK: [

        'ROLLED_BACK',

        'COMPENSATION_FAILED'

    ],

    COMMITTED: [],

    ROLLED_BACK: [],

    COMPENSATION_FAILED: [],

    FAILED: [],

    ABORTED: []

});


/**
 * Save-level transition guard.
 */
DistributedTransactionRecordSchema.pre(
    'save',
    function validateStateTransition(
        next
    ) {

        if (
            this.isNew ||
            !this.isModified('state')
        ) {

            return next();

        }


        /**
         * get() is not guaranteed to provide the previous database state
         * for every update pathway, so query-level methods below should use
         * conditional filters. This check primarily protects document saves.
         */
        const currentState =
            this.state;


        if (
            !Object.prototype.hasOwnProperty.call(
                ALLOWED_TRANSITIONS,
                currentState
            )
        ) {

            return next(
                new Error(
                    `Unknown distributed transaction state: ${currentState}`
                )
            );

        }


        next();

    }
);


/**
 * ============================================================================
 * Compound Indexes
 * ============================================================================
 *
 * The tenant should be the first key on operational indexes wherever tenant
 * isolation applies.
 * ============================================================================
 */


/**
 * Primary tenant transaction lookup.
 */
DistributedTransactionRecordSchema.index({

    tenantId:
        1,

    transactionId:
        1

}, {

    unique:
        true,

    name:
        'uniq_dtx_tenant_transaction'

});


/**
 * Correlation tracing.
 */
DistributedTransactionRecordSchema.index({

    tenantId:
        1,

    correlationId:
        1,

    createdAt:
        -1

}, {

    name:
        'idx_dtx_tenant_correlation_created'

});


/**
 * Workflow state/recovery queue.
 */
DistributedTransactionRecordSchema.index({

    tenantId:
        1,

    state:
        1,

    createdAt:
        -1

}, {

    name:
        'idx_dtx_tenant_state_created'

});


/**
 * Compensation recovery.
 */
DistributedTransactionRecordSchema.index({

    tenantId:
        1,

    compensationState:
        1,

    updatedAt:
        -1

}, {

    name:
        'idx_dtx_tenant_compensation_updated'

});


/**
 * Next recovery scheduling.
 */
DistributedTransactionRecordSchema.index({

    tenantId:
        1,

    state:
        1,

    nextRecoveryAt:
        1

}, {

    sparse:
        true,

    name:
        'idx_dtx_recovery_schedule'

});


/**
 * Lease recovery.
 */
DistributedTransactionRecordSchema.index({

    tenantId:
        1,

    leaseExpiresAt:
        1,

    state:
        1

}, {

    sparse:
        true,

    name:
        'idx_dtx_expired_lease_recovery'

});


/**
 * Worker visibility.
 */
DistributedTransactionRecordSchema.index({

    tenantId:
        1,

    workerId:
        1,

    state:
        1,

    updatedAt:
        -1

}, {

    sparse:
        true,

    name:
        'idx_dtx_worker_state'

});


/**
 * Provider/operation monitoring.
 */
DistributedTransactionRecordSchema.index({

    tenantId:
        1,

    provider:
        1,

    operationType:
        1,

    createdAt:
        -1

}, {

    sparse:
        true,

    name:
        'idx_dtx_provider_operation_created'

});


/**
 * Aggregate recovery/history.
 */
DistributedTransactionRecordSchema.index({

    tenantId:
        1,

    aggregateType:
        1,

    aggregateId:
        1,

    createdAt:
        -1

}, {

    sparse:
        true,

    name:
        'idx_dtx_aggregate_history'

});


/**
 * Tenant-scoped idempotency.
 */
DistributedTransactionRecordSchema.index({

    tenantId:
        1,

    idempotencyKey:
        1

}, {

    unique:
        true,

    sparse:
        true,

    name:
        'uniq_dtx_tenant_idempotency'

});


/**
 ============================================================================
 * Static Methods
 * ============================================================================
 */

/**
 * Find a saga by business transaction identity.
 */
DistributedTransactionRecordSchema.statics.findByTransactionId =
    function findByTransactionId({

        tenantId,

        transactionId

    }) {

        return this.findOne({

            tenantId,

            transactionId

        });

    };


/**
 * Find by correlation ID.
 */
DistributedTransactionRecordSchema.statics.findByCorrelationId =
    function findByCorrelationId({

        tenantId,

        correlationId

    }) {

        return this.find({

            tenantId,

            correlationId

        })
            .sort({

                createdAt:
                    -1

            });

    };


/**
 * Find an existing idempotent saga.
 */
DistributedTransactionRecordSchema.statics.findByIdempotencyKey =
    function findByIdempotencyKey({

        tenantId,

        idempotencyKey

    }) {

        return this.findOne({

            tenantId,

            idempotencyKey

        });

    };


/**
 * Find recoverable transactions.
 *
 * Used by workers after process/container crashes.
 */
DistributedTransactionRecordSchema.statics.findRecoverable =
    function findRecoverable({

        tenantId,

        limit = 100,

        now = new Date()

    } = {}) {

        return this.find({

            ...(tenantId
                ? { tenantId }
                : {}),

            $or: [

                {

                    state:
                        TRANSACTION_STATES.RUNNING,

                    $or: [

                        {
                            leaseExpiresAt: {
                                $lte:
                                    now
                            }
                        },

                        {
                            leaseExpiresAt:
                                null
                        }

                    ]

                },

                {

                    state:
                        TRANSACTION_STATES.ROLLING_BACK

                },

                {

                    state:
                        TRANSACTION_STATES.COMPENSATION_FAILED

                },

                {

                    nextRecoveryAt: {
                        $lte:
                            now
                    },

                    state: {
                        $nin: [

                            TRANSACTION_STATES.COMMITTED,

                            TRANSACTION_STATES.ROLLED_BACK,

                            TRANSACTION_STATES.FAILED,

                            TRANSACTION_STATES.ABORTED

                        ]

                    }

                }

            ]

        })
            .sort({

                updatedAt:
                    1

            })
            .limit(
                limit
            );

    };


/**
 * Find active workflows.
 */
DistributedTransactionRecordSchema.statics.findActive =
    function findActive({

        tenantId,

        limit = 100

    } = {}) {

        return this.find({

            ...(tenantId
                ? { tenantId }
                : {}),

            state: {

                $in: [

                    TRANSACTION_STATES.CREATED,

                    TRANSACTION_STATES.RUNNING,

                    TRANSACTION_STATES.ROLLING_BACK

                ]

            }

        })
            .sort({

                createdAt:
                    1

            })
            .limit(
                limit
            );

    };


/**
 * ============================================================================
 * Instance Methods
 * ============================================================================
 */

/**
 * Add bounded execution history.
 */
DistributedTransactionRecordSchema.methods.appendHistory =
    function appendHistory(
        entry,
        maxHistory = 500
    ) {

        if (
            !Array.isArray(
                this.executionHistory
            )
        ) {

            this.executionHistory =
                [];

        }


        this.executionHistory.push({
            ...entry,
            occurredAt:
                entry.occurredAt ||
                new Date()
        });


        if (
            this.executionHistory.length >
            maxHistory
        ) {

            this.executionHistory =
                this.executionHistory.slice(
                    -maxHistory
                );

        }


        return this;

    };


/**
 * Update heartbeat/lease information for a worker.
 */
DistributedTransactionRecordSchema.methods.heartbeat =
    async function heartbeat({

        workerId,

        leaseMs =
            30000

    } = {}) {

        if (
            !workerId
        ) {

            throw new Error(
                'workerId is required'
            );

        }


        this.workerId =
            workerId;

        this.lastHeartbeatAt =
            new Date();

        this.leaseExpiresAt =
            new Date(
                Date.now() +
                leaseMs
            );


        return this.save();

    };


/**
 * Claim workflow for recovery worker.
 *
 * Uses conditional state/lease matching to reduce worker races.
 */
DistributedTransactionRecordSchema.statics.claim =
    async function claim({

        tenantId,

        transactionId,

        workerId,

        leaseMs =
            30000

    }) {

        if (
            !tenantId ||
            !transactionId ||
            !workerId
        ) {

            throw new Error(
                'tenantId, transactionId and workerId are required'
            );

        }


        const now =
            new Date();


        const leaseExpiresAt =
            new Date(
                Date.now() +
                leaseMs
            );


        return this.findOneAndUpdate(

            {

                tenantId,

                transactionId,

                state: {

                    $in: [

                        TRANSACTION_STATES.CREATED,

                        TRANSACTION_STATES.RUNNING,

                        TRANSACTION_STATES.ROLLING_BACK

                    ]

                },

                $or: [

                    {
                        leaseExpiresAt:
                            null
                    },

                    {
                        leaseExpiresAt:
                            { $lte: now }
                    },

                    {
                        workerId
                    }

                ]

            },

            {

                $set: {

                    workerId,

                    leaseExpiresAt,

                    lastHeartbeatAt:
                        now,

                    nextRecoveryAt:
                        null

                },

                $inc: {

                    recoveryAttempts:
                        1

                }

            },

            {

                new:
                    true

            }

        );

    };


/**
 * Release worker lease.
 */
DistributedTransactionRecordSchema.methods.releaseLease =
    async function releaseLease() {

        this.workerId =
            undefined;

        this.leaseExpiresAt =
            undefined;

        this.lastHeartbeatAt =
            undefined;

        return this.save();

    };


/**
 * Safe operational summary.
 */
DistributedTransactionRecordSchema.methods.toOperationalSummary =
    function toOperationalSummary() {

        return {

            transactionId:
                this.transactionId,

            tenantId:
                this.tenantId,

            correlationId:
                this.correlationId,

            requestId:
                this.requestId,

            state:
                this.state,

            compensationState:
                this.compensationState,

            retryState:
                this.retryState?.state,

            operationCount:
                this.operationCount,

            completedOperationCount:
                this.completedOperationCount,

            failedOperationCount:
                this.failedOperationCount,

            compensationFailureCount:
                this.compensationFailureCount,

            provider:
                this.provider,

            operationType:
                this.operationType,

            workerId:
                this.workerId,

            recoveryAttempts:
                this.recoveryAttempts,

            createdAt:
                this.createdAt,

            updatedAt:
                this.updatedAt,

            nextRecoveryAt:
                this.nextRecoveryAt

        };

    };


/**
 * ============================================================================
 * Model Registration
 * ============================================================================
 */

const DistributedTransactionRecord =
    mongoose.models[MODEL_NAME] ||
    mongoose.model(
        MODEL_NAME,
        DistributedTransactionRecordSchema
    );


/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports =
    DistributedTransactionRecord;

module.exports.DistributedTransactionRecord =
    DistributedTransactionRecord;

module.exports.DistributedTransactionRecordSchema =
    DistributedTransactionRecordSchema;

module.exports.TRANSACTION_STATES =
    TRANSACTION_STATES;

module.exports.OPERATION_STATES =
    OPERATION_STATES;

module.exports.COMPENSATION_STATES =
    COMPENSATION_STATES;

module.exports.RETRY_STATES =
    RETRY_STATES;