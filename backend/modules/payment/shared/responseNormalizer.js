'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Payment Response Normalizer
 * =============================================================================
 *
 * Shared provider response normalization layer.
 *
 * Converts provider-specific responses into a unified internal payment format.
 *
 * Supports:
 *
 * • MTN MoMo
 * • Airtel Money
 * • Bank integrations
 * • Payment orchestration engine
 * • Callback processing
 * • Reconciliation engine
 * • Settlement workflows
 *
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 *
 * ✓ Normalize provider responses
 * ✓ Extract transaction identifiers
 * ✓ Standardize statuses
 * ✓ Preserve provider metadata
 * ✓ Detect provider failures
 * ✓ Attach correlation context
 * ✓ Support audit logging
 * ✓ Support reconciliation matching
 *
 *
 * Does NOT
 * -----------------------------------------------------------------------------
 *
 * ✗ Update payment state
 * ✗ Post ledger entries
 * ✗ Trigger retries
 * ✗ Perform fraud decisions
 *
 * =============================================================================
 */



const crypto = require('crypto');






class ResponseNormalizer {



    constructor({

        logger,

        metrics

    } = {}) {



        this.logger = logger;

        this.metrics = metrics;


    }








    /**
     * =========================================================================
     * Normalize Generic Provider Response
     * =========================================================================
     */


    normalize({

        provider,

        operation,

        response,

        requestContext = {}

    } = {}) {



        if (!provider) {


            throw new Error(

                'Payment provider required'

            );


        }






        if (!response) {


            throw new Error(

                'Provider response required'

            );


        }







        const normalized = {



            id:

                crypto.randomUUID(),





            provider,



            operation,





            status:

                this.resolveStatus(response),





            providerReference:

                this.extractReference(response),





            amount:

                this.extractAmount(response),





            currency:

                this.extractCurrency(response),





            success:

                this.isSuccessful(response),





            failureReason:

                this.extractFailureReason(response),





            correlationId:

                requestContext.correlationId || null,





            tenantId:

                requestContext.tenantId || null,





            idempotencyKey:

                requestContext.idempotencyKey || null,





            raw:

                response,





            metadata: {



                receivedAt:

                    new Date(),



                operation



            }



        };








        this.metrics?.counter?.(

            'payment_response_normalized_total',

            {

                provider,

                status:

                    normalized.status

            }

        );








        this.logger?.debug?.({

            event:

                'payment.response.normalized',



            provider,



            operation,



            status:

                normalized.status



        });








        return normalized;


    }








    /**
     * =========================================================================
     * MTN MoMo Response Normalizer
     * =========================================================================
     */


    normalizeMTN({

        operation,

        response,

        requestContext = {}

    }) {



        return this.normalize({

            provider:

                'MTN',



            operation,



            response,



            requestContext



        });


    }








    /**
     * =========================================================================
     * Airtel Money Response Normalizer
     * =========================================================================
     */


    normalizeAirtel({

        operation,

        response,

        requestContext = {}

    }) {



        return this.normalize({

            provider:

                'AIRTEL',



            operation,



            response,



            requestContext



        });


    }








    /**
     * =========================================================================
     * Resolve Transaction Status
     * =========================================================================
     */


    resolveStatus(response = {}) {



        const status =



            response.status ||



            response.transactionStatus ||



            response.financialTransactionStatus;







        if (!status) {



            return 'UNKNOWN';


        }







        const normalized =

            String(status)

                .toUpperCase();








        const mapping = {



            SUCCESS:

                'SUCCESSFUL',



            SUCCESSFUL:

                'SUCCESSFUL',



            COMPLETED:

                'SUCCESSFUL',



            PENDING:

                'PENDING',



            FAILED:

                'FAILED',



            ERROR:

                'FAILED',



            REJECTED:

                'FAILED'


        };








        return mapping[normalized] || normalized;


    }








    /**
     * =========================================================================
     * Extract Provider Reference
     * =========================================================================
     */


    extractReference(response = {}) {



        return (



            response.financialTransactionId ||



            response.transactionId ||



            response.referenceId ||



            response.externalId ||



            null



        );


    }








    /**
     * =========================================================================
     * Extract Amount
     * =========================================================================
     */


    extractAmount(response = {}) {



        return (



            response.amount ||



            response.amountValue ||



            null



        );


    }








    /**
     * =========================================================================
     * Extract Currency
     * =========================================================================
     */


    extractCurrency(response = {}) {



        return (



            response.currency ||



            response.currencyCode ||



            null



        );


    }








    /**
     * =========================================================================
     * Success Detection
     * =========================================================================
     */


    isSuccessful(response = {}) {



        const status =

            this.resolveStatus(response);





        return (

            status ===

            'SUCCESSFUL'

        );


    }








    /**
     * =========================================================================
     * Failure Reason Extraction
     * =========================================================================
     */


    extractFailureReason(response = {}) {



        return (



            response.reason ||



            response.message ||



            response.error ||



            null



        );


    }








    /**
     * =========================================================================
     * Provider Error Normalization
     * =========================================================================
     */


    normalizeFailure({

        provider,

        error,

        requestContext = {}

    }) {



        return {



            provider,



            success:

                false,



            status:

                'FAILED',



            error:



                {

                    message:

                        error?.message ||



                        'Provider request failed'

                },



            correlationId:

                requestContext.correlationId || null,



            tenantId:

                requestContext.tenantId || null,



            timestamp:

                new Date()



        };


    }








    /**
     * =========================================================================
     * Health Check
     * =========================================================================
     */


    health() {



        return {



            module:

                'PAYMENT_RESPONSE_NORMALIZER',



            status:

                'READY'



        };


    }


}

module.exports = ResponseNormalizer;