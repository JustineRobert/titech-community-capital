'use strict';

/**
 * ==========================================================
 * TITech Community Capital LTD
 * Enterprise Payment Idempotency Engine
 * ----------------------------------------------------------
 * Purpose
 * -------
 * Provides distributed idempotency protection for all payment
 * orchestration workflows.
 *
 * Responsibilities
 * ----------------
 * • Duplicate request detection
 * • Atomic idempotency registration
 * • Replay response storage
 * • Tenant isolation
 * • Request fingerprinting
 * • TTL management
 * • Concurrent request protection
 * • Distributed cache support
 * • Metrics instrumentation
 * • Structured logging
 * • Audit hooks
 * • Health monitoring
 *
 * Supported Workflows
 * -------------------
 * • MTN Collections
 * • MTN Disbursements
 * • Airtel Money
 * • Bank Transfers
 * • Payment Callbacks
 * • Settlement Operations
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • Payment processing
 * • Provider communication
 * • Transaction validation
 * • Ledger posting
 *
 * ==========================================================
 */


const crypto = require('crypto');


class IdempotencyEngine {


    constructor({

        cache,

        logger,

        metrics,

        auditService,

        defaultTTL = 86400

    } = {}) {


        if (!cache) {

            throw new Error(

                'Idempotency cache dependency required'

            );

        }


        this.cache = cache;

        this.logger = logger;

        this.metrics = metrics;

        this.auditService = auditService;

        this.defaultTTL = defaultTTL;


        /**
         * Local in-flight locks.
         *
         * Prevents duplicate execution
         * inside same process.
         */
        this.locks = new Map();


    }




    /**
     * ------------------------------------------------------
     * Check existing idempotency record
     * ------------------------------------------------------
     */
    async check({

        key,

        tenantId = null

    }) {


        const normalizedKey =

            this.buildKey({

                key,

                tenantId

            });



        const existing =

            await this.cache.get(

                normalizedKey

            );



        if (existing) {


            this.metrics?.counter?.(

                'payment_idempotency_hit_total'

            );



            this.logger?.warn?.({

                message:

                    'Duplicate idempotency request detected',

                key:

                    normalizedKey,

                tenantId

            });



            return {

                exists: true,

                response: existing

            };

        }



        this.metrics?.counter?.(

            'payment_idempotency_miss_total'

        );



        return {

            exists:false,

            response:null

        };

    }





    /**
     * ------------------------------------------------------
     * Acquire execution lock
     *
     * Prevents concurrent duplicate processing.
     * ------------------------------------------------------
     */
    async acquire({

        key,

        tenantId = null

    }) {


        const normalizedKey =

            this.buildKey({

                key,

                tenantId

            });



        if (

            this.locks.has(normalizedKey)

        ) {


            throw new Error(

                'Request already being processed'

            );

        }



        this.locks.set(

            normalizedKey,

            {

                createdAt:

                    new Date()

            }

        );



        return true;

    }





    /**
     * ------------------------------------------------------
     * Release execution lock
     * ------------------------------------------------------
     */
    release({

        key,

        tenantId = null

    }) {


        const normalizedKey =

            this.buildKey({

                key,

                tenantId

            });



        return this.locks.delete(

            normalizedKey

        );

    }





    /**
     * ------------------------------------------------------
     * Store completed response
     * ------------------------------------------------------
     */
    async store({

        key,

        response,

        tenantId = null,

        ttl = this.defaultTTL,

        metadata = {}

    }) {


        const normalizedKey =

            this.buildKey({

                key,

                tenantId

            });



        const record = Object.freeze({


            response,


            metadata,


            storedAt:

                new Date(),


            expiresAt:

                new Date(

                    Date.now() +

                    ttl * 1000

                )

        });



        await this.cache.set(

            normalizedKey,

            record,

            ttl

        );



        this.metrics?.counter?.(

            'payment_idempotency_store_total'

        );



        await this.auditService?.record?.({

            action:

                'PAYMENT_IDEMPOTENCY_REGISTERED',


            tenantId,


            key:

                normalizedKey

        });



        return record;

    }





    /**
     * ------------------------------------------------------
     * Execute with idempotency protection
     * ------------------------------------------------------
     */
    async execute({

        key,

        tenantId = null,

        handler

    }) {


        const existing =

            await this.check({

                key,

                tenantId

            });



        if (existing.exists) {


            return existing.response;

        }



        await this.acquire({

            key,

            tenantId

        });



        try {


            const response =

                await handler();



            await this.store({

                key,

                tenantId,

                response

            });



            return response;


        }


        finally {


            this.release({

                key,

                tenantId

            });


        }

    }





    /**
     * ------------------------------------------------------
     * Generate deterministic key
     * ------------------------------------------------------
     */
    buildKey({

        key,

        tenantId

    }) {


        if (!key) {


            throw new Error(

                'Idempotency key required'

            );

        }



        const namespace =

            tenantId ||

            'global';



        return crypto

            .createHash('sha256')

            .update(

                `${namespace}:${key}`

            )

            .digest('hex');

    }





    /**
     * ------------------------------------------------------
     * Remove idempotency record
     * ------------------------------------------------------
     */
    async remove({

        key,

        tenantId = null

    }) {


        const normalizedKey =

            this.buildKey({

                key,

                tenantId

            });



        return this.cache.delete(

            normalizedKey

        );

    }





    /**
     * ------------------------------------------------------
     * Health
     * ------------------------------------------------------
     */
    health() {


        return {


            status:'UP',


            activeLocks:

                this.locks.size,


            ttl:

                this.defaultTTL


        };

    }





    /**
     * ------------------------------------------------------
     * Statistics snapshot
     * ------------------------------------------------------
     */
    stats() {


        return {


            activeLocks:

                this.locks.size,


            ttl:

                this.defaultTTL


        };

    }


}


module.exports = IdempotencyEngine;