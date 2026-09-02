'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/environment/validation/mobileMoneyValidator.js
 *
 * Purpose:
 *   Enterprise production-grade Mobile Money configuration validator.
 *
 * Responsibilities:
 *   - Validate TITech Mobile Money provider configuration.
 *   - Validate provider selection and supported-provider policy.
 *   - Validate API/base URLs.
 *   - Validate merchant/partner identifiers.
 *   - Validate credentials and secret requirements.
 *   - Validate callback/webhook configuration.
 *   - Validate currency and country configuration.
 *   - Validate timeout and retry policies.
 *   - Validate TLS/security requirements.
 *   - Validate sandbox versus production configuration.
 *   - Detect conflicting provider configurations.
 *   - Validate provider-specific configuration where known.
 *   - Produce credential-safe diagnostics.
 *   - Integrate with validationErrors.js.
 *   - Remain connectivity-independent.
 *
 * IMPORTANT:
 *
 *   This module VALIDATES MOBILE MONEY CONFIGURATION.
 *
 *   It does NOT:
 *     - call Mobile Money APIs.
 *     - initiate payments.
 *     - confirm transactions.
 *     - process callbacks/webhooks.
 *     - persist payment records.
 *     - execute financial transactions.
 *     - mutate process.env.
 *     - load dotenv files.
 *     - merge configuration layers.
 *     - determine environment precedence.
 *     - initialize queues.
 *     - connect Redis.
 *     - connect MongoDB.
 *
 * Runtime payment ownership remains with the payment/provider integration
 * subsystem.
 *
 * =============================================================================
 *
 * Validation boundary:
 *
 *   process.env
 *       ↓
 *   environment normalization
 *       ↓
 *   mobileMoneyValidator.js
 *       ↓
 *   validationErrors.js
 *       ↓
 *   payment/mobile-money bootstrap
 *       ↓
 *   provider runtime clients
 *
 * =============================================================================
 */

const crypto =
    require('node:crypto');

const net =
    require('node:net');

const {
    URL,
} = require('node:url');

/**
 * =============================================================================
 * Validation error integration
 * =============================================================================
 */

const validationErrors =
    require('../validationErrors');

const {
    EnvironmentValidationError,
    EnvironmentValidationAggregateError,
    ValidationErrorCollection,
    VALIDATION_CATEGORIES,
    VALIDATION_SEVERITIES,
    VALIDATION_ERROR_CODES,
} = validationErrors;

/**
 * =============================================================================
 * Optional URL normalizer
 * =============================================================================
 */

let urlNormalizerModule = null;

try {
    // eslint-disable-next-line global-require
    urlNormalizerModule =
        require('../normalizers/url');
} catch {
    urlNormalizerModule = null;
}

/**
 * =============================================================================
 * Optional secret masker
 * =============================================================================
 */

let secretMaskerModule = null;

try {
    // eslint-disable-next-line global-require
    secretMaskerModule =
        require('../secretMasker');
} catch {
    secretMaskerModule = null;
}

/**
 * =============================================================================
 * Optional logger
 * =============================================================================
 */

let loggerModule = null;

try {
    // eslint-disable-next-line global-require
    loggerModule =
        require('../../../utils/logger');
} catch {
    loggerModule = null;
}

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const COMPONENT =
    'environment-validation-mobile-money';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

const MOBILE_MONEY_PROVIDERS =
    Object.freeze({
        MPESA:
            'mpesa',

        AIRTEL_MONEY:
            'airtel-money',

        MTN_MOBILE_MONEY:
            'mtn-mobile-money',

        AIRTEL:
            'airtel',

        MTN:
            'mtn',

        UNKNOWN:
            'unknown',
    });

const MOBILE_MONEY_ENVIRONMENTS =
    Object.freeze({
        SANDBOX:
            'sandbox',

        TEST:
            'test',

        STAGING:
            'staging',

        PRODUCTION:
            'production',
    });

const MOBILE_MONEY_AUTH_MODES =
    Object.freeze({
        API_KEY:
            'api-key',

        CLIENT_CREDENTIALS:
            'client-credentials',

        OAUTH2:
            'oauth2',

        BASIC:
            'basic',

        TOKEN:
            'token',

        SIGNATURE:
            'signature',
    });

const DEFAULT_CURRENCIES =
    Object.freeze([
        'UGX',
    ]);

const DEFAULT_COUNTRIES =
    Object.freeze([
        'UG',
    ]);

const DEFAULTS =
    Object.freeze({
        strict:
            true,

        failClosed:
            true,

        environment:
            process.env.NODE_ENV ||
            'development',

        requireProvider:
            true,

        requireBaseUrl:
            true,

        requireCallbackUrl:
            true,

        requireWebhookUrl:
            false,

        requireHttpsInProduction:
            true,

        allowHttpInDevelopment:
            true,

        allowHttpInProduction:
            false,

        allowLocalhost:
            true,

        allowLoopback:
            true,

        allowPrivateNetwork:
            true,

        allowIpLiterals:
            true,

        requireCredentials:
            true,

        allowMultipleProviders:
            true,

        requireExplicitProvider:
            true,

        requireMerchantIdentifier:
            false,

        requireApiKey:
            false,

        requireClientId:
            false,

        requireClientSecret:
            false,

        requireSubscriptionKey:
            false,

        requirePasskey:
            false,

        requireWebhookSecret:
            true,

        requireCallbackSecret:
            false,

        requireEncryptionKey:
            false,

        requireProductionTls:
            true,

        supportedProviders:
            Object.freeze([
                'mpesa',
                'airtel-money',
                'mtn-mobile-money',
                'airtel',
                'mtn',
            ]),

        supportedCurrencies:
            DEFAULT_CURRENCIES,

        supportedCountries:
            DEFAULT_COUNTRIES,

        defaultCurrency:
            'UGX',

        defaultCountry:
            'UG',

        maxProviderNameLength:
            64,

        maxIdentifierLength:
            256,

        maxUrlLength:
            32_768,

        maxSecretLength:
            16_384,

        minimumSecretLength:
            16,

        recommendedSecretLength:
            32,

        minimumTimeoutMs:
            500,

        maximumTimeoutMs:
            120_000,

        defaultTimeoutMs:
            30_000,

        maximumRetries:
            10,

        defaultRetries:
            3,

        maximumRetryDelayMs:
            60_000,

        defaultRetryDelayMs:
            2_000,

        maximumWebhookAgeSeconds:
            86_400,

        defaultWebhookAgeSeconds:
            300,

        allowedHttpMethods:
            Object.freeze([
                'POST',
                'PUT',
                'PATCH',
            ]),

        allowedSchemes:
            Object.freeze([
                'https:',
                'http:',
            ]),

        fingerprintAlgorithm:
            'sha256',

        maxErrors:
            100,

        providerConfigs:
            Object.freeze({
                mpesa:
                    Object.freeze({
                        requireApiKey:
                            false,

                        requireClientId:
                            false,

                        requireClientSecret:
                            false,

                        requirePasskey:
                            true,

                        requireMerchantIdentifier:
                            false,
                    }),

                'airtel-money':
                    Object.freeze({
                        requireApiKey:
                            false,

                        requireClientId:
                            true,

                        requireClientSecret:
                            true,

                        requirePasskey:
                            false,

                        requireMerchantIdentifier:
                            true,
                    }),

                'mtn-mobile-money':
                    Object.freeze({
                        requireApiKey:
                            true,

                        requireClientId:
                            true,

                        requireClientSecret:
                            true,

                        requirePasskey:
                            false,

                        requireSubscriptionKey:
                            true,

                        requireMerchantIdentifier:
                            true,
                    }),

                airtel:
                    Object.freeze({
                        requireApiKey:
                            false,

                        requireClientId:
                            true,

                        requireClientSecret:
                            true,

                        requirePasskey:
                            false,

                        requireMerchantIdentifier:
                            true,
                    }),

                mtn:
                    Object.freeze({
                        requireApiKey:
                            true,

                        requireClientId:
                            true,

                        requireClientSecret:
                            true,

                        requirePasskey:
                            false,

                        requireSubscriptionKey:
                            true,

                        requireMerchantIdentifier:
                            true,
                    }),
            }),
    });

/**
 * =============================================================================
 * Error
 * =============================================================================
 */

class MobileMoneyValidatorError
    extends EnvironmentValidationError {

    constructor(
        message,
        options = {},
    ) {

        super(
            message,
            {
                ...options,

                component:
                    options.component ||
                    COMPONENT,

                category:
                    options.category ||
                    VALIDATION_CATEGORIES
                        .FEATURE,
            },
        );

        this.name =
            'MobileMoneyValidatorError';
    }
}

/**
 * =============================================================================
 * Utilities
 * =============================================================================
 */

function clone(
    value,
) {

    if (
        value === undefined ||
        value === null
    ) {
        return value;
    }

    if (
        typeof structuredClone ===
        'function'
    ) {

        try {
            return structuredClone(
                value,
            );
        } catch {
            // Fallback below.
        }
    }

    if (
        Array.isArray(
            value,
        )
    ) {

        return value.map(
            item =>
                clone(
                    item,
                ),
        );
    }

    if (
        typeof value ===
        'object'
    ) {

        const output = {};

        for (
            const [
                key,
                item,
            ] of Object.entries(
                value,
            )
        ) {

            output[key] =
                clone(
                    item,
                );
        }

        return output;
    }

    return value;
}

function deepFreeze(
    value,
    seen = new WeakSet(),
) {

    if (
        value === null ||
        value === undefined ||
        typeof value !==
            'object'
    ) {

        return value;
    }

    if (
        seen.has(
            value,
        )
    ) {

        return value;
    }

    seen.add(
        value,
    );

    for (
        const key of
        Reflect.ownKeys(
            value,
        )
    ) {

        try {
            deepFreeze(
                value[key],
                seen,
            );
        } catch {
            // Best effort.
        }
    }

    try {
        Object.freeze(
            value,
        );
    } catch {
        // Best effort.
    }

    return value;
}

function normalizeEnvironment(
    value,
) {

    return String(
        value ||
        process.env.NODE_ENV ||
        'development',
    )
        .trim()
        .toLowerCase();
}

function normalizeString(
    value,
) {

    if (
        value === undefined ||
        value === null
    ) {

        return null;
    }

    const normalized =
        String(
            value,
        )
            .trim();

    return normalized ||
        null;
}

function normalizeLower(
    value,
) {

    const normalized =
        normalizeString(
            value,
        );

    return normalized
        ? normalized.toLowerCase()
        : null;
}

function normalizeInteger(
    value,
    fallback = null,
) {

    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {

        return fallback;
    }

    const parsed =
        Number(
            value,
        );

    return Number.isInteger(
        parsed,
    )
        ? parsed
        : fallback;
}

function normalizeBoolean(
    value,
    fallback = false,
) {

    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {

        return fallback;
    }

    if (
        typeof value ===
        'boolean'
    ) {

        return value;
    }

    const normalized =
        String(
            value,
        )
            .trim()
            .toLowerCase();

    if (
        [
            'true',
            '1',
            'yes',
            'on',
            'enabled',
        ].includes(
            normalized,
        )
    ) {

        return true;
    }

    if (
        [
            'false',
            '0',
            'no',
            'off',
            'disabled',
        ].includes(
            normalized,
        )
    ) {

        return false;
    }

    return fallback;
}

function isPresent(
    value,
) {

    return (
        value !== undefined &&
        value !== null &&
        String(
            value,
        ).trim() !== ''
    );
}

function isLoopback(
    hostname,
) {

    const normalized =
        String(
            hostname ||
            '',
        )
            .toLowerCase();

    if (
        normalized ===
        'localhost'
    ) {

        return true;
    }

    if (
        net.isIP(
            normalized,
        ) ===
        4
    ) {

        return normalized
            .startsWith(
                '127.',
            );
    }

    return (
        normalized ===
        '::1'
    );
}

function isPrivateIpv4(
    hostname,
) {

    if (
        net.isIP(
            hostname,
        ) !==
        4
    ) {

        return false;
    }

    const [
        a,
        b,
    ] =
        String(
            hostname,
        )
            .split(
                '.',
            )
            .map(
                Number,
            );

    return (
        a === 10 ||
        (
            a === 172 &&
            b >= 16 &&
            b <= 31
        ) ||
        (
            a === 192 &&
            b === 168
        ) ||
        (
            a === 169 &&
            b === 254
        ) ||
        (
            a === 100 &&
            b >= 64 &&
            b <= 127
        )
    );
}

function sanitizeMetadata(
    value,
) {

    if (
        !value ||
        typeof value !==
        'object'
    ) {

        return {};
    }

    const output =
        {};

    for (
        const [
            key,
            item,
        ] of Object.entries(
            value,
        )
    ) {

        if (
            key ===
                '__proto__' ||
            key ===
                'prototype' ||
            key ===
                'constructor'
        ) {

            continue;
        }

        output[key] =
            clone(
                item,
            );
    }

    return output;
}

function stableStringify(
    value,
) {

    if (
        value === null ||
        typeof value !==
        'object'
    ) {

        return JSON.stringify(
            value,
        );
    }

    if (
        Array.isArray(
            value,
        )
    ) {

        return `[${value
            .map(
                item =>
                    stableStringify(
                        item,
                    ),
            )
            .join(',')}]`;
    }

    return `{${Object.keys(
        value,
    )
        .sort()
        .map(
            key =>
                `${JSON.stringify(
                    key,
                )}:${stableStringify(
                    value[key],
                )}`,
        )
        .join(',')}}`;
}

function fingerprint(
    value,
    options = DEFAULTS,
) {

    return crypto
        .createHash(
            options.fingerprintAlgorithm ||
            DEFAULTS.fingerprintAlgorithm,
        )
        .update(
            stableStringify(
                value,
            ),
            'utf8',
        )
        .digest(
            'hex',
        );
}

function maskSecret(
    value,
    key,
) {

    if (
        !isPresent(
            value,
        )
    ) {

        return value;
    }

    try {

        if (
            secretMaskerModule?.maskKeyValue
        ) {

            return secretMaskerModule
                .maskKeyValue(
                    key,
                    value,
                );
        }

        if (
            secretMaskerModule?.mask
        ) {

            return secretMaskerModule.mask(
                value,
            );
        }

    } catch {
        // Fall through.
    }

    return '[REDACTED]';
}

function getLogger() {

    try {

        return (
            loggerModule?.getLogger?.() ||
            loggerModule?.logger ||
            loggerModule ||
            console
        );

    } catch {

        return console;
    }
}

function log(
    level,
    metadata,
    message,
) {

    try {

        const logger =
            getLogger();

        if (
            typeof logger?.[level] ===
            'function'
        ) {

            logger[level](
                {
                    component:
                        COMPONENT,

                    service:
                        SERVICE_NAME,

                    application:
                        APPLICATION_NAME,

                    ...metadata,
                },
                message,
            );
        }

    } catch {
        // Validation remains logger-independent.
    }
}

/**
 * =============================================================================
 * Provider helpers
 * =============================================================================
 */

function normalizeProvider(
    provider,
) {

    const normalized =
        normalizeLower(
            provider,
        );

    if (
        !normalized
    ) {

        return null;
    }

    const aliases = {
        'mtn':
            MOBILE_MONEY_PROVIDERS
                .MTN_MOBILE_MONEY,

        'mtn-momo':
            MOBILE_MONEY_PROVIDERS
                .MTN_MOBILE_MONEY,

        'mtn-mobilemoney':
            MOBILE_MONEY_PROVIDERS
                .MTN_MOBILE_MONEY,

        'airtel':
            MOBILE_MONEY_PROVIDERS
                .AIRTEL_MONEY,

        'airtelmoney':
            MOBILE_MONEY_PROVIDERS
                .AIRTEL_MONEY,

        'airtel_money':
            MOBILE_MONEY_PROVIDERS
                .AIRTEL_MONEY,

        'mpesa':
            MOBILE_MONEY_PROVIDERS
                .MPESA,

        'm-pesa':
            MOBILE_MONEY_PROVIDERS
                .MPESA,
    };

    return (
        aliases[
            normalized
        ] ||
        normalized
    );
}

function normalizeProviderList(
    value,
) {

    if (
        Array.isArray(
            value,
        )
    ) {

        return [
            ...new Set(
                value
                    .map(
                        normalizeProvider,
                    )
                    .filter(Boolean),
            ),
        ];
    }

    const text =
        normalizeString(
            value,
        );

    if (
        !text
    ) {

        return [];
    }

    return [
        ...new Set(
            text
                .split(
                    /[,;|]/,
                )
                .map(
                    normalizeProvider,
                )
                .filter(Boolean),
        ),
    ];
}

function resolveProviderConfig(
    provider,
    options,
) {

    return (
        options.providerConfigs?.[
            provider
        ] ||
        {}
    );
}

function resolveProviderVariable(
    provider,
    suffix,
) {

    const mappings = {
        mpesa: {
            BASE_URL:
                [
                    'MPESA_BASE_URL',
                    'MPESA_API_URL',
                ],

            API_KEY:
                [
                    'MPESA_API_KEY',
                    'MPESA_CONSUMER_KEY',
                ],

            CLIENT_ID:
                [
                    'MPESA_CLIENT_ID',
                    'MPESA_CONSUMER_KEY',
                ],

            CLIENT_SECRET:
                [
                    'MPESA_CLIENT_SECRET',
                    'MPESA_CONSUMER_SECRET',
                ],

            PASSKEY:
                [
                    'MPESA_PASSKEY',
                ],

            MERCHANT_ID:
                [
                    'MPESA_SHORT_CODE',
                    'MPESA_MERCHANT_ID',
                ],

            CALLBACK_URL:
                [
                    'MPESA_CALLBACK_URL',
                ],

            WEBHOOK_URL:
                [
                    'MPESA_WEBHOOK_URL',
                ],

            WEBHOOK_SECRET:
                [
                    'MPESA_WEBHOOK_SECRET',
                ],
        },

        'airtel-money': {
            BASE_URL:
                [
                    'AIRTEL_MONEY_BASE_URL',
                    'AIRTEL_BASE_URL',
                ],

            API_KEY:
                [
                    'AIRTEL_MONEY_API_KEY',
                    'AIRTEL_API_KEY',
                ],

            CLIENT_ID:
                [
                    'AIRTEL_MONEY_CLIENT_ID',
                    'AIRTEL_CLIENT_ID',
                ],

            CLIENT_SECRET:
                [
                    'AIRTEL_MONEY_CLIENT_SECRET',
                    'AIRTEL_CLIENT_SECRET',
                ],

            MERCHANT_ID:
                [
                    'AIRTEL_MONEY_MERCHANT_ID',
                    'AIRTEL_MERCHANT_ID',
                ],

            CALLBACK_URL:
                [
                    'AIRTEL_MONEY_CALLBACK_URL',
                    'AIRTEL_CALLBACK_URL',
                ],

            WEBHOOK_URL:
                [
                    'AIRTEL_MONEY_WEBHOOK_URL',
                    'AIRTEL_WEBHOOK_URL',
                ],

            WEBHOOK_SECRET:
                [
                    'AIRTEL_MONEY_WEBHOOK_SECRET',
                    'AIRTEL_WEBHOOK_SECRET',
                ],
        },

        'mtn-mobile-money': {
            BASE_URL:
                [
                    'MTN_MOBILE_MONEY_BASE_URL',
                    'MTN_MOMO_BASE_URL',
                    'MTN_BASE_URL',
                ],

            API_KEY:
                [
                    'MTN_MOBILE_MONEY_API_KEY',
                    'MTN_MOMO_API_KEY',
                    'MTN_API_KEY',
                ],

            CLIENT_ID:
                [
                    'MTN_MOBILE_MONEY_CLIENT_ID',
                    'MTN_MOMO_CLIENT_ID',
                    'MTN_CLIENT_ID',
                ],

            CLIENT_SECRET:
                [
                    'MTN_MOBILE_MONEY_CLIENT_SECRET',
                    'MTN_MOMO_CLIENT_SECRET',
                    'MTN_CLIENT_SECRET',
                ],

            SUBSCRIPTION_KEY:
                [
                    'MTN_MOBILE_MONEY_SUBSCRIPTION_KEY',
                    'MTN_MOMO_SUBSCRIPTION_KEY',
                    'MTN_SUBSCRIPTION_KEY',
                ],

            MERCHANT_ID:
                [
                    'MTN_MOBILE_MONEY_MERCHANT_ID',
                    'MTN_MOMO_MERCHANT_ID',
                    'MTN_MERCHANT_ID',
                ],

            CALLBACK_URL:
                [
                    'MTN_MOBILE_MONEY_CALLBACK_URL',
                    'MTN_MOMO_CALLBACK_URL',
                    'MTN_CALLBACK_URL',
                ],

            WEBHOOK_URL:
                [
                    'MTN_MOBILE_MONEY_WEBHOOK_URL',
                    'MTN_MOMO_WEBHOOK_URL',
                    'MTN_WEBHOOK_URL',
                ],

            WEBHOOK_SECRET:
                [
                    'MTN_MOBILE_MONEY_WEBHOOK_SECRET',
                    'MTN_MOMO_WEBHOOK_SECRET',
                    'MTN_WEBHOOK_SECRET',
                ],
        },
    };

    return (
        mappings[
            provider
        ]?.[
            suffix
        ] ||
        []
    );
}

function firstPresent(
    config,
    variables,
) {

    for (
        const variable of
        variables
    ) {

        if (
            isPresent(
                config[
                    variable
                ],
            )
        ) {

            return {
                variable,

                value:
                    config[
                        variable
                    ],
            };
        }
    }

    return {
        variable:
            variables[0] ||
            null,

        value:
            null,
    };
}

/**
 * =============================================================================
 * URL validation
 * =============================================================================
 */

function validateProviderUrl(
    variable,
    value,
    collection,
    options,
) {

    if (
        !isPresent(
            value,
        )
    ) {

        return null;
    }

    try {

        let parsed = null;

        if (
            urlNormalizerModule?.normalize
        ) {

            const normalized =
                urlNormalizerModule
                    .normalize(
                        value,
                        {
                            requireProtocol:
                                true,

                            requireHostname:
                                true,

                            allowCredentials:
                                false,

                            requirePort:
                                false,

                            allowLocalhost:
                                options
                                    .allowLocalhost,

                            allowLoopback:
                                options
                                    .allowLoopback,

                            allowPrivateNetwork:
                                options
                                    .allowPrivateNetwork,

                            allowedProtocols:
                                options
                                    .allowedSchemes,

                            freezeResult:
                                false,
                        },
                    );

            parsed =
                new URL(
                    normalized.url,
                );

        } else {

            parsed =
                new URL(
                    String(
                        value,
                    ),
                );
        }

        const protocol =
            parsed.protocol
                .toLowerCase();

        if (
            options.environment ===
                'production' &&
            options.requireHttpsInProduction &&
            protocol !==
                'https:'
        ) {

            collection.addIssue({
                code:
                    VALIDATION_ERROR_CODES
                        .SECURITY_POLICY_VIOLATION,

                category:
                    VALIDATION_CATEGORIES
                        .SECURITY,

                severity:
                    VALIDATION_SEVERITIES
                        .CRITICAL,

                variable,

                environment:
                    options.environment,

                message:
                    `TITech production Mobile Money URL "${variable}" must use HTTPS.`,
            });
        }

        if (
            options.environment !==
                'production' &&
            !options.allowHttpInDevelopment &&
            protocol ===
                'http:'
        ) {

            collection.addIssue({
                code:
                    VALIDATION_ERROR_CODES
                        .SECURITY_POLICY_VIOLATION,

                category:
                    VALIDATION_CATEGORIES
                        .SECURITY,

                severity:
                    VALIDATION_SEVERITIES
                        .ERROR,

                variable,

                environment:
                    options.environment,

                message:
                    `HTTP is disabled by TITech Mobile Money policy for "${variable}".`,
            });
        }

        const hostname =
            parsed.hostname
                .toLowerCase();

        if (
            isLoopback(
                hostname,
            ) &&
            !options.allowLoopback
        ) {

            collection.addIssue({
                code:
                    VALIDATION_ERROR_CODES
                        .SECURITY_POLICY_VIOLATION,

                category:
                    VALIDATION_CATEGORIES
                        .SECURITY,

                severity:
                    VALIDATION_SEVERITIES
                        .ERROR,

                variable,

                environment:
                    options.environment,

                message:
                    `Loopback host is not permitted for TITech Mobile Money URL "${variable}".`,
            });
        }

        if (
            isPrivateIpv4(
                hostname,
            ) &&
            !options.allowPrivateNetwork
        ) {

            collection.addIssue({
                code:
                    VALIDATION_ERROR_CODES
                        .SECURITY_POLICY_VIOLATION,

                category:
                    VALIDATION_CATEGORIES
                        .SECURITY,

                severity:
                    VALIDATION_SEVERITIES
                        .ERROR,

                variable,

                environment:
                    options.environment,

                message:
                    `Private-network host is not permitted for TITech Mobile Money URL "${variable}".`,
            });
        }

        return {
            url:
                parsed
                    .toString(),

            protocol,

            hostname,

            port:
                parsed.port
                    ? Number(
                        parsed.port,
                    )
                    : null,
        };

    } catch (
        error
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .INVALID_URL,

            category:
                VALIDATION_CATEGORIES
                    .FORMAT,

            severity:
                VALIDATION_SEVERITIES
                    .CRITICAL,

            variable,

            environment:
                options.environment,

            message:
                `TITech Mobile Money URL "${variable}" is invalid.`,
        });

        return null;
    }
}

/**
 * =============================================================================
 * Secret validation
 * =============================================================================
 */

function validateSecret(
    variable,
    value,
    collection,
    options,
    required = false,
) {

    if (
        required &&
        !isPresent(
            value,
        )
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .REQUIRED_VARIABLE_MISSING,

            category:
                VALIDATION_CATEGORIES
                    .REQUIRED,

            severity:
                options.environment ===
                    'production'
                    ? VALIDATION_SEVERITIES
                        .CRITICAL
                    : VALIDATION_SEVERITIES
                        .ERROR,

            variable,

            environment:
                options.environment,

            message:
                `Required TITech Mobile Money credential "${variable}" is missing.`,
        });

        return false;
    }

    if (
        !isPresent(
            value,
        )
    ) {

        return true;
    }

    const text =
        String(
            value,
        );

    if (
        text.length >
        options.maxSecretLength
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .INVALID_RANGE,

            category:
                VALIDATION_CATEGORIES
                    .RANGE,

            severity:
                VALIDATION_SEVERITIES
                    .ERROR,

            variable,

            environment:
                options.environment,

            message:
                `TITech Mobile Money credential "${variable}" exceeds the maximum permitted length.`,
        });

        return false;
    }

    if (
        text.length <
        options.minimumSecretLength
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .SECURITY_POLICY_VIOLATION,

            category:
                VALIDATION_CATEGORIES
                    .SECURITY,

            severity:
                options.environment ===
                    'production'
                    ? VALIDATION_SEVERITIES
                        .CRITICAL
                    : VALIDATION_SEVERITIES
                        .WARNING,

            variable,

            environment:
                options.environment,

            message:
                `TITech Mobile Money credential "${variable}" is shorter than the configured security minimum.`,
        });

        return false;
    }

    return true;
}

/**
 * =============================================================================
 * Generic required field validation
 * =============================================================================
 */

function validateRequiredField(
    variable,
    value,
    collection,
    options,
    category =
        VALIDATION_CATEGORIES
            .REQUIRED,
) {

    if (
        !isPresent(
            value,
        )
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .REQUIRED_VARIABLE_MISSING,

            category,

            severity:
                options.environment ===
                    'production'
                    ? VALIDATION_SEVERITIES
                        .CRITICAL
                    : VALIDATION_SEVERITIES
                        .ERROR,

            variable,

            environment:
                options.environment,

            message:
                `Required TITech Mobile Money configuration "${variable}" is missing.`,
        });

        return false;
    }

    return true;
}

/**
 * =============================================================================
 * Provider validation
 * =============================================================================
 */

function validateProvider(
    provider,
    config,
    collection,
    options,
) {

    const normalized =
        normalizeProvider(
            provider,
        );

    if (
        !normalized
    ) {

        if (
            options.requireProvider
        ) {

            collection.addIssue({
                code:
                    VALIDATION_ERROR_CODES
                        .REQUIRED_VARIABLE_MISSING,

                category:
                    VALIDATION_CATEGORIES
                        .REQUIRED,

                severity:
                    options.environment ===
                        'production'
                        ? VALIDATION_SEVERITIES
                            .CRITICAL
                        : VALIDATION_SEVERITIES
                            .ERROR,

                variable:
                    'MOBILE_MONEY_PROVIDER',

                environment:
                    options.environment,

                message:
                    'TITech Mobile Money provider configuration is required.',
            });
        }

        return null;
    }

    const supported =
        options.supportedProviders
            .map(
                normalizeProvider,
            );

    if (
        !supported.includes(
            normalized,
        )
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .INVALID_ENUM,

            category:
                VALIDATION_CATEGORIES
                    .ENUM,

            severity:
                VALIDATION_SEVERITIES
                    .CRITICAL,

            variable:
                'MOBILE_MONEY_PROVIDER',

            environment:
                options.environment,

            expected:
                supported,

            actual:
                normalized,

            message:
                `TITech Mobile Money provider "${normalized}" is not supported by the current configuration policy.`,
        });

        return normalized;
    }

    const providerPolicy =
        resolveProviderConfig(
            normalized,
            options,
        );

    const providerFlags = {
        ...providerPolicy,
    };

    /**
     * -------------------------------------------------------------------------
     * Provider-specific field resolution.
     * -------------------------------------------------------------------------
     */

    const fields = {
        BASE_URL:
            firstPresent(
                config,
                resolveProviderVariable(
                    normalized,
                    'BASE_URL',
                ),
            ),

        API_KEY:
            firstPresent(
                config,
                resolveProviderVariable(
                    normalized,
                    'API_KEY',
                ),
            ),

        CLIENT_ID:
            firstPresent(
                config,
                resolveProviderVariable(
                    normalized,
                    'CLIENT_ID',
                ),
            ),

        CLIENT_SECRET:
            firstPresent(
                config,
                resolveProviderVariable(
                    normalized,
                    'CLIENT_SECRET',
                ),
            ),

        PASSKEY:
            firstPresent(
                config,
                resolveProviderVariable(
                    normalized,
                    'PASSKEY',
                ),
            ),

        MERCHANT_ID:
            firstPresent(
                config,
                resolveProviderVariable(
                    normalized,
                    'MERCHANT_ID',
                ),
            ),

        SUBSCRIPTION_KEY:
            firstPresent(
                config,
                resolveProviderVariable(
                    normalized,
                    'SUBSCRIPTION_KEY',
                ),
            ),

        CALLBACK_URL:
            firstPresent(
                config,
                resolveProviderVariable(
                    normalized,
                    'CALLBACK_URL',
                ),
            ),

        WEBHOOK_URL:
            firstPresent(
                config,
                resolveProviderVariable(
                    normalized,
                    'WEBHOOK_URL',
                ),
            ),

        WEBHOOK_SECRET:
            firstPresent(
                config,
                resolveProviderVariable(
                    normalized,
                    'WEBHOOK_SECRET',
                ),
            ),
    };

    const baseUrlVariable =
        fields.BASE_URL.variable ||
        'MOBILE_MONEY_BASE_URL';

    const callbackVariable =
        fields.CALLBACK_URL.variable ||
        'MOBILE_MONEY_CALLBACK_URL';

    const webhookVariable =
        fields.WEBHOOK_URL.variable ||
        'MOBILE_MONEY_WEBHOOK_URL';

    if (
        options.requireBaseUrl
    ) {

        validateRequiredField(
            baseUrlVariable,
            fields.BASE_URL.value,
            collection,
            options,
        );
    }

    validateProviderUrl(
        baseUrlVariable,
        fields.BASE_URL.value,
        collection,
        options,
    );

    if (
        options.requireCallbackUrl
    ) {

        validateRequiredField(
            callbackVariable,
            fields.CALLBACK_URL.value,
            collection,
            options,
        );
    }

    validateProviderUrl(
        callbackVariable,
        fields.CALLBACK_URL.value,
        collection,
        options,
    );

    if (
        options.requireWebhookUrl
    ) {

        validateRequiredField(
            webhookVariable,
            fields.WEBHOOK_URL.value,
            collection,
            options,
        );
    }

    if (
        fields.WEBHOOK_URL.value
    ) {

        validateProviderUrl(
            webhookVariable,
            fields.WEBHOOK_URL.value,
            collection,
            options,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Provider-specific credentials.
     * -------------------------------------------------------------------------
     */

    if (
        options.requireCredentials
    ) {

        const requireApiKey =
            Boolean(
                options.requireApiKey ||
                providerFlags.requireApiKey,
            );

        const requireClientId =
            Boolean(
                options.requireClientId ||
                providerFlags.requireClientId,
            );

        const requireClientSecret =
            Boolean(
                options.requireClientSecret ||
                providerFlags
                    .requireClientSecret,
            );

        const requirePasskey =
            Boolean(
                options.requirePasskey ||
                providerFlags.requirePasskey,
            );

        const requireSubscriptionKey =
            Boolean(
                options.requireSubscriptionKey ||
                providerFlags
                    .requireSubscriptionKey,
            );

        if (
            requireApiKey
        ) {

            validateSecret(
                fields.API_KEY.variable ||
                    `${normalized
                        .replace(
                            /-/g,
                            '_',
                        )
                        .toUpperCase()}_API_KEY`,
                fields.API_KEY.value,
                collection,
                options,
                true,
            );
        }

        if (
            requireClientId
        ) {

            validateRequiredField(
                fields.CLIENT_ID.variable ||
                    `${normalized
                        .replace(
                            /-/g,
                            '_',
                        )
                        .toUpperCase()}_CLIENT_ID`,
                fields.CLIENT_ID.value,
                collection,
                options,
                VALIDATION_CATEGORIES
                    .SECURITY,
            );
        }

        if (
            requireClientSecret
        ) {

            validateSecret(
                fields.CLIENT_SECRET.variable ||
                    `${normalized
                        .replace(
                            /-/g,
                            '_',
                        )
                        .toUpperCase()}_CLIENT_SECRET`,
                fields.CLIENT_SECRET.value,
                collection,
                options,
                true,
            );
        }

        if (
            requirePasskey
        ) {

            validateSecret(
                fields.PASSKEY.variable ||
                    `${normalized
                        .replace(
                            /-/g,
                            '_',
                        )
                        .toUpperCase()}_PASSKEY`,
                fields.PASSKEY.value,
                collection,
                options,
                true,
            );
        }

        if (
            requireSubscriptionKey
        ) {

            validateSecret(
                fields.SUBSCRIPTION_KEY.variable ||
                    `${normalized
                        .replace(
                            /-/g,
                            '_',
                        )
                        .toUpperCase()}_SUBSCRIPTION_KEY`,
                fields.SUBSCRIPTION_KEY.value,
                collection,
                options,
                true,
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Merchant identifier.
     * -------------------------------------------------------------------------
     */

    if (
        options.requireMerchantIdentifier ||
        providerFlags
            .requireMerchantIdentifier
    ) {

        validateRequiredField(
            fields.MERCHANT_ID.variable ||
                `${normalized
                    .replace(
                        /-/g,
                        '_',
                    )
                    .toUpperCase()}_MERCHANT_ID`,
            fields.MERCHANT_ID.value,
            collection,
            options,
            VALIDATION_CATEGORIES
                .FINANCIAL,
        );

    }

    if (
        isPresent(
            fields.MERCHANT_ID.value,
        )
    ) {

        if (
            String(
                fields.MERCHANT_ID.value,
            ).length >
            options.maxIdentifierLength
        ) {

            collection.addIssue({
                code:
                    VALIDATION_ERROR_CODES
                        .INVALID_RANGE,

                category:
                    VALIDATION_CATEGORIES
                        .RANGE,

                severity:
                    VALIDATION_SEVERITIES
                        .ERROR,

                variable:
                    fields.MERCHANT_ID.variable,

                environment:
                    options.environment,

                message:
                    'TITech Mobile Money merchant identifier exceeds the configured maximum length.',
            });
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Webhook secret.
     * -------------------------------------------------------------------------
     */

    if (
        options.requireWebhookSecret
    ) {

        validateSecret(
            fields.WEBHOOK_SECRET.variable ||
                `${normalized
                    .replace(
                        /-/g,
                        '_',
                    )
                    .toUpperCase()}_WEBHOOK_SECRET`,
            fields.WEBHOOK_SECRET.value,
            collection,
            options,
            true,
        );
    }

    return {
        provider:
            normalized,

        fields: {
            baseUrl:
                fields.BASE_URL.value,

            callbackUrl:
                fields.CALLBACK_URL.value,

            webhookUrl:
                fields.WEBHOOK_URL.value,

            apiKeyConfigured:
                Boolean(
                    fields.API_KEY.value,
                ),

            clientIdConfigured:
                Boolean(
                    fields.CLIENT_ID.value,
                ),

            clientSecretConfigured:
                Boolean(
                    fields.CLIENT_SECRET.value,
                ),

            passkeyConfigured:
                Boolean(
                    fields.PASSKEY.value,
                ),

            subscriptionKeyConfigured:
                Boolean(
                    fields.SUBSCRIPTION_KEY.value,
                ),

            merchantIdConfigured:
                Boolean(
                    fields.MERCHANT_ID.value,
                ),

            webhookSecretConfigured:
                Boolean(
                    fields.WEBHOOK_SECRET.value,
                ),
        },
    };
}

/**
 * =============================================================================
 * Callback/webhook consistency validation
 * =============================================================================
 */

function validateCallbackPolicy(
    config,
    collection,
    options,
) {

    const callbackUrl =
        normalizeString(
            config.MOBILE_MONEY_CALLBACK_URL,
        );

    const webhookUrl =
        normalizeString(
            config.MOBILE_MONEY_WEBHOOK_URL,
        );

    const callbackMethod =
        normalizeUpper(
            config.MOBILE_MONEY_CALLBACK_METHOD ||
            'POST',
        );

    if (
        callbackMethod &&
        !options.allowedHttpMethods.includes(
            callbackMethod,
        )
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .INVALID_ENUM,

            category:
                VALIDATION_CATEGORIES
                    .ENUM,

            severity:
                VALIDATION_SEVERITIES
                    .ERROR,

            variable:
                'MOBILE_MONEY_CALLBACK_METHOD',

            environment:
                options.environment,

            expected:
                options.allowedHttpMethods,

            actual:
                callbackMethod,

            message:
                'TITech Mobile Money callback method is not permitted.',
        });
    }

    if (
        callbackUrl &&
        webhookUrl &&
        callbackUrl ===
            webhookUrl
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .CONFIGURATION_INCONSISTENT,

            category:
                VALIDATION_CATEGORIES
                    .CONFIGURATION,

            severity:
                VALIDATION_SEVERITIES
                    .WARNING,

            variable:
                'MOBILE_MONEY_WEBHOOK_URL',

            environment:
                options.environment,

            message:
                'TITech Mobile Money callback and webhook endpoints resolve to the same URL; verify that this is intentional.',
        });
    }
}

/**
 * =============================================================================
 * Currency/country validation
 * =============================================================================
 */

function validateLocale(
    config,
    collection,
    options,
) {

    const currency =
        (
            normalizeString(
                config.MOBILE_MONEY_CURRENCY ||
                config.PAYMENT_CURRENCY ||
                config.DEFAULT_CURRENCY,
            ) ||
            options.defaultCurrency
        )
            .toUpperCase();

    const country =
        (
            normalizeString(
                config.MOBILE_MONEY_COUNTRY ||
                config.PAYMENT_COUNTRY ||
                config.DEFAULT_COUNTRY,
            ) ||
            options.defaultCountry
        )
            .toUpperCase();

    if (
        !/^[A-Z]{3}$/.test(
            currency,
        )
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .INVALID_FORMAT,

            category:
                VALIDATION_CATEGORIES
                    .FORMAT,

            severity:
                VALIDATION_SEVERITIES
                    .ERROR,

            variable:
                'MOBILE_MONEY_CURRENCY',

            environment:
                options.environment,

            message:
                'TITech Mobile Money currency must be a three-letter ISO-style currency code.',
        });
    }

    if (
        !/^[A-Z]{2}$/.test(
            country,
        )
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .INVALID_FORMAT,

            category:
                VALIDATION_CATEGORIES
                    .FORMAT,

            severity:
                VALIDATION_SEVERITIES
                    .ERROR,

            variable:
                'MOBILE_MONEY_COUNTRY',

            environment:
                options.environment,

            message:
                'TITech Mobile Money country must be a two-letter country code.',
        });
    }

    if (
        options.supportedCurrencies?.length &&
        !options.supportedCurrencies
            .map(
                value =>
                    String(
                        value,
                    ).toUpperCase(),
            )
            .includes(
                currency,
            )
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .INVALID_ENUM,

            category:
                VALIDATION_CATEGORIES
                    .ENUM,

            severity:
                VALIDATION_SEVERITIES
                    .ERROR,

            variable:
                'MOBILE_MONEY_CURRENCY',

            environment:
                options.environment,

            expected:
                options.supportedCurrencies
                    .map(
                        value =>
                            String(
                                value,
                            ).toUpperCase(),
                    ),

            actual:
                currency,

            message:
                `TITech Mobile Money currency "${currency}" is not enabled by the current configuration policy.`,
        });
    }

    if (
        options.supportedCountries?.length &&
        !options.supportedCountries
            .map(
                value =>
                    String(
                        value,
                    ).toUpperCase(),
            )
            .includes(
                country,
            )
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .INVALID_ENUM,

            category:
                VALIDATION_CATEGORIES
                    .ENUM,

            severity:
                VALIDATION_SEVERITIES
                    .ERROR,

            variable:
                'MOBILE_MONEY_COUNTRY',

            environment:
                options.environment,

            expected:
                options.supportedCountries
                    .map(
                        value =>
                            String(
                                value,
                            ).toUpperCase(),
                    ),

            actual:
                country,

            message:
                `TITech Mobile Money country "${country}" is not enabled by the current configuration policy.`,
        });
    }

    return {
        currency,

        country,
    };
}

/**
 * =============================================================================
 * Timeout/retry validation
 * =============================================================================
 */

function validateTransportPolicy(
    config,
    collection,
    options,
) {

    const timeoutMs =
        normalizeInteger(
            config.MOBILE_MONEY_TIMEOUT_MS ||
            config.PAYMENT_TIMEOUT_MS,
            options.defaultTimeoutMs,
        );

    const retries =
        normalizeInteger(
            config.MOBILE_MONEY_MAX_RETRIES ||
            config.PAYMENT_MAX_RETRIES,
            options.defaultRetries,
        );

    const retryDelayMs =
        normalizeInteger(
            config.MOBILE_MONEY_RETRY_DELAY_MS ||
            config.PAYMENT_RETRY_DELAY_MS,
            options.defaultRetryDelayMs,
        );

    if (
        timeoutMs ===
            null ||
        timeoutMs <
            options.minimumTimeoutMs ||
        timeoutMs >
            options.maximumTimeoutMs
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .INVALID_RANGE,

            category:
                VALIDATION_CATEGORIES
                    .RANGE,

            severity:
                VALIDATION_SEVERITIES
                    .ERROR,

            variable:
                'MOBILE_MONEY_TIMEOUT_MS',

            environment:
                options.environment,

            expected:
                {
                    min:
                        options.minimumTimeoutMs,

                    max:
                        options.maximumTimeoutMs,
                },

            actual:
                config.MOBILE_MONEY_TIMEOUT_MS,

            message:
                'TITech Mobile Money timeout is outside the supported range.',
        });
    }

    if (
        retries ===
            null ||
        retries <
            0 ||
        retries >
            options.maximumRetries
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .INVALID_RANGE,

            category:
                VALIDATION_CATEGORIES
                    .RANGE,

            severity:
                VALIDATION_SEVERITIES
                    .ERROR,

            variable:
                'MOBILE_MONEY_MAX_RETRIES',

            environment:
                options.environment,

            expected:
                {
                    min:
                        0,

                    max:
                        options.maximumRetries,
                },

            actual:
                config.MOBILE_MONEY_MAX_RETRIES,

            message:
                'TITech Mobile Money retry count is outside the supported range.',
        });
    }

    if (
        retryDelayMs ===
            null ||
        retryDelayMs <
            0 ||
        retryDelayMs >
            options.maximumRetryDelayMs
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .INVALID_RANGE,

            category:
                VALIDATION_CATEGORIES
                    .RANGE,

            severity:
                VALIDATION_SEVERITIES
                    .ERROR,

            variable:
                'MOBILE_MONEY_RETRY_DELAY_MS',

            environment:
                options.environment,

            expected:
                {
                    min:
                        0,

                    max:
                        options.maximumRetryDelayMs,
                },

            actual:
                config.MOBILE_MONEY_RETRY_DELAY_MS,

            message:
                'TITech Mobile Money retry delay is outside the supported range.',
        });
    }

    return {
        timeoutMs,

        retries,

        retryDelayMs,
    };
}

/**
 * =============================================================================
 * Authentication mode validation
 * =============================================================================
 */

function validateAuthMode(
    config,
    collection,
    options,
) {

    const authMode =
        normalizeLower(
            config.MOBILE_MONEY_AUTH_MODE ||
            config.PAYMENT_AUTH_MODE ||
            MOBILE_MONEY_AUTH_MODES
                .OAUTH2,
        );

    const supported =
        Object.values(
            MOBILE_MONEY_AUTH_MODES,
        );

    if (
        !supported.includes(
            authMode,
        )
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .INVALID_ENUM,

            category:
                VALIDATION_CATEGORIES
                    .ENUM,

            severity:
                VALIDATION_SEVERITIES
                    .ERROR,

            variable:
                'MOBILE_MONEY_AUTH_MODE',

            environment:
                options.environment,

            expected:
                supported,

            actual:
                authMode,

            message:
                'TITech Mobile Money authentication mode is unsupported.',
        });
    }

    return authMode;
}

/**
 * =============================================================================
 * Duplicate/provider conflict validation
 * =============================================================================
 */

function validateProviderSelection(
    config,
    collection,
    options,
) {

    const primary =
        normalizeProvider(
            config.MOBILE_MONEY_PROVIDER,
        );

    const configured =
        normalizeProviderList(
            config.MOBILE_MONEY_PROVIDERS ||
            config.ENABLED_MOBILE_MONEY_PROVIDERS,
        );

    if (
        primary &&
        configured.length > 0 &&
        !configured.includes(
            primary,
        )
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .CONFIGURATION_INCONSISTENT,

            category:
                VALIDATION_CATEGORIES
                    .CONFIGURATION,

            severity:
                VALIDATION_SEVERITIES
                    .ERROR,

            variable:
                'MOBILE_MONEY_PROVIDER',

            environment:
                options.environment,

            expected:
                configured,

            actual:
                primary,

            message:
                'TITech primary Mobile Money provider must be included in the enabled-provider list.',
        });
    }

    if (
        !options.allowMultipleProviders &&
        configured.length >
            1
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .CONFIGURATION_INCONSISTENT,

            category:
                VALIDATION_CATEGORIES
                    .CONFIGURATION,

            severity:
                VALIDATION_SEVERITIES
                    .ERROR,

            variable:
                'MOBILE_MONEY_PROVIDERS',

            environment:
                options.environment,

            message:
                'TITech configuration permits only one active Mobile Money provider.',
        });
    }

    return {
        primary,

        configured:
            configured.length
                ? configured
                : primary
                    ? [
                        primary,
                    ]
                    : [],
    };
}

/**
 * =============================================================================
 * Main validator
 * =============================================================================
 */

function validateMobileMoneyConfiguration(
    config = {},
    options = {},
) {

    const environment =
        normalizeEnvironment(
            options.environment ||
            config.NODE_ENV,
        );

    const normalizedOptions =
        {
            ...DEFAULTS,
            ...options,

            environment,
        };

    const collection =
        new ValidationErrorCollection({
            maxErrors:
                normalizedOptions.maxErrors,
        });

    const diagnostics =
        {
            component:
                COMPONENT,

            service:
                SERVICE_NAME,

            application:
                APPLICATION_NAME,

            environment,

            timestamp:
                new Date().toISOString(),
        };

    /**
     * -------------------------------------------------------------------------
     * Provider selection.
     * -------------------------------------------------------------------------
     */

    const providerSelection =
        validateProviderSelection(
            config,
            collection,
            normalizedOptions,
        );

    diagnostics.providers =
        providerSelection;

    const primaryProvider =
        providerSelection.primary ||
        normalizeProvider(
            config.MOBILE_MONEY_PROVIDER,
        );

    /**
     * -------------------------------------------------------------------------
     * Auth mode.
     * -------------------------------------------------------------------------
     */

    diagnostics.authMode =
        validateAuthMode(
            config,
            collection,
            normalizedOptions,
        );

    /**
     * -------------------------------------------------------------------------
     * Global/base credentials.
     * -------------------------------------------------------------------------
     */

    const globalApiKey =
        normalizeString(
            config.MOBILE_MONEY_API_KEY ||
            config.PAYMENT_API_KEY,
        );

    const globalClientId =
        normalizeString(
            config.MOBILE_MONEY_CLIENT_ID ||
            config.PAYMENT_CLIENT_ID,
        );

    const globalClientSecret =
        normalizeString(
            config.MOBILE_MONEY_CLIENT_SECRET ||
            config.PAYMENT_CLIENT_SECRET,
        );

    const globalSubscriptionKey =
        normalizeString(
            config.MOBILE_MONEY_SUBSCRIPTION_KEY,
        );

    const globalPasskey =
        normalizeString(
            config.MOBILE_MONEY_PASSKEY,
        );

    const globalMerchantId =
        normalizeString(
            config.MOBILE_MONEY_MERCHANT_ID ||
            config.PAYMENT_MERCHANT_ID,
        );

    const globalWebhookSecret =
        normalizeString(
            config.MOBILE_MONEY_WEBHOOK_SECRET ||
            config.PAYMENT_WEBHOOK_SECRET,
        );

    /**
     * -------------------------------------------------------------------------
     * Global credentials if a provider is explicitly configured.
     * -------------------------------------------------------------------------
     */

    if (
        primaryProvider
    ) {

        const policy =
            resolveProviderConfig(
                primaryProvider,
                normalizedOptions,
            );

        const resolvedApiKey =
            globalApiKey;

        const resolvedClientId =
            globalClientId;

        const resolvedClientSecret =
            globalClientSecret;

        const resolvedSubscriptionKey =
            globalSubscriptionKey;

        const resolvedPasskey =
            globalPasskey;

        const resolvedMerchantId =
            globalMerchantId;

        if (
            normalizedOptions.requireCredentials
        ) {

            if (
                normalizedOptions.requireApiKey ||
                policy.requireApiKey
            ) {

                validateSecret(
                    'MOBILE_MONEY_API_KEY',
                    resolvedApiKey,
                    collection,
                    normalizedOptions,
                    true,
                );
            }

            if (
                normalizedOptions.requireClientId ||
                policy.requireClientId
            ) {

                validateRequiredField(
                    'MOBILE_MONEY_CLIENT_ID',
                    resolvedClientId,
                    collection,
                    normalizedOptions,
                    VALIDATION_CATEGORIES
                        .SECURITY,
                );
            }

            if (
                normalizedOptions.requireClientSecret ||
                policy.requireClientSecret
            ) {

                validateSecret(
                    'MOBILE_MONEY_CLIENT_SECRET',
                    resolvedClientSecret,
                    collection,
                    normalizedOptions,
                    true,
                );
            }

            if (
                normalizedOptions.requireSubscriptionKey ||
                policy.requireSubscriptionKey
            ) {

                validateSecret(
                    'MOBILE_MONEY_SUBSCRIPTION_KEY',
                    resolvedSubscriptionKey,
                    collection,
                    normalizedOptions,
                    true,
                );
            }

            if (
                normalizedOptions.requirePasskey ||
                policy.requirePasskey
            ) {

                validateSecret(
                    'MOBILE_MONEY_PASSKEY',
                    resolvedPasskey,
                    collection,
                    normalizedOptions,
                    true,
                );
            }
        }

        if (
            normalizedOptions.requireMerchantIdentifier ||
            policy.requireMerchantIdentifier
        ) {

            validateRequiredField(
                'MOBILE_MONEY_MERCHANT_ID',
                resolvedMerchantId,
                collection,
                normalizedOptions,
                VALIDATION_CATEGORIES
                    .FINANCIAL,
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Global webhook secret.
     * -------------------------------------------------------------------------
     */

    validateSecret(
        'MOBILE_MONEY_WEBHOOK_SECRET',
        globalWebhookSecret,
        collection,
        normalizedOptions,
        normalizedOptions
            .requireWebhookSecret,
    );

    /**
     * -------------------------------------------------------------------------
     * Primary provider detailed validation.
     * -------------------------------------------------------------------------
     */

    let providerDetails =
        null;

    if (
        primaryProvider
    ) {

        providerDetails =
            validateProvider(
                primaryProvider,
                config,
                collection,
                normalizedOptions,
            );
    }

    diagnostics.provider =
        providerDetails;

    /**
     * -------------------------------------------------------------------------
     * Locale.
     * -------------------------------------------------------------------------
     */

    diagnostics.locale =
        validateLocale(
            config,
            collection,
            normalizedOptions,
        );

    /**
     * -------------------------------------------------------------------------
     * Callback and webhook policies.
     * -------------------------------------------------------------------------
     */

    validateCallbackPolicy(
        config,
        collection,
        normalizedOptions,
    );

    /**
     * -------------------------------------------------------------------------
     * Transport policy.
     * -------------------------------------------------------------------------
     */

    diagnostics.transport =
        validateTransportPolicy(
            config,
            collection,
            normalizedOptions,
        );

    /**
     * -------------------------------------------------------------------------
     * Sandbox/production consistency.
     * -------------------------------------------------------------------------
     */

    const configuredMode =
        normalizeLower(
            config.MOBILE_MONEY_ENVIRONMENT ||
            config.PAYMENT_ENVIRONMENT ||
            (
                environment ===
                    'production'
                    ? MOBILE_MONEY_ENVIRONMENTS
                        .PRODUCTION
                    : MOBILE_MONEY_ENVIRONMENTS
                        .SANDBOX
            ),
        );

    diagnostics.mode =
        configuredMode;

    const supportedModes =
        Object.values(
            MOBILE_MONEY_ENVIRONMENTS,
        );

    if (
        !supportedModes.includes(
            configuredMode,
        )
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .INVALID_ENUM,

            category:
                VALIDATION_CATEGORIES
                    .ENUM,

            severity:
                VALIDATION_SEVERITIES
                    .ERROR,

            variable:
                'MOBILE_MONEY_ENVIRONMENT',

            environment,

            expected:
                supportedModes,

            actual:
                configuredMode,

            message:
                'TITech Mobile Money environment mode is unsupported.',
        });
    }

    if (
        environment ===
            'production' &&
        configuredMode !==
            MOBILE_MONEY_ENVIRONMENTS
                .PRODUCTION
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .CONFIGURATION_INCONSISTENT,

            category:
                VALIDATION_CATEGORIES
                    .CONFIGURATION,

            severity:
                VALIDATION_SEVERITIES
                    .CRITICAL,

            variable:
                'MOBILE_MONEY_ENVIRONMENT',

            environment,

            actual:
                configuredMode,

            message:
                'TITech production application must not use a sandbox/test Mobile Money environment.',
        });
    }

    if (
        environment !==
            'production' &&
        configuredMode ===
            MOBILE_MONEY_ENVIRONMENTS
                .PRODUCTION &&
        normalizeBoolean(
            config.MOBILE_MONEY_ALLOW_PRODUCTION_ENDPOINTS,
            false,
        ) !== true
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .SECURITY_POLICY_VIOLATION,

            category:
                VALIDATION_CATEGORIES
                    .SECURITY,

            severity:
                VALIDATION_SEVERITIES
                    .WARNING,

            variable:
                'MOBILE_MONEY_ENVIRONMENT',

            environment,

            message:
                'TITech non-production configuration points to production Mobile Money mode without explicit approval.',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Signature/callback replay policy.
     * -------------------------------------------------------------------------
     */

    const webhookAge =
        normalizeInteger(
            config.MOBILE_MONEY_WEBHOOK_MAX_AGE_SECONDS ||
            config.PAYMENT_WEBHOOK_MAX_AGE_SECONDS,
            normalizedOptions
                .defaultWebhookAgeSeconds,
        );

    diagnostics.webhook =
        {
            maxAgeSeconds:
                webhookAge,

            signatureVerificationEnabled:
                normalizeBoolean(
                    config.MOBILE_MONEY_VERIFY_WEBHOOK_SIGNATURE,
                    true,
                ),
        };

    if (
        webhookAge ===
            null ||
        webhookAge <=
            0 ||
        webhookAge >
            normalizedOptions
                .maximumWebhookAgeSeconds
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .INVALID_RANGE,

            category:
                VALIDATION_CATEGORIES
                    .RANGE,

            severity:
                VALIDATION_SEVERITIES
                    .ERROR,

            variable:
                'MOBILE_MONEY_WEBHOOK_MAX_AGE_SECONDS',

            environment,

            expected:
                {
                    min:
                        1,

                    max:
                        normalizedOptions
                            .maximumWebhookAgeSeconds,
                },

            actual:
                webhookAge,

            message:
                'TITech Mobile Money webhook maximum age is outside the supported security range.',
        });
    }

    if (
        environment ===
            'production' &&
        normalizeBoolean(
            config.MOBILE_MONEY_VERIFY_WEBHOOK_SIGNATURE,
            true,
        ) !== true
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .SECURITY_POLICY_VIOLATION,

            category:
                VALIDATION_CATEGORIES
                    .SECURITY,

            severity:
                VALIDATION_SEVERITIES
                    .CRITICAL,

            variable:
                'MOBILE_MONEY_VERIFY_WEBHOOK_SIGNATURE',

            environment,

            message:
                'TITech production Mobile Money webhook signature verification must be enabled.',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Idempotency policy.
     * -------------------------------------------------------------------------
     */

    const idempotencyEnabled =
        normalizeBoolean(
            config.MOBILE_MONEY_IDEMPOTENCY_ENABLED ??
            config.PAYMENT_IDEMPOTENCY_ENABLED,
            true,
        );

    diagnostics.idempotency =
        {
            enabled:
                idempotencyEnabled,
        };

    if (
        environment ===
            'production' &&
        idempotencyEnabled !==
            true
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .SECURITY_POLICY_VIOLATION,

            category:
                VALIDATION_CATEGORIES
                    .SECURITY,

            severity:
                VALIDATION_SEVERITIES
                    .CRITICAL,

            variable:
                'MOBILE_MONEY_IDEMPOTENCY_ENABLED',

            environment,

            message:
                'TITech production Mobile Money transactions must have idempotency protection enabled.',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Duplicate/conflicting generic credentials.
     * -------------------------------------------------------------------------
     */

    if (
        primaryProvider &&
        normalizeProviderList(
            config.MOBILE_MONEY_PROVIDERS,
        ).length >
            1 &&
        !normalizedOptions
            .allowMultipleProviders
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .CONFIGURATION_INCONSISTENT,

            category:
                VALIDATION_CATEGORIES
                    .CONFIGURATION,

            severity:
                VALIDATION_SEVERITIES
                    .ERROR,

            variable:
                'MOBILE_MONEY_PROVIDERS',

            environment,

            message:
                'TITech Mobile Money provider configuration contains multiple providers while multi-provider operation is disabled.',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Final result.
     * -------------------------------------------------------------------------
     */

    const summary =
        collection.summary();

    const blockingErrors =
        collection.getBlockingErrors();

    const status =
        blockingErrors.length >
        0
            ? 'invalid'
            : summary.warnings >
                0
                ? 'degraded'
                : 'valid';

    const safeDiagnostics =
        sanitizeMobileMoneyDiagnostics(
            diagnostics,
        );

    const result = {
        valid:
            blockingErrors.length ===
            0,

        ready:
            blockingErrors.length ===
            0,

        status,

        environment,

        provider:
            primaryProvider ||
            null,

        providers:
            providerSelection
                .configured,

        summary,

        diagnostics:
            safeDiagnostics,

        errors:
            collection.toJSON({
                environment,
                includeRawValues:
                    false,
            }),

        fingerprint:
            fingerprint(
                {
                    environment,

                    provider:
                        primaryProvider ||
                        null,

                    providers:
                        providerSelection
                            .configured,

                    currency:
                        diagnostics
                            .locale
                            ?.currency ||
                        null,

                    country:
                        diagnostics
                            .locale
                            ?.country ||
                        null,

                    mode:
                        configuredMode,

                    errorCodes:
                        collection.errors.map(
                            error =>
                                error.code,
                        ),
                },
                normalizedOptions,
            ),

        timestamp:
            new Date().toISOString(),
    };

    if (
        normalizedOptions.failClosed &&
        blockingErrors.length >
        0
    ) {

        throw new EnvironmentValidationAggregateError(
            blockingErrors,
            {
                message:
                    'TITech Mobile Money configuration validation failed.',

                environment,

                component:
                    COMPONENT,

                code:
                    'TITECH_MOBILE_MONEY_CONFIGURATION_INVALID',
            },
        );
    }

    return deepFreeze(
        result,
    );
}

/**
 * =============================================================================
 * Diagnostics sanitizer
 * =============================================================================
 */

function sanitizeMobileMoneyDiagnostics(
    diagnostics,
) {

    const result =
        clone(
            diagnostics,
        );

    if (
        result.provider?.fields
    ) {

        const fields =
            result.provider.fields;

        delete fields.apiKey;
        delete fields.clientSecret;
        delete fields.passkey;
        delete fields.subscriptionKey;
        delete fields.webhookSecret;
    }

    /**
     * Keep credential metadata, never raw credential values.
     */
    return result;
}

/**
 * =============================================================================
 * MobileMoneyValidator class
 * =============================================================================
 */

class MobileMoneyValidator {

    constructor(
        options = {},
    ) {

        this.options =
            Object.freeze({
                ...DEFAULTS,
                ...options,
            });

        this.state =
            'created';

        this.validationCount =
            0;

        this.lastResult =
            null;

        this.lastError =
            null;
    }

    /**
     * -------------------------------------------------------------------------
     * Validate.
     * -------------------------------------------------------------------------
     */

    validate(
        config = {},
        options = {},
    ) {

        const mergedOptions =
            {
                ...this.options,
                ...options,
            };

        this.state =
            'validating';

        try {

            const result =
                validateMobileMoneyConfiguration(
                    config,
                    mergedOptions,
                );

            this.validationCount +=
                1;

            this.lastResult =
                result;

            this.lastError =
                null;

            this.state =
                result.valid
                    ? 'ready'
                    : 'failed';

            log(
                result.valid
                    ? result.status ===
                      'degraded'
                        ? 'warn'
                        : 'debug'
                    : 'error',
                {
                    environment:
                        normalizeEnvironment(
                            mergedOptions
                                .environment ||
                            config.NODE_ENV,
                        ),

                    provider:
                        result.provider,

                    status:
                        result.status,

                    errorCount:
                        result.summary
                            .total,
                },
                result.valid
                    ? 'TITech Mobile Money configuration validation completed.'
                    : 'TITech Mobile Money configuration validation failed.',
            );

            return result;

        } catch (
            error
        ) {

            this.state =
                'failed';

            this.lastError =
                error;

            throw error;
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Process environment.
     * -------------------------------------------------------------------------
     */

    validateEnvironment(
        options = {},
    ) {

        return this.validate(
            process.env,
            options,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Production validation.
     * -------------------------------------------------------------------------
     */

    validateProduction(
        config = {},
        options = {},
    ) {

        return this.validate(
            config,
            {
                ...options,

                environment:
                    'production',

                requireProvider:
                    true,

                requireBaseUrl:
                    true,

                requireCallbackUrl:
                    true,

                requireWebhookSecret:
                    true,

                requireCredentials:
                    true,

                requireProductionTls:
                    true,

                requireHttpsInProduction:
                    true,

                allowHttpInProduction:
                    false,

                failClosed:
                    options.failClosed ??
                    true,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Staging validation.
     * -------------------------------------------------------------------------
     */

    validateStaging(
        config = {},
        options = {},
    ) {

        return this.validate(
            config,
            {
                ...options,

                environment:
                    'staging',

                requireProvider:
                    true,

                requireBaseUrl:
                    true,

                requireCallbackUrl:
                    true,

                failClosed:
                    options.failClosed ??
                    true,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Sandbox validation.
     * -------------------------------------------------------------------------
     */

    validateSandbox(
        config = {},
        options = {},
    ) {

        return this.validate(
            config,
            {
                ...options,

                environment:
                    'development',

                failClosed:
                    options.failClosed ??
                    true,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Non-throwing check.
     * -------------------------------------------------------------------------
     */

    check(
        config = {},
        options = {},
    ) {

        try {

            return this.validate(
                config,
                {
                    ...options,

                    failClosed:
                        false,
                },
            );

        } catch (
            error
        ) {

            if (
                error instanceof
                EnvironmentValidationAggregateError
            ) {

                return {
                    valid:
                        false,

                    ready:
                        false,

                    status:
                        'invalid',

                    error:
                        error.toJSON(),
                };
            }

            return {
                valid:
                    false,

                ready:
                    false,

                status:
                    'invalid',

                error:
                    {
                        name:
                            error.name,

                        code:
                            error.code,

                        message:
                            error.message,
                    },
            };
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Provider helper.
     * -------------------------------------------------------------------------
     */

    normalizeProvider(
        provider,
    ) {

        return normalizeProvider(
            provider,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Snapshot.
     * -------------------------------------------------------------------------
     */

    snapshot() {

        return deepFreeze({
            component:
                COMPONENT,

            service:
                SERVICE_NAME,

            application:
                APPLICATION_NAME,

            state:
                this.state,

            validationCount:
                this.validationCount,

            lastResult:
                clone(
                    this.lastResult,
                ),

            lastError:
                this.lastError
                    ? {
                        name:
                            this.lastError
                                .name,

                        code:
                            this.lastError
                                .code,

                        message:
                            this.lastError
                                .message,
                    }
                    : null,

            timestamp:
                new Date().toISOString(),
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Readiness.
     * -------------------------------------------------------------------------
     */

    readiness() {

        return {
            status:
                this.state ===
                    'failed'
                    ? 'not_ready'
                    : 'ready',

            ready:
                this.state !==
                'failed',

            state:
                this.state,

            validationCount:
                this.validationCount,

            timestamp:
                new Date().toISOString(),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Health.
     * -------------------------------------------------------------------------
     */

    health() {

        const readiness =
            this.readiness();

        return {
            status:
                readiness.ready
                    ? 'healthy'
                    : 'unhealthy',

            healthy:
                readiness.ready,

            state:
                this.state,

            validationCount:
                this.validationCount,

            lastValidationStatus:
                this.lastResult
                    ?.status ||
                null,

            timestamp:
                new Date().toISOString(),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Reset.
     * -------------------------------------------------------------------------
     */

    reset() {

        this.state =
            'created';

        this.validationCount =
            0;

        this.lastResult =
            null;

        this.lastError =
            null;

        return this;
    }
}

/**
 * =============================================================================
 * Singleton
 * =============================================================================
 */

const mobileMoneyValidator =
    new MobileMoneyValidator();

/**
 * =============================================================================
 * Convenience API
 * =============================================================================
 */

function validate(
    config,
    options,
) {

    return mobileMoneyValidator.validate(
        config,
        options,
    );
}

function validateEnvironment(
    options,
) {

    return mobileMoneyValidator
        .validateEnvironment(
            options,
        );
}

function validateProduction(
    config,
    options,
) {

    return mobileMoneyValidator
        .validateProduction(
            config,
            options,
        );
}

function validateStaging(
    config,
    options,
) {

    return mobileMoneyValidator
        .validateStaging(
            config,
            options,
        );
}

function validateSandbox(
    config,
    options,
) {

    return mobileMoneyValidator
        .validateSandbox(
            config,
            options,
        );
}

function check(
    config,
    options,
) {

    return mobileMoneyValidator.check(
        config,
        options,
    );
}

function normalizeProviderPublic(
    provider,
) {

    return normalizeProvider(
        provider,
    );
}

function snapshot() {

    return mobileMoneyValidator.snapshot();
}

function readiness() {

    return mobileMoneyValidator.readiness();
}

function health() {

    return mobileMoneyValidator.health();
}

function reset() {

    return mobileMoneyValidator.reset();
}

/**
 * =============================================================================
 * Public API
 * =============================================================================
 */

module.exports =
    Object.freeze({
        /**
         * Singleton and class.
         */
        mobileMoneyValidator,

        MobileMoneyValidator,

        MobileMoneyValidatorError,

        /**
         * Constants.
         */
        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        MOBILE_MONEY_PROVIDERS,

        MOBILE_MONEY_ENVIRONMENTS,

        MOBILE_MONEY_AUTH_MODES,

        DEFAULTS,

        /**
         * Validation.
         */
        validate,

        validateEnvironment,

        validateProduction,

        validateStaging,

        validateSandbox,

        check,

        validateMobileMoneyConfiguration,

        /**
         * Provider helpers.
         */
        normalizeProvider:
            normalizeProviderPublic,

        normalizeProviderList,

        resolveProviderVariable,

        /**
         * URL/security helpers.
         */
        isLoopback,

        isPrivateIpv4,

        /**
         * Diagnostics.
         */
        snapshot,

        readiness,

        health,

        reset,

        /**
         * Fingerprint.
         */
        fingerprint,
    });