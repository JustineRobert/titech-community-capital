'use strict';

/**
 * ==========================================================
 * TITech Community Capital LTD
 * Enterprise Payment Orchestration Engine
 * ----------------------------------------------------------
 * Purpose
 * -------
 * Central orchestration layer for all payment workflows.
 *
 * Coordinates:
 *
 * • Provider routing
 * • Payment execution
 * • Retry orchestration
 * • Idempotency protection
 * • Payment lifecycle management
 * • Ledger integration hooks
 * • Audit logging
 * • Domain event publishing
 * • Observability hooks
 * • Tenant isolation
 *
 *
 * Supported Operations
 * --------------------
 *
 * • Collections
 * • Disbursements
 * • Transfers
 * • Refunds
 * • Settlements
 *
 *
 * Architecture
 * ------------
 *
 * Request
 *    |
 *    ↓
 * Payment Engine
 *    |
 *    ├── Idempotency Engine
 *    |
 *    ├── Provider Router
 *    |
 *    ├── Retry Manager
 *    |
 *    ├── Payment Provider Adapter
 *    |
 *    ├── Ledger Engine
 *    |
 *    ├── Audit Service
 *    |
 *    └── Event Bus
 *
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 *
 * • Provider API communication
 * • Authentication
 * • Business-specific validation
 * • Ledger accounting rules
 *
 * ==========================================================
 */


const crypto = require('crypto');

const PaymentContext =
    require('../context/paymentContext');


const {
    normalizeError
} = require('../shared/errors');



class PaymentEngine {


    constructor({

        providerRouter,

        retryManager,

        idempotencyEngine,

        ledgerEngine,

        auditService,

        eventBus,

        logger,

        metrics,

        tracer,

        fraudEngine = null,

        validationEngine = null

    } = {}) {


        this.providerRouter =
            providerRouter;


        this.retryManager =
            retryManager;


        this.idempotencyEngine =
            idempotencyEngine;


        this.ledgerEngine =
            ledgerEngine;


        this.auditService =
            auditService;


        this.eventBus =
            eventBus;


        this.logger =
            logger;


        this.metrics =
            metrics;


        this.tracer =
            tracer;


        this.fraudEngine =
            fraudEngine;


        this.validationEngine =
            validationEngine;

    }




    /**
     * ------------------------------------------------------
     * Initiate Payment
     * ------------------------------------------------------
     */
    async initiate({

        provider,

        type,

        amount,

        customer,

        tenantId,

        idempotencyKey,

        metadata = {}

    }) {


        const correlationId =
            crypto.randomUUID();



        const span =
            this.tracer?.startSpan?.(
                'payment.engine.initiate'
            );



        try {


            /**
             * Validate request
             */
            await this.validationEngine?.validate?.({

                tenantId,

                provider,

                type,

                amount,

                customer

            });





            /**
             * Idempotency protection
             */
            const existing =

                await this.idempotencyEngine.check({

                    key:
                        idempotencyKey,

                    tenantId

                });



            if (

                existing.exists

            ) {


                this.logger?.info?.({

                    message:

                        'Returning existing payment response',

                    tenantId,

                    idempotencyKey,

                    correlationId

                });


                return existing.response;

            }





            /**
             * Create payment execution context
             */
            const context =

                new PaymentContext({


                    tenantId,


                    provider,


                    operation:

                        type,


                    idempotencyKey,


                    correlationId


                });






            /**
             * Fraud screening
             */
            await this.fraudEngine?.inspect?.({

                tenantId,

                amount,

                customer,

                provider,

                type,

                context

            });






            /**
             * Resolve provider adapter
             */
            const adapter =

                this.providerRouter.resolve(

                    provider

                );






            /**
             * Execute provider operation
             */
            const response =

                await this.retryManager.execute(

                    async () => {


                        return adapter[type]( {


                            amount,


                            customer,


                            metadata,


                            context


                        });


                    }

                );







            /**
             * Ledger integration hook
             *
             * Actual posting happens only
             * when provider confirms settlement.
             */
            await this.ledgerEngine
                ?.prepare?.({

                    tenantId,

                    payment:

                        response,

                    context

                });







            /**
             * Store idempotent response
             */
            await this.idempotencyEngine.store({

                key:

                    idempotencyKey,


                tenantId,


                response,


                metadata: {

                    provider,

                    type,

                    correlationId

                }

            });








            /**
             * Audit trail
             */
            await this.auditService
                ?.record({

                    action:

                        'PAYMENT_INITIATED',


                    entity:

                        response,


                    context


                });








            /**
             * Publish domain event
             */
            await this.eventBus
                ?.publish({

                    type:

                        'PaymentInitiated',


                    payload:

                        response,


                    context


                });







            this.metrics?.counter?.(

                'payment_initiated_total'

            );





            return {


                ...response,


                correlationId


            };



        }



        catch(error) {


            this.metrics?.counter?.(

                'payment_initiation_failed_total'

            );



            this.logger?.error?.({

                message:

                    'Payment initiation failed',


                tenantId,


                provider,


                type,


                correlationId,


                error:

                    error.toJSON?.() ||

                    error


            });



            throw normalizeError(

                error,

                {

                    tenantId,

                    correlationId,

                    provider

                }

            );


        }



        finally {


            span?.end?.();


        }


    }






    /**
     * ------------------------------------------------------
     * Query payment health
     * ------------------------------------------------------
     */
    async health() {


        return {


            status:

                'UP',


            module:

                'payment-engine',


            providerRouter:

                !!this.providerRouter,


            timestamp:

                new Date()


        };

    }






}



module.exports =
    PaymentEngine;