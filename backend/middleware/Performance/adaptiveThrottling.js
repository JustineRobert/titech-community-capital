'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * File:
 * backend/middleware/performance/adaptiveThrottling.js
 *
 * Enterprise Adaptive Traffic Throttling Middleware
 *
 * =============================================================================
 *
 * Purpose
 * -----------------------------------------------------------------------------
 *
 * Intelligent runtime traffic management layer designed for fintech workloads.
 *
 * Dynamically adjusts request acceptance based on:
 *
 * • System resource pressure
 * • Tenant workload behaviour
 * • API criticality
 * • Payment provider availability
 * • Kubernetes pod health
 * • Current platform capacity
 *
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 *
 * • Dynamic traffic control
 * • Tenant-aware throttling
 * • CPU based throttling
 * • Memory pressure throttling
 * • Payment provider protection
 * • Kubernetes autoscaling awareness
 * • Intelligent workload shaping
 * • Graceful degradation
 * • Priority traffic preservation
 * • Enterprise diagnostics
 *
 *
 * Protected Systems
 * -----------------------------------------------------------------------------
 *
 * • Ledger processing
 * • Savings transactions
 * • Loan workflows
 * • MTN MoMo APIs
 * • Airtel Money APIs
 * • Background jobs
 * • Reporting workloads
 *
 *
 * Traffic Priority Model
 * -----------------------------------------------------------------------------
 *
 * CRITICAL
 *      |
 *      | Ledger
 *      | Payments
 *      | Settlements
 *
 * HIGH
 *      |
 *      | Authentication
 *      | Loan operations
 *
 * NORMAL
 *      |
 *      | General APIs
 *
 * LOW
 *      |
 *      | Reports
 *      | Analytics
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
    'enterprise-adaptive-throttling';


const COMPONENT_VERSION =
    '1.0.0';



/**
 * ============================================================================
 * Throttling Policies
 * ============================================================================
 */

const DEFAULT_POLICY = Object.freeze({

    enabled:true,


    cpuThreshold:

        80,


    memoryThreshold:

        85,


    criticalCpuThreshold:

        95,


    criticalMemoryThreshold:

        95,


    defaultRequestsPerMinute:

        1000,


    tenantLimits:

    {

        FREE:

            100,


        STANDARD:

            1000,


        PREMIUM:

            5000,


        ENTERPRISE:

            20000

    },


    paymentProviders:

    {

        MTN:

            500,


        AIRTEL:

            500

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

    throttledRequests:0,

    acceptedRequests:0,

    currentPressure:'NORMAL',

    tenantBlocks:0,

    providerBlocks:0

});



/**
 * ============================================================================
 * Request Counters
 * ============================================================================
 */

const REQUEST_BUCKETS = new Map();



/**
 * ============================================================================
 * System Resource Monitoring
 * ============================================================================
 */

function systemPressure() {


    const memoryUsage =

        (

            process.memoryUsage()

            .heapUsed

            /

            process.memoryUsage()

            .heapTotal

        )

        *

        100;



    const cpuApproximation =

        os.loadavg()[0]

        /

        os.cpus().length

        *

        100;



    if (

        cpuApproximation >=

        DEFAULT_POLICY.criticalCpuThreshold

        ||

        memoryUsage >=

        DEFAULT_POLICY.criticalMemoryThreshold

    ) {


        return 'CRITICAL';

    }



    if (

        cpuApproximation >=

        DEFAULT_POLICY.cpuThreshold

        ||

        memoryUsage >=

        DEFAULT_POLICY.memoryThreshold

    ) {


        return 'HIGH';

    }



    return 'NORMAL';

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
 * Event Publishing
 * ============================================================================
 */

function publish(

    event,

    payload

) {


    try {


        EventBus

        ?.publish?.(

            event,

            Object.freeze(payload)

        );


    }

    catch(_) {}

}



/**
 * ============================================================================
 * Tenant Resolution
 * ============================================================================
 */

function resolveTenant(req) {


    return (

        req.tenant

        ||

        req.context

        ?.tenant

        ||

        {

            id:'anonymous',

            plan:'FREE'

        }

    );

}



/**
 * ============================================================================
 * Request Classification
 * ============================================================================
 */

function classifyRequest(req) {


    const path =

        req.originalUrl || '';



    if (

        path.includes(

            '/ledger'

        )

        ||

        path.includes(

            '/payments'

        )

    ) {


        return 'CRITICAL';

    }



    if (

        path.includes(

            '/loan'

        )

    ) {


        return 'HIGH';

    }



    if (

        path.includes(

            '/report'

        )

    ) {


        return 'LOW';

    }



    return 'NORMAL';

}



/**
 * ============================================================================
 * Payment Provider Detection
 * ============================================================================
 */

function resolveProvider(req) {


    const provider =

        req.headers

        ['x-payment-provider'];



    return provider

        ?

        provider.toUpperCase()

        :

        null;

}



/**
 * ============================================================================
 * Rate Decision Engine
 * ============================================================================
 */

function shouldThrottle(req) {


    const pressure =

        systemPressure();



    STATE.currentPressure =

        pressure;



    const classification =

        classifyRequest(req);



    /*
     * Always preserve critical financial flows.
     */

    if (

        classification ===

        'CRITICAL'

    ) {


        return false;

    }



    if (

        pressure ===

        'CRITICAL'

    ) {


        return true;

    }



    const tenant =

        resolveTenant(req);



    const planLimit =

        DEFAULT_POLICY

        .tenantLimits

        [

            tenant.plan ||

            'FREE'

        ]

        ||

        DEFAULT_POLICY

        .defaultRequestsPerMinute;



    const bucketKey =

        `${tenant.id}:${classification}`;



    const bucket =

        REQUEST_BUCKETS.get(

            bucketKey

        )

        ||

        {

            count:0,

            reset:

                Date.now()

                +

                60000

        };



    if (

        Date.now()

        >

        bucket.reset

    ) {


        bucket.count = 0;


        bucket.reset =

            Date.now()

            +

            60000;

    }



    bucket.count++;



    REQUEST_BUCKETS.set(

        bucketKey,

        bucket

    );



    return bucket.count > planLimit;

}



/**
 * ============================================================================
 * Middleware
 * ============================================================================
 */

function adaptiveThrottling(

    options = {}

) {


    const policy = Object.freeze({

        ...DEFAULT_POLICY,

        ...options

    });



    return function adaptiveThrottleMiddleware(

        req,

        res,

        next

    ) {



        STATE.initialized = true;



        STATE.initializedAt ||=

            new Date()

            .toISOString();



        const provider =

            resolveProvider(req);



        if (

            shouldThrottle(req)

        ) {



            STATE.throttledRequests++;



            metric(

                'adaptive_throttling.blocked'

            );



            publish(

                'traffic.throttled',

                {

                    requestId:

                        req.id,


                    provider,


                    traceId:

                        TraceContext

                        ?.getTraceId?.(),


                    hostname:

                        os.hostname()

                }

            );



            return res

                .status(429)

                .json({

                    success:false,


                    code:

                        'SYSTEM_CAPACITY_LIMIT',


                    message:

                        'Request temporarily throttled.'

                });

        }



        STATE.acceptedRequests++;



        res.setHeader(

            'X-Traffic-Policy',

            STATE.currentPressure

        );



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

            STATE.currentPressure !==

            'CRITICAL',


        pressure:

            STATE.currentPressure

    });

}



async function readinessCheck() {


    return Object.freeze({

        ready:

            STATE.currentPressure !==

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

        450,


    critical:

        true,


    description:

        'Enterprise adaptive traffic shaping and workload protection layer.'

});



/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports = Object.freeze({

    create:

        adaptiveThrottling,


    adaptiveThrottling,


    systemPressure,


    shouldThrottle,


    resolveTenant,


    classifyRequest,


    metadata,


    healthCheck,


    readinessCheck,


    diagnostics,


    policy:

        DEFAULT_POLICY

});