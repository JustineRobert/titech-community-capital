'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * MTN MoMo Callback Correlation Service
 * =============================================================================
 *
 * Enterprise Production Implementation
 *
 * Purpose
 * -----------------------------------------------------------------------------
 * Correlation layer responsible for mapping MTN provider callbacks back to
 * internal payment transactions and tenant context.
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Generate tenant-specific callback URLs
 * • Resolve callbacks to internal transactions
 * • Validate correlation identifiers
 * • Support multi-tenant callback routing
 * • Prevent cross-tenant callback leakage
 * • Provide audit visibility
 * • Support distributed tracing
 *
 * Does NOT
 * -----------------------------------------------------------------------------
 * ✗ Validate MTN signatures
 * ✗ Process callbacks
 * ✗ Update payment states
 * ✗ Post ledger entries
 * ✗ Perform reconciliation
 *
 * =============================================================================
 */


class CallbackCorrelation {


    constructor({

        configuration,

        repository,

        auditService,

        metrics,

        eventBus,

        logger

    } = {}) {


        if (!configuration) {

            throw new Error(

                'CallbackCorrelation requires configuration.'

            );

        }


        if (!repository) {

            throw new Error(

                'CallbackCorrelation requires repository.'

            );

        }


        this.configuration = configuration;

        this.repository = repository;

        this.auditService = auditService;

        this.metrics = metrics;

        this.eventBus = eventBus;

        this.logger = logger || console;


    }



    /**
     * =========================================================================
     * Generate MTN Callback URL
     * =========================================================================
     */


    callbackUrl({

        tenantId

    } = {}) {


        if (!tenantId) {

            throw this.#error(

                'VALIDATION_ERROR',

                'tenantId is required.',

                400

            );

        }


        const baseUrl =

            this.configuration.callbackHost

                ?.replace(/\/$/, '');


        if (!baseUrl) {

            throw this.#error(

                'CONFIGURATION_ERROR',

                'MTN callback host is not configured.',

                500

            );

        }


        return (

            `${baseUrl}` +

            `/api/v1/payments/mtn/callback/${encodeURIComponent(tenantId)}`

        );


    }



    /**
     * =========================================================================
     * Correlate Provider Callback
     * =========================================================================
     */


    async correlate({

        externalId,

        financialTransactionId,

        tenantId

    } = {}) {


        if (

            !externalId &&

            !financialTransactionId

        ) {

            throw this.#error(

                'VALIDATION_ERROR',

                'Callback correlation identifier required.',

                400

            );

        }


        let transaction;


        /**
         * ---------------------------------------------------------------------
         * Primary correlation using external ID
         * ---------------------------------------------------------------------
         */


        if (externalId) {


            transaction =

                await this.repository.findByExternalId(

                    externalId

                );


        }



        /**
         * ---------------------------------------------------------------------
         * Fallback MTN Financial Transaction ID
         * ---------------------------------------------------------------------
         */


        if (

            !transaction &&

            financialTransactionId &&

            this.repository.findByFinancialTransactionId

        ) {


            transaction =

                await this.repository.findByFinancialTransactionId(

                    financialTransactionId

                );


        }



        if (!transaction) {


            this.metrics?.increment?.(

                'payment.callback.correlation.failed'

            );


            this.logger.warn?.({

                event:

                    'mtn.callback.correlation.failed',

                externalId,

                financialTransactionId

            });


            return null;


        }



        /**
         * ---------------------------------------------------------------------
         * Tenant Isolation Check
         * ---------------------------------------------------------------------
         */


        if (

            tenantId &&

            transaction.tenantId &&

            transaction.tenantId !== tenantId

        ) {


            throw this.#error(

                'TENANT_MISMATCH',

                'Callback transaction tenant mismatch.',

                403

            );


        }



        this.metrics?.increment?.(

            'payment.callback.correlation.success'

        );



        await this.auditService?.record({

            action:

                'MTN_CALLBACK_CORRELATED',

            transactionId:

                transaction.id,

            externalId,

            financialTransactionId,

            tenantId:

                transaction.tenantId,

            timestamp:

                new Date()

        });



        await this.eventBus?.publish?.({

            type:

                'PAYMENT_CALLBACK_CORRELATED',

            payload: {

                transactionId:

                    transaction.id,

                externalId,

                financialTransactionId

            }

        });



        return transaction;


    }



    /**
     * =========================================================================
     * Build Correlation Context
     * =========================================================================
     */


    async context({

        externalId,

        tenantId

    } = {}) {


        const transaction =

            await this.correlate({

                externalId,

                tenantId

            });


        if (!transaction) {

            return {

                correlated: false

            };

        }


        return {

            correlated: true,

            transactionId:

                transaction.id,

            tenantId:

                transaction.tenantId,

            externalId:

                transaction.externalId

        };


    }



    /**
     * =========================================================================
     * Error Factory
     * =========================================================================
     */


    #error(

        code,

        message,

        statusCode = 500

    ) {


        const error =

            new Error(message);


        error.name =

            'CallbackCorrelationError';


        error.code =

            code;


        error.statusCode =

            statusCode;


        return error;


    }


}



module.exports = CallbackCorrelation;