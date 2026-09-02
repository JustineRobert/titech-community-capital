'use strict';

/**
 * ==========================================================
 * TITech Community Capital LTD
 * MTN MoMo Enterprise Settlement Engine
 * ----------------------------------------------------------
 *
 * Production settlement orchestration layer.
 *
 * Responsibilities
 * ----------------
 *
 * • Retrieve MTN settlement information
 * • Validate settlement completeness
 * • Match provider settlement records
 * • Confirm financial settlement
 * • Trigger ledger settlement posting
 * • Detect settlement variance
 * • Generate settlement reports
 * • Publish settlement events
 * • Maintain audit trail
 *
 *
 * Does NOT:
 *
 * • Initiate payments
 * • Handle OAuth lifecycle
 * • Modify balances directly
 *
 * ==========================================================
 */


const crypto = require('crypto');


const {
    normalizeError,
    SettlementError
} = require('../shared/errors');



class MTNSettlement {


    constructor({

        authService,

        httpClient,

        configuration,

        settlementRepository,

        reconciliationService,

        ledgerBridge,

        reportGenerator,

        varianceDetector,

        auditService,

        eventPublisher,

        logger,

        metrics,

        tracer

    } = {}) {


        this.authService =
            authService;


        this.httpClient =
            httpClient;


        this.configuration =
            configuration;


        this.settlementRepository =
            settlementRepository;


        this.reconciliationService =
            reconciliationService;


        this.ledgerBridge =
            ledgerBridge;


        this.reportGenerator =
            reportGenerator;


        this.varianceDetector =
            varianceDetector;


        this.auditService =
            auditService;


        this.eventPublisher =
            eventPublisher;


        this.logger =
            logger;


        this.metrics =
            metrics;


        this.tracer =
            tracer;



        this.statistics = {


            executions: 0,

            completed: 0,

            failed: 0,

            variances: 0


        };


    }





    /**
     * ------------------------------------------------------
     * Execute Settlement
     * ------------------------------------------------------
     */
    async settle({

        tenantId,

        settlementDate,

        type = 'COLLECTION'

    }) {


        const correlationId =

            crypto.randomUUID();



        const span =

            this.tracer?.startSpan?.(

                'payment.mtn.settlement'

            );



        this.statistics.executions++;



        try {



            this.logger?.info?.({

                message:

                    'Starting MTN settlement process',


                tenantId,


                settlementDate,


                correlationId

            });







            /**
             * 1. Retrieve provider settlement
             */
            const providerSettlement =

                await this.fetchSettlement({

                    tenantId,

                    settlementDate,

                    type,

                    correlationId

                });








            /**
             * 2. Retrieve internal settlement records
             */
            const internalSettlement =

                await this.settlementRepository.find({

                    tenantId,

                    settlementDate,

                    provider:

                        'MTN'

                });








            /**
             * 3. Validate settlement variance
             */
            const variance =

                await this.varianceDetector.detect({

                    providerSettlement,

                    internalSettlement

                });








            if (

                variance.hasVariance

            ) {


                this.statistics.variances++;


                await this.settlementRepository.updateStatus({

                    tenantId,

                    settlementDate,

                    status:

                        'VARIANCE_DETECTED',


                    variance

                });


            }








            /**
             * 4. Post settlement through ledger bridge
             */
            if (

                !variance.hasVariance

            ) {



                await this.ledgerBridge.postSettlement({

                    tenantId,


                    settlement: providerSettlement


                });


            }








            /**
             * 5. Store settlement result
             */
            const record =

                await this.settlementRepository.create({

                    tenantId,


                    provider:

                        'MTN',


                    settlementDate,


                    type,


                    status:

                        variance.hasVariance

                            ? 'VARIANCE'

                            : 'SETTLED',


                    correlationId,


                    variance

                });








            /**
             * 6. Generate settlement report
             */
            const report =

                await this.reportGenerator?.generate({

                    tenantId,

                    settlement: record,

                    correlationId

                });








            /**
             * 7. Audit
             */
            await this.auditService?.record({

                action:

                    'MTN_SETTLEMENT_COMPLETED',


                tenantId,


                settlementDate,


                correlationId


            });








            /**
             * 8. Publish event
             */
            await this.eventPublisher?.publish({

                type:

                    'MTN_SETTLEMENT_COMPLETED',


                payload: {


                    tenantId,


                    settlementDate,


                    status:

                        record.status,


                    correlationId


                }

            });








            this.statistics.completed++;



            this.metrics?.counter?.(

                'payment_mtn_settlement_success_total'

            );








            return {


                success: true,


                tenantId,


                settlementDate,


                status:

                    record.status,


                variance,


                report,


                correlationId


            };



        }



        catch(error) {



            this.statistics.failed++;



            this.metrics?.counter?.(

                'payment_mtn_settlement_failure_total'

            );





            const normalized =


                error instanceof SettlementError

                    ? error

                    :

                    normalizeError(error, {


                        provider:

                            'MTN',


                        tenantId,


                        correlationId


                    });






            this.logger?.error?.({

                message:

                    'MTN settlement failed',


                tenantId,


                correlationId,


                error:

                    normalized.toJSON?.()

                    ||

                    normalized

            });





            throw normalized;


        }



        finally {


            span?.end?.();


        }


    }








    /**
     * ------------------------------------------------------
     * Fetch provider settlement
     * ------------------------------------------------------
     */
    async fetchSettlement({

        tenantId,

        settlementDate,

        type,

        correlationId

    }) {



        const token =

            await this.authService.getAccessToken({

                tenantId,

                correlationId

            });







        const response =

            await this.httpClient.request({

                method:

                    'GET',


                url:

                    this.settlementEndpoint(),



                headers: {


                    Authorization:

                        `Bearer ${token}`


                },



                params: {


                    settlementDate,


                    type


                },


                correlationId


            });






        return this.normalizeSettlement(

            response.body

        );


    }








    /**
     * ------------------------------------------------------
     * Normalize MTN settlement response
     * ------------------------------------------------------
     */
    normalizeSettlement(data = {}) {


        return {


            provider:

                'MTN',


            settlementId:

                data.settlementId,


            amount:

                Number(

                    data.amount || 0

                ),


            currency:

                data.currency || 'UGX',


            transactions:

                data.transactions || [],


            raw:

                data


        };


    }








    /**
     * ------------------------------------------------------
     * Settlement endpoint
     * ------------------------------------------------------
     */
    settlementEndpoint() {


        return (

            this.configuration

                .getEndpoints()

                .collection

            +

            '/settlements'

        );


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

                'settlement',



            status:

                'UP',



            statistics:

                {

                    ...this.statistics

                }


        };


    }



}



module.exports = MTNSettlement;