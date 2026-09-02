'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/environment/validation/jwtValidator.js
 *
 * Purpose:
 *   Enterprise production-grade JWT/security configuration validator.
 *
 * Responsibilities:
 *   - Validate TITech JWT configuration before authentication startup.
 *   - Validate signing algorithm policy.
 *   - Validate issuer, audience and subject configuration.
 *   - Validate access-token and refresh-token lifetimes.
 *   - Validate signing secret/key requirements.
 *   - Validate asymmetric key configuration when applicable.
 *   - Validate symmetric-secret strength.
 *   - Validate clock tolerance and token-issuance settings.
 *   - Detect conflicting JWT configuration.
 *   - Enforce production security policy.
 *   - Safely validate key material without exposing secrets.
 *   - Produce deterministic, credential-safe diagnostics.
 *   - Integrate with validationErrors.js.
 *   - Remain independent from JWT signing/verification execution.
 *
 * IMPORTANT:
 *
 *   This module VALIDATES JWT CONFIGURATION.
 *
 *   It does NOT:
 *     - sign JWTs.
 *     - verify JWTs.
 *     - decode user tokens for authentication.
 *     - create authentication middleware.
 *     - mutate process.env.
 *     - load dotenv files.
 *     - merge configuration layers.
 *     - determine environment precedence.
 *     - persist refresh tokens.
 *     - access the database.
 *     - execute financial transactions.
 *
 * Runtime JWT implementation ownership remains with the authentication/security
 * subsystem, for example:
 *
 *   backend/services/auth/
 *   backend/middleware/authentication/
 *   backend/utils/jwt/
 *
 * =============================================================================
 *
 * Validation boundary:
 *
 *   process.env
 *       ↓
 *   environment normalization
 *       ↓
 *   jwtValidator.js
 *       ↓
 *   validationErrors.js
 *       ↓
 *   authentication bootstrap
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
    'environment-validation-jwt';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

const JWT_ALGORITHMS =
    Object.freeze({
        /**
         * Symmetric HMAC algorithms.
         */
        HS256:
            'HS256',

        HS384:
            'HS384',

        HS512:
            'HS512',

        /**
         * RSA PKCS#1 v1.5.
         */
        RS256:
            'RS256',

        RS384:
            'RS384',

        RS512:
            'RS512',

        /**
         * RSA-PSS.
         */
        PS256:
            'PS256',

        PS384:
            'PS384',

        PS512:
            'PS512',

        /**
         * Elliptic Curve.
         */
        ES256:
            'ES256',

        ES384:
            'ES384',

        ES512:
            'ES512',

        /**
         * EdDSA support depends on the JWT runtime/library.
         */
        EdDSA:
            'EdDSA',
    });

const JWT_ALGORITHM_FAMILIES =
    Object.freeze({
        HMAC:
            'hmac',

        RSA:
            'rsa',

        RSA_PSS:
            'rsa-pss',

        EC:
            'ec',

        EDDSA:
            'eddsa',
    });

const JWT_TOKEN_TYPES =
    Object.freeze({
        ACCESS:
            'access',

        REFRESH:
            'refresh',

        ID:
            'id',
    });

const DEFAULTS =
    Object.freeze({
        strict:
            true,

        failClosed:
            true,

        environment:
            process.env.NODE_ENV ||
            'development',

        defaultAlgorithm:
            'HS256',

        allowedAlgorithms:
            Object.freeze([
                'HS256',
                'HS384',
                'HS512',
                'RS256',
                'RS384',
                'RS512',
                'PS256',
                'PS384',
                'PS512',
                'ES256',
                'ES384',
                'ES512',
                'EdDSA',
            ]),

        forbiddenAlgorithms:
            Object.freeze([
                'none',
            ]),

        requireIssuerInProduction:
            true,

        requireAudienceInProduction:
            true,

        requireIssuer:
            false,

        requireAudience:
            false,

        requireSubject:
            false,

        requireJwtId:
            false,

        requireTokenType:
            false,

        requireAccessSecret:
            true,

        requireRefreshSecret:
            true,

        requireDistinctAccessAndRefreshSecrets:
            true,

        allowSharedSecret:
            false,

        minimumSymmetricSecretBytes:
            32,

        minimumSymmetricSecretLength:
            32,

        recommendedSymmetricSecretLength:
            64,

        minimumAsymmetricKeyBytes:
            2_048,

        minimumAccessTokenTtlSeconds:
            60,

        maximumAccessTokenTtlSeconds:
            86_400,

        minimumRefreshTokenTtlSeconds:
            300,

        maximumRefreshTokenTtlSeconds:
            2_592_000,

        minimumClockToleranceSeconds:
            0,

        maximumClockToleranceSeconds:
            300,

        defaultClockToleranceSeconds:
            30,

        maximumIssuedAtSkewSeconds:
            300,

        minimumNotBeforeDelaySeconds:
            0,

        maximumNotBeforeDelaySeconds:
            300,

        requireSecureProductionAlgorithm:
            true,

        requireHttpsIssuerInProduction:
            true,

        requireNonEmptyIssuer:
            true,

        requireNonEmptyAudience:
            true,

        allowLocalhostIssuer:
            true,

        allowPrivateIssuer:
            false,

        allowWildcardAudience:
            false,

        allowEmptyAudience:
            false,

        maxIssuerLength:
            512,

        maxAudienceLength:
            512,

        maxSubjectLength:
            256,

        maxKeyIdLength:
            256,

        maxSecretLength:
            16_384,

        maxDurationSeconds:
            31_536_000,

        includeRawValues:
            false,

        maxErrors:
            100,

        fingerprintAlgorithm:
            'sha256',

        sensitiveKeys:
            Object.freeze([
                'JWT_SECRET',
                'JWT_ACCESS_SECRET',
                'JWT_REFRESH_SECRET',
                'JWT_SIGNING_SECRET',
                'JWT_PRIVATE_KEY',
                'JWT_PUBLIC_KEY',
                'JWT_ACCESS_PRIVATE_KEY',
                'JWT_ACCESS_PUBLIC_KEY',
                'JWT_REFRESH_PRIVATE_KEY',
                'JWT_REFRESH_PUBLIC_KEY',
            ]),
    });

/**
 * =============================================================================
 * Error
 * =============================================================================
 */

class JwtValidatorError extends EnvironmentValidationError {

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
            'JwtValidatorError';
    }
}

/**
 * =============================================================================
 * Utility functions
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
            // Continue recursively.
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

        const result = {};

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

    const normalized =
        String(
            value,
        )
            .trim();

    return normalized ||
        null;
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

    const parsed =
        Number(
            value,
        );

    return Number.isFinite(
        parsed,
    )
        ? parsed
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

function maskSensitiveValue(
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
        // Fall through to hard redaction.
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
 * JWT algorithm helpers
 * =============================================================================
 */

function getAlgorithmFamily(
    algorithm,
) {

    const normalized =
        String(
            algorithm ||
            '',
        )
            .trim()
            .toUpperCase();

    if (
        /^HS(256|384|512)$/.test(
            normalized,
        )
    ) {

        return JWT_ALGORITHM_FAMILIES
            .HMAC;
    }

    if (
        /^RS(256|384|512)$/.test(
            normalized,
        )
    ) {

        return JWT_ALGORITHM_FAMILIES
            .RSA;
    }

    if (
        /^PS(256|384|512)$/.test(
            normalized,
        )
    ) {

        return JWT_ALGORITHM_FAMILIES
            .RSA_PSS;
    }

    if (
        /^ES(256|384|512)$/.test(
            normalized,
        )
    ) {

        return JWT_ALGORITHM_FAMILIES
            .EC;
    }

    if (
        normalized ===
        'EDDSA'
    ) {

        return JWT_ALGORITHM_FAMILIES
            .EDDSA;
    }

    return null;
}

function isSymmetricAlgorithm(
    algorithm,
) {

    return (
        getAlgorithmFamily(
            algorithm,
        ) ===
        JWT_ALGORITHM_FAMILIES
            .HMAC
    );
}

function isAsymmetricAlgorithm(
    algorithm,
) {

    return [
        JWT_ALGORITHM_FAMILIES
            .RSA,
        JWT_ALGORITHM_FAMILIES
            .RSA_PSS,
        JWT_ALGORITHM_FAMILIES
            .EC,
        JWT_ALGORITHM_FAMILIES
            .EDDSA,
    ].includes(
        getAlgorithmFamily(
            algorithm,
        ),
    );
}

function normalizeAlgorithm(
    algorithm,
    fallback,
) {

    return (
        normalizeString(
            algorithm,
        ) ||
        fallback
    )
        .toUpperCase();
}

/**
 * =============================================================================
 * JWT duration parser
 * =============================================================================
 *
 * Supports:
 *   900
 *   "900"
 *   "15m"
 *   "1h"
 *   "7d"
 *   "30s"
 *
 * =============================================================================
 */

function parseDurationSeconds(
    value,
) {

    if (
        value ===
            undefined ||
        value ===
            null ||
        value ===
            ''
    ) {

        return null;
    }

    if (
        typeof value ===
        'number'
    ) {

        return Number.isFinite(
            value,
        )
            ? value
            : null;
    }

    const text =
        String(
            value,
        )
            .trim()
            .toLowerCase();

    if (
        /^\d+(?:\.\d+)?$/.test(
            text,
        )
    ) {

        return Number(
            text,
        );
    }

    const match =
        text.match(
            /^(\d+(?:\.\d+)?)(ms|s|m|h|d|w)$/i,
        );

    if (
        !match
    ) {

        return null;
    }

    const amount =
        Number(
            match[1],
        );

    const multipliers = {
        ms:
            0.001,

        s:
            1,

        m:
            60,

        h:
            3_600,

        d:
            86_400,

        w:
            604_800,
    };

    return (
        amount *
        multipliers[
            match[2]
                .toLowerCase()
        ]
    );
}

/**
 * =============================================================================
 * Secret/key material helpers
 * =============================================================================
 */

function decodePem(
    value,
) {

    if (
        !isPresent(
            value,
        )
    ) {

        return null;
    }

    return String(
        value,
    )
        .replace(
            /\\n/g,
            '\n',
        )
        .trim();
}

function isPemPrivateKey(
    value,
) {

    return /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i.test(
        String(
            value ||
            '',
        ),
    );
}

function isPemPublicKey(
    value,
) {

    return /-----BEGIN (?:RSA |EC )?PUBLIC KEY-----/i.test(
        String(
            value ||
            '',
        ),
    );
}

function getKeyDetails(
    value,
    type,
) {

    const pem =
        decodePem(
            value,
        );

    if (
        !pem
    ) {

        return {
            valid:
                false,

            type,

            asymmetricKeyType:
                null,

            modulusLength:
                null,
        };
    }

    try {

        const key =
            type ===
                'private'
                ? crypto.createPrivateKey(
                    pem,
                )
                : crypto.createPublicKey(
                    pem,
                );

        const details =
            key.asymmetricKeyDetails ||
            {};

        return {
            valid:
                true,

            type,

            asymmetricKeyType:
                key.asymmetricKeyType ||
                null,

            modulusLength:
                details.modulusLength ||
                null,

            namedCurve:
                details.namedCurve ||
                null,
        };

    } catch (
        error
    ) {

        return {
            valid:
                false,

            type,

            asymmetricKeyType:
                null,

            modulusLength:
                null,

            error:
                error.message,
        };
    }
}

function validateSymmetricSecret(
    secret,
    variable,
    collection,
    options,
) {

    if (
        !isPresent(
            secret,
        )
    ) {

        return;
    }

    const text =
        String(
            secret,
        );

    const byteLength =
        Buffer.byteLength(
            text,
            'utf8',
        );

    if (
        text.length <
        options.minimumSymmetricSecretLength
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
                        .ERROR,

            variable,

            environment:
                options.environment,

            expected:
                {
                    minimumCharacters:
                        options
                            .minimumSymmetricSecretLength,
                },

            message:
                `TITech ${variable} is shorter than the minimum configured symmetric JWT secret length.`,
        });
    }

    if (
        byteLength <
        options.minimumSymmetricSecretBytes
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

            expected:
                {
                    minimumBytes:
                        options
                            .minimumSymmetricSecretBytes,
                },

            message:
                `TITech ${variable} does not meet the recommended UTF-8 byte-length requirement for a symmetric JWT signing secret.`,
        });
    }

    /**
     * Warn about obvious low-entropy secrets.
     *
     * This is intentionally heuristic. It does not attempt to calculate
     * cryptographic entropy.
     */
    const normalized =
        text
            .toLowerCase();

    const weakPatterns = [
        'secret',
        'password',
        'changeme',
        'change-me',
        'titech',
        'jwt',
        'example',
        'test',
        'development',
        'default',
        '123456',
    ];

    const looksObvious =
        weakPatterns.some(
            pattern =>
                normalized ===
                    pattern ||
                normalized.includes(
                    pattern,
                ) &&
                normalized.length <
                    options
                        .recommendedSymmetricSecretLength,
        );

    if (
        looksObvious
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
                `TITech ${variable} appears to use a weak or placeholder secret.`,
        });
    }
}

function validateAsymmetricKeys(
    privateKey,
    publicKey,
    algorithm,
    collection,
    options,
) {

    const family =
        getAlgorithmFamily(
            algorithm,
        );

    if (
        !privateKey &&
        !publicKey
    ) {
        return {
            privateKeyValid:
                false,

            publicKeyValid:
                false,

            privateKeyDetails:
                null,

            publicKeyDetails:
                null,
        };
    }

    let privateDetails =
        null;

    let publicDetails =
        null;

    if (
        privateKey
    ) {

        privateDetails =
            getKeyDetails(
                privateKey,
                'private',
            );

        if (
            !privateDetails.valid
        ) {

            collection.addIssue({
                code:
                    VALIDATION_ERROR_CODES
                        .INVALID_FORMAT,

                category:
                    VALIDATION_CATEGORIES
                        .SECURITY,

                severity:
                    VALIDATION_SEVERITIES
                        .CRITICAL,

                variable:
                    'JWT_PRIVATE_KEY',

                environment:
                    options.environment,

                message:
                    'TITech JWT private key material is invalid or cannot be parsed.',
            });
        }
    }

    if (
        publicKey
    ) {

        publicDetails =
            getKeyDetails(
                publicKey,
                'public',
            );

        if (
            !publicDetails.valid
        ) {

            collection.addIssue({
                code:
                    VALIDATION_ERROR_CODES
                        .INVALID_FORMAT,

                category:
                    VALIDATION_CATEGORIES
                        .SECURITY,

                severity:
                    VALIDATION_SEVERITIES
                        .CRITICAL,

                variable:
                    'JWT_PUBLIC_KEY',

                environment:
                    options.environment,

                message:
                    'TITech JWT public key material is invalid or cannot be parsed.',
            });
        }
    }

    /**
     * RSA/PS algorithms require RSA-family key material.
     */
    if (
        [
            JWT_ALGORITHM_FAMILIES.RSA,
            JWT_ALGORITHM_FAMILIES.RSA_PSS,
        ].includes(
            family,
        )
    ) {

        for (
            const [
                name,
                details,
            ] of [
                [
                    'JWT_PRIVATE_KEY',
                    privateDetails,
                ],
                [
                    'JWT_PUBLIC_KEY',
                    publicDetails,
                ],
            ]
        ) {

            if (
                details?.valid &&
                details.asymmetricKeyType !==
                    'rsa'
            ) {

                collection.addIssue({
                    code:
                        VALIDATION_ERROR_CODES
                            .CONFIGURATION_INCONSISTENT,

                    category:
                        VALIDATION_CATEGORIES
                            .SECURITY,

                    severity:
                        VALIDATION_SEVERITIES
                            .CRITICAL,

                    variable:
                        name,

                    environment:
                        options.environment,

                    message:
                        `TITech ${name} must contain an RSA key for algorithm ${algorithm}.`,
                });
            }

            if (
                details?.valid &&
                details.modulusLength &&
                details.modulusLength <
                    options.minimumAsymmetricKeyBytes
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
                        name,

                    environment:
                        options.environment,

                    expected:
                        {
                            minimumRsaBits:
                                options
                                    .minimumAsymmetricKeyBytes,
                        },

                    message:
                        `TITech ${name} does not meet the minimum RSA key strength policy.`,
                });
            }
        }
    }

    /**
     * EC algorithms.
     */
    if (
        family ===
        JWT_ALGORITHM_FAMILIES.EC
    ) {

        const requiredCurves = {
            ES256:
                'prime256v1',

            ES384:
                'secp384r1',

            ES512:
                'secp521r1',
        };

        const requiredCurve =
            requiredCurves[
                algorithm
            ];

        for (
            const [
                name,
                details,
            ] of [
                [
                    'JWT_PRIVATE_KEY',
                    privateDetails,
                ],
                [
                    'JWT_PUBLIC_KEY',
                    publicDetails,
                ],
            ]
        ) {

            if (
                details?.valid &&
                details.asymmetricKeyType !==
                    'ec'
            ) {

                collection.addIssue({
                    code:
                        VALIDATION_ERROR_CODES
                            .CONFIGURATION_INCONSISTENT,

                    category:
                        VALIDATION_CATEGORIES
                            .SECURITY,

                    severity:
                        VALIDATION_SEVERITIES
                            .CRITICAL,

                    variable:
                        name,

                    environment:
                        options.environment,

                    message:
                        `TITech ${name} must contain an EC key for algorithm ${algorithm}.`,
                });
            }

            if (
                requiredCurve &&
                details?.valid &&
                details.namedCurve &&
                details.namedCurve !==
                    requiredCurve
            ) {

                collection.addIssue({
                    code:
                        VALIDATION_ERROR_CODES
                            .CONFIGURATION_INCONSISTENT,

                    category:
                        VALIDATION_CATEGORIES
                            .SECURITY,

                    severity:
                        VALIDATION_SEVERITIES
                            .CRITICAL,

                    variable:
                        name,

                    environment:
                        options.environment,

                    expected:
                        requiredCurve,

                    actual:
                        details.namedCurve,

                    message:
                        `TITech ${name} uses an incompatible EC curve for algorithm ${algorithm}.`,
                });
            }
        }
    }

    return {
        privateKeyValid:
            Boolean(
                privateDetails?.valid,
            ),

        publicKeyValid:
            Boolean(
                publicDetails?.valid,
            ),

        privateKeyDetails:
            privateDetails
                ? {
                    valid:
                        privateDetails.valid,

                    asymmetricKeyType:
                        privateDetails
                            .asymmetricKeyType,

                    modulusLength:
                        privateDetails
                            .modulusLength,

                    namedCurve:
                        privateDetails
                            .namedCurve,
                }
                : null,

        publicKeyDetails:
            publicDetails
                ? {
                    valid:
                        publicDetails.valid,

                    asymmetricKeyType:
                        publicDetails
                            .asymmetricKeyType,

                    modulusLength:
                        publicDetails
                            .modulusLength,

                    namedCurve:
                        publicDetails
                            .namedCurve,
                }
                : null,
    };
}

/**
 * =============================================================================
 * Required-claim validation
 * =============================================================================
 */

function validateClaim(
    variable,
    value,
    optionsObject,
    collection,
    category,
    environment,
) {

    const required =
        optionsObject.required;

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

            category,

            severity:
                environment ===
                    'production'
                    ? VALIDATION_SEVERITIES
                        .CRITICAL
                    : VALIDATION_SEVERITIES
                        .ERROR,

            variable,

            environment,

            message:
                `TITech JWT configuration requires ${variable}.`,
        });

        return false;
    }

    if (
        isPresent(
            value,
        ) &&
        optionsObject.maxLength &&
        String(
            value,
        ).length >
            optionsObject.maxLength
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .INVALID_RANGE,

            category,

            severity:
                VALIDATION_SEVERITIES
                    .ERROR,

            variable,

            environment,

            expected:
                {
                    maxLength:
                        optionsObject.maxLength,
                },

            message:
                `TITech JWT ${variable} exceeds the configured length limit.`,
        });

        return false;
    }

    return true;
}

/**
 * =============================================================================
 * Issuer validation
 * =============================================================================
 */

function validateIssuer(
    issuer,
    collection,
    options,
) {

    const normalized =
        normalizeString(
            issuer,
        );

    const required =
        Boolean(
            options.requireIssuer ||
            (
                options.environment ===
                'production' &&
                options.requireIssuerInProduction
            ),
        );

    validateClaim(
        'JWT_ISSUER',
        normalized,
        {
            required,

            maxLength:
                options.maxIssuerLength,
        },
        collection,
        VALIDATION_CATEGORIES
            .SECURITY,
        options.environment,
    );

    if (
        !normalized
    ) {

        return;
    }

    if (
        options.requireHttpsIssuerInProduction &&
        options.environment ===
            'production'
    ) {

        try {

            const parsed =
                new URL(
                    normalized,
                );

            if (
                parsed.protocol !==
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

                    variable:
                        'JWT_ISSUER',

                    environment:
                        options.environment,

                    message:
                        'TITech production JWT issuer must use HTTPS.',
                });
            }

            if (
                parsed.hostname ===
                    'localhost' ||
                parsed.hostname ===
                    '127.0.0.1'
            ) {

                if (
                    !options.allowLocalhostIssuer
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
                            'JWT_ISSUER',

                        environment:
                            options.environment,

                        message:
                            'TITech production JWT issuer cannot point to localhost.',
                    });
                }
            }

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
                        .ERROR,

                variable:
                    'JWT_ISSUER',

                environment:
                    options.environment,

                message:
                    'TITech JWT issuer must be a valid absolute URI.',
            });
        }
    }

    if (
        options.requireNonEmptyIssuer &&
        normalized ===
            ''
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .INVALID_VALUE,

            category:
                VALIDATION_CATEGORIES
                    .SECURITY,

            severity:
                VALIDATION_SEVERITIES
                    .ERROR,

            variable:
                'JWT_ISSUER',

            message:
                'TITech JWT issuer cannot be empty.',
        });
    }
}

/**
 * =============================================================================
 * Audience validation
 * =============================================================================
 */

function normalizeAudience(
    audience,
) {

    if (
        Array.isArray(
            audience,
        )
    ) {

        return audience
            .map(
                value =>
                    normalizeString(
                        value,
                    ),
            )
            .filter(Boolean);
    }

    const value =
        normalizeString(
            audience,
        );

    if (
        !value
    ) {

        return [];
    }

    return [
        value,
    ];
}

function validateAudience(
    audience,
    collection,
    options,
) {

    const normalized =
        normalizeAudience(
            audience,
        );

    const required =
        Boolean(
            options.requireAudience ||
            (
                options.environment ===
                    'production' &&
                options.requireAudienceInProduction
            ),
        );

    if (
        required &&
        normalized.length ===
        0
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .REQUIRED_VARIABLE_MISSING,

            category:
                VALIDATION_CATEGORIES
                    .SECURITY,

            severity:
                options.environment ===
                    'production'
                    ? VALIDATION_SEVERITIES
                        .CRITICAL
                    : VALIDATION_SEVERITIES
                        .ERROR,

            variable:
                'JWT_AUDIENCE',

            environment:
                options.environment,

            message:
                'TITech production JWT audience configuration is required.',
        });

        return;
    }

    for (
        const value of
        normalized
    ) {

        if (
            value.length >
            options.maxAudienceLength
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
                    'JWT_AUDIENCE',

                environment:
                    options.environment,

                message:
                    'TITech JWT audience value exceeds the configured length limit.',
            });
        }

        if (
            !options.allowWildcardAudience &&
            (
                value.includes('*') ||
                value.includes('?')
            )
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
                    'JWT_AUDIENCE',

                environment:
                    options.environment,

                message:
                    'TITech JWT audience must not use wildcard matching.',
            });
        }
    }
}

/**
 * =============================================================================
 * Lifetime validation
 * =============================================================================
 */

function validateLifetime(
    variable,
    value,
    minimum,
    maximum,
    collection,
    options,
    category =
        VALIDATION_CATEGORIES
            .SECURITY,
) {

    const seconds =
        parseDurationSeconds(
            value,
        );

    if (
        seconds ===
        null
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .INVALID_FORMAT,

            category,

            severity:
                VALIDATION_SEVERITIES
                    .ERROR,

            variable,

            environment:
                options.environment,

            expected:
                'duration in seconds or duration string such as 15m, 1h or 7d',

            message:
                `TITech ${variable} contains an invalid JWT duration.`,
        });

        return null;
    }

    if (
        seconds <
            minimum ||
        seconds >
            maximum
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .INVALID_RANGE,

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

            expected:
                {
                    minSeconds:
                        minimum,

                    maxSeconds:
                        maximum,
                },

            actual:
                seconds,

            message:
                `TITech ${variable} is outside the permitted lifetime range.`,
        });
    }

    return seconds;
}

/**
 * =============================================================================
 * Complete configuration validator
 * =============================================================================
 */

function validateJwtConfiguration(
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
     * Resolve algorithm.
     * -------------------------------------------------------------------------
     */

    const algorithm =
        normalizeAlgorithm(
            config.JWT_ALGORITHM ||
            config.JWT_SIGN_ALGORITHM,
            normalizedOptions
                .defaultAlgorithm,
        );

    diagnostics.algorithm =
        algorithm;

    const allowedAlgorithms =
        (
            normalizedOptions
                .allowedAlgorithms ||
            []
        ).map(
            value =>
                String(
                    value,
                )
                    .trim()
                    .toUpperCase(),
        );

    const forbiddenAlgorithms =
        (
            normalizedOptions
                .forbiddenAlgorithms ||
            []
        ).map(
            value =>
                String(
                    value,
                )
                    .trim()
                    .toUpperCase(),
        );

    if (
        forbiddenAlgorithms.includes(
            algorithm,
        )
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
                'JWT_ALGORITHM',

            environment,

            message:
                `TITech JWT algorithm "${algorithm}" is explicitly forbidden.`,
        });

    } else if (
        !allowedAlgorithms.includes(
            algorithm,
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
                'JWT_ALGORITHM',

            environment,

            expected:
                allowedAlgorithms,

            actual:
                algorithm,

            message:
                `TITech JWT algorithm "${algorithm}" is not in the approved algorithm allow-list.`,
        });
    }

    const family =
        getAlgorithmFamily(
            algorithm,
        );

    if (
        !family
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
                'JWT_ALGORITHM',

            environment,

            message:
                'TITech JWT algorithm family could not be determined.',
        });
    }

    diagnostics.algorithmFamily =
        family;

    /**
     * -------------------------------------------------------------------------
     * Access / refresh lifetime.
     * -------------------------------------------------------------------------
     */

    const accessTokenTtl =
        parseDurationSeconds(
            config.JWT_ACCESS_TOKEN_EXPIRES_IN ||
            config.JWT_EXPIRES_IN ||
            config.JWT_ACCESS_TTL,
        );

    const refreshTokenTtl =
        parseDurationSeconds(
            config.JWT_REFRESH_TOKEN_EXPIRES_IN ||
            config.JWT_REFRESH_EXPIRES_IN ||
            config.JWT_REFRESH_TTL,
        );

    if (
        isPresent(
            config.JWT_ACCESS_TOKEN_EXPIRES_IN ||
            config.JWT_EXPIRES_IN ||
            config.JWT_ACCESS_TTL,
        )
    ) {

        validateLifetime(
            'JWT_ACCESS_TOKEN_EXPIRES_IN',
            config.JWT_ACCESS_TOKEN_EXPIRES_IN ||
                config.JWT_EXPIRES_IN ||
                config.JWT_ACCESS_TTL,
            normalizedOptions
                .minimumAccessTokenTtlSeconds,
            normalizedOptions
                .maximumAccessTokenTtlSeconds,
            collection,
            normalizedOptions,
        );

    } else if (
        environment ===
            'production'
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .REQUIRED_VARIABLE_MISSING,

            category:
                VALIDATION_CATEGORIES
                    .REQUIRED,

            severity:
                VALIDATION_SEVERITIES
                    .ERROR,

            variable:
                'JWT_ACCESS_TOKEN_EXPIRES_IN',

            environment,

            message:
                'TITech production access-token lifetime configuration is required.',
        });
    }

    if (
        isPresent(
            config.JWT_REFRESH_TOKEN_EXPIRES_IN ||
            config.JWT_REFRESH_EXPIRES_IN ||
            config.JWT_REFRESH_TTL,
        )
    ) {

        validateLifetime(
            'JWT_REFRESH_TOKEN_EXPIRES_IN',
            config.JWT_REFRESH_TOKEN_EXPIRES_IN ||
                config.JWT_REFRESH_EXPIRES_IN ||
                config.JWT_REFRESH_TTL,
            normalizedOptions
                .minimumRefreshTokenTtlSeconds,
            normalizedOptions
                .maximumRefreshTokenTtlSeconds,
            collection,
            normalizedOptions,
        );

    } else if (
        normalizedOptions
            .requireRefreshSecret &&
        environment ===
            'production'
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .REQUIRED_VARIABLE_MISSING,

            category:
                VALIDATION_CATEGORIES
                    .REQUIRED,

            severity:
                VALIDATION_SEVERITIES
                    .ERROR,

            variable:
                'JWT_REFRESH_TOKEN_EXPIRES_IN',

            environment,

            message:
                'TITech production refresh-token lifetime configuration is required.',
        });
    }

    diagnostics.lifetimes =
        {
            accessTokenSeconds:
                accessTokenTtl,

            refreshTokenSeconds:
                refreshTokenTtl,
        };

    if (
        accessTokenTtl !==
            null &&
        refreshTokenTtl !==
            null &&
        refreshTokenTtl <=
            accessTokenTtl
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .CONFIGURATION_INCONSISTENT,

            category:
                VALIDATION_CATEGORIES
                    .SECURITY,

            severity:
                VALIDATION_SEVERITIES
                    .ERROR,

            variable:
                'JWT_REFRESH_TOKEN_EXPIRES_IN',

            environment,

            expected:
                {
                    greaterThanAccessToken:
                        accessTokenTtl,
                },

            actual:
                refreshTokenTtl,

            message:
                'TITech refresh-token lifetime must exceed access-token lifetime.',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Required claims.
     * -------------------------------------------------------------------------
     */

    const issuer =
        normalizeString(
            config.JWT_ISSUER ||
            config.JWT_ISS ||
            config.TOKEN_ISSUER,
        );

    const audience =
        config.JWT_AUDIENCE ||
        config.JWT_AUD ||
        config.TOKEN_AUDIENCE;

    const subject =
        normalizeString(
            config.JWT_SUBJECT,
        );

    validateIssuer(
        issuer,
        collection,
        normalizedOptions,
    );

    validateAudience(
        audience,
        collection,
        normalizedOptions,
    );

    if (
        normalizedOptions.requireSubject &&
        !isPresent(
            subject,
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
                environment ===
                    'production'
                    ? VALIDATION_SEVERITIES
                        .CRITICAL
                    : VALIDATION_SEVERITIES
                        .ERROR,

            variable:
                'JWT_SUBJECT',

            environment,

            message:
                'TITech JWT subject configuration is required.',
        });
    }

    if (
        subject &&
        subject.length >
            normalizedOptions
                .maxSubjectLength
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
                'JWT_SUBJECT',

            environment,

            message:
                'TITech JWT subject exceeds the configured maximum length.',
        });
    }

    diagnostics.claims =
        {
            issuer:
                issuer ||
                null,

            audience:
                Array.isArray(
                    audience,
                )
                    ? audience.length
                    : isPresent(
                        audience,
                    )
                        ? 1
                        : 0,

            subject:
                subject ||
                null,
        };

    /**
     * -------------------------------------------------------------------------
     * Token metadata.
     * -------------------------------------------------------------------------
     */

    const keyId =
        normalizeString(
            config.JWT_KEY_ID ||
            config.JWT_KID,
        );

    const tokenType =
        normalizeString(
            config.JWT_TOKEN_TYPE,
        );

    if (
        keyId &&
        keyId.length >
            normalizedOptions
                .maxKeyIdLength
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
                'JWT_KEY_ID',

            message:
                'TITech JWT key identifier exceeds the configured maximum length.',
        });
    }

    if (
        normalizedOptions.requireTokenType &&
        !tokenType
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .REQUIRED_VARIABLE_MISSING,

            category:
                VALIDATION_CATEGORIES
                    .REQUIRED,

            severity:
                VALIDATION_SEVERITIES
                    .ERROR,

            variable:
                'JWT_TOKEN_TYPE',

            environment,

            message:
                'TITech JWT token-type configuration is required.',
        });
    }

    if (
        tokenType &&
        ![
            JWT_TOKEN_TYPES.ACCESS,
            JWT_TOKEN_TYPES.REFRESH,
            JWT_TOKEN_TYPES.ID,
        ].includes(
            tokenType
                .toLowerCase(),
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
                'JWT_TOKEN_TYPE',

            expected:
                Object.values(
                    JWT_TOKEN_TYPES,
                ),

            actual:
                tokenType,

            message:
                'TITech JWT_TOKEN_TYPE contains an unsupported value.',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Clock tolerance.
     * -------------------------------------------------------------------------
     */

    const clockTolerance =
        normalizeInteger(
            config.JWT_CLOCK_TOLERANCE_SECONDS ||
            config.JWT_CLOCK_TOLERANCE,
            normalizedOptions
                .defaultClockToleranceSeconds,
        );

    if (
        clockTolerance ===
            null ||
        clockTolerance <
            normalizedOptions
                .minimumClockToleranceSeconds ||
        clockTolerance >
            normalizedOptions
                .maximumClockToleranceSeconds
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
                'JWT_CLOCK_TOLERANCE_SECONDS',

            environment,

            expected:
                {
                    min:
                        normalizedOptions
                            .minimumClockToleranceSeconds,

                    max:
                        normalizedOptions
                            .maximumClockToleranceSeconds,
                },

            actual:
                config.JWT_CLOCK_TOLERANCE_SECONDS,

            message:
                'TITech JWT clock tolerance is outside the supported range.',
        });
    }

    diagnostics.clockToleranceSeconds =
        clockTolerance;

    /**
     * -------------------------------------------------------------------------
     * Symmetric signing policy.
     * -------------------------------------------------------------------------
     */

    const accessSecret =
        normalizeString(
            config.JWT_ACCESS_SECRET ||
            config.JWT_SECRET ||
            config.JWT_SIGNING_SECRET,
        );

    const refreshSecret =
        normalizeString(
            config.JWT_REFRESH_SECRET ||
            config.JWT_SECRET,
        );

    const distinctSecrets =
        accessSecret &&
        refreshSecret &&
        accessSecret !==
            refreshSecret;

    diagnostics.secrets =
        {
            accessConfigured:
                Boolean(
                    accessSecret,
                ),

            refreshConfigured:
                Boolean(
                    refreshSecret,
                ),

            distinct:
                Boolean(
                    distinctSecrets,
                ),
        };

    if (
        isSymmetricAlgorithm(
            algorithm,
        )
    ) {

        if (
            normalizedOptions
                .requireAccessSecret &&
            !accessSecret
        ) {

            collection.addIssue({
                code:
                    VALIDATION_ERROR_CODES
                        .REQUIRED_VARIABLE_MISSING,

                category:
                    VALIDATION_CATEGORIES
                        .REQUIRED,

                severity:
                    environment ===
                        'production'
                        ? VALIDATION_SEVERITIES
                            .CRITICAL
                        : VALIDATION_SEVERITIES
                            .ERROR,

                variable:
                    'JWT_ACCESS_SECRET',

                environment,

                message:
                    'TITech HMAC JWT configuration requires an access-token signing secret.',
            });

        } else if (
            accessSecret
        ) {

            validateSymmetricSecret(
                accessSecret,
                config.JWT_ACCESS_SECRET
                    ? 'JWT_ACCESS_SECRET'
                    : 'JWT_SECRET',
                collection,
                normalizedOptions,
            );
        }

        if (
            normalizedOptions
                .requireRefreshSecret &&
            !refreshSecret
        ) {

            collection.addIssue({
                code:
                    VALIDATION_ERROR_CODES
                        .REQUIRED_VARIABLE_MISSING,

                category:
                    VALIDATION_CATEGORIES
                        .REQUIRED,

                severity:
                    environment ===
                        'production'
                        ? VALIDATION_SEVERITIES
                            .CRITICAL
                        : VALIDATION_SEVERITIES
                            .ERROR,

                variable:
                    'JWT_REFRESH_SECRET',

                environment,

                message:
                    'TITech HMAC JWT configuration requires a refresh-token signing secret.',
            });

        } else if (
            refreshSecret
        ) {

            validateSymmetricSecret(
                refreshSecret,
                config.JWT_REFRESH_SECRET
                    ? 'JWT_REFRESH_SECRET'
                    : 'JWT_SECRET',
                collection,
                normalizedOptions,
            );
        }

        if (
            normalizedOptions
                .requireDistinctAccessAndRefreshSecrets &&
            accessSecret &&
            refreshSecret &&
            accessSecret ===
                refreshSecret &&
            !normalizedOptions
                .allowSharedSecret
        ) {

            collection.addIssue({
                code:
                    VALIDATION_ERROR_CODES
                        .SECURITY_POLICY_VIOLATION,

                category:
                    VALIDATION_CATEGORIES
                        .SECURITY,

                severity:
                    environment ===
                        'production'
                        ? VALIDATION_SEVERITIES
                            .CRITICAL
                        : VALIDATION_SEVERITIES
                            .ERROR,

                variable:
                    'JWT_REFRESH_SECRET',

                environment,

                message:
                    'TITech access and refresh JWT tokens must use distinct signing secrets unless shared-secret operation is explicitly approved.',
            });
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Asymmetric signing policy.
     * -------------------------------------------------------------------------
     */

    const privateKey =
        decodePem(
            config.JWT_PRIVATE_KEY ||
            config.JWT_ACCESS_PRIVATE_KEY,
        );

    const publicKey =
        decodePem(
            config.JWT_PUBLIC_KEY ||
            config.JWT_ACCESS_PUBLIC_KEY,
        );

    const refreshPrivateKey =
        decodePem(
            config.JWT_REFRESH_PRIVATE_KEY,
        );

    const refreshPublicKey =
        decodePem(
            config.JWT_REFRESH_PUBLIC_KEY,
        );

    if (
        isAsymmetricAlgorithm(
            algorithm,
        )
    ) {

        if (
            !privateKey
        ) {

            collection.addIssue({
                code:
                    VALIDATION_ERROR_CODES
                        .REQUIRED_VARIABLE_MISSING,

                category:
                    VALIDATION_CATEGORIES
                        .REQUIRED,

                severity:
                    environment ===
                        'production'
                        ? VALIDATION_SEVERITIES
                            .CRITICAL
                        : VALIDATION_SEVERITIES
                            .ERROR,

                variable:
                    'JWT_PRIVATE_KEY',

                environment,

                message:
                    `TITech ${algorithm} JWT configuration requires a private signing key.`,
            });

        }

        if (
            !publicKey
        ) {

            collection.addIssue({
                code:
                    VALIDATION_ERROR_CODES
                        .REQUIRED_VARIABLE_MISSING,

                category:
                    VALIDATION_CATEGORIES
                        .REQUIRED,

                severity:
                    environment ===
                        'production'
                        ? VALIDATION_SEVERITIES
                            .CRITICAL
                        : VALIDATION_SEVERITIES
                            .ERROR,

                variable:
                    'JWT_PUBLIC_KEY',

                environment,

                message:
                    `TITech ${algorithm} JWT configuration requires a public verification key.`,
            });

        }

        diagnostics.keys =
            validateAsymmetricKeys(
                privateKey,
                publicKey,
                algorithm,
                collection,
                normalizedOptions,
            );
    }

    /**
     * -------------------------------------------------------------------------
     * Refresh asymmetric key validation.
     * -------------------------------------------------------------------------
     */

    if (
        refreshPrivateKey ||
        refreshPublicKey
    ) {

        diagnostics.refreshKeys =
            validateAsymmetricKeys(
                refreshPrivateKey,
                refreshPublicKey,
                algorithm,
                collection,
                normalizedOptions,
            );
    }

    /**
     * -------------------------------------------------------------------------
     * Key ID requirement.
     * -------------------------------------------------------------------------
     */

    const requireKeyId =
        Boolean(
            config.JWT_REQUIRE_KID ||
            (
                environment ===
                    'production' &&
                toBoolean(
                    config.JWT_KEY_ROTATION_ENABLED,
                    false,
                )
            ),
        );

    if (
        requireKeyId &&
        !keyId
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .REQUIRED_VARIABLE_MISSING,

            category:
                VALIDATION_CATEGORIES
                    .REQUIRED,

            severity:
                environment ===
                    'production'
                    ? VALIDATION_SEVERITIES
                        .CRITICAL
                    : VALIDATION_SEVERITIES
                        .ERROR,

            variable:
                'JWT_KEY_ID',

            environment,

            message:
                'TITech JWT key rotation requires a key identifier (kid).',
        });
    }

    diagnostics.keyIdConfigured =
        Boolean(
            keyId,
        );

    /**
     * -------------------------------------------------------------------------
     * Algorithm/secret conflict detection.
     * -------------------------------------------------------------------------
     */

    const asymmetricConfigured =
        Boolean(
            privateKey ||
            publicKey ||
            refreshPrivateKey ||
            refreshPublicKey,
        );

    if (
        isSymmetricAlgorithm(
            algorithm,
        ) &&
        asymmetricConfigured
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .CONFIGURATION_INCONSISTENT,

            category:
                VALIDATION_CATEGORIES
                    .SECURITY,

            severity:
                VALIDATION_SEVERITIES
                    .WARNING,

            variable:
                'JWT_ALGORITHM',

            environment,

            message:
                'TITech HMAC JWT configuration includes asymmetric key material; remove unused keys or select an asymmetric algorithm intentionally.',
        });
    }

    if (
        isAsymmetricAlgorithm(
            algorithm,
        ) &&
        accessSecret
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .CONFIGURATION_INCONSISTENT,

            category:
                VALIDATION_CATEGORIES
                    .SECURITY,

            severity:
                VALIDATION_SEVERITIES
                    .WARNING,

            variable:
                'JWT_ACCESS_SECRET',

            environment,

            message:
                `TITech ${algorithm} JWT configuration includes an HMAC secret that will not be used for asymmetric signing.`,
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Production algorithm policy.
     * -------------------------------------------------------------------------
     */

    if (
        normalizedOptions
            .requireSecureProductionAlgorithm &&
        environment ===
            'production'
    ) {

        const approvedProductionAlgorithms =
            [
                'HS256',
                'HS384',
                'HS512',
                'RS256',
                'RS384',
                'RS512',
                'PS256',
                'PS384',
                'PS512',
                'ES256',
                'ES384',
                'ES512',
                'EdDSA',
            ];

        if (
            !approvedProductionAlgorithms.includes(
                algorithm,
            )
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
                    'JWT_ALGORITHM',

                environment,

                message:
                    `TITech production JWT algorithm "${algorithm}" is not approved by the production security policy.`,
            });
        }
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
        sanitizeDiagnostics(
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

        algorithm,

        algorithmFamily:
            family,

        environment,

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

                    algorithm,

                    algorithmFamily:
                        family,

                    issuer:
                        issuer ||
                        null,

                    audience:
                        normalizeAudience(
                            audience,
                        ),

                    lifetimes:
                        {
                            access:
                                accessTokenTtl,

                            refresh:
                                refreshTokenTtl,
                        },

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
                    'TITech JWT/security configuration validation failed.',

                environment,

                component:
                    COMPONENT,

                code:
                    'TITECH_JWT_CONFIGURATION_INVALID',
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
) {

    const result =
        clone(
            diagnostics,
        );

    if (
        result.secrets
    ) {

        /**
         * Keep only boolean operational metadata.
         */
        result.secrets =
            {
                accessConfigured:
                    Boolean(
                        result.secrets
                            .accessConfigured,
                    ),

                refreshConfigured:
                    Boolean(
                        result.secrets
                            .refreshConfigured,
                    ),

                distinct:
                    Boolean(
                        result.secrets
                            .distinct,
                    ),
            };
    }

    if (
        result.keys
    ) {

        delete result.keys
            .privateKey;
        delete result.keys
            .publicKey;
    }

    return result;
}

/**
 * =============================================================================
 * JwtValidator class
 * =============================================================================
 */

class JwtValidator {

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
                validateJwtConfiguration(
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

                    algorithm:
                        result.algorithm,

                    status:
                        result.status,

                    errorCount:
                        result.summary
                            .total,
                },
                result.valid
                    ? 'TITech JWT configuration validation completed.'
                    : 'TITech JWT configuration validation failed.',
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
     * Validate process environment.
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

                requireIssuer:
                    true,

                requireAudience:
                    true,

                requireIssuerInProduction:
                    true,

                requireAudienceInProduction:
                    true,

                requireAccessSecret:
                    true,

                requireRefreshSecret:
                    true,

                requireDistinctAccessAndRefreshSecrets:
                    true,

                requireSecureProductionAlgorithm:
                    true,

                requireHttpsIssuerInProduction:
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
                    'staging',

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
     * Algorithm helper.
     * -------------------------------------------------------------------------
     */

    getAlgorithmFamily(
        algorithm,
    ) {

        return getAlgorithmFamily(
            algorithm,
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

const jwtValidator =
    new JwtValidator();

/**
 * =============================================================================
 * Convenience API
 * =============================================================================
 */

function validate(
    config,
    options,
) {

    return jwtValidator.validate(
        config,
        options,
    );
}

function validateEnvironment(
    options,
) {

    return jwtValidator.validateEnvironment(
        options,
    );
}

function validateProduction(
    config,
    options,
) {

    return jwtValidator.validateProduction(
        config,
        options,
    );
}

function validateStaging(
    config,
    options,
) {

    return jwtValidator.validateStaging(
        config,
        options,
    );
}

function check(
    config,
    options,
) {

    return jwtValidator.check(
        config,
        options,
    );
}

function getAlgorithmFamilyPublic(
    algorithm,
) {

    return getAlgorithmFamily(
        algorithm,
    );
}

function snapshot() {

    return jwtValidator.snapshot();
}

function readiness() {

    return jwtValidator.readiness();
}

function health() {

    return jwtValidator.health();
}

function reset() {

    return jwtValidator.reset();
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
        jwtValidator,

        JwtValidator,

        JwtValidatorError,

        /**
         * Constants.
         */
        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        JWT_ALGORITHMS,

        JWT_ALGORITHM_FAMILIES,

        JWT_TOKEN_TYPES,

        DEFAULTS,

        /**
         * Validation.
         */
        validate,

        validateEnvironment,

        validateProduction,

        validateStaging,

        check,

        validateJwtConfiguration,

        /**
         * Helpers.
         */
        getAlgorithmFamily:
            getAlgorithmFamilyPublic,

        isSymmetricAlgorithm,

        isAsymmetricAlgorithm,

        parseDurationSeconds,

        getKeyDetails,

        /**
         * Safe lifecycle/diagnostics.
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