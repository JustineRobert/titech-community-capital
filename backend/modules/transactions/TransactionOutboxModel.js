'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Transaction Outbox Core Model
 * ============================================================================
 *
 * File:
 *   backend/modules/transactions/TransactionOutboxCore.js
 *
 * Purpose
 * -------
 * Canonical in-process factory and validation layer for transaction outbox
 * events.
 *
 * Responsibilities
 * ----------------
 * • Event envelope creation
 * • Event identity
 * • Deterministic event key
 * • Event fingerprinting
 * • Correlation propagation
 * • Tenant isolation
 * • Aggregate identity
 * • Provider / operation context
 * • Ordering key generation
 * • Event metadata
 * • Priority handling
 * • Outbox record creation
 * • Repository contract definition
 * • Replay-safe event representation
 * • Validation
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • MongoDB persistence
 * • Event publication
 * • Kafka/RabbitMQ/Redis/SNS transport
 * • Worker leasing
 * • Retry execution
 * • Financial transaction execution
 *
 * Relationship
 * ------------
 *
 * TransactionEvents
 *        │
 *        ▼
 * TransactionOutboxCore
 *        │
 *        ├── envelope
 *        ├── eventKey
 *        ├── fingerprint
 *        └── orderingKey
 *               │
 *               ▼
 * TransactionOutboxRepository
 *               │
 *               ▼
 * TransactionOutboxWorker
 *
 * ============================================================================
 */

const crypto =
    require('crypto');


const {
    generateEventId
} =
    require('./utils/TransactionEventIdUtils');


const {
    generateCorrelationId
} =
    require('./utils/TransactionCorrelationUtils');


const {
    generateBatchId
} =
    require('./utils/TransactionPublisherIdentityUtils');


const {
    deepFreeze
} =
    require('./utils/TransactionObjectUtils');


/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const OUTBOX_VERSION =
    '1.0';


const EVENT_SCHEMA_VERSION =
    '1.0';


const DEFAULT_SOURCE =
    'transaction-service';


const DEFAULT_SERVICE =
    'transactions';


const HASH_ALGORITHM =
    'sha256';


const MAX_ID_LENGTH =
    512;


const MAX_EVENT_TYPE_LENGTH =
    256;


const MAX_TOPIC_LENGTH =
    512;


/**
 * ============================================================================
 * Event Status
 * ============================================================================
 *
 * These represent the core lifecycle contract.
 *
 * Delivery-specific persistence implementations may maintain additional
 * states such as CANCELLED or DEAD_LETTERED.
 * ============================================================================
 */

const EventStatus = Object.freeze({

    CREATED:
        'CREATED',

    PENDING:
        'PENDING',

    PROCESSING:
        'PROCESSING',

    PUBLISHED:
        'PUBLISHED',

    FAILED:
        'FAILED',

    DEAD_LETTER:
        'DEAD_LETTER',

    CANCELLED:
        'CANCELLED'

});


/**
 * ============================================================================
 * Event Priority
 * ============================================================================
 */

const EventPriority = Object.freeze({

    LOW:
        'LOW',

    NORMAL:
        'NORMAL',

    HIGH:
        'HIGH',

    CRITICAL:
        'CRITICAL'

});


const EVENT_PRIORITIES =
    Object.freeze(
        Object.values(
            EventPriority
        )
    );


/**
 * ============================================================================
 * Repository Contract
 * ============================================================================
 */

const OutboxRepositoryContract = Object.freeze({

    create:
        'create(eventOrRecord)',

    createMany:
        'createMany(events)',

    findOne:
        'findOne(query)',

    findByEventId:
        'findByEventId({ tenantId, eventId })',

    findByEventKey:
        'findByEventKey({ tenantId, eventKey })',

    findByTransaction:
        'findByTransaction({ tenantId, transactionId })',

    findDue:
        'findDue(options)',

    claim:
        'claim({ tenantId, eventId, workerId, leaseMs })',

    claimBatch:
        'claimBatch(options)',

    heartbeat:
        'heartbeat({ tenantId, eventId, workerId, leaseMs })',

    releaseLease:
        'releaseLease({ tenantId, eventId, workerId })',

    update:
        'update(options)',

    complete:
        'complete({ tenantId, eventId, workerId })',

    markPublished:
        'markPublished(options)',

    fail:
        'fail({ tenantId, eventId, workerId, error })',

    scheduleRetry:
        'scheduleRetry(options)',

    deadLetter:
        'deadLetter(options)',

    replay:
        'replay(options)',

    findExpiredLeases:
        'findExpiredLeases(options)',

    releaseExpiredLeases:
        'releaseExpiredLeases(options)',

    health:
        'health()',

    stats:
        'stats()'

});


/**
 * ============================================================================
 * Sensitive Fields
 * ============================================================================
 */

const SENSITIVE_FIELDS = new Set([

    'password',

    'secret',

    'clientsecret',

    'client_secret',

    'token',

    'accesstoken',

    'access_token',

    'refreshtoken',

    'refresh_token',

    'authorization',

    'apikey',

    'api_key',

    'privatekey',

    'private_key',

    'credentials',

    'credential',

    'pin',

    'otp',

    'cvv',

    'cvc',

    'cardnumber',

    'card_number'

]);


/**
 * ============================================================================
 * Safe Clone / Redaction
 * ============================================================================
 */

function sanitizeValue(
    value,
    depth = 0,
    maxDepth = 8,
    seen = new WeakSet()
) {

    if (
        depth > maxDepth
    ) {

        return '[MAX_DEPTH]';

    }


    if (
        value === null ||
        value === undefined
    ) {

        return value;

    }


    if (
        value instanceof Date
    ) {

        return new Date(
            value.getTime()
        );

    }


    if (
        typeof value !== 'object'
    ) {

        return value;

    }


    if (
        seen.has(value)
    ) {

        return '[CIRCULAR]';

    }


    seen.add(value);


    if (
        Array.isArray(value)
    ) {

        return value.map(

            item =>
                sanitizeValue(
                    item,
                    depth + 1,
                    maxDepth,
                    seen
                )

        );

    }


    const output = {};


    for (
        const [
            key,
            nestedValue
        ]
        of Object.entries(value)
    ) {

        const normalizedKey =
            String(
                key
            )
                .trim()
                .toLowerCase()
                .replace(
                    /[\s-]/g,
                    ''
                );


        if (
            SENSITIVE_FIELDS.has(
                normalizedKey
            )
        ) {

            output[key] =
                '[REDACTED]';

            continue;

        }


        output[key] =
            sanitizeValue(
                nestedValue,
                depth + 1,
                maxDepth,
                seen
            );

    }


    return output;

}


/**
 * ============================================================================
 * Canonicalization
 * ============================================================================
 */

function canonicalize(
    value
) {

    if (
        value === null ||
        value === undefined
    ) {

        return value;

    }


    if (
        value instanceof Date
    ) {

        return value.toISOString();

    }


    if (
        Array.isArray(value)
    ) {

        return value.map(
            canonicalize
        );

    }


    if (
        typeof value !== 'object'
    ) {

        return value;

    }


    return Object.keys(value)
        .sort()
        .reduce(

            (
                output,
                key
            ) => {

                output[key] =
                    canonicalize(
                        value[key]
                    );

                return output;

            },

            {}

        );

}


/**
 * ============================================================================
 * Hash Helper
 * ============================================================================
 */

function hash(
    value
) {

    return crypto
        .createHash(
            HASH_ALGORITHM
        )
        .update(

            JSON.stringify(
                canonicalize(
                    value
                )
            ),

            'utf8'

        )
        .digest(
            'hex'
        );

}


/**
 * ============================================================================
 * ID Normalization
 * ============================================================================
 */

function normalizeId(
    value
) {

    if (
        value === null ||
        value === undefined
    ) {

        return null;

    }


    const normalized =
        String(
            value
        )
            .trim();


    if (
        !normalized
    ) {

        return null;

    }


    return normalized.slice(
        0,
        MAX_ID_LENGTH
    );

}


/**
 * ============================================================================
 * Event Type Normalization
 * ============================================================================
 */

function normalizeEventType(
    value
) {

    if (
        value === null ||
        value === undefined
    ) {

        return null;

    }


    const normalized =
        String(
            value
        )
            .trim()
            .toLowerCase()
            .slice(
                0,
                MAX_EVENT_TYPE_LENGTH
            );


    return normalized ||
        null;

}


/**
 * ============================================================================
 * Provider Normalization
 * ============================================================================
 */

function normalizeProvider(
    value
) {

    if (
        value === null ||
        value === undefined
    ) {

        return null;

    }


    const normalized =
        String(
            value
        )
            .trim()
            .toUpperCase();


    return normalized ||
        null;

}


/**
 * ============================================================================
 * Priority Normalization
 * ============================================================================
 */

function normalizePriority(
    value
) {

    const normalized =
        String(
            value ||
            EventPriority.NORMAL
        )
            .trim()
            .toUpperCase();


    return EVENT_PRIORITIES.includes(
        normalized
    )
        ? normalized
        : EventPriority.NORMAL;

}


/**
 * ============================================================================
 * Aggregate Identity
 * ============================================================================
 */

function createAggregateIdentity(
    aggregate = {}
) {

    if (
        !aggregate ||
        typeof aggregate !== 'object'
    ) {

        return {

            type:
                null,

            id:
                null,

            version:
                null

        };

    }


    return {

        type:
            normalizeId(
                aggregate.type
            ),

        id:
            normalizeId(
                aggregate.id
            ),

        version:
            aggregate.version ??
            null

    };

}


/**
 * ============================================================================
 * Event Metadata
 * ============================================================================
 */

function createEventMetadata(
    metadata = {}
) {

    const environment =
        metadata.environment ||
        process.env.NODE_ENV ||
        'development';


    return sanitizeValue({

        source:
            metadata.source ||
            DEFAULT_SOURCE,

        service:
            metadata.service ||
            DEFAULT_SERVICE,

        environment,

        schemaVersion:
            metadata.schemaVersion ||
            EVENT_SCHEMA_VERSION,

        priority:
            normalizePriority(
                metadata.priority
            ),

        retryCount:
            Number(
                metadata.retryCount
            ) >= 0
                ? Number(
                    metadata.retryCount
                )
                : 0,

        publisher:
            metadata.publisher ||
            null,

        transport:
            metadata.transport ||
            null,

        contentType:
            metadata.contentType ||
            'application/json',

        ...metadata

    });

}


/**
 * ============================================================================
 * Trace Context
 * ============================================================================
 */

function createTraceContext(
    trace = {}
) {

    return {

        traceId:
            normalizeId(
                trace.traceId
            ),

        spanId:
            normalizeId(
                trace.spanId
            ),

        parentSpanId:
            normalizeId(
                trace.parentSpanId
            )

    };

}


/**
 * ============================================================================
 * Create Deterministic Ordering Key
 * ============================================================================
 *
 * Tenant identity is always incorporated.
 *
 * Preferred:
 *
 *   tenant:<tenant>:aggregate:<type>:<id>
 *
 * Fallback:
 *
 *   tenant:<tenant>:event:<eventType>
 */

function createOrderingKey(
    event
) {

    const tenantId =
        normalizeId(
            event?.tenantId
        ) ||
        'global';


    const aggregate =
        createAggregateIdentity(
            event?.aggregate
        );


    if (
        aggregate.type &&
        aggregate.id
    ) {

        return [

            'tenant',
            tenantId,

            'aggregate',
            aggregate.type,
            aggregate.id

        ].join(':');

    }


    return [

        'tenant',
        tenantId,

        'event',
        normalizeEventType(
            event?.eventType
        ) ||
        'unknown'

    ].join(':');

}


/**
 * ============================================================================
 * Create Event Key
 * ============================================================================
 *
 * The event key is deterministic and suitable for outbox deduplication.
 */

function createEventKey(
    event
) {

    return hash({

        tenantId:
            normalizeId(
                event?.tenantId
            ),

        transactionId:
            normalizeId(
                event?.transactionId
            ),

        aggregate:
            createAggregateIdentity(
                event?.aggregate
            ),

        eventType:
            normalizeEventType(
                event?.eventType
            ),

        eventVersion:
            event?.eventVersion ||
            OUTBOX_VERSION,

        idempotencyKey:
            normalizeId(
                event?.idempotencyKey
            ),

        correlationId:
            normalizeId(
                event?.correlationId
            )

    });

}


/**
 * ============================================================================
 * Create Event Fingerprint
 * ============================================================================
 *
 * Fingerprint represents the immutable event envelope excluding volatile
 * publication state.
 */

function createEventFingerprint(
    event
) {

    const canonical =
        sanitizeValue({

            eventType:
                event.eventType,

            eventVersion:
                event.eventVersion,

            occurredAt:
                event.occurredAt,

            tenantId:
                event.tenantId,

            organizationId:
                event.organizationId,

            userId:
                event.userId,

            customerId:
                event.customerId,

            transactionId:
                event.transactionId,

            parentTransactionId:
                event.parentTransactionId,

            correlationId:
                event.correlationId,

            requestId:
                event.requestId,

            idempotencyKey:
                event.idempotencyKey,

            provider:
                event.provider,

            operation:
                event.operation,

            aggregate:
                event.aggregate,

            trace:
                event.trace,

            payload:
                event.payload,

            metadata:
                event.metadata

        });


    return hash(
        canonical
    );

}


/**
 * ============================================================================
 * Create Event Envelope
 * ============================================================================
 */

function createEventEnvelope(
    options = {}
) {

    const now =
        options.createdAt
            ? new Date(
                options.createdAt
            )
            : new Date();


    const occurredAt =
        options.occurredAt
            ? new Date(
                options.occurredAt
            )
            : now;


    const eventType =
        normalizeEventType(
            options.eventType
        );


    if (
        !eventType
    ) {

        throw new TypeError(
            'eventType is required'
        );

    }


    const tenantId =
        normalizeId(
            options.tenantId
        );


    if (
        !tenantId
    ) {

        throw new TypeError(
            'tenantId is required for transaction outbox events'
        );

    }


    const aggregate =
        createAggregateIdentity(
            options.aggregate
        );


    const metadata =
        createEventMetadata(
            options.metadata
        );


    const event = {

        eventId:
            normalizeId(
                options.eventId
            ) ||
            generateEventId(),

        eventKey:
            null,

        eventType,

        eventVersion:
            String(
                options.eventVersion ||
                OUTBOX_VERSION
            ),

        schemaVersion:
            String(
                options.schemaVersion ||
                EVENT_SCHEMA_VERSION
            ),

        category:
            options.category ||
            resolveEventCategory(
                eventType
            ),

        occurredAt,

        createdAt:
            now,

        source:
            options.source ||
            metadata.source,

        service:
            options.service ||
            metadata.service,

        environment:
            options.environment ||
            metadata.environment,

        correlationId:
            normalizeId(
                options.correlationId
            ) ||
            generateCorrelationId(),

        requestId:
            normalizeId(
                options.requestId
            ),

        idempotencyKey:
            normalizeId(
                options.idempotencyKey
            ),

        tenantId,

        organizationId:
            normalizeId(
                options.organizationId
            ),

        userId:
            normalizeId(
                options.userId
            ),

        customerId:
            normalizeId(
                options.customerId
            ),

        transactionId:
            normalizeId(
                options.transactionId
            ),

        parentTransactionId:
            normalizeId(
                options.parentTransactionId
            ),

        provider:
            normalizeProvider(
                options.provider
            ),

        operation:
            normalizeId(
                options.operation
            ),

        aggregate,

        trace:
            createTraceContext(
                options.trace ||
                {}
            ),

        metadata,

        payload:
            sanitizeValue(
                options.payload ||
                {}
            )

    };


    event.eventKey =
        options.eventKey ||
        createEventKey(
            event
        );


    event.fingerprint =
        options.fingerprint ||
        createEventFingerprint(
            event
        );


    event.orderingKey =
        options.orderingKey ||
        createOrderingKey(
            event
        );


    return deepFreeze(
        event
    );

}


/**
 * ============================================================================
 * Event Category Resolution
 * ============================================================================
 */

function resolveEventCategory(
    eventType
) {

    const type =
        String(
            eventType ||
            ''
        )
            .toLowerCase();


    if (
        type.startsWith(
            'ledger.'
        ) ||
        type.startsWith(
            'balance.'
        )
    ) {

        return 'financial';

    }


    if (
        type.startsWith(
            'payment.'
        )
    ) {

        return 'payment';

    }


    if (
        type.startsWith(
            'settlement.'
        )
    ) {

        return 'settlement';

    }


    if (
        type.startsWith(
            'compensation.'
        ) ||
        type.startsWith(
            'recovery.'
        ) ||
        type.startsWith(
            'transaction.rollback'
        ) ||
        type.startsWith(
            'transaction.recover'
        )
    ) {

        return 'recovery';

    }


    if (
        type.startsWith(
            'audit.'
        )
    ) {

        return 'audit';

    }


    if (
        type.startsWith(
            'security.'
        )
    ) {

        return 'security';

    }


    return 'transaction';

}


/**
 * ============================================================================
 * Create Outbox Record
 * ============================================================================
 *
 * This returns an application-level record compatible with the persistent
 * TransactionOutboxRepository.
 */

function createOutboxRecord(
    options = {}
) {

    const envelope =
        options.event
            ? normalizeExistingEvent(
                options.event
            )
            : createEventEnvelope(
                options
            );


    const createdAt =
        envelope.createdAt ||
        new Date();


    const availableAt =
        options.availableAt
            ? new Date(
                options.availableAt
            )
            : new Date(
                createdAt
            );


    return {

        id:
            envelope.eventId,

        eventId:
            envelope.eventId,

        eventKey:
            envelope.eventKey,

        event:
            envelope,

        fingerprint:
            envelope.fingerprint,

        status:
            options.status ||
            EventStatus.PENDING,

        batchId:
            options.batchId ||
            generateBatchId(),

        orderingKey:
            envelope.orderingKey,

        tenantId:
            envelope.tenantId,

        transactionId:
            envelope.transactionId ||
            null,

        correlationId:
            envelope.correlationId ||
            null,

        provider:
            envelope.provider ||
            null,

        eventType:
            envelope.eventType,

        priority:
            envelope.metadata?.priority ||
            EventPriority.NORMAL,

        availableAt,

        attempts:
            Number(
                options.attempts
            ) >= 0
                ? Number(
                    options.attempts
                )
                : 0,

        maxAttempts:
            Number(
                options.maxAttempts
            ) > 0
                ? Number(
                    options.maxAttempts
                )
                : 10,

        nextAttemptAt:
            options.nextAttemptAt
                ? new Date(
                    options.nextAttemptAt
                )
                : availableAt,

        publishedAt:
            options.publishedAt
                ? new Date(
                    options.publishedAt
                )
                : null,

        failedAt:
            options.failedAt
                ? new Date(
                    options.failedAt
                )
                : null,

        lockedAt:
            options.lockedAt
                ? new Date(
                    options.lockedAt
                )
                : null,

        claimedBy:
            options.claimedBy ||
            null,

        leaseExpiresAt:
            options.leaseExpiresAt
                ? new Date(
                    options.leaseExpiresAt
                )
                : null,

        lastError:
            options.lastError ||
            null,

        replayCount:
            Number(
                options.replayCount
            ) >= 0
                ? Number(
                    options.replayCount
                )
                : 0,

        createdAt,

        updatedAt:
            new Date(
                createdAt
            ),

        version:
            Number(
                options.version
            ) >= 0
                ? Number(
                    options.version
                )
                : 0

    };

}


/**
 * ============================================================================
 * Normalize Existing Event
 * ============================================================================
 */

function normalizeExistingEvent(
    event
) {

    if (
        !event ||
        typeof event !== 'object'
    ) {

        throw new TypeError(
            'event must be an object'
        );

    }


    return createEventEnvelope({

        ...event,

        eventId:
            event.eventId,

        eventKey:
            event.eventKey,

        fingerprint:
            event.fingerprint,

        orderingKey:
            event.orderingKey,

        createdAt:
            event.createdAt,

        occurredAt:
            event.occurredAt,

        metadata:
            event.metadata,

        aggregate:
            event.aggregate,

        trace:
            event.trace,

        payload:
            event.payload

    });

}


/**
 * ============================================================================
 * Validate Event Envelope
 * ============================================================================
 */

function validateEventEnvelope(
    event,
    options = {}
) {

    const errors = [];


    if (
        !event ||
        typeof event !== 'object'
    ) {

        return {

            valid:
                false,

            errors:
                [
                    'event must be an object'
                ]

        };

    }


    const requiredFields = [

        'eventId',
        'eventType',
        'eventVersion',
        'schemaVersion',
        'occurredAt',
        'createdAt',
        'correlationId',
        'tenantId',
        'payload',
        'eventKey',
        'fingerprint',
        'orderingKey'

    ];


    for (
        const field
        of requiredFields
    ) {

        if (
            event[field] ===
                undefined ||
            event[field] ===
                null ||
            event[field] ===
                ''
        ) {

            errors.push(
                `${field} is required`
            );

        }

    }


    if (
        event.eventType &&
        typeof event.eventType !==
            'string'
    ) {

        errors.push(
            'eventType must be a string'
        );

    }


    if (
        event.tenantId &&
        typeof event.tenantId !==
            'string'
    ) {

        errors.push(
            'tenantId must be a string'
        );

    }


    if (
        event.aggregate &&
        (
            event.aggregate.type &&
            !event.aggregate.id
        )
    ) {

        errors.push(
            'aggregate.id is required when aggregate.type is provided'
        );

    }


    if (
        event.occurredAt &&
        !isValidDate(
            event.occurredAt
        )
    ) {

        errors.push(
            'occurredAt must be a valid date'
        );

    }


    if (
        event.createdAt &&
        !isValidDate(
            event.createdAt
        )
    ) {

        errors.push(
            'createdAt must be a valid date'
        );

    }


    const expectedKey =
        event.eventKey &&
        createEventKey(
            event
        );


    if (
        expectedKey &&
        options.verifyFingerprint !== false &&
        expectedKey !==
            event.eventKey
    ) {

        errors.push(
            'eventKey does not match deterministic event identity'
        );

    }


    const expectedFingerprint =
        event.fingerprint &&
        createEventFingerprint(
            event
        );


    if (
        expectedFingerprint &&
        options.verifyFingerprint === true &&
        expectedFingerprint !==
            event.fingerprint
    ) {

        errors.push(
            'event fingerprint does not match event payload'
        );

    }


    return {

        valid:
            errors.length ===
            0,

        errors

    };

}


/**
 * ============================================================================
 * Validate Outbox Record
 * ============================================================================
 */

function validateOutboxRecord(
    record,
    options = {}
) {

    const errors = [];


    if (
        !record ||
        typeof record !==
            'object'
    ) {

        return {

            valid:
                false,

            errors:
                [
                    'record must be an object'
                ]

        };

    }


    if (
        !record.id
    ) {

        errors.push(
            'record.id is required'
        );

    }


    if (
        !record.tenantId
    ) {

        errors.push(
            'record.tenantId is required'
        );

    }


    if (
        !record.event
    ) {

        errors.push(
            'record.event is required'
        );

    }
    else {

        const envelopeValidation =
            validateEventEnvelope(

                record.event,

                options

            );


        errors.push(
            ...envelopeValidation.errors.map(
                error =>
                    `event.${error}`
            )
        );

    }


    if (
        record.status &&
        !Object.values(
            EventStatus
        ).includes(
            record.status
        )
    ) {

        errors.push(
            `invalid outbox status: ${record.status}`
        );

    }


    if (
        record.eventId &&
        record.event?.eventId &&
        record.eventId !==
            record.event.eventId
    ) {

        errors.push(
            'record.eventId must match event.eventId'
        );

    }


    if (
        record.eventKey &&
        record.event?.eventKey &&
        record.eventKey !==
            record.event.eventKey
    ) {

        errors.push(
            'record.eventKey must match event.eventKey'
        );

    }


    if (
        record.orderingKey &&
        record.event?.orderingKey &&
        record.orderingKey !==
            record.event.orderingKey
    ) {

        errors.push(
            'record.orderingKey must match event.orderingKey'
        );

    }


    return {

        valid:
            errors.length ===
            0,

        errors

    };

}


/**
 * ============================================================================
 * Date Validation
 * ============================================================================
 */

function isValidDate(
    value
) {

    const date =
        value instanceof Date
            ? value
            : new Date(
                value
            );


    return Number.isFinite(
        date.getTime()
    );

}


/**
 * ============================================================================
 * Assertion Helpers
 * ============================================================================
 */

function assertValidEvent(
    event,
    options = {}
) {

    const result =
        validateEventEnvelope(
            event,
            options
        );


    if (
        !result.valid
    ) {

        const error =
            new TypeError(

                `Invalid transaction outbox event: ${result.errors.join('; ')}`

            );


        error.code =
            'TRANSACTION_OUTBOX_EVENT_INVALID';


        error.validationErrors =
            result.errors;


        throw error;

    }


    return true;

}


function assertValidRecord(
    record,
    options = {}
) {

    const result =
        validateOutboxRecord(
            record,
            options
        );


    if (
        !result.valid
    ) {

        const error =
            new TypeError(

                `Invalid transaction outbox record: ${result.errors.join('; ')}`

            );


        error.code =
            'TRANSACTION_OUTBOX_RECORD_INVALID';


        error.validationErrors =
            result.errors;


        throw error;

    }


    return true;

}


/**
 * ============================================================================
 * Public API
 * ============================================================================
 */

module.exports = {

    OUTBOX_VERSION,

    EVENT_SCHEMA_VERSION,

    EventStatus,

    EventPriority,

    OutboxRepositoryContract,

    createEventEnvelope,

    createOutboxRecord,

    createAggregateIdentity,

    createEventMetadata,

    createTraceContext,

    createOrderingKey,

    createEventKey,

    createEventFingerprint,

    resolveEventCategory,

    validateEventEnvelope,

    validateOutboxRecord,

    assertValidEvent,

    assertValidRecord,

    normalizeEventType,

    normalizeProvider,

    normalizeId,

    sanitizeValue

};