'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * MTN MoMo Disbursement Idempotency Manager
 * =============================================================================
 *
 * Enterprise Production Implementation
 *
 * Purpose
 * -----------------------------------------------------------------------------
 * Provides distributed idempotency protection for MTN MoMo disbursement
 * workflows.
 *
 * Disbursements are financially sensitive operations. Duplicate execution can
 * result in:
 *
 * • Duplicate beneficiary payments
 * • Duplicate ledger postings
 * • Settlement inconsistencies
 * • Financial reconciliation failures
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Detect duplicate disbursement requests
 * • Reserve disbursement references
 * • Store completed responses
 * • Support safe request retries
 * • Prevent concurrent duplicate execution
 * • Track idempotency lifecycle
 * • Emit audit and operational events
 *
 * Does NOT
 * -----------------------------------------------------------------------------
 * ✗ Execute MTN transfers
 * ✗ Approve disbursements
 * ✗ Perform fraud checks
 * ✗ Post accounting entries
 *
 * =============================================================================
 */


class IdempotencyManager {


    constructor({

        store,

        auditService,

        eventBus,

        metrics,

        logger,

        ttlSeconds = 86400

    } = {}) {


        if (!store) {

            throw new Error(

                'Disbursement IdempotencyManager requires store.'

            );

        }


        this.store = store;

        this.auditService = auditService;

        this.eventBus = eventBus;

        this.metrics = metrics;

        this.logger = logger || console;

        this.ttlSeconds = ttlSeconds;


    }






    /**
     * =========================================================================
     * Check Existing Idempotency Record
     * =========================================================================
     *
     * Returns previous execution details when available.
     */


    async check({

        tenantId,

        reference

    } = {}) {



        this.#validate({

            tenantId,

            reference

        });




        const existing =

            await this.store.find({

                tenantId,

                reference

            });





        if (!existing) {


            this.metrics?.increment?.(

                'mtn.disbursement.idempotency.miss'

            );



            return {


                exists: false


            };


        }







        this.metrics?.increment?.(

            'mtn.disbursement.idempotency.hit'

        );





        this.logger.warn?.({

            event:

                'mtn.disbursement.duplicate.detected',


            tenantId,


            reference


        });





        return {


            exists: true,


            status:

                existing.status,


            response:

                existing.response || null,


            createdAt:

                existing.createdAt


        };


    }







    /**
     * =========================================================================
     * Reserve Disbursement Reference
     * =========================================================================
     *
     * Called before submitting request to MTN.
     * Prevents simultaneous duplicate execution.
     */


    async reserve({

        tenantId,

        reference,

        metadata = {}

    } = {}) {



        this.#validate({

            tenantId,

            reference

        });





        const existing =

            await this.store.find({

                tenantId,

                reference

            });






        if (existing) {


            throw this.#error(

                'IDEMPOTENCY_CONFLICT',

                'Disbursement already exists.',

                409

            );


        }






        const record =

            await this.store.save({

                tenantId,

                reference,

                provider:

                    'MTN',


                operation:

                    'DISBURSEMENT',


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






        this.metrics?.increment?.(

            'mtn.disbursement.idempotency.reserved'

        );





        await this.eventBus?.publish?.({

            type:

                'MTN_DISBURSEMENT_IDEMPOTENCY_RESERVED',


            payload:

                record


        });






        return record;


    }







    /**
     * =========================================================================
     * Register Completed Execution
     * =========================================================================
     */


    async register({

        tenantId,

        reference,

        response,

        status = 'COMPLETED',

        metadata = {}

    } = {}) {



        this.#validate({

            tenantId,

            reference

        });






        const result =

            await this.store.update({

                tenantId,

                reference,

                status,

                response,

                metadata,

                completedAt:

                    new Date()


            });








        this.metrics?.increment?.(

            'mtn.disbursement.idempotency.completed'

        );








        await this.auditService?.record({

            action:

                'MTN_DISBURSEMENT_IDEMPOTENCY_REGISTERED',


            tenantId,


            reference,


            status,


            timestamp:

                new Date()


        });








        await this.eventBus?.publish?.({

            type:

                'MTN_DISBURSEMENT_IDEMPOTENCY_COMPLETED',


            payload:

                result


        });







        return result;


    }







    /**
     * =========================================================================
     * Mark Failed Execution
     * =========================================================================
     */


    async fail({

        tenantId,

        reference,

        error

    } = {}) {



        this.#validate({

            tenantId,

            reference

        });






        return this.store.update({

            tenantId,

            reference,

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

        reference

    }) {



        if (!tenantId) {


            throw this.#error(

                'VALIDATION_ERROR',

                'tenantId is required.',

                400

            );


        }






        if (!reference) {


            throw this.#error(

                'VALIDATION_ERROR',

                'Disbursement reference is required.',

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

            'DisbursementIdempotencyError';




        error.code =

            code;




        error.statusCode =

            statusCode;




        error.retryable =

            false;




        return error;


    }


}





module.exports = IdempotencyManager;