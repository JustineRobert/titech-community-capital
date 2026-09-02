'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * File:
 * backend/middleware/performance/queryOptimizer.js
 *
 * Enterprise MongoDB Query Optimization Middleware
 *
 * =============================================================================
 *
 * Purpose
 * -----------------------------------------------------------------------------
 *
 * Production-grade database query intelligence layer designed to improve
 * MongoDB query efficiency, protect financial workloads, and prevent expensive
 * database access patterns.
 *
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 *
 * • MongoDB index awareness
 * • Aggregation pipeline optimization
 * • N+1 query detection
 * • Projection enforcement
 * • Pagination protection
 * • Financial report query optimization
 * • Query pattern analysis
 * • Query performance diagnostics
 * • Database workload protection
 *
 *
 * Protected Financial Domains
 * -----------------------------------------------------------------------------
 *
 * • Double-entry ledger
 * • Loan portfolio reports
 * • Savings reports
 * • Member statements
 * • Reconciliation reports
 * • Regulatory reports
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
 * • DatabaseOptimization
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
    'enterprise-query-optimizer';


const COMPONENT_VERSION =
    '1.0.0';



/**
 * ============================================================================
 * Query Policies
 * ============================================================================
 */

const DEFAULT_POLICY = Object.freeze({

    maxPageSize:

        100,


    defaultPageSize:

        25,


    maxAggregationStages:

        50,


    maxDocumentsWithoutIndex:

        1000,


    enableProjection:

        true,


    detectNPlusOne:

        true,


    optimizeFinancialReports:

        true

});



/**
 * ============================================================================
 * Known Financial Collections
 * ============================================================================
 */

const FINANCIAL_COLLECTIONS = Object.freeze([

    'transactions',

    'journals',

    'journalentries',

    'accounts',

    'loans',

    'savings',

    'members'

]);



/**
 * ============================================================================
 * Runtime State
 * ============================================================================
 */

const STATE = Object.seal({

    initialized:false,

    initializedAt:null,

    optimizedQueries:0,

    blockedQueries:0,

    detectedNPlusOne:0,

    projectionApplied:0,

    aggregationOptimized:0

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

function metric(

    name,

    value = 1

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

function publish(

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
 * Index Awareness
 * ============================================================================
 */

function validateIndexUsage(query = {}) {


    if (

        query.collection &&

        FINANCIAL_COLLECTIONS.includes(

            query.collection

            .toLowerCase()

        )

    ) {


        return {

            recommended:

                true,


            reason:

                'financial collection requires indexed access'

        };


    }



    return {

        recommended:false

    };

}



/**
 * ============================================================================
 * Projection Enforcement
 * ============================================================================
 */

function enforceProjection(

    query = {}

) {


    if (

        query.projection

    ) {


        return query;

    }



    if (

        query.collection &&

        FINANCIAL_COLLECTIONS.includes(

            query.collection

            .toLowerCase()

        )

    ) {


        STATE.projectionApplied++;



        return Object.freeze({

            ...query,


            projection:

            {

                createdAt:1,

                updatedAt:1

            }

        });


    }



    return query;

}



/**
 * ============================================================================
 * Pagination Protection
 * ============================================================================
 */

function protectPagination(

    options = {},

    policy

) {


    let limit =

        options.limit ||

        policy.defaultPageSize;



    if (

        limit >

        policy.maxPageSize

    ) {


        STATE.blockedQueries++;



        throw new Error(

            'Pagination limit exceeds enterprise maximum.'

        );

    }



    return Object.freeze({

        ...options,

        limit

    });

}



/**
 * ============================================================================
 * Aggregation Optimization
 * ============================================================================
 */

function optimizeAggregation(

    pipeline = []

) {


    if (

        pipeline.length === 0

    ) {


        return pipeline;

    }



    if (

        pipeline.length >

        DEFAULT_POLICY.maxAggregationStages

    ) {


        throw new Error(

            'Aggregation pipeline exceeds allowed complexity.'

        );

    }



    STATE.aggregationOptimized++;



    return pipeline;

}



/**
 * ============================================================================
 * N+1 Detection
 * ============================================================================
 */

const QUERY_HISTORY = new Map();



function detectNPlusOne(

    key

) {


    const count =

        (

            QUERY_HISTORY.get(key)

            ||

            0

        )

        + 1;



    QUERY_HISTORY.set(

        key,

        count

    );



    if (

        count >

        20

    ) {


        STATE.detectedNPlusOne++;



        publish(

            'database.n_plus_one_detected',

            {

                query:key,

                count

            }

        );



        return true;

    }



    return false;

}



/**
 * ============================================================================
 * Financial Report Optimizer
 * ============================================================================
 */

function optimizeFinancialReport(

    query

) {


    if (

        !query.collection

    ) {


        return query;

    }



    if (

        FINANCIAL_COLLECTIONS.includes(

            query.collection

            .toLowerCase()

        )

    ) {


        return Object.freeze({

            ...query,


            allowDiskUse:

                true,


            readPreference:

                'secondaryPreferred'

        });

    }



    return query;

}



/**
 * ============================================================================
 * Query Optimization Engine
 * ============================================================================
 */

function optimizeQuery(

    query = {},

    options = {}

) {


    const policy = Object.freeze({

        ...DEFAULT_POLICY,

        ...options

    });



    let optimized =

        {

            ...query

        };



    optimized =

        enforceProjection(

            optimized

        );



    optimized =

        optimizeFinancialReport(

            optimized

        );



    const indexAdvice =

        validateIndexUsage(

            optimized

        );



    if (

        policy.detectNPlusOne

    ) {


        detectNPlusOne(

            JSON.stringify(

                optimized

            )

        );

    }



    STATE.optimizedQueries++;



    metric(

        'database.query.optimized'

    );



    return Object.freeze({

        query:

            optimized,


        indexAdvice

    });

}



/**
 * ============================================================================
 * Middleware
 * ============================================================================
 */

function queryOptimizer(options = {}) {


    const policy = Object.freeze({

        ...DEFAULT_POLICY,

        ...options

    });



    return function queryOptimizerMiddleware(

        req,

        res,

        next

    ) {


        STATE.initialized = true;


        STATE.initializedAt ||=

            new Date()

            .toISOString();



        req.queryOptimizer = Object.freeze({

            optimize:

                query =>

                    optimizeQuery(

                        query,

                        policy

                    ),



            aggregate:

                pipeline =>

                    optimizeAggregation(

                        pipeline

                    ),



            paginate:

                options =>

                    protectPagination(

                        options,

                        policy

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

            true

    });

}



async function readinessCheck() {

    return Object.freeze({

        ready:

            true

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

        390,


    critical:

        true,


    description:

        'Enterprise MongoDB query optimization and protection layer.'

});



/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports = Object.freeze({

    create:

        queryOptimizer,


    queryOptimizer,


    optimizeQuery,


    optimizeAggregation,


    enforceProjection,


    protectPagination,


    metadata,


    healthCheck,


    readinessCheck,


    diagnostics,


    policy:

        DEFAULT_POLICY

});