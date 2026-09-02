'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Payment Engine Error
 * ============================================================================
 *
 * File:
 * backend/modules/payment/errors/PaymentEngineError.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Enterprise domain error for the payment engine.
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - Stable machine-readable error codes
 * - Human-readable messages
 * - Error classification
 * - HTTP status mapping
 * - Retry classification
 * - Provider context
 * - Tenant context
 * - Request/correlation propagation
 * - Error cause preservation
 * - Recursive secret redaction
 * - Safe serialization
 * - Operational diagnostics
 * - Deterministic error fingerprinting
 *
 * Explicitly NOT Responsible For
 * ----------------------------------------------------------------------------
 * - Logging
 * - Metrics
 * - Payment execution
 * - Provider communication
 * - Retry scheduling
 *
 * Security Principles
 * ----------------------------------------------------------------------------
 * - Never expose credentials, tokens, cookies, secrets, or authorization
 *   material through metadata serialization.
 * - Never expose arbitrary provider payloads directly to API consumers.
 * - Preserve low-level causes internally while serializing only safe fields.
 * - Retry classification must be explicit and deterministic.
 * - HTTP status must always be within a valid response range.
 *
 * ============================================================================
 */

const crypto = require('crypto');

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const DEFAULT_STATUS_CODE = 500;

const DEFAULT_ERROR_CODE =
    'PAYMENT_ENGINE_ERROR';

const DEFAULT_ERROR_MESSAGE =
    'Payment engine error';

const MAX_CODE_LENGTH = 128;

const MAX_MESSAGE_LENGTH = 2000;

const MAX_PROVIDER_LENGTH = 128;

const MAX_PROVIDER_CODE_LENGTH = 256;

const MAX_TENANT_ID_LENGTH = 256;

const MAX_REQUEST_ID_LENGTH = 256;

const MAX_CORRELATION_ID_LENGTH = 256;

const MAX_OPERATION_LENGTH = 128;

const MAX_METADATA_DEPTH = 6;

const MAX_METADATA_KEYS = 100;

const REDACTED_VALUE =
    '[REDACTED]';

/**
 * ============================================================================
 * Error Categories
 * ============================================================================
 */

const ERROR_CATEGORIES =
    Object.freeze({

        VALIDATION:
            'VALIDATION',

        AUTHENTICATION:
            'AUTHENTICATION',

        AUTHORIZATION:
            'AUTHORIZATION',

        IDEMPOTENCY:
            'IDEMPOTENCY',

        CONFLICT:
            'CONFLICT',

        PROVIDER:
            'PROVIDER',

        NETWORK:
            'NETWORK',

        TIMEOUT:
            'TIMEOUT',

        RATE_LIMIT:
            'RATE_LIMIT',

        NOT_FOUND:
            'NOT_FOUND',

        CONFIGURATION:
            'CONFIGURATION',

        INTERNAL:
            'INTERNAL'

    });

/**
 * ============================================================================
 * Retryable Categories
 * ============================================================================
 *
 * These are defaults only.
 *
 * Individual errors may explicitly override retryability where provider
 * semantics require it.
 * ============================================================================
 */

const RETRYABLE_CATEGORIES =
    new Set([

        ERROR_CATEGORIES.PROVIDER,

        ERROR_CATEGORIES.NETWORK,

        ERROR_CATEGORIES.TIMEOUT,

        ERROR_CATEGORIES.RATE_LIMIT

    ]);

/**
 * ============================================================================
 * Sensitive Keys
 * ============================================================================
 *
 * Keys are normalized before comparison.
 * ============================================================================
 */

const SENSITIVE_KEYS =
    new Set([

        'password',

        'passwd',

        'passphrase',

        'secret',

        'clientsecret',

        'client_secret',

        'accesstoken',

        'access_token',

        'refreshtoken',

        'refresh_token',

        'authorization',

        'proxyauthorization',

        'cookie',

        'setcookie',

        'set-cookie',

        'apikey',

        'api_key',

        'privatekey',

        'private_key',

        'publickey',

        'public_key',

        'token',

        'bearertoken',

        'idtoken',

        'jwt',

        'signature',

        'clientcredential',

        'client_credentials',

        'consumerkey',

        'consumer_key',

        'consumersecret',

        'consumer_secret',

        'credential',

        'credentials',

        'webhooksecret',

        'webhook_secret'

    ]);

/**
 * ============================================================================
 * Sensitive Key Detection
 * ============================================================================
 */

function normalizeKey(key) {

    return String(key)
        .replace(/[\s_-]/g, '')
        .toLowerCase();

}

function isSensitiveKey(key) {

    const normalized =
        normalizeKey(key);

    if (
        SENSITIVE_KEYS.has(
            normalized
        )
    ) {

        return true;

    }

    /**
     * Catch common token/secret naming variants.
     */
    return (
        normalized.includes('accesstoken') ||
        normalized.includes('refreshtoken') ||
        normalized.includes('clientsecret') ||
        normalized.includes('privatekey') ||
        normalized.includes('authorization') ||
        normalized.includes('password')
    );

}

/**
 * ============================================================================
 * Primitive Normalization
 * ============================================================================
 */

function normalizeCategory(
    category
) {

    const normalized =
        String(
            category ||
            ERROR_CATEGORIES.INTERNAL
        )
            .trim()
            .toUpperCase();

    return Object.values(
        ERROR_CATEGORIES
    ).includes(
        normalized
    )
        ? normalized
        : ERROR_CATEGORIES.INTERNAL;

}

function normalizeBoundedString(
    value,
    fallback,
    maxLength
) {

    if (
        value === undefined ||
        value === null
    ) {

        return fallback;

    }

    const normalized =
        String(value)
            .trim();

    if (
        normalized.length === 0
    ) {

        return fallback;

    }

    return normalized.substring(
        0,
        maxLength
    );

}

function normalizeStatusCode(
    value
) {

    const status =
        Number(value);

    if (
        !Number.isInteger(status)
    ) {

        return DEFAULT_STATUS_CODE;

    }

    /**
     * Valid HTTP response status range.
     */
    if (
        status < 100 ||
        status > 599
    ) {

        return DEFAULT_STATUS_CODE;

    }

    return status;

}

/**
 * ============================================================================
 * Recursive Metadata Sanitization
 * ============================================================================
 *
 * Protects against:
 * - nested credentials
 * - provider OAuth payloads
 * - authorization headers
 * - cookies
 * - bearer tokens
 * - prototype pollution keys
 * - excessively deep objects
 * ============================================================================
 */

function sanitizeMetadata(
    metadata,
    depth = 0,
    seen = new WeakSet()
) {

    if (
        metadata === null ||
        metadata === undefined
    ) {

        return metadata;

    }

    if (
        depth > MAX_METADATA_DEPTH
    ) {

        return '[TRUNCATED]';

    }

    if (
        typeof metadata === 'string' ||
        typeof metadata === 'number' ||
        typeof metadata === 'boolean'
    ) {

        return metadata;

    }

    if (
        typeof metadata === 'bigint'
    ) {

        return metadata.toString();

    }

    if (
        metadata instanceof Date
    ) {

        return new Date(
            metadata.getTime()
        );

    }

    if (
        Buffer.isBuffer(
            metadata
        )
    ) {

        return '[BUFFER_REDACTED]';

    }

    if (
        typeof metadata !== 'object'
    ) {

        return String(metadata);

    }

    /**
     * Circular reference protection.
     */
    if (
        seen.has(metadata)
    ) {

        return '[CIRCULAR]';

    }

    seen.add(metadata);

    if (
        Array.isArray(metadata)
    ) {

        const result = [];

        const limit =
            Math.min(
                metadata.length,
                MAX_METADATA_KEYS
            );

        for (
            let index = 0;
            index < limit;
            index += 1
        ) {

            result.push(
                sanitizeMetadata(
                    metadata[index],
                    depth + 1,
                    seen
                )
            );

        }

        if (
            metadata.length > limit
        ) {

            result.push(
                '[TRUNCATED]'
            );

        }

        return result;

    }

    const result = {};

    const entries =
        Object.entries(
            metadata
        );

    const limit =
        Math.min(
            entries.length,
            MAX_METADATA_KEYS
        );

    for (
        let index = 0;
        index < limit;
        index += 1
    ) {

        const [
            key,
            value
        ] = entries[index];

        if (
            key === '__proto__' ||
            key === 'prototype' ||
            key === 'constructor'
        ) {

            continue;

        }

        if (
            isSensitiveKey(
                key
            )
        ) {

            result[key] =
                REDACTED_VALUE;

            continue;

        }

        result[key] =
            sanitizeMetadata(
                value,
                depth + 1,
                seen
            );

    }

    if (
        entries.length > limit
    ) {

        result._truncated =
            true;

    }

    return result;

}

/**
 * ============================================================================
 * Safe Cause Serialization
 * ============================================================================
 *
 * Never recursively serialize arbitrary causes.
 * ============================================================================
 */

function serializeCause(
    cause
) {

    if (
        !cause
    ) {

        return undefined;

    }

    return {

        name:
            normalizeBoundedString(
                cause.name,
                'Error',
                128
            ),

        message:
            normalizeBoundedString(
                cause.message,
                'Unknown error',
                MAX_MESSAGE_LENGTH
            ),

        code:
            normalizeBoundedString(
                cause.code,
                null,
                MAX_CODE_LENGTH
            )

    };

}

/**
 * ============================================================================
 * Stable Error Fingerprint
 * ============================================================================
 *
 * Used for operational grouping.
 *
 * Deliberately excludes:
 * - timestamp
 * - requestId
 * - correlationId
 * - arbitrary metadata
 *
 * This allows multiple instances of the same logical error to be grouped.
 * ============================================================================
 */

function createFingerprint({
    code,
    category,
    provider,
    providerCode,
    operation
}) {

    const canonical =
        [
            code || '',
            category || '',
            provider || '',
            providerCode || '',
            operation || ''
        ].join('|');

    return crypto
        .createHash(
            'sha256'
        )
        .update(
            canonical,
            'utf8'
        )
        .digest('hex');

}

/**
 * ============================================================================
 * Payment Engine Error
 * ============================================================================
 */

class PaymentEngineError
    extends Error {

    constructor(
        code,
        message,
        metadata = {},
        options = {}
    ) {

        const safeCode =
            normalizeBoundedString(
                code,
                DEFAULT_ERROR_CODE,
                MAX_CODE_LENGTH
            );

        const safeMessage =
            normalizeBoundedString(
                message,
                DEFAULT_ERROR_MESSAGE,
                MAX_MESSAGE_LENGTH
            );

        super(
            safeMessage
        );

        this.name =
            'PaymentEngineError';

        this.code =
            safeCode;

        this.category =
            normalizeCategory(
                options.category
            );

        this.statusCode =
            normalizeStatusCode(
                options.statusCode
            );

        this.retryable =
            typeof options.retryable ===
                'boolean'
                ? options.retryable
                : RETRYABLE_CATEGORIES.has(
                    this.category
                );

        this.provider =
            normalizeBoundedString(
                options.provider,
                null,
                MAX_PROVIDER_LENGTH
            );

        this.providerCode =
            normalizeBoundedString(
                options.providerCode,
                null,
                MAX_PROVIDER_CODE_LENGTH
            );

        this.tenantId =
            normalizeBoundedString(
                options.tenantId,
                null,
                MAX_TENANT_ID_LENGTH
            );

        this.requestId =
            normalizeBoundedString(
                options.requestId,
                null,
                MAX_REQUEST_ID_LENGTH
            );

        this.correlationId =
            normalizeBoundedString(
                options.correlationId,
                null,
                MAX_CORRELATION_ID_LENGTH
            );

        this.operation =
            normalizeBoundedString(
                options.operation,
                null,
                MAX_OPERATION_LENGTH
            );

        this.metadata =
            sanitizeMetadata(
                metadata
            );

        this.timestamp =
            new Date();

        /**
         * Optional retry-after information.
         *
         * Useful for HTTP 429 and provider throttling.
         */
        this.retryAfterMs =
            Number.isFinite(
                Number(
                    options.retryAfterMs
                )
            ) &&
            Number(
                options.retryAfterMs
            ) >= 0
                ? Number(
                    options.retryAfterMs
                )
                : null;

        /**
         * Provider request/reference identifiers can be safely preserved as
         * bounded strings for support and reconciliation.
         */
        this.providerRequestId =
            normalizeBoundedString(
                options.providerRequestId,
                null,
                MAX_REQUEST_ID_LENGTH
            );

        this.providerTransactionId =
            normalizeBoundedString(
                options.providerTransactionId,
                null,
                MAX_REQUEST_ID_LENGTH
            );

        /**
         * Preserve the original cause.
         */
        if (
            options.cause
        ) {

            this.cause =
                options.cause;

        }

        /**
         * Stable operational grouping fingerprint.
         */
        this.fingerprint =
            createFingerprint({
                code:
                    this.code,

                category:
                    this.category,

                provider:
                    this.provider,

                providerCode:
                    this.providerCode,

                operation:
                    this.operation
            });

        /**
         * Native Error stack semantics.
         */
        if (
            Error.captureStackTrace
        ) {

            Error.captureStackTrace(
                this,
                PaymentEngineError
            );

        }

    }

    /**
     * ------------------------------------------------------------------------
     * Retry Classification
     * ------------------------------------------------------------------------
     */

    isRetryable() {

        return (
            this.retryable === true
        );

    }

    /**
     * ------------------------------------------------------------------------
     * HTTP Retry Headers
     * ------------------------------------------------------------------------
     */

    getRetryHeaders() {

        if (
            !this.isRetryable()
        ) {

            return {};

        }

        if (
            !Number.isFinite(
                this.retryAfterMs
            )
        ) {

            return {};

        }

        return {
            'Retry-After':
                Math.ceil(
                    this.retryAfterMs /
                    1000
                ).toString()
        };

    }

    /**
     * ------------------------------------------------------------------------
     * Safe Serialization
     * ------------------------------------------------------------------------
     */

    toJSON() {

        return {

            name:
                this.name,

            code:
                this.code,

            category:
                this.category,

            message:
                this.message,

            statusCode:
                this.statusCode,

            retryable:
                this.retryable,

            provider:
                this.provider,

            providerCode:
                this.providerCode,

            providerRequestId:
                this.providerRequestId,

            providerTransactionId:
                this.providerTransactionId,

            tenantId:
                this.tenantId,

            requestId:
                this.requestId,

            correlationId:
                this.correlationId,

            operation:
                this.operation,

            fingerprint:
                this.fingerprint,

            retryAfterMs:
                this.retryAfterMs,

            metadata:
                sanitizeMetadata(
                    this.metadata
                ),

            timestamp:
                new Date(
                    this.timestamp.getTime()
                ),

            cause:
                serializeCause(
                    this.cause
                )

        };

    }

    /**
     * ------------------------------------------------------------------------
     * Operational Representation
     * ------------------------------------------------------------------------
     *
     * Deliberately excludes:
     * - stack
     * - arbitrary metadata
     * - cause payload
     * - secrets
     */

    toOperationalError() {

        return {

            code:
                this.code,

            category:
                this.category,

            message:
                this.message,

            statusCode:
                this.statusCode,

            retryable:
                this.retryable,

            provider:
                this.provider,

            providerCode:
                this.providerCode,

            providerRequestId:
                this.providerRequestId,

            providerTransactionId:
                this.providerTransactionId,

            tenantId:
                this.tenantId,

            requestId:
                this.requestId,

            correlationId:
                this.correlationId,

            operation:
                this.operation,

            fingerprint:
                this.fingerprint

        };

    }

    /**
     * ------------------------------------------------------------------------
     * API-Safe Representation
     * ------------------------------------------------------------------------
     *
     * More restrictive than toJSON().
     *
     * Intended for controllers/global HTTP error middleware.
     */

    toApiResponse() {

        const response = {

            success:
                false,

            code:
                this.code,

            message:
                this.message,

            category:
                this.category,

            retryable:
                this.retryable,

            requestId:
                this.requestId,

            correlationId:
                this.correlationId

        };

        if (
            this.retryAfterMs !== null &&
            this.retryAfterMs !== undefined
        ) {

            response.retryAfterMs =
                this.retryAfterMs;

        }

        return response;

    }

    /**
     * ------------------------------------------------------------------------
     * Wrap Existing Error
     * ------------------------------------------------------------------------
     */

    static from(
        error,
        options = {}
    ) {

        if (
            error instanceof
            PaymentEngineError
        ) {

            /**
             * Preserve the domain error rather than wrapping it repeatedly.
             */
            return error;

        }

        const causeCode =
            normalizeBoundedString(
                error?.code,
                null,
                MAX_CODE_LENGTH
            );

        return new PaymentEngineError(

            options.code ||
            causeCode ||
            DEFAULT_ERROR_CODE,

            options.message ||
            error?.message ||
            DEFAULT_ERROR_MESSAGE,

            options.metadata ||
            {},

            {

                ...options,

                category:
                    options.category ||
                    ERROR_CATEGORIES.INTERNAL,

                cause:
                    error

            }

        );

    }

    /**
     * ------------------------------------------------------------------------
     * Validation Error
     * ------------------------------------------------------------------------
     */

    static validation(
        code,
        message,
        metadata = {},
        options = {}
    ) {

        return new PaymentEngineError(

            code,

            message,

            metadata,

            {

                ...options,

                category:
                    ERROR_CATEGORIES.VALIDATION,

                statusCode:
                    options.statusCode ??
                    400,

                retryable:
                    false

            }

        );

    }

    /**
     * ------------------------------------------------------------------------
     * Authentication Error
     * ------------------------------------------------------------------------
     */

    static authentication(
        code,
        message,
        metadata = {},
        options = {}
    ) {

        return new PaymentEngineError(

            code,

            message,

            metadata,

            {

                ...options,

                category:
                    ERROR_CATEGORIES.AUTHENTICATION,

                statusCode:
                    options.statusCode ??
                    401,

                retryable:
                    false

            }

        );

    }

    /**
     * ------------------------------------------------------------------------
     * Authorization Error
     * ------------------------------------------------------------------------
     */

    static authorization(
        code,
        message,
        metadata = {},
        options = {}
    ) {

        return new PaymentEngineError(

            code,

            message,

            metadata,

            {

                ...options,

                category:
                    ERROR_CATEGORIES.AUTHORIZATION,

                statusCode:
                    options.statusCode ??
                    403,

                retryable:
                    false

            }

        );

    }

    /**
     * ------------------------------------------------------------------------
     * Idempotency Error
     * ------------------------------------------------------------------------
     */

    static idempotency(
        code,
        message,
        metadata = {},
        options = {}
    ) {

        return new PaymentEngineError(

            code,

            message,

            metadata,

            {

                ...options,

                category:
                    ERROR_CATEGORIES.IDEMPOTENCY,

                statusCode:
                    options.statusCode ??
                    409,

                retryable:
                    false

            }

        );

    }

    /**
     * ------------------------------------------------------------------------
     * Conflict Error
     * ------------------------------------------------------------------------
     */

    static conflict(
        code,
        message,
        metadata = {},
        options = {}
    ) {

        return new PaymentEngineError(

            code,

            message,

            metadata,

            {

                ...options,

                category:
                    options.category ||
                    ERROR_CATEGORIES.CONFLICT,

                statusCode:
                    options.statusCode ??
                    409,

                retryable:
                    false

            }

        );

    }

    /**
     * ------------------------------------------------------------------------
     * Not Found Error
     * ------------------------------------------------------------------------
     */

    static notFound(
        code,
        message,
        metadata = {},
        options = {}
    ) {

        return new PaymentEngineError(

            code,

            message,

            metadata,

            {

                ...options,

                category:
                    ERROR_CATEGORIES.NOT_FOUND,

                statusCode:
                    options.statusCode ??
                    404,

                retryable:
                    false

            }

        );

    }

    /**
     * ------------------------------------------------------------------------
     * Provider Error
     * ------------------------------------------------------------------------
     */

    static provider(
        code,
        message,
        metadata = {},
        options = {}
    ) {

        return new PaymentEngineError(

            code,

            message,

            metadata,

            {

                ...options,

                category:
                    ERROR_CATEGORIES.PROVIDER,

                statusCode:
                    options.statusCode ??
                    502,

                retryable:
                    options.retryable ??
                    true

            }

        );

    }

    /**
     * ------------------------------------------------------------------------
     * Network Error
     * ------------------------------------------------------------------------
     */

    static network(
        code,
        message,
        metadata = {},
        options = {}
    ) {

        return new PaymentEngineError(

            code,

            message,

            metadata,

            {

                ...options,

                category:
                    ERROR_CATEGORIES.NETWORK,

                statusCode:
                    options.statusCode ??
                    502,

                retryable:
                    options.retryable ??
                    true

            }

        );

    }

    /**
     * ------------------------------------------------------------------------
     * Timeout Error
     * ------------------------------------------------------------------------
     */

    static timeout(
        code,
        message,
        metadata = {},
        options = {}
    ) {

        return new PaymentEngineError(

            code,

            message,

            metadata,

            {

                ...options,

                category:
                    ERROR_CATEGORIES.TIMEOUT,

                statusCode:
                    options.statusCode ??
                    504,

                retryable:
                    options.retryable ??
                    true

            }

        );

    }

    /**
     * ------------------------------------------------------------------------
     * Rate Limit Error
     * ------------------------------------------------------------------------
     */

    static rateLimit(
        code,
        message,
        metadata = {},
        options = {}
    ) {

        return new PaymentEngineError(

            code,

            message,

            metadata,

            {

                ...options,

                category:
                    ERROR_CATEGORIES.RATE_LIMIT,

                statusCode:
                    options.statusCode ??
                    429,

                retryable:
                    options.retryable ??
                    true

            }

        );

    }

    /**
     * ------------------------------------------------------------------------
     * Configuration Error
     * ------------------------------------------------------------------------
     */

    static configuration(
        code,
        message,
        metadata = {},
        options = {}
    ) {

        return new PaymentEngineError(

            code,

            message,

            metadata,

            {

                ...options,

                category:
                    ERROR_CATEGORIES.CONFIGURATION,

                statusCode:
                    options.statusCode ??
                    500,

                retryable:
                    options.retryable ??
                    false

            }

        );

    }

    /**
     * ------------------------------------------------------------------------
     * Internal Error
     * ------------------------------------------------------------------------
     */

    static internal(
        code,
        message,
        metadata = {},
        options = {}
    ) {

        return new PaymentEngineError(

            code,

            message,

            metadata,

            {

                ...options,

                category:
                    ERROR_CATEGORIES.INTERNAL,

                statusCode:
                    options.statusCode ??
                    500,

                retryable:
                    options.retryable ??
                    false

            }

        );

    }

}


/**
 * ============================================================================
 * Static Constants
 * ============================================================================
 */

PaymentEngineError.ERROR_CATEGORIES =
    ERROR_CATEGORIES;

PaymentEngineError.RETRYABLE_CATEGORIES =
    RETRYABLE_CATEGORIES;

PaymentEngineError.SENSITIVE_KEYS =
    SENSITIVE_KEYS;


/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports =
    PaymentEngineError;

module.exports.PaymentEngineError =
    PaymentEngineError;

module.exports.ERROR_CATEGORIES =
    ERROR_CATEGORIES;

module.exports.RETRYABLE_CATEGORIES =
    RETRYABLE_CATEGORIES;