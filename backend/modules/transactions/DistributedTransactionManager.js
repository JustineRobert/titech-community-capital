'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Distributed Transaction Manager
 * ============================================================================
 *
 * Coordinates distributed operations across:
 *
 * • Ledger
 * • Wallet
 * • Mobile Money
 * • Settlement
 * • Audit
 * • Notifications
 * • Event Bus
 * • External Providers
 *
 * Pattern
 * -------
 * Saga / Compensating Transaction Coordinator
 *
 * Important
 * ---------
 * This class is a SAGA coordinator. It is NOT a replacement for an actual
 * distributed database transaction.
 *
 * For durable cross-process execution, supply a persistenceAdapter and,
 * optionally, a lockAdapter. In-process state is retained as a fast operational
 * cache and backward-compatible fallback.
 *
 * ============================================================================
 */

const crypto = require('crypto');


/**
 * ============================================================================
 * States
 * ============================================================================
 */

const TransactionState = Object.freeze({

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


/**
 * ============================================================================
 * Operation States
 * ============================================================================
 */

const OperationState = Object.freeze({

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


/**
 * ============================================================================
 * Defaults
 * ============================================================================
 */

const DEFAULT_TIMEOUT =
    60000;

const DEFAULT_RETRIES =
    0;

const DEFAULT_MAX_OPERATIONS =
    100;

const DEFAULT_MAX_HISTORY =
    500;


/**
 * ============================================================================
 * Helper
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
                1000
            ),

        code:
            error.code,

        retryable:
            error.retryable

    };

}


/**
 * ============================================================================
 * Distributed Transaction Manager
 * ============================================================================
 */

class DistributedTransactionManager {

    constructor(options = {}) {

        this.logger =
            options.logger ||
            console;

        this.tracer =
            options.tracer;

        this.metrics =
            options.metrics;

        this.auditPublisher =
            options.auditPublisher;

        this.eventBus =
            options.eventBus;

        this.retryPolicy =
            options.retryPolicy;

        this.persistenceAdapter =
            options.persistenceAdapter ||
            null;

        this.lockAdapter =
            options.lockAdapter ||
            null;

        this.defaultTimeout =
            this.normalizePositiveNumber(
                options.timeout,
                DEFAULT_TIMEOUT
            );

        this.defaultRetries =
            this.normalizeInteger(
                options.retries,
                DEFAULT_RETRIES
            );

        this.maxOperations =
            this.normalizeInteger(
                options.maxOperations,
                DEFAULT_MAX_OPERATIONS
            );

        this.maxHistory =
            this.normalizeInteger(
                options.maxHistory,
                DEFAULT_MAX_HISTORY
            );

        this.retryClassifier =
            typeof options.retryClassifier ===
            'function'
                ? options.retryClassifier
                : null;

        this.context =
            Object.freeze({

                tenantId:
                    options.tenantId || null,

                correlationId:
                    options.correlationId ||
                    crypto.randomUUID(),

                requestId:
                    options.requestId || null,

                idempotencyKey:
                    options.idempotencyKey || null

            });

        this.transactionId =
            options.transactionId ||
            crypto.randomUUID();

        this.state =
            TransactionState.CREATED;

        this.operations =
            [];

        this.completed =
            [];

        this.executionHistory =
            [];

        this.startedAt =
            null;

        this.finishedAt =
            null;

        this.rollbackStartedAt =
            null;

        this.rollbackFinishedAt =
            null;

        this.lockToken =
            null;

        this.commitResult =
            null;

        this.rollbackResult =
            null;

        this.failure =
            null;

        this.isRollingBack =
            false;

        this.isCommitted =
            false;

        this.isExecuting =
            false;

    }


    /**
     * =========================================================================
     * Register Operation
     * =========================================================================
     *
     * Every operation should have:
     *
     *   execute(context)
     *   rollback(result, context)
     *
     * An operation should preferably be idempotent because the execute method
     * may be retried after a transient failure.
     */

    register(operation = {}) {

        if (
            this.state !==
            TransactionState.CREATED
        ) {

            throw new Error(
                'Operations cannot be registered after transaction execution begins'
            );

        }

        if (
            this.operations.length >=
            this.maxOperations
        ) {

            throw new Error(
                `Maximum distributed transaction operations exceeded (${this.maxOperations})`
            );

        }

        if (
            typeof operation.execute !==
            'function'
        ) {

            throw new Error(
                'Distributed transaction operation must implement execute()'
            );

        }

        const operationId =
            operation.id ||
            crypto.randomUUID();

        const registration =
            Object.freeze({

                id:
                    operationId,

                name:
                    operation.name ||
                    `operation-${this.operations.length + 1}`,

                execute:
                    operation.execute,

                rollback:
                    typeof operation.rollback ===
                    'function'
                        ? operation.rollback
                        : null,

                timeout:
                    this.normalizePositiveNumber(
                        operation.timeout,
                        this.defaultTimeout
                    ),

                retries:
                    this.normalizeInteger(
                        operation.retries,
                        this.defaultRetries
                    ),

                retryable:
                    operation.retryable !== false,

                idempotencyKey:
                    operation.idempotencyKey ||
                    null,

                metadata:
                    this.freezeObject(
                        operation.metadata ||
                        {}
                    )

            });

        this.operations.push(
            registration
        );

        this.recordHistory({

            type:
                'OPERATION_REGISTERED',

            operationId,

            operation:
                registration.name

        });

        return this;

    }


    /**
     * =========================================================================
     * Commit / Execute Saga
     * =========================================================================
     */

    async commit() {

        if (
            this.isExecuting
        ) {

            throw new Error(
                'Distributed transaction is already executing'
            );

        }

        if (
            this.state !==
            TransactionState.CREATED
        ) {

            throw new Error(
                `Distributed transaction cannot commit from state ${this.state}`
            );

        }

        this.isExecuting =
            true;

        this.startedAt =
            new Date();

        this.state =
            TransactionState.RUNNING;

        const span =
            this.startSpan(
                'distributed.transaction.commit'
            );

        try {

            await this.acquireLock();

            await this.persistState();

            this.logger.info?.(

                '[DistributedTransaction] Starting',

                this.logContext({

                    operationCount:
                        this.operations.length

                })

            );

            this.metrics?.increment?.(
                'distributed_transactions_started_total'
            );

            for (
                const operation
                of this.operations
            ) {

                const result =
                    await this.executeOperation(
                        operation
                    );

                this.completed.push({

                    operationId:
                        operation.id,

                    operationName:
                        operation.name,

                    operation,

                    result

                });

                await this.persistState();

            }

            /**
             * -----------------------------------------------------------------
             * Financial/business state is now complete.
             * -----------------------------------------------------------------
             */

            this.state =
                TransactionState.COMMITTED;

            this.isCommitted =
                true;

            this.finishedAt =
                new Date();

            this.commitResult = {

                success:
                    true,

                transactionId:
                    this.transactionId,

                state:
                    this.state,

                completedOperations:
                    this.completed.length,

                durationMs:
                    this.getDuration(),

                results:
                    this.completed.map(
                        item => ({

                            operation:
                                item.operationName,

                            operationId:
                                item.operationId,

                            result:
                                item.result

                        })
                    )

            };

            await this.persistState();

            this.metrics?.increment?.(
                'distributed_transactions_success_total'
            );

            /**
             * Important:
             *
             * Event/audit publication happens AFTER the transaction reaches
             * COMMITTED. Publication failure must NOT cause compensation.
             */
            await this.publishCommitSafely();

            this.logger.info?.(

                '[DistributedTransaction] Commit successful',

                this.logContext({

                    completedOperations:
                        this.completed.length,

                    durationMs:
                        this.getDuration()

                })

            );

            this.setSpanSuccess(
                span
            );

            return this.commitResult;

        }
        catch (error) {

            this.failure =
                safeError(
                    error
                );

            /**
             * If the financial/business transaction is already committed, never
             * compensate merely because observability/event publication failed.
             */
            if (
                this.isCommitted
            ) {

                this.logger.error?.(

                    '[DistributedTransaction] Post-commit processing failed',

                    this.logContext({

                        error:
                            this.failure

                    })

                );

                this.metrics?.increment?.(
                    'distributed_transactions_post_commit_failure_total'
                );

                this.setSpanError(
                    span,
                    error
                );

                throw error;

            }

            this.logger.error?.(

                '[DistributedTransaction] Commit failed',

                this.logContext({

                    error:
                        this.failure

                })

            );

            this.metrics?.increment?.(
                'distributed_transactions_failed_total'
            );

            const rollbackResult =
                await this.rollback(
                    error
                );

            if (
                rollbackResult.rolledBack
            ) {

                this.state =
                    TransactionState.FAILED;

            }
            else {

                this.state =
                    TransactionState.COMPENSATION_FAILED;

            }

            await this.persistState();

            this.setSpanError(
                span,
                error
            );

            throw error;

        }
        finally {

            await this.releaseLock();

            this.isExecuting =
                false;

            span?.end?.();

        }

    }


    /**
     * =========================================================================
     * Execute Operation
     * =========================================================================
     */

    async executeOperation(
        operation
    ) {

        const startedAt =
            Date.now();

        let attempts =
            0;

        this.setOperationState(
            operation.id,
            OperationState.RUNNING
        );

        while (
            true
        ) {

            attempts++;

            try {

                const operationContext =
                    this.createOperationContext(
                        operation,
                        attempts
                    );

                const result =
                    await this.executeWithTimeout(

                        () =>
                            operation.execute(
                                operationContext
                            ),

                        operation.timeout,

                        operation

                    );

                const history =
                    {

                        type:
                            'OPERATION_COMPLETED',

                        operationId:
                            operation.id,

                        operation:
                            operation.name,

                        success:
                            true,

                        attempts,

                        durationMs:
                            Date.now() -
                            startedAt,

                        timestamp:
                            new Date()

                    };

                this.recordHistory(
                    history
                );

                this.setOperationState(
                    operation.id,
                    OperationState.COMPLETED
                );

                this.metrics?.increment?.(
                    'distributed_transaction_operation_success_total'
                );

                this.metrics?.histogram?.(
                    'distributed_transaction_operation_duration_ms',
                    history.durationMs
                );

                return result;

            }
            catch (error) {

                const retryable =
                    this.shouldRetry({

                        error,

                        operation,

                        attempt:
                            attempts

                    });

                this.recordHistory({

                    type:
                        'OPERATION_FAILED',

                    operationId:
                        operation.id,

                    operation:
                        operation.name,

                    success:
                        false,

                    attempts,

                    retryable,

                    error:
                        safeError(error),

                    timestamp:
                        new Date()

                });

                if (
                    !retryable
                ) {

                    this.setOperationState(
                        operation.id,
                        OperationState.FAILED
                    );

                    this.metrics?.increment?.(
                        'distributed_transaction_operation_failed_total'
                    );

                    throw error;

                }

                if (
                    attempts >
                    operation.retries
                ) {

                    this.setOperationState(
                        operation.id,
                        OperationState.FAILED
                    );

                    this.metrics?.increment?.(
                        'distributed_transaction_operation_retry_exhausted_total'
                    );

                    throw error;

                }

                this.metrics?.increment?.(
                    'distributed_transaction_operation_retry_total'
                );

                const delay =
                    await this.calculateRetryDelay(
                        attempts,
                        error,
                        operation
                    );

                this.logger.warn?.(

                    '[DistributedTransaction] Retrying operation',

                    this.logContext({

                        operation:
                            operation.name,

                        operationId:
                            operation.id,

                        attempt:
                            attempts,

                        nextAttempt:
                            attempts + 1,

                        delay,

                        error:
                            safeError(error)

                    })

                );

                if (
                    delay > 0
                ) {

                    await this.sleep(
                        delay
                    );

                }

            }

        }

    }


    /**
     * =========================================================================
     * Retry Classification
     * =========================================================================
     */

    shouldRetry({

        error,

        operation,

        attempt

    }) {

        if (
            operation.retryable ===
            false
        ) {

            return false;

        }

        if (
            attempt >=
            operation.retries + 1
        ) {

            return false;

        }

        if (
            this.retryClassifier
        ) {

            return Boolean(
                this.retryClassifier(
                    error,
                    {
                        operation,
                        attempt,
                        transactionId:
                            this.transactionId
                    }
                )
            );

        }

        if (
            typeof error?.retryable ===
            'boolean'
        ) {

            return error.retryable;

        }

        const statusCode =
            Number(
                error?.statusCode ||
                error?.status ||
                error?.httpStatus
            );

        if (
            statusCode >= 500
        ) {

            return true;

        }

        if (
            statusCode === 408 ||
            statusCode === 409 ||
            statusCode === 425 ||
            statusCode === 429
        ) {

            return true;

        }

        const retryableCodes =
            new Set([

                'ETIMEDOUT',

                'ECONNRESET',

                'ECONNREFUSED',

                'ECONNABORTED',

                'EAI_AGAIN',

                'ENETUNREACH',

                'EHOSTUNREACH',

                'NETWORK_ERROR',

                'TIMEOUT',

                'PROVIDER_UNAVAILABLE',

                'SERVICE_UNAVAILABLE'

            ]);

        return retryableCodes.has(
            String(
                error?.code ||
                ''
            ).toUpperCase()
        );

    }


    /**
     * =========================================================================
     * Retry Delay
     * =========================================================================
     */

    async calculateRetryDelay(
        attempt,
        error,
        operation
    ) {

        if (
            this.retryPolicy?.wait
        ) {

            await this.retryPolicy.wait(
                attempt,
                error,
                {
                    transactionId:
                        this.transactionId,

                    operation:
                        operation.name
                }
            );

            return 0;

        }

        const baseDelay =
            Math.min(

                500 *
                Math.pow(
                    2,
                    Math.max(
                        attempt - 1,
                        0
                    )
                ),

                10000

            );

        /**
         * Full jitter prevents synchronized retry storms.
         */
        return Math.floor(
            Math.random() *
            baseDelay
        );

    }


    /**
     * =========================================================================
     * Rollback / Compensation
     * =========================================================================
     */

    async rollback(
        originalError
    ) {

        if (
            this.isRollingBack
        ) {

            return this.rollbackResult;

        }

        if (
            this.isCommitted
        ) {

            this.logger.warn?.(

                '[DistributedTransaction] Rollback requested after commit; ignoring',

                this.logContext()

            );

            return {

                rolledBack:
                    false,

                reason:
                    'TRANSACTION_ALREADY_COMMITTED',

                failures:
                    []

            };

        }

        this.isRollingBack =
            true;

        this.state =
            TransactionState.ROLLING_BACK;

        this.rollbackStartedAt =
            new Date();

        this.rollbackResult = null;

        const failures = [];

        const compensated = [];

        this.logger.warn?.(

            '[DistributedTransaction] Rolling back',

            this.logContext({

                completedOperations:
                    this.completed.length

            })

        );

        this.metrics?.increment?.(
            'distributed_transactions_rollback_started_total'
        );

        try {

            /**
             * Reverse order is mandatory for saga compensation.
             */
            for (
                const completed
                of [...this.completed].reverse()
            ) {

                const operation =
                    completed.operation;

                if (
                    typeof operation.rollback !==
                    'function'
                ) {

                    this.recordHistory({

                        type:
                            'COMPENSATION_SKIPPED',

                        operationId:
                            completed.operationId,

                        operation:
                            completed.operationName,

                        reason:
                            'NO_COMPENSATION_HANDLER',

                        timestamp:
                            new Date()

                    });

                    continue;

                }

                this.setOperationState(

                    completed.operationId,

                    OperationState.COMPENSATING

                );

                try {

                    const rollbackContext =
                        this.createOperationContext(
                            operation,
                            1
                        );

                    await this.executeWithTimeout(

                        () =>
                            operation.rollback(
                                completed.result,
                                rollbackContext
                            ),

                        operation.timeout,

                        operation

                    );

                    compensated.push(
                        completed.operationId
                    );

                    this.setOperationState(

                        completed.operationId,

                        OperationState.COMPENSATED

                    );

                    this.recordHistory({

                        type:
                            'COMPENSATION_COMPLETED',

                        operationId:
                            completed.operationId,

                        operation:
                            completed.operationName,

                        success:
                            true,

                        timestamp:
                            new Date()

                    });

                    this.metrics?.increment?.(
                        'distributed_transaction_compensation_success_total'
                    );

                }
                catch (rollbackError) {

                    const failure = {

                        operationId:
                            completed.operationId,

                        operation:
                            completed.operationName,

                        error:
                            safeError(
                                rollbackError
                            )

                    };

                    failures.push(
                        failure
                    );

                    this.setOperationState(

                        completed.operationId,

                        OperationState.COMPENSATION_FAILED

                    );

                    this.recordHistory({

                        type:
                            'COMPENSATION_FAILED',

                        operationId:
                            completed.operationId,

                        operation:
                            completed.operationName,

                        success:
                            false,

                        error:
                            safeError(
                                rollbackError
                            ),

                        timestamp:
                            new Date()

                    });

                    this.metrics?.increment?.(
                        'distributed_transaction_compensation_failed_total'
                    );

                    this.logger.error?.(

                        '[DistributedTransaction] Compensation failed',

                        this.logContext(
                            failure
                        )

                    );

                }

            }

            this.rollbackFinishedAt =
                new Date();

            const fullyCompensated =
                failures.length === 0;

            this.state =
                fullyCompensated
                    ? TransactionState.ROLLED_BACK
                    : TransactionState.COMPENSATION_FAILED;

            this.rollbackResult = {

                rolledBack:
                    fullyCompensated,

                state:
                    this.state,

                failures,

                compensated,

                durationMs:
                    this.rollbackFinishedAt -
                    this.rollbackStartedAt,

                originalError:
                    safeError(
                        originalError
                    )

            };

            await this.persistState();

            await this.publishRollbackSafely(
                originalError,
                failures
            );

            return this.rollbackResult;

        }
        finally {

            this.isRollingBack =
                false;

        }

    }


    /**
     * =========================================================================
     * Timeout Protection
     * =========================================================================
     *
     * This wrapper prevents the coordinator from waiting indefinitely.
     *
     * IMPORTANT:
     * Promise.race() cannot cancel an already-running operation. For providers
     * supporting AbortController, operation.execute() should consume
     * context.signal and terminate its underlying HTTP request.
     */

    async executeWithTimeout(
        operationFunction,
        timeout,
        operation
    ) {

        const controller =
            typeof AbortController !==
            'undefined'
                ? new AbortController()
                : null;

        let timer;

        try {

            const executionContext = {

                signal:
                    controller?.signal,

                transactionId:
                    this.transactionId,

                tenantId:
                    this.context.tenantId,

                correlationId:
                    this.context.correlationId,

                requestId:
                    this.context.requestId,

                idempotencyKey:
                    this.context.idempotencyKey,

                operationId:
                    operation.id,

                operation:
                    operation.name

            };

            const execution =
                Promise.resolve()
                    .then(
                        () =>
                            operationFunction(
                                executionContext
                            )
                    );

            const timeoutPromise =
                new Promise(
                    (_, reject) => {

                        timer =
                            setTimeout(
                                () => {

                                    controller?.abort?.();

                                    const error =
                                        new Error(

                                            `Operation ${operation.name} timed out after ${timeout} ms`

                                        );

                                    error.code =
                                        'DISTRIBUTED_TRANSACTION_TIMEOUT';

                                    error.retryable =
                                        true;

                                    error.operationId =
                                        operation.id;

                                    reject(
                                        error
                                    );

                                },
                                timeout
                            );

                    }
                );

            return await Promise.race([

                execution,

                timeoutPromise

            ]);

        }
        finally {

            if (
                timer
            ) {

                clearTimeout(
                    timer
                );

            }

        }

    }


    /**
     * =========================================================================
     * Operation Context
     * =========================================================================
     */

    createOperationContext(
        operation,
        attempt
    ) {

        return Object.freeze({

            transactionId:
                this.transactionId,

            operationId:
                operation.id,

            operation:
                operation.name,

            tenantId:
                this.context.tenantId,

            correlationId:
                this.context.correlationId,

            requestId:
                this.context.requestId,

            idempotencyKey:
                operation.idempotencyKey ||
                this.context.idempotencyKey,

            attempt,

            metadata:
                operation.metadata

        });

    }


    /**
     * =========================================================================
     * Operation Runtime State
     * =========================================================================
     */

    setOperationState(
        operationId,
        status
    ) {

        const operation =
            this.operations.find(
                item =>
                    item.id ===
                    operationId
            );

        if (
            operation
        ) {

            /**
             * Keep runtime state in execution history rather than mutating
             * the immutable registration itself.
             */
            this.recordHistory({

                type:
                    'OPERATION_STATE_CHANGED',

                operationId,

                operation:
                    operation.name,

                status,

                timestamp:
                    new Date()

            });

        }

    }


    /**
     * =========================================================================
     * Persistence Hook
     * =========================================================================
     */

    async persistState() {

        if (
            typeof this.persistenceAdapter?.save !==
            'function'
        ) {

            return;

        }

        try {

            await this.persistenceAdapter.save(
                this.getStatus()
            );

        }
        catch (error) {

            /**
             * Persistence is important for distributed recovery.
             *
             * If configured, failure should be visible and can optionally
             * become fatal depending on adapter policy.
             */
            this.metrics?.increment?.(
                'distributed_transaction_persistence_failure_total'
            );

            this.logger.error?.(

                '[DistributedTransaction] State persistence failed',

                this.logContext({

                    error:
                        safeError(
                            error
                        )

                })

            );

            if (
                this.persistenceAdapter.failClosed ===
                true
            ) {

                throw error;

            }

        }

    }


    /**
     * =========================================================================
     * Distributed Lock
     * =========================================================================
     */

    async acquireLock() {

        if (
            typeof this.lockAdapter?.acquire !==
            'function'
        ) {

            return;

        }

        this.lockToken =
            crypto.randomUUID();

        const acquired =
            await this.lockAdapter.acquire({

                key:
                    this.buildLockKey(),

                token:
                    this.lockToken,

                ttl:
                    this.defaultTimeout *
                    Math.max(
                        this.operations.length,
                        1
                    ),

                tenantId:
                    this.context.tenantId,

                transactionId:
                    this.transactionId

            });

        if (
            acquired === false
        ) {

            throw new Error(
                'Distributed transaction lock could not be acquired'
            );

        }

    }


    /**
     * =========================================================================
     * Release Distributed Lock
     * =========================================================================
     */

    async releaseLock() {

        if (
            !this.lockToken ||
            typeof this.lockAdapter?.release !==
            'function'
        ) {

            return;

        }

        try {

            await this.lockAdapter.release({

                key:
                    this.buildLockKey(),

                token:
                    this.lockToken,

                tenantId:
                    this.context.tenantId,

                transactionId:
                    this.transactionId

            });

        }
        catch (error) {

            this.metrics?.increment?.(
                'distributed_transaction_lock_release_failure_total'
            );

            this.logger.error?.(

                '[DistributedTransaction] Lock release failed',

                this.logContext({

                    error:
                        safeError(
                            error
                        )

                })

            );

        }
        finally {

            this.lockToken =
                null;

        }

    }


    /**
     * =========================================================================
     * Lock Key
     * =========================================================================
     */

    buildLockKey() {

        return [

            'titech',

            'distributed-transaction',

            this.context.tenantId ||
                'global',

            this.transactionId

        ].join(':');

    }


    /**
     * =========================================================================
     * Commit Events
     * =========================================================================
     */

    async publishCommitSafely() {

        const event = {

            type:
                'DISTRIBUTED_TRANSACTION_COMMITTED',

            transactionId:
                this.transactionId,

            tenantId:
                this.context.tenantId,

            correlationId:
                this.context.correlationId,

            requestId:
                this.context.requestId,

            timestamp:
                new Date(),

            operations:
                this.completed.length,

            state:
                TransactionState.COMMITTED

        };

        await this.publishNonCritical(
            this.auditPublisher?.publish,
            event,
            'audit commit'
        );

        await this.publishNonCritical(
            this.eventBus?.publish,
            {

                ...event,

                type:
                    'distributed.transaction.committed'

            },
            'event-bus commit'
        );

    }


    /**
     * =========================================================================
     * Rollback Events
     * =========================================================================
     */

    async publishRollbackSafely(
        error,
        failures
    ) {

        const event = {

            type:
                'DISTRIBUTED_TRANSACTION_ROLLED_BACK',

            transactionId:
                this.transactionId,

            tenantId:
                this.context.tenantId,

            correlationId:
                this.context.correlationId,

            requestId:
                this.context.requestId,

            reason:
                safeError(
                    error
                ),

            rollbackFailures:
                failures,

            timestamp:
                new Date(),

            state:
                this.state

        };

        await this.publishNonCritical(
            this.auditPublisher?.publish,
            event,
            'audit rollback'
        );

        await this.publishNonCritical(
            this.eventBus?.publish,
            {

                ...event,

                type:
                    'distributed.transaction.rollback'

            },
            'event-bus rollback'
        );

    }


    /**
     * =========================================================================
     * Non-Critical Publication
     * =========================================================================
     */

    async publishNonCritical(
        publisher,
        payload,
        description
    ) {

        if (
            typeof publisher !==
            'function'
        ) {

            return;

        }

        try {

            await publisher(
                payload
            );

        }
        catch (error) {

            this.metrics?.increment?.(
                'distributed_transaction_publication_failure_total'
            );

            this.logger.warn?.(

                '[DistributedTransaction] Non-critical publication failed',

                this.logContext({

                    description,

                    error:
                        safeError(
                            error
                        )

                })

            );

        }

    }


    /**
     * =========================================================================
     * Status
     * =========================================================================
     */

    getStatus() {

        return {

            transactionId:
                this.transactionId,

            tenantId:
                this.context.tenantId,

            correlationId:
                this.context.correlationId,

            requestId:
                this.context.requestId,

            idempotencyKey:
                this.context.idempotencyKey,

            state:
                this.state,

            startedAt:
                this.startedAt,

            finishedAt:
                this.finishedAt,

            rollbackStartedAt:
                this.rollbackStartedAt,

            rollbackFinishedAt:
                this.rollbackFinishedAt,

            operations:
                this.operations.map(
                    operation => ({

                        id:
                            operation.id,

                        name:
                            operation.name,

                        timeout:
                            operation.timeout,

                        retries:
                            operation.retries,

                        metadata:
                            operation.metadata

                    })
                ),

            completed:
                this.completed.map(
                    item => ({

                        operationId:
                            item.operationId,

                        operation:
                            item.operationName

                    })
                ),

            history:
                [
                    ...this.executionHistory
                ],

            failure:
                this.failure,

            commitResult:
                this.commitResult,

            rollbackResult:
                this.rollbackResult

        };

    }


    /**
     * =========================================================================
     * History
     * =========================================================================
     */

    recordHistory(
        entry
    ) {

        this.executionHistory.push({

            ...entry,

            transactionId:
                this.transactionId

        });

        if (
            this.executionHistory.length >
            this.maxHistory
        ) {

            this.executionHistory =
                this.executionHistory.slice(
                    -this.maxHistory
                );

        }

    }


    /**
     * =========================================================================
     * Logging Context
     * =========================================================================
     */

    logContext(
        additional = {}
    ) {

        return {

            transactionId:
                this.transactionId,

            tenantId:
                this.context.tenantId,

            correlationId:
                this.context.correlationId,

            requestId:
                this.context.requestId,

            ...additional

        };

    }


    /**
     * =========================================================================
     * Duration
     * =========================================================================
     */

    getDuration() {

        if (
            !this.startedAt
        ) {

            return 0;

        }

        const end =
            this.finishedAt ||
            new Date();

        return (
            end.getTime() -
            this.startedAt.getTime()
        );

    }


    /**
     * =========================================================================
     * Span Helpers
     * =========================================================================
     */

    startSpan(
        name
    ) {

        try {

            const span =
                this.tracer?.startSpan?.(
                    name,
                    {
                        attributes: {

                            'transaction.id':
                                this.transactionId,

                            'tenant.id':
                                this.context.tenantId,

                            'correlation.id':
                                this.context.correlationId

                        }

                    }
                );

            return span;

        }
        catch (error) {

            this.logger.warn?.(

                '[DistributedTransaction] Tracing failed',

                this.logContext({

                    error:
                        safeError(
                            error
                        )

                })

            );

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
            // Never allow tracing to affect business execution.
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
            // Never allow tracing to affect business execution.
        }

    }


    /**
     * =========================================================================
     * Normalize Values
     * =========================================================================
     */

    normalizePositiveNumber(
        value,
        fallback
    ) {

        const parsed =
            Number(value);

        return (
            Number.isFinite(parsed) &&
            parsed > 0
        )
            ? parsed
            : fallback;

    }


    normalizeInteger(
        value,
        fallback
    ) {

        const parsed =
            Number(value);

        return (
            Number.isInteger(parsed) &&
            parsed >= 0
        )
            ? parsed
            : fallback;

    }


    freezeObject(
        object
    ) {

        if (
            !object ||
            typeof object !==
            'object'
        ) {

            return Object.freeze({});

        }

        return Object.freeze({

            ...object

        });

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


    /**
     * =========================================================================
     * Clear
     * =========================================================================
     *
     * A transaction manager instance should generally not be reused.
     *
     * clear() is retained for compatibility, but it explicitly refuses to
     * reset an active or committed transaction.
     */

    clear() {

        if (
            this.isExecuting ||
            this.state ===
            TransactionState.RUNNING ||
            this.state ===
            TransactionState.ROLLING_BACK
        ) {

            throw new Error(
                'Cannot clear an active distributed transaction'
            );

        }

        this.transactionId =
            crypto.randomUUID();

        this.state =
            TransactionState.CREATED;

        this.operations =
            [];

        this.completed =
            [];

        this.executionHistory =
            [];

        this.startedAt =
            null;

        this.finishedAt =
            null;

        this.rollbackStartedAt =
            null;

        this.rollbackFinishedAt =
            null;

        this.lockToken =
            null;

        this.commitResult =
            null;

        this.rollbackResult =
            null;

        this.failure =
            null;

        this.isRollingBack =
            false;

        this.isCommitted =
            false;

        return this;

    }


    /**
     * =========================================================================
     * Health
     * =========================================================================
     */

    health() {

        return {

            service:
                'distributed-transaction-manager',

            status:
                this.isExecuting
                    ? 'BUSY'
                    : 'UP',

            transactionId:
                this.transactionId,

            tenantId:
                this.context.tenantId,

            state:
                this.state,

            operations:
                this.operations.length,

            completed:
                this.completed.length,

            distributedPersistence:
                Boolean(
                    this.persistenceAdapter
                ),

            distributedLock:
                Boolean(
                    this.lockAdapter
                ),

            uptimeMs:
                this.startedAt
                    ? Date.now() -
                        this.startedAt.getTime()
                    : 0

        };

    }

}


module.exports =
    DistributedTransactionManager;


module.exports.TransactionState =
    TransactionState;


module.exports.OperationState =
    OperationState;