'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * File:
 * backend/middleware/tenancy/tenantContext.js
 *
 * Enterprise Tenant Context Middleware
 *
 * -----------------------------------------------------------------------------
 * Purpose
 * -----------------------------------------------------------------------------
 *
 * Provides enterprise tenant context propagation across the complete request
 * lifecycle.
 *
 * Responsibilities:
 *
 * • Inject req.tenantContext
 * • Bind AsyncLocalStorage tenant context
 * • Enrich distributed tracing
 * • Tag request metrics
 * • Correlate audit events
 * • Propagate tenant identity through EventBus
 * • Provide downstream service access
 * • Integrate with createApp() middleware pipeline
 *
 * Designed For:
 *
 * • Multi-tenant SaaS
 * • SACCO / VSLA fintech workloads
 * • Kubernetes deployments
 * • Distributed services
 * • Background workers
 *
 * =============================================================================
 */


const {

    AsyncLocalStorage

} = require('async_hooks');


/**
 * ============================================================================
 * Optional Enterprise Dependencies
 * ============================================================================
 */

let LoggerFactory;
let StructuredLogger;
let TraceContext;
let RequestMetrics;
let MetricsRegistry;
let EventBus;
let AuditService;


try {

    LoggerFactory =
        require('../../shared/logging/LoggerFactory');

}

catch (_) {}


try {

    StructuredLogger =
        require('../../shared/logging/StructuredLogger');

}

catch (_) {}


try {

    TraceContext =
        require('../../shared/tracing/TraceContext');

}

catch (_) {}


try {

    RequestMetrics =
        require('../../shared/metrics/RequestMetrics');

}

catch (_) {}


try {

    MetricsRegistry =
        require('../../shared/metrics/MetricsRegistry');

}

catch (_) {}


try {

    EventBus =
        require('../../shared/events/EventBus');

}

catch (_) {}


try {

    AuditService =
        require('../../shared/audit/AuditService');

}

catch (_) {}



/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const COMPONENT_NAME =
    'EnterpriseTenantContextMiddleware';


const COMPONENT_VERSION =
    '1.0.0';



const TENANT_CONTEXT_KEY =
    Symbol.for(
        'titech.tenant.context'
    );



/**
 * ============================================================================
 * Runtime Context Storage
 * ============================================================================
 *
 * AsyncLocalStorage allows any downstream service to access tenant context
 * without manually passing tenantId through every function.
 *
 */

const tenantStorage =
    new AsyncLocalStorage();



/**
 * ============================================================================
 * Metadata
 * ============================================================================
 */

const METADATA = Object.freeze({

    name:
        COMPONENT_NAME,

    version:
        COMPONENT_VERSION,

    category:
        'tenancy',

    type:
        'middleware',

    critical:
        true,

    supports:

        Object.freeze([

            'tenant-context',

            'async-local-storage',

            'tracing',

            'metrics',

            'audit',

            'events'

        ])

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

    requests:
        0,

    tenantBindings:
        0,

    lastTenant:
        null,

    lastHealthCheck:
        null

});



/**
 * ============================================================================
 * Tenant Context Access API
 * ============================================================================
 */


function getTenantContext() {


    const store =
        tenantStorage.getStore();


    return store?.tenantContext || null;


}




function requireTenantContext() {


    const context =
        getTenantContext();


    if (!context) {

        throw new Error(
            'Tenant context is unavailable.'
        );

    }


    return context;


}



/**
 * ============================================================================
 * Trace Context Integration
 * ============================================================================
 */

function enrichTrace(context, req) {


    if (!TraceContext) {

        return;

    }


    try {


        TraceContext.setAttributes({

            tenantId:
                context.tenantId,

            tenantCode:
                context.code,

            tenantPlan:
                context.plan?.name

        });


    }

    catch (_) {}

}



/**
 * ============================================================================
 * Metrics Integration
 * ============================================================================
 */


function tagMetrics(context) {


    if (!RequestMetrics) {

        return;

    }


    try {


        RequestMetrics.tag({

            tenantId:
                context.tenantId,

            tenantPlan:
                context.plan?.name

        });


    }

    catch (_) {}

}



/**
 * ============================================================================
 * Audit Correlation
 * ============================================================================
 */


function enrichAudit(context, req) {


    if (!AuditService) {

        return;

    }


    try {


        AuditService.setContext({

            tenantId:
                context.tenantId,

            tenantCode:
                context.code,

            requestId:
                req.id

        });


    }

    catch (_) {}

}



/**
 * ============================================================================
 * EventBus Propagation
 * ============================================================================
 */


async function publishTenantContext(context) {


    if (!EventBus) {

        return;

    }


    try {


        await EventBus.publish(

            'tenant.context.bound',

            {

                tenantId:
                    context.tenantId,

                plan:
                    context.plan?.name

            }

        );


    }

    catch (_) {}

}



/**
 * ============================================================================
 * Middleware Factory
 * ============================================================================
 */


function createTenantContextMiddleware(options = {}) {


    const logger =

        options.logger ||

        StructuredLogger ||

        LoggerFactory;



    INTERNAL_STATE.initialized =
        true;


    INTERNAL_STATE.initializedAt =
        new Date();



    return async function tenantContextMiddleware(

        req,

        res,

        next

    ) {



        INTERNAL_STATE.requests++;



        try {



            /**
             * tenantResolver.js should already have populated this.
             */

            const tenantContext =

                req.tenantContext;



            if (!tenantContext) {


                return next();


            }



            INTERNAL_STATE.tenantBindings++;


            INTERNAL_STATE.lastTenant =

                tenantContext.tenantId;



            /**
             * Attach to Express request
             */

            req.tenantContext =
                tenantContext;



            /**
             * Bind AsyncLocalStorage
             */

            return tenantStorage.run(

                {

                    tenantContext,

                    requestId:
                        req.id,

                    traceId:
                        req.traceId

                },

                async () => {



                    enrichTrace(

                        tenantContext,

                        req

                    );



                    tagMetrics(

                        tenantContext

                    );



                    enrichAudit(

                        tenantContext,

                        req

                    );



                    await publishTenantContext(

                        tenantContext

                    );



                    next();



                }

            );



        }

        catch(error) {


            logger?.error?.(

                'Tenant context middleware failed',

                {

                    error,

                    requestId:
                        req.id

                }

            );


            next(error);


        }


    };


}



/**
 * ============================================================================
 * Diagnostics
 * ============================================================================
 */


function healthCheck() {


    INTERNAL_STATE.lastHealthCheck =
        new Date();



    return Object.freeze({

        status:
            'ok',

        component:
            COMPONENT_NAME,

        initialized:
            INTERNAL_STATE.initialized,

        timestamp:
            INTERNAL_STATE.lastHealthCheck

    });


}



function readinessCheck() {


    return Object.freeze({

        ready:
            INTERNAL_STATE.initialized,

        component:
            COMPONENT_NAME

    });


}



function diagnostics() {


    return Object.freeze({

        metadata:

            METADATA,


        runtime:

            {

                ...INTERNAL_STATE

            }

    });


}



/**
 * ============================================================================
 * createApp() Registration Metadata
 * ============================================================================
 */


const registration = Object.freeze({

    name:
        COMPONENT_NAME,

    phase:
        'tenancy',

    priority:
        50,

    before:

        [

            'authorization',

            'auditSecurity'

        ],

    after:

        [

            'authentication',

            'tenantResolver'

        ]

});



/**
 * ============================================================================
 * Public API
 * ============================================================================
 */

module.exports = Object.freeze({

    createTenantContextMiddleware,

    middleware:
        createTenantContextMiddleware,


    getTenantContext,

    requireTenantContext,


    tenantStorage,


    metadata:
        METADATA,


    registration,


    healthCheck,

    readinessCheck,

    diagnostics

});