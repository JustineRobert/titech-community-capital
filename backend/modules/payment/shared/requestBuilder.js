'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Payment Request Builder
 * =============================================================================
 *
 * Shared provider request construction layer.
 *
 * Supports:
 *
 * • MTN MoMo
 * • Airtel Money
 * • Bank integrations
 * • Payment provider adapters
 * • Callback-aware requests
 * • Multi-tenant payment routing
 *
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Build normalized provider requests
 * • Generate correlation metadata
 * • Attach idempotency keys
 * • Construct secure headers
 * • Inject tenant context
 * • Normalize request format
 * • Support tracing propagation
 *
 *
 * Does NOT
 * -----------------------------------------------------------------------------
 * ✗ Execute HTTP requests
 * ✗ Authenticate providers
 * ✗ Retry failed requests
 * ✗ Validate business rules
 * ✗ Modify ledger
 *
 * =============================================================================
 */



const crypto = require('crypto');






class RequestBuilder {



    constructor({

        configuration,

        logger,

        tracer

    } = {}) {



        this.configuration = configuration;

        this.logger = logger || console;

        this.tracer = tracer;


    }








    /**
     * =========================================================================
     * Build Provider Request
     * =========================================================================
     */


    build({

        provider,

        operation,

        method = 'POST',

        url,

        payload = {},

        tenantId,

        correlationId,

        idempotencyKey,

        headers = {},

        metadata = {}

    } = {}) {



        this.validate({

            provider,

            operation,

            url

        });







        const requestId =

            correlationId ||

            crypto.randomUUID();








        const requestKey =

            idempotencyKey ||

            this.generateIdempotencyKey({

                tenantId,

                operation,

                payload

            });








        const request = {



            provider,



            operation,



            method,



            url,



            body:

                payload,



            headers: {



                ...this.defaultHeaders(),



                ...headers,



                'X-Correlation-ID':

                    requestId,



                'X-Request-ID':

                    requestId,



                'X-Idempotency-Key':

                    requestKey



            },



            context: {



                tenantId,



                correlationId:

                    requestId,



                idempotencyKey:

                    requestKey,



                metadata



            },



            createdAt:

                new Date()



        };








        this.logger.debug?.({

            event:

                'payment.request.built',



            provider,



            operation,



            correlationId:

                requestId


        });








        return request;


    }








    /**
     * =========================================================================
     * Build MTN MoMo Request
     * =========================================================================
     */


    buildMTN({

        operation,

        endpoint,

        payload,

        tenantId,

        subscriptionKey,

        correlationId

    }) {



        return this.build({

            provider:

                'MTN',



            operation,



            url:

                endpoint,



            payload,



            tenantId,



            correlationId,



            headers: {



                'Ocp-Apim-Subscription-Key':

                    subscriptionKey

            }



        });


    }








    /**
     * =========================================================================
     * Build Airtel Money Request
     * =========================================================================
     */


    buildAirtel({

        operation,

        endpoint,

        payload,

        tenantId,

        correlationId

    }) {



        return this.build({

            provider:

                'AIRTEL',



            operation,



            url:

                endpoint,



            payload,



            tenantId,



            correlationId



        });


    }








    /**
     * =========================================================================
     * Generate Idempotency Key
     * =========================================================================
     */


    generateIdempotencyKey({

        tenantId,

        operation,

        payload

    }) {



        const raw =

            JSON.stringify({

                tenantId,

                operation,

                payload

            });








        return crypto

            .createHash('sha256')

            .update(raw)

            .digest('hex');


    }








    /**
     * =========================================================================
     * Default Headers
     * =========================================================================
     */


    defaultHeaders() {



        return {


            Accept:

                'application/json',



            'Content-Type':

                'application/json',



            'User-Agent':

                'TITech-Payment-Platform'


        };


    }








    /**
     * =========================================================================
     * Add Trace Context
     * =========================================================================
     */


    attachTrace(headers = {}) {



        const traceId =

            this.tracer?.getTraceId?.();






        if (traceId) {



            headers['X-Trace-ID'] =

                traceId;


        }






        return headers;


    }








    /**
     * =========================================================================
     * Validate Request
     * =========================================================================
     */


    validate({

        provider,

        operation,

        url

    }) {



        if (!provider) {


            throw new Error(

                'Payment provider required'

            );


        }






        if (!operation) {


            throw new Error(

                'Payment operation required'

            );


        }






        if (!url) {


            throw new Error(

                'Payment provider URL required'

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

                'PAYMENT_REQUEST_BUILDER',



            status:

                'READY'



        };


    }


}

module.exports = RequestBuilder;