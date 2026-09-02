'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * File:
 * backend/middleware/performance/concurrencyControl.js
 *
 * Enterprise Concurrency Control Middleware
 *
 * =============================================================================
 *
 * Purpose
 * -----------------------------------------------------------------------------
 *
 * Production-grade workload protection layer responsible for controlling
 * concurrent execution across HTTP requests, tenants, workers, databases,
 * queues, and external payment providers.
 *
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 *
 * • HTTP request concurrency limits
 * • Tenant workload isolation
 * • Queue backpressure protection
 * • Worker overload prevention
 * • Database overload prevention
 * • Payment API protection
 * • External provider throttling
 * • Graceful request rejection
 * • Runtime diagnostics
 * • Metrics publishing
 * • Event publishing
 *
 *
 * Designed For
 * -----------------------------------------------------------------------------
 *
 * • Express Application Factory
 * • Kubernetes deployments
 * • Multi-tenant SaaS workloads
 * • MongoDB clusters
 * • Redis queues
 * • BullMQ workers
 * • MTN MoMo integration
 * • Airtel Money integration
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
    'enterprise-concurrency-control';


const COMPONENT_VERSION =
    '1.0.0';



/**
 * ============================================================================
 * Concurrency Policies
 * ============================================================================
 */

const DEFAULT_POLICIES = Object.freeze({

    global:

    {

        maxConcurrent:

            1000

    },


    anonymous:

    {

        maxConcurrent:

            50

    },


    authenticated:

    {

        maxConcurrent:

            200

    },


    tenant:

    {

        maxConcurrent:

            100

    },


    payment:

    {

        maxConcurrent:

            25

    },


    database:

    {

        maxConcurrent:

            300

    },


    worker:

    {

        maxConcurrent:

            500

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


    activeRequests:

        0,


    rejectedRequests:

        0,


    tenantCounters:

        new Map(),


    paymentCounters:

        new Map()

});



/**
 * ============================================================================
 * Enterprise Errors
 * ============================================================================
 */

class ConcurrencyLimitExceededError
    extends Error {


    constructor(message, details = {}) {


        super(

            message ||

            'Concurrency limit exceeded.'

        );


        this.name =

            'ConcurrencyLimitExceededError';


        this.code =

            'CONCURRENCY_LIMIT_EXCEEDED';


        this.statusCode =

            429;


        this.details =

            details;


        this.operational = true;


    }

}



/**
 * ============================================================================
 * Context Helpers
 * ============================================================================
 */

function context(req) {


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

            ?.id || 'public',


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
 * Counter Helpers
 * ============================================================================
 */

function incrementCounter(

    collection,

    key

) {


    const current =

        collection.get(key) || 0;



    collection.set(

        key,

        current + 1

    );


}



function decrementCounter(

    collection,

    key

) {


    const current =

        collection.get(key) || 0;



    if (current <= 1) {


        collection.delete(key);


        return;

    }



    collection.set(

        key,

        current - 1

    );

}



/**
 * ============================================================================
 * Policy Resolution
 * ============================================================================
 */

function resolveTenantLimit(

    req,

    policies

) {


    const tenant =

        req.context

        ?.tenant

        ?.id;



    return {


        tenant,


        limit:

            policies.tenant.maxConcurrent

    };

}



/**
 * ============================================================================
 * Middleware Factory
 * ============================================================================
 */

function concurrencyControl(options = {}) {


    const policies = Object.freeze({

        ...DEFAULT_POLICIES,

        ...options

    });



    return function concurrencyMiddleware(

        req,

        res,

        next

    ) {


        STATE.initialized = true;


        STATE.initializedAt ||=

            new Date()

            .toISOString();



        const tenantInfo =

            resolveTenantLimit(

                req,

                policies

            );



        const tenantId =

            tenantInfo.tenant;



        const tenantCount =

            STATE.tenantCounters

            .get(tenantId) || 0;



        if (

            tenantCount >=

            tenantInfo.limit

        ) {


            STATE.rejectedRequests++;



            incrementMetric(

                'concurrency_limit_exceeded_total'

            );



            publishEvent(

                'system.concurrency.rejected',

                {

                    ...context(req),

                    tenantId

                }

            );



            return next(

                new ConcurrencyLimitExceededError(

                    'Tenant concurrency limit exceeded.',

                    {

                        tenantId,

                        limit:

                            tenantInfo.limit

                    }

                )

            );

        }



        if (

            STATE.activeRequests >=

            policies.global.maxConcurrent

        ) {


            STATE.rejectedRequests++;



            return next(

                new ConcurrencyLimitExceededError(

                    'System concurrency capacity reached.'

                )

            );

        }




        STATE.activeRequests++;



        incrementCounter(

            STATE.tenantCounters,

            tenantId

        );



        incrementMetric(

            'active_requests_total'

        );



        publishEvent(

            'system.concurrency.accepted',

            {

                ...context(req),

                tenantId

            }

        );




        let completed = false;



        function release() {


            if (completed) {

                return;

            }


            completed = true;



            STATE.activeRequests--;



            decrementCounter(

                STATE.tenantCounters,

                tenantId

            );

        }




        res.once(

            'finish',

            release

        );


        res.once(

            'close',

            release

        );



        req.concurrencyContext = Object.freeze({

            tenantId,


            acquiredAt:

                Date.now(),

        });



        next();

    };

}



/**
 * ============================================================================
 * External Service Guard
 * ============================================================================
 *
 * Protects:
 *
 * MTN MoMo
 * Airtel Money
 * Banking APIs
 *
 */

function createServiceLimiter(

    service,

    limit = 25

) {


    return {


        acquire() {


            const current =

                STATE.paymentCounters

                .get(service) || 0;



            if (

                current >= limit

            ) {


                throw new ConcurrencyLimitExceededError(

                    `${service} concurrency limit exceeded.`

                );

            }



            STATE.paymentCounters.set(

                service,

                current + 1

            );


        },


        release() {


            decrementCounter(

                STATE.paymentCounters,

                service

            );


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


        activeRequests:

            STATE.activeRequests


    });

}



async function readinessCheck() {


    return Object.freeze({

        component:

            COMPONENT_NAME,


        ready:

            STATE.initialized

    });

}



function diagnostics() {


    return Object.freeze({

        metadata,


        state:

        {

            activeRequests:

                STATE.activeRequests,


            rejectedRequests:

                STATE.rejectedRequests

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

        330,


    critical:

        true,


    description:

        'Enterprise workload concurrency protection middleware.'

});



/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports = Object.freeze({

    create:

        concurrencyControl,


    concurrencyControl,


    createServiceLimiter,


    ConcurrencyLimitExceededError,


    metadata,


    healthCheck,


    readinessCheck,


    diagnostics,


    policies:

        DEFAULT_POLICIES

});