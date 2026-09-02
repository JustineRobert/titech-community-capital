'use strict';

/**
 * ==========================================================
 * TITech Community Capital LTD
 * MTN MoMo Enterprise Collections Gateway
 * ----------------------------------------------------------
 *
 * Production payment collection orchestration engine.
 *
 * Supports:
 *
 * • Savings contributions
 * • Loan repayments
 * • Member deposits
 * • Group collections
 * • Subscription payments
 *
 *
 * Responsibilities
 * ----------------
 *
 * • Collection orchestration
 * • Request-To-Pay generation
 * • Provider execution
 * • Idempotency protection
 * • Fraud controls
 * • Transaction lifecycle management
 * • Callback correlation
 * • Settlement tracking
 * • Ledger integration
 * • Audit logging
 * • Metrics/tracing
 *
 *
 * Does NOT:
 *
 * • Store tokens
 * • Handle OAuth directly
 * • Manipulate balances
 * • Process callbacks directly
 *
 * ==========================================================
 */


const crypto = require('crypto');


const {
    normalizeError
} = require('../shared/errors');



class MTNCollections {


    constructor({

        authService,

        httpClient,

        configuration,

        transactionBuilder,

        idempotencyManager,

        fraudGuard,

        stateMachine,

        ledgerBridge,

        settlementTracker,

        callbackCorrelation,

        auditService,

        eventPublisher,

        logger,

        metrics,

        tracer

    } = {}) {


        this.authService =
            authService;


        this.httpClient =
            httpClient;


        this.configuration =
            configuration;


        this.transactionBuilder =
            transactionBuilder;


        this.idempotencyManager =
            idempotencyManager;


        this.fraudGuard =
            fraudGuard;


        this.stateMachine =
            stateMachine;


        this.ledgerBridge =
            ledgerBridge;


        this.settlementTracker =
            settlementTracker;


        this.callbackCorrelation =
            callbackCorrelation;


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


            failed: 0


        };

    }



    /**
     * ------------------------------------------------------
     * Initiate Collection
     * ------------------------------------------------------
     */
    async collect({


        tenantId,


        payer,


        amount,


        currency = 'UGX',


        reference,


        type = 'SAVINGS_CONTRIBUTION',


        requestedBy,


        metadata = {}


    }) {



        const correlationId =

            crypto.randomUUID();



        const span =

            this.tracer?.startSpan?.(

                'payment.mtn.collection'

            );



        this.statistics.initiated++;



        try {



            /**
             * 1. Idempotency protection
             */
            await this.idempotencyManager.check({

                tenantId,

                externalId:

                    reference

            });



            /**
             * 2. Fraud screening
             */
            await this.fraudGuard.inspect({

                tenantId,

                payer,

                amount,

                type

            });



            /**
             * 3. Build MTN payload
             */
            const callbackUrl =

                this.callbackCorrelation.callbackUrl({

                    tenantId

                });



            const payload =

                this.transactionBuilder.build({

                    externalId:

                        reference,


                    payer,


                    amount,


                    currency,


                    callbackUrl,


                    metadata

                });



            /**
             * 4. Authenticate
             */
            const token =

                await this.authService.getAccessToken({

                    tenantId,

                    correlationId

                });



            /**
             * 5. Create internal transaction
             */
            const transaction =

                await this.stateMachine.create({

                    tenantId,


                    reference,


                    externalId:

                        reference,


                    type,


                    amount,


                    currency,


                    requestedBy

                });



            /**
             * 6. Submit MTN request
             */
            const response =

                await this.httpClient.request({

                    method: 'POST',


                    url:

                        this.collectionEndpoint(),



                    headers: {


                        Authorization:

                            `Bearer ${token}`,


                        'X-Reference-Id':

                            reference,


                        'X-Target-Environment':

                            this.configuration
                                .get()
                                .environment


                    },


                    body:

                        payload,


                    correlationId

                });



            /**
             * 7. Transition state
             */
            await this.stateMachine.transition({

                id:

                    transaction.id,


                nextStatus:

                    'PENDING_CALLBACK'

            });



            /**
             * 8. Register settlement tracking
             */
            await this.settlementTracker.register({

                tenantId,


                reference,


                response

            });



            /**
             * 9. Register idempotency key
             */
            await this.idempotencyManager.register({

                tenantId,


                externalId:

                    reference,


                response

            });



            /**
             * 10. Audit
             */
            await this.auditService?.record({

                action:

                    'MTN_COLLECTION_INITIATED',


                tenantId,


                reference,


                correlationId

            });



            /**
             * 11. Event
             */
            await this.eventPublisher?.publish({

                type:

                    'MTN_COLLECTION_CREATED',


                payload: {

                    tenantId,

                    reference,

                    amount,

                    correlationId

                }

            });



            this.statistics.successful++;



            this.metrics?.counter?.(

                'payment_mtn_collection_success_total'

            );



            return {


                reference,


                status:

                    'PENDING_CALLBACK',


                correlationId,


                transactionId:

                    transaction.id

            };



        }



        catch(error) {


            this.statistics.failed++;



            this.metrics?.counter?.(

                'payment_mtn_collection_failure_total'

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

                    'MTN collection failed',


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
     * Query Collection
     * ------------------------------------------------------
     */
    async query(reference) {


        return this.callbackCorrelation.correlate({

            externalId:

                reference

        });

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

                'collections',


            status:

                'UP',


            statistics:

                {

                    ...this.statistics

                }


        };

    }




    /**
     * ------------------------------------------------------
     * MTN Collection Endpoint
     * ------------------------------------------------------
     */
    collectionEndpoint() {


        return (

            this.configuration

                .getEndpoints()

                .collection

            +

            '/requesttopay'

        );

    }


}



module.exports = MTNCollections;