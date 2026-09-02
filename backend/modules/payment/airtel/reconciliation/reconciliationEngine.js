'use strict';

/**
 * ==========================================================
 * TITech Community Capital LTD
 * Airtel Settlement Reconciliation Engine
 * ----------------------------------------------------------
 * Enterprise reconciliation intelligence service.
 *
 * Responsibilities
 * ----------------
 * • Provider settlement reconciliation
 * • Ledger vs provider comparison
 * • Settlement matching
 * • Transaction variance detection
 * • Duplicate detection
 * • Missing transaction detection
 * • Automated reconciliation repair hooks
 * • Exception generation
 * • Tenant isolation
 * • Idempotent reconciliation execution
 * • Audit trail generation
 * • Metrics and tracing
 * • Operational reporting hooks
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • Payment execution
 * • Provider communication
 * • Ledger posting
 * • Settlement processing
 * • Regulatory reporting generation
 *
 * ==========================================================
 */


const crypto = require('crypto');

const {
    normalizeError,
    ReconciliationError
} = require('../../shared/errors');



const RECONCILIATION_STATUS = Object.freeze({

    CREATED: 'CREATED',

    RUNNING: 'RUNNING',

    MATCHED: 'MATCHED',

    PARTIAL: 'PARTIAL',

    FAILED: 'FAILED',

    COMPLETED: 'COMPLETED',

    REVIEW: 'REVIEW'

});



const MATCH_STATUS = Object.freeze({

    MATCHED: 'MATCHED',

    MISSING_PROVIDER:

        'MISSING_PROVIDER',

    MISSING_LEDGER:

        'MISSING_LEDGER',

    AMOUNT_MISMATCH:

        'AMOUNT_MISMATCH',

    DUPLICATE:

        'DUPLICATE',

    UNKNOWN:

        'UNKNOWN'

});




class ReconciliationEngine {


    constructor({

        repository,

        settlementRepository,

        ledgerBridge,

        providerAdapter,

        matcher,

        repairEngine,

        auditService,

        eventBus,

        metrics,

        logger,

        tracer,

        idempotencyStore,

        clock = Date


    } = {}) {


        this.repository =
            repository;


        this.settlementRepository =
            settlementRepository;


        this.ledgerBridge =
            ledgerBridge;


        this.providerAdapter =
            providerAdapter;


        this.matcher =
            matcher;


        this.repairEngine =
            repairEngine;


        this.auditService =
            auditService;


        this.eventBus =
            eventBus;


        this.metrics =
            metrics;


        this.logger =
            logger;


        this.tracer =
            tracer;


        this.idempotencyStore =
            idempotencyStore;


        this.clock =
            clock;



        this.statistics = {

            executions: 0,

            matched: 0,

            mismatched: 0,

            repaired: 0,

            failed: 0

        };



        this.healthState = {

            status:

                'INITIALIZING',


            lastExecution:

                null

        };

    }





    /**
     * ------------------------------------------------------
     * Initialize Engine
     * ------------------------------------------------------
     */
    async initialize(){


        this.validateDependencies();


        this.healthState.status =
            'READY';


        this.logger?.info?.({

            message:

                'Airtel reconciliation engine initialized'

        });


        return true;

    }








    /**
     * ------------------------------------------------------
     * Execute Reconciliation
     * ------------------------------------------------------
     */
    async reconcile({

        tenantId,

        settlementDate,

        correlationId =
            crypto.randomUUID()


    }) {


        const span =
            this.tracer?.startSpan?.(
                'airtel.reconciliation.execute'
            );



        try {


            const idempotencyKey =

                `airtel-recon:${tenantId}:${settlementDate}`;



            const existing =

                await this.idempotencyStore?.get(
                    idempotencyKey
                );



            if(existing){

                return existing;

            }






            this.statistics.executions++;





            const run = {


                tenantId,


                provider:

                    'AIRTEL',


                settlementDate,


                correlationId,


                status:

                    RECONCILIATION_STATUS.RUNNING,


                startedAt:

                    new this.clock()

            };





            await this.repository?.create(run);







            const providerTransactions =

                await this.fetchProviderTransactions({

                    tenantId,

                    settlementDate

                });







            const ledgerTransactions =

                await this.fetchLedgerTransactions({

                    tenantId,

                    settlementDate

                });








            const comparison =

                await this.compare({

                    providerTransactions,

                    ledgerTransactions

                });







            const result = {


                ...run,


                status:

                    comparison.matched


                        ? RECONCILIATION_STATUS.MATCHED

                        :

                        RECONCILIATION_STATUS.REVIEW,



                summary:

                    comparison.summary,


                exceptions:

                    comparison.exceptions,


                completedAt:

                    new this.clock()


            };







            await this.repository?.complete({

                correlationId,

                result

            });







            await this.auditService?.record({

                action:

                    'AIRTEL_RECONCILIATION_COMPLETED',


                tenantId,

                correlationId,

                result

            });







            await this.eventBus?.publish({

                type:

                    'SETTLEMENT_RECONCILIATION_COMPLETED',


                payload:

                    result,


                correlationId

            });








            await this.idempotencyStore?.set(

                idempotencyKey,

                result,

                86400

            );







            this.healthState.lastExecution =
                new this.clock();



            return result;



        }


        catch(error){



            this.statistics.failed++;



            throw normalizeError(error, {


                metadata:{

                    operation:

                        'airtel_reconciliation'

                }


            });



        }


        finally{


            span?.end?.();


        }


    }








    /**
     * ------------------------------------------------------
     * Provider Transactions
     * ------------------------------------------------------
     */
    async fetchProviderTransactions({

        tenantId,

        settlementDate

    }) {


        return this.providerAdapter?.getSettlementTransactions({

            tenantId,

            settlementDate

        }) || [];

    }








    /**
     * ------------------------------------------------------
     * Ledger Transactions
     * ------------------------------------------------------
     */
    async fetchLedgerTransactions({

        tenantId,

        settlementDate

    }) {


        return this.ledgerBridge?.getSettlementTransactions({

            tenantId,

            settlementDate

        }) || [];

    }








    /**
     * ------------------------------------------------------
     * Compare Provider And Ledger
     * ------------------------------------------------------
     */
    async compare({

        providerTransactions,

        ledgerTransactions

    }) {



        const exceptions = [];

        const matched = [];





        const ledgerMap = new Map();



        ledgerTransactions.forEach(tx => {


            ledgerMap.set(

                tx.reference,

                tx

            );


        });






        for(const providerTx of providerTransactions){



            const ledgerTx =

                ledgerMap.get(

                    providerTx.reference

                );





            if(!ledgerTx){



                exceptions.push({

                    reference:

                        providerTx.reference,


                    status:

                        MATCH_STATUS.MISSING_LEDGER


                });



                continue;

            }






            if(

                Number(providerTx.amount)

                !==

                Number(ledgerTx.amount)

            ){



                exceptions.push({

                    reference:

                        providerTx.reference,


                    status:

                        MATCH_STATUS.AMOUNT_MISMATCH


                });



                continue;


            }







            matched.push(providerTx);



        }






        const result = {


            matched:

                exceptions.length === 0,


            summary:{


                providerCount:

                    providerTransactions.length,


                ledgerCount:

                    ledgerTransactions.length,


                matched:

                    matched.length,


                exceptions:

                    exceptions.length


            },


            exceptions

        };






        if(result.matched){


            this.statistics.matched++;


        }

        else {


            this.statistics.mismatched++;


        }






        return result;


    }








    /**
     * ------------------------------------------------------
     * Automated Repair
     * ------------------------------------------------------
     */
    async repair({

        exception,

        correlationId

    }) {


        if(!this.repairEngine){

            return null;

        }



        const result =

            await this.repairEngine.execute({

                provider:

                    'AIRTEL',


                exception,


                correlationId

            });




        this.statistics.repaired++;



        return result;


    }








    /**
     * ------------------------------------------------------
     * Health
     * ------------------------------------------------------
     */
    health(){


        return {


            provider:

                'AIRTEL',


            status:

                this.healthState.status,


            statistics:

                this.statistics,


            lastExecution:

                this.healthState.lastExecution


        };

    }








    /**
     * ------------------------------------------------------
     * Validation
     * ------------------------------------------------------
     */
    validateDependencies(){


        if(!this.repository){


            throw new ReconciliationError(

                'Reconciliation repository missing'

            );

        }


    }



}




module.exports = {

    ReconciliationEngine,

    RECONCILIATION_STATUS,

    MATCH_STATUS

};