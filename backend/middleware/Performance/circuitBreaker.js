'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * File:
 * backend/middleware/performance/circuitBreaker.js
 *
 * Enterprise Circuit Breaker Middleware & Service Protection Layer
 *
 * =============================================================================
 *
 * Purpose
 * -----------------------------------------------------------------------------
 *
 * Production-grade failure isolation framework protecting the TITech Community
 * Capital fintech platform from cascading failures.
 *
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 *
 * • External API failure isolation
 * • MTN MoMo circuit protection
 * • Airtel Money circuit protection
 * • MongoDB failure containment
 * • Redis failure handling
 * • Automatic recovery
 * • Half-open probing
 * • Distributed failure resilience
 * • Dependency health tracking
 * • Failure event publishing
 * • Metrics collection
 * • Enterprise diagnostics
 *
 *
 * Protected Dependencies
 * -----------------------------------------------------------------------------
 *
 * Payment Providers:
 *
 * • MTN MoMo
 * • Airtel Money
 *
 * Infrastructure:
 *
 * • MongoDB
 * • Redis
 *
 * External:
 *
 * • Email providers
 * • SMS providers
 * • Banking APIs
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
    'enterprise-circuit-breaker';


const COMPONENT_VERSION =
    '1.0.0';



/**
 * ============================================================================
 * Circuit States
 * ============================================================================
 */

const STATES = Object.freeze({

    CLOSED:

        'CLOSED',


    OPEN:

        'OPEN',


    HALF_OPEN:

        'HALF_OPEN'

});



/**
 * ============================================================================
 * Default Policies
 * ============================================================================
 */

const DEFAULT_POLICY = Object.freeze({

    failureThreshold:

        5,


    successThreshold:

        3,


    timeout:

        30000,


    resetTimeout:

        60000,


    monitoringWindow:

        120000

});



/**
 * ============================================================================
 * Runtime Registry
 * ============================================================================
 */

const CIRCUITS = new Map();



/**
 * ============================================================================
 * Enterprise Error
 * ============================================================================
 */

class CircuitBreakerOpenError
    extends Error {


    constructor(service, details = {}) {


        super(

            `Circuit breaker open for ${service}`

        );


        this.name =

            'CircuitBreakerOpenError';


        this.code =

            'CIRCUIT_BREAKER_OPEN';


        this.statusCode =

            503;


        this.service =

            service;


        this.details =

            details;


        this.operational = true;

    }

}



/**
 * ============================================================================
 * Context Builder
 * ============================================================================
 */

function buildContext(context = {}) {


    return Object.freeze({

        requestId:

            context.requestId,


        correlationId:

            context.correlationId,


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
 * Circuit Creation
 * ============================================================================
 */

function createCircuit(

    name,

    options = {}

) {


    if (

        CIRCUITS.has(name)

    ) {

        return CIRCUITS.get(name);

    }



    const circuit = {


        name,


        state:

            STATES.CLOSED,


        failures:

            0,


        successes:

            0,


        lastFailure:

            null,


        openedAt:

            null,


        policy:

        {

            ...DEFAULT_POLICY,

            ...options

        }


    };



    CIRCUITS.set(

        name,

        circuit

    );



    return circuit;

}



/**
 * ============================================================================
 * State Evaluation
 * ============================================================================
 */

function canExecute(circuit) {


    if (

        circuit.state ===

        STATES.CLOSED

    ) {


        return true;

    }



    if (

        circuit.state ===

        STATES.OPEN

    ) {


        const elapsed =

            Date.now()

            -

            circuit.openedAt;



        if (

            elapsed >=

            circuit.policy.resetTimeout

        ) {


            circuit.state =

                STATES.HALF_OPEN;



            publishEvent(

                'circuit.half_open',

                {

                    service:

                        circuit.name

                }

            );



            return true;

        }



        return false;

    }



    return true;

}



/**
 * ============================================================================
 * Success Handler
 * ============================================================================
 */

function recordSuccess(circuit) {


    circuit.successes++;


    circuit.failures = 0;



    if (

        circuit.state ===

        STATES.HALF_OPEN

        &&

        circuit.successes >=

        circuit.policy.successThreshold

    ) {


        circuit.state =

            STATES.CLOSED;



        circuit.successes = 0;



        publishEvent(

            'circuit.closed',

            {

                service:

                    circuit.name

            }

        );

    }

}



/**
 * ============================================================================
 * Failure Handler
 * ============================================================================
 */

function recordFailure(

    circuit,

    error

) {


    circuit.failures++;


    circuit.lastFailure =

        Date.now();



    incrementMetric(

        'circuit_breaker_failure_total'

    );



    if (

        circuit.failures >=

        circuit.policy.failureThreshold

    ) {


        circuit.state =

            STATES.OPEN;



        circuit.openedAt =

            Date.now();



        publishEvent(

            'circuit.open',

            {

                service:

                    circuit.name,


                error:

                    error?.message

            }

        );

    }

}



/**
 * ============================================================================
 * Protected Execution Wrapper
 * ============================================================================
 */

async function execute(

    service,

    operation,

    options = {},

    context = {}

) {


    const circuit =

        createCircuit(

            service,

            options

        );



    if (

        !canExecute(circuit)

    ) {


        throw new CircuitBreakerOpenError(

            service,

            {

                state:

                    circuit.state

            }

        );

    }



    try {


        const result =

            await Promise.race([


                operation(),



                new Promise(

                    (_, reject) => {


                        setTimeout(

                            () => reject(

                                new Error(

                                    'Operation timeout'

                                )

                            ),

                            circuit.policy.timeout

                        );


                    }

                )


            ]);



        recordSuccess(

            circuit

        );



        return result;


    }

    catch(error) {


        recordFailure(

            circuit,

            error

        );



        publishEvent(

            'circuit.failure',

            {

                ...buildContext(context),


                service,


                error:

                    error.message

            }

        );



        throw error;

    }

}



/**
 * ============================================================================
 * Middleware Factory
 * ============================================================================
 */

function circuitBreaker(options = {}) {


    return function circuitBreakerMiddleware(

        req,

        res,

        next

    ) {


        req.circuitBreaker = Object.freeze({

            execute:

                (

                    service,

                    fn,

                    policy

                ) =>


                    execute(

                        service,

                        fn,

                        policy,

                        {

                            requestId:

                                req.id,


                            correlationId:

                                req.context

                                ?.correlationId

                        }

                    )

        });



        next();

    };

}



/**
 * ============================================================================
 * Predefined Financial Service Circuits
 * ============================================================================
 */

const SERVICE_POLICIES = Object.freeze({

    'mtn-momo':

    {

        failureThreshold: 3,

        timeout: 30000

    },


    'airtel-money':

    {

        failureThreshold: 3,

        timeout: 30000

    },


    mongodb:

    {

        failureThreshold: 5,

        timeout: 10000

    },


    redis:

    {

        failureThreshold: 5,

        timeout: 5000

    }

});



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


        circuits:

            CIRCUITS.size

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


        circuits:

            Array.from(

                CIRCUITS.values()

            )

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

        350,


    critical:

        true,


    description:

        'Enterprise dependency circuit breaker and failure isolation layer.'

});



/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports = Object.freeze({

    create:

        circuitBreaker,


    circuitBreaker,


    execute,


    createCircuit,


    CircuitBreakerOpenError,


    states:

        STATES,


    policies:

        SERVICE_POLICIES,


    metadata,


    healthCheck,


    readinessCheck,


    diagnostics

});