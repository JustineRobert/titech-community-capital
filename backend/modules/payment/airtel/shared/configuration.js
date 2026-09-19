'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Airtel Money Enterprise Configuration Boundary
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/shared/configuration.js
 *
 * Architectural Role
 * ------------------
 * Canonical configuration boundary for the Airtel Money provider integration.
 *
 * This module translates application configuration/environment values into a
 * validated, immutable Airtel provider configuration object.
 *
 * Responsibilities
 * ----------------
 * • Load Airtel-specific configuration from approved sources.
 * • Validate required provider endpoints and runtime settings.
 * • Resolve provider endpoint families.
 * • Expose non-secret provider configuration.
 * • Provide credential references without exposing credential values.
 * • Validate transport/security settings.
 * • Define timeout/retry/rate-limit policies.
 * • Provide safe diagnostics and health information.
 * • Support dependency injection and explicit configuration objects.
 *
 * Does NOT:
 * ----------
 * • Perform HTTP/network calls.
 * • Obtain OAuth tokens.
 * • Store OAuth access/refresh tokens.
 * • Perform payment collections.
 * • Perform disbursements.
 * • Process callbacks.
 * • Reconcile payments.
 * • Post ledger entries.
 * • Modify wallet balances.
 *
 * Security Principles
 * -------------------
 * • Production secrets are supplied through environment/secret-management
 *   infrastructure, not hard-coded into source.
 * • Secret values are never returned from diagnostics().
 * • Endpoint URLs must not contain embedded credentials.
 * • HTTPS is required unless explicitly enabled for local development.
 * • Configuration is immutable after construction.
 * • Environment selection is explicit and normalized.
 * • Unknown provider configuration keys are ignored rather than silently
 *   becoming runtime behavior.
 *
 * Provider Contract
 * -----------------
 * Exact Airtel API paths are configuration-authoritative. This module does not
 * invent undocumented production URLs.
 *
 * Supported endpoint aliases include:
 *   base
 *   baseUrl
 *   auth
 *   token
 *   collection
 *   collections
 *   disbursement
 *   disbursements
 *   callback
 *   callbacks
 *   settlement
 *   settlements
 *   reconciliation
 *
 * Module Format
 * -------------
 * CommonJS.
 *
 * =============================================================================
 */

const crypto = require('crypto');


const PROVIDER = 'AIRTEL';


const ENVIRONMENTS = Object.freeze({
    DEVELOPMENT:
        'development',

    TEST:
        'test',

    STAGING:
        'staging',

    PRODUCTION:
        'production'
});


const DEFAULTS = Object.freeze({
    environment:
        ENVIRONMENTS.DEVELOPMENT,

    requestTimeoutMs:
        60_000,

    connectTimeoutMs:
        10_000,

    tokenTimeoutMs:
        30_000,

    maxBodyBytes:
        1 * 1024 * 1024,

    maxRetries:
        3,

    retryBaseDelayMs:
        250,

    retryMaxDelayMs:
        5_000,

    tokenRefreshSafetyWindowSeconds:
        60,

    rateLimitPerMinute:
        100,

    circuitFailureThreshold:
        5,

    circuitResetTimeoutMs:
        30_000,

    allowHttpInDevelopment:
        true
});


const REQUIRED_ENDPOINT_KEYS = Object.freeze([
    'base'
]);


const OPTIONAL_ENDPOINT_KEYS = Object.freeze([
    'auth',
    'token',
    'collection',
    'collections',
    'disbursement',
    'disbursements',
    'callback',
    'callbacks',
    'settlement',
    'settlements',
    'reconciliation'
]);


const SENSITIVE_CONFIG_KEYS = new Set([
    'clientSecret',
    'client_secret',
    'apiKey',
    'api_key',
    'password',
    'secret',
    'accessToken',
    'refreshToken',
    'token',
    'privateKey',
    'private_key',
    'credentialValue',
    'credentials'
]);


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
    value
) {
    if (
        value === undefined ||
        value === null
    ) {
        return undefined;
    }

    const result =
        String(value).trim();

    return result || undefined;
}


function positiveInteger(
    value,
    name
) {
    const number =
        Number(value);

    if (
        !Number.isSafeInteger(number) ||
        number <= 0
    ) {
        throw createConfigurationError(
            'AIRTEL_CONFIGURATION_INVALID',
            `${name} must be a positive safe integer`
        );
    }

    return number;
}


function nonNegativeInteger(
    value,
    name
) {
    const number =
        Number(value);

    if (
        !Number.isSafeInteger(number) ||
        number < 0
    ) {
        throw createConfigurationError(
            'AIRTEL_CONFIGURATION_INVALID',
            `${name} must be a non-negative safe integer`
        );
    }

    return number;
}


function booleanValue(
    value,
    fallback
) {
    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {
        return fallback;
    }

    if (
        typeof value === 'boolean'
    ) {
        return value;
    }

    const normalized =
        String(value)
            .trim()
            .toLowerCase();

    if (
        [
            'true',
            '1',
            'yes',
            'on'
        ].includes(normalized)
    ) {
        return true;
    }

    if (
        [
            'false',
            '0',
            'no',
            'off'
        ].includes(normalized)
    ) {
        return false;
    }

    throw createConfigurationError(
        'AIRTEL_CONFIGURATION_BOOLEAN_INVALID',
        `Invalid boolean configuration value: ${value}`
    );
}


function normalizeEnvironment(
    value
) {
    const normalized =
        String(
            value ||
            DEFAULTS.environment
        )
            .trim()
            .toLowerCase();

    if (
        !Object.values(
            ENVIRONMENTS
        ).includes(
            normalized
        )
    ) {
        throw createConfigurationError(
            'AIRTEL_ENVIRONMENT_INVALID',
            `Unsupported Airtel environment: ${value}`
        );
    }

    return normalized;
}


function normalizeCurrency(
    value,
    fallback = 'UGX'
) {
    const currency =
        String(
            value ||
            fallback
        )
            .trim()
            .toUpperCase();

    if (
        !/^[A-Z]{3}$/.test(
            currency
        )
    ) {
        throw createConfigurationError(
            'AIRTEL_DEFAULT_CURRENCY_INVALID',
            `Invalid currency code: ${currency}`
        );
    }

    return currency;
}


function assertSafeUrl(
    url,
    {
        environment,
        name,
        allowHttpInDevelopment
    }
) {
    const candidate =
        safeString(url);

    if (
        !candidate
    ) {
        return undefined;
    }

    let parsed;

    try {
        parsed =
            new URL(
                candidate
            );
    } catch (error) {
        throw createConfigurationError(
            'AIRTEL_ENDPOINT_INVALID',
            `Invalid Airtel ${name} endpoint`,
            {
                cause:
                    error
            }
        );
    }

    if (
        parsed.username ||
        parsed.password
    ) {
        throw createConfigurationError(
            'AIRTEL_ENDPOINT_CREDENTIALS_FORBIDDEN',
            `Airtel ${name} endpoint must not contain embedded credentials`
        );
    }

    const httpAllowed =
        environment !==
            ENVIRONMENTS.PRODUCTION &&
        allowHttpInDevelopment;

    if (
        parsed.protocol !== 'https:' &&
        !(
            httpAllowed &&
            parsed.protocol === 'http:'
        )
    ) {
        throw createConfigurationError(
            'AIRTEL_ENDPOINT_PROTOCOL_FORBIDDEN',
            `Airtel ${name} endpoint must use HTTPS`
        );
    }

    return parsed.toString().replace(
        /\/+$/,
        ''
    );
}


function clone(
    value
) {
    if (
        Array.isArray(value)
    ) {
        return value.map(
            item =>
                clone(item)
        );
    }

    if (
        !isPlainObject(value)
    ) {
        return value;
    }

    const output = {};

    for (
        const [
            key,
            item
        ] of Object.entries(value)
    ) {
        output[key] =
            clone(item);
    }

    return output;
}


function redact(
    value,
    depth = 0
) {
    if (
        depth > 6
    ) {
        return '[TRUNCATED]';
    }

    if (
        Array.isArray(value)
    ) {
        return value.map(
            item =>
                redact(
                    item,
                    depth + 1
                )
        );
    }

    if (
        !isPlainObject(value)
    ) {
        return value;
    }

    const output = {};

    for (
        const [
            key,
            item
        ] of Object.entries(value)
    ) {
        const normalizedKey =
            String(key)
                .toLowerCase();

        if (
            SENSITIVE_CONFIG_KEYS.has(
                key
            ) ||
            [
                'clientsecret',
                'client_secret',
                'apikey',
                'api_key',
                'password',
                'secret',
                'token',
                'accesstoken',
                'refreshtoken',
                'privatekey',
                'credentials'
            ].includes(
                normalizedKey
            )
        ) {
            output[key] =
                '[REDACTED]';

            continue;
        }

        output[key] =
            redact(
                item,
                depth + 1
            );
    }

    return output;
}


function createConfigurationError(
    code,
    message,
    details = {}
) {
    const error =
        new Error(
            message
        );

    error.name =
        'AirtelConfigurationError';

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


function environmentValue(
    env,
    key,
    fallback
) {
    if (
        env &&
        Object.prototype.hasOwnProperty.call(
            env,
            key
        )
    ) {
        return env[key];
    }

    if (
        process.env &&
        Object.prototype.hasOwnProperty.call(
            process.env,
            key
        )
    ) {
        return process.env[key];
    }

    return fallback;
}


/**
 * ============================================================================
 * Airtel Configuration
 * ============================================================================
 */
class AirtelConfiguration {

    constructor(options = {}) {
        if (
            !isPlainObject(options)
        ) {
            throw new TypeError(
                'Airtel configuration options must be an object'
            );
        }

        this.startedAt =
            new Date();

        this.provider =
            PROVIDER;

        this.environment =
            normalizeEnvironment(
                options.environment ||
                environmentValue(
                    options.env,
                    'AIRTEL_ENVIRONMENT'
                )
            );

        this.region =
            safeString(
                options.region ||
                environmentValue(
                    options.env,
                    'AIRTEL_REGION',
                    'UG'
                )
            );

        this.country =
            safeString(
                options.country ||
                environmentValue(
                    options.env,
                    'AIRTEL_COUNTRY',
                    'UG'
                )
            );

        this.currency =
            normalizeCurrency(
                options.currency ||
                environmentValue(
                    options.env,
                    'AIRTEL_DEFAULT_CURRENCY'
                )
            );

        this.apiVersion =
            safeString(
                options.apiVersion ||
                environmentValue(
                    options.env,
                    'AIRTEL_API_VERSION'
                )
            );

        this.endpoints =
            Object.freeze(
                this.buildEndpoints(
                    options.endpoints ||
                    this.readEndpointEnvironment(
                        options.env
                    )
                )
            );

        this.credentials =
            Object.freeze(
                this.buildCredentialReferences({
                    ...options,

                    credentials:
                        options.credentials ||
                        this.readCredentialEnvironment(
                            options.env
                        )
                })
            );

        this.transport =
            Object.freeze(
                this.buildTransportConfiguration(
                    options.transport ||
                    {}
                )
            );

        this.retry =
            Object.freeze(
                this.buildRetryConfiguration(
                    options.retry ||
                    {}
                )
            );

        this.rateLimit =
            Object.freeze(
                this.buildRateLimitConfiguration(
                    options.rateLimit ||
                    {}
                )
            );

        this.oauth =
            Object.freeze(
                this.buildOAuthConfiguration(
                    options.oauth ||
                    {}
                )
            );

        this.security =
            Object.freeze(
                this.buildSecurityConfiguration(
                    options.security ||
                    {}
                )
            );

        this.features =
            Object.freeze(
                this.buildFeatureConfiguration(
                    options.features ||
                    {}
                )
            );

        this.custom =
            Object.freeze(
                redact(
                    clone(
                        options.custom ||
                        {}
                    )
                )
            );

        /**
         * Freeze the top-level object after all configuration has been built.
         * Consumers should treat the object as immutable.
         */
        Object.freeze(
            this
        );
    }


    /**
     * =========================================================================
     * Endpoint Configuration
     * =========================================================================
     */
    buildEndpoints(
        supplied = {}
    ) {
        const endpoints =
            isPlainObject(
                supplied
            )
                ? supplied
                : {};

        const environment =
            this.environment;

        const allowHttpInDevelopment =
            booleanValue(
                environmentValue(
                    null,
                    'AIRTEL_ALLOW_HTTP_IN_DEVELOPMENT'
                ),
                DEFAULTS.allowHttpInDevelopment
            );

        const base =
            endpoints.base ||
            endpoints.baseUrl ||
            endpoints.apiBaseUrl ||
            environmentValue(
                null,
                'AIRTEL_BASE_URL'
            );

        if (
            !base
        ) {
            throw createConfigurationError(
                'AIRTEL_ENDPOINT_UNCONFIGURED',
                'AIRTEL_BASE_URL is required'
            );
        }

        const result = {};

        result.base =
            assertSafeUrl(
                base,
                {
                    environment,
                    name:
                        'base',
                    allowHttpInDevelopment
                }
            );

        const mappings = {
            auth: [
                endpoints.auth,
                endpoints.authentication,
                environmentValue(
                    null,
                    'AIRTEL_AUTH_URL'
                )
            ],

            token: [
                endpoints.token,
                endpoints.oauth,
                environmentValue(
                    null,
                    'AIRTEL_TOKEN_URL'
                )
            ],

            collection: [
                endpoints.collection,
                endpoints.collections,
                environmentValue(
                    null,
                    'AIRTEL_COLLECTION_URL'
                )
            ],

            collections: [
                endpoints.collections,
                endpoints.collection,
                environmentValue(
                    null,
                    'AIRTEL_COLLECTION_URL'
                )
            ],

            disbursement: [
                endpoints.disbursement,
                endpoints.disbursements,
                environmentValue(
                    null,
                    'AIRTEL_DISBURSEMENT_URL'
                )
            ],

            disbursements: [
                endpoints.disbursements,
                endpoints.disbursement,
                environmentValue(
                    null,
                    'AIRTEL_DISBURSEMENT_URL'
                )
            ],

            callback: [
                endpoints.callback,
                endpoints.callbacks,
                environmentValue(
                    null,
                    'AIRTEL_CALLBACK_URL'
                )
            ],

            callbacks: [
                endpoints.callbacks,
                endpoints.callback,
                environmentValue(
                    null,
                    'AIRTEL_CALLBACK_URL'
                )
            ],

            settlement: [
                endpoints.settlement,
                endpoints.settlements,
                environmentValue(
                    null,
                    'AIRTEL_SETTLEMENT_URL'
                )
            ],

            settlements: [
                endpoints.settlements,
                endpoints.settlement,
                environmentValue(
                    null,
                    'AIRTEL_SETTLEMENT_URL'
                )
            ],

            reconciliation: [
                endpoints.reconciliation,
                environmentValue(
                    null,
                    'AIRTEL_RECONCILIATION_URL'
                )
            ]
        };

        for (
            const [
                name,
                candidates
            ] of Object.entries(
                mappings
            )
        ) {
            const candidate =
                candidates.find(
                    value =>
                        safeString(
                            value
                        )
                );

            if (
                candidate
            ) {
                result[name] =
                    assertSafeUrl(
                        candidate,
                        {
                            environment,
                            name,
                            allowHttpInDevelopment
                        }
                    );
            }
        }

        /**
         * Preserve only defined endpoint values and make them immutable.
         */
        return result;
    }


    readEndpointEnvironment(
        env
    ) {
        return {
            base:
                environmentValue(
                    env,
                    'AIRTEL_BASE_URL'
                ),

            auth:
                environmentValue(
                    env,
                    'AIRTEL_AUTH_URL'
                ),

            token:
                environmentValue(
                    env,
                    'AIRTEL_TOKEN_URL'
                ),

            collection:
                environmentValue(
                    env,
                    'AIRTEL_COLLECTION_URL'
                ),

            disbursement:
                environmentValue(
                    env,
                    'AIRTEL_DISBURSEMENT_URL'
                ),

            callback:
                environmentValue(
                    env,
                    'AIRTEL_CALLBACK_URL'
                ),

            settlement:
                environmentValue(
                    env,
                    'AIRTEL_SETTLEMENT_URL'
                ),

            reconciliation:
                environmentValue(
                    env,
                    'AIRTEL_RECONCILIATION_URL'
                )
        };
    }


    /**
     * =========================================================================
     * Credential References
     * =========================================================================
     *
     * The configuration stores references/identifiers, not secret material.
     * A secret manager or credentialManager should resolve the actual values.
     */
    buildCredentialReferences(
        options = {}
    ) {
        const credentials =
            isPlainObject(
                options.credentials
            )
                ? options.credentials
                : {};

        const clientId =
            safeString(
                credentials.clientId ||
                credentials.client_id ||
                options.clientId ||
                environmentValue(
                    options.env,
                    'AIRTEL_CLIENT_ID'
                )
            );

        const clientSecretReference =
            safeString(
                credentials.clientSecretReference ||
                credentials.client_secret_reference ||
                options.clientSecretReference ||
                environmentValue(
                    options.env,
                    'AIRTEL_CLIENT_SECRET_REFERENCE'
                )
            );

        const apiKeyReference =
            safeString(
                credentials.apiKeyReference ||
                credentials.api_key_reference ||
                options.apiKeyReference ||
                environmentValue(
                    options.env,
                    'AIRTEL_API_KEY_REFERENCE'
                )
            );

        const secretManager =
            safeString(
                credentials.secretManager ||
                options.secretManager ||
                environmentValue(
                    options.env,
                    'AIRTEL_SECRET_MANAGER'
                )
            );

        return {
            clientId,

            /**
             * References identify where a secret is stored. They are not the
             * secret value itself.
             */
            clientSecretReference,

            apiKeyReference,

            secretManager,

            credentialVersion:
                safeString(
                    credentials.version ||
                    options.credentialVersion ||
                    environmentValue(
                        options.env,
                        'AIRTEL_CREDENTIAL_VERSION'
                    )
                )
        };
    }


    readCredentialEnvironment(
        env
    ) {
        return {
            clientId:
                environmentValue(
                    env,
                    'AIRTEL_CLIENT_ID'
                ),

            clientSecretReference:
                environmentValue(
                    env,
                    'AIRTEL_CLIENT_SECRET_REFERENCE'
                ),

            apiKeyReference:
                environmentValue(
                    env,
                    'AIRTEL_API_KEY_REFERENCE'
                ),

            secretManager:
                environmentValue(
                    env,
                    'AIRTEL_SECRET_MANAGER'
                ),

            version:
                environmentValue(
                    env,
                    'AIRTEL_CREDENTIAL_VERSION'
                )
        };
    }


    /**
     * =========================================================================
     * Transport
     * =========================================================================
     */
    buildTransportConfiguration(
        supplied = {}
    ) {
        const timeoutMs =
            supplied.timeoutMs ??
            environmentValue(
                null,
                'AIRTEL_REQUEST_TIMEOUT_MS',
                DEFAULTS.requestTimeoutMs
            );

        const connectTimeoutMs =
            supplied.connectTimeoutMs ??
            environmentValue(
                null,
                'AIRTEL_CONNECT_TIMEOUT_MS',
                DEFAULTS.connectTimeoutMs
            );

        const tokenTimeoutMs =
            supplied.tokenTimeoutMs ??
            environmentValue(
                null,
                'AIRTEL_TOKEN_TIMEOUT_MS',
                DEFAULTS.tokenTimeoutMs
            );

        const maxBodyBytes =
            supplied.maxBodyBytes ??
            environmentValue(
                null,
                'AIRTEL_MAX_BODY_BYTES',
                DEFAULTS.maxBodyBytes
            );

        return {
            timeoutMs:
                positiveInteger(
                    timeoutMs,
                    'requestTimeoutMs'
                ),

            connectTimeoutMs:
                positiveInteger(
                    connectTimeoutMs,
                    'connectTimeoutMs'
                ),

            tokenTimeoutMs:
                positiveInteger(
                    tokenTimeoutMs,
                    'tokenTimeoutMs'
                ),

            maxBodyBytes:
                positiveInteger(
                    maxBodyBytes,
                    'maxBodyBytes'
                ),

            keepAlive:
                booleanValue(
                    supplied.keepAlive ??
                    environmentValue(
                        null,
                        'AIRTEL_HTTP_KEEP_ALIVE'
                    ),
                    true
                ),

            decompress:
                booleanValue(
                    supplied.decompress ??
                    environmentValue(
                        null,
                        'AIRTEL_HTTP_DECOMPRESS'
                    ),
                    true
                ),

            validateCertificates:
                booleanValue(
                    supplied.validateCertificates ??
                    environmentValue(
                        null,
                        'AIRTEL_TLS_VALIDATE_CERTIFICATES'
                    ),
                    true
                )
        };
    }


    /**
     * =========================================================================
     * Retry Policy
     * =========================================================================
     */
    buildRetryConfiguration(
        supplied = {}
    ) {
        return {
            maxRetries:
                nonNegativeInteger(
                    supplied.maxRetries ??
                    environmentValue(
                        null,
                        'AIRTEL_MAX_RETRIES',
                        DEFAULTS.maxRetries
                    ),
                    'maxRetries'
                ),

            baseDelayMs:
                nonNegativeInteger(
                    supplied.retryBaseDelayMs ??
                    environmentValue(
                        null,
                        'AIRTEL_RETRY_BASE_DELAY_MS',
                        DEFAULTS.retryBaseDelayMs
                    ),
                    'retryBaseDelayMs'
                ),

            maxDelayMs:
                positiveInteger(
                    supplied.retryMaxDelayMs ??
                    environmentValue(
                        null,
                        'AIRTEL_RETRY_MAX_DELAY_MS',
                        DEFAULTS.retryMaxDelayMs
                    ),
                    'retryMaxDelayMs'
                ),

            jitter:
                booleanValue(
                    supplied.jitter ??
                    environmentValue(
                        null,
                        'AIRTEL_RETRY_JITTER'
                    ),
                    true
                ),

            retryOnTimeout:
                booleanValue(
                    supplied.retryOnTimeout ??
                    environmentValue(
                        null,
                        'AIRTEL_RETRY_ON_TIMEOUT'
                    ),
                    true
                ),

            retryOnRateLimit:
                booleanValue(
                    supplied.retryOnRateLimit ??
                    environmentValue(
                        null,
                        'AIRTEL_RETRY_ON_RATE_LIMIT'
                    ),
                    true
                ),

            retryOn5xx:
                booleanValue(
                    supplied.retryOn5xx ??
                    environmentValue(
                        null,
                        'AIRTEL_RETRY_ON_5XX'
                    ),
                    true
                )
        };
    }


    /**
     * =========================================================================
     * Rate Limiting
     * =========================================================================
     */
    buildRateLimitConfiguration(
        supplied = {}
    ) {
        return {
            enabled:
                booleanValue(
                    supplied.enabled ??
                    environmentValue(
                        null,
                        'AIRTEL_RATE_LIMIT_ENABLED'
                    ),
                    true
                ),

            requestsPerMinute:
                positiveInteger(
                    supplied.requestsPerMinute ??
                    environmentValue(
                        null,
                        'AIRTEL_RATE_LIMIT_PER_MINUTE',
                        DEFAULTS.rateLimitPerMinute
                    ),
                    'requestsPerMinute'
                ),

            burst:
                positiveInteger(
                    supplied.burst ??
                    environmentValue(
                        null,
                        'AIRTEL_RATE_LIMIT_BURST',
                        DEFAULTS.rateLimitPerMinute
                    ),
                    'burst'
                )
        };
    }


    /**
     * =========================================================================
     * OAuth / Token Policy
     * =========================================================================
     */
    buildOAuthConfiguration(
        supplied = {}
    ) {
        const tokenUrl =
            this.endpoints.token ||
            this.endpoints.auth;

        return {
            tokenEndpoint:
                tokenUrl,

            tokenRefreshSafetyWindowSeconds:
                positiveInteger(
                    supplied.tokenRefreshSafetyWindowSeconds ??
                    environmentValue(
                        null,
                        'AIRTEL_TOKEN_REFRESH_SAFETY_WINDOW_SECONDS',
                        DEFAULTS.tokenRefreshSafetyWindowSeconds
                    ),
                    'tokenRefreshSafetyWindowSeconds'
                ),

            maxClockSkewSeconds:
                nonNegativeInteger(
                    supplied.maxClockSkewSeconds ??
                    environmentValue(
                        null,
                        'AIRTEL_TOKEN_MAX_CLOCK_SKEW_SECONDS',
                        30
                    ),
                    'maxClockSkewSeconds'
                ),

            cacheTokens:
                booleanValue(
                    supplied.cacheTokens ??
                    environmentValue(
                        null,
                        'AIRTEL_TOKEN_CACHE_ENABLED'
                    ),
                    true
                ),

            cacheMode:
                safeString(
                    supplied.cacheMode ||
                    environmentValue(
                        null,
                        'AIRTEL_TOKEN_CACHE_MODE',
                        'memory'
                    )
                )
        };
    }


    /**
     * =========================================================================
     * Security
     * =========================================================================
     */
    buildSecurityConfiguration(
        supplied = {}
    ) {
        const allowHttpInDevelopment =
            booleanValue(
                supplied.allowHttpInDevelopment ??
                environmentValue(
                    null,
                    'AIRTEL_ALLOW_HTTP_IN_DEVELOPMENT'
                ),
                DEFAULTS.allowHttpInDevelopment
            );

        const enforceHttps =
            this.environment ===
            ENVIRONMENTS.PRODUCTION
                ? true
                : booleanValue(
                    supplied.enforceHttps ??
                    environmentValue(
                        null,
                        'AIRTEL_ENFORCE_HTTPS'
                    ),
                    !allowHttpInDevelopment
                );

        return {
            enforceHttps,

            allowHttpInDevelopment:
                this.environment !==
                    ENVIRONMENTS.PRODUCTION &&
                allowHttpInDevelopment,

            validateCertificates:
                booleanValue(
                    supplied.validateCertificates ??
                    environmentValue(
                        null,
                        'AIRTEL_VALIDATE_TLS_CERTIFICATES'
                    ),
                    true
                ),

            allowEmbeddedCredentialsInUrl:
                false,

            secretLogging:
                false,

            tokenLogging:
                false
        };
    }


    /**
     * =========================================================================
     * Feature Flags
     * =========================================================================
     */
    buildFeatureConfiguration(
        supplied = {}
    ) {
        return {
            callbacks:
                booleanValue(
                    supplied.callbacks ??
                    environmentValue(
                        null,
                        'AIRTEL_CALLBACKS_ENABLED'
                    ),
                    true
                ),

            collections:
                booleanValue(
                    supplied.collections ??
                    environmentValue(
                        null,
                        'AIRTEL_COLLECTIONS_ENABLED'
                    ),
                    true
                ),

            disbursements:
                booleanValue(
                    supplied.disbursements ??
                    environmentValue(
                        null,
                        'AIRTEL_DISBURSEMENTS_ENABLED'
                    ),
                    true
                ),

            settlement:
                booleanValue(
                    supplied.settlement ??
                    environmentValue(
                        null,
                        'AIRTEL_SETTLEMENT_ENABLED'
                    ),
                    true
                ),

            reconciliation:
                booleanValue(
                    supplied.reconciliation ??
                    environmentValue(
                        null,
                        'AIRTEL_RECONCILIATION_ENABLED'
                    ),
                    true
                )
        };
    }


    /**
     * =========================================================================
     * Endpoint Accessors
     * =========================================================================
     */
    getEndpoints() {
        return this.endpoints;
    }


    getEndpoint(
        name,
        {
            required = false,
            appendPath
        } = {}
    ) {
        const endpoint =
            this.endpoints[name];

        if (
            !endpoint
        ) {
            if (
                required
            ) {
                throw createConfigurationError(
                    'AIRTEL_ENDPOINT_UNCONFIGURED',
                    `Airtel endpoint "${name}" is not configured`
                );
            }

            return undefined;
        }

        if (
            !appendPath
        ) {
            return endpoint;
        }

        return this.joinEndpoint(
            endpoint,
            appendPath
        );
    }


    joinEndpoint(
        endpoint,
        path
    ) {
        const base =
            String(
                endpoint
            ).replace(
                /\/+$/,
                ''
            );

        const suffix =
            String(
                path || ''
            ).replace(
                /^\/+/,
                ''
            );

        return suffix
            ? `${base}/${suffix}`
            : base;
    }


    getBaseUrl() {
        return this.endpoints.base;
    }


    getAuthEndpoint() {
        return (
            this.endpoints.auth ||
            this.endpoints.token
        );
    }


    getTokenEndpoint() {
        return this.endpoints.token ||
            this.endpoints.auth;
    }


    getCollectionEndpoint() {
        return (
            this.endpoints.collection ||
            this.endpoints.collections
        );
    }


    getDisbursementEndpoint() {
        return (
            this.endpoints.disbursement ||
            this.endpoints.disbursements
        );
    }


    getSettlementEndpoint() {
        return (
            this.endpoints.settlement ||
            this.endpoints.settlements
        );
    }


    getReconciliationEndpoint() {
        return this.endpoints.reconciliation;
    }


    /**
     * =========================================================================
     * Provider Metadata
     * =========================================================================
     */
    getProvider() {
        return PROVIDER;
    }


    getEnvironment() {
        return this.environment;
    }


    getRegion() {
        return this.region;
    }


    getCountry() {
        return this.country;
    }


    getCurrency() {
        return this.currency;
    }


    getApiVersion() {
        return this.apiVersion;
    }


    getCredentials() {
        /**
         * Only credential references are returned.
         */
        return this.credentials;
    }


    getTransport() {
        return this.transport;
    }


    getRetryPolicy() {
        return this.retry;
    }


    getRateLimitPolicy() {
        return this.rateLimit;
    }


    getOAuthPolicy() {
        return this.oauth;
    }


    getSecurityPolicy() {
        return this.security;
    }


    getFeatures() {
        return this.features;
    }


    /**
     * =========================================================================
     * Validation
     * =========================================================================
     */
    validate() {
        if (
            !this.provider ||
            this.provider !== PROVIDER
        ) {
            throw createConfigurationError(
                'AIRTEL_CONFIGURATION_PROVIDER_INVALID',
                'Invalid provider configuration'
            );
        }

        for (
            const key
            of REQUIRED_ENDPOINT_KEYS
        ) {
            if (
                !this.endpoints[key]
            ) {
                throw createConfigurationError(
                    'AIRTEL_ENDPOINT_UNCONFIGURED',
                    `Required Airtel endpoint "${key}" is missing`
                );
            }
        }

        /**
         * Production security gate.
         */
        if (
            this.environment ===
            ENVIRONMENTS.PRODUCTION
        ) {
            for (
                const [
                    name,
                    endpoint
                ] of Object.entries(
                    this.endpoints
                ) ) {
                if (
                    !endpoint
                ) {
                    continue;
                }

                if (
                    !endpoint.startsWith(
                        'https://'
                    )
                ) {
                    throw createConfigurationError(
                        'AIRTEL_PRODUCTION_HTTPS_REQUIRED',
                        `Production Airtel endpoint "${name}" must use HTTPS`
                    );
                }
            }

            if (
                !this.credentials.clientId
            ) {
                throw createConfigurationError(
                    'AIRTEL_CLIENT_ID_MISSING',
                    'Airtel production client ID is not configured'
                );
            }

            if (
                !this.credentials.clientSecretReference &&
                !this.credentials.apiKeyReference
            ) {
                throw createConfigurationError(
                    'AIRTEL_CREDENTIAL_REFERENCE_MISSING',
                    'Airtel production credential reference is not configured'
                );
            }
        }

        if (
            this.oauth.tokenRefreshSafetyWindowSeconds <=
            0
        ) {
            throw createConfigurationError(
                'AIRTEL_OAUTH_POLICY_INVALID',
                'Token refresh safety window must be greater than zero'
            );
        }

        if (
            this.retry.maxDelayMs <
            this.retry.baseDelayMs
        ) {
            throw createConfigurationError(
                'AIRTEL_RETRY_POLICY_INVALID',
                'Retry max delay must be >= retry base delay'
            );
        }

        if (
            this.transport.maxBodyBytes <= 0
        ) {
            throw createConfigurationError(
                'AIRTEL_TRANSPORT_POLICY_INVALID',
                'Maximum request body size must be greater than zero'
            );
        }

        return true;
    }


    /**
     * =========================================================================
     * Startup / Runtime Validation
     * =========================================================================
     */
    assertOperational() {
        this.validate();

        return {
            provider:
                PROVIDER,

            environment:
                this.environment,

            status:
                'READY'
        };
    }


    /**
     * =========================================================================
     * Safe Diagnostics
     * =========================================================================
     */
    diagnostics() {
        return {
            provider:
                PROVIDER,

            environment:
                this.environment,

            region:
                this.region,

            country:
                this.country,

            currency:
                this.currency,

            apiVersion:
                this.apiVersion,

            endpoints:
                clone(
                    this.endpoints
                ),

            credentials:
                redact(
                    this.credentials
                ),

            transport:
                clone(
                    this.transport
                ),

            retry:
                clone(
                    this.retry
                ),

            rateLimit:
                clone(
                    this.rateLimit
                ),

            oauth:
                clone(
                    this.oauth
                ),

            security:
                clone(
                    this.security
                ),

            features:
                clone(
                    this.features
                ),

            custom:
                redact(
                    this.custom
                )
        };
    }


    /**
     * =========================================================================
     * Health
     * =========================================================================
     */
    health() {
        try {
            this.validate();

            return {
                provider:
                    PROVIDER,

                module:
                    'configuration',

                status:
                    'UP',

                environment:
                    this.environment,

                endpointConfigured:
                    Boolean(
                        this.endpoints.base
                    ),

                tokenEndpointConfigured:
                    Boolean(
                        this.getTokenEndpoint()
                    ),

                collectionEndpointConfigured:
                    Boolean(
                        this.getCollectionEndpoint()
                    ),

                disbursementEndpointConfigured:
                    Boolean(
                        this.getDisbursementEndpoint()
                    ),

                settlementEndpointConfigured:
                    Boolean(
                        this.getSettlementEndpoint()
                    ),

                reconciliationEndpointConfigured:
                    Boolean(
                        this.getReconciliationEndpoint()
                    ),

                secureTransport:
                    this.environment ===
                        ENVIRONMENTS.PRODUCTION
                        ? Object.values(
                            this.endpoints
                        ).every(
                            endpoint =>
                                !endpoint ||
                                endpoint.startsWith(
                                    'https://'
                                )
                        )
                        : this.security.enforceHttps,

                secretLoggingDisabled:
                    this.security.secretLogging === false,

                tokenLoggingDisabled:
                    this.security.tokenLogging === false
            };
        } catch (error) {
            return {
                provider:
                    PROVIDER,

                module:
                    'configuration',

                status:
                    'DOWN',

                error: {
                    code:
                        error.code,

                    message:
                        error.message
                }
            };
        }
    }


    /**
     * =========================================================================
     * Configuration Fingerprint
     * =========================================================================
     *
     * Useful for detecting configuration version changes without exposing
     * secret values.
     */
    fingerprint() {
        const safeConfiguration = {
            provider:
                this.provider,

            environment:
                this.environment,

            region:
                this.region,

            country:
                this.country,

            currency:
                this.currency,

            apiVersion:
                this.apiVersion,

            endpoints:
                this.endpoints,

            transport:
                this.transport,

            retry:
                this.retry,

            rateLimit:
                this.rateLimit,

            oauth:
                this.oauth,

            security:
                this.security,

            features:
                this.features,

            credentials: {
                clientId:
                    this.credentials.clientId,

                clientSecretConfigured:
                    Boolean(
                        this.credentials.clientSecretReference
                    ),

                apiKeyConfigured:
                    Boolean(
                        this.credentials.apiKeyReference
                    ),

                secretManager:
                    this.credentials.secretManager,

                credentialVersion:
                    this.credentials.credentialVersion
            }
        };

        return crypto
            .createHash('sha256')
            .update(
                JSON.stringify(
                    safeConfiguration
                )
            )
            .digest('hex');
    }


    /**
     * =========================================================================
     * Runtime Environment Helpers
     * =========================================================================
     */
    isDevelopment() {
        return (
            this.environment ===
            ENVIRONMENTS.DEVELOPMENT
        );
    }


    isTest() {
        return (
            this.environment ===
            ENVIRONMENTS.TEST
        );
    }


    isStaging() {
        return (
            this.environment ===
            ENVIRONMENTS.STAGING
        );
    }


    isProduction() {
        return (
            this.environment ===
            ENVIRONMENTS.PRODUCTION
        );
    }


    /**
     * =========================================================================
     * Compatibility Alias
     * =========================================================================
     *
     * Allows existing provider modules that call getBaseConfiguration() to
     * transition without creating a second configuration architecture.
     */
    getBaseConfiguration() {
        return {
            provider:
                PROVIDER,

            environment:
                this.environment,

            region:
                this.region,

            country:
                this.country,

            currency:
                this.currency,

            apiVersion:
                this.apiVersion
        };
    }
}


/**
 * ============================================================================
 * Factory
 * ============================================================================
 */
function createAirtelConfiguration(
    options = {}
) {
    return new AirtelConfiguration(
        options
    );
}


/**
 * ============================================================================
 * Environment Factory
 * ============================================================================
 */
function fromEnvironment(
    env = process.env,
    options = {}
) {
    return new AirtelConfiguration({
        ...options,

        env
    });
}


/**
 * ============================================================================
 * Public Exports
 * ============================================================================
 *
 * Export the constructor directly for compatibility with:
 *
 *   const Configuration = require('./configuration');
 *
 * and expose named exports for:
 *
 *   const { AirtelConfiguration } = require('./configuration');
 * ============================================================================
 */
module.exports =
    AirtelConfiguration;

module.exports.AirtelConfiguration =
    AirtelConfiguration;

module.exports.Configuration =
    AirtelConfiguration;

module.exports.createAirtelConfiguration =
    createAirtelConfiguration;

module.exports.fromEnvironment =
    fromEnvironment;

module.exports.PROVIDER =
    PROVIDER;

module.exports.ENVIRONMENTS =
    ENVIRONMENTS;

module.exports.DEFAULTS =
    DEFAULTS;