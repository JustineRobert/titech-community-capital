'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Transaction Events
 * ============================================================================
 *
 * File:
 *   backend/modules/transactions/TransactionEvents.js
 *
 * Purpose
 * -------
 * Canonical transaction-domain event contract for the financial platform.
 *
 * Supports
 * --------
 * • Transaction lifecycle events
 * • Ledger integration events
 * • Payment events
 * • Provider callback events
 * • Settlement events
 * • Recovery events
 * • Compensation events
 * • Audit events
 * • Transactional Outbox Pattern
 * • Event-driven architecture
 * • Distributed processing
 * • Idempotent event publication
 * • Deterministic routing
 *
 * Design Principles
 * -----------------
 * • Immutable event envelopes
 * • Tenant isolation
 * • Correlation propagation
 * • Deterministic event identity
 * • Safe serialization
 * • Safe error normalization
 * • Versioned event contracts
 * • No mutation of caller payloads
 * • No secrets in event payloads
 *
 * ============================================================================
 */

const crypto =
    require('crypto');


/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const EVENT_VERSION =
    '1.0';


const EVENT_SCHEMA_VERSION =
    '1.0';


const DEFAULT_SOURCE =
    'transaction-service';


const DEFAULT_ENVIRONMENT =
    process.env.NODE_ENV ||
    'development';


const MAX_EVENT_TYPE_LENGTH =
    256;


const MAX_ID_LENGTH =
    512;


/**
 * ============================================================================
 * Event Types
 * ============================================================================
 */

const TransactionEventTypes = Object.freeze({

    /**
     * ------------------------------------------------------------------------
     * Transaction lifecycle
     * ------------------------------------------------------------------------
     */

    TRANSACTION_CREATED:
        'transaction.created',

    TRANSACTION_VALIDATED:
        'transaction.validated',

    TRANSACTION_STARTED:
        'transaction.started',

    TRANSACTION_PROCESSING:
        'transaction.processing',

    TRANSACTION_COMPLETED:
        'transaction.completed',

    TRANSACTION_FAILED:
        'transaction.failed',

    TRANSACTION_CANCELLED:
        'transaction.cancelled',

    TRANSACTION_TIMEOUT:
        'transaction.timeout',

    TRANSACTION_RETRYING:
        'transaction.retrying',

    TRANSACTION_RECOVERING:
        'transaction.recovering',

    TRANSACTION_RECOVERED:
        'transaction.recovered',

    TRANSACTION_ROLLBACK_STARTED:
        'transaction.rollback.started',

    TRANSACTION_ROLLED_BACK:
        'transaction.rollback.completed',


    /**
     * ------------------------------------------------------------------------
     * Financial / ledger
     * ------------------------------------------------------------------------
     */

    LEDGER_POSTING_STARTED:
        'ledger.posting.started',

    LEDGER_POSTED:
        'ledger.posted',

    LEDGER_POST_FAILED:
        'ledger.post.failed',

    LEDGER_REVERSAL_CREATED:
        'ledger.reversal.created',

    LEDGER_REVERSAL_COMPLETED:
        'ledger.reversal.completed',

    LEDGER_REVERSAL_FAILED:
        'ledger.reversal.failed',

    BALANCE_UPDATED:
        'balance.updated',


    /**
     * ------------------------------------------------------------------------
     * Payment
     * ------------------------------------------------------------------------
     */

    PAYMENT_INITIATED:
        'payment.initiated',

    PAYMENT_AUTHORIZED:
        'payment.authorized',

    PAYMENT_COMPLETED:
        'payment.completed',

    PAYMENT_FAILED:
        'payment.failed',

    PAYMENT_REVERSED:
        'payment.reversed',

    PAYMENT_TIMEOUT:
        'payment.timeout',


    /**
     * ------------------------------------------------------------------------
     * Provider callbacks
     * ------------------------------------------------------------------------
     */

    PAYMENT_CALLBACK_RECEIVED:
        'payment.callback.received',

    PAYMENT_CALLBACK_PROCESSED:
        'payment.callback.processed',

    PAYMENT_CALLBACK_FAILED:
        'payment.callback.failed',


    /**
     * ------------------------------------------------------------------------
     * Settlement
     * ------------------------------------------------------------------------
     */

    SETTLEMENT_STARTED:
        'settlement.started',

    SETTLEMENT_COMPLETED:
        'settlement.completed',

    SETTLEMENT_FAILED:
        'settlement.failed',

    SETTLEMENT_RECONCILED:
        'settlement.reconciled',


    /**
     * ------------------------------------------------------------------------
     * Recovery / compensation
     * ------------------------------------------------------------------------
     */

    COMPENSATION_STARTED:
        'compensation.started',

    COMPENSATION_COMPLETED:
        'compensation.completed',

    COMPENSATION_FAILED:
        'compensation.failed',

    RECOVERY_CLAIMED:
        'recovery.claimed',

    RECOVERY_COMPLETED:
        'recovery.completed',

    RECOVERY_FAILED:
        'recovery.failed',


    /**
     * ------------------------------------------------------------------------
     * Audit
     * ------------------------------------------------------------------------
     */

    AUDIT_REQUIRED:
        'audit.required',

    SECURITY_EVENT:
        'security.event'

});


/**
 * ============================================================================
 * Event Categories
 * ============================================================================
 */

const EventCategories = Object.freeze({

    TRANSACTION:
        'transaction',

    FINANCIAL:
        'financial',

    PAYMENT:
        'payment',

    SETTLEMENT:
        'settlement',

    RECOVERY:
        'recovery',

    AUDIT:
        'audit',

    SECURITY:
        'security'

});


/**
 * ============================================================================
 * Sensitive Fields
 * ============================================================================
 */

const SENSITIVE_FIELDS = new Set([

    'password',

    'passwd',

    'secret',

    'clientSecret',

    'client_secret',

    'accessToken',

    'access_token',

    'refreshToken',

    'refresh_token',

    'authorization',

    'Authorization',

    'apiKey',

    'api_key',

    'privateKey',

    'private_key',

    'token',

    'credential',

    'credentials',

    'cookie',

    'set-cookie'

]);


/**
 * ============================================================================
 * Safe Clone / Redaction
 * ============================================================================
 */

function sanitizeValue(
    value,
    depth = 0,
    maxDepth = 8
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
        typeof value === 'string'
    ) {

        return value.slice(
            0,
            5000
        );

    }


    if (
        typeof value !== 'object'
    ) {

        return value;

    }


    if (
        Array.isArray(value)
    ) {

        return value.map(
            item =>
                sanitizeValue(
                    item,
                    depth + 1,
                    maxDepth
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

        if (
            SENSITIVE_FIELDS.has(key)
        ) {

            output[key] =
                '[REDACTED]';

        }
        else {

            output[key] =
                sanitizeValue(
                    nestedValue,
                    depth + 1,
                    maxDepth
                );

        }

    }


    return output;

}


/**
 * ============================================================================
 * Deep Freeze
 * ============================================================================
 */

function deepFreeze(
    value,
    seen = new WeakSet()
) {

    if (
        !value ||
        typeof value !== 'object'
    ) {

        return value;

    }


    if (
        seen.has(value)
    ) {

        return value;

    }


    seen.add(value);


    for (
        const key
        of Reflect.ownKeys(value)
    ) {

        deepFreeze(
            value[key],
            seen
        );

    }


    return Object.freeze(
        value
    );

}


/**
 * ============================================================================
 * Transaction Events
 * ============================================================================
 */

class TransactionEvents {

    constructor(
        options = {}
    ) {

        this.serviceName =
            options.serviceName ||
            DEFAULT_SOURCE;


        this.version =
            options.version ||
            EVENT_VERSION;


        this.schemaVersion =
            options.schemaVersion ||
            EVENT_SCHEMA_VERSION;


        this.environment =
            options.environment ||
            DEFAULT_ENVIRONMENT;


        this.includeEnvironmentMetadata =
            options.includeEnvironmentMetadata !== false;


        this.hashAlgorithm =
            options.hashAlgorithm ||
            'sha256';

    }


    /**
     * =========================================================================
     * Create Event
     * =========================================================================
     */

    create(
        type,
        payload = {},
        context = {}
    ) {

        const normalizedType =
            this.normalizeEventType(
                type
            );


        if (
            !normalizedType
        ) {

            throw new TypeError(
                'Event type is required'
            );

        }


        if (
            !Object.values(
                TransactionEventTypes
            ).includes(
                normalizedType
            )
        ) {

            throw new TypeError(

                `Unsupported transaction event type: ${normalizedType}`

            );

        }


        const eventId =
            context.eventId ||
            crypto.randomUUID();


        const occurredAt =
            context.occurredAt
                ? new Date(
                    context.occurredAt
                )
                : new Date();


        const tenantId =
            this.normalizeId(
                context.tenantId
            );


        const transactionId =
            this.normalizeId(
                context.transactionId
            );


        const correlationId =
            this.normalizeId(
                context.correlationId
            );


        const requestId =
            this.normalizeId(
                context.requestId
            );


        const idempotencyKey =
            this.normalizeId(
                context.idempotencyKey
            );


        const aggregate =
            this.normalizeAggregate(
                context.aggregate
            );


        const provider =
            this.normalizeProvider(
                context.provider
            );


        const sanitizedPayload =
            sanitizeValue(
                payload
            );


        const sanitizedMetadata =
            sanitizeValue({

                ...(context.metadata || {}),

                ...(this.includeEnvironmentMetadata
                    ? {
                        environment:
                            this.environment
                    }
                    : {})

            });


        /**
         * Stable event identity.
         *
         * `eventId` is unique event identity.
         * `eventKey` can be used for outbox/event-bus deduplication.
         */
        const eventKey =
            context.eventKey ||
            this.createEventKey({

                tenantId,

                transactionId,

                eventType:
                    normalizedType,

                idempotencyKey,

                correlationId

            });


        const event = {

            eventId,

            eventKey,

            eventType:
                normalizedType,

            eventVersion:
                this.version,

            schemaVersion:
                this.schemaVersion,

            category:
                this.resolveCategory(
                    normalizedType
                ),

            occurredAt,

            publishedAt:
                null,

            source:
                this.serviceName,

            service:
                this.serviceName,

            environment:
                this.environment,

            tenantId,

            organizationId:
                this.normalizeId(
                    context.organizationId
                ),

            userId:
                this.normalizeId(
                    context.userId
                ),

            customerId:
                this.normalizeId(
                    context.customerId
                ),

            transactionId,

            parentTransactionId:
                this.normalizeId(
                    context.parentTransactionId
                ),

            correlationId,

            requestId,

            idempotencyKey,

            provider,

            operation:
                this.normalizeId(
                    context.operation
                ),

            aggregate,

            trace: {

                traceId:
                    this.normalizeId(
                        context.traceId
                    ),

                spanId:
                    this.normalizeId(
                        context.spanId
                    ),

                parentSpanId:
                    this.normalizeId(
                        context.parentSpanId
                    )

            },

            payload:
                sanitizedPayload,

            metadata:
                sanitizedMetadata

        };


        /**
         * Deterministic integrity fingerprint for the event envelope.
         */
        event.fingerprint =
            this.createFingerprint(
                event
            );


        return deepFreeze(
            event
        );

    }


    /**
     * =========================================================================
     * Event Key
     * =========================================================================
     */

    createEventKey({
        tenantId = null,
        transactionId = null,
        eventType,
        idempotencyKey = null,
        correlationId = null
    } = {}) {

        const canonical = [

            tenantId ||
                'global',

            transactionId ||
                'transactionless',

            eventType ||
                'unknown',

            idempotencyKey ||
                correlationId ||
                'none'

        ].join('|');


        return crypto
            .createHash(
                this.hashAlgorithm
            )
            .update(
                canonical,
                'utf8'
            )
            .digest(
                'hex'
            );

    }


    /**
     * =========================================================================
     * Event Fingerprint
     * =========================================================================
     */

    createFingerprint(
        event
    ) {

        const canonical =
            this.canonicalize({

                ...event,

                publishedAt:
                    null,

                fingerprint:
                    undefined

            });


        return crypto
            .createHash(
                this.hashAlgorithm
            )
            .update(
                JSON.stringify(
                    canonical
                ),
                'utf8'
            )
            .digest(
                'hex'
            );

    }


    /**
     * =========================================================================
     * Transaction Created
     * =========================================================================
     */

    transactionCreated(
        transaction,
        context = {}
    ) {

        return this.create(

            TransactionEventTypes.TRANSACTION_CREATED,

            transaction,

            context

        );

    }


    /**
     * =========================================================================
     * Transaction Validated
     * =========================================================================
     */

    transactionValidated(
        transaction,
        context = {}
    ) {

        return this.create(

            TransactionEventTypes.TRANSACTION_VALIDATED,

            transaction,

            context

        );

    }


    /**
     * =========================================================================
     * Transaction Started
     * =========================================================================
     */

    transactionStarted(
        transaction,
        context = {}
    ) {

        return this.create(

            TransactionEventTypes.TRANSACTION_STARTED,

            transaction,

            context

        );

    }


    /**
     * =========================================================================
     * Transaction Processing
     * =========================================================================
     */

    transactionProcessing(
        transaction,
        context = {}
    ) {

        return this.create(

            TransactionEventTypes.TRANSACTION_PROCESSING,

            transaction,

            context

        );

    }


    /**
     * =========================================================================
     * Transaction Completed
     * =========================================================================
     */

    transactionCompleted(
        transaction,
        context = {}
    ) {

        return this.create(

            TransactionEventTypes.TRANSACTION_COMPLETED,

            transaction,

            context

        );

    }


    /**
     * =========================================================================
     * Transaction Failed
     * =========================================================================
     */

    transactionFailed(
        transaction,
        error,
        context = {}
    ) {

        return this.create(

            TransactionEventTypes.TRANSACTION_FAILED,

            {

                transaction:
                    sanitizeValue(
                        transaction
                    ),

                error:
                    this.normalizeError(
                        error
                    )

            },

            context

        );

    }


    /**
     * =========================================================================
     * Transaction Timeout
     * =========================================================================
     */

    transactionTimeout(
        transaction,
        error = null,
        context = {}
    ) {

        return this.create(

            TransactionEventTypes.TRANSACTION_TIMEOUT,

            {

                transaction:
                    sanitizeValue(
                        transaction
                    ),

                error:
                    this.normalizeError(
                        error
                    )

            },

            context

        );

    }


    /**
     * =========================================================================
     * Transaction Retry
     * =========================================================================
     */

    transactionRetrying(
        transaction,
        retry,
        context = {}
    ) {

        return this.create(

            TransactionEventTypes.TRANSACTION_RETRYING,

            {

                transaction:
                    sanitizeValue(
                        transaction
                    ),

                retry:
                    sanitizeValue(
                        retry
                    )

            },

            context

        );

    }


    /**
     * =========================================================================
     * Transaction Recovery
     * =========================================================================
     */

    transactionRecovering(
        data,
        context = {}
    ) {

        return this.create(

            TransactionEventTypes.TRANSACTION_RECOVERING,

            data,

            context

        );

    }


    transactionRecovered(
        data,
        context = {}
    ) {

        return this.create(

            TransactionEventTypes.TRANSACTION_RECOVERED,

            data,

            context

        );

    }


    /**
     * =========================================================================
     * Ledger Posted
     * =========================================================================
     */

    ledgerPosted(
        entry,
        context = {}
    ) {

        return this.create(

            TransactionEventTypes.LEDGER_POSTED,

            entry,

            context

        );

    }


    /**
     * =========================================================================
     * Ledger Reversal
     * =========================================================================
     */

    ledgerReversalCreated(
        reversal,
        context = {}
    ) {

        return this.create(

            TransactionEventTypes.LEDGER_REVERSAL_CREATED,

            reversal,

            context

        );

    }


    /**
     * =========================================================================
     * Payment Initiated
     * =========================================================================
     */

    paymentInitiated(
        payment,
        context = {}
    ) {

        return this.create(

            TransactionEventTypes.PAYMENT_INITIATED,

            payment,

            context

        );

    }


    /**
     * =========================================================================
     * Payment Completed
     * =========================================================================
     */

    paymentCompleted(
        payment,
        context = {}
    ) {

        return this.create(

            TransactionEventTypes.PAYMENT_COMPLETED,

            payment,

            context

        );

    }


    /**
     * =========================================================================
     * Payment Failed
     * =========================================================================
     */

    paymentFailed(
        payment,
        error,
        context = {}
    ) {

        return this.create(

            TransactionEventTypes.PAYMENT_FAILED,

            {

                payment:
                    sanitizeValue(
                        payment
                    ),

                error:
                    this.normalizeError(
                        error
                    )

            },

            context

        );

    }


    /**
     * =========================================================================
     * Callback Events
     * =========================================================================
     */

    paymentCallbackReceived(
        callback,
        context = {}
    ) {

        return this.create(

            TransactionEventTypes.PAYMENT_CALLBACK_RECEIVED,

            callback,

            context

        );

    }


    paymentCallbackProcessed(
        callback,
        context = {}
    ) {

        return this.create(

            TransactionEventTypes.PAYMENT_CALLBACK_PROCESSED,

            callback,

            context

        );

    }


    paymentCallbackFailed(
        callback,
        error,
        context = {}
    ) {

        return this.create(

            TransactionEventTypes.PAYMENT_CALLBACK_FAILED,

            {

                callback:
                    sanitizeValue(
                        callback
                    ),

                error:
                    this.normalizeError(
                        error
                    )

            },

            context

        );

    }


    /**
     * =========================================================================
     * Settlement Events
     * =========================================================================
     */

    settlementStarted(
        settlement,
        context = {}
    ) {

        return this.create(

            TransactionEventTypes.SETTLEMENT_STARTED,

            settlement,

            context

        );

    }


    settlementCompleted(
        settlement,
        context = {}
    ) {

        return this.create(

            TransactionEventTypes.SETTLEMENT_COMPLETED,

            settlement,

            context

        );

    }


    settlementFailed(
        settlement,
        error,
        context = {}
    ) {

        return this.create(

            TransactionEventTypes.SETTLEMENT_FAILED,

            {

                settlement:
                    sanitizeValue(
                        settlement
                    ),

                error:
                    this.normalizeError(
                        error
                    )

            },

            context

        );

    }


    /**
     * =========================================================================
     * Rollback
     * =========================================================================
     */

    rollbackStarted(
        data,
        context = {}
    ) {

        return this.create(

            TransactionEventTypes.TRANSACTION_ROLLBACK_STARTED,

            data,

            context

        );

    }


    rollbackCompleted(
        data,
        context = {}
    ) {

        return this.create(

            TransactionEventTypes.TRANSACTION_ROLLED_BACK,

            data,

            context

        );

    }


    /**
     * =========================================================================
     * Compensation
     * =========================================================================
     */

    compensationStarted(
        data,
        context = {}
    ) {

        return this.create(

            TransactionEventTypes.COMPENSATION_STARTED,

            data,

            context

        );

    }


    compensationCompleted(
        data,
        context = {}
    ) {

        return this.create(

            TransactionEventTypes.COMPENSATION_COMPLETED,

            data,

            context

        );

    }


    compensationFailed(
        data,
        error,
        context = {}
    ) {

        return this.create(

            TransactionEventTypes.COMPENSATION_FAILED,

            {

                compensation:
                    sanitizeValue(
                        data
                    ),

                error:
                    this.normalizeError(
                        error
                    )

            },

            context

        );

    }


    /**
     * =========================================================================
     * Recovery
     * =========================================================================
     */

    recoveryClaimed(
        data,
        context = {}
    ) {

        return this.create(

            TransactionEventTypes.RECOVERY_CLAIMED,

            data,

            context

        );

    }


    recoveryCompleted(
        data,
        context = {}
    ) {

        return this.create(

            TransactionEventTypes.RECOVERY_COMPLETED,

            data,

            context

        );

    }


    recoveryFailed(
        data,
        error,
        context = {}
    ) {

        return this.create(

            TransactionEventTypes.RECOVERY_FAILED,

            {

                recovery:
                    sanitizeValue(
                        data
                    ),

                error:
                    this.normalizeError(
                        error
                    )

            },

            context

        );

    }


    /**
     * =========================================================================
     * Error Normalization
     * =========================================================================
     */

    normalizeError(
        error
    ) {

        if (
            !error
        ) {

            return null;

        }


        return {

            errorId:
                error.errorId ||
                null,

            name:
                error.name ||
                'Error',

            message:
                String(
                    error.message ||
                    'Unknown error'
                )
                    .slice(
                        0,
                        2000
                    ),

            code:
                error.code ||
                null,

            category:
                error.category ||
                null,

            severity:
                error.severity ||
                null,

            statusCode:
                error.statusCode ||
                null,

            retryable:
                error.retryable === true,

            requiresCompensation:
                error.requiresCompensation === true,

            provider:
                error.provider ||
                null,

            providerCode:
                error.providerCode ||
                null

        };

    }


    /**
     * =========================================================================
     * Category Resolver
     * =========================================================================
     */

    resolveCategory(
        type
    ) {

        const normalized =
            String(
                type ||
                ''
            )
                .toLowerCase();


        if (
            normalized.startsWith(
                'ledger.'
            ) ||
            normalized.startsWith(
                'balance.'
            )
        ) {

            return EventCategories.FINANCIAL;

        }


        if (
            normalized.startsWith(
                'payment.'
            )
        ) {

            return EventCategories.PAYMENT;

        }


        if (
            normalized.startsWith(
                'settlement.'
            )
        ) {

            return EventCategories.SETTLEMENT;

        }


        if (
            normalized.startsWith(
                'compensation.'
            ) ||
            normalized.startsWith(
                'recovery.'
            ) ||
            normalized.startsWith(
                'transaction.rollback'
            ) ||
            normalized.startsWith(
                'transaction.recover'
            )
        ) {

            return EventCategories.RECOVERY;

        }


        if (
            normalized.startsWith(
                'audit.'
            )
        ) {

            return EventCategories.AUDIT;

        }


        if (
            normalized.startsWith(
                'security.'
            )
        ) {

            return EventCategories.SECURITY;

        }


        return EventCategories.TRANSACTION;

    }


    /**
     * =========================================================================
     * Event Type Normalization
     * =========================================================================
     */

    normalizeEventType(
        type
    ) {

        if (
            type === null ||
            type === undefined
        ) {

            return '';

        }


        return String(
            type
        )
            .trim()
            .toLowerCase()
            .slice(
                0,
                MAX_EVENT_TYPE_LENGTH
            );

    }


    /**
     * =========================================================================
     * Provider Normalization
     * =========================================================================
     */

    normalizeProvider(
        provider
    ) {

        if (
            provider === null ||
            provider === undefined
        ) {

            return null;

        }


        return String(
            provider
        )
            .trim()
            .toUpperCase()
            .slice(
                0,
                128
            );

    }


    /**
     * =========================================================================
     * ID Normalization
     * =========================================================================
     */

    normalizeId(
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
     * =========================================================================
     * Aggregate Normalization
     * =========================================================================
     */

    normalizeAggregate(
        aggregate
    ) {

        if (
            !aggregate ||
            typeof aggregate !== 'object'
        ) {

            return null;

        }


        return {

            type:
                this.normalizeId(
                    aggregate.type
                ),

            id:
                this.normalizeId(
                    aggregate.id
                ),

            version:
                aggregate.version ??
                null

        };

    }


    /**
     * =========================================================================
     * Canonicalization
     * =========================================================================
     */

    canonicalize(
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
                item =>
                    this.canonicalize(
                        item
                    )
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
                        this.canonicalize(
                            value[key]
                        );

                    return output;

                },

                {}

            );

    }


    /**
     * =========================================================================
     * Validation
     * =========================================================================
     */

    validate(
        event,
        options = {}
    ) {

        if (
            !event ||
            typeof event !== 'object'
        ) {

            return false;

        }


        const errors = [];


        if (
            !event.eventId
        ) {

            errors.push(
                'eventId is required'
            );

        }


        if (
            !event.eventType
        ) {

            errors.push(
                'eventType is required'
            );

        }


        if (
            !event.eventVersion
        ) {

            errors.push(
                'eventVersion is required'
            );

        }


        if (
            !event.category
        ) {

            errors.push(
                'category is required'
            );

        }


        if (
            !event.occurredAt
        ) {

            errors.push(
                'occurredAt is required'
            );

        }


        if (
            !Object.values(
                EventCategories
            ).includes(
                event.category
            )
        ) {

            errors.push(
                'invalid event category'
            );

        }


        if (
            options.requireTenant !== false &&
            !event.tenantId
        ) {

            errors.push(
                'tenantId is required'
            );

        }


        if (
            !event.payload ||
            typeof event.payload !== 'object'
        ) {

            errors.push(
                'payload is required'
            );

        }


        if (
            errors.length > 0
        ) {

            if (
                options.throw === true
            ) {

                const error =
                    new Error(
                        errors.join('; ')
                    );

                error.code =
                    'TRANSACTION_EVENT_INVALID';

                error.validationErrors =
                    errors;

                throw error;

            }


            return false;

        }


        return true;

    }


    /**
     * =========================================================================
     * Serialize Event
     * =========================================================================
     */

    serialize(
        event
    ) {

        this.validate(
            event,
            {
                throw:
                    true
            }
        );


        return JSON.stringify(
            event
        );

    }


    /**
     * =========================================================================
     * Deserialize Event
     * =========================================================================
     */

    deserialize(
        value
    ) {

        if (
            typeof value === 'object'
        ) {

            return value;

        }


        if (
            typeof value !== 'string'
        ) {

            throw new TypeError(
                'Serialized transaction event must be a string or object'
            );

        }


        const event =
            JSON.parse(
                value
            );


        this.validate(
            event,
            {
                throw:
                    true
            }
        );


        return event;

    }


    /**
     * =========================================================================
     * Event Cloning
     * =========================================================================
     */

    clone(
        event
    ) {

        this.validate(
            event,
            {
                throw:
                    true
            }
        );


        return deepFreeze(
            sanitizeValue(
                event
            )
        );

    }


    /**
     * =========================================================================
     * Static Factory
     * =========================================================================
     */

    static create(
        options = {}
    ) {

        return new TransactionEvents(
            options
        );

    }

}


/**
 * ============================================================================
 * Static Public API
 * ============================================================================
 */

TransactionEvents.Types =
    TransactionEventTypes;


TransactionEvents.Categories =
    EventCategories;


/**
 * ============================================================================
 * Export
 * ============================================================================
 */

module.exports =
    TransactionEvents;


module.exports.TransactionEvents =
    TransactionEvents;


module.exports.TransactionEventTypes =
    TransactionEventTypes;


module.exports.EventCategories =
    EventCategories;