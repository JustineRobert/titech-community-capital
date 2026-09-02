'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Distributed Transaction Repository
 * ============================================================================
 *
 * File:
 *   backend/modules/transactions/repositories/DistributedTransactionRepository.js
 *
 * Purpose
 * -------
 * Durable persistence/coordination layer for DistributedTransactionManager.
 *
 * Responsibilities
 * ----------------
 * • DistributedTransactionRecord persistence
 * • Tenant-scoped transaction lookup
 * • Idempotent transaction creation
 * • Optimistic concurrency updates
 * • Atomic worker claiming
 * • Heartbeats / lease management
 * • Saga completion
 * • Saga failure persistence
 * • Saga rollback persistence
 * • Recovery queries
 * • Compensation recovery queries
 * • Expired lease recovery
 * • Safe operational diagnostics
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • Executing saga operations
 * • Payment processing
 * • Ledger posting
 * • Provider communication
 * • Compensation execution
 * • Business decisioning
 *
 * Financial Principle
 * -------------------
 * This repository persists WORKFLOW COORDINATION STATE.
 *
 * It does not replace:
 *
 *   Transaction
 *   Journal
 *   JournalEntry
 *   Account
 *   Ledger
 *
 * The immutable double-entry ledger remains the financial source of truth.
 *
 * ============================================================================
 */

const crypto = require('crypto');

const DistributedTransactionRecord =
    require('../models/DistributedTransactionRecord');


const {
    TRANSACTION_STATES,
    OPERATION_STATES,
    COMPENSATION_STATES,
    RETRY_STATES
} = require('../models/DistributedTransactionRecord');


/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const DUPLICATE_KEY_CODE =
    11000;

const DEFAULT_RECOVERY_LIMIT =
    100;

const DEFAULT_LEASE_MS =
    30 * 1000;

const DEFAULT_HISTORY_LIMIT =
    500;


/**
 * ============================================================================
 * Repository
 * ============================================================================
 */

class DistributedTransactionRepository {

    constructor({

        model =
            DistributedTransactionRecord,

        logger =
            console,

        metrics =
            null,

        clock =
            Date,

        recoveryLimit =
            DEFAULT_RECOVERY_LIMIT,

        defaultLeaseMs =
            DEFAULT_LEASE_MS,

        maxHistory =
            DEFAULT_HISTORY_LIMIT

    } = {}) {

        if (!model) {

            throw new Error(
                'DistributedTransactionRecord model is required'
            );

        }

        this.model =
            model;

        this.logger =
            logger;

        this.metrics =
            metrics;

        this.clock =
            clock;

        this.recoveryLimit =
            recoveryLimit;

        this.defaultLeaseMs =
            defaultLeaseMs;

        this.maxHistory =
            maxHistory;

    }


    /**
     * =========================================================================
     * Create
     * =========================================================================
     *
     * Creates a durable saga record.
     *
     * The tenant + transactionId / idempotency constraints on the model remain
     * the final concurrency guard.
     */

    async create({

        tenantId,

        transactionId =
            crypto.randomUUID(),

        correlationId,

        requestId = null,

        idempotencyKey = null,

        provider = null,

        operationType = null,

        aggregateType = null,

        aggregateId = null,

        operations = [],

        metadata = {},

        state =
            TRANSACTION_STATES.CREATED,

        compensationState =
            COMPENSATION_STATES.NOT_REQUIRED,

        retryState = null

    } = {}) {

        this.validateIdentity({

            tenantId,

            transactionId,

            correlationId

        });


        const existing =
            await this.findOne({

                tenantId,

                transactionId

            });


        if (
            existing
        ) {

            return existing;

        }


        if (
            idempotencyKey
        ) {

            const existingByIdempotency =
                await this.findByIdempotencyKey({

                    tenantId,

                    idempotencyKey

                });


            if (
                existingByIdempotency
            ) {

                return existingByIdempotency;

            }

        }


        const normalizedOperations =
            this.normalizeOperations(
                operations
            );


        const document = {

            tenantId,

            transactionId,

            correlationId,

            requestId,

            idempotencyKey,

            provider,

            operationType,

            aggregateType,

            aggregateId,

            state,

            compensationState,

            retryState:
                retryState ||
                this.createDefaultRetryState(),

            operations:
                normalizedOperations,

            completedOperations:
                [],

            executionHistory:
                [],

            metadata:
                this.sanitizeMetadata(
                    metadata
                ),

            operationCount:
                normalizedOperations.length,

            completedOperationCount:
                0,

            failedOperationCount:
                0,

            compensationFailureCount:
                0,

            recoveryAttempts:
                0

        };


        try {

            const created =
                await this.model.create(
                    document
                );


            this.metrics?.counter?.(
                'distributed_transaction_repository_create_total'
            );


            return created;

        }
        catch (error) {

            /**
             * Concurrent create race:
             *
             * Worker A creates record.
             * Worker B creates same key.
             *
             * Unique index wins. Worker B retrieves the existing record.
             */
            if (
                this.isDuplicateKeyError(
                    error
                )
            ) {

                const raced =
                    idempotencyKey
                        ? await this.findByIdempotencyKey({

                            tenantId,

                            idempotencyKey

                        })
                        : await this.findOne({

                            tenantId,

                            transactionId

                        });


                if (
                    raced
                ) {

                    this.metrics?.counter?.(
                        'distributed_transaction_repository_duplicate_create_total'
                    );

                    return raced;

                }

            }


            this.metrics?.counter?.(
                'distributed_transaction_repository_create_failure_total'
            );

            throw error;

        }

    }


    /**
     * =========================================================================
     * Find One
     * =========================================================================
     */

    async findOne({

        tenantId,

        transactionId

    } = {}) {

        this.validateIdentity({

            tenantId,

            transactionId,

            correlationId:
                'repository-lookup'

        });


        return this.model
            .findOne({

                tenantId,

                transactionId

            })
            .exec();

    }


    /**
     * =========================================================================
     * Find By ID
     * =========================================================================
     */

    async findById(
        tenantId,
        transactionId
    ) {

        return this.findOne({

            tenantId,

            transactionId

        });

    }


    /**
     * =========================================================================
     * Find By Idempotency Key
     * =========================================================================
     */

    async findByIdempotencyKey({

        tenantId,

        idempotencyKey

    } = {}) {

        if (
            !tenantId
        ) {

            throw new Error(
                'tenantId is required'
            );

        }

        if (
            !idempotencyKey
        ) {

            throw new Error(
                'idempotencyKey is required'
            );

        }


        return this.model
            .findOne({

                tenantId,

                idempotencyKey

            })
            .exec();

    }


    /**
     * =========================================================================
     * Update
     * =========================================================================
     *
     * Supports partial saga-state updates.
     *
     * Uses optimistic concurrency through the record's `version` value where
     * available.
     */

    async update({

        tenantId,

        transactionId,

        patch = {},

        expectedVersion = null

    } = {}) {

        this.validateIdentity({

            tenantId,

            transactionId,

            correlationId:
                'repository-update'

        });


        const safePatch =
            this.sanitizePatch(
                patch
            );


        if (
            Object.keys(
                safePatch
            ).length === 0
        ) {

            return this.findOne({

                tenantId,

                transactionId

            });

        }


        const filter = {

            tenantId,

            transactionId

        };


        if (
            expectedVersion !==
            null &&
            expectedVersion !==
            undefined
        ) {

            filter.version =
                expectedVersion;

        }


        const update = {

            $set:
                safePatch,

            $inc: {

                version:
                    1

            }

        };


        const result =
            await this.model.findOneAndUpdate(

                filter,

                update,

                {

                    new:
                        true,

                    runValidators:
                        true,

                    returnDocument:
                        'after'

                }

            );


        if (
            !result
        ) {

            if (
                expectedVersion !==
                null &&
                expectedVersion !==
                undefined
            ) {

                const exists =
                    await this.findOne({

                        tenantId,

                        transactionId

                    });


                if (
                    exists
                ) {

                    const error =
                        new Error(
                            'Distributed transaction version conflict'
                        );

                    error.code =
                        'DISTRIBUTED_TRANSACTION_VERSION_CONFLICT';

                    error.retryable =
                        true;

                    throw error;

                }

            }


            return null;

        }


        this.metrics?.counter?.(
            'distributed_transaction_repository_update_total'
        );


        return result;

    }


    /**
     * =========================================================================
     * Save Manager Snapshot
     * =========================================================================
     *
     * Adapter method used directly by DistributedTransactionManager.
     */

    async save(
        snapshot = {}
    ) {

        const {

            tenantId,

            transactionId,

            correlationId,

            requestId,

            idempotencyKey,

            state,

            operations,

            completed,

            history,

            failure,

            rollbackResult,

            commitResult

        } =
            snapshot;


        this.validateIdentity({

            tenantId,

            transactionId,

            correlationId

        });


        const existing =
            await this.findOne({

                tenantId,

                transactionId

            });


        /**
         * First save creates the record.
         */
        if (
            !existing
        ) {

            return this.create({

                tenantId,

                transactionId,

                correlationId,

                requestId,

                idempotencyKey,

                state:
                    state ||
                    TRANSACTION_STATES.CREATED,

                operations:
                    this.convertManagerOperations(
                        operations
                    ),

                completedOperations:
                    this.convertCompletedOperations(
                        completed
                    ),

                executionHistory:
                    this.limitHistory(
                        history
                    ),

                failure:
                    this.normalizeFailure(
                        failure
                    ),

                metadata: {

                    managerSnapshot:
                        true

                }

            });

        }


        const completedOperations =
            this.convertCompletedOperations(
                completed
            );


        const operationDefinitions =
            this.convertManagerOperations(
                operations
            );


        const history =
            this.limitHistory(
                snapshot.history
            );


        const patch = {

            correlationId,

            requestId,

            idempotencyKey,

            state,

            operations:
                operationDefinitions,

            completedOperations,

            executionHistory:
                history,

            failure:
                this.normalizeFailure(
                    failure
                ),

            operationCount:
                operationDefinitions.length,

            completedOperationCount:
                completedOperations.length,

            failedOperationCount:
                operationDefinitions.filter(
                    operation =>
                        operation.state ===
                        OPERATION_STATES.FAILED ||
                        operation.state ===
                        OPERATION_STATES.COMPENSATION_FAILED
                ).length,

            compensationFailureCount:
                Array.isArray(
                    rollbackResult?.failures
                )
                    ? rollbackResult.failures.length
                    : 0

        };


        if (
            state ===
            TRANSACTION_STATES.COMMITTED
        ) {

            patch.finishedAt =
                snapshot.finishedAt ||
                this.now();

            patch.commitResult =
                this.safeResult(
                    commitResult
                );

        }


        if (
            state ===
            TRANSACTION_STATES.ROLLING_BACK ||
            state ===
            TRANSACTION_STATES.ROLLED_BACK ||
            state ===
            TRANSACTION_STATES.COMPENSATION_FAILED
        ) {

            patch.rollbackResult =
                this.safeResult(
                    rollbackResult
                );

            patch.compensationState =
                this.resolveCompensationState(
                    state,
                    rollbackResult
                );

        }


        const updated =
            await this.update({

                tenantId,

                transactionId,

                patch

            });


        if (
            !updated
        ) {

            throw new Error(
                'Distributed transaction record not found during save'
            );

        }


        return updated;

    }


    /**
     * =========================================================================
     * Claim
     * =========================================================================
     *
     * Atomic worker acquisition.
     */

    async claim({

        tenantId,

        transactionId,

        workerId,

        leaseMs =
            this.defaultLeaseMs

    } = {}) {

        if (
            !tenantId
        ) {

            throw new Error(
                'tenantId is required'
            );

        }

        if (
            !transactionId
        ) {

            throw new Error(
                'transactionId is required'
            );

        }

        if (
            !workerId
        ) {

            throw new Error(
                'workerId is required'
            );

        }


        const now =
            this.now();


        const leaseExpiresAt =
            new Date(
                now.getTime() +
                Number(
                    leaseMs
                )
            );


        const filter = {

            tenantId,

            transactionId,

            $or: [

                {
                    workerId
                },

                {
                    leaseExpiresAt: {
                        $lte:
                            now

                    }

                },

                {
                    leaseExpiresAt:
                        null

                },

                {
                    workerId:
                        null
                }

            ],

            state: {

                $in: [

                    TRANSACTION_STATES.CREATED,

                    TRANSACTION_STATES.RUNNING,

                    TRANSACTION_STATES.ROLLING_BACK,

                    TRANSACTION_STATES.COMPENSATION_FAILED

                ]

            }

        };


        const record =
            await this.model.findOneAndUpdate(

                filter,

                {

                    $set: {

                        workerId,

                        leaseExpiresAt,

                        lastHeartbeatAt:
                            now

                    },

                    $inc: {

                        recoveryAttempts:
                            1,

                        version:
                            1

                    }

                },

                {

                    new:
                        true,

                    runValidators:
                        true

                }

            );


        if (
            record
        ) {

            this.metrics?.counter?.(
                'distributed_transaction_repository_claim_success_total'
            );

        }
        else {

            this.metrics?.counter?.(
                'distributed_transaction_repository_claim_conflict_total'
            );

        }


        return record;

    }


    /**
     * =========================================================================
     * Heartbeat
     * =========================================================================
     */

    async heartbeat({

        tenantId,

        transactionId,

        workerId,

        leaseMs =
            this.defaultLeaseMs

    } = {}) {

        const now =
            this.now();


        const leaseExpiresAt =
            new Date(
                now.getTime() +
                Number(
                    leaseMs
                )
            );


        const record =
            await this.model.findOneAndUpdate(

                {

                    tenantId,

                    transactionId,

                    workerId,

                    state: {

                        $in: [

                            TRANSACTION_STATES.RUNNING,

                            TRANSACTION_STATES.ROLLING_BACK

                        ]

                    }

                },

                {

                    $set: {

                        lastHeartbeatAt:
                            now,

                        leaseExpiresAt

                    },

                    $inc: {

                        version:
                            1

                    }

                },

                {

                    new:
                        true

                }

            );


        return record;

    }


    /**
     * =========================================================================
     * Release Lease
     * =========================================================================
     */

    async releaseLease({

        tenantId,

        transactionId,

        workerId

    } = {}) {

        const filter = {

            tenantId,

            transactionId

        };


        if (
            workerId
        ) {

            filter.workerId =
                workerId;

        }


        return this.model
            .findOneAndUpdate(

                filter,

                {

                    $unset: {

                        workerId:
                            1,

                        leaseExpiresAt:
                            1,

                        lastHeartbeatAt:
                            1

                    },

                    $inc: {

                        version:
                            1

                    }

                },

                {

                    new:
                        true

                }

            );

    }


    /**
     * =========================================================================
     * Complete
     * =========================================================================
     */

    async complete({

        tenantId,

        transactionId,

        result = null,

        expectedVersion = null

    } = {}) {

        const patch = {

            state:
                TRANSACTION_STATES.COMMITTED,

            compensationState:
                COMPENSATION_STATES.NOT_REQUIRED,

            finishedAt:
                this.now(),

            commitResult:
                this.safeResult(
                    result
                ),

            nextRecoveryAt:
                null,

            failure:
                undefined

        };


        return this.update({

            tenantId,

            transactionId,

            patch,

            expectedVersion

        });

    }


    /**
     * =========================================================================
     * Fail
     * =========================================================================
     */

    async fail({

        tenantId,

        transactionId,

        error,

        expectedVersion = null

    } = {}) {

        const normalizedFailure =
            this.normalizeFailure(
                error
            );


        return this.update({

            tenantId,

            transactionId,

            patch: {

                state:
                    TRANSACTION_STATES.FAILED,

                failure:
                    normalizedFailure,

                finishedAt:
                    this.now(),

                nextRecoveryAt:
                    null

            },

            expectedVersion

        });

    }


    /**
     * =========================================================================
     * Rollback
     * =========================================================================
     */

    async rollback({

        tenantId,

        transactionId,

        originalError = null,

        failures = [],

        result = null,

        expectedVersion = null

    } = {}) {

        const compensationFailureCount =
            Array.isArray(
                failures
            )
                ? failures.length
                : 0;


        const fullyRolledBack =
            compensationFailureCount === 0;


        return this.update({

            tenantId,

            transactionId,

            patch: {

                state:
                    fullyRolledBack
                        ? TRANSACTION_STATES.ROLLED_BACK
                        : TRANSACTION_STATES.COMPENSATION_FAILED,

                compensationState:
                    fullyRolledBack
                        ? COMPENSATION_STATES.COMPLETED
                        : COMPENSATION_STATES.FAILED,

                rollbackFinishedAt:
                    this.now(),

                rollbackResult:
                    this.safeResult(
                        result
                    ),

                failure:
                    this.normalizeFailure(
                        originalError
                    ),

                compensationFailures:
                    this.normalizeFailures(
                        failures
                    ),

                compensationFailureCount,

                finishedAt:
                    fullyRolledBack
                        ? this.now()
                        : null

            },

            expectedVersion

        });

    }


    /**
     * =========================================================================
     * Mark Operation Running
     * =========================================================================
     */

    async markOperationRunning({

        tenantId,

        transactionId,

        operationId,

        attemptCount = null

    } = {}) {

        const record =
            await this.findOne({

                tenantId,

                transactionId

            });


        if (
            !record
        ) {

            return null;

        }


        const operation =
            record.operations?.find(
                item =>
                    item.operationId ===
                    operationId
            );


        if (
            !operation
        ) {

            throw new Error(
                `Distributed transaction operation not found: ${operationId}`
            );

        }


        operation.state =
            OPERATION_STATES.RUNNING;

        operation.startedAt =
            operation.startedAt ||
            this.now();


        if (
            Number.isInteger(
                attemptCount
            )
        ) {

            operation.attemptCount =
                attemptCount;

        }


        return record.save();

    }


    /**
     * =========================================================================
     * Mark Operation Completed
     * =========================================================================
     */

    async markOperationCompleted({

        tenantId,

        transactionId,

        operationId,

        resultSummary = null,

        attemptCount = null,

        durationMs = null

    } = {}) {

        const record =
            await this.findOne({

                tenantId,

                transactionId

            });


        if (
            !record
        ) {

            return null;

        }


        const operation =
            record.operations?.find(
                item =>
                    item.operationId ===
                    operationId
            );


        if (
            !operation
        ) {

            throw new Error(
                `Distributed transaction operation not found: ${operationId}`
            );

        }


        operation.state =
            OPERATION_STATES.COMPLETED;

        operation.completedAt =
            this.now();


        if (
            resultSummary !==
            undefined
        ) {

            operation.resultSummary =
                this.safeResult(
                    resultSummary
                );

        }


        if (
            Number.isInteger(
                attemptCount
            )
        ) {

            operation.attemptCount =
                attemptCount;

        }


        if (
            Number.isFinite(
                durationMs
            )
        ) {

            operation.durationMs =
                durationMs;

        }


        const exists =
            record.completedOperations?.some(
                item =>
                    item.operationId ===
                    operationId
            );


        if (
            !exists
        ) {

            record.completedOperations.push({

                operationId,

                operationName:
                    operation.name,

                completedAt:
                    operation.completedAt,

                attemptCount:
                    operation.attemptCount,

                durationMs:
                    operation.durationMs,

                resultSummary:
                    operation.resultSummary

            });

        }


        record.completedOperationCount =
            record.completedOperations.length;


        return record.save();

    }


    /**
     * =========================================================================
     * Mark Operation Failed
     * =========================================================================
     */

    async markOperationFailed({

        tenantId,

        transactionId,

        operationId,

        error,

        retryable = false

    } = {}) {

        const record =
            await this.findOne({

                tenantId,

                transactionId

            });


        if (
            !record
        ) {

            return null;

        }


        const operation =
            record.operations?.find(
                item =>
                    item.operationId ===
                    operationId
            );


        if (
            !operation
        ) {

            throw new Error(
                `Distributed transaction operation not found: ${operationId}`
            );

        }


        operation.state =
            OPERATION_STATES.FAILED;

        operation.failedAt =
            this.now();

        operation.failure =
            this.normalizeFailure({

                ...(error || {}),

                retryable

            });


        record.failedOperationCount =
            record.operations.filter(
                item =>
                    item.state ===
                    OPERATION_STATES.FAILED ||
                    item.state ===
                    OPERATION_STATES.COMPENSATION_FAILED
            ).length;


        return record.save();

    }


    /**
     * =========================================================================
     * Mark Operation Compensated
     * =========================================================================
     */

    async markOperationCompensated({

        tenantId,

        transactionId,

        operationId

    } = {}) {

        return this.updateOperationState({

            tenantId,

            transactionId,

            operationId,

            state:
                OPERATION_STATES.COMPENSATED,

            compensatedAt:
                this.now()

        });

    }


    /**
     * =========================================================================
     * Mark Compensation Failed
     * =========================================================================
     */

    async markCompensationFailed({

        tenantId,

        transactionId,

        operationId,

        error

    } = {}) {

        const record =
            await this.findOne({

                tenantId,

                transactionId

            });


        if (
            !record
        ) {

            return null;

        }


        const operation =
            record.operations?.find(
                item =>
                    item.operationId ===
                    operationId
            );


        if (
            !operation
        ) {

            throw new Error(
                `Distributed transaction operation not found: ${operationId}`
            );

        }


        operation.state =
            OPERATION_STATES.COMPENSATION_FAILED;


        operation.compensationFailure =
            this.normalizeFailure(
                error
            );


        operation.failedAt =
            this.now();


        record.compensationFailureCount =
            record.operations.filter(
                item =>
                    item.state ===
                    OPERATION_STATES.COMPENSATION_FAILED
            ).length;


        record.compensationState =
            COMPENSATION_STATES.FAILED;


        return record.save();

    }


    /**
     * =========================================================================
     * Update Operation State
     * =========================================================================
     */

    async updateOperationState({

        tenantId,

        transactionId,

        operationId,

        state,

        ...fields

    } = {}) {

        const record =
            await this.findOne({

                tenantId,

                transactionId

            });


        if (
            !record
        ) {

            return null;

        }


        const operation =
            record.operations?.find(
                item =>
                    item.operationId ===
                    operationId
            );


        if (
            !operation
        ) {

            throw new Error(
                `Distributed transaction operation not found: ${operationId}`
            );

        }


        operation.state =
            state;


        Object.assign(
            operation,
            fields
        );


        return record.save();

    }


    /**
     * =========================================================================
     * Recovery Queries
     * =========================================================================
     */

    async findRecoverable({

        tenantId = null,

        limit =
            this.recoveryLimit

    } = {}) {

        return this.model
            .findRecoverable({

                tenantId,

                limit,

                now:
                    this.now()

            });

    }


    /**
     * =========================================================================
     * Active Queries
     * =========================================================================
     */

    async findActive({

        tenantId = null,

        limit =
            this.recoveryLimit

    } = {}) {

        return this.model
            .findActive({

                tenantId,

                limit

            });

    }


    /**
     * =========================================================================
     * Find Expired Leases
     * =========================================================================
     */

    async findExpiredLeases({

        tenantId = null,

        limit =
            this.recoveryLimit

    } = {}) {

        const now =
            this.now();


        return this.model
            .find({

                ...(tenantId
                    ? { tenantId }
                    : {}),

                leaseExpiresAt: {

                    $lte:
                        now

                },

                state: {

                    $in: [

                        TRANSACTION_STATES.RUNNING,

                        TRANSACTION_STATES.ROLLING_BACK,

                        TRANSACTION_STATES.COMPENSATION_FAILED

                    ]

                }

            })

            .sort({

                leaseExpiresAt:
                    1

            })

            .limit(
                limit
            );

    }


    /**
     * =========================================================================
     * Find Compensation Failures
     * =========================================================================
     */

    async findCompensationFailures({

        tenantId = null,

        limit =
            this.recoveryLimit

    } = {}) {

        return this.model
            .find({

                ...(tenantId
                    ? { tenantId }
                    : {}),

                state:
                    TRANSACTION_STATES.COMPENSATION_FAILED,

                compensationState: {

                    $in: [

                        COMPENSATION_STATES.FAILED,

                        COMPENSATION_STATES.PARTIAL

                    ]

                }

            })

            .sort({

                updatedAt:
                    1

            })

            .limit(
                limit
            );

    }


    /**
     * =========================================================================
     * Schedule Recovery
     * =========================================================================
     */

    async scheduleRecovery({

        tenantId,

        transactionId,

        nextRecoveryAt,

        reason = null

    } = {}) {

        if (
            !nextRecoveryAt
        ) {

            throw new Error(
                'nextRecoveryAt is required'
            );

        }


        const patch = {

            nextRecoveryAt,

            recoveryReason:
                reason

        };


        return this.update({

            tenantId,

            transactionId,

            patch

        });

    }


    /**
     * =========================================================================
     * Clear Recovery Schedule
     * =========================================================================
     */

    async clearRecoverySchedule({

        tenantId,

        transactionId

    } = {}) {

        return this.update({

            tenantId,

            transactionId,

            patch: {

                nextRecoveryAt:
                    null,

                recoveryReason:
                    null

            }

        });

    }


    /**
     * =========================================================================
     * Health
     * =========================================================================
     */

    async health() {

        try {

            await this.model
                .findOne({})
                .select('_id')
                .lean()
                .limit(1);

            return {

                status:
                    'UP',

                repository:
                    'DistributedTransactionRepository',

                model:
                    this.model.modelName

            };

        }
        catch (error) {

            return {

                status:
                    'DOWN',

                repository:
                    'DistributedTransactionRepository',

                error:
                    this.safeError(
                        error
                    )

            };

        }

    }


    /**
     * =========================================================================
     * Statistics
     * =========================================================================
     */

    stats() {

        return {

            repository:
                'DistributedTransactionRepository',

            recoveryLimit:
                this.recoveryLimit,

            defaultLeaseMs:
                this.defaultLeaseMs,

            maxHistory:
                this.maxHistory

        };

    }


    /**
     * =========================================================================
     * Internal Helpers
     * =========================================================================
     */

    validateIdentity({

        tenantId,

        transactionId,

        correlationId

    }) {

        if (
            !tenantId
        ) {

            throw new Error(
                'tenantId is required'
            );

        }


        if (
            !transactionId
        ) {

            throw new Error(
                'transactionId is required'
            );

        }


        if (
            correlationId ===
            undefined
        ) {

            throw new Error(
                'correlationId is required'
            );

        }


        return true;

    }


    normalizeOperations(
        operations
    ) {

        if (
            !Array.isArray(
                operations
            )
        ) {

            return [];

        }


        return operations.map(
            operation => ({

                operationId:
                    operation.id ||
                    operation.operationId ||
                    crypto.randomUUID(),

                name:
                    operation.name ||
                    'unknown-operation',

                state:
                    operation.state ||
                    OPERATION_STATES.PENDING,

                timeoutMs:
                    Number(
                        operation.timeout ||
                        operation.timeoutMs ||
                        60000
                    ),

                maxRetries:
                    Number(
                        operation.retries ??
                        operation.maxRetries ??
                        0
                    ),

                retryable:
                    operation.retryable !== false,

                idempotencyKey:
                    operation.idempotencyKey ||
                    null,

                metadata:
                    this.sanitizeMetadata(
                        operation.metadata ||
                        {}
                    )

            })
        );

    }


    convertManagerOperations(
        operations
    ) {

        if (
            !Array.isArray(
                operations
            )
        ) {

            return [];

        }


        return this.normalizeOperations(
            operations
        );

    }


    convertCompletedOperations(
        completed
    ) {

        if (
            !Array.isArray(
                completed
            )
        ) {

            return [];

        }


        return completed.map(
            item => ({

                operationId:
                    item.operationId ||
                    item.operation?.id ||
                    crypto.randomUUID(),

                operationName:
                    item.operationName ||
                    item.operation?.name ||
                    'unknown-operation',

                completedAt:
                    item.completedAt ||
                    this.now(),

                attemptCount:
                    item.attemptCount ||
                    1,

                durationMs:
                    item.durationMs,

                resultSummary:
                    this.safeResult(
                        item.result
                    )

            })
        );

    }


    createDefaultRetryState() {

        return {

            state:
                RETRY_STATES.IDLE,

            attempts:
                0,

            maxAttempts:
                0

        };

    }


    resolveCompensationState(
        state,
        rollbackResult
    ) {

        if (
            state ===
            TRANSACTION_STATES.ROLLED_BACK
        ) {

            return COMPENSATION_STATES.COMPLETED;

        }


        if (
            state ===
            TRANSACTION_STATES.COMPENSATION_FAILED
        ) {

            return COMPENSATION_STATES.FAILED;

        }


        if (
            Array.isArray(
                rollbackResult?.failures
            ) &&
            rollbackResult.failures.length > 0
        ) {

            return COMPENSATION_STATES.PARTIAL;

        }


        return COMPENSATION_STATES.RUNNING;

    }


    normalizeFailure(
        error
    ) {

        if (
            !error
        ) {

            return undefined;

        }


        const source =
            error.error ||
            error;


        return {

            code:
                source.code,

            category:
                source.category,

            message:
                String(
                    source.message ||
                    source
                ).slice(
                    0,
                    2000
                ),

            retryable:
                Boolean(
                    source.retryable
                ),

            operationId:
                source.operationId,

            provider:
                source.provider,

            occurredAt:
                source.occurredAt ||
                this.now(),

            metadata:
                this.sanitizeMetadata(
                    source.metadata ||
                    {}
                )

        };

    }


    normalizeFailures(
        failures
    ) {

        if (
            !Array.isArray(
                failures
            )
        ) {

            return [];

        }


        return failures.map(
            failure =>
                this.normalizeFailure(
                    failure
                )
        );

    }


    safeResult(
        result
    ) {

        if (
            result ===
            undefined
        ) {

            return undefined;

        }


        if (
            result ===
            null
        ) {

            return null;

        }


        if (
            typeof result ===
            'object'
        ) {

            /**
             * Do not persist functions, sockets, streams, or giant arbitrary
             * structures as workflow results.
             */
            return this.sanitizeMetadata(
                result
            );

        }


        return result;

    }


    sanitizePatch(
        patch
    ) {

        if (
            !patch ||
            typeof patch !==
            'object'
        ) {

            return {};

        }


        const output = {};

        for (
            const [
                key,
                value
            ]
            of Object.entries(
                patch
            )
        ) {

            if (
                key ===
                '_id'
            ) {

                continue;

            }


            if (
                key ===
                'version'
            ) {

                continue;

            }


            output[key] =
                value;

        }


        return output;

    }


    sanitizeMetadata(
        metadata
    ) {

        if (
            !metadata ||
            typeof metadata !==
            'object' ||
            Array.isArray(metadata)
        ) {

            return {};

        }


        const sensitive =
            new Set([

                'password',

                'secret',

                'clientSecret',

                'client_secret',

                'accessToken',

                'access_token',

                'refreshToken',

                'refresh_token',

                'authorization',

                'apiKey',

                'api_key',

                'privateKey',

                'private_key'

            ]);


        const result = {};

        for (
            const [
                key,
                value
            ]
            of Object.entries(
                metadata
            )
        ) {

            if (
                sensitive.has(
                    key
                )
            ) {

                result[key] =
                    '[REDACTED]';

                continue;

            }


            result[key] =
                value;

        }


        return result;

    }


    limitHistory(
        history
    ) {

        if (
            !Array.isArray(
                history
            )
        ) {

            return [];

        }


        return history
            .slice(
                -this.maxHistory
            )
            .map(
                entry => ({

                    type:
                        entry.type,

                    operationId:
                        entry.operationId,

                    operation:
                        entry.operation,

                    state:
                        entry.state,

                    success:
                        entry.success,

                    attempt:
                        entry.attempt,

                    durationMs:
                        entry.durationMs,

                    retryable:
                        entry.retryable,

                    error:
                        this.normalizeFailure(
                            entry.error
                        ),

                    occurredAt:
                        entry.timestamp ||
                        entry.occurredAt ||
                        this.now()

                })
            );

    }


    isDuplicateKeyError(
        error
    ) {

        return (
            error?.code ===
            DUPLICATE_KEY_CODE
        );

    }


    now() {

        return new this.clock();

    }

}


/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports =
    DistributedTransactionRepository;

module.exports.DistributedTransactionRepository =
    DistributedTransactionRepository;