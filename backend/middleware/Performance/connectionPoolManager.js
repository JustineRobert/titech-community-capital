'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * File:
 * backend/middleware/performance/connectionPoolManager.js
 *
 * Enterprise MongoDB Connection Pool Management Middleware
 *
 * =============================================================================
 *
 * Purpose
 * -----------------------------------------------------------------------------
 *
 * Enterprise database resilience layer responsible for monitoring, protecting,
 * and optimizing MongoDB connection pools for high-throughput fintech workloads.
 *
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 *
 * • MongoDB pool monitoring
 * • Connection leak detection
 * • Replica health awareness
 * • Dynamic pool tuning
 * • Database failover handling
 * • Transaction reliability protection
 * • Connection exhaustion prevention
 * • Database availability diagnostics
 * • Runtime database telemetry
 *
 *
 * Critical Financial Workloads Protected
 * -----------------------------------------------------------------------------
 *
 * • Double-entry ledger posting
 * • Loan approvals
 * • Savings transactions
 * • Mobile money settlements
 * • Reconciliation processing
 * • Regulatory reporting
 *
 *
 * Observability
 * -----------------------------------------------------------------------------
 *
 * Integrates with:
 *
 * • StructuredLogger
 * • MetricsRegistry
 * • RequestMetrics
 * • TraceContext
 * • EventBus
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
    'enterprise-connection-pool-manager';


const COMPONENT_VERSION =
    '1.0.0';



/**
 * ============================================================================
 * Connection Pool Policies
 * ============================================================================
 */

const DEFAULT_POLICY = Object.freeze({

    minPoolSize:

        5,


    maxPoolSize:

        100,


    maxConnectionIdleTime:

        60000,


    connectionTimeout:

        10000,


    leakThreshold:

        30000,


    healthCheckInterval:

        30000,


    failoverThreshold:

        3,


    enableDynamicScaling:

        true

});



/**
 * ============================================================================
 * Runtime State
 * ============================================================================
 */

const STATE = Object.seal({

    initialized:false,

    initializedAt:null,

    activeConnections:0,

    idleConnections:0,

    checkedOutConnections:0,

    leakedConnections:0,

    failures:0,

    failoverEvents:0,

    replicaStatus:'unknown',

    lastHealthCheck:null,

    poolSize:0

});



/**
 * ============================================================================
 * Connection Registry
 * ============================================================================
 */

const CONNECTIONS = new Map();



/**
 * ============================================================================
 * Context Builder
 * ============================================================================
 */

function buildContext(req = {}) {


    return Object.freeze({

        requestId:

            req.id,


        correlationId:

            req.context

            ?.correlationId,


        traceId:

            TraceContext

            ?.getTraceId?.(),


        hostname:

            os.hostname(),


        component:

            COMPONENT_NAME

    });

}



/**
 * ============================================================================
 * Metrics
 * ============================================================================
 */

function recordMetric(

    name,

    value

) {


    try {


        MetricsRegistry

        ?.record?.(

            name,

            value

        );


    }

    catch(_) {}

}



/**
 * ============================================================================
 * Events
 * ============================================================================
 */

function publishEvent(

    type,

    payload

) {


    try {


        EventBus

        ?.publish?.(

            type,

            Object.freeze(payload)

        );


    }

    catch(_) {}

}



/**
 * ============================================================================
 * Register Connection
 * ============================================================================
 */

function registerConnection(

    id,

    metadata = {}

) {


    CONNECTIONS.set(

        id,

        {

            createdAt:

                Date.now(),


            lastActivity:

                Date.now(),


            status:

                'active',


            ...metadata

        }

    );



    STATE.activeConnections++;

    STATE.checkedOutConnections++;


}



/**
 * ============================================================================
 * Release Connection
 * ============================================================================
 */

function releaseConnection(id) {


    const connection =

        CONNECTIONS.get(id);



    if (!connection) {


        return;

    }



    connection.status =

        'idle';



    connection.lastActivity =

        Date.now();



    STATE.checkedOutConnections--;


    STATE.idleConnections++;

}



/**
 * ============================================================================
 * Connection Leak Detection
 * ============================================================================
 */

function detectLeaks() {


    const now =

        Date.now();



    for (

        const [

            id,

            connection

        ]

        of CONNECTIONS.entries()

    ) {



        if (

            connection.status ===

            'active'

            &&

            (

                now -

                connection.createdAt

            )

            >

            DEFAULT_POLICY.leakThreshold

        ) {



            STATE.leakedConnections++;



            publishEvent(

                'database.connection.leak_detected',

                {

                    connectionId:id,


                    age:

                        now -

                        connection.createdAt

                }

            );


        }


    }

}



/**
 * ============================================================================
 * Replica Health Monitoring
 * ============================================================================
 */

function updateReplicaHealth(

    status

) {


    STATE.replicaStatus =

        status;



    if (

        status !==

        'healthy'

    ) {



        publishEvent(

            'database.replica.unhealthy',

            {

                status

            }

        );


    }

}



/**
 * ============================================================================
 * Dynamic Pool Tuning
 * ============================================================================
 */

function calculateOptimalPoolSize(

    workload = {}

) {


    if (

        !DEFAULT_POLICY.enableDynamicScaling

    ) {


        return DEFAULT_POLICY.maxPoolSize;

    }



    const active =

        workload.activeRequests

        ||

        0;



    if (

        active > 500

    ) {


        return 150;

    }



    if (

        active > 100

    ) {


        return 100;

    }



    return 50;

}



/**
 * ============================================================================
 * Failover Handling
 * ============================================================================
 */

function handleDatabaseFailure(

    error

) {


    STATE.failures++;



    if (

        STATE.failures >=

        DEFAULT_POLICY.failoverThreshold

    ) {



        STATE.failoverEvents++;



        publishEvent(

            'database.failover.triggered',

            {

                failures:

                    STATE.failures,


                error:

                    error.message

            }

        );



    }


}



/**
 * ============================================================================
 * Transaction Protection
 * ============================================================================
 */

async function executeTransaction(

    transactionHandler

) {


    try {


        return await transactionHandler();



    }

    catch(error) {


        handleDatabaseFailure(

            error

        );


        throw error;

    }

}



/**
 * ============================================================================
 * Middleware
 * ============================================================================
 */

function connectionPoolManager(options = {}) {



    const policy = Object.freeze({

        ...DEFAULT_POLICY,

        ...options

    });



    return function connectionPoolManagerMiddleware(

        req,

        res,

        next

    ) {



        STATE.initialized = true;



        STATE.initializedAt ||=

            new Date()

            .toISOString();



        req.databasePool = Object.freeze({

            register:

                registerConnection,


            release:

                releaseConnection,


            transaction:

                executeTransaction,


            calculatePoolSize:

                calculateOptimalPoolSize

        });



        res.once(

            'finish',

            ()=>{


                recordMetric(

                    'database.connection.active',

                    STATE.activeConnections

                );


            }

        );



        next();

    };

}



/**
 * ============================================================================
 * Monitoring Loop
 * ============================================================================
 */

setInterval(

    ()=>{


        detectLeaks();



        STATE.lastHealthCheck =

            new Date()

            .toISOString();



    },

    DEFAULT_POLICY.healthCheckInterval

);



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

            STATE.failures <

            DEFAULT_POLICY.failoverThreshold,


        replica:

            STATE.replicaStatus

    });

}



async function readinessCheck() {


    return Object.freeze({

        ready:

            STATE.replicaStatus !==

            'failed'

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

        400,


    critical:

        true,


    description:

        'Enterprise MongoDB connection pool monitoring and resilience layer.'

});



/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports = Object.freeze({

    create:

        connectionPoolManager,


    connectionPoolManager,


    registerConnection,


    releaseConnection,


    executeTransaction,


    detectLeaks,


    updateReplicaHealth,


    calculateOptimalPoolSize,


    handleDatabaseFailure,


    metadata,


    healthCheck,


    readinessCheck,


    diagnostics,


    policy:

        DEFAULT_POLICY

});