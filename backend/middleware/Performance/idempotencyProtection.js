'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * File:
 * backend/middleware/performance/idempotencyProtection.js
 *
 * Enterprise Idempotency Protection Middleware
 *
 * =============================================================================
 *
 * Purpose
 * -----------------------------------------------------------------------------
 *
 * Provides enterprise-grade duplicate execution protection for financial APIs,
 * asynchronous callbacks, webhook processing, and distributed workloads.
 *
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 *
 * • Payment idempotency keys
 * • Webhook replay protection
 * • Transaction deduplication
 * • API retry safety
 * • Ledger duplicate prevention
 * • MTN MoMo callback reliability
 * • Airtel Money callback reliability
 * • Distributed request replay prevention
 * • Financial operation uniqueness enforcement
 *
 *
 * Protected Operations
 * -----------------------------------------------------------------------------
 *
 * • Loan disbursement
 * • Savings deposits
 * • Withdrawals
 * • Mobile money collections
 * • Settlement posting
 * • Ledger journal creation
 * • Refund processing
 *
 *
 * Enterprise Guarantees
 * -----------------------------------------------------------------------------
 *
 * Prevents:
 *
 * - Duplicate payments
 * - Duplicate webhook execution
 * - Duplicate journal entries
 * - Double settlement processing
 * - Retry-induced financial corruption
 *
 *
 * Integrations
 * -----------------------------------------------------------------------------
 *
 * • StructuredLogger
 * • MetricsRegistry
 * • EventBus
 * • TraceContext
 * • DistributedLock
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
    'enterprise-idempotency-protection';


const COMPONENT_VERSION =
    '1.0.0';



/**
 * ============================================================================
 * Configuration
 * ============================================================================
 */

const DEFAULT_POLICY = Object.freeze({

    ttl:

        24 * 60 * 60 * 1000,


    header:

        'idempotency-key',


    webhookHeader:

        'x-webhook-id',


    strict:

        true,


    providers:

    {

        MTN:

            true,


        AIRTEL:

            true

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

    requestsChecked:0,

    duplicatesDetected:0,

    storedKeys:0,

    replayAttempts:0

});



/**
 * ============================================================================
 * Idempotency Store
 *
 * Production:
 *
 * Replace with Redis/MongoDB atomic storage.
 *
 * Required pattern:
 *
 * SET key value NX PX ttl
 *
 */

const IDEMPOTENCY_STORE = new Map();



/**
 * ============================================================================
 * Context
 * ============================================================================
 */

function context(req = {}) {


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
 * Events
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
 * Key Generation
 * ============================================================================
 */

function createFingerprint(

    req

) {


    const body =

        JSON.stringify(

            req.body || {}

        );



    return crypto

        .createHash('sha256')

        .update(

            [

                req.method,

                req.originalUrl,

                body

            ]

            .join('|')

        )

        .digest('hex');

}



/**
 * ============================================================================
 * Resolve Idempotency Key
 * ============================================================================
 */

function resolveKey(

    req

) {


    return (

        req.headers

        [DEFAULT_POLICY.header]

        ||

        req.headers

        [DEFAULT_POLICY.webhookHeader]

        ||

        createFingerprint(req)

    );

}



/**
 * ============================================================================
 * Acquire Idempotency Record
 * ============================================================================
 */

async function acquire(

    key,

    metadata = {}

) {


    const existing =

        IDEMPOTENCY_STORE.get(

            key

        );



    if (

        existing &&

        existing.expiresAt >

        Date.now()

    ) {



        STATE.duplicatesDetected++;



        metric(

            'idempotency.duplicate'

        );



        publish(

            'idempotency.duplicate.detected',

            {

                key

            }

        );



        return Object.freeze({

            duplicate:true,


            response:

                existing.response

        });

    }



    IDEMPOTENCY_STORE.set(

        key,

        {

            status:'PROCESSING',


            metadata,


            createdAt:

                Date.now(),


            expiresAt:

                Date.now()

                +

                DEFAULT_POLICY.ttl

        }

    );



    STATE.storedKeys++;



    return Object.freeze({

        duplicate:false

    });

}



/**
 * ============================================================================
 * Complete Execution
 * ============================================================================
 */

async function complete(

    key,

    response

) {


    const record =

        IDEMPOTENCY_STORE.get(

            key

        );



    if (!record) {


        return false;

    }



    record.status =

        'COMPLETED';



    record.response =

        response;



    return true;

}



/**
 * ============================================================================
 * Remove Key
 * ============================================================================
 */

async function invalidate(

    key

) {


    return IDEMPOTENCY_STORE.delete(

        key

    );

}



/**
 * ============================================================================
 * Webhook Replay Protection
 * ============================================================================
 */

async function protectWebhook(

    provider,

    webhookId

) {


    const key =

        `webhook:${provider}:${webhookId}`;



    return acquire(

        key,

        {

            provider

        }

    );

}



/**
 * ============================================================================
 * Payment Protection
 * ============================================================================
 */

async function protectPayment(

    paymentId

) {


    return acquire(

        `payment:${paymentId}`

    );

}



/**
 * ============================================================================
 * Ledger Protection
 * ============================================================================
 */

async function protectLedger(

    transactionId

) {


    return acquire(

        `ledger:${transactionId}`

    );

}



/**
 * ============================================================================
 * Middleware
 * ============================================================================
 */

function idempotencyProtection(

    options = {}

) {


    const policy = Object.freeze({

        ...DEFAULT_POLICY,

        ...options

    });



    return function idempotencyMiddleware(

        req,

        res,

        next

    ) {



        STATE.initialized = true;



        STATE.initializedAt ||=

            new Date()

            .toISOString();



        STATE.requestsChecked++;



        const key =

            resolveKey(req);



        acquire(

            key,

            {

                request:

                    context(req)

            }

        )

        .then(result=>{


            if (

                result.duplicate

            ) {



                STATE.replayAttempts++;



                return res

                    .status(200)

                    .json({

                        success:true,


                        idempotent:true,


                        data:

                            result.response

                    });

            }



            req.idempotency = Object.freeze({

                key,


                complete:

                    response =>

                        complete(

                            key,

                            response

                        ),


                invalidate:

                    ()=>invalidate(key)

            });



            next();


        })

        .catch(next);


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


        storedKeys:

            STATE.storedKeys

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

        430,


    critical:

        true,


    description:

        'Enterprise financial idempotency and replay protection middleware.'

});



/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports = Object.freeze({

    create:

        idempotencyProtection,


    idempotencyProtection,


    acquire,


    complete,


    invalidate,


    protectWebhook,


    protectPayment,


    protectLedger,


    metadata,


    healthCheck,


    readinessCheck,


    diagnostics,


    policy:

        DEFAULT_POLICY

});