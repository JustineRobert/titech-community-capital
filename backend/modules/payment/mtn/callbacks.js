'use strict';

/**
 * ==========================================================
 * TITech Community Capital LTD
 * MTN MoMo Callback Gateway
 * ----------------------------------------------------------
 *
 * Enterprise callback orchestration layer.
 *
 * Responsibilities
 * ----------------
 * • Receive MTN callback payloads
 * • Validate callback structure
 * • Verify provider signatures
 * • Prevent duplicate processing
 * • Correlate transactions
 * • Delegate processing pipeline
 * • Handle failures safely
 * • Publish callback events
 * • Maintain observability
 *
 * Delegates
 * ----------
 * callbackProcessor
 * callbackValidator
 * signatureVerifier
 * deadLetterQueue
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • Direct ledger manipulation
 * • Payment state rules
 * • Reconciliation logic
 * • Provider HTTP communication
 *
 * ==========================================================
 */

const crypto = require('crypto');

const {
    normalizeError
} = require('../shared/errors');


class MTNCallbacks {


    constructor({

        callbackProcessor,

        callbackValidator,

        signatureVerifier,

        deadLetterQueue,

        eventPublisher,

        auditService,

        logger,

        metrics,

        tracer

    } = {}) {


        this.callbackProcessor =
            callbackProcessor;


        this.callbackValidator =
            callbackValidator;


        this.signatureVerifier =
            signatureVerifier;


        this.deadLetterQueue =
            deadLetterQueue;


        this.eventPublisher =
            eventPublisher;


        this.auditService =
            auditService;


        this.logger =
            logger;


        this.metrics =
            metrics;


        this.tracer =
            tracer;



        this.statistics = {

            received: 0,

            successful: 0,

            failed: 0,

            rejected: 0

        };

    }



    /**
     * ------------------------------------------------------
     * Handle MTN callback
     * ------------------------------------------------------
     */
    async handle({

        headers = {},

        payload,

        tenantId = null,

        correlationId =
            crypto.randomUUID()

    }) {


        const span =

            this.tracer?.startSpan?.(

                'payment.mtn.callback.handle'

            );


        this.statistics.received++;


        this.metrics?.counter?.(

            'payment_mtn_callback_received_total'

        );



        try {


            this.logger?.info?.({

                message:

                    'Processing MTN callback',


                tenantId,


                correlationId

            });



            /**
             * 1. Validate payload
             */
            this.callbackValidator.validate(

                payload

            );



            /**
             * 2. Verify signature
             */
            const signature =

                headers['x-mtn-signature']

                ||

                headers['X-MTN-Signature'];



            const verified =

                this.signatureVerifier.verify({

                    payload,

                    signature

                });



            if (!verified) {


                this.statistics.rejected++;


                this.metrics?.counter?.(

                    'payment_mtn_callback_signature_failure_total'

                );


                throw new Error(

                    'Invalid MTN callback signature'

                );

            }



            /**
             * 3. Execute callback pipeline
             */
            const result =

                await this.callbackProcessor.process({

                    headers,

                    payload,

                    tenantId,

                    correlationId

                });



            /**
             * 4. Publish event
             */
            await this.eventPublisher?.publish({

                type:

                    'MTN_CALLBACK_PROCESSED',


                payload: {

                    transactionId:

                        payload.externalId,


                    tenantId,


                    correlationId

                }

            });



            /**
             * 5. Audit
             */
            await this.auditService?.record({

                action:

                    'MTN_CALLBACK_RECEIVED',


                provider:

                    'MTN',


                tenantId,


                correlationId,


                transaction:

                    payload.externalId

            });



            this.statistics.successful++;


            this.metrics?.counter?.(

                'payment_mtn_callback_success_total'

            );



            return {


                success: true,


                correlationId,


                transactionId:

                    result.id

            };


        }


        catch(error) {


            this.statistics.failed++;


            this.metrics?.counter?.(

                'payment_mtn_callback_failure_total'

            );



            const normalized =

                normalizeError(error, {

                    provider: 'MTN',

                    tenantId,

                    correlationId

                });



            this.logger?.error?.({

                message:

                    'MTN callback processing failed',


                tenantId,


                correlationId,


                error:

                    normalized.toJSON?.()

                    ||

                    normalized

            });



            /**
             * Persist failed callbacks
             */
            await this.deadLetterQueue?.store({

                payload,

                error:

                    normalized.message,


                metadata: {

                    tenantId,

                    correlationId

                }

            });



            throw normalized;


        }


        finally {


            span?.end?.();

        }


    }




    /**
     * ------------------------------------------------------
     * Express middleware adapter
     * ------------------------------------------------------
     */
    middleware() {


        return async (req, res) => {


            const correlationId =

                req.id

                ||

                crypto.randomUUID();



            try {


                const result =

                    await this.handle({

                        headers:

                            req.headers,


                        payload:

                            req.body,


                        tenantId:

                            req.tenantId,


                        correlationId

                    });



                return res.status(200).json(result);



            }


            catch(error) {


                return res.status(

                    error.httpStatus || 500

                )
                .json({

                    success: false,


                    error: {

                        code:

                            error.code

                            ||

                            'PAYMENT_CALLBACK_ERROR',


                        message:

                            error.message

                    }

                });

            }


        };

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

                'callbacks',


            status:

                'UP',


            statistics:

                {

                    ...this.statistics

                }

        };

    }



}


module.exports = MTNCallbacks;