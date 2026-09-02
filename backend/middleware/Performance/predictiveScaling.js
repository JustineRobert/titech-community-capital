'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * File:
 * backend/middleware/performance/predictiveScaling.js
 *
 * Enterprise Predictive Scaling Middleware
 *
 * =============================================================================
 *
 * Purpose
 * -----------------------------------------------------------------------------
 *
 * Provides predictive workload intelligence for the TITech Community Capital
 * fintech platform by analysing historical runtime signals and generating
 * scaling recommendations before system pressure occurs.
 *
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 *
 * • Workload forecasting
 * • Predictive resource allocation
 * • Traffic prediction
 * • Kubernetes autoscaling recommendations
 * • Fintech peak-period preparation
 * • Capacity planning intelligence
 * • Runtime demand analysis
 * • Scaling event generation
 *
 *
 * Designed For
 * -----------------------------------------------------------------------------
 *
 * • Kubernetes HPA/VPA
 * • Prometheus
 * • Grafana
 * • OpenTelemetry
 * • Cloud autoscaling systems
 * • High-throughput fintech workloads
 *
 *
 * Scaling Intelligence Pipeline
 * -----------------------------------------------------------------------------
 *
 * Historical Metrics
 *        |
 *        v
 * Workload Analyzer
 *        |
 *        v
 * Forecast Engine
 *        |
 *        v
 * Scaling Decision
 *        |
 *        +----------------+
 *        |                |
 *        v                v
 *
 * Kubernetes HPA      Operations Dashboard
 *
 *
 * Integrations
 * -----------------------------------------------------------------------------
 *
 * • StructuredLogger
 * • MetricsRegistry
 * • EventBus
 * • TraceContext
 * • RuntimeHealth
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
    'enterprise-predictive-scaling';


const COMPONENT_VERSION =
    '1.0.0';



/**
 * ============================================================================
 * Scaling Policy
 * ============================================================================
 */

const DEFAULT_POLICY = Object.freeze({

    enabled:true,


    forecastWindowMinutes:

        60,


    historyWindow:

        100,


    thresholds:

    {

        cpu:

        {

            scaleUp:75,

            scaleDown:30

        },


        memory:

        {

            scaleUp:80,

            scaleDown:40

        },


        latency:

        {

            scaleUp:500

        }

    },


    kubernetes:

    {

        minReplicas:2,

        maxReplicas:20

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


    samplesCollected:0,


    forecastsGenerated:0,


    lastForecast:null,


    recommendedReplicas:null

});



/**
 * ============================================================================
 * Historical Workload Store
 * ============================================================================
 */

const WORKLOAD_HISTORY = [];



/**
 * ============================================================================
 * Metric Collection
 * ============================================================================
 */

function collectWorkloadSample(

    sample = {}

) {


    const normalized = Object.freeze({

        timestamp:

            Date.now(),


        requests:

            sample.requests || 0,


        cpu:

            sample.cpu || 0,


        memory:

            sample.memory || 0,


        latency:

            sample.latency || 0,


        errors:

            sample.errors || 0

    });



    WORKLOAD_HISTORY.push(

        normalized

    );



    if (

        WORKLOAD_HISTORY.length >

        DEFAULT_POLICY.historyWindow

    ) {


        WORKLOAD_HISTORY.shift();

    }



    STATE.samplesCollected++;



    return normalized;

}



/**
 * ============================================================================
 * Traffic Prediction Engine
 * ============================================================================
 */

function predictTraffic() {


    if (

        WORKLOAD_HISTORY.length === 0

    ) {


        return 0;

    }



    const total =

        WORKLOAD_HISTORY.reduce(

            (

                sum,

                item

            ) =>

                sum +

                item.requests,

            0

        );



    return Math.round(

        total /

        WORKLOAD_HISTORY.length

    );

}



/**
 * ============================================================================
 * Resource Forecasting
 * ============================================================================
 */

function forecastResources() {


    const samples =

        WORKLOAD_HISTORY;



    if (

        samples.length === 0

    ) {


        return Object.freeze({

            cpu:0,

            memory:0,

            latency:0

        });

    }



    const average = field =>


        samples.reduce(

            (

                sum,

                item

            ) =>

                sum +

                item[field],

            0

        )

        /

        samples.length;



    return Object.freeze({

        cpu:

            average('cpu'),


        memory:

            average('memory'),


        latency:

            average('latency')

    });

}



/**
 * ============================================================================
 * Kubernetes Autoscaling Recommendation
 * ============================================================================
 */

function recommendReplicas(

    resources

) {


    let replicas =

        DEFAULT_POLICY

        .kubernetes

        .minReplicas;



    if (

        resources.cpu >=

        DEFAULT_POLICY

        .thresholds

        .cpu

        .scaleUp

        ||

        resources.memory >=

        DEFAULT_POLICY

        .thresholds

        .memory

        .scaleUp

        ||

        resources.latency >=

        DEFAULT_POLICY

        .thresholds

        .latency

        .scaleUp

    ) {


        replicas += 2;

    }



    if (

        resources.cpu > 90

        ||

        resources.memory > 90

    ) {


        replicas += 5;

    }



    return Math.min(

        replicas,

        DEFAULT_POLICY

        .kubernetes

        .maxReplicas

    );

}



/**
 * ============================================================================
 * Workload Forecast
 * ============================================================================
 */

function generateForecast() {


    const resources =

        forecastResources();



    const traffic =

        predictTraffic();



    const replicas =

        recommendReplicas(

            resources

        );



    const forecast = Object.freeze({

        timestamp:

            new Date()

            .toISOString(),


        predictedTraffic:

            traffic,


        predictedResources:

            resources,


        recommendedReplicas:

            replicas

    });



    STATE.forecastsGenerated++;


    STATE.lastForecast =

        forecast;


    STATE.recommendedReplicas =

        replicas;



    publish(

        'scaling.forecast.generated',

        forecast

    );



    return forecast;

}



/**
 * ============================================================================
 * Peak Period Intelligence
 * ============================================================================
 */

function detectPeakRisk() {


    const forecast =

        STATE.lastForecast;



    if (!forecast) {


        return false;

    }



    return (

        forecast.predictedResources.cpu >

        70

        ||

        forecast.predictedResources.memory >

        75

        ||

        forecast.predictedResources.latency >

        400

    );

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

            Object.freeze({

                ...payload,


                traceId:

                    TraceContext

                    ?.getTraceId

                    ?.()

            })

        );


    }

    catch(_) {}

}



/**
 * ============================================================================
 * Middleware
 * ============================================================================
 */

function predictiveScaling(

    options = {}

) {


    const policy = Object.freeze({

        ...DEFAULT_POLICY,

        ...options

    });



    return function predictiveScalingMiddleware(

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



                collectWorkloadSample({

                    requests:1,


                    cpu:

                        process.cpuUsage()

                        .user

                        /

                        1000000,


                    memory:

                        (

                            process.memoryUsage()

                            .heapUsed

                            /

                            process.memoryUsage()

                            .heapTotal

                        )

                        *

                        100,


                    latency:

                        duration,


                    errors:

                        res.statusCode >= 500

                        ?

                        1

                        :

                        0

                });



                if (

                    STATE.samplesCollected %

                    20 === 0

                ) {


                    generateForecast();

                }


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


        samples:

            STATE.samplesCollected

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

        },


        historySize:

            WORKLOAD_HISTORY.length

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

        'scaling',


    priority:

        500,


    critical:

        false,


    description:

        'Predictive workload forecasting and Kubernetes scaling intelligence engine.'

});



/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports = Object.freeze({

    create:

        predictiveScaling,


    predictiveScaling,


    collectWorkloadSample,


    predictTraffic,


    forecastResources,


    recommendReplicas,


    generateForecast,


    detectPeakRisk,


    healthCheck,


    readinessCheck,


    diagnostics,


    metadata,


    policy:

        DEFAULT_POLICY

});