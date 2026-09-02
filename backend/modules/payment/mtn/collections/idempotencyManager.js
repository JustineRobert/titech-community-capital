'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * MTN MoMo Collection Idempotency Manager
 * =============================================================================
 *
 * Enterprise Production Implementation
 *
 * Purpose
 * -----------------------------------------------------------------------------
 * Provides distributed idempotency protection for MTN MoMo collection requests.
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Detect duplicate payment requests
 * • Reserve transaction keys
 * • Store completed responses
 * • Support replay-safe processing
 * • Prevent duplicate financial operations
 * • Track idempotency lifecycle
 * • Provide operational visibility
 *
 * Does NOT
 * -----------------------------------------------------------------------------
 * ✗ Execute payments
 * ✗ Call MTN APIs
 * ✗ Update ledger
 * ✗ Validate payment business rules
 *
 * =============================================================================
 */

class IdempotencyManager {

    constructor({

        store,

        auditService,

        metrics,

        eventBus,

        logger,

        ttlSeconds = 86400

    } = {}) {


        if (!store) {

            throw new Error(

                'IdempotencyManager requires store.'

            );

        }


        this.store = store;

        this.auditService = auditService;

        this.metrics = metrics;

        this.eventBus = eventBus;

        this.logger = logger || console;

        this.ttlSeconds = ttlSeconds;

    }


    /**
     * =========================================================================
     * Check Idempotency Key
     * =========================================================================
     *
     * Returns existing response if duplicate.
     * Throws only when duplicate protection fails.
     */

    async check({

        tenantId,

        externalId,

        operation = 'MTN_COLLECTION'

    } = {}) {


        this.#validate({

            tenantId,

            externalId

        });


        const record =

            await this.store.find({

                tenantId,

                externalId

            });


        if (!record) {


            this.metrics?.increment?.(

                'payment.idempotency.miss'

            );


            return {

                exists: false

            };


        }


        this.metrics?.increment?.(

            'payment.idempotency.hit'

        );


        this.logger.warn?.({

            event:

                'payment.idempotency.duplicate_detected',

            tenantId,

            externalId,

            operation

        });


        return {

            exists: true,

            response:

                record.response,

            status:

                record.status,

            createdAt:

                record.createdAt

        };


    }


    /**
     * =========================================================================
     * Reserve Idempotency Key
     * =========================================================================
     *
     * Used before calling MTN to prevent concurrent duplicate requests.
     */

    async reserve({

        tenantId,

        externalId,

        operation = 'MTN_COLLECTION',

        metadata = {}

    } = {}) {


        this.#validate({

            tenantId,

            externalId

        });


        const existing =

            await this.store.find({

                tenantId,

                externalId

            });


        if (existing) {


            throw this.#error(

                'IDEMPOTENCY_CONFLICT',

                'Payment request already reserved.',

                409

            );


        }


        const record =

            await this.store.save({

                tenantId,

                externalId,

                operation,

                status:

                    'PROCESSING',

                metadata,

                createdAt:

                    new Date(),

                expiresAt:

                    new Date(

                        Date.now() +

                        this.ttlSeconds * 1000

                    )

            });



        await this.eventBus?.publish?.({

            type:

                'PAYMENT_IDEMPOTENCY_RESERVED',

            tenantId,

            externalId

        });



        return record;


    }


    /**
     * =========================================================================
     * Register Completed Response
     * =========================================================================
     */

    async register({

        tenantId,

        externalId,

        response,

        status = 'COMPLETED',

        metadata = {}

    } = {}) {


        this.#validate({

            tenantId,

            externalId

        });


        const result =

            await this.store.update({

                tenantId,

                externalId,

                response,

                status,

                metadata,

                completedAt:

                    new Date()

            });



        this.metrics?.increment?.(

            'payment.idempotency.completed'

        );



        await this.auditService?.record({

            action:

                'PAYMENT_IDEMPOTENCY_REGISTERED',

            tenantId,

            externalId,

            status,

            timestamp:

                new Date()

        });



        await this.eventBus?.publish?.({

            type:

                'PAYMENT_IDEMPOTENCY_COMPLETED',

            tenantId,

            externalId,

            status

        });



        return result;


    }


    /**
     * =========================================================================
     * Mark Failed
     * =========================================================================
     */

    async fail({

        tenantId,

        externalId,

        error

    } = {}) {


        return this.store.update({

            tenantId,

            externalId,

            status:

                'FAILED',

            error: {

                message:

                    error?.message ||

                    String(error)

            },

            failedAt:

                new Date()

        });


    }


    /**
     * =========================================================================
     * Validate Input
     * =========================================================================
     */

    #validate({

        tenantId,

        externalId

    }) {


        if (!tenantId) {

            throw this.#error(

                'VALIDATION_ERROR',

                'tenantId is required.',

                400

            );

        }


        if (!externalId) {

            throw this.#error(

                'VALIDATION_ERROR',

                'externalId is required.',

                400

            );

        }


    }


    /**
     * =========================================================================
     * Error Factory
     * =========================================================================
     */

    #error(

        code,

        message,

        statusCode = 500

    ) {


        const error =

            new Error(message);


        error.name =

            'IdempotencyError';


        error.code =

            code;


        error.statusCode =

            statusCode;


        return error;


    }


}


module.exports = IdempotencyManager;