'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/environment/validation/databaseValidator.js
 *
 * Purpose:
 *   Enterprise production-grade database configuration validator.
 *
 * Responsibilities:
 *   - Validate TITech MongoDB/database environment configuration.
 *   - Validate MongoDB URI structure and protocol policy.
 *   - Validate MongoDB SRV URI requirements.
 *   - Validate standard mongodb:// URI requirements.
 *   - Validate database name and host configuration.
 *   - Validate authentication configuration.
 *   - Validate TLS/security configuration.
 *   - Validate retry, pool and timeout configuration.
 *   - Detect incompatible database configuration combinations.
 *   - Validate production-safe defaults and policies.
 *   - Produce safe diagnostics without exposing credentials.
 *   - Integrate with validationErrors.js.
 *   - Remain connectivity-independent.
 *
 * IMPORTANT:
 *
 *   This module VALIDATES DATABASE CONFIGURATION.
 *
 *   It does NOT:
 *     - connect to MongoDB.
 *     - create a Mongoose connection.
 *     - disconnect MongoDB.
 *     - retry database connections.
 *     - execute database queries.
 *     - initialize indexes.
 *     - mutate process.env.
 *     - load dotenv files.
 *     - merge configuration layers.
 *     - determine environment precedence.
 *     - execute financial transactions.
 *
 * Database connection ownership remains with:
 *
 *   backend/config/db.js
 *
 * or the canonical database infrastructure/bootstrap subsystem.
 *
 * =============================================================================
 *
 * Validation boundary:
 *
 *   process.env
 *       ↓
 *   environment normalization
 *       ↓
 *   databaseValidator.js
 *       ↓
 *   validationErrors.js
 *       ↓
 *   database bootstrap/connection
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
 * Optional URL normalizer integration
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
 * Optional secret masker integration
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
    'environment-validation-database';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

const DATABASE_PROTOCOLS =
    Object.freeze({
        STANDARD:
            'mongodb:',

        SRV:
            'mongodb+srv:',
    });

const DATABASE_TYPES =
    Object.freeze({
        MONGODB:
            'mongodb',

        MONGODB_SRV:
            'mongodb-srv',
    });

const DATABASE_AUTH_MODES =
    Object.freeze({
        DEFAULT:
            'default',

        SCRAM:
            'scram',

        SCRAM_SHA_1:
            'scram-sha-1',

        SCRAM_SHA_256:
            'scram-sha-256',

        X509:
            'x509',

        AWS:
            'aws',

        GSSAPI:
            'gssapi',
    });

const DEFAULTS =
    Object.freeze({
        strict:
            true,

        failClosed:
            true,

        requireUri:
            true,

        allowFallback:
            true,

        allowMultipleUris:
            true,

        requireProductionTls:
            true,

        requireProductionAuthentication:
            true,

        requireSrvInProduction:
            false,

        allowLocalhost:
            true,

        allowLoopback:
            true,

        allowPrivateNetwork:
            true,

        allowIpLiterals:
            true,

        allowStandardMongo:
            true,

        allowSrvMongo:
            true,

        allowEmptyDatabaseName:
            false,

        allowDatabaseQueryOptions:
            true,

        maxPoolSize:
            100,

        minPoolSize:
            0,

        maxPoolSizeProduction:
            100,

        minPoolSizeProduction:
            0,

        minServerSelectionTimeoutMs:
            1,

        maxServerSelectionTimeoutMs:
            120_000,

        minSocketTimeoutMs:
            0,

        maxSocketTimeoutMs:
            600_000,

        minConnectTimeoutMs:
            1,

        maxConnectTimeoutMs:
            120_000,

        minWaitQueueTimeoutMs:
            0,

        maxWaitQueueTimeoutMs:
            120_000,

        defaultServerSelectionTimeoutMs:
            10_000,

        defaultConnectTimeoutMs:
            10_000,

        defaultSocketTimeoutMs:
            45_000,

        defaultMaxPoolSize:
            10,

        defaultMinPoolSize:
            2,

        productionMinimumPoolSize:
            1,

        maxRetries:
            10,

        retryDelayMs:
            2_000,

        maxRetryDelayMs:
            30_000,

        requireReplicaSetForProduction:
            false,

        fingerprintAlgorithm:
            'sha256',

        includeRawValues:
            false,

        maxErrors:
            100,

        maxDiagnostics:
            100,

        sensitiveKeys:
            Object.freeze([
                'MONGO_URI',
                'MONGO_URI_FALLBACK',
                'MONGODB_URI',
                'MONGODB_URI_FALLBACK',
                'DATABASE_URL',
                'DATABASE_URI',
                'MONGO_PASSWORD',
                'MONGODB_PASSWORD',
                'MONGO_USERNAME',
                'MONGODB_USERNAME',
            ]),
    });

/**
 * =============================================================================
 * DatabaseValidatorError
 * =============================================================================
 */

class DatabaseValidatorError extends EnvironmentValidationError {

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
                        .DATABASE,
            },
        );

        this.name =
            'DatabaseValidatorError';
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

    const result =
        String(
            value,
        )
            .trim();

    return result ||
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
        // Fall back below.
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
        // Validation must remain logger-independent.
    }
}

/**
 * =============================================================================
 * URI helpers
 * =============================================================================
 */

function getProtocol(
    uri,
) {

    try {

        return new URL(
            uri,
        ).protocol;

    } catch {

        const match =
            String(
                uri,
            ).match(
                /^([a-z][a-z0-9+.-]*):\/\//i,
            );

        return match
            ? `${match[1].toLowerCase()}:`
            : null;
    }
}

function isMongoProtocol(
    protocol,
) {

    return (
        protocol ===
            DATABASE_PROTOCOLS.STANDARD ||
        protocol ===
            DATABASE_PROTOCOLS.SRV
    );
}

function isSrvProtocol(
    protocol,
) {

    return (
        protocol ===
        DATABASE_PROTOCOLS.SRV
    );
}

function isStandardMongoProtocol(
    protocol,
) {

    return (
        protocol ===
        DATABASE_PROTOCOLS.STANDARD
    );
}

function redactMongoUri(
    uri,
) {

    if (
        !uri
    ) {

        return uri;
    }

    try {

        return String(
            uri,
        )
            .replace(
                /^(mongodb(?:\+srv)?:\/\/)([^/@:]+)(?::[^/@]*)?@/i,
                '$1$2:****@',
            );

    } catch {

        return '[REDACTED]';
    }
}

function safelyParseMongoUri(
    uri,
) {

    try {

        return new URL(
            uri,
        );

    } catch {

        return null;
    }
}

function getMongoDatabaseName(
    uriObject,
) {

    if (
        !uriObject
    ) {

        return null;
    }

    const pathname =
        uriObject.pathname ||
        '';

    const databaseName =
        pathname
            .replace(
                /^\/+/,
                '',
            )
            .split(
                '/',
            )[0];

    return databaseName ||
        null;
}

function getHostnames(
    uriObject,
) {

    if (
        !uriObject
    ) {

        return [];
    }

    /**
     * URL.host only represents the first authority host. MongoDB connection
     * strings can contain multiple hosts in a standard mongodb:// URI.
     */
    const hostname =
        uriObject.hostname;

    return hostname
        ? [
            hostname,
        ]
        : [];
}

function parseStandardMongoHosts(
    uri,
) {

    const match =
        String(
            uri,
        )
            .match(
                /^mongodb:\/\/([^/]+)(?:\/|$)/i,
            );

    if (
        !match
    ) {

        return [];
    }

    const authority =
        match[1]
            .split(
                '?',
            )[0];

    /**
     * Remove credentials.
     */
    const hostList =
        authority
            .replace(
                /^[^@]+@/,
                '',
            )
            .split(
                ',',
            )
            .map(
                item =>
                    item.trim(),
            )
            .filter(Boolean);

    return hostList.map(
        host => {

            const withoutIpv6Brackets =
                host.startsWith('[')
                    ? host.slice(
                        1,
                        host.indexOf(
                            ']',
                        ),
                    )
                    : host;

            if (
                withoutIpv6Brackets.includes(
                    ']',
                )
            ) {

                return withoutIpv6Brackets;
            }

            /**
             * hostname:port
             */
            const lastColon =
                withoutIpv6Brackets.lastIndexOf(
                    ':',
                );

            if (
                lastColon >
                    -1 &&
                /^\d+$/.test(
                    withoutIpv6Brackets.slice(
                        lastColon + 1,
                    ),
                )
            ) {

                return withoutIpv6Brackets.slice(
                    0,
                    lastColon,
                );
            }

            return withoutIpv6Brackets;
        },
    );
}

function hasExplicitPort(
    uriObject,
) {

    return Boolean(
        uriObject?.port,
    );
}

function queryParameter(
    uriObject,
    parameter,
) {

    if (
        !uriObject
    ) {

        return null;
    }

    return (
        uriObject.searchParams.get(
            parameter,
        )
    );
}

/**
 * =============================================================================
 * MongoDB URI validators
 * =============================================================================
 */

function validateUriSyntax(
    uri,
    result,
    options,
) {

    if (
        !isPresent(
            uri,
        )
    ) {

        result.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .REQUIRED_VARIABLE_MISSING,

            category:
                VALIDATION_CATEGORIES
                    .REQUIRED,

            severity:
                VALIDATION_SEVERITIES
                    .CRITICAL,

            variable:
                options.variable ||
                'MONGO_URI',

            environment:
                options.environment,

            message:
                'TITech MongoDB connection URI is required.',
        });

        return null;
    }

    const protocol =
        getProtocol(
            uri,
        );

    if (
        !isMongoProtocol(
            protocol,
        )
    ) {

        result.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .INVALID_FORMAT,

            category:
                VALIDATION_CATEGORIES
                    .FORMAT,

            severity:
                VALIDATION_SEVERITIES
                    .CRITICAL,

            variable:
                options.variable ||
                'MONGO_URI',

            environment:
                options.environment,

            expected:
                [
                    DATABASE_PROTOCOLS
                        .STANDARD,
                    DATABASE_PROTOCOLS
                        .SRV,
                ],

            message:
                'TITech MongoDB URI must use mongodb:// or mongodb+srv://.',
        });

        return null;
    }

    if (
        protocol ===
        DATABASE_PROTOCOLS.STANDARD &&
        !options.allowStandardMongo
    ) {

        result.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .INVALID_VALUE,

            category:
                VALIDATION_CATEGORIES
                    .DATABASE,

            severity:
                VALIDATION_SEVERITIES
                    .ERROR,

            variable:
                options.variable ||
                'MONGO_URI',

            message:
                'Standard mongodb:// connections are disabled by the TITech database policy.',
        });

        return null;
    }

    if (
        protocol ===
        DATABASE_PROTOCOLS.SRV &&
        !options.allowSrvMongo
    ) {

        result.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .INVALID_VALUE,

            category:
                VALIDATION_CATEGORIES
                    .DATABASE,

            severity:
                VALIDATION_SEVERITIES
                    .ERROR,

            variable:
                options.variable ||
                'MONGO_URI',

            message:
                'MongoDB SRV connections are disabled by the TITech database policy.',
        });

        return null;
    }

    const parsed =
        safelyParseMongoUri(
            uri,
        );

    if (
        !parsed
    ) {

        result.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .INVALID_URL,

            category:
                VALIDATION_CATEGORIES
                    .FORMAT,

            severity:
                VALIDATION_SEVERITIES
                    .CRITICAL,

            variable:
                options.variable ||
                'MONGO_URI',

            message:
                'TITech MongoDB URI could not be parsed as a valid URI.',
        });

        return null;
    }

    return {
        uri,
        parsed,
        protocol,
    };
}

function validateSrvUri(
    context,
    result,
    options,
) {

    const {
        uri,
        parsed,
    } = context;

    /**
     * mongodb+srv:// must identify a DNS hostname and must not use an explicit
     * port. URL parsing normalizes default information for us, but we inspect
     * the original URI too because SRV syntax must not specify a port.
     */
    if (
        hasExplicitPort(
            parsed,
        ) ||
        /mongodb\+srv:\/\/[^/]+:\d+/i.test(
            uri,
        )
    ) {

        result.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .INVALID_FORMAT,

            category:
                VALIDATION_CATEGORIES
                    .FORMAT,

            severity:
                VALIDATION_SEVERITIES
                    .CRITICAL,

            variable:
                options.variable ||
                'MONGO_URI',

            message:
                'TITech mongodb+srv:// URIs must not contain an explicit port.',
        });
    }

    const hostname =
        parsed.hostname;

    if (
        !hostname
    ) {

        result.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .INVALID_FORMAT,

            category:
                VALIDATION_CATEGORIES
                    .FORMAT,

            severity:
                VALIDATION_SEVERITIES
                    .CRITICAL,

            variable:
                options.variable ||
                'MONGO_URI',

            message:
                'TITech MongoDB SRV URI must contain a hostname.',
        });

        return;
    }

    /**
     * SRV normally uses a DNS hostname rather than a raw IP literal.
     */
    if (
        net.isIP(
            hostname,
        )
    ) {

        result.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .INVALID_VALUE,

            category:
                VALIDATION_CATEGORIES
                    .DATABASE,

            severity:
                VALIDATION_SEVERITIES
                    .CRITICAL,

            variable:
                options.variable ||
                'MONGO_URI',

            message:
                'TITech mongodb+srv:// configuration must use a DNS hostname rather than an IP address.',
        });
    }

    /**
     * SRV supports TLS through DNS-discovered MongoDB topology. Explicit tls
     * query parameters are allowed and production policy can require TLS.
     */
    const tls =
        queryParameter(
            parsed,
            'tls',
        );

    const ssl =
        queryParameter(
            parsed,
            'ssl',
        );

    if (
        options.requireProductionTls &&
        options.environment ===
            'production' &&
        (
            String(
                tls ||
                ssl ||
                '',
            )
                .trim()
                .toLowerCase() ===
                'false'
        )
    ) {

        result.addIssue({
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
                options.variable ||
                'MONGO_URI',

            message:
                'TITech production MongoDB configuration cannot explicitly disable TLS.',
        });
    }
}

function validateStandardUri(
    context,
    result,
    options,
) {

    const {
        uri,
        parsed,
    } = context;

    const hosts =
        parseStandardMongoHosts(
            uri,
        );

    if (
        hosts.length ===
        0
    ) {

        const hostname =
            parsed.hostname;

        if (
            hostname
        ) {

            hosts.push(
                hostname,
            );
        }
    }

    if (
        hosts.length ===
        0
    ) {

        result.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .INVALID_FORMAT,

            category:
                VALIDATION_CATEGORIES
                    .FORMAT,

            severity:
                VALIDATION_SEVERITIES
                    .CRITICAL,

            variable:
                options.variable ||
                'MONGO_URI',

            message:
                'TITech standard MongoDB URI must contain at least one database host.',
        });

        return;
    }

    for (
        const host of
        hosts
    ) {

        if (
            !host
        ) {

            result.addIssue({
                code:
                    VALIDATION_ERROR_CODES
                        .INVALID_FORMAT,

                category:
                    VALIDATION_CATEGORIES
                        .FORMAT,

                severity:
                    VALIDATION_SEVERITIES
                        .CRITICAL,

                variable:
                    options.variable ||
                    'MONGO_URI',

                message:
                    'TITech MongoDB URI contains an empty host.',
            });

            continue;
        }

        if (
            !options.allowLoopback &&
            (
                host ===
                    '127.0.0.1' ||
                host ===
                    '::1' ||
                host ===
                    'localhost'
            )
        ) {

            result.addIssue({
                code:
                    VALIDATION_ERROR_CODES
                        .SECURITY_POLICY_VIOLATION,

                category:
                    VALIDATION_CATEGORIES
                        .SECURITY,

                severity:
                    VALIDATION_SEVERITIES
                        .ERROR,

                variable:
                    options.variable ||
                    'MONGO_URI',

                message:
                    'Loopback MongoDB hosts are not permitted by the TITech database policy.',
            });
        }

        if (
            net.isIP(
                host,
            ) === 0 &&
            !(
                host.includes(
                    '.',
                ) ||
                host ===
                    'localhost'
            )
        ) {

            result.addIssue({
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
                    options.variable ||
                    'MONGO_URI',

                message:
                    `TITech MongoDB host "${host}" does not appear to be a valid hostname.`,
            });
        }
    }

    if (
        options.requireProductionTls &&
        options.environment ===
            'production'
    ) {

        const tls =
            queryParameter(
                parsed,
                'tls',
            );

        const ssl =
            queryParameter(
                parsed,
                'ssl',
            );

        if (
            String(
                tls ||
                ssl ||
                '',
            )
                .trim()
                .toLowerCase() ===
            'false'
        ) {

            result.addIssue({
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
                    options.variable ||
                    'MONGO_URI',

                message:
                    'TITech production MongoDB configuration cannot explicitly disable TLS.',
            });
        }
    }
}

/**
 * =============================================================================
 * Authentication validation
 * =============================================================================
 */

function validateAuthentication(
    context,
    config,
    result,
    options,
) {

    const {
        parsed,
    } = context;

    const username =
        normalizeString(
            config.MONGO_USERNAME ||
            config.MONGODB_USERNAME,
        );

    const password =
        normalizeString(
            config.MONGO_PASSWORD ||
            config.MONGODB_PASSWORD,
        );

    const authSource =
        normalizeString(
            queryParameter(
                parsed,
                'authSource',
            ),
        );

    const authMechanism =
        normalizeString(
            queryParameter(
                parsed,
                'authMechanism',
            ),
        );

    const hasUriCredentials =
        Boolean(
            parsed.username ||
            parsed.password,
        );

    if (
        options.environment ===
            'production' &&
        options.requireProductionAuthentication &&
        !hasUriCredentials &&
        !(
            username &&
            password
        )
    ) {

        result.addIssue({
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
                options.variable ||
                'MONGO_URI',

            message:
                'TITech production MongoDB configuration requires authenticated access.',
        });
    }

    if (
        (
            username &&
            !password
        ) ||
        (
            password &&
            !username
        )
    ) {

        result.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .INVALID_VALUE,

            category:
                VALIDATION_CATEGORIES
                    .DATABASE,

            severity:
                VALIDATION_SEVERITIES
                    .ERROR,

            variable:
                password
                    ? 'MONGO_USERNAME'
                    : 'MONGO_PASSWORD',

            message:
                'TITech MongoDB username and password configuration must be supplied together.',
        });
    }

    if (
        authMechanism
    ) {

        const supported =
            Object.values(
                DATABASE_AUTH_MODES,
            );

        const normalized =
            authMechanism
                .toLowerCase();

        if (
            !supported.includes(
                normalized,
            ) &&
            ![
                'scram-sha-1',
                'scram-sha-256',
            ].includes(
                normalized,
            )
        ) {

            result.addIssue({
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
                    options.variable ||
                    'MONGO_URI',

                expected:
                    supported,

                actual:
                    normalized,

                message:
                    `Unsupported TITech MongoDB authentication mechanism "${normalized}".`,
            });
        }
    }

    if (
        authSource ===
        '$external' &&
        !authMechanism
    ) {

        result.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .CONFIGURATION_INCONSISTENT,

            category:
                VALIDATION_CATEGORIES
                    .DATABASE,

            severity:
                VALIDATION_SEVERITIES
                    .ERROR,

            variable:
                options.variable ||
                'MONGO_URI',

            message:
                'TITech MongoDB authSource=$external requires an explicit external authentication mechanism.',
        });
    }

    /**
     * Credentials embedded in production configuration may be acceptable for
     * MongoDB URIs, but diagnostic output must remain redacted.
     */
    return {
        hasUriCredentials,

        hasSeparateCredentials:
            Boolean(
                username &&
                password,
            ),

        authSource,

        authMechanism,
    };
}

/**
 * =============================================================================
 * TLS validation
 * =============================================================================
 */

function validateTls(
    context,
    config,
    result,
    options,
) {

    const {
        parsed,
    } = context;

    const tls =
        queryParameter(
            parsed,
            'tls',
        );

    const ssl =
        queryParameter(
            parsed,
            'ssl',
        );

    const tlsValue =
        (
            tls ??
            ssl
        );

    const tlsEnabled =
        tlsValue === null
            ? null
            : toBoolean(
                tlsValue,
                false,
            );

    const environment =
        options.environment;

    if (
        environment ===
        'production'
    ) {

        if (
            options.requireProductionTls
        ) {

            if (
                tlsEnabled ===
                false
            ) {

                result.addIssue({
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
                        options.variable ||
                        'MONGO_URI',

                    message:
                        'TITech production MongoDB TLS cannot be explicitly disabled.',
                });
            }

            /**
             * For explicit TLS-safe production configurations, either SRV
             * topology or a secure deployment policy must ultimately establish
             * TLS. The validator does not perform network negotiation.
             */
        }
    }

    return {
        explicitlyConfigured:
            tlsEnabled !== null,

        enabled:
            tlsEnabled,
    };
}

/**
 * =============================================================================
 * Pool / timeout validation
 * =============================================================================
 */

function validatePoolAndTimeouts(
    config,
    result,
    options,
) {

    const poolSettings = [
        {
            name:
                'MONGO_MAX_POOL_SIZE',

            aliases:
                [
                    'MAX_POOL_SIZE',
                ],

            value:
                config.MONGO_MAX_POOL_SIZE,

            min:
                1,

            max:
                options.environment ===
                    'production'
                    ? options
                        .maxPoolSizeProduction
                    : options.maxPoolSize,
        },

        {
            name:
                'MONGO_MIN_POOL_SIZE',

            aliases:
                [
                    'MIN_POOL_SIZE',
                ],

            value:
                config.MONGO_MIN_POOL_SIZE,

            min:
                options.minPoolSize,

            max:
                options.maxPoolSizeProduction,
        },

        {
            name:
                'MONGO_SERVER_SELECTION_TIMEOUT_MS',

            aliases:
                [
                    'SERVER_SELECTION_TIMEOUT_MS',
                ],

            value:
                config.MONGO_SERVER_SELECTION_TIMEOUT_MS,

            min:
                options.minServerSelectionTimeoutMs,

            max:
                options.maxServerSelectionTimeoutMs,
        },

        {
            name:
                'MONGO_CONNECT_TIMEOUT_MS',

            aliases:
                [
                    'CONNECT_TIMEOUT_MS',
                ],

            value:
                config.MONGO_CONNECT_TIMEOUT_MS,

            min:
                options.minConnectTimeoutMs,

            max:
                options.maxConnectTimeoutMs,
        },

        {
            name:
                'MONGO_SOCKET_TIMEOUT_MS',

            aliases:
                [
                    'SOCKET_TIMEOUT_MS',
                ],

            value:
                config.MONGO_SOCKET_TIMEOUT_MS,

            min:
                options.minSocketTimeoutMs,

            max:
                options.maxSocketTimeoutMs,
        },

        {
            name:
                'MONGO_WAIT_QUEUE_TIMEOUT_MS',

            aliases:
                [
                    'WAIT_QUEUE_TIMEOUT_MS',
                ],

            value:
                config.MONGO_WAIT_QUEUE_TIMEOUT_MS,

            min:
                options.minWaitQueueTimeoutMs,

            max:
                options.maxWaitQueueTimeoutMs,
        },
    ];

    const normalized =
        {};

    for (
        const setting of
        poolSettings
    ) {

        const raw =
            setting.value;

        if (
            !isPresent(
                raw,
            )
        ) {

            continue;
        }

        const parsed =
            normalizeInteger(
                raw,
            );

        if (
            parsed === null
        ) {

            result.addIssue({
                code:
                    VALIDATION_ERROR_CODES
                        .INVALID_INTEGER,

                category:
                    VALIDATION_CATEGORIES
                        .TYPE,

                severity:
                    VALIDATION_SEVERITIES
                        .ERROR,

                variable:
                    setting.name,

                message:
                    `TITech ${setting.name} must be an integer.`,
            });

            continue;
        }

        if (
            parsed <
                setting.min ||
            parsed >
                setting.max
        ) {

            result.addIssue({
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
                    setting.name,

                expected:
                    {
                        min:
                            setting.min,

                        max:
                            setting.max,
                    },

                actual:
                    parsed,

                message:
                    `TITech ${setting.name} is outside the supported range.`,
            });

            continue;
        }

        normalized[
            setting.name
        ] =
            parsed;
    }

    const maxPoolSize =
        normalized.MONGO_MAX_POOL_SIZE;

    const minPoolSize =
        normalized.MONGO_MIN_POOL_SIZE;

    if (
        maxPoolSize !==
            undefined &&
        minPoolSize !==
            undefined &&
        minPoolSize >
            maxPoolSize
    ) {

        result.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .CONFIGURATION_INCONSISTENT,

            category:
                VALIDATION_CATEGORIES
                    .DATABASE,

            severity:
                VALIDATION_SEVERITIES
                    .CRITICAL,

            variable:
                'MONGO_MIN_POOL_SIZE',

            expected:
                {
                    maxPoolSize,
                },

            actual:
                minPoolSize,

            message:
                'TITech MongoDB minPoolSize cannot exceed maxPoolSize.',
        });
    }

    return normalized;
}

/**
 * =============================================================================
 * Database configuration validation
 * =============================================================================
 */

function validateDatabaseConfiguration(
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

            variable:
                options.variable ||
                'MONGO_URI',
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
     * URI source resolution
     * -------------------------------------------------------------------------
     */

    const primaryUri =
        normalizeString(
            config.MONGO_URI ||
            config.MONGODB_URI ||
            config.DATABASE_URL ||
            config.DATABASE_URI,
        );

    const fallbackUri =
        normalizeString(
            config.MONGO_URI_FALLBACK ||
            config.MONGODB_URI_FALLBACK,
        );

    const selectedUri =
        primaryUri ||
        fallbackUri;

    const selectedSource =
        primaryUri
            ? 'MONGO_URI'
            : fallbackUri
                ? 'MONGO_URI_FALLBACK'
                : null;

    if (
        !selectedUri &&
        normalizedOptions.requireUri
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .REQUIRED_VARIABLE_MISSING,

            category:
                VALIDATION_CATEGORIES
                    .REQUIRED,

            severity:
                normalizedOptions.failClosed
                    ? VALIDATION_SEVERITIES
                        .CRITICAL
                    : VALIDATION_SEVERITIES
                        .ERROR,

            variable:
                'MONGO_URI',

            environment,

            message:
                'TITech MongoDB configuration requires MONGO_URI or a permitted fallback URI.',
        });

    } else if (
        selectedUri
    ) {

        const context =
            validateUriSyntax(
                selectedUri,
                collection,
                normalizedOptions,
            );

        if (
            context
        ) {

            if (
                context.protocol ===
                DATABASE_PROTOCOLS.SRV
            ) {

                validateSrvUri(
                    context,
                    collection,
                    normalizedOptions,
                );

            } else {

                validateStandardUri(
                    context,
                    collection,
                    normalizedOptions,
                );
            }

            validateAuthentication(
                context,
                config,
                collection,
                normalizedOptions,
            );

            validateTls(
                context,
                config,
                collection,
                normalizedOptions,
            );

            diagnostics.database =
                buildDatabaseDiagnostics(
                    context,
                    selectedSource,
                    config,
                    normalizedOptions,
                );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Fallback policy
     * -------------------------------------------------------------------------
     */

    if (
        environment ===
        'production' &&
        fallbackUri &&
        primaryUri
    ) {

        /**
         * A fallback can be valid, but production should not silently switch to
         * an unintended local URI. This validator reports the presence as a
         * warning-level operational concern rather than automatically rejecting
         * it.
         */
        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .CONFIGURATION_INCONSISTENT,

            category:
                VALIDATION_CATEGORIES
                    .DATABASE,

            severity:
                VALIDATION_SEVERITIES
                    .WARNING,

            variable:
                'MONGO_URI_FALLBACK',

            environment,

            message:
                'TITech production configuration defines a MongoDB fallback URI; ensure failover policy is explicitly controlled.',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Topology / replica-set policy.
     * -------------------------------------------------------------------------
     */

    const replicaSet =
        normalizeString(
            config.MONGO_REPLICA_SET ||
            config.MONGODB_REPLICA_SET,
        );

    const requireReplicaSet =
        toBoolean(
            config.MONGO_REQUIRE_REPLICA_SET,
            normalizedOptions
                .requireReplicaSetForProduction &&
                environment ===
                    'production',
        );

    if (
        requireReplicaSet &&
        !replicaSet
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
                    .CRITICAL,

            variable:
                'MONGO_REPLICA_SET',

            environment,

            message:
                'TITech database policy requires a MongoDB replica set identifier.',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Pool and timeout policy.
     * -------------------------------------------------------------------------
     */

    const poolDiagnostics =
        validatePoolAndTimeouts(
            config,
            collection,
            normalizedOptions,
        );

    diagnostics.pool =
        poolDiagnostics;

    /**
     * -------------------------------------------------------------------------
     * Auto-indexing policy.
     * -------------------------------------------------------------------------
     */

    const autoIndex =
        toBoolean(
            config.MONGO_AUTO_INDEX ??
            config.MONGOOSE_AUTO_INDEX,
            environment !==
                'production',
        );

    diagnostics.autoIndex =
        autoIndex;

    if (
        environment ===
            'production' &&
        autoIndex
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
                'MONGO_AUTO_INDEX',

            environment,

            message:
                'TITech production MongoDB configuration should normally disable automatic index creation in application startup.',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Retry policy.
     * -------------------------------------------------------------------------
     */

    const maxRetries =
        normalizeInteger(
            config.MONGO_MAX_RETRIES ||
            config.MAX_RETRIES,
            normalizedOptions
                .maxRetries,
        );

    if (
        maxRetries === null ||
        maxRetries < 0 ||
        maxRetries >
            normalizedOptions
                .maxRetries
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
                'MONGO_MAX_RETRIES',

            expected:
                {
                    min:
                        0,

                    max:
                        normalizedOptions
                            .maxRetries,
                },

            actual:
                config.MONGO_MAX_RETRIES ||
                config.MAX_RETRIES,

            message:
                'TITech MongoDB maximum retry count is outside the supported range.',
        });
    }

    const retryDelayMs =
        normalizeInteger(
            config.MONGO_RETRY_DELAY_MS ||
            config.INITIAL_RETRY_DELAY_MS,
            normalizedOptions
                .retryDelayMs,
        );

    const maxRetryDelayMs =
        normalizeInteger(
            config.MONGO_MAX_RETRY_DELAY_MS ||
            config.MAX_RETRY_DELAY_MS,
            normalizedOptions
                .maxRetryDelayMs,
        );

    if (
        retryDelayMs !==
            null &&
        maxRetryDelayMs !==
            null &&
        retryDelayMs >
            maxRetryDelayMs
    ) {

        collection.addIssue({
            code:
                VALIDATION_ERROR_CODES
                    .CONFIGURATION_INCONSISTENT,

            category:
                VALIDATION_CATEGORIES
                    .DATABASE,

            severity:
                VALIDATION_SEVERITIES
                    .ERROR,

            variable:
                'MONGO_RETRY_DELAY_MS',

            expected:
                {
                    maxRetryDelayMs,
                },

            actual:
                retryDelayMs,

            message:
                'TITech MongoDB retry delay cannot exceed maximum retry delay.',
        });
    }

    diagnostics.retry =
        {
            maxRetries,

            retryDelayMs,

            maxRetryDelayMs,
        };

    /**
     * -------------------------------------------------------------------------
     * TLS/SSL environment controls.
     * -------------------------------------------------------------------------
     */

    const tlsEnabled =
        toBoolean(
            config.MONGO_TLS ??
            config.MONGODB_TLS ??
            config.MONGO_SSL,
            null,
        );

    diagnostics.tls =
        {
            enabled:
                tlsEnabled,
        };

    if (
        environment ===
            'production' &&
        normalizedOptions
            .requireProductionTls &&
        tlsEnabled ===
            false
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
                'MONGO_TLS',

            environment,

            message:
                'TITech production MongoDB TLS must not be explicitly disabled.',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Connection database name.
     * -------------------------------------------------------------------------
     */

    const explicitDatabaseName =
        normalizeString(
            config.MONGO_DB_NAME ||
            config.MONGODB_DATABASE ||
            config.DATABASE_NAME,
        );

    diagnostics.databaseName =
        explicitDatabaseName;

    if (
        !explicitDatabaseName &&
        selectedUri
    ) {

        const context =
            safelyParseMongoUri(
                selectedUri,
            );

        const databaseName =
            getMongoDatabaseName(
                context,
            );

        if (
            databaseName
        ) {

            diagnostics.databaseName =
                databaseName;
        } else if (
            !normalizedOptions
                .allowEmptyDatabaseName
        ) {

            /**
             * Atlas and MongoDB URIs can legitimately omit a database name,
             * depending on application behavior. We therefore emit a warning
             * unless an organization-level policy explicitly disallows this.
             */
            collection.addIssue({
                code:
                    VALIDATION_ERROR_CODES
                        .INVALID_VALUE,

                category:
                    VALIDATION_CATEGORIES
                        .DATABASE,

                severity:
                    VALIDATION_SEVERITIES
                        .WARNING,

                variable:
                    selectedSource ||
                    'MONGO_URI',

                environment,

                message:
                    'TITech MongoDB URI does not specify an explicit database name.',
            });
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Database name safety.
     * -------------------------------------------------------------------------
     */

    const databaseName =
        explicitDatabaseName ||
        diagnostics.databaseName;

    if (
        databaseName
    ) {

        if (
            databaseName.length >
            63
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
                    'MONGO_DB_NAME',

                environment,

                message:
                    'TITech MongoDB database name is too long.',
            });
        }

        if (
            /[\0/\\]/.test(
                databaseName,
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
                    'MONGO_DB_NAME',

                environment,

                message:
                    'TITech MongoDB database name contains invalid characters.',
            });
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Build final result.
     * -------------------------------------------------------------------------
     */

    const summary =
        collection.summary();

    const blockingErrors =
        collection
            .getBlockingErrors();

    const status =
        blockingErrors.length >
        0
            ? 'invalid'
            : summary.warnings >
                0
                ? 'degraded'
                : 'valid';

    const safeUri =
        selectedUri
            ? redactMongoUri(
                selectedUri,
            )
            : null;

    const result = {
        valid:
            blockingErrors.length ===
            0,

        ready:
            blockingErrors.length ===
            0,

        status,

        database:
            DATABASE_TYPES.MONGODB,

        environment,

        selectedSource,

        uri:
            safeUri,

        summary,

        diagnostics:

            sanitizeDiagnostics(
                diagnostics,
            ),

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

                    selectedSource,

                    uri:
                        safeUri,

                    diagnostics:
                        sanitizeDiagnostics(
                            diagnostics,
                        ),

                    errorCodes:
                        collection
                            .errors
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
                    'TITech database configuration validation failed.',

                environment,

                component:
                    COMPONENT,

                code:
                    'TITECH_DATABASE_CONFIGURATION_INVALID',
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

function sanitizeDiagnostics(
    diagnostics,
) {

    const output =
        clone(
            diagnostics,
        );

    if (
        output.uri
    ) {

        output.uri =
            redactMongoUri(
                output.uri,
            );
    }

    return output;
}

/**
 * =============================================================================
 * Full environment-config validator
 * =============================================================================
 */

class DatabaseValidator {

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
     * Validate configuration.
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
                validateDatabaseConfiguration(
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

                    status:
                        result.status,

                    errorCount:
                        result.summary
                            .total,
                },
                result.valid
                    ? 'TITech database configuration validation completed.'
                    : 'TITech database configuration validation failed.',
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
     * Validate production policy.
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

                requireProductionTls:
                    true,

                requireProductionAuthentication:
                    true,

                failClosed:
                    options.failClosed ??
                    true,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Validate staging policy.
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
     * Check URI only.
     * -------------------------------------------------------------------------
     */

    validateUri(
        uri,
        options = {},
    ) {

        const config =
            {
                ...options,

                MONGO_URI:
                    uri,
            };

        return this.validate(
            config,
            options,
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

const databaseValidator =
    new DatabaseValidator();

/**
 * =============================================================================
 * Convenience API
 * =============================================================================
 */

function validate(
    config,
    options,
) {

    return databaseValidator.validate(
        config,
        options,
    );
}

function validateEnvironment(
    options,
) {

    return databaseValidator.validateEnvironment(
        options,
    );
}

function check(
    config,
    options,
) {

    return databaseValidator.check(
        config,
        options,
    );
}

function validateProduction(
    config,
    options,
) {

    return databaseValidator.validateProduction(
        config,
        options,
    );
}

function validateStaging(
    config,
    options,
) {

    return databaseValidator.validateStaging(
        config,
        options,
    );
}

function validateUri(
    uri,
    options,
) {

    return databaseValidator.validateUri(
        uri,
        options,
    );
}

function snapshot() {

    return databaseValidator.snapshot();
}

function readiness() {

    return databaseValidator.readiness();
}

function health() {

    return databaseValidator.health();
}

function reset() {

    return databaseValidator.reset();
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
        databaseValidator,

        DatabaseValidator,

        DatabaseValidatorError,

        /**
         * Constants.
         */
        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        DATABASE_PROTOCOLS,

        DATABASE_TYPES,

        DATABASE_AUTH_MODES,

        DEFAULTS,

        /**
         * Validation.
         */
        validate,

        validateEnvironment,

        validateProduction,

        validateStaging,

        validateUri,

        check,

        /**
         * Lower-level validator.
         */
        validateDatabaseConfiguration,

        /**
         * URI utilities.
         */
        redactMongoUri,

        getProtocol,

        isMongoProtocol,

        isSrvProtocol,

        isStandardMongoProtocol,

        getMongoDatabaseName,

        parseStandardMongoHosts,

        /**
         * Diagnostics/lifecycle.
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