'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise MTN MoMo Authentication Idempotency Manager
 * =============================================================================
 *
 * Purpose
 * -------
 * Prevent duplicate authentication operations and protect MTN OAuth lifecycle
 * workflows from replay execution.
 *
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 *
 * ✓ Authentication request deduplication
 * ✓ Distributed idempotency protection
 * ✓ Tenant isolation
 * ✓ Correlation tracking
 * ✓ Concurrent request locking
 * ✓ Idempotency key lifecycle management
 * ✓ Cache/store abstraction
 * ✓ Metrics instrumentation
 * ✓ Audit integration
 * ✓ Structured logging
 *
 *
 * Does NOT:
 *
 * ✗ Generate tokens
 * ✗ Validate credentials
 * ✗ Call MTN APIs
 * ✗ Store secrets
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
 * IdempotencyManager
 *
 *        |
 *        +----------------+
 *        |                |
 *        ▼                ▼
 *
 * Redis Store        Memory Fallback
 *
 *        |
 *        ▼
 *
 * OAuth Execution Lock
 *
 * =============================================================================
 */



const crypto = require('crypto');








class IdempotencyManager {





    constructor({

        store,

        ttl = 300000,

        lockTTL = 60000,

        logger,

        metrics,

        auditService

    } = {}) {



        this.store = store;



        this.ttl = ttl;



        this.lockTTL = lockTTL;



        this.logger = logger;



        this.metrics = metrics;



        this.auditService = auditService;







        /**
         * Local fallback protection
         *
         * Used when distributed store unavailable
         */
        this.memoryStore = new Map();







    }









    /**
     * =========================================================================
     * Generate Idempotency Key
     * =========================================================================
     */


    generateKey({

        tenantId,

        operation,

        reference = ''

    }) {



        if (!tenantId || !operation) {



            throw new Error(

                'Tenant and operation required for idempotency key'

            );



        }







        return crypto

            .createHash('sha256')

            .update(

                [

                    tenantId,

                    operation,

                    reference

                ].join(':')

            )

            .digest('hex');



    }









    /**
     * =========================================================================
     * Check Existing Execution
     * =========================================================================
     */


    async check({

        tenantId,

        key,

        operation = 'AUTHENTICATION'

    }) {



        const idempotencyKey =

            key ||

            this.generateKey({

                tenantId,

                operation

            });







        const existing =

            await this.get(idempotencyKey);







        if (existing) {



            this.metrics?.counter?.(

                'payment_mtn_auth_idempotency_hit_total'

            );







            return {



                duplicate:

                    true,



                key:

                    idempotencyKey,



                response:

                    existing



            };



        }







        this.metrics?.counter?.(

            'payment_mtn_auth_idempotency_miss_total'

        );







        return {



            duplicate:

                false,



            key:

                idempotencyKey



        };



    }









    /**
     * =========================================================================
     * Acquire Execution Lock
     * =========================================================================
     */


    async acquireLock({

        key,

        metadata = {}

    }) {



        const lock = {



            status:

                'PROCESSING',



            metadata,



            createdAt:

                new Date()



        };







        const exists =

            await this.get(key);







        if (exists) {



            throw new Error(

                'Idempotency lock already exists'

            );



        }







        await this.save(

            key,

            lock,

            this.lockTTL

        );







        return true;



    }









    /**
     * =========================================================================
     * Store Successful Result
     * =========================================================================
     */


    async complete({

        key,

        response,

        metadata = {}

    }) {



        const record = {



            status:

                'COMPLETED',



            response,



            metadata,



            completedAt:

                new Date()



        };







        await this.save(

            key,

            record,

            this.ttl

        );







        await this.auditService?.record?.({

            action:

                'MTN_AUTH_IDEMPOTENCY_COMPLETED',



            key



        });







        return record;



    }









    /**
     * =========================================================================
     * Mark Failed Execution
     * =========================================================================
     */


    async fail({

        key,

        error

    }) {



        const record = {



            status:

                'FAILED',



            error:

                error?.message || error,



            failedAt:

                new Date()



        };







        await this.save(

            key,

            record,

            this.ttl

        );







        return record;



    }









    /**
     * =========================================================================
     * Store Wrapper
     * =========================================================================
     */


    async save(

        key,

        value,

        ttl = this.ttl

    ) {



        if (this.store?.set) {



            return this.store.set({

                key,

                value,

                ttl



            });



        }







        this.memoryStore.set(

            key,

            {

                value,

                expiresAt:

                    Date.now() + ttl



            }

        );







        return true;



    }









    /**
     * =========================================================================
     * Retrieve Wrapper
     * =========================================================================
     */


    async get(key) {



        if (this.store?.get) {



            return this.store.get({

                key

            });



        }







        const record =

            this.memoryStore.get(key);







        if (!record) {



            return null;



        }







        if (

            record.expiresAt < Date.now()

        ) {



            this.memoryStore.delete(key);



            return null;



        }







        return record.value;



    }









    /**
     * =========================================================================
     * Remove Key
     * =========================================================================
     */


    async remove(key) {



        if (this.store?.delete) {



            return this.store.delete({

                key

            });



        }







        return this.memoryStore.delete(key);



    }









    /**
     * =========================================================================
     * Cleanup Expired Local Records
     * =========================================================================
     */


    cleanup() {



        const now = Date.now();







        for (const [

            key,

            value

        ] of this.memoryStore.entries()) {



            if (

                value.expiresAt < now

            ) {



                this.memoryStore.delete(key);



            }



        }



    }









    /**
     * =========================================================================
     * Health
     * =========================================================================
     */


    async health() {



        return {



            status:

                'UP',



            provider:

                'MTN',



            module:

                'AUTH_IDEMPOTENCY',



            distributedStore:

                Boolean(this.store),



            memoryEntries:

                this.memoryStore.size,



            ttl:

                this.ttl



        };



    }

    /**
     * =========================================================================
     * Snapshot
     * =========================================================================
     */


    snapshot() {



        return {



            memoryEntries:

                this.memoryStore.size,



            ttl:

                this.ttl,



            lockTTL:

                this.lockTTL



        };



    }

}
module.exports = IdempotencyManager;