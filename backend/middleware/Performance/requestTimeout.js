'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * File:
 * backend/middleware/performance/requestTimeout.js
 *
 * Enterprise Request Timeout Middleware
 *
 * =============================================================================
 *
 * Purpose
 * -----------------------------------------------------------------------------
 *
 * Production-grade request lifecycle timeout protection for the TITech Community
 * Capital fintech platform.
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 *
 * • Controller execution timeout protection
 * • MongoDB operation timeout propagation
 * • External API timeout policies
 * • MTN MoMo API protection
 * • Airtel Money API protection
 * • Graceful request cancellation
 * • AbortController integration
 * • OpenTelemetry timeout spans
 * • Timeout metrics
 * • Timeout events
 * • Enterprise diagnostics
 *
 *
 * Designed For
 * -----------------------------------------------------------------------------
 *
 * • Express Application Factory
 * • Payment integrations
 * • Ledger processing
 * • Background workflows
 * • MongoDB operations
 * • External service calls
 * • Kubernetes workloads
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
 * • OpenTelemetry
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



const LoggerFactory =

    loadOptionalDependency(

        '../../shared/logging/LoggerFactory'

    );



const MetricsRegistry =

    loadOptionalDependency(

        '../../shared/metrics/MetricsRegistry'

    );



const RequestMetrics =

    loadOptionalDependency(

        '../../shared/metrics/RequestMetrics'

    );



const EventBus =

    loadOptionalDependency(

        '../../shared/events/EventBus'

    );



const TraceContext =

    loadOptionalDependency(

        '../../shared/tracing/TraceContext'

    );



const OpenTelemetry =

    loadOptionalDependency(

        '../../shared/tracing/OpenTelemetry'

    );



/**
 * ============================================================================
 * Component Identity
 * ============================================================================
 */

const COMPONENT_NAME =
    'enterprise-request-timeout';


const COMPONENT_VERSION =
    '1.0.0';



/**
 * ============================================================================
 * Timeout Policies
 * ============================================================================
 */

const TIMEOUT_POLICIES = Object.freeze({

    DEFAULT:

        30000,


    CONTROLLER:

        30000,


    DATABASE:

        15000,


    MONGODB:

        10000,


    EXTERNAL_API:

        20000,


    MOBILE_MONEY:

        30000,


    MTN_MOMO:

        30000,


    AIRTEL_MONEY:

        30000,


    HEALTH:

        5000

});



/**
 * ============================================================================
 * Runtime State
 * ============================================================================
 */

const INTERNAL_STATE = Object.seal({

    initialized:

        false,


    initializedAt:

        null,


    timeoutCount:

        0,


    cancelledRequests:

        0,


    activeRequests:

        0

});



/**
 * ============================================================================
 * Timeout Error
 * ============================================================================
 */

class RequestTimeoutError extends Error {


    constructor(message, details = {}) {


        super(

            message ||

            'Request execution timeout.'

        );


        this.name =

            'RequestTimeoutError';


        this.code =

            'REQUEST_TIMEOUT';


        this.statusCode =

            504;


        this.details =

            details;


        this.operational = true;


    }

}



/**
 * ============================================================================
 * Trace Helpers
 * ============================================================================
 */

function createTimeoutSpan(req) {


    try {


        return OpenTelemetry

            ?.startSpan?.(

                'http.request.timeout',

                {

                    attributes:

                    {

                        requestId:

                            req.id,

                        correlationId:

                            req.context

                            ?.correlationId

                    }

                }

            );


    }

    catch (_) {


        return null;

    }

}



/**
 * ============================================================================
 * Observability Helpers
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



function publishTimeoutEvent(

    type,

    req,

    metadata = {}

) {


    try {


        EventBus

            ?.publish?.(

                type,

                Object.freeze({

                    ...buildContext(req),

                    ...metadata,

                    timestamp:

                        new Date()

                        .toISOString()

                })

            );


    }

    catch (_) {}

}



function recordTimeoutMetric(

    name

) {


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
 * Determine Timeout Policy
 * ============================================================================
 */

function resolveTimeout(options = {}) {


    return options.timeout ||

        TIMEOUT_POLICIES.DEFAULT;

}



/**
 * ============================================================================
 * Request Timeout Middleware
 * ============================================================================
 */

function requestTimeout(options = {}) {


    const timeout =

        resolveTimeout(options);



    return function requestTimeoutMiddleware(

        req,

        res,

        next

    ) {


        INTERNAL_STATE.initialized = true;


        INTERNAL_STATE.initializedAt ||=

            new Date()

            .toISOString();



        INTERNAL_STATE.activeRequests++;



        const controller =

            new AbortController();



        req.abortController =

            controller;



        req.signal =

            controller.signal;



        const span =

            createTimeoutSpan(req);



        let completed = false;



        const timer = setTimeout(

            () => {


                if (completed) {

                    return;

                }



                INTERNAL_STATE.timeoutCount++;



                controller.abort();



                const error =

                    new RequestTimeoutError(

                        'Request exceeded allowed execution time.',

                        {

                            timeout,

                            method:

                                req.method,

                            url:

                                req.originalUrl

                        }

                    );



                recordTimeoutMetric(

                    'request_timeout_total'

                );



                publishTimeoutEvent(

                    'request.timeout',

                    req,

                    {

                        timeout,

                        error:

                            error.message

                    }

                );



                req.logger

                    ?.error?.(

                        {

                            ...buildContext(req),

                            timeout,

                            error

                        },

                        'Request timeout exceeded'

                    );



                if (!res.headersSent) {


                    res

                        .status(504)

                        .json({

                            success:

                                false,

                            message:

                                'Request timeout.'

                        });

                }



            },

            timeout

        );



        /**
         * Request completed normally.
         */
        res.once(

            'finish',

            () => {


                completed = true;


                clearTimeout(timer);



                INTERNAL_STATE.activeRequests--;



                span

                    ?.end?.();


            }

        );



        /**
         * Client disconnected.
         */
        req.once(

            'close',

            () => {


                if (!completed) {


                    INTERNAL_STATE.cancelledRequests++;


                    controller.abort();



                    publishTimeoutEvent(

                        'request.cancelled',

                        req

                    );

                }


            }

        );



        next();


    };

}



/**
 * ============================================================================
 * External Service Timeout Helper
 * ============================================================================
 *
 * Used by:
 *
 * MTN MoMo
 * Airtel Money
 * Email providers
 * Third-party APIs
 *
 * ============================================================================
 */

function createExternalTimeoutSignal(

    timeout = TIMEOUT_POLICIES.EXTERNAL_API

) {


    const controller =

        new AbortController();



    const timer =

        setTimeout(

            () =>

                controller.abort(),

            timeout

        );



    return {

        signal:

            controller.signal,


        cancel() {


            clearTimeout(timer);


            controller.abort();


        }

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


        timestamp:

            new Date()

            .toISOString()

    });

}



async function readinessCheck() {


    return Object.freeze({

        component:

            COMPONENT_NAME,


        ready:

            INTERNAL_STATE.initialized,


        activeRequests:

            INTERNAL_STATE.activeRequests

    });

}



function diagnostics() {


    return Object.freeze({

        metadata,


        runtime:

        {

            ...INTERNAL_STATE

        },


        policies:

            TIMEOUT_POLICIES

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

        320,


    critical:

        true,


    description:

        'Enterprise request timeout and cancellation middleware.'

});



/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports = Object.freeze({

    create:

        requestTimeout,


    requestTimeout,


    createExternalTimeoutSignal,


    RequestTimeoutError,


    metadata,


    healthCheck,


    readinessCheck,


    diagnostics,


    policies:

        TIMEOUT_POLICIES

});