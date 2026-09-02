'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Distributed Transaction Recovery Adapter
 * ============================================================================
 *
 * File:
 *   backend/modules/transactions/recovery/DistributedTransactionRecoveryAdapter.js
 *
 * Purpose
 * -------
 * Recover persisted distributed sagas after:
 *
 *   • process crashes
 *   • container restarts
 *   • Kubernetes rescheduling
 *   • worker termination
 *   • transient infrastructure failures
 *   • expired workflow leases
 *
 * Responsibilities
 * ----------------
 * • Discover recoverable DistributedTransactionRecord documents
 * • Atomically claim a saga for one worker
 * • Reconstruct workflow execution state
 * • Rebind registered operation handlers
 * • Skip already-completed operations
 * • Resume pending/incomplete operations
 * • Resume compensation
 * • Persist workflow checkpoints
 * • Maintain worker lease/heartbeat
 * • Release leases safely
 * • Schedule retry/recovery
 * • Protect against duplicate external side effects
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • Defining business operations
 * • Payment-provider communication
 * • Ledger posting
 * • AML/Fraud/KYC execution
 * • Creating compensating business logic
 *
 * IMPORTANT
 * ---------
 * A persisted saga record does NOT contain executable JavaScript functions.
 *
 * Therefore recovery requires an operation registry:
 *
 *   operationName / operationId
 *          ↓
 *   executable handler
 *
 * Never deserialize executable code from MongoDB.
 *
 * ============================================================================
 */

const crypto = require('crypto');


const DistributedTransactionManager =
    require('../DistributedTransactionManager');


const {
    TRANSACTION_STATES,
    OPERATION_STATES,
    COMPENSATION_STATES,
    RETRY_STATES
} =
    require('../models/DistributedTransactionRecord');


/**
 * ============================================================================
 * Defaults
 * ============================================================================
 */

const DEFAULT_WORKER_ID =
    process.env.HOSTNAME ||
    `recovery-worker-${process.pid}`;

const DEFAULT_LEASE_MS =
    30000;

const DEFAULT_HEARTBEAT_INTERVAL_MS =
    10000;

const DEFAULT_BATCH_SIZE =
    50;

const DEFAULT_RECOVERY_DELAY_MS =
    5000;

const DEFAULT_MAX_RECOVERY_ATTEMPTS =
    10;


/**
 * ============================================================================
 * Recovery Adapter
 * ============================================================================
 */

class DistributedTransactionRecoveryAdapter {

    constructor({

        repository,

        operationRegistry,

        logger =
            console,

        metrics =
            null,

        tracer =
            null,

        auditPublisher =
            null,

        eventBus =
            null,

        workerId =
            DEFAULT_WORKER_ID,

        leaseMs =
            DEFAULT_LEASE_MS,

        heartbeatIntervalMs =
            DEFAULT_HEARTBEAT_INTERVAL_MS,

        batchSize =
            DEFAULT_BATCH_SIZE,

        recoveryDelayMs =
            DEFAULT_RECOVERY_DELAY_MS,

        maxRecoveryAttempts =
            DEFAULT_MAX_RECOVERY_ATTEMPTS,

        managerFactory =
            null,

        managerOptions =
            {}

    } = {}) {

        if (
            !repository
        ) {

            throw new Error(
                'DistributedTransactionRepository is required'
            );

        }


        if (
            !operationRegistry
        ) {

            throw new Error(
                'operationRegistry is required'
            );

        }


        this.repository =
            repository;


        this.operationRegistry =
            operationRegistry;


        this.logger =
            logger;


        this.metrics =
            metrics;


        this.tracer =
            tracer;


        this.auditPublisher =
            auditPublisher;


        this.eventBus =
            eventBus;


        this.workerId =
            workerId;


        this.leaseMs =
            Number(
                leaseMs
            );


        this.heartbeatIntervalMs =
            Number(
                heartbeatIntervalMs
            );


        this.batchSize =
            Number(
                batchSize
            );


        this.recoveryDelayMs =
            Number(
                recoveryDelayMs
            );


        this.maxRecoveryAttempts =
            Number(
                maxRecoveryAttempts
            );


        this.managerFactory =
            typeof managerFactory ===
            'function'
                ? managerFactory
                : null;


        this.managerOptions =
            {
                ...managerOptions
            };


        this.activeRecoveries =
            new Map();


        this.running =
            false;


        this.shutdownRequested =
            false;


        this.startedAt =
            new Date();


        this.statistics = {

            scanned:
                0,

            claimed:
                0,

            claimConflicts:
                0,

            resumed:
                0,

            compensated:
                0,

            completed:
                0,

            failed:
                0,

            skipped:
                0,

            recoveryErrors:
                0

        };

    }


    /**
     * =========================================================================
     * Recover One Transaction
     * =========================================================================
     */

    async recover({

        tenantId,

        transactionId

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


        const correlationId =
            crypto.randomUUID();


        const span =
            this.startSpan(
                'distributed.transaction.recover'
            );


        const startedAt =
            Date.now();


        let record;


        try {

            record =
                await this.repository.findOne({

                    tenantId,

                    transactionId

                });


            if (
                !record
            ) {

                this.statistics.skipped++;


                return {

                    success:
                        false,

                    recovered:
                        false,

                    reason:
                        'TRANSACTION_NOT_FOUND',

                    tenantId,

                    transactionId

                };

            }


            /**
             * ---------------------------------------------------------------
             * Terminal transactions do not need recovery.
             * ---------------------------------------------------------------
             */

            if (
                this.isTerminalState(
                    record.state
                )
            ) {

                this.statistics.skipped++;


                return {

                    success:
                        true,

                    recovered:
                        false,

                    skipped:
                        true,

                    reason:
                        'TRANSACTION_ALREADY_TERMINAL',

                    state:
                        record.state,

                    transactionId,

                    tenantId

                };

            }


            /**
             * ---------------------------------------------------------------
             * Recovery-attempt protection.
             * ---------------------------------------------------------------
             */

            if (
                record.recoveryAttempts >=
                this.maxRecoveryAttempts
            ) {

                this.statistics.failed++;


                await this.scheduleRetry(
                    record,
                    'MAX_RECOVERY_ATTEMPTS_EXCEEDED'
                );


                return {

                    success:
                        false,

                    recovered:
                        false,

                    reason:
                        'MAX_RECOVERY_ATTEMPTS_EXCEEDED',

                    transactionId,

                    tenantId

                };

            }


            /**
             * ---------------------------------------------------------------
             * Atomic worker claim.
             * ---------------------------------------------------------------
             */

            const claimed =
                await this.repository.claim({

                    tenantId,

                    transactionId,

                    workerId:
                        this.workerId,

                    leaseMs:
                        this.leaseMs

                });


            if (
                !claimed
            ) {

                this.statistics.claimConflicts++;


                this.metrics?.increment?.(
                    'distributed_transaction_recovery_claim_conflict_total'
                );


                return {

                    success:
                        false,

                    recovered:
                        false,

                    reason:
                        'CLAIM_CONFLICT',

                    transactionId,

                    tenantId

                };

            }


            this.statistics.claimed++;


            this.metrics?.increment?.(
                'distributed_transaction_recovery_claim_success_total'
            );


            this.activeRecoveries.set(
                transactionId,
                {

                    tenantId,

                    transactionId,

                    startedAt:
                        new Date(),

                    correlationId

                }
            );


            await this.publishRecoveryEvent(
                'DISTRIBUTED_TRANSACTION_RECOVERY_CLAIMED',
                {

                    tenantId,

                    transactionId,

                    correlationId,

                    workerId:
                        this.workerId

                }
            );


            /**
             * ---------------------------------------------------------------
             * Start heartbeat.
             * ---------------------------------------------------------------
             */

            const heartbeat =
                this.startHeartbeat({

                    tenantId,

                    transactionId

                });


            try {

                const freshRecord =
                    await this.repository.findOne({

                        tenantId,

                        transactionId

                    });


                if (
                    !freshRecord
                ) {

                    throw new Error(
                        'Transaction disappeared after recovery claim'
                    );

                }


                /**
                 * -----------------------------------------------------------
                 * Re-check terminal state after claim.
                 * -----------------------------------------------------------
                 *
                 * Another worker/process may have completed it before the
                 * recovery worker acquired the lease.
                 */

                if (
                    this.isTerminalState(
                        freshRecord.state
                    )
                ) {

                    this.statistics.skipped++;


                    return {

                        success:
                            true,

                        recovered:
                            false,

                        skipped:
                            true,

                        reason:
                            'BECAME_TERMINAL_AFTER_CLAIM',

                        state:
                            freshRecord.state,

                        transactionId,

                        tenantId

                    };

                }


                /**
                 * -----------------------------------------------------------
                 * Decide resume vs compensation.
                 * -----------------------------------------------------------
                 */

                const mode =
                    this.determineRecoveryMode(
                        freshRecord
                    );


                if (
                    mode ===
                    'COMPENSATE'
                ) {

                    const result =
                        await this.resumeCompensation(
                            freshRecord,
                            heartbeat
                        );


                    this.statistics.compensated++;


                    this.metrics?.increment?.(
                        'distributed_transaction_recovery_compensation_total'
                    );


                    return result;

                }


                const result =
                    await this.resumeExecution(
                        freshRecord,
                        heartbeat
                    );


                this.statistics.resumed++;


                this.metrics?.increment?.(
                    'distributed_transaction_recovery_resume_total'
                );


                return result;

            }
            finally {

                this.stopHeartbeat(
                    heartbeat
                );

            }

        }
        catch (error) {

            this.statistics.recoveryErrors++;


            this.metrics?.increment?.(
                'distributed_transaction_recovery_error_total'
            );


            this.logger.error?.(

                '[DistributedTransactionRecovery] Recovery failed',

                {

                    tenantId,

                    transactionId,

                    correlationId,

                    workerId:
                        this.workerId,

                    error:
                        this.safeError(
                            error
                        )

                }

            );


            try {

                await this.repository.fail({

                    tenantId,

                    transactionId,

                    error: {

                        code:
                            error.code ||
                            'DISTRIBUTED_TRANSACTION_RECOVERY_FAILED',

                        category:
                            error.category ||
                            'RECOVERY',

                        message:
                            error.message,

                        retryable:
                            error.retryable !== false

                    }

                });

            }
            catch (persistError) {

                this.logger.error?.(

                    '[DistributedTransactionRecovery] Failed to persist recovery failure',

                    {

                        tenantId,

                        transactionId,

                        error:
                            this.safeError(
                                persistError
                            )

                    }

                );

            }


            this.setSpanError(
                span,
                error
            );


            throw error;

        }
        finally {

            this.activeRecoveries.delete(
                transactionId
            );


            try {

                await this.repository.releaseLease({

                    tenantId,

                    transactionId,

                    workerId:
                        this.workerId

                });

            }
            catch (releaseError) {

                this.logger.warn?.(

                    '[DistributedTransactionRecovery] Lease release failed',

                    {

                        tenantId,

                        transactionId,

                        error:
                            this.safeError(
                                releaseError
                            )

                    }

                );

            }


            span?.end?.();


            this.metrics?.histogram?.(
                'distributed_transaction_recovery_duration_ms',
                Date.now() -
                startedAt
            );

        }

    }


    /**
     * =========================================================================
     * Resume Execution
     * =========================================================================
     */

    async resumeExecution(
        record,
        heartbeat
    ) {

        const manager =
            this.createManager(
                record
            );


        /**
         * ---------------------------------------------------------------------
         * Reconstruct only operations that are not already completed.
         * ---------------------------------------------------------------------
         */

        const completedIds =
            new Set(

                (record.completedOperations || [])
                    .map(
                        operation =>
                            operation.operationId
                    )

            );


        const persistedOperations =
            Array.isArray(
                record.operations
            )
                ? record.operations
                : [];


        for (
            const persistedOperation
            of persistedOperations
        ) {

            /**
             * Never re-execute a completed operation.
             */
            if (
                completedIds.has(
                    persistedOperation.operationId
                )
            ) {

                continue;

            }


            if (
                persistedOperation.state ===
                OPERATION_STATES.COMPLETED
            ) {

                continue;

            }


            /**
             * ---------------------------------------------------------------
             * Resolve executable operation handler from trusted registry.
             * ---------------------------------------------------------------
             */

            const handler =
                this.resolveOperationHandler(
                    persistedOperation
                );


            if (
                !handler
            ) {

                const error =
                    new Error(

                        `No recovery handler registered for operation ${persistedOperation.name} (${persistedOperation.operationId})`

                    );


                error.code =
                    'RECOVERY_OPERATION_HANDLER_NOT_FOUND';


                error.retryable =
                    false;


                throw error;

            }


            manager.register({

                id:
                    persistedOperation.operationId,

                name:
                    persistedOperation.name,

                timeout:
                    persistedOperation.timeoutMs,

                retries:
                    persistedOperation.maxRetries,

                retryable:
                    persistedOperation.retryable,

                idempotencyKey:
                    persistedOperation.idempotencyKey,

                metadata:
                    persistedOperation.metadata,

                execute:
                    handler.execute,

                rollback:
                    handler.rollback

            });

        }


        /**
         * If every operation was already completed but the persisted state was
         * not committed, let the manager finalize the saga without executing
         * those operations again.
         */
        if (
            manager.operations.length ===
            0 &&
            completedIds.size > 0
        ) {

            const finalized =
                await this.finalizeFromPersistedCompletion(
                    record
                );


            this.statistics.completed++;


            return finalized;

        }


        await this.persistRecoveryCheckpoint(
            record,
            'RUNNING'
        );


        /**
         * Manager executes only registered incomplete operations.
         */
        const result =
            await manager.commit();


        this.statistics.completed++;


        await this.persistManagerResult(
            record,
            result
        );


        await this.publishRecoveryEvent(

            'DISTRIBUTED_TRANSACTION_RECOVERY_COMPLETED',

            {

                tenantId:
                    record.tenantId,

                transactionId:
                    record.transactionId,

                correlationId:
                    record.correlationId,

                workerId:
                    this.workerId,

                state:
                    result.state

            }

        );


        return {

            success:
                true,

            recovered:
                true,

            mode:
                'RESUME',

            result

        };

    }


    /**
     * =========================================================================
     * Resume Compensation
     * =========================================================================
     */

    async resumeCompensation(
        record,
        heartbeat
    ) {

        const manager =
            this.createManager(
                record
            );


        /**
         * ---------------------------------------------------------------------
         * Build only operations that were actually completed.
         *
         * Compensation must happen in reverse order.
         * ---------------------------------------------------------------------
         */

        const completedOperations =
            Array.isArray(
                record.completedOperations
            )
                ? record.completedOperations
                : [];


        const operationRegistry =
            new Map();


        for (
            const persistedOperation
            of record.operations || []
        ) {

            const handler =
                this.resolveOperationHandler(
                    persistedOperation
                );


            if (
                handler
            ) {

                operationRegistry.set(
                    persistedOperation.operationId,
                    {

                        persistedOperation,

                        handler

                    }
                );

            }

        }


        /**
         * We cannot ask the manager to execute normal operations before
         * compensation. Instead, explicitly invoke trusted compensation
         * handlers in reverse completion order.
         */

        const failures = [];


        for (
            const completed
            of [...completedOperations].reverse()
        ) {

            const registration =
                operationRegistry.get(
                    completed.operationId
                );


            if (
                !registration
            ) {

                failures.push({

                    operationId:
                        completed.operationId,

                    operation:
                        completed.operationName,

                    error: {

                        code:
                            'RECOVERY_OPERATION_HANDLER_NOT_FOUND',

                        message:
                            `No recovery handler registered for completed operation ${completed.operationName}`

                    }

                });

                continue;

            }


            const {
                persistedOperation,
                handler
            } =
                registration;


            if (
                typeof handler.rollback !==
                'function'
            ) {

                /**
                 * A completed external side effect without a compensator is
                 * explicitly treated as a compensation failure, not silently
                 * ignored.
                 */
                failures.push({

                    operationId:
                        completed.operationId,

                    operation:
                        completed.operationName,

                    error: {

                        code:
                            'MISSING_COMPENSATION_HANDLER',

                        message:
                            `No compensation handler registered for ${completed.operationName}`

                    }

                });

                continue;

            }


            try {

                const context =
                    this.createRecoveryContext({

                        record,

                        operation:
                            persistedOperation,

                        attempt:
                            1,

                        signal:
                            undefined

                    });


                await handler.rollback(

                    completed.resultSummary,

                    context

                );


                await this.repository.markOperationCompensated({

                    tenantId:
                        record.tenantId,

                    transactionId:
                        record.transactionId,

                    operationId:
                        completed.operationId

                });


            }
            catch (error) {

                failures.push({

                    operationId:
                        completed.operationId,

                    operation:
                        completed.operationName,

                    error:
                        this.safeError(
                            error
                        )

                });


                try {

                    await this.repository.markCompensationFailed({

                        tenantId:
                            record.tenantId,

                        transactionId:
                            record.transactionId,

                        operationId:
                            completed.operationId,

                        error

                    });

                }
                catch (persistError) {

                    this.logger.error?.(

                        '[DistributedTransactionRecovery] Compensation failure persistence failed',

                        {

                            tenantId:
                                record.tenantId,

                            transactionId:
                                record.transactionId,

                            operationId:
                                completed.operationId,

                            error:
                                this.safeError(
                                    persistError
                                )

                        }

                    );

                }

            }


            /**
             * Keep the lease fresh between slow provider compensations.
             */
            await this.safeHeartbeat(
                heartbeat
            );

        }


        const rollbackResult =
            await this.repository.rollback({

                tenantId:
                    record.tenantId,

                transactionId:
                    record.transactionId,

                originalError:
                    record.failure,

                failures,

                result: {

                    rolledBack:
                        failures.length ===
                        0

                }

            });


        if (
            rollbackResult?.state ===
            TRANSACTION_STATES.ROLLED_BACK
        ) {

            this.statistics.completed++;

        }
        else {

            this.statistics.failed++;

        }


        await this.publishRecoveryEvent(

            failures.length === 0
                ? 'DISTRIBUTED_TRANSACTION_RECOVERY_COMPENSATED'
                : 'DISTRIBUTED_TRANSACTION_RECOVERY_COMPENSATION_FAILED',

            {

                tenantId:
                    record.tenantId,

                transactionId:
                    record.transactionId,

                correlationId:
                    record.correlationId,

                workerId:
                    this.workerId,

                failures:
                    failures.length

            }

        );


        return {

            success:
                failures.length ===
                0,

            recovered:
                true,

            mode:
                'COMPENSATE',

            state:
                rollbackResult?.state,

            failures

        };

    }


    /**
     * =========================================================================
     * Determine Recovery Mode
     * =========================================================================
     */

    determineRecoveryMode(
        record
    ) {

        if (
            record.state ===
            TRANSACTION_STATES.ROLLING_BACK
        ) {

            return 'COMPENSATE';

        }


        if (
            record.state ===
            TRANSACTION_STATES.COMPENSATION_FAILED
        ) {

            return 'COMPENSATE';

        }


        if (
            record.compensationState ===
            COMPENSATION_STATES.FAILED
        ) {

            return 'COMPENSATE';

        }


        return 'RESUME';

    }


    /**
     * =========================================================================
     * Manager Reconstruction
     * =========================================================================
     *
     * Critical:
     *
     * The manager receives the same transaction identity and correlation
     * context as the persisted saga.
     */

    createManager(
        record
    ) {

        const options = {

            ...this.managerOptions,

            transactionId:
                record.transactionId,

            tenantId:
                record.tenantId,

            correlationId:
                record.correlationId,

            requestId:
                record.requestId,

            idempotencyKey:
                record.idempotencyKey,

            logger:
                this.logger,

            tracer:
                this.tracer,

            metrics:
                this.metrics,

            auditPublisher:
                this.auditPublisher,

            eventBus:
                this.eventBus,

            persistenceAdapter:
                this.repository

        };


        if (
            this.managerFactory
        ) {

            return this.managerFactory(
                options
            );

        }


        return new DistributedTransactionManager(
            options
        );

    }


    /**
     * =========================================================================
     * Operation Handler Resolution
     * =========================================================================
     *
     * Trusted registry only.
     */

    resolveOperationHandler(
        persistedOperation
    ) {

        if (
            typeof this.operationRegistry ===
            'function'
        ) {

            return this.operationRegistry(
                persistedOperation
            );

        }


        if (
            typeof this.operationRegistry.get ===
            'function'
        ) {

            return this.operationRegistry.get(
                persistedOperation.name
            ) ||
            this.operationRegistry.get(
                persistedOperation.operationId
            );

        }


        if (
            typeof this.operationRegistry ===
            'object'
        ) {

            return (

                this.operationRegistry[
                    persistedOperation.name
                ] ||

                this.operationRegistry[
                    persistedOperation.operationId
                ]

            );

        }


        return null;

    }


    /**
     * =========================================================================
     * Recovery Context
     * =========================================================================
     */

    createRecoveryContext({

        record,

        operation,

        attempt,

        signal

    }) {

        return Object.freeze({

            transactionId:
                record.transactionId,

            tenantId:
                record.tenantId,

            correlationId:
                record.correlationId,

            requestId:
                record.requestId,

            idempotencyKey:
                operation.idempotencyKey ||
                record.idempotencyKey,

            operationId:
                operation.operationId,

            operation:
                operation.name,

            attempt,

            recovery:
                true,

            workerId:
                this.workerId,

            signal,

            metadata:
                this.safeMetadata(
                    operation.metadata
                )

        });

    }


    /**
     * =========================================================================
     * Finalize From Persisted Completion
     * =========================================================================
     */

    async finalizeFromPersistedCompletion(
        record
    ) {

        const completedOperations =
            Array.isArray(
                record.completedOperations
            )
                ? record.completedOperations
                : [];


        const result = {

            success:
                true,

            transactionId:
                record.transactionId,

            state:
                TRANSACTION_STATES.COMMITTED,

            completedOperations:
                completedOperations.length,

            durationMs:
                record.durationMs || 0

        };


        await this.repository.complete({

            tenantId:
                record.tenantId,

            transactionId:
                record.transactionId,

            result

        });


        await this.publishRecoveryEvent(

            'DISTRIBUTED_TRANSACTION_RECOVERY_FINALIZED',

            {

                tenantId:
                    record.tenantId,

                transactionId:
                    record.transactionId,

                correlationId:
                    record.correlationId,

                workerId:
                    this.workerId,

                state:
                    TRANSACTION_STATES.COMMITTED

            }

        );


        this.statistics.completed++;


        return {

            success:
                true,

            recovered:
                true,

            mode:
                'FINALIZE',

            result

        };

    }


    /**
     * =========================================================================
     * Persist Recovery Checkpoint
     * =========================================================================
     */

    async persistRecoveryCheckpoint(
        record,
        state
    ) {

        try {

            await this.repository.update({

                tenantId:
                    record.tenantId,

                transactionId:
                    record.transactionId,

                patch: {

                    state,

                    lastHeartbeatAt:
                        new Date(),

                    workerId:
                        this.workerId,

                    leaseExpiresAt:
                        new Date(
                            Date.now() +
                            this.leaseMs
                        )

                }

            });

        }
        catch (error) {

            this.logger.error?.(

                '[DistributedTransactionRecovery] Failed to persist recovery checkpoint',

                {

                    tenantId:
                        record.tenantId,

                    transactionId:
                        record.transactionId,

                    error:
                        this.safeError(
                            error
                        )

                }

            );


            throw error;

        }

    }


    /**
     * =========================================================================
     * Persist Manager Result
     * =========================================================================
     */

    async persistManagerResult(
        record,
        result
    ) {

        if (
            result?.state ===
            TRANSACTION_STATES.COMMITTED
        ) {

            await this.repository.complete({

                tenantId:
                    record.tenantId,

                transactionId:
                    record.transactionId,

                result

            });

            return;

        }


        if (
            result?.state ===
            TRANSACTION_STATES.ROLLED_BACK
        ) {

            await this.repository.rollback({

                tenantId:
                    record.tenantId,

                transactionId:
                    record.transactionId,

                originalError:
                    record.failure,

                failures:
                    result.failures || [],

                result

            });

        }

    }


    /**
     * =========================================================================
     * Discover Recoverable Transactions
     * =========================================================================
     */

    async discover({

        tenantId = null,

        limit =
            this.batchSize

    } = {}) {

        const records =
            await this.repository.findRecoverable({

                tenantId,

                limit

            });


        this.statistics.scanned +=
            records.length;


        return records;

    }


    /**
     * =========================================================================
     * Recover Batch
     * =========================================================================
     */

    async recoverBatch({

        tenantId = null,

        limit =
            this.batchSize

    } = {}) {

        this.running =
            true;


        try {

            const records =
                await this.discover({

                    tenantId,

                    limit

                });


            const results = [];


            for (
                const record
                of records
            ) {

                if (
                    this.shutdownRequested
                ) {

                    break;

                }


                try {

                    const result =
                        await this.recover({

                            tenantId:
                                record.tenantId,

                            transactionId:
                                record.transactionId

                        });


                    results.push(
                        result
                    );

                }
                catch (error) {

                    results.push({

                        success:
                            false,

                        recovered:
                            false,

                        transactionId:
                            record.transactionId,

                        tenantId:
                            record.tenantId,

                        error:
                            this.safeError(
                                error
                            )

                    });

                }

            }


            return {

                success:
                    true,

                scanned:
                    records.length,

                processed:
                    results.length,

                results

            };

        }
        finally {

            this.running =
                false;

        }

    }


    /**
     * =========================================================================
     * Start Continuous Recovery Loop
     * =========================================================================
     */

    async start({

        tenantId = null,

        intervalMs =
            this.recoveryDelayMs

    } = {}) {

        if (
            this.running
        ) {

            return false;

        }


        this.shutdownRequested =
            false;


        this.running =
            true;


        while (
            !this.shutdownRequested
        ) {

            try {

                await this.recoverBatch({

                    tenantId,

                    limit:
                        this.batchSize

                });

            }
            catch (error) {

                this.logger.error?.(

                    '[DistributedTransactionRecovery] Recovery cycle failed',

                    {

                        error:
                            this.safeError(
                                error
                            )

                    }

                );

                this.metrics?.increment?.(
                    'distributed_transaction_recovery_cycle_failure_total'
                );

            }


            if (
                this.shutdownRequested
            ) {

                break;

            }


            await this.sleep(
                intervalMs
            );

        }


        this.running =
            false;


        return true;

    }


    /**
     * =========================================================================
     * Shutdown
     * =========================================================================
     */

    async shutdown() {

        this.shutdownRequested =
            true;


        /**
         * Give active recoveries a chance to release their leases normally.
         */
        const active =
            Array.from(
                this.activeRecoveries.values()
            );


        for (
            const recovery
            of active
        ) {

            try {

                await this.repository.releaseLease({

                    tenantId:
                        recovery.tenantId,

                    transactionId:
                        recovery.transactionId,

                    workerId:
                        this.workerId

                });

            }
            catch (error) {

                this.logger.warn?.(

                    '[DistributedTransactionRecovery] Failed to release shutdown lease',

                    {

                        tenantId:
                            recovery.tenantId,

                        transactionId:
                            recovery.transactionId,

                        error:
                            this.safeError(
                                error
                            )

                    }

                );

            }

        }


        return true;

    }


    /**
     * =========================================================================
     * Heartbeat
     * =========================================================================
     */

    startHeartbeat({

        tenantId,

        transactionId

    }) {

        const interval =
            setInterval(

                async () => {

                    await this.safeHeartbeat({

                        tenantId,

                        transactionId

                    });

                },

                this.heartbeatIntervalMs

            );


        return interval;

    }


    stopHeartbeat(
        heartbeat
    ) {

        if (
            heartbeat
        ) {

            clearInterval(
                heartbeat
            );

        }

    }


    async safeHeartbeat(
        heartbeat
    ) {

        if (
            !heartbeat
        ) {

            return;

        }


        try {

            if (
                typeof heartbeat ===
                'object' &&
                heartbeat.tenantId
            ) {

                await this.repository.heartbeat({

                    tenantId:
                        heartbeat.tenantId,

                    transactionId:
                        heartbeat.transactionId,

                    workerId:
                        this.workerId,

                    leaseMs:
                        this.leaseMs

                });

                return;

            }

            /**
             * Interval handles are not sufficient to identify a transaction,
             * so this branch is intentionally a no-op.
             *
             * Recovery checkpoints are also persisted between operations.
             */

        }
        catch (error) {

            this.logger.warn?.(

                '[DistributedTransactionRecovery] Heartbeat failed',

                {

                    error:
                        this.safeError(
                            error
                        )

                }

            );

            this.metrics?.increment?.(
                'distributed_transaction_recovery_heartbeat_failure_total'
            );

        }

    }


    /**
     * =========================================================================
     * Schedule Retry
     * =========================================================================
     */

    async scheduleRetry(
        record,
        reason
    ) {

        const nextRecoveryAt =
            new Date(

                Date.now() +
                this.recoveryDelayMs

            );


        await this.repository.scheduleRecovery({

            tenantId:
                record.tenantId,

            transactionId:
                record.transactionId,

            nextRecoveryAt,

            reason

        });


        await this.publishRecoveryEvent(

            'DISTRIBUTED_TRANSACTION_RECOVERY_SCHEDULED',

            {

                tenantId:
                    record.tenantId,

                transactionId:
                    record.transactionId,

                correlationId:
                    record.correlationId,

                reason,

                nextRecoveryAt,

                workerId:
                    this.workerId

            }

        );

    }


    /**
     * =========================================================================
     * Terminal State
     * =========================================================================
     */

    isTerminalState(
        state
    ) {

        return [

            TRANSACTION_STATES.COMMITTED,

            TRANSACTION_STATES.ROLLED_BACK,

            TRANSACTION_STATES.FAILED,

            TRANSACTION_STATES.ABORTED

        ].includes(
            state
        );

    }


    /**
     * =========================================================================
     * Recovery Event
     * =========================================================================
     */

    async publishRecoveryEvent(
        type,
        payload
    ) {

        const event = {

            eventId:
                crypto.randomUUID(),

            type,

            timestamp:
                new Date(),

            service:
                'distributed-transaction-recovery',

            workerId:
                this.workerId,

            payload:
                this.safeMetadata(
                    payload
                )

        };


        try {

            await this.auditPublisher?.publish?.(
                event
            );

        }
        catch (error) {

            this.logger.warn?.(

                '[DistributedTransactionRecovery] Audit event failed',

                {

                    type,

                    error:
                        this.safeError(
                            error
                        )

                }

            );

        }


        try {

            await this.eventBus?.publish?.(
                event
            );

        }
        catch (error) {

            this.logger.warn?.(

                '[DistributedTransactionRecovery] Event bus publication failed',

                {

                    type,

                    error:
                        this.safeError(
                            error
                        )

                }

            );

        }

    }


    /**
     * =========================================================================
     * Span
     * =========================================================================
     */

    startSpan(
        name
    ) {

        try {

            return this.tracer?.startSpan?.(

                name,

                {

                    attributes: {

                        'recovery.worker_id':
                            this.workerId

                    }

                }

            );

        }
        catch (_) {

            return null;

        }

    }


    setSpanError(
        span,
        error
    ) {

        try {

            span?.recordException?.(
                error
            );

            span?.setStatus?.({

                code:
                    2,

                message:
                    error?.message

            });

        }
        catch (_) {
            // Tracing must never break recovery.
        }

    }


    /**
     * =========================================================================
     * Safe Metadata
     * =========================================================================
     */

    safeMetadata(
        metadata
    ) {

        if (
            !metadata ||
            typeof metadata !==
            'object'
        ) {

            return {};

        }


        const sensitiveKeys =
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


        return Object.entries(
            metadata
        )
            .reduce(

                (
                    output,
                    [
                        key,
                        value
                    ]
                ) => {

                    if (
                        sensitiveKeys.has(
                            key
                        )
                    ) {

                        output[key] =
                            '[REDACTED]';

                    }
                    else {

                        output[key] =
                            value;

                    }


                    return output;

                },

                {}

            );

    }


    /**
     * =========================================================================
     * Safe Error
     * =========================================================================
     */

    safeError(
        error
    ) {

        if (
            !error
        ) {

            return {

                code:
                    'UNKNOWN_ERROR',

                message:
                    'Unknown error'

            };

        }


        return {

            name:
                error.name,

            code:
                error.code,

            message:
                String(
                    error.message ||
                    error
                )
                    .slice(
                        0,
                        1000
                    ),

            retryable:
                error.retryable

        };

    }


    /**
     * =========================================================================
     * Stats
     * =========================================================================
     */

    stats() {

        return {

            ...this.statistics,

            workerId:
                this.workerId,

            running:
                this.running,

            activeRecoveries:
                this.activeRecoveries.size,

            uptimeMs:
                Date.now() -
                this.startedAt.getTime()

        };

    }


    /**
     * =========================================================================
     * Health
     * =========================================================================
     */

    health() {

        return {

            service:
                'distributed-transaction-recovery',

            status:
                this.running
                    ? 'UP'
                    : 'IDLE',

            workerId:
                this.workerId,

            activeRecoveries:
                this.activeRecoveries.size,

            statistics:
                this.stats()

        };

    }


    /**
     * =========================================================================
     * Sleep
     * =========================================================================
     */

    sleep(
        ms
    ) {

        return new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    ms
                )
        );

    }

}


module.exports =
    DistributedTransactionRecoveryAdapter;


module.exports.DistributedTransactionRecoveryAdapter =
    DistributedTransactionRecoveryAdapter;