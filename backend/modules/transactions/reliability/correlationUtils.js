'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Transaction Correlation Utilities
 * ============================================================================
 *
 * File:
 * backend/modules/transactions/reliability/correlationUtils.js
 *
 * Purpose
 * -------
 * Provides enterprise-grade correlation and distributed transaction context
 * utilities used across:
 *
 * • API requests
 * • Transactions
 * • Sagas
 * • Transaction events
 * • Outbox records
 * • Payment workflows
 * • Audit records
 * • Retry workflows
 * • Compensation workflows
 * • Background workers
 *
 * Design Goals
 * ------------
 * • Globally unique correlation identifiers
 * • Cryptographically secure entropy
 * • Request → Transaction → Event continuity
 * • Parent/child correlation propagation
 * • Strict validation
 * • Safe handling of untrusted input
 * • Immutable returned contexts
 * • Distributed-system friendly identifiers
 * • Audit reconstruction support
 * • Trace-context compatibility
 * • No mutation of caller-owned objects
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

const DEFAULT_ENTROPY_BYTES = 16;

const MAX_CORRELATION_ID_LENGTH = 128;
const MAX_METADATA_KEYS = 50;
const MAX_METADATA_VALUE_LENGTH = 500;

const CORRELATION_PATTERN =
    /^cor_v\d+_[a-z0-9]+_[a-f0-9]+$/i;

const DEFAULT_SOURCE = 'transaction-service';

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

    INVALID_CORRELATION_CONTEXT:
        'INVALID_CORRELATION_CONTEXT',

    INVALID_METADATA:
        'INVALID_CORRELATION_METADATA'
});

/**
 * ============================================================================
 * Internal Helpers
 * ============================================================================
 */

/**
 * Generate a cryptographically secure entropy component.
 *
 * @param {number} bytes
 * @returns {string}
 */
function generateEntropy(bytes = DEFAULT_ENTROPY_BYTES) {
    const normalizedBytes = Number(bytes);

    if (
        !Number.isInteger(normalizedBytes) ||
        normalizedBytes < 8 ||
        normalizedBytes > 64
    ) {
        throw createCorrelationError(
            'Invalid entropy byte length',
            ERROR_CODES.INVALID_CORRELATION_CONTEXT
        );
    }

    return crypto
        .randomBytes(normalizedBytes)
        .toString('hex');
}

/**
 * Generate compact timestamp component.
 *
 * Base-36 keeps identifiers relatively compact while preserving
 * chronological creation information.
 *
 * @param {number|Date} value
 * @returns {string}
 */
function correlationTimestamp(value = Date.now()) {
    let timestamp;

    if (value instanceof Date) {
        timestamp = value.getTime();
    } else {
        timestamp = Number(value);
    }

    if (
        !Number.isFinite(timestamp) ||
        timestamp < 0
    ) {
        throw createCorrelationError(
            'Invalid correlation timestamp',
            ERROR_CODES.INVALID_CORRELATION_CONTEXT
        );
    }

    return Math.floor(timestamp)
        .toString(36)
        .toLowerCase();
}

/**
 * Freeze an object recursively.
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

    for (const key of Object.keys(value)) {
        deepFreeze(value[key]);
    }

    return value;
}

/**
 * Defensive metadata clone.
 *
 * @param {Object} metadata
 * @returns {Object}
 */
function cloneMetadata(metadata = {}) {
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

    const keys = Object.keys(metadata);

    if (keys.length > MAX_METADATA_KEYS) {
        throw createCorrelationError(
            `Correlation metadata cannot contain more than ${MAX_METADATA_KEYS} keys`,
            ERROR_CODES.INVALID_METADATA
        );
    }

    const output = {};

    for (const key of keys) {
        if (
            typeof key !== 'string' ||
            key.length === 0 ||
            key.length > 100
        ) {
            continue;
        }

        const value = metadata[key];

        if (
            value === null ||
            value === undefined
        ) {
            output[key] = value;
            continue;
        }

        if (
            typeof value === 'string'
        ) {
            output[key] =
                value.length > MAX_METADATA_VALUE_LENGTH
                    ? value.substring(
                        0,
                        MAX_METADATA_VALUE_LENGTH
                    )
                    : value;

            continue;
        }

        if (
            typeof value === 'number' ||
            typeof value === 'boolean'
        ) {
            output[key] = value;
            continue;
        }

        /**
         * Avoid carrying arbitrary objects, functions, buffers,
         * request objects, model instances, or secrets into correlation
         * metadata.
         */
        if (
            Array.isArray(value)
        ) {
            output[key] = value
                .slice(0, 20)
                .map(item =>
                    sanitizeMetadataValue(item)
                );

            continue;
        }

        if (
            typeof value === 'object'
        ) {
            output[key] =
                '[OBJECT_REDACTED]';

            continue;
        }

        output[key] =
            String(value)
                .substring(
                    0,
                    MAX_METADATA_VALUE_LENGTH
                );
    }

    return output;
}

/**
 * Sanitize nested metadata values.
 *
 * @param {*} value
 * @returns {*}
 */
function sanitizeMetadataValue(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return value;
    }

    if (
        typeof value === 'string'
    ) {
        return value.substring(
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

    error.code = code;
    error.name = 'CorrelationError';
    error.timestamp = new Date();

    return error;
}

/**
 * ============================================================================
 * Generate Secure UUID
 * ============================================================================
 *
 * Uses Node.js crypto.randomUUID() when available.
 *
 * Includes a secure RFC-compatible fallback for older Node.js runtimes.
 *
 * @returns {string}
 */
function generateUUID() {
    if (
        typeof crypto.randomUUID === 'function'
    ) {
        return crypto.randomUUID();
    }

    const bytes =
        crypto.randomBytes(16);

    /**
     * RFC 4122 version 4.
     */
    bytes[6] =
        (bytes[6] & 0x0f) | 0x40;

    bytes[8] =
        (bytes[8] & 0x3f) | 0x80;

    const hex =
        bytes.toString('hex');

    return [
        hex.substring(0, 8),
        hex.substring(8, 12),
        hex.substring(12, 16),
        hex.substring(16, 20),
        hex.substring(20, 32)
    ].join('-');
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
 * Example:
 *
 * cor_v1_lq8j4k9z_a84f91e7d9c2b7aa91
 *
 * Properties:
 *
 * • Globally unique
 * • Trace friendly
 * • Searchable
 * • Time identifiable
 * • Cryptographically random
 * • Safe for distributed workers
 *
 * @param {Object} options
 * @returns {string}
 */
function generateCorrelationId(options = {}) {
    /**
     * Preserve an explicitly supplied valid correlation ID.
     */
    if (
        options.existingCorrelationId
    ) {
        const existing =
            normalizeCorrelationId(
                options.existingCorrelationId
            );

        if (
            existing
        ) {
            return existing;
        }
    }

    const timestamp =
        correlationTimestamp(
            options.timestamp || Date.now()
        );

    const entropy =
        generateEntropy(
            options.entropyBytes ||
            DEFAULT_ENTROPY_BYTES
        );

    const correlationId = [
        CORRELATION_PREFIX,
        `v${CORRELATION_VERSION}`,
        timestamp,
        entropy
    ].join('_');

    if (
        correlationId.length >
        MAX_CORRELATION_ID_LENGTH
    ) {
        throw createCorrelationError(
            'Generated correlation ID exceeds maximum length',
            ERROR_CODES.INVALID_CORRELATION_ID
        );
    }

    return correlationId;
}

/**
 * ============================================================================
 * Normalize Correlation ID
 * ============================================================================
 *
 * @param {*} value
 * @returns {string|null}
 */
function normalizeCorrelationId(value) {
    if (
        typeof value !== 'string'
    ) {
        return null;
    }

    const normalized =
        value.trim();

    if (
        !normalized ||
        normalized.length >
        MAX_CORRELATION_ID_LENGTH
    ) {
        return null;
    }

    return normalized;
}

/**
 * ============================================================================
 * Validate Correlation ID
 * ============================================================================
 *
 * @param {*} value
 * @returns {boolean}
 */
function isValidCorrelationId(value) {
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
 * Assert Correlation ID
 * ============================================================================
 *
 * @param {string} correlationId
 * @returns {true}
 */
function assertValidCorrelationId(
    correlationId
) {
    if (
        !isValidCorrelationId(
            correlationId
        )
    ) {
        throw createCorrelationError(
            'Invalid correlation ID',
            ERROR_CODES.INVALID_CORRELATION_ID
        );
    }

    return true;
}

/**
 * ============================================================================
 * Create Child Correlation
 * ============================================================================
 *
 * Creates a new correlation identity while preserving the parent.
 *
 * Parent:
 *
 *     API Request
 *
 *          |
 *          v
 *
 * Child:
 *
 *     Transaction
 *
 *          |
 *          v
 *
 * Grandchild:
 *
 *     Event
 *
 * @param {string|null} parentCorrelationId
 * @param {Object} metadata
 * @returns {Object}
 */
function createChildCorrelation(
    parentCorrelationId,
    metadata = {}
) {
    const normalizedParent =
        parentCorrelationId
            ? normalizeCorrelationId(
                parentCorrelationId
            )
            : null;

    if (
        normalizedParent &&
        !isValidCorrelationId(
            normalizedParent
        )
    ) {
        throw createCorrelationError(
            'Invalid parent correlation ID',
            ERROR_CODES.INVALID_PARENT_CORRELATION_ID
        );
    }

    const correlationId =
        generateCorrelationId();

    const safeMetadata =
        cloneMetadata(metadata);

    return deepFreeze({
        correlationId,

        parentCorrelationId:
            normalizedParent,

        metadata:
            safeMetadata,

        createdAt:
            new Date()
    });
}

/**
 * ============================================================================
 * Resolve Correlation Context
 * ============================================================================
 *
 * Priority:
 *
 * 1. Existing correlation
 * 2. Transaction correlation
 * 3. Request correlation
 * 4. Parent correlation
 * 5. Generate new correlation
 *
 * @param {Object} context
 * @returns {Object}
 */
function resolveCorrelationContext(
    context = {}
) {
    if (
        context === null ||
        typeof context !== 'object'
    ) {
        throw createCorrelationError(
            'Correlation context must be an object',
            ERROR_CODES.INVALID_CORRELATION_CONTEXT
        );
    }

    const candidates = [
        context.correlationId,
        context.transactionCorrelationId,
        context.requestCorrelationId
    ];

    let correlationId = null;

    for (
        const candidate of candidates
    ) {
        if (
            isValidCorrelationId(
                candidate
            )
        ) {
            correlationId =
                candidate;

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
        context.parentCorrelationId || null;

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

    return deepFreeze({
        correlationId,

        parentCorrelationId,

        requestId:
            normalizeContextIdentifier(
                context.requestId
            ),

        transactionId:
            normalizeContextIdentifier(
                context.transactionId
            ),

        traceId:
            normalizeContextIdentifier(
                context.traceId
            ),

        spanId:
            normalizeContextIdentifier(
                context.spanId
            ),

        tenantId:
            normalizeContextIdentifier(
                context.tenantId
            ),

        source:
            normalizeContextIdentifier(
                context.source
            ) ||
            DEFAULT_SOURCE
    });
}

/**
 * ============================================================================
 * Normalize Context Identifier
 * ============================================================================
 *
 * Used for IDs that are not necessarily correlation IDs.
 *
 * @param {*} value
 * @returns {string|null}
 */
function normalizeContextIdentifier(
    value
) {
    if (
        value === null ||
        value === undefined
    ) {
        return null;
    }

    if (
        typeof value !== 'string'
    ) {
        return null;
    }

    const normalized =
        value.trim();

    if (
        !normalized
    ) {
        return null;
    }

    return normalized.substring(
        0,
        200
    );
}

/**
 * ============================================================================
 * Build Event Correlation Metadata
 * ============================================================================
 *
 * Designed for TransactionEvents.create().
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

        traceId:
            resolved.traceId,

        spanId:
            resolved.spanId,

        tenantId:
            resolved.tenantId,

        source:
            resolved.source
    });
}

/**
 * ============================================================================
 * Build Transaction Correlation Context
 * ============================================================================
 *
 * Convenience helper for transaction orchestration.
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

        createdAt:
            new Date()
    });
}

/**
 * ============================================================================
 * Build Audit Correlation Context
 * ============================================================================
 *
 * Provides the minimum correlation information required to reconstruct
 * transaction activity from audit records.
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

        source:
            resolved.source,

        timestamp:
            new Date()
    });
}

/**
 * ============================================================================
 * Propagate Correlation Context
 * ============================================================================
 *
 * Creates a child context suitable for:
 *
 * • events
 * • retries
 * • compensation
 * • background jobs
 * • downstream service calls
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
            parent.correlationId,
            metadata
        );

    return deepFreeze({
        correlationId:
            child.correlationId,

        parentCorrelationId:
            parent.correlationId ||
            parent.correlationId,

        requestId:
            parent.requestId,

        transactionId:
            parent.transactionId,

        tenantId:
            parent.tenantId,

        traceId:
            parent.traceId,

        spanId:
            parent.spanId,

        source:
            parent.source,

        metadata:
            child.metadata,

        createdAt:
            child.createdAt
    });
}

/**
 * ============================================================================
 * Extract Correlation Headers
 * ============================================================================
 *
 * Supports common HTTP header conventions.
 *
 * @param {Object} headers
 * @returns {Object}
 */
function extractCorrelationFromHeaders(
    headers = {}
) {
    if (
        !headers ||
        typeof headers !== 'object'
    ) {
        return deepFreeze({
            correlationId: null,
            requestId: null,
            traceId: null
        });
    }

    const correlationId =
        firstHeaderValue(
            headers,
            [
                'x-correlation-id',
                'x-correlationid',
                'correlation-id'
            ]
        );

    const requestId =
        firstHeaderValue(
            headers,
            [
                'x-request-id',
                'request-id'
            ]
        );

    const traceId =
        firstHeaderValue(
            headers,
            [
                'x-trace-id',
                'trace-id'
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
            normalizeContextIdentifier(
                requestId
            ),

        traceId:
            normalizeContextIdentifier(
                traceId
            )
    });
}

/**
 * ============================================================================
 * Header Value Resolver
 * ============================================================================
 *
 * @param {Object} headers
 * @param {string[]} names
 * @returns {string|null}
 */
function firstHeaderValue(
    headers,
    names
) {
    for (
        const name of names
    ) {
        const lowerName =
            name.toLowerCase();

        const key =
            Object.keys(headers)
                .find(
                    candidate =>
                        candidate.toLowerCase() ===
                        lowerName
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
 * Merge Correlation Context
 * ============================================================================
 *
 * Explicit values from `override` take precedence.
 * Does not mutate either source.
 *
 * @param {Object} base
 * @param {Object} override
 * @returns {Object}
 */
function mergeCorrelationContext(
    base = {},
    override = {}
) {
    const resolvedBase =
        resolveCorrelationContext(
            base
        );

    const resolvedOverride =
        override &&
        typeof override === 'object'
            ? override
            : {};

    return resolveCorrelationContext({
        ...resolvedBase,
        ...resolvedOverride,

        correlationId:
            resolvedOverride.correlationId ||
            resolvedBase.correlationId,

        transactionCorrelationId:
            resolvedOverride.transactionCorrelationId ||
            resolvedBase.correlationId,

        requestCorrelationId:
            resolvedOverride.requestCorrelationId ||
            resolvedBase.correlationId
    });
}

/**
 * ============================================================================
 * Correlation Context Serialization
 * ============================================================================
 *
 * Produces a safe JSON representation suitable for logs/events.
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
            resolved.source
    };
}

/**
 * ============================================================================
 * Correlation Context Equality
 * ============================================================================
 *
 * @param {Object} left
 * @param {Object} right
 * @returns {boolean}
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
 * Exported Constants
 * ============================================================================
 */

const CorrelationConstants =
    Object.freeze({
        CORRELATION_PREFIX,

        CORRELATION_VERSION,

        MAX_CORRELATION_ID_LENGTH,

        MAX_METADATA_KEYS,

        MAX_METADATA_VALUE_LENGTH,

        ERROR_CODES
    });

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports = {
    CorrelationConstants,

    generateCorrelationId,

    generateUUID,

    createChildCorrelation,

    resolveCorrelationContext,

    buildCorrelationMetadata,

    buildTransactionCorrelationContext,

    buildAuditCorrelationContext,

    propagateCorrelationContext,

    extractCorrelationFromHeaders,

    mergeCorrelationContext,

    serializeCorrelationContext,

    sameCorrelation,

    normalizeCorrelationId,

    isValidCorrelationId,

    assertValidCorrelationId
};