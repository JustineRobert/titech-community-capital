'use strict';

/**
 * ==========================================================
 * TITech Community Capital LTD
 * MTN MoMo Enterprise Reconciliation Engine
 * ----------------------------------------------------------
 *
 * Production reconciliation orchestration layer.
 *
 * Responsibilities
 * ----------------
 *
 * • Fetch MTN provider transactions
 * • Normalize provider responses
 * • Compare against internal ledger
 * • Detect mismatches
 * • Detect missing settlements
 * • Detect duplicate records
 * • Generate reconciliation reports
 * • Trigger repair workflows
 * • Publish reconciliation events
 * • Maintain audit trail
 *
 *
 * Does NOT:
 *
 * • Modify ledger directly
 * • Execute payments
 * • Handle OAuth lifecycle
 *
 * ==========================================================
 */


const crypto = require('crypto');


const {
    normalizeError,
    ReconciliationError
} = require('../shared/errors');



class MTNReconciliation {


    constructor({

        authService,

        httpClient,

        configuration,

        transactionRepository,

        ledgerService,

        settlementRepository,

        matcher,

        repairService,

        reportGenerator,

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


        this.transactionRepository =
            transactionRepository;


        this.ledgerService =
            ledgerService;


        this.settlementRepository =
            settlementRepository;


        this.matcher =
            matcher;


        this.repairService =
            repairService;


        this.reportGenerator =
            reportGenerator;


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

            matched: 0,

            unmatched: 0,

            failed: 0

        };

    }





    /**
     * ------------------------------------------------------
     * Execute reconciliation
     * ------------------------------------------------------
     */
    async reconcile({


        tenantId,


        from,


        to,


        type = 'COLLECTION'


    }) {


        const correlationId =

            crypto.randomUUID();



        const span =

            this.tracer?.startSpan?.(

                'payment.mtn.reconciliation'

            );



        this.statistics.executions++;



        try {



            this.logger?.info?.({


                message:

                    'Starting MTN reconciliation',



                tenantId,


                correlationId


            });





            /**
             * 1. Load provider transactions
             */
            const providerTransactions =

                await this.fetchProviderTransactions({


                    tenantId,


                    from,


                    to,


                    type,


                    correlationId


                });






            /**
             * 2. Load internal records
             */
            const internalTransactions =

                await this.transactionRepository.findBetween({


                    tenantId,


                    from,


                    to,


                    provider:

                        'MTN'


                });






            /**
             * 3. Match transactions
             */
            const result =

                await this.matcher.match({


                    providerTransactions,


                    internalTransactions


                });






            this.statistics.matched +=

                result.matched.length;





            this.statistics.unmatched +=

                result.unmatched.length;







            /**
             * 4. Persist reconciliation result
             */
            await this.settlementRepository.create({


                tenantId,


                provider:

                    'MTN',


                type,


                correlationId,


                matched:

                    result.matched.length,


                unmatched:

                    result.unmatched.length,


                status:

                    result.unmatched.length

                        ? 'VARIANCE_FOUND'

                        : 'COMPLETED'


            });







            /**
             * 5. Trigger repair workflow
             */
            if (

                result.unmatched.length

            ) {



                await this.repairService?.createCases({


                    tenantId,


                    provider:

                        'MTN',


                    transactions:

                        result.unmatched,


                    correlationId


                });


            }








            /**
             * 6. Generate report
             */
            const report =

                await this.reportGenerator?.generate({


                    tenantId,


                    provider:

                        'MTN',


                    result,


                    correlationId


                });








            /**
             * 7. Audit
             */
            await this.auditService?.record({


                action:

                    'MTN_RECONCILIATION_COMPLETED',



                tenantId,


                correlationId,


                summary: {


                    matched:

                        result.matched.length,


                    unmatched:

                        result.unmatched.length


                }


            });








            /**
             * 8. Publish event
             */
            await this.eventPublisher?.publish({


                type:

                    'MTN_RECONCILIATION_COMPLETED',



                payload: {


                    tenantId,


                    correlationId,


                    result


                }


            });







            this.metrics?.counter?.(

                'payment_mtn_reconciliation_success_total'

            );







            return {


                success: true,


                tenantId,


                correlationId,


                matched:

                    result.matched.length,


                unmatched:

                    result.unmatched.length,


                report


            };



        }



        catch(error) {



            this.statistics.failed++;




            this.metrics?.counter?.(

                'payment_mtn_reconciliation_failure_total'

            );





            const normalized =

                error instanceof ReconciliationError

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

                    'MTN reconciliation failed',



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
     * Fetch MTN provider transactions
     * ------------------------------------------------------
     */
    async fetchProviderTransactions({

        tenantId,

        from,

        to,

        type,

        correlationId

    }) {



        const token =

            await this.authService.getAccessToken({


                tenantId,


                correlationId


            });





        const endpoint =

            this.reconciliationEndpoint();






        const response =

            await this.httpClient.request({


                method:

                    'GET',



                url:

                    endpoint,



                headers: {


                    Authorization:

                        `Bearer ${token}`


                },



                params: {


                    from,


                    to,


                    type


                },



                correlationId


            });





        return this.normalizeProviderTransactions(

            response.body

        );


    }







    /**
     * ------------------------------------------------------
     * Normalize MTN response
     * ------------------------------------------------------
     */
    normalizeProviderTransactions(data = {}) {


        const transactions =

            data.transactions || [];



        return transactions.map(item => ({



            provider:

                'MTN',



            externalId:

                item.financialTransactionId,



            reference:

                item.externalId,



            amount:

                Number(item.amount),



            status:

                item.status,



            raw:

                item



        }));


    }







    /**
     * ------------------------------------------------------
     * Reconciliation endpoint
     * ------------------------------------------------------
     */
    reconciliationEndpoint() {


        return (

            this.configuration

                .getEndpoints()

                .collection

            +

            '/transactions'

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

                'reconciliation',



            status:

                'UP',



            statistics:

                {

                    ...this.statistics

                }


        };


    }



}



module.exports = MTNReconciliation;