'use strict';

/**
 * ==========================================================
 * TITech Community Capital LTD
 * Airtel Enterprise Reconciliation Service
 * ----------------------------------------------------------
 * Central orchestration service for Airtel reconciliation.
 *
 * Responsibilities
 * ----------------
 * • Reconciliation lifecycle orchestration
 * • Transaction collection coordination
 * • Matching engine integration
 * • Variance calculation
 * • Exception management
 * • Automated repair orchestration
 * • Report generation hooks
 * • Settlement reconciliation
 * • Ledger verification hooks
 * • Idempotent execution
 * • Tenant isolation
 * • Audit trail generation
 * • Event publishing
 * • Metrics and tracing
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • Airtel API communication
 * • Ledger writes
 * • Payment execution
 * • Settlement processing
 *
 * ==========================================================
 */


const crypto = require('crypto');

const {
    normalizeError,
    ReconciliationError
} = require('../../shared/errors');



const SERVICE_STATUS = Object.freeze({

    INITIALIZING: 'INITIALIZING',

    READY: 'READY',

    RUNNING: 'RUNNING',

    DEGRADED: 'DEGRADED',

    FAILED: 'FAILED'

});



const RECONCILIATION_MODE = Object.freeze({

    AUTOMATIC:

        'AUTOMATIC',


    MANUAL:

        'MANUAL',


    SCHEDULED:

        'SCHEDULED'

});







class ReconciliationService {


    constructor({

        reconciliationEngine,

        reconciliationMatcher,

        reconciliationReporter,

        settlementRepository,

        transactionRepository,

        exceptionRepository,

        repairEngine,

        ledgerBridge,

        providerAdapter,

        idempotencyEngine,

        auditService,

        eventBus,

        metrics,

        logger,

        tracer,

        clock = Date


    } = {}) {



        this.reconciliationEngine =
            reconciliationEngine;


        this.reconciliationMatcher =
            reconciliationMatcher;


        this.reconciliationReporter =
            reconciliationReporter;


        this.settlementRepository =
            settlementRepository;


        this.transactionRepository =
            transactionRepository;


        this.exceptionRepository =
            exceptionRepository;


        this.repairEngine =
            repairEngine;


        this.ledgerBridge =
            ledgerBridge;


        this.providerAdapter =
            providerAdapter;


        this.idempotencyEngine =
            idempotencyEngine;


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


        this.clock =
            clock;





        this.healthState = {


            status:

                SERVICE_STATUS.INITIALIZING,


            lastRun:

                null,


            lastFailure:

                null


        };





        this.statistics = {


            executions: 0,


            successful: 0,


            failed: 0,


            exceptions: 0,


            repairs: 0


        };



    }









    /**
     * ------------------------------------------------------
     * Initialize Service
     * ------------------------------------------------------
     */
    async initialize(){



        this.validateDependencies();



        await this.reconciliationEngine?.initialize?.();



        await this.reconciliationReporter?.initialize?.();





        this.healthState.status =

            SERVICE_STATUS.READY;






        this.logger?.info?.({

            message:

                'Airtel reconciliation service initialized'

        });




        return true;


    }









    /**
     * ------------------------------------------------------
     * Execute Reconciliation Workflow
     * ------------------------------------------------------
     */
    async execute({

        tenantId,

        settlementDate,

        mode = RECONCILIATION_MODE.AUTOMATIC,


        correlationId = crypto.randomUUID()


    }) {



        const span =

            this.tracer?.startSpan?.(

                'airtel.reconciliation.service.execute'

            );





        const idempotencyKey =


            `airtel-reconciliation:${tenantId}:${settlementDate}`;



        try {



            const previous =

                await this.idempotencyEngine?.check(

                    idempotencyKey

                );





            if(previous){

                return previous;

            }





            this.healthState.status =

                SERVICE_STATUS.RUNNING;



            this.statistics.executions++;







            const result =

                await this.reconciliationEngine.reconcile({

                    tenantId,

                    settlementDate,

                    correlationId

                });







            await this.processExceptions({

                tenantId,

                exceptions:

                    result.exceptions || [],

                correlationId

            });








            const report =

                await this.reconciliationReporter.generate({

                    tenantId,

                    reconciliationId:

                        result.correlationId,


                    data:

                        result,


                    correlationId


                });








            const response = {


                reconciliation:

                    result,


                report,


                completedAt:

                    new this.clock()


            };






            await this.idempotencyEngine?.store(

                idempotencyKey,

                response

            );






            await this.auditService?.record({

                action:

                    'AIRTEL_RECONCILIATION_EXECUTED',


                tenantId,

                correlationId,


                mode


            });






            await this.eventBus?.publish({

                type:

                    'AIRTEL_RECONCILIATION_COMPLETED',


                payload:

                    response,


                correlationId


            });






            this.statistics.successful++;


            this.healthState.lastRun =

                new this.clock();


            this.healthState.status =

                SERVICE_STATUS.READY;






            return response;



        }


        catch(error){



            this.statistics.failed++;



            this.healthState.lastFailure =

                new this.clock();



            this.healthState.status =

                SERVICE_STATUS.DEGRADED;





            throw normalizeError(error, {


                metadata:{

                    operation:

                        'airtel_reconciliation_service'

                }


            });



        }


        finally{


            span?.end?.();


        }


    }









    /**
     * ------------------------------------------------------
     * Process Exceptions
     * ------------------------------------------------------
     */
    async processExceptions({

        tenantId,

        exceptions,

        correlationId


    }) {



        if(!exceptions.length){

            return;

        }





        this.statistics.exceptions +=

            exceptions.length;





        for(const exception of exceptions){



            await this.exceptionRepository?.create({

                tenantId,

                provider:

                    'AIRTEL',


                exception,


                correlationId


            });




        }




        await this.eventBus?.publish({

            type:

                'AIRTEL_RECONCILIATION_EXCEPTION_CREATED',


            payload:{

                tenantId,

                count:

                    exceptions.length

            },


            correlationId


        });


    }









    /**
     * ------------------------------------------------------
     * Repair Failed Reconciliation
     * ------------------------------------------------------
     */
    async repair({

        exceptionId,

        correlationId = crypto.randomUUID()


    }) {



        if(!this.repairEngine){


            throw new ReconciliationError(

                'Repair engine unavailable'

            );


        }





        const result =

            await this.repairEngine.execute({

                exceptionId,

                provider:

                    'AIRTEL',

                correlationId


            });






        this.statistics.repairs++;






        await this.auditService?.record({

            action:

                'AIRTEL_RECONCILIATION_REPAIR_EXECUTED',


            exceptionId,

            correlationId


        });






        return result;


    }









    /**
     * ------------------------------------------------------
     * Manual Transaction Match
     * ------------------------------------------------------
     */
    async manualMatch({

        providerTransaction,

        ledgerTransaction


    }) {



        return this.reconciliationMatcher.match({

            providerTransaction,

            ledgerTransaction


        });


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


            lastRun:

                this.healthState.lastRun,


            lastFailure:

                this.healthState.lastFailure


        };


    }









    /**
     * ------------------------------------------------------
     * Snapshot
     * ------------------------------------------------------
     */
    snapshot(){


        return {


            health:

                this.healthState,


            statistics:

                this.statistics


        };


    }









    /**
     * ------------------------------------------------------
     * Validate Dependencies
     * ------------------------------------------------------
     */
    validateDependencies(){



        const required = [

            'reconciliationEngine',

            'transactionRepository'

        ];





        for(const dependency of required){



            if(!this[dependency]){



                throw new ReconciliationError(

                    `${dependency} dependency missing`

                );


            }


        }


    }


}




module.exports = {


    ReconciliationService,

    SERVICE_STATUS,

    RECONCILIATION_MODE


};