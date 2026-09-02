'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/environment/validation/securityValidator.js
 *
 * Purpose:
 *   Enterprise production-grade application security configuration validator.
 *
 * Responsibilities:
 *   - Validate TITech security-related environment configuration.
 *   - Validate security policy enablement.
 *   - Validate HTTPS/TLS requirements.
 *   - Validate CORS origins and credential policies.
 *   - Validate cookie security settings.
 *   - Validate CSRF configuration.
 *   - Validate Helmet/security-header configuration.
 *   - Validate rate limiting configuration.
 *   - Validate request/body limits.
 *   - Validate session and token security settings.
 *   - Validate encryption and hashing configuration.
 *   - Validate password/security policy parameters.
 *   - Validate secure production defaults.
 *   - Detect contradictory security settings.
 *   - Detect insecure development settings accidentally enabled in production.
 *   - Produce credential-safe diagnostics.
 *   - Integrate with validationErrors.js.
 *   - Remain connectivity and infrastructure independent.
 *
 * IMPORTANT:
 *
 *   This module VALIDATES SECURITY CONFIGURATION.
 *
 *   It does NOT:
 *     - implement authentication.
 *     - implement authorization.
 *     - hash passwords.
 *     - encrypt/decrypt application data.
 *     - create JWTs.
 *     - validate JWTs.
 *     - enforce CORS at runtime.
 *     - configure Helmet at runtime.
 *     - create Redis-backed rate limiters.
 *     - mutate process.env.
 *     - load dotenv files.
 *     - merge configuration layers.
 *     - start Express.
 *     - execute financial transactions.
 *
 * =============================================================================
 *
 * Validation boundary:
 *
 *   normalized environment
 *       ↓
 *   securityValidator.js
 *       ↓
 *   validationErrors.js
 *       ↓
 *   security bootstrap
 *       ↓
 *   runtime middleware/security controls
 *
 * =============================================================================
 */

const crypto =
    require('node:crypto');

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
 * Optional secret masker
 * =============================================================================
 */

let secretMaskerModule =
    null;

try {
    // eslint-disable-next-line global-require
    secretMaskerModule =
        require('../secretMasker');
} catch {
    secretMaskerModule =
        null;
}

/**
 * =============================================================================
 * Optional logger
 * =============================================================================
 */

let loggerModule =
    null;

try {
    // eslint-disable-next-line global-require
    loggerModule =
        require('../../../utils/logger');
} catch {
    loggerModule =
        null;
}

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const COMPONENT =
    'environment-validation-security';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

/**
 * Supported security policy modes.
 */
const SECURITY_MODES =
    Object.freeze({
        DEVELOPMENT:
            'development',

        TEST:
            'test',

        STAGING:
            'staging',

        PRODUCTION:
            'production',
    });

/**
 * Supported password hashing algorithms.
 */
const PASSWORD_HASH_ALGORITHMS =
    Object.freeze([
        'argon2id',
        'argon2i',
        'argon2d',
        'bcrypt',
        'scrypt',
        'pbkdf2',
    ]);

/**
 * Supported encryption algorithms.
 */
const ENCRYPTION_ALGORITHMS =
    Object.freeze([
        'aes-256-gcm',
        'aes-192-gcm',
        'aes-128-gcm',
        'aes-256-cbc',
        'aes-192-cbc',
        'aes-128-cbc',
    ]);

/**
 * Approved HMAC/hash algorithms.
 */
const HMAC_ALGORITHMS =
    Object.freeze([
        'sha256',
        'sha384',
        'sha512',
    ]);

/**
 * Common HTTP security headers controlled through application configuration.
 */
const SECURITY_HEADER_POLICIES =
    Object.freeze({
        CONTENT_SECURITY_POLICY:
            'content-security-policy',

        STRICT_TRANSPORT_SECURITY:
            'strict-transport-security',

        X_CONTENT_TYPE_OPTIONS:
            'x-content-type-options',

        REFERRER_POLICY:
            'referrer-policy',

        FRAME_GUARD:
            'frame-guard',

        CROSS_ORIGIN_OPENER_POLICY:
            'cross-origin-opener-policy',

        CROSS_ORIGIN_RESOURCE_POLICY:
            'cross-origin-resource-policy',

        CROSS_ORIGIN_EMBEDDER_POLICY:
            'cross-origin-embedder-policy',
    });

/**
 * Enterprise defaults.
 */
const DEFAULTS =
    Object.freeze({
        strict:
            true,

        failClosed:
            true,

        environment:
            process.env.NODE_ENV ||
            'development',

        /**
         * Production must have transport security enabled.
         */
        requireHttpsInProduction:
            true,

        requireTlsInProduction:
            true,

        allowHttpInDevelopment:
            true,

        allowHttpInTest:
            true,

        allowInsecureCookiesInDevelopment:
            true,

        allowInsecureCookiesInProduction:
            false,

        requireSecureCookiesInProduction:
            true,

        requireHttpOnlyCookiesInProduction:
            true,

        requireSameSiteCookiesInProduction:
            true,

        allowSameSiteNone:
            true,

        allowWildcardCors:
            false,

        allowCredentialsWithWildcardCors:
            false,

        requireExplicitCorsProduction:
            true,

        requireCorsOrigin:
            false,

        requireCsrfProtectionForCookieAuth:
            true,

        requireCsrfSecret:
            false,

        requireRateLimitingInProduction:
            true,

        requireSecurityHeadersInProduction:
            true,

        requireHelmetInProduction:
            true,

        requireXContentTypeOptions:
            true,

        requireFrameProtection:
            true,

        requireReferrerPolicy:
            true,

        requireHstsInProduction:
            true,

        requireCspInProduction:
            false,

        requirePasswordHashing:
            true,

        requireStrongPasswordHash:
            true,

        minimumPasswordLength:
            8,

        recommendedPasswordLength:
            12,

        maximumPasswordLength:
            256,

        minimumBcryptCost:
            10,

        recommendedBcryptCost:
            12,

        maximumBcryptCost:
            16,

        minimumScryptN:
            16_384,

        minimumPbkdf2Iterations:
            310_000,

        minimumArgonMemoryKb:
            16_384,

        minimumArgonTimeCost:
            2,

        minimumArgonParallelism:
            1,

        requireEncryptionInProduction:
            false,

        minimumEncryptionKeyBytes:
            32,

        minimumSecretLength:
            32,

        recommendedSecretLength:
            64,

        minimumCsrfSecretLength:
            32,

        minimumSessionSecretLength:
            32,

        minimumApiKeyLength:
            32,

        minimumRateLimitWindowMs:
            1_000,

        maximumRateLimitWindowMs:
            3_600_000,

        minimumRateLimitMax:
            1,

        maximumRateLimitMax:
            1_000_000,

        minimumBodyLimitBytes:
            1_024,

        maximumBodyLimitBytes:
            50 * 1024 * 1024,

        maximumHeaderLimitBytes:
            64 * 1024,

        minimumRequestTimeoutMs:
            1_000,

        maximumRequestTimeoutMs:
            300_000,

        maximumSecurityStringLength:
            16_384,

        maxErrors:
            200,

        maxOrigins:
            500,

        fingerprintAlgorithm:
            'sha256',

        redactSensitive:
            true,

        includeValues:
            false,

        sensitivePattern:
            /(password|passwd|secret|token|authorization|api[_-]?key|private[_-]?key|client[_-]?secret|encryption[_-]?key|jwt|access[_-]?token|refresh[_-]?token|cookie|credential|pin|otp|cvv|cvc|passkey|subscription[_-]?key|webhook[_-]?secret|session[_-]?secret|csrf[_-]?secret|encryption[_-]?key)/i,
    });

/**
 * =============================================================================
 * Error
 * =============================================================================
 */

class SecurityValidatorError
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
                        .SECURITY,
            },
        );

        this.name =
            'SecurityValidatorError';
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
            // Recursive fallback below.
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

        const result =
            {};

        for (
            const [
                key,
                item,
            ] of Object.entries(
                value,
            )
        ) {

            result[key] =
                clone(
                    item,
                );
        }

        return result;
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

    const result =
        String(
            value,
        )
            .trim();

    return result ||
        null;
}

function normalizeLower(
    value,
) {

    const result =
        normalizeString(
            value,
        );

    return result
        ? result.toLowerCase()
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

    const number =
        Number(
            value,
        );

    return Number.isInteger(
        number,
    )
        ? number
        : fallback;
}

function normalizeNumber(
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

    const number =
        Number(
            value,
        );

    return Number.isFinite(
        number,
    )
        ? number
        : fallback;
}

function toBoolean(
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

function isSensitiveKey(
    key,
    options,
) {

    return (
        options.sensitivePattern ||
        DEFAULTS.sensitivePattern
    ).test(
        String(
            key ||
            '',
        ),
    );
}

function maskValue(
    key,
    value,
    options,
) {

    if (
        options.includeValues ||
        !options.redactSensitive
    ) {

        return clone(
            value,
        );
    }

    if (
        !isSensitiveKey(
            key,
            options,
        )
    ) {

        return clone(
            value,
        );
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
        // Hard fallback.
    }

    return '[REDACTED]';
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
        // Security validation must remain independent from logging.
    }
}

/**
 * =============================================================================
 * URL / network helpers
 * =============================================================================
 */

function parseUrl(
    value,
) {

    try {

        return new URL(
            String(
                value,
            ),
        );

    } catch {

        return null;
    }
}

function isHttpsUrl(
    value,
) {

    const url =
        parseUrl(
            value,
        );

    return Boolean(
        url &&
        url.protocol ===
            'https:',
    );
}

function isHttpUrl(
    value,
) {

    const url =
        parseUrl(
            value,
        );

    return Boolean(
        url &&
        url.protocol ===
            'http:',
    );
}

function isWildcardOrigin(
    value,
) {

    return (
        normalizeString(
            value,
        ) ===
        '*'
    );
}

function normalizeOrigins(
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
                        normalizeString,
                    )
                    .filter(Boolean),
            ),
        ];
    }

    const normalized =
        normalizeString(
            value,
        );

    if (
        !normalized
    ) {

        return [];
    }

    if (
        normalized ===
        '*'
    ) {

        return [
            '*',
        ];
    }

    return [
        ...new Set(
            normalized
                .split(
                    /[,;|]/,
                )
                .map(
                    item =>
                        item.trim(),
                )
                .filter(Boolean),
        ),
    ];
}

function validateOrigin(
    origin,
) {

    if (
        isWildcardOrigin(
            origin,
        )
    ) {

        return {
            valid:
                true,

            wildcard:
                true,
        };
    }

    const parsed =
        parseUrl(
            origin,
        );

    if (
        !parsed
    ) {

        return {
            valid:
                false,

            wildcard:
                false,
        };
    }

    if (
        ![
            'http:',
            'https:',
        ].includes(
            parsed.protocol,
        )
    ) {

        return {
            valid:
                false,

            wildcard:
                false,
        };
    }

    return {
        valid:
            Boolean(
                parsed.hostname,
            ),

        wildcard:
            false,

        protocol:
            parsed.protocol,

        hostname:
            parsed.hostname,

        port:
            parsed.port ||
            null,
    };
}

/**
 * =============================================================================
 * Generic issue helper
 * =============================================================================
 */

function addIssue(
    collection,
    code,
    variable,
    message,
    options = {},
) {

    collection.addIssue({
        code,

        category:
            options.category ||
            VALIDATION_CATEGORIES
                .SECURITY,

        severity:
            options.severity ||
            VALIDATION_SEVERITIES
                .ERROR,

        variable,

        path:
            variable,

        environment:
            options.environment,

        expected:
            options.expected,

        actual:
            options.actual,

        message,
    });
}

/**
 * =============================================================================
 * Presence / security toggle helpers
 * =============================================================================
 */

function requireEnabled(
    config,
    variable,
    collection,
    options,
    message,
) {

    const value =
        toBoolean(
            config[variable],
            false,
        );

    if (
        !value
    ) {

        addIssue(
            collection,
            VALIDATION_ERROR_CODES
                .SECURITY_POLICY_VIOLATION,
            variable,
            message ||
                `${variable} must be enabled for the current TITech security policy.`,
            {
                severity:
                    options.environment ===
                        'production'
                        ? VALIDATION_SEVERITIES
                            .CRITICAL
                        : VALIDATION_SEVERITIES
                            .ERROR,

                environment:
                    options.environment,

                actual:
                    value,
            },
        );
    }

    return value;
}

function validateLength(
    variable,
    value,
    minimum,
    maximum,
    collection,
    options,
    severity =
        VALIDATION_SEVERITIES.ERROR,
) {

    if (
        !isPresent(
            value,
        )
    ) {

        return;
    }

    const length =
        Buffer.byteLength(
            String(
                value,
            ),
            'utf8',
        );

    if (
        minimum !==
            undefined &&
        length <
            minimum
    ) {

        addIssue(
            collection,
            VALIDATION_ERROR_CODES
                .SECURITY_POLICY_VIOLATION,
            variable,
            `${variable} is shorter than the TITech security minimum.`,
            {
                severity,

                environment:
                    options.environment,

                expected:
                    {
                        minimumBytes:
                            minimum,
                    },

                actual:
                    length,
            },
        );
    }

    if (
        maximum !==
            undefined &&
        length >
            maximum
    ) {

        addIssue(
            collection,
            VALIDATION_ERROR_CODES
                .INVALID_RANGE,
            variable,
            `${variable} exceeds the TITech security maximum.`,
            {
                severity:
                    VALIDATION_SEVERITIES
                        .ERROR,

                environment:
                    options.environment,

                expected:
                    {
                        maximumBytes:
                            maximum,
                    },

                actual:
                    length,
            },
        );
    }
}

/**
 * =============================================================================
 * HTTPS/TLS validation
 * =============================================================================
 */

function validateTransportSecurity(
    config,
    collection,
    options,
) {

    const result = {
        httpsEnforced:
            toBoolean(
                config.HTTPS_ONLY,
                options.environment ===
                    'production',
            ),

        tlsEnabled:
            toBoolean(
                config.TLS_ENABLED ??
                config.HTTPS_ENABLED,
                options.environment ===
                    'production',
            ),

        trustProxy:
            toBoolean(
                config.TRUST_PROXY,
                false,
            ),

        rejectUnauthorized:
            toBoolean(
                config.TLS_REJECT_UNAUTHORIZED,
                true,
            ),
    };

    if (
        options.environment ===
            'production'
    ) {

        if (
            options.requireHttpsInProduction &&
            result.httpsEnforced !==
                true
        ) {

            addIssue(
                collection,
                VALIDATION_ERROR_CODES
                    .SECURITY_POLICY_VIOLATION,
                'HTTPS_ONLY',
                'TITech production requires HTTPS-only operation.',
                {
                    severity:
                        VALIDATION_SEVERITIES
                            .CRITICAL,

                    environment:
                        options.environment,

                    actual:
                        result.httpsEnforced,
                },
            );
        }

        if (
            options.requireTlsInProduction &&
            result.tlsEnabled !==
                true
        ) {

            addIssue(
                collection,
                VALIDATION_ERROR_CODES
                    .SECURITY_POLICY_VIOLATION,
                'TLS_ENABLED',
                'TITech production requires TLS to be enabled.',
                {
                    severity:
                        VALIDATION_SEVERITIES
                            .CRITICAL,

                    environment:
                        options.environment,

                    actual:
                        result.tlsEnabled,
                },
            );
        }

        if (
            result.rejectUnauthorized !==
                true
        ) {

            addIssue(
                collection,
                VALIDATION_ERROR_CODES
                    .SECURITY_POLICY_VIOLATION,
                'TLS_REJECT_UNAUTHORIZED',
                'TITech production must not disable TLS certificate verification.',
                {
                    severity:
                        VALIDATION_SEVERITIES
                            .CRITICAL,

                    environment:
                        options.environment,

                    actual:
                        result.rejectUnauthorized,
                },
            );
        }
    }

    if (
        result.httpsEnforced &&
        !result.tlsEnabled
    ) {

        addIssue(
            collection,
            VALIDATION_ERROR_CODES
                .CONFIGURATION_INCONSISTENT,
            'TLS_ENABLED',
            'TITech HTTPS_ONLY cannot be enabled while TLS_ENABLED is disabled.',
            {
                severity:
                    VALIDATION_SEVERITIES
                        .CRITICAL,

                environment:
                    options.environment,
            },
        );
    }

    return result;
}

/**
 * =============================================================================
 * CORS validation
 * =============================================================================
 */

function validateCors(
    config,
    collection,
    options,
) {

    const origins =
        normalizeOrigins(
            config.CORS_ORIGINS ||
            config.CORS_ORIGIN,
        );

    const credentials =
        toBoolean(
            config.CORS_CREDENTIALS,
            false,
        );

    const enabled =
        toBoolean(
            config.CORS_ENABLED,
            true,
        );

    const result = {
        enabled,

        credentials,

        origins:
            origins.map(
                origin =>
                    isSensitiveKey(
                        'CORS_ORIGIN',
                        options,
                    )
                        ? '[REDACTED]'
                        : origin,
            ),

        wildcard:
            origins.some(
                isWildcardOrigin,
            ),
    };

    if (
        options.environment ===
            'production' &&
        options.requireExplicitCorsProduction &&
        enabled &&
        origins.length ===
            0
    ) {

        addIssue(
            collection,
            VALIDATION_ERROR_CODES
                .REQUIRED_VARIABLE_MISSING,
            'CORS_ORIGINS',
            'TITech production CORS requires an explicit allow-list of origins.',
            {
                severity:
                    VALIDATION_SEVERITIES
                        .CRITICAL,

                environment:
                    options.environment,
            },
        );
    }

    if (
        options.requireCorsOrigin &&
        origins.length ===
        0
    ) {

        addIssue(
            collection,
            VALIDATION_ERROR_CODES
                .REQUIRED_VARIABLE_MISSING,
            'CORS_ORIGINS',
            'TITech CORS origin configuration is required.',
            {
                severity:
                    VALIDATION_SEVERITIES
                        .ERROR,

                environment:
                    options.environment,
            },
        );
    }

    if (
        origins.length >
        options.maxOrigins
    ) {

        addIssue(
            collection,
            VALIDATION_ERROR_CODES
                .INVALID_RANGE,
            'CORS_ORIGINS',
            'TITech CORS origin allow-list exceeds the configured maximum.',
            {
                severity:
                    VALIDATION_SEVERITIES
                        .ERROR,

                environment:
                    options.environment,

                expected:
                    {
                        max:
                            options.maxOrigins,
                    },

                actual:
                    origins.length,
            },
        );
    }

    for (
        const origin of
        origins
    ) {

        if (
            origin ===
            '*'
        ) {

            if (
                options.environment ===
                    'production' &&
                !options.allowWildcardCors
            ) {

                addIssue(
                    collection,
                    VALIDATION_ERROR_CODES
                        .SECURITY_POLICY_VIOLATION,
                    'CORS_ORIGINS',
                    'Wildcard CORS origins are not permitted in TITech production.',
                    {
                        severity:
                            VALIDATION_SEVERITIES
                                .CRITICAL,

                        environment:
                            options.environment,
                    },
                );
            }

            if (
                credentials &&
                !options
                    .allowCredentialsWithWildcardCors
            ) {

                addIssue(
                    collection,
                    VALIDATION_ERROR_CODES
                        .SECURITY_POLICY_VIOLATION,
                    'CORS_CREDENTIALS',
                    'TITech credentialed CORS must not use a wildcard origin.',
                    {
                        severity:
                            VALIDATION_SEVERITIES
                                .CRITICAL,

                        environment:
                            options.environment,
                    },
                );
            }

            continue;
        }

        const validation =
            validateOrigin(
                origin,
            );

        if (
            !validation.valid
        ) {

            addIssue(
                collection,
                VALIDATION_ERROR_CODES
                    .INVALID_URL,
                'CORS_ORIGINS',
                `TITech CORS origin "${origin}" is invalid.`,
                {
                    severity:
                        options.environment ===
                            'production'
                            ? VALIDATION_SEVERITIES
                                .CRITICAL
                            : VALIDATION_SEVERITIES
                                .ERROR,

                    environment:
                        options.environment,

                    actual:
                        origin,
                },
            );

            continue;
        }

        if (
            options.environment ===
                'production' &&
            validation.protocol !==
                'https:'
        ) {

            addIssue(
                collection,
                VALIDATION_ERROR_CODES
                    .SECURITY_POLICY_VIOLATION,
                'CORS_ORIGINS',
                `TITech production CORS origin "${origin}" must use HTTPS.`,
                {
                    severity:
                        VALIDATION_SEVERITIES
                            .CRITICAL,

                    environment:
                        options.environment,
                },
            );
        }
    }

    return result;
}

/**
 * =============================================================================
 * Cookie validation
 * =============================================================================
 */

function validateCookies(
    config,
    collection,
    options,
) {

    const result = {
        secure:
            toBoolean(
                config.COOKIE_SECURE,
                options.environment ===
                    'production',
            ),

        httpOnly:
            toBoolean(
                config.COOKIE_HTTP_ONLY,
                options.environment ===
                    'production',
            ),

        sameSite:
            normalizeLower(
                config.COOKIE_SAME_SITE ||
                'lax',
            ),

        domain:
            normalizeString(
                config.COOKIE_DOMAIN,
            ),

        path:
            normalizeString(
                config.COOKIE_PATH ||
                '/',
            ),

        maxAgeMs:
            normalizeInteger(
                config.COOKIE_MAX_AGE_MS,
                null,
            ),
    };

    const validSameSite =
        [
            'strict',
            'lax',
            'none',
        ].includes(
            result.sameSite,
        );

    if (
        !validSameSite
    ) {

        addIssue(
            collection,
            VALIDATION_ERROR_CODES
                .INVALID_ENUM,
            'COOKIE_SAME_SITE',
            'TITech COOKIE_SAME_SITE must be strict, lax or none.',
            {
                severity:
                    VALIDATION_SEVERITIES
                        .ERROR,

                environment:
                    options.environment,

                expected:
                    [
                        'strict',
                        'lax',
                        'none',
                    ],

                actual:
                    result.sameSite,
            },
        );
    }

    if (
        options.environment ===
            'production'
    ) {

        if (
            options.requireSecureCookiesInProduction &&
            result.secure !==
                true
        ) {

            addIssue(
                collection,
                VALIDATION_ERROR_CODES
                    .SECURITY_POLICY_VIOLATION,
                'COOKIE_SECURE',
                'TITech production cookies must use the Secure attribute.',
                {
                    severity:
                        VALIDATION_SEVERITIES
                            .CRITICAL,

                    environment:
                        options.environment,

                    actual:
                        result.secure,
                },
            );
        }

        if (
            options.requireHttpOnlyCookiesInProduction &&
            result.httpOnly !==
                true
        ) {

            addIssue(
                collection,
                VALIDATION_ERROR_CODES
                    .SECURITY_POLICY_VIOLATION,
                'COOKIE_HTTP_ONLY',
                'TITech production authentication cookies must use HttpOnly.',
                {
                    severity:
                        VALIDATION_SEVERITIES
                            .CRITICAL,

                    environment:
                        options.environment,

                    actual:
                        result.httpOnly,
                },
            );
        }

        if (
            options.requireSameSiteCookiesInProduction &&
            !validSameSite
        ) {

            return result;
        }

        if (
            options.requireSameSiteCookiesInProduction &&
            !result.sameSite
        ) {

            addIssue(
                collection,
                VALIDATION_ERROR_CODES
                    .SECURITY_POLICY_VIOLATION,
                'COOKIE_SAME_SITE',
                'TITech production authentication cookies require an explicit SameSite policy.',
                {
                    severity:
                        VALIDATION_SEVERITIES
                            .CRITICAL,

                    environment:
                        options.environment,
                },
            );
        }
    }

    if (
        result.sameSite ===
            'none' &&
        result.secure !==
            true
    ) {

        addIssue(
            collection,
            VALIDATION_ERROR_CODES
                .CONFIGURATION_INCONSISTENT,
            'COOKIE_SECURE',
            'TITech SameSite=None cookies require Secure=true.',
            {
                severity:
                    VALIDATION_SEVERITIES
                        .CRITICAL,

                environment:
                    options.environment,
            },
        );
    }

    if (
        result.maxAgeMs !==
            null &&
        result.maxAgeMs <
            0
    ) {

        addIssue(
            collection,
            VALIDATION_ERROR_CODES
                .INVALID_RANGE,
            'COOKIE_MAX_AGE_MS',
            'TITech COOKIE_MAX_AGE_MS cannot be negative.',
            {
                severity:
                    VALIDATION_SEVERITIES
                        .ERROR,

                environment:
                    options.environment,

                actual:
                    result.maxAgeMs,
            },
        );
    }

    return result;
}

/**
 * =============================================================================
 * CSRF validation
 * =============================================================================
 */

function validateCsrf(
    config,
    collection,
    options,
    cookies,
) {

    const enabled =
        toBoolean(
            config.CSRF_ENABLED,
            false,
        );

    const cookieAuth =
        toBoolean(
            config.COOKIE_AUTH_ENABLED,
            false,
        );

    const secret =
        normalizeString(
            config.CSRF_SECRET,
        );

    const sameSite =
        cookies.sameSite;

    const result = {
        enabled,

        cookieAuth,

        secretConfigured:
            Boolean(
                secret,
            ),

        sameSite,
    };

    if (
        options.environment ===
            'production' &&
        cookieAuth &&
        options.requireCsrfProtectionForCookieAuth &&
        enabled !==
            true
    ) {

        addIssue(
            collection,
            VALIDATION_ERROR_CODES
                .SECURITY_POLICY_VIOLATION,
            'CSRF_ENABLED',
            'TITech production cookie-based authentication requires CSRF protection.',
            {
                severity:
                    VALIDATION_SEVERITIES
                        .CRITICAL,

                environment:
                    options.environment,
            },
        );
    }

    if (
        enabled &&
        !secret
    ) {

        addIssue(
            collection,
            VALIDATION_ERROR_CODES
                .REQUIRED_VARIABLE_MISSING,
            'CSRF_SECRET',
            'TITech CSRF protection is enabled but CSRF_SECRET is missing.',
            {
                severity:
                    options.environment ===
                        'production'
                        ? VALIDATION_SEVERITIES
                            .CRITICAL
                        : VALIDATION_SEVERITIES
                            .ERROR,

                environment:
                    options.environment,
            },
        );
    }

    if (
        secret
    ) {

        validateLength(
            'CSRF_SECRET',
            secret,
            options.minimumCsrfSecretLength,
            options.maximumSecurityStringLength,
            collection,
            options,
            options.environment ===
                'production'
                ? VALIDATION_SEVERITIES
                    .CRITICAL
                : VALIDATION_SEVERITIES
                    .ERROR,
        );
    }

    return result;
}

/**
 * =============================================================================
 * Security headers validation
 * =============================================================================
 */

function validateSecurityHeaders(
    config,
    collection,
    options,
) {

    const helmetEnabled =
        toBoolean(
            config.HELMET_ENABLED,
            options.environment ===
                'production',
        );

    const headersEnabled =
        toBoolean(
            config.SECURITY_HEADERS_ENABLED,
            helmetEnabled,
        );

    const hstsEnabled =
        toBoolean(
            config.HSTS_ENABLED,
            options.environment ===
                'production',
        );

    const cspEnabled =
        toBoolean(
            config.CSP_ENABLED,
            false,
        );

    const xContentTypeOptions =
        toBoolean(
            config.SECURITY_HEADER_X_CONTENT_TYPE_OPTIONS,
            true,
        );

    const frameProtection =
        toBoolean(
            config.SECURITY_HEADER_FRAME_PROTECTION,
            true,
        );

    const referrerPolicy =
        normalizeString(
            config.SECURITY_HEADER_REFERRER_POLICY ||
            'strict-origin-when-cross-origin',
        );

    const result = {
        helmetEnabled,

        headersEnabled,

        hstsEnabled,

        cspEnabled,

        xContentTypeOptions,

        frameProtection,

        referrerPolicy,
    };

    if (
        options.environment ===
            'production' &&
        options.requireHelmetInProduction &&
        helmetEnabled !==
            true
    ) {

        addIssue(
            collection,
            VALIDATION_ERROR_CODES
                .SECURITY_POLICY_VIOLATION,
            'HELMET_ENABLED',
            'TITech production must enable the centralized HTTP security-header subsystem.',
            {
                severity:
                    VALIDATION_SEVERITIES
                        .CRITICAL,

                environment:
                    options.environment,
            },
        );
    }

    if (
        options.environment ===
            'production' &&
        options.requireSecurityHeadersInProduction &&
        headersEnabled !==
            true
    ) {

        addIssue(
            collection,
            VALIDATION_ERROR_CODES
                .SECURITY_POLICY_VIOLATION,
            'SECURITY_HEADERS_ENABLED',
            'TITech production must enable application security headers.',
            {
                severity:
                    VALIDATION_SEVERITIES
                        .CRITICAL,

                environment:
                    options.environment,
            },
        );
    }

    if (
        options.environment ===
            'production' &&
        options.requireHstsInProduction &&
        hstsEnabled !==
            true
    ) {

        addIssue(
            collection,
            VALIDATION_ERROR_CODES
                .SECURITY_POLICY_VIOLATION,
            'HSTS_ENABLED',
            'TITech production must enable HSTS.',
            {
                severity:
                    VALIDATION_SEVERITIES
                        .CRITICAL,

                environment:
                    options.environment,
            },
        );
    }

    if (
        options.requireXContentTypeOptions &&
        xContentTypeOptions !==
            true
    ) {

        addIssue(
            collection,
            VALIDATION_ERROR_CODES
                .SECURITY_POLICY_VIOLATION,
            'SECURITY_HEADER_X_CONTENT_TYPE_OPTIONS',
            'TITech X-Content-Type-Options protection must be enabled.',
            {
                severity:
                    options.environment ===
                        'production'
                        ? VALIDATION_SEVERITIES
                            .CRITICAL
                        : VALIDATION_SEVERITIES
                            .WARNING,

                environment:
                    options.environment,
            },
        );
    }

    if (
        options.requireFrameProtection &&
        frameProtection !==
            true
    ) {

        addIssue(
            collection,
            VALIDATION_ERROR_CODES
                .SECURITY_POLICY_VIOLATION,
            'SECURITY_HEADER_FRAME_PROTECTION',
            'TITech clickjacking protection must be enabled.',
            {
                severity:
                    options.environment ===
                        'production'
                        ? VALIDATION_SEVERITIES
                            .CRITICAL
                        : VALIDATION_SEVERITIES
                            .WARNING,

                environment:
                    options.environment,
            },
        );
    }

    if (
        options.requireReferrerPolicy &&
        !isPresent(
            referrerPolicy,
        )
    ) {

        addIssue(
            collection,
            VALIDATION_ERROR_CODES
                .REQUIRED_VARIABLE_MISSING,
            'SECURITY_HEADER_REFERRER_POLICY',
            'TITech Referrer-Policy configuration is required.',
            {
                severity:
                    options.environment ===
                        'production'
                        ? VALIDATION_SEVERITIES
                            .CRITICAL
                        : VALIDATION_SEVERITIES
                            .WARNING,

                environment:
                    options.environment,
            },
        );
    }

    if (
        cspEnabled &&
        options.environment ===
            'production' &&
        !isPresent(
            config.CSP_POLICY,
        )
    ) {

        addIssue(
            collection,
            VALIDATION_ERROR_CODES
                .REQUIRED_VARIABLE_MISSING,
            'CSP_POLICY',
            'TITech Content-Security-Policy is enabled but CSP_POLICY is missing.',
            {
                severity:
                    VALIDATION_SEVERITIES
                        .ERROR,

                environment:
                    options.environment,
            },
        );
    }

    return result;
}

/**
 * =============================================================================
 * Rate-limit validation
 * =============================================================================
 */

function validateRateLimiting(
    config,
    collection,
    options,
) {

    const enabled =
        toBoolean(
            config.RATE_LIMIT_ENABLED,
            options.environment ===
                'production',
        );

    const windowMs =
        normalizeInteger(
            config.RATE_LIMIT_WINDOW_MS,
            60_000,
        );

    const max =
        normalizeInteger(
            config.RATE_LIMIT_MAX,
            100,
        );

    const trustProxy =
        toBoolean(
            config.TRUST_PROXY,
            false,
        );

    const result = {
        enabled,

        windowMs,

        max,

        trustProxy,
    };

    if (
        options.environment ===
            'production' &&
        options.requireRateLimitingInProduction &&
        enabled !==
            true
    ) {

        addIssue(
            collection,
            VALIDATION_ERROR_CODES
                .SECURITY_POLICY_VIOLATION,
            'RATE_LIMIT_ENABLED',
            'TITech production must enable request rate limiting.',
            {
                severity:
                    VALIDATION_SEVERITIES
                        .CRITICAL,

                environment:
                    options.environment,
            },
        );
    }

    if (
        windowMs <
            options.minimumRateLimitWindowMs ||
        windowMs >
            options.maximumRateLimitWindowMs
    ) {

        addIssue(
            collection,
            VALIDATION_ERROR_CODES
                .INVALID_RANGE,
            'RATE_LIMIT_WINDOW_MS',
            'TITech rate-limit window is outside the supported range.',
            {
                severity:
                    VALIDATION_SEVERITIES
                        .ERROR,

                environment:
                    options.environment,

                expected:
                    {
                        min:
                            options
                                .minimumRateLimitWindowMs,

                        max:
                            options
                                .maximumRateLimitWindowMs,
                    },

                actual:
                    windowMs,
            },
        );
    }

    if (
        max <
            options.minimumRateLimitMax ||
        max >
            options.maximumRateLimitMax
    ) {

        addIssue(
            collection,
            VALIDATION_ERROR_CODES
                .INVALID_RANGE,
            'RATE_LIMIT_MAX',
            'TITech rate-limit maximum is outside the supported range.',
            {
                severity:
                    VALIDATION_SEVERITIES
                        .ERROR,

                environment:
                    options.environment,

                expected:
                    {
                        min:
                            options
                                .minimumRateLimitMax,

                        max:
                            options
                                .maximumRateLimitMax,
                    },

                actual:
                    max,
            },
        );
    }

    if (
        enabled &&
        options.environment ===
            'production' &&
        !trustProxy &&
        toBoolean(
            config.RUNS_BEHIND_PROXY,
            false,
        )
    ) {

        addIssue(
            collection,
            VALIDATION_ERROR_CODES
                .CONFIGURATION_INCONSISTENT,
            'TRUST_PROXY',
            'TITech production is configured behind a proxy/load balancer but TRUST_PROXY is disabled; client IP based security controls may be incorrect.',
            {
                severity:
                    VALIDATION_SEVERITIES
                        .ERROR,

                environment:
                    options.environment,
            },
        );
    }

    return result;
}

/**
 * =============================================================================
 * Request/body limits validation
 * =============================================================================
 */

function validateRequestLimits(
    config,
    collection,
    options,
) {

    const bodyLimitBytes =
        normalizeInteger(
            config.REQUEST_BODY_LIMIT_BYTES ||
            config.BODY_LIMIT_BYTES,
            1 * 1024 * 1024,
        );

    const jsonLimitBytes =
        normalizeInteger(
            config.JSON_BODY_LIMIT_BYTES,
            bodyLimitBytes,
        );

    const urlEncodedLimitBytes =
        normalizeInteger(
            config.URL_ENCODED_BODY_LIMIT_BYTES,
            bodyLimitBytes,
        );

    const requestTimeoutMs =
        normalizeInteger(
            config.REQUEST_TIMEOUT_MS,
            30_000,
        );

    const headerLimitBytes =
        normalizeInteger(
            config.HEADER_LIMIT_BYTES,
            16 * 1024,
        );

    const result = {
        bodyLimitBytes,

        jsonLimitBytes,

        urlEncodedLimitBytes,

        requestTimeoutMs,

        headerLimitBytes,
    };

    for (
        const [
            variable,
            value,
            label,
        ] of [
            [
                'REQUEST_BODY_LIMIT_BYTES',
                bodyLimitBytes,
                'request body',
            ],
            [
                'JSON_BODY_LIMIT_BYTES',
                jsonLimitBytes,
                'JSON body',
            ],
            [
                'URL_ENCODED_BODY_LIMIT_BYTES',
                urlEncodedLimitBytes,
                'URL-encoded body',
            ],
        ]
    ) {

        if (
            value <
                options.minimumBodyLimitBytes ||
            value >
                options.maximumBodyLimitBytes
        ) {

            addIssue(
                collection,
                VALIDATION_ERROR_CODES
                    .INVALID_RANGE,
                variable,
                `TITech ${label} limit is outside the supported range.`,
                {
                    severity:
                        VALIDATION_SEVERITIES
                            .ERROR,

                    environment:
                        options.environment,

                    expected:
                        {
                            min:
                                options
                                    .minimumBodyLimitBytes,

                            max:
                                options
                                    .maximumBodyLimitBytes,
                        },

                    actual:
                        value,
                },
            );
        }
    }

    if (
        headerLimitBytes >
            options.maximumHeaderLimitBytes
    ) {

        addIssue(
            collection,
            VALIDATION_ERROR_CODES
                .INVALID_RANGE,
            'HEADER_LIMIT_BYTES',
            'TITech header limit is larger than the maximum permitted security boundary.',
            {
                severity:
                    VALIDATION_SEVERITIES
                        .ERROR,

                environment:
                    options.environment,

                expected:
                    {
                        max:
                            options
                                .maximumHeaderLimitBytes,
                    },

                actual:
                    headerLimitBytes,
            },
        );
    }

    if (
        requestTimeoutMs <
            options.minimumRequestTimeoutMs ||
        requestTimeoutMs >
            options.maximumRequestTimeoutMs
    ) {

        addIssue(
            collection,
            VALIDATION_ERROR_CODES
                .INVALID_RANGE,
            'REQUEST_TIMEOUT_MS',
            'TITech request timeout is outside the supported range.',
            {
                severity:
                    VALIDATION_SEVERITIES
                        .ERROR,

                environment:
                    options.environment,

                expected:
                    {
                        min:
                            options
                                .minimumRequestTimeoutMs,

                        max:
                            options
                                .maximumRequestTimeoutMs,
                    },

                actual:
                    requestTimeoutMs,
            },
        );
    }

    return result;
}

/**
 * =============================================================================
 * Password hashing policy
 * =============================================================================
 */

function validatePasswordSecurity(
    config,
    collection,
    options,
) {

    const enabled =
        toBoolean(
            config.PASSWORD_HASHING_ENABLED,
            options.requirePasswordHashing,
        );

    const algorithm =
        normalizeLower(
            config.PASSWORD_HASH_ALGORITHM ||
            'argon2id',
        );

    const passwordMinimumLength =
        normalizeInteger(
            config.PASSWORD_MIN_LENGTH,
            options.minimumPasswordLength,
        );

    const passwordMaximumLength =
        normalizeInteger(
            config.PASSWORD_MAX_LENGTH,
            options.maximumPasswordLength,
        );

    const bcryptCost =
        normalizeInteger(
            config.BCRYPT_COST,
            options.recommendedBcryptCost,
        );

    const scryptN =
        normalizeInteger(
            config.SCRYPT_N,
            options.minimumScryptN,
        );

    const pbkdf2Iterations =
        normalizeInteger(
            config.PBKDF2_ITERATIONS,
            options.minimumPbkdf2Iterations,
        );

    const argonMemoryKb =
        normalizeInteger(
            config.ARGON2_MEMORY_KB,
            options.minimumArgonMemoryKb,
        );

    const argonTimeCost =
        normalizeInteger(
            config.ARGON2_TIME_COST,
            options.minimumArgonTimeCost,
        );

    const argonParallelism =
        normalizeInteger(
            config.ARGON2_PARALLELISM,
            options.minimumArgonParallelism,
        );

    const result = {
        enabled,

        algorithm,

        passwordMinimumLength,

        passwordMaximumLength,

        bcryptCost,

        scryptN,

        pbkdf2Iterations,

        argonMemoryKb,

        argonTimeCost,

        argonParallelism,
    };

    if (
        enabled &&
        options.requireStrongPasswordHash &&
        !PASSWORD_HASH_ALGORITHMS.includes(
            algorithm,
        )
    ) {

        addIssue(
            collection,
            VALIDATION_ERROR_CODES
                .INVALID_ENUM,
            'PASSWORD_HASH_ALGORITHM',
            `Unsupported TITech password hashing algorithm "${algorithm}".`,
            {
                severity:
                    options.environment ===
                        'production'
                        ? VALIDATION_SEVERITIES
                            .CRITICAL
                        : VALIDATION_SEVERITIES
                            .ERROR,

                environment:
                    options.environment,

                expected:
                    PASSWORD_HASH_ALGORITHMS,

                actual:
                    algorithm,
            },
        );
    }

    if (
        passwordMinimumLength <
            options.minimumPasswordLength ||
        passwordMinimumLength >
            passwordMaximumLength
    ) {

        addIssue(
            collection,
            VALIDATION_ERROR_CODES
                .INVALID_RANGE,
            'PASSWORD_MIN_LENGTH',
            'TITech password minimum length is outside the configured secure range.',
            {
                severity:
                    options.environment ===
                        'production'
                        ? VALIDATION_SEVERITIES
                            .CRITICAL
                        : VALIDATION_SEVERITIES
                            .ERROR,

                environment:
                    options.environment,

                expected:
                    {
                        min:
                            options
                                .minimumPasswordLength,

                        max:
                            passwordMaximumLength,
                    },

                actual:
                    passwordMinimumLength,
            },
        );
    }

    if (
        passwordMaximumLength <
            passwordMinimumLength ||
        passwordMaximumLength >
            options.maximumPasswordLength
    ) {

        addIssue(
            collection,
            VALIDATION_ERROR_CODES
                .INVALID_RANGE,
            'PASSWORD_MAX_LENGTH',
            'TITech password maximum length is invalid.',
            {
                severity:
                    VALIDATION_SEVERITIES
                        .ERROR,

                environment:
                    options.environment,

                expected:
                    {
                        min:
                            passwordMinimumLength,

                        max:
                            options
                                .maximumPasswordLength,
                    },

                actual:
                    passwordMaximumLength,
            },
        );
    }

    if (
        algorithm ===
            'bcrypt' &&
        (
            bcryptCost <
                options.minimumBcryptCost ||
            bcryptCost >
                options.maximumBcryptCost
        )
    ) {

        addIssue(
            collection,
            VALIDATION_ERROR_CODES
                .SECURITY_POLICY_VIOLATION,
            'BCRYPT_COST',
            'TITech bcrypt cost factor is outside the supported security range.',
            {
                severity:
                    options.environment ===
                        'production'
                        ? VALIDATION_SEVERITIES
                            .CRITICAL
                        : VALIDATION_SEVERITIES
                            .ERROR,

                environment:
                    options.environment,

                expected:
                    {
                        min:
                            options
                                .minimumBcryptCost,

                        max:
                            options
                                .maximumBcryptCost,
                    },

                actual:
                    bcryptCost,
            },
        );
    }

    if (
        algorithm ===
            'scrypt' &&
        scryptN <
            options.minimumScryptN
    ) {

        addIssue(
            collection,
            VALIDATION_ERROR_CODES
                .SECURITY_POLICY_VIOLATION,
            'SCRYPT_N',
            'TITech scrypt cost parameter is too weak.',
            {
                severity:
                    options.environment ===
                        'production'
                        ? VALIDATION_SEVERITIES
                            .CRITICAL
                        : VALIDATION_SEVERITIES
                            .ERROR,

                environment:
                    options.environment,

                expected:
                    {
                        minimum:
                            options
                                .minimumScryptN,
                    },

                actual:
                    scryptN,
            },
        );
    }

    if (
        algorithm ===
            'pbkdf2' &&
        pbkdf2Iterations <
            options.minimumPbkdf2Iterations
    ) {

        addIssue(
            collection,
            VALIDATION_ERROR_CODES
                .SECURITY_POLICY_VIOLATION,
            'PBKDF2_ITERATIONS',
            'TITech PBKDF2 iteration count is too weak.',
            {
                severity:
                    options.environment ===
                        'production'
                        ? VALIDATION_SEVERITIES
                            .CRITICAL
                        : VALIDATION_SEVERITIES
                            .ERROR,

                environment:
                    options.environment,

                expected:
                    {
                        minimum:
                            options
                                .minimumPbkdf2Iterations,
                    },

                actual:
                    pbkdf2Iterations,
            },
        );
    }

    if (
        [
            'argon2id',
            'argon2i',
            'argon2d',
        ].includes(
            algorithm,
        )
    ) {

        if (
            argonMemoryKb <
            options.minimumArgonMemoryKb
        ) {

            addIssue(
                collection,
                VALIDATION_ERROR_CODES
                    .SECURITY_POLICY_VIOLATION,
                'ARGON2_MEMORY_KB',
                'TITech Argon2 memory cost is too weak.',
                {
                    severity:
                        options.environment ===
                            'production'
                            ? VALIDATION_SEVERITIES
                                .CRITICAL
                            : VALIDATION_SEVERITIES
                                .ERROR,

                    environment:
                        options.environment,

                    expected:
                        {
                            minimum:
                                options
                                    .minimumArgonMemoryKb,
                        },

                    actual:
                        argonMemoryKb,
                },
            );
        }

        if (
            argonTimeCost <
            options.minimumArgonTimeCost
        ) {

            addIssue(
                collection,
                VALIDATION_ERROR_CODES
                    .SECURITY_POLICY_VIOLATION,
                'ARGON2_TIME_COST',
                'TITech Argon2 time cost is too weak.',
                {
                    severity:
                        options.environment ===
                            'production'
                            ? VALIDATION_SEVERITIES
                                .CRITICAL
                            : VALIDATION_SEVERITIES
                                .ERROR,

                    environment:
                        options.environment,

                    expected:
                        {
                            minimum:
                                options
                                    .minimumArgonTimeCost,
                        },

                    actual:
                        argonTimeCost,
                },
            );
        }

        if (
            argonParallelism <
            options.minimumArgonParallelism
        ) {

            addIssue(
                collection,
                VALIDATION_ERROR_CODES
                    .SECURITY_POLICY_VIOLATION,
                'ARGON2_PARALLELISM',
                'TITech Argon2 parallelism is too weak.',
                {
                    severity:
                        options.environment ===
                            'production'
                            ? VALIDATION_SEVERITIES
                                .CRITICAL
                            : VALIDATION_SEVERITIES
                                .ERROR,

                    environment:
                        options.environment,

                    expected:
                        {
                            minimum:
                                options
                                    .minimumArgonParallelism,
                        },

                    actual:
                        argonParallelism,
                },
            );
        }
    }

    return result;
}

/**
 * =============================================================================
 * Encryption / key-management validation
 * =============================================================================
 */

function validateEncryption(
    config,
    collection,
    options,
) {

    const enabled =
        toBoolean(
            config.ENCRYPTION_ENABLED,
            options.requireEncryptionInProduction &&
                options.environment ===
                    'production',
        );

    const algorithm =
        normalizeLower(
            config.ENCRYPTION_ALGORITHM ||
            'aes-256-gcm',
        );

    const encryptionKey =
        normalizeString(
            config.ENCRYPTION_KEY,
        );

    const keyId =
        normalizeString(
            config.ENCRYPTION_KEY_ID,
        );

    const result = {
        enabled,

        algorithm,

        keyConfigured:
            Boolean(
                encryptionKey,
            ),

        keyIdConfigured:
            Boolean(
                keyId,
            ),
    };

    if (
        enabled &&
        !ENCRYPTION_ALGORITHMS.includes(
            algorithm,
        )
    ) {

        addIssue(
            collection,
            VALIDATION_ERROR_CODES
                .INVALID_ENUM,
            'ENCRYPTION_ALGORITHM',
            `TITech encryption algorithm "${algorithm}" is not approved.`,
            {
                severity:
                    options.environment ===
                        'production'
                        ? VALIDATION_SEVERITIES
                            .CRITICAL
                        : VALIDATION_SEVERITIES
                            .ERROR,

                environment:
                    options.environment,

                expected:
                    ENCRYPTION_ALGORITHMS,

                actual:
                    algorithm,
            },
        );
    }

    if (
        enabled &&
        !encryptionKey
    ) {

        addIssue(
            collection,
            VALIDATION_ERROR_CODES
                .REQUIRED_VARIABLE_MISSING,
            'ENCRYPTION_KEY',
            'TITech encryption is enabled but ENCRYPTION_KEY is missing.',
            {
                severity:
                    options.environment ===
                        'production'
                        ? VALIDATION_SEVERITIES
                            .CRITICAL
                        : VALIDATION_SEVERITIES
                            .ERROR,

                environment:
                    options.environment,
            },
        );

    } else if (
        encryptionKey
    ) {

        validateLength(
            'ENCRYPTION_KEY',
            encryptionKey,
            options.minimumEncryptionKeyBytes,
            options.maximumSecurityStringLength,
            collection,
            options,
            options.environment ===
                'production'
                ? VALIDATION_SEVERITIES
                    .CRITICAL
                : VALIDATION_SEVERITIES
                    .ERROR,
        );
    }

    if (
        enabled &&
        options.environment ===
            'production' &&
        !keyId
    ) {

        addIssue(
            collection,
            VALIDATION_ERROR_CODES
                .CONFIGURATION_INCONSISTENT,
            'ENCRYPTION_KEY_ID',
            'TITech production encryption should identify the active key for controlled rotation.',
            {
                severity:
                    VALIDATION_SEVERITIES
                        .WARNING,

                environment:
                    options.environment,
            },
        );
    }

    return result;
}

/**
 * =============================================================================
 * API-key / secrets policy validation
 * =============================================================================
 */

function validateApplicationSecrets(
    config,
    collection,
    options,
) {

    const jwtAccessSecret =
        normalizeString(
            config.JWT_ACCESS_SECRET ||
            config.JWT_SECRET,
        );

    const jwtRefreshSecret =
        normalizeString(
            config.JWT_REFRESH_SECRET,
        );

    const sessionSecret =
        normalizeString(
            config.SESSION_SECRET,
        );

    const apiSigningSecret =
        normalizeString(
            config.API_SIGNING_SECRET,
        );

    const result = {
        jwtAccessConfigured:
            Boolean(
                jwtAccessSecret,
            ),

        jwtRefreshConfigured:
            Boolean(
                jwtRefreshSecret,
            ),

        sessionConfigured:
            Boolean(
                sessionSecret,
            ),

        apiSigningConfigured:
            Boolean(
                apiSigningSecret,
            ),
    };

    if (
        sessionSecret
    ) {

        validateLength(
            'SESSION_SECRET',
            sessionSecret,
            options.minimumSessionSecretLength,
            options.maximumSecurityStringLength,
            collection,
            options,
            options.environment ===
                'production'
                ? VALIDATION_SEVERITIES
                    .CRITICAL
                : VALIDATION_SEVERITIES
                    .WARNING,
        );
    }

    if (
        apiSigningSecret
    ) {

        validateLength(
            'API_SIGNING_SECRET',
            apiSigningSecret,
            options.minimumSecretLength,
            options.maximumSecurityStringLength,
            collection,
            options,
            options.environment ===
                'production'
                ? VALIDATION_SEVERITIES
                    .CRITICAL
                : VALIDATION_SEVERITIES
                    .WARNING,
        );
    }

    if (
        options.environment ===
            'production' &&
        toBoolean(
            config.SESSION_ENABLED,
            false,
        ) &&
        !sessionSecret
    ) {

        addIssue(
            collection,
            VALIDATION_ERROR_CODES
                .REQUIRED_VARIABLE_MISSING,
            'SESSION_SECRET',
            'TITech production session management is enabled but SESSION_SECRET is missing.',
            {
                severity:
                    VALIDATION_SEVERITIES
                        .CRITICAL,

                environment:
                    options.environment,
            },
        );
    }

    return result;
}

/**
 * =============================================================================
 * Security configuration validator
 * =============================================================================
 */

function validateSecurityConfiguration(
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

    const diagnostics = {
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
     * Security master switch.
     * -------------------------------------------------------------------------
     */

    const securityEnabled =
        toBoolean(
            config.SECURITY_ENABLED,
            true,
        );

    diagnostics.securityEnabled =
        securityEnabled;

    if (
        environment ===
            'production' &&
        securityEnabled !==
            true
    ) {

        addIssue(
            collection,
            VALIDATION_ERROR_CODES
                .SECURITY_POLICY_VIOLATION,
            'SECURITY_ENABLED',
            'TITech production cannot run with SECURITY_ENABLED=false.',
            {
                severity:
                    VALIDATION_SEVERITIES
                        .CRITICAL,

                environment,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Transport.
     * -------------------------------------------------------------------------
     */

    diagnostics.transport =
        validateTransportSecurity(
            config,
            collection,
            normalizedOptions,
        );

    /**
     * -------------------------------------------------------------------------
     * CORS.
     * -------------------------------------------------------------------------
     */

    diagnostics.cors =
        validateCors(
            config,
            collection,
            normalizedOptions,
        );

    /**
     * -------------------------------------------------------------------------
     * Cookies.
     * -------------------------------------------------------------------------
     */

    diagnostics.cookies =
        validateCookies(
            config,
            collection,
            normalizedOptions,
        );

    /**
     * -------------------------------------------------------------------------
     * CSRF.
     * -------------------------------------------------------------------------
     */

    diagnostics.csrf =
        validateCsrf(
            config,
            collection,
            normalizedOptions,
            diagnostics.cookies,
        );

    /**
     * -------------------------------------------------------------------------
     * Security headers.
     * -------------------------------------------------------------------------
     */

    diagnostics.headers =
        validateSecurityHeaders(
            config,
            collection,
            normalizedOptions,
        );

    /**
     * -------------------------------------------------------------------------
     * Rate limiting.
     * -------------------------------------------------------------------------
     */

    diagnostics.rateLimit =
        validateRateLimiting(
            config,
            collection,
            normalizedOptions,
        );

    /**
     * -------------------------------------------------------------------------
     * Request limits.
     * -------------------------------------------------------------------------
     */

    diagnostics.requestLimits =
        validateRequestLimits(
            config,
            collection,
            normalizedOptions,
        );

    /**
     * -------------------------------------------------------------------------
     * Password security.
     * -------------------------------------------------------------------------
     */

    diagnostics.passwordSecurity =
        validatePasswordSecurity(
            config,
            collection,
            normalizedOptions,
        );

    /**
     * -------------------------------------------------------------------------
     * Encryption.
     * -------------------------------------------------------------------------
     */

    diagnostics.encryption =
        validateEncryption(
            config,
            collection,
            normalizedOptions,
        );

    /**
     * -------------------------------------------------------------------------
     * Application secrets.
     * -------------------------------------------------------------------------
     */

    diagnostics.secrets =
        validateApplicationSecrets(
            config,
            collection,
            normalizedOptions,
        );

    /**
     * -------------------------------------------------------------------------
     * Environment-specific insecure settings.
     * -------------------------------------------------------------------------
     */

    const debugEnabled =
        toBoolean(
            config.DEBUG,
            false,
        );

    const stackTraces =
        toBoolean(
            config.EXPOSE_STACK_TRACES,
            false,
        );

    const detailedErrors =
        toBoolean(
            config.EXPOSE_DETAILED_ERRORS,
            false,
        );

    const swaggerEnabled =
        toBoolean(
            config.SWAGGER_ENABLED,
            false,
        );

    const swaggerPublic =
        toBoolean(
            config.SWAGGER_PUBLIC,
            false,
        );

    diagnostics.exposure =
        {
            debugEnabled,

            stackTracesExposed:
                stackTraces,

            detailedErrorsExposed:
                detailedErrors,

            swaggerEnabled,

            swaggerPublic,
        };

    if (
        environment ===
            'production'
    ) {

        if (
            debugEnabled
        ) {

            addIssue(
                collection,
                VALIDATION_ERROR_CODES
                    .SECURITY_POLICY_VIOLATION,
                'DEBUG',
                'TITech production must disable DEBUG mode.',
                {
                    severity:
                        VALIDATION_SEVERITIES
                            .CRITICAL,

                    environment,
                },
            );
        }

        if (
            stackTraces
        ) {

            addIssue(
                collection,
                VALIDATION_ERROR_CODES
                    .SECURITY_POLICY_VIOLATION,
                'EXPOSE_STACK_TRACES',
                'TITech production must not expose server stack traces to clients.',
                {
                    severity:
                        VALIDATION_SEVERITIES
                            .CRITICAL,

                    environment,
                },
            );
        }

        if (
            detailedErrors
        ) {

            addIssue(
                collection,
                VALIDATION_ERROR_CODES
                    .SECURITY_POLICY_VIOLATION,
                'EXPOSE_DETAILED_ERRORS',
                'TITech production must not expose detailed internal errors to clients.',
                {
                    severity:
                        VALIDATION_SEVERITIES
                            .CRITICAL,

                    environment,
                },
            );
        }

        if (
            swaggerEnabled &&
            swaggerPublic
        ) {

            addIssue(
                collection,
                VALIDATION_ERROR_CODES
                    .SECURITY_POLICY_VIOLATION,
                'SWAGGER_PUBLIC',
                'TITech production API documentation must not be publicly exposed unless explicitly approved.',
                {
                    severity:
                        VALIDATION_SEVERITIES
                            .ERROR,

                    environment,
                },
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Trust proxy security.
     * -------------------------------------------------------------------------
     */

    const trustProxy =
        toBoolean(
            config.TRUST_PROXY,
            false,
        );

    const trustProxyHops =
        normalizeInteger(
            config.TRUST_PROXY_HOPS,
            null,
        );

    diagnostics.proxy =
        {
            trustProxy,

            trustProxyHops,
        };

    if (
        environment ===
            'production' &&
        trustProxy &&
        (
            trustProxyHops ===
                null ||
            trustProxyHops <
                1
        ) &&
        toBoolean(
            config.RUNS_BEHIND_PROXY,
            false,
        )
    ) {

        addIssue(
            collection,
            VALIDATION_ERROR_CODES
                .CONFIGURATION_INCONSISTENT,
            'TRUST_PROXY_HOPS',
            'TITech production proxy trust must be constrained to a known proxy-hop count when deployed behind a proxy chain.',
            {
                severity:
                    VALIDATION_SEVERITIES
                        .WARNING,

                environment,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Final summary.
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
        sanitizeDiagnostics(
            diagnostics,
            normalizedOptions,
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

        summary,

        diagnostics:
            safeDiagnostics,

        errors:
            collection.toJSON({
                environment,

                includeRawValues:
                    normalizedOptions
                        .includeValues,
            }),

        fingerprint:
            fingerprint(
                {
                    environment,

                    securityEnabled,

                    transport:
                        diagnostics.transport,

                    cors:
                        {
                            enabled:
                                diagnostics
                                    .cors
                                    ?.enabled,

                            credentials:
                                diagnostics
                                    .cors
                                    ?.credentials,

                            wildcard:
                                diagnostics
                                    .cors
                                    ?.wildcard,
                        },

                    cookies:
                        {
                            secure:
                                diagnostics
                                    .cookies
                                    ?.secure,

                            httpOnly:
                                diagnostics
                                    .cookies
                                    ?.httpOnly,

                            sameSite:
                                diagnostics
                                    .cookies
                                    ?.sameSite,
                        },

                    csrf:
                        {
                            enabled:
                                diagnostics
                                    .csrf
                                    ?.enabled,

                            cookieAuth:
                                diagnostics
                                    .csrf
                                    ?.cookieAuth,
                        },

                    headers:
                        diagnostics
                            .headers,

                    rateLimit:
                        diagnostics
                            .rateLimit,

                    errorCodes:
                        collection.errors
                            .map(
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
                    'TITech security configuration validation failed.',

                environment,

                component:
                    COMPONENT,

                code:
                    'TITECH_SECURITY_CONFIGURATION_INVALID',
            },
        );
    }

    return deepFreeze(
        result,
    );
}

/**
 * =============================================================================
 * Safe diagnostics
 * =============================================================================
 */

function sanitizeDiagnostics(
    diagnostics,
    options,
) {

    const result =
        clone(
            diagnostics,
        );

    /**
     * Explicitly remove credential values if a future diagnostic extension adds
     * them accidentally.
     */
    const sensitiveSections = [
        'secrets',
        'encryption',
        'csrf',
    ];

    for (
        const section of
        sensitiveSections
    ) {

        if (
            !result[
                section
            ]
        ) {

            continue;
        }

        for (
            const key of
            Object.keys(
                result[
                    section
                ],
            )
        ) {

            if (
                isSensitiveKey(
                    key,
                    options,
                )
            ) {

                result[
                    section
                ][key] =
                    '[REDACTED]';
            }
        }
    }

    return result;
}

/**
 * =============================================================================
 * SecurityValidator class
 * =============================================================================
 */

class SecurityValidator {

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
                validateSecurityConfiguration(
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
                        result.environment,

                    status:
                        result.status,

                    totalErrors:
                        result.summary
                            .total,
                },
                result.valid
                    ? 'TITech security configuration validation completed.'
                    : 'TITech security configuration validation failed.',
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
     * Validate current process environment.
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
                    SECURITY_MODES
                        .PRODUCTION,

                requireHttpsInProduction:
                    true,

                requireTlsInProduction:
                    true,

                requireSecureCookiesInProduction:
                    true,

                requireHttpOnlyCookiesInProduction:
                    true,

                requireSameSiteCookiesInProduction:
                    true,

                requireExplicitCorsProduction:
                    true,

                requireCsrfProtectionForCookieAuth:
                    true,

                requireRateLimitingInProduction:
                    true,

                requireSecurityHeadersInProduction:
                    true,

                requireHelmetInProduction:
                    true,

                requireHstsInProduction:
                    true,

                requirePasswordHashing:
                    true,

                requireStrongPasswordHash:
                    true,

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
                    SECURITY_MODES
                        .STAGING,

                requireRateLimitingInProduction:
                    false,

                failClosed:
                    options.failClosed ??
                    true,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Non-throwing validation.
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
                            this.lastError.name,

                        code:
                            this.lastError.code,

                        message:
                            this.lastError.message,
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

const securityValidator =
    new SecurityValidator();

/**
 * =============================================================================
 * Convenience API
 * =============================================================================
 */

function validate(
    config,
    options,
) {

    return securityValidator.validate(
        config,
        options,
    );
}

function validateEnvironment(
    options,
) {

    return securityValidator
        .validateEnvironment(
            options,
        );
}

function validateProduction(
    config,
    options,
) {

    return securityValidator
        .validateProduction(
            config,
            options,
        );
}

function validateStaging(
    config,
    options,
) {

    return securityValidator
        .validateStaging(
            config,
            options,
        );
}

function check(
    config,
    options,
) {

    return securityValidator.check(
        config,
        options,
    );
}

function snapshot() {

    return securityValidator.snapshot();
}

function readiness() {

    return securityValidator.readiness();
}

function health() {

    return securityValidator.health();
}

function reset() {

    return securityValidator.reset();
}

/**
 * =============================================================================
 * Public API
 * =============================================================================
 */

module.exports =
    Object.freeze({
        /**
         * Singleton/class.
         */
        securityValidator,

        SecurityValidator,

        SecurityValidatorError,

        /**
         * Constants.
         */
        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        SECURITY_MODES,

        PASSWORD_HASH_ALGORITHMS,

        ENCRYPTION_ALGORITHMS,

        HMAC_ALGORITHMS,

        SECURITY_HEADER_POLICIES,

        DEFAULTS,

        /**
         * Validation.
         */
        validate,

        validateEnvironment,

        validateProduction,

        validateStaging,

        check,

        validateSecurityConfiguration,

        /**
         * URL/origin helpers.
         */
        parseUrl,

        isHttpsUrl,

        isHttpUrl,

        isWildcardOrigin,

        normalizeOrigins,

        validateOrigin,

        /**
         * Diagnostics.
         */
        snapshot,

        readiness,

        health,

        reset,

        /**
         * Fingerprinting.
         */
        fingerprint,
    });