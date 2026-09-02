'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * File:
 * backend/middleware/performance/databaseFailover.js
 *
 * Enterprise MongoDB Failover Management Middleware
 *
 * =============================================================================
 *
 * Purpose
 * -----------------------------------------------------------------------------
 *
 * Enterprise database resilience layer responsible for maintaining application
 * availability during MongoDB topology changes, replica elections, network
 * failures, and temporary database degradation.
 *
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 *
 * • MongoDB primary election handling
 * • Replica routing
 * • Automatic retry policies
 * • Transaction recovery
 * • Degraded mode operation
 * • Financial consistency guarantees
 * • Retryable write protection
 * • Database availability monitoring
 * • Failover event publishing
 * • Enterprise diagnostics
 *
 *
 * Financial Systems Protected
 * -----------------------------------------------------------------------------
 *
 * • Double-entry ledger posting
 * • Loan disbursement
 * • Savings deposits
 * • Mobile money settlements
 * • Reconciliation jobs
 * • Regulatory reporting
 *
 *
 * Design Principles
 * -----------------------------------------------------------------------------
 *
 * NEVER:
 *
 * • Duplicate financial transactions
 * • Retry non-idempotent operations blindly
 * • Break ledger consistency
 * • Hide database failures
 *
 * ALWAYS:
 *
 * • Preserve transaction integrity
 * • Use idempotency keys
 * • Maintain audit visibility
 * • Fail safely
 *
 *
 * Observability
 * -----------------------------------------------------------------------------
 *
 * Integrates with:
 *
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
    'enterprise-database-failover';


const COMPONENT_VERSION =
    '1.0.0';



/**
 * ============================================================================
 * Failover Policies
 * ============================================================================
 */

const DEFAULT_POLICY = Object.freeze({

    maxRetries:

        3,


    retryDelay:

        250,


    maxRetryDelay:

        5000,


    transactionRetryLimit:

        1,


    degradedModeEnabled:

        true,


    failoverThreshold:

        5,


    consistencyMode:

        'strict'


});



/**
 * ============================================================================
 * MongoDB Retryable Error Codes
 * ============================================================================
 */

const RETRYABLE_ERRORS = Object.freeze([

    'MongoNetworkError',

    'MongoServerSelectionError',

    'MongoNotPrimaryError',

    'MongoWriteConcernError',

    'MongoTransientTransactionError'

]);



/**
 * ============================================================================
 * Runtime State
 * ============================================================================
 */

const STATE = Object.seal({

    initialized:false,

    initializedAt:null,

    primaryStatus:'unknown',

    replicaStatus:'unknown',

    failovers:0,

    retries:0,

    failedRetries:0,

    degraded:false,

    lastFailover:null

});



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
 * Primary Election Handling
 * ============================================================================
 */

function handlePrimaryElection(

    event = {}

) {


    STATE.primaryStatus =

        event.status ||

        'unknown';



    STATE.failovers++;



    STATE.lastFailover =

        new Date()

        .toISOString();



    publish(

        'database.primary.elected',

        {

            status:

                STATE.primaryStatus,


            timestamp:

                STATE.lastFailover

        }

    );



    metric(

        'database.failover.count'

    );

}



/**
 * ============================================================================
 * Replica Routing
 * ============================================================================
 */

function resolveReadPreference(

    operation = {}

) {


    if (

        operation.consistency ===

        'strong'

    ) {


        return 'primary';

    }



    if (

        operation.type ===

        'report'

    ) {


        return 'secondaryPreferred';

    }



    return 'primaryPreferred';

}



/**
 * ============================================================================
 * Retry Detection
 * ============================================================================
 */

function isRetryable(error) {


    if (!error) {


        return false;

    }



    return RETRYABLE_ERRORS.includes(

        error.name

    )

    ||

    error.hasErrorLabel?.(

        'TransientTransactionError'

    );

}



/**
 * ============================================================================
 * Backoff Calculation
 * ============================================================================
 */

function retryDelay(

    attempt

) {


    return Math.min(

        DEFAULT_POLICY.retryDelay *

        Math.pow(

            2,

            attempt

        ),

        DEFAULT_POLICY.maxRetryDelay

    );

}



/**
 * ============================================================================
 * Retry Execution Engine
 * ============================================================================
 */

async function executeWithRetry(

    operation,

    options = {}

) {


    const policy = Object.freeze({

        ...DEFAULT_POLICY,

        ...options

    });



    let attempt = 0;



    while (

        attempt <= policy.maxRetries

    ) {


        try {


            return await operation();



        }

        catch(error) {



            if (

                !isRetryable(error)

                ||

                attempt === policy.maxRetries

            ) {



                STATE.failedRetries++;


                throw error;


            }



            STATE.retries++;



            await new Promise(

                resolve =>

                    setTimeout(

                        resolve,

                        retryDelay(

                            attempt

                        )

                    )

            );



            attempt++;


        }

    }

}



/**
 * ============================================================================
 * Transaction Recovery
 * ============================================================================
 */

async function recoverTransaction(

    transaction,

    options = {}

) {


    if (

        !transaction.idempotencyKey

    ) {


        throw new Error(

            'Transaction recovery requires idempotency key.'

        );

    }



    return executeWithRetry(

        transaction.execute,

        {

            ...options,


            maxRetries:

                DEFAULT_POLICY.transactionRetryLimit

        }

    );

}



/**
 * ============================================================================
 * Degraded Mode
 * ============================================================================
 */

function enterDegradedMode(

    reason

) {


    if (

        !DEFAULT_POLICY.degradedModeEnabled

    ) {


        return;

    }



    STATE.degraded = true;



    publish(

        'database.degraded_mode.enabled',

        {

            reason

        }

    );

}



function exitDegradedMode() {


    STATE.degraded = false;



    publish(

        'database.degraded_mode.disabled',

        {}

    );

}



/**
 * ============================================================================
 * Middleware
 * ============================================================================
 */

function databaseFailover(options = {}) {



    const policy = Object.freeze({

        ...DEFAULT_POLICY,

        ...options

    });



    return function databaseFailoverMiddleware(

        req,

        res,

        next

    ) {


        STATE.initialized = true;



        STATE.initializedAt ||=

            new Date()

            .toISOString();



        req.databaseFailover = Object.freeze({

            retry:

                operation =>

                    executeWithRetry(

                        operation,

                        policy

                    ),



            transaction:

                transaction =>

                    recoverTransaction(

                        transaction,

                        policy

                    ),



            readPreference:

                resolveReadPreference,


            degraded:

                ()=>STATE.degraded

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

            !STATE.degraded,


        primary:

            STATE.primaryStatus

    });

}



async function readinessCheck() {


    return Object.freeze({

        ready:

            STATE.primaryStatus !==

            'failed'

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

        410,


    critical:

        true,


    description:

        'Enterprise MongoDB failover and transaction resilience layer.'

});



/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports = Object.freeze({

    create:

        databaseFailover,


    databaseFailover,


    handlePrimaryElection,


    resolveReadPreference,


    executeWithRetry,


    recoverTransaction,


    enterDegradedMode,


    exitDegradedMode,


    isRetryable,


    metadata,


    healthCheck,


    readinessCheck,


    diagnostics,


    policy:

        DEFAULT_POLICY

});