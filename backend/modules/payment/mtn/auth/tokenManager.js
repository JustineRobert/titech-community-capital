'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise MTN MoMo Token Manager
 * =============================================================================
 *
 * Purpose
 * -------
 * Enterprise lifecycle manager for MTN OAuth access tokens.
 *
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 *
 * ✓ Multi-tenant token isolation
 * ✓ Secure token caching
 * ✓ Expiration management
 * ✓ Refresh window calculation
 * ✓ Atomic token replacement
 * ✓ Cache invalidation
 * ✓ Token lifecycle metrics
 * ✓ Structured operational logging
 * ✓ Health monitoring
 * ✓ Safe diagnostics
 * ✓ Clock abstraction for testing
 *
 *
 * Does NOT:
 *
 * ✗ Authenticate against MTN
 * ✗ Manage credentials
 * ✗ Call OAuth APIs
 * ✗ Execute payments
 * ✗ Handle callbacks
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
 * TokenManager
 *
 *        |
 *        ├── Memory Cache
 *        ├── Metrics
 *        ├── Logger
 *        └── Health
 *
 * =============================================================================
 */



const crypto = require('crypto');








class TokenManager {





    constructor({

        refreshBufferSeconds = 60,

        logger,

        metrics,

        tracer,

        observability,

        clock = Date

    } = {}) {



        this.refreshBufferMs =

            refreshBufferSeconds * 1000;



        this.logger = logger;



        this.metrics = metrics;



        this.tracer = tracer;



        this.observability = observability;



        this.clock = clock;







        /**
         * Tenant token storage
         *
         * tenantId => token record
         */
        this.cache = new Map();







        this.statistics = {



            hits: 0,



            misses: 0,



            stores: 0,



            removals: 0,



            replacements: 0,



            expirations: 0,



            invalidations: 0



        };



    }









    /**
     * =========================================================================
     * Store Token
     * =========================================================================
     */


    async store({

        tenantId,

        token,

        correlationId = crypto.randomUUID()

    }) {



        if (!tenantId) {



            throw new Error(

                'Tenant ID required for token storage'

            );



        }







        if (!token) {



            throw new Error(

                'Token payload required'

            );



        }







        const now =

            new this.clock();







        const expiresIn =

            Number(

                token.expiresIn ||

                token.expires_in ||

                3600

            );







        const accessToken =

            token.accessToken ||

            token.access_token;







        if (!accessToken) {



            throw new Error(

                'Access token missing'

            );



        }







        const record = Object.freeze({



            tenantId,



            accessToken,



            tokenType:

                token.tokenType ||

                token.token_type ||

                'Bearer',



            expiresIn,



            expiresAt:

                new Date(

                    now.getTime() +

                    expiresIn * 1000

                ),



            createdAt:

                now,



            refreshedAt:

                now,



            correlationId



        });







        /**
         * Atomic Map replacement.
         */
        this.cache.set(

            tenantId,

            record

        );







        this.statistics.stores++;







        this.metrics?.counter?.(

            'payment_mtn_token_store_total'

        );







        this.logger?.info?.({

            event:

                'mtn.token.cached',



            tenantId,



            expiresAt:

                record.expiresAt

        });







        return record;



    }









    /**
     * =========================================================================
     * Retrieve Token
     * =========================================================================
     */


    async get({

        tenantId

    }) {



        const token =

            this.cache.get(

                tenantId

            );







        if (!token) {



            this.statistics.misses++;







            this.metrics?.counter?.(

                'payment_mtn_token_cache_miss_total'

            );







            return null;



        }







        if (this.isExpired(token)) {



            await this.remove({

                tenantId

            });







            this.statistics.expirations++;







            this.metrics?.counter?.(

                'payment_mtn_token_expired_total'

            );







            return null;



        }







        this.statistics.hits++;







        this.metrics?.counter?.(

            'payment_mtn_token_cache_hit_total'

        );







        return token;



    }









    /**
     * =========================================================================
     * Atomic Token Replacement
     * =========================================================================
     */


    async replace({

        tenantId,

        token,

        correlationId

    }) {



        this.statistics.replacements++;







        return this.store({

            tenantId,

            token,

            correlationId

        });



    }









    /**
     * =========================================================================
     * Remove Token
     * =========================================================================
     */


    async remove({

        tenantId

    }) {



        const removed =

            this.cache.delete(

                tenantId

            );







        if (removed) {



            this.statistics.removals++;







            this.metrics?.counter?.(

                'payment_mtn_token_removed_total'

            );







            this.logger?.info?.({

                event:

                    'mtn.token.removed',



                tenantId

            });



        }







        return removed;



    }









    /**
     * =========================================================================
     * Invalidate Token
     * =========================================================================
     */


    async invalidate({

        tenantId,

        reason = 'manual'

    }) {



        const removed =

            await this.remove({

                tenantId

            });







        if (removed) {



            this.statistics.invalidations++;







            this.logger?.warn?.({

                event:

                    'mtn.token.invalidated',



                tenantId,



                reason

            });



        }







        return removed;



    }









    /**
     * =========================================================================
     * Clear All Tokens
     * =========================================================================
     */


    async clear() {



        this.cache.clear();



        return true;



    }









    /**
     * =========================================================================
     * Expiration Checks
     * =========================================================================
     */


    isExpired(token) {



        return (

            token.expiresAt <=

            new this.clock()

        );



    }









    isExpiringSoon(token) {



        const refreshThreshold =

            token.expiresAt.getTime()

            -

            this.refreshBufferMs;







        return (

            Date.now() >=

            refreshThreshold

        );



    }









    /**
     * =========================================================================
     * Remaining Lifetime
     * =========================================================================
     */


    remainingLifetime(token) {



        return Math.max(

            0,

            token.expiresAt.getTime()

            -

            Date.now()

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



            cachedTenants:

                this.cache.size,



            refreshBufferMs:

                this.refreshBufferMs



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

                'MTN_TOKEN_MANAGER',



            cacheEntries:

                this.cache.size,



            statistics:

                this.stats()



        };



    }









    /**
     * =========================================================================
     * Size
     * =========================================================================
     */


    size() {



        return this.cache.size;



    }









    /**
     * =========================================================================
     * Safe Snapshot
     *
     * Never exposes access tokens.
     * =========================================================================
     */


    snapshot() {



        return [

            ...this.cache.values()

        ]

        .map(token => ({



            tenantId:

                token.tenantId,



            tokenType:

                token.tokenType,



            expiresIn:

                token.expiresIn,



            expiresAt:

                token.expiresAt,



            createdAt:

                token.createdAt,



            refreshedAt:

                token.refreshedAt



        }));



    }


    /**
     * =========================================================================
     * Token Existence Check
     * =========================================================================
     */


    exists(tenantId) {



        return this.cache.has(

            tenantId

        );



    }





}

module.exports = TokenManager;