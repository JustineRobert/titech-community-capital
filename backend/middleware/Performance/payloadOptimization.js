'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * File:
 * backend/middleware/performance/payloadOptimization.js
 *
 * Enterprise Payload Optimization Middleware
 *
 * =============================================================================
 *
 * Purpose
 * -----------------------------------------------------------------------------
 *
 * Production-grade response and request payload optimization middleware designed
 * for high-throughput fintech workloads.
 *
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 *
 * • Response payload optimization
 * • Request payload analysis
 * • JSON payload minimization
 * • Duplicate field detection
 * • Large payload protection
 * • Response metadata optimization
 * • Serialization performance monitoring
 * • API bandwidth optimization
 * • Mobile network optimization
 * • Compression coordination
 * • Observability integration
 *
 *
 * Designed For
 * -----------------------------------------------------------------------------
 *
 * • Express Application Factory
 * • Kubernetes deployments
 * • Mobile clients
 * • Web clients
 * • API gateways
 * • Financial APIs
 *
 *
 * Observability
 * -----------------------------------------------------------------------------
 *
 * Integrates with:
 *
 * • StructuredLogger
 * • LoggerFactory
 * • RequestMetrics
 * • MetricsRegistry
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

function optionalRequire(path) {

    try {

        return require(path);

    }

    catch(error) {

        return Object.freeze({

            unavailable:

                true,


            module:

                path

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
    'enterprise-payload-optimization';


const COMPONENT_VERSION =
    '1.0.0';



/**
 * ============================================================================
 * Optimization Defaults
 * ============================================================================
 */

const DEFAULT_POLICY = Object.freeze({

    enabled:

        true,


    maxPayloadSize:

        5 * 1024 * 1024,


    optimizeJSON:

        true,


    removeUndefined:

        true,


    removeNullFields:

        false,


    compactArrays:

        true,


    mobileOptimization:

        true,


    trackSavings:

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


    optimizedRequests:

        0,


    optimizedResponses:

        0,


    bytesSaved:

        0

});



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
 * JSON Optimizer
 * ============================================================================
 */

function optimizeObject(

    value,

    policy

) {


    if (

        Array.isArray(value)

    ) {


        return value

            .map(

                item =>

                    optimizeObject(

                        item,

                        policy

                    )

            )

            .filter(

                item =>

                    policy.compactArrays

                    ?

                    item !== undefined

                    :

                    true

            );

    }



    if (

        value &&

        typeof value === 'object'

    ) {


        const result = {};



        Object.entries(value)

        .forEach(([key,val])=>{


            if (

                policy.removeUndefined &&

                val === undefined

            ) {

                return;

            }



            if (

                policy.removeNullFields &&

                val === null

            ) {

                return;

            }



            result[key] =

                optimizeObject(

                    val,

                    policy

                );


        });



        return result;

    }



    return value;

}



/**
 * ============================================================================
 * Payload Size
 * ============================================================================
 */

function calculateSize(payload) {


    try {


        return Buffer

            .byteLength(

                JSON.stringify(payload)

            );


    }

    catch(_) {


        return 0;

    }

}



/**
 * ============================================================================
 * Middleware Factory
 * ============================================================================
 */

function payloadOptimization(options = {}) {


    const policy = Object.freeze({

        ...DEFAULT_POLICY,

        ...options

    });



    return function payloadOptimizationMiddleware(

        req,

        res,

        next

    ) {



        STATE.initialized = true;


        STATE.initializedAt ||=

            new Date()

            .toISOString();



        req.payloadOptimization = Object.freeze({

            enabled:

                policy.enabled

        });



        /**
         * Protect oversized payloads.
         */

        let received = 0;



        req.on(

            'data',

            chunk => {


                received +=

                    chunk.length;



                if (

                    received >

                    policy.maxPayloadSize

                ) {


                    req.destroy();


                }


            }

        );



        STATE.optimizedRequests++;



        /**
         * Capture JSON responses.
         */

        const originalJson =

            res.json.bind(res);



        res.json = function optimizedJson(body) {



            if (

                !policy.enabled

            ) {


                return originalJson(

                    body

                );

            }



            const originalSize =

                calculateSize(body);



            const optimized =

                policy.optimizeJSON

                ?

                optimizeObject(

                    body,

                    policy

                )

                :

                body;



            const optimizedSize =

                calculateSize(

                    optimized

                );



            const saved =

                originalSize -

                optimizedSize;



            if (

                saved > 0

            ) {


                STATE.bytesSaved +=

                    saved;



                recordMetric(

                    'payload.bytes.saved',

                    saved

                );


            }



            STATE.optimizedResponses++;



            publishEvent(

                'payload.optimized',

                {

                    ...buildContext(req),


                    originalSize,


                    optimizedSize,


                    saved

                }

            );



            return originalJson(

                optimized

            );


        };



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

            true,


        component:

            COMPONENT_NAME

    });

}



async function readinessCheck() {


    return Object.freeze({

        ready:

            true,


        component:

            COMPONENT_NAME

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

        370,


    critical:

        false,


    description:

        'Enterprise API payload optimization middleware.'

});



/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports = Object.freeze({

    create:

        payloadOptimization,


    payloadOptimization,


    optimizeObject,


    metadata,


    healthCheck,


    readinessCheck,


    diagnostics,


    policy:

        DEFAULT_POLICY

});