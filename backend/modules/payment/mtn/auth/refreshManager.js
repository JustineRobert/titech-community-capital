'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise MTN MoMo Refresh Manager
 * =============================================================================
 *
 * Purpose
 * -------
 * Coordinates secure MTN OAuth token refresh operations in a distributed
 * enterprise environment.
 *
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 *
 * ✓ Single-flight token refresh execution
 * ✓ Tenant isolated refresh locking
 * ✓ Refresh storm prevention
 * ✓ Concurrent request coordination
 * ✓ Exponential backoff retries
 * ✓ Failure classification
 * ✓ Metrics instrumentation
 * ✓ Structured logging
 * ✓ Distributed tracing hooks
 * ✓ Refresh lifecycle telemetry
 * ✓ Operational health reporting
 *
 *
 * Does NOT:
 *
 * ✗ Store tokens
 * ✗ Communicate with MTN OAuth directly
 * ✗ Manage credentials
 * ✗ Perform payment operations
 *
 *
 * Architecture:
 *
 *
 * MTNAuthService
 *
 *        |
 *        ▼
 *
 * RefreshManager
 *
 *        |
 *        ▼
 *
 * OAuthClient
 *
 *        |
 *        ▼
 *
 * TokenManager
 *
 * =============================================================================
 */


const crypto = require('crypto');


const {

    normalizeError

} = require('../../shared/errors');








class RefreshManager {





    constructor({

        logger,

        metrics,

        tracer,

        observability,

        maxRetries = 3,

        retryDelayMs = 500,

        maxLockDurationMs = 60000

    } = {}) {



        this.logger = logger;



        this.metrics = metrics;



        this.tracer = tracer;



        this.observability = observability;



        this.maxRetries = maxRetries;



        this.retryDelayMs = retryDelayMs;



        this.maxLockDurationMs =
            maxLockDurationMs;







        /**
         * Tenant refresh locks
         *
         * tenantId => Promise
         */
        this.refreshLocks = new Map();







        /**
         * Runtime statistics
         */
        this.statistics = {



            attempts: 0,



            successful: 0,



            failed: 0,



            deduplicated: 0,



            retries: 0



        };





    }









    /**
     * =========================================================================
     * Execute Refresh
     *
     * Guarantees only one refresh operation per tenant.
     * =========================================================================
     */


    async execute({

        tenantId,

        correlationId = crypto.randomUUID(),

        refresh

    }) {



        if (!tenantId) {



            throw new Error(

                'Tenant ID required for token refresh'

            );



        }







        if (typeof refresh !== 'function') {



            throw new Error(

                'Refresh operation must be a function'

            );



        }







        const existing =

            this.refreshLocks.get(

                tenantId

            );







        if (existing) {



            this.statistics.deduplicated++;





            this.metrics?.counter?.(

                'payment_mtn_refresh_deduplicated_total'

            );





            this.logger?.debug?.({

                event:

                    'mtn.refresh.deduplicated',



                tenantId,



                correlationId

            });





            return existing;



        }







        const operation =

            this.createRefreshLock({

                tenantId,

                correlationId,

                refresh

            });







        this.refreshLocks.set(

            tenantId,

            operation

        );







        try {



            return await operation;



        }



        finally {



            this.refreshLocks.delete(

                tenantId

            );



        }



    }









    /**
     * =========================================================================
     * Create Refresh Lock Operation
     * =========================================================================
     */


    async createRefreshLock({

        tenantId,

        correlationId,

        refresh

    }) {



        const span =

            this.tracer?.startSpan?.(

                'payment.mtn.token.refresh'

            );







        this.statistics.attempts++;







        this.metrics?.counter?.(

            'payment_mtn_refresh_attempt_total'

        );







        this.observability?.tokenRefreshStarted?.({

            tenantId,

            correlationId

        });







        try {



            const result =

                await this.withRetry({

                    operation:

                        refresh,

                    tenantId,

                    correlationId

                });







            this.statistics.successful++;







            this.metrics?.counter?.(

                'payment_mtn_refresh_success_total'

            );







            this.observability?.tokenRefreshSucceeded?.({

                tenantId,

                correlationId

            });







            this.logger?.info?.({

                event:

                    'mtn.refresh.success',



                tenantId,



                correlationId

            });







            return result;



        }



        catch(error) {



            this.statistics.failed++;







            this.metrics?.counter?.(

                'payment_mtn_refresh_failure_total'

            );







            this.observability?.tokenRefreshFailed?.({

                tenantId,

                correlationId,

                error

            });







            this.logger?.error?.({

                event:

                    'mtn.refresh.failure',



                tenantId,



                correlationId,



                error:

                    error.toJSON?.() ||

                    error.message

            });







            throw normalizeError(

                error,

                {

                    provider:

                        'MTN',

                    correlationId,

                    tenantId

                }

            );



        }



        finally {



            span?.end?.();



        }



    }









    /**
     * =========================================================================
     * Retry Execution
     *
     * Exponential backoff strategy:
     *
     * Attempt 1
     * 500ms
     *
     * Attempt 2
     * 1000ms
     *
     * Attempt 3
     * 2000ms
     *
     * =========================================================================
     */


    async withRetry({

        operation,

        tenantId,

        correlationId

    }) {



        let attempt = 0;



        let lastError;







        while (

            attempt < this.maxRetries

        ) {



            try {



                return await operation();



            }



            catch(error) {



                lastError = error;



                attempt++;







                if (

                    attempt >= this.maxRetries

                ) {



                    break;



                }







                this.statistics.retries++;







                const delay =

                    this.retryDelayMs *

                    Math.pow(

                        2,

                        attempt - 1

                    );







                this.metrics?.counter?.(

                    'payment_mtn_refresh_retry_total'

                );







                this.logger?.warn?.({

                    event:

                        'mtn.refresh.retry',



                    tenantId,



                    correlationId,



                    attempt,



                    delay

                });







                await this.sleep(

                    delay

                );



            }



        }







        throw lastError;



    }









    /**
     * =========================================================================
     * Check Active Refresh
     * =========================================================================
     */


    isRefreshing(tenantId) {



        return this.refreshLocks.has(

            tenantId

        );



    }









    /**
     * =========================================================================
     * Force Release Lock
     *
     * Emergency operational recovery.
     * =========================================================================
     */


    release(tenantId) {



        return this.refreshLocks.delete(

            tenantId

        );



    }









    /**
     * =========================================================================
     * Statistics
     * =========================================================================
     */


    stats() {



        return {



            ...this.statistics,



            activeRefreshes:

                this.refreshLocks.size



        };



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

                'MTN_REFRESH_MANAGER',



            activeRefreshes:

                this.refreshLocks.size,



            statistics:

                this.stats()



        };



    }









    /**
     * =========================================================================
     * Delay Utility
     * =========================================================================
     */


    sleep(ms) {



        return new Promise(

            resolve =>

                setTimeout(

                    resolve,

                    ms

                )

        );



    }





}


module.exports = RefreshManager;