'use strict';

/**
 * ==========================================================
 * TITech Community Capital LTD
 * MTN MoMo Enterprise Disbursement Gateway
 * ----------------------------------------------------------
 *
 * Production outbound payment orchestration facade.
 *
 * Supports:
 *
 * • Loan payouts
 * • Savings withdrawals
 * • Member refunds
 * • Supplier payments
 * • Bulk transfers
 *
 *
 * Responsibilities
 * ----------------
 *
 * • Disbursement orchestration
 * • Approval enforcement
 * • Beneficiary validation
 * • Fraud controls
 * • Idempotency
 * • MTN transfer execution
 * • Settlement tracking
 * • Callback correlation
 * • Ledger integration
 * • Compensation workflows
 * • Audit events
 *
 *
 * Does NOT:
 *
 * • Store OAuth tokens
 * • Manage credentials
 * • Directly modify balances
 * • Process callbacks
 *
 * ==========================================================
 */


const crypto = require('crypto');


const {
    normalizeError
} = require('../shared/errors');



class MTNDisbursements {



    constructor({


        disbursementService,

        callbackCorrelation,

        settlementTracker,

        auditService,

        eventPublisher,

        logger,

        metrics,

        tracer


    } = {}) {



        this.disbursementService =
            disbursementService;


        this.callbackCorrelation =
            callbackCorrelation;


        this.settlementTracker =
            settlementTracker;


        this.auditService =
            auditService;


        this.eventPublisher =
            eventPublisher;


        this.logger =
            logger;


        this.metrics =
            metrics;


        this.tracer =
            tracer;



        this.statistics = {


            initiated: 0,

            successful: 0,

            failed: 0,

            compensated: 0

        };


    }





    /**
     * ------------------------------------------------------
     * Initiate MTN Disbursement
     * ------------------------------------------------------
     */
    async disburse({


        tenantId,


        beneficiary,


        amount,


        currency = 'UGX',


        type = 'LOAN_DISBURSEMENT',


        reference,


        requestedBy,


        metadata = {}


    }) {



        const correlationId =

            crypto.randomUUID();



        const span =

            this.tracer?.startSpan?.(

                'payment.mtn.disbursement'

            );



        this.statistics.initiated++;



        try {



            const result =

                await this.disbursementService.initiate({



                    tenantId,


                    beneficiary,


                    amount,


                    currency,


                    type,


                    reference,


                    requestedBy,


                    metadata


                });



            await this.eventPublisher?.publish({


                type:

                    'MTN_DISBURSEMENT_CREATED',



                payload: {


                    tenantId,


                    reference,


                    amount,


                    correlationId


                }


            });



            await this.auditService?.record({


                action:

                    'MTN_DISBURSEMENT_REQUESTED',



                tenantId,


                reference,


                correlationId


            });



            this.statistics.successful++;



            this.metrics?.counter?.(

                'payment_mtn_disbursement_success_total'

            );



            return {


                ...result,


                correlationId


            };



        }



        catch(error) {



            this.statistics.failed++;



            this.metrics?.counter?.(

                'payment_mtn_disbursement_failure_total'

            );



            const normalized =

                normalizeError(error, {


                    provider:

                        'MTN',


                    tenantId,


                    correlationId


                });



            this.logger?.error?.({


                message:

                    'MTN disbursement failed',



                tenantId,


                reference,


                correlationId,


                error:

                    normalized.toJSON?.()

                    ||

                    normalized


            });



            throw normalized;


        }



        finally {


            span?.end?.();


        }


    }







    /**
     * ------------------------------------------------------
     * Query Settlement
     * ------------------------------------------------------
     */
    async query(reference) {



        return this.settlementTracker.reconcile(

            reference

        );


    }







    /**
     * ------------------------------------------------------
     * Correlate Callback
     * ------------------------------------------------------
     */
    async correlate(reference) {



        return this.callbackCorrelation.correlate({


            externalId:

                reference


        });


    }







    /**
     * ------------------------------------------------------
     * Compensation / Recovery
     * ------------------------------------------------------
     */
    async compensate({


        tenantId,


        reference,


        reason


    }) {



        const result =

            await this.disbursementService.compensate({


                tenantId,


                reference,


                reason


            });



        this.statistics.compensated++;



        await this.auditService?.record({


            action:

                'MTN_DISBURSEMENT_COMPENSATED',



            tenantId,


            reference,


            reason


        });



        return result;


    }







    /**
     * ------------------------------------------------------
     * Health
     * ------------------------------------------------------
     */
    health() {


        return {


            provider:

                'MTN',



            module:

                'disbursements',



            status:

                'UP',



            statistics:

                {

                    ...this.statistics

                }


        };


    }



}



module.exports = MTNDisbursements;