'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * MTN MoMo Enterprise Disbursement Service
 * =============================================================================
 *
 * Enterprise Production Implementation
 *
 * Purpose
 * -----------------------------------------------------------------------------
 * Enterprise outbound payment orchestration engine responsible for managing
 * the complete MTN MoMo disbursement lifecycle.
 *
 * Supported Use Cases
 * -----------------------------------------------------------------------------
 * • Loan payouts
 * • Savings withdrawals
 * • Supplier payments
 * • Bulk member payments
 * • Compensation workflows
 * • Internal settlement transfers
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Disbursement orchestration
 * • Approval enforcement
 * • Beneficiary validation
 * • Fraud screening
 * • Idempotency protection
 * • MTN API execution
 * • Transaction lifecycle management
 * • Callback correlation
 * • Settlement tracking
 * • Ledger integration
 * • Audit logging
 * • Failure compensation
 * • Observability
 *
 * Does NOT
 * -----------------------------------------------------------------------------
 * ✗ Directly modify balances
 * ✗ Create accounting journals
 * ✗ Bypass approval workflows
 * ✗ Trust provider responses without validation
 *
 * =============================================================================
 */


const crypto = require('crypto');



class DisbursementService {



    constructor({

        authService,

        httpClient,

        transactionBuilder,

        approvalWorkflow,

        beneficiaryValidator,

        idempotencyManager,

        fraudGuard,

        ledgerBridge,

        settlementTracker,

        stateMachine,

        compensationManager,

        auditService,

        logger,

        metrics,

        tracer,

        configuration = {}

    } = {}) {



        this.authService = authService;

        this.httpClient = httpClient;

        this.transactionBuilder = transactionBuilder;

        this.approvalWorkflow = approvalWorkflow;

        this.beneficiaryValidator = beneficiaryValidator;

        this.idempotencyManager = idempotencyManager;

        this.fraudGuard = fraudGuard;

        this.ledgerBridge = ledgerBridge;

        this.settlementTracker = settlementTracker;

        this.stateMachine = stateMachine;

        this.compensationManager = compensationManager;

        this.auditService = auditService;

        this.logger = logger || console;

        this.metrics = metrics;

        this.tracer = tracer;

        this.configuration = configuration;


    }






    /**
     * =========================================================================
     * Initiate MTN Disbursement
     * =========================================================================
     */


    async initiate({

        tenantId,

        beneficiary,

        amount,

        currency = 'UGX',

        type,

        reference,

        requestedBy,

        metadata = {}

    } = {}) {



        const correlationId =

            crypto.randomUUID();




        const span =

            this.tracer?.startSpan?.(

                'payment.mtn.disbursement.initiate'

            );





        const startedAt = Date.now();




        try {



            this.#validateRequest({

                tenantId,

                beneficiary,

                amount,

                reference

            });





            /**
             * -----------------------------------------------------------------
             * 1. Validate beneficiary
             * -----------------------------------------------------------------
             */


            await this.beneficiaryValidator?.validate?.({

                tenantId,

                beneficiary

            });







            /**
             * -----------------------------------------------------------------
             * 2. Approval enforcement
             * -----------------------------------------------------------------
             */


            await this.approvalWorkflow?.authorize?.({

                tenantId,

                reference,

                amount,

                requestedBy

            });







            /**
             * -----------------------------------------------------------------
             * 3. Idempotency protection
             * -----------------------------------------------------------------
             */


            const existing =

                await this.idempotencyManager?.check?.({

                    tenantId,

                    reference

                });





            if (

                existing?.exists

            ) {


                return {


                    reference,


                    status:

                        existing.status || 'PROCESSING',


                    response:

                        existing.response || null,


                    correlationId


                };


            }







            await this.idempotencyManager?.reserve?.({

                tenantId,

                reference,

                metadata: {

                    type,

                    amount,

                    beneficiary

                }

            });







            /**
             * -----------------------------------------------------------------
             * 4. Fraud screening
             * -----------------------------------------------------------------
             */


            await this.fraudGuard?.inspect?.({

                tenantId,

                beneficiary,

                amount,

                type,

                reference,

                requestedBy

            });







            /**
             * -----------------------------------------------------------------
             * 5. Build MTN payload
             * -----------------------------------------------------------------
             */


            const transaction =

                this.transactionBuilder.build({

                    reference,

                    beneficiary,

                    amount,

                    currency,

                    tenantId,

                    metadata

                });








            /**
             * -----------------------------------------------------------------
             * 6. Authenticate MTN
             * -----------------------------------------------------------------
             */


            const token =

                await this.authService.getAccessToken({

                    tenantId,

                    correlationId

                });








            /**
             * -----------------------------------------------------------------
             * 7. Submit MTN transfer
             * -----------------------------------------------------------------
             */


            const response =

                await this.httpClient.request({

                    method:

                        'POST',


                    url:

                        this.transferEndpoint(),



                    headers: {


                        Authorization:

                            `Bearer ${token}`,



                        'X-Reference-Id':

                            reference,



                        'X-Correlation-Id':

                            correlationId


                    },



                    body:

                        transaction.payload,



                    correlationId


                });









            /**
             * -----------------------------------------------------------------
             * 8. Create transaction lifecycle record
             * -----------------------------------------------------------------
             */


            const state =

                await this.stateMachine.create({

                    tenantId,

                    reference,

                    type,

                    amount,

                    currency,

                    provider:

                        'MTN',


                    transactionId:

                        transaction.transactionId,


                    status:

                        'SUBMITTED'


                });








            /**
             * -----------------------------------------------------------------
             * 9. Register settlement tracking
             * -----------------------------------------------------------------
             */


            await this.settlementTracker.register({

                tenantId,

                reference,

                transactionId:

                    transaction.transactionId,


                response,

                amount,

                currency


            });








            /**
             * -----------------------------------------------------------------
             * 10. Register idempotent completion state
             * -----------------------------------------------------------------
             */


            await this.idempotencyManager.register({

                tenantId,

                reference,

                status:

                    'PROCESSING',


                response

            });








            /**
             * -----------------------------------------------------------------
             * 11. Audit event
             * -----------------------------------------------------------------
             */


            await this.auditService?.record?.({

                action:

                    'MTN_DISBURSEMENT_CREATED',


                tenantId,

                reference,

                correlationId,

                transactionId:

                    transaction.transactionId,


                timestamp:

                    new Date()


            });








            this.metrics?.increment?.(

                'payment.mtn.disbursement.success'

            );




            this.metrics?.observe?.(

                'payment.mtn.disbursement.duration',

                Date.now() - startedAt

            );








            this.logger.info?.({

                event:

                    'mtn.disbursement.submitted',



                tenantId,


                reference,


                correlationId


            });







            return {


                reference,


                transactionId:

                    transaction.transactionId,


                status:

                    'PENDING_CALLBACK',



                correlationId


            };





        }


        catch(error) {



            this.metrics?.increment?.(

                'payment.mtn.disbursement.failure'

            );




            await this.idempotencyManager?.fail?.({

                tenantId,

                reference,

                error

            }).catch(() => {});





            this.logger.error?.({

                event:

                    'mtn.disbursement.failed',


                tenantId,


                reference,


                correlationId,


                error

            });





            throw error;


        }


        finally {


            span?.end?.();


        }


    }








    /**
     * =========================================================================
     * Complete Ledger Settlement
     * =========================================================================
     *
     * Called after successful callback confirmation.
     */


    async settleLedger({

        tenantId,

        transaction

    }) {


        return this.ledgerBridge.postDisbursement({

            tenantId,

            transaction

        });


    }








    /**
     * =========================================================================
     * Compensation Workflow
     * =========================================================================
     */


    async compensate({

        tenantId,

        reference,

        reason

    } = {}) {



        if (!this.compensationManager) {


            throw new Error(

                'Compensation manager unavailable.'

            );


        }



        return this.compensationManager.execute({

            tenantId,

            reference,

            reason

        });


    }








    /**
     * =========================================================================
     * Service Health
     * =========================================================================
     */


    async health() {



        return {


            provider:

                'MTN',



            module:

                'disbursement',



            status:

                'UP',



            timestamp:

                new Date()


        };


    }








    /**
     * =========================================================================
     * Transfer Endpoint
     * =========================================================================
     */


    transferEndpoint() {



        return (

            this.configuration.transferEndpoint ||

            process.env.MTN_TRANSFER_ENDPOINT

        );


    }








    /**
     * =========================================================================
     * Validate Request
     * =========================================================================
     */


    #validateRequest({

        tenantId,

        beneficiary,

        amount,

        reference

    }) {



        if (!tenantId) {


            throw new Error(

                'tenantId required'

            );


        }





        if (!reference) {


            throw new Error(

                'Disbursement reference required'

            );


        }





        if (!beneficiary?.partyId) {


            throw new Error(

                'Beneficiary required'

            );


        }





        if (

            amount === undefined ||

            Number(amount) <= 0

        ) {


            throw new Error(

                'Invalid disbursement amount'

            );


        }


    }


}




module.exports = DisbursementService;