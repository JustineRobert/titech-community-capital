'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * File:
 * backend/middleware/performance/loadShedding.js
 *
 * Enterprise Adaptive Load Shedding Middleware
 *
 * =============================================================================
 *
 * Purpose
 * -----------------------------------------------------------------------------
 *
 * Production-grade resilience middleware responsible for protecting the
 * TITech Community Capital fintech platform during extreme resource pressure.
 *
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 *
 * • Adaptive traffic rejection
 * • CPU pressure detection
 * • Memory pressure detection
 * • Kubernetes pod protection
 * • Graceful degradation
 * • Critical-path preservation
 * • Request prioritization
 * • System overload protection
 * • Metrics publishing
 * • Event publishing
 * • Enterprise diagnostics
 *
 *
 * Protected Critical Paths
 * -----------------------------------------------------------------------------
 *
 * Priority requests:
 *
 * • Authentication
 * • Ledger posting
 * • Loan approvals
 * • Payment callbacks
 * • Mobile money reconciliation
 * • Regulatory reporting
 *
 *
 * Degradable Paths:
 *
 * • Reports
 * • Analytics
 * • Exports
 * • Search
 * • Notifications
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

function loadOptionalDependency(path) {

    try {

        return require(path);

    }

    catch (error) {

        return Object.freeze({

            unavailable: true,

            module: path,

            error:
                error.message

        });

    }

}



const MetricsRegistry =

    loadOptionalDependency(

        '../../shared/metrics/MetricsRegistry'

    );



const EventBus =

    loadOptionalDependency(

        '../../shared/events/EventBus'

    );



const TraceContext =

    loadOptionalDependency(

        '../../shared/tracing/TraceContext'

    );



/**
 * ============================================================================
 * Component Identity
 * ============================================================================
 */

const COMPONENT_NAME =
    'enterprise-load-shedding';


const COMPONENT_VERSION =
    '1.0.0';



/**
 * ============================================================================
 * Load Threshold Policies
 * ============================================================================
 */

const DEFAULT_POLICIES = Object.freeze({

    cpu:

    {

        warning:

            75,


        critical:

            90

    },


    memory:

    {

        warning:

            80,


        critical:

            90

    },


    actions:

    {

        rejectAnalytics:

            true,


        rejectExports:

            true,


        rejectReports:

            true,


        preservePayments:

            true,


        preserveLedger:

            true

    },


    response:

    {

        statusCode:

            503,


        retryAfter:

            30

    }

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


    overload:

        false,


    level:

        'NORMAL',


    rejected:

        0,


    accepted:

        0,


    lastCheck:

        null

});



/**
 * ============================================================================
 * Critical Routes
 * ============================================================================
 */

const CRITICAL_PATHS = Object.freeze([


    '/api/auth',


    '/api/payments',


    '/api/mtn',


    '/api/airtel',


    '/api/ledger',


    '/api/loans/approve'


]);



const LOW_PRIORITY_PATHS = Object.freeze([


    '/api/reports',


    '/api/export',


    '/api/analytics',


    '/api/search'


]);



/**
 * ============================================================================
 * Context
 * ============================================================================
 */

function buildContext(req) {


    return Object.freeze({

        requestId:

            req.id,


        correlationId:

            req.context

            ?.correlationId,


        traceId:

            TraceContext

            ?.getTraceId?.(),


        tenant:

            req.context

            ?.tenant

            ?.id || null,


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

function incrementMetric(name) {


    try {


        MetricsRegistry

            ?.increment?.(

                name

            );


    }

    catch (_) {}

}



/**
 * ============================================================================
 * Events
 * ============================================================================
 */

function publishEvent(type, payload) {


    try {


        EventBus

            ?.publish?.(

                type,

                Object.freeze(payload)

            );


    }

    catch (_) {}

}



/**
 * ============================================================================
 * Resource Monitoring
 * ============================================================================
 */

function getCPUUsage() {


    const cpus =

        os.cpus();



    let idle = 0;

    let total = 0;



    cpus.forEach(cpu => {


        idle += cpu.times.idle;


        total +=

            Object.values(

                cpu.times

            )

            .reduce(

                (a,b)=>a+b,

                0

            );


    });



    return (

        1 -

        idle /

        total

    )

    *

    100;

}



function getMemoryUsage() {


    return (

        (

            process.memoryUsage()

            .heapUsed /

            process.memoryUsage()

            .heapTotal

        )

        *

        100

    );

}



/**
 * ============================================================================
 * Load Evaluation
 * ============================================================================
 */

function evaluateSystemLoad(policy) {


    const cpu =

        getCPUUsage();



    const memory =

        getMemoryUsage();



    let level =

        'NORMAL';



    if (

        cpu >= policy.cpu.critical ||

        memory >= policy.memory.critical

    ) {


        level =

            'CRITICAL';

    }

    else if (

        cpu >= policy.cpu.warning ||

        memory >= policy.memory.warning

    ) {


        level =

            'WARNING';

    }



    STATE.level = level;


    STATE.overload =

        level !== 'NORMAL';



    STATE.lastCheck =

        new Date()

        .toISOString();



    return {

        cpu,

        memory,

        level

    };

}



/**
 * ============================================================================
 * Request Classification
 * ============================================================================
 */

function isCriticalRequest(req) {


    return CRITICAL_PATHS.some(

        route =>

            req.path.startsWith(route)

    );

}



function isLowPriorityRequest(req) {


    return LOW_PRIORITY_PATHS.some(

        route =>

            req.path.startsWith(route)

    );

}



/**
 * ============================================================================
 * Middleware Factory
 * ============================================================================
 */

function loadShedding(options = {}) {


    const policy = Object.freeze({

        ...DEFAULT_POLICIES,

        ...options

    });



    return function loadSheddingMiddleware(

        req,

        res,

        next

    ) {



        STATE.initialized = true;


        STATE.initializedAt ||=

            new Date()

            .toISOString();



        const load =

            evaluateSystemLoad(policy);



        if (

            load.level ===

            'NORMAL'

        ) {


            STATE.accepted++;


            return next();

        }



        /**
         * Preserve financial critical paths.
         */

        if (

            isCriticalRequest(req)

            &&

            policy.actions.preservePayments

        ) {


            STATE.accepted++;


            req.loadShedding = Object.freeze({

                bypassed:

                    true,


                reason:

                    'critical-path'

            });


            return next();

        }



        /**
         * Reject low-value traffic.
         */

        if (

            isLowPriorityRequest(req)

        ) {



            STATE.rejected++;



            incrementMetric(

                'load_shedding_rejected_total'

            );



            publishEvent(

                'system.load_shedding',

                {

                    ...buildContext(req),

                    load

                }

            );



            res.setHeader(

                'Retry-After',

                policy.response.retryAfter

            );



            return res

                .status(

                    policy.response.statusCode

                )

                .json({

                    success:

                        false,


                    code:

                        'SYSTEM_OVERLOAD',


                    message:

                        'Service temporarily degraded. Please retry later.'

                });

        }



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


        level:

            STATE.level

    });

}



async function readinessCheck() {


    return Object.freeze({

        component:

            COMPONENT_NAME,


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

        340,


    critical:

        true,


    description:

        'Enterprise adaptive traffic load shedding middleware.'

});



/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports = Object.freeze({

    create:

        loadShedding,


    loadShedding,


    metadata,


    healthCheck,


    readinessCheck,


    diagnostics,


    policies:

        DEFAULT_POLICIES

});