'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Shared Payment Security Signature Service
 * =============================================================================
 *
 * Enterprise Production Implementation
 *
 * Purpose
 * -----------------------------------------------------------------------------
 * Provides cryptographic signing and signature verification capabilities for
 * payment integrations.
 *
 * Used by:
 *
 * • MTN MoMo callbacks
 * • Airtel Money callbacks
 * • Bank payment integrations
 * • Internal payment events
 * • Webhook security validation
 * • Provider request authentication
 *
 *
 * Security Responsibilities
 * -----------------------------------------------------------------------------
 * • Generate cryptographic signatures
 * • Verify incoming signatures
 * • Prevent payload tampering
 * • Support multiple algorithms
 * • Perform timing-safe comparisons
 * • Normalize payload signing
 * • Support key rotation
 * • Produce security audit events
 *
 *
 * Does NOT
 * -----------------------------------------------------------------------------
 * ✗ Manage secrets storage
 * ✗ Rotate encryption keys
 * ✗ Perform authentication
 * ✗ Authorize payments
 *
 * =============================================================================
 */


const crypto = require('crypto');



class SignatureService {



    constructor({

        secretProvider,

        algorithm = 'sha256',

        encoding = 'hex',

        auditService,

        metrics,

        logger,

        configuration = {}

    } = {}) {



        if (!secretProvider) {


            throw new Error(

                'SignatureService requires secretProvider.'

            );


        }



        this.secretProvider = secretProvider;

        this.algorithm = algorithm;

        this.encoding = encoding;

        this.auditService = auditService;

        this.metrics = metrics;

        this.logger = logger || console;

        this.configuration = configuration;


    }








    /**
     * =========================================================================
     * Generate Signature
     * =========================================================================
     */


    async sign({

        payload,

        keyId,

        context = {}

    } = {}) {



        const secret =

            await this.#resolveSecret({

                keyId

            });






        const normalized =

            this.normalize(payload);







        const signature =

            crypto

                .createHmac(

                    this.algorithm,

                    secret

                )

                .update(normalized)

                .digest(this.encoding);








        this.metrics?.increment?.(

            'payment.signature.generated'

        );







        await this.auditService?.record?.({

            action:

                'PAYMENT_SIGNATURE_GENERATED',



            keyId,


            context,


            timestamp:

                new Date()


        });








        return {


            signature,


            algorithm:

                this.algorithm,


            encoding:

                this.encoding



        };


    }








    /**
     * =========================================================================
     * Verify Signature
     * =========================================================================
     */


    async verify({

        payload,

        signature,

        keyId,

        context = {}

    } = {}) {



        if (!signature) {



            return {


                valid: false,


                reason:

                    'Missing signature'


            };


        }







        try {



            const secret =

                await this.#resolveSecret({

                    keyId

                });






            const expected =

                crypto

                    .createHmac(

                        this.algorithm,

                        secret

                    )

                    .update(

                        this.normalize(payload)

                    )

                    .digest(this.encoding);







            const valid =

                this.#safeCompare(

                    expected,

                    signature

                );








            if (!valid) {



                this.metrics?.increment?.(

                    'payment.signature.failed'

                );





                await this.auditService?.record?.({

                    action:

                        'PAYMENT_SIGNATURE_FAILED',



                    keyId,


                    context,


                    timestamp:

                        new Date()


                });






                return {


                    valid: false,


                    reason:

                        'Invalid signature'


                };


            }








            this.metrics?.increment?.(

                'payment.signature.success'

            );








            return {


                valid: true,


                algorithm:

                    this.algorithm



            };





        }


        catch(error) {



            this.logger.error?.({

                event:

                    'payment.signature.verification.error',



                error

            });




            throw error;


        }


    }








    /**
     * =========================================================================
     * Normalize Payload
     * =========================================================================
     *
     * Ensures identical signing input across services.
     */


    normalize(payload) {



        if (

            payload === null ||

            payload === undefined

        ) {



            return '';

        }






        if (

            typeof payload === 'string'

        ) {



            return payload;


        }







        return JSON.stringify(

            this.#sortObject(payload)

        );


    }








    /**
     * =========================================================================
     * Timing Safe Comparison
     * =========================================================================
     */


    #safeCompare(a, b) {



        try {



            const bufferA =

                Buffer.from(a);




            const bufferB =

                Buffer.from(b);






            if (

                bufferA.length !==

                bufferB.length

            ) {



                return false;


            }






            return crypto.timingSafeEqual(

                bufferA,

                bufferB

            );





        }


        catch(error) {



            return false;


        }


    }








    /**
     * =========================================================================
     * Resolve Secret
     * =========================================================================
     */


    async #resolveSecret({

        keyId

    }) {



        const secret =

            await this.secretProvider.get({

                keyId

            });







        if (!secret) {



            throw new Error(

                'Signing secret unavailable.'

            );


        }






        return secret;


    }








    /**
     * =========================================================================
     * Deterministic Object Sorting
     * =========================================================================
     */


    #sortObject(value) {



        if (

            Array.isArray(value)

        ) {



            return value.map(

                item =>

                    this.#sortObject(item)

            );


        }







        if (

            value &&

            typeof value === 'object'

        ) {



            return Object.keys(value)

                .sort()

                .reduce((obj, key) => {



                    obj[key] =

                        this.#sortObject(

                            value[key]

                        );



                    return obj;



                }, {});


        }







        return value;


    }


}





module.exports = SignatureService;