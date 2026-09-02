'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Rollback Coordinator
 * ============================================================================
 *
 * File:
 *   backend/modules/transactions/RollbackCoordinator.js
 *
 * Purpose
 * -------
 * Coordinates compensating actions for failed distributed transactions.
 *
 * Responsibilities
 * ----------------
 * • Saga rollback orchestration
 * • Reverse-order compensation
 * • Idempotent compensation
 * • Partial rollback tracking
 * • Compensation retries
 * • Timeout protection
 * • Tenant isolation
 * • Correlation/request propagation
 * • Persistent rollback checkpoints
 * • Recovery of interrupted rollbacks
 * • Audit publishing
 * • Metrics
 * • Distributed tracing
 * • Safe operational diagnostics
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • Financial ledger rules
 * • Payment-provider implementation
 * • Fraud screening
 * • AML screening
 * • KYC
 * • Final compliance decisions
 *
 * Financial Rule
 * --------------
 * Compensation is NOT deletion.
 *
 * A failed financial operation is compensated by a NEW reversing operation
 * through the appropriate domain service / ledger engine.
 *
 * ============================================================================
 */

const crypto = require('crypto');


/**
 * ============================================================================
 * Status Constants
 * ============================================================================
 */

const RollbackStatus = Object.freeze({

    CREATED:
        'CREATED',

    STARTED:
        'STARTED',

    PROCESSING:
        'PROCESSING',

    COMPLETED:
        'COMPLETED',

    FAILED:
        'FAILED',

    PARTIAL:
        'PARTIAL',

    RECOVERING:
        'RECOVERING'

});


const CompensationStatus = Object.freeze({

    PENDING:
        'PENDING',

    PROCESSING:
        'PROCESSING',

    COMPLETED:
        'COMPLETED',

    FAILED:
        'FAILED',

    SKIPPED:
        'SKIPPED'

});


/**
 * ============================================================================
 * Defaults
 * ============================================================================
 */

const DEFAULT_TIMEOUT_MS =
    60000;

const DEFAULT_MAX_RETRIES =
    3;

const DEFAULT_HISTORY_LIMIT =
    500;


/**
 * ============================================================================
 * Helpers
 * ============================================================================
 */

function safeError(error) {

    if (!error) {

        return {

            name:
                'Error',

            message:
                'Unknown error',

            code:
                undefined,

            retryable:
                undefined

        };

    }

    return {

        name:
            error.name,

        message:
            String(
                error.message ||
                error
            ).slice(
                0,
                2000
            ),

        code:
            error.code,

        retryable:
            error.retryable,

        category:
            error.category

    };

}


function normalizeString(
    value,
    fallback = null
) {

    if (
        value === undefined ||
        value === null
    ) {

        return fallback;

    }

    const normalized =
        String(value).trim();


    return normalized ||
        fallback;

}


/**
 * ============================================================================
 * Rollback Coordinator
 * ============================================================================
 */

class RollbackCoordinator {

    constructor(options = {}) {

        this.logger =
            options.logger ||
            console;

        this.repository =
            options.repository;

        this.auditPublisher =
            options.auditPublisher;

        this.metrics =
            options.metrics;

        this.tracer =
            options.tracer;

        this.retryPolicy =
            options.retryPolicy;

        this.timeoutManager =
            options.timeoutManager;

        this.eventBus =
            options.eventBus;

        this.defaultTimeoutMs =
            Number(
                options.timeoutMs ||
                DEFAULT_TIMEOUT_MS
            );

        this.defaultMaxRetries =
            Number(
                options.maxRetries ??
                DEFAULT_MAX_RETRIES
            );

        this.maxHistory =
            Number(
                options.maxHistory ||
                DEFAULT_HISTORY_LIMIT
            );

        this.rollbackHandlers =
            new Map();

        this.rollbackLocks =
            new Map();

        this.activeRollbacks =
            new Map();

        this.statistics = {

            started:
                0,

            completed:
                0,

            failed:
                0,

            partial:
                0,

            compensatedSteps:
                0,

            failedSteps:
                0,

            skippedSteps:
                0,

            retries:
                0

        };

    }


    /**
     * =========================================================================
     * Register Compensation Handler
     * =========================================================================
     *
     * Handler contract:
     *
     * async ({
     *     transaction,
     *     step,
     *     context,
     *     signal
     * }) => result
     */

    register(
        type,
        handler,
        options = {}
    ) {

        const normalizedType =
            normalizeString(
                type
            );


        if (
            !normalizedType
        ) {

            throw new Error(
                'Rollback handler type is required'
            );

        }


        if (
            typeof handler !==
            'function'
        ) {

            throw new Error(
                'Rollback handler must be a function'
            );

        }


        this.rollbackHandlers.set(
            normalizedType,
            Object.freeze({

                handler,

                timeoutMs:
                    Number(
                        options.timeoutMs ||
                        this.defaultTimeoutMs
                    ),

                maxRetries:
                    Number(
                        options.maxRetries ??
                        this.defaultMaxRetries
                    ),

                retryable:
                    options.retryable !== false

            })
        );


        return this;

    }


    /**
     * =========================================================================
     * Execute Rollback
     * =========================================================================
     */

    async rollback(
        transaction,
        context = {}
    ) {

        this.validateTransaction(
            transaction
        );


        const tenantId =
            transaction.tenantId ||
            context.tenantId ||
            null;


        const transactionId =
            transaction.transactionId;


        const correlationId =
            transaction.correlationId ||
            context.correlationId ||
            crypto.randomUUID();


        const rollbackId =
            crypto.randomUUID();


        /**
         * Prevent duplicate rollback execution in the same process.
         */

        const existingLock =
            this.rollbackLocks.get(
                transactionId
            );


        if (
            existingLock
        ) {

            return existingLock;

        }


        const operation =
            this.executeRollbackInternal({

                rollbackId,

                transaction,

                context: {

                    ...context,

                    tenantId,

                    transactionId,

                    correlationId

                }

            });


        this.rollbackLocks.set(
            transactionId,
            operation
        );


        try {

            return await operation;

        }
        finally {

            this.rollbackLocks.delete(
                transactionId
            );

        }

    }


    /**
     * =========================================================================
     * Internal Rollback Executor
     * =========================================================================
     */

    async executeRollbackInternal({

        rollbackId,

        transaction,

        context

    }) {

        const span =
            this.startSpan(
                'transaction.rollback'
            );


        const startedAt =
            new Date();


        const rollbackRecord = {

            rollbackId,

            transactionId:
                transaction.transactionId,

            tenantId:
                context.tenantId,

            correlationId:
                context.correlationId,

            requestId:
                context.requestId ||
                transaction.requestId ||
                null,

            idempotencyKey:
                context.idempotencyKey ||
                transaction.idempotencyKey ||
                null,

            status:
                RollbackStatus.CREATED,

            startedAt,

            completedAt:
                null,

            failure:
                null,

            compensations: [],

            history: []

        };


        this.activeRollbacks.set(
            rollbackId,
            rollbackRecord
        );


        this.statistics.started++;


        try {

            /**
             * ---------------------------------------------------------------
             * Recover existing rollback state first.
             * ---------------------------------------------------------------
             */

            const existing =
                await this.findExistingRollback(
                    transaction
                );


            if (
                existing &&
                existing.status ===
                    RollbackStatus.COMPLETED
            ) {

                this.statistics.completed++;


                return existing;

            }


            /**
             * ---------------------------------------------------------------
             * Persist initial state BEFORE executing side effects.
             * ---------------------------------------------------------------
             */

            rollbackRecord.status =
                RollbackStatus.STARTED;


            this.appendHistory(
                rollbackRecord,
                {

                    type:
                        'ROLLBACK_STARTED',

                    occurredAt:
                        new Date()

                }
            );


            await this.persistRollback(
                rollbackRecord
            );


            await this.publishAuditSafely({

                type:
                    'ROLLBACK_STARTED',

                transactionId:
                    transaction.transactionId,

                rollbackId,

                tenantId:
                    context.tenantId,

                correlationId:
                    context.correlationId

            });


            rollbackRecord.status =
                RollbackStatus.PROCESSING;


            await this.persistRollback(
                rollbackRecord
            );


            /**
             * ---------------------------------------------------------------
             * Determine steps.
             * ---------------------------------------------------------------
             */

            const steps =
                this.getCompensationSteps(
                    transaction
                );


            /**
             * ---------------------------------------------------------------
             * Reverse order.
             * ---------------------------------------------------------------
             */

            const reversedSteps =
                [...steps].reverse();


            /**
             * ---------------------------------------------------------------
             * Execute compensation.
             * ---------------------------------------------------------------
             */

            for (
                const step
                of reversedSteps
            ) {

                await this.executeCompensation({

                    step,

                    transaction,

                    rollbackRecord,

                    context

                });

            }


            /**
             * ---------------------------------------------------------------
             * Final state.
             * ---------------------------------------------------------------
             */

            const failed =
                rollbackRecord.compensations
                    .filter(
                        item =>
                            item.status ===
                            CompensationStatus.FAILED
                    );


            const completed =
                rollbackRecord.compensations
                    .filter(
                        item =>
                            item.status ===
                            CompensationStatus.COMPLETED
                    );


            const skipped =
                rollbackRecord.compensations
                    .filter(
                        item =>
                            item.status ===
                            CompensationStatus.SKIPPED
                    );


            if (
                failed.length > 0
            ) {

                rollbackRecord.status =
                    completed.length > 0 ||
                    skipped.length > 0
                        ? RollbackStatus.PARTIAL
                        : RollbackStatus.FAILED;

                this.statistics.partial +=
                    rollbackRecord.status ===
                    RollbackStatus.PARTIAL
                        ? 1
                        : 0;

                this.statistics.failed +=
                    rollbackRecord.status ===
                    RollbackStatus.FAILED
                        ? 1
                        : 0;

            }
            else {

                rollbackRecord.status =
                    RollbackStatus.COMPLETED;

                this.statistics.completed++;

            }


            rollbackRecord.completedAt =
                new Date();


            await this.persistRollback(
                rollbackRecord
            );


            await this.publishRollbackCompletedSafely(
                rollbackRecord
            );


            this.metrics?.increment?.(

                rollbackRecord.status ===
                    RollbackStatus.COMPLETED

                    ? 'transaction_rollback_success_total'

                    : rollbackRecord.status ===
                        RollbackStatus.PARTIAL

                        ? 'transaction_rollback_partial_total'

                        : 'transaction_rollback_failure_total'

            );


            this.setSpanSuccess(
                span
            );


            return rollbackRecord;

        }
        catch (error) {

            this.statistics.failed++;


            rollbackRecord.status =
                RollbackStatus.FAILED;


            rollbackRecord.failure =
                safeError(
                    error
                );


            rollbackRecord.completedAt =
                new Date();


            this.appendHistory(
                rollbackRecord,
                {

                    type:
                        'ROLLBACK_FAILED',

                    error:
                        safeError(
                            error
                        ),

                    occurredAt:
                        new Date()

                }
            );


            try {

                await this.persistRollback(
                    rollbackRecord
                );

            }
            catch (persistError) {

                this.logger.error?.(

                    '[RollbackCoordinator] Failed to persist rollback failure',

                    {

                        transactionId:
                            transaction.transactionId,

                        rollbackId,

                        error:
                            safeError(
                                persistError
                            )

                    }

                );

            }


            await this.publishAuditSafely({

                type:
                    'ROLLBACK_FAILED',

                transactionId:
                    transaction.transactionId,

                rollbackId,

                tenantId:
                    context.tenantId,

                correlationId:
                    context.correlationId,

                error:
                    safeError(
                        error
                    )

            });


            this.metrics?.increment?.(
                'transaction_rollback_failure_total'
            );


            this.logger.error?.(

                '[RollbackCoordinator] Rollback failed',

                {

                    transactionId:
                        transaction.transactionId,

                    rollbackId,

                    tenantId:
                        context.tenantId,

                    error:
                        safeError(
                            error
                        )

                }

            );


            this.setSpanError(
                span,
                error
            );


            throw error;

        }
        finally {

            this.activeRollbacks.delete(
                rollbackId
            );

            span?.end?.();

        }

    }


    /**
     * =========================================================================
     * Execute One Compensation Step
     * =========================================================================
     */

    async executeCompensation({

        step,

        transaction,

        rollbackRecord,

        context

    }) {

        if (
            !step ||
            !step.id
        ) {

            throw new Error(
                'Compensation step must have an id'
            );

        }


        if (
            step.compensationRequired ===
            false
        ) {

            const skipped = {

                stepId:
                    step.id,

                type:
                    step.type,

                status:
                    CompensationStatus.SKIPPED,

                startedAt:
                    new Date(),

                completedAt:
                    new Date(),

                reason:
                    'COMPENSATION_NOT_REQUIRED'

            };


            rollbackRecord.compensations.push(
                skipped
            );


            this.statistics.skippedSteps++;


            this.appendHistory(
                rollbackRecord,
                {

                    type:
                        'COMPENSATION_SKIPPED',

                    stepId:
                        step.id,

                    occurredAt:
                        new Date()

                }
            );


            await this.persistRollback(
                rollbackRecord
            );


            return skipped;

        }


        const existing =
            rollbackRecord.compensations
                .find(
                    item =>
                        item.stepId ===
                        step.id
                );


        /**
         * Idempotency:
         *
         * A completed compensation must NEVER run twice.
         */

        if (
            existing?.status ===
            CompensationStatus.COMPLETED
        ) {

            this.statistics.skippedSteps++;

            return existing;

        }


        const handlerConfig =
            this.rollbackHandlers.get(
                step.type
            );


        if (
            !handlerConfig
        ) {

            throw new Error(
                `No rollback handler registered for ${step.type}`
            );

        }


        const compensation =
            existing ||
            {

                stepId:
                    step.id,

                type:
                    step.type,

                status:
                    CompensationStatus.PENDING,

                startedAt:
                    null,

                completedAt:
                    null,

                attempts:
                    0,

                error:
                    null

            };


        if (
            !existing
        ) {

            rollbackRecord.compensations.push(
                compensation
            );

        }


        compensation.status =
            CompensationStatus.PROCESSING;


        compensation.startedAt =
            compensation.startedAt ||
            new Date();


        compensation.attempts =
            Number(
                compensation.attempts ||
                0
            );


        await this.persistRollback(
            rollbackRecord
        );


        const operationId =
            step.id;


        const compensationId =
            `${rollbackRecord.rollbackId}:${operationId}`;


        const startedAt =
            Date.now();


        try {

            const execute =
                async ({
                    signal
                } = {}) => {

                    compensation.attempts++;


                    const handlerContext = {

                        ...context,

                        rollbackId:
                            rollbackRecord.rollbackId,

                        compensationId,

                        operationId,

                        signal,

                        recovery:
                            true

                    };


                    return handlerConfig.handler({

                        transaction,

                        step,

                        context:
                            handlerContext

                    });

                };


            let result;


            const maxRetries =
                Number(
                    step.maxCompensationRetries ??
                    handlerConfig.maxRetries ??
                    this.defaultMaxRetries
                );


            const retryable =
                step.compensationRetryable !== false &&
                handlerConfig.retryable !== false;


            if (
                this.retryPolicy?.execute
            ) {

                result =
                    await this.retryPolicy.execute(
                        execute,
                        {

                            transactionId:
                                transaction.transactionId,

                            operationId,

                            maxRetries,

                            retryable

                        }
                    );

            }
            else {

                result =
                    await this.executeWithRetry({

                        execute,

                        transactionId:
                            transaction.transactionId,

                        operationId,

                        maxRetries,

                        retryable,

                        timeoutMs:
                            Number(
                                step.compensationTimeoutMs ||
                                handlerConfig.timeoutMs ||
                                this.defaultTimeoutMs
                            )

                    });

            }


            compensation.status =
                CompensationStatus.COMPLETED;


            compensation.completedAt =
                new Date();


            compensation.durationMs =
                Date.now() -
                startedAt;


            compensation.result =
                this.safeResult(
                    result
                );


            compensation.error =
                null;


            this.statistics.compensatedSteps++;


            this.appendHistory(
                rollbackRecord,
                {

                    type:
                        'COMPENSATION_COMPLETED',

                    stepId:
                        step.id,

                    operation:
                        step.type,

                    durationMs:
                        compensation.durationMs,

                    occurredAt:
                        new Date()

                }
            );


            await this.persistRollback(
                rollbackRecord
            );


            await this.publishAuditSafely({

                type:
                    'COMPENSATION_COMPLETED',

                transactionId:
                    transaction.transactionId,

                rollbackId:
                    rollbackRecord.rollbackId,

                tenantId:
                    context.tenantId,

                stepId:
                    step.id,

                stepType:
                    step.type

            });


            return compensation;

        }
        catch (error) {

            compensation.status =
                CompensationStatus.FAILED;


            compensation.completedAt =
                new Date();


            compensation.durationMs =
                Date.now() -
                startedAt;


            compensation.error =
                safeError(
                    error
                );


            this.statistics.failedSteps++;


            this.appendHistory(
                rollbackRecord,
                {

                    type:
                        'COMPENSATION_FAILED',

                    stepId:
                        step.id,

                    operation:
                        step.type,

                    error:
                        safeError(
                            error
                        ),

                    occurredAt:
                        new Date()

                }
            );


            await this.persistRollback(
                rollbackRecord
            );


            await this.publishAuditSafely({

                type:
                    'COMPENSATION_FAILED',

                transactionId:
                    transaction.transactionId,

                rollbackId:
                    rollbackRecord.rollbackId,

                tenantId:
                    context.tenantId,

                stepId:
                    step.id,

                stepType:
                    step.type,

                error:
                    safeError(
                        error
                    )

            });


            throw error;

        }

    }


    /**
     * =========================================================================
     * Compensation Steps
     * =========================================================================
     */

    getCompensationSteps(
        transaction
    ) {

        const steps =
            Array.isArray(
                transaction.executedSteps
            )
                ? transaction.executedSteps
                : [];


        return steps.filter(
            step =>
                step &&
                step.compensationRequired !== false
        );

    }


    /**
     * =========================================================================
     * Single Step Compensation
     * =========================================================================
     */

    async compensateStep(
        transaction,
        step,
        context = {}
    ) {

        this.validateTransaction(
            transaction
        );


        const rollbackRecord = {

            rollbackId:
                context.rollbackId ||
                crypto.randomUUID(),

            transactionId:
                transaction.transactionId,

            tenantId:
                transaction.tenantId ||
                context.tenantId ||
                null,

            correlationId:
                transaction.correlationId ||
                context.correlationId ||
                crypto.randomUUID(),

            status:
                RollbackStatus.PROCESSING,

            startedAt:
                new Date(),

            compensations: [],

            history: []

        };


        return this.executeCompensation({

            step,

            transaction,

            rollbackRecord,

            context: {

                ...context,

                rollbackId:
                    rollbackRecord.rollbackId

            }

        });

    }


    /**
     * =========================================================================
     * Recover Interrupted Rollback
     * =========================================================================
     */

    async recoverRollback({

        tenantId,

        transactionId

    } = {}) {

        if (
            !tenantId
        ) {

            throw new Error(
                'tenantId is required for rollback recovery'
            );

        }


        if (
            !transactionId
        ) {

            throw new Error(
                'transactionId is required for rollback recovery'
            );

        }


        /**
         * Prefer a dedicated rollback lookup if available.
         */
        let record =
            null;


        if (
            typeof this.repository?.findRollbackByTransactionId ===
            'function'
        ) {

            record =
                await this.repository
                    .findRollbackByTransactionId({

                        tenantId,

                        transactionId

                    });

        }
        else if (
            typeof this.repository?.findByTransactionId ===
            'function'
        ) {

            /**
             * Compatibility fallback.
             *
             * IMPORTANT:
             * tenantId is still supplied when the repository supports the
             * modern contract.
             */
            try {

                record =
                    await this.repository
                        .findByTransactionId({

                            tenantId,

                            transactionId

                        });

            }
            catch (_) {

                /**
                 * Legacy repository contract:
                 *
                 * findByTransactionId(transactionId)
                 *
                 * Keep as a compatibility fallback only.
                 */
                record =
                    await this.repository
                        .findByTransactionId(
                            transactionId
                        );

            }

        }


        if (
            !record
        ) {

            return null;

        }


        if (
            record.status ===
            RollbackStatus.COMPLETED
        ) {

            return record;

        }


        return record;

    }


    /**
     * =========================================================================
     * Persist Rollback
     * =========================================================================
     */

    async persistRollback(
        record
    ) {

        if (
            !this.repository
        ) {

            return record;

        }


        /**
         * New dedicated rollback repository API.
         */
        if (
            typeof this.repository.saveRollback ===
            'function'
        ) {

            return this.repository.saveRollback(
                this.toPersistenceRecord(
                    record
                )
            );

        }


        /**
         * Generic create/update fallback.
         */
        if (
            typeof this.repository.upsertRollback ===
            'function'
        ) {

            return this.repository.upsertRollback(
                this.toPersistenceRecord(
                    record
                )
            );

        }


        if (
            typeof this.repository.create ===
            'function'
        ) {

            /**
             * The original implementation used create() for every checkpoint,
             * which creates duplicates. Only use create for an explicit new
             * rollback repository contract.
             */
            if (
                !record._persisted
            ) {

                const created =
                    await this.repository.create(
                        this.toPersistenceRecord(
                            record
                        )
                    );


                record._persisted =
                    true;


                return created;

            }

        }


        return record;

    }


    /**
     * =========================================================================
     * Persistence Projection
     * =========================================================================
     */

    toPersistenceRecord(
        record
    ) {

        return {

            rollbackId:
                record.rollbackId,

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

            status:
                record.status,

            startedAt:
                record.startedAt,

            completedAt:
                record.completedAt,

            failure:
                record.failure,

            compensations:
                record.compensations.map(
                    compensation => ({

                        stepId:
                            compensation.stepId,

                        type:
                            compensation.type,

                        status:
                            compensation.status,

                        startedAt:
                            compensation.startedAt,

                        completedAt:
                            compensation.completedAt,

                        attempts:
                            compensation.attempts,

                        durationMs:
                            compensation.durationMs,

                        result:
                            this.safeResult(
                                compensation.result
                            ),

                        error:
                            compensation.error

                    })
                ),

            history:
                record.history
                    .slice(
                        -this.maxHistory
                    )

        };

    }


    /**
     * =========================================================================
     * Retry Execution
     * =========================================================================
     */

    async executeWithRetry({

        execute,

        transactionId,

        operationId,

        maxRetries,

        retryable,

        timeoutMs

    }) {

        let attempt =
            0;


        let lastError;


        while (
            attempt <=
            maxRetries
        ) {

            attempt++;


            try {

                return await this.executeWithTimeout(

                    execute,

                    timeoutMs,

                    {

                        transactionId,

                        operationId

                    }

                );

            }
            catch (error) {

                lastError =
                    error;


                if (
                    !retryable ||
                    attempt >
                    maxRetries
                ) {

                    throw error;

                }


                if (
                    !this.isRetryableError(
                        error
                    )
                ) {

                    throw error;

                }


                this.statistics.retries++;


                if (
                    this.retryPolicy?.wait
                ) {

                    await this.retryPolicy.wait(
                        attempt
                    );

                }
                else {

                    await this.sleep(
                        this.calculateBackoff(
                            attempt
                        )
                    );

                }

            }

        }


        throw lastError;

    }


    /**
     * =========================================================================
     * Timeout
     * =========================================================================
     */

    async executeWithTimeout(
        operation,
        timeoutMs,
        metadata = {}
    ) {

        const controller =
            typeof AbortController !==
            'undefined'
                ? new AbortController()
                : null;


        let timer;


        try {

            const execution =
                Promise.resolve()
                    .then(
                        () =>
                            operation({

                                ...metadata,

                                signal:
                                    controller?.signal

                            })
                    );


            const timeout =
                new Promise(
                    (_, reject) => {

                        timer =
                            setTimeout(
                                () => {

                                    controller?.abort?.();


                                    const error =
                                        new Error(

                                            `Compensation operation timed out after ${timeoutMs} ms`

                                        );


                                    error.code =
                                        'COMPENSATION_TIMEOUT';

                                    error.retryable =
                                        true;


                                    reject(
                                        error
                                    );

                                },

                                timeoutMs

                            );

                    }
                );


            return await Promise.race([

                execution,

                timeout

            ]);

        }
        finally {

            clearTimeout(
                timer
            );

        }

    }


    /**
     * =========================================================================
     * Retry Classification
     * =========================================================================
     */

    isRetryableError(
        error
    ) {

        if (
            typeof error?.retryable ===
            'boolean'
        ) {

            return error.retryable;

        }


        const status =
            Number(
                error?.statusCode ||
                error?.status
            );


        if (
            status >= 500 ||
            status === 408 ||
            status === 409 ||
            status === 429
        ) {

            return true;

        }


        return [

            'ETIMEDOUT',

            'ECONNRESET',

            'ECONNREFUSED',

            'ECONNABORTED',

            'EAI_AGAIN',

            'NETWORK_ERROR',

            'PROVIDER_UNAVAILABLE',

            'SERVICE_UNAVAILABLE'

        ].includes(

            String(
                error?.code ||
                ''
            ).toUpperCase()

        );

    }


    /**
     * =========================================================================
     * Backoff
     * =========================================================================
     */

    calculateBackoff(
        attempt
    ) {

        const base =
            Math.min(

                500 *
                Math.pow(
                    2,
                    attempt - 1
                ),

                10000

            );


        return Math.floor(
            Math.random() *
            base
        );

    }


    /**
     * =========================================================================
     * Existing Rollback Lookup
     * =========================================================================
     */

    async findExistingRollback(
        transaction
    ) {

        if (
            typeof this.repository?.findRollbackByTransactionId ===
            'function'
        ) {

            return this.repository
                .findRollbackByTransactionId({

                    tenantId:
                        transaction.tenantId,

                    transactionId:
                        transaction.transactionId

                });

        }


        return null;

    }


    /**
     * =========================================================================
     * Validation
     * =========================================================================
     */

    validateTransaction(
        transaction
    ) {

        if (
            !transaction ||
            typeof transaction !==
            'object'
        ) {

            throw new TypeError(
                'Transaction is required'
            );

        }


        if (
            !transaction.transactionId
        ) {

            throw new Error(
                'Transaction ID is required'
            );

        }


        if (
            !Array.isArray(
                transaction.executedSteps
            )
        ) {

            throw new Error(
                'Transaction executedSteps must be an array'
            );

        }


        return true;

    }


    /**
     * =========================================================================
     * History
     * =========================================================================
     */

    appendHistory(
        record,
        entry
    ) {

        if (
            !Array.isArray(
                record.history
            )
        ) {

            record.history =
                [];

        }


        record.history.push({

            ...entry,

            rollbackId:
                record.rollbackId,

            transactionId:
                record.transactionId

        });


        if (
            record.history.length >
            this.maxHistory
        ) {

            record.history =
                record.history.slice(
                    -this.maxHistory
                );

        }

    }


    /**
     * =========================================================================
     * Safe Result
     * =========================================================================
     */

    safeResult(
        value
    ) {

        if (
            value ===
            undefined ||
            value ===
            null
        ) {

            return value;

        }


        if (
            typeof value ===
            'object'
        ) {

            return this.redact(
                value
            );

        }


        return value;

    }


    /**
     * =========================================================================
     * Redaction
     * =========================================================================
     */

    redact(
        value
    ) {

        if (
            Array.isArray(
                value
            )
        ) {

            return value.map(
                item =>
                    this.redact(
                        item
                    )
            );

        }


        if (
            !value ||
            typeof value !==
            'object'
        ) {

            return value;

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

                'Authorization',

                'apiKey',

                'api_key',

                'privateKey',

                'private_key'

            ]);


        return Object.entries(
            value
        )
            .reduce(

                (
                    output,
                    [
                        key,
                        val
                    ]
                ) => {

                    if (
                        sensitive.has(
                            key
                        )
                    ) {

                        output[key] =
                            '[REDACTED]';

                    }
                    else {

                        output[key] =
                            this.redact(
                                val
                            );

                    }


                    return output;

                },

                {}

            );

    }


    /**
     * =========================================================================
     * Audit
     * =========================================================================
     */

    async publishAuditSafely(
        event
    ) {

        try {

            await this.auditPublisher?.publish?.({

                eventId:
                    crypto.randomUUID(),

                timestamp:
                    new Date(),

                service:
                    'rollback-coordinator',

                ...this.redact(
                    event
                )

            });

        }
        catch (error) {

            this.logger.warn?.(

                '[RollbackCoordinator] Audit publication failed',

                {

                    error:
                        safeError(
                            error
                        )

                }

            );


            this.metrics?.increment?.(
                'transaction_rollback_audit_failure_total'
            );

        }

    }


    /**
     * =========================================================================
     * Rollback Completion Events
     * =========================================================================
     */

    async publishRollbackCompletedSafely(
        record
    ) {

        const payload = {

            rollbackId:
                record.rollbackId,

            transactionId:
                record.transactionId,

            tenantId:
                record.tenantId,

            correlationId:
                record.correlationId,

            status:
                record.status,

            compensations:
                record.compensations.length

        };


        try {

            await this.eventBus?.publish?.({

                type:
                    'transaction.rollback.completed',

                payload:
                    this.redact(
                        payload
                    )

            });

        }
        catch (error) {

            this.logger.warn?.(

                '[RollbackCoordinator] Rollback event publication failed',

                {

                    error:
                        safeError(
                            error
                        )

                }

            );


            this.metrics?.increment?.(
                'transaction_rollback_event_failure_total'
            );

        }


        await this.publishAuditSafely({

            type:
                'ROLLBACK_COMPLETED',

            ...payload

        });

    }


    /**
     * =========================================================================
     * Tracing
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

                        'transaction.rollback':
                            true

                    }

                }

            );

        }
        catch (_) {

            return null;

        }

    }


    setSpanSuccess(
        span
    ) {

        try {

            span?.setStatus?.({

                code:
                    1

            });

        }
        catch (_) {
            // Tracing must never affect compensation.
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
            // Tracing must never affect compensation.
        }

    }


    /**
     * =========================================================================
     * Health
     * =========================================================================
     */

    health() {

        return {

            status:
                'UP',

            component:
                'rollback-coordinator',

            handlers:
                this.rollbackHandlers.size,

            activeRollbacks:
                this.activeRollbacks.size,

            statistics:
                {
                    ...this.statistics
                }

        };

    }


    /**
     * =========================================================================
     * Statistics
     * =========================================================================
     */

    stats() {

        return {

            ...this.statistics,

            handlers:
                this.rollbackHandlers.size,

            activeRollbacks:
                this.activeRollbacks.size

        };

    }


    /**
     * =========================================================================
     * Shutdown
     * =========================================================================
     */

    async shutdown() {

        if (
            this.activeRollbacks.size >
            0
        ) {

            this.logger.warn?.({

                message:
                    'Rollback coordinator shutting down with active rollbacks',

                activeRollbacks:
                    this.activeRollbacks.size

            });

        }


        this.rollbackHandlers.clear();

        this.rollbackLocks.clear();

        this.activeRollbacks.clear();


        return true;

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


RollbackCoordinator.Status =
    RollbackStatus;


RollbackCoordinator.CompensationStatus =
    CompensationStatus;


module.exports =
    RollbackCoordinator;


module.exports.RollbackCoordinator =
    RollbackCoordinator;


module.exports.RollbackStatus =
    RollbackStatus;


module.exports.CompensationStatus =
    CompensationStatus;