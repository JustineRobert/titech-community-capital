'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Callback Signature Verifier
 * =============================================================================
 *
 * Purpose
 * -------
 * Enterprise cryptographic verification boundary for Airtel Money callbacks.
 *
 * This component validates that callback payloads originated from Airtel and
 * have not been modified during transport.
 *
 * Responsibilities
 * ----------------
 * • Airtel signature algorithm handling
 * • HMAC signature verification
 * • Secret rotation support
 * • Multi-tenant secret resolution
 * • Timestamp binding
 * • Constant-time signature comparison
 * • Replay protection support
 * • Security audit events
 * • Signature failure intelligence
 * • Cryptographic metrics
 * • Provider security diagnostics
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • Callback parsing
 * • Payment processing
 * • Token authentication
 * • OAuth communication
 * • Ledger operations
 *
 *
 * Security Flow
 * -------------
 *
 * Airtel Callback
 *        |
 *        v
 * Signature Extractor
 *        |
 *        v
 * Canonical Payload Builder
 *        |
 *        v
 * HMAC Generator
 *        |
 *        v
 * Constant Time Compare
 *        |
 *        v
 * Security Decision
 *
 * =============================================================================
 */


const crypto = require('crypto');


const {
    AuthenticationError,
    ValidationError
} = require('../../../shared/errors');





/**
 * =============================================================================
 * Constants
 * =============================================================================
 */


const PROVIDER = Object.freeze({

    NAME:
        'AIRTEL',

    COMPONENT:
        'signature-verifier'

});



const ALGORITHMS = Object.freeze({

    HMAC_SHA256:
        'sha256',

    HMAC_SHA512:
        'sha512'

});



const SIGNATURE_STATUS = Object.freeze({

    VALID:
        'VALID',

    INVALID:
        'INVALID',

    MISSING:
        'MISSING',

    EXPIRED:
        'EXPIRED'

});



const DEFAULTS = Object.freeze({

    algorithm:
        ALGORITHMS.HMAC_SHA256,


    timestampToleranceSeconds:
        300

});







/**
 * =============================================================================
 * Signature Verifier
 * =============================================================================
 */


class SignatureVerifier {



    constructor({

        secretProvider,

        configuration,

        auditService,

        eventBus,

        metrics,

        tracer,

        logger,

        algorithm =
            DEFAULTS.algorithm,

        timestampToleranceSeconds =
            DEFAULTS.timestampToleranceSeconds

    } = {}) {



        this.secretProvider =
            secretProvider;



        this.configuration =
            configuration;



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



        this.algorithm =
            algorithm;



        this.timestampToleranceSeconds =
            timestampToleranceSeconds;



        this.statistics = {


            verified:
                0,


            failed:
                0,


            missing:
                0,


            expired:
                0,


            rotatedSecrets:
                0



        };



        this.startedAt =
            new Date();


    }








    /**
     * =========================================================================
     * Verify Signature
     * =========================================================================
     */


    async verify({

        tenantId,

        payload,

        headers = {},

        correlationId =
            crypto.randomUUID()

    }) {



        const span =
            this.tracer?.startSpan?.(

                'airtel.signature.verify'

            );



        try {



            const signature =

                this.extractSignature(headers);



            if (!signature) {


                this.statistics.missing++;



                throw new AuthenticationError(

                    'Missing Airtel callback signature'

                );


            }




            const timestamp =

                this.extractTimestamp({

                    payload,

                    headers

                });





            this.validateTimestamp(timestamp);






            const secret =

                await this.resolveSecret({

                    tenantId

                });





            const canonicalPayload =

                this.buildCanonicalPayload({

                    payload,

                    timestamp

                });





            const expectedSignature =

                this.generateSignature({

                    payload:

                        canonicalPayload,

                    secret

                });





            const valid =

                this.safeCompare(

                    expectedSignature,

                    signature

                );





            if (!valid) {



                this.statistics.failed++;



                await this.recordSecurityFailure({

                    tenantId,

                    correlationId,

                    reason:

                        'INVALID_SIGNATURE'

                });



                throw new AuthenticationError(

                    'Invalid Airtel callback signature'

                );


            }






            this.statistics.verified++;



            this.metrics?.counter?.(

                'airtel_callback_signature_success_total'

            );





            await this.recordAudit({

                tenantId,

                correlationId,

                status:

                    SIGNATURE_STATUS.VALID

            });





            return true;



        }



        catch(error) {



            this.metrics?.counter?.(

                'airtel_callback_signature_failure_total'

            );



            throw error;



        }



        finally {


            span?.end?.();


        }



    }










    /**
     * =========================================================================
     * Signature Generation
     * =========================================================================
     */


    generateSignature({

        payload,

        secret

    }) {



        return crypto

            .createHmac(

                this.algorithm,

                secret

            )

            .update(payload)

            .digest('hex');


    }








    /**
     * =========================================================================
     * Constant Time Comparison
     * =========================================================================
     */


    safeCompare(

        expected,

        received

    ) {



        try {



            const expectedBuffer =

                Buffer.from(

                    expected,

                    'utf8'

                );



            const receivedBuffer =

                Buffer.from(

                    received,

                    'utf8'

                );





            if (

                expectedBuffer.length !==

                receivedBuffer.length

            ) {


                return false;


            }



            return crypto.timingSafeEqual(

                expectedBuffer,

                receivedBuffer

            );



        }

        catch(error) {



            return false;


        }



    }









    /**
     * =========================================================================
     * Secret Resolution
     * =========================================================================
     */


    async resolveSecret({

        tenantId

    }) {



        if (

            this.secretProvider?.getSecret

        ) {



            return this.secretProvider.getSecret({

                provider:

                    PROVIDER.NAME,

                tenantId

            });


        }




        if (

            this.configuration?.airtelSignatureSecret

        ) {


            return this.configuration.airtelSignatureSecret;


        }





        if (

            process.env.AIRTEL_SIGNATURE_SECRET

        ) {


            return process.env.AIRTEL_SIGNATURE_SECRET;


        }





        throw new ValidationError(

            'Airtel signature secret unavailable'

        );


    }









    /**
     * =========================================================================
     * Secret Rotation Support
     * =========================================================================
     */


    async verifyWithRotation({

        tenantId,

        payload,

        headers

    }) {



        const secrets =

            await this.secretProvider?.getSecrets?.({

                provider:

                    PROVIDER.NAME,

                tenantId

            });



        if (!Array.isArray(secrets)) {


            return this.verify({

                tenantId,

                payload,

                headers

            });


        }





        for (const secret of secrets) {



            const signature =

                this.extractSignature(headers);



            const timestamp =

                this.extractTimestamp({

                    payload,

                    headers

                });



            const canonical =

                this.buildCanonicalPayload({

                    payload,

                    timestamp

                });





            const expected =

                crypto

                    .createHmac(

                        this.algorithm,

                        secret

                    )

                    .update(canonical)

                    .digest('hex');





            if (

                this.safeCompare(

                    expected,

                    signature

                )

            ) {



                this.statistics.rotatedSecrets++;



                return true;


            }


        }



        throw new AuthenticationError(

            'Signature verification failed after rotation check'

        );


    }










    /**
     * =========================================================================
     * Canonical Payload
     * =========================================================================
     */


    buildCanonicalPayload({

        payload,

        timestamp

    }) {



        return JSON.stringify({

            timestamp,

            payload


        });


    }










    /**
     * =========================================================================
     * Timestamp Validation
     * =========================================================================
     */


    validateTimestamp(timestamp) {



        if (!timestamp) {


            return;


        }





        const age =

            Math.abs(

                Date.now() -

                new Date(timestamp).getTime()

            );





        if (

            age >

            this.timestampToleranceSeconds *

            1000

        ) {



            this.statistics.expired++;



            throw new AuthenticationError(

                'Callback signature timestamp expired'

            );


        }


    }









    extractTimestamp({

        payload,

        headers

    }) {



        return (

            headers['x-airtel-timestamp']

            ||

            payload.timestamp

            ||

            new Date().toISOString()

        );


    }









    extractSignature(headers) {



        return (

            headers['x-airtel-signature']

            ||

            headers.signature

            ||

            null

        );


    }









    /**
     * =========================================================================
     * Security Audit
     * =========================================================================
     */


    async recordAudit({

        tenantId,

        correlationId,

        status

    }) {



        await this.auditService?.record?.({

            action:

                'AIRTEL_SIGNATURE_VERIFICATION',


            tenantId,


            correlationId,


            metadata:

                {

                    provider:

                        PROVIDER.NAME,

                    status

                }


        });


    }








    async recordSecurityFailure({

        tenantId,

        correlationId,

        reason

    }) {



        await this.auditService?.record?.({

            action:

                'AIRTEL_SIGNATURE_SECURITY_FAILURE',


            tenantId,


            correlationId,


            metadata:

                {

                    provider:

                        PROVIDER.NAME,

                    reason

                }


        });



        await this.eventBus?.publish?.({

            type:

                'AIRTEL_SECURITY_ALERT',


            payload:

                {

                    reason,

                    correlationId

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


            component:

                PROVIDER.COMPONENT,


            status:

                'UP',



            algorithm:

                this.algorithm,



            statistics:

                this.statistics,



            uptimeMs:

                Date.now() -

                this.startedAt.getTime()


        };


    }




}



module.exports = SignatureVerifier;