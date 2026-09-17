'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Airtel Money Enterprise Request Builder
 * ============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/shared/requestBuilder.js
 *
 * Architectural Role
 * ------------------
 * Canonical transport-request construction boundary for Airtel Money
 * integrations.
 *
 * This module converts an application/provider-service request description into
 * a deterministic HTTP request descriptor. It does NOT execute the request.
 *
 * Responsibilities
 * ----------------
 * • Build provider HTTP request descriptors.
 * • Normalize HTTP methods.
 * • Resolve and validate configured endpoints.
 * • Construct safe request URLs and query strings.
 * • Construct deterministic headers.
 * • Propagate correlation, operation and idempotency context.
 * • Support JSON and form-encoded bodies.
 * • Enforce request-size limits.
 * • Preserve monetary strings without floating-point conversion.
 * • Produce safe diagnostic metadata.
 * • Generate request/body fingerprints for observability.
 * • Support provider-specific additional headers without owning business rules.
 *
 * Does NOT:
 * ----------
 * • Execute HTTP/network requests.
 * • Manage OAuth/access tokens.
 * • Refresh credentials.
 * • Implement retries/backoff.
 * • Implement payment collections/disbursements.
 * • Process callbacks.
 * • Reconcile transactions.
 * • Post ledger entries.
 * • Mutate balances.
 * • Store credentials or tokens.
 * • Hard-code undocumented Airtel API payloads.
 *
 * Security Principles
 * -------------------
 * • Authorization credentials are supplied at runtime and redacted from
 *   diagnostics.
 * • Sensitive headers are never returned by diagnostic helpers.
 * • Caller-controlled URLs are rejected unless explicitly permitted by the
 *   configured endpoint policy.
 * • Request bodies are size-limited.
 * • Header values are normalized and validated.
 * • Query parameters are encoded through URLSearchParams.
 * • Raw secrets are never included in fingerprints or logs.
 * • Provider contract details remain configuration-authoritative.
 *
 * Financial Safety
 * ----------------
 * Monetary values are never coerced with Number(), parseFloat() or arithmetic
 * in this module. Request construction preserves the caller's exact monetary
 * representation for canonical financial services to validate.
 *
 * Module Format
 * -------------
 * CommonJS.
 *
 * ============================================================================
 */

const crypto = require('crypto');


const PROVIDER = 'AIRTEL';

const DEFAULTS = Object.freeze({
    timeoutMs: 60_000,
    maxBodyBytes: 1 * 1024 * 1024,
    maxHeaderValueLength: 8_192,
    maxUrlLength: 8_192
});


const HTTP_METHODS = Object.freeze([
    'GET',
    'HEAD',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'OPTIONS'
]);


const CONTENT_TYPES = Object.freeze({
    JSON:
        'application/json',

    FORM:
        'application/x-www-form-urlencoded',

    TEXT:
        'text/plain'
});


const SENSITIVE_HEADERS = new Set([
    'authorization',
    'proxy-authorization',
    'cookie',
    'set-cookie',
    'x-api-key',
    'api-key',
    'x-client-secret',
    'x-secret',
    'x-access-token',
    'x-refresh-token'
]);


const INTERNAL_CONTEXT_HEADERS = Object.freeze({
    TENANT:
        'x-tenant-id',

    CORRELATION:
        'x-correlation-id',

    OPERATION:
        'x-operation-id',

    IDEMPOTENCY:
        'idempotency-key',

    REQUEST_ID:
        'x-request-id'
});


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
    maxLength = 8_192
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


function normalizeMethod(
    method = 'GET'
) {
    const normalized =
        String(method)
            .trim()
            .toUpperCase();

    if (
        !HTTP_METHODS.includes(
            normalized
        )
    ) {
        throw createError(
            'AIRTEL_HTTP_METHOD_INVALID',
            `Unsupported HTTP method: ${method}`
        );
    }

    return normalized;
}


function normalizeHeaderName(
    name
) {
    const value =
        String(name || '')
            .trim()
            .toLowerCase();

    if (
        !value
    ) {
        throw createError(
            'AIRTEL_HEADER_NAME_INVALID',
            'HTTP header name cannot be empty'
        );
    }

    /**
     * RFC-compatible token validation.
     */
    if (
        !/^[!#$%&'*+\-.^_`|~0-9a-z]+$/i.test(
            value
        )
    ) {
        throw createError(
            'AIRTEL_HEADER_NAME_INVALID',
            `Invalid HTTP header name: ${name}`
        );
    }

    return value;
}


function normalizeHeaderValue(
    value,
    maxLength = DEFAULTS.maxHeaderValueLength
) {
    if (
        value === undefined ||
        value === null
    ) {
        return undefined;
    }

    const result =
        String(value);

    if (
        result.length >
        maxLength
    ) {
        throw createError(
            'AIRTEL_HEADER_VALUE_TOO_LARGE',
            'HTTP header value exceeds configured maximum'
        );
    }

    /**
     * Reject CR/LF to prevent header injection.
     */
    if (
        /[\r\n]/.test(
            result
        )
    ) {
        throw createError(
            'AIRTEL_HEADER_INJECTION_BLOCKED',
            'HTTP header value contains prohibited newline characters'
        );
    }

    return result;
}


function normalizeHeaders(
    headers = {},
    {
        maxHeaderValueLength =
            DEFAULTS.maxHeaderValueLength
    } = {}
) {
    if (
        !isObject(headers)
    ) {
        throw createError(
            'AIRTEL_HEADERS_INVALID',
            'HTTP headers must be an object'
        );
    }

    const result = {};

    for (
        const [
            rawName,
            rawValue
        ] of Object.entries(headers)
    ) {
        const name =
            normalizeHeaderName(
                rawName
            );

        const value =
            normalizeHeaderValue(
                rawValue,
                maxHeaderValueLength
            );

        if (
            value === undefined
        ) {
            continue;
        }

        result[name] = value;
    }

    return result;
}


function normalizeQuery(
    query = {}
) {
    if (
        query === null ||
        query === undefined
    ) {
        return {};
    }

    if (
        !isObject(query)
    ) {
        throw createError(
            'AIRTEL_QUERY_INVALID',
            'Query parameters must be an object'
        );
    }

    const result = {};

    for (
        const [
            key,
            value
        ] of Object.entries(query)
    ) {
        if (
            value === undefined ||
            value === null
        ) {
            continue;
        }

        if (
            Array.isArray(value)
        ) {
            result[key] =
                value
                    .filter(
                        item =>
                            item !==
                                undefined &&
                            item !==
                                null
                    )
                    .map(
                        item =>
                            String(item)
                    );

            continue;
        }

        if (
            isObject(value)
        ) {
            /**
             * Query values should be scalar. Objects are serialized only
             * when explicitly represented as JSON strings by the caller.
             */
            throw createError(
                'AIRTEL_QUERY_VALUE_INVALID',
                `Query parameter "${key}" must be scalar or an array`
            );
        }

        result[key] =
            String(value);
    }

    return result;
}


function appendQuery(
    url,
    query
) {
    const normalizedQuery =
        normalizeQuery(
            query
        );

    const params =
        new URLSearchParams();

    for (
        const [
            key,
            value
        ] of Object.entries(
            normalizedQuery
        )
    ) {
        if (
            Array.isArray(value)
        ) {
            for (
                const item
                of value
            ) {
                params.append(
                    key,
                    item
                );
            }

            continue;
        }

        params.append(
            key,
            value
        );
    }

    const queryString =
        params.toString();

    if (
        !queryString
    ) {
        return url;
    }

    return url.includes('?')
        ? `${url}&${queryString}`
        : `${url}?${queryString}`;
}


function serializeJsonBody(
    body
) {
    if (
        body === undefined ||
        body === null
    ) {
        return undefined;
    }

    try {
        return JSON.stringify(
            body
        );
    } catch (error) {
        throw createError(
            'AIRTEL_REQUEST_BODY_SERIALIZATION_FAILED',
            'Unable to serialize JSON request body',
            {
                cause:
                    error
            }
        );
    }
}


function serializeFormBody(
    body
) {
    if (
        body === undefined ||
        body === null
    ) {
        return undefined;
    }

    if (
        !isObject(body)
    ) {
        throw createError(
            'AIRTEL_FORM_BODY_INVALID',
            'Form request body must be an object'
        );
    }

    const params =
        new URLSearchParams();

    for (
        const [
            key,
            value
        ] of Object.entries(body)
    ) {
        if (
            value === undefined ||
            value === null
        ) {
            continue;
        }

        if (
            Array.isArray(value)
        ) {
            for (
                const item
                of value
            ) {
                params.append(
                    key,
                    String(item)
                );
            }

            continue;
        }

        params.append(
            key,
            String(value)
        );
    }

    return params.toString();
}


function bodyByteLength(
    body
) {
    if (
        body === undefined ||
        body === null
    ) {
        return 0;
    }

    if (
        Buffer.isBuffer(body)
    ) {
        return body.length;
    }

    return Buffer.byteLength(
        String(body),
        'utf8'
    );
}


function fingerprint(
    value
) {
    let input;

    if (
        Buffer.isBuffer(value)
    ) {
        input = value;
    } else if (
        typeof value === 'string'
    ) {
        input = value;
    } else {
        try {
            input =
                JSON.stringify(
                    value ?? {}
                );
        } catch (_) {
            input =
                String(value);
        }
    }

    return crypto
        .createHash('sha256')
        .update(input)
        .digest('hex');
}


function normalizeId(
    value,
    name
) {
    if (
        value === undefined ||
        value === null
    ) {
        return undefined;
    }

    const result =
        String(value)
            .trim();

    if (
        !result
    ) {
        return undefined;
    }

    if (
        result.length >
        256
    ) {
        throw createError(
            `AIRTEL_${name.toUpperCase()}_TOO_LARGE`,
            `${name} exceeds maximum length`
        );
    }

    return result;
}


function cloneObject(
    value
) {
    if (
        Array.isArray(value)
    ) {
        return value.map(
            item =>
                cloneObject(item)
        );
    }

    if (
        !isPlainObject(value)
    ) {
        return value;
    }

    const result = {};

    for (
        const [
            key,
            item
        ] of Object.entries(value)
    ) {
        result[key] =
            cloneObject(item);
    }

    return result;
}


function redactHeaders(
    headers = {}
) {
    const result = {};

    for (
        const [
            key,
            value
        ] of Object.entries(headers)
    ) {
        result[key] =
            SENSITIVE_HEADERS.has(
                String(key)
                    .toLowerCase()
            )
                ? '[REDACTED]'
                : value;
    }

    return result;
}


function safeUrlForDiagnostics(
    url
) {
    try {
        const parsed =
            new URL(url);

        /**
         * Query strings can contain sensitive provider/application data.
         */
        parsed.search = '';

        return parsed.toString();
    } catch (_) {
        return '[INVALID_URL]';
    }
}


function createError(
    code,
    message,
    details = {}
) {
    const error =
        new Error(
            message
        );

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


/**
 * ============================================================================
 * Airtel Request Builder
 * ============================================================================
 */
class AirtelRequestBuilder {

    constructor({
        configuration,
        baseUrl,
        timeoutMs =
            DEFAULTS.timeoutMs,
        maxBodyBytes =
            DEFAULTS.maxBodyBytes,
        maxHeaderValueLength =
            DEFAULTS.maxHeaderValueLength,
        maxUrlLength =
            DEFAULTS.maxUrlLength,
        allowedProtocols = [
            'https:'
        ],
        allowHttpInDevelopment = false,
        logger,
        metrics,
        tracer
    } = {}) {
        this.configuration =
            configuration;

        this.baseUrl =
            baseUrl;

        this.timeoutMs =
            this.normalizeTimeout(
                timeoutMs
            );

        this.maxBodyBytes =
            this.normalizePositiveInteger(
                maxBodyBytes,
                'maxBodyBytes'
            );

        this.maxHeaderValueLength =
            this.normalizePositiveInteger(
                maxHeaderValueLength,
                'maxHeaderValueLength'
            );

        this.maxUrlLength =
            this.normalizePositiveInteger(
                maxUrlLength,
                'maxUrlLength'
            );

        this.allowedProtocols =
            new Set(
                allowedProtocols.map(
                    protocol =>
                        String(protocol)
                            .trim()
                            .toLowerCase()
                )
            );

        this.allowHttpInDevelopment =
            Boolean(
                allowHttpInDevelopment
            );

        this.logger =
            logger;

        this.metrics =
            metrics;

        this.tracer =
            tracer;
    }


    /**
     * =========================================================================
     * Generic Request Builder
     * =========================================================================
     */
    build(options = {}) {
        if (
            !isObject(options)
        ) {
            throw createError(
                'AIRTEL_REQUEST_OPTIONS_INVALID',
                'Request options must be an object'
            );
        }

        const method =
            normalizeMethod(
                options.method ||
                'GET'
            );

        const url =
            this.resolveUrl(
                options.url,
                options.path
            );

        const query =
            normalizeQuery(
                options.query ||
                options.params
            );

        const finalUrl =
            appendQuery(
                url,
                query
            );

        this.assertUrlLength(
            finalUrl
        );

        const bodyType =
            this.resolveBodyType(
                options
            );

        const body =
            this.serializeBody(
                options.body,
                bodyType
            );

        const headers =
            this.buildHeaders({
                ...options,

                body,
                bodyType
            });

        this.assertBodyLength(
            body
        );

        this.assertMethodBodyCompatibility({
            method,
            body
        });

        const request = {
            method,

            url:
                finalUrl,

            headers,

            body,

            timeoutMs:
                this.normalizeTimeout(
                    options.timeoutMs ??
                    this.timeoutMs
                ),

            correlationId:
                normalizeId(
                    options.correlationId,
                    'correlationId'
                ),

            operationId:
                normalizeId(
                    options.operationId,
                    'operationId'
                ),

            tenantId:
                normalizeId(
                    options.tenantId,
                    'tenantId'
                ),

            idempotencyKey:
                normalizeId(
                    options.idempotencyKey,
                    'idempotencyKey'
                ),

            provider:
                PROVIDER
        };

        /**
         * Keep the transport request JSON-safe and immutable from accidental
         * mutation by downstream middleware.
         */
        return Object.freeze(
            request
        );
    }


    /**
     * =========================================================================
     * JSON Request
     * =========================================================================
     */
    buildJson({
        method = 'POST',
        body,
        headers = {},
        ...options
    } = {}) {
        return this.build({
            ...options,

            method,

            body,

            headers: {
                ...headers,

                'content-type':
                    CONTENT_TYPES.JSON
            }
        });
    }


    /**
     * =========================================================================
     * Form Request
     * =========================================================================
     */
    buildForm({
        method = 'POST',
        body,
        headers = {},
        ...options
    } = {}) {
        return this.build({
            ...options,

            method,

            body,

            bodyType:
                'form',

            headers: {
                ...headers,

                'content-type':
                    CONTENT_TYPES.FORM
            }
        });
    }


    /**
     * =========================================================================
     * Empty Request
     * =========================================================================
     */
    buildEmpty({
        method = 'GET',
        headers = {},
        ...options
    } = {}) {
        return this.build({
            ...options,

            method,

            headers
        });
    }


    /**
     * =========================================================================
     * URL Resolution
     * =========================================================================
     */
    resolveUrl(
        url,
        path
    ) {
        let candidate =
            url;

        if (
            candidate === undefined ||
            candidate === null ||
            String(candidate).trim() === ''
        ) {
            candidate =
                this.resolveConfiguredBaseUrl();

            if (
                path
            ) {
                candidate =
                    this.joinUrl(
                        candidate,
                        path
                    );
            }
        }

        if (
            !candidate
        ) {
            throw createError(
                'AIRTEL_ENDPOINT_REQUIRED',
                'Airtel request endpoint is required'
            );
        }

        const normalized =
            String(candidate).trim();

        let parsed;

        try {
            parsed =
                new URL(
                    normalized
                );
        } catch (error) {
            throw createError(
                'AIRTEL_ENDPOINT_INVALID',
                'Airtel request endpoint is not a valid URL',
                {
                    cause:
                        error
                }
            );
        }

        const allowHttp =
            this.allowHttpInDevelopment;

        if (
            !this.allowedProtocols.has(
                parsed.protocol
            ) &&
            !(
                allowHttp &&
                parsed.protocol ===
                    'http:'
            )
        ) {
            throw createError(
                'AIRTEL_ENDPOINT_PROTOCOL_FORBIDDEN',
                `Unsupported Airtel endpoint protocol: ${parsed.protocol}`
            );
        }

        /**
         * Restrict credentials in endpoint URLs.
         */
        if (
            parsed.username ||
            parsed.password
        ) {
            throw createError(
                'AIRTEL_ENDPOINT_CREDENTIALS_FORBIDDEN',
                'Airtel endpoint URLs must not contain embedded credentials'
            );
        }

        return parsed.toString();
    }


    resolveConfiguredBaseUrl() {
        if (
            this.baseUrl
        ) {
            return String(
                this.baseUrl
            ).trim();
        }

        const endpoints =
            this.configuration?.getEndpoints?.() ||
            {};

        return (
            endpoints.baseUrl ||
            endpoints.base ||
            endpoints.apiBaseUrl ||
            endpoints.collection ||
            endpoints.disbursement ||
            endpoints.collections ||
            endpoints.disbursements
        );
    }


    joinUrl(
        base,
        path
    ) {
        const normalizedBase =
            String(
                base || ''
            ).replace(
                /\/+$/,
                ''
            );

        const normalizedPath =
            String(
                path || ''
            ).replace(
                /^\/+/,
                ''
            );

        if (
            !normalizedBase
        ) {
            return `/${normalizedPath}`;
        }

        return `${normalizedBase}/${normalizedPath}`;
    }


    /**
     * =========================================================================
     * Headers
     * =========================================================================
     */
    buildHeaders({
        headers = {},
        body,
        bodyType,
        tenantId,
        correlationId,
        operationId,
        idempotencyKey,
        requestId,
        accept = 'application/json'
    } = {}) {
        const result =
            normalizeHeaders(
                headers,
                {
                    maxHeaderValueLength:
                        this.maxHeaderValueLength
                }
            );

        /**
         * Explicit caller headers remain authoritative where present.
         */
        if (
            accept &&
            !result.accept
        ) {
            result.accept =
                normalizeHeaderValue(
                    accept,
                    this.maxHeaderValueLength
                );
        }

        if (
            !result['user-agent']
        ) {
            result['user-agent'] =
                'TITech-Community-Capital-Airtel/1.0';
        }

        if (
            body !== undefined &&
            !result['content-type']
        ) {
            result['content-type'] =
                bodyType === 'form'
                    ? CONTENT_TYPES.FORM
                    : CONTENT_TYPES.JSON;
        }

        const normalizedTenantId =
            normalizeId(
                tenantId,
                'tenantId'
            );

        const normalizedCorrelationId =
            normalizeId(
                correlationId,
                'correlationId'
            );

        const normalizedOperationId =
            normalizeId(
                operationId,
                'operationId'
            );

        const normalizedIdempotencyKey =
            normalizeId(
                idempotencyKey,
                'idempotencyKey'
            );

        const normalizedRequestId =
            normalizeId(
                requestId,
                'requestId'
            );

        if (
            normalizedTenantId &&
            !result[
                INTERNAL_CONTEXT_HEADERS.TENANT
            ]
        ) {
            result[
                INTERNAL_CONTEXT_HEADERS.TENANT
            ] =
                normalizedTenantId;
        }

        if (
            normalizedCorrelationId &&
            !result[
                INTERNAL_CONTEXT_HEADERS.CORRELATION
            ]
        ) {
            result[
                INTERNAL_CONTEXT_HEADERS.CORRELATION
            ] =
                normalizedCorrelationId;
        }

        if (
            normalizedOperationId &&
            !result[
                INTERNAL_CONTEXT_HEADERS.OPERATION
            ]
        ) {
            result[
                INTERNAL_CONTEXT_HEADERS.OPERATION
            ] =
                normalizedOperationId;
        }

        if (
            normalizedIdempotencyKey &&
            !result[
                INTERNAL_CONTEXT_HEADERS.IDEMPOTENCY
            ]
        ) {
            result[
                INTERNAL_CONTEXT_HEADERS.IDEMPOTENCY
            ] =
                normalizedIdempotencyKey;
        }

        if (
            normalizedRequestId &&
            !result[
                INTERNAL_CONTEXT_HEADERS.REQUEST_ID
            ]
        ) {
            result[
                INTERNAL_CONTEXT_HEADERS.REQUEST_ID
            ] =
                normalizedRequestId;
        }

        /**
         * Content-Length is deliberately not calculated here. The final HTTP
         * client should own transport framing because it may use Buffer,
         * streams or compression.
         */
        return result;
    }


    /**
     * =========================================================================
     * Body Serialization
     * =========================================================================
     */
    resolveBodyType(
        options = {}
    ) {
        if (
            options.bodyType
        ) {
            return String(
                options.bodyType
            )
                .trim()
                .toLowerCase();
        }

        const contentType =
            String(
                options.headers?.['content-type'] ||
                options.headers?.['Content-Type'] ||
                ''
            )
                .split(';')[0]
                .trim()
                .toLowerCase();

        if (
            contentType ===
            CONTENT_TYPES.FORM
        ) {
            return 'form';
        }

        if (
            contentType ===
            CONTENT_TYPES.TEXT
        ) {
            return 'text';
        }

        return 'json';
    }


    serializeBody(
        body,
        bodyType
    ) {
        if (
            body === undefined ||
            body === null
        ) {
            return undefined;
        }

        switch (
            bodyType
        ) {
            case 'json':
                return serializeJsonBody(
                    body
                );

            case 'form':
                return serializeFormBody(
                    body
                );

            case 'text':
                return String(
                    body
                );

            case 'raw':
                return body;

            default:
                throw createError(
                    'AIRTEL_BODY_TYPE_INVALID',
                    `Unsupported request body type: ${bodyType}`
                );
        }
    }


    /**
     * =========================================================================
     * Request Validation
     * =========================================================================
     */
    assertBodyLength(
        body
    ) {
        const bytes =
            bodyByteLength(
                body
            );

        if (
            bytes >
            this.maxBodyBytes
        ) {
            throw createError(
                'AIRTEL_REQUEST_BODY_TOO_LARGE',
                'Airtel request body exceeds configured maximum',
                {
                    bodyBytes:
                        bytes,
                    maxBodyBytes:
                        this.maxBodyBytes
                }
            );
        }

        return true;
    }


    assertUrlLength(
        url
    ) {
        if (
            String(url).length >
            this.maxUrlLength
        ) {
            throw createError(
                'AIRTEL_REQUEST_URL_TOO_LARGE',
                'Airtel request URL exceeds configured maximum'
            );
        }

        return true;
    }


    assertMethodBodyCompatibility({
        method,
        body
    }) {
        if (
            body === undefined ||
            body === null
        ) {
            return true;
        }

        if (
            method === 'GET' ||
            method === 'HEAD'
        ) {
            throw createError(
                'AIRTEL_BODY_NOT_ALLOWED',
                `${method} requests must not contain a body`
            );
        }

        return true;
    }


    /**
     * =========================================================================
     * Request Fingerprint
     * =========================================================================
     */
    fingerprint(
        request
    ) {
        if (
            !isObject(request)
        ) {
            throw createError(
                'AIRTEL_REQUEST_INVALID',
                'Request must be an object'
            );
        }

        /**
         * The fingerprint intentionally contains method, URL path/query and
         * body hash but excludes Authorization and other sensitive headers.
         */
        return fingerprint({
            provider:
                PROVIDER,

            method:
                request.method,

            url:
                request.url,

            body:
                request.body ===
                    undefined
                    ? undefined
                    : fingerprint(
                        request.body
                    )
        });
    }


    /**
     * =========================================================================
     * Safe Diagnostic Representation
     * =========================================================================
     */
    diagnostics(
        request
    ) {
        if (
            !request
        ) {
            return {
                provider:
                    PROVIDER,
                status:
                    'EMPTY'
            };
        }

        const sanitizedHeaders =
            redactHeaders(
                request.headers ||
                {}
            );

        return {
            provider:
                PROVIDER,

            method:
                request.method,

            url:
                safeUrlForDiagnostics(
                    request.url
                ),

            headers:
                sanitizedHeaders,

            bodyPresent:
                request.body !==
                undefined,

            bodyBytes:
                bodyByteLength(
                    request.body
                ),

            bodyFingerprint:
                request.body ===
                    undefined
                    ? undefined
                    : fingerprint(
                        request.body
                    ),

            requestFingerprint:
                this.fingerprint(
                    request
                ),

            timeoutMs:
                request.timeoutMs,

            tenantId:
                request.tenantId,

            correlationId:
                request.correlationId,

            operationId:
                request.operationId,

            idempotencyKey:
                request.idempotencyKey
        };
    }


    /**
     * =========================================================================
     * Configuration Validation
     * =========================================================================
     */
    validateConfiguration() {
        const endpoint =
            this.resolveConfiguredBaseUrl();

        if (
            !endpoint
        ) {
            return {
                status:
                    'DEGRADED',

                provider:
                    PROVIDER,

                endpointConfigured:
                    false
            };
        }

        try {
            this.resolveUrl(
                endpoint
            );

            return {
                status:
                    'UP',

                provider:
                    PROVIDER,

                endpointConfigured:
                    true
            };
        } catch (error) {
            return {
                status:
                    'DOWN',

                provider:
                    PROVIDER,

                endpointConfigured:
                    false,

                error:
                    safeError(error)
            };
        }
    }


    /**
     * =========================================================================
     * Health
     * =========================================================================
     */
    health() {
        const configuration =
            this.validateConfiguration();

        return {
            provider:
                PROVIDER,

            module:
                'shared.requestBuilder',

            status:
                configuration.status,

            configuration,

            limits: {
                timeoutMs:
                    this.timeoutMs,

                maxBodyBytes:
                    this.maxBodyBytes,

                maxHeaderValueLength:
                    this.maxHeaderValueLength,

                maxUrlLength:
                    this.maxUrlLength
            },

            security: {
                allowedProtocols:
                    [...this.allowedProtocols],

                allowHttpInDevelopment:
                    this.allowHttpInDevelopment,

                credentialsInUrl:
                    false,

                secretSafeDiagnostics:
                    true
            }
        };
    }


    /**
     * =========================================================================
     * Utilities
     * =========================================================================
     */
    normalizeTimeout(
        value
    ) {
        const timeout =
            Number(
                value
            );

        if (
            !Number.isFinite(timeout) ||
            timeout <= 0
        ) {
            throw createError(
                'AIRTEL_TIMEOUT_INVALID',
                'Request timeout must be a positive finite number'
            );
        }

        return Math.floor(
            timeout
        );
    }


    normalizePositiveInteger(
        value,
        field
    ) {
        const number =
            Number(
                value
            );

        if (
            !Number.isSafeInteger(number) ||
            number <= 0
        ) {
            throw createError(
                'AIRTEL_CONFIGURATION_INVALID',
                `${field} must be a positive safe integer`
            );
        }

        return number;
    }


    clone(
        request
    ) {
        return cloneObject(
            request
        );
    }


    static isSensitiveHeader(
        name
    ) {
        return SENSITIVE_HEADERS.has(
            String(name || '')
                .toLowerCase()
        );
    }
}


/**
 * ============================================================================
 * Factory
 * ============================================================================
 */
function createRequestBuilder(
    options = {}
) {
    return new AirtelRequestBuilder(
        options
    );
}


/**
 * ============================================================================
 * Module Exports
 * ============================================================================
 */
module.exports =
    AirtelRequestBuilder;

module.exports.AirtelRequestBuilder =
    AirtelRequestBuilder;

module.exports.createRequestBuilder =
    createRequestBuilder;

module.exports.PROVIDER =
    PROVIDER;

module.exports.DEFAULTS =
    DEFAULTS;

module.exports.HTTP_METHODS =
    HTTP_METHODS;

module.exports.CONTENT_TYPES =
    CONTENT_TYPES;