'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Transaction Retry Policy
 * ============================================================================
 *
 * File:
 * backend/modules/transactions/TransactionRetryPolicy.js
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 *
 * • Distributed transaction retry orchestration
 * • Exponential backoff
 * • Decorrelated jitter
 * • Retry budget enforcement
 * • Maximum attempt enforcement
 * • Maximum elapsed-time enforcement
 * • Maximum cumulative delay enforcement
 * • Retryable error classification
 * • Non-retryable error classification
 * • Circuit-breaker awareness
 * • Retry-After support
 * • Timeout awareness
 * • Cancellation support
 * • OpenTelemetry hooks
 * • Metrics
 * • Audit events
 * • Structured logging
 * • Retry decision transparency
 *
 * Design principles
 * ----------------------------------------------------------------------------
 *
 * ✓ Never retry deterministic business failures
 * ✓ Never retry after retry budget exhaustion
 * ✓ Never sleep beyond the remaining retry budget
 * ✓ Never allow observability failures to break business execution
 * ✓ Preserve original errors
 * ✓ Make retry decisions explainable
 * ✓ Support distributed transaction recovery
 *
 * ============================================================================
 */


/**
 * ============================================================================
 * Default Configuration
 * ============================================================================
 */

const DEFAULTS = Object.freeze({

    maxAttempts:
        5,

    initialDelay:
        250,

    maxDelay:
        30000,

    multiplier:
        2,

    jitter:
        true,

    /**
     * Maximum wall-clock time spent in the retry policy.
     */
    maxElapsedTime:
        300000,

    /**
     * Maximum total sleep time.
     *
     * This is intentionally separate from maxElapsedTime.
     */
    maxRetryDelay:
        120000,

    /**
     * Retry budget.
     *
     * A policy instance may consume at most this many retry attempts
     * across executions when a budgetKey is supplied.
     */
    retryBudget:
        50,

    /**
     * Optional minimum delay between retries.
     */
    minDelay:
        0,

    /**
     * Retry HTTP 429 responses.
     */
    retryRateLimited:
        true,

    /**
     * Whether unknown errors with status >= 500 are retryable.
     */
    retryServerErrors:
        true,

    /**
     * Whether timeout errors should be retried.
     */
    retryTimeouts:
        true

});


/**
 * ============================================================================
 * Non-Retryable Errors
 * ============================================================================
 */

const NON_RETRYABLE_CODES = new Set([

    'VALIDATION_ERROR',

    'INVALID_ARGUMENT',

    'INVALID_TRANSACTION',

    'UNAUTHORIZED',

    'FORBIDDEN',

    'NOT_FOUND',

    'DUPLICATE_TRANSACTION',

    'IDEMPOTENCY_CONFLICT',

    'BUSINESS_RULE_VIOLATION',

    'ACCOUNT_CLOSED',

    'ACCOUNT_BLOCKED',

    'INSUFFICIENT_FUNDS',

    'INVALID_ACCOUNT',

    'INVALID_CURRENCY',

    'INVALID_STATE_TRANSITION',

    'PERIOD_CLOSED',

    'PERIOD_LOCKED',

    'COMPLIANCE_REJECTED',

    'AML_REJECTED',

    'KYC_REJECTED',

    'FRAUD_REJECTED'

]);


/**
 * ============================================================================
 * Retryable Errors
 * ============================================================================
 */

const RETRYABLE_CODES = new Set([

    'NETWORK_ERROR',

    'ECONNRESET',

    'ECONNREFUSED',

    'ETIMEDOUT',

    'EAI_AGAIN',

    'ESOCKETTIMEDOUT',

    'ERR_NETWORK',

    'REDIS_TIMEOUT',

    'REDIS_CONNECTION_ERROR',

    'DATABASE_TIMEOUT',

    'DATABASE_CONNECTION_ERROR',

    'LOCK_TIMEOUT',

    'SERVICE_UNAVAILABLE',

    'RATE_LIMITED',

    'TEMPORARY_FAILURE',

    'DEADLOCK',

    'TRANSACTION_ABORTED',

    'TRANSACTION_CONCURRENCY_CONFLICT',

    'OPTIMISTIC_CONCURRENCY_CONFLICT',

    'WRITE_CONFLICT',

    'CIRCUIT_HALF_OPEN',

    'UPSTREAM_TIMEOUT',

    'GATEWAY_TIMEOUT',

    'BAD_GATEWAY',

    'DEPENDENCY_UNAVAILABLE'

]);


/**
 * ============================================================================
 * Transaction Retry Policy
 * ============================================================================
 */

class TransactionRetryPolicy {

    constructor(options = {}) {

        this.options = {

            ...DEFAULTS,

            ...options

        };


        this.validateConfiguration();


        this.logger =
            options.logger ||
            console;


        this.metrics =
            options.metrics ||
            null;


        this.tracer =
            options.tracer ||
            null;


        this.auditPublisher =
            options.auditPublisher ||
            null;


        this.circuitBreaker =
            options.circuitBreaker ||
            null;


        /**
         * Clock abstraction.
         *
         * Makes the policy deterministic and testable.
         */
        this.clock =
            options.clock ||
            (() => Date.now());


        /**
         * Random abstraction.
         *
         * Allows deterministic testing.
         */
        this.random =
            options.random ||
            Math.random;


        /**
         * Retry budget state.
         *
         * Map:
         *
         * budgetKey -> {
         *     consumed,
         *     startedAt
         * }
         */
        this.budgets =
            new Map();

    }


    /**
     * =========================================================================
     * Execute With Retry
     * =========================================================================
     */

    async execute(
        operation,
        context = {}
    ) {

        if (
            typeof operation !==
            'function'
        ) {

            throw new TypeError(
                'TransactionRetryPolicy.execute requires an operation function.'
            );

        }


        const startedAt =
            this.clock();


        const budgetKey =
            context.budgetKey ||
            context.transactionId ||
            null;


        const span =
            this.startSpan(
                context
            );


        let attempt =
            0;


        let lastError =
            null;


        let totalDelay =
            0;


        try {

            while (
                attempt <
                this.options.maxAttempts
            ) {

                attempt++;


                /**
                 * Check cancellation before executing.
                 */

                this.throwIfAborted(
                    context.signal
                );


                /**
                 * Check wall-clock budget.
                 */

                if (
                    !this.hasElapsedBudget(
                        startedAt
                    )
                ) {

                    lastError =
                        this.createRetryBudgetError(
                            'Maximum retry elapsed time exceeded.'
                        );

                    break;

                }


                /**
                 * Consume retry budget.
                 *
                 * The first execution does not consume a retry slot.
                 */
                if (
                    attempt > 1
                ) {

                    const budgetAvailable =
                        this.consumeRetryBudget(
                            budgetKey
                        );


                    if (
                        !budgetAvailable
                    ) {

                        lastError =
                            this.createRetryBudgetError(
                                'Retry budget exhausted.'
                            );

                        this.recordBudgetExhausted(
                            context,
                            attempt
                        );

                        break;

                    }

                }


                /**
                 * Circuit breaker awareness.
                 *
                 * Do not treat an OPEN circuit as an ordinary operation
                 * failure.
                 */

                if (
                    this.circuitBreaker?.isOpen?.()
                ) {

                    lastError =
                        this.createError(

                            'Circuit breaker is open',

                            'CIRCUIT_OPEN'

                        );


                    this.recordCircuitOpen(
                        context,
                        attempt
                    );

                    break;

                }


                this.recordAttempt(
                    context,
                    attempt
                );


                try {

                    const result =
                        await this.executeOperation(

                            operation,

                            attempt,

                            context

                        );


                    this.recordSuccess(
                        context,
                        attempt,
                        this.clock() -
                        startedAt
                    );


                    span?.setAttribute?.(
                        'transaction.retry.attempts',
                        attempt
                    );


                    span?.setAttribute?.(
                        'transaction.retry.success',
                        true
                    );


                    return result;

                }

                catch (error) {

                    lastError =
                        error;


                    const decision =
                        this.getRetryDecision(

                            error,

                            {

                                attempt,

                                startedAt,

                                totalDelay,

                                context

                            }

                        );


                    this.recordDecision(
                        context,
                        attempt,
                        error,
                        decision
                    );


                    if (
                        !decision.retry
                    ) {

                        break;

                    }


                    const delay =
                        this.calculateRetryDelay(

                            attempt,

                            error,

                            decision

                        );


                    const remainingElapsed =
                        this.remainingElapsedTime(
                            startedAt
                        );


                    const remainingDelayBudget =
                        this.remainingDelayBudget(
                            totalDelay
                        );


                    const boundedDelay =
                        Math.min(

                            delay,

                            remainingElapsed,

                            remainingDelayBudget

                        );


                    if (
                        boundedDelay <= 0
                    ) {

                        lastError =
                            this.createRetryBudgetError(

                                'Retry delay budget exhausted.'

                            );

                        break;

                    }


                    totalDelay +=
                        boundedDelay;


                    this.logRetry(
                        context,
                        attempt,
                        error,
                        boundedDelay,
                        decision
                    );


                    this.recordRetryMetrics(
                        context,
                        attempt,
                        boundedDelay,
                        decision
                    );


                    await this.publishRetryAudit(

                        context,

                        {

                            attempt,

                            delay:
                                boundedDelay,

                            error:
                                this.normalizeError(
                                    error
                                ),

                            reason:
                                decision.reason,

                            totalDelay,

                            timestamp:
                                new Date(
                                    this.clock()
                                )

                        }

                    );


                    await this.sleep(

                        boundedDelay,

                        context.signal

                    );

                }

            }


            this.recordExhausted(
                context,
                attempt,
                lastError
            );


            span?.recordException?.(
                lastError
            );


            span?.setAttribute?.(
                'transaction.retry.success',
                false
            );


            throw (

                lastError ||

                this.createError(

                    'Transaction retry policy exhausted without an error.',

                    'RETRY_EXHAUSTED'

                )

            );

        }

        finally {

            span?.end?.();

        }

    }


    /**
     * =========================================================================
     * Execute Operation
     * =========================================================================
     */

    async executeOperation(
        operation,
        attempt,
        context
    ) {

        return operation(

            attempt,

            {

                ...context,

                attempt,

                remainingTime:
                    this.remainingElapsedTime(
                        context.startedAt ||
                        this.clock()
                    )

            }

        );

    }


    /**
     * =========================================================================
     * Retry Decision
     * =========================================================================
     */

    getRetryDecision(
        error,
        metadata = {}
    ) {

        const {

            attempt,
            startedAt,
            totalDelay

        } = metadata;


        if (
            attempt >=
            this.options.maxAttempts
        ) {

            return {

                retry:
                    false,

                reason:
                    'MAX_ATTEMPTS_EXCEEDED'

            };

        }


        if (
            !this.hasElapsedBudget(
                startedAt
            )
        ) {

            return {

                retry:
                    false,

                reason:
                    'MAX_ELAPSED_TIME_EXCEEDED'

            };

        }


        if (
            totalDelay >=
            this.options.maxRetryDelay
        ) {

            return {

                retry:
                    false,

                reason:
                    'MAX_RETRY_DELAY_EXCEEDED'

            };

        }


        if (!error) {

            return {

                retry:
                    false,

                reason:
                    'NO_ERROR'

            };

        }


        const code =
            error.code;


        if (
            NON_RETRYABLE_CODES.has(
                code
            )
        ) {

            return {

                retry:
                    false,

                reason:
                    'NON_RETRYABLE_ERROR',

                code

            };

        }


        if (
            code ===
            'CIRCUIT_OPEN'
        ) {

            return {

                retry:
                    false,

                reason:
                    'CIRCUIT_OPEN',

                code

            };

        }


        if (
            RETRYABLE_CODES.has(
                code
            )
        ) {

            return {

                retry:
                    true,

                reason:
                    'RETRYABLE_ERROR_CODE',

                code

            };

        }


        if (
            error.retryable ===
            false
        ) {

            return {

                retry:
                    false,

                reason:
                    'ERROR_EXPLICITLY_NON_RETRYABLE',

                code

            };

        }


        if (
            error.retryable ===
            true
        ) {

            return {

                retry:
                    true,

                reason:
                    'ERROR_EXPLICITLY_RETRYABLE',

                code

            };

        }


        if (
            this.isTimeoutError(
                error
            )
        ) {

            return {

                retry:
                    this.options.retryTimeouts,

                reason:
                    this.options.retryTimeouts
                        ? 'TIMEOUT'
                        : 'TIMEOUT_RETRY_DISABLED',

                code

            };

        }


        if (
            error.status ===
            429
        ) {

            return {

                retry:
                    this.options.retryRateLimited,

                reason:
                    this.options.retryRateLimited
                        ? 'RATE_LIMITED'
                        : 'RATE_LIMITED_RETRY_DISABLED',

                code

            };

        }


        if (
            error.status >=
            500
        ) {

            return {

                retry:
                    this.options.retryServerErrors,

                reason:
                    this.options.retryServerErrors
                        ? 'SERVER_ERROR'
                        : 'SERVER_ERROR_RETRY_DISABLED',

                code

            };

        }


        return {

            retry:
                false,

            reason:
                'UNKNOWN_ERROR'

        };

    }


    /**
     * =========================================================================
     * Backwards-Compatible Retry Decision API
     * =========================================================================
     */

    shouldRetry(
        error,
        attempt,
        startedAt
    ) {

        return this.getRetryDecision(

            error,

            {

                attempt,

                startedAt,

                totalDelay:
                    0

            }

        ).retry;

    }


    /**
     * =========================================================================
     * Delay Calculation
     * =========================================================================
     */

    calculateRetryDelay(
        attempt,
        error = null,
        decision = {}
    ) {

        /**
         * Rate-limited APIs may provide Retry-After.
         */

        const retryAfter =
            this.getRetryAfter(
                error
            );


        if (
            retryAfter !== null
        ) {

            return Math.min(

                Math.max(
                    retryAfter,
                    this.options.minDelay
                ),

                this.options.maxDelay

            );

        }


        const exponential =
            this.options.initialDelay *

            Math.pow(

                this.options.multiplier,

                Math.max(
                    attempt - 1,
                    0
                )

            );


        let delay =
            Math.min(

                exponential,

                this.options.maxDelay

            );


        if (
            this.options.jitter
        ) {

            delay =
                this.applyDecorrelatedJitter(
                    delay
                );

        }


        delay =
            Math.max(

                delay,

                this.options.minDelay

            );


        return Math.floor(
            delay
        );

    }


    /**
     * =========================================================================
     * Backwards-Compatible Delay API
     * =========================================================================
     */

    calculateDelay(
        attempt
    ) {

        return this.calculateRetryDelay(
            attempt
        );

    }


    /**
     * =========================================================================
     * Decorrelated Jitter
     * =========================================================================
     *
     * Produces a delay between 50% and 100% of the calculated exponential
     * delay while remaining bounded by maxDelay.
     *
     * This avoids synchronized retry storms.
     */

    applyDecorrelatedJitter(
        delay
    ) {

        const lowerBound =
            Math.max(
                0,
                delay / 2
            );


        const upperBound =
            Math.max(
                lowerBound,
                delay
            );


        return (

            lowerBound +

            this.random() *

            (
                upperBound -
                lowerBound
            )

        );

    }


    /**
     * =========================================================================
     * Retry-After
     * =========================================================================
     */

    getRetryAfter(
        error
    ) {

        if (!error) {

            return null;

        }


        const value =
            error.retryAfter ??
            error.retryAfterMs ??
            error.response?.headers?.[
                'retry-after'
            ];


        if (
            value === undefined ||
            value === null
        ) {

            return null;

        }


        if (
            typeof value ===
            'number'
        ) {

            /**
             * Numeric Retry-After is normally seconds.
             *
             * retryAfterMs is treated explicitly as milliseconds.
             */

            if (
                error.retryAfterMs !==
                undefined
            ) {

                return Math.max(
                    0,
                    value
                );

            }


            return Math.max(
                0,
                value * 1000
            );

        }


        const numeric =
            Number(
                value
            );


        if (
            Number.isFinite(
                numeric
            )
        ) {

            return Math.max(
                0,
                numeric * 1000
            );

        }


        const parsed =
            Date.parse(
                value
            );


        if (
            Number.isNaN(
                parsed
            )
        ) {

            return null;

        }


        return Math.max(

            0,

            parsed -
            this.clock()

        );

    }


    /**
     * =========================================================================
     * Wait
     * =========================================================================
     */

    async wait(
        attempt,
        signal
    ) {

        const delay =
            this.calculateDelay(
                attempt
            );


        return this.sleep(
            delay,
            signal
        );

    }


    /**
     * =========================================================================
     * Sleep
     * =========================================================================
     */

    sleep(
        ms,
        signal
    ) {

        if (
            signal?.aborted
        ) {

            return Promise.reject(
                this.createAbortError()
            );

        }


        return new Promise(

            (resolve, reject) => {

                let timer;


                const onAbort =
                    () => {

                        clearTimeout(
                            timer
                        );


                        signal?.removeEventListener?.(
                            'abort',
                            onAbort
                        );


                        reject(
                            this.createAbortError()
                        );

                    };


                if (
                    signal
                ) {

                    signal.addEventListener(

                        'abort',

                        onAbort,

                        {
                            once:
                                true
                        }

                    );

                }


                timer =
                    setTimeout(

                        () => {

                            signal?.removeEventListener?.(
                                'abort',
                                onAbort
                            );


                            resolve();

                        },

                        Math.max(
                            0,
                            ms
                        )

                    );

            }

        );

    }


    /**
     * =========================================================================
     * Retry Budget
     * =========================================================================
     */

    consumeRetryBudget(
        budgetKey
    ) {

        /**
         * Without a key, the policy behaves as an execution-local policy.
         */

        if (!budgetKey) {

            return true;

        }


        const now =
            this.clock();


        let budget =
            this.budgets.get(
                budgetKey
            );


        if (!budget) {

            budget = {

                consumed:
                    0,

                startedAt:
                    now

            };


            this.budgets.set(
                budgetKey,
                budget
            );

        }


        if (
            budget.consumed >=
            this.options.retryBudget
        ) {

            return false;

        }


        budget.consumed++;


        return true;

    }


    /**
     * =========================================================================
     * Clear Retry Budget
     * =========================================================================
     */

    clearBudget(
        budgetKey
    ) {

        if (
            budgetKey
        ) {

            this.budgets.delete(
                budgetKey
            );

        }

    }


    /**
     * =========================================================================
     * Budget Inspection
     * =========================================================================
     */

    getBudget(
        budgetKey
    ) {

        const budget =
            this.budgets.get(
                budgetKey
            );


        if (!budget) {

            return {

                consumed:
                    0,

                remaining:
                    this.options.retryBudget

            };

        }


        return {

            consumed:
                budget.consumed,

            remaining:
                Math.max(

                    0,

                    this.options.retryBudget -
                    budget.consumed

                ),

            startedAt:
                budget.startedAt

        };

    }


    /**
     * =========================================================================
     * Elapsed Time
     * =========================================================================
     */

    hasElapsedBudget(
        startedAt
    ) {

        return (

            this.clock() -
            startedAt

        ) <=
        this.options.maxElapsedTime;

    }


    /**
     * =========================================================================
     * Remaining Elapsed Time
     * =========================================================================
     */

    remainingElapsedTime(
        startedAt
    ) {

        return Math.max(

            0,

            this.options.maxElapsedTime -

            (
                this.clock() -
                startedAt
            )

        );

    }


    /**
     * =========================================================================
     * Remaining Delay Budget
     * =========================================================================
     */

    remainingDelayBudget(
        totalDelay
    ) {

        return Math.max(

            0,

            this.options.maxRetryDelay -
            totalDelay

        );

    }


    /**
     * =========================================================================
     * Timeout Detection
     * =========================================================================
     */

    isTimeoutError(
        error
    ) {

        if (!error) {

            return false;

        }


        return (

            error.code ===
            'ETIMEDOUT'

        ) ||

        (

            error.code ===
            'ESOCKETTIMEDOUT'

        ) ||

        (

            error.code ===
            'UPSTREAM_TIMEOUT'

        ) ||

        (

            error.code ===
            'GATEWAY_TIMEOUT'

        ) ||

        (

            error.name ===
            'TimeoutError'

        ) ||

        (

            error.timeout ===
            true

        );

    }


    /**
     * =========================================================================
     * Cancellation
     * =========================================================================
     */

    throwIfAborted(
        signal
    ) {

        if (
            signal?.aborted
        ) {

            throw this.createAbortError();

        }

    }


    createAbortError() {

        const error =
            new Error(
                'Transaction retry operation was aborted.'
            );


        error.name =
            'AbortError';


        error.code =
            'TRANSACTION_RETRY_ABORTED';


        error.retryable =
            false;


        return error;

    }


    /**
     * =========================================================================
     * Error Creation
     * =========================================================================
     */

    createError(
        message,
        code
    ) {

        const error =
            new Error(
                message
            );


        error.code =
            code;


        error.retryable =
            false;


        return error;

    }


    createRetryBudgetError(
        message
    ) {

        const error =
            this.createError(

                message,

                'RETRY_BUDGET_EXHAUSTED'

            );


        error.retryable =
            false;


        return error;

    }


    /**
     * =========================================================================
     * Error Normalization
     * =========================================================================
     */

    normalizeError(
        error
    ) {

        if (!error) {

            return null;

        }


        return {

            name:
                error.name ||
                'Error',

            message:
                error.message ||
                String(error),

            code:
                error.code ||
                null,

            status:
                error.status ??
                error.statusCode ??
                null,

            retryable:
                error.retryable ??
                null,

            retryAfter:
                error.retryAfter ??
                error.retryAfterMs ??
                null

        };

    }


    /**
     * =========================================================================
     * Structured Logging
     * =========================================================================
     */

    logRetry(
        context,
        attempt,
        error,
        delay,
        decision
    ) {

        try {

            this.logger.warn?.(

                '[RetryPolicy] Retrying transaction',

                {

                    transactionId:
                        context.transactionId ||
                        null,

                    tenantId:
                        context.tenantId ||
                        null,

                    correlationId:
                        context.correlationId ||
                        null,

                    attempt,

                    delay,

                    reason:
                        decision.reason,

                    code:
                        error?.code ||
                        null,

                    error:
                        error?.message ||
                        null

                }

            );

        }

        catch (_) {

            /**
             * Observability must never break financial execution.
             */

        }

    }


    /**
     * =========================================================================
     * Metrics
     * =========================================================================
     */

    incrementMetric(
        name,
        value = 1,
        labels = {}
    ) {

        try {

            this.metrics?.increment?.(
                name,
                value,
                labels
            );

        }

        catch (_) {

            /**
             * Metrics are non-critical.
             */

        }

    }


    recordAttempt(
        context,
        attempt
    ) {

        this.incrementMetric(

            'transaction_retry_attempt_started_total',

            1,

            {

                service:
                    context.service ||
                    'transaction-service'

            }

        );

    }


    recordRetryMetrics(
        context,
        attempt,
        delay,
        decision
    ) {

        this.incrementMetric(

            'transaction_retry_attempt_total'

        );


        this.incrementMetric(

            'transaction_retry_delay_ms_total',

            delay

        );


        this.incrementMetric(

            'transaction_retry_reason_total',

            1,

            {

                reason:
                    decision.reason

            }

        );

    }


    recordSuccess(
        context,
        attempt,
        duration
    ) {

        this.incrementMetric(

            'transaction_retry_success_total'

        );


        this.incrementMetric(

            'transaction_retry_duration_ms_total',

            duration

        );

    }


    recordExhausted(
        context,
        attempt,
        error
    ) {

        this.incrementMetric(

            'transaction_retry_exhausted_total'

        );

    }


    recordBudgetExhausted(
        context,
        attempt
    ) {

        this.incrementMetric(

            'transaction_retry_budget_exhausted_total'

        );

    }


    recordCircuitOpen(
        context,
        attempt
    ) {

        this.incrementMetric(

            'transaction_retry_circuit_open_total'

        );

    }


    recordDecision(
        context,
        attempt,
        error,
        decision
    ) {

        this.incrementMetric(

            'transaction_retry_decision_total',

            1,

            {

                decision:
                    decision.retry
                        ? 'retry'
                        : 'stop',

                reason:
                    decision.reason

            }

        );

    }


    /**
     * =========================================================================
     * Audit Publisher
     * =========================================================================
     */

    async publishRetryAudit(
        context,
        event
    ) {

        if (
            !this.auditPublisher?.publish
        ) {

            return;

        }


        try {

            await this.auditPublisher.publish({

                type:
                    'TRANSACTION_RETRY',

                transactionId:
                    context.transactionId ||
                    null,

                tenantId:
                    context.tenantId ||
                    null,

                correlationId:
                    context.correlationId ||
                    null,

                ...event

            });

        }

        catch (auditError) {

            /**
             * Audit infrastructure failure must be observable,
             * but must not accidentally convert a retryable business
             * failure into a transaction failure.
             */

            try {

                this.logger.error?.(

                    '[RetryPolicy] Audit publication failed',

                    {

                        transactionId:
                            context.transactionId ||
                            null,

                        error:
                            auditError.message

                    }

                );

            }

            catch (_) {}

            this.incrementMetric(

                'transaction_retry_audit_publish_failure_total'

            );

        }

    }


    /**
     * =========================================================================
     * OpenTelemetry
     * =========================================================================
     */

    startSpan(
        context
    ) {

        try {

            return this.tracer?.startSpan?.(

                'transaction.retry.execute',

                {

                    attributes: {

                        'transaction.id':
                            context.transactionId ||
                            '',

                        'transaction.tenant_id':
                            context.tenantId ||
                            '',

                        'transaction.retry.max_attempts':
                            this.options.maxAttempts

                    }

                }

            );

        }

        catch (_) {

            return null;

        }

    }


    /**
     * =========================================================================
     * Runtime Configuration
     * =========================================================================
     */

    update(
        options = {}
    ) {

        const next = {

            ...this.options,

            ...options

        };


        this.validateConfiguration(
            next
        );


        this.options =
            next;


        return this.getConfiguration();

    }


    /**
     * =========================================================================
     * Configuration Validation
     * =========================================================================
     */

    validateConfiguration(
        configuration =
            this.options
    ) {

        const positiveIntegers = [

            'maxAttempts',

            'retryBudget'

        ];


        for (
            const field
            of positiveIntegers
        ) {

            if (

                !Number.isInteger(
                    configuration[field]
                ) ||

                configuration[field] <=
                0

            ) {

                throw new TypeError(

                    `${field} must be a positive integer.`

                );

            }

        }


        const nonNegativeNumbers = [

            'initialDelay',

            'maxDelay',

            'maxElapsedTime',

            'maxRetryDelay',

            'minDelay'

        ];


        for (
            const field
            of nonNegativeNumbers
        ) {

            if (

                !Number.isFinite(
                    configuration[field]
                ) ||

                configuration[field] < 0

            ) {

                throw new TypeError(

                    `${field} must be a non-negative number.`

                );

            }

        }


        if (
            configuration.maxDelay <
            configuration.initialDelay
        ) {

            throw new RangeError(

                'maxDelay cannot be smaller than initialDelay.'

            );

        }


        if (
            configuration.multiplier <
            1
        ) {

            throw new RangeError(

                'multiplier must be greater than or equal to 1.'

            );

        }


        if (
            configuration.minDelay >
            configuration.maxDelay
        ) {

            throw new RangeError(

                'minDelay cannot exceed maxDelay.'

            );

        }

    }


    /**
     * =========================================================================
     * Runtime Configuration
     * =========================================================================
     */

    getConfiguration() {

        return {

            ...this.options

        };

    }


    /**
     * =========================================================================
     * Static Retryability Check
     * =========================================================================
     */

    static isRetryable(
        error
    ) {

        if (!error) {

            return false;

        }


        if (
            NON_RETRYABLE_CODES.has(
                error.code
            )
        ) {

            return false;

        }


        if (
            RETRYABLE_CODES.has(
                error.code
            )
        ) {

            return true;

        }


        if (
            error.retryable ===
            true
        ) {

            return true;

        }


        if (
            error.retryable ===
            false
        ) {

            return false;

        }


        return (

            error.status >=
            500

        );

    }


    /**
     * =========================================================================
     * Static Classification
     * =========================================================================
     */

    static classify(
        error
    ) {

        if (!error) {

            return {

                retryable:
                    false,

                reason:
                    'NO_ERROR'

            };

        }


        if (
            NON_RETRYABLE_CODES.has(
                error.code
            )
        ) {

            return {

                retryable:
                    false,

                reason:
                    'NON_RETRYABLE_ERROR_CODE',

                code:
                    error.code

            };

        }


        if (
            RETRYABLE_CODES.has(
                error.code
            )
        ) {

            return {

                retryable:
                    true,

                reason:
                    'RETRYABLE_ERROR_CODE',

                code:
                    error.code

            };

        }


        if (
            error.retryable ===
            true
        ) {

            return {

                retryable:
                    true,

                reason:
                    'EXPLICITLY_RETRYABLE'

            };

        }


        if (
            error.retryable ===
            false
        ) {

            return {

                retryable:
                    false,

                reason:
                    'EXPLICITLY_NON_RETRYABLE'

            };

        }


        if (
            error.status >=
            500
        ) {

            return {

                retryable:
                    true,

                reason:
                    'SERVER_ERROR'

            };

        }


        return {

            retryable:
                false,

            reason:
                'UNKNOWN_ERROR'

        };

    }

}


/**
 * ============================================================================
 * Static Exports
 * ============================================================================
 */

TransactionRetryPolicy.DEFAULTS =
    DEFAULTS;


TransactionRetryPolicy.RETRYABLE_CODES =
    RETRYABLE_CODES;


TransactionRetryPolicy.NON_RETRYABLE_CODES =
    NON_RETRYABLE_CODES;


module.exports =
    TransactionRetryPolicy;