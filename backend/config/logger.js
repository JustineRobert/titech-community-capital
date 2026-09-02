'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/logger.js
 *
 * Purpose:
 *   Enterprise production-grade logging configuration and policy boundary.
 *
 * Responsibilities:
 *   - Centralize logger configuration.
 *   - Define log levels and environment-aware defaults.
 *   - Define structured logging policy.
 *   - Define sensitive-field redaction policy.
 *   - Define correlation/request/trace context policy.
 *   - Define development/prod formatting policy.
 *   - Define log transport configuration.
 *   - Define log retention/buffering controls.
 *   - Define safe diagnostics.
 *   - Provide compatibility with bootstrap/logger.js.
 *   - Keep logger policy separate from the actual logger implementation.
 *
 * IMPORTANT:
 *
 *   This file owns LOGGER CONFIGURATION.
 *
 *   It does NOT:
 *     - create a Pino/Winston logger instance.
 *     - write logs directly.
 *     - initialize transports.
 *     - register HTTP middleware.
 *     - persist audit events.
 *     - implement observability metrics.
 *     - expose secrets.
 *
 * Canonical implementation:
 *
 *   backend/bootstrap/logger.js
 *
 * Canonical configuration:
 *
 *   backend/config/logger.js
 *
 * =============================================================================
 *
 * Architecture:
 *
 *   process.env
 *       ↓
 *   environment.js
 *       ↓
 *   defaults.js
 *       ↓
 *   config/logger.js
 *       ↓
 *   bootstrap/logger.js
 *       ↓
 *   application / services / infrastructure
 *
 * =============================================================================
 */

const os =
    require('node:os');

/**
 * =============================================================================
 * Optional configuration provider
 * =============================================================================
 */

let configProvider =
    null;

try {

    // eslint-disable-next-line global-require
    configProvider =
        require('./configProvider');

} catch {

    configProvider =
        null;

}

/**
 * =============================================================================
 * Optional logger integration
 * =============================================================================
 *
 * Deliberately do NOT require bootstrap/logger.js here.
 *
 * That would create:
 *
 *   config/logger.js
 *       ↓
 *   bootstrap/logger.js
 *       ↓
 *   config/logger.js
 *
 * and could create a circular initialization dependency.
 *
 * This module is configuration-only.
 * =============================================================================
 */

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const COMPONENT =
    'logger-config';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

const LOGGER_STATES =
    Object.freeze({

        ENABLED:
            'enabled',

        DISABLED:
            'disabled',

        DEGRADED:
            'degraded',

        INVALID:
            'invalid'

    });

const LOG_LEVELS =
    Object.freeze([
        'fatal',
        'error',
        'warn',
        'info',
        'debug',
        'trace',
        'silent'
    ]);

const LOG_FORMATS =
    Object.freeze({

        JSON:
            'json',

        PRETTY:
            'pretty',

        TEXT:
            'text'

    });

const TRANSPORT_TYPES =
    Object.freeze({

        STDOUT:
            'stdout',

        STDERR:
            'stderr',

        FILE:
            'file',

        HTTP:
            'http'

    });

/**
 * =============================================================================
 * Default configuration
 * =============================================================================
 */

const DEFAULTS =
    Object.freeze({

        enabled:
            true,

        level:
            'info',

        format:
            'json',

        pretty:
            false,

        colorize:
            false,

        timestamps:
            true,

        messageKey:
            'message',

        levelKey:
            'level',

        timeKey:
            'time',

        serviceKey:
            'service',

        applicationKey:
            'application',

        environmentKey:
            'environment',

        componentKey:
            'component',

        requestIdKey:
            'requestId',

        correlationIdKey:
            'correlationId',

        traceIdKey:
            'traceId',

        spanIdKey:
            'spanId',

        tenantIdKey:
            'tenantId',

        actorIdKey:
            'actorId',

        userIdKey:
            'userId',

        operationKey:
            'operation',

        errorKey:
            'err',

        /**
         * Development logs may be human friendly.
         */
        developmentPretty:
            true,

        /**
         * Production remains structured and machine-readable.
         */
        productionPretty:
            false,

        /**
         * Do not serialize arbitrary request bodies by default.
         */
        includeRequestBody:
            false,

        includeResponseBody:
            false,

        includeHeaders:
            true,

        includeUserAgent:
            true,

        includeRemoteAddress:
            true,

        includeRequestQuery:
            false,

        includeRequestParams:
            false,

        /**
         * Redaction policy.
         */
        redactEnabled:
            true,

        redactReplacement:
            '[REDACTED]',

        redactCaseInsensitive:
            true,

        /**
         * Runtime buffer/transport controls.
         */
        sync:
            false,

        flushIntervalMs:
            1_000,

        maxBatchSize:
            100,

        maxBufferSize:
            10_000,

        /**
         * File transport defaults.
         */
        fileEnabled:
            false,

        filePath:
            './logs/titech.log',

        fileMaxSizeBytes:
            50 * 1024 * 1024,

        fileMaxFiles:
            10,

        /**
         * Remote transport.
         */
        remoteEnabled:
            false,

        remoteTimeoutMs:
            5_000,

        remoteRetryAttempts:
            3,

        remoteBatchSize:
            100,

        /**
         * Request logging.
         */
        requestLogging:
            true,

        requestLoggingLevel:
            'info',

        slowRequestLogging:
            true,

        slowRequestThresholdMs:
            1_000,

        /**
         * Error logging.
         */
        includeStack:
            true,

        includeErrorCause:
            true,

        includeErrorCode:
            true,

        includeErrorStatus:
            true,

        /**
         * Security.
         */
        allowSensitiveLogs:
            false,

        allowProductionDebug:
            false,

        /**
         * Context.
         */
        contextEnabled:
            true,

        asyncContextEnabled:
            true,

        /**
         * Operational diagnostics.
         */
        diagnosticsEnabled:
            true,

        /**
         * Graceful shutdown.
         */
        shutdownFlushTimeoutMs:
            10_000

    });

/**
 * =============================================================================
 * Redaction policy
 * =============================================================================
 */

const REDACT_KEYS =
    Object.freeze([
        'password',
        'passcode',
        'pin',
        'otp',

        'token',
        'accessToken',
        'refreshToken',
        'idToken',

        'authorization',
        'proxy-authorization',

        'cookie',
        'set-cookie',

        'secret',
        'apiKey',
        'api_key',
        'apikey',

        'clientSecret',
        'client_secret',

        'privateKey',
        'private_key',

        'encryptionKey',
        'encryption_key',

        'jwt',
        'jwtSecret',
        'sessionSecret',

        'cardNumber',
        'card_number',
        'pan',

        'cvv',
        'cvc',

        'accountPassword',

        'databasePassword',
        'redisPassword',

        'connectionString',
        'databaseUrl',
        'databaseUri',

        'mongoUri',
        'mongodbUri',

        'redisUri',
        'redisUrl',

        'smtpPassword',

        'awsSecretAccessKey',
        'gcpPrivateKey',

        'signature',

        'securityAnswer',
        'recoveryCode',

        'mfaSecret',
        'totpSecret'
    ]);

const REDACT_KEY_PATTERN =
    /(password|passcode|pin|otp|token|secret|authorization|cookie|api[_-]?key|private[_-]?key|encryption[_-]?key|credential|connection|string|database[_-]?(url|uri|password)|mongo(db)?[_-]?uri|redis[_-]?(url|uri|password)|jwt|session[_-]?secret|card[_-]?number|pan|cvv|cvc|signature|mfa|totp)/i;

/**
 * =============================================================================
 * Header redaction
 * =============================================================================
 */

const REDACT_HEADERS =
    Object.freeze([
        'authorization',
        'proxy-authorization',
        'cookie',
        'set-cookie',
        'x-api-key',
        'x-auth-token',
        'x-access-token',
        'x-refresh-token'
    ]);

/**
 * =============================================================================
 * Environment access
 * =============================================================================
 */

function env(
    key,
    fallback = undefined
) {

    const value =
        process.env[key];

    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {

        return fallback;

    }

    return String(
        value
    ).trim();

}

function asBoolean(
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
        typeof value ===
        'boolean'
    ) {

        return value;

    }

    const normalized =
        String(
            value
        )
            .trim()
            .toLowerCase();

    if (
        [
            '1',
            'true',
            'yes',
            'on',
            'enabled'
        ].includes(
            normalized
        )
    ) {

        return true;

    }

    if (
        [
            '0',
            'false',
            'no',
            'off',
            'disabled'
        ].includes(
            normalized
        )
    ) {

        return false;

    }

    return fallback;

}

function asPositiveInteger(
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

    const parsed =
        Number(
            value
        );

    if (
        !Number.isInteger(
            parsed
        ) ||
        parsed <= 0
    ) {

        return fallback;

    }

    return parsed;

}

function asString(
    value,
    fallback
) {

    if (
        value === undefined ||
        value === null
    ) {

        return fallback;

    }

    const normalized =
        String(
            value
        ).trim();

    return (
        normalized ||
        fallback
    );

}

function asList(
    value,
    fallback = []
) {

    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {

        return [
            ...fallback
        ];

    }

    const source =
        Array.isArray(
            value
        )
            ? value
            : String(
                value
            ).split(',');

    return [
        ...new Set(
            source
                .map(
                    item =>
                        String(
                            item
                        ).trim()
                )
                .filter(Boolean)
        )
    ];

}

function toEnum(
    value,
    allowed,
    fallback
) {

    const normalized =
        asString(
            value,
            fallback
        );

    const matched =
        allowed.find(
            item =>
                String(
                    item
                ).toLowerCase() ===
                String(
                    normalized
                ).toLowerCase()
        );

    return (
        matched ||
        fallback
    );

}

function deepFreeze(
    object,
    seen = new WeakSet()
) {

    if (
        object === null ||
        object === undefined ||
        typeof object !==
            'object'
    ) {

        return object;

    }

    if (
        seen.has(
            object
        )
    ) {

        return object;

    }

    seen.add(
        object
    );

    for (
        const key of
        Reflect.ownKeys(
            object
        )
    ) {

        try {

            deepFreeze(
                object[key],
                seen
            );

        } catch {

            // Best effort.

        }

    }

    try {

        Object.freeze(
            object
        );

    } catch {

        // Best effort.

    }

    return object;

}

function getEnvironment() {

    try {

        if (
            typeof configProvider?.getEnvironment ===
                'function'
        ) {

            return configProvider.getEnvironment();

        }

        if (
            typeof configProvider?.get ===
                'function'
        ) {

            return configProvider.get(
                'app.environment',
                process.env.NODE_ENV ||
                    'development'
            );

        }

    } catch {

        // Fall through.

    }

    return (
        process.env.NODE_ENV ||
        'development'
    );

}

function isProduction() {

    return (
        getEnvironment() ===
        'production'
    );

}

/**
 * =============================================================================
 * Configuration builder
 * =============================================================================
 */

function createLoggerConfig(
    input = {}
) {

    const source =
        input.logger ||
        input;

    const environment =
        asString(
            source.environment,
            getEnvironment()
        );

    const development =
        environment ===
        'development';

    const test =
        environment ===
        'test';

    const production =
        environment ===
        'production';

    const configuredLevel =
        toEnum(
            source.level ??
                env(
                    'LOG_LEVEL'
                ),
            LOG_LEVELS,
            production
                ? 'info'
                : development
                    ? 'debug'
                    : 'info'
        );

    const configuredFormat =
        toEnum(
            source.format ??
                env(
                    'LOG_FORMAT'
                ),
            Object.values(
                LOG_FORMATS
            ),
            production
                ? LOG_FORMATS.JSON
                : LOG_FORMATS.PRETTY
        );

    const pretty =
        source.pretty ??
        asBoolean(
            env(
                'LOG_PRETTY'
            ),
            development &&
                !test
        );

    const logFilePath =
        asString(
            source.filePath ??
                env(
                    'LOG_FILE_PATH'
                ),
            DEFAULTS.filePath
        );

    const remoteUrl =
        asString(
            source.remoteUrl ??
                env(
                    'LOG_REMOTE_URL'
                ),
            null
        );

    const config = {

        /**
         * ---------------------------------------------------------------------
         * Identity
         * ---------------------------------------------------------------------
         */

        component:
            COMPONENT,

        serviceName:
            asString(
                source.serviceName ??
                    env(
                        'SERVICE_NAME'
                    ),
                SERVICE_NAME
            ),

        applicationName:
            asString(
                source.applicationName ??
                    env(
                        'APP_NAME'
                    ),
                APPLICATION_NAME
            ),

        version:
            asString(
                source.version ??
                    env(
                        'APP_VERSION'
                    ),
                env(
                    'npm_package_version',
                    '0.0.0'
                )
            ),

        environment,

        hostname:
            os.hostname(),

        /**
         * ---------------------------------------------------------------------
         * Core
         * ---------------------------------------------------------------------
         */

        enabled:
            source.enabled ??
            asBoolean(
                env(
                    'LOGGER_ENABLED'
                ),
                DEFAULTS.enabled
            ),

        level:
            configuredLevel,

        format:
            configuredFormat,

        pretty:
            Boolean(
                pretty
            ),

        colorize:
            source.colorize ??
            asBoolean(
                env(
                    'LOG_COLORIZE'
                ),
                development
            ),

        timestamps:
            source.timestamps ??
            asBoolean(
                env(
                    'LOG_TIMESTAMPS'
                ),
                DEFAULTS.timestamps
            ),

        messageKey:
            asString(
                source.messageKey ??
                    env(
                        'LOG_MESSAGE_KEY'
                    ),
                DEFAULTS.messageKey
            ),

        levelKey:
            asString(
                source.levelKey ??
                    env(
                        'LOG_LEVEL_KEY'
                    ),
                DEFAULTS.levelKey
            ),

        timeKey:
            asString(
                source.timeKey ??
                    env(
                        'LOG_TIME_KEY'
                    ),
                DEFAULTS.timeKey
            ),

        /**
         * ---------------------------------------------------------------------
         * Context
         * ---------------------------------------------------------------------
         */

        context:
            {
                enabled:
                    source.contextEnabled ??
                    asBoolean(
                        env(
                            'LOG_CONTEXT_ENABLED'
                        ),
                        DEFAULTS.contextEnabled
                    ),

                asyncLocalStorage:
                    source.asyncContextEnabled ??
                    asBoolean(
                        env(
                            'LOG_ASYNC_CONTEXT_ENABLED'
                        ),
                        DEFAULTS.asyncContextEnabled
                    ),

                requestIdKey:
                    asString(
                        source.requestIdKey ??
                            env(
                                'REQUEST_ID_HEADER'
                            ),
                        DEFAULTS.requestIdKey
                    ),

                correlationIdKey:
                    asString(
                        source.correlationIdKey ??
                            env(
                                'CORRELATION_ID_HEADER'
                            ),
                        DEFAULTS.correlationIdKey
                    ),

                traceIdKey:
                    asString(
                        source.traceIdKey ??
                            env(
                                'TRACE_ID_FIELD'
                            ),
                        DEFAULTS.traceIdKey
                    ),

                spanIdKey:
                    asString(
                        source.spanIdKey ??
                            env(
                                'SPAN_ID_FIELD'
                            ),
                        DEFAULTS.spanIdKey
                    ),

                tenantIdKey:
                    asString(
                        source.tenantIdKey ??
                            env(
                                'TENANT_ID_FIELD'
                            ),
                        DEFAULTS.tenantIdKey
                    ),

                actorIdKey:
                    asString(
                        source.actorIdKey ??
                            env(
                                'ACTOR_ID_FIELD'
                            ),
                        DEFAULTS.actorIdKey
                    ),

                userIdKey:
                    asString(
                        source.userIdKey ??
                            env(
                                'USER_ID_FIELD'
                            ),
                        DEFAULTS.userIdKey
                    ),

                operationKey:
                    asString(
                        source.operationKey ??
                            env(
                                'OPERATION_FIELD'
                            ),
                        DEFAULTS.operationKey
                    )
            },

        /**
         * ---------------------------------------------------------------------
         * Redaction
         * ---------------------------------------------------------------------
         */

        redaction:
            {
                enabled:
                    source.redactEnabled ??
                    asBoolean(
                        env(
                            'LOG_REDACTION_ENABLED'
                        ),
                        DEFAULTS.redactEnabled
                    ),

                replacement:
                    asString(
                        source.redactReplacement ??
                            env(
                                'LOG_REDACTION_REPLACEMENT'
                            ),
                        DEFAULTS.redactReplacement
                    ),

                caseInsensitive:
                    source.redactCaseInsensitive ??
                    asBoolean(
                        env(
                            'LOG_REDACTION_CASE_INSENSITIVE'
                        ),
                        DEFAULTS.redactCaseInsensitive
                    ),

                keys:
                    asList(
                        source.redactKeys ??
                            env(
                                'LOG_REDACT_KEYS'
                            ),
                        REDACT_KEYS
                    ),

                keyPattern:
                    REDACT_KEY_PATTERN,

                headers:
                    asList(
                        source.redactHeaders ??
                            env(
                                'LOG_REDACT_HEADERS'
                            ),
                        REDACT_HEADERS
                    )
            },

        /**
         * ---------------------------------------------------------------------
         * Request logging
         * ---------------------------------------------------------------------
         */

        request:
            {
                enabled:
                    source.requestLogging ??
                    asBoolean(
                        env(
                            'ENABLE_REQUEST_LOGGING'
                        ),
                        DEFAULTS.requestLogging
                    ),

                level:
                    toEnum(
                        source.requestLoggingLevel ??
                            env(
                                'REQUEST_LOG_LEVEL'
                            ),
                        LOG_LEVELS,
                        DEFAULTS.requestLoggingLevel
                    ),

                includeRequestBody:
                    source.includeRequestBody ??
                    asBoolean(
                        env(
                            'LOG_INCLUDE_REQUEST_BODY'
                        ),
                        DEFAULTS.includeRequestBody
                    ),

                includeResponseBody:
                    source.includeResponseBody ??
                    asBoolean(
                        env(
                            'LOG_INCLUDE_RESPONSE_BODY'
                        ),
                        DEFAULTS.includeResponseBody
                    ),

                includeHeaders:
                    source.includeHeaders ??
                    asBoolean(
                        env(
                            'LOG_INCLUDE_HEADERS'
                        ),
                        DEFAULTS.includeHeaders
                    ),

                includeQuery:
                    source.includeRequestQuery ??
                    asBoolean(
                        env(
                            'LOG_INCLUDE_REQUEST_QUERY'
                        ),
                        DEFAULTS.includeRequestQuery
                    ),

                includeParams:
                    source.includeRequestParams ??
                    asBoolean(
                        env(
                            'LOG_INCLUDE_REQUEST_PARAMS'
                        ),
                        DEFAULTS.includeRequestParams
                    ),

                includeUserAgent:
                    source.includeUserAgent ??
                    asBoolean(
                        env(
                            'LOG_INCLUDE_USER_AGENT'
                        ),
                        DEFAULTS.includeUserAgent
                    ),

                includeRemoteAddress:
                    source.includeRemoteAddress ??
                    asBoolean(
                        env(
                            'LOG_INCLUDE_REMOTE_ADDRESS'
                        ),
                        DEFAULTS.includeRemoteAddress
                    ),

                slowRequestLogging:
                    source.slowRequestLogging ??
                    asBoolean(
                        env(
                            'SLOW_REQUEST_LOGGING'
                        ),
                        DEFAULTS.slowRequestLogging
                    ),

                slowRequestThresholdMs:
                    asPositiveInteger(
                        source.slowRequestThresholdMs ??
                            env(
                                'SLOW_REQUEST_THRESHOLD_MS'
                            ),
                        DEFAULTS.slowRequestThresholdMs
                    )
            },

        /**
         * ---------------------------------------------------------------------
         * Error logging
         * ---------------------------------------------------------------------
         */

        errors:
            {
                includeStack:
                    source.includeStack ??
                    asBoolean(
                        env(
                            'LOG_INCLUDE_STACK'
                        ),
                        DEFAULTS.includeStack
                    ),

                includeCause:
                    source.includeErrorCause ??
                    asBoolean(
                        env(
                            'LOG_INCLUDE_ERROR_CAUSE'
                        ),
                        DEFAULTS.includeErrorCause
                    ),

                includeCode:
                    source.includeErrorCode ??
                    asBoolean(
                        env(
                            'LOG_INCLUDE_ERROR_CODE'
                        ),
                        DEFAULTS.includeErrorCode
                    ),

                includeStatus:
                    source.includeErrorStatus ??
                    asBoolean(
                        env(
                            'LOG_INCLUDE_ERROR_STATUS'
                        ),
                        DEFAULTS.includeErrorStatus
                    ),

                errorKey:
                    asString(
                        source.errorKey ??
                            env(
                                'LOG_ERROR_KEY'
                            ),
                        DEFAULTS.errorKey
                    )
            },

        /**
         * ---------------------------------------------------------------------
         * Transport
         * ---------------------------------------------------------------------
         */

        transport:
            {
                type:
                    toEnum(
                        source.transport ??
                            env(
                                'LOG_TRANSPORT'
                            ),
                        Object.values(
                            TRANSPORT_TYPES
                        ),
                        development
                            ? TRANSPORT_TYPES.STDOUT
                            : TRANSPORT_TYPES.STDOUT
                    ),

                stdout:
                    {
                        enabled:
                            source.stdoutEnabled ??
                            asBoolean(
                                env(
                                    'LOG_STDOUT_ENABLED'
                                ),
                                true
                            )
                    },

                stderr:
                    {
                        enabled:
                            source.stderrEnabled ??
                            asBoolean(
                                env(
                                    'LOG_STDERR_ENABLED'
                                ),
                                true
                            )
                    },

                file:
                    {
                        enabled:
                            source.fileEnabled ??
                            asBoolean(
                                env(
                                    'LOG_FILE_ENABLED'
                                ),
                                DEFAULTS.fileEnabled
                            ),

                        path:
                            logFilePath,

                        maxSizeBytes:
                            asPositiveInteger(
                                source.fileMaxSizeBytes ??
                                    env(
                                        'LOG_FILE_MAX_SIZE_BYTES'
                                    ),
                                DEFAULTS.fileMaxSizeBytes
                            ),

                        maxFiles:
                            asPositiveInteger(
                                source.fileMaxFiles ??
                                    env(
                                        'LOG_FILE_MAX_FILES'
                                    ),
                                DEFAULTS.fileMaxFiles
                            )
                    },

                remote:
                    {
                        enabled:
                            source.remoteEnabled ??
                            asBoolean(
                                env(
                                    'LOG_REMOTE_ENABLED'
                                ),
                                DEFAULTS.remoteEnabled
                            ),

                        url:
                            remoteUrl,

                        timeoutMs:
                            asPositiveInteger(
                                source.remoteTimeoutMs ??
                                    env(
                                        'LOG_REMOTE_TIMEOUT_MS'
                                    ),
                                DEFAULTS.remoteTimeoutMs
                            ),

                        retryAttempts:
                            asPositiveInteger(
                                source.remoteRetryAttempts ??
                                    env(
                                        'LOG_REMOTE_RETRY_ATTEMPTS'
                                    ),
                                DEFAULTS.remoteRetryAttempts
                            ),

                        batchSize:
                            asPositiveInteger(
                                source.remoteBatchSize ??
                                    env(
                                        'LOG_REMOTE_BATCH_SIZE'
                                    ),
                                DEFAULTS.remoteBatchSize
                            )
                    }
            },

        /**
         * ---------------------------------------------------------------------
         * Buffering
         * ---------------------------------------------------------------------
         */

        buffering:
            {
                sync:
                    source.sync ??
                    asBoolean(
                        env(
                            'LOG_SYNC'
                        ),
                        DEFAULTS.sync
                    ),

                flushIntervalMs:
                    asPositiveInteger(
                        source.flushIntervalMs ??
                            env(
                                'LOG_FLUSH_INTERVAL_MS'
                            ),
                        DEFAULTS.flushIntervalMs
                    ),

                maxBatchSize:
                    asPositiveInteger(
                        source.maxBatchSize ??
                            env(
                                'LOG_MAX_BATCH_SIZE'
                            ),
                        DEFAULTS.maxBatchSize
                    ),

                maxBufferSize:
                    asPositiveInteger(
                        source.maxBufferSize ??
                            env(
                                'LOG_MAX_BUFFER_SIZE'
                            ),
                        DEFAULTS.maxBufferSize
                    )
            },

        /**
         * ---------------------------------------------------------------------
         * Operational controls
         * ---------------------------------------------------------------------
         */

        operational:
            {
                diagnosticsEnabled:
                    source.diagnosticsEnabled ??
                    asBoolean(
                        env(
                            'LOG_DIAGNOSTICS_ENABLED'
                        ),
                        DEFAULTS.diagnosticsEnabled
                    ),

                allowSensitiveLogs:
                    source.allowSensitiveLogs ??
                    asBoolean(
                        env(
                            'ALLOW_SENSITIVE_LOGS'
                        ),
                        DEFAULTS.allowSensitiveLogs
                    ),

                allowProductionDebug:
                    source.allowProductionDebug ??
                    asBoolean(
                        env(
                            'ALLOW_PRODUCTION_DEBUG_LOGGING'
                        ),
                        DEFAULTS.allowProductionDebug
                    ),

                shutdownFlushTimeoutMs:
                    asPositiveInteger(
                        source.shutdownFlushTimeoutMs ??
                            env(
                                'LOG_SHUTDOWN_FLUSH_TIMEOUT_MS'
                            ),
                        DEFAULTS.shutdownFlushTimeoutMs
                    )
            }

    };

    return validateLoggerConfig(
        config
    );

}

/**
 * =============================================================================
 * Configuration validation
 * =============================================================================
 */

function validateLoggerConfig(
    config
) {

    const errors =
        [];

    const warnings =
        [];

    /**
     * -------------------------------------------------------------------------
     * Level
     * -------------------------------------------------------------------------
     */

    if (
        !LOG_LEVELS.includes(
            config.level
        )
    ) {

        errors.push({
            code:
                'LOGGER_LEVEL_INVALID',

            field:
                'level',

            message:
                `Unsupported log level "${config.level}".`
        });

    }

    /**
     * -------------------------------------------------------------------------
     * Format
     * -------------------------------------------------------------------------
     */

    if (
        !Object.values(
            LOG_FORMATS
        ).includes(
            config.format
        )
    ) {

        errors.push({
            code:
                'LOGGER_FORMAT_INVALID',

            field:
                'format'
        });

    }

    /**
     * -------------------------------------------------------------------------
     * Production structured logging
     * -------------------------------------------------------------------------
     */

    if (
        config.environment ===
        'production'
    ) {

        if (
            config.pretty
        ) {

            warnings.push({
                code:
                    'PRODUCTION_PRETTY_LOGGING',

                field:
                    'pretty',

                message:
                    'Pretty logging is enabled in production; structured JSON is recommended.'
            });

        }

        if (
            config.level ===
                'debug' ||
            config.level ===
                'trace'
        ) {

            if (
                !config.operational
                    .allowProductionDebug
            ) {

                errors.push({
                    code:
                        'PRODUCTION_DEBUG_LOGGING_FORBIDDEN',

                    field:
                        'level',

                    message:
                        'TITech production debug/trace logging requires explicit opt-in.'
                });

            }

        }

        if (
            config.operational
                .allowSensitiveLogs
        ) {

            errors.push({
                code:
                    'PRODUCTION_SENSITIVE_LOGGING_FORBIDDEN',

                field:
                    'operational.allowSensitiveLogs',

                message:
                    'Sensitive logging is forbidden in TITech production.'
            });

        }

        if (
            !config.redaction.enabled
        ) {

            errors.push({
                code:
                    'PRODUCTION_LOG_REDACTION_DISABLED',

                field:
                    'redaction.enabled',

                message:
                    'TITech production log redaction must remain enabled.'
            });

        }

        if (
            config.request
                .includeRequestBody
        ) {

            warnings.push({
                code:
                    'PRODUCTION_REQUEST_BODY_LOGGING',

                field:
                    'request.includeRequestBody',

                message:
                    'Request body logging is enabled in production and may expose sensitive business data.'
            });

        }

        if (
            config.request
                .includeResponseBody
        ) {

            warnings.push({
                code:
                    'PRODUCTION_RESPONSE_BODY_LOGGING',

                field:
                    'request.includeResponseBody',

                message:
                    'Response body logging is enabled in production and may expose sensitive data.'
            });

        }

    }

    /**
     * -------------------------------------------------------------------------
     * Credential safety
     * -------------------------------------------------------------------------
     */

    if (
        config.redaction.keys.length ===
        0
    ) {

        warnings.push({
            code:
                'LOGGER_REDACTION_KEYS_EMPTY',

            field:
                'redaction.keys'
        });

    }

    /**
     * -------------------------------------------------------------------------
     * Remote transport
     * -------------------------------------------------------------------------
     */

    if (
        config.transport.remote.enabled &&
        !config.transport.remote.url
    ) {

        errors.push({
            code:
                'REMOTE_LOG_URL_MISSING',

            field:
                'transport.remote.url',

            message:
                'Remote logging is enabled but no remote logger URL is configured.'
        });

    }

    /**
     * -------------------------------------------------------------------------
     * File transport
     * -------------------------------------------------------------------------
     */

    if (
        config.transport.file.enabled &&
        !config.transport.file.path
    ) {

        errors.push({
            code:
                'FILE_LOG_PATH_MISSING',

            field:
                'transport.file.path'
        });

    }

    /**
     * -------------------------------------------------------------------------
     * Request threshold
     * -------------------------------------------------------------------------
     */

    if (
        config.request
            .slowRequestThresholdMs <=
        0
    ) {

        errors.push({
            code:
                'SLOW_REQUEST_THRESHOLD_INVALID',

            field:
                'request.slowRequestThresholdMs'
        });

    }

    /**
     * -------------------------------------------------------------------------
     * Buffer safety
     * -------------------------------------------------------------------------
     */

    if (
        config.buffering.maxBatchSize >
        config.buffering.maxBufferSize
    ) {

        errors.push({
            code:
                'LOGGER_BUFFER_SIZE_INVALID',

            field:
                'buffering',

            message:
                'Log batch size cannot exceed maximum buffer size.'
        });

    }

    if (
        errors.length >
        0
    ) {

        throw new Error(
            `TITech logger configuration validation failed: ${errors
                .map(
                    error =>
                        error.code
                )
                .join(
                    ', '
                )}`
        );

    }

    const state =
        config.enabled
            ? (
                warnings.length >
                0
                    ? LOGGER_STATES.DEGRADED
                    : LOGGER_STATES.ENABLED
            )
            : LOGGER_STATES.DISABLED;

    return deepFreeze({

        ...config,

        state,

        warnings:
            Object.freeze(
                warnings
            )

    });

}

/**
 * =============================================================================
 * Redaction helpers
 * =============================================================================
 */

function shouldRedactKey(
    key,
    config = defaultConfig
) {

    if (
        !config.redaction
            .enabled
    ) {

        return false;

    }

    if (
        !key
    ) {

        return false;

    }

    const normalized =
        String(
            key
        ).trim();

    if (
        config.redaction
            .keys
            .some(
                item =>
                    config.redaction
                        .caseInsensitive
                        ? String(
                            item
                        ).toLowerCase() ===
                            normalized.toLowerCase()
                        : String(
                            item
                        ) ===
                            normalized
            )
    ) {

        return true;

    }

    return config.redaction
        .keyPattern
        .test(
            normalized
        );

}

function shouldRedactHeader(
    key,
    config = defaultConfig
) {

    if (
        !key
    ) {

        return false;

    }

    const normalized =
        String(
            key
        )
            .trim()
            .toLowerCase();

    return config.redaction
        .headers
        .some(
            item =>
                String(
                    item
                ).toLowerCase() ===
                normalized
        );

}

/**
 * =============================================================================
 * Safe object redaction
 * =============================================================================
 */

function redact(
    value,
    options = {},
    state = {
        depth:
            0,

        seen:
            new WeakSet()
    }
) {

    const config =
        options.config ||
        defaultConfig;

    const maxDepth =
        Number.isInteger(
            options.maxDepth
        ) &&
        options.maxDepth >=
            0
            ? options.maxDepth
            : 10;

    if (
        state.depth >
        maxDepth
    ) {

        return '[TRUNCATED]';

    }

    if (
        value ===
            null ||
        value ===
            undefined
    ) {

        return value;

    }

    if (
        typeof value !==
            'object'
    ) {

        return value;

    }

    if (
        state.seen.has(
            value
        )
    ) {

        return '[Circular]';

    }

    state.seen.add(
        value
    );

    if (
        value instanceof
        Date
    ) {

        return value.toISOString();

    }

    if (
        Buffer.isBuffer(
            value
        )
    ) {

        return '[Buffer]';

    }

    if (
        Array.isArray(
            value
        )
    ) {

        return value.map(
            item =>
                redact(
                    item,
                    options,
                    {
                        depth:
                            state.depth + 1,

                        seen:
                            state.seen
                    }
                )
        );

    }

    const output =
        {};

    for (
        const [
            key,
            child
        ] of Object.entries(
            value
        )
    ) {

        if (
            shouldRedactKey(
                key,
                config
            )
        ) {

            output[key] =
                config.redaction
                    .replacement;

            continue;

        }

        output[key] =
            redact(
                child,
                options,
                {
                    depth:
                        state.depth + 1,

                    seen:
                        state.seen
                }
            );

    }

    return output;

}

/**
 * =============================================================================
 * Header redaction
 * =============================================================================
 */

function redactHeaders(
    headers,
    options = {}
) {

    const config =
        options.config ||
        defaultConfig;

    if (
        !headers ||
        typeof headers !==
            'object'
    ) {

        return {};

    }

    const output =
        {};

    for (
        const [
            key,
            value
        ] of Object.entries(
            headers
        )
    ) {

        output[key] =
            shouldRedactHeader(
                key,
                config
            )
                ? config.redaction
                    .replacement
                : value;

    }

    return output;

}

/**
 * =============================================================================
 * Request metadata policy
 * =============================================================================
 */

function getRequestLoggingPolicy(
    config = defaultConfig
) {

    return deepFreeze({

        enabled:
            config.request.enabled,

        level:
            config.request.level,

        includeBody:
            config.request.includeRequestBody,

        includeResponseBody:
            config.request.includeResponseBody,

        includeHeaders:
            config.request.includeHeaders,

        includeQuery:
            config.request.includeQuery,

        includeParams:
            config.request.includeParams,

        includeUserAgent:
            config.request.includeUserAgent,

        includeRemoteAddress:
            config.request.includeRemoteAddress,

        slowRequestLogging:
            config.request.slowRequestLogging,

        slowRequestThresholdMs:
            config.request
                .slowRequestThresholdMs,

        redaction:
            {
                enabled:
                    config.redaction
                        .enabled,

                headerCount:
                    config.redaction
                        .headers
                        .length,

                fieldCount:
                    config.redaction
                        .keys
                        .length
            }

    });

}

/**
 * =============================================================================
 * Error logging policy
 * =============================================================================
 */

function getErrorLoggingPolicy(
    config = defaultConfig
) {

    return deepFreeze({

        includeStack:
            config.errors
                .includeStack,

        includeCause:
            config.errors
                .includeCause,

        includeCode:
            config.errors
                .includeCode,

        includeStatus:
            config.errors
                .includeStatus,

        errorKey:
            config.errors
                .errorKey

    });

}

/**
 * =============================================================================
 * Transport policy
 * =============================================================================
 */

function getTransportConfig(
    config = defaultConfig
) {

    return deepFreeze({

        type:
            config.transport.type,

        stdout:
            {
                enabled:
                    config.transport
                        .stdout
                        .enabled
            },

        stderr:
            {
                enabled:
                    config.transport
                        .stderr
                        .enabled
            },

        file:
            {
                enabled:
                    config.transport
                        .file
                        .enabled,

                path:
                    config.transport
                        .file
                        .path,

                maxSizeBytes:
                    config.transport
                        .file
                        .maxSizeBytes,

                maxFiles:
                    config.transport
                        .file
                        .maxFiles
            },

        remote:
            {
                enabled:
                    config.transport
                        .remote
                        .enabled,

                urlConfigured:
                    Boolean(
                        config.transport
                            .remote
                            .url
                    ),

                timeoutMs:
                    config.transport
                        .remote
                        .timeoutMs,

                retryAttempts:
                    config.transport
                        .remote
                        .retryAttempts,

                batchSize:
                    config.transport
                        .remote
                        .batchSize
            }

    });

}

/**
 * =============================================================================
 * Safe snapshot
 * ============================================================================= */

function getSnapshot(
    config = defaultConfig
) {

    return deepFreeze({

        component:
            COMPONENT,

        service:
            config.serviceName,

        application:
            config.applicationName,

        version:
            config.version,

        environment:
            config.environment,

        hostname:
            config.hostname,

        state:
            config.state,

        enabled:
            config.enabled,

        level:
            config.level,

        format:
            config.format,

        pretty:
            config.pretty,

        colorize:
            config.colorize,

        timestamps:
            config.timestamps,

        context:
            {
                enabled:
                    config.context
                        .enabled,

                asyncLocalStorage:
                    config.context
                        .asyncLocalStorage,

                requestIdKey:
                    config.context
                        .requestIdKey,

                correlationIdKey:
                    config.context
                        .correlationIdKey,

                traceIdKey:
                    config.context
                        .traceIdKey,

                spanIdKey:
                    config.context
                        .spanIdKey,

                tenantIdKey:
                    config.context
                        .tenantIdKey,

                actorIdKey:
                    config.context
                        .actorIdKey,

                operationKey:
                    config.context
                        .operationKey
            },

        redaction:
            {
                enabled:
                    config.redaction
                        .enabled,

                replacement:
                    config.redaction
                        .replacement,

                configuredKeys:
                    config.redaction
                        .keys
                        .length,

                configuredHeaders:
                    config.redaction
                        .headers
                        .length
            },

        request:
            getRequestLoggingPolicy(
                config
            ),

        errors:
            getErrorLoggingPolicy(
                config
            ),

        transport:
            getTransportConfig(
                config
            ),

        buffering:
            {
                sync:
                    config.buffering
                        .sync,

                flushIntervalMs:
                    config.buffering
                        .flushIntervalMs,

                maxBatchSize:
                    config.buffering
                        .maxBatchSize,

                maxBufferSize:
                    config.buffering
                        .maxBufferSize
            },

        operational:
            {
                diagnosticsEnabled:
                    config.operational
                        .diagnosticsEnabled,

                allowSensitiveLogs:
                    config.operational
                        .allowSensitiveLogs,

                allowProductionDebug:
                    config.operational
                        .allowProductionDebug,

                shutdownFlushTimeoutMs:
                    config.operational
                        .shutdownFlushTimeoutMs
            },

        warnings:
            [
                ...(config.warnings ||
                    [])
            ],

        timestamp:
            new Date()
                .toISOString()

    });

}

/**
 * =============================================================================
 * Environment overrides
 * =============================================================================
 */

function getEnvironmentOverrides() {

    const keys = [

        'LOGGER_ENABLED',

        'LOG_LEVEL',

        'LOG_FORMAT',

        'LOG_PRETTY',

        'LOG_COLORIZE',

        'LOG_TIMESTAMPS',

        'LOG_CONTEXT_ENABLED',

        'LOG_ASYNC_CONTEXT_ENABLED',

        'LOG_REDACTION_ENABLED',

        'LOG_REDACT_KEYS',

        'LOG_REDACT_HEADERS',

        'ENABLE_REQUEST_LOGGING',

        'REQUEST_LOG_LEVEL',

        'LOG_INCLUDE_HEADERS',

        'LOG_INCLUDE_USER_AGENT',

        'LOG_INCLUDE_REMOTE_ADDRESS',

        'LOG_INCLUDE_REQUEST_QUERY',

        'LOG_INCLUDE_REQUEST_PARAMS',

        'LOG_INCLUDE_REQUEST_BODY',

        'LOG_INCLUDE_RESPONSE_BODY',

        'SLOW_REQUEST_LOGGING',

        'SLOW_REQUEST_THRESHOLD_MS',

        'LOG_INCLUDE_STACK',

        'LOG_INCLUDE_ERROR_CAUSE',

        'LOG_INCLUDE_ERROR_CODE',

        'LOG_INCLUDE_ERROR_STATUS',

        'LOG_TRANSPORT',

        'LOG_FILE_ENABLED',

        'LOG_FILE_PATH',

        'LOG_FILE_MAX_SIZE_BYTES',

        'LOG_FILE_MAX_FILES',

        'LOG_REMOTE_ENABLED',

        'LOG_REMOTE_TIMEOUT_MS',

        'LOG_REMOTE_RETRY_ATTEMPTS',

        'LOG_REMOTE_BATCH_SIZE',

        'LOG_SYNC',

        'LOG_FLUSH_INTERVAL_MS',

        'LOG_MAX_BATCH_SIZE',

        'LOG_MAX_BUFFER_SIZE',

        'LOG_DIAGNOSTICS_ENABLED',

        'ALLOW_PRODUCTION_DEBUG_LOGGING',

        'LOG_SHUTDOWN_FLUSH_TIMEOUT_MS'

    ];

    const result =
        {};

    for (
        const key of
        keys
    ) {

        result[key] =
            process.env[key];

    }

    /**
     * Never return remote URL if it might include credentials.
     */
    if (
        process.env.LOG_REMOTE_URL
    ) {

        result.LOG_REMOTE_URL =
            '[CONFIGURED]';

    }

    return Object.freeze(
        result
    );

}

/**
 * =============================================================================
 * Bootstrap adapter
 * =============================================================================
 */

async function initialize(
    context = {},
    options = {}
) {

    const config =
        options.config
            ? createLoggerConfig(
                options.config
            )
            : defaultConfig;

    if (
        context &&
        typeof context ===
            'object'
    ) {

        context.loggerConfig =
            config;

        context.logging =
            config;

    }

    return config;

}

async function start(
    context = {},
    options = {}
) {

    return initialize(
        context,
        options
    );

}

async function bootstrap(
    context = {},
    options = {}
) {

    return initialize(
        context,
        options
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
         * Core configuration.
         */
        config:
            defaultConfig,

        logger:
            defaultConfig,

        createLoggerConfig,

        validateLoggerConfig,

        /**
         * Constants.
         */
        DEFAULTS,

        LOG_LEVELS,

        LOG_FORMATS,

        TRANSPORT_TYPES,

        REDACT_KEYS,

        REDACT_HEADERS,

        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        LOGGER_STATES,

        /**
         * Lifecycle compatibility.
         */
        initialize,

        start,

        bootstrap,

        /**
         * Diagnostics.
         */
        getSnapshot,

        getEnvironmentOverrides,

        getRequestLoggingPolicy,

        getErrorLoggingPolicy,

        getTransportConfig,

        /**
         * Redaction.
         */
        shouldRedactKey,

        shouldRedactHeader,

        redact,

        redactHeaders

    });