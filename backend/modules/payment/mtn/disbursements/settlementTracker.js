'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * MTN MoMo Disbursement Settlement Tracker
 * =============================================================================
 *
 * Enterprise Production Implementation
 *
 * Purpose
 * -----------------------------------------------------------------------------
 * Tracks MTN MoMo disbursement settlement lifecycle from provider submission
 * through final reconciliation.
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Register outbound MTN settlement transactions
 * • Track settlement lifecycle states
 * • Correlate provider references
 * • Support reconciliation workflows
 * • Detect settlement anomalies
 * • Maintain settlement history
 * • Emit operational events
 * • Provide audit visibility
 *
 * Does NOT
 * -----------------------------------------------------------------------------
 * ✗ Execute MTN transfers
 * ✗ Modify ledger balances
 * ✗ Perform accounting entries
 * ✗ Replace reconciliation engine
 *
 * =============================================================================
 */


class SettlementTracker {


    constructor({

        repository,

        auditService,

        eventBus,

        metrics,

        logger

    } = {}) {



        if (!repository) {

            throw new Error(

                'SettlementTracker requires repository.'

            );

        }



        this.repository = repository;

        this.auditService = auditService;

        this.eventBus = eventBus;

        this.metrics = metrics;

        this.logger = logger || console;


    }





    /**
     * =========================================================================
     * Register Settlement
     * =========================================================================
     *
     * Called after MTN accepts a disbursement request.
     */


    async register({

        tenantId,

        reference,

        response,

        transactionId,

        amount,

        currency = 'UGX',

        metadata = {}

    } = {}) {



        this.#validate({

            tenantId,

            reference

        });



        const settlement =

            await this.repository.create({


                tenantId,


                reference,


                transactionId,


                provider:

                    'MTN',



                status:

                    'PENDING',



                amount,


                currency,



                providerResponse:

                    response,



                metadata,



                statusHistory: [

                    {

                        status:

                            'PENDING',


                        timestamp:

                            new Date(),


                        source:

                            'SYSTEM'

                    }

                ],



                createdAt:

                    new Date(),



                updatedAt:

                    new Date()



            });





        this.metrics?.increment?.(

            'mtn.settlement.registered'

        );





        await this.auditService?.record({

            action:

                'MTN_SETTLEMENT_REGISTERED',


            tenantId,


            reference,


            transactionId,


            timestamp:

                new Date()

        });





        await this.eventBus?.publish?.({

            type:

                'MTN_SETTLEMENT_REGISTERED',


            payload:

                settlement

        });





        this.logger.info?.({

            event:

                'mtn.settlement.registered',


            tenantId,


            reference


        });





        return settlement;


    }






    /**
     * =========================================================================
     * Update Settlement Status
     * =========================================================================
     */


    async updateStatus({

        reference,

        status,

        providerResponse,

        metadata = {}

    } = {}) {



        if (!reference) {


            throw this.#error(

                'VALIDATION_ERROR',

                'Settlement reference required.',

                400

            );


        }



        if (!status) {


            throw this.#error(

                'VALIDATION_ERROR',

                'Settlement status required.',

                400

            );


        }





        const settlement =

            await this.repository.find({

                reference

            });





        if (!settlement) {


            throw this.#error(

                'SETTLEMENT_NOT_FOUND',

                'Settlement record not found.',

                404

            );


        }






        const history =

            Array.isArray(

                settlement.statusHistory

            )

                ? [

                    ...settlement.statusHistory

                ]

                : [];





        history.push({

            previousStatus:

                settlement.status,


            status,


            timestamp:

                new Date(),


            metadata

        });






        const updated =

            await this.repository.update(

                settlement.id,

                {


                    status,


                    providerResponse,


                    statusHistory:

                        history,



                    updatedAt:

                        new Date(),



                    settledAt:

                        status === 'SETTLED'

                            ? new Date()

                            : settlement.settledAt

                }

            );







        await this.eventBus?.publish?.({

            type:

                `MTN_SETTLEMENT_${status}`,

            payload:

                updated

        });






        return updated;


    }







    /**
     * =========================================================================
     * Reconcile Settlement
     * =========================================================================
     */


    async reconcile(reference) {



        if (!reference) {


            throw this.#error(

                'VALIDATION_ERROR',

                'Settlement reference required.',

                400

            );


        }




        const settlement =

            await this.repository.find({

                reference

            });






        this.metrics?.increment?.(

            settlement

                ? 'mtn.settlement.reconcile.found'

                : 'mtn.settlement.reconcile.missing'

        );






        return settlement;


    }







    /**
     * =========================================================================
     * Find Pending Settlements
     * =========================================================================
     */


    async pending() {


        return this.repository.findMany({

            provider:

                'MTN',


            status:

                {

                    $in: [

                        'PENDING',

                        'PROCESSING'

                    ]

                }

        });


    }







    /**
     * =========================================================================
     * Mark Settlement Failed
     * =========================================================================
     */


    async fail({

        reference,

        reason

    } = {}) {


        return this.updateStatus({

            reference,


            status:

                'FAILED',



            metadata: {

                reason

            }

        });


    }







    /**
     * =========================================================================
     * Validate Required Fields
     * =========================================================================
     */


    #validate({

        tenantId,

        reference

    }) {



        if (!tenantId) {


            throw this.#error(

                'VALIDATION_ERROR',

                'tenantId required.',

                400

            );


        }




        if (!reference) {


            throw this.#error(

                'VALIDATION_ERROR',

                'Settlement reference required.',

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

            'SettlementTrackerError';



        error.code =

            code;



        error.statusCode =

            statusCode;



        return error;


    }


}





module.exports = SettlementTracker;