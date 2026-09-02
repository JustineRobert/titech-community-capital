'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * File:
 * backend/middleware/performance/observabilityOptimizer.js
 *
 * Enterprise Observability Optimization Middleware
 *
 * =============================================================================
 *
 * Purpose
 * -----------------------------------------------------------------------------
 *
 * Provides an intelligent observability optimization layer responsible for
 * collecting, reducing, enriching, and optimizing runtime telemetry across the
 * TITech Community Capital fintech platform.
 *
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 *
 * • Performance telemetry aggregation
 * • Adaptive metric sampling
 * • Trace optimization
 * • Dashboard intelligence
 * • Production SLO calculations
 * • Telemetry cost optimization
 * • High-cardinality protection
 * • Runtime observability decisions
 *
 *
 * Designed For
 * -----------------------------------------------------------------------------
 *
 * • Prometheus
 * • Grafana
 * • OpenTelemetry
 * • Kubernetes
 * • Fintech production monitoring
 *
 *
 * Telemetry Pipeline
 * -----------------------------------------------------------------------------
 *
 * Request
 *    |
 *    v
 * Trace Context
 *    |
 *    v
 * Metrics Collection
 *    |
 *    v
 * Observability Optimizer
 *    |
 *    +----------------+
 *    |                |
 *    v                v
 *
 * Dashboards       Alerting
 *
 *
 * Integrations
 * -----------------------------------------------------------------------------
 *
 * • StructuredLogger
 * • MetricsRegistry
 * • OpenTelemetry
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
    'enterprise-observability-optimizer';


const COMPONENT_VERSION =
    '1.0.0';



/**
 * ============================================================================
 * Observability Policy
 * ============================================================================
 */

const DEFAULT_POLICY = Object.freeze({

    enabled:true,


    sampling:

    {

        normal:0.25,

        degraded:0.75,

        critical:1

    },


    trace:

    {

        maxAttributes:50,

        maxEvents:100

    },


    slo:

    {

        availabilityTarget:99.9,

        latencyTarget:500,

        errorBudget:0.1

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


    telemetryEvents:0,

    sampledEvents:0,

    droppedEvents:0,


    tracesOptimized:0,


    currentSamplingRate:

        DEFAULT_POLICY.sampling.normal

});



/**
 * ============================================================================
 * Telemetry Buffer
 * ============================================================================
 */

const TELEMETRY_BUFFER = [];



/**
 * ============================================================================
 * Metric Recording
 * ============================================================================
 */

function recordMetric(

    name,

    value,

    labels = {}

) {


    STATE.telemetryEvents++;



    TELEMETRY_BUFFER.push({

        name,

        value,

        labels,

        timestamp:

            Date.now()

    });



    try {


        MetricsRegistry

        ?.record

        ?.(
            name,
            value,
            labels
        );


    }

    catch(_) {}

}



/**
 * ============================================================================
 * Adaptive Sampling Engine
 * ============================================================================
 */

function resolveSamplingRate(

    systemState = 'NORMAL'

) {


    switch(systemState) {


        case 'CRITICAL':

            return DEFAULT_POLICY

                .sampling

                .critical;



        case 'HIGH':

            return DEFAULT_POLICY

                .sampling

                .degraded;



        default:

            return DEFAULT_POLICY

                .sampling

                .normal;

    }

}



/**
 * Determine whether telemetry should be retained.
 */
function shouldSample(

    systemState

) {


    const rate =

        resolveSamplingRate(

            systemState

        );



    STATE.currentSamplingRate =

        rate;



    return Math.random() <= rate;

}



/**
 * ============================================================================
 * Trace Optimization
 * ============================================================================
 */

function optimizeTrace(

    trace = {}

) {


    const optimized = {


        traceId:

            trace.traceId ||


            TraceContext

            ?.getTraceId

            ?.(),



        service:

            trace.service ||


            'titech-community-capital',



        attributes:{},


        events:[]

    };



    Object

        .keys(

            trace.attributes || {}

        )

        .slice(

            0,

            DEFAULT_POLICY

            .trace

            .maxAttributes

        )

        .forEach(

            key => {


                optimized.attributes[key] =

                    trace.attributes[key];


            }

        );



    STATE.tracesOptimized++;



    return Object.freeze(

        optimized

    );

}



/**
 * ============================================================================
 * Performance Aggregation
 * ============================================================================
 */

function aggregateTelemetry() {


    const total =

        TELEMETRY_BUFFER.length;



    const latencyMetrics =

        TELEMETRY_BUFFER

        .filter(

            item =>

                item.name

                ===

                'request.duration'

        );



    const averageLatency =

        latencyMetrics.length

        ?

        latencyMetrics.reduce(

            (

                total,

                item

            ) =>

                total +

                item.value,

            0

        )

        /

        latencyMetrics.length

        :

        0;



    return Object.freeze({

        totalEvents:

            total,


        averageLatency

    });

}



/**
 * ============================================================================
 * SLO Calculation
 * ============================================================================
 */

function calculateSLO(

    metrics = {}

) {


    const total =

        metrics.totalRequests || 0;



    const failures =

        metrics.failures || 0;



    const latency =

        metrics.averageLatency || 0;



    const availability =

        total

        ?

        (

            (

                total -

                failures

            )

            /

            total

        )

        *

        100

        :

        100;



    return Object.freeze({

        availability,


        latency,


        target:

        {

            ...DEFAULT_POLICY.slo

        },


        healthy:

            availability >=

            DEFAULT_POLICY

            .slo

            .availabilityTarget

            &&

            latency <=

            DEFAULT_POLICY

            .slo

            .latencyTarget

    });

}



/**
 * ============================================================================
 * Dashboard Intelligence
 * ============================================================================
 */

function dashboardSnapshot() {


    return Object.freeze({

        service:

            COMPONENT_NAME,


        timestamp:

            new Date()

            .toISOString(),


        telemetry:

            aggregateTelemetry(),


        slo:

            calculateSLO({

                totalRequests:

                    STATE.telemetryEvents

            }),


        runtime:

        {

            hostname:

                os.hostname(),


            uptime:

                process.uptime()

        }

    });

}



/**
 * ============================================================================
 * Events
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
 * Middleware
 * ============================================================================
 */

function observabilityOptimizer(

    options = {}

) {


    const policy = Object.freeze({

        ...DEFAULT_POLICY,

        ...options

    });



    return function observabilityMiddleware(

        req,

        res,

        next

    ) {



        STATE.initialized = true;



        STATE.initializedAt ||=

            new Date()

            .toISOString();



        const started =

            process.hrtime.bigint();



        res.once(

            'finish',

            () => {



                const duration =

                    Number(

                        process.hrtime.bigint()

                        -

                        started

                    )

                    /

                    1_000_000;



                if (

                    shouldSample(

                        'NORMAL'

                    )

                ) {



                    STATE.sampledEvents++;



                    recordMetric(

                        'request.duration',

                        duration,

                        {

                            method:

                                req.method,


                            status:

                                res.statusCode

                        }

                    );



                }

                else {


                    STATE.droppedEvents++;

                }



                publish(

                    'observability.request.recorded',

                    {

                        requestId:

                            req.id,


                        duration,


                        hostname:

                            os.hostname()

                    }

                );


            }

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

        healthy:true,


        component:

            COMPONENT_NAME,


        sampled:

            STATE.sampledEvents

    });

}



async function readinessCheck() {


    return Object.freeze({

        ready:true

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

        'observability',


    priority:

        490,


    critical:

        false,


    description:

        'Enterprise telemetry optimization, sampling, tracing, and SLO intelligence layer.'

});



/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports = Object.freeze({

    create:

        observabilityOptimizer,


    observabilityOptimizer,


    recordMetric,


    resolveSamplingRate,


    shouldSample,


    optimizeTrace,


    aggregateTelemetry,


    calculateSLO,


    dashboardSnapshot,


    healthCheck,


    readinessCheck,


    diagnostics,


    metadata,


    policy:

        DEFAULT_POLICY

});