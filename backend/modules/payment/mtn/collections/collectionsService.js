'use strict';

/**
 * ==========================================================
 * TITech Community Capital LTD
 * MTN MoMo Enterprise Collections Service
 * ----------------------------------------------------------
 * Purpose
 * -------
 * Enterprise Request-To-Pay orchestration layer for MTN MoMo.
 *
 * Responsibilities
 * ----------------
 * • Request-To-Pay initiation
 * • Transaction lifecycle management
 * • Authentication integration
 * • Idempotency enforcement
 * • Fraud validation hooks
 * • Callback correlation
 * • Payment state management
 * • Ledger integration hooks
 * • Audit integration
 * • Metrics and tracing
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • Token management
 * • OAuth authentication
 * • Direct ledger writes
 * • Balance updates
 * • Settlement processing
 *
 * ==========================================================
 */

const crypto = require('crypto');

const {
    normalizeError,
    AuthenticationError
} = require('../../../shared/errors');


class CollectionsService {


    constructor({

        authService,

        httpClient,

        transactionBuilder,

        stateMachine,

        idempotencyManager,

        fraudGuard,

        ledgerBridge,

        callbackCorrelation,

        logger,

        metrics,

        tracer,

        auditService

    } = {}) {


        this.authService = authService;

        this.httpClient = httpClient;

        this.transactionBuilder =
            transactionBuilder;

        this.stateMachine =
            stateMachine;

        this.idempotencyManager =
            idempotencyManager;

        this.fraudGuard =
            fraudGuard;

        this.ledgerBridge =
            ledgerBridge;

        this.callbackCorrelation =
            callbackCorrelation;

        this.logger = logger;

        this.metrics = metrics;

        this.tracer = tracer;

        this.auditService = auditService;


    }


    /**
     * ------------------------------------------------------
     * Initialize
     * ------------------------------------------------------
     */
    async initialize() {


        this.logger?.info?.({

            message:
                'MTN Collections initialized'

        });


        return true;

    }



    /**
     * ------------------------------------------------------
     * Request-To-Pay
     * ------------------------------------------------------
     */
    async requestPayment({

        tenantId,

        payer,

        amount,

        currency = 'UGX',

        externalId,

        metadata = {}

    }) {


        const correlationId =
            crypto.randomUUID();


        const span =
            this.tracer?.startSpan?.(
                'mtn.collections.requestPayment'
            );


        try {


            /**
             * 1. Validate request
             */
            await this.validate({

                tenantId,

                payer,

                amount

            });



            /**
             * 2. Idempotency protection
             */
            await this.idempotencyManager.check({

                tenantId,

                externalId

            });



            /**
             * 3. Fraud checks
             */
            await this.fraudGuard.inspect({

                tenantId,

                payer,

                amount,

                metadata

            });



            /**
             * 4. Obtain OAuth token
             */
            const token =

                await this.authService
                    .getAccessToken({

                        tenantId,

                        correlationId

                    });



            /**
             * 5. Build MTN request
             */
            const payload =

                this.transactionBuilder.build({

                    externalId,

                    payer,

                    amount,

                    currency,

                    callbackUrl:

                        this.callbackCorrelation
                            .callbackUrl({

                                tenantId

                            })

                });



            /**
             * 6. Send request
             */
            const response =

                await this.httpClient.request({

                    method: 'POST',

                    url:

                    `${this.getEndpoint()}/requesttopay`,

                    headers: {


                        Authorization:

                            `Bearer ${token}`,


                        'X-Reference-Id':

                            externalId,


                        'Ocp-Apim-Subscription-Key':

                            this.getSubscriptionKey(
                                tenantId
                            )


                    },


                    body: payload,


                    correlationId

                });



            /**
             * 7. Register transaction
             */
            await this.stateMachine.create({

                tenantId,

                externalId,

                status:
                    'PENDING',

                response

            });



            /**
             * 8. Audit
             */
            await this.auditService?.record({

                action:
                    'MTN_COLLECTION_REQUESTED',

                tenantId,

                externalId,

                correlationId

            });



            this.metrics?.counter?.(

                'payment_mtn_collection_requests_total'

            );



            return {


                transactionId:
                    externalId,


                status:
                    'PENDING',


                correlationId


            };


        }


        catch(error) {


            this.metrics?.counter?.(

                'payment_mtn_collection_failures_total'

            );


            this.logger?.error?.({

                message:
                    'MTN collection request failed',

                error:
                    error.toJSON?.() || error

            });



            throw normalizeError(error);


        }


        finally {


            span?.end?.();

        }

    }




    /**
     * ------------------------------------------------------
     * Transaction status query
     * ------------------------------------------------------
     */
    async getStatus({

        tenantId,

        transactionId

    }) {


        const token =

            await this.authService
                .getAccessToken({

                    tenantId

                });



        return this.httpClient.request({

            method:'GET',

            url:

            `${this.getEndpoint()}/requesttopay/${transactionId}`,


            headers:{


                Authorization:

                    `Bearer ${token}`


            }

        });


    }



    /**
     * ------------------------------------------------------
     * Cancel request
     * ------------------------------------------------------
     */
    async cancelPayment({

        tenantId,

        transactionId

    }) {


        const token =

            await this.authService
                .getAccessToken({

                    tenantId

                });



        return this.httpClient.request({

            method:'DELETE',

            url:

            `${this.getEndpoint()}/requesttopay/${transactionId}`,


            headers:{

                Authorization:

                    `Bearer ${token}`

            }

        });

    }



    /**
     * ------------------------------------------------------
     * Validation
     * ------------------------------------------------------
     */
    async validate({

        tenantId,

        payer,

        amount

    }) {


        if (!tenantId)

            throw new AuthenticationError(
                'Tenant required'
            );


        if (!payer)

            throw new Error(
                'Payer required'
            );


        if (!amount || amount <= 0)

            throw new Error(
                'Invalid payment amount'
            );


        return true;

    }



    /**
     * ------------------------------------------------------
     * Health
     * ------------------------------------------------------
     */
    async health() {


        return {

            provider:
                'MTN',

            module:
                'collections',

            status:
                'UP'

        };

    }



    getEndpoint() {

        return this.configuration
            ?.getEndpoints()
            ?.collection;

    }



    getSubscriptionKey() {

        return process.env
            .MTN_SUBSCRIPTION_KEY;

    }


}


module.exports = CollectionsService;