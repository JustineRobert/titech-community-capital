'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Transaction Event Publisher
 * ============================================================================
 *
 * Responsibilities
 * ----------------
 * - Transactional Outbox
 * - Reliable Event Delivery
 * - Batch Publishing
 * - Event Routing
 * - Retry Coordination
 * - Dead Letter Queue
 * - Replay Support
 * * - OpenTelemetry Integration
 * - Metrics
 * - Audit Trail
 * - Multi-tenant Isolation
 *
 * Design Goals
 * ------------
 * - At-least-once delivery
 * - Idempotent publishing
 * - Ordered publishing per aggregate
 * - Graceful shutdown
 * - Backpressure handling
 * - Observable throughout the publishing lifecycle
 *
 * ============================================================================
 */

const { EventEmitter } = require('events');
const crypto = require('crypto');

const os = require('os');

const {
    randomUUID
} = crypto;

const {
    setTimeout: sleep
} = require('timers/promises');

const {
    TransactionError
} = require('./transactions/TransactionErrors');

const TransactionEvents =
    require('./transactions/TransactionEvents');

const {
    RetryConstants
} = require('./transactions/TransactionConstants');

/**
 * Optional dependencies.
 * The publisher must continue to operate when individual
 * infrastructure services are not available.
 */

let StructuredLogger;
let LoggerFactory;

try {
    StructuredLogger =
        require('../shared/logging/StructuredLogger');

    LoggerFactory =
        require('../shared/logging/LoggerFactory');
}
catch {
    StructuredLogger = null;
    LoggerFactory = null;
}

/**
 * Internal symbols.
 */

const INTERNAL =
    Symbol('TransactionEventPublisher');

const DEFAULT_NAMESPACE =
    'transactions.events';

const MODULE_NAME =
    'TransactionEventPublisher';

const MODULE_VERSION =
    '1.0.0';

/**
 * Publisher lifecycle states.
 */

const PublisherState =
    Object.freeze({

        CREATED:
            'CREATED',

        STARTING:
            'STARTING',

        RUNNING:
            'RUNNING',

        STOPPING:
            'STOPPING',

        STOPPED:
            'STOPPED',

        FAILED:
            'FAILED'

    });

/**
 * Event persistence states.
 */

const EventStatus =
    Object.freeze({

        PENDING:
            'PENDING',

        PROCESSING:
            'PROCESSING',

        PUBLISHED:
            'PUBLISHED',

        FAILED:
            'FAILED',

        DEAD_LETTER:
            'DEAD_LETTER'

    });

module.exports = {
    PublisherState,
    EventStatus,
    MODULE_NAME,
    MODULE_VERSION,
    DEFAULT_NAMESPACE,
    INTERNAL
};

/**
 * ============================================================================
 * Publisher States
 * ============================================================================
 */
const PublisherState = Object.freeze({
    CREATED: 'CREATED',
    STARTING: 'STARTING',
    RUNNING: 'RUNNING',
    STOPPING: 'STOPPING',
    STOPPED: 'STOPPED',
    FAILED: 'FAILED'
});

/**
 * ============================================================================
 * Event Status
 * ============================================================================
 */
const EventStatus = Object.freeze({
    PENDING: 'PENDING',
    PROCESSING: 'PROCESSING',
    PUBLISHED: 'PUBLISHED',
    FAILED: 'FAILED',
    DEAD_LETTER: 'DEAD_LETTER'
});

/**
 * ============================================================================
 * Delivery Guarantees
 * ============================================================================
 */
const DeliveryGuarantee = Object.freeze({
    AT_LEAST_ONCE: 'AT_LEAST_ONCE',
    EXACTLY_ONCE_SIMULATED: 'EXACTLY_ONCE_SIMULATED'
});

/**
 * ============================================================================
 * Routing Strategies
 * ============================================================================
 */
const RoutingStrategy = Object.freeze({
    EVENT_TYPE: 'EVENT_TYPE',
    TENANT: 'TENANT',
    AGGREGATE: 'AGGREGATE',
    CUSTOM: 'CUSTOM'
});

/**
 * ============================================================================
 * Batch Flush Reasons
 * ============================================================================
 */
const FlushReason = Object.freeze({
    SIZE: 'SIZE',
    TIMEOUT: 'TIMEOUT',
    SHUTDOWN: 'SHUTDOWN',
    MANUAL: 'MANUAL'
});

const DEFAULT_CONFIG = Object.freeze({
    enabled: true,
    namespace: 'transactions.events',
    batch: Object.freeze({
        enabled: true,
        maxSize: 100,
        flushIntervalMs: 1000,
        maxConcurrency: 4
    }),
    retry: Object.freeze({
        enabled: true,
        maxAttempts: 10,
        initialDelayMs: 1000,
        maxDelayMs: 60000,
        backoffFactor: 2
    }),
    outbox: Object.freeze({
        pollingIntervalMs: 500,
        cleanupIntervalMs: 3600000
    }),
    deadLetter: Object.freeze({
        enabled: true,
        maxAgeHours: 168
    }),
    health: Object.freeze({
        staleThresholdMs: 30000
    })
});

/**
 * ============================================================================
 * Core Event ID Generation Utilities
 * ============================================================================
 *
 * Provides:
 *
 * - generateEventId()
 * - UUID support
 * - Timestamp encoding
 *
 * Design goals:
 *
 * - Globally unique identifiers
 * - Traceable event creation time
 * - Safe for distributed systems
 * - Database/index friendly
 *
 * ============================================================================
 */


const crypto = require('crypto');



/**
 * ============================================================================
 * Constants
 * ============================================================================
 */


const EVENT_ID_PREFIX = 'evt';


const UUID_VERSION = 'v4';


const TIMESTAMP_LENGTH = 13;



/**
 * ============================================================================
 * Validate UUID availability
 * ============================================================================
 */


function hasUUIDSupport() {


    return Boolean(

        crypto.randomUUID

    );


}



/**
 * ============================================================================
 * Generate Secure UUID
 * ============================================================================
 *
 * Uses native Node.js crypto UUID generation.
 *
 * Falls back to random bytes when unavailable.
 *
 */


function generateUUID() {


    if (

        hasUUIDSupport()

    ) {


        return crypto.randomUUID();


    }



    return [

        crypto.randomBytes(4).toString('hex'),

        crypto.randomBytes(2).toString('hex'),

        crypto.randomBytes(2).toString('hex'),

        crypto.randomBytes(2).toString('hex'),

        crypto.randomBytes(6).toString('hex')

    ].join('-');


}



/**
 * ============================================================================
 * Timestamp Encoding
 * ============================================================================
 *
 * Produces millisecond precision timestamp.
 *
 * Example:
 *
 * 1785712334123
 *
 */


function encodeTimestamp(timestamp = Date.now()) {


    if (

        !Number.isFinite(timestamp)

    ) {


        throw new TypeError(

            'Invalid timestamp'

        );


    }



    return String(timestamp)

        .padStart(

            TIMESTAMP_LENGTH,

            '0'

        );


}



/**
 * ============================================================================
 * Generate Event ID
 * ============================================================================
 *
 * Format:
 *
 * evt_<timestamp>_<uuid>
 *
 * Example:
 *
 * evt_1785712334123_550e8400-e29b-41d4-a716-446655440000
 *
 *
 * Properties:
 *
 * - Human traceable
 * - Globally unique
 * - Distributed-safe
 *
 */


function generateEventId(options = {}) {


    const timestamp =

        encodeTimestamp(

            options.timestamp || Date.now()

        );



    const uuid =

        options.uuid ||

        generateUUID();



    return [

        EVENT_ID_PREFIX,

        timestamp,

        uuid

    ].join('_');


}



/**
 * ============================================================================
 * Validate Event ID
 * ============================================================================
 */


function isValidEventId(eventId) {


    if (

        typeof eventId !== 'string'

    ) {


        return false;


    }



    const pattern =

        /^evt_\d{13}_[a-f0-9-]{36}$/i;



    return pattern.test(

        eventId

    );


}



/**
 * ============================================================================
 * Extract Timestamp From Event ID
 * ============================================================================
 */


function extractEventTimestamp(eventId) {


    if (

        !isValidEventId(eventId)

    ) {


        throw new Error(

            'Invalid event ID format'

        );


    }



    const parts =

        eventId.split('_');



    return Number(

        parts[1]

    );


}

/**
 * ============================================================================
 * Correlation Utilities
 * ============================================================================
 *
 * Provides:
 *
 * - generateCorrelationId()
 * - Parent correlation propagation
 * - Request -> Transaction -> Event trace continuity
 *
 * Design goals:
 *
 * - Maintain distributed transaction identity
 * - Preserve upstream context
 * - Support microservice workflows
 * - Enable audit reconstruction
 *
 * ============================================================================
 */



const crypto = require('crypto');



/**
 * ============================================================================
 * Constants
 * ============================================================================
 */


const CORRELATION_PREFIX = 'cor';



const CORRELATION_VERSION = '1';



/**
 * ============================================================================
 * Generate Secure Random Component
 * ============================================================================
 */


function generateEntropy() {


    return crypto

        .randomBytes(12)

        .toString('hex');


}



/**
 * ============================================================================
 * Timestamp Component
 * ============================================================================
 */


function correlationTimestamp() {


    return Date

        .now()

        .toString(36);


}



/**
 * ============================================================================
 * Generate Correlation ID
 * ============================================================================
 *
 * Format:
 *
 * cor_v1_<timestamp>_<entropy>
 *
 *
 * Example:
 *
 * cor_v1_lq8j4k9z_a84f91e7d9c2b7aa91
 *
 *
 * Characteristics:
 *
 * - Globally unique
 * - Trace friendly
 * - Compact
 * - Log searchable
 *
 */


function generateCorrelationId(options = {}) {


    if (

        options.existingCorrelationId

    ) {


        return options.existingCorrelationId;


    }



    return [

        CORRELATION_PREFIX,

        `v${CORRELATION_VERSION}`,

        correlationTimestamp(),

        generateEntropy()

    ].join('_');


}





/**
 * ============================================================================
 * Parent Correlation Propagation
 * ============================================================================
 *
 * Creates child correlation context.
 *
 * Example:
 *
 * API Request
 *      |
 *      |
 *      +-- Transaction
 *              |
 *              +-- Event
 *
 */


function createChildCorrelation(parentCorrelationId, metadata = {}) {


    if (

        !parentCorrelationId

    ) {


        return {


            correlationId:

                generateCorrelationId(),



            parentCorrelationId:

                null,


            metadata


        };


    }



    return {


        correlationId:

            generateCorrelationId(),



        parentCorrelationId,



        metadata


    };


}





/**
 * ============================================================================
 * Resolve Correlation Context
 * ============================================================================
 *
 * Priority:
 *
 * 1. Existing event context
 * 2. Transaction context
 * 3. Request context
 * 4. New correlation
 *
 */


function resolveCorrelationContext(context = {}) {


    return {


        correlationId:


            context.correlationId ||


            context.transactionCorrelationId ||


            context.requestCorrelationId ||


            generateCorrelationId(),



        parentCorrelationId:


            context.parentCorrelationId || null,



        requestId:


            context.requestId || null,



        transactionId:


            context.transactionId || null,


        traceId:


            context.traceId || null


    };


}





/**
 * ============================================================================
 * Validate Correlation ID
 * ============================================================================
 */


function isValidCorrelationId(value) {


    if (

        typeof value !== 'string'

    ) {


        return false;


    }



    return /^cor_v\d+_[a-z0-9]+_[a-f0-9]+$/i

        .test(value);


}





/**
 * ============================================================================
 * Build Event Correlation Metadata
 * ============================================================================
 *
 * Used by TransactionEvents.create()
 *
 */


function buildCorrelationMetadata(context = {}) {


    const resolved =

        resolveCorrelationContext(

            context

        );



    return {


        correlationId:

            resolved.correlationId,



        parentCorrelationId:

            resolved.parentCorrelationId,



        requestId:

            resolved.requestId,



        transactionId:

            resolved.transactionId,



        traceId:

            resolved.traceId


    };


}


'use strict';

/**
 * ============================================================================
 * Batch & Publisher Identity Utilities
 * ============================================================================
 *
 * Provides:
 *
 * - generateBatchId()
 * - generatePublisherId()
 * - Publisher instance identity
 * - Batch processing traceability
 *
 * Design goals:
 *
 * - Identify publisher workers uniquely
 * - Trace event batches
 * - Support horizontal scaling
 * - Support Kubernetes replicas
 * - Support operational debugging
 *
 * ============================================================================
 */


const crypto = require('crypto');

const os = require('os');



/**
 * ============================================================================
 * Constants
 * ============================================================================
 */


const BATCH_PREFIX = 'batch';


const PUBLISHER_PREFIX = 'pub';


const PROCESS_ID =

    process.pid;



/**
 * ============================================================================
 * Secure Random Component
 * ============================================================================
 */


function randomToken(length = 12) {


    return crypto

        .randomBytes(length)

        .toString('hex');


}



/**
 * ============================================================================
 * Timestamp Encoding
 * ============================================================================
 */


function timestampToken() {


    return Date

        .now()

        .toString(36);


}



/**
 * ============================================================================
 * Generate Batch ID
 * ============================================================================
 *
 * Identifies a group of events processed together.
 *
 * Format:
 *
 * batch_<timestamp>_<random>
 *
 *
 * Example:
 *
 * batch_lq9x8m2a_83f91ab82c
 *
 *
 * Used for:
 *
 * - Batch publishing
 * - Retry grouping
 * - Metrics aggregation
 * - Failure analysis
 *
 */


function generateBatchId(options = {}) {


    const prefix =

        options.prefix ||

        BATCH_PREFIX;



    return [

        prefix,

        timestampToken(),

        randomToken(10)

    ].join('_');


}





/**
 * ============================================================================
 * Generate Publisher Instance ID
 * ============================================================================
 *
 * Identifies a running publisher worker.
 *
 * Format:
 *
 * pub_<hostname>_<pid>_<timestamp>_<random>
 *
 *
 * Example:
 *
 * pub-node01-4821-lq9x8m2a-a82fd991
 *
 *
 * Useful for:
 *
 * - Kubernetes replicas
 * - Worker ownership
 * - Logs
 * - Metrics
 * - Distributed debugging
 *
 */


function generatePublisherId(options = {}) {


    const hostname =

        options.hostname ||

        os.hostname();



    const processId =

        options.processId ||

        PROCESS_ID;



    return [

        PUBLISHER_PREFIX,

        sanitize(hostname),

        processId,

        timestampToken(),

        randomToken(8)

    ].join('_');


}





/**
 * ============================================================================
 * Publisher Identity Object
 * ============================================================================
 *
 * Represents one active publisher instance.
 *
 */


function createPublisherIdentity(options = {}) {


    return {


        publisherId:

            generatePublisherId(options),



        hostname:

            options.hostname ||

            os.hostname(),



        processId:

            options.processId ||

            PROCESS_ID,



        nodeVersion:

            process.version,



        environment:

            process.env.NODE_ENV ||



            'development',



        createdAt:

            new Date(),



        instanceToken:

            randomToken(16)


    };


}





/**
 * ============================================================================
 * Build Batch Metadata
 * ============================================================================
 *
 * Attached to published batches.
 *
 */


function buildBatchMetadata(options = {}) {


    return {


        batchId:

            options.batchId ||

            generateBatchId(),



        publisherId:

            options.publisherId || null,



        size:

            options.size || 0,



        createdAt:

            new Date(),



        priority:

            options.priority || 'NORMAL',



        retryAttempt:

            options.retryAttempt || 0


    };


}





/**
 * ============================================================================
 * Validate Publisher Identity
 * ============================================================================
 */


function validatePublisherId(value) {


    if (

        typeof value !== 'string'

    ) {


        return false;


    }



    return /^pub_[a-z0-9-]+_\d+_[a-z0-9]+_[a-f0-9]+$/i

        .test(value);


}





/**
 * ============================================================================
 * Validate Batch ID
 * ============================================================================
 */


function validateBatchId(value) {


    if (

        typeof value !== 'string'

    ) {


        return false;


    }



    return /^batch_[a-z0-9]+_[a-f0-9]+$/i

        .test(value);


}





/**
 * ============================================================================
 * Sanitize Hostnames
 * ============================================================================
 */


function sanitize(value) {


    return String(value)

        .replace(

            /[^a-zA-Z0-9-]/g,

            '-'

        )

        .substring(

            0,

            40

        );


}


'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Transaction Event Publisher
 *
 * Section 1B — Enterprise Constructor
 * ============================================================================
 */


const EventEmitter = require('events');



const {
    resolveDefaults,
    normalizeConfiguration
} = require('./utils/TransactionConfigurationUtils');



const {
    createPublisherIdentity
} = require('./utils/TransactionPublisherIdentityUtils');



const {
    assertDependency
} = require('./utils/TransactionValidationUtils');



const {
    createImmutableConfig
} = require('./utils/TransactionObjectUtils');





/**
 * ============================================================================
 * Publisher Lifecycle States
 * ============================================================================
 */


const PublisherState = Object.freeze({

    CREATED:

        'CREATED',


    INITIALIZING:

        'INITIALIZING',


    READY:

        'READY',


    RUNNING:

        'RUNNING',


    STOPPING:

        'STOPPING',


    STOPPED:

        'STOPPED',


    FAILED:

        'FAILED'

});





class TransactionEventPublisher extends EventEmitter {


    /**
     * =========================================================================
     * Constructor
     * =========================================================================
     *
     * Dependency Injection:
     *
     * {
     *    logger,
     *    metrics,
     *    tracer,
     *    repository,
     *    eventBus,
     *    auditPublisher,
     *    config
     * }
     *
     */


    constructor(options = {}) {


        super();



        this.state =

            PublisherState.CREATED;



        this.startedAt =

            null;



        this.stoppedAt =

            null;



        this.instance =

            createPublisherIdentity();



        /**
         * -------------------------------------------------------------
         * Configuration
         * -------------------------------------------------------------
         */


        const resolvedConfig =

            resolveDefaults(

                options.config || {},

                options.environment || {}

            );



        const normalizedConfig =

            normalizeConfiguration(

                resolvedConfig

            );



        this.config =

            createImmutableConfig(

                normalizedConfig

            );





        /**
         * -------------------------------------------------------------
         * Dependencies
         * -------------------------------------------------------------
         */



        this.logger =

            options.logger ||

            console;



        this.metrics =

            options.metrics || {


                increment() {},


                observe() {},


                gauge() {}


            };



        this.tracer =

            options.tracer || {


                startSpan() {


                    return {


                        end() {}

                    };


                }


            };





        this.repository =

            options.repository;



        this.eventBus =

            options.eventBus;



        this.auditPublisher =

            options.auditPublisher;





        /**
         * -------------------------------------------------------------
         * Runtime State
         * -------------------------------------------------------------
         */


        this.statistics = {


            eventsReceived:

                0,


            eventsPublished:

                0,


            eventsFailed:

                0,


            batchesProcessed:

                0,


            retries:

                0,


            lastEventAt:

                null,


            lastFailureAt:

                null


        };





        /**
         * -------------------------------------------------------------
         * Internal Runtime Containers
         * -------------------------------------------------------------
         */


        this.pendingEvents =

            new Map();



        this.processingBatches =

            new Set();



        this.shutdownRequested =

            false;



        this.initialized =

            false;





        this.validateDependencies();



        this.logger.info?.(

            {

                module:

                    'TransactionEventPublisher',


                publisherId:

                    this.instance.publisherId

            },

            'Transaction event publisher created'

        );


    }







    /**
     * =========================================================================
     * Dependency Validation
     * =========================================================================
     */


    validateDependencies() {


        if (

            this.config.enabled !== true

        ) {


            return;


        }



        if (

            this.config.requireRepository === true

        ) {


            assertDependency(

                this.repository,

                'Outbox Repository'

            );


        }



        if (

            this.config.requireEventBus === true

        ) {


            assertDependency(

                this.eventBus,

                'Event Bus'

            );


        }


    }





    /**
     * =========================================================================
     * Runtime Metadata
     * =========================================================================
     */


    getRuntimeIdentity() {


        return {


            ...this.instance,


            state:

                this.state,


            startedAt:

                this.startedAt


        };


    }





    /**
     * =========================================================================
     * Current State
     * =========================================================================
     */


    getState() {


        return this.state;


    }


    /**
 * ============================================================================
 * Section 1C — Publisher Lifecycle
 * ============================================================================
 */



/**
 * ============================================================================
 * Initialize Publisher
 * ============================================================================
 *
 * Performs startup validation and prepares runtime resources.
 *
 */


async initialize() {


    if (

        this.initialized

    ) {


        return;


    }



    this.transitionState(

        PublisherState.INITIALIZING

    );



    try {


        await this.validateStartup();



        await this.initializeDependencies();



        this.initialized = true;



        this.transitionState(

            PublisherState.READY

        );



        this.logger.info?.(

            {

                publisherId:

                    this.instance.publisherId

            },

            'Transaction event publisher initialized'

        );


    }

    catch(error) {


        this.transitionState(

            PublisherState.FAILED

        );



        this.logger.error?.(

            error,

            'Transaction event publisher initialization failed'

        );



        throw error;


    }


}





/**
 * ============================================================================
 * Start Publisher
 * ============================================================================
 *
 * Starts background processing.
 *
 */


async start() {


    if (

        this.state === PublisherState.RUNNING

    ) {


        return;


    }



    if (

        !this.initialized

    ) {


        await this.initialize();


    }





    this.transitionState(

        PublisherState.RUNNING

    );



    this.startedAt =

        new Date();



    this.shutdownRequested = false;



    await this.registerWorker();



    this.emit(

        'started',

        this.getRuntimeIdentity()

    );



    this.logger.info?.(

        {

            publisherId:

                this.instance.publisherId

        },

        'Transaction event publisher started'

    );


}





/**
 * ============================================================================
 * Stop Publisher
 * ============================================================================
 *
 * Graceful shutdown.
 *
 */


async stop(options = {}) {


    if (

        this.state === PublisherState.STOPPED

    ) {


        return;


    }



    this.transitionState(

        PublisherState.STOPPING

    );



    this.shutdownRequested = true;



    try {


        await this.flushPendingEvents();



        await this.stopWorkers();



        await this.closeDependencies();



        this.stoppedAt =

            new Date();



        this.transitionState(

            PublisherState.STOPPED

        );



        this.emit(

            'stopped',

            this.getRuntimeIdentity()

        );



        this.logger.info?.(

            {

                publisherId:

                    this.instance.publisherId

            },

            'Transaction event publisher stopped'

        );


    }

    catch(error) {


        this.transitionState(

            PublisherState.FAILED

        );



        this.logger.error?.(

            error,

            'Transaction event publisher shutdown failed'

        );



        throw error;


    }


}





/**
 * ============================================================================
 * Startup Validation
 * ============================================================================
 */


async validateStartup() {


    if (

        !this.config.enabled

    ) {


        throw new Error(

            'Transaction event publisher disabled'

        );


    }



    if (

        !this.instance.publisherId

    ) {


        throw new Error(

            'Publisher identity unavailable'

        );


    }



    return true;


}





/**
 * ============================================================================
 * Dependency Initialization
 * ============================================================================
 */


async initializeDependencies() {


    await this.repository?.initialize?.();



    await this.eventBus?.connect?.();



    await this.auditPublisher?.initialize?.();


}





/**
 * ============================================================================
 * Worker Registration
 * ============================================================================
 */


async registerWorker() {


    this.worker = {


        id:

            this.instance.publisherId,


        startedAt:

            new Date(),


        hostname:

            this.instance.hostname


    };



    this.metrics?.gauge?.(

        'transaction_event_publisher_running',

        1

    );


}





/**
 * ============================================================================
 * Stop Workers
 * ============================================================================
 */


async stopWorkers() {


    this.worker = null;



    this.metrics?.gauge?.(

        'transaction_event_publisher_running',

        0

    );


}





/**
 * ============================================================================
 * Flush Pending Events
 * ============================================================================
 */


async flushPendingEvents() {


    if (

        this.pendingEvents.size === 0

    ) {


        return;


    }



    this.logger.info?.(

        {

            pending:

                this.pendingEvents.size

        },

        'Flushing pending transaction events'

    );



    this.pendingEvents.clear();


}





/**
 * ============================================================================
 * Close Dependencies
 * ============================================================================
 */


async closeDependencies() {


    await this.eventBus?.disconnect?.();



    await this.repository?.close?.();



    await this.auditPublisher?.shutdown?.();


}





/**
 * ============================================================================
 * State Transition
 * ============================================================================
 */


transitionState(nextState) {


    const previous =

        this.state;



    this.state =

        nextState;



    this.emit(

        'stateChanged',

        {

            previous,

            current:

                nextState

        }

    );


}





/**
 * ============================================================================
 * Readiness Check
 * ============================================================================
 */


isReady() {


    return (

        this.state === PublisherState.READY ||

        this.state === PublisherState.RUNNING

    );


}





/**
 * ============================================================================
 * Health State
 * ============================================================================
 */


health() {


    return {


        status:

            this.isReady()

                ? 'UP'

                : 'DOWN',



        state:

            this.state,



        publisherId:

            this.instance.publisherId,



        uptime:


            this.startedAt

                ? Date.now() -

                  this.startedAt.getTime()

                : 0,



        statistics:

            this.statistics


    };


}



}



module.exports = TransactionEventPublisher;



/**
 * ============================================================================
 * Exports
 * ============================================================================
 */


module.exports = {


    generateBatchId,


    generatePublisherId,


    createPublisherIdentity,


    buildBatchMetadata,


    validatePublisherId,


    validateBatchId, 


    generateCorrelationId,


    createChildCorrelation,


    resolveCorrelationContext,


    buildCorrelationMetadata,


    isValidCorrelationId, 


    generateEventId,


    generateUUID,


    encodeTimestamp,


    isValidEventId,


    extractEventTimestamp


};