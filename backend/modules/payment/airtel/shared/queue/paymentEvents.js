'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Airtel Money Enterprise Payment Events
 * ============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/shared/queue/paymentEvents.js
 *
 * Architectural Role
 * ------------------
 * Canonical event contract and event-envelope builder for Airtel Money
 * payment operations.
 *
 * This module defines WHAT an Airtel payment event means and validates the
 * event envelope. It does not define HOW events are delivered.
 *
 * Event transport belongs to the configured:
 *   • transactional outbox
 *   • message broker
 *   • event publisher
 *   • queue adapter
 *
 * Responsibilities
 * ----------------
 * • Define stable Airtel payment event types.
 * • Build validated event envelopes.
 * • Normalize tenant/correlation/operation context.
 * • Generate deterministic event IDs.
 * • Generate event idempotency keys.
 * • Sanitize event payloads.
 * • Prevent secrets and sensitive transport data from entering events.
 * • Attach event schema/version metadata.
 * • Support aggregate/entity correlation.
 * • Validate event envelopes before publication.
 * • Serialize events safely for transport.
 * • Provide event capability/diagnostic metadata.
 *
 * Does NOT:
 * ----------
 * • Publish to Kafka/RabbitMQ/SQS/Redis/etc.
 * • Perform network I/O.
 * • Process callbacks.
 * • Execute payments.
 * • Modify payment state.
 * • Post ledger entries.
 * • Modify balances.
 * • Perform reconciliation.
 * • Perform settlement.
 * • Retry message delivery.
 *
 * Event Safety Principles
 * -----------------------
 * • Events describe authoritative state/action; they do not create it.
 * • Event publication must never be interpreted as financial settlement.
 * • Financial state must already be committed or intentionally represented as
 *   an event describing the lifecycle transition.
 * • Consumers must use eventId/idempotencyKey for duplicate protection.
 * • Tenant context is mandatory for tenant-scoped financial events.
 * • Raw provider responses, signatures, access tokens and credentials are
 *   forbidden from event payloads.
 * • Payload values are sanitized recursively.
 * • Event names and schema versions are stable contracts.
 *
 * Module Format
 * -------------
 * CommonJS.
 *
 * ============================================================================
 */

const crypto = require('crypto');


const PROVIDER = 'AIRTEL';

const EVENT_SCHEMA_VERSION = '1.0';

const EVENT_SOURCE = 'titech-community-capital';

const AGGREGATE_TYPES = Object.freeze({
    COLLECTION:
        'AIRTEL_COLLECTION',

    DISBURSEMENT:
        'AIRTEL_DISBURSEMENT',

    CALLBACK:
        'AIRTEL_CALLBACK',

    SETTLEMENT:
        'AIRTEL_SETTLEMENT',

    RECONCILIATION:
        'AIRTEL_RECONCILIATION',

    AUTHENTICATION:
        'AIRTEL_AUTHENTICATION'
});


/**
 * Stable lifecycle/event vocabulary.
 *
 * Names are intentionally explicit and provider-qualified so consumers cannot
 * confuse Airtel events with MTN or internal payment events.
 */
const PAYMENT_EVENT_TYPES = Object.freeze({

    COLLECTION_CREATED:
        'AIRTEL_COLLECTION_CREATED',

    COLLECTION_ACCEPTED:
        'AIRTEL_COLLECTION_ACCEPTED',

    COLLECTION_PENDING:
        'AIRTEL_COLLECTION_PENDING',

    COLLECTION_SUCCEEDED:
        'AIRTEL_COLLECTION_SUCCEEDED',

    COLLECTION_FAILED:
        'AIRTEL_COLLECTION_FAILED',

    COLLECTION_REVERSED:
        'AIRTEL_COLLECTION_REVERSED',

    DISBURSEMENT_CREATED:
        'AIRTEL_DISBURSEMENT_CREATED',

    DISBURSEMENT_ACCEPTED:
        'AIRTEL_DISBURSEMENT_ACCEPTED',

    DISBURSEMENT_PENDING:
        'AIRTEL_DISBURSEMENT_PENDING',

    DISBURSEMENT_SUCCEEDED:
        'AIRTEL_DISBURSEMENT_SUCCEEDED',

    DISBURSEMENT_FAILED:
        'AIRTEL_DISBURSEMENT_FAILED',

    DISBURSEMENT_REVERSED:
        'AIRTEL_DISBURSEMENT_REVERSED',

    CALLBACK_RECEIVED:
        'AIRTEL_CALLBACK_RECEIVED',

    CALLBACK_VERIFIED:
        'AIRTEL_CALLBACK_VERIFIED',

    CALLBACK_REJECTED:
        'AIRTEL_CALLBACK_REJECTED',

    CALLBACK_DUPLICATE:
        'AIRTEL_CALLBACK_DUPLICATE',

    CALLBACK_PROCESSED:
        'AIRTEL_CALLBACK_PROCESSED',

    CALLBACK_FAILED:
        'AIRTEL_CALLBACK_FAILED',

    SETTLEMENT_REGISTERED:
        'AIRTEL_SETTLEMENT_REGISTERED',

    SETTLEMENT_RECONCILIATION_STARTED:
        'AIRTEL_SETTLEMENT_RECONCILIATION_STARTED',

    SETTLEMENT_VARIANCE_DETECTED:
        'AIRTEL_SETTLEMENT_VARIANCE_DETECTED',

    SETTLEMENT_SETTLED:
        'AIRTEL_SETTLEMENT_SETTLED',

    SETTLEMENT_FAILED:
        'AIRTEL_SETTLEMENT_FAILED',

    SETTLEMENT_REVERSED:
        'AIRTEL_SETTLEMENT_REVERSED',

    RECONCILIATION_STARTED:
        'AIRTEL_RECONCILIATION_STARTED',

    RECONCILIATION_COMPLETED:
        'AIRTEL_RECONCILIATION_COMPLETED',

    RECONCILIATION_VARIANCE_DETECTED:
        'AIRTEL_RECONCILIATION_VARIANCE_DETECTED',

    RECONCILIATION_REQUIRES_REVIEW:
        'AIRTEL_RECONCILIATION_REQUIRES_REVIEW',

    AUTHENTICATION_INITIALIZED:
        'AIRTEL_AUTHENTICATION_INITIALIZED',

    AUTHENTICATION_FAILED:
        'AIRTEL_AUTHENTICATION_FAILED'
});


const EVENT_CATEGORIES = Object.freeze({
    COLLECTION:
        'COLLECTION',

    DISBURSEMENT:
        'DISBURSEMENT',

    CALLBACK:
        'CALLBACK',

    SETTLEMENT:
        'SETTLEMENT',

    RECONCILIATION:
        'RECONCILIATION',

    AUTHENTICATION:
        'AUTHENTICATION'
});


const SENSITIVE_KEYS = new Set([
    'authorization',
    'proxyAuthorization',
    'proxy-authorization',
    'cookie',
    'set-cookie',

    'password',
    'secret',
    'clientSecret',
    'client_secret',
    'clientId',
    'client_id',

    'apiKey',
    'api_key',

    'accessToken',
    'access_token',
    'refreshToken',
    'refresh_token',

    'token',
    'signature',

    'privateKey',
    'private_key',

    'credentials',

    'rawPayload',
    'raw_payload',

    'providerResponse',
    'provider_response',

    'requestHeaders',
    'responseHeaders'
]);


const FORBIDDEN_PAYLOAD_KEY_NAMES = new Set([
    'raw',
    'body',
    'request',
    'response',
    'requestBody',
    'responseBody',
    'request_body',
    'response_body'
]);


const MAX_PAYLOAD_DEPTH = 8;

const MAX_STRING_LENGTH = 4000;

const MAX_ARRAY_LENGTH = 200;

const MAX_EVENT_TYPE_LENGTH = 128;

const MAX_ID_LENGTH = 256;


/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */
function isObject(value) {
    return (
        value !== null &&
        typeof value === 'object'
    );
}


function isPlainObject(value) {
    if (
        !isObject(value)
    ) {
        return false;
    }

    const prototype =
        Object.getPrototypeOf(value);

    return (
        prototype === Object.prototype ||
        prototype === null
    );
}


function isFunction(value) {
    return typeof value === 'function';
}


function safeString(
    value,
    maxLength = MAX_STRING_LENGTH
) {
    if (
        value === undefined ||
        value === null
    ) {
        return undefined;
    }

    return String(value)
        .trim()
        .slice(
            0,
            maxLength
        );
}


function requiredId(
    value,
    name
) {
    const normalized =
        safeString(
            value,
            MAX_ID_LENGTH
        );

    if (
        !normalized
    ) {
        throw createEventError(
            'AIRTEL_EVENT_CONTEXT_REQUIRED',
            `${name} is required`
        );
    }

    return normalized;
}


function generateUuid() {
    return crypto.randomUUID();
}


function generateEventId({
    eventType,
    tenantId,
    aggregateId,
    occurredAt,
    correlationId,
    operationId
}) {
    return crypto
        .createHash('sha256')
        .update(
            [
                PROVIDER,
                eventType,
                tenantId || '',
                aggregateId || '',
                occurredAt,
                correlationId || '',
                operationId || ''
            ].join('|')
        )
        .digest('hex');
}


function generateIdempotencyKey({
    tenantId,
    eventType,
    aggregateId,
    operationId,
    eventId
}) {
    return crypto
        .createHash('sha256')
        .update(
            [
                PROVIDER,
                tenantId || '',
                eventType,
                aggregateId || '',
                operationId || eventId
            ].join('|')
        )
        .digest('hex');
}


function sanitizeValue(
    value,
    depth = 0,
    parentKey = ''
) {
    if (
        depth > MAX_PAYLOAD_DEPTH
    ) {
        return '[TRUNCATED]';
    }

    if (
        value === null ||
        value === undefined
    ) {
        return value;
    }

    if (
        Buffer.isBuffer(value)
    ) {
        return '[REDACTED_BUFFER]';
    }

    if (
        value instanceof Date
    ) {
        return value.toISOString();
    }

    if (
        typeof value === 'string'
    ) {
        return value.slice(
            0,
            MAX_STRING_LENGTH
        );
    }

    if (
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        return value;
    }

    if (
        typeof value === 'bigint'
    ) {
        return value.toString();
    }

    if (
        Array.isArray(value)
    ) {
        return value
            .slice(
                0,
                MAX_ARRAY_LENGTH
            )
            .map(
                item =>
                    sanitizeValue(
                        item,
                        depth + 1,
                        parentKey
                    )
            );
    }

    if (
        isObject(value)
    ) {
        const result = {};

        for (
            const [
                key,
                item
            ] of Object.entries(value)
        ) {
            const normalizedKey =
                String(key);

            const lowerKey =
                normalizedKey.toLowerCase();

            if (
                SENSITIVE_KEYS.has(
                    normalizedKey
                ) ||
                SENSITIVE_KEYS.has(
                    lowerKey
                )
            ) {
                result[key] =
                    '[REDACTED]';

                continue;
            }

            if (
                FORBIDDEN_PAYLOAD_KEY_NAMES.has(
                    normalizedKey
                ) ||
                FORBIDDEN_PAYLOAD_KEY_NAMES.has(
                    lowerKey
                )
            ) {
                /**
                 * Only exclude known transport/container fields. Business
                 * fields such as "reference", "status", "amount" remain intact.
                 */
                result[key] =
                    '[OMITTED]';

                continue;
            }

            result[key] =
                sanitizeValue(
                    item,
                    depth + 1,
                    normalizedKey
                );
        }

        return result;
    }

    return safeString(
        value
    );
}


function cloneSanitized(
    value
) {
    return sanitizeValue(
        value
    );
}


function createEventError(
    code,
    message,
    details = {}
) {
    const error =
        new Error(
            message
        );

    error.name =
        'AirtelPaymentEventError';

    error.code =
        code;

    error.provider =
        PROVIDER;

    Object.assign(
        error,
        details
    );

    return error;
}


function normalizeOccurredAt(
    occurredAt
) {
    if (
        occurredAt === undefined ||
        occurredAt === null
    ) {
        return new Date()
            .toISOString();
    }

    const date =
        occurredAt instanceof Date
            ? occurredAt
            : new Date(
                occurredAt
            );

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        throw createEventError(
            'AIRTEL_EVENT_TIMESTAMP_INVALID',
            'Event occurredAt must be a valid timestamp'
        );
    }

    return date.toISOString();
}


function normalizeCategory(
    eventType
) {
    const value =
        String(
            eventType || ''
        );

    if (
        value.includes(
            '_COLLECTION_'
        )
    ) {
        return EVENT_CATEGORIES.COLLECTION;
    }

    if (
        value.includes(
            '_DISBURSEMENT_'
        )
    ) {
        return EVENT_CATEGORIES.DISBURSEMENT;
    }

    if (
        value.includes(
            '_CALLBACK_'
        )
    ) {
        return EVENT_CATEGORIES.CALLBACK;
    }

    if (
        value.includes(
            '_SETTLEMENT_'
        )
    ) {
        return EVENT_CATEGORIES.SETTLEMENT;
    }

    if (
        value.includes(
            '_RECONCILIATION_'
        )
    ) {
        return EVENT_CATEGORIES.RECONCILIATION;
    }

    if (
        value.includes(
            '_AUTHENTICATION_'
        )
    ) {
        return EVENT_CATEGORIES.AUTHENTICATION;
    }

    throw createEventError(
        'AIRTEL_EVENT_TYPE_INVALID',
        `Unable to infer event category from ${eventType}`
    );
}


function inferAggregateType(
    category
) {
    switch (
        category
    ) {
        case EVENT_CATEGORIES.COLLECTION:
            return AGGREGATE_TYPES.COLLECTION;

        case EVENT_CATEGORIES.DISBURSEMENT:
            return AGGREGATE_TYPES.DISBURSEMENT;

        case EVENT_CATEGORIES.CALLBACK:
            return AGGREGATE_TYPES.CALLBACK;

        case EVENT_CATEGORIES.SETTLEMENT:
            return AGGREGATE_TYPES.SETTLEMENT;

        case EVENT_CATEGORIES.RECONCILIATION:
            return AGGREGATE_TYPES.RECONCILIATION;

        case EVENT_CATEGORIES.AUTHENTICATION:
            return AGGREGATE_TYPES.AUTHENTICATION;

        default:
            throw createEventError(
                'AIRTEL_EVENT_AGGREGATE_INVALID',
                `Unsupported Airtel event category: ${category}`
            );
    }
}


/**
 * ============================================================================
 * Payment Event Contract
 * ============================================================================
 */
class AirtelPaymentEvents {

    constructor({
        provider =
            PROVIDER,

        source =
            EVENT_SOURCE,

        schemaVersion =
            EVENT_SCHEMA_VERSION,

        logger,
        metrics
    } = {}) {
        if (
            provider !== PROVIDER
        ) {
            throw createEventError(
                'AIRTEL_EVENT_PROVIDER_INVALID',
                `Payment events provider must be ${PROVIDER}`
            );
        }

        this.provider =
            provider;

        this.source =
            safeString(
                source,
                256
            ) ||
            EVENT_SOURCE;

        this.schemaVersion =
            safeString(
                schemaVersion,
                32
            ) ||
            EVENT_SCHEMA_VERSION;

        this.logger =
            logger;

        this.metrics =
            metrics;
    }


    /**
     * =========================================================================
     * Create Event
     * =========================================================================
     */
    create({
        type,
        tenantId,
        aggregateId,
        aggregateType,
        correlationId,
        operationId,
        requestId,
        actorId,
        occurredAt,
        payload = {},
        metadata = {},
        idempotencyKey,
        eventId,
        causationId,
        traceId
    } = {}) {
        const eventType =
            this.normalizeEventType(
                type
            );

        const normalizedTenantId =
            requiredId(
                tenantId,
                'tenantId'
            );

        const normalizedAggregateId =
            safeString(
                aggregateId,
                MAX_ID_LENGTH
            );

        if (
            !normalizedAggregateId
        ) {
            throw createEventError(
                'AIRTEL_EVENT_AGGREGATE_ID_REQUIRED',
                'aggregateId is required'
            );
        }

        const category =
            normalizeCategory(
                eventType
            );

        const effectiveAggregateType =
            aggregateType ||
            inferAggregateType(
                category
            );

        const normalizedOccurredAt =
            normalizeOccurredAt(
                occurredAt
            );

        const normalizedCorrelationId =
            correlationId ||
            generateUuid();

        const normalizedOperationId =
            operationId ||
            generateUuid();

        const normalizedEventId =
            eventId ||
            generateEventId({
                eventType,
                tenantId:
                    normalizedTenantId,
                aggregateId:
                    normalizedAggregateId,
                occurredAt:
                    normalizedOccurredAt,
                correlationId:
                    normalizedCorrelationId,
                operationId:
                    normalizedOperationId
            });

        const normalizedIdempotencyKey =
            idempotencyKey ||
            generateIdempotencyKey({
                tenantId:
                    normalizedTenantId,
                eventType,
                aggregateId:
                    normalizedAggregateId,
                operationId:
                    normalizedOperationId,
                eventId:
                    normalizedEventId
            });

        const event = {
            eventId:
                normalizedEventId,

            eventType,

            eventVersion:
                this.schemaVersion,

            provider:
                this.provider,

            source:
                this.source,

            category,

            aggregateType:
                effectiveAggregateType,

            aggregateId:
                normalizedAggregateId,

            tenantId:
                normalizedTenantId,

            occurredAt:
                normalizedOccurredAt,

            correlationId:
                safeString(
                    normalizedCorrelationId,
                    MAX_ID_LENGTH
                ),

            operationId:
                safeString(
                    normalizedOperationId,
                    MAX_ID_LENGTH
                ),

            requestId:
                safeString(
                    requestId,
                    MAX_ID_LENGTH
                ),

            actorId:
                safeString(
                    actorId,
                    MAX_ID_LENGTH
                ),

            causationId:
                safeString(
                    causationId,
                    MAX_ID_LENGTH
                ),

            traceId:
                safeString(
                    traceId,
                    MAX_ID_LENGTH
                ),

            idempotencyKey:
                normalizedIdempotencyKey,

            payload:
                cloneSanitized(
                    payload
                ),

            metadata:
                cloneSanitized(
                    metadata
                )
        };

        this.validate(
            event
        );

        this.metrics?.increment?.(
            'payment_airtel_event_created_total'
        );

        return Object.freeze(
            event
        );
    }


    /**
     * =========================================================================
     * Event-Type-Specific Helpers
     * =========================================================================
     */
    collectionCreated(
        options = {}
    ) {
        return this.create({
            ...options,
            type:
                PAYMENT_EVENT_TYPES.COLLECTION_CREATED,
            aggregateType:
                AGGREGATE_TYPES.COLLECTION
        });
    }


    collectionAccepted(
        options = {}
    ) {
        return this.create({
            ...options,
            type:
                PAYMENT_EVENT_TYPES.COLLECTION_ACCEPTED,
            aggregateType:
                AGGREGATE_TYPES.COLLECTION
        });
    }


    collectionPending(
        options = {}
    ) {
        return this.create({
            ...options,
            type:
                PAYMENT_EVENT_TYPES.COLLECTION_PENDING,
            aggregateType:
                AGGREGATE_TYPES.COLLECTION
        });
    }


    collectionSucceeded(
        options = {}
    ) {
        return this.create({
            ...options,
            type:
                PAYMENT_EVENT_TYPES.COLLECTION_SUCCEEDED,
            aggregateType:
                AGGREGATE_TYPES.COLLECTION
        });
    }


    collectionFailed(
        options = {}
    ) {
        return this.create({
            ...options,
            type:
                PAYMENT_EVENT_TYPES.COLLECTION_FAILED,
            aggregateType:
                AGGREGATE_TYPES.COLLECTION
        });
    }


    collectionReversed(
        options = {}
    ) {
        return this.create({
            ...options,
            type:
                PAYMENT_EVENT_TYPES.COLLECTION_REVERSED,
            aggregateType:
                AGGREGATE_TYPES.COLLECTION
        });
    }


    disbursementCreated(
        options = {}
    ) {
        return this.create({
            ...options,
            type:
                PAYMENT_EVENT_TYPES.DISBURSEMENT_CREATED,
            aggregateType:
                AGGREGATE_TYPES.DISBURSEMENT
        });
    }


    disbursementAccepted(
        options = {}
    ) {
        return this.create({
            ...options,
            type:
                PAYMENT_EVENT_TYPES.DISBURSEMENT_ACCEPTED,
            aggregateType:
                AGGREGATE_TYPES.DISBURSEMENT
        });
    }


    disbursementPending(
        options = {}
    ) {
        return this.create({
            ...options,
            type:
                PAYMENT_EVENT_TYPES.DISBURSEMENT_PENDING,
            aggregateType:
                AGGREGATE_TYPES.DISBURSEMENT
        });
    }


    disbursementSucceeded(
        options = {}
    ) {
        return this.create({
            ...options,
            type:
                PAYMENT_EVENT_TYPES.DISBURSEMENT_SUCCEEDED,
            aggregateType:
                AGGREGATE_TYPES.DISBURSEMENT
        });
    }


    disbursementFailed(
        options = {}
    ) {
        return this.create({
            ...options,
            type:
                PAYMENT_EVENT_TYPES.DISBURSEMENT_FAILED,
            aggregateType:
                AGGREGATE_TYPES.DISBURSEMENT
        });
    }


    disbursementReversed(
        options = {}
    ) {
        return this.create({
            ...options,
            type:
                PAYMENT_EVENT_TYPES.DISBURSEMENT_REVERSED,
            aggregateType:
                AGGREGATE_TYPES.DISBURSEMENT
        });
    }


    callbackReceived(
        options = {}
    ) {
        return this.create({
            ...options,
            type:
                PAYMENT_EVENT_TYPES.CALLBACK_RECEIVED,
            aggregateType:
                AGGREGATE_TYPES.CALLBACK
        });
    }


    callbackVerified(
        options = {}
    ) {
        return this.create({
            ...options,
            type:
                PAYMENT_EVENT_TYPES.CALLBACK_VERIFIED,
            aggregateType:
                AGGREGATE_TYPES.CALLBACK
        });
    }


    callbackRejected(
        options = {}
    ) {
        return this.create({
            ...options,
            type:
                PAYMENT_EVENT_TYPES.CALLBACK_REJECTED,
            aggregateType:
                AGGREGATE_TYPES.CALLBACK
        });
    }


    callbackDuplicate(
        options = {}
    ) {
        return this.create({
            ...options,
            type:
                PAYMENT_EVENT_TYPES.CALLBACK_DUPLICATE,
            aggregateType:
                AGGREGATE_TYPES.CALLBACK
        });
    }


    callbackProcessed(
        options = {}
    ) {
        return this.create({
            ...options,
            type:
                PAYMENT_EVENT_TYPES.CALLBACK_PROCESSED,
            aggregateType:
                AGGREGATE_TYPES.CALLBACK
        });
    }


    callbackFailed(
        options = {}
    ) {
        return this.create({
            ...options,
            type:
                PAYMENT_EVENT_TYPES.CALLBACK_FAILED,
            aggregateType:
                AGGREGATE_TYPES.CALLBACK
        });
    }


    settlementRegistered(
        options = {}
    ) {
        return this.create({
            ...options,
            type:
                PAYMENT_EVENT_TYPES.SETTLEMENT_REGISTERED,
            aggregateType:
                AGGREGATE_TYPES.SETTLEMENT
        });
    }


    settlementReconciliationStarted(
        options = {}
    ) {
        return this.create({
            ...options,
            type:
                PAYMENT_EVENT_TYPES.SETTLEMENT_RECONCILIATION_STARTED,
            aggregateType:
                AGGREGATE_TYPES.SETTLEMENT
        });
    }


    settlementVarianceDetected(
        options = {}
    ) {
        return this.create({
            ...options,
            type:
                PAYMENT_EVENT_TYPES.SETTLEMENT_VARIANCE_DETECTED,
            aggregateType:
                AGGREGATE_TYPES.SETTLEMENT
        });
    }


    settlementSettled(
        options = {}
    ) {
        return this.create({
            ...options,
            type:
                PAYMENT_EVENT_TYPES.SETTLEMENT_SETTLED,
            aggregateType:
                AGGREGATE_TYPES.SETTLEMENT
        });
    }


    settlementFailed(
        options = {}
    ) {
        return this.create({
            ...options,
            type:
                PAYMENT_EVENT_TYPES.SETTLEMENT_FAILED,
            aggregateType:
                AGGREGATE_TYPES.SETTLEMENT
        });
    }


    settlementReversed(
        options = {}
    ) {
        return this.create({
            ...options,
            type:
                PAYMENT_EVENT_TYPES.SETTLEMENT_REVERSED,
            aggregateType:
                AGGREGATE_TYPES.SETTLEMENT
        });
    }


    reconciliationStarted(
        options = {}
    ) {
        return this.create({
            ...options,
            type:
                PAYMENT_EVENT_TYPES.RECONCILIATION_STARTED,
            aggregateType:
                AGGREGATE_TYPES.RECONCILIATION
        });
    }


    reconciliationCompleted(
        options = {}
    ) {
        return this.create({
            ...options,
            type:
                PAYMENT_EVENT_TYPES.RECONCILIATION_COMPLETED,
            aggregateType:
                AGGREGATE_TYPES.RECONCILIATION
        });
    }


    reconciliationVarianceDetected(
        options = {}
    ) {
        return this.create({
            ...options,
            type:
                PAYMENT_EVENT_TYPES.RECONCILIATION_VARIANCE_DETECTED,
            aggregateType:
                AGGREGATE_TYPES.RECONCILIATION
        });
    }


    reconciliationRequiresReview(
        options = {}
    ) {
        return this.create({
            ...options,
            type:
                PAYMENT_EVENT_TYPES.RECONCILIATION_REQUIRES_REVIEW,
            aggregateType:
                AGGREGATE_TYPES.RECONCILIATION
        });
    }


    authenticationInitialized(
        options = {}
    ) {
        return this.create({
            ...options,
            type:
                PAYMENT_EVENT_TYPES.AUTHENTICATION_INITIALIZED,
            aggregateType:
                AGGREGATE_TYPES.AUTHENTICATION
        });
    }


    authenticationFailed(
        options = {}
    ) {
        return this.create({
            ...options,
            type:
                PAYMENT_EVENT_TYPES.AUTHENTICATION_FAILED,
            aggregateType:
                AGGREGATE_TYPES.AUTHENTICATION
        });
    }


    /**
     * =========================================================================
     * Event Validation
     * =========================================================================
     */
    validate(
        event
    ) {
        if (
            !isObject(event)
        ) {
            throw createEventError(
                'AIRTEL_EVENT_INVALID',
                'Event must be an object'
            );
        }

        if (
            !event.eventId
        ) {
            throw createEventError(
                'AIRTEL_EVENT_ID_REQUIRED',
                'eventId is required'
            );
        }

        if (
            !event.eventType
        ) {
            throw createEventError(
                'AIRTEL_EVENT_TYPE_REQUIRED',
                'eventType is required'
            );
        }

        if (
            !Object.values(
                PAYMENT_EVENT_TYPES
            ).includes(
                event.eventType
            )
        ) {
            throw createEventError(
                'AIRTEL_EVENT_TYPE_UNSUPPORTED',
                `Unsupported Airtel payment event type: ${event.eventType}`
            );
        }

        if (
            event.provider !==
            PROVIDER
        ) {
            throw createEventError(
                'AIRTEL_EVENT_PROVIDER_INVALID',
                'Invalid event provider'
            );
        }

        if (
            !event.tenantId
        ) {
            throw createEventError(
                'AIRTEL_EVENT_TENANT_REQUIRED',
                'tenantId is required'
            );
        }

        if (
            !event.aggregateId
        ) {
            throw createEventError(
                'AIRTEL_EVENT_AGGREGATE_ID_REQUIRED',
                'aggregateId is required'
            );
        }

        if (
            !event.aggregateType
        ) {
            throw createEventError(
                'AIRTEL_EVENT_AGGREGATE_TYPE_REQUIRED',
                'aggregateType is required'
            );
        }

        if (
            !Object.values(
                AGGREGATE_TYPES
            ).includes(
                event.aggregateType
            )
        ) {
            throw createEventError(
                'AIRTEL_EVENT_AGGREGATE_TYPE_INVALID',
                `Unsupported Airtel aggregate type: ${event.aggregateType}`
            );
        }

        if (
            !event.occurredAt
        ) {
            throw createEventError(
                'AIRTEL_EVENT_TIMESTAMP_REQUIRED',
                'occurredAt is required'
            );
        }

        if (
            !event.correlationId
        ) {
            throw createEventError(
                'AIRTEL_EVENT_CORRELATION_ID_REQUIRED',
                'correlationId is required'
            );
        }

        if (
            !event.operationId
        ) {
            throw createEventError(
                'AIRTEL_EVENT_OPERATION_ID_REQUIRED',
                'operationId is required'
            );
        }

        if (
            typeof event.payload !==
            'object'
        ) {
            throw createEventError(
                'AIRTEL_EVENT_PAYLOAD_INVALID',
                'Event payload must be an object'
            );
        }

        if (
            typeof event.metadata !==
            'object'
        ) {
            throw createEventError(
                'AIRTEL_EVENT_METADATA_INVALID',
                'Event metadata must be an object'
            );
        }

        return true;
    }


    /**
     * =========================================================================
     * Serialization
     * =========================================================================
     */
    serialize(
        event
    ) {
        this.validate(
            event
        );

        try {
            return JSON.stringify(
                event
            );
        } catch (error) {
            throw createEventError(
                'AIRTEL_EVENT_SERIALIZATION_FAILED',
                'Unable to serialize Airtel payment event',
                {
                    cause:
                        error
                }
            );
        }
    }


    /**
     * =========================================================================
     * Deserialization
     * =========================================================================
     */
    deserialize(
        input
    ) {
        let parsed;

        try {
            parsed =
                typeof input === 'string'
                    ? JSON.parse(input)
                    : input;
        } catch (error) {
            throw createEventError(
                'AIRTEL_EVENT_DESERIALIZATION_FAILED',
                'Unable to deserialize Airtel payment event',
                {
                    cause:
                        error
                }
            );
        }

        this.validate(
            parsed
        );

        return parsed;
    }


    /**
     * =========================================================================
     * Safe Event Projection
     * =========================================================================
     *
     * Useful before handing an event to generic logging infrastructure.
     */
    toSafeLog(
        event
    ) {
        this.validate(
            event
        );

        return {
            eventId:
                event.eventId,

            eventType:
                event.eventType,

            eventVersion:
                event.eventVersion,

            provider:
                event.provider,

            source:
                event.source,

            category:
                event.category,

            aggregateType:
                event.aggregateType,

            aggregateId:
                event.aggregateId,

            tenantId:
                event.tenantId,

            occurredAt:
                event.occurredAt,

            correlationId:
                event.correlationId,

            operationId:
                event.operationId,

            requestId:
                event.requestId,

            causationId:
                event.causationId,

            traceId:
                event.traceId
        };
    }


    /**
     * =========================================================================
     * Event Type Registry
     * =========================================================================
     */
    types() {
        return Object.freeze({
            ...PAYMENT_EVENT_TYPES
        });
    }


    categories() {
        return Object.freeze({
            ...EVENT_CATEGORIES
        });
    }


    aggregates() {
        return Object.freeze({
            ...AGGREGATE_TYPES
        });
    }


    /**
     * =========================================================================
     * Health
     * =========================================================================
     */
    health() {
        return {
            provider:
                PROVIDER,

            module:
                'queue.paymentEvents',

            status:
                'UP',

            schemaVersion:
                this.schemaVersion,

            source:
                this.source,

            eventTypeCount:
                Object.keys(
                    PAYMENT_EVENT_TYPES
                ).length,

            aggregateTypeCount:
                Object.keys(
                    AGGREGATE_TYPES
                ).length,

            transportManagedElsewhere:
                true,

            sensitivePayloadSanitization:
                true
        };
    }
}


/**
 * ============================================================================
 * Factory
 * ============================================================================
 */
function createPaymentEvents(
    options = {}
) {
    return new AirtelPaymentEvents(
        options
    );
}


/**
 * ============================================================================
 * Static Convenience API
 * ============================================================================
 *
 * Useful for existing code that imports this module as a simple event helper.
 */
const defaultEvents =
    new AirtelPaymentEvents();


function createEvent(
    options = {}
) {
    return defaultEvents.create(
        options
    );
}


function validateEvent(
    event
) {
    return defaultEvents.validate(
        event
    );
}


function serializeEvent(
    event
) {
    return defaultEvents.serialize(
        event
    );
}


/**
 * ============================================================================
 * Public API
 * ============================================================================
 */
module.exports =
    AirtelPaymentEvents;

module.exports.AirtelPaymentEvents =
    AirtelPaymentEvents;

module.exports.createPaymentEvents =
    createPaymentEvents;

module.exports.createEvent =
    createEvent;

module.exports.validateEvent =
    validateEvent;

module.exports.serializeEvent =
    serializeEvent;

module.exports.PAYMENT_EVENT_TYPES =
    PAYMENT_EVENT_TYPES;

module.exports.EVENT_CATEGORIES =
    EVENT_CATEGORIES;

module.exports.AGGREGATE_TYPES =
    AGGREGATE_TYPES;

module.exports.EVENT_SCHEMA_VERSION =
    EVENT_SCHEMA_VERSION;

module.exports.EVENT_SOURCE =
    EVENT_SOURCE;

module.exports.PROVIDER =
    PROVIDER;