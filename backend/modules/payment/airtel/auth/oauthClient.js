'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money OAuth Client
 * ============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/auth/oauthClient.js
 *
 * Purpose
 * -------
 * Enterprise HTTP abstraction layer for Airtel Money OAuth authentication.
 *
 * Responsibilities
 * ----------------
 * • OAuth access-token acquisition
 * • HTTP transport orchestration
 * • Request construction
 * • Credential validation
 * • OAuth response validation
 * • Retry policy enforcement
 * • Timeout/error classification
 * • Correlation ID propagation
 * • Tenant context propagation
 * • Metrics instrumentation
 * • OpenTelemetry tracing hooks
 * • Structured logging
 * • Provider health state
 * • Safe diagnostics
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • Token caching
 * • Token refresh lifecycle
 * • Credential storage
 * • Payment execution
 * • Collections
 * • Disbursements
 * • Settlement
 * • Ledger posting
 *
 * Security
 * --------
 * • Client secrets are never logged.
 * • Access tokens are never logged.
 * • Authorization headers are never logged.
 * • Provider response bodies are sanitized before diagnostics.
 * • Production endpoints must use HTTPS.
 *
 * ============================================================================
 */

const crypto = require('crypto');

const {
    AuthenticationError,
    ProviderUnavailableError,
    normalizeError
} = require('../../../shared/errors');

const {
    PROVIDER,
    OAUTH,
    HTTP,
    HEADERS,
    RETRY,
    ERROR_CODES,
    SECURITY,
    validateConfiguration
} = require('./authConstants');


/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const PROVIDER_NAME = PROVIDER.CODE || 'AIRTEL_MONEY';

const DEFAULT_TIMEOUT_MS =
    Number(HTTP?.TIMEOUT_MS) > 0
        ? Number(HTTP.TIMEOUT_MS)
        : 10000;

const DEFAULT_MAX_RESPONSE_BODY_BYTES =
    Number(HTTP?.MAX_RESPONSE_BODY_BYTES) > 0
        ? Number(HTTP.MAX_RESPONSE_BODY_BYTES)
        : 1024 * 1024;

const RETRYABLE_STATUS_CODES = new Set(
    Array.isArray(RETRY?.RETRYABLE_STATUS_CODES)
        ? RETRY.RETRYABLE_STATUS_CODES
        : [429, 502, 503, 504]
);

const NON_RETRYABLE_STATUS_CODES = new Set(
    Array.isArray(RETRY?.NON_RETRYABLE_STATUS_CODES)
        ? RETRY.NON_RETRYABLE_STATUS_CODES
        : [400, 401, 403, 404]
);

const SENSITIVE_KEYS = new Set(
    Array.isArray(SECURITY?.SENSITIVE_FIELDS)
        ? SECURITY.SENSITIVE_FIELDS.map(
            key => String(key).toLowerCase()
        )
        : [
            'client_secret',
            'clientsecret',
            'access_token',
            'accesstoken',
            'refresh_token',
            'refreshtoken',
            'authorization',
            'password',
            'secret',
            'token'
        ]
);


/**
 * ============================================================================
 * Utility helpers
 * ============================================================================
 */

/**
 * Safely convert a value to a positive integer.
 */
function positiveInteger(
    value,
    fallback
) {
    const number = Number(value);

    if (
        !Number.isFinite(number) ||
        number < 0
    ) {
        return fallback;
    }

    return Math.floor(number);
}


/**
 * Sleep without introducing external dependencies.
 */
function sleep(ms) {

    return new Promise(resolve => {

        setTimeout(
            resolve,
            Math.max(0, ms)
        );

    });

}


/**
 * Safely calculate exponential retry delay.
 */
function calculateBackoffDelay(
    attempt
) {

    const initial =
        positiveInteger(
            RETRY?.INITIAL_DELAY_MS,
            250
        );

    const maximum =
        positiveInteger(
            RETRY?.MAX_DELAY_MS,
            5000
        );

    const multiplier =
        Number(RETRY?.BACKOFF_MULTIPLIER) > 0
            ? Number(RETRY.BACKOFF_MULTIPLIER)
            : 2;

    let delay =
        initial *
        Math.pow(
            multiplier,
            Math.max(0, attempt - 1)
        );

    delay =
        Math.min(
            delay,
            maximum
        );

    if (RETRY?.JITTER !== false) {

        const jitter =
            Math.floor(
                Math.random() *
                Math.max(1, delay * 0.25)
            );

        delay += jitter;

    }

    return Math.min(
        delay,
        maximum
    );

}


/**
 * Extract HTTP status from different HTTP client response formats.
 */
function getStatusCode(
    response
) {

    if (!response) {
        return null;
    }

    const status =
        response.statusCode ??
        response.status ??
        response.response?.statusCode ??
        response.response?.status;

    const numeric =
        Number(status);

    return Number.isFinite(numeric)
        ? numeric
        : null;

}


/**
 * Extract response body from common HTTP client formats.
 */
function getResponseBody(
    response
) {

    if (!response) {
        return {};
    }

    if (
        response.body !== undefined &&
        response.body !== null
    ) {
        return response.body;
    }

    if (
        response.data !== undefined &&
        response.data !== null
    ) {
        return response.data;
    }

    if (
        response.response?.body !== undefined
    ) {
        return response.response.body;
    }

    if (
        response.response?.data !== undefined
    ) {
        return response.response.data;
    }

    return {};
}


/**
 * Extract headers from different response formats.
 */
function getResponseHeaders(
    response
) {

    return (
        response?.headers ||
        response?.response?.headers ||
        {}
    );

}


/**
 * Retrieve a header case-insensitively.
 */
function getHeader(
    headers,
    name
) {

    if (!headers || typeof headers !== 'object') {
        return null;
    }

    const wanted =
        String(name).toLowerCase();

    for (
        const [key, value]
        of Object.entries(headers)
    ) {

        if (
            String(key).toLowerCase() === wanted
        ) {
            return value;
        }

    }

    return null;

}


/**
 * Convert potentially string/object body into a safe diagnostic object.
 */
function parseBody(
    body
) {

    if (
        body === null ||
        body === undefined
    ) {
        return {};
    }

    if (
        typeof body === 'object'
    ) {
        return body;
    }

    if (
        typeof body === 'string'
    ) {

        try {
            return JSON.parse(body);
        }
        catch {
            return {
                message: body
            };
        }

    }

    return {
        value: String(body)
    };

}


/**
 * ============================================================================
 * OAuthClient
 * ============================================================================
 */

class OAuthClient {

    constructor({

        configuration,

        httpClient,

        logger,

        metrics,

        tracer

    } = {}) {

        if (!configuration) {

            throw new Error(
                'Airtel OAuthClient requires configuration'
            );

        }

        if (!httpClient) {

            throw new Error(
                'Airtel OAuthClient requires httpClient'
            );

        }

        this.configuration =
            configuration;

        this.httpClient =
            httpClient;

        this.logger =
            logger;

        this.metrics =
            metrics;

        this.tracer =
            tracer;

        this.startedAt =
            new Date();

        this.healthState = {

            status: 'UNKNOWN',

            lastSuccess: null,

            lastFailure: null,

            lastFailureCode: null,

            consecutiveFailures: 0,

            consecutiveSuccesses: 0,

            lastLatencyMs: null,

            totalRequests: 0,

            totalSuccesses: 0,

            totalFailures: 0,

            totalRetries: 0

        };

        this.configurationState =
            this.resolveConfiguration();

    }


    /**
     * =========================================================================
     * Resolve Runtime Configuration
     * =========================================================================
     */

    resolveConfiguration() {

        let endpoint = null;

        let validation = null;

        /**
         * Existing configuration object has priority.
         */
        if (
            typeof this.configuration.getOAuthEndpoint ===
            'function'
        ) {

            endpoint =
                this.configuration.getOAuthEndpoint();

        }

        /**
         * Compatibility with constants-style configuration.
         */
        if (
            !endpoint &&
            this.configuration.oauth?.TOKEN_ENDPOINT
        ) {

            endpoint =
                this.configuration.oauth.TOKEN_ENDPOINT;

        }

        if (
            !endpoint &&
            this.configuration.authBaseUrl &&
            this.configuration.endpoints?.TOKEN
        ) {

            endpoint =
                `${String(
                    this.configuration.authBaseUrl
                ).replace(/\/+$/, '')}${this.configuration.endpoints.TOKEN}`;

        }

        if (
            !endpoint &&
            this.configuration.baseUrl &&
            this.configuration.endpoints?.TOKEN
        ) {

            endpoint =
                `${String(
                    this.configuration.baseUrl
                ).replace(/\/+$/, '')}${this.configuration.endpoints.TOKEN}`;

        }

        /**
         * Final fallback to centralized auth constants.
         */
        if (!endpoint && OAUTH?.TOKEN_ENDPOINT) {

            endpoint =
                OAUTH.TOKEN_ENDPOINT;

        }

        try {

            validation =
                validateConfiguration({

                    environment:
                        this.configuration.environment,

                    baseUrl:
                        this.configuration.baseUrl ||
                        this.configuration.apiBaseUrl ||
                        PROVIDER.API_BASE_URL

                });

        }
        catch {

            validation = {

                valid: true,

                errors: []

            };

        }

        return Object.freeze({

            endpoint,

            timeoutMs:
                positiveInteger(
                    this.configuration.timeoutMs,
                    DEFAULT_TIMEOUT_MS
                ),

            maxResponseBodyBytes:
                positiveInteger(
                    this.configuration.maxResponseBodyBytes,
                    DEFAULT_MAX_RESPONSE_BODY_BYTES
                ),

            environment:
                this.configuration.environment ||
                PROVIDER.ENVIRONMENT,

            country:
                this.configuration.country ||
                PROVIDER.COUNTRY,

            currency:
                this.configuration.currency ||
                PROVIDER.CURRENCY,

            validation

        });

    }


    /**
     * =========================================================================
     * Authenticate
     * =========================================================================
     */

    async authenticate({

        credentials,

        tenantId = null,

        correlationId =
            crypto.randomUUID(),

        requestId =
            correlationId

    } = {}) {

        const span =
            this.tracer?.startSpan?.(
                'airtel.oauth.authenticate'
            );

        const startedAt =
            Date.now();

        let attempt = 0;

        this.healthState.totalRequests++;

        this.metrics?.counter?.(
            'payment_airtel_oauth_request_total'
        );

        try {

            this.validateConfiguration();

            this.validateCredentials(
                credentials
            );

            const endpoint =
                this.configurationState.endpoint;

            const requestContext = {

                tenantId,

                correlationId,

                requestId

            };

            this.setSpanAttributes(
                span,
                requestContext
            );

            this.logger?.info?.({

                message:
                    'Airtel OAuth authentication started',

                provider:
                    PROVIDER_NAME,

                tenantId,

                correlationId,

                requestId,

                environment:
                    this.configurationState.environment

            });

            const request =
                this.buildTokenRequest({

                    credentials,

                    tenantId,

                    correlationId,

                    requestId

                });

            const maxAttempts =
                positiveInteger(
                    RETRY?.MAX_ATTEMPTS,
                    3
                );

            while (true) {

                attempt++;

                try {

                    const response =
                        await this.executeRequest({

                            request,

                            tenantId,

                            correlationId,

                            requestId,

                            attempt

                        });

                    const token =
                        this.validateResponse(
                            response
                        );

                    const latencyMs =
                        Date.now() - startedAt;

                    this.markSuccess(
                        latencyMs
                    );

                    this.metrics?.counter?.(
                        'payment_airtel_oauth_success_total'
                    );

                    this.metrics?.histogram?.(
                        'payment_airtel_oauth_duration_ms',
                        latencyMs
                    );

                    this.logger?.info?.({

                        message:
                            'Airtel OAuth authentication successful',

                        provider:
                            PROVIDER_NAME,

                        tenantId,

                        correlationId,

                        requestId,

                        latencyMs,

                        attempt

                    });

                    return token;

                }
                catch (error) {

                    const normalized =
                        normalizeError(error);

                    const retryable =
                        this.isRetryable(
                            normalized
                        );

                    const canRetry =
                        retryable &&
                        attempt <= maxAttempts;

                    if (!canRetry) {

                        throw normalized;

                    }

                    const delay =
                        this.getRetryDelay({

                            error:
                                normalized,

                            attempt

                        });

                    this.healthState.totalRetries++;

                    this.metrics?.counter?.(
                        'payment_airtel_oauth_retry_total'
                    );

                    this.logger?.warn?.({

                        message:
                            'Retrying Airtel OAuth request',

                        provider:
                            PROVIDER_NAME,

                        tenantId,

                        correlationId,

                        requestId,

                        attempt,

                        maxAttempts,

                        delayMs:
                            delay,

                        reason:
                            this.safeErrorSummary(
                                normalized
                            )

                    });

                    await sleep(
                        delay
                    );

                }

            }

        }
        catch (error) {

            const normalized =
                normalizeError(error);

            const latencyMs =
                Date.now() - startedAt;

            this.markFailure(
                normalized,
                latencyMs
            );

            this.metrics?.counter?.(
                'payment_airtel_oauth_failure_total'
            );

            this.metrics?.histogram?.(
                'payment_airtel_oauth_duration_ms',
                latencyMs
            );

            this.logger?.error?.({

                message:
                    'Airtel OAuth authentication failed',

                provider:
                    PROVIDER_NAME,

                tenantId,

                correlationId,

                requestId,

                latencyMs,

                error:
                    this.safeErrorSummary(
                        normalized
                    )

            });

            this.setSpanError(
                span,
                normalized
            );

            throw normalized;

        }
        finally {

            span?.end?.();

        }

    }


    /**
     * =========================================================================
     * Build OAuth Token Request
     * =========================================================================
     */

    buildTokenRequest({

        credentials,

        tenantId,

        correlationId,

        requestId

    }) {

        const headers = {

            ...(HEADERS?.TOKEN_REQUEST || {}),

            [HTTP.HEADERS.CONTENT_TYPE]:
                OAUTH?.CONTENT_TYPE ||
                'application/json',

            [HTTP.HEADERS.ACCEPT]:
                OAUTH?.ACCEPT ||
                'application/json',

            [HTTP.HEADERS.X_COUNTRY]:
                credentials.country ||
                this.configurationState.country,

            [HTTP.HEADERS.X_CURRENCY]:
                credentials.currency ||
                this.configurationState.currency,

            [HTTP.HEADERS.X_CORRELATION_ID]:
                correlationId,

            [HTTP.HEADERS.X_REQUEST_ID]:
                requestId

        };

        if (
            credentials.userAgent ||
            this.configuration.userAgent
        ) {

            headers[
                HTTP.HEADERS.USER_AGENT
            ] =
                credentials.userAgent ||
                this.configuration.userAgent;

        }

        const body = {

            client_id:
                credentials.clientId,

            client_secret:
                credentials.clientSecret,

            grant_type:
                OAUTH?.GRANT_TYPE ||
                'client_credentials'

        };

        if (
            OAUTH?.SCOPE
        ) {

            body.scope =
                OAUTH.SCOPE;

        }

        /**
         * Preserve optional Airtel subscription key when supplied.
         *
         * It is never logged.
         */
        if (
            credentials.subscriptionKey
        ) {

            headers[
                'Ocp-Apim-Subscription-Key'
            ] =
                credentials.subscriptionKey;

        }

        return {

            method:
                HTTP?.METHODS?.POST ||
                'POST',

            url:
                this.configurationState.endpoint,

            headers,

            body,

            timeoutMs:
                this.configurationState.timeoutMs,

            tenantId,

            correlationId,

            requestId

        };

    }


    /**
     * =========================================================================
     * Execute HTTP Request
     * =========================================================================
     */

    async executeRequest({

        request,

        tenantId,

        correlationId,

        requestId,

        attempt

    }) {

        const span =
            this.tracer?.startSpan?.(
                'airtel.oauth.http_request'
            );

        const startedAt =
            Date.now();

        try {

            this.setSpanAttributes(

                span,

                {

                    tenantId,

                    correlationId,

                    requestId,

                    attempt,

                    provider:
                        PROVIDER_NAME,

                    endpoint:
                        this.sanitizeEndpoint(
                            request.url
                        )

                }

            );

            /**
             * The surrounding HTTP abstraction may use timeout,
             * timeoutMs, signal, or its own transport configuration.
             *
             * We provide both common forms while retaining compatibility.
             */
            const response =
                await this.httpClient.request({

                    method:
                        request.method,

                    url:
                        request.url,

                    headers:
                        request.headers,

                    body:
                        request.body,

                    timeout:
                        request.timeoutMs,

                    timeoutMs:
                        request.timeoutMs,

                    correlationId,

                    requestId,

                    tenantId

                });

            const latencyMs =
                Date.now() - startedAt;

            this.metrics?.histogram?.(
                'payment_airtel_oauth_http_duration_ms',
                latencyMs
            );

            return response;

        }
        catch (error) {

            const normalized =
                normalizeError(error);

            this.setSpanError(
                span,
                normalized
            );

            throw this.classifyTransportError(
                normalized
            );

        }
        finally {

            span?.end?.();

        }

    }


    /**
     * =========================================================================
     * Validate OAuth Response
     * =========================================================================
     */

    validateResponse(
        response
    ) {

        if (!response) {

            throw new ProviderUnavailableError(
                'Empty response received from Airtel OAuth service'
            );

        }

        const status =
            getStatusCode(
                response
            );

        const body =
            parseBody(
                getResponseBody(
                    response
                )
            );

        /**
         * No status code can be accepted only when the HTTP abstraction
         * explicitly returns a successful body-only response.
         */
        if (
            status !== null &&
            status >= 500
        ) {

            throw this.createProviderError(

                status >= 502
                    ? ERROR_CODES.PROVIDER_BAD_GATEWAY
                    : ERROR_CODES.PROVIDER_UNAVAILABLE,

                'Airtel OAuth service is temporarily unavailable',

                {

                    statusCode:
                        status

                }

            );

        }

        if (
            status === HTTP.STATUS.UNAUTHORIZED
        ) {

            throw new AuthenticationError(
                'Invalid Airtel OAuth credentials'
            );

        }

        if (
            status === HTTP.STATUS.FORBIDDEN
        ) {

            throw new AuthenticationError(
                'Airtel OAuth credentials are not authorized'
            );

        }

        if (
            status !== null &&
            status >= 400
        ) {

            if (
                status ===
                HTTP.STATUS.TOO_MANY_REQUESTS
            ) {

                const error =
                    new ProviderUnavailableError(
                        'Airtel OAuth service rate limited the request'
                    );

                error.statusCode =
                    status;

                error.code =
                    ERROR_CODES.AUTH_RATE_LIMITED;

                error.retryable =
                    true;

                error.retryAfterMs =
                    this.getRetryAfterMs(
                        response
                    );

                throw error;

            }

            const providerMessage =
                this.extractProviderErrorMessage(
                    body
                );

            const error =
                new AuthenticationError(

                    providerMessage
                        ? `Airtel OAuth request failed: ${providerMessage}`
                        : `Airtel OAuth request failed (${status})`

                );

            error.statusCode =
                status;

            error.providerCode =
                this.extractProviderErrorCode(
                    body
                );

            throw error;

        }

        const accessToken =
            body?.[
                OAUTH?.TOKEN_RESPONSE_FIELDS?.ACCESS_TOKEN ||
                'access_token'
            ] ||
            body?.access_token ||
            body?.accessToken;

        if (
            typeof accessToken !== 'string' ||
            !accessToken.trim()
        ) {

            const error =
                new AuthenticationError(
                    'Airtel OAuth response missing access token'
                );

            error.code =
                ERROR_CODES.INVALID_TOKEN_RESPONSE;

            throw error;

        }

        const tokenType =
            body?.token_type ||
            body?.tokenType ||
            OAUTH?.TOKEN_TYPE ||
            'Bearer';

        const normalizedTokenType =
            this.normalizeTokenType(
                tokenType
            );

        const expiresIn =
            Number(
                body?.expires_in ??
                body?.expiresIn ??
                0
            );

        if (
            !Number.isFinite(expiresIn) ||
            expiresIn <= 0
        ) {

            const error =
                new AuthenticationError(
                    'Airtel OAuth response contains invalid token expiry'
                );

            error.code =
                ERROR_CODES.INVALID_TOKEN_RESPONSE;

            throw error;

        }

        /**
         * Never return provider response bodies containing secrets.
         *
         * The authentication service only needs the normalized token.
         */
        return {

            accessToken:
                accessToken.trim(),

            tokenType:
                normalizedTokenType,

            expiresIn:

                Math.floor(
                    expiresIn
                ),

            issuedAt:
                new Date(),

            scope:
                body?.scope ||
                undefined,

            refreshToken:
                body?.refresh_token ||
                body?.refreshToken ||
                undefined

        };

    }


    /**
     * =========================================================================
     * Credential Validation
     * =========================================================================
     */

    validateCredentials(
        credentials = {}
    ) {

        const missing = [];

        if (
            typeof credentials.clientId !== 'string' ||
            !credentials.clientId.trim()
        ) {

            missing.push(
                'clientId'
            );

        }

        if (
            typeof credentials.clientSecret !== 'string' ||
            !credentials.clientSecret.trim()
        ) {

            missing.push(
                'clientSecret'
            );

        }

        if (missing.length) {

            const error =
                new AuthenticationError(

                    `Missing Airtel OAuth credentials: ${missing.join(', ')}`

                );

            error.code =
                missing.includes('clientId')
                    ? ERROR_CODES.MISSING_CLIENT_ID
                    : ERROR_CODES.MISSING_CLIENT_SECRET;

            throw error;

        }

        return true;

    }


    /**
     * =========================================================================
     * Configuration Validation
     * =========================================================================
     */

    validateConfiguration() {

        const endpoint =
            this.configurationState.endpoint;

        if (
            !endpoint ||
            typeof endpoint !== 'string'
        ) {

            const error =
                new AuthenticationError(
                    'Airtel OAuth endpoint is not configured'
                );

            error.code =
                ERROR_CODES.INVALID_BASE_URL;

            throw error;

        }

        let parsed;

        try {

            parsed =
                new URL(
                    endpoint
                );

        }
        catch {

            const error =
                new AuthenticationError(
                    'Airtel OAuth endpoint is invalid'
                );

            error.code =
                ERROR_CODES.INVALID_BASE_URL;

            throw error;

        }

        const environment =
            String(
                this.configurationState.environment ||
                ''
            ).toLowerCase();

        if (
            SECURITY?.REQUIRE_HTTPS_IN_PRODUCTION !== false &&
            environment === 'production' &&
            parsed.protocol !== 'https:'
        ) {

            const error =
                new AuthenticationError(
                    'Airtel production OAuth endpoint must use HTTPS'
                );

            error.code =
                ERROR_CODES.INVALID_BASE_URL;

            throw error;

        }

        return true;

    }


    /**
     * =========================================================================
     * Retry Classification
     * =========================================================================
     */

    isRetryable(
        error
    ) {

        if (!error) {
            return false;
        }

        if (
            error.retryable === true
        ) {
            return true;
        }

        if (
            error.retryable === false
        ) {
            return false;
        }

        const statusCode =
            Number(
                error.statusCode ??
                error.status
            );

        if (
            Number.isFinite(statusCode)
        ) {

            if (
                NON_RETRYABLE_STATUS_CODES.has(
                    statusCode
                )
            ) {
                return false;
            }

            if (
                RETRYABLE_STATUS_CODES.has(
                    statusCode
                )
            ) {
                return true;
            }

        }

        const code =
            String(
                error.code ||
                ''
            ).toUpperCase();

        /**
         * Network / timeout errors are generally transient.
         */
        const transientCodes = new Set([

            'ETIMEDOUT',

            'ECONNRESET',

            'ECONNREFUSED',

            'EAI_AGAIN',

            'ENETUNREACH',

            'EHOSTUNREACH',

            'ECONNABORTED',

            'ERR_NETWORK',

            'ERR_TIMEOUT',

            'TIMEOUT',

            'NETWORK_ERROR'

        ]);

        return transientCodes.has(
            code
        );

    }


    /**
     * =========================================================================
     * Retry Delay
     * =========================================================================
     */

    getRetryDelay({

        error,

        attempt

    }) {

        const retryAfter =
            Number(
                error?.retryAfterMs
            );

        if (
            Number.isFinite(retryAfter) &&
            retryAfter >= 0
        ) {

            return Math.min(
                retryAfter,
                positiveInteger(
                    RETRY?.MAX_DELAY_MS,
                    5000
                )
            );

        }

        return calculateBackoffDelay(
            attempt
        );

    }


    /**
     * =========================================================================
     * Retry-After
     * =========================================================================
     */

    getRetryAfterMs(
        response
    ) {

        const headers =
            getResponseHeaders(
                response
            );

        const retryAfter =
            getHeader(
                headers,
                'retry-after'
            );

        if (
            retryAfter === null ||
            retryAfter === undefined
        ) {

            return null;

        }

        const seconds =
            Number(
                retryAfter
            );

        if (
            Number.isFinite(seconds)
        ) {

            return Math.max(
                0,
                seconds * 1000
            );

        }

        const date =
            Date.parse(
                String(
                    retryAfter
                )
            );

        if (
            Number.isFinite(date)
        ) {

            return Math.max(
                0,
                date - Date.now()
            );

        }

        return null;

    }


    /**
     * =========================================================================
     * Transport Error Classification
     * =========================================================================
     */

    classifyTransportError(
        error
    ) {

        if (!error) {

            return new ProviderUnavailableError(
                'Unknown Airtel OAuth transport error'
            );

        }

        const code =
            String(
                error.code ||
                ''
            ).toUpperCase();

        if (
            code.includes('TIMEOUT') ||
            code === 'ETIMEDOUT' ||
            code === 'ECONNABORTED'
        ) {

            error.code =
                ERROR_CODES.AUTH_TIMEOUT;

            error.retryable =
                true;

            return error;

        }

        if (
            code === 'ECONNREFUSED' ||
            code === 'ECONNRESET' ||
            code === 'EAI_AGAIN' ||
            code === 'ENETUNREACH' ||
            code === 'EHOSTUNREACH'
        ) {

            error.code =
                ERROR_CODES.PROVIDER_UNAVAILABLE;

            error.retryable =
                true;

            return error;

        }

        return error;

    }


    /**
     * =========================================================================
     * Provider Error Creation
     * =========================================================================
     */

    createProviderError(
        code,
        message,
        metadata = {}
    ) {

        const error =
            new ProviderUnavailableError(
                message
            );

        error.code =
            code;

        Object.assign(
            error,
            metadata
        );

        error.retryable =
            true;

        return error;

    }


    /**
     * =========================================================================
     * Token Type Normalization
     * =========================================================================
     */

    normalizeTokenType(
        tokenType
    ) {

        const normalized =
            String(
                tokenType ||
                'Bearer'
            ).trim();

        if (
            !normalized
        ) {
            return 'Bearer';
        }

        if (
            SECURITY?.ALLOWED_TOKEN_TYPES?.includes?.(
                normalized
            )
        ) {

            return 'Bearer';

        }

        /**
         * OAuth access tokens should normally use Bearer.
         *
         * Do not silently accept arbitrary token schemes unless the provider
         * explicitly returns one.
         */
        return normalized;

    }


    /**
     * =========================================================================
     * Provider Error Extraction
     * =========================================================================
     */

    extractProviderErrorMessage(
        body
    ) {

        if (!body || typeof body !== 'object') {
            return null;
        }

        const candidates = [

            body.message,

            body.error_description,

            body.errorMessage,

            body.error?.message,

            body.error?.description,

            body.response?.message

        ];

        for (
            const candidate
            of candidates
        ) {

            if (
                typeof candidate === 'string' &&
                candidate.trim()
            ) {

                return candidate
                    .trim()
                    .slice(0, 500);

            }

        }

        return null;

    }


    /**
     * =========================================================================
     * Provider Error Code Extraction
     * =========================================================================
     */

    extractProviderErrorCode(
        body
    ) {

        if (!body || typeof body !== 'object') {
            return null;
        }

        const candidates = [

            body.code,

            body.error,

            body.errorCode,

            body.error?.code,

            body.response?.code

        ];

        for (
            const candidate
            of candidates
        ) {

            if (
                typeof candidate === 'string' &&
                candidate.trim()
            ) {

                return candidate
                    .trim()
                    .slice(0, 128);

            }

        }

        return null;

    }


    /**
     * =========================================================================
     * Health
     * =========================================================================
     */

    async health({

        deep = false

    } = {}) {

        try {

            const configurationValid =
                !!this.configurationState.endpoint;

            if (!configurationValid) {

                return {

                    provider:
                        PROVIDER_NAME,

                    status:
                        'DOWN',

                    reason:
                        'OAuth endpoint is not configured',

                    timestamp:
                        new Date()

                };

            }

            /**
             * Deep health does not perform a token acquisition.
             *
             * Authentication itself belongs to authService.
             *
             * This avoids accidentally creating OAuth traffic merely because
             * Kubernetes probes are running.
             */
            if (!deep) {

                return {

                    provider:
                        PROVIDER_NAME,

                    status:
                        this.healthState.status,

                    endpointConfigured:
                        true,

                    environment:
                        this.configurationState.environment,

                    lastSuccess:
                        this.healthState.lastSuccess,

                    lastFailure:
                        this.healthState.lastFailure,

                    consecutiveFailures:
                        this.healthState.consecutiveFailures,

                    timestamp:
                        new Date()

                };

            }

            /**
             * If the HTTP client provides a connectivity health method,
             * delegate to it.
             */
            if (
                typeof this.httpClient.health ===
                'function'
            ) {

                const transportHealth =
                    await this.httpClient.health();

                return {

                    provider:
                        PROVIDER_NAME,

                    status:
                        transportHealth?.status ||
                        this.healthState.status,

                    transport:
                        this.sanitizeHealthResult(
                            transportHealth
                        ),

                    endpointConfigured:
                        true,

                    timestamp:
                        new Date()

                };

            }

            return {

                provider:
                    PROVIDER_NAME,

                status:
                    this.healthState.status,

                endpointConfigured:
                    true,

                timestamp:
                    new Date()

            };

        }
        catch (error) {

            return {

                provider:
                    PROVIDER_NAME,

                status:
                    'DOWN',

                error:
                    this.safeErrorSummary(
                        error
                    ),

                timestamp:
                    new Date()

            };

        }

    }


    /**
     * =========================================================================
     * Health State
     * =========================================================================
     */

    markSuccess(
        latencyMs
    ) {

        this.healthState.status =
            'UP';

        this.healthState.lastSuccess =
            new Date();

        this.healthState.lastLatencyMs =
            latencyMs;

        this.healthState.consecutiveSuccesses++;

        this.healthState.consecutiveFailures =
            0;

        this.healthState.totalSuccesses++;

    }


    markFailure(
        error,
        latencyMs
    ) {

        this.healthState.status =
            this.isRetryable(error)
                ? 'DEGRADED'
                : 'DOWN';

        this.healthState.lastFailure =
            new Date();

        this.healthState.lastFailureCode =
            error?.code ||
            null;

        this.healthState.lastLatencyMs =
            latencyMs;

        this.healthState.consecutiveFailures++;

        this.healthState.consecutiveSuccesses =
            0;

        this.healthState.totalFailures++;

    }


    /**
     * =========================================================================
     * Safe Logging / Diagnostics
     * =========================================================================
     */

    safeErrorSummary(
        error
    ) {

        if (!error) {
            return null;
        }

        return {

            name:
                error.name,

            code:
                error.code,

            statusCode:
                error.statusCode,

            message:
                this.sanitizeMessage(
                    error.message
                ),

            retryable:
                error.retryable === true

        };

    }


    sanitizeMessage(
        message
    ) {

        if (
            typeof message !== 'string'
        ) {

            return message;

        }

        let sanitized =
            message;

        /**
         * Remove obvious bearer tokens.
         */
        sanitized =
            sanitized.replace(

                /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,

                'Bearer [REDACTED]'

            );

        /**
         * Remove common credential assignments.
         */
        for (
            const key
            of SENSITIVE_KEYS
        ) {

            const pattern =
                new RegExp(

                    `(${this.escapeRegex(key)}\\s*[:=]\\s*)[^,\\s&]+`,

                    'gi'

                );

            sanitized =
                sanitized.replace(

                    pattern,

                    '$1[REDACTED]'

                );

        }

        return sanitized.slice(
            0,
            1000
        );

    }


    escapeRegex(
        value
    ) {

        return String(
            value
        ).replace(
            /[.*+?^${}()|[\]\\]/g,
            '\\$&'
        );

    }


    sanitizeEndpoint(
        endpoint
    ) {

        if (
            typeof endpoint !== 'string'
        ) {
            return null;
        }

        try {

            const url =
                new URL(
                    endpoint
                );

            /**
             * OAuth endpoint should not normally contain secrets, but remove
             * query parameters defensively.
             */
            url.search =
                '';

            url.hash =
                '';

            return url.toString();

        }
        catch {

            return '[INVALID_ENDPOINT]';

        }

    }


    sanitizeHealthResult(
        result
    ) {

        if (
            !result ||
            typeof result !== 'object'
        ) {

            return result;

        }

        return {

            status:
                result.status,

            latencyMs:
                result.latencyMs,

            healthy:
                result.healthy

        };

    }


    /**
     * =========================================================================
     * OpenTelemetry Helpers
     * =========================================================================
     */

    setSpanAttributes(
        span,
        attributes = {}
    ) {

        if (
            !span ||
            typeof span.setAttribute !==
            'function'
        ) {
            return;
        }

        const safeAttributes = {

            'provider.name':
                PROVIDER_NAME,

            'payment.provider':
                PROVIDER_NAME,

            'tenant.id':
                attributes.tenantId ||
                'unknown',

            'correlation.id':
                attributes.correlationId ||
                'unknown',

            'request.id':
                attributes.requestId ||
                'unknown'

        };

        if (
            attributes.attempt !== undefined
        ) {

            safeAttributes[
                'retry.attempt'
            ] =
                Number(
                    attributes.attempt
                );

        }

        if (
            attributes.endpoint
        ) {

            safeAttributes[
                'server.endpoint'
            ] =
                attributes.endpoint;

        }

        for (
            const [key, value]
            of Object.entries(
                safeAttributes
            )
        ) {

            try {

                span.setAttribute(
                    key,
                    value
                );

            }
            catch {
                // Observability must never break authentication.
            }

        }

    }


    setSpanError(
        span,
        error
    ) {

        if (!span) {
            return;
        }

        try {

            span.recordException?.(
                error
            );

            span.setStatus?.({

                code:
                    2,

                message:
                    this.sanitizeMessage(
                        error?.message
                    )

            });

        }
        catch {
            // Tracing must never break authentication.
        }

    }


    /**
     * =========================================================================
     * Diagnostics Snapshot
     * =========================================================================
     */

    snapshot() {

        return {

            provider:
                PROVIDER_NAME,

            component:
                'oauth-client',

            status:
                this.healthState.status,

            startedAt:
                this.startedAt,

            uptimeMs:
                Date.now() -
                this.startedAt.getTime(),

            configuration: {

                endpointConfigured:
                    !!this.configurationState.endpoint,

                endpoint:
                    this.sanitizeEndpoint(
                        this.configurationState.endpoint
                    ),

                environment:
                    this.configurationState.environment,

                country:
                    this.configurationState.country,

                currency:
                    this.configurationState.currency,

                timeoutMs:
                    this.configurationState.timeoutMs

            },

            health: {

                status:
                    this.healthState.status,

                lastSuccess:
                    this.healthState.lastSuccess,

                lastFailure:
                    this.healthState.lastFailure,

                lastFailureCode:
                    this.healthState.lastFailureCode,

                consecutiveFailures:
                    this.healthState.consecutiveFailures,

                consecutiveSuccesses:
                    this.healthState.consecutiveSuccesses,

                lastLatencyMs:
                    this.healthState.lastLatencyMs

            },

            statistics: {

                totalRequests:
                    this.healthState.totalRequests,

                totalSuccesses:
                    this.healthState.totalSuccesses,

                totalFailures:
                    this.healthState.totalFailures,

                totalRetries:
                    this.healthState.totalRetries

            }

        };

    }


    /**
     * =========================================================================
     * Capability Declaration
     * =========================================================================
     */

    capabilities() {

        return Object.freeze({

            provider:
                PROVIDER_NAME,

            oauth:
                true,

            clientCredentialsGrant:
                true,

            tokenAcquisition:
                true,

            retry:
                true,

            exponentialBackoff:
                true,

            jitter:
                RETRY?.JITTER !== false,

            retryAfter:
                true,

            timeout:
                true,

            correlationIds:
                true,

            tenantContext:
                true,

            metrics:
                !!this.metrics,

            tracing:
                !!this.tracer,

            structuredLogging:
                !!this.logger,

            secretRedaction:
                true,

            healthMonitoring:
                true

        });

    }

}


module.exports = OAuthClient;