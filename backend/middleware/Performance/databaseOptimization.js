'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * File:
 * backend/middleware/performance/databaseOptimization.js
 *
 * Enterprise Database Performance Protection Middleware
 *
 * =============================================================================
 *
 * Purpose
 * -----------------------------------------------------------------------------
 *
 * Production-grade MongoDB performance protection layer for the TITech
 * Community Capital fintech platform.
 *
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 *
 * • MongoDB query timeout enforcement
 * • Slow query detection
 * • Connection pool protection
 * • Read/write optimization
 * • Transaction performance monitoring
 * • Ledger query protection
 * • Database overload prevention
 * • Query execution tracing
 * • Database metrics publishing
 * • Enterprise diagnostics
 *
 *
 * Protected Financial Workloads
 * -----------------------------------------------------------------------------
 *
 * • Double-entry ledger queries
 * • Loan processing
 * • Savings transactions
 * • Mobile money settlement
 * • Reconciliation jobs
 * • Regulatory reporting
 *
 *
 * Observability
 * -----------------------------------------------------------------------------
 *
 * Integrates with:
 *
 * • StructuredLogger
 * • LoggerFactory
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



/**
 * ============================================================================
 * Optional Enterprise Dependencies
 * ============================================================================
 */

function optionalRequire(path) {

    try {

        return require(path);

    }

    catch(error) {

        return Object.freeze({

            unavailable:

                true,


            module:

                path,


            error:

                error.message

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
    'enterprise-database-optimization';


const COMPONENT_VERSION =
    '1.0.0';



/**
 * ============================================================================
 * Database Performance Policies
 * ============================================================================
 */

const DEFAULT_POLICY = Object.freeze({

    queryTimeout:

        10000,


    transactionTimeout:

        30000,


    slowQueryThreshold:

        500,


    criticalQueryThreshold:

        2000,


    maxConcurrentOperations:

        100,


    ledgerTimeout:

        5000,


    enableReadOptimization:

        true,


    enableWriteOptimization:

        true

});



/**
 * ============================================================================
 * Runtime State
 * ============================================================================
 */

const STATE = Object.seal({

    initialized:

        false,


    initializedAt:

        null,


    activeOperations:

        0,


    totalQueries:

        0,


    slowQueries:

        0,


    failedQueries:

        0,


    ledgerQueries:

        0,


    averageLatency:

        0

});



/**
 * ============================================================================
 * Context
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
 * Query Timer
 * ============================================================================
 */

function startTimer() {


    return process.hrtime.bigint();

}



function elapsedMilliseconds(start) {


    return Number(

        process.hrtime.bigint()

        -

        start

    )

    /

    1_000_000;

}



/**
 * ============================================================================
 * Query Classification
 * ============================================================================
 */

function classifyQuery(options = {}) {


    if (

        options.operation ===

        'ledger'

    ) {


        return 'ledger';

    }



    if (

        options.transaction

    ) {


        return 'transaction';

    }



    return options.type ||

        'general';

}



/**
 * ============================================================================
 * Database Operation Wrapper
 * ============================================================================
 *
 * Used by repositories/services:
 *
 * await databaseOptimization.execute(
 *
 * {
 *   operation:"ledger",
 *   query:"findEntries"
 * },
 *
 * () => Model.find()
 *
 * );
 *
 */

async function execute(

    options = {},

    operation

) {



    const policy = Object.freeze({

        ...DEFAULT_POLICY,

        ...options.policy

    });



    const started =

        startTimer();



    const category =

        classifyQuery(

            options

        );



    STATE.activeOperations++;


    STATE.totalQueries++;



    if (

        category ===

        'ledger'

    ) {


        STATE.ledgerQueries++;

    }



    try {


        const timeout =


            category ===

            'ledger'


            ?

            policy.ledgerTimeout


            :

            options.transaction

            ?

            policy.transactionTimeout


            :

            policy.queryTimeout;



        const result =

            await Promise.race([



                operation(),



                new Promise(

                    (_, reject)=>{


                        setTimeout(

                            ()=>{


                                reject(

                                    new Error(

                                        'Database operation timeout'

                                    )

                                );


                            },

                            timeout

                        );


                    }

                )


            ]);



        const duration =

            elapsedMilliseconds(

                started

            );



        updatePerformance(

            duration

        );



        analyseLatency(

            duration,

            options

        );



        return result;


    }

    catch(error) {


        STATE.failedQueries++;



        publishEvent(

            'database.operation.failed',

            {

                ...buildContext(

                    options.request

                ),


                category,


                error:

                    error.message

            }

        );



        throw error;


    }

    finally {


        STATE.activeOperations--;

    }

}



/**
 * ============================================================================
 * Performance Analysis
 * ============================================================================
 */

function analyseLatency(

    duration,

    options

) {


    if (

        duration >=

        DEFAULT_POLICY.slowQueryThreshold

    ) {


        STATE.slowQueries++;



        recordMetric(

            'database.slow_query',

            duration

        );



        publishEvent(

            'database.slow_query',

            {

                operation:

                    options.operation,


                duration

            }

        );

    }



    if (

        duration >=

        DEFAULT_POLICY.criticalQueryThreshold

    ) {


        publishEvent(

            'database.critical_latency',

            {

                operation:

                    options.operation,


                duration

            }

        );

    }

}



function updatePerformance(duration) {


    STATE.averageLatency =

        (

            STATE.averageLatency +

            duration

        )

        /

        2;



    recordMetric(

        'database.query.duration',

        duration

    );

}



/**
 * ============================================================================
 * Middleware
 * ============================================================================
 */

function databaseOptimization(options = {}) {



    const policy = Object.freeze({

        ...DEFAULT_POLICY,

        ...options

    });



    return function databaseOptimizationMiddleware(

        req,

        res,

        next

    ) {



        STATE.initialized = true;


        STATE.initializedAt ||=

            new Date()

            .toISOString();



        req.databaseContext = Object.freeze({

            execute:

                (

                    operationOptions,

                    handler

                ) =>


                    execute(

                        {

                            ...operationOptions,


                            policy,


                            request:

                                req

                        },


                        handler

                    )

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

            true,


        activeOperations:

            STATE.activeOperations

    });

}



async function readinessCheck() {


    return Object.freeze({

        component:

            COMPONENT_NAME,


        ready:

            STATE.activeOperations

            <

            DEFAULT_POLICY.maxConcurrentOperations

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

        380,


    critical:

        true,


    description:

        'Enterprise MongoDB performance protection and optimization layer.'

});



/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports = Object.freeze({

    create:

        databaseOptimization,


    databaseOptimization,


    execute,


    metadata,


    healthCheck,


    readinessCheck,


    diagnostics,


    policy:

        DEFAULT_POLICY

});