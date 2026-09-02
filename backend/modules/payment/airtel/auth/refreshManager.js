'use strict';

/**
 * ==========================================================
 * TITech Community Capital LTD
 * Airtel Money Enterprise Refresh Manager
 * ----------------------------------------------------------
 * Enterprise OAuth token refresh coordination service.
 *
 * Responsibilities
 * ----------------
 * • Single-flight token refresh
 * • Concurrent refresh prevention
 * • Tenant-isolated refresh locks
 * • Optional distributed refresh locking
 * • Refresh retry orchestration
 * • Exponential backoff
 * • Jitter protection
 * • Failure classification
 * • Refresh timeout protection
 * • Metrics instrumentation
 * • Distributed tracing hooks
 * • Structured logging
 * • Refresh analytics
 * • Observability lifecycle hooks
 * • Graceful shutdown
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • OAuth HTTP communication
 * • Token storage
 * • Credential resolution
 * • Payment processing
 *
 * ==========================================================
 */

const crypto = require('crypto');

const {
    normalizeError
} = require('../../../shared/errors');


const PROVIDER = 'AIRTEL';


const REFRESH_STATUS = Object.freeze({

    IDLE:
        'IDLE',

    RUNNING:
        'RUNNING',

    FAILED:
        'FAILED',

    SUCCESS:
        'SUCCESS'

});


const DEFAULTS = Object.freeze({

    maxRetries:
        3,

    initialDelayMs:
        500,

    maxDelayMs:
        10000,

    backoffMultiplier:
        2,

    jitterRatio:
        0.20,

    timeoutMs:
        30000

});


class RefreshManager {


    constructor({

        logger,

        metrics,

        tracer,

        observability = null,

        distributedLock = null,

        maxRetries =
            DEFAULTS.maxRetries,

        initialDelayMs =
            DEFAULTS.initialDelayMs,

        maxDelayMs =
            DEFAULTS.maxDelayMs,

        backoffMultiplier =
            DEFAULTS.backoffMultiplier,

        jitterRatio =
            DEFAULTS.jitterRatio,

        timeoutMs =
            DEFAULTS.timeoutMs,

        retryableError = null,

        clock = Date,

        random = Math.random


    } = {}) {


        this.logger =
            logger;


        this.metrics =
            metrics;


        this.tracer =
            tracer;


        this.observability =
            observability;


        this.distributedLock =
            distributedLock;


        this.maxRetries =
            this.normalizePositiveInteger(
                maxRetries,
                DEFAULTS.maxRetries
            );


        this.initialDelayMs =
            this.normalizePositiveNumber(
                initialDelayMs,
                DEFAULTS.initialDelayMs
            );


        this.maxDelayMs =
            this.normalizePositiveNumber(
                maxDelayMs,
                DEFAULTS.maxDelayMs
            );


        this.backoffMultiplier =
            this.normalizePositiveNumber(
                backoffMultiplier,
                DEFAULTS.backoffMultiplier
            );


        this.jitterRatio =
            Math.min(
                Math.max(
                    Number(jitterRatio) || 0,
                    0
                ),
                1
            );


        this.timeoutMs =
            this.normalizePositiveNumber(
                timeoutMs,
                DEFAULTS.timeoutMs
            );


        this.retryableError =
            typeof retryableError === 'function'
                ? retryableError
                : null;


        this.clock =
            clock;


        this.random =
            typeof random === 'function'
                ? random
                : Math.random;


        /**
         * ------------------------------------------------------
         * Local Single-Flight Locks
         *
         * tenantId -> Promise
         * ------------------------------------------------------
         */

        this.refreshLocks =
            new Map();


        /**
         * ------------------------------------------------------
         * Refresh Runtime State
         * ------------------------------------------------------
         */

        this.refreshState =
            new Map();


        /**
         * ------------------------------------------------------
         * Shutdown State
         * ------------------------------------------------------
         */

        this.shuttingDown =
            false;


        /**
         * ------------------------------------------------------
         * Runtime Statistics
         * ------------------------------------------------------
         */

        this.statistics = {

            attempts:
                0,

            successful:
                0,

            failed:
                0,

            deduplicated:
                0,

            retries:
                0,

            retrySkipped:
                0,

            timeoutFailures:
                0,

            distributedLockAcquired:
                0,

            distributedLockConflicts:
                0,

            startedAt:
                new this.clock()

        };

    }


    /**
     * ==========================================================
     * Execute Refresh
     * ==========================================================
     */

    async execute({

        tenantId,

        refresh,

        correlationId =
            crypto.randomUUID(),

        force = false

    } = {}) {


        this.validateTenant(
            tenantId
        );


        this.validateRefresh(
            refresh
        );


        if(this.shuttingDown){

            throw new Error(
                'Airtel refresh manager is shutting down'
            );

        }


        /**
         * ------------------------------------------------------
         * Local single-flight protection
         * ------------------------------------------------------
         */

        const existing =
            this.refreshLocks.get(
                tenantId
            );


        if(existing && !force){

            this.statistics.deduplicated++;


            this.metrics?.counter?.(
                'payment_airtel_refresh_deduplicated_total'
            );


            this.logger?.debug?.({

                message:
                    'Airtel token refresh deduplicated',

                tenantId,

                correlationId

            });


            return existing;

        }


        const operation =
            this.runRefresh({

                tenantId,

                refresh,

                correlationId

            });


        this.refreshLocks.set(
            tenantId,
            operation
        );


        try {

            return await operation;

        }

        finally {

            /**
             * Only remove our own operation.
             *
             * This protects against accidental replacement
             * of a lock by another execution.
             */

            if(
                this.refreshLocks.get(
                    tenantId
                ) === operation
            ){

                this.refreshLocks.delete(
                    tenantId
                );

            }

        }

    }


    /**
     * ==========================================================
     * Refresh Executor
     * ==========================================================
     */

    async runRefresh({

        tenantId,

        refresh,

        correlationId

    }) {


        const span =
            this.tracer?.startSpan?.(
                'airtel.oauth.refresh'
            );


        const startedAt =
            Date.now();


        let distributedLockToken =
            null;


        try {


            this.setSpanAttributes(
                span,
                {
                    'provider.name':
                        PROVIDER,

                    'payment.provider':
                        PROVIDER,

                    'tenant.id':
                        tenantId,

                    'correlation.id':
                        correlationId
                }
            );


            this.statistics.attempts++;


            this.setState(
                tenantId,
                REFRESH_STATUS.RUNNING
            );


            this.observability?.refreshStarted?.({

                tenantId,

                correlationId

            });


            this.metrics?.counter?.(
                'payment_airtel_refresh_started_total'
            );


            /**
             * --------------------------------------------------
             * Optional distributed lock
             * --------------------------------------------------
             */

            if(this.distributedLock){

                distributedLockToken =
                    await this.acquireDistributedLock({

                        tenantId,

                        correlationId

                    });


                if(
                    distributedLockToken === null
                ){

                    this.statistics.distributedLockConflicts++;


                    /**
                     * Another application instance is
                     * refreshing this tenant.
                     *
                     * If the distributed lock implementation
                     * exposes wait/get functionality, the
                     * caller can resolve the newly stored token.
                     */

                    this.metrics?.counter?.(
                        'payment_airtel_refresh_distributed_lock_conflict_total'
                    );


                    throw new Error(
                        'Airtel token refresh is already running on another instance'
                    );

                }

            }


            const result =
                await this.executeWithRetry({

                    operation:
                        refresh,

                    tenantId,

                    correlationId

                });


            this.statistics.successful++;


            this.setState(
                tenantId,
                REFRESH_STATUS.SUCCESS
            );


            const durationMs =
                Date.now() - startedAt;


            this.metrics?.counter?.(
                'payment_airtel_refresh_success_total'
            );


            this.metrics?.histogram?.(
                'payment_airtel_refresh_duration_ms',
                durationMs
            );


            this.observability?.refreshSucceeded?.({

                tenantId,

                correlationId

            });


            this.logger?.info?.({

                message:
                    'Airtel token refresh successful',

                provider:
                    PROVIDER,

                tenantId,

                correlationId,

                durationMs

            });


            span?.setStatus?.({
                code:
                    'OK'
            });


            return result;

        }

        catch(error){


            const normalized =
                normalizeError(error);


            this.statistics.failed++;


            if(
                this.isTimeoutError(
                    error
                )
            ){

                this.statistics.timeoutFailures++;


                this.metrics?.counter?.(
                    'payment_airtel_refresh_timeout_total'
                );

            }


            this.setState(
                tenantId,
                REFRESH_STATUS.FAILED
            );


            this.metrics?.counter?.(
                'payment_airtel_refresh_failed_total'
            );


            this.metrics?.histogram?.(
                'payment_airtel_refresh_duration_ms',
                Date.now() - startedAt
            );


            this.observability?.refreshFailed?.({

                tenantId,

                correlationId,

                error:
                    normalized

            });


            this.logger?.error?.({

                message:
                    'Airtel token refresh failed',

                provider:
                    PROVIDER,

                tenantId,

                correlationId,

                durationMs:
                    Date.now() - startedAt,

                error:
                    normalized?.toJSON?.()
                    ||
                    normalized

            });


            span?.recordException?.(
                normalized
            );


            span?.setStatus?.({

                code:
                    'ERROR',

                message:
                    normalized?.message

            });


            throw normalized;

        }

        finally {


            await this.releaseDistributedLock({

                tenantId,

                lockToken:
                    distributedLockToken,

                correlationId

            });


            span?.end?.();

        }

    }


    /**
     * ==========================================================
     * Retry Execution
     * ==========================================================
     */

    async executeWithRetry({

        operation,

        tenantId,

        correlationId

    }) {


        let attempt =
            0;


        let lastError =
            null;


        while(
            attempt < this.maxRetries
        ){


            attempt++;


            this.metrics?.counter?.(
                'payment_airtel_refresh_attempt_total'
            );


            try {


                const result =
                    await this.executeWithTimeout({

                        operation,

                        tenantId,

                        correlationId,

                        attempt

                    });


                return result;

            }

            catch(error){


                lastError =
                    error;


                const retryable =
                    this.shouldRetry({

                        error,

                        attempt,

                        tenantId

                    });


                if(!retryable){

                    this.statistics.retrySkipped++;


                    this.metrics?.counter?.(
                        'payment_airtel_refresh_retry_skipped_total'
                    );


                    throw error;

                }


                if(
                    attempt >=
                    this.maxRetries
                ){

                    break;

                }


                this.statistics.retries++;


                const delay =
                    this.calculateBackoff(
                        attempt
                    );


                this.metrics?.counter?.(
                    'payment_airtel_refresh_retry_total'
                );


                this.metrics?.histogram?.(
                    'payment_airtel_refresh_retry_delay_ms',
                    delay
                );


                this.logger?.warn?.({

                    message:
                        'Retrying Airtel token refresh',

                    provider:
                        PROVIDER,

                    tenantId,

                    attempt,

                    nextAttempt:
                        attempt + 1,

                    maxRetries:
                        this.maxRetries,

                    delay,

                    correlationId,

                    error:
                        error?.message

                });


                await this.sleep(
                    delay
                );

            }

        }


        throw lastError;

    }


    /**
     * ==========================================================
     * Timeout Protection
     * ==========================================================
     */

    async executeWithTimeout({

        operation,

        tenantId,

        correlationId,

        attempt

    }) {


        if(
            !this.timeoutMs ||
            this.timeoutMs <= 0
        ){

            return operation();

        }


        let timer;


        try {

            return await Promise.race([

                Promise.resolve().then(
                    () => operation()
                ),

                new Promise(
                    (_, reject) => {

                        timer =
                            setTimeout(
                                () => {

                                    const error =
                                        new Error(
                                            'Airtel token refresh timed out'
                                        );

                                    error.code =
                                        'AIRTEL_REFRESH_TIMEOUT';

                                    error.tenantId =
                                        tenantId;

                                    error.correlationId =
                                        correlationId;

                                    error.attempt =
                                        attempt;

                                    reject(error);

                                },
                                this.timeoutMs
                            );

                    }
                )

            ]);

        }

        finally {

            if(timer){

                clearTimeout(
                    timer
                );

            }

        }

    }


    /**
     * ==========================================================
     * Retry Classification
     * ==========================================================
     */

    shouldRetry({

        error,

        attempt,

        tenantId

    }) {


        if(
            attempt >=
            this.maxRetries
        ){

            return false;

        }


        if(this.retryableError){

            return Boolean(

                this.retryableError(
                    error,
                    {
                        tenantId,
                        attempt,
                        provider:
                            PROVIDER
                    }
                )

            );

        }


        /**
         * Explicitly non-retryable authentication failures.
         */

        const code =
            error?.code;


        const status =
            Number(
                error?.statusCode
                ||
                error?.status
                ||
                error?.httpStatus
            );


        const nonRetryableCodes =
            new Set([

                'AUTHENTICATION_ERROR',

                'INVALID_CREDENTIALS',

                'INVALID_CLIENT',

                'UNAUTHORIZED',

                'FORBIDDEN',

                'AIRTEL_INVALID_CREDENTIALS',

                'VALIDATION_ERROR',

                'AIRTEL_REFRESH_TIMEOUT'

            ]);


        if(
            code &&
            nonRetryableCodes.has(
                String(code).toUpperCase()
            )
        ){

            return false;

        }


        /**
         * HTTP client errors generally should not retry,
         * except rate limiting.
         */

        if(
            status >= 400 &&
            status < 500
        ){

            return status === 408 ||
                status === 409 ||
                status === 425 ||
                status === 429;

        }


        /**
         * Provider failures and transport failures
         * are retry candidates.
         */

        if(
            status >= 500
        ){

            return true;

        }


        const retryableCodes =
            new Set([

                'ECONNRESET',

                'ECONNREFUSED',

                'ECONNABORTED',

                'ETIMEDOUT',

                'EAI_AGAIN',

                'ENETUNREACH',

                'EHOSTUNREACH',

                'PROVIDER_UNAVAILABLE',

                'SERVICE_UNAVAILABLE',

                'TIMEOUT',

                'NETWORK_ERROR'

            ]);


        if(
            code &&
            retryableCodes.has(
                String(code).toUpperCase()
            )
        ){

            return true;

        }


        /**
         * If the error explicitly declares retryability,
         * respect it.
         */

        if(
            typeof error?.retryable ===
            'boolean'
        ){

            return error.retryable;

        }


        return false;

    }


    /**
     * ==========================================================
     * Backoff Calculation
     * ==========================================================
     */

    calculateBackoff(
        attempt
    ) {


        const exponential =
            this.initialDelayMs *
            Math.pow(
                this.backoffMultiplier,
                Math.max(
                    attempt - 1,
                    0
                )
            );


        const capped =
            Math.min(
                exponential,
                this.maxDelayMs
            );


        /**
         * Full jitter around the calculated delay.
         *
         * Example with jitterRatio = 0.20:
         *
         * 500ms -> approximately 400-600ms
         */

        const jitter =
            capped *
            this.jitterRatio;


        const min =
            Math.max(
                0,
                capped - jitter
            );


        const max =
            capped + jitter;


        return Math.round(
            min +
            (
                this.random() *
                (max - min)
            )
        );

    }


    /**
     * ==========================================================
     * Distributed Lock
     * ==========================================================
     */

    async acquireDistributedLock({

        tenantId,

        correlationId

    }) {


        if(!this.distributedLock){

            return null;

        }


        const key =
            this.buildLockKey(
                tenantId
            );


        const token =
            crypto.randomUUID();


        /**
         * Supported adapter contracts:
         *
         * acquire(key, ttl, token)
         * acquire({ key, ttl, token })
         */

        let acquired;


        if(
            typeof this.distributedLock.acquire ===
            'function'
        ){

            try {

                acquired =
                    await this.distributedLock.acquire({

                        key,

                        ttl:
                            this.timeoutMs *
                            this.maxRetries,

                        token,

                        tenantId,

                        provider:
                            PROVIDER,

                        correlationId

                    });

            }

            catch(firstError){

                /**
                 * Do not silently swallow distributed-lock
                 * infrastructure failures.
                 */

                this.logger?.error?.({

                    message:
                        'Airtel distributed refresh lock acquisition failed',

                    tenantId,

                    correlationId,

                    error:
                        firstError?.message

                });


                throw firstError;

            }

        }
        else {

            throw new Error(
                'Invalid Airtel distributedLock adapter'
            );

        }


        if(
            acquired === false ||
            acquired === null ||
            acquired === undefined
        ){

            return null;

        }


        this.statistics.distributedLockAcquired++;


        this.metrics?.counter?.(
            'payment_airtel_refresh_distributed_lock_acquired_total'
        );


        return (
            typeof acquired === 'string'
                ? acquired
                : token
        );

    }


    /**
     * ==========================================================
     * Distributed Lock Release
     * ==========================================================
     */

    async releaseDistributedLock({

        tenantId,

        lockToken,

        correlationId

    }) {


        if(
            !this.distributedLock ||
            !lockToken
        ){

            return;

        }


        const key =
            this.buildLockKey(
                tenantId
            );


        try {

            if(
                typeof this.distributedLock.release ===
                'function'
            ){

                await this.distributedLock.release({

                    key,

                    token:
                        lockToken,

                    tenantId,

                    provider:
                        PROVIDER,

                    correlationId

                });

            }

        }

        catch(error){

            /**
             * Lock release failure must be observable,
             * but must not replace the actual refresh result.
             */

            this.metrics?.counter?.(
                'payment_airtel_refresh_distributed_lock_release_failure_total'
            );


            this.logger?.error?.({

                message:
                    'Failed to release Airtel distributed refresh lock',

                tenantId,

                correlationId,

                error:
                    error?.message

            });

        }

    }


    /**
     * ==========================================================
     * Lock Key
     * ==========================================================
     */

    buildLockKey(
        tenantId
    ) {

        return [
            'payment',
            PROVIDER.toLowerCase(),
            'oauth',
            'refresh-lock',
            tenantId
        ].join(':');

    }


    /**
     * ==========================================================
     * State
     * ==========================================================
     */

    getStatus(
        tenantId
    ) {


        this.validateTenant(
            tenantId
        );


        const state =
            this.refreshState.get(
                tenantId
            );


        if(!state){

            return {

                status:
                    REFRESH_STATUS.IDLE

            };

        }


        return {
            ...state
        };

    }


    setState(

        tenantId,

        status

    ) {


        this.refreshState.set(

            tenantId,

            Object.freeze({

                status,

                updatedAt:
                    new this.clock()

            })

        );

    }


    isRefreshing(
        tenantId
    ) {

        return this.refreshLocks.has(
            tenantId
        );

    }


    /**
     * ==========================================================
     * Validation
     * ==========================================================
     */

    validateTenant(
        tenantId
    ) {

        if(
            typeof tenantId !==
            'string' ||
            !tenantId.trim()
        ){

            throw new Error(
                'tenantId required'
            );

        }

    }


    validateRefresh(
        refresh
    ) {

        if(
            typeof refresh !==
            'function'
        ){

            throw new TypeError(
                'refresh must be a function'
            );

        }

    }


    normalizePositiveInteger(
        value,
        fallback
    ) {

        const parsed =
            Number(value);


        return Number.isInteger(parsed) &&
            parsed > 0
            ? parsed
            : fallback;

    }


    normalizePositiveNumber(
        value,
        fallback
    ) {

        const parsed =
            Number(value);


        return Number.isFinite(parsed) &&
            parsed > 0
            ? parsed
            : fallback;

    }


    /**
     * ==========================================================
     * Statistics
     * ==========================================================
     */

    stats() {


        return Object.freeze({

            ...this.statistics,

            activeRefreshes:
                this.refreshLocks.size,

            trackedTenants:
                this.refreshState.size,

            uptimeMs:
                Date.now()
                -
                new Date(
                    this.statistics.startedAt
                ).getTime(),

            shuttingDown:
                this.shuttingDown,

            maxRetries:
                this.maxRetries,

            timeoutMs:
                this.timeoutMs,

            initialDelayMs:
                this.initialDelayMs,

            maxDelayMs:
                this.maxDelayMs,

            jitterRatio:
                this.jitterRatio

        });

    }


    /**
     * ==========================================================
     * Health
     * ==========================================================
     */

    health() {


        const activeRefreshes =
            this.refreshLocks.size;


        return {

            provider:
                PROVIDER,

            component:
                'oauth-refresh-manager',

            status:
                this.shuttingDown
                    ? 'DEGRADED'
                    : 'UP',

            activeRefreshes,

            distributedLock:
                Boolean(
                    this.distributedLock
                ),

            statistics:
                this.stats()

        };

    }


    /**
     * ==========================================================
     * Snapshot
     * ==========================================================
     */

    snapshot() {


        const states = {};


        for(
            const [
                tenantId,
                state
            ]
            of this.refreshState.entries()
        ){

            states[tenantId] = {
                ...state
            };

        }


        return {

            provider:
                PROVIDER,

            component:
                'oauth-refresh-manager',

            shuttingDown:
                this.shuttingDown,

            activeRefreshes:
                this.refreshLocks.size,

            states,

            statistics:
                this.stats(),

            generatedAt:
                new this.clock()

        };

    }


    /**
     * ==========================================================
     * Shutdown
     * ==========================================================
     */

    async shutdown({

        waitForActive =
            true,

        timeoutMs =
            10000

    } = {}) {


        this.shuttingDown =
            true;


        if(
            !waitForActive ||
            this.refreshLocks.size === 0
        ){

            this.refreshState.clear();

            return true;

        }


        const active =
            Array.from(
                this.refreshLocks.values()
            );


        try {

            await Promise.race([

                Promise.allSettled(
                    active
                ),

                this.sleep(
                    timeoutMs
                )

            ]);

        }

        finally {

            this.refreshLocks.clear();

            this.refreshState.clear();

        }


        return true;

    }


    /**
     * ==========================================================
     * Sleep
     * ==========================================================
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
     * ==========================================================
     * Span Attributes
     * ==========================================================
     */

    setSpanAttributes(
        span,
        attributes
    ) {


        if(!span){

            return;

        }


        for(
            const [
                key,
                value
            ]
            of Object.entries(
                attributes
            )
        ){

            try {

                span.setAttribute?.(
                    key,
                    value
                );

            }

            catch{

                // Observability must never break authentication.

            }

        }

    }


    /**
     * ==========================================================
     * Timeout Detection
     * ==========================================================
     */

    isTimeoutError(
        error
    ) {


        return (

            error?.code ===
            'AIRTEL_REFRESH_TIMEOUT'

        ) ||

        (

            error?.code ===
            'ETIMEDOUT'

        ) ||

        (

            error?.code ===
            'ECONNABORTED'

        );

    }

}


module.exports = {

    RefreshManager,

    REFRESH_STATUS

};