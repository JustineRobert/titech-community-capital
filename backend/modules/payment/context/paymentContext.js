'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Payment Execution Context
 * ============================================================================
 *
 * File:
 * backend/modules/payment/context/PaymentContext.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Canonical execution context shared across:
 *
 * • Airtel Money
 * • MTN MoMo
 * • Payment orchestration
 * • Authentication
 * • Idempotency
 * • Callback processing
 * • Settlement
 * • Reconciliation
 * • Ledger integration
 * • Audit logging
 * • Metrics
 * • Distributed tracing
 *
 * Design Goals
 * ----------------------------------------------------------------------------
 * • Immutable execution identity
 * • Deeply immutable metadata
 * • Tenant isolation
 * • Correlation propagation
 * • Idempotency propagation
 * • Provider / operation identification
 * • Safe diagnostics
 * • Context fingerprinting
 * • Child context support
 * • Deterministic serialization
 * • Sensitive-data protection
 * • Distributed workflow traceability
 *
 * Explicitly NOT Responsible For
 * ----------------------------------------------------------------------------
 * • Payment execution
 * • Authentication
 * • Ledger posting
 * • Credential storage
 * • Provider communication
 *
 * ============================================================================
 */

const crypto = require('crypto');

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const CONTEXT_VERSION = '1.1';

const MAX_STRING_LENGTH = 512;

const MAX_TENANT_ID_LENGTH = 256;

const MAX_USER_ID_LENGTH = 256;

const MAX_PROVIDER_LENGTH = 128;

const MAX_OPERATION_LENGTH = 256;

const MAX_REQUEST_ID_LENGTH = 256;

const MAX_CORRELATION_ID_LENGTH = 256;

const MAX_IDEMPOTENCY_KEY_LENGTH = 512;

const MAX_PARENT_REQUEST_ID_LENGTH = 256;

const MAX_METADATA_KEYS = 50;

const MAX_METADATA_DEPTH = 6;

const MAX_METADATA_ARRAY_LENGTH = 100;

const RESERVED_METADATA_KEYS = new Set([
    'password',
    'passwd',
    'passphrase',
    'secret',
    'clientsecret',
    'client_secret',
    'accessToken',
    'accesstoken',
    'access_token',
    'refreshToken',
    'refreshtoken',
    'refresh_token',
    'authorization',
    'proxyAuthorization',
    'cookie',
    'set-cookie',
    'token',
    'bearerToken',
    'bearertoken',
    'apiKey',
    'apikey',
    'api_key',
    'privateKey',
    'privatekey',
    'private_key',
    'credential',
    'credentials',
    'signature',
    'webhookSecret',
    'webhooksecret',
    'webhook_secret',
]);

const RESERVED_METADATA_NORMALIZED_KEYS =
    new Set(
        Array.from(
            RESERVED_METADATA_KEYS,
            key =>
                String(key)
                    .replace(/[\s_-]/g, '')
                    .toLowerCase()
        )
    );

/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

function generateId() {
    return crypto.randomUUID();
}

function isPlainObject(value) {
    if (
        value === null ||
        typeof value !== 'object'
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

function normalizeRequiredString(
    value,
    field,
    maxLength = MAX_STRING_LENGTH
) {
    if (
        typeof value !== 'string' ||
        value.trim() === ''
    ) {
        throw new TypeError(
            `${field} is required`
        );
    }

    const normalized =
        value.trim();

    if (
        normalized.length >
        maxLength
    ) {
        throw new RangeError(
            `${field} exceeds maximum length of ${maxLength}`
        );
    }

    return normalized;
}

function normalizeOptionalString(
    value,
    field,
    maxLength = MAX_STRING_LENGTH
) {
    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {
        return null;
    }

    if (
        typeof value !== 'string'
    ) {
        throw new TypeError(
            `${field} must be a string`
        );
    }

    const normalized =
        value.trim();

    if (
        normalized.length === 0
    ) {
        return null;
    }

    if (
        normalized.length >
        maxLength
    ) {
        throw new RangeError(
            `${field} exceeds maximum length of ${maxLength}`
        );
    }

    return normalized;
}

function normalizeProvider(
    provider
) {
    return normalizeRequiredString(
        provider,
        'provider',
        MAX_PROVIDER_LENGTH
    ).toUpperCase();
}

function normalizeOperation(
    operation
) {
    return normalizeRequiredString(
        operation,
        'operation',
        MAX_OPERATION_LENGTH
    );
}

/**
 * ============================================================================
 * Deep Freeze
 * ============================================================================
 *
 * Object.freeze() only freezes the object itself.
 *
 * Nested arrays/objects and Date instances require special handling.
 * ============================================================================
 */

function deepFreeze(value, seen = new WeakSet()) {
    if (
        value === null ||
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

    if (
        value instanceof Date
    ) {
        return value;
    }

    if (
        Array.isArray(value)
    ) {
        for (
            const item of value
        ) {
            deepFreeze(
                item,
                seen
            );
        }

        return Object.freeze(
            value
        );
    }

    for (
        const key of Object.keys(value)
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
 * Clone Value
 * ============================================================================
 *
 * Used for safe outward serialization.
 * ============================================================================
 */

function cloneValue(
    value,
    seen = new WeakMap()
) {
    if (
        value === null ||
        typeof value !== 'object'
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
        Buffer.isBuffer(value)
    ) {
        return '[BUFFER_REDACTED]';
    }

    if (
        seen.has(value)
    ) {
        return '[CIRCULAR]';
    }

    if (
        Array.isArray(value)
    ) {
        const result = [];

        seen.set(
            value,
            result
        );

        for (
            const item of value
        ) {
            result.push(
                cloneValue(
                    item,
                    seen
                )
            );
        }

        return result;
    }

    const result = {};

    seen.set(
        value,
        result
    );

    for (
        const [key, child]
        of Object.entries(value)
    ) {
        result[key] =
            cloneValue(
                child,
                seen
            );
    }

    return result;
}

/**
 * ============================================================================
 * Metadata Key Security
 * ============================================================================
 */

function normalizeMetadataKey(
    key
) {
    return String(key)
        .trim()
        .replace(/[\s_-]/g, '')
        .toLowerCase();
}

function isReservedMetadataKey(
    key
) {
    return RESERVED_METADATA_NORMALIZED_KEYS.has(
        normalizeMetadataKey(key)
    );
}

/**
 * ============================================================================
 * Metadata Sanitization
 * ============================================================================
 *
 * Strictly rejects sensitive metadata instead of silently redacting it.
 *
 * This is preferable for payment contexts because accidentally attempting to
 * place credentials in a context should fail immediately.
 * ============================================================================
 */

function sanitizeMetadata(
    metadata = {},
    depth = 0,
    seen = new WeakSet()
) {
    if (
        metadata === null ||
        metadata === undefined
    ) {
        return {};
    }

    if (
        depth > MAX_METADATA_DEPTH
    ) {
        throw new RangeError(
            `metadata exceeds maximum nesting depth of ${MAX_METADATA_DEPTH}`
        );
    }

    if (
        !isPlainObject(metadata) &&
        !Array.isArray(metadata)
    ) {
        throw new TypeError(
            'metadata must be an object'
        );
    }

    if (
        seen.has(metadata)
    ) {
        throw new TypeError(
            'metadata cannot contain circular references'
        );
    }

    seen.add(metadata);

    if (
        Array.isArray(metadata)
    ) {
        if (
            metadata.length >
            MAX_METADATA_ARRAY_LENGTH
        ) {
            throw new RangeError(
                `metadata arrays cannot contain more than ${MAX_METADATA_ARRAY_LENGTH} items`
            );
        }

        const result =
            metadata.map(
                item =>
                    sanitizeMetadataValue(
                        item,
                        depth + 1,
                        seen
                    )
            );

        return deepFreeze(
            result
        );
    }

    const entries =
        Object.entries(
            metadata
        );

    if (
        entries.length >
        MAX_METADATA_KEYS
    ) {
        throw new RangeError(
            `metadata cannot contain more than ${MAX_METADATA_KEYS} keys`
        );
    }

    const result = {};

    for (
        const [key, value]
        of entries
    ) {
        if (
            key === '__proto__' ||
            key === 'prototype' ||
            key === 'constructor'
        ) {
            throw new Error(
                `Unsafe metadata field is not permitted: ${key}`
            );
        }

        if (
            isReservedMetadataKey(key)
        ) {
            throw new Error(
                `Sensitive metadata field is not permitted: ${key}`
            );
        }

        result[key] =
            sanitizeMetadataValue(
                value,
                depth + 1,
                seen
            );
    }

    return deepFreeze(
        result
    );
}

function sanitizeMetadataValue(
    value,
    depth,
    seen
) {
    if (
        value === null ||
        value === undefined
    ) {
        return value;
    }

    if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        if (
            typeof value === 'number' &&
            !Number.isFinite(value)
        ) {
            throw new TypeError(
                'metadata cannot contain non-finite numbers'
            );
        }

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
        typeof value === 'function' ||
        typeof value === 'symbol' ||
        typeof value === 'bigint'
    ) {
        throw new TypeError(
            'Unsupported metadata value type'
        );
    }

    return sanitizeMetadata(
        value,
        depth,
        seen
    );
}

/**
 * ============================================================================
 * Canonical Serialization
 * ============================================================================
 */

function stableSerialize(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return JSON.stringify(
            value
        );
    }

    if (
        value instanceof Date
    ) {
        return JSON.stringify(
            value.toISOString()
        );
    }

    if (
        Array.isArray(value)
    ) {
        return `[${value
            .map(
                stableSerialize
            )
            .join(',')}]`;
    }

    if (
        typeof value === 'object'
    ) {
        return `{${Object.keys(value)
            .sort()
            .map(
                key =>
                    `${JSON.stringify(key)}:${stableSerialize(
                        value[key]
                    )}`
            )
            .join(',')}}`;
    }

    return JSON.stringify(
        value
    );
}

/**
 * ============================================================================
 * Payment Context
 * ============================================================================
 */

class PaymentContext {

    constructor({
        tenantId,

        userId = null,

        provider,

        operation,

        correlationId = null,

        idempotencyKey = null,

        requestId = null,

        parentRequestId = null,

        metadata = {},

        createdAt = null,

        contextVersion =
            CONTEXT_VERSION,

    } = {}) {

        /**
         * --------------------------------------------------------------------
         * Tenant identity
         * --------------------------------------------------------------------
         */

        this._tenantId =
            normalizeRequiredString(
                tenantId,
                'tenantId',
                MAX_TENANT_ID_LENGTH
            );

        /**
         * --------------------------------------------------------------------
         * Provider / operation identity
         * --------------------------------------------------------------------
         */

        this._provider =
            normalizeProvider(
                provider
            );

        this._operation =
            normalizeOperation(
                operation
            );

        /**
         * --------------------------------------------------------------------
         * Optional user identity
         * --------------------------------------------------------------------
         */

        this._userId =
            normalizeOptionalString(
                userId,
                'userId',
                MAX_USER_ID_LENGTH
            );

        /**
         * --------------------------------------------------------------------
         * Request identity
         * --------------------------------------------------------------------
         *
         * requestId = one concrete execution/request.
         *
         * correlationId = distributed workflow identity shared by all related
         * child operations, retries, callbacks and asynchronous processing.
         */

        this._requestId =
            requestId
                ? normalizeRequiredString(
                    requestId,
                    'requestId',
                    MAX_REQUEST_ID_LENGTH
                )
                : generateId();

        this._correlationId =
            correlationId
                ? normalizeRequiredString(
                    correlationId,
                    'correlationId',
                    MAX_CORRELATION_ID_LENGTH
                )
                : this._requestId;

        this._parentRequestId =
            normalizeOptionalString(
                parentRequestId,
                'parentRequestId',
                MAX_PARENT_REQUEST_ID_LENGTH
            );

        /**
         * --------------------------------------------------------------------
         * Idempotency
         * --------------------------------------------------------------------
         */

        this._idempotencyKey =
            normalizeOptionalString(
                idempotencyKey,
                'idempotencyKey',
                MAX_IDEMPOTENCY_KEY_LENGTH
            );

        /**
         * --------------------------------------------------------------------
         * Metadata
         * --------------------------------------------------------------------
         */

        this._metadata =
            sanitizeMetadata(
                metadata
            );

        /**
         * --------------------------------------------------------------------
         * Context version
         * --------------------------------------------------------------------
         */

        this._contextVersion =
            normalizeRequiredString(
                contextVersion,
                'contextVersion',
                64
            );

        /**
         * --------------------------------------------------------------------
         * Timestamp
         * --------------------------------------------------------------------
         */

        const timestamp =
            createdAt
                ? new Date(
                    createdAt
                )
                : new Date();

        if (
            Number.isNaN(
                timestamp.getTime()
            )
        ) {
            throw new TypeError(
                'createdAt must be a valid date'
            );
        }

        /**
         * Store the timestamp as a frozen primitive-backed Date snapshot.
         *
         * The getter below returns a clone, preventing callers from mutating
         * the internal execution timestamp.
         */

        this._createdAt =
            Object.freeze(
                timestamp
            );

        /**
         * --------------------------------------------------------------------
         * Context fingerprint
         * --------------------------------------------------------------------
         */

        this._fingerprint =
            this._computeFingerprint();

        /**
         * --------------------------------------------------------------------
         * Freeze context
         * --------------------------------------------------------------------
         */

        Object.freeze(
            this
        );
    }

    /**
     * =========================================================================
     * Accessors
     * =========================================================================
     */

    get requestId() {
        return this._requestId;
    }

    get tenantId() {
        return this._tenantId;
    }

    get userId() {
        return this._userId;
    }

    get provider() {
        return this._provider;
    }

    get operation() {
        return this._operation;
    }

    get correlationId() {
        return this._correlationId;
    }

    get idempotencyKey() {
        return this._idempotencyKey;
    }

    get parentRequestId() {
        return this._parentRequestId;
    }

    get contextVersion() {
        return this._contextVersion;
    }

    get createdAt() {
        /**
         * Date remains mutable even when frozen, so always return a clone.
         */
        return new Date(
            this._createdAt.getTime()
        );
    }

    get metadata() {
        /**
         * Return a cloned frozen structure so callers cannot mutate internal
         * nested references.
         */
        return cloneValue(
            this._metadata
        );
    }

    /**
     * =========================================================================
     * Idempotency Requirement
     * =========================================================================
     */

    requiresIdempotency() {
        return Boolean(
            this._idempotencyKey
        );
    }

    /**
     * =========================================================================
     * Require Idempotency
     * =========================================================================
     *
     * Useful for operations such as payment initiation, reversal, refund,
     * settlement creation, or other financial mutations where idempotency
     * must exist before provider execution.
     */

    assertIdempotencyRequired() {

        if (
            !this._idempotencyKey
        ) {
            const error =
                new TypeError(
                    `Idempotency key is required for payment operation: ${this._operation}`
                );

            error.code =
                'PAYMENT_IDEMPOTENCY_KEY_REQUIRED';

            throw error;
        }

        return this;
    }

    /**
     * =========================================================================
     * Context Fingerprint
     * =========================================================================
     *
     * Used for deterministic diagnostics and correlation.
     *
     * IMPORTANT:
     * This is NOT an idempotency key.
     */

    fingerprint() {
        return this._fingerprint;
    }

    _computeFingerprint() {

        const canonical = {
            contextVersion:
                this._contextVersion,

            tenantId:
                this._tenantId,

            userId:
                this._userId,

            provider:
                this._provider,

            operation:
                this._operation,

            correlationId:
                this._correlationId,

            idempotencyKey:
                this._idempotencyKey,

            parentRequestId:
                this._parentRequestId,
        };

        return crypto
            .createHash(
                'sha256'
            )
            .update(
                stableSerialize(
                    canonical
                ),
                'utf8'
            )
            .digest('hex');
    }

    /**
     * =========================================================================
     * Child Context
     * =========================================================================
     *
     * Parent:
     *
     *   PAYMENT_INITIATE
     *        │
     *        ├── PROVIDER_AUTH
     *        ├── PROVIDER_REQUEST
     *        └── AUDIT
     *
     * Child contexts preserve:
     * - tenant
     * - user
     * - correlation
     * - idempotency
     *
     * but receive a new requestId and parentRequestId.
     */

    child({
        operation,

        provider =
            this._provider,

        userId =
            this._userId,

        idempotencyKey =
            this._idempotencyKey,

        metadata = {},

    } = {}) {

        const mergedMetadata = {
            ...cloneValue(
                this._metadata
            ),
            ...metadata,
        };

        return new PaymentContext({

            tenantId:
                this._tenantId,

            userId,

            provider,

            operation,

            correlationId:
                this._correlationId,

            idempotencyKey,

            parentRequestId:
                this._requestId,

            metadata:
                mergedMetadata,

            contextVersion:
                this._contextVersion,

        });
    }

    /**
     * =========================================================================
     * Child Context With Independent Idempotency
     * =========================================================================
     *
     * Useful where the downstream operation has its own idempotency identity.
     */

    childWithIdempotency(
        {
            operation,

            provider =
                this._provider,

            idempotencyKey,

            userId =
                this._userId,

            metadata = {},

        } = {}
    ) {

        return this.child({
            operation,

            provider,

            userId,

            idempotencyKey,

            metadata,
        });
    }

    /**
     * =========================================================================
     * Safe Diagnostic Representation
     * =========================================================================
     *
     * Includes the idempotency key because this representation is intended
     * for controlled diagnostics, not general-purpose application logging.
     */

    toJSON() {

        return {
            contextVersion:
                this._contextVersion,

            requestId:
                this._requestId,

            parentRequestId:
                this._parentRequestId,

            tenantId:
                this._tenantId,

            userId:
                this._userId,

            provider:
                this._provider,

            operation:
                this._operation,

            correlationId:
                this._correlationId,

            idempotencyKey:
                this._idempotencyKey,

            createdAt:
                this.createdAt,

            metadata:
                cloneValue(
                    this._metadata
                ),

            fingerprint:
                this._fingerprint,
        };
    }

    /**
     * =========================================================================
     * Safe Logging Representation
     * =========================================================================
     *
     * Intentionally excludes idempotencyKey.
     */

    toLogContext() {

        return {
            contextVersion:
                this._contextVersion,

            requestId:
                this._requestId,

            parentRequestId:
                this._parentRequestId,

            tenantId:
                this._tenantId,

            userId:
                this._userId,

            provider:
                this._provider,

            operation:
                this._operation,

            correlationId:
                this._correlationId,

            contextFingerprint:
                this._fingerprint,
        };
    }

    /**
     * =========================================================================
     * Provider Request Context
     * =========================================================================
     *
     * Useful when building provider adapter calls.
     *
     * Excludes:
     * - credentials
     * - metadata
     * - idempotency secrets
     */

    toProviderContext() {

        return {
            tenantId:
                this._tenantId,

            provider:
                this._provider,

            operation:
                this._operation,

            requestId:
                this._requestId,

            correlationId:
                this._correlationId,

            parentRequestId:
                this._parentRequestId,

            contextVersion:
                this._contextVersion,

            contextFingerprint:
                this._fingerprint,
        };
    }

    /**
     * =========================================================================
     * Audit Context
     * =========================================================================
     */

    toAuditContext() {

        return {
            tenantId:
                this._tenantId,

            userId:
                this._userId,

            provider:
                this._provider,

            operation:
                this._operation,

            requestId:
                this._requestId,

            correlationId:
                this._correlationId,

            parentRequestId:
                this._parentRequestId,

            contextVersion:
                this._contextVersion,

            contextFingerprint:
                this._fingerprint,
        };
    }

    /**
     * =========================================================================
     * Serialization
     * =========================================================================
     */

    serialize() {
        return JSON.stringify(
            this.toJSON()
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
        return new PaymentContext(
            options
        );
    }

    /**
     * =========================================================================
     * Static Validation
     * =========================================================================
     */

    static isValid(
        context
    ) {
        return (
            context instanceof
            PaymentContext
        );
    }

    /**
     * =========================================================================
     * Rehydrate
     * =========================================================================
     *
     * Reconstruct a context from serialized diagnostic state.
     *
     * This is intentionally explicit rather than relying on object spreading,
     * which could accidentally bypass constructors/validation.
     */

    static fromJSON(
        payload
    ) {

        if (
            payload === null ||
            typeof payload !== 'object'
        ) {
            throw new TypeError(
                'Payment context payload must be an object'
            );
        }

        return new PaymentContext({
            tenantId:
                payload.tenantId,

            userId:
                payload.userId,

            provider:
                payload.provider,

            operation:
                payload.operation,

            correlationId:
                payload.correlationId,

            idempotencyKey:
                payload.idempotencyKey,

            requestId:
                payload.requestId,

            parentRequestId:
                payload.parentRequestId,

            metadata:
                payload.metadata || {},

            createdAt:
                payload.createdAt,

            contextVersion:
                payload.contextVersion ||
                CONTEXT_VERSION,
        });
    }
}

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports =
    PaymentContext;

module.exports.PaymentContext =
    PaymentContext;

module.exports.CONTEXT_VERSION =
    CONTEXT_VERSION;