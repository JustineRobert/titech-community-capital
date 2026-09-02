'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Transaction Retry Orchestrator
 * =============================================================================
 *
 * File:
 *   backend/modules/transactions/reliability/TransactionRetryOrchestrator.js
 *
 * Purpose:
 *   Enterprise retry orchestration for distributed transaction operations.
 *
 * Responsibilities:
 *   - Execute retryable transaction operations
 *   - Apply exponential backoff
 *   - Apply bounded random jitter
 *   - Classify retryable/non-retryable errors
 *   - Enforce maximum attempts
 *   - Enforce operation timeout
 *   - Support AbortSignal cancellation
 *   - Preserve transaction context
 *   - Support retry callbacks
 *   - Support metrics
 *   - Support tracing
 *   - Support structured logging
 *   - Prevent retry storms
 *   - Provide retry metadata
 *
 * Design principles:
 *   - Does not implement transaction business logic
 *   - Does not mutate financial state directly
 *   - Never retries known non-retryable failures
 *   - Never retries when explicitly cancelled
 *   - Retry orchestration remains deterministic and observable
 *   - Compatible with injected enterprise observability components
 *
 * =============================================================================
 */

const crypto = require('crypto');

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const DEFAULT_CONFIGURATION = Object.freeze({
    maxAttempts: 10,

    baseDelayMs: 1000,

    maxDelayMs: 60000,

    jitterRatio: 0.25,

    operationTimeoutMs: 30000,

    enabled: true,

    retryOnUnknownErrors: true,

    respectRetryAfter: true,

    maxRetryAfterMs: 120000,

    enableMetrics: true,

    enableTracing: true,

    enableLogging: true,

    throwLastError: true,

    source: 'transaction-retry-orchestrator'
});

const RETRY_DECISION = Object.freeze({
    RETRY: 'RETRY',

    STOP: 'STOP',

    CANCELLED: 'CANCELLED',

    DISABLED: 'DISABLED'
});

const RETRY_REASON = Object.freeze({
    RETRYABLE_ERROR: 'RETRYABLE_ERROR',

    MAX_ATTEMPTS_REACHED: 'MAX_ATTEMPTS_REACHED',

    NON_RETRYABLE_ERROR: 'NON_RETRYABLE_ERROR',

    CANCELLED: 'CANCELLED',

    TIMEOUT: 'TIMEOUT',

    DISABLED: 'DISABLED'
});

const DEFAULT_NON_RETRYABLE_CODES = Object.freeze([
    'INVALID_TRANSACTION',
    'INVALID_TRANSACTION_REQUEST',
    'VALIDATION_ERROR',
    'INVALID_ARGUMENT',
    'AUTHENTICATION_FAILED',
    'AUTHORIZATION_FAILED',
    'FORBIDDEN',
    'PERMISSION_DENIED',
    'TENANT_MISMATCH',
    'TENANT_CONTEXT_MISSING',
    'DUPLICATE_TRANSACTION_EXECUTION',
    'DUPLICATE_TRANSACTION',
    'ALREADY_PROCESSED',
    'ALREADY_COMPLETED',
    'ALREADY_REVERSED',
    'ALREADY_SETTLED',
    'FINANCIAL_PERIOD_LOCKED',
    'ACCOUNT_CLOSED',
    'ACCOUNT_BLOCKED',
    'INSUFFICIENT_FUNDS',
    'LIMIT_EXCEEDED',
    'COMPLIANCE_BLOCKED',
    'SANCTIONS_BLOCKED',
    'FRAUD_BLOCKED',
    'BUSINESS_RULE_VIOLATION'
]);

const DEFAULT_RETRYABLE_CODES = Object.freeze([
    'TIMEOUT',
    'ETIMEDOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'EPIPE',
    'ENETUNREACH',
    'EAI_AGAIN',
    'SERVICE_UNAVAILABLE',
    'UNAVAILABLE',
    'TEMPORARY_FAILURE',
    'TRANSIENT_ERROR',
    'RATE_LIMITED',
    'TOO_MANY_REQUESTS',
    'DEADLOCK',
    'LOCK_TIMEOUT',
    'WRITE_CONFLICT',
    'CONNECTION_LOST',
    'UPSTREAM_TIMEOUT',
    'UPSTREAM_UNAVAILABLE'
]);

/**
 * =============================================================================
 * TransactionRetryOrchestrator
 * =============================================================================
 */

class TransactionRetryOrchestrator {
    /**
     * =========================================================================
     * Constructor
     * =========================================================================
     */

    constructor(options = {}) {
        this.config = Object.freeze({
            ...DEFAULT_CONFIGURATION,
            ...(options.config || {})
        });

        this.logger =
            options.logger ||
            console;

        this.metrics =
            options.metrics ||
            null;

        this.tracer =
            options.tracer ||
            null;

        this.clock =
            options.clock ||
            (() => Date.now());

        this.retryableCodes = new Set([
            ...DEFAULT_RETRYABLE_CODES,
            ...(options.retryableCodes || [])
        ]);

        this.nonRetryableCodes = new Set([
            ...DEFAULT_NON_RETRYABLE_CODES,
            ...(options.nonRetryableCodes || [])
        ]);

        this.retryableStatuses = new Set(
            options.retryableStatuses || [
                408,
                425,
                429,
                500,
                502,
                503,
                504
            ]
        );

        this.nonRetryableStatuses = new Set(
            options.nonRetryableStatuses || [
                400,
                401,
                403,
                404,
                409,
                410,
                422
            ]
        );

        this.orchestratorId =
            options.orchestratorId ||
            `retry-${process.pid}-${Date.now()}-${crypto
                .randomBytes(4)
                .toString('hex')}`;

        this.activeOperations = new Map();

        this.statistics = {
            executions: 0,
            successes: 0,
            failures: 0,
            retries: 0,
            cancelled: 0,
            timeouts: 0,
            nonRetryableFailures: 0,
            maxAttemptsReached: 0
        };

        this.validateConfiguration();

        this.logInfo(
            'TransactionRetryOrchestrator initialized',
            {
                orchestratorId:
                    this.orchestratorId,

                maxAttempts:
                    this.config.maxAttempts,

                baseDelayMs:
                    this.config.baseDelayMs,

                maxDelayMs:
                    this.config.maxDelayMs
            }
        );
    }

    /**
     * =========================================================================
     * Configuration Validation
     * =========================================================================
     */

    validateConfiguration() {
        if (
            !Number.isInteger(
                this.config.maxAttempts
            ) ||
            this.config.maxAttempts < 1
        ) {
            throw new Error(
                'maxAttempts must be a positive integer.'
            );
        }

        if (
            !Number.isFinite(
                this.config.baseDelayMs
            ) ||
            this.config.baseDelayMs < 0
        ) {
            throw new Error(
                'baseDelayMs must be a non-negative number.'
            );
        }

        if (
            !Number.isFinite(
                this.config.maxDelayMs
            ) ||
            this.config.maxDelayMs < 0
        ) {
            throw new Error(
                'maxDelayMs must be a non-negative number.'
            );
        }

        if (
            this.config.maxDelayMs <
            this.config.baseDelayMs
        ) {
            throw new Error(
                'maxDelayMs must be greater than or equal to baseDelayMs.'
            );
        }

        if (
            !Number.isFinite(
                this.config.jitterRatio
            ) ||
            this.config.jitterRatio < 0 ||
            this.config.jitterRatio > 1
        ) {
            throw new Error(
                'jitterRatio must be between 0 and 1.'
            );
        }
    }

    /**
     * =========================================================================
     * Main Execution API
     * =========================================================================
     *
     * Backwards compatible:
     *
     *   execute(operation, context)
     *
     * Extended context:
     *
     *   {
     *       transactionId,
     *       correlationId,
     *       tenantId,
     *       operationName,
     *       signal,
     *       timeoutMs,
     *       maxAttempts,
     *       metadata
     *   }
     *
     * =========================================================================
     */

    async execute(
        operation,
        context = {}
    ) {
        this.validateOperation(
            operation
        );

        const execution =
            this.createExecutionContext(
                context
            );

        this.statistics.executions++;

        if (
            !this.config.enabled
        ) {
            return this.executeDisabled(
                operation,
                execution
            );
        }

        this.activeOperations.set(
            execution.executionId,
            execution
        );

        const startedAt =
            this.clock();

        const span =
            this.startSpan(
                execution
            );

        this.logInfo(
            'Transaction retry execution started',
            {
                executionId:
                    execution.executionId,

                transactionId:
                    execution.transactionId,

                correlationId:
                    execution.correlationId,

                operation:
                    execution.operationName
            }
        );

        try {
            while (
                execution.attempt <
                execution.maxAttempts
            ) {
                this.throwIfCancelled(
                    execution
                );

                execution.attempt++;

                const attemptStartedAt =
                    this.clock();

                this.logInfo(
                    'Transaction operation attempt started',
                    {
                        executionId:
                            execution.executionId,

                        transactionId:
                            execution.transactionId,

                        attempt:
                            execution.attempt,

                        maxAttempts:
                            execution.maxAttempts
                    }
                );

                this.metricIncrement(
                    'transaction.retry.attempts'
                );

                try {
                    const result =
                        await this.executeAttempt(
                            operation,
                            execution
                        );

                    execution.completed = true;

                    execution.succeeded = true;

                    execution.completedAt =
                        new Date();

                    execution.durationMs =
                        this.clock() -
                        startedAt;

                    this.statistics.successes++;

                    this.metricIncrement(
                        'transaction.retry.success'
                    );

                    this.metricObserve(
                        'transaction.retry.duration_ms',
                        execution.durationMs
                    );

                    this.logInfo(
                        'Transaction operation succeeded',
                        {
                            executionId:
                                execution.executionId,

                            transactionId:
                                execution.transactionId,

                            attempts:
                                execution.attempt,

                            durationMs:
                                execution.durationMs
                        }
                    );

                    return result;
                }
                catch (error) {
                    execution.lastError =
                        error;

                    const attemptDuration =
                        this.clock() -
                        attemptStartedAt;

                    this.metricObserve(
                        'transaction.retry.attempt_duration_ms',
                        attemptDuration
                    );

                    const decision =
                        this.evaluateRetryDecision(
                            error,
                            execution
                        );

                    if (
                        decision.decision ===
                        RETRY_DECISION.CANCELLED
                    ) {
                        this.statistics.cancelled++;

                        throw this.createCancellationError(
                            execution,
                            error
                        );
                    }

                    if (
                        decision.decision ===
                        RETRY_DECISION.STOP
                    ) {
                        if (
                            decision.reason ===
                            RETRY_REASON.NON_RETRYABLE_ERROR
                        ) {
                            this.statistics.nonRetryableFailures++;
                        }

                        if (
                            decision.reason ===
                            RETRY_REASON.MAX_ATTEMPTS_REACHED
                        ) {
                            this.statistics.maxAttemptsReached++;
                        }

                        throw error;
                    }

                    execution.retryCount++;

                    this.statistics.retries++;

                    this.metricIncrement(
                        'transaction.retry.retry'
                    );

                    const delay =
                        this.calculateDelay(
                            execution.attempt,
                            {
                                error,

                                retryAfterMs:
                                    decision.retryAfterMs,

                                baseDelayMs:
                                    execution.baseDelayMs,

                                maxDelayMs:
                                    execution.maxDelayMs,

                                jitterRatio:
                                    execution.jitterRatio
                            }
                        );

                    execution.lastDelayMs =
                        delay;

                    this.logWarn(
                        'Transaction operation retry scheduled',
                        {
                            executionId:
                                execution.executionId,

                            transactionId:
                                execution.transactionId,

                            attempt:
                                execution.attempt,

                            nextAttempt:
                                execution.attempt + 1,

                            delayMs:
                                delay,

                            reason:
                                decision.reason,

                            errorCode:
                                error?.code,

                            error:
                                error?.message
                        }
                    );

                    await this.waitBeforeRetry(
                        delay,
                        execution
                    );
                }
            }

            this.statistics.maxAttemptsReached++;

            throw this.createMaxAttemptsError(
                execution
            );
        }
        catch (error) {
            this.statistics.failures++;

            this.metricIncrement(
                'transaction.retry.failure'
            );

            this.logError(
                'Transaction retry execution failed',
                {
                    executionId:
                        execution.executionId,

                    transactionId:
                        execution.transactionId,

                    attempts:
                        execution.attempt,

                    error
                }
            );

            throw error;
        }
        finally {
            execution.completedAt =
                execution.completedAt ||
                new Date();

            execution.durationMs =
                execution.durationMs ||
                this.clock() -
                startedAt;

            this.finishSpan(
                span,
                execution
            );

            this.activeOperations.delete(
                execution.executionId
            );
        }
    }

    /**
     * =========================================================================
     * Operation Validation
     * =========================================================================
     */

    validateOperation(
        operation
    ) {
        if (
            typeof operation !==
            'function'
        ) {
            const error =
                new TypeError(
                    'Transaction retry operation must be a function.'
                );

            error.code =
                'INVALID_RETRY_OPERATION';

            throw error;
        }
    }

    /**
     * =========================================================================
     * Execution Context
     * =========================================================================
     */

    createExecutionContext(
        context
    ) {
        const maxAttempts =
            this.normalizePositiveInteger(
                context.maxAttempts,
                this.config.maxAttempts
            );

        const timeoutMs =
            this.normalizePositiveInteger(
                context.timeoutMs,
                this.config.operationTimeoutMs
            );

        return {
            executionId:
                context.executionId ||
                crypto.randomUUID(),

            transactionId:
                context.transactionId ||
                null,

            correlationId:
                context.correlationId ||
                crypto.randomUUID(),

            tenantId:
                context.tenantId ||
                null,

            operationName:
                context.operationName ||
                context.operation ||
                this.config.source,

            source:
                context.source ||
                this.config.source,

            metadata:
                {
                    ...(context.metadata || {})
                },

            signal:
                context.signal ||
                null,

            timeoutMs,

            maxAttempts,

            baseDelayMs:
                this.normalizeNonNegativeNumber(
                    context.baseDelayMs,
                    this.config.baseDelayMs
                ),

            maxDelayMs:
                this.normalizeNonNegativeNumber(
                    context.maxDelayMs,
                    this.config.maxDelayMs
                ),

            jitterRatio:
                this.normalizeJitterRatio(
                    context.jitterRatio,
                    this.config.jitterRatio
                ),

            attempt: 0,

            retryCount: 0,

            lastError: null,

            lastDelayMs: 0,

            completed: false,

            succeeded: false,

            createdAt:
                new Date()
        };
    }

    /**
     * =========================================================================
     * Attempt Execution
     * =========================================================================
     */

    async executeAttempt(
        operation,
        execution
    ) {
        this.throwIfCancelled(
            execution
        );

        const attemptContext =
            this.createAttemptContext(
                execution
            );

        const operationPromise =
            Promise.resolve().then(
                () =>
                    operation(
                        attemptContext
                    )
            );

        return this.withTimeout(
            operationPromise,
            execution.timeoutMs,
            execution
        );
    }

    /**
     * =========================================================================
     * Attempt Context
     * =========================================================================
     */

    createAttemptContext(
        execution
    ) {
        return Object.freeze({
            executionId:
                execution.executionId,

            transactionId:
                execution.transactionId,

            correlationId:
                execution.correlationId,

            tenantId:
                execution.tenantId,

            operationName:
                execution.operationName,

            source:
                execution.source,

            attempt:
                execution.attempt,

            maxAttempts:
                execution.maxAttempts,

            retryCount:
                execution.retryCount,

            signal:
                execution.signal,

            metadata:
                Object.freeze({
                    ...execution.metadata
                }),

            retry:
                execution.attempt > 1
        });
    }

    /**
     * =========================================================================
     * Retry Decision Engine
     * =========================================================================
     */

    evaluateRetryDecision(
        error,
        execution
    ) {
        if (
            this.isCancelled(
                execution
            )
        ) {
            return {
                decision:
                    RETRY_DECISION.CANCELLED,

                reason:
                    RETRY_REASON.CANCELLED
            };
        }

        if (
            execution.attempt >=
            execution.maxAttempts
        ) {
            return {
                decision:
                    RETRY_DECISION.STOP,

                reason:
                    RETRY_REASON.MAX_ATTEMPTS_REACHED
            };
        }

        if (
            !this.config.enabled
        ) {
            return {
                decision:
                    RETRY_DECISION.DISABLED,

                reason:
                    RETRY_REASON.DISABLED
            };
        }

        if (
            this.isNonRetryableError(
                error
            )
        ) {
            return {
                decision:
                    RETRY_DECISION.STOP,

                reason:
                    RETRY_REASON.NON_RETRYABLE_ERROR
            };
        }

        if (
            !this.isRetryableError(
                error
            )
        ) {
            return {
                decision:
                    RETRY_DECISION.STOP,

                reason:
                    RETRY_REASON.NON_RETRYABLE_ERROR
            };
        }

        return {
            decision:
                RETRY_DECISION.RETRY,

            reason:
                RETRY_REASON.RETRYABLE_ERROR,

            retryAfterMs:
                this.extractRetryAfter(
                    error
                )
        };
    }

    /**
     * =========================================================================
     * Retry Classification
     * =========================================================================
     */

    isRetryableError(
        error
    ) {
        if (!error) {
            return false;
        }

        if (
            error.retryable === true
        ) {
            return true;
        }

        if (
            error.retryable === false
        ) {
            return false;
        }

        const code =
            String(
                error.code ||
                ''
            ).toUpperCase();

        if (
            this.retryableCodes.has(
                code
            )
        ) {
            return true;
        }

        if (
            this.nonRetryableCodes.has(
                code
            )
        ) {
            return false;
        }

        const status =
            Number(
                error.status ||
                error.statusCode ||
                error.httpStatus
            );

        if (
            Number.isFinite(status)
        ) {
            if (
                this.retryableStatuses.has(
                    status
                )
            ) {
                return true;
            }

            if (
                this.nonRetryableStatuses.has(
                    status
                )
            ) {
                return false;
            }
        }

        if (
            error.name ===
            'AbortError'
        ) {
            return false;
        }

        if (
            error.name ===
            'TimeoutError'
        ) {
            return true;
        }

        return Boolean(
            this.config.retryOnUnknownErrors
        );
    }

    /**
     * =========================================================================
     * Non-Retryable Classification
     * =========================================================================
     */

    isNonRetryableError(
        error
    ) {
        if (!error) {
            return false;
        }

        if (
            error.retryable === false
        ) {
            return true;
        }

        const code =
            String(
                error.code ||
                ''
            ).toUpperCase();

        return this.nonRetryableCodes.has(
            code
        );
    }

    /**
     * =========================================================================
     * Backoff Calculation
     * =========================================================================
     */

    calculateDelay(
        attempt,
        options = {}
    ) {
        const baseDelay =
            this.normalizeNonNegativeNumber(
                options.baseDelayMs,
                this.config.baseDelayMs
            );

        const maxDelay =
            this.normalizeNonNegativeNumber(
                options.maxDelayMs,
                this.config.maxDelayMs
            );

        const jitterRatio =
            this.normalizeJitterRatio(
                options.jitterRatio,
                this.config.jitterRatio
            );

        const exponentialDelay =
            Math.min(
                maxDelay,
                baseDelay *
                Math.pow(
                    2,
                    Math.max(
                        0,
                        attempt - 1
                    )
                )
            );

        let delay =
            exponentialDelay;

        /**
         * Respect upstream Retry-After when present.
         */

        if (
            this.config.respectRetryAfter &&
            Number.isFinite(
                options.retryAfterMs
            )
        ) {
            delay =
                Math.max(
                    delay,
                    Math.min(
                        options.retryAfterMs,
                        this.config.maxRetryAfterMs
                    )
                );
        }

        /**
         * Full bounded jitter.
         *
         * Example:
         * jitterRatio = 0.25
         *
         * Delay may vary between:
         * 75% and 125% of calculated delay.
         */

        if (
            delay > 0 &&
            jitterRatio > 0
        ) {
            const jitterRange =
                delay *
                jitterRatio;

            const jitter =
                (
                    Math.random() *
                    (jitterRange * 2)
                ) -
                jitterRange;

            delay =
                delay +
                jitter;
        }

        return Math.max(
            0,
            Math.min(
                Math.round(delay),
                maxDelay
            )
        );
    }

    /**
     * =========================================================================
     * Retry Wait
     * =========================================================================
     */

    async waitBeforeRetry(
        delay,
        execution
    ) {
        this.throwIfCancelled(
            execution
        );

        if (
            delay <= 0
        ) {
            return;
        }

        await this.sleep(
            delay,
            execution.signal
        );

        this.throwIfCancelled(
            execution
        );
    }

    /**
     * =========================================================================
     * Timeout
     * =========================================================================
     */

    async withTimeout(
        promise,
        timeoutMs,
        execution
    ) {
        if (
            !Number.isFinite(
                timeoutMs
            ) ||
            timeoutMs <= 0
        ) {
            return promise;
        }

        let timer = null;

        const timeoutPromise =
            new Promise(
                (_, reject) => {
                    timer =
                        setTimeout(
                            () => {
                                const error =
                                    new Error(
                                        'Transaction operation timed out.'
                                    );

                                error.name =
                                    'TimeoutError';

                                error.code =
                                    'TRANSACTION_OPERATION_TIMEOUT';

                                error.retryable =
                                    true;

                                error.executionId =
                                    execution.executionId;

                                error.transactionId =
                                    execution.transactionId;

                                reject(error);
                            },
                            timeoutMs
                        );
                }
            );

        try {
            return await Promise.race([
                promise,
                timeoutPromise
            ]);
        }
        finally {
            if (timer) {
                clearTimeout(
                    timer
                );
            }
        }
    }

    /**
     * =========================================================================
     * Cancellation
     * =========================================================================
     */

    isCancelled(
        execution
    ) {
        return Boolean(
            execution.signal?.aborted
        );
    }

    throwIfCancelled(
        execution
    ) {
        if (
            !this.isCancelled(
                execution
            )
        ) {
            return;
        }

        const error =
            new Error(
                'Transaction retry operation was cancelled.'
            );

        error.name =
            'AbortError';

        error.code =
            'TRANSACTION_RETRY_CANCELLED';

        error.retryable =
            false;

        error.executionId =
            execution.executionId;

        error.transactionId =
            execution.transactionId;

        throw error;
    }

    createCancellationError(
        execution,
        cause
    ) {
        const error =
            new Error(
                'Transaction retry operation was cancelled.'
            );

        error.name =
            'AbortError';

        error.code =
            'TRANSACTION_RETRY_CANCELLED';

        error.retryable =
            false;

        error.executionId =
            execution.executionId;

        error.transactionId =
            execution.transactionId;

        error.cause =
            cause;

        return error;
    }

    /**
     * =========================================================================
     * Retry-After Extraction
     * =========================================================================
     */

    extractRetryAfter(
        error
    ) {
        if (!error) {
            return null;
        }

        const direct =
            Number(
                error.retryAfterMs
            );

        if (
            Number.isFinite(
                direct
            ) &&
            direct >= 0
        ) {
            return direct;
        }

        const headers =
            error.response?.headers ||
            error.headers;

        if (!headers) {
            return null;
        }

        const value =
            headers['retry-after'] ||
            headers['Retry-After'];

        if (!value) {
            return null;
        }

        const numeric =
            Number(value);

        if (
            Number.isFinite(
                numeric
            ) &&
            numeric >= 0
        ) {
            /**
             * HTTP Retry-After numeric values are seconds.
             */
            return numeric * 1000;
        }

        const date =
            Date.parse(
                value
            );

        if (
            Number.isFinite(date)
        ) {
            return Math.max(
                0,
                date -
                this.clock()
            );
        }

        return null;
    }

    /**
     * =========================================================================
     * Max Attempts Error
     * =========================================================================
     */

    createMaxAttemptsError(
        execution
    ) {
        const error =
            execution.lastError ||
            new Error(
                'Transaction retry maximum attempts reached.'
            );

        if (
            !error.code
        ) {
            error.code =
                'TRANSACTION_RETRY_MAX_ATTEMPTS';
        }

        error.retryExhausted =
            true;

        error.attempts =
            execution.attempt;

        error.maxAttempts =
            execution.maxAttempts;

        error.executionId =
            execution.executionId;

        error.transactionId =
            execution.transactionId;

        return error;
    }

    /**
     * =========================================================================
     * Disabled Execution
     * =========================================================================
     */

    async executeDisabled(
        operation,
        execution
    ) {
        this.metricIncrement(
            'transaction.retry.disabled'
        );

        this.logWarn(
            'Transaction retry orchestration disabled; executing operation once',
            {
                executionId:
                    execution.executionId,

                transactionId:
                    execution.transactionId
            }
        );

        return operation(
            this.createAttemptContext({
                ...execution,
                attempt: 1
            })
        );
    }

    /**
     * =========================================================================
     * Runtime Inspection
     * =========================================================================
     */

    getActiveOperations() {
        return Array.from(
            this.activeOperations.values()
        ).map(
            execution => ({
                executionId:
                    execution.executionId,

                transactionId:
                    execution.transactionId,

                correlationId:
                    execution.correlationId,

                tenantId:
                    execution.tenantId,

                operationName:
                    execution.operationName,

                attempt:
                    execution.attempt,

                maxAttempts:
                    execution.maxAttempts,

                retryCount:
                    execution.retryCount,

                createdAt:
                    execution.createdAt
            })
        );
    }

    getStatistics() {
        return {
            ...this.statistics,

            activeOperations:
                this.activeOperations.size,

            orchestratorId:
                this.orchestratorId
        };
    }

    resetStatistics() {
        this.statistics = {
            executions: 0,
            successes: 0,
            failures: 0,
            retries: 0,
            cancelled: 0,
            timeouts: 0,
            nonRetryableFailures: 0,
            maxAttemptsReached: 0
        };
    }

    /**
     * =========================================================================
     * Health
     * =========================================================================
     */

    getHealth() {
        return {
            status:
                this.config.enabled
                    ? 'READY'
                    : 'DISABLED',

            ready:
                true,

            enabled:
                this.config.enabled,

            activeOperations:
                this.activeOperations.size,

            statistics:
                this.getStatistics(),

            orchestratorId:
                this.orchestratorId
        };
    }

    async isReady() {
        return true;
    }

    /**
     * =========================================================================
     * Sleep With Cancellation
     * =========================================================================
     */

    sleep(
        milliseconds,
        signal
    ) {
        if (
            milliseconds <= 0
        ) {
            return Promise.resolve();
        }

        return new Promise(
            (resolve, reject) => {
                let timer = null;

                const cleanup =
                    () => {
                        if (timer) {
                            clearTimeout(
                                timer
                            );
                        }

                        if (
                            signal &&
                            typeof signal.removeEventListener ===
                            'function'
                        ) {
                            signal.removeEventListener(
                                'abort',
                                onAbort
                            );
                        }
                    };

                const onAbort =
                    () => {
                        cleanup();

                        const error =
                            new Error(
                                'Retry delay cancelled.'
                            );

                        error.name =
                            'AbortError';

                        error.code =
                            'TRANSACTION_RETRY_CANCELLED';

                        reject(
                            error
                        );
                    };

                timer =
                    setTimeout(
                        () => {
                            cleanup();

                            resolve();
                        },
                        milliseconds
                    );

                if (
                    signal &&
                    typeof signal.addEventListener ===
                    'function'
                ) {
                    if (
                        signal.aborted
                    ) {
                        onAbort();

                        return;
                    }

                    signal.addEventListener(
                        'abort',
                        onAbort,
                        {
                            once: true
                        }
                    );
                }
            }
        );
    }

    /**
     * =========================================================================
     * Numeric Helpers
     * =========================================================================
     */

    normalizePositiveInteger(
        value,
        fallback
    ) {
        const number =
            Number(value);

        if (
            !Number.isFinite(number) ||
            number < 1
        ) {
            return fallback;
        }

        return Math.floor(
            number
        );
    }

    normalizeNonNegativeNumber(
        value,
        fallback
    ) {
        const number =
            Number(value);

        if (
            !Number.isFinite(number) ||
            number < 0
        ) {
            return fallback;
        }

        return number;
    }

    normalizeJitterRatio(
        value,
        fallback
    ) {
        const number =
            Number(value);

        if (
            !Number.isFinite(number) ||
            number < 0 ||
            number > 1
        ) {
            return fallback;
        }

        return number;
    }

    /**
     * =========================================================================
     * Metrics
     * =========================================================================
     */

    metricIncrement(
        name,
        value = 1
    ) {
        if (
            !this.config.enableMetrics
        ) {
            return;
        }

        try {
            this.metrics?.increment?.(
                name,
                value
            );
        }
        catch (error) {
            this.logWarn(
                'Transaction retry metric increment failed',
                {
                    metric:
                        name,

                    error:
                        error.message
                }
            );
        }
    }

    metricObserve(
        name,
        value
    ) {
        if (
            !this.config.enableMetrics
        ) {
            return;
        }

        try {
            this.metrics?.observe?.(
                name,
                value
            );
        }
        catch (error) {
            this.logWarn(
                'Transaction retry metric observation failed',
                {
                    metric:
                        name,

                    error:
                        error.message
                }
            );
        }
    }

    /**
     * =========================================================================
     * Tracing
     * =========================================================================
     */

    startSpan(
        execution
    ) {
        if (
            !this.config.enableTracing
        ) {
            return null;
        }

        try {
            return this.tracer?.startSpan?.(
                'transaction.retry',
                {
                    attributes: {
                        'transaction.execution_id':
                            execution.executionId,

                        'transaction.transaction_id':
                            execution.transactionId,

                        'transaction.correlation_id':
                            execution.correlationId,

                        'transaction.tenant_id':
                            execution.tenantId,

                        'transaction.operation':
                            execution.operationName
                    }
                }
            );
        }
        catch (error) {
            this.logWarn(
                'Transaction retry tracing initialization failed',
                {
                    error:
                        error.message
                }
            );

            return null;
        }
    }

    finishSpan(
        span,
        execution
    ) {
        if (!span) {
            return;
        }

        try {
            span.setAttribute?.(
                'transaction.retry.attempts',
                execution.attempt
            );

            span.setAttribute?.(
                'transaction.retry.count',
                execution.retryCount
            );

            span.setAttribute?.(
                'transaction.retry.success',
                execution.succeeded
            );

            span.end?.();
        }
        catch (error) {
            this.logWarn(
                'Transaction retry tracing finalization failed',
                {
                    error:
                        error.message
                }
            );
        }
    }

    /**
     * =========================================================================
     * Structured Logging
     * =========================================================================
     */

    logInfo(
        message,
        metadata = {}
    ) {
        if (
            !this.config.enableLogging
        ) {
            return;
        }

        try {
            this.logger?.info?.(
                {
                    component:
                        'TransactionRetryOrchestrator',

                    ...metadata
                },
                message
            );
        }
        catch (error) {
            // Logging must never affect transaction execution.
        }
    }

    logWarn(
        message,
        metadata = {}
    ) {
        if (
            !this.config.enableLogging
        ) {
            return;
        }

        try {
            this.logger?.warn?.(
                {
                    component:
                        'TransactionRetryOrchestrator',

                    ...metadata
                },
                message
            );
        }
        catch (error) {
            // Logging must never affect transaction execution.
        }
    }

    logError(
        message,
        metadata = {}
    ) {
        if (
            !this.config.enableLogging
        ) {
            return;
        }

        try {
            this.logger?.error?.(
                {
                    component:
                        'TransactionRetryOrchestrator',

                    ...metadata,

                    error:
                        metadata.error
                            ? {
                                name:
                                    metadata.error.name,

                                code:
                                    metadata.error.code,

                                message:
                                    metadata.error.message,

                                stack:
                                    metadata.error.stack
                            }
                            : undefined
                },
                message
            );
        }
        catch (error) {
            // Logging must never affect transaction execution.
        }
    }
}

module.exports =
    TransactionRetryOrchestrator;