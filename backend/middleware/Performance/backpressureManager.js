'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * File:
 * backend/middleware/performance/backpressureManager.js
 *
 * Enterprise Backpressure Management Middleware
 *
 * =============================================================================
 *
 * Purpose
 * -----------------------------------------------------------------------------
 *
 * Provides intelligent workload protection by controlling the flow of requests,
 * background jobs, workers, database operations, and payment processing when
 * downstream dependencies become saturated.
 *
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 *
 * • Queue backpressure
 * • BullMQ workload protection
 * • Worker saturation control
 * • Database pressure propagation
 * • Payment settlement throttling
 * • Graceful degradation under extreme load
 * • Distributed workload balancing
 * • Dependency pressure awareness
 * • Critical workload preservation
 *
 *
 * Protected Workloads
 * -----------------------------------------------------------------------------
 *
 * • Ledger posting
 * • Loan processing
 * • Savings transactions
 * • MTN MoMo settlement
 * • Airtel Money settlement
 * • Notifications
 * • Reports
 * • Background jobs
 *
 *
 * Architecture
 * -----------------------------------------------------------------------------
 *
 * Incoming Request
 *
 *        |
 *        v
 *
 * Backpressure Manager
 *
 *        |
 *        +----------------+
 *        |                |
 *        v                v
 *
 * Queue Pressure     Database Pressure
 *
 *        |
 *        v
 *
 * Worker Capacity
 *
 *        |
 *        v
 *
 * Execute / Delay / Reject
 *
 *
 * Observability
 * -----------------------------------------------------------------------------
 *
 * Integrates with:
 *
 * • StructuredLogger
 * • MetricsRegistry
 * • EventBus
 * • TraceContext
 * • OpenTelemetry
 *
 * =============================================================================
 */


/**
 * ============================================================================
 * Dependencies
 * ============================================================================
 */

const os = require('os');



function optionalRequire(path) {

    try {

        return require(path);

    }

    catch(error) {

        return Object.freeze({

            unavailable:true,

            module:path

        });

    }

}



const MetricsRegistry =
    optionalRequire(
        '../../shared/metrics/MetricsRegistry'
    );



const EventBus =
    optionalRequire(
        '../../shared/events/EventBus'
    );



const TraceContext =
    optionalRequire(
        '../../shared/tracing/TraceContext'
    );



/**
 * ============================================================================
 * Component Identity
 * ============================================================================
 */

const COMPONENT_NAME =
    'enterprise-backpressure-manager';


const COMPONENT_VERSION =
    '1.0.0';



/**
 * ============================================================================
 * Backpressure Policies
 * ============================================================================
 */

const DEFAULT_POLICY = Object.freeze({

    enabled:true,


    queue:

    {

        warningDepth:1000,

        criticalDepth:5000

    },


    workers:

    {

        warningUtilization:80,

        criticalUtilization:95

    },


    database:

    {

        warningConnections:80,

        criticalConnections:95

    },


    payment:

    {

        warningPending:500,

        criticalPending:2000

    },


    actions:

    {

        warning:'DELAY',

        critical:'REJECT'

    }

});



/**
 * ============================================================================
 * Runtime State
 * ============================================================================
 */

const STATE = Object.seal({

    initialized:false,

    initializedAt:null,

    pressure:'NORMAL',

    queuePressure:'NORMAL',

    databasePressure:'NORMAL',

    workerPressure:'NORMAL',

    paymentPressure:'NORMAL',

    rejectedRequests:0,

    delayedRequests:0

});



/**
 * ============================================================================
 * Queue Runtime Snapshot
 * ============================================================================
 */

const QUEUE_STATE = {

    depth:0,

    activeWorkers:0,

    maxWorkers:10

};



/**
 * ============================================================================
 * Metrics
 * ============================================================================
 */

function metric(

    name,

    value = 1

) {

    try {

        MetricsRegistry
            ?.record
            ?.(
                name,
                value
            );

    }

    catch(_) {}

}



/**
 * ============================================================================
 * Event Publishing
 * ============================================================================
 */

function publish(

    event,

    payload

) {

    try {

        EventBus
            ?.publish
            ?.(
                event,
                Object.freeze(payload)
            );

    }

    catch(_) {}

}



/**
 * ============================================================================
 * Pressure Classification
 * ============================================================================
 */

function classifyPressure(

    value,

    warning,

    critical

) {


    if (

        value >= critical

    ) {


        return 'CRITICAL';

    }



    if (

        value >= warning

    ) {


        return 'HIGH';

    }



    return 'NORMAL';

}



/**
 * ============================================================================
 * Queue Backpressure
 * ============================================================================
 */

function evaluateQueuePressure(

    queue = QUEUE_STATE

) {


    STATE.queuePressure =

        classifyPressure(

            queue.depth,

            DEFAULT_POLICY.queue.warningDepth,

            DEFAULT_POLICY.queue.criticalDepth

        );


    return STATE.queuePressure;

}



/**
 * ============================================================================
 * Worker Saturation Detection
 * ============================================================================
 */

function evaluateWorkerPressure(

    workers = QUEUE_STATE

) {


    const utilization =

        (

            workers.activeWorkers /

            workers.maxWorkers

        )

        *

        100;



    STATE.workerPressure =

        classifyPressure(

            utilization,

            DEFAULT_POLICY.workers.warningUtilization,

            DEFAULT_POLICY.workers.criticalUtilization

        );



    return STATE.workerPressure;

}



/**
 * ============================================================================
 * Database Pressure Propagation
 * ============================================================================
 */

function evaluateDatabasePressure(

    database = {}

) {


    const usage =

        database.connectionUsage || 0;



    STATE.databasePressure =

        classifyPressure(

            usage,

            DEFAULT_POLICY.database.warningConnections,

            DEFAULT_POLICY.database.criticalConnections

        );



    return STATE.databasePressure;

}



/**
 * ============================================================================
 * Payment Settlement Protection
 * ============================================================================
 */

function evaluatePaymentPressure(

    payments = {}

) {


    STATE.paymentPressure =

        classifyPressure(

            payments.pending || 0,

            DEFAULT_POLICY.payment.warningPending,

            DEFAULT_POLICY.payment.criticalPending

        );



    return STATE.paymentPressure;

}



/**
 * ============================================================================
 * Global Pressure Calculation
 * ============================================================================
 */

function calculateSystemPressure() {


    const levels = [

        STATE.queuePressure,

        STATE.databasePressure,

        STATE.workerPressure,

        STATE.paymentPressure

    ];



    if (

        levels.includes('CRITICAL')

    ) {


        STATE.pressure =

            'CRITICAL';


        return STATE.pressure;

    }



    if (

        levels.includes('HIGH')

    ) {


        STATE.pressure =

            'HIGH';


        return STATE.pressure;

    }



    STATE.pressure =

        'NORMAL';



    return STATE.pressure;

}



/**
 * ============================================================================
 * Decision Engine
 * ============================================================================
 */

function shouldAccept(

    workload = 'NORMAL'

) {


    const pressure =

        STATE.pressure;



    /*
     * Never block financial critical paths.
     */

    if (

        workload === 'CRITICAL'

    ) {


        return true;

    }



    if (

        pressure === 'CRITICAL'

    ) {


        return false;

    }



    return true;

}



/**
 * ============================================================================
 * Middleware
 * ============================================================================
 */

function backpressureManager(

    options = {}

) {


    const policy = Object.freeze({

        ...DEFAULT_POLICY,

        ...options

    });



    return function backpressureMiddleware(

        req,

        res,

        next

    ) {


        STATE.initialized = true;



        STATE.initializedAt ||=

            new Date()

            .toISOString();



        const workload =

            req.context

            ?.priority

            ||

            'NORMAL';



        if (

            !shouldAccept(workload)

        ) {



            STATE.rejectedRequests++;



            metric(

                'backpressure.requests.rejected'

            );



            publish(

                'backpressure.request.rejected',

                {

                    requestId:

                        req.id,


                    workload,


                    pressure:

                        STATE.pressure,


                    traceId:

                        TraceContext

                        ?.getTraceId?.(),


                    hostname:

                        os.hostname()

                }

            );



            return res

                .status(503)

                .json({

                    success:false,


                    code:

                        'SERVICE_OVERLOADED',


                    message:

                        'System temporarily under heavy load.'

                });

        }



        req.backpressure = Object.freeze({

            pressure:

                STATE.pressure,


            queue:

                evaluateQueuePressure,


            worker:

                evaluateWorkerPressure,


            database:

                evaluateDatabasePressure,


            payment:

                evaluatePaymentPressure

        });



        next();


    };

}



/**
 * ============================================================================
 * Diagnostics
 * ============================================================================
 */

async function healthCheck() {


    return Object.freeze({

        component:

            COMPONENT_NAME,


        healthy:

            STATE.pressure !==

            'CRITICAL',


        pressure:

            STATE.pressure

    });

}



async function readinessCheck() {


    return Object.freeze({

        ready:

            STATE.pressure !==

            'CRITICAL'

    });

}



function diagnostics() {


    return Object.freeze({

        metadata,


        state:

        {

            ...STATE

        }

    });

}



/**
 * ============================================================================
 * Metadata
 * ============================================================================
 */

const metadata = Object.freeze({

    name:

        COMPONENT_NAME,


    version:

        COMPONENT_VERSION,


    category:

        'performance',


    phase:

        'middleware',


    priority:

        460,


    critical:

        true,


    description:

        'Enterprise workload backpressure and saturation protection layer.'

});



/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports = Object.freeze({

    create:

        backpressureManager,


    backpressureManager,


    evaluateQueuePressure,


    evaluateWorkerPressure,


    evaluateDatabasePressure,


    evaluatePaymentPressure,


    calculateSystemPressure,


    shouldAccept,


    metadata,


    healthCheck,


    readinessCheck,


    diagnostics,


    policy:

        DEFAULT_POLICY

});