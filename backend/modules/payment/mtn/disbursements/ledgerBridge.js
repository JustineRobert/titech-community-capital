'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * MTN MoMo Disbursement Ledger Bridge
 * =============================================================================
 *
 * Enterprise Production Implementation
 *
 * Purpose
 * -----------------------------------------------------------------------------
 * Secure accounting integration layer between MTN MoMo disbursement workflows
 * and the TITech Financial Ledger Engine.
 *
 * The Ledger Engine remains the single authoritative source of truth for:
 *
 * • Journal creation
 * • Double-entry validation
 * • Account balancing
 * • Balance updates
 * • Financial reporting
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Validate disbursement ledger posting requests
 * • Normalize MTN disbursement operations
 * • Prevent duplicate ledger postings
 * • Submit accounting operations to Ledger Engine
 * • Publish financial events
 * • Create audit trails
 * • Provide observability hooks
 *
 * Does NOT
 * -----------------------------------------------------------------------------
 * ✗ Directly modify balances
 * ✗ Create journals manually
 * ✗ Bypass Ledger Engine rules
 * ✗ Perform settlement reconciliation
 * ✗ Update payment state
 *
 * =============================================================================
 */


class LedgerBridge {


    constructor({

        ledgerEngine,

        auditService,

        eventBus,

        metrics,

        logger

    } = {}) {


        if (!ledgerEngine) {


            throw new Error(

                'MTN Disbursement LedgerBridge requires ledgerEngine.'

            );


        }



        this.ledgerEngine = ledgerEngine;

        this.auditService = auditService;

        this.eventBus = eventBus;

        this.metrics = metrics;

        this.logger = logger || console;


    }






    /**
     * =========================================================================
     * Post MTN Disbursement To Ledger
     * =========================================================================
     */


    async postDisbursement({

        tenantId,

        transaction,

        correlationId,

        idempotencyKey

    } = {}) {


        const startedAt = Date.now();



        this.#validate({

            tenantId,

            transaction

        });





        /**
         * ---------------------------------------------------------------------
         * Prevent duplicate accounting entries
         * ---------------------------------------------------------------------
         */


        if (

            transaction.ledgerPosted === true ||

            transaction.ledgerStatus === 'POSTED'

        ) {



            this.logger.warn?.({

                event:

                    'mtn.disbursement.ledger.skip',


                reason:

                    'Already posted',



                transactionId:

                    transaction.id,


                reference:

                    transaction.reference


            });



            return {


                posted: false,


                skipped: true,


                reason:

                    'ALREADY_POSTED'


            };


        }






        /**
         * ---------------------------------------------------------------------
         * Build Financial Operation
         * ---------------------------------------------------------------------
         */


        const operation = {



            type:

                'MTN_DISBURSEMENT',



            provider:

                'MTN',



            reference:

                transaction.reference,



            externalId:

                transaction.externalId,



            amount:

                transaction.amount,



            currency:

                transaction.currency || 'UGX',



            occurredAt:

                transaction.completedAt ||

                transaction.updatedAt ||

                new Date(),



            idempotencyKey:

                idempotencyKey ||

                transaction.reference,



            metadata: {



                tenantId,



                transactionId:

                    transaction.id,



                memberId:

                    transaction.memberId,



                beneficiary:

                    transaction.beneficiary,



                provider:

                    'MTN',



                providerTransactionId:

                    transaction.providerTransactionId,



                status:

                    transaction.status,



                correlationId,



                source:

                    'MTN_DISBURSEMENT'

            }


        };







        /**
         * ---------------------------------------------------------------------
         * Ledger Engine Posting
         * ---------------------------------------------------------------------
         */


        const result =

            await this.ledgerEngine.post({

                tenantId,


                operation


            });







        /**
         * ---------------------------------------------------------------------
         * Metrics
         * ---------------------------------------------------------------------
         */


        this.metrics?.increment?.(

            'mtn.disbursement.ledger.post.success'

        );



        this.metrics?.observe?.(

            'mtn.disbursement.ledger.post.duration',

            Date.now() - startedAt

        );







        /**
         * ---------------------------------------------------------------------
         * Audit Trail
         * ---------------------------------------------------------------------
         */


        await this.auditService?.record({

            action:

                'MTN_DISBURSEMENT_LEDGER_POSTED',



            tenantId,



            transactionId:

                transaction.id,



            reference:

                transaction.reference,



            journalId:

                result?.journalId ||

                result?.id ||



                null,



            amount:

                transaction.amount,



            currency:

                transaction.currency || 'UGX',



            correlationId,



            timestamp:

                new Date()


        });








        /**
         * ---------------------------------------------------------------------
         * Financial Domain Event
         * ---------------------------------------------------------------------
         */


        await this.eventBus?.publish?.({

            type:

                'MTN_DISBURSEMENT_LEDGER_POSTED',



            payload: {



                transactionId:

                    transaction.id,



                reference:

                    transaction.reference,



                ledgerResult:

                    result


            }


        });








        this.logger.info?.({

            event:

                'mtn.disbursement.ledger.completed',



            tenantId,



            transactionId:

                transaction.id,



            reference:

                transaction.reference,



            journalId:

                result?.journalId || null



        });








        return result;


    }







    /**
     * =========================================================================
     * Validate Posting Request
     * =========================================================================
     */


    #validate({

        tenantId,

        transaction

    }) {



        if (!tenantId) {



            throw this.#error(

                'VALIDATION_ERROR',

                'tenantId is required.',

                400

            );


        }






        if (!transaction) {



            throw this.#error(

                'VALIDATION_ERROR',

                'transaction is required.',

                400

            );


        }







        if (!transaction.reference) {



            throw this.#error(

                'VALIDATION_ERROR',

                'Transaction reference is required.',

                400

            );


        }






        if (

            transaction.amount === undefined ||

            transaction.amount === null ||

            Number(transaction.amount) <= 0

        ) {



            throw this.#error(

                'INVALID_AMOUNT',

                'Disbursement amount must be greater than zero.',

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

            'MTNDisbursementLedgerBridgeError';




        error.code =

            code;




        error.statusCode =

            statusCode;




        return error;


    }


}





module.exports = LedgerBridge;