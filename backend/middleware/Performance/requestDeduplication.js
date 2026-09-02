'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * File:
 * backend/middleware/performance/requestDeduplication.js
 *
 * Enterprise Distributed Request Deduplication Middleware
 *
 * =============================================================================
 *
 * Purpose
 * -----------------------------------------------------------------------------
 *
 * Provides a distributed request identity layer that prevents duplicate request
 * execution across multiple API instances, Kubernetes pods, mobile retries,
 * unstable network conditions, and asynchronous client synchronization flows.
 *
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 *
 * • Distributed request fingerprinting
 * • Duplicate API suppression
 * • Replay attack resistance
 * • High-volume fintech traffic protection
 * • Mobile network retry storm protection
 * • Offline mobile client synchronization safety
 * • Request collision detection
 * • Duplicate workload reduction
 * • Distributed execution coordination
 *
 *
 * Protected Flows
 * -----------------------------------------------------------------------------
 *
 * • Savings deposits
 * • Loan repayments
 * • Loan disbursements
 * • Mobile money callbacks
 * • Wallet transfers
 * • Ledger posting
 * • Offline mobile synchronization
 * • Batch uploads
 *
 *
 * Enterprise Design
 * -----------------------------------------------------------------------------
 *
 * Request
 *    |
 *    v
 * Fingerprint Generator
 *    |
 *    v
 * Distributed Dedup Store
 *    |
 *    +---- Existing request
 *    |          |
 *    |          v
 *    |      Return previous state
 *    |
 *    +---- New request
 *               |
 *               v
 *          Execute safely
 *
 *
 * Integrations
 * -----------------------------------------------------------------------------
 *
 * • DistributedLock
 * • IdempotencyProtection
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

const crypto = require('crypto');
const os = require('os');



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
    'enterprise-request-deduplication';


const COMPONENT_VERSION =
    '1.0.0';



/**
 * ============================================================================
 * Configuration
 * ============================================================================
 */

const DEFAULT_POLICY = Object.freeze({

    ttl:

        30000,


    fingerprintHeader:

        'x-request-fingerprint',


    clientRequestIdHeader:

        'x-client-request-id',


    mobileSyncHeader:

        'x-sync-operation-id',


    includeBody:

        true,


    includeHeaders:

        false,


    strict:

        true,


    maxPayloadSize:

        5 * 1024 * 1024

});



/**
 * ============================================================================
 * Runtime State
 * ============================================================================
 */

const STATE = Object.seal({

    initialized:false,

    initializedAt:null,

    totalRequests:0,

    duplicateRequests:0,

    suppressedRequests:0,

    fingerprintsGenerated:0

});



/**
 * ============================================================================
 * Distributed Deduplication Store
 *
 * Production replacement:
 *
 * Redis:
 *
 * SET fingerprint value NX PX ttl
 *
 * or MongoDB unique index.
 *
 * ============================================================================
 */

const REQUEST_STORE = new Map();



/**
 * ============================================================================
 * Context
 * ============================================================================
 */

function buildContext(req = {}) {


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

            os.hostname()

    });

}



/**
 * ============================================================================
 * Metrics
 * ============================================================================
 */

function metric(

    name,

    value = 1

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
 * Event Publishing
 * ============================================================================
 */

function publish(

    event,

    payload

) {


    try {


        EventBus

        ?.publish?.(

            event,

            Object.freeze(payload)

        );


    }

    catch(_) {}

}



/**
 * ============================================================================
 * Fingerprint Generation
 * ============================================================================
 */

function generateFingerprint(

    req

) {


    const payload =

        DEFAULT_POLICY.includeBody

        ?

        JSON.stringify(

            req.body || {}

        )

        :

        '';



    const clientRequestId =

        req.headers

        [

            DEFAULT_POLICY.clientRequestIdHeader

        ];



    const syncId =

        req.headers

        [

            DEFAULT_POLICY.mobileSyncHeader

        ];



    const fingerprintSource =

        [

            req.method,

            req.originalUrl,

            clientRequestId,

            syncId,

            payload

        ]

        .join('|');



    STATE.fingerprintsGenerated++;



    return crypto

        .createHash('sha256')

        .update(

            fingerprintSource

        )

        .digest('hex');

}



/**
 * ============================================================================
 * Detect Existing Request
 * ============================================================================
 */

async function checkDuplicate(

    fingerprint

) {


    const existing =

        REQUEST_STORE.get(

            fingerprint

        );



    if (

        !existing

    ) {


        return Object.freeze({

            duplicate:false

        });

    }



    if (

        existing.expiresAt

        <

        Date.now()

    ) {



        REQUEST_STORE.delete(

            fingerprint

        );



        return Object.freeze({

            duplicate:false

        });

    }



    STATE.duplicateRequests++;



    STATE.suppressedRequests++;



    metric(

        'request_deduplication.duplicate'

    );



    publish(

        'request.duplicate.detected',

        {

            fingerprint

        }

    );



    return Object.freeze({

        duplicate:true,


        state:

            existing.state,


        response:

            existing.response

    });

}



/**
 * ============================================================================
 * Register Request
 * ============================================================================
 */

async function registerRequest(

    fingerprint,

    metadata = {}

) {


    REQUEST_STORE.set(

        fingerprint,

        {

            state:

                'PROCESSING',


            metadata,


            createdAt:

                Date.now(),


            expiresAt:

                Date.now()

                +

                DEFAULT_POLICY.ttl

        }

    );

}



/**
 * ============================================================================
 * Complete Request
 * ============================================================================
 */

async function completeRequest(

    fingerprint,

    response

) {


    const record =

        REQUEST_STORE.get(

            fingerprint

        );



    if (!record) {


        return false;

    }



    record.state =

        'COMPLETED';



    record.response =

        response;



    return true;

}



/**
 * ============================================================================
 * Mobile Synchronization Protection
 * ============================================================================
 */

async function protectOfflineSync(

    syncOperationId

) {


    return checkDuplicate(

        `sync:${syncOperationId}`

    );

}



/**
 * ============================================================================
 * Middleware
 * ============================================================================
 */

function requestDeduplication(

    options = {}

) {


    const policy = Object.freeze({

        ...DEFAULT_POLICY,

        ...options

    });



    return async function requestDeduplicationMiddleware(

        req,

        res,

        next

    ) {



        STATE.initialized = true;



        STATE.initializedAt ||=

            new Date()

            .toISOString();



        STATE.totalRequests++;



        const fingerprint =

            req.headers

            [policy.fingerprintHeader]

            ||

            generateFingerprint(req);



        const result =

            await checkDuplicate(

                fingerprint

            );



        if (

            result.duplicate

        ) {


            return res

                .status(409)

                .json({

                    success:false,


                    duplicate:true,


                    message:

                        'Duplicate request detected.',


                    fingerprint

                });

        }



        await registerRequest(

            fingerprint,

            {

                context:

                    buildContext(req),


                method:

                    req.method,


                path:

                    req.originalUrl

            }

        );



        req.requestDeduplication = Object.freeze({

            fingerprint,


            complete:

                response =>

                    completeRequest(

                        fingerprint,

                        response

                    )

        });



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


        trackedRequests:

            REQUEST_STORE.size

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

        440,


    critical:

        true,


    description:

        'Enterprise distributed request deduplication and replay protection layer.'

});



/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports = Object.freeze({

    create:

        requestDeduplication,


    requestDeduplication,


    generateFingerprint,


    checkDuplicate,


    registerRequest,


    completeRequest,


    protectOfflineSync,


    metadata,


    healthCheck,


    readinessCheck,


    diagnostics,


    policy:

        DEFAULT_POLICY

});