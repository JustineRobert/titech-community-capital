'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Authentication Constants
 * ============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/auth/authConstants.js
 *
 * Purpose:
 *   Centralized, immutable configuration and policy constants for the Airtel
 *   Money OAuth2 authentication subsystem.
 *
 * Design Principles:
 *   - Multi-tenant safe
 *   - Production hardened
 *   - Immutable configuration
 *   - Explicit environment selection
 *   - No credentials or secrets in source
 *   - No network operations
 *   - No mutable runtime state
 *   - Safe distributed token caching
 *   - Safe distributed token refresh locking
 *   - Clock-skew protection
 *   - OAuth response validation support
 *   - Retry / timeout policy
 *   - Circuit-breaker policy
 *   - Correlation / request tracing support
 *   - Credential rotation compatibility
 *   - Backward-compatible aliases
 *
 * SECURITY:
 *   NEVER place the following in this file:
 *
 *     clientId
 *     clientSecret
 *     accessToken
 *     refreshToken
 *     passwords
 *     API keys
 *     authorization headers
 *     private keys
 *
 * Secrets MUST be resolved by the credential-management layer.
 *
 * ============================================================================
 */

/**
 * ============================================================================
 * Environment Helpers
 * ============================================================================
 */

const readStringEnv = (
    ...names
) => {

    for (const name of names) {

        const value =
            process.env[name];

        if (
            value !== undefined &&
            value !== null &&
            String(value).trim() !== ''
        ) {

            return String(value).trim();

        }

    }

    return '';

};

const readIntegerEnv = (
    name,
    fallback,
    {
        min = Number.MIN_SAFE_INTEGER,
        max = Number.MAX_SAFE_INTEGER,
    } = {}
) => {

    const raw =
        process.env[name];

    if (
        raw === undefined ||
        raw === null ||
        String(raw).trim() === ''
    ) {

        return fallback;

    }

    const value =
        Number(raw);

    if (
        !Number.isFinite(value)
    ) {

        return fallback;

    }

    return Math.min(
        max,
        Math.max(
            min,
            Math.trunc(value)
        )
    );

};

const readBooleanEnv = (
    name,
    fallback = false
) => {

    const raw =
        process.env[name];

    if (
        raw === undefined ||
        raw === null
    ) {

        return fallback;

    }

    switch (
        String(raw)
            .trim()
            .toLowerCase()
    ) {

        case 'true':
        case '1':
        case 'yes':
        case 'on':

            return true;

        case 'false':
        case '0':
        case 'no':
        case 'off':

            return false;

        default:

            return fallback;

    }

};

/**
 * ============================================================================
 * Environment
 * ============================================================================
 */

const ENV = Object.freeze({

    NODE_ENV:
        readStringEnv(
            'NODE_ENV'
        )
        .toLowerCase() ||
        'development',

    AIRTEL_ENVIRONMENT:
        readStringEnv(
            'AIRTEL_ENVIRONMENT',
            'AIRTEL_API_ENVIRONMENT'
        )
        .toLowerCase(),

    AIRTEL_COUNTRY:
        readStringEnv(
            'AIRTEL_COUNTRY',
            'AIRTEL_MONEY_COUNTRY'
        )
        .toUpperCase() ||
        'UG',

    AIRTEL_CURRENCY:
        readStringEnv(
            'AIRTEL_CURRENCY',
            'AIRTEL_MONEY_CURRENCY'
        )
        .toUpperCase() ||
        'UGX',

    AIRTEL_API_BASE_URL:
        readStringEnv(
            'AIRTEL_API_BASE_URL'
        ),

    AIRTEL_AUTH_BASE_URL:
        readStringEnv(
            'AIRTEL_AUTH_BASE_URL'
        ),

    AIRTEL_AUTH_TIMEOUT_MS:
        readIntegerEnv(
            'AIRTEL_AUTH_TIMEOUT_MS',
            10000,
            {
                min: 1000,
                max: 120000,
            }
        ),

    AIRTEL_AUTH_RETRY_ATTEMPTS:
        readIntegerEnv(
            'AIRTEL_AUTH_RETRY_ATTEMPTS',
            3,
            {
                min: 0,
                max: 10,
            }
        ),

    AIRTEL_AUTH_RETRY_DELAY_MS:
        readIntegerEnv(
            'AIRTEL_AUTH_RETRY_DELAY_MS',
            250,
            {
                min: 0,
                max: 30000,
            }
        ),

    AIRTEL_TOKEN_SKEW_SECONDS:
        readIntegerEnv(
            'AIRTEL_TOKEN_SKEW_SECONDS',
            60,
            {
                min: 0,
                max: 3600,
            }
        ),

    AIRTEL_TOKEN_CACHE_TTL_SECONDS:
        readIntegerEnv(
            'AIRTEL_TOKEN_CACHE_TTL_SECONDS',
            3300,
            {
                min: 1,
                max: 86400,
            }
        ),

    AIRTEL_TOKEN_CACHE_PREFIX:
        readStringEnv(
            'AIRTEL_TOKEN_CACHE_PREFIX'
        ) ||
        'titech:payment:airtel:oauth',

    AIRTEL_OAUTH_SCOPE:
        readStringEnv(
            'AIRTEL_OAUTH_SCOPE'
        ),

    AIRTEL_USER_AGENT:
        readStringEnv(
            'AIRTEL_USER_AGENT'
        ) ||
        'TITech-Community-Capital/Airtel-Money-Client',

    AIRTEL_REQUIRE_CORRELATION_ID:
        readBooleanEnv(
            'AIRTEL_REQUIRE_CORRELATION_ID',
            false
        ),

    AIRTEL_STRICT_ENVIRONMENT:
        readBooleanEnv(
            'AIRTEL_STRICT_ENVIRONMENT',
            true
        ),

    AIRTEL_ALLOW_INSECURE_HTTP:
        readBooleanEnv(
            'AIRTEL_ALLOW_INSECURE_HTTP',
            false
        ),

    AIRTEL_CACHE_LOCK_TTL_MS:
        readIntegerEnv(
            'AIRTEL_CACHE_LOCK_TTL_MS',
            15000,
            {
                min: 1000,
                max: 120000,
            }
        ),

    AIRTEL_CACHE_LOCK_WAIT_MS:
        readIntegerEnv(
            'AIRTEL_CACHE_LOCK_WAIT_MS',
            100,
            {
                min: 10,
                max: 5000,
            }
        ),

    AIRTEL_CACHE_LOCK_MAX_WAIT_MS:
        readIntegerEnv(
            'AIRTEL_CACHE_LOCK_MAX_WAIT_MS',
            5000,
            {
                min: 100,
                max: 120000,
            }
        ),

});

/**
 * ============================================================================
 * Environment Names
 * ============================================================================
 */

const ENVIRONMENTS = Object.freeze({

    SANDBOX: 'sandbox',

    UAT: 'uat',

    PRODUCTION: 'production',

});

/**
 * ============================================================================
 * Environment Resolution
 * ============================================================================
 *
 * SECURITY DECISION:
 *
 * Production is NEVER selected solely because NODE_ENV=production.
 *
 * This prevents an accidental production deployment from silently switching
 * Airtel credentials/endpoints.
 *
 * Explicit:
 *
 *   AIRTEL_ENVIRONMENT=production
 *
 * is required for production.
 *
 * ============================================================================
 */

const resolveEnvironment = () => {

    const explicit =
        ENV.AIRTEL_ENVIRONMENT;

    if (
        explicit ===
        ENVIRONMENTS.PRODUCTION ||
        explicit === 'prod'
    ) {

        return ENVIRONMENTS.PRODUCTION;

    }

    if (
        explicit ===
        ENVIRONMENTS.UAT ||
        explicit === 'test'
    ) {

        return ENVIRONMENTS.UAT;

    }

    if (
        explicit ===
        ENVIRONMENTS.SANDBOX ||
        explicit === 'dev' ||
        explicit === 'development'
    ) {

        return ENVIRONMENTS.SANDBOX;

    }

    /**
     * Safe default.
     *
     * Even NODE_ENV=production does not automatically select Airtel
     * production.
     */
    return ENVIRONMENTS.SANDBOX;

};

const AIRTEL_ENVIRONMENT =
    resolveEnvironment();

/**
 * ============================================================================
 * Default Airtel API URLs
 * ============================================================================
 */

const DEFAULT_BASE_URLS =
    Object.freeze({

        [ENVIRONMENTS.SANDBOX]:
            'https://openapiuat.airtel.africa',

        [ENVIRONMENTS.UAT]:
            'https://openapiuat.airtel.africa',

        [ENVIRONMENTS.PRODUCTION]:
            'https://openapi.airtel.africa',

    });

const removeTrailingSlashes = (
    value
) => {

    return String(value || '')
        .trim()
        .replace(/\/+$/, '');

};

const API_BASE_URL =
    removeTrailingSlashes(
        ENV.AIRTEL_API_BASE_URL ||
        DEFAULT_BASE_URLS[
            AIRTEL_ENVIRONMENT
        ]
    );

const AUTH_BASE_URL =
    removeTrailingSlashes(
        ENV.AIRTEL_AUTH_BASE_URL ||
        API_BASE_URL
    );

/**
 * ============================================================================
 * Endpoint Configuration
 * ============================================================================
 */

const AUTH_ENDPOINTS =
    Object.freeze({

        TOKEN:
            '/auth/oauth2/token',

    });

/**
 * ============================================================================
 * OAuth Configuration
 * ============================================================================
 */

const OAUTH =
    Object.freeze({

        GRANT_TYPE:
            'client_credentials',

        TOKEN_TYPE:
            'Bearer',

        CONTENT_TYPE:
            'application/json',

        ACCEPT:
            'application/json',

        TOKEN_ENDPOINT:
            `${AUTH_BASE_URL}${AUTH_ENDPOINTS.TOKEN}`,

        SCOPE:
            ENV.AIRTEL_OAUTH_SCOPE ||
            undefined,

    });

/**
 * ============================================================================
 * HTTP Configuration
 * ============================================================================
 */

const HTTP =
    Object.freeze({

        METHODS:
            Object.freeze({

                GET: 'GET',

                POST: 'POST',

                PUT: 'PUT',

                PATCH: 'PATCH',

                DELETE: 'DELETE',

            }),

        STATUS:
            Object.freeze({

                OK: 200,

                CREATED: 201,

                ACCEPTED: 202,

                NO_CONTENT: 204,

                BAD_REQUEST: 400,

                UNAUTHORIZED: 401,

                FORBIDDEN: 403,

                NOT_FOUND: 404,

                CONFLICT: 409,

                UNPROCESSABLE_ENTITY: 422,

                TOO_MANY_REQUESTS: 429,

                INTERNAL_SERVER_ERROR: 500,

                BAD_GATEWAY: 502,

                SERVICE_UNAVAILABLE: 503,

                GATEWAY_TIMEOUT: 504,

            }),

        TIMEOUT_MS:
            ENV.AIRTEL_AUTH_TIMEOUT_MS,

        MAX_RESPONSE_BODY_BYTES:
            1024 * 1024,

        HEADERS:
            Object.freeze({

                CONTENT_TYPE:
                    'Content-Type',

                ACCEPT:
                    'Accept',

                AUTHORIZATION:
                    'Authorization',

                USER_AGENT:
                    'User-Agent',

                X_COUNTRY:
                    'X-Country',

                X_CURRENCY:
                    'X-Currency',

                X_REQUEST_ID:
                    'X-Request-ID',

                X_CORRELATION_ID:
                    'X-Correlation-ID',

                IDEMPOTENCY_KEY:
                    'Idempotency-Key',

            }),

    });

/**
 * ============================================================================
 * Header Configuration
 * ============================================================================
 */

const HEADERS =
    Object.freeze({

        JSON:
            Object.freeze({

                [HTTP.HEADERS.CONTENT_TYPE]:
                    OAUTH.CONTENT_TYPE,

                [HTTP.HEADERS.ACCEPT]:
                    OAUTH.ACCEPT,

            }),

        TOKEN_REQUEST:
            Object.freeze({

                [HTTP.HEADERS.CONTENT_TYPE]:
                    OAUTH.CONTENT_TYPE,

                [HTTP.HEADERS.ACCEPT]:
                    OAUTH.ACCEPT,

                [HTTP.HEADERS.X_COUNTRY]:
                    ENV.AIRTEL_COUNTRY,

                [HTTP.HEADERS.X_CURRENCY]:
                    ENV.AIRTEL_CURRENCY,

                [HTTP.HEADERS.USER_AGENT]:
                    ENV.AIRTEL_USER_AGENT,

            }),

    });

/**
 * ============================================================================
 * Token Lifecycle Configuration
 * ============================================================================
 */

const TOKEN =
    Object.freeze({

        DEFAULT_TTL_SECONDS:
            3600,

        SKEW_SECONDS:
            ENV.AIRTEL_TOKEN_SKEW_SECONDS,

        CACHE_TTL_SECONDS:
            ENV.AIRTEL_TOKEN_CACHE_TTL_SECONDS,

        MIN_VALIDITY_SECONDS:
            Math.max(
                1,
                Math.min(
                    30,
                    ENV.AIRTEL_TOKEN_SKEW_SECONDS ||
                    30
                )
            ),

        MIN_CACHE_TTL_SECONDS:
            1,

        MAX_CACHE_TTL_SECONDS:
            24 * 60 * 60,

        CACHE_PREFIX:
            ENV.AIRTEL_TOKEN_CACHE_PREFIX,

        CACHE_KEY_SEPARATOR:
            ':',

        /**
         * OAuth response fields.
         */
        RESPONSE_FIELDS:
            Object.freeze({

                ACCESS_TOKEN:
                    'access_token',

                TOKEN_TYPE:
                    'token_type',

                EXPIRES_IN:
                    'expires_in',

                REFRESH_TOKEN:
                    'refresh_token',

                SCOPE:
                    'scope',

            }),

        /**
         * Canonical internal token fields.
         */
        INTERNAL_FIELDS:
            Object.freeze({

                ACCESS_TOKEN:
                    'accessToken',

                TOKEN_TYPE:
                    'tokenType',

                EXPIRES_IN:
                    'expiresIn',

                EXPIRES_AT:
                    'expiresAt',

            }),

    });

/**
 * ============================================================================
 * Retry Configuration
 * ============================================================================
 */

const RETRY =
    Object.freeze({

        MAX_ATTEMPTS:
            ENV.AIRTEL_AUTH_RETRY_ATTEMPTS,

        INITIAL_DELAY_MS:
            ENV.AIRTEL_AUTH_RETRY_DELAY_MS,

        MAX_DELAY_MS:
            5000,

        BACKOFF_MULTIPLIER:
            2,

        JITTER:
            true,

        RETRYABLE_STATUS_CODES:
            Object.freeze([

                HTTP.STATUS.TOO_MANY_REQUESTS,

                HTTP.STATUS.BAD_GATEWAY,

                HTTP.STATUS.SERVICE_UNAVAILABLE,

                HTTP.STATUS.GATEWAY_TIMEOUT,

            ]),

        NON_RETRYABLE_STATUS_CODES:
            Object.freeze([

                HTTP.STATUS.BAD_REQUEST,

                HTTP.STATUS.UNAUTHORIZED,

                HTTP.STATUS.FORBIDDEN,

                HTTP.STATUS.NOT_FOUND,

                HTTP.STATUS.UNPROCESSABLE_ENTITY,

            ]),

    });

/**
 * ============================================================================
 * Circuit Breaker Configuration
 * ============================================================================
 */

const CIRCUIT_BREAKER =
    Object.freeze({

        FAILURE_THRESHOLD:
            5,

        SUCCESS_THRESHOLD:
            2,

        OPEN_STATE_TIMEOUT_MS:
            30000,

        HALF_OPEN_MAX_CALLS:
            1,

        REQUEST_TIMEOUT_MS:
            HTTP.TIMEOUT_MS,

    });

/**
 * ============================================================================
 * Cache Configuration
 * ============================================================================
 *
 * VERSION 2 is deliberately tenant-aware.
 *
 * The previous cache-key format:
 *
 *   airtel:payment:auth:v1:UG:UGX:production
 *
 * was unsafe for a multi-tenant authentication service because different
 * tenants could resolve to the same token key.
 *
 * Canonical format:
 *
 *   airtel:payment:auth:v2:UG:UGX:production:tenant:<tenantId>
 *
 * Credential version may optionally be appended when credential rotation
 * requires hard cache separation.
 *
 * ============================================================================
 */

const CACHE =
    Object.freeze({

        PROVIDER:
            'airtel',

        NAMESPACE:
            'payment',

        AUTH_NAMESPACE:
            'auth',

        KEY_VERSION:
            'v2',

        PREFIX:
            ENV.AIRTEL_TOKEN_CACHE_PREFIX,

        TENANT_NAMESPACE:
            'tenant',

        CREDENTIAL_NAMESPACE:
            'credential',

        LOCK_SUFFIX:
            'lock',

        LOCK_TTL_MS:
            ENV.AIRTEL_CACHE_LOCK_TTL_MS,

        LOCK_WAIT_MS:
            ENV.AIRTEL_CACHE_LOCK_WAIT_MS,

        LOCK_MAX_WAIT_MS:
            ENV.AIRTEL_CACHE_LOCK_MAX_WAIT_MS,

        MAX_TENANT_ID_LENGTH:
            128,

        MAX_CREDENTIAL_VERSION_LENGTH:
            128,

    });

/**
 * ============================================================================
 * Request / Correlation Configuration
 * ============================================================================
 */

const REQUEST =
    Object.freeze({

        CORRELATION_ID_HEADER:
            HTTP.HEADERS.X_CORRELATION_ID,

        REQUEST_ID_HEADER:
            HTTP.HEADERS.X_REQUEST_ID,

        IDEMPOTENCY_KEY_HEADER:
            HTTP.HEADERS.IDEMPOTENCY_KEY,

        MAX_ID_LENGTH:
            128,

        REQUIRE_CORRELATION_ID:
            ENV.AIRTEL_REQUIRE_CORRELATION_ID,

        SENSITIVE_FIELDS:
            Object.freeze([

                'client_id',

                'clientId',

                'client_secret',

                'clientSecret',

                'access_token',

                'accessToken',

                'refresh_token',

                'refreshToken',

                'authorization',

                'Authorization',

                'password',

                'token',

                'secret',

                'apiKey',

                'api_key',

                'privateKey',

                'private_key',

                'credential',

                'credentials',

            ]),

    });

/**
 * ============================================================================
 * Security Policy
 * ============================================================================
 */

const SECURITY =
    Object.freeze({

        ALLOWED_TOKEN_TYPES:
            Object.freeze([

                'Bearer',

                'bearer',

            ]),

        REQUIRED_CLIENT_CREDENTIALS:
            true,

        REQUIRE_HTTPS_IN_PRODUCTION:
            true,

        REDACT_CREDENTIALS:
            true,

        REDACT_AUTHORIZATION_HEADER:
            true,

        CACHE_CLIENT_SECRET:
            false,

        AUDIT_CLIENT_SECRET:
            false,

        AUDIT_ACCESS_TOKEN:
            false,

        LOG_ACCESS_TOKEN:
            false,

        LOG_CLIENT_SECRET:
            false,

        LOG_AUTHORIZATION_HEADER:
            false,

        MAX_ERROR_MESSAGE_LENGTH:
            1024,

    });

/**
 * ============================================================================
 * Provider Identity
 * ============================================================================
 */

const PROVIDER =
    Object.freeze({

        NAME:
            'airtel',

        DISPLAY_NAME:
            'Airtel Money',

        CODE:
            'AIRTEL_MONEY',

        COUNTRY:
            ENV.AIRTEL_COUNTRY,

        CURRENCY:
            ENV.AIRTEL_CURRENCY,

        ENVIRONMENT:
            AIRTEL_ENVIRONMENT,

        API_BASE_URL,

        AUTH_BASE_URL,

    });

/**
 * ============================================================================
 * Authentication Error Codes
 * ============================================================================
 */

const ERROR_CODES =
    Object.freeze({

        AUTHENTICATION_FAILED:
            'AIRTEL_AUTHENTICATION_FAILED',

        INVALID_CREDENTIALS:
            'AIRTEL_INVALID_CREDENTIALS',

        INVALID_TOKEN_RESPONSE:
            'AIRTEL_INVALID_TOKEN_RESPONSE',

        UNSUPPORTED_TOKEN_TYPE:
            'AIRTEL_UNSUPPORTED_TOKEN_TYPE',

        TOKEN_EXPIRED:
            'AIRTEL_TOKEN_EXPIRED',

        TOKEN_UNAVAILABLE:
            'AIRTEL_TOKEN_UNAVAILABLE',

        TOKEN_REFRESH_FAILED:
            'AIRTEL_TOKEN_REFRESH_FAILED',

        TOKEN_CACHE_ERROR:
            'AIRTEL_TOKEN_CACHE_ERROR',

        TOKEN_LOCK_ERROR:
            'AIRTEL_TOKEN_LOCK_ERROR',

        AUTH_TIMEOUT:
            'AIRTEL_AUTH_TIMEOUT',

        AUTH_RATE_LIMITED:
            'AIRTEL_AUTH_RATE_LIMITED',

        PROVIDER_UNAVAILABLE:
            'AIRTEL_PROVIDER_UNAVAILABLE',

        PROVIDER_BAD_GATEWAY:
            'AIRTEL_PROVIDER_BAD_GATEWAY',

        PROVIDER_CONFIGURATION_ERROR:
            'AIRTEL_PROVIDER_CONFIGURATION_ERROR',

        MISSING_CLIENT_ID:
            'AIRTEL_MISSING_CLIENT_ID',

        MISSING_CLIENT_SECRET:
            'AIRTEL_MISSING_CLIENT_SECRET',

        INVALID_BASE_URL:
            'AIRTEL_INVALID_BASE_URL',

        UNSUPPORTED_ENVIRONMENT:
            'AIRTEL_UNSUPPORTED_ENVIRONMENT',

        TENANT_ID_REQUIRED:
            'AIRTEL_TENANT_ID_REQUIRED',

        TENANT_ID_INVALID:
            'AIRTEL_TENANT_ID_INVALID',

        CORRELATION_ID_INVALID:
            'AIRTEL_CORRELATION_ID_INVALID',

        CREDENTIAL_VERSION_INVALID:
            'AIRTEL_CREDENTIAL_VERSION_INVALID',

        AUTH_SERVICE_NOT_INITIALIZED:
            'AIRTEL_AUTH_SERVICE_NOT_INITIALIZED',

    });

/**
 * ============================================================================
 * Validation Helpers
 * ============================================================================
 */

const isValidEnvironment =
    (environment) => {

        return Object.values(
            ENVIRONMENTS
        ).includes(
            String(environment)
                .trim()
                .toLowerCase()
        );

    };

const isValidHttpsUrl =
    (value) => {

        try {

            const url =
                new URL(value);

            return (
                url.protocol ===
                'https:'
            );

        } catch (error) {

            return false;

        }

    };

const validateIdentifier =
    (
        value,
        {
            name = 'identifier',
            maxLength = 128,
        } = {}
    ) => {

        if (
            value === undefined ||
            value === null
        ) {

            return {

                valid: false,

                message:
                    `${name} is required.`

            };

        }

        const normalized =
            String(value).trim();

        if (!normalized) {

            return {

                valid: false,

                message:
                    `${name} cannot be empty.`

            };

        }

        if (
            normalized.length >
            maxLength
        ) {

            return {

                valid: false,

                message:
                    `${name} exceeds maximum length.`

            };

        }

        return {

            valid: true,

            value: normalized,

        };

    };

/**
 * ============================================================================
 * Configuration Validation
 * ============================================================================
 *
 * This validates configuration only.
 *
 * Client credentials remain intentionally outside this module.
 * ============================================================================
 */

const validateConfiguration =
    (
        options = {}
    ) => {

        const errors = [];

        const environment =
            String(
                options.environment ||
                AIRTEL_ENVIRONMENT
            )
            .trim()
            .toLowerCase();

        const baseUrl =
            removeTrailingSlashes(
                options.baseUrl ||
                API_BASE_URL
            );

        const authBaseUrl =
            removeTrailingSlashes(
                options.authBaseUrl ||
                AUTH_BASE_URL
            );

        /**
         * Environment.
         */

        if (
            !isValidEnvironment(
                environment
            )
        ) {

            errors.push({

                code:
                    ERROR_CODES
                        .UNSUPPORTED_ENVIRONMENT,

                message:
                    `Unsupported Airtel environment: ${environment}`,

            });

        }

        /**
         * API URL.
         */

        if (!baseUrl) {

            errors.push({

                code:
                    ERROR_CODES
                        .INVALID_BASE_URL,

                message:
                    'Airtel API base URL is not configured.',

            });

        }

        /**
         * Auth URL.
         */

        if (!authBaseUrl) {

            errors.push({

                code:
                    ERROR_CODES
                        .INVALID_BASE_URL,

                message:
                    'Airtel authentication base URL is not configured.',

            });

        }

        /**
         * Production transport security.
         */

        if (
            SECURITY.REQUIRE_HTTPS_IN_PRODUCTION &&
            environment ===
                ENVIRONMENTS.PRODUCTION
        ) {

            if (
                !isValidHttpsUrl(
                    baseUrl
                )
            ) {

                errors.push({

                    code:
                        ERROR_CODES
                            .INVALID_BASE_URL,

                    message:
                        'Airtel production API URL must use HTTPS.',

                });

            }

            if (
                !isValidHttpsUrl(
                    authBaseUrl
                )
            ) {

                errors.push({

                    code:
                        ERROR_CODES
                            .INVALID_BASE_URL,

                    message:
                        'Airtel production authentication URL must use HTTPS.',

                });

            }

        }

        /**
         * Non-production HTTP is also rejected by default.
         */

        if (
            !ENV.AIRTEL_ALLOW_INSECURE_HTTP
        ) {

            if (
                !isValidHttpsUrl(
                    baseUrl
                )
            ) {

                errors.push({

                    code:
                        ERROR_CODES
                            .INVALID_BASE_URL,

                    message:
                        'Airtel API URL must use HTTPS.',

                });

            }

            if (
                !isValidHttpsUrl(
                    authBaseUrl
                )
            ) {

                errors.push({

                    code:
                        ERROR_CODES
                            .INVALID_BASE_URL,

                    message:
                        'Airtel authentication URL must use HTTPS.',

                });

            }

        }

        /**
         * Country.
         */

        if (
            !/^[A-Z]{2}$/.test(
                PROVIDER.COUNTRY
            )
        ) {

            errors.push({

                code:
                    ERROR_CODES
                        .PROVIDER_CONFIGURATION_ERROR,

                message:
                    'Airtel country must be a two-letter ISO-style code.',

            });

        }

        /**
         * Currency.
         */

        if (
            !/^[A-Z]{3}$/.test(
                PROVIDER.CURRENCY
            )
        ) {

            errors.push({

                code:
                    ERROR_CODES
                        .PROVIDER_CONFIGURATION_ERROR,

                message:
                    'Airtel currency must be a three-letter currency code.',

            });

        }

        /**
         * Retry policy.
         */

        if (
            RETRY.MAX_ATTEMPTS < 0
        ) {

            errors.push({

                code:
                    ERROR_CODES
                        .PROVIDER_CONFIGURATION_ERROR,

                message:
                    'Airtel retry attempts cannot be negative.',

            });

        }

        /**
         * Cache lock consistency.
         */

        if (
            CACHE.LOCK_MAX_WAIT_MS <
            CACHE.LOCK_WAIT_MS
        ) {

            errors.push({

                code:
                    ERROR_CODES
                        .PROVIDER_CONFIGURATION_ERROR,

                message:
                    'Airtel cache lock maximum wait must be greater than lock wait.',

            });

        }

        return Object.freeze({

            valid:
                errors.length === 0,

            errors:
                Object.freeze(
                    errors
                ),

        });

    };

/**
 * ============================================================================
 * Tenant / Credential Cache Key Normalization
 * ============================================================================
 */

const normalizeCacheIdentifier =
    (
        value,
        {
            name = 'identifier',
            maxLength = 128,
        } = {}
    ) => {

        const result =
            validateIdentifier(
                value,
                {
                    name,
                    maxLength,
                }
            );

        if (!result.valid) {

            const error =
                new Error(
                    result.message
                );

            error.code =
                name === 'tenantId'
                    ? ERROR_CODES.TENANT_ID_INVALID
                    : ERROR_CODES.CREDENTIAL_VERSION_INVALID;

            throw error;

        }

        /**
         * Prevent Redis key ambiguity and control characters.
         */

        return result.value
            .replace(/[\r\n\t]/g, '_')
            .replace(/:/g, '_');

    };

/**
 * ============================================================================
 * Tenant-Aware Token Cache Key
 * ============================================================================
 *
 * Canonical:
 *
 *   <prefix>:payment:auth:v2:<country>:<currency>:<environment>:tenant:<id>
 *
 * Optional credential version:
 *
 *   ...:credential:<version>
 *
 * This guarantees that authentication tokens cannot accidentally be shared
 * between tenants.
 * ============================================================================
 */

const buildTokenCacheKey = ({
    tenantId,
    country =
        PROVIDER.COUNTRY,
    currency =
        PROVIDER.CURRENCY,
    environment =
        PROVIDER.ENVIRONMENT,
    credentialVersion,
} = {}) => {

    const safeTenantId =
        normalizeCacheIdentifier(
            tenantId,
            {
                name:
                    'tenantId',

                maxLength:
                    CACHE.MAX_TENANT_ID_LENGTH,
            }
        );

    const safeCountry =
        String(
            country
        )
        .trim()
        .toUpperCase();

    const safeCurrency =
        String(
            currency
        )
        .trim()
        .toUpperCase();

    const safeEnvironment =
        String(
            environment
        )
        .trim()
        .toLowerCase();

    const parts = [

        CACHE.PREFIX,

        CACHE.NAMESPACE,

        CACHE.AUTH_NAMESPACE,

        CACHE.KEY_VERSION,

        safeCountry,

        safeCurrency,

        safeEnvironment,

        CACHE.TENANT_NAMESPACE,

        safeTenantId,

    ];

    if (
        credentialVersion !== undefined &&
        credentialVersion !== null &&
        String(credentialVersion).trim() !== ''
    ) {

        const safeCredentialVersion =
            normalizeCacheIdentifier(
                credentialVersion,
                {
                    name:
                        'credentialVersion',

                    maxLength:
                        CACHE.MAX_CREDENTIAL_VERSION_LENGTH,
                }
            );

        parts.push(
            CACHE.CREDENTIAL_NAMESPACE,
            safeCredentialVersion
        );

    }

    return parts.join(
        CACHE.KEY_SEPARATOR
    );

};

/**
 * ============================================================================
 * Tenant-Aware Token Lock Key
 * ============================================================================
 */

const buildTokenLockKey = (
    options = {}
) => {

    return [
        buildTokenCacheKey(
            options
        ),
        CACHE.LOCK_SUFFIX,
    ].join(
        CACHE.KEY_SEPARATOR
    );

};

/**
 * ============================================================================
 * Token Expiry Helpers
 * ============================================================================
 */

/**
 * Calculate safe cache TTL from provider expires_in.
 *
 * Example:
 *
 *   expires_in = 3600
 *   skew       = 60
 *   cache TTL  = 3540
 *
 * This prevents a cached token from being used right at provider expiry.
 */
const calculateTokenTtlSeconds = (
    expiresIn
) => {

    const numericExpiresIn =
        Number(
            expiresIn
        );

    if (
        !Number.isFinite(
            numericExpiresIn
        ) ||
        numericExpiresIn <= 0
    ) {

        return 0;

    }

    const safeTtl =
        Math.floor(
            numericExpiresIn -
            TOKEN.SKEW_SECONDS
        );

    /**
     * Never cache a token when its remaining safe lifetime is zero or less.
     */
    if (
        safeTtl <= 0
    ) {

        return 0;

    }

    return Math.min(

        TOKEN.MAX_CACHE_TTL_SECONDS,

        Math.max(
            TOKEN.MIN_CACHE_TTL_SECONDS,
            safeTtl
        )

    );

};

/**
 * Calculate absolute expiry time.
 */
const calculateExpiresAt = (
    expiresIn,
    nowMs = Date.now()
) => {

    const numericExpiresIn =
        Number(
            expiresIn
        );

    if (
        !Number.isFinite(
            numericExpiresIn
        ) ||
        numericExpiresIn <= 0
    ) {

        return null;

    }

    const timestamp =
        Number(
            nowMs
        );

    if (
        !Number.isFinite(
            timestamp
        )
    ) {

        return null;

    }

    return new Date(
        timestamp +
        numericExpiresIn * 1000
    );

};

/**
 * Determine whether a token has sufficient remaining validity.
 */
const isTokenUsable = ({
    expiresAt,
    nowMs = Date.now(),
    minimumValiditySeconds =
        TOKEN.MIN_VALIDITY_SECONDS,
} = {}) => {

    if (!expiresAt) {

        return false;

    }

    const expiryMs =
        expiresAt instanceof Date
            ? expiresAt.getTime()
            : new Date(
                expiresAt
            ).getTime();

    if (
        !Number.isFinite(
            expiryMs
        )
    ) {

        return false;

    }

    const currentMs =
        Number(
            nowMs
        );

    if (
        !Number.isFinite(
            currentMs
        )
    ) {

        return false;

    }

    const minimumValidityMs =
        Math.max(
            0,
            Number(
                minimumValiditySeconds
            )
        ) * 1000;

    return (
        expiryMs -
        currentMs >
        minimumValidityMs
    );

};

/**
 ============================================================================
 * OAuth Token Response Validation
 * ============================================================================
 */

const isSuccessfulTokenResponse = (
    response = {}
) => {

    if (
        !response ||
        typeof response !== 'object'
    ) {

        return false;

    }

    const token =
        response[
            TOKEN.RESPONSE_FIELDS
                .ACCESS_TOKEN
        ];

    return (
        typeof token === 'string' &&
        token.trim().length > 0
    );

};

/**
 * ============================================================================
 * Token Type Normalization
 * ============================================================================
 *
 * Only Bearer authentication is accepted.
 *
 * Returning an arbitrary provider-supplied token type would allow a malformed
 * or unexpected OAuth response to propagate into payment requests.
 * ============================================================================
 */

const normalizeTokenType = (
    tokenType
) => {

    if (
        tokenType === undefined ||
        tokenType === null ||
        String(tokenType).trim() === ''
    ) {

        return OAUTH.TOKEN_TYPE;

    }

    const normalized =
        String(
            tokenType
        ).trim();

    if (
        !SECURITY.ALLOWED_TOKEN_TYPES
            .includes(
                normalized
            )
    ) {

        const error =
            new Error(
                `Unsupported Airtel OAuth token type: ${normalized}`
            );

        error.code =
            ERROR_CODES
                .UNSUPPORTED_TOKEN_TYPE;

        throw error;

    }

    return OAUTH.TOKEN_TYPE;

};

/**
 * ============================================================================
 * Public Configuration
 * ============================================================================
 */

const CONFIG =
    Object.freeze({

        provider:
            PROVIDER,

        environment:
            AIRTEL_ENVIRONMENT,

        baseUrl:
            API_BASE_URL,

        authBaseUrl:
            AUTH_BASE_URL,

        endpoints:
            AUTH_ENDPOINTS,

        oauth:
            OAUTH,

        http:
            HTTP,

        headers:
            HEADERS,

        token:
            TOKEN,

        retry:
            RETRY,

        circuitBreaker:
            CIRCUIT_BREAKER,

        cache:
            CACHE,

        request:
            REQUEST,

        security:
            SECURITY,

        errors:
            ERROR_CODES,

    });

/**
 * ============================================================================
 * Backward-Compatible Aliases
 * ============================================================================
 */

const AUTH_CONSTANTS =
    Object.freeze({

        ...CONFIG,

        PROVIDER_NAME:
            PROVIDER.NAME,

        PROVIDER_CODE:
            PROVIDER.CODE,

        PROVIDER_DISPLAY_NAME:
            PROVIDER.DISPLAY_NAME,

        ENVIRONMENT:
            AIRTEL_ENVIRONMENT,

        SANDBOX:
            ENVIRONMENTS.SANDBOX,

        UAT:
            ENVIRONMENTS.UAT,

        PRODUCTION:
            ENVIRONMENTS.PRODUCTION,

        BASE_URL:
            API_BASE_URL,

        API_BASE_URL,

        AUTH_BASE_URL,

        TOKEN_URL:
            OAUTH.TOKEN_ENDPOINT,

        GRANT_TYPE:
            OAUTH.GRANT_TYPE,

        TOKEN_TYPE:
            OAUTH.TOKEN_TYPE,

        CONTENT_TYPE:
            OAUTH.CONTENT_TYPE,

        COUNTRY:
            PROVIDER.COUNTRY,

        CURRENCY:
            PROVIDER.CURRENCY,

        TIMEOUT_MS:
            HTTP.TIMEOUT_MS,

        MAX_RETRIES:
            RETRY.MAX_ATTEMPTS,

        RETRY_DELAY_MS:
            RETRY.INITIAL_DELAY_MS,

        TOKEN_SKEW_SECONDS:
            TOKEN.SKEW_SECONDS,

        TOKEN_CACHE_TTL_SECONDS:
            TOKEN.CACHE_TTL_SECONDS,

    });

/**
 * ============================================================================
 * Final Immutable Export
 * ============================================================================
 */

module.exports =
    Object.freeze({

        ...AUTH_CONSTANTS,

        ENV,

        ENVIRONMENTS,

        DEFAULT_BASE_URLS,

        PROVIDER,

        AUTH_ENDPOINTS,

        OAUTH,

        HTTP,

        HEADERS,

        TOKEN,

        RETRY,

        CIRCUIT_BREAKER,

        CACHE,

        REQUEST,

        SECURITY,

        ERROR_CODES,

        CONFIG,

        validateConfiguration,

        isValidEnvironment,

        validateIdentifier,

        buildTokenCacheKey,

        buildTokenLockKey,

        calculateTokenTtlSeconds,

        calculateExpiresAt,

        isTokenUsable,

        isSuccessfulTokenResponse,

        normalizeTokenType,

    });