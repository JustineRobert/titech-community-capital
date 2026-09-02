'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * File:
 * backend/middleware/performance/healthAdaptive.js
 *
 * Enterprise Adaptive Health Management Middleware
 *
 * =============================================================================
 *
 * Purpose
 * -----------------------------------------------------------------------------
 *
 * Production-grade adaptive availability layer responsible for continuously
 * evaluating platform health and dynamically adjusting system behaviour.
 *
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 *
 * • Dependency health scoring
 * • Automatic feature degradation
 * • Kubernetes readiness integration
 * • Kubernetes liveness support
 * • Service dependency graphs
 * • Self-healing decisions
 * • Availability protection
 * • Critical fintech path preservation
 * • Dependency failure isolation
 * • Runtime diagnostics
 *
 *
 * Protected Platform Components
 * -----------------------------------------------------------------------------
 *
 * Core:
 *
 * • MongoDB
 * • Redis
 * • Queue workers
 *
 * Financial:
 *
 * • Ledger Engine
 * • Loan Engine
 * • Savings Engine
 *
 * External:
 *
 * • MTN MoMo
 * • Airtel Money
 * • Notification providers
 *
 *
 * Observability Integration
 * -----------------------------------------------------------------------------
 *
 * Integrates with:
 *
 * • StructuredLogger
 * • MetricsRegistry
 * • EventBus
 * • TraceContext
 * • RequestContext
 * • CircuitBreaker
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
 * Optional Enterprise Services
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
    'enterprise-health-adaptive';


const COMPONENT_VERSION =
    '1.0.0';



/**
 * ============================================================================
 * Health Status
 * ============================================================================
 */

const HEALTH_STATUS = Object.freeze({

    HEALTHY:

        'HEALTHY',


    DEGRADED:

        'DEGRADED',


    UNAVAILABLE:

        'UNAVAILABLE'

});



/**
 * ============================================================================
 * Health Thresholds
 * ============================================================================
 */

const HEALTH_THRESHOLDS = Object.freeze({

    healthy:

        90,


    degraded:

        60,


    unavailable:

        0

});



/**
 * ============================================================================
 * Feature Policies
 * ============================================================================
 */

const FEATURE_POLICIES = Object.freeze({

    analytics:

    {

        disableWhen:

            'DEGRADED'

    },


    exports:

    {

        disableWhen:

            'DEGRADED'

    },


    reports:

    {

        disableWhen:

            'DEGRADED'

    },


    payments:

    {

        disableWhen:

            'UNAVAILABLE'

    },


    ledger:

    {

        disableWhen:

            'UNAVAILABLE'

    }

});



/**
 * ============================================================================
 * Dependency Graph
 * ============================================================================
 */

const DEPENDENCY_GRAPH = Object.freeze({

    api:

    [

        'mongodb',

        'redis'

    ],


    payments:

    [

        'mtn-momo',

        'airtel-money',

        'ledger'

    ],


    loans:

    [

        'mongodb',

        'ledger'

    ],


    notifications:

    [

        'redis',

        'email'

    ]

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


    overall:

        HEALTH_STATUS.HEALTHY,


    dependencies:

        {},


    degradedFeatures:

        [],


    lastEvaluation:

        null

});



/**
 * ============================================================================
 * Context
 * ============================================================================
 */

function context() {


    return Object.freeze({

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
 * Event Publisher
 * ============================================================================
 */

function publish(type,payload) {


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
 * Metrics
 * ============================================================================
 */

function metric(name,value=1) {


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
 * Dependency Registration
 * ============================================================================
 */

function registerDependency(

    name,

    healthCheck

) {


    STATE.dependencies[name] = {


        name,


        healthCheck,


        score:

            100,


        status:

            HEALTH_STATUS.HEALTHY,


        lastCheck:

            null

    };


}



/**
 * ============================================================================
 * Health Evaluation
 * ============================================================================
 */

async function evaluateDependency(

    dependency

) {


    try {


        const result =

            await dependency.healthCheck();



        dependency.score =

            result === true

            ?

            100

            :

            50;



    }

    catch(error) {


        dependency.score =

            0;

    }



    dependency.status =


        dependency.score >=

        HEALTH_THRESHOLDS.healthy


        ?

        HEALTH_STATUS.HEALTHY


        :

        dependency.score >=

        HEALTH_THRESHOLDS.degraded


        ?

        HEALTH_STATUS.DEGRADED


        :

        HEALTH_STATUS.UNAVAILABLE;



    dependency.lastCheck =

        new Date()

        .toISOString();



    return dependency;

}



/**
 * ============================================================================
 * System Evaluation
 * ============================================================================
 */

async function evaluateHealth() {


    const dependencies =

        Object.values(

            STATE.dependencies

        );



    for (

        const dependency

        of

        dependencies

    ) {


        await evaluateDependency(

            dependency

        );


    }



    const unavailable =

        dependencies.filter(

            d =>

            d.status ===

            HEALTH_STATUS.UNAVAILABLE

        );



    const degraded =

        dependencies.filter(

            d =>

            d.status ===

            HEALTH_STATUS.DEGRADED

        );



    if (

        unavailable.length

    ) {


        STATE.overall =

            HEALTH_STATUS.UNAVAILABLE;


    }

    else if (

        degraded.length

    ) {


        STATE.overall =

            HEALTH_STATUS.DEGRADED;


    }

    else {


        STATE.overall =

            HEALTH_STATUS.HEALTHY;

    }



    applyDegradation();



    STATE.lastEvaluation =

        new Date()

        .toISOString();



    return STATE.overall;

}



/**
 * ============================================================================
 * Automatic Feature Degradation
 * ============================================================================
 */

function applyDegradation() {


    STATE.degradedFeatures = [];



    Object.entries(

        FEATURE_POLICIES

    )

    .forEach(([feature,policy])=>{


        if (

            STATE.overall ===

            policy.disableWhen

        ) {


            STATE.degradedFeatures.push(

                feature

            );

        }


    });



    if (

        STATE.degradedFeatures.length

    ) {


        publish(

            'system.feature_degraded',

            {

                ...context(),


                features:

                    STATE.degradedFeatures

            }

        );


    }

}



/**
 * ============================================================================
 * Middleware
 * ============================================================================
 */

function healthAdaptive(options={}) {


    if (

        options.dependencies

    ) {


        Object.entries(

            options.dependencies

        )

        .forEach(

            ([name,check]) =>

                registerDependency(

                    name,

                    check

                )

        );


    }



    return async function healthAdaptiveMiddleware(

        req,

        res,

        next

    ) {


        STATE.initialized = true;


        STATE.initializedAt ||=

            new Date()

            .toISOString();



        await evaluateHealth();



        req.healthContext = Object.freeze({

            status:

                STATE.overall,


            degradedFeatures:

                [

                    ...

                    STATE.degradedFeatures

                ]

        });



        next();

    };

}



/**
 * ============================================================================
 * Kubernetes Health Endpoints
 * ============================================================================
 */

async function readinessCheck() {


    await evaluateHealth();



    return Object.freeze({

        ready:

            STATE.overall !==

            HEALTH_STATUS.UNAVAILABLE,


        status:

            STATE.overall

    });

}



async function healthCheck() {


    return Object.freeze({

        healthy:

            true,


        status:

            STATE.overall

    });

}



/**
 * ============================================================================
 * Diagnostics
 * ============================================================================
 */

function diagnostics() {


    return Object.freeze({

        metadata,


        state:

        {

            ...STATE

        },


        dependencyGraph:

            DEPENDENCY_GRAPH

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

        360,


    critical:

        true,


    description:

        'Adaptive health management and availability protection layer.'

});



/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports = Object.freeze({

    create:

        healthAdaptive,


    healthAdaptive,


    registerDependency,


    evaluateHealth,


    readinessCheck,


    healthCheck,


    diagnostics,


    dependencyGraph:

        DEPENDENCY_GRAPH,


    metadata

});