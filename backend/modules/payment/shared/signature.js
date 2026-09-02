'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Payment Signature Service
 * =============================================================================
 *
 * Shared cryptographic signature framework.
 *
 * Used by:
 *
 * • MTN MoMo callbacks
 * • Airtel Money callbacks
 * • Bank webhooks
 * • Payment API requests
 * • Internal service-to-service authentication
 *
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 *
 * ✓ Generate request signatures
 * ✓ Verify callback signatures
 * ✓ Support HMAC algorithms
 * ✓ Prevent timing attacks
 * ✓ Normalize payload signing
 * ✓ Support key rotation
 * ✓ Preserve audit metadata
 * ✓ Provider-independent design
 *
 *
 * Does NOT
 * -----------------------------------------------------------------------------
 *
 * ✗ Store secrets permanently
 * ✗ Manage credentials
 * ✗ Authorize payments
 * ✗ Modify transactions
 *
 * =============================================================================
 */



const crypto = require('crypto');






class SignatureService {



    constructor({

        secret,

        algorithm = 'sha256',

        logger,

        metrics

    } = {}) {



        this.secret = secret;

        this.algorithm = algorithm;

        this.logger = logger;

        this.metrics = metrics;


    }








    /**
     * =========================================================================
     * Generate Signature
     * =========================================================================
     */


    generate({

        payload,

        secret = this.secret,

        algorithm = this.algorithm

    } = {}) {



        this.validateSecret(secret);







        const normalized =

            this.normalizePayload(payload);








        return crypto

            .createHmac(

                algorithm,

                secret

            )

            .update(normalized)

            .digest('hex');


    }








    /**
     * =========================================================================
     * Verify Signature
     * =========================================================================
     */


    verify({

        payload,

        signature,

        secret = this.secret,

        algorithm = this.algorithm

    } = {}) {



        try {



            if (!signature) {


                return false;


            }






            this.validateSecret(secret);







            const expected =

                this.generate({

                    payload,

                    secret,

                    algorithm

                });







            const valid =

                this.safeCompare(

                    expected,

                    signature

                );







            this.metrics?.counter?.(

                'payment_signature_verification_total',

                {

                    result:

                        valid

                            ? 'success'

                            : 'failure'

                }

            );








            return valid;


        }



        catch(error) {



            this.logger?.error?.({

                event:

                    'payment.signature.verification.failed',



                error



            });



            return false;


        }


    }








    /**
     * =========================================================================
     * Verify Provider Signature
     * =========================================================================
     */


    verifyProviderSignature({

        provider,

        payload,

        signature,

        secret

    }) {



        const valid =

            this.verify({

                payload,

                signature,

                secret

            });








        this.logger?.debug?.({

            event:

                'payment.provider.signature.checked',



            provider,



            valid



        });








        return valid;


    }








    /**
     * =========================================================================
     * Generate Request Signature Headers
     * =========================================================================
     */


    createHeaders({

        payload,

        secret = this.secret

    } = {}) {



        const timestamp =

            Date.now();







        const signature =

            this.generate({

                payload: {



                    timestamp,

                    body: payload



                },



                secret



            });








        return {



            'X-Signature':

                signature,



            'X-Signature-Timestamp':

                timestamp



        };


    }








    /**
     * =========================================================================
     * Validate Timestamp
     *
     * Prevents replay attacks
     * =========================================================================
     */


    validateTimestamp({

        timestamp,

        toleranceMs = 300000

    } = {}) {



        if (!timestamp) {


            return false;


        }








        const difference =

            Math.abs(

                Date.now() -

                Number(timestamp)

            );







        return (

            difference <=

            toleranceMs

        );


    }








    /**
     * =========================================================================
     * Normalize Payload
     *
     * Ensures identical signing across systems
     * =========================================================================
     */


    normalizePayload(payload) {



        if (

            typeof payload ===

            'string'

        ) {



            return payload;


        }







        return JSON.stringify(

            this.sortObject(payload)

        );


    }








    /**
     * =========================================================================
     * Deterministic Object Sorting
     * =========================================================================
     */


    sortObject(object) {



        if (

            object === null ||

            typeof object !== 'object'

        ) {



            return object;


        }








        if (

            Array.isArray(object)

        ) {



            return object.map(

                item =>

                    this.sortObject(item)

            );


        }








        return Object.keys(object)

            .sort()

            .reduce(

                (result, key) => {



                    result[key] =

                        this.sortObject(

                            object[key]

                        );



                    return result;


                },

                {}

            );


    }








    /**
     * =========================================================================
     * Timing Safe Comparison
     * =========================================================================
     */


    safeCompare(

        expected,

        received

    ) {



        const expectedBuffer =

            Buffer.from(

                expected

            );







        const receivedBuffer =

            Buffer.from(

                received

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








    /**
     * =========================================================================
     * Secret Validation
     * =========================================================================
     */


    validateSecret(secret) {



        if (!secret) {



            throw new Error(

                'Signature secret missing'

            );


        }







        if (

            typeof secret !==

            'string'

        ) {



            throw new Error(

                'Signature secret must be string'

            );


        }


    }








    /**
     * =========================================================================
     * Health Check
     * =========================================================================
     */


    health() {



        return {



            module:

                'PAYMENT_SIGNATURE_SERVICE',



            algorithm:

                this.algorithm,



            status:

                'READY'



        };


    }


}








module.exports = SignatureService;