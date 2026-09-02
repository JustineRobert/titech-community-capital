'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Callback Validator
 * =============================================================================
 *
 * Purpose
 * -------
 * Enterprise security validation boundary for Airtel Money callback events.
 *
 * This service executes BEFORE callback correlation and processing.
 * It ensures callback authenticity, integrity, freshness, normalization, and
 * compliance before entering the internal payment lifecycle.
 *
 * Responsibilities
 * ----------------
 * • Airtel callback payload schema validation
 * • Signature verification integration
 * • Replay attack prevention
 * • Timestamp validation
 * • Callback normalization
 * • Fraud signal extraction
 * • Provider error mapping
 * • Validation decisioning
 * • Metrics publication
 * • Audit trail creation
 * • Security event generation
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • Callback HTTP handling
 * • Payment state transitions
 * • Ledger posting
 * • Reconciliation
 * • Settlement execution
 * • OAuth authentication
 *
 *
 * Security Pipeline
 * -----------------
 *
 * Airtel Callback
 *        |
 *        v
 * Callback Validator
 *        |
 *        +--> Signature Check
 *        |
 *        +--> Replay Protection
 *        |
 *        +--> Schema Validation
 *        |
 *        +--> Fraud Signals
 *        |
 *        v
 * Callback Correlation
 *        |
 *        v
 * Callback Processor
 *
 * =============================================================================
 */


const crypto = require('crypto');


const {
    normalizeError,
    ValidationError,
    AuthenticationError
} = require('../../../shared/errors');



/**
 * =============================================================================
 * Constants
 * =============================================================================
 */


const PROVIDER = Object.freeze({

    NAME: 'AIRTEL',

    MODULE: 'callback-validator'

});



const VALIDATION_STATUS = Object.freeze({

    VALID:
        'VALID',

    INVALID:
        'INVALID',

    REPLAY:
        'REPLAY',

    UNAUTHORIZED:
        'UNAUTHORIZED',

    REVIEW:
        'REVIEW'

});



const FRAUD_SIGNAL = Object.freeze({

    DUPLICATE:
        'DUPLICATE_CALLBACK',

    OLD_TIMESTAMP:
        'STALE_TIMESTAMP',

    INVALID_SIGNATURE:
        'INVALID_SIGNATURE',

    LARGE_AMOUNT:
        'HIGH_VALUE_TRANSACTION',

    UNKNOWN_REFERENCE:
        'UNKNOWN_REFERENCE'

});



const DEFAULTS = Object.freeze({

    maxCallbackAgeSeconds:
        300,

    maxAmountThreshold:
        10000000

});





/**
 * =============================================================================
 * Callback Validator
 * =============================================================================
 */


class CallbackValidator {



    constructor({

        signatureVerifier,

        replayProtection,

        schemaValidator,

        fraudEngine,

        providerErrorMapper,

        auditService,

        eventBus,

        metrics,

        tracer,

        logger,

        configuration

    } = {}) {



        this.signatureVerifier =
            signatureVerifier;



        this.replayProtection =
            replayProtection;



        this.schemaValidator =
            schemaValidator;



        this.fraudEngine =
            fraudEngine;



        this.providerErrorMapper =
            providerErrorMapper;



        this.auditService =
            auditService;



        this.eventBus =
            eventBus;



        this.metrics =
            metrics;



        this.tracer =
            tracer;



        this.logger =
            logger;



        this.configuration =
            configuration;




        this.statistics = {


            received:
                0,


            validated:
                0,


            rejected:
                0,


            replayBlocked:
                0,


            signatureFailures:
                0,


            fraudReviews:
                0

        };



        this.startedAt =
            new Date();



    }






    /**
     * =========================================================================
     * Validate Callback
     * =========================================================================
     */


    async validate({

        tenantId,

        payload,

        headers = {},

        correlationId =
            crypto.randomUUID()

    }) {



        const span =
            this.tracer?.startSpan?.(

                'airtel.callback.validation'

            );



        try {



            this.statistics.received++;



            this.validateInput(payload);




            /**
             * -------------------------------------------------------------
             * Timestamp validation
             * -------------------------------------------------------------
             */


            this.validateTimestamp(payload);




            /**
             * -------------------------------------------------------------
             * Signature verification
             * -------------------------------------------------------------
             */


            await this.verifySignature({

                payload,

                headers,

                correlationId

            });





            /**
             * -------------------------------------------------------------
             * Replay protection
             * -------------------------------------------------------------
             */


            await this.checkReplay({

                payload,

                correlationId

            });






            /**
             * -------------------------------------------------------------
             * Schema validation
             * -------------------------------------------------------------
             */


            await this.validateSchema(payload);






            /**
             * -------------------------------------------------------------
             * Normalize callback
             * -------------------------------------------------------------
             */


            const normalized =

                this.normalize(payload);







            /**
             * -------------------------------------------------------------
             * Fraud intelligence
             * -------------------------------------------------------------
             */


            const fraud =

                await this.detectFraud({

                    tenantId,

                    callback:

                        normalized

                });






            if (

                fraud.requiresReview

            ) {



                this.statistics.fraudReviews++;



                return {

                    status:

                        VALIDATION_STATUS.REVIEW,


                    callback:

                        normalized,


                    fraud,


                    correlationId

                };

            }






            await this.recordAudit({

                tenantId,

                callback:

                    normalized,

                correlationId,

                status:

                    VALIDATION_STATUS.VALID

            });






            this.statistics.validated++;




            return {


                status:

                    VALIDATION_STATUS.VALID,


                callback:

                    normalized,


                fraud,


                correlationId



            };



        }



        catch(error) {



            this.statistics.rejected++;




            await this.handleValidationFailure({

                tenantId,

                payload,

                correlationId,

                error

            });




            throw normalizeError(error);



        }



        finally {


            span?.end?.();


        }



    }







    /**
     * =========================================================================
     * Input Validation
     * =========================================================================
     */


    validateInput(payload) {



        if (!payload) {


            throw new ValidationError(

                'Airtel callback payload required'

            );


        }



        if (

            typeof payload !== 'object'

        ) {


            throw new ValidationError(

                'Invalid callback format'

            );


        }



        return true;


    }







    /**
     * =========================================================================
     * Timestamp Protection
     * =========================================================================
     */


    validateTimestamp(payload) {



        const timestamp =

            payload.timestamp ||

            payload.createdAt;



        if (!timestamp) {


            return true;


        }



        const age =

            Date.now() -

            new Date(timestamp).getTime();




        if (

            age >

            DEFAULTS.maxCallbackAgeSeconds *

            1000

        ) {



            throw new ValidationError(

                'Callback timestamp expired'

            );


        }



        return true;


    }








    /**
     * =========================================================================
     * Signature Verification
     * =========================================================================
     */


    async verifySignature({

        payload,

        headers,

        correlationId

    }) {



        if (

            !this.signatureVerifier

        ) {



            return true;


        }




        const valid =

            await this.signatureVerifier.verify({

                payload,

                headers

            });





        if (!valid) {



            this.statistics.signatureFailures++;



            this.metrics?.counter?.(

                'airtel_callback_signature_failure_total'

            );



            throw new AuthenticationError(

                'Invalid Airtel callback signature'

            );


        }




        return true;


    }








    /**
     * =========================================================================
     * Replay Protection
     * =========================================================================
     */


    async checkReplay({

        payload,

        correlationId

    }) {



        if (

            !this.replayProtection

        ) {


            return;


        }




        const key =

            `airtel:callback:${

                payload.transactionId ||

                payload.reference

            }`;




        const replay =

            await this.replayProtection.exists(key);





        if (replay) {



            this.statistics.replayBlocked++;



            throw new ValidationError(

                'Duplicate callback detected'

            );


        }





        await this.replayProtection.store(

            key,

            DEFAULTS.maxCallbackAgeSeconds

        );



    }







    /**
     * =========================================================================
     * Schema Validation
     * =========================================================================
     */


    async validateSchema(payload) {



        if (

            !this.schemaValidator

        ) {


            return true;


        }



        const valid =

            await this.schemaValidator.validate({

                provider:

                    PROVIDER.NAME,

                payload

            });




        if (!valid) {


            throw new ValidationError(

                'Invalid Airtel callback schema'

            );


        }



        return true;


    }







    /**
     * =========================================================================
     * Callback Normalization
     * =========================================================================
     */


    normalize(payload) {



        return {


            provider:

                PROVIDER.NAME,



            transactionId:

                payload.transactionId ||

                payload.id,



            reference:

                payload.reference || null,



            status:

                payload.status || 'UNKNOWN',



            amount:

                Number(

                    payload.amount || 0

                ),



            currency:

                payload.currency || 'UGX',



            customer:

                payload.customer || null,



            receivedAt:

                new Date(),



            raw:

                payload



        };


    }








    /**
     * =========================================================================
     * Fraud Detection
     * =========================================================================
     */


    async detectFraud({

        tenantId,

        callback

    }) {



        const signals = [];




        if (

            callback.amount >

            DEFAULTS.maxAmountThreshold

        ) {



            signals.push(

                FRAUD_SIGNAL.LARGE_AMOUNT

            );


        }




        const result =

            await this.fraudEngine?.evaluate?.({

                tenantId,

                callback

            });




        return {


            signals:

                [

                    ...signals,

                    ...(result?.signals || [])

                ],



            score:

                result?.score || 0,



            requiresReview:

                Boolean(

                    result?.requiresReview

                )



        };


    }








    /**
     * =========================================================================
     * Provider Error Mapping
     * =========================================================================
     */


    mapProviderError(error) {



        return this.providerErrorMapper

            ?.map?.(error)

            ||

            {


                code:

                    'AIRTEL_CALLBACK_ERROR',


                message:

                    error.message


            };


    }







    /**
     * =========================================================================
     * Audit
     * =========================================================================
     */


    async recordAudit({

        tenantId,

        callback,

        correlationId,

        status

    }) {



        await this.auditService?.record?.({

            action:

                'AIRTEL_CALLBACK_VALIDATED',



            tenantId,



            correlationId,



            metadata:

                {

                    status,

                    transactionId:

                        callback.transactionId

                }



        });


    }








    /**
     * =========================================================================
     * Failure Handling
     * =========================================================================
     */


    async handleValidationFailure({

        tenantId,

        payload,

        correlationId,

        error

    }) {



        this.logger?.error?.({

            message:

                'Airtel callback validation failed',


            tenantId,


            correlationId,


            error:

                error.message


        });



        await this.auditService?.record?.({

            action:

                'AIRTEL_CALLBACK_VALIDATION_FAILED',


            tenantId,


            correlationId,


            metadata:

                {

                    error:

                        error.message

                }


        });


    }








    /**
     * =========================================================================
     * Health
     * =========================================================================
     */


    health() {


        return {


            provider:

                PROVIDER.NAME,


            status:

                'UP',



            statistics:

                this.statistics,



            uptimeMs:

                Date.now() -

                this.startedAt.getTime()



        };


    }




}



module.exports = CallbackValidator;