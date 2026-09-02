'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/environment/secretMasker.js
 *
 * Purpose:
 *   Enterprise production-grade secret/sensitive-data masking engine for the
 *   TITech environment and configuration subsystem.
 *
 * Responsibilities:
 *   - Detect sensitive environment/configuration keys.
 *   - Redact secrets from diagnostics and operational snapshots.
 *   - Mask credentials embedded inside URLs.
 *   - Mask authorization headers and bearer tokens.
 *   - Recursively sanitize objects and arrays.
 *   - Support configurable secret-key patterns.
 *   - Support exact key and path policies.
 *   - Preserve non-sensitive operational information where safe.
 *   - Prevent accidental secret leakage through Error objects.
 *   - Prevent secret leakage through configuration fingerprints.
 *   - Provide deterministic masking for logs, diagnostics and snapshots.
 *   - Support allow-listed values that are explicitly safe to expose.
 *   - Detect common credential formats without attempting to decrypt them.
 *
 * IMPORTANT:
 *
 *   This module is a SECURITY SANITIZATION BOUNDARY.
 *
 *   It does NOT:
 *     - load environment files.
 *     - mutate process.env.
 *     - store secrets.
 *     - decrypt secrets.
 *     - rotate secrets.
 *     - fetch secrets from a secret manager.
 *     - authenticate users.
 *     - authorize tenants.
 *     - connect to MongoDB.
 *     - connect to Redis.
 *     - execute financial transactions.
 *
 * Related modules:
 *
 *   backend/config/environment.js
 *   backend/config/environment/layerMerger.js
 *   backend/config/environment/namespaceBuilder.js
 *   backend/config/environment/normalizeEnvironment.js
 *   backend/config/environment/precedenceRules.js
 *   backend/config/environment/requiredVariables.js
 *   backend/config/environment/environmentValidator.js
 *   backend/config/environment/environmentSnapshot.js
 *
 * =============================================================================
 */

const crypto =
    require('node:crypto');

const util =
    require('node:util');

/**
 * =============================================================================
 * Optional logger
 * =============================================================================
 */

let loggerModule = null;

try {
    // eslint-disable-next-line global-require
    loggerModule =
        require('../../utils/logger');
} catch {
    loggerModule = null;
}

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const COMPONENT =
    'environment-secret-masker';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

const MASKING_MODES =
    Object.freeze({
        REDACT:
            'redact',

        MASK:
            'mask',

        HASH:
            'hash',

        PRESERVE:
            'preserve',
    });

const VALUE_TYPES =
    Object.freeze({
        STRING:
            'string',

        OBJECT:
            'object',

        ARRAY:
            'array',

        ERROR:
            'error',

        BUFFER:
            'buffer',

        URL:
            'url',

        UNKNOWN:
            'unknown',
    });

const DEFAULTS =
    Object.freeze({
        mode:
            MASKING_MODES.REDACT,

        replacement:
            '[REDACTED]',

        maskCharacter:
            '*',

        preserveVisibleCharacters:
            0,

        preserveEndCharacters:
            0,

        minMaskLength:
            8,

        hashAlgorithm:
            'sha256',

        hashPrefix:
            'sha256:',

        maxDepth:
            20,

        maxKeys:
            20_000,

        maxArrayLength:
            5_000,

        maxStringLength:
            32_768,

        detectBearerTokens:
            true,

        detectBasicAuth:
            true,

        detectUrlCredentials:
            true,

        detectJwt:
            true,

        detectPrivateKeys:
            true,

        detectConnectionStrings:
            true,

        detectAuthorizationHeaders:
            true,

        stripStackTrace:
            false,

        preserveErrorName:
            true,

        preserveErrorCode:
            true,

        preserveErrorStatus:
            true,

        exposeAllowListedValues:
            true,

        caseInsensitiveKeys:
            true,

        includePathInDiagnostics:
            false,

        forbiddenOutputKeys:
            Object.freeze([
                '__proto__',
                'prototype',
                'constructor',
            ]),

        /**
         * Exact sensitive variable/key names commonly used across the TITech
         * backend.
         */
        sensitiveKeys:
            Object.freeze([
                'password',
                'passwd',
                'passphrase',
                'secret',
                'secrets',
                'token',
                'accessToken',
                'access_token',
                'refreshToken',
                'refresh_token',
                'idToken',
                'id_token',
                'authorization',
                'proxyAuthorization',
                'cookie',
                'set-cookie',
                'session',
                'sessionToken',
                'session_token',
                'apiKey',
                'api_key',
                'apikey',
                'clientSecret',
                'client_secret',
                'privateKey',
                'private_key',
                'publicKey',
                'signingKey',
                'signing_key',
                'encryptionKey',
                'encryption_key',
                'masterKey',
                'master_key',
                'credential',
                'credentials',
                'databaseUrl',
                'database_url',
                'databaseUri',
                'database_uri',
                'mongoUri',
                'mongo_uri',
                'mongodbUri',
                'mongodb_uri',
                'redisUrl',
                'redis_url',
                'smtpPassword',
                'smtp_password',
                'jwt',
                'jwtSecret',
                'jwt_secret',
                'jwtSigningSecret',
                'jwt_signing_secret',
                'cardNumber',
                'card_number',
                'pan',
                'cvv',
                'cvc',
                'pin',
                'otp',
                'securityCode',
                'security_code',
            ]),

        /**
         * Sensitive key fragments. Deliberately conservative.
         */
        sensitivePatterns:
            Object.freeze([
                /pass(word|wd|phrase)?/i,
                /secret/i,
                /token/i,
                /authorization/i,
                /api[_-]?key/i,
                /private[_-]?key/i,
                /signing[_-]?key/i,
                /encryption[_-]?key/i,
                /credential/i,
                /cookie/i,
                /session/i,
                /refresh[_-]?token/i,
                /access[_-]?token/i,
                /client[_-]?secret/i,
                /jwt/i,
                /database[_-]?(url|uri|password|credential)/i,
                /mongo(db)?[_-]?(url|uri|password|credential)/i,
                /redis[_-]?(url|uri|password|credential)/i,
                /smtp[_-]?(password|credential)/i,
                /private[_-]?key/i,
                /encryption/i,
                /master[_-]?key/i,
            ]),

        /**
         * Fields that may safely remain visible.
         */
        safeKeys:
            Object.freeze([
                'name',
                'code',
                'status',
                'statusCode',
                'message',
                'method',
                'route',
                'path',
                'host',
                'hostname',
                'port',
                'protocol',
                'environment',
                'service',
                'serviceName',
                'application',
                'applicationName',
                'version',
                'timestamp',
                'createdAt',
                'updatedAt',
                'durationMs',
                'duration',
                'requestId',
                'correlationId',
                'traceId',
                'spanId',
                'operation',
                'component',
            ]),

        /**
         * Environment variables that are sensitive even when their names do
         * not contain an obvious secret word.
         */
        sensitiveEnvironmentVariables:
            Object.freeze([
                'MONGO_URI',
                'MONGO_URI_FALLBACK',
                'MONGODB_URI',
                'DATABASE_URL',
                'DATABASE_URI',
                'REDIS_URL',
                'JWT_SECRET',
                'JWT_SIGNING_SECRET',
                'ENCRYPTION_KEY',
                'APP_ENCRYPTION_KEY',
                'SMTP_PASSWORD',
                'MAIL_PASSWORD',
                'AWS_SECRET_ACCESS_KEY',
                'AWS_SESSION_TOKEN',
                'GOOGLE_APPLICATION_CREDENTIALS',
                'PRIVATE_KEY',
                'SIGNING_KEY',
            ]),
    });

/**
 * =============================================================================
 * Errors
 * =============================================================================
 */

class SecretMaskerError extends Error {

    constructor(
        message,
        options = {},
    ) {

        super(
            message,
        );

        this.name =
            'SecretMaskerError';

        this.code =
            options.code ||
            'SECRET_MASKER_ERROR';

        this.path =
            options.path ||
            null;

        this.cause =
            options.cause ||
            null;

        this.details =
            Object.freeze({
                ...(options.details || {}),
            });

        Error.captureStackTrace?.(
            this,
            SecretMaskerError,
        );
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
            // Continue below.
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

function normalizeKey(
    key,
) {

    return String(
        key ??
        '',
    )
        .trim();
}

function normalizePath(
    path,
) {

    return String(
        path ||
        '',
    )
        .trim()
        .replace(
            /\[(\w+)\]/g,
            '.$1',
        )
        .split('.')
        .filter(Boolean)
        .join('.');
}

function isForbiddenOutputKey(
    key,
    options,
) {

    return (
        options.forbiddenOutputKeys ||
        DEFAULTS.forbiddenOutputKeys
    ).includes(
        key,
    );
}

function stableStringify(
    value,
) {

    if (
        value === null ||
        typeof value !== 'object'
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

function hashValue(
    value,
    options = DEFAULTS,
) {

    return (
        options.hashPrefix ||
        DEFAULTS.hashPrefix
    ) +
    crypto
        .createHash(
            options.hashAlgorithm ||
                DEFAULTS.hashAlgorithm,
        )
        .update(
            String(
                value ??
                '',
            ),
            'utf8',
        )
        .digest(
            'hex',
        );
}

function isPlainObject(
    value,
) {

    if (
        value === null ||
        typeof value !== 'object'
    ) {
        return false;
    }

    const prototype =
        Object.getPrototypeOf(
            value,
        );

    return (
        prototype ===
            Object.prototype ||
        prototype === null
    );
}

function isBuffer(
    value,
) {

    return Buffer.isBuffer(
        value,
    );
}

/**
 * =============================================================================
 * Secret detection
 * =============================================================================
 */

function normalizeSensitiveName(
    value,
) {

    return String(
        value ||
        '',
    )
        .trim()
        .replace(
            /[-\s]/g,
            '_',
        );
}

function isSensitiveKey(
    key,
    options = DEFAULTS,
) {

    const normalized =
        normalizeSensitiveName(
            key,
        );

    if (
        !normalized
    ) {
        return false;
    }

    const comparable =
        options
            .caseInsensitiveKeys
            ? normalized.toLowerCase()
            : normalized;

    const exactKeys =
        (
            options.sensitiveKeys ||
            DEFAULTS.sensitiveKeys
        ).map(
            value =>
                options
                    .caseInsensitiveKeys
                    ? String(
                        value,
                    )
                        .toLowerCase()
                    : String(
                        value,
                    ),
        );

    if (
        exactKeys.includes(
            comparable,
        )
    ) {
        return true;
    }

    return (
        options.sensitivePatterns ||
        DEFAULTS.sensitivePatterns
    ).some(
        pattern =>
            pattern.test(
                normalized,
            ),
    );
}

function isSensitiveEnvironmentVariable(
    key,
    options = DEFAULTS,
) {

    const normalized =
        normalizeSensitiveName(
            key,
        ).toUpperCase();

    if (
        (
            options
                .sensitiveEnvironmentVariables ||
            DEFAULTS
                .sensitiveEnvironmentVariables
        ).includes(
            normalized,
        )
    ) {
        return true;
    }

    return isSensitiveKey(
        key,
        options,
    );
}

function isSafeKey(
    key,
    options = DEFAULTS,
) {

    const normalized =
        normalizeSensitiveName(
            key,
        );

    return (
        options
            .safeKeys ||
        DEFAULTS.safeKeys
    ).some(
        safeKey =>
            safeKey.toLowerCase() ===
            normalized.toLowerCase(),
    );
}

/**
 * =============================================================================
 * String detector
 * =============================================================================
 */

function detectSensitiveString(
    value,
    options = DEFAULTS,
) {

    if (
        typeof value !==
        'string'
    ) {

        return {
            sensitive:
                false,

            reason:
                null,
        };
    }

    const text =
        value;

    /**
     * Authorization header.
     */
    if (
        options.detectAuthorizationHeaders &&
        /^authorization\s*:/i.test(
            text,
        )
    ) {

        return {
            sensitive:
                true,

            reason:
                'authorization-header',
        };
    }

    /**
     * Bearer token.
     */
    if (
        options.detectBearerTokens &&
        /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/i.test(
            text,
        )
    ) {

        return {
            sensitive:
                true,

            reason:
                'bearer-token',
        };
    }

    /**
     * Basic authentication.
     */
    if (
        options.detectBasicAuth &&
        /\bBasic\s+[A-Za-z0-9+/=]{12,}\b/i.test(
            text,
        )
    ) {

        return {
            sensitive:
                true,

            reason:
                'basic-auth',
        };
    }

    /**
     * JWT.
     */
    if (
        options.detectJwt &&
        /\beyJ[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9._-]{5,}\.[a-zA-Z0-9._-]{5,}\b/.test(
            text,
        )
    ) {

        return {
            sensitive:
                true,

            reason:
                'jwt',
        };
    }

    /**
     * Private key blocks.
     */
    if (
        options.detectPrivateKeys &&
        /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i.test(
            text,
        )
    ) {

        return {
            sensitive:
                true,

            reason:
                'private-key',
        };
    }

    /**
     * Common secret assignments.
     */
    if (
        /\b(?:password|passwd|secret|token|api[_-]?key|client[_-]?secret)\s*[:=]\s*['"]?[^\s,'"}]+/i.test(
            text,
        )
    ) {

        return {
            sensitive:
                true,

            reason:
                'secret-assignment',
        };
    }

    /**
     * Connection-string credentials.
     *
     * mongodb://user:password@host
     * redis://user:password@host
     */
    if (
        options.detectConnectionStrings &&
        /(?:mongodb(?:\+srv)?|redis|rediss|amqp|postgres(?:ql)?|mysql|mssql):\/\/[^/\s:@]+:[^@\s]+@/i.test(
            text,
        )
    ) {

        return {
            sensitive:
                true,

            reason:
                'connection-string-credentials',
        };
    }

    /**
     * URL credentials.
     */
    if (
        options.detectUrlCredentials &&
        /https?:\/\/[^/\s:@]+:[^@\s]+@/i.test(
            text,
        )
    ) {

        return {
            sensitive:
                true,

            reason:
                'url-credentials',
        };
    }

    /**
     * Authorization-like key-value strings.
     */
    if (
        options.detectAuthorizationHeaders &&
        /\b(?:authorization|proxy-authorization)\s*[:=]\s*\S+/i.test(
            text,
        )
    ) {

        return {
            sensitive:
                true,

            reason:
                'authorization-value',
        };
    }

    return {
        sensitive:
            false,

        reason:
            null,
    };
}

/**
 * =============================================================================
 * String masking
 * =============================================================================
 */

function maskSecret(
    value,
    options = DEFAULTS,
    reason = null,
) {

    if (
        value === null ||
        value === undefined
    ) {
        return value;
    }

    const text =
        String(
            value,
        );

    switch (
        options.mode
    ) {

        case MASKING_MODES.HASH:

            return hashValue(
                text,
                options,
            );

        case MASKING_MODES.MASK: {

            const visibleStart =
                Math.max(
                    0,
                    Number(
                        options
                            .preserveVisibleCharacters ||
                        0,
                    ),
                );

            const visibleEnd =
                Math.max(
                    0,
                    Number(
                        options
                            .preserveEndCharacters ||
                        0,
                    ),
                );

            if (
                text.length <=
                    visibleStart +
                    visibleEnd
            ) {

                return options.replacement;
            }

            const middleLength =
                Math.max(
                    Number(
                        options.minMaskLength ||
                        DEFAULTS
                            .minMaskLength,
                    ),
                    text.length -
                        visibleStart -
                        visibleEnd,
                );

            return (
                text.slice(
                    0,
                    visibleStart,
                ) +
                options.maskCharacter
                    .repeat(
                        middleLength,
                    ) +
                (
                    visibleEnd > 0
                        ? text.slice(
                            -visibleEnd,
                        )
                        : ''
                )
            );
        }

        case MASKING_MODES.PRESERVE:

            return text;

        case MASKING_MODES.REDACT:
        default:

            return options.replacement;
    }
}

/**
 * =============================================================================
 * Inline string sanitizers
 * =============================================================================
 */

function maskBearerTokens(
    value,
    options,
) {

    return value.replace(
        /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{12,}\b/gi,
        `$1 ${maskSecret(
            'sensitive-bearer-token',
            options,
            'bearer-token',
        )}`,
    );
}

function maskBasicAuth(
    value,
    options,
) {

    return value.replace(
        /\b(Basic)\s+[A-Za-z0-9+/=]{12,}\b/gi,
        `$1 ${maskSecret(
            'sensitive-basic-auth',
            options,
            'basic-auth',
        )}`,
    );
}

function maskJwt(
    value,
    options,
) {

    return value.replace(
        /\beyJ[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9._-]{5,}\.[a-zA-Z0-9._-]{5,}\b/g,
        () =>
            maskSecret(
                'sensitive-jwt',
                options,
                'jwt',
            ),
    );
}

function maskPrivateKeys(
    value,
    options,
) {

    return value.replace(
        /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/gi,
        () =>
            maskSecret(
                'sensitive-private-key',
                options,
                'private-key',
            ),
    );
}

function maskUrlCredentials(
    value,
    options,
) {

    /**
     * Generic URL:
     *
     * https://username:password@example.com
     *
     * MongoDB / Redis / AMQP etc.:
     *
     * mongodb://username:password@cluster/db
     */
    return value.replace(
        /((?:[a-z][a-z0-9+.-]*):\/\/[^/\s:@]+:)[^@\s]+(@)/gi,
        `$1${maskSecret(
            'sensitive-url-password',
            options,
            'url-credentials',
        )}$2`,
    );
}

function maskConnectionStringQueryCredentials(
    value,
    options,
) {

    /**
     * Masks common query parameters:
     *
     * ?password=secret
     * &access_token=secret
     * ?apiKey=secret
     */
    return value.replace(
        /([?&](?:password|passwd|secret|token|access_token|refresh_token|api[_-]?key|client[_-]?secret|authorization)=)[^&\s]+/gi,
        `$1${maskSecret(
            'sensitive-query-parameter',
            options,
            'connection-string-credentials',
        )}`,
    );
}

function maskSecretAssignments(
    value,
    options,
) {

    return value.replace(
        /(\b(?:password|passwd|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret|private[_-]?key|encryption[_-]?key)\b\s*[:=]\s*['"]?)[^'"\s,}]+/gi,
        `$1${maskSecret(
            'sensitive-assignment',
            options,
            'secret-assignment',
        )}`,
    );
}

function sanitizeString(
    value,
    options = DEFAULTS,
) {

    if (
        typeof value !==
        'string'
    ) {

        return value;
    }

    let output =
        value;

    if (
        options.detectBearerTokens
    ) {
        output =
            maskBearerTokens(
                output,
                options,
            );
    }

    if (
        options.detectBasicAuth
    ) {
        output =
            maskBasicAuth(
                output,
                options,
            );
    }

    if (
        options.detectJwt
    ) {
        output =
            maskJwt(
                output,
                options,
            );
    }

    if (
        options.detectPrivateKeys
    ) {
        output =
            maskPrivateKeys(
                output,
                options,
            );
    }

    if (
        options.detectUrlCredentials
    ) {
        output =
            maskUrlCredentials(
                output,
                options,
            );
    }

    if (
        options.detectConnectionStrings
    ) {
        output =
            maskConnectionStringQueryCredentials(
                output,
                options,
            );
    }

    output =
        maskSecretAssignments(
            output,
            options,
        );

    if (
        output.length >
        options.maxStringLength
    ) {

        output =
            `${output.slice(
                0,
                options.maxStringLength,
            )}[TRUNCATED]`;
    }

    return output;
}

/**
 * =============================================================================
 * Error sanitization
 * =============================================================================
 */

function sanitizeError(
    error,
    options,
    path,
    depth,
) {

    if (
        !(error instanceof Error)
    ) {

        return sanitize(
            error,
            {
                ...options,
                path,
                depth,
            },
        );
    }

    const output = {
        name:
            options
                .preserveErrorName
                ? error.name
                : undefined,

        message:
            sanitizeString(
                error.message,
                options,
            ),

        code:
            options
                .preserveErrorCode
                ? error.code
                : undefined,

        statusCode:
            options
                .preserveErrorStatus
                ? error.statusCode
                : undefined,
    };

    if (
        error.status
    ) {

        output.status =
            error.status;
    }

    if (
        error.cause &&
        depth <
            options.maxDepth
    ) {

        output.cause =
            sanitizeError(
                error.cause,
                options,
                `${path}.cause`,
                depth + 1,
            );
    }

    /**
     * Stack traces can contain request data, URLs and credentials. Sanitizing
     * the stack is intentionally controlled by option.
     */
    if (
        options.stripStackTrace
    ) {

        output.stack =
            undefined;

    } else if (
        error.stack
    ) {

        output.stack =
            sanitizeString(
                error.stack,
                options,
            );
    }

    /**
     * Include enumerable custom properties, but apply the same recursive
     * masking policy.
     */
    for (
        const [
            key,
            value,
        ] of Object.entries(
            error,
        )
    ) {

        if (
            key === 'name' ||
            key === 'message' ||
            key === 'code' ||
            key === 'statusCode' ||
            key === 'status' ||
            key === 'cause' ||
            key === 'stack'
        ) {

            continue;
        }

        if (
            isForbiddenOutputKey(
                key,
                options,
            )
        ) {

            continue;
        }

        const childPath =
            path
                ? `${path}.${key}`
                : key;

        output[key] =
            sanitize(
                value,
                {
                    ...options,
                    path:
                        childPath,
                    depth:
                        depth + 1,
                },
            );
    }

    return removeUndefined(
        output,
    );
}

/**
 * =============================================================================
 * Recursive sanitization
 * =============================================================================
 */

function sanitize(
    value,
    options = {},
) {

    const normalizedOptions =
        normalizeOptions(
            options,
        );

    const path =
        normalizePath(
            normalizedOptions.path ||
            '',
        );

    return sanitizeInternal(
        value,
        normalizedOptions,
        path,
        0,
        {
            keys:
                0,
        },
    );
}

function sanitizeInternal(
    value,
    options,
    path,
    depth,
    state,
) {

    if (
        depth >
        options.maxDepth
    ) {

        return '[MAX_DEPTH_EXCEEDED]';
    }

    if (
        state.keys >
        options.maxKeys
    ) {

        return '[MAX_KEYS_EXCEEDED]';
    }

    if (
        value === null ||
        value === undefined
    ) {

        return value;
    }

    /**
     * Buffer / binary values should never be dumped raw.
     */
    if (
        isBuffer(
            value,
        )
    ) {

        return options.mode ===
            MASKING_MODES.HASH
            ? hashValue(
                value.toString(
                    'base64',
                ),
                options,
            )
            : options.replacement;
    }

    /**
     * Errors receive a purpose-built sanitizer.
     */
    if (
        value instanceof Error
    ) {

        return sanitizeError(
            value,
            options,
            path,
            depth,
        );
    }

    if (
        typeof value ===
        'string'
    ) {

        const sensitiveByPath =
            path &&
            isSensitiveKey(
                path,
                options,
            );

        const sensitiveByInlineDetection =
            detectSensitiveString(
                value,
                options,
            ).sensitive;

        if (
            sensitiveByPath ||
            sensitiveByInlineDetection
        ) {

            return maskSecret(
                value,
                options,
                sensitiveByPath
                    ? 'sensitive-key'
                    : detectSensitiveString(
                        value,
                        options,
                    ).reason,
            );
        }

        return sanitizeString(
            value,
            options,
        );
    }

    if (
        typeof value !==
            'object'
    ) {

        return value;
    }

    if (
        Array.isArray(
            value,
        )
    ) {

        const length =
            Math.min(
                value.length,
                options.maxArrayLength,
            );

        const output =
            new Array(
                length,
            );

        for (
            let index = 0;
            index < length;
            index += 1
        ) {

            state.keys +=
                1;

            const itemPath =
                path
                    ? `${path}.${index}`
                    : String(
                        index,
                    );

            output[index] =
                sanitizeInternal(
                    value[index],
                    options,
                    itemPath,
                    depth + 1,
                    state,
                );
        }

        if (
            value.length >
            length
        ) {

            output.push(
                '[TRUNCATED]',
            );
        }

        return output;
    }

    /**
     * URL objects may contain username/password.
     */
    if (
        value instanceof URL
    ) {

        return maskUrlCredentials(
            value.toString(),
            options,
        );
    }

    const output = {};

    for (
        const [
            key,
            child,
        ] of Object.entries(
            value,
        )
    ) {

        state.keys +=
            1;

        if (
            state.keys >
            options.maxKeys
        ) {

            output.__truncated =
                '[MAX_KEYS_EXCEEDED]';

            break;
        }

        if (
            isForbiddenOutputKey(
                key,
                options,
            )
        ) {

            continue;
        }

        const childPath =
            path
                ? `${path}.${key}`
                : key;

        const sensitive =
            isSensitiveKey(
                key,
                options,
            ) ||
            isSensitiveEnvironmentVariable(
                key,
                options,
            );

        if (
            sensitive
        ) {

            if (
                options.exposeAllowListedValues &&
                isSafeKey(
                    key,
                    options,
                )
            ) {

                output[key] =
                    sanitizeString(
                        String(
                            child,
                        ),
                        options,
                    );

            } else {

                output[key] =
                    maskSecret(
                        child,
                        options,
                        'sensitive-key',
                    );
            }

            continue;
        }

        output[key] =
            sanitizeInternal(
                child,
                options,
                childPath,
                depth + 1,
                state,
            );
    }

    return output;
}

function removeUndefined(
    value,
) {

    if (
        Array.isArray(
            value,
        )
    ) {

        return value.map(
            item =>
                removeUndefined(
                    item,
                ),
        );
    }

    if (
        isPlainObject(
            value,
        )
    ) {

        const output = {};

        for (
            const [
                key,
                child,
            ] of Object.entries(
                value,
            )
        ) {

            if (
                child ===
                undefined
            ) {

                continue;
            }

            output[key] =
                removeUndefined(
                    child,
                );
        }

        return output;
    }

    return value;
}

/**
 * =============================================================================
 * Options
 * =============================================================================
 */

function normalizeOptions(
    options = {},
) {

    return {
        ...DEFAULTS,
        ...options,

        sensitiveKeys:
            [
                ...(
                    options.sensitiveKeys ||
                    DEFAULTS.sensitiveKeys
                ),
            ],

        sensitivePatterns:
            [
                ...(
                    options.sensitivePatterns ||
                    DEFAULTS.sensitivePatterns
                ),
            ],

        sensitiveEnvironmentVariables:
            [
                ...(
                    options.sensitiveEnvironmentVariables ||
                    DEFAULTS
                        .sensitiveEnvironmentVariables
                ),
            ],

        safeKeys:
            [
                ...(
                    options.safeKeys ||
                    DEFAULTS.safeKeys
                ),
            ],

        forbiddenOutputKeys:
            [
                ...(
                    options.forbiddenOutputKeys ||
                    DEFAULTS.forbiddenOutputKeys
                ),
            ],
    };
}

/**
 * =============================================================================
 * SecretMasker
 * =============================================================================
 */

class SecretMasker {

    constructor(
        options = {},
    ) {

        this.options =
            Object.freeze(
                normalizeOptions(
                    options,
                ),
            );

        this.state =
            'created';

        this.maskingCount =
            0;

        this.detectionCount =
            0;

        this.lastError =
            null;

        this.lastSnapshot =
            null;

        this.history =
            [];
    }

    /**
     * -------------------------------------------------------------------------
     * Mask a value.
     * -------------------------------------------------------------------------
     */

    mask(
        value,
        options = {},
    ) {

        const config =
            normalizeOptions({
                ...this.options,
                ...options,
            });

        this.state =
            'masking';

        try {

            const result =
                sanitize(
                    value,
                    config,
                );

            this.maskingCount +=
                1;

            this.state =
                'ready';

            return result;

        } catch (
            error
        ) {

            this.state =
                'failed';

            this.lastError =
                error;

            throw (
                error instanceof
                SecretMaskerError
                    ? error
                    : new SecretMaskerError(
                        'TITech secret masking failed.',
                        {
                            code:
                                'SECRET_MASKING_FAILED',

                            cause:
                                error,
                        },
                    )
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Mask an object.
     * -------------------------------------------------------------------------
     */

    maskObject(
        value,
        options = {},
    ) {

        return this.mask(
            value,
            options,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Mask environment variables.
     * -------------------------------------------------------------------------
     */

    maskEnvironment(
        environment = process.env,
        options = {},
    ) {

        const config =
            normalizeOptions({
                ...this.options,
                ...options,
            });

        const output =
            this.mask(
                environment,
                {
                    ...config,

                    path:
                        '',
                },
            );

        return deepFreeze(
            output,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Mask an error.
     * -------------------------------------------------------------------------
     */

    maskError(
        error,
        options = {},
    ) {

        const config =
            normalizeOptions({
                ...this.options,
                ...options,
            });

        return sanitizeError(
            error,
            config,
            '',
            0,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Detect.
     * -------------------------------------------------------------------------
     */

    detect(
        value,
        options = {},
    ) {

        const config =
            normalizeOptions({
                ...this.options,
                ...options,
            });

        this.detectionCount +=
            1;

        if (
            typeof value ===
            'string'
        ) {

            const detection =
                detectSensitiveString(
                    value,
                    config,
                );

            return {
                sensitive:
                    detection.sensitive,

                reason:
                    detection.reason,

                type:
                    VALUE_TYPES.STRING,

                timestamp:
                    new Date().toISOString(),
            };
        }

        return {
            sensitive:
                isSensitiveKey(
                    options.key ||
                    '',
                    config,
                ),

            reason:
                options.key
                    ? 'sensitive-key'
                    : null,

            type:
                Array.isArray(
                    value,
                )
                    ? VALUE_TYPES.ARRAY
                    : isBuffer(
                        value,
                    )
                        ? VALUE_TYPES.BUFFER
                        : VALUE_TYPES.UNKNOWN,

            timestamp:
                new Date().toISOString(),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Mask a specific key/value pair.
     * -------------------------------------------------------------------------
     */

    maskKeyValue(
        key,
        value,
        options = {},
    ) {

        const config =
            normalizeOptions({
                ...this.options,
                ...options,
            });

        const sensitive =
            isSensitiveKey(
                key,
                config,
            ) ||
            isSensitiveEnvironmentVariable(
                key,
                config,
            );

        if (
            sensitive
        ) {

            this.maskingCount +=
                1;

            return maskSecret(
                value,
                config,
                'sensitive-key',
            );
        }

        return sanitize(
            value,
            {
                ...config,

                path:
                    key,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Redaction preset.
     * -------------------------------------------------------------------------
     */

    redact(
        value,
        options = {},
    ) {

        return this.mask(
            value,
            {
                ...options,

                mode:
                    MASKING_MODES.REDACT,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Partial masking preset.
     * -------------------------------------------------------------------------
     */

    partial(
        value,
        options = {},
    ) {

        return this.mask(
            value,
            {
                ...options,

                mode:
                    MASKING_MODES.MASK,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Hash preset.
     * -------------------------------------------------------------------------
     */

    hash(
        value,
        options = {},
    ) {

        return this.mask(
            value,
            {
                ...options,

                mode:
                    MASKING_MODES.HASH,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Safe log payload.
     * -------------------------------------------------------------------------
     */

    forLog(
        value,
        options = {},
    ) {

        return this.mask(
            value,
            {
                ...options,

                mode:
                    MASKING_MODES.REDACT,

                exposeAllowListedValues:
                    true,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Safe diagnostic payload.
     * -------------------------------------------------------------------------
     */

    forDiagnostics(
        value,
        options = {},
    ) {

        return this.mask(
            value,
            {
                ...options,

                mode:
                    MASKING_MODES.REDACT,

                exposeAllowListedValues:
                    true,

                includePathInDiagnostics:
                    true,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Fingerprint without exposing secret value.
     * -------------------------------------------------------------------------
     */

    fingerprint(
        value,
        options = {},
    ) {

        const config =
            normalizeOptions({
                ...this.options,
                ...options,
            });

        return hashValue(
            value,
            config,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Snapshot.
     * -------------------------------------------------------------------------
     */

    snapshot() {

        const output = {
            component:
                COMPONENT,

            service:
                SERVICE_NAME,

            application:
                APPLICATION_NAME,

            state:
                this.state,

            maskingCount:
                this.maskingCount,

            detectionCount:
                this.detectionCount,

            options: {
                mode:
                    this.options.mode,

                maxDepth:
                    this.options.maxDepth,

                detectBearerTokens:
                    this.options
                        .detectBearerTokens,

                detectBasicAuth:
                    this.options
                        .detectBasicAuth,

                detectJwt:
                    this.options
                        .detectJwt,

                detectPrivateKeys:
                    this.options
                        .detectPrivateKeys,

                detectConnectionStrings:
                    this.options
                        .detectConnectionStrings,
            },

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
        };

        this.lastSnapshot =
            deepFreeze(
                output,
            );

        return this.lastSnapshot;
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

            maskingCount:
                this.maskingCount,

            detectionCount:
                this.detectionCount,

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

            maskingCount:
                this.maskingCount,

            detectionCount:
                this.detectionCount,

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

        this.maskingCount =
            0;

        this.detectionCount =
            0;

        this.lastError =
            null;

        this.lastSnapshot =
            null;

        this.history.length =
            0;

        return this;
    }
}

/**
 * =============================================================================
 * Singleton
 * =============================================================================
 */

const secretMasker =
    new SecretMasker();

/**
 * =============================================================================
 * Convenience API
 * =============================================================================
 */

function mask(
    value,
    options,
) {

    return secretMasker.mask(
        value,
        options,
    );
}

function redact(
    value,
    options,
) {

    return secretMasker.redact(
        value,
        options,
    );
}

function partial(
    value,
    options,
) {

    return secretMasker.partial(
        value,
        options,
    );
}

function hash(
    value,
    options,
) {

    return secretMasker.hash(
        value,
        options,
    );
}

function maskEnvironment(
    environment,
    options,
) {

    return secretMasker.maskEnvironment(
        environment,
        options,
    );
}

function maskError(
    error,
    options,
) {

    return secretMasker.maskError(
        error,
        options,
    );
}

function detect(
    value,
    options,
) {

    return secretMasker.detect(
        value,
        options,
    );
}

function maskKeyValue(
    key,
    value,
    options,
) {

    return secretMasker.maskKeyValue(
        key,
        value,
        options,
    );
}

function fingerprint(
    value,
    options,
) {

    return secretMasker.fingerprint(
        value,
        options,
    );
}

function forLog(
    value,
    options,
) {

    return secretMasker.forLog(
        value,
        options,
    );
}

function forDiagnostics(
    value,
    options,
) {

    return secretMasker.forDiagnostics(
        value,
        options,
    );
}

/**
 * =============================================================================
 * Public API
 * =============================================================================
 */

module.exports =
    Object.freeze({
        /**
         * Singleton.
         */
        secretMasker,

        SecretMasker,

        SecretMaskerError,

        /**
         * Constants.
         */
        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        MASKING_MODES,

        VALUE_TYPES,

        DEFAULTS,

        /**
         * Core operations.
         */
        mask,

        redact,

        partial,

        hash,

        maskEnvironment,

        maskError,

        maskKeyValue,

        detect,

        fingerprint,

        /**
         * Operational presets.
         */
        forLog,

        forDiagnostics,

        /**
         * Low-level helpers.
         */
        isSensitiveKey:
            (
                key,
                options,
            ) =>
                isSensitiveKey(
                    key,
                    normalizeOptions(
                        options,
                    ),
                ),

        isSensitiveEnvironmentVariable:
            (
                key,
                options,
            ) =>
                isSensitiveEnvironmentVariable(
                    key,
                    normalizeOptions(
                        options,
                    ),
                ),

        detectSensitiveString:
            (
                value,
                options,
            ) =>
                detectSensitiveString(
                    value,
                    normalizeOptions(
                        options,
                    ),
                ),

        maskSecret:
            (
                value,
                options,
            ) =>
                maskSecret(
                    value,
                    normalizeOptions(
                        options,
                    ),
                ),

        sanitizeString:
            (
                value,
                options,
            ) =>
                sanitizeString(
                    value,
                    normalizeOptions(
                        options,
                    ),
                ),

        sanitize,

        stableStringify,

        /**
         * Lifecycle/diagnostics.
         */
        readiness:
            () =>
                secretMasker.readiness(),

        health:
            () =>
                secretMasker.health(),

        snapshot:
            () =>
                secretMasker.snapshot(),

        reset:
            () =>
                secretMasker.reset(),
    });