'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Payment Configuration Management
 * =============================================================================
 *
 * Shared configuration foundation for payment infrastructure.
 *
 * Supports:
 *
 * • MTN MoMo
 * • Airtel Money
 * • Bank integrations
 * • Multi-tenant payment configuration
 * • Environment management
 * • Secure TLS configuration
 * • Retry policies
 * • Timeout policies
 * • Provider endpoint routing
 * • Credential isolation
 *
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Load provider configuration
 * • Validate required settings
 * • Resolve tenant overrides
 * • Provide secure HTTP options
 * • Manage endpoint configuration
 * • Expose operational policies
 *
 *
 * Does NOT
 * -----------------------------------------------------------------------------
 * ✗ Store secrets
 * ✗ Call external APIs
 * ✗ Authenticate users
 * ✗ Manage payments
 *
 * =============================================================================
 */


const fs = require('fs');
const path = require('path');





/**
 * =============================================================================
 * Default Configuration
 * =============================================================================
 */


const DEFAULTS = Object.freeze({


    provider:

        process.env.PAYMENT_PROVIDER || 'mtn',



    environment:

        process.env.PAYMENT_ENVIRONMENT ||

        process.env.MTN_ENVIRONMENT ||

        'sandbox',



    region:

        process.env.PAYMENT_REGION ||

        process.env.MTN_REGION ||

        'uganda',



    apiVersion:

        process.env.MTN_API_VERSION ||

        'v1_0',





    timeout: Object.freeze({


        connect:

            Number(

                process.env.PAYMENT_CONNECT_TIMEOUT_MS ||

                process.env.MTN_CONNECT_TIMEOUT_MS ||

                5000

            ),



        request:

            Number(

                process.env.PAYMENT_REQUEST_TIMEOUT_MS ||

                process.env.MTN_REQUEST_TIMEOUT_MS ||

                30000

            )


    }),





    retry: Object.freeze({


        retries:

            Number(

                process.env.PAYMENT_RETRY_COUNT ||

                process.env.MTN_RETRY_COUNT ||

                3

            ),



        initialDelayMs:

            Number(

                process.env.PAYMENT_RETRY_INITIAL_DELAY_MS ||

                process.env.MTN_RETRY_INITIAL_DELAY_MS ||

                500

            ),



        maxDelayMs:

            Number(

                process.env.PAYMENT_RETRY_MAX_DELAY_MS ||

                process.env.MTN_RETRY_MAX_DELAY_MS ||

                10000

            ),



        backoffMultiplier:

            Number(

                process.env.PAYMENT_RETRY_BACKOFF ||

                process.env.MTN_RETRY_BACKOFF ||

                2

            )


    }),





    tls: Object.freeze({


        rejectUnauthorized:

            process.env.MTN_TLS_REJECT_UNAUTHORIZED !==

            'false',



        caFile:

            process.env.MTN_TLS_CA_FILE || null,



        certFile:

            process.env.MTN_TLS_CERT_FILE || null,



        keyFile:

            process.env.MTN_TLS_KEY_FILE || null


    }),





    callback: Object.freeze({


        host:

            process.env.MTN_CALLBACK_HOST || '',



        collectionsPath:

            process.env.MTN_COLLECTION_CALLBACK ||

            '/api/v1/payments/mtn/collections/callback',



        disbursementPath:

            process.env.MTN_DISBURSEMENT_CALLBACK ||

            '/api/v1/payments/mtn/disbursements/callback'


    })


});








/**
 * =============================================================================
 * MTN Regional Endpoints
 * =============================================================================
 */


const REGIONAL_ENDPOINTS = Object.freeze({



    uganda: {


        sandbox: {


            collection:

                'https://sandbox.momodeveloper.mtn.com/collection',



            disbursement:

                'https://sandbox.momodeveloper.mtn.com/disbursement',



            remittance:

                'https://sandbox.momodeveloper.mtn.com/remittance'


        },



        production: {


            collection:

                process.env.MTN_COLLECTION_URL || '',



            disbursement:

                process.env.MTN_DISBURSEMENT_URL || '',



            remittance:

                process.env.MTN_REMITTANCE_URL || ''


        }


    },






    ghana: {


        sandbox: {


            collection:

                'https://sandbox.momodeveloper.mtn.com/collection',



            disbursement:

                'https://sandbox.momodeveloper.mtn.com/disbursement',



            remittance:

                'https://sandbox.momodeveloper.mtn.com/remittance'


        },



        production: {


            collection:

                process.env.MTN_COLLECTION_URL || '',



            disbursement:

                process.env.MTN_DISBURSEMENT_URL || '',



            remittance:

                process.env.MTN_REMITTANCE_URL || ''


        }


    }



});









/**
 * =============================================================================
 * Payment Configuration Service
 * =============================================================================
 */


class PaymentConfiguration {



    constructor(overrides = {}) {


        this.config = Object.freeze(

            this.build(overrides)

        );


    }








    /**
     * Build configuration
     */


    build(overrides = {}) {



        const environment =

            overrides.environment ||

            DEFAULTS.environment;






        const region =

            overrides.region ||

            DEFAULTS.region;







        const endpoints =

            REGIONAL_ENDPOINTS?.[region]?.[environment];







        if (!endpoints) {


            throw new Error(

                `Unsupported payment environment ${region}/${environment}`

            );


        }








        return Object.freeze({



            ...DEFAULTS,



            ...overrides,



            environment,



            region,



            endpoints,





            credentials: Object.freeze({



                apiUser:

                    overrides.apiUser ||

                    process.env.MTN_API_USER,



                apiKey:

                    overrides.apiKey ||

                    process.env.MTN_API_KEY,



                subscriptionKey:

                    overrides.subscriptionKey ||

                    process.env.MTN_SUBSCRIPTION_KEY


            })



        });



    }








    /**
     * Validate configuration
     */


    validate() {



        const errors = [];



        const credentials =

            this.config.credentials;







        if (!credentials.apiUser)

            errors.push(

                'MTN_API_USER missing'

            );






        if (!credentials.apiKey)

            errors.push(

                'MTN_API_KEY missing'

            );






        if (!credentials.subscriptionKey)

            errors.push(

                'MTN_SUBSCRIPTION_KEY missing'

            );






        if (!this.config.callback.host)

            errors.push(

                'MTN_CALLBACK_HOST missing'

            );








        if (errors.length) {



            const error =

                new Error(

                    'Payment configuration validation failed'

                );



            error.code =

                'PAYMENT_CONFIGURATION_INVALID';



            error.validationErrors = errors;



            throw error;


        }







        return true;


    }








    /**
     * Tenant-specific configuration
     */


    forTenant(tenant = {}) {



        return Object.freeze({



            ...this.config,



            credentials: Object.freeze({



                ...this.config.credentials,



                ...(tenant.payment?.mtn || {})



            })



        });



    }








    get() {


        return this.config;


    }








    /**
     * TLS options
     */


    getTLSOptions() {



        const tls =

            this.config.tls;





        const options = {



            rejectUnauthorized:

                tls.rejectUnauthorized


        };







        if (tls.caFile) {



            options.ca =

                fs.readFileSync(

                    path.resolve(

                        tls.caFile

                    )

                );


        }







        if (tls.certFile) {



            options.cert =

                fs.readFileSync(

                    path.resolve(

                        tls.certFile

                    )

                );


        }







        if (tls.keyFile) {



            options.key =

                fs.readFileSync(

                    path.resolve(

                        tls.keyFile

                    )

                );


        }







        return options;


    }








    /**
     * Callback URL resolver
     */


    getCallbackUrl(type = 'collection') {



        const callback =

            this.config.callback;







        const suffix =

            type === 'disbursement'

                ? callback.disbursementPath

                : callback.collectionsPath;







        return (

            callback.host +

            suffix

        );


    }








    getRetryPolicy() {



        return Object.freeze(

            this.config.retry

        );


    }








    getTimeoutPolicy() {



        return Object.freeze(

            this.config.timeout

        );


    }








    getEndpoints() {



        return Object.freeze(

            this.config.endpoints

        );


    }








    /**
     * Runtime health information
     */


    health() {



        return {



            provider:

                this.config.provider,



            environment:

                this.config.environment,



            region:

                this.config.region,



            status:

                'READY'



        };


    }


}








module.exports = {


    PaymentConfiguration,


    MTNConfiguration:

        PaymentConfiguration,


    DEFAULTS,


    REGIONAL_ENDPOINTS


};