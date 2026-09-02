'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Transaction Correlation Utilities
 * ============================================================================
 *
 * File:
 * backend/modules/transactions/utils/TransactionCorrelationUtils.js
 *
 * Version:
 * 3.0.0
 *
 * Purpose
 * -------
 * Centralized correlation utility layer for distributed transaction
 * orchestration.
 *
 * Responsibilities
 * ----------------
 * • Request → Transaction correlation
 * • Transaction → Event correlation
 * • Parent/child correlation propagation
 * • Correlation ID generation
 * • Transaction ID generation
 * • Request ID propagation
 * • Trace ID / Span ID propagation
 * • Tenant context propagation
 * • Correlation context validation
 * • Safe metadata handling
 * • HTTP header extraction
 * • Audit correlation support
 * • Retry/compensation correlation continuity
 * • Immutable correlation contexts
 *
 * Design Principles
 * -----------------
 * • No business logic
 * • No database access
 * • No external service dependencies
 * • Cryptographically secure identifiers
 * • No mutation of caller-owned objects
 * • Fail closed on malformed correlation IDs
 * • Safe propagation across asynchronous boundaries
 * • Suitable for multi-tenant financial systems
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

const TRANSACTION_PREFIX = 'txn';
const REQUEST_PREFIX = 'req';
const TRACE_PREFIX = 'trace';
const SPAN_PREFIX = 'span';

const DEFAULT_ENTROPY_BYTES = 16;

const MAX_CORRELATION_ID_LENGTH = 128;
const MAX_TRANSACTION_ID_LENGTH = 128;
const MAX_REQUEST_ID_LENGTH = 128;
const MAX_TRACE_ID_LENGTH = 128;
const MAX_SPAN_ID_LENGTH = 128;

const MAX_METADATA_KEYS = 50;
const MAX_METADATA_VALUE_LENGTH = 500;

const DEFAULT_SOURCE =
    'transaction-service';

const DEFAULT_COMPONENT =
    'transaction-orchestration';

const CORRELATION_PATTERN =
    /^cor_v\d+_[a-z0-9]+_[a-f0-9]{16,128}$/i;

const TRANSACTION_PATTERN =
    /^txn_[a-z0-9]+_[a-f0-9]{16,128}$/i;

const REQUEST_PATTERN =
    /^req_[a-z0-9]+_[a-f0-9]{16,128}$/i;

const TRACE_PATTERN =
    /^trace_[a-z0-9]+_[a-f0-9]{16,128}$/i;

const SPAN_PATTERN =
    /^span_[a-z0-9]+_[a-f0-9]{16,128}$/i;

/**
 * ============================================================================
 * Error Codes
 * ============================================================================
 */

const ERROR_CODES = Object.freeze({
    INVALID_CORRELATION_ID:
        'INVALID_CORRELATION_ID',

    INVALID_PARENT_CORRELATION_ID:
        'INVALID_PARENT_CORRELATION_ID',

    INVALID_TRANSACTION_ID:
        'INVALID_TRANSACTION_ID',

    INVALID_REQUEST_ID:
        'INVALID_REQUEST_ID',

    INVALID_TRACE_ID:
        'INVALID_TRACE_ID',

    INVALID_SPAN_ID:
        'INVALID_SPAN_ID',

    INVALID_CONTEXT:
        'INVALID_CORRELATION_CONTEXT',

    INVALID_METADATA:
        'INVALID_CORRELATION_METADATA',

    INVALID_ENTROPY:
        'INVALID_CORRELATION_ENTROPY'
});

/**
 * ============================================================================
 * Internal Utility Functions
 * ============================================================================
 */

/**
 * Create standardized correlation error.
 *
 * @param {string} message
 * @param {string} code
 * @returns {Error}
 */
function createCorrelationError(
    message,
    code
) {
    const error = new Error(message);

    error.name =
        'TransactionCorrelationError';

    error.code = code;

    error.timestamp =
        new Date();

    return error;
}

/**
 * ============================================================================
 * Secure Entropy
 * ============================================================================
 *
 * @param {number} bytes
 * @returns {string}
 */
function generateEntropy(
    bytes = DEFAULT_ENTROPY_BYTES
) {
    const normalized =
        Number(bytes);

    if (
        !Number.isInteger(normalized) ||
        normalized < 8 ||
        normalized > 64
    ) {
        throw createCorrelationError(
            'Entropy length must be an integer between 8 and 64 bytes',
            ERROR_CODES.INVALID_ENTROPY
        );
    }

    return crypto
        .randomBytes(normalized)
        .toString('hex');
}

/**
 * ============================================================================
 * Secure UUID
 * ============================================================================
 *
 * @returns {string}
 */
function generateUUID() {
    if (
        typeof crypto.randomUUID ===
        'function'
    ) {
        return crypto.randomUUID();
    }

    const bytes =
        crypto.randomBytes(16);

    /*
     * RFC 4122 UUID v4.
     */
    bytes[6] =
        (bytes[6] & 0x0f) | 0x40;

    bytes[8] =
        (bytes[8] & 0x3f) | 0x80;

    const hex =
        bytes.toString('hex');

    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20, 32)
    ].join('-');
}

/**
 * ============================================================================
 * Timestamp Encoding
 * ============================================================================
 *
 * Base-36 timestamp keeps generated identifiers compact while retaining
 * creation-time information.
 *
 * @param {number|Date} value
 * @returns {string}
 */
function encodeTimestamp(
    value = Date.now()
) {
    const timestamp =
        value instanceof Date
            ? value.getTime()
            : Number(value);

    if (
        !Number.isFinite(timestamp) ||
        timestamp < 0
    ) {
        throw createCorrelationError(
            'Invalid timestamp',
            ERROR_CODES.INVALID_CONTEXT
        );
    }

    return Math
        .floor(timestamp)
        .toString(36)
        .toLowerCase();
}

/**
 * ============================================================================
 * Deep Freeze
 * ============================================================================
 *
 * @param {*} value
 * @returns {*}
 */
function deepFreeze(value) {
    if (
        value === null ||
        typeof value !== 'object' ||
        Object.isFrozen(value)
    ) {
        return value;
    }

    Object.freeze(value);

    for (
        const key of Object.keys(value)
    ) {
        deepFreeze(value[key]);
    }

    return value;
}

/**
 * ============================================================================
 * Safe Identifier Normalization
 * ============================================================================
 *
 * @param {*} value
 * @param {number} maxLength
 * @returns {string|null}
 */
function normalizeIdentifier(
    value,
    maxLength
) {
    if (
        typeof value !== 'string'
    ) {
        return null;
    }

    const normalized =
        value.trim();

    if (
        !normalized ||
        normalized.length > maxLength
    ) {
        return null;
    }

    return normalized;
}

/**
 * ============================================================================
 * Metadata Sanitization
 * ============================================================================
 *
 * Correlation metadata is frequently propagated into logs, events and audit
 * records. Arbitrary objects must therefore not be allowed to leak through.
 *
 * @param {Object} metadata
 * @returns {Object}
 */
function sanitizeMetadata(
    metadata = {}
) {
    if (
        metadata === null ||
        metadata === undefined
    ) {
        return {};
    }

    if (
        typeof metadata !== 'object' ||
        Array.isArray(metadata)
    ) {
        throw createCorrelationError(
            'Correlation metadata must be a plain object',
            ERROR_CODES.INVALID_METADATA
        );
    }

    const keys =
        Object.keys(metadata);

    if (
        keys.length >
        MAX_METADATA_KEYS
    ) {
        throw createCorrelationError(
            `Correlation metadata cannot contain more than ${MAX_METADATA_KEYS} keys`,
            ERROR_CODES.INVALID_METADATA
        );
    }

    const output = {};

    for (
        const key of keys
    ) {
        if (
            typeof key !== 'string' ||
            key.length === 0 ||
            key.length > 100
        ) {
            continue;
        }

        const value =
            metadata[key];

        if (
            value === null ||
            value === undefined
        ) {
            output[key] =
                value;

            continue;
        }

        if (
            typeof value === 'string'
        ) {
            output[key] =
                value.slice(
                    0,
                    MAX_METADATA_VALUE_LENGTH
                );

            continue;
        }

        if (
            typeof value === 'number' ||
            typeof value === 'boolean'
        ) {
            output[key] =
                value;

            continue;
        }

        if (
            Array.isArray(value)
        ) {
            output[key] =
                value
                    .slice(0, 20)
                    .map(
                        sanitizeMetadataValue
                    );

            continue;
        }

        /*
         * Do not serialize arbitrary objects. They may contain:
         *
         * • credentials
         * • tokens
         * • request objects
         * • Mongoose documents
         * • circular references
         * • large payloads
         */
        output[key] =
            '[OBJECT_REDACTED]';
    }

    return output;
}

/**
 * ============================================================================
 * Metadata Value Sanitizer
 * ============================================================================
 */
function sanitizeMetadataValue(
    value
) {
    if (
        value === null ||
        value === undefined
    ) {
        return value;
    }

    if (
        typeof value === 'string'
    ) {
        return value.slice(
            0,
            MAX_METADATA_VALUE_LENGTH
        );
    }

    if (
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        return value;
    }

    return '[OBJECT_REDACTED]';
}

/**
 * ============================================================================
 * Correlation ID
 * ============================================================================
 */

/**
 * Generate a globally unique correlation ID.
 *
 * Format:
 *
 * cor_v1_<timestamp>_<entropy>
 *
 * Example:
 *
 * cor_v1_m7x9k2ab_a84f91e7d9c2b7aa91
 *
 * @param {Object} options
 * @returns {string}
 */
function generateCorrelationId(
    options = {}
) {
    const existing =
        options.existingCorrelationId;

    if (
        existing !== undefined &&
        existing !== null
    ) {
        if (
            !isValidCorrelationId(
                existing
            )
        ) {
            throw createCorrelationError(
                'Existing correlation ID is invalid',
                ERROR_CODES.INVALID_CORRELATION_ID
            );
        }

        return existing.trim();
    }

    return [
        CORRELATION_PREFIX,
        `v${CORRELATION_VERSION}`,
        encodeTimestamp(
            options.timestamp ||
            Date.now()
        ),
        generateEntropy(
            options.entropyBytes ||
            DEFAULT_ENTROPY_BYTES
        )
    ].join('_');
}

/**
 * Validate correlation ID.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isValidCorrelationId(
    value
) {
    if (
        typeof value !== 'string'
    ) {
        return false;
    }

    if (
        value.length === 0 ||
        value.length >
        MAX_CORRELATION_ID_LENGTH
    ) {
        return false;
    }

    return CORRELATION_PATTERN.test(
        value
    );
}

/**
 * ============================================================================
 * Transaction ID
 * ============================================================================
 */

/**
 * Generate transaction identity.
 *
 * @param {Object} options
 * @returns {string}
 */
function generateTransactionId(
    options = {}
) {
    if (
        options.existingTransactionId
    ) {
        if (
            !isValidTransactionId(
                options.existingTransactionId
            )
        ) {
            throw createCorrelationError(
                'Existing transaction ID is invalid',
                ERROR_CODES.INVALID_TRANSACTION_ID
            );
        }

        return options
            .existingTransactionId
            .trim();
    }

    return [
        TRANSACTION_PREFIX,
        encodeTimestamp(
            options.timestamp ||
            Date.now()
        ),
        generateEntropy(
            options.entropyBytes ||
            DEFAULT_ENTROPY_BYTES
        )
    ].join('_');
}

/**
 * Validate transaction ID.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isValidTransactionId(
    value
) {
    if (
        typeof value !== 'string'
    ) {
        return false;
    }

    if (
        value.length === 0 ||
        value.length >
        MAX_TRANSACTION_ID_LENGTH
    ) {
        return false;
    }

    return TRANSACTION_PATTERN.test(
        value
    );
}

/**
 * ============================================================================
 * Request ID
 * ============================================================================
 */

/**
 * Generate request identity.
 *
 * @param {Object} options
 * @returns {string}
 */
function generateRequestId(
    options = {}
) {
    if (
        options.existingRequestId
    ) {
        if (
            !isValidRequestId(
                options.existingRequestId
            )
        ) {
            throw createCorrelationError(
                'Existing request ID is invalid',
                ERROR_CODES.INVALID_REQUEST_ID
            );
        }

        return options
            .existingRequestId
            .trim();
    }

    return [
        REQUEST_PREFIX,
        encodeTimestamp(
            options.timestamp ||
            Date.now()
        ),
        generateEntropy(
            options.entropyBytes ||
            12
        )
    ].join('_');
}

/**
 * Validate request ID.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isValidRequestId(
    value
) {
    if (
        typeof value !== 'string'
    ) {
        return false;
    }

    if (
        value.length === 0 ||
        value.length >
        MAX_REQUEST_ID_LENGTH
    ) {
        return false;
    }

    return REQUEST_PATTERN.test(
        value
    );
}

/**
 * ============================================================================
 * Trace ID
 * ============================================================================
 */

/**
 * Generate trace identity.
 *
 * @param {Object} options
 * @returns {string}
 */
function generateTraceId(
    options = {}
) {
    if (
        options.existingTraceId
    ) {
        if (
            !isValidTraceId(
                options.existingTraceId
            )
        ) {
            throw createCorrelationError(
                'Existing trace ID is invalid',
                ERROR_CODES.INVALID_TRACE_ID
            );
        }

        return options
            .existingTraceId
            .trim();
    }

    return [
        TRACE_PREFIX,
        encodeTimestamp(
            options.timestamp ||
            Date.now()
        ),
        generateEntropy(
            options.entropyBytes ||
            16
        )
    ].join('_');
}

/**
 * Validate trace ID.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isValidTraceId(
    value
) {
    if (
        typeof value !== 'string'
    ) {
        return false;
    }

    return (
        value.length <=
        MAX_TRACE_ID_LENGTH &&
        TRACE_PATTERN.test(value)
    );
}

/**
 * ============================================================================
 * Span ID
 * ============================================================================
 */

/**
 * Generate span identity.
 *
 * @param {Object} options
 * @returns {string}
 */
function generateSpanId(
    options = {}
) {
    if (
        options.existingSpanId
    ) {
        if (
            !isValidSpanId(
                options.existingSpanId
            )
        ) {
            throw createCorrelationError(
                'Existing span ID is invalid',
                ERROR_CODES.INVALID_SPAN_ID
            );
        }

        return options
            .existingSpanId
            .trim();
    }

    return [
        SPAN_PREFIX,
        encodeTimestamp(
            options.timestamp ||
            Date.now()
        ),
        generateEntropy(
            options.entropyBytes ||
            8
        )
    ].join('_');
}

/**
 * Validate span ID.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isValidSpanId(
    value
) {
    if (
        typeof value !== 'string'
    ) {
        return false;
    }

    return (
        value.length <=
        MAX_SPAN_ID_LENGTH &&
        SPAN_PATTERN.test(value)
    );
}

/**
 * ============================================================================
 * Correlation Context Resolution
 * ============================================================================
 *
 * Priority:
 *
 * 1. Explicit correlationId
 * 2. Transaction correlation ID
 * 3. Request correlation ID
 * 4. Generated correlation ID
 *
 * @param {Object} context
 * @returns {Object}
 */
function resolveCorrelationContext(
    context = {}
) {
    if (
        context === null ||
        typeof context !== 'object' ||
        Array.isArray(context)
    ) {
        throw createCorrelationError(
            'Correlation context must be an object',
            ERROR_CODES.INVALID_CONTEXT
        );
    }

    const correlationCandidates = [
        context.correlationId,
        context.transactionCorrelationId,
        context.requestCorrelationId
    ];

    let correlationId =
        null;

    for (
        const candidate of
        correlationCandidates
    ) {
        if (
            candidate &&
            isValidCorrelationId(
                candidate
            )
        ) {
            correlationId =
                candidate.trim();

            break;
        }
    }

    if (
        !correlationId
    ) {
        correlationId =
            generateCorrelationId();
    }

    const parentCorrelationId =
        context.parentCorrelationId ||
        null;

    if (
        parentCorrelationId &&
        !isValidCorrelationId(
            parentCorrelationId
        )
    ) {
        throw createCorrelationError(
            'Invalid parent correlation ID',
            ERROR_CODES.INVALID_PARENT_CORRELATION_ID
        );
    }

    const transactionId =
        context.transactionId &&
        isValidTransactionId(
            context.transactionId
        )
            ? context.transactionId
            : null;

    const requestId =
        context.requestId &&
        isValidRequestId(
            context.requestId
        )
            ? context.requestId
            : null;

    const traceId =
        context.traceId &&
        isValidTraceId(
            context.traceId
        )
            ? context.traceId
            : null;

    const spanId =
        context.spanId &&
        isValidSpanId(
            context.spanId
        )
            ? context.spanId
            : null;

    return deepFreeze({
        correlationId,

        parentCorrelationId,

        requestId,

        transactionId,

        traceId,

        spanId,

        tenantId:
            normalizeIdentifier(
                context.tenantId,
                200
            ),

        source:
            normalizeIdentifier(
                context.source,
                200
            ) ||
            DEFAULT_SOURCE,

        component:
            normalizeIdentifier(
                context.component,
                200
            ) ||
            DEFAULT_COMPONENT
    });
}

/**
 * ============================================================================
 * Create Child Correlation Context
 * ============================================================================
 *
 * Creates a new child correlation identity while preserving the parent.
 *
 * @param {string|Object} parent
 * @param {Object} metadata
 * @returns {Object}
 */
function createChildCorrelation(
    parent,
    metadata = {}
) {
    const parentContext =
        typeof parent === 'string'
            ? resolveCorrelationContext({
                correlationId:
                    parent
            })
            : resolveCorrelationContext(
                parent || {}
            );

    const childCorrelationId =
        generateCorrelationId();

    return deepFreeze({
        correlationId:
            childCorrelationId,

        parentCorrelationId:
            parentContext.correlationId,

        requestId:
            parentContext.requestId,

        transactionId:
            parentContext.transactionId,

        tenantId:
            parentContext.tenantId,

        traceId:
            parentContext.traceId,

        spanId:
            parentContext.spanId,

        source:
            parentContext.source,

        component:
            parentContext.component,

        metadata:
            sanitizeMetadata(
                metadata
            ),

        createdAt:
            new Date()
    });
}

/**
 * ============================================================================
 * Build Event Correlation Metadata
 * ============================================================================
 *
 * Designed for transaction event payloads and outbox records.
 *
 * @param {Object} context
 * @returns {Object}
 */
function buildCorrelationMetadata(
    context = {}
) {
    const resolved =
        resolveCorrelationContext(
            context
        );

    return deepFreeze({
        correlationId:
            resolved.correlationId,

        parentCorrelationId:
            resolved.parentCorrelationId,

        requestId:
            resolved.requestId,

        transactionId:
            resolved.transactionId,

        tenantId:
            resolved.tenantId,

        traceId:
            resolved.traceId,

        spanId:
            resolved.spanId,

        source:
            resolved.source,

        component:
            resolved.component
    });
}

/**
 * ============================================================================
 * Build Transaction Correlation Context
 * ============================================================================
 *
 * @param {Object} context
 * @returns {Object}
 */
function buildTransactionCorrelationContext(
    context = {}
) {
    const resolved =
        resolveCorrelationContext(
            context
        );

    return deepFreeze({
        correlationId:
            resolved.correlationId,

        parentCorrelationId:
            resolved.parentCorrelationId,

        requestId:
            resolved.requestId,

        transactionId:
            resolved.transactionId,

        tenantId:
            resolved.tenantId,

        traceId:
            resolved.traceId,

        spanId:
            resolved.spanId,

        source:
            resolved.source,

        component:
            resolved.component,

        createdAt:
            new Date()
    });
}

/**
 * ============================================================================
 * Build Audit Correlation Context
 * ============================================================================
 *
 * Provides the correlation fields required to reconstruct a transaction
 * lifecycle from audit records.
 *
 * @param {Object} context
 * @returns {Object}
 */
function buildAuditCorrelationContext(
    context = {}
) {
    const resolved =
        resolveCorrelationContext(
            context
        );

    return deepFreeze({
        correlationId:
            resolved.correlationId,

        parentCorrelationId:
            resolved.parentCorrelationId,

        requestId:
            resolved.requestId,

        transactionId:
            resolved.transactionId,

        tenantId:
            resolved.tenantId,

        traceId:
            resolved.traceId,

        spanId:
            resolved.spanId,

        source:
            resolved.source,

        component:
            resolved.component,

        timestamp:
            new Date()
    });
}

/**
 * ============================================================================
 * Propagate Correlation Context
 * ============================================================================
 *
 * Used when creating:
 *
 * • retry operations
 * • compensation operations
 * • child events
 * • downstream service calls
 * • worker jobs
 *
 * @param {Object} context
 * @param {Object} metadata
 * @returns {Object}
 */
function propagateCorrelationContext(
    context = {},
    metadata = {}
) {
    const parent =
        resolveCorrelationContext(
            context
        );

    const child =
        createChildCorrelation(
            parent,
            metadata
        );

    return deepFreeze({
        correlationId:
            child.correlationId,

        parentCorrelationId:
            child.parentCorrelationId,

        requestId:
            child.requestId,

        transactionId:
            child.transactionId,

        tenantId:
            child.tenantId,

        traceId:
            child.traceId,

        spanId:
            child.spanId,

        source:
            child.source,

        component:
            child.component,

        metadata:
            child.metadata,

        createdAt:
            child.createdAt
    });
}

/**
 * ============================================================================
 * Resolve Or Create Transaction Context
 * ============================================================================
 *
 * Useful to the TransactionEventCoordinator and SagaOrchestrator.
 *
 * @param {Object} options
 * @returns {Object}
 */
function createTransactionContext(
    options = {}
) {
    const correlationId =
        options.correlationId &&
        isValidCorrelationId(
            options.correlationId
        )
            ? options.correlationId
            : generateCorrelationId();

    const transactionId =
        options.transactionId &&
        isValidTransactionId(
            options.transactionId
        )
            ? options.transactionId
            : generateTransactionId();

    const requestId =
        options.requestId &&
        isValidRequestId(
            options.requestId
        )
            ? options.requestId
            : generateRequestId();

    const traceId =
        options.traceId &&
        isValidTraceId(
            options.traceId
        )
            ? options.traceId
            : generateTraceId();

    const spanId =
        options.spanId &&
        isValidSpanId(
            options.spanId
        )
            ? options.spanId
            : generateSpanId();

    return deepFreeze({
        correlationId,

        parentCorrelationId:
            options.parentCorrelationId ||
            null,

        transactionId,

        requestId,

        traceId,

        spanId,

        tenantId:
            normalizeIdentifier(
                options.tenantId,
                200
            ),

        source:
            normalizeIdentifier(
                options.source,
                200
            ) ||
            DEFAULT_SOURCE,

        component:
            normalizeIdentifier(
                options.component,
                200
            ) ||
            DEFAULT_COMPONENT,

        metadata:
            sanitizeMetadata(
                options.metadata || {}
            ),

        createdAt:
            new Date()
    });
}

/**
 * ============================================================================
 * Extract Correlation Headers
 * ============================================================================
 *
 * Supports common HTTP header naming conventions.
 *
 * @param {Object} headers
 * @returns {Object}
 */
function extractCorrelationHeaders(
    headers = {}
) {
    if (
        !headers ||
        typeof headers !== 'object'
    ) {
        return deepFreeze({
            correlationId: null,
            requestId: null,
            traceId: null,
            spanId: null
        });
    }

    const correlationId =
        getHeaderValue(
            headers,
            [
                'x-correlation-id',
                'x-correlationid',
                'correlation-id'
            ]
        );

    const requestId =
        getHeaderValue(
            headers,
            [
                'x-request-id',
                'request-id'
            ]
        );

    const traceId =
        getHeaderValue(
            headers,
            [
                'x-trace-id',
                'trace-id'
            ]
        );

    const spanId =
        getHeaderValue(
            headers,
            [
                'x-span-id',
                'span-id'
            ]
        );

    return deepFreeze({
        correlationId:
            isValidCorrelationId(
                correlationId
            )
                ? correlationId
                : null,

        requestId:
            isValidRequestId(
                requestId
            )
                ? requestId
                : null,

        traceId:
            isValidTraceId(
                traceId
            )
                ? traceId
                : null,

        spanId:
            isValidSpanId(
                spanId
            )
                ? spanId
                : null
    });
}

/**
 * ============================================================================
 * Header Value Resolver
 * ============================================================================
 */
function getHeaderValue(
    headers,
    names
) {
    for (
        const name of names
    ) {
        const key =
            Object.keys(headers)
                .find(
                    candidate =>
                        candidate.toLowerCase() ===
                        name.toLowerCase()
                );

        if (
            !key
        ) {
            continue;
        }

        const value =
            headers[key];

        if (
            Array.isArray(value)
        ) {
            return value[0] || null;
        }

        if (
            typeof value === 'string'
        ) {
            return value.trim() || null;
        }
    }

    return null;
}

/**
 * ============================================================================
 * Build HTTP Correlation Headers
 * ============================================================================
 *
 * Useful when propagating context to another service.
 *
 * @param {Object} context
 * @returns {Object}
 */
function buildCorrelationHeaders(
    context = {}
) {
    const resolved =
        resolveCorrelationContext(
            context
        );

    const headers = {
        'x-correlation-id':
            resolved.correlationId
    };

    if (
        resolved.requestId
    ) {
        headers['x-request-id'] =
            resolved.requestId;
    }

    if (
        resolved.transactionId
    ) {
        headers['x-transaction-id'] =
            resolved.transactionId;
    }

    if (
        resolved.traceId
    ) {
        headers['x-trace-id'] =
            resolved.traceId;
    }

    if (
        resolved.spanId
    ) {
        headers['x-span-id'] =
            resolved.spanId;
    }

    if (
        resolved.tenantId
    ) {
        headers['x-tenant-id'] =
            resolved.tenantId;
    }

    return Object.freeze(
        headers
    );
}

/**
 * ============================================================================
 * Merge Correlation Context
 * ============================================================================
 *
 * Does not mutate either input.
 *
 * @param {Object} base
 * @param {Object} override
 * @returns {Object}
 */
function mergeCorrelationContext(
    base = {},
    override = {}
) {
    const baseContext =
        resolveCorrelationContext(
            base
        );

    const incoming =
        override &&
        typeof override === 'object'
            ? override
            : {};

    return resolveCorrelationContext({
        ...baseContext,
        ...incoming,

        correlationId:
            incoming.correlationId ||
            baseContext.correlationId,

        transactionId:
            incoming.transactionId ||
            baseContext.transactionId,

        requestId:
            incoming.requestId ||
            baseContext.requestId,

        traceId:
            incoming.traceId ||
            baseContext.traceId,

        spanId:
            incoming.spanId ||
            baseContext.spanId,

        tenantId:
            incoming.tenantId ||
            baseContext.tenantId
    });
}

/**
 * ============================================================================
 * Serialize Correlation Context
 * ============================================================================
 *
 * Produces a safe plain object suitable for:
 *
 * • structured logs
 * • audit events
 * • transaction events
 * • metrics labels
 * • outbox metadata
 *
 * @param {Object} context
 * @returns {Object}
 */
function serializeCorrelationContext(
    context = {}
) {
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

        tenantId:
            resolved.tenantId,

        traceId:
            resolved.traceId,

        spanId:
            resolved.spanId,

        source:
            resolved.source,

        component:
            resolved.component
    };
}

/**
 * ============================================================================
 * Correlation Equality
 * ============================================================================
 */
function sameCorrelation(
    left,
    right
) {
    if (
        !left ||
        !right
    ) {
        return false;
    }

    return (
        left.correlationId ===
        right.correlationId
    );
}

/**
 * ============================================================================
 * Extract Timestamp
 * ============================================================================
 *
 * Correlation IDs encode creation time in the third component.
 *
 * @param {string} correlationId
 * @returns {number|null}
 */
function extractCorrelationTimestamp(
    correlationId
) {
    if (
        !isValidCorrelationId(
            correlationId
        )
    ) {
        return null;
    }

    const parts =
        correlationId.split('_');

    if (
        parts.length !== 4
    ) {
        return null;
    }

    const timestamp =
        parseInt(
            parts[2],
            36
        );

    return Number.isFinite(timestamp)
        ? timestamp
        : null;
}

/**
 * ============================================================================
 * Context Validation
 * ============================================================================
 *
 * @param {Object} context
 * @param {Object} options
 * @returns {true}
 */
function validateCorrelationContext(
    context,
    options = {}
) {
    if (
        !context ||
        typeof context !== 'object'
    ) {
        throw createCorrelationError(
            'Correlation context is required',
            ERROR_CODES.INVALID_CONTEXT
        );
    }

    if (
        options.requireCorrelation !== false &&
        !isValidCorrelationId(
            context.correlationId
        )
    ) {
        throw createCorrelationError(
            'Valid correlationId is required',
            ERROR_CODES.INVALID_CORRELATION_ID
        );
    }

    if (
        options.requireTransaction &&
        !isValidTransactionId(
            context.transactionId
        )
    ) {
        throw createCorrelationError(
            'Valid transactionId is required',
            ERROR_CODES.INVALID_TRANSACTION_ID
        );
    }

    if (
        options.requireRequest &&
        !isValidRequestId(
            context.requestId
        )
    ) {
        throw createCorrelationError(
            'Valid requestId is required',
            ERROR_CODES.INVALID_REQUEST_ID
        );
    }

    if (
        context.parentCorrelationId &&
        !isValidCorrelationId(
            context.parentCorrelationId
        )
    ) {
        throw createCorrelationError(
            'Invalid parentCorrelationId',
            ERROR_CODES.INVALID_PARENT_CORRELATION_ID
        );
    }

    if (
        context.traceId &&
        !isValidTraceId(
            context.traceId
        )
    ) {
        throw createCorrelationError(
            'Invalid traceId',
            ERROR_CODES.INVALID_TRACE_ID
        );
    }

    if (
        context.spanId &&
        !isValidSpanId(
            context.spanId
        )
    ) {
        throw createCorrelationError(
            'Invalid spanId',
            ERROR_CODES.INVALID_SPAN_ID
        );
    }

    return true;
}

/**
 * ============================================================================
 * Constants Export
 * ============================================================================
 */

const TransactionCorrelationConstants =
    Object.freeze({
        CORRELATION_PREFIX,

        CORRELATION_VERSION,

        TRANSACTION_PREFIX,

        REQUEST_PREFIX,

        TRACE_PREFIX,

        SPAN_PREFIX,

        MAX_CORRELATION_ID_LENGTH,

        MAX_TRANSACTION_ID_LENGTH,

        MAX_REQUEST_ID_LENGTH,

        MAX_TRACE_ID_LENGTH,

        MAX_SPAN_ID_LENGTH,

        MAX_METADATA_KEYS,

        MAX_METADATA_VALUE_LENGTH,

        DEFAULT_SOURCE,

        DEFAULT_COMPONENT,

        ERROR_CODES
    });

/**
 * ============================================================================
 * Module Exports
 * ============================================================================
 */

module.exports = {
    TransactionCorrelationConstants,

    generateCorrelationId,

    generateTransactionId,

    generateRequestId,

    generateTraceId,

    generateSpanId,

    generateUUID,

    encodeTimestamp,

    createChildCorrelation,

    createTransactionContext,

    resolveCorrelationContext,

    buildCorrelationMetadata,

    buildTransactionCorrelationContext,

    buildAuditCorrelationContext,

    propagateCorrelationContext,

    extractCorrelationHeaders,

    buildCorrelationHeaders,

    mergeCorrelationContext,

    serializeCorrelationContext,

    extractCorrelationTimestamp,

    validateCorrelationContext,

    sameCorrelation,

    isValidCorrelationId,

    isValidTransactionId,

    isValidRequestId,

    isValidTraceId,

    isValidSpanId,

    sanitizeMetadata
};