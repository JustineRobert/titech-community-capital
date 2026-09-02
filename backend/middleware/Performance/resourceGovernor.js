'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * File:
 * backend/middleware/performance/resourceGovernor.js
 *
 * Enterprise Runtime Resource Governor Middleware
 *
 * =============================================================================
 *
 * Purpose
 * -----------------------------------------------------------------------------
 *
 * Protects the TITech Community Capital runtime environment by monitoring and
 * controlling application resource pressure.
 *
 * Designed for:
 *
 * • High-throughput fintech APIs
 * • Kubernetes workloads
 * • Multi-tenant SaaS environments
 * • Payment processing systems
 * • Ledger-critical applications
 *
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 *
 * • CPU governance
 * • Memory protection
 * • Event loop monitoring
 * • Node.js runtime pressure control
 * • Kubernetes pod protection
 * • Automatic workload shedding
 * • Graceful degradation
 * • Runtime diagnostics
 *
 *
 * Protected Resources
 * -----------------------------------------------------------------------------
 *
 * • API request processing
 * • MongoDB operations
 * • Redis workloads
 * • BullMQ workers
 * • MTN/Airtel settlement flows
 * • Ledger processing
 *
 *
 * Observability Integration
 * -----------------------------------------------------------------------------
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

const os =
    require('os');



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
    'enterprise-resource-governor';


const COMPONENT_VERSION =
    '1.0.0';



/**
 * ============================================================================
 * Runtime Policies
 * ============================================================================
 */

const DEFAULT_POLICY = Object.freeze({

    enabled:true,


    cpu:

    {

        warning:75,

        critical:90

    },


    memory:

    {

        warning:80,

        critical:92

    },


    eventLoop:

    {

        warning:100,

        critical:500

    },


    actions:

    {

        warning:'DEGRADE',

        critical:'SHED'

    },


    preservePriority:

    [

        'CRITICAL',

        'PAYMENT',

        'LEDGER'

    ]

});



/**
 * ============================================================================
 * Internal Runtime State
 * ============================================================================
 */

const STATE = Object.seal({

    initialized:false,

    initializedAt:null,


    cpuUsage:0,

    memoryUsage:0,

    eventLoopDelay:0,


    pressure:'NORMAL',


    shedRequests:0,

    degradedRequests:0,


    lastEvaluation:null

});



/**
 * ============================================================================
 * Runtime Measurements
 * ============================================================================
 */


/**
 * CPU pressure estimation.
 */
function measureCPU() {


    const load =

        os.loadavg()[0];



    const cores =

        os.cpus().length;



    return Math.min(

        100,

        (

            load /

            cores

        )

        *

        100

    );

}



/**
 * Memory pressure estimation.
 */
function measureMemory() {


    const usage =

        process.memoryUsage();



    return (

        usage.heapUsed /

        usage.heapTotal

    )

    *

    100;

}



/**
 * Event loop pressure.
 *
 * Uses Node.js performance API
 * when available.
 */
function measureEventLoop() {


    try {


        const {

            monitorEventLoopDelay

        } = require('perf_hooks');



        const monitor =

            monitorEventLoopDelay({

                resolution:20

            });



        monitor.enable();



        const delay =

            monitor.mean /

            1e6;



        monitor.disable();



        return delay;


    }

    catch(error) {


        return 0;

    }

}



/**
 * ============================================================================
 * Pressure Evaluation
 * ============================================================================
 */

function classify(

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
 * Evaluate runtime health.
 */
function evaluateResources() {


    STATE.cpuUsage =

        measureCPU();



    STATE.memoryUsage =

        measureMemory();



    STATE.eventLoopDelay =

        measureEventLoop();



    const pressures = [

        classify(

            STATE.cpuUsage,

            DEFAULT_POLICY.cpu.warning,

            DEFAULT_POLICY.cpu.critical

        ),


        classify(

            STATE.memoryUsage,

            DEFAULT_POLICY.memory.warning,

            DEFAULT_POLICY.memory.critical

        ),


        classify(

            STATE.eventLoopDelay,

            DEFAULT_POLICY.eventLoop.warning,

            DEFAULT_POLICY.eventLoop.critical

        )

    ];



    if (

        pressures.includes(

            'CRITICAL'

        )

    ) {


        STATE.pressure =

            'CRITICAL';

    }

    else if (

        pressures.includes(

            'HIGH'

        )

    ) {


        STATE.pressure =

            'HIGH';

    }

    else {


        STATE.pressure =

            'NORMAL';

    }



    STATE.lastEvaluation =

        new Date()

        .toISOString();



    return STATE.pressure;

}



/**
 * ============================================================================
 * Kubernetes Protection
 * ============================================================================
 */

function isPodHealthy() {


    return (

        STATE.pressure !==

        'CRITICAL'

    );

}



/**
 * ============================================================================
 * Workload Classification
 * ============================================================================
 */

function resolvePriority(req) {


    return (

        req.context

        ?.priority

        ||

        req.headers

        ['x-workload-priority']

        ||

        'NORMAL'

    );

}



/**
 * ============================================================================
 * Workload Shedding Decision
 * ============================================================================
 */

function shouldShed(req) {


    const priority =

        resolvePriority(req);



    if (

        DEFAULT_POLICY

        .preservePriority

        .includes(

            priority

        )

    ) {


        return false;

    }



    return (

        STATE.pressure ===

        'CRITICAL'

    );

}



/**
 * ============================================================================
 * Observability
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
 * Middleware Factory
 * ============================================================================
 */

function resourceGovernor(

    options = {}

) {


    const policy = Object.freeze({

        ...DEFAULT_POLICY,

        ...options

    });



    return function resourceGovernorMiddleware(

        req,

        res,

        next

    ) {



        STATE.initialized = true;



        STATE.initializedAt ||=

            new Date()

            .toISOString();



        evaluateResources();



        req.resourceGovernor = Object.freeze({

            pressure:

                STATE.pressure,


            cpu:

                STATE.cpuUsage,


            memory:

                STATE.memoryUsage,


            eventLoop:

                STATE.eventLoopDelay

        });



        if (

            shouldShed(req)

        ) {


            STATE.shedRequests++;



            metric(

                'resource_governor.requests_shed'

            );



            publish(

                'resource.shedding',

                {

                    requestId:

                        req.id,


                    pressure:

                        STATE.pressure,


                    traceId:

                        TraceContext

                        ?.getTraceId

                        ?.(),


                    hostname:

                        os.hostname()

                }

            );



            return res

                .status(503)

                .json({

                    success:false,


                    code:

                        'RESOURCE_PRESSURE',


                    message:

                        'Service temporarily unavailable due to resource protection.'

                });


        }



        if (

            STATE.pressure ===

            'HIGH'

        ) {


            STATE.degradedRequests++;



            res.setHeader(

                'X-System-Mode',

                'DEGRADED'

            );

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

        healthy:

            STATE.pressure !==

            'CRITICAL',


        pressure:

            STATE.pressure,


        cpu:

            STATE.cpuUsage,


        memory:

            STATE.memoryUsage,


        eventLoop:

            STATE.eventLoopDelay

    });

}



async function readinessCheck() {


    return Object.freeze({

        ready:

            isPodHealthy()

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

        470,


    critical:

        true,


    description:

        'Enterprise Node.js runtime resource governance and workload protection layer.'

});



/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports = Object.freeze({

    create:

        resourceGovernor,


    resourceGovernor,


    evaluateResources,


    measureCPU,


    measureMemory,


    measureEventLoop,


    shouldShed,


    healthCheck,


    readinessCheck,


    diagnostics,


    metadata,


    policy:

        DEFAULT_POLICY

});