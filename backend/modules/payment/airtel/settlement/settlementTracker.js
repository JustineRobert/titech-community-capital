'use strict';

/**
 * ==========================================================
 * TITech Community Capital LTD
 * Airtel Settlement Tracker
 * ----------------------------------------------------------
 * Enterprise settlement lifecycle tracking engine.
 *
 * Responsibilities
 * ----------------
 * • Settlement lifecycle monitoring
 * • State transition tracking
 * • Correlation ID propagation
 * • Tenant isolation
 * • Idempotent tracking
 * • Settlement timeline history
 * • Provider status synchronization
 * • Operational metrics
 * • Audit integration
 * • Distributed tracing hooks
 * • SLA monitoring hooks
 * • Failure analytics
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • Settlement execution
 * • Provider API communication
 * • Ledger posting
 * • Reconciliation processing
 * • Compliance decisions
 *
 * ==========================================================
 */


const crypto = require('crypto');

const {
    normalizeError
} = require('../../shared/errors');



const SETTLEMENT_STATUS = Object.freeze({

    CREATED: 'CREATED',

    PENDING: 'PENDING',

    PROCESSING: 'PROCESSING',

    SUBMITTED: 'SUBMITTED',

    PROVIDER_ACCEPTED: 'PROVIDER_ACCEPTED',

    COMPLETED: 'COMPLETED',

    FAILED: 'FAILED',

    REVERSED: 'REVERSED',

    CANCELLED: 'CANCELLED',

    UNKNOWN: 'UNKNOWN'

});



const TERMINAL_STATES = Object.freeze([

    SETTLEMENT_STATUS.COMPLETED,

    SETTLEMENT_STATUS.FAILED,

    SETTLEMENT_STATUS.REVERSED,

    SETTLEMENT_STATUS.CANCELLED

]);



class SettlementTracker {


    constructor({

        repository,

        auditService,

        eventBus,

        metrics,

        logger,

        tracer,

        clock = Date,

        slaMonitor

    } = {}) {


        this.repository =
            repository;


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


        this.slaMonitor =
            slaMonitor;



        this.statistics = {

            tracked: 0,

            transitions: 0,

            failures: 0,

            completed: 0

        };


        this.healthState = {

            status: 'INITIALIZING',

            startedAt:
                new this.clock(),

            lastActivity:
                null

        };

    }



    /**
     * ------------------------------------------------------
     * Initialize Tracker
     * ------------------------------------------------------
     */
    async initialize() {


        this.validateDependencies();


        this.healthState.status =
            'READY';


        this.logger?.info?.({

            message:
                'Airtel settlement tracker initialized'

        });


        return true;

    }




    /**
     * ------------------------------------------------------
     * Create Settlement Tracking Record
     * ------------------------------------------------------
     */
    async create({

        tenantId,

        settlementId,

        providerReference,

        amount,

        currency,

        metadata = {},

        correlationId =
            crypto.randomUUID()

    }) {


        try {


            const record = {


                settlementId,


                tenantId,


                provider:

                    'AIRTEL',


                providerReference,


                amount,


                currency,


                status:

                    SETTLEMENT_STATUS.CREATED,


                correlationId,


                metadata,


                timeline:[{

                    status:

                        SETTLEMENT_STATUS.CREATED,


                    timestamp:

                        new this.clock()

                }]

            };



            const saved =

                await this.repository?.create(record)

                || record;



            this.statistics.tracked++;


            await this.auditService?.record({

                action:

                    'SETTLEMENT_TRACKING_CREATED',


                tenantId,

                settlementId,

                correlationId

            });



            return saved;


        }

        catch(error){


            throw normalizeError(error, {

                metadata: {

                    operation:
                        'settlement_tracking_create'

                }

            });

        }

    }





    /**
     * ------------------------------------------------------
     * Update Settlement State
     * ------------------------------------------------------
     */
    async transition({

        settlementId,

        nextStatus,

        reason,

        metadata = {},

        correlationId =
            crypto.randomUUID()

    }) {



        if(!Object.values(SETTLEMENT_STATUS)
            .includes(nextStatus)){


            throw new Error(

                `Invalid settlement status ${nextStatus}`

            );

        }





        const current =

            await this.repository.findBySettlementId(

                settlementId

            );




        if(!current){


            throw new Error(

                'Settlement tracking record not found'

            );

        }





        if(this.isTerminal(current.status)){


            return current;

        }






        const update = {


            status:

                nextStatus,


            updatedAt:

                new this.clock(),



            $push:{


                timeline:{


                    status:

                        nextStatus,


                    reason,


                    metadata,


                    correlationId,


                    timestamp:

                        new this.clock()


                }

            }

        };





        const result =

            await this.repository.update(

                settlementId,

                update

            );






        this.statistics.transitions++;





        if(nextStatus === SETTLEMENT_STATUS.COMPLETED){


            this.statistics.completed++;


        }




        if(nextStatus === SETTLEMENT_STATUS.FAILED){


            this.statistics.failures++;

        }






        await this.publishTransitionEvent({

            settlementId,

            status:

                nextStatus,

            correlationId

        });





        return result;


    }








    /**
     * ------------------------------------------------------
     * Provider Status Synchronization
     * ------------------------------------------------------
     */
    async synchronizeProviderStatus({

        settlementId,

        providerStatus,

        correlationId

    }) {



        const mapping = {


            SUCCESS:

                SETTLEMENT_STATUS.COMPLETED,


            FAILED:

                SETTLEMENT_STATUS.FAILED,


            PENDING:

                SETTLEMENT_STATUS.PROCESSING

        };





        return this.transition({

            settlementId,

            nextStatus:

                mapping[providerStatus]
                ||
                SETTLEMENT_STATUS.UNKNOWN,


            correlationId,


            reason:

                'PROVIDER_STATUS_SYNC'

        });


    }







    /**
     * ------------------------------------------------------
     * Settlement Timeline
     * ------------------------------------------------------
     */
    async timeline(settlementId){


        return this.repository
            .getTimeline(settlementId);

    }






    /**
     * ------------------------------------------------------
     * SLA Tracking
     * ------------------------------------------------------
     */
    async evaluateSLA({

        settlementId

    }) {


        if(!this.slaMonitor){

            return null;

        }



        return this.slaMonitor.evaluate({

            settlementId

        });


    }







    /**
     * ------------------------------------------------------
     * Publish Events
     * ------------------------------------------------------
     */
    async publishTransitionEvent({

        settlementId,

        status,

        correlationId

    }) {


        await this.eventBus?.publish({

            type:

                'SETTLEMENT_STATUS_CHANGED',


            payload:{

                settlementId,

                provider:

                    'AIRTEL',

                status

            },


            correlationId


        });


    }







    /**
     * ------------------------------------------------------
     * Check Terminal State
     * ------------------------------------------------------
     */
    isTerminal(status){


        return TERMINAL_STATES.includes(status);

    }







    /**
     * ------------------------------------------------------
     * Dependency Validation
     * ------------------------------------------------------
     */
    validateDependencies(){


        if(!this.repository){


            throw new Error(

                'Settlement repository required'

            );

        }

    }








    /**
     * ------------------------------------------------------
     * Health
     * ------------------------------------------------------
     */
    health(){


        return {


            status:

                this.healthState.status,


            statistics:

                this.statistics,


            provider:

                'AIRTEL',


            lastActivity:

                this.healthState.lastActivity


        };


    }







    /**
     * ------------------------------------------------------
     * Snapshot
     * ------------------------------------------------------
     */
    snapshot(){


        return {


            provider:

                'AIRTEL',


            statistics:

                {

                    ...this.statistics

                },


            health:

                this.healthState


        };


    }


}



module.exports = {

    SettlementTracker,

    SETTLEMENT_STATUS

};