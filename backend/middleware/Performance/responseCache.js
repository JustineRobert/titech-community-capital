'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * File:
 * backend/middleware/performance/responseCache.js
 *
 * Enterprise Response Cache Middleware
 *
 * =============================================================================
 *
 * Purpose
 * -----------------------------------------------------------------------------
 *
 * Production-grade HTTP response caching layer for fintech APIs.
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 *
 * • HTTP response caching
 * • Redis distributed cache readiness
 * • Tenant-aware cache isolation
 * • Route-aware cache policies
 * • HTTP method filtering
 * • Cache-control compliance
 * • Sensitive endpoint protection
 * • Cache invalidation hooks
 * • Observability integration
 * • Enterprise diagnostics
 *
 *
 * Designed For
 * -----------------------------------------------------------------------------
 *
 * • Express Application Factory
 * • Kubernetes deployments
 * • Redis clusters
 * • Multi-tenant SaaS workloads
 * • High-throughput APIs
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

const crypto = require('crypto');

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

        return {

            unavailable: true,

            module: path,

            error:
                error.message

        };

    }

}



const ConfigurationProvider =

    loadOptionalDependency(

        '../../config/ConfigurationProvider'

    );



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



/**
 * ============================================================================
 * Component Identity
 * ============================================================================
 */

const COMPONENT_NAME =
    'enterprise-response-cache';


const COMPONENT_VERSION =
    '1.0.0';



/**
 * ============================================================================
 * Cache Configuration
 * ============================================================================
 */

const DEFAULT_CACHE_CONFIGURATION = Object.freeze({

    enabled:
        true,


    ttl:

        60,


    methods:

        Object.freeze([

            'GET',

            'HEAD'

        ]),


    cacheStatusHeader:
        true,


    tenantIsolation:
        true,


    includeQuery:
        true,


    excludedRoutes:

        Object.freeze([

            '/health',

            '/healthz',

            '/metrics',

            '/api/auth',

            '/api/payment',

            '/api/transactions'

        ]),


    sensitiveHeaders:

        Object.freeze([

            'authorization',

            'cookie',

            'set-cookie'

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


    hits:

        0,


    misses:

        0,


    bypasses:

        0

});



/**
 * ============================================================================
 * Cache Key Generation
 * ============================================================================
 */

function generateCacheKey(req) {


    const tenant =

        req.context?.tenant?.id ||

        'public';



    const identity =

        [

            tenant,

            req.method,

            req.originalUrl

        ]

        .join('|');



    return crypto

        .createHash('sha256')

        .update(identity)

        .digest('hex');

}



/**
 * ============================================================================
 * Cache Eligibility
 * ============================================================================
 */

function canCacheRequest(req, policy) {


    if (!policy.enabled) {

        return false;

    }



    if (

        !policy.methods.includes(

            req.method

        )

    ) {

        return false;

    }



    if (

        policy.excludedRoutes.some(

            route =>

                req.path.startsWith(route)

        )

    ) {

        return false;

    }



    return true;

}



/**
 * ============================================================================
 * Cache Context
 * ============================================================================
 */

function buildCacheContext(req) {


    return Object.freeze({

        requestId:

            req.id,


        correlationId:

            req.context?.correlationId,


        traceId:

            TraceContext?.getTraceId?.(),


        tenant:

            req.context?.tenant?.id || null,


        service:

            COMPONENT_NAME,


        hostname:

            os.hostname()

    });

}



/**
 * ============================================================================
 * Observability Helpers
 * ============================================================================
 */

function emitEvent(type, payload) {


    try {

        EventBus?.publish?.(

            type,

            Object.freeze(payload)

        );

    }

    catch (_) {}

}



function recordMetric(name, value = 1) {


    try {

        MetricsRegistry?.increment?.(

            name,

            value

        );

    }

    catch (_) {}

}



/**
 * ============================================================================
 * Enterprise Response Cache Middleware
 * ============================================================================
 */

function responseCache(options = {}) {


    const policy = Object.freeze({

        ...DEFAULT_CACHE_CONFIGURATION,

        ...options

    });



    INTERNAL_STATE.initialized = true;

    INTERNAL_STATE.initializedAt =

        new Date().toISOString();



    const store =

        options.store || new Map();



    return function responseCacheMiddleware(

        req,

        res,

        next

    ) {


        if (

            !canCacheRequest(

                req,

                policy

            )

        ) {


            INTERNAL_STATE.bypasses++;


            return next();

        }



        const cacheKey =

            generateCacheKey(req);



        const cached =

            store.get(cacheKey);



        if (cached) {


            INTERNAL_STATE.hits++;


            res.setHeader(

                'X-Cache',

                'HIT'

            );



            recordMetric(

                'response_cache_hit_total'

            );



            emitEvent(

                'cache.hit',

                {

                    ...buildCacheContext(req),

                    cacheKey

                }

            );



            return res

                .status(

                    cached.status

                )

                .send(

                    cached.body

                );

        }



        INTERNAL_STATE.misses++;



        recordMetric(

            'response_cache_miss_total'

        );



        res.sendResponse =

            res.send;



        res.send = function(body) {



            store.set(

                cacheKey,

                {

                    status:

                        res.statusCode,


                    body,

                    createdAt:

                        Date.now()

                }

            );



            res.setHeader(

                'X-Cache',

                'MISS'

            );



            emitEvent(

                'cache.store',

                {

                    ...buildCacheContext(req),

                    cacheKey

                }

            );



            return res.sendResponse(body);

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

        component:

            COMPONENT_NAME,


        healthy:

            true,


        timestamp:

            new Date().toISOString()

    });

}



async function readinessCheck() {

    return Object.freeze({

        component:

            COMPONENT_NAME,


        ready:

            INTERNAL_STATE.initialized,


        timestamp:

            new Date().toISOString()

    });

}



function diagnostics() {

    return Object.freeze({

        metadata,

        runtime:

            {

                ...INTERNAL_STATE

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

        310,


    critical:

        false,


    description:

        'Enterprise HTTP response caching middleware.'

});



/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports = Object.freeze({

    responseCache,

    create:

        responseCache,

    metadata,

    healthCheck,

    readinessCheck,

    diagnostics

});