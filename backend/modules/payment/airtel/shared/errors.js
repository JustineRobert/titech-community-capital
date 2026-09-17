'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Airtel Money Enterprise Error Contract
 * ============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/shared/errors.js
 *
 * Architectural Role
 * ------------------
 * Canonical error taxonomy, normalization boundary and safe serialization
 * contract for the Airtel Money payment integration.
 *
 * This module provides one consistent error model for:
 *
 *   authentication
 *   collections
 *   disbursements
 *   callbacks
 *   settlement
 *   reconciliation
 *   provider transport
 *   configuration
 *   validation
 *   authorization
 *   idempotency
 *
 * Responsibilities
 * ----------------
 * • Define stable Airtel error codes.
 * • Define error categories.
 * • Provide typed domain/provider error classes.
 * • Normalize unknown exceptions.
 * • Normalize provider HTTP/API errors.
 * • Classify retryable/non-retryable failures.
 * • Preserve safe correlation/operation/tenant context.
 * • Serialize errors safely for logs/API responses.
 * • Prevent credentials and sensitive payloads from escaping through errors.
 * • Preserve causal relationships where supported by Node.js.
 *
 * Does NOT:
 * ----------
 * • Perform HTTP calls.
 * • Retry network requests.
 * • Log errors itself.
 * • Decide business outcomes.
 * • Modify financial records.
 * • Post ledger entries.
 * • Change transaction state.
 * • Expose provider secrets.
 *
 * Security Principles
 * -------------------
 * • Raw Authorization headers, credentials, tokens, signatures and secrets
 *   must never appear in serialized errors.
 * • Provider response bodies are treated as untrusted input.
 * • Error messages are bounded before being persisted/logged.
 * • Internal stack traces are not included in public serialization.
 * • A stable public code is separated from provider-specific raw error data.
 * • Error normalization must not convert an unknown financial failure into
 *   a successful or settled outcome.
 *
 * Compatibility
 * -------------
 * Existing Airtel modules may already consume:
 *
 *   normalizeError()
 *   SettlementError
 *
 * Both contracts remain available.
 *
 * Module Format
 * -------------
 * CommonJS.
 *
 * ============================================================================
 */

const crypto = require('crypto');


const PROVIDER = 'AIRTEL';


/**
 * ============================================================================
 * Error Categories
 * ============================================================================
 */
const ERROR_CATEGORY = Object.freeze({
    VALIDATION:
        'VALIDATION',

    CONFIGURATION:
        'CONFIGURATION',

    AUTHENTICATION:
        'AUTHENTICATION',

    AUTHORIZATION:
        'AUTHORIZATION',

    NETWORK:
        'NETWORK',

    PROVIDER:
        'PROVIDER',

    CALLBACK:
        'CALLBACK',

    IDEMPOTENCY:
        'IDEMPOTENCY',

    CONCURRENCY:
        'CONCURRENCY',

    RECONCILIATION:
        'RECONCILIATION',

    SETTLEMENT:
        'SETTLEMENT',

    FINANCIAL:
        'FINANCIAL',

    STATE:
        'STATE',

    SECURITY:
        'SECURITY',

    RATE_LIMIT:
        'RATE_LIMIT',

    TIMEOUT:
        'TIMEOUT',

    INTERNAL:
        'INTERNAL',

    DEPENDENCY:
        'DEPENDENCY',

    UNKNOWN:
        'UNKNOWN'
});


/**
 * ============================================================================
 * Stable Error Codes
 * ============================================================================
 *
 * Codes are intentionally provider-specific so API consumers and operational
 * tooling can distinguish Airtel failures from MTN or internal failures.
 */
const ERROR_CODE = Object.freeze({

    UNKNOWN:
        'AIRTEL_UNKNOWN_ERROR',

    INTERNAL:
        'AIRTEL_INTERNAL_ERROR',

    DEPENDENCY_FAILURE:
        'AIRTEL_DEPENDENCY_FAILURE',

    CONFIGURATION_INVALID:
        'AIRTEL_CONFIGURATION_INVALID',

    ENDPOINT_UNCONFIGURED:
        'AIRTEL_ENDPOINT_UNCONFIGURED',

    ENDPOINT_INVALID:
        'AIRTEL_ENDPOINT_INVALID',

    REQUEST_INVALID:
        'AIRTEL_REQUEST_INVALID',

    REQUEST_BODY_INVALID:
        'AIRTEL_REQUEST_BODY_INVALID',

    REQUEST_BODY_TOO_LARGE:
        'AIRTEL_REQUEST_BODY_TOO_LARGE',

    REQUEST_TIMEOUT:
        'AIRTEL_REQUEST_TIMEOUT',

    NETWORK_FAILURE:
        'AIRTEL_NETWORK_FAILURE',

    DNS_FAILURE:
        'AIRTEL_DNS_FAILURE',

    TLS_FAILURE:
        'AIRTEL_TLS_FAILURE',

    AUTHENTICATION_REQUIRED:
        'AIRTEL_AUTHENTICATION_REQUIRED',

    AUTHENTICATION_FAILED:
        'AIRTEL_AUTHENTICATION_FAILED',

    ACCESS_TOKEN_UNAVAILABLE:
        'AIRTEL_ACCESS_TOKEN_UNAVAILABLE',

    ACCESS_TOKEN_EXPIRED:
        'AIRTEL_ACCESS_TOKEN_EXPIRED',

    CREDENTIALS_INVALID:
        'AIRTEL_CREDENTIALS_INVALID',

    CREDENTIALS_UNAVAILABLE:
        'AIRTEL_CREDENTIALS_UNAVAILABLE',

    AUTHORIZATION_FAILED:
        'AIRTEL_AUTHORIZATION_FAILED',

    TENANT_REQUIRED:
        'AIRTEL_TENANT_REQUIRED',

    TENANT_FORBIDDEN:
        'AIRTEL_TENANT_FORBIDDEN',

    COLLECTION_INVALID:
        'AIRTEL_COLLECTION_INVALID',

    COLLECTION_NOT_FOUND:
        'AIRTEL_COLLECTION_NOT_FOUND',

    COLLECTION_FAILED:
        'AIRTEL_COLLECTION_FAILED',

    DISBURSEMENT_INVALID:
        'AIRTEL_DISBURSEMENT_INVALID',

    DISBURSEMENT_NOT_FOUND:
        'AIRTEL_DISBURSEMENT_NOT_FOUND',

    DISBURSEMENT_FAILED:
        'AIRTEL_DISBURSEMENT_FAILED',

    CALLBACK_INVALID:
        'AIRTEL_CALLBACK_INVALID',

    CALLBACK_SIGNATURE_INVALID:
        'AIRTEL_CALLBACK_SIGNATURE_INVALID',

    CALLBACK_REPLAY:
        'AIRTEL_CALLBACK_REPLAY',

    CALLBACK_DUPLICATE:
        'AIRTEL_CALLBACK_DUPLICATE',

    CALLBACK_PROCESSING_FAILED:
        'AIRTEL_CALLBACK_PROCESSING_FAILED',

    IDEMPOTENCY_KEY_REQUIRED:
        'AIRTEL_IDEMPOTENCY_KEY_REQUIRED',

    IDEMPOTENCY_CONFLICT:
        'AIRTEL_IDEMPOTENCY_CONFLICT',

    IDEMPOTENCY_IN_PROGRESS:
        'AIRTEL_IDEMPOTENCY_IN_PROGRESS',

    CONCURRENCY_CONFLICT:
        'AIRTEL_CONCURRENCY_CONFLICT',

    STATE_TRANSITION_INVALID:
        'AIRTEL_STATE_TRANSITION_INVALID',

    STATE_CONFLICT:
        'AIRTEL_STATE_CONFLICT',

    RECONCILIATION_FAILED:
        'AIRTEL_RECONCILIATION_FAILED',

    RECONCILIATION_VARIANCE:
        'AIRTEL_RECONCILIATION_VARIANCE',

    RECONCILIATION_REQUIRED:
        'AIRTEL_RECONCILIATION_REQUIRED',

    SETTLEMENT_INVALID:
        'AIRTEL_SETTLEMENT_INVALID',

    SETTLEMENT_NOT_FOUND:
        'AIRTEL_SETTLEMENT_NOT_FOUND',

    SETTLEMENT_NOT_SETTLEABLE:
        'AIRTEL_SETTLEMENT_NOT_SETTLEABLE',

    SETTLEMENT_VARIANCE:
        'AIRTEL_SETTLEMENT_VARIANCE',

    SETTLEMENT_FAILED:
        'AIRTEL_SETTLEMENT_FAILED',

    FINANCIAL_POSTING_FAILED:
        'AIRTEL_FINANCIAL_POSTING_FAILED',

    FINANCIAL_BOUNDARY_UNAVAILABLE:
        'AIRTEL_FINANCIAL_BOUNDARY_UNAVAILABLE',

    RATE_LIMITED:
        'AIRTEL_RATE_LIMITED',

    PROVIDER_BAD_REQUEST:
        'AIRTEL_PROVIDER_BAD_REQUEST',

    PROVIDER_UNAUTHORIZED:
        'AIRTEL_PROVIDER_UNAUTHORIZED',

    PROVIDER_FORBIDDEN:
        'AIRTEL_PROVIDER_FORBIDDEN',

    PROVIDER_NOT_FOUND:
        'AIRTEL_PROVIDER_NOT_FOUND',

    PROVIDER_CONFLICT:
        'AIRTEL_PROVIDER_CONFLICT',

    PROVIDER_UNPROCESSABLE:
        'AIRTEL_PROVIDER_UNPROCESSABLE',

    PROVIDER_SERVER_ERROR:
        'AIRTEL_PROVIDER_SERVER_ERROR',

    PROVIDER_UNAVAILABLE:
        'AIRTEL_PROVIDER_UNAVAILABLE',

    PROVIDER_UNKNOWN:
        'AIRTEL_PROVIDER_UNKNOWN',

    RESPONSE_INVALID:
        'AIRTEL_PROVIDER_RESPONSE_INVALID'
});


/**
 * ============================================================================
 * HTTP Status Mapping
 * ============================================================================
 */
const HTTP_STATUS = Object.freeze({
    VALIDATION:
        400,

    AUTHENTICATION:
        401,

    AUTHORIZATION:
        403,

    NOT_FOUND:
        404,

    CONFLICT:
        409,

    UNPROCESSABLE:
        422,

    RATE_LIMIT:
        429,

    INTERNAL:
        500,

    PROVIDER_UNAVAILABLE:
        503,

    TIMEOUT:
        504
});


/**
 * ============================================================================
 * Retry Classification
 * ============================================================================
 */
const RETRY_CLASS = Object.freeze({
    NEVER:
        'NEVER',

    SAFE:
        'SAFE',

    CONDITIONAL:
        'CONDITIONAL',

    UNKNOWN:
        'UNKNOWN'
});


const RETRYABLE_CATEGORIES = new Set([
    ERROR_CATEGORY.NETWORK,
    ERROR_CATEGORY.TIMEOUT,
    ERROR_CATEGORY.DEPENDENCY,
    ERROR_CATEGORY.RATE_LIMIT
]);


const NON_RETRYABLE_CODES = new Set([
    ERROR_CODE.CREDENTIALS_INVALID,
    ERROR_CODE.AUTHORIZATION_FAILED,
    ERROR_CODE.TENANT_FORBIDDEN,
    ERROR_CODE.COLLECTION_INVALID,
    ERROR_CODE.DISBURSEMENT_INVALID,
    ERROR_CODE.CALLBACK_SIGNATURE_INVALID,
    ERROR_CODE.CALLBACK_REPLAY,
    ERROR_CODE.IDEMPOTENCY_CONFLICT,
    ERROR_CODE.STATE_TRANSITION_INVALID,
    ERROR_CODE.RECONCILIATION_VARIANCE,
    ERROR_CODE.SETTLEMENT_VARIANCE,
    ERROR_CODE.FINANCIAL_POSTING_FAILED
]);


/**
 * ============================================================================
 * Sensitive Data Utilities
 * ============================================================================
 */
const SENSITIVE_KEYS = new Set([
    'authorization',
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
    'credentials',
    'privateKey',
    'private_key'
]);


function isObject(value) {
    return (
        value !== null &&
        typeof value === 'object'
    );
}


function isFunction(value) {
    return typeof value === 'function';
}


function boundedString(
    value,
    maxLength = 2_000
) {
    if (
        value === undefined ||
        value === null
    ) {
        return undefined;
    }

    return String(value)
        .replace(
            /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
            ' '
        )
        .slice(
            0,
            maxLength
        );
}


function sanitizeValue(
    value,
    depth = 0
) {
    if (
        depth > 5
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
        typeof value === 'string'
    ) {
        return boundedString(
            value,
            2_000
        );
    }

    if (
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        return value;
    }

    if (
        value instanceof Error
    ) {
        return {
            name:
                value.name,
            code:
                value.code,
            message:
                boundedString(
                    value.message
                )
        };
    }

    if (
        Buffer.isBuffer(value)
    ) {
        return '[BUFFER_REDACTED]';
    }

    if (
        Array.isArray(value)
    ) {
        return value
            .slice(
                0,
                100
            )
            .map(
                item =>
                    sanitizeValue(
                        item,
                        depth + 1
                    )
            );
    }

    if (
        isObject(value)
    ) {
        const output = {};

        for (
            const [
                key,
                item
            ] of Object.entries(value)
        ) {
            if (
                SENSITIVE_KEYS.has(
                    key
                ) ||
                SENSITIVE_KEYS.has(
                    String(key)
                        .toLowerCase()
                )
            ) {
                output[key] =
                    '[REDACTED]';

                continue;
            }

            output[key] =
                sanitizeValue(
                    item,
                    depth + 1
                );
        }

        return output;
    }

    return boundedString(
        value
    );
}


function generateCorrelationId() {
    return crypto.randomUUID();
}


/**
 * ============================================================================
 * Base Airtel Error
 * ============================================================================
 */
class AirtelError extends Error {

    constructor(
        message,
        {
            code =
                ERROR_CODE.UNKNOWN,

            category =
                ERROR_CATEGORY.UNKNOWN,

            statusCode,

            retryable = false,

            retryClass =
                RETRY_CLASS.NEVER,

            provider =
                PROVIDER,

            providerCode,

            providerStatus,

            providerReference,

            tenantId,

            correlationId,

            operationId,

            requestId,

            idempotencyKey,

            details = {},

            cause,

            expose = false,

            safeMessage
        } = {}
    ) {
        super(
            boundedString(
                message ||
                'Airtel error'
            )
        );

        this.name =
            this.constructor.name;

        this.code =
            code;

        this.category =
            category;

        this.statusCode =
            statusCode ||
            inferHttpStatus({
                code,
                category
            });

        this.retryable =
            Boolean(
                retryable
            );

        this.retryClass =
            retryClass;

        this.provider =
            provider;

        this.providerCode =
            boundedString(
                providerCode,
                256
            );

        this.providerStatus =
            boundedString(
                providerStatus,
                128
            );

        this.providerReference =
            boundedString(
                providerReference,
                256
            );

        this.tenantId =
            tenantId !== undefined &&
            tenantId !== null
                ? String(tenantId)
                : undefined;

        this.correlationId =
            correlationId ||
            generateCorrelationId();

        this.operationId =
            operationId;

        this.requestId =
            requestId;

        this.idempotencyKey =
            idempotencyKey;

        this.details =
            sanitizeValue(
                details
            );

        this.expose =
            Boolean(
                expose
            );

        this.safeMessage =
            boundedString(
                safeMessage ||
                message ||
                'Payment operation failed'
            );

        if (
            cause
        ) {
            this.cause =
                cause;
        }

        if (
            Error.captureStackTrace
        ) {
            Error.captureStackTrace(
                this,
                this.constructor
            );
        }
    }


    /**
     * ------------------------------------------------------------------------
     * Public/API-safe representation
     * ------------------------------------------------------------------------
     */
    toJSON({
        includeDetails = true,
        includeProvider = false,
        includeInternal = false
    } = {}) {
        const result = {
            name:
                this.name,

            code:
                this.code,

            category:
                this.category,

            message:
                this.expose
                    ? this.safeMessage
                    : this.safeMessage,

            statusCode:
                this.statusCode,

            retryable:
                this.retryable,

            retryClass:
                this.retryClass,

            provider:
                this.provider,

            correlationId:
                this.correlationId
        };

        if (
            this.tenantId
        ) {
            result.tenantId =
                this.tenantId;
        }

        if (
            this.operationId
        ) {
            result.operationId =
                this.operationId;
        }

        if (
            this.requestId
        ) {
            result.requestId =
                this.requestId;
        }

        if (
            this.idempotencyKey &&
            includeInternal
        ) {
            result.idempotencyKey =
                this.idempotencyKey;
        }

        if (
            includeProvider
        ) {
            if (
                this.providerCode
            ) {
                result.providerCode =
                    this.providerCode;
            }

            if (
                this.providerStatus
            ) {
                result.providerStatus =
                    this.providerStatus;
            }

            if (
                this.providerReference
            ) {
                result.providerReference =
                    this.providerReference;
            }
        }

        if (
            includeDetails &&
            this.details &&
            Object.keys(
                this.details
            ).length
        ) {
            result.details =
                this.details;
        }

        return result;
    }


    /**
     * ------------------------------------------------------------------------
     * Internal representation
     * ------------------------------------------------------------------------
     */
    toInternalJSON() {
        return this.toJSON({
            includeDetails:
                true,

            includeProvider:
                true,

            includeInternal:
                true
        });
    }


    isRetryable() {
        return this.retryable;
    }


    isOperational() {
        return [
            ERROR_CATEGORY.NETWORK,
            ERROR_CATEGORY.TIMEOUT,
            ERROR_CATEGORY.DEPENDENCY,
            ERROR_CATEGORY.RATE_LIMIT,
            ERROR_CATEGORY.PROVIDER
        ].includes(
            this.category
        );
    }


    isFinancial() {
        return [
            ERROR_CATEGORY.FINANCIAL,
            ERROR_CATEGORY.SETTLEMENT,
            ERROR_CATEGORY.RECONCILIATION
        ].includes(
            this.category
        );
    }
}


/**
 * ============================================================================
 * Validation Error
 * ============================================================================
 */
class AirtelValidationError
    extends AirtelError {

    constructor(
        message,
        options = {}
    ) {
        super(
            message,
            {
                ...options,

                code:
                    options.code ||
                    ERROR_CODE.REQUEST_INVALID,

                category:
                    ERROR_CATEGORY.VALIDATION,

                statusCode:
                    options.statusCode ||
                    HTTP_STATUS.VALIDATION,

                retryable:
                    false,

                retryClass:
                    RETRY_CLASS.NEVER,

                expose:
                    options.expose !== false
            }
        );
    }
}


/**
 * ============================================================================
 * Configuration Error
 * ============================================================================
 */
class AirtelConfigurationError
    extends AirtelError {

    constructor(
        message,
        options = {}
    ) {
        super(
            message,
            {
                ...options,

                code:
                    options.code ||
                    ERROR_CODE.CONFIGURATION_INVALID,

                category:
                    ERROR_CATEGORY.CONFIGURATION,

                statusCode:
                    options.statusCode ||
                    HTTP_STATUS.INTERNAL,

                retryable:
                    false,

                retryClass:
                    RETRY_CLASS.NEVER,

                expose:
                    false
            }
        );
    }
}


/**
 * ============================================================================
 * Authentication Error
 * ============================================================================
 */
class AirtelAuthenticationError
    extends AirtelError {

    constructor(
        message,
        options = {}
    ) {
        super(
            message,
            {
                ...options,

                code:
                    options.code ||
                    ERROR_CODE.AUTHENTICATION_FAILED,

                category:
                    ERROR_CATEGORY.AUTHENTICATION,

                statusCode:
                    options.statusCode ||
                    HTTP_STATUS.AUTHENTICATION,

                retryable:
                    options.retryable ??
                    false,

                retryClass:
                    options.retryClass ||
                    RETRY_CLASS.NEVER,

                expose:
                    options.expose !== false
            }
        );
    }
}


/**
 * ============================================================================
 * Authorization Error
 * ============================================================================
 */
class AirtelAuthorizationError
    extends AirtelError {

    constructor(
        message,
        options = {}
    ) {
        super(
            message,
            {
                ...options,

                code:
                    options.code ||
                    ERROR_CODE.AUTHORIZATION_FAILED,

                category:
                    ERROR_CATEGORY.AUTHORIZATION,

                statusCode:
                    options.statusCode ||
                    HTTP_STATUS.AUTHORIZATION,

                retryable:
                    false,

                retryClass:
                    RETRY_CLASS.NEVER,

                expose:
                    options.expose !== false
            }
        );
    }
}


/**
 * ============================================================================
 * Network Error
 * ============================================================================
 */
class AirtelNetworkError
    extends AirtelError {

    constructor(
        message,
        options = {}
    ) {
        super(
            message,
            {
                ...options,

                code:
                    options.code ||
                    ERROR_CODE.NETWORK_FAILURE,

                category:
                    ERROR_CATEGORY.NETWORK,

                statusCode:
                    options.statusCode ||
                    HTTP_STATUS.PROVIDER_UNAVAILABLE,

                retryable:
                    true,

                retryClass:
                    options.retryClass ||
                    RETRY_CLASS.CONDITIONAL,

                expose:
                    false
            }
        );
    }
}


/**
 * ============================================================================
 * Timeout Error
 * ============================================================================
 */
class AirtelTimeoutError
    extends AirtelError {

    constructor(
        message,
        options = {}
    ) {
        super(
            message,
            {
                ...options,

                code:
                    options.code ||
                    ERROR_CODE.REQUEST_TIMEOUT,

                category:
                    ERROR_CATEGORY.TIMEOUT,

                statusCode:
                    options.statusCode ||
                    HTTP_STATUS.TIMEOUT,

                retryable:
                    options.retryable ??
                    true,

                retryClass:
                    options.retryClass ||
                    RETRY_CLASS.CONDITIONAL,

                expose:
                    false
            }
        );
    }
}


/**
 * ============================================================================
 * Provider Error
 * ============================================================================
 */
class AirtelProviderError
    extends AirtelError {

    constructor(
        message,
        options = {}
    ) {
        const httpStatus =
            options.statusCode ||
            options.providerStatusCode;

        super(
            message,
            {
                ...options,

                code:
                    options.code ||
                    mapProviderStatusToCode(
                        httpStatus
                    ),

                category:
                    ERROR_CATEGORY.PROVIDER,

                statusCode:
                    httpStatus ||
                    HTTP_STATUS.PROVIDER_UNAVAILABLE,

                retryable:
                    options.retryable ??
                    isRetryableProviderStatus(
                        httpStatus
                    ),

                retryClass:
                    options.retryClass ||
                    (
                        isRetryableProviderStatus(
                            httpStatus
                        )
                            ? RETRY_CLASS.CONDITIONAL
                            : RETRY_CLASS.NEVER
                    ),

                expose:
                    options.expose === true
            }
        );
    }
}


/**
 * ============================================================================
 * Idempotency Error
 * ============================================================================
 */
class AirtelIdempotencyError
    extends AirtelError {

    constructor(
        message,
        options = {}
    ) {
        super(
            message,
            {
                ...options,

                code:
                    options.code ||
                    ERROR_CODE.IDEMPOTENCY_CONFLICT,

                category:
                    ERROR_CATEGORY.IDEMPOTENCY,

                statusCode:
                    options.statusCode ||
                    HTTP_STATUS.CONFLICT,

                retryable:
                    options.retryable ??
                    false,

                retryClass:
                    RETRY_CLASS.NEVER,

                expose:
                    options.expose !== false
            }
        );
    }
}


/**
 * ============================================================================
 * Reconciliation Error
 * ============================================================================
 */
class AirtelReconciliationError
    extends AirtelError {

    constructor(
        message,
        options = {}
    ) {
        super(
            message,
            {
                ...options,

                code:
                    options.code ||
                    ERROR_CODE.RECONCILIATION_FAILED,

                category:
                    ERROR_CATEGORY.RECONCILIATION,

                statusCode:
                    options.statusCode ||
                    HTTP_STATUS.CONFLICT,

                retryable:
                    options.retryable ??
                    false,

                retryClass:
                    RETRY_CLASS.NEVER,

                expose:
                    options.expose !== false
            }
        );
    }
}


/**
 * ============================================================================
 * Settlement Error
 * ============================================================================
 *
 * Preserved as a named compatibility class because settlement modules already
 * import/throw SettlementError.
 */
class SettlementError
    extends AirtelError {

    constructor(
        message,
        options = {}
    ) {
        super(
            message,
            {
                ...options,

                code:
                    options.code ||
                    ERROR_CODE.SETTLEMENT_FAILED,

                category:
                    ERROR_CATEGORY.SETTLEMENT,

                statusCode:
                    options.statusCode ||
                    HTTP_STATUS.CONFLICT,

                retryable:
                    options.retryable ??
                    false,

                retryClass:
                    options.retryClass ||
                    RETRY_CLASS.NEVER,

                expose:
                    options.expose !== false
            }
        );
    }
}


/**
 * ============================================================================
 * Financial Error
 * ============================================================================
 */
class AirtelFinancialError
    extends AirtelError {

    constructor(
        message,
        options = {}
    ) {
        super(
            message,
            {
                ...options,

                code:
                    options.code ||
                    ERROR_CODE.FINANCIAL_POSTING_FAILED,

                category:
                    ERROR_CATEGORY.FINANCIAL,

                statusCode:
                    options.statusCode ||
                    HTTP_STATUS.CONFLICT,

                /**
                 * Financial posting failures must not be blindly retried by
                 * the error layer. The canonical financial service decides
                 * whether the specific operation is safely retryable.
                 */
                retryable:
                    options.retryable ??
                    false,

                retryClass:
                    options.retryClass ||
                    RETRY_CLASS.CONDITIONAL,

                expose:
                    false
            }
        );
    }
}


/**
 * ============================================================================
 * State / Concurrency Errors
 * ============================================================================
 */
class AirtelStateError
    extends AirtelError {

    constructor(
        message,
        options = {}
    ) {
        super(
            message,
            {
                ...options,

                code:
                    options.code ||
                    ERROR_CODE.STATE_CONFLICT,

                category:
                    ERROR_CATEGORY.STATE,

                statusCode:
                    options.statusCode ||
                    HTTP_STATUS.CONFLICT,

                retryable:
                    options.retryable ??
                    false,

                retryClass:
                    options.retryClass ||
                    RETRY_CLASS.CONDITIONAL,

                expose:
                    options.expose !== false
            }
        );
    }
}


class AirtelConcurrencyError
    extends AirtelError {

    constructor(
        message,
        options = {}
    ) {
        super(
            message,
            {
                ...options,

                code:
                    options.code ||
                    ERROR_CODE.CONCURRENCY_CONFLICT,

                category:
                    ERROR_CATEGORY.CONCURRENCY,

                statusCode:
                    options.statusCode ||
                    HTTP_STATUS.CONFLICT,

                retryable:
                    options.retryable ??
                    true,

                retryClass:
                    RETRY_CLASS.CONDITIONAL,

                expose:
                    options.expose !== false
            }
        );
    }
}


/**
 * ============================================================================
 * Callback Error
 * ============================================================================
 */
class AirtelCallbackError
    extends AirtelError {

    constructor(
        message,
        options = {}
    ) {
        super(
            message,
            {
                ...options,

                code:
                    options.code ||
                    ERROR_CODE.CALLBACK_PROCESSING_FAILED,

                category:
                    ERROR_CATEGORY.CALLBACK,

                statusCode:
                    options.statusCode ||
                    HTTP_STATUS.UNPROCESSABLE,

                retryable:
                    options.retryable ??
                    false,

                retryClass:
                    options.retryClass ||
                    RETRY_CLASS.CONDITIONAL,

                expose:
                    options.expose !== false
            }
        );
    }
}


/**
 * ============================================================================
 * Error Construction Helpers
 * ============================================================================
 */
function inferHttpStatus({
    code,
    category
}) {
    if (
        [
            ERROR_CATEGORY.VALIDATION,
            ERROR_CATEGORY.CALLBACK
        ].includes(
            category
        )
    ) {
        return category ===
            ERROR_CATEGORY.CALLBACK
            ? HTTP_STATUS.UNPROCESSABLE
            : HTTP_STATUS.VALIDATION;
    }

    if (
        category ===
        ERROR_CATEGORY.AUTHENTICATION
    ) {
        return HTTP_STATUS.AUTHENTICATION;
    }

    if (
        category ===
        ERROR_CATEGORY.AUTHORIZATION
    ) {
        return HTTP_STATUS.AUTHORIZATION;
    }

    if (
        category ===
            ERROR_CATEGORY.IDEMPOTENCY ||
        category ===
            ERROR_CATEGORY.CONCURRENCY ||
        category ===
            ERROR_CATEGORY.STATE ||
        category ===
            ERROR_CATEGORY.SETTLEMENT ||
        category ===
            ERROR_CATEGORY.RECONCILIATION ||
        category ===
            ERROR_CATEGORY.FINANCIAL
    ) {
        return HTTP_STATUS.CONFLICT;
    }

    if (
        category ===
        ERROR_CATEGORY.RATE_LIMIT
    ) {
        return HTTP_STATUS.RATE_LIMIT;
    }

    if (
        category ===
        ERROR_CATEGORY.TIMEOUT
    ) {
        return HTTP_STATUS.TIMEOUT;
    }

    if (
        category ===
        ERROR_CATEGORY.NETWORK ||
        category ===
        ERROR_CATEGORY.DEPENDENCY
    ) {
        return HTTP_STATUS.PROVIDER_UNAVAILABLE;
    }

    return HTTP_STATUS.INTERNAL;
}


function mapProviderStatusToCode(
    statusCode
) {
    const status =
        Number(
            statusCode
        );

    if (
        status === 400
    ) {
        return ERROR_CODE.PROVIDER_BAD_REQUEST;
    }

    if (
        status === 401
    ) {
        return ERROR_CODE.PROVIDER_UNAUTHORIZED;
    }

    if (
        status === 403
    ) {
        return ERROR_CODE.PROVIDER_FORBIDDEN;
    }

    if (
        status === 404
    ) {
        return ERROR_CODE.PROVIDER_NOT_FOUND;
    }

    if (
        status === 409
    ) {
        return ERROR_CODE.PROVIDER_CONFLICT;
    }

    if (
        status === 422
    ) {
        return ERROR_CODE.PROVIDER_UNPROCESSABLE;
    }

    if (
        status === 429
    ) {
        return ERROR_CODE.RATE_LIMITED;
    }

    if (
        status >= 500 &&
        status <= 599
    ) {
        return ERROR_CODE.PROVIDER_SERVER_ERROR;
    }

    return ERROR_CODE.PROVIDER_UNKNOWN;
}


function isRetryableProviderStatus(
    statusCode
) {
    const status =
        Number(
            statusCode
        );

    return (
        status === 408 ||
        status === 425 ||
        status === 429 ||
        (
            status >= 500 &&
            status <= 599
        )
    );
}


function inferRetryClass({
    category,
    code,
    retryable
}) {
    if (
        retryable === false
    ) {
        return RETRY_CLASS.NEVER;
    }

    if (
        code &&
        NON_RETRYABLE_CODES.has(
            code
        )
    ) {
        return RETRY_CLASS.NEVER;
    }

    if (
        category ===
            ERROR_CATEGORY.RATE_LIMIT ||
        category ===
            ERROR_CATEGORY.NETWORK ||
        category ===
            ERROR_CATEGORY.TIMEOUT
    ) {
        return RETRY_CLASS.CONDITIONAL;
    }

    if (
        category ===
            ERROR_CATEGORY.DEPENDENCY
    ) {
        return RETRY_CLASS.CONDITIONAL;
    }

    if (
        retryable
    ) {
        return RETRY_CLASS.SAFE;
    }

    return RETRY_CLASS.UNKNOWN;
}


/**
 * ============================================================================
 * Normalize Unknown Errors
 * ============================================================================
 *
 * This function is the preferred integration boundary for catch blocks.
 */
function normalizeError(
    error,
    context = {}
) {
    if (
        error instanceof AirtelError
    ) {
        return enrichError(
            error,
            context
        );
    }

    const source =
        error || {};

    const code =
        source.code ||
        inferErrorCode(
            source
        );

    const category =
        inferErrorCategory({
            error:
                source,
            code
        });

    const retryable =
        typeof source.retryable === 'boolean'
            ? source.retryable
            : inferRetryable({
                source,
                category,
                code
            });

    const retryClass =
        source.retryClass ||
        inferRetryClass({
            category,
            code,
            retryable
        });

    const normalized =
        new AirtelError(
            boundedString(
                source.message ||
                'Airtel payment operation failed'
            ),
            {
                code,

                category,

                statusCode:
                    source.statusCode ||
                    source.status,

                retryable,

                retryClass,

                provider:
                    context.provider ||
                    source.provider ||
                    PROVIDER,

                providerCode:
                    source.providerCode,

                providerStatus:
                    source.providerStatus,

                providerReference:
                    source.providerReference,

                tenantId:
                    context.tenantId ||
                    source.tenantId,

                correlationId:
                    context.correlationId ||
                    source.correlationId ||
                    generateCorrelationId(),

                operationId:
                    context.operationId ||
                    source.operationId,

                requestId:
                    context.requestId ||
                    source.requestId,

                idempotencyKey:
                    context.idempotencyKey ||
                    source.idempotencyKey,

                details: {
                    ...sanitizeValue(
                        context.details
                    ),
                    ...sanitizeValue(
                        source.details
                    )
                },

                cause:
                    error,

                expose:
                    isPublicSafeCode(
                        code
                    ),

                safeMessage:
                    publicMessageFor(
                        code
                    )
            }
        );

    return normalized;
}


function enrichError(
    error,
    context = {}
) {
    if (
        context.provider &&
        !error.provider
    ) {
        error.provider =
            context.provider;
    }

    if (
        context.tenantId &&
        !error.tenantId
    ) {
        error.tenantId =
            context.tenantId;
    }

    if (
        context.correlationId &&
        !error.correlationId
    ) {
        error.correlationId =
            context.correlationId;
    }

    if (
        context.operationId &&
        !error.operationId
    ) {
        error.operationId =
            context.operationId;
    }

    if (
        context.requestId &&
        !error.requestId
    ) {
        error.requestId =
            context.requestId;
    }

    if (
        context.idempotencyKey &&
        !error.idempotencyKey
    ) {
        error.idempotencyKey =
            context.idempotencyKey;
    }

    return error;
}


/**
 * ============================================================================
 * Error Inference
 * ============================================================================
 */
function inferErrorCode(
    error
) {
    const name =
        String(
            error?.name || ''
        )
            .toLowerCase();

    const code =
        String(
            error?.code || ''
        )
            .toUpperCase();

    if (
        code.includes('ETIMEDOUT') ||
        name.includes('timeout')
    ) {
        return ERROR_CODE.REQUEST_TIMEOUT;
    }

    if (
        [
            'ECONNRESET',
            'ECONNREFUSED',
            'ENETUNREACH',
            'EHOSTUNREACH',
            'EAI_AGAIN'
        ].includes(
            code
        )
    ) {
        return ERROR_CODE.NETWORK_FAILURE;
    }

    if (
        code === 'ENOTFOUND'
    ) {
        return ERROR_CODE.DNS_FAILURE;
    }

    if (
        code.includes('CERT') ||
        code.includes('TLS')
    ) {
        return ERROR_CODE.TLS_FAILURE;
    }

    if (
        Number(
            error?.statusCode ||
            error?.status
        ) >= 500
    ) {
        return ERROR_CODE.PROVIDER_SERVER_ERROR;
    }

    if (
        Number(
            error?.statusCode ||
            error?.status
        ) === 429
    ) {
        return ERROR_CODE.RATE_LIMITED;
    }

    if (
        Number(
            error?.statusCode ||
            error?.status
        ) === 401
    ) {
        return ERROR_CODE.PROVIDER_UNAUTHORIZED;
    }

    if (
        Number(
            error?.statusCode ||
            error?.status
        ) === 403
    ) {
        return ERROR_CODE.PROVIDER_FORBIDDEN;
    }

    return ERROR_CODE.INTERNAL;
}


function inferErrorCategory({
    error,
    code
}) {
    if (
        code === ERROR_CODE.REQUEST_TIMEOUT
    ) {
        return ERROR_CATEGORY.TIMEOUT;
    }

    if (
        code === ERROR_CODE.RATE_LIMITED
    ) {
        return ERROR_CATEGORY.RATE_LIMIT;
    }

    if (
        [
            ERROR_CODE.NETWORK_FAILURE,
            ERROR_CODE.DNS_FAILURE,
            ERROR_CODE.TLS_FAILURE
        ].includes(
            code
        )
    ) {
        return ERROR_CATEGORY.NETWORK;
    }

    if (
        String(code)
            .includes(
                'AUTHENTICATION'
            ) ||
        String(code)
            .includes(
                'ACCESS_TOKEN'
            ) ||
        String(code)
            .includes(
                'CREDENTIAL'
            )
    ) {
        return ERROR_CATEGORY.AUTHENTICATION;
    }

    if (
        String(code)
            .includes(
                'AUTHORIZATION'
            ) ||
        String(code)
            .includes(
                'FORBIDDEN'
            )
    ) {
        return ERROR_CATEGORY.AUTHORIZATION;
    }

    if (
        String(code)
            .includes(
                'CALLBACK'
            )
    ) {
        return ERROR_CATEGORY.CALLBACK;
    }

    if (
        String(code)
            .includes(
                'IDEMPOTENCY'
            )
    ) {
        return ERROR_CATEGORY.IDEMPOTENCY;
    }

    if (
        String(code)
            .includes(
                'RECONCILIATION'
            )
    ) {
        return ERROR_CATEGORY.RECONCILIATION;
    }

    if (
        String(code)
            .includes(
                'SETTLEMENT'
            )
    ) {
        return ERROR_CATEGORY.SETTLEMENT;
    }

    if (
        String(code)
            .includes(
                'FINANCIAL'
            )
    ) {
        return ERROR_CATEGORY.FINANCIAL;
    }

    if (
        String(code)
            .includes(
                'STATE'
            )
    ) {
        return ERROR_CATEGORY.STATE;
    }

    if (
        String(code)
            .includes(
                'CONCURRENCY'
            )
    ) {
        return ERROR_CATEGORY.CONCURRENCY;
    }

    if (
        String(code)
            .includes(
                'CONFIGURATION'
            ) ||
        String(code)
            .includes(
                'ENDPOINT'
            )
    ) {
        return ERROR_CATEGORY.CONFIGURATION;
    }

    if (
        error?.provider ||
        String(code)
            .includes(
                'PROVIDER'
            )
    ) {
        return ERROR_CATEGORY.PROVIDER;
    }

    if (
        error?.dependency ||
        String(code)
            .includes(
                'DEPENDENCY'
            )
    ) {
        return ERROR_CATEGORY.DEPENDENCY;
    }

    return ERROR_CATEGORY.INTERNAL;
}


function inferRetryable({
    source,
    category,
    code
}) {
    if (
        NON_RETRYABLE_CODES.has(
            code
        )
    ) {
        return false;
    }

    if (
        typeof source.retryable === 'boolean'
    ) {
        return source.retryable;
    }

    if (
        RETRYABLE_CATEGORIES.has(
            category
        )
    ) {
        return true;
    }

    return isRetryableProviderStatus(
        source.statusCode ||
        source.status
    );
}


function isPublicSafeCode(
    code
) {
    return [
        ERROR_CODE.REQUEST_INVALID,
        ERROR_CODE.TENANT_REQUIRED,
        ERROR_CODE.TENANT_FORBIDDEN,
        ERROR_CODE.AUTHORIZATION_FAILED,
        ERROR_CODE.COLLECTION_INVALID,
        ERROR_CODE.COLLECTION_NOT_FOUND,
        ERROR_CODE.DISBURSEMENT_INVALID,
        ERROR_CODE.DISBURSEMENT_NOT_FOUND,
        ERROR_CODE.CALLBACK_INVALID,
        ERROR_CODE.CALLBACK_SIGNATURE_INVALID,
        ERROR_CODE.CALLBACK_REPLAY,
        ERROR_CODE.CALLBACK_DUPLICATE,
        ERROR_CODE.IDEMPOTENCY_KEY_REQUIRED,
        ERROR_CODE.IDEMPOTENCY_CONFLICT,
        ERROR_CODE.IDEMPOTENCY_IN_PROGRESS,
        ERROR_CODE.SETTLEMENT_NOT_FOUND,
        ERROR_CODE.SETTLEMENT_NOT_SETTLEABLE,
        ERROR_CODE.RECONCILIATION_REQUIRED
    ].includes(
        code
    );
}


function publicMessageFor(
    code
) {
    const messages = {
        [ERROR_CODE.REQUEST_INVALID]:
            'The Airtel payment request is invalid.',

        [ERROR_CODE.TENANT_REQUIRED]:
            'Tenant context is required.',

        [ERROR_CODE.TENANT_FORBIDDEN]:
            'The operation is not permitted for this tenant.',

        [ERROR_CODE.AUTHORIZATION_FAILED]:
            'The operation is not authorized.',

        [ERROR_CODE.COLLECTION_INVALID]:
            'The Airtel collection request is invalid.',

        [ERROR_CODE.COLLECTION_NOT_FOUND]:
            'The Airtel collection could not be found.',

        [ERROR_CODE.DISBURSEMENT_INVALID]:
            'The Airtel disbursement request is invalid.',

        [ERROR_CODE.DISBURSEMENT_NOT_FOUND]:
            'The Airtel disbursement could not be found.',

        [ERROR_CODE.CALLBACK_INVALID]:
            'The Airtel callback is invalid.',

        [ERROR_CODE.CALLBACK_SIGNATURE_INVALID]:
            'The Airtel callback signature is invalid.',

        [ERROR_CODE.CALLBACK_REPLAY]:
            'The Airtel callback has already been processed or rejected as a replay.',

        [ERROR_CODE.CALLBACK_DUPLICATE]:
            'The Airtel callback has already been processed.',

        [ERROR_CODE.IDEMPOTENCY_KEY_REQUIRED]:
            'An idempotency key is required.',

        [ERROR_CODE.IDEMPOTENCY_CONFLICT]:
            'The request conflicts with an existing operation.',

        [ERROR_CODE.IDEMPOTENCY_IN_PROGRESS]:
            'An equivalent operation is already in progress.',

        [ERROR_CODE.SETTLEMENT_NOT_FOUND]:
            'The settlement could not be found.',

        [ERROR_CODE.SETTLEMENT_NOT_SETTLEABLE]:
            'The settlement is not currently eligible for completion.',

        [ERROR_CODE.RECONCILIATION_REQUIRED]:
            'The transaction requires reconciliation before completion.'
    };

    return (
        messages[code] ||
        'The Airtel payment operation could not be completed.'
    );
}


/**
 * ============================================================================
 * Provider Error Normalization
 * ============================================================================
 */
function normalizeProviderError(
    error,
    {
        tenantId,
        correlationId,
        operationId,
        requestId,
        idempotencyKey,
        providerReference
    } = {}
) {
    if (
        error instanceof AirtelProviderError
    ) {
        return enrichError(
            error,
            {
                tenantId,
                correlationId,
                operationId,
                requestId,
                idempotencyKey,
                provider:
                    PROVIDER
            }
        );
    }

    const statusCode =
        Number(
            error?.statusCode ??
            error?.status ??
            error?.response?.status ??
            error?.response?.statusCode
        ) || undefined;

    const responseBody =
        error?.response?.body ??
        error?.response?.data ??
        error?.body ??
        error?.data;

    const providerCode =
        extractProviderCode(
            responseBody
        ) ||
        error?.providerCode;

    const providerMessage =
        extractProviderMessage(
            responseBody
        );

    const providerStatus =
        extractProviderStatus(
            responseBody
        );

    const normalizedCode =
        mapProviderStatusToCode(
            statusCode
        );

    return new AirtelProviderError(
        boundedString(
            providerMessage ||
            error?.message ||
            'Airtel provider request failed'
        ),
        {
            code:
                normalizedCode,

            statusCode,

            providerCode,

            providerStatus,

            providerReference,

            tenantId,

            correlationId,

            operationId,

            requestId,

            idempotencyKey,

            retryable:
                isRetryableProviderStatus(
                    statusCode
                ),

            details: {
                statusCode,
                providerCode,
                providerStatus
            },

            cause:
                error,

            expose:
                false
        }
    );
}


function extractProviderCode(
    body
) {
    if (
        !isObject(body)
    ) {
        return undefined;
    }

    return (
        body.code ||
        body.errorCode ||
        body.error_code ||
        body.statusCode ||
        body.status?.code ||
        body.error?.code ||
        body.error?.errorCode
    );
}


function extractProviderMessage(
    body
) {
    if (
        typeof body === 'string'
    ) {
        return body;
    }

    if (
        !isObject(body)
    ) {
        return undefined;
    }

    return (
        body.message ||
        body.errorDescription ||
        body.error_description ||
        body.description ||
        body.status?.message ||
        body.error?.message
    );
}


function extractProviderStatus(
    body
) {
    if (
        !isObject(body)
    ) {
        return undefined;
    }

    return (
        body.status ||
        body.state ||
        body.resultStatus ||
        body.responseStatus
    );
}


/**
 * ============================================================================
 * Error Classification Helpers
 * ============================================================================
 */
function isRetryableError(
    error
) {
    const normalized =
        normalizeError(
            error
        );

    return normalized.isRetryable();
}


function getRetryClass(
    error
) {
    const normalized =
        normalizeError(
            error
        );

    return normalized.retryClass;
}


function isProviderError(
    error
) {
    return (
        error instanceof AirtelProviderError ||
        normalizeError(
            error
        ).category ===
            ERROR_CATEGORY.PROVIDER
    );
}


function isFinancialError(
    error
) {
    return normalizeError(
        error
    ).isFinancial();
}


function isClientError(
    error
) {
    const normalized =
        normalizeError(
            error
        );

    return (
        normalized.statusCode >= 400 &&
        normalized.statusCode < 500
    );
}


function isServerError(
    error
) {
    const normalized =
        normalizeError(
            error
        );

    return (
        normalized.statusCode >= 500
    );
}


function errorCode(
    error
) {
    return normalizeError(
        error
    ).code;
}


/**
 * ============================================================================
 * Express/API Serialization
 * ============================================================================
 */
function toPublicError(
    error
) {
    const normalized =
        normalizeError(
            error
        );

    return {
        success:
            false,

        error:
            normalized.toJSON({
                includeDetails:
                    false,

                includeProvider:
                    false,

                includeInternal:
                    false
            })
    };
}


/**
 * ============================================================================
 * Logging Serialization
 * ============================================================================
 *
 * Safe for application logging. Provider payloads and credentials remain
 * excluded.
 */
function toLogError(
    error
) {
    const normalized =
        normalizeError(
            error
        );

    return {
        ...normalized.toJSON({
            includeDetails:
                true,

            includeProvider:
                true,

            includeInternal:
                true
        }),

        stack:
            boundedString(
                normalized.stack,
                8_000
            ),

        cause:
            normalized.cause
                ? {
                    name:
                        normalized.cause.name,

                    code:
                        normalized.cause.code,

                    message:
                        boundedString(
                            normalized.cause.message
                        )
                }
                : undefined
    };
}


/**
 * ============================================================================
 * Error Factory
 * ============================================================================
 */
function createError(
    code,
    message,
    options = {}
) {
    const category =
        inferErrorCategory({
            error:
                options,
            code
        });

    const retryable =
        options.retryable ??
        inferRetryable({
            source:
                options,
            category,
            code
        });

    const retryClass =
        options.retryClass ||
        inferRetryClass({
            category,
            code,
            retryable
        });

    const ErrorClass =
        classForCategory(
            category
        );

    return new ErrorClass(
        message,
        {
            ...options,

            code,

            category,

            retryable,

            retryClass
        }
    );
}


function classForCategory(
    category
) {
    switch (
        category
    ) {
        case ERROR_CATEGORY.VALIDATION:
            return AirtelValidationError;

        case ERROR_CATEGORY.CONFIGURATION:
            return AirtelConfigurationError;

        case ERROR_CATEGORY.AUTHENTICATION:
            return AirtelAuthenticationError;

        case ERROR_CATEGORY.AUTHORIZATION:
            return AirtelAuthorizationError;

        case ERROR_CATEGORY.NETWORK:
            return AirtelNetworkError;

        case ERROR_CATEGORY.TIMEOUT:
            return AirtelTimeoutError;

        case ERROR_CATEGORY.PROVIDER:
            return AirtelProviderError;

        case ERROR_CATEGORY.CALLBACK:
            return AirtelCallbackError;

        case ERROR_CATEGORY.IDEMPOTENCY:
            return AirtelIdempotencyError;

        case ERROR_CATEGORY.RECONCILIATION:
            return AirtelReconciliationError;

        case ERROR_CATEGORY.SETTLEMENT:
            return SettlementError;

        case ERROR_CATEGORY.FINANCIAL:
            return AirtelFinancialError;

        case ERROR_CATEGORY.CONCURRENCY:
            return AirtelConcurrencyError;

        case ERROR_CATEGORY.STATE:
            return AirtelStateError;

        default:
            return AirtelError;
    }
}


/**
 * ============================================================================
 * Public Exports
 * ============================================================================
 */
module.exports = {

    PROVIDER,

    ERROR_CATEGORY,

    ERROR_CODE,

    HTTP_STATUS,

    RETRY_CLASS,

    AirtelError,

    AirtelValidationError,

    AirtelConfigurationError,

    AirtelAuthenticationError,

    AirtelAuthorizationError,

    AirtelNetworkError,

    AirtelTimeoutError,

    AirtelProviderError,

    AirtelIdempotencyError,

    AirtelReconciliationError,

    AirtelCallbackError,

    AirtelFinancialError,

    AirtelStateError,

    AirtelConcurrencyError,

    SettlementError,

    normalizeError,

    normalizeProviderError,

    isRetryableError,

    getRetryClass,

    isProviderError,

    isFinancialError,

    isClientError,

    isServerError,

    errorCode,

    toPublicError,

    toLogError,

    createError
};