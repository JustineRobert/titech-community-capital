'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/environment.js
 *
 * Purpose:
 *   Enterprise production-grade environment bootstrap and runtime environment
 *   configuration boundary.
 *
 * Responsibilities:
 *   - Discover dotenv configuration layers.
 *   - Parse dotenv files without unsafe mutation.
 *   - Merge configuration deterministically.
 *   - Preserve deployment environment variables as highest precedence.
 *   - Normalize runtime environment values.
 *   - Validate supported runtime environments.
 *   - Validate critical production configuration.
 *   - Generate a stable non-secret configuration fingerprint.
 *   - Expose runtime feature flags.
 *   - Provide immutable environment configuration.
 *   - Provide safe startup diagnostics.
 *   - Integrate cleanly with the TITech bootstrap/configuration pipeline.
 *
 * IMPORTANT:
 *
 *   This module owns ENVIRONMENT BOOTSTRAPPING.
 *
 *   It does NOT:
 *     - create MongoDB connections.
 *     - create Redis connections.
 *     - initialize Express.
 *     - register middleware.
 *     - initialize business services.
 *     - implement authentication.
 *     - execute financial operations.
 *     - persist audit events.
 *
 * Canonical configuration pipeline:
 *
 *   OS / container environment
 *            ↓
 *       process.env
 *            ↓
 *   backend/config/environment.js
 *            ↓
 *   backend/config/env.js
 *            ↓
 *   backend/config/defaults.js
 *            ↓
 *   backend/config/bootstrapEnvironment.js
 *            ↓
 *   backend/config/index.js
 *            ↓
 *   backend/config/configProvider.js
 *            ↓
 *   ApplicationBootstrap
 *
 * =============================================================================
 */

const fs =
    require('node:fs');

const os =
    require('node:os');

const path =
    require('node:path');

const crypto =
    require('node:crypto');

const process =
    require('node:process');

const dotenv =
    require('dotenv');

/**
 * =============================================================================
 * Optional integrations
 * =============================================================================
 */

let loggerModule =
    null;

try {

    // eslint-disable-next-line global-require
    loggerModule =
        require('../utils/logger');

} catch {

    loggerModule =
        null;

}

let startupErrors =
    null;

try {

    // eslint-disable-next-line global-require
    startupErrors =
        require('../bootstrap/startupErrors');

} catch {

    startupErrors =
        null;

}

/**
 * =============================================================================
 * Enterprise Constants
 * =============================================================================
 */

const COMPONENT =
    'environment';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

const ENVIRONMENT_NAMES =
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

const SUPPORTED_ENVIRONMENTS =
    Object.freeze([
        ENVIRONMENT_NAMES.DEVELOPMENT,
        ENVIRONMENT_NAMES.TEST,
        ENVIRONMENT_NAMES.STAGING,
        ENVIRONMENT_NAMES.PRODUCTION,
    ]);

const DEFAULT_ENVIRONMENT =
    ENVIRONMENT_NAMES.DEVELOPMENT;

const DEFAULT_TIMEZONE =
    'UTC';

const DEFAULT_LOCALE =
    'en-US';

const DEFAULT_ENCODING =
    'utf8';

const DEFAULT_HOST =
    '0.0.0.0';

const DEFAULT_PORT =
    3000;

const DEFAULT_VERSION =
    '0.0.0';

const FINGERPRINT_ALGORITHM =
    'sha256';

const ENVIRONMENT_SCHEMA_VERSION =
    1;

/**
 * =============================================================================
 * Sensitive environment variables
 * =============================================================================
 *
 * These variables can be used during startup but MUST NOT appear in:
 *   - fingerprints
 *   - diagnostics
 *   - logs
 *   - snapshots
 * =============================================================================
 */

const SENSITIVE_VARIABLE_PATTERN =
    /(?:PASSWORD|PASSCODE|PIN|OTP|TOKEN|SECRET|AUTHORIZATION|COOKIE|API[_-]?KEY|CLIENT[_-]?SECRET|PRIVATE[_-]?KEY|ENCRYPTION[_-]?KEY|CREDENTIAL|DSN|MONGO_URI|MONGODB_URI|REDIS_URI|REDIS_URL|DATABASE_URI|DATABASE_URL|CONNECTION_STRING|ACCESS_KEY|SECRET_KEY)/i;

const EXPLICIT_SENSITIVE_VARIABLES =
    Object.freeze([
        'JWT_SECRET',
        'SESSION_SECRET',
        'REFRESH_TOKEN_SECRET',
        'MONGO_URI',
        'MONGODB_URI',
        'MONGO_URI_FALLBACK',
        'MONGODB_URI_FALLBACK',
        'REDIS_URL',
        'REDIS_URI',
        'REDIS_PASSWORD',
        'DATABASE_URL',
        'DATABASE_URI',
        'SMTP_PASSWORD',
        'SMTP_PASS',
        'STRIPE_SECRET_KEY',
        'SENTRY_DSN',
        'AWS_SECRET_ACCESS_KEY',
        'GCP_PRIVATE_KEY',
        'ENCRYPTION_KEY',
    ]);

/**
 * =============================================================================
 * Dotenv loading policy
 * =============================================================================
 *
 * Earlier layers establish defaults.
 * Later dotenv layers override earlier dotenv layers.
 * Real process environment variables always have the final word.
 *
 * Example:
 *
 *   .env
 *      ↓
 *   .env.local
 *      ↓
 *   .env.production
 *      ↓
 *   .env.production.local
 *      ↓
 *   process.env
 *
 * This means deployment/container configuration cannot accidentally be
 * overwritten by a repository-level dotenv file.
 * =============================================================================
 */

const DOTENV_FILENAMES =
    Object.freeze([
        '.env',
        '.env.local',
        '.env.${NODE_ENV}',
        '.env.${NODE_ENV}.local',
    ]);

/**
 * =============================================================================
 * Errors
 * =============================================================================
 */

class EnvironmentBootstrapError extends Error {

    constructor(
        message,
        details = {},
    ) {

        super(
            message,
        );

        this.name =
            'EnvironmentBootstrapError';

        this.code =
            details.code ||
            'ENVIRONMENT_BOOTSTRAP_ERROR';

        this.details =
            Object.freeze({
                ...details,
            });

        Error.captureStackTrace?.(
            this,
            this.constructor,
        );

    }

}

class EnvironmentValidationError
    extends EnvironmentBootstrapError {

    constructor(
        message,
        details = {},
    ) {

        super(
            message,
            {
                ...details,

                code:
                    details.code ||
                    'ENVIRONMENT_VALIDATION_ERROR',
            },
        );

        this.name =
            'EnvironmentValidationError';

    }

}

class EnvironmentConfigurationError
    extends EnvironmentBootstrapError {

    constructor(
        message,
        details = {},
    ) {

        super(
            message,
            {
                ...details,

                code:
                    details.code ||
                    'ENVIRONMENT_CONFIGURATION_ERROR',
            },
        );

        this.name =
            'EnvironmentConfigurationError';

    }

}

/**
 * =============================================================================
 * Utility functions
 * =============================================================================
 */

function isDefined(
    value,
) {

    return (
        value !== undefined &&
        value !== null
    );

}

function isNonEmptyString(
    value,
) {

    return (
        typeof value ===
            'string' &&
        value.trim().length >
            0
    );

}

function normalizeString(
    value,
) {

    if (
        !isDefined(
            value,
        )
    ) {

        return undefined;

    }

    return String(
        value,
    ).trim();

}

function toBoolean(
    value,
    defaultValue = false,
) {

    if (
        !isDefined(
            value,
        )
    ) {

        return defaultValue;

    }

    if (
        typeof value ===
        'boolean'
    ) {

        return value;

    }

    switch (
        String(
            value,
        )
            .trim()
            .toLowerCase()
    ) {

        case '1':
        case 'true':
        case 'yes':
        case 'y':
        case 'on':
        case 'enabled':

            return true;

        case '0':
        case 'false':
        case 'no':
        case 'n':
        case 'off':
        case 'disabled':

            return false;

        default:

            return defaultValue;

    }

}

function toInteger(
    value,
    defaultValue = 0,
) {

    const parsed =
        Number(
            value,
        );

    return Number.isInteger(
        parsed,
    )
        ? parsed
        : defaultValue;

}

function toPositiveInteger(
    value,
    defaultValue = 0,
) {

    const parsed =
        toInteger(
            value,
            defaultValue,
        );

    return parsed >
        0
        ? parsed
        : defaultValue;

}

function toPort(
    value,
    defaultValue = DEFAULT_PORT,
) {

    const parsed =
        toInteger(
            value,
            defaultValue,
        );

    if (
        parsed >= 1 &&
        parsed <= 65_535
    ) {

        return parsed;

    }

    return defaultValue;

}

function toList(
    value,
    defaultValue = [],
) {

    if (
        !isDefined(
            value,
        )
    ) {

        return [
            ...defaultValue,
        ];

    }

    const values =
        Array.isArray(
            value,
        )
            ? value
            : String(
                value,
            ).split(',');

    return [
        ...new Set(
            values
                .map(
                    item =>
                        normalizeString(
                            item,
                        ),
                )
                .filter(
                    Boolean,
                ),
        ),
    ];

}

function toEnum(
    value,
    allowed,
    defaultValue,
) {

    const normalized =
        normalizeString(
            value,
        );

    if (
        !normalized
    ) {

        return defaultValue;

    }

    const match =
        allowed.find(
            item =>
                item.toLowerCase() ===
                normalized.toLowerCase(),
        );

    return (
        match ||
        defaultValue
    );

}

function sha256(
    value,
) {

    return crypto
        .createHash(
            FINGERPRINT_ALGORITHM,
        )
        .update(
            String(
                value,
            ),
            DEFAULT_ENCODING,
        )
        .digest(
            'hex',
        );

}

function deepFreeze(
    object,
    seen = new WeakSet(),
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
            object,
        )
    ) {

        return object;

    }

    seen.add(
        object,
    );

    for (
        const property of
        Reflect.ownKeys(
            object,
        )
    ) {

        try {

            deepFreeze(
                object[property],
                seen,
            );

        } catch {

            // Best effort.

        }

    }

    try {

        Object.freeze(
            object,
        );

    } catch {

        // Best effort.

    }

    return object;

}

function deepClone(
    value,
) {

    if (
        typeof structuredClone ===
        'function'
    ) {

        try {

            return structuredClone(
                value,
            );

        } catch {

            // Fall through.

        }

    }

    if (
        Array.isArray(
            value,
        )
    ) {

        return value.map(
            item =>
                deepClone(
                    item,
                ),
        );

    }

    if (
        value &&
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
                deepClone(
                    item,
                );

        }

        return result;

    }

    return value;

}

function isSensitiveVariable(
    key,
) {

    const normalized =
        String(
            key ||
                '',
        )
            .trim()
            .toUpperCase();

    return (
        EXPLICIT_SENSITIVE_VARIABLES.includes(
            normalized,
        ) ||
        SENSITIVE_VARIABLE_PATTERN.test(
            normalized,
        )
    );

}

function maskVariable(
    key,
    value,
) {

    if (
        isSensitiveVariable(
            key,
        )
    ) {

        if (
            !isDefined(
                value,
            )
        ) {

            return value;

        }

        return '[REDACTED]';

    }

    return value;

}

/**
 * =============================================================================
 * Runtime logger
 * =============================================================================
 */

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
            logger &&
            typeof logger[level] ===
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

            return;

        }

    } catch {

        // Fallback below.

    }

    const line =
        `[${COMPONENT}] ${message}`;

    if (
        level === 'error' ||
        level === 'fatal'
    ) {

        process.stderr.write(
            `${line}\n`,
        );

    } else {

        process.stdout.write(
            `${line}\n`,
        );

    }

}

/**
 * =============================================================================
 * Project root
 * =============================================================================
 *
 * backend/config/environment.js
 * backend/
 * project-root/
 *
 * Therefore:
 *   ../../ from this file => project root.
 * =============================================================================
 */

const PROJECT_ROOT =
    Object.freeze(
        path.resolve(
            __dirname,
            '../..',
        ),
    );

const ENVIRONMENT_DIRECTORY =
    Object.freeze(
        PROJECT_ROOT,
    );

/**
 * =============================================================================
 * Runtime environment name
 * =============================================================================
 */

function getInitialNodeEnvironment() {

    return (
        toEnum(
            process.env.NODE_ENV,
            SUPPORTED_ENVIRONMENTS,
            DEFAULT_ENVIRONMENT,
        ) ||
        DEFAULT_ENVIRONMENT
    );

}

/**
 * =============================================================================
 * Dotenv discovery
 * =============================================================================
 */

function buildDotenvCandidates(
    environment =
        getInitialNodeEnvironment(),
) {

    const names = [
        '.env',
        '.env.local',
        `.env.${environment}`,
        `.env.${environment}.local`,
    ];

    return Object.freeze(
        [
            ...new Set(
                names,
            ),
        ],
    );

}

function resolveEnvironmentFile(
    filename,
) {

    return path.resolve(
        ENVIRONMENT_DIRECTORY,
        filename,
    );

}

function fileExists(
    file,
) {

    try {

        return (
            fs.existsSync(
                file,
            ) &&
            fs.statSync(
                file,
            ).isFile()
        );

    } catch {

        return false;

    }

}

function discoverEnvironmentFiles(
    environment =
        getInitialNodeEnvironment(),
) {

    const candidates =
        buildDotenvCandidates(
            environment,
        );

    const discovered =
        [];

    const visited =
        new Set();

    for (
        const filename of
        candidates
    ) {

        const absolutePath =
            resolveEnvironmentFile(
                filename,
            );

        if (
            visited.has(
                absolutePath,
            )
        ) {

            continue;

        }

        visited.add(
            absolutePath,
        );

        discovered.push({
            filename,

            path:
                absolutePath,

            exists:
                fileExists(
                    absolutePath,
                ),
        });

    }

    return Object.freeze(
        discovered.map(
            item =>
                Object.freeze(
                    item,
                ),
        ),
    );

}

/**
 * =============================================================================
 * Environment load plan
 * =============================================================================
 */

function buildEnvironmentLoadPlan(
    environment =
        getInitialNodeEnvironment(),
) {

    const files =
        discoverEnvironmentFiles(
            environment,
        );

    return Object.freeze({
        rootDirectory:
            PROJECT_ROOT,

        environmentDirectory:
            ENVIRONMENT_DIRECTORY,

        nodeEnvironment:
            environment,

        discoveredFiles:
            files.length,

        availableFiles:
            files.filter(
                file =>
                    file.exists,
            ).length,

        files:
            files,
    });

}

/**
 * =============================================================================
 * Dotenv layer loading
 * =============================================================================
 */

class DotenvLoadResult {

    constructor({
        filename,
        path: filePath,
        loaded,
        variables = {},
        variableCount = 0,
        durationMs = 0,
        error = null,
    }) {

        this.filename =
            filename;

        this.path =
            filePath;

        this.loaded =
            loaded;

        this.variables =
            Object.freeze({
                ...variables,
            });

        this.variableCount =
            variableCount;

        this.durationMs =
            Number(
                durationMs,
            );

        this.error =
            error
                ? Object.freeze({
                    name:
                        error.name,

                    message:
                        error.message,

                    code:
                        error.code,
                })
                : null;

        Object.freeze(
            this,
        );

    }

}

function parseDotenvFile(
    file,
) {

    const startedAt =
        process.hrtime.bigint();

    try {

        const result =
            dotenv.config({
                path:
                    file.path,

                processEnv:
                    {},

                override:
                    false,
            });

        const elapsed =
            Number(
                process.hrtime.bigint() -
                    startedAt,
            ) / 1e6;

        if (
            result.error
        ) {

            return new DotenvLoadResult({
                filename:
                    file.filename,

                path:
                    file.path,

                loaded:
                    false,

                durationMs:
                    elapsed,

                error:
                    result.error,
            });

        }

        const parsed =
            result.parsed ||
            {};

        return new DotenvLoadResult({
            filename:
                file.filename,

            path:
                file.path,

            loaded:
                true,

            variables:
                parsed,

            variableCount:
                Object.keys(
                    parsed,
                ).length,

            durationMs:
                elapsed,
        });

    } catch (
        error
    ) {

        return new DotenvLoadResult({
            filename:
                file.filename,

            path:
                file.path,

            loaded:
                false,

            durationMs:
                Number(
                    process.hrtime.bigint() -
                        startedAt,
                ) / 1e6,

            error,
        });

    }

}

function loadDotenvLayers(
    loadPlan,
) {

    const diagnostics =
        [];

    const loadedLayers =
        [];

    for (
        const file of
        loadPlan.files
    ) {

        const result =
            parseDotenvFile(
                file,
            );

        diagnostics.push(
            result,
        );

        if (
            result.loaded
        ) {

            loadedLayers.push(
                result,
            );

        }

    }

    return Object.freeze({
        loadedLayers:
            Object.freeze(
                loadedLayers,
            ),

        diagnostics:
            Object.freeze(
                diagnostics,
            ),

        successfulLoads:
            loadedLayers.length,

        failedLoads:
            diagnostics.length -
            loadedLayers.length,
    });

}

/**
 * =============================================================================
 * Merge environment layers
 * =============================================================================
 *
 * Deterministic precedence:
 *
 *   .env
 *     < .env.local
 *     < .env.<environment>
 *     < .env.<environment>.local
 *     < deployment process.env
 *
 * Deployment process.env is always authoritative.
 * =============================================================================
 */

function mergeEnvironmentLayers(
    layers,
    processEnvironment =
        process.env,
) {

    const merged =
        {};

    for (
        const layer of
        layers
    ) {

        Object.assign(
            merged,
            layer.variables,
        );

    }

    /**
     * Real runtime environment always wins.
     */
    Object.assign(
        merged,
        processEnvironment,
    );

    return merged;

}

/**
 * =============================================================================
 * Runtime normalization
 * =============================================================================
 */

function normalizeEnvironment(
    source,
) {

    const environment =
        toEnum(
            source.NODE_ENV,
            SUPPORTED_ENVIRONMENTS,
            DEFAULT_ENVIRONMENT,
        );

    const normalized =
        {

            schemaVersion:
                ENVIRONMENT_SCHEMA_VERSION,

            app:
                {
                    name:
                        normalizeString(
                            source.APP_NAME,
                        ) ||
                        APPLICATION_NAME,

                    serviceName:
                        normalizeString(
                            source.SERVICE_NAME,
                        ) ||
                        SERVICE_NAME,

                    version:
                        normalizeString(
                            source.APP_VERSION,
                        ) ||
                        normalizeString(
                            source.npm_package_version,
                        ) ||
                        DEFAULT_VERSION,

                    environment:
                        environment,

                    nodeEnv:
                        environment,

                    timezone:
                        normalizeString(
                            source.TZ,
                        ) ||
                        DEFAULT_TIMEZONE,

                    locale:
                        normalizeString(
                            source.LOCALE,
                        ) ||
                        DEFAULT_LOCALE,

                    encoding:
                        normalizeString(
                            source.ENCODING,
                        ) ||
                        DEFAULT_ENCODING,

                },

            runtime:
                {
                    production:
                        environment ===
                        ENVIRONMENT_NAMES.PRODUCTION,

                    staging:
                        environment ===
                        ENVIRONMENT_NAMES.STAGING,

                    development:
                        environment ===
                        ENVIRONMENT_NAMES.DEVELOPMENT,

                    test:
                        environment ===
                        ENVIRONMENT_NAMES.TEST,

                    nodeVersion:
                        process.versions.node,

                    nodeMajor:
                        toInteger(
                            process.versions.node
                                ?.split(
                                    '.',
                                )[0],
                            0,
                        ),

                    processId:
                        process.pid,

                    hostname:
                        os.hostname(),

                    platform:
                        process.platform,

                    architecture:
                        process.arch,

                },

            server:
                {
                    host:
                        normalizeString(
                            source.HOST,
                        ) ||
                        DEFAULT_HOST,

                    port:
                        toPort(
                            source.PORT,
                            DEFAULT_PORT,
                        ),

                    trustProxy:
                        toBoolean(
                            source.TRUST_PROXY,
                            false,
                        ),

                    bodyLimit:
                        normalizeString(
                            source.BODY_LIMIT,
                        ) ||
                        '1mb',

                    keepAliveTimeoutMs:
                        toPositiveInteger(
                            source.HTTP_KEEP_ALIVE_TIMEOUT_MS,
                            65_000,
                        ),

                    headersTimeoutMs:
                        toPositiveInteger(
                            source.HTTP_HEADERS_TIMEOUT_MS,
                            66_000,
                        ),

                    requestTimeoutMs:
                        toPositiveInteger(
                            source.HTTP_REQUEST_TIMEOUT_MS,
                            30_000,
                        ),

                },

            logging:
                {
                    level:
                        toEnum(
                            source.LOG_LEVEL,
                            [
                                'fatal',
                                'error',
                                'warn',
                                'info',
                                'debug',
                                'trace',
                                'silent',
                            ],
                            environment ===
                                ENVIRONMENT_NAMES.DEVELOPMENT
                                ? 'debug'
                                : 'info',
                        ),

                    pretty:
                        toBoolean(
                            source.LOG_PRETTY,
                            environment ===
                                ENVIRONMENT_NAMES.DEVELOPMENT,
                        ),

                    requestLogging:
                        toBoolean(
                            source.ENABLE_REQUEST_LOGGING,
                            true,
                        ),

                },

            timeouts:
                {
                    startupMs:
                        toPositiveInteger(
                            source.STARTUP_TIMEOUT_MS,
                            120_000,
                        ),

                    shutdownMs:
                        toPositiveInteger(
                            source.SHUTDOWN_TIMEOUT_MS,
                            30_000,
                        ),

                    readinessMs:
                        toPositiveInteger(
                            source.READINESS_TIMEOUT_MS,
                            5_000,
                        ),

                    healthMs:
                        toPositiveInteger(
                            source.HEALTH_TIMEOUT_MS,
                            5_000,
                        ),

                },

            flags:
                {
                    observability:
                        toBoolean(
                            source.ENABLE_OBSERVABILITY,
                            true,
                        ),

                    metrics:
                        toBoolean(
                            source.ENABLE_METRICS,
                            true,
                        ),

                    tracing:
                        toBoolean(
                            source.ENABLE_TRACING,
                            true,
                        ),

                    resilience:
                        toBoolean(
                            source.ENABLE_RESILIENCE,
                            true,
                        ),

                    database:
                        toBoolean(
                            source.ENABLE_DATABASE,
                            true,
                        ),

                    redis:
                        toBoolean(
                            source.ENABLE_REDIS,
                            true,
                        ),

                    queue:
                        toBoolean(
                            source.ENABLE_QUEUE,
                            true,
                        ),

                    socket:
                        toBoolean(
                            source.ENABLE_SOCKET,
                            true,
                        ),

                    audit:
                        toBoolean(
                            source.AUDIT_ENABLED,
                            true,
                        ),

                    cors:
                        toBoolean(
                            source.CORS_ENABLED,
                            true,
                        ),

                    rateLimit:
                        toBoolean(
                            source.ENABLE_RATE_LIMIT,
                            true,
                        ),

                    securityHeaders:
                        toBoolean(
                            source.ENABLE_SECURITY_HEADERS,
                            true,
                        ),

                },

            security:
                {
                    helmetEnabled:
                        toBoolean(
                            source.ENABLE_SECURITY_HEADERS,
                            true,
                        ),

                    rateLimitEnabled:
                        toBoolean(
                            source.ENABLE_RATE_LIMIT,
                            true,
                        ),

                    corsEnabled:
                        toBoolean(
                            source.CORS_ENABLED,
                            true,
                        ),

                    corsCredentials:
                        toBoolean(
                            source.CORS_CREDENTIALS,
                            true,
                        ),

                    corsWildcard:
                        toBoolean(
                            source.CORS_ALLOW_WILDCARD,
                            false,
                        ),

                    corsOrigins:
                        toList(
                            source.CORS_ORIGINS,
                            [],
                        ),

                    productionCorsOrigins:
                        toList(
                            source.CORS_PRODUCTION_ORIGINS,
                            [],
                        ),

                },

            database:
                {
                    enabled:
                        toBoolean(
                            source.DATABASE_ENABLED,
                            true,
                        ),

                    required:
                        toBoolean(
                            source.DATABASE_REQUIRED,
                            true,
                        ),

                    gracefulStartup:
                        toBoolean(
                            source.GRACEFUL_STARTUP,
                            environment !==
                                ENVIRONMENT_NAMES.PRODUCTION,
                        ),

                    skipChecks:
                        toBoolean(
                            source.SKIP_DB_CHECKS,
                            false,
                        ),

                    uriConfigured:
                        isNonEmptyString(
                            source.MONGO_URI ||
                                source.MONGODB_URI,
                        ),

                    fallbackConfigured:
                        isNonEmptyString(
                            source.MONGO_URI_FALLBACK ||
                                source.MONGODB_URI_FALLBACK,
                        ),

                },

            redis:
                {
                    enabled:
                        toBoolean(
                            source.ENABLE_REDIS,
                            true,
                        ),

                    required:
                        toBoolean(
                            source.REDIS_REQUIRED,
                            false,
                        ),

                    urlConfigured:
                        isNonEmptyString(
                            source.REDIS_URL ||
                                source.REDIS_URI,
                        ),

                },

            audit:
                {
                    enabled:
                        toBoolean(
                            source.AUDIT_ENABLED,
                            true,
                        ),

                    failClosed:
                        toBoolean(
                            source.AUDIT_FAIL_CLOSED,
                            true,
                        ),

                    financialFailClosed:
                        toBoolean(
                            source.AUDIT_FINANCIAL_FAIL_CLOSED,
                            true,
                        ),

                    securityFailClosed:
                        toBoolean(
                            source.AUDIT_SECURITY_FAIL_CLOSED,
                            true,
                        ),

                },

            financial:
                {
                    requireIdempotency:
                        toBoolean(
                            source.FINANCIAL_REQUIRE_IDEMPOTENCY,
                            true,
                        ),

                    requireAudit:
                        toBoolean(
                            source.FINANCIAL_REQUIRE_AUDIT,
                            true,
                        ),

                    cacheAuthoritativeState:
                        toBoolean(
                            source.CACHE_AUTHORITATIVE_FINANCIAL_STATE,
                            false,
                        ),

                },

            deployment:
                {
                    region:
                        normalizeString(
                            source.AWS_REGION ||
                                source.CLOUD_REGION,
                        ),

                    zone:
                        normalizeString(
                            source.AVAILABILITY_ZONE ||
                                source.ZONE,
                        ),

                    release:
                        normalizeString(
                            source.RELEASE,
                        ),

                    commitSha:
                        normalizeString(
                            source.GIT_COMMIT_SHA,
                        ),

                    instanceId:
                        normalizeString(
                            source.INSTANCE_ID ||
                                source.HOSTNAME,
                        ),

                },

        };

    return deepFreeze(
        normalized,
    );

}

/**
 * =============================================================================
 * Node runtime validation
 * =============================================================================
 */

function validateNodeRuntime(
    environment,
) {

    const major =
        environment.runtime.nodeMajor;

    const minimumMajor =
        20;

    if (
        !Number.isInteger(
            major,
        ) ||
        major <
            minimumMajor
    ) {

        throw new EnvironmentValidationError(
            `TITech requires Node.js ${minimumMajor}+; detected ${environment.runtime.nodeVersion}.`,
            {
                code:
                    'NODE_VERSION_UNSUPPORTED',

                minimumMajor,

                detected:
                    environment.runtime.nodeVersion,
            },
        );

    }

}

/**
 * =============================================================================
 * Environment validation
 * =============================================================================
 */

function validateEnvironmentConfiguration(
    environment,
    source,
) {

    const errors =
        [];

    const warnings =
        [];

    /**
     * -------------------------------------------------------------------------
     * Runtime
     * -------------------------------------------------------------------------
     */

    if (
        !SUPPORTED_ENVIRONMENTS.includes(
            environment.app.environment,
        )
    ) {

        errors.push({
            code:
                'ENVIRONMENT_UNSUPPORTED',

            message:
                `Unsupported NODE_ENV "${environment.app.environment}".`,
        });

    }

    if (
        environment.runtime.nodeMajor <
        20
    ) {

        errors.push({
            code:
                'NODE_VERSION_UNSUPPORTED',

            message:
                `TITech requires Node.js 20+. Detected ${environment.runtime.nodeVersion}.`,
        });

    }

    /**
     * -------------------------------------------------------------------------
     * HTTP timeouts
     * -------------------------------------------------------------------------
     */

    if (
        environment.server.headersTimeoutMs <=
        environment.server.keepAliveTimeoutMs
    ) {

        errors.push({
            code:
                'HTTP_TIMEOUT_INVALID',

            message:
                'HTTP headers timeout must exceed keep-alive timeout.',
        });

    }

    /**
     * -------------------------------------------------------------------------
     * Production safety
     * -------------------------------------------------------------------------
     */

    if (
        environment.runtime.production
    ) {

        if (
            environment.security.corsWildcard &&
            environment.security.corsCredentials
        ) {

            errors.push({
                code:
                    'PRODUCTION_CORS_WILDCARD_CREDENTIALS',

                message:
                    'TITech production CORS cannot combine wildcard origins with credentials.',
            });

        }

        if (
            environment.security.corsEnabled &&
            environment.security.corsOrigins.length ===
                0 &&
            environment.security.productionCorsOrigins.length ===
                0
        ) {

            errors.push({
                code:
                    'PRODUCTION_CORS_ORIGINS_MISSING',

                message:
                    'TITech production CORS requires explicit allowed origins.',
            });

        }

        if (
            !environment.security.helmetEnabled
        ) {

            errors.push({
                code:
                    'PRODUCTION_SECURITY_HEADERS_DISABLED',

                message:
                    'TITech security headers must remain enabled in production.',
            });

        }

        if (
            !environment.flags.rateLimit
        ) {

            warnings.push({
                code:
                    'PRODUCTION_RATE_LIMIT_DISABLED',

                message:
                    'Production rate limiting is disabled.',
            });

        }

        if (
            environment.logging.level ===
                'debug' ||
            environment.logging.level ===
                'trace'
        ) {

            warnings.push({
                code:
                    'PRODUCTION_VERBOSE_LOGGING',

                message:
                    'Verbose logging is enabled in production.',
            });

        }

        if (
            !environment.database.uriConfigured &&
            environment.database.required &&
            environment.database.enabled
        ) {

            errors.push({
                code:
                    'PRODUCTION_DATABASE_URI_MISSING',

                message:
                    'TITech production MongoDB URI is not configured.',
            });

        }

        if (
            environment.audit.enabled &&
            !environment.audit.financialFailClosed
        ) {

            warnings.push({
                code:
                    'FINANCIAL_AUDIT_NOT_FAIL_CLOSED',

                message:
                    'Financial audit is not configured fail-closed.',
            });

        }

        if (
            !environment.financial.requireIdempotency
        ) {

            errors.push({
                code:
                    'FINANCIAL_IDEMPOTENCY_DISABLED',

                message:
                    'Financial idempotency is disabled in production.',
            });

        }

        if (
            environment.financial.cacheAuthoritativeState
        ) {

            errors.push({
                code:
                    'AUTHORITATIVE_FINANCIAL_CACHE_FORBIDDEN',

                message:
                    'TITech authoritative financial state must not use cache as its source of truth.',
            });

        }

    }

    /**
     * -------------------------------------------------------------------------
     * Database safety
     * -------------------------------------------------------------------------
     */

    if (
        environment.database.skipChecks &&
        environment.database.required &&
        environment.runtime.production
    ) {

        errors.push({
            code:
                'PRODUCTION_DATABASE_CHECKS_SKIPPED',

            message:
                'TITech production cannot skip required database checks.',
        });

    }

    /**
     * -------------------------------------------------------------------------
     * Redis
     * -------------------------------------------------------------------------
     */

    if (
        environment.redis.required &&
        environment.redis.enabled &&
        !environment.redis.urlConfigured
    ) {

        errors.push({
            code:
                'REDIS_CONFIGURATION_MISSING',

            message:
                'Redis is marked required but no Redis URL is configured.',
        });

    }

    if (
        errors.length >
        0
    ) {

        throw new EnvironmentValidationError(
            'TITech environment configuration validation failed.',
            {
                code:
                    'ENVIRONMENT_CONFIGURATION_INVALID',

                errors,

                warnings,
            },
        );

    }

    return Object.freeze({
        valid:
            true,

        errors:
            Object.freeze(
                [],
            ),

        warnings:
            Object.freeze(
                warnings,
            ),
    });

}

/**
 * =============================================================================
 * Safe environment fingerprint
 * =============================================================================
 *
 * Fingerprinting is useful for startup diagnostics and deployment comparison.
 *
 * Secrets are excluded.
 *
 * The fingerprint describes configuration shape/value identity, not credentials.
 * =============================================================================
 */

function createEnvironmentFingerprint(
    source,
) {

    const entries =
        Object.entries(
            source,
        )
            .filter(
                ([
                    key,
                ]) =>
                    !isSensitiveVariable(
                        key,
                    ),
            )
            .sort(
                (a, b) =>
                    a[0].localeCompare(
                        b[0],
                    ),
            );

    const canonical =
        JSON.stringify(
            entries,
        );

    return sha256(
        canonical,
    );

}

/**
 * =============================================================================
 * Safe diagnostics
 * =============================================================================
 */

function createEnvironmentDiagnostics(
    source,
    environment,
    loadPlan,
    dotenvLayers,
    validation,
    fingerprint,
) {

    const safeVariables =
        {};

    for (
        const [
            key,
            value,
        ] of Object.entries(
            source,
        )
    ) {

        safeVariables[key] =
            maskVariable(
                key,
                value,
            );

    }

    return deepFreeze({
        component:
            COMPONENT,

        schemaVersion:
            ENVIRONMENT_SCHEMA_VERSION,

        initialized:
            INTERNAL_STATE.initialized,

        nodeEnvironment:
            environment.app.environment,

        service:
            environment.app.serviceName,

        application:
            environment.app.name,

        projectRoot:
            PROJECT_ROOT,

        environmentDirectory:
            ENVIRONMENT_DIRECTORY,

        dotenvLoaded:
            dotenvLayers.successfulLoads >
            0,

        dotenv:
            {
                successfulLoads:
                    dotenvLayers.successfulLoads,

                failedLoads:
                    dotenvLayers.failedLoads,

                files:
                    dotenvLayers.diagnostics.map(
                        layer => ({
                            filename:
                                layer.filename,

                            loaded:
                                layer.loaded,

                            variableCount:
                                layer.variableCount,

                            durationMs:
                                Number(
                                    layer.durationMs.toFixed(
                                        3,
                                    ),
                                ),

                            error:
                                layer.error?.message ||
                                null,
                        }),
                    ),
            },

        discovery:
            {
                discoveredFiles:
                    loadPlan.discoveredFiles,

                availableFiles:
                    loadPlan.availableFiles,
            },

        validation:
            {
                valid:
                    validation.valid,

                warnings:
                    validation.warnings,
            },

        fingerprint:
            {
                algorithm:
                    FINGERPRINT_ALGORITHM,

                value:
                    fingerprint,
            },

        runtime:
            {
                nodeVersion:
                    process.versions.node,

                pid:
                    process.pid,

                platform:
                    process.platform,

                architecture:
                    process.arch,

                hostname:
                    os.hostname(),
            },

        variables:
            safeVariables,

        warnings:
            [
                ...INTERNAL_STATE.warnings,
                ...validation.warnings,
            ],

        timestamp:
            new Date().toISOString(),
    });

}

/**
 * =============================================================================
 * Bootstrap runtime state
 * ============================================================================= */

const INTERNAL_STATE = {

    initialized:
        false,

    bootstrapStartedAt:
        null,

    bootstrapCompletedAt:
        null,

    loadedFiles:
        [],

    validationErrors:
        [],

    warnings:
        [],

    projectRoot:
        PROJECT_ROOT,

    environmentDirectory:
        ENVIRONMENT_DIRECTORY,

    discovery:
        null,

    dotenv:
        null,

    diagnostics:
        null,

    fingerprint:
        null,

};

/**
 * =============================================================================
 * Bootstrap process
 * =============================================================================
 */

let ENVIRONMENT =
    Object.freeze({});

let BOOTSTRAP_PROMISE =
    null;

function performBootstrap(
    options = {},
) {

    INTERNAL_STATE.bootstrapStartedAt =
        new Date();

    const initialEnvironment =
        getInitialNodeEnvironment();

    /**
     * -------------------------------------------------------------------------
     * Discovery
     * -------------------------------------------------------------------------
     */

    const loadPlan =
        buildEnvironmentLoadPlan(
            initialEnvironment,
        );

    INTERNAL_STATE.discovery =
        loadPlan;

    /**
     * -------------------------------------------------------------------------
     * Load dotenv layers
     * -------------------------------------------------------------------------
     */

    const dotenvLayers =
        loadDotenvLayers(
            loadPlan,
        );

    INTERNAL_STATE.dotenv =
        dotenvLayers;

    INTERNAL_STATE.loadedFiles =
        dotenvLayers.diagnostics
            .filter(
                layer =>
                    layer.loaded,
            )
            .map(
                layer =>
                    layer.filename,
            );

    /**
     * -------------------------------------------------------------------------
     * Merge
     * -------------------------------------------------------------------------
     */

    const mergedEnvironment =
        mergeEnvironmentLayers(
            dotenvLayers.loadedLayers,
            process.env,
        );

    /**
     * -------------------------------------------------------------------------
     * Normalize
     * -------------------------------------------------------------------------
     */

    const normalized =
        normalizeEnvironment(
            mergedEnvironment,
        );

    /**
     * -------------------------------------------------------------------------
     * Validate
     * -------------------------------------------------------------------------
     */

    validateNodeRuntime(
        normalized,
    );

    const validation =
        validateEnvironmentConfiguration(
            normalized,
            mergedEnvironment,
        );

    /**
     * -------------------------------------------------------------------------
     * Fingerprint
     * -------------------------------------------------------------------------
     */

    const fingerprint =
        createEnvironmentFingerprint(
            mergedEnvironment,
        );

    INTERNAL_STATE.fingerprint =
        fingerprint;

    /**
     * -------------------------------------------------------------------------
     * Runtime environment
     * -------------------------------------------------------------------------
     */

    ENVIRONMENT =
        deepFreeze({
            ...normalized,

            fingerprint:
                Object.freeze({
                    algorithm:
                        FINGERPRINT_ALGORITHM,

                    value:
                        fingerprint,
                }),

            bootstrap:
                Object.freeze({
                    schemaVersion:
                        ENVIRONMENT_SCHEMA_VERSION,

                    dotenvLoaded:
                        dotenvLayers
                            .successfulLoads >
                        0,

                    dotenvLayers:
                        dotenvLayers
                            .diagnostics
                            .map(
                                layer => ({
                                    filename:
                                        layer.filename,

                                    loaded:
                                        layer.loaded,

                                    variableCount:
                                        layer.variableCount,
                                }),
                            ),

                    projectRoot:
                        PROJECT_ROOT,

                    environmentDirectory:
                        ENVIRONMENT_DIRECTORY,

                    startedAt:
                        INTERNAL_STATE
                            .bootstrapStartedAt,

                    completedAt:
                        new Date(),
                }),

            diagnostics:
                Object.freeze({
                    validation:
                        validation,

                    loadedFiles:
                        [
                            ...INTERNAL_STATE
                                .loadedFiles,
                        ],
                }),
        });

    INTERNAL_STATE.validationErrors =
        [];

    INTERNAL_STATE.warnings.push(
        ...validation.warnings,
    );

    INTERNAL_STATE.bootstrapCompletedAt =
        new Date();

    INTERNAL_STATE.initialized =
        true;

    INTERNAL_STATE.diagnostics =
        createEnvironmentDiagnostics(
            mergedEnvironment,
            ENVIRONMENT,
            loadPlan,
            dotenvLayers,
            validation,
            fingerprint,
        );

    log(
        'info',
        {
            environment:
                ENVIRONMENT.app.environment,

            service:
                ENVIRONMENT.app.serviceName,

            application:
                ENVIRONMENT.app.name,

            version:
                ENVIRONMENT.app.version,

            fingerprint:
                fingerprint.slice(
                    0,
                    16,
                ),

            dotenvLayers:
                dotenvLayers
                    .successfulLoads,

            warnings:
                validation
                    .warnings
                    .length,
        },
        'TITech environment bootstrap completed.',
    );

    return ENVIRONMENT;

}

/**
 * =============================================================================
 * Public bootstrap
 * =============================================================================
 */

async function bootstrapEnvironment(
    options = {},
) {

    if (
        INTERNAL_STATE.initialized &&
        ENVIRONMENT
    ) {

        return ENVIRONMENT;

    }

    if (
        BOOTSTRAP_PROMISE
    ) {

        return BOOTSTRAP_PROMISE;

    }

    BOOTSTRAP_PROMISE =
        Promise.resolve()
            .then(
                () =>
                    performBootstrap(
                        options,
                    ),
            )
            .catch(
                error => {

                    const normalized =
                        normalizeBootstrapError(
                            error,
                        );

                    INTERNAL_STATE
                        .validationErrors
                        .push(
                            {
                                code:
                                    normalized.code,

                                message:
                                    normalized.message,
                            },
                        );

                    log(
                        'error',
                        {
                            code:
                                normalized.code,

                            message:
                                normalized.message,
                        },
                        'TITech environment bootstrap failed.',
                    );

                    throw normalized;

                },
            );

    try {

        return await BOOTSTRAP_PROMISE;

    } finally {

        BOOTSTRAP_PROMISE =
            null;

    }

}

/**
 * =============================================================================
 * Error normalization
 * ============================================================================= */

function normalizeBootstrapError(
    error,
) {

    if (
        error instanceof
        EnvironmentBootstrapError
    ) {

        return error;

    }

    if (
        startupErrors?.environmentError
    ) {

        try {

            return startupErrors.environmentError(
                error?.message ||
                    'TITech environment bootstrap failed.',
                {
                    cause:
                        error,

                    critical:
                        true,

                    fatal:
                        true,

                    details:
                        error?.details ||
                        {},
                },
            );

        } catch {

            // Fall through.

        }

    }

    return new EnvironmentConfigurationError(
        error?.message ||
            'TITech environment bootstrap failed.',
        {
            code:
                error?.code ||
                'ENVIRONMENT_BOOTSTRAP_FAILED',

            cause:
                error,

            details:
                error?.details ||
                {},
        },
    );

}

/**
 * =============================================================================
 * Diagnostics API
 * =============================================================================
 */

function getEnvironmentDiscoveryDiagnostics() {

    const discovery =
        INTERNAL_STATE.discovery ||
        buildEnvironmentLoadPlan();

    return deepFreeze({
        projectRoot:
            PROJECT_ROOT,

        environmentDirectory:
            ENVIRONMENT_DIRECTORY,

        nodeEnvironment:
            discovery.nodeEnvironment,

        discoveredFiles:
            discovery.discoveredFiles,

        availableFiles:
            discovery.availableFiles,

        files:
            discovery.files.map(
                file => ({
                    filename:
                        file.filename,

                    exists:
                        file.exists,
                }),
            ),
    });

}

function getDotenvDiagnostics() {

    const dotenv =
        INTERNAL_STATE.dotenv;

    if (
        !dotenv
    ) {

        return Object.freeze({
            successfulLoads:
                0,

            failedLoads:
                0,

            files:
                [],
        });

    }

    return deepFreeze({
        successfulLoads:
            dotenv.successfulLoads,

        failedLoads:
            dotenv.failedLoads,

        files:
            dotenv.diagnostics.map(
                layer => ({
                    filename:
                        layer.filename,

                    loaded:
                        layer.loaded,

                    variableCount:
                        layer.variableCount,

                    durationMs:
                        Number(
                            layer.durationMs.toFixed(
                                3,
                            ),
                        ),

                    error:
                        layer.error?.message ||
                        null,
                }),
            ),
    });

}

function getDiagnostics() {

    if (
        INTERNAL_STATE.diagnostics
    ) {

        return deepClone(
            INTERNAL_STATE.diagnostics,
        );

    }

    return deepFreeze({
        component:
            COMPONENT,

        initialized:
            false,

        discovery:
            getEnvironmentDiscoveryDiagnostics(),

        dotenv:
            getDotenvDiagnostics(),

        validation:
            {
                valid:
                    false,

                warnings:
                    [],
            },

        fingerprint:
            null,

        warnings:
            [
                ...INTERNAL_STATE.warnings,
            ],

        timestamp:
            new Date().toISOString(),
    });

}

/**
 * =============================================================================
 * Environment access
 * =============================================================================
 */

function getEnvironment() {

    if (
        !INTERNAL_STATE.initialized
    ) {

        throw new EnvironmentBootstrapError(
            'TITech environment has not been bootstrapped.',
            {
                code:
                    'ENVIRONMENT_NOT_INITIALIZED',
            },
        );

    }

    return ENVIRONMENT;

}

function get(
    pathValue,
    defaultValue =
        undefined,
) {

    const parts =
        Array.isArray(
            pathValue,
        )
            ? pathValue
            : String(
                pathValue ||
                    '',
            )
                .split('.')
                .filter(
                    Boolean,
                );

    if (
        parts.length ===
        0
    ) {

        return defaultValue;

    }

    let current =
        getEnvironment();

    for (
        const part of
        parts
    ) {

        if (
            current ===
                null ||
            current ===
                undefined ||
            !Object.prototype.hasOwnProperty.call(
                Object(
                    current,
                ),
                part,
            )
        ) {

            return defaultValue;

        }

        current =
            current[
                part
            ];

    }

    return current;

}

function has(
    pathValue,
) {

    const marker =
        Symbol(
            'missing',
        );

    return (
        get(
            pathValue,
            marker,
        ) !==
        marker
    );

}

/**
 * =============================================================================
 * Environment status
 * =============================================================================
 */

function isInitialized() {

    return INTERNAL_STATE.initialized;

}

function isProduction() {

    return (
        getEnvironment()
            .runtime
            .production ===
        true
    );

}

function isStaging() {

    return (
        getEnvironment()
            .runtime
            .staging ===
        true
    );

}

function isDevelopment() {

    return (
        getEnvironment()
            .runtime
            .development ===
        true
    );

}

function isTest() {

    return (
        getEnvironment()
            .runtime
            .test ===
        true
    );

}

function isFeatureEnabled(
    feature,
    fallback =
        false,
) {

    if (
        !feature
    ) {

        return fallback;

    }

    return Boolean(
        get(
            `flags.${feature}`,
            fallback,
        ),
    );

}

/**
 * =============================================================================
 * Fingerprint
 * =============================================================================
 */

function getFingerprint() {

    return (
        INTERNAL_STATE.fingerprint ||
        null
    );

}

/**
 * =============================================================================
 * Reset
 * =============================================================================
 *
 * Test-process isolation only.
 *
 * This resets this module's internal state; it does not mutate process.env and
 * does not remove dotenv variables already loaded elsewhere.
 * =============================================================================
 */

function reset() {

    INTERNAL_STATE.initialized =
        false;

    INTERNAL_STATE.bootstrapStartedAt =
        null;

    INTERNAL_STATE.bootstrapCompletedAt =
        null;

    INTERNAL_STATE.loadedFiles =
        [];

    INTERNAL_STATE.validationErrors =
        [];

    INTERNAL_STATE.warnings =
        [];

    INTERNAL_STATE.discovery =
        null;

    INTERNAL_STATE.dotenv =
        null;

    INTERNAL_STATE.diagnostics =
        null;

    INTERNAL_STATE.fingerprint =
        null;

    ENVIRONMENT =
        Object.freeze({});

    BOOTSTRAP_PROMISE =
        null;

    return true;

}

/**
 * =============================================================================
 * Compatibility bootstrap adapter
 * =============================================================================
 */

async function initialize(
    context = {},
    options = {},
) {

    const environment =
        await bootstrapEnvironment(
            options,
        );

    if (
        context &&
        typeof context ===
            'object'
    ) {

        context.environment =
            environment;

        context.env =
            environment;

    }

    return environment;

}

async function start(
    context = {},
    options = {},
) {

    return initialize(
        context,
        options,
    );

}

async function bootstrap(
    context = {},
    options = {},
) {

    return initialize(
        context,
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
         * -----------------------------------------------------------------------
         * Bootstrap
         * -----------------------------------------------------------------------
         */

        bootstrapEnvironment,

        initialize,

        start,

        bootstrap,

        /**
         * -----------------------------------------------------------------------
         * Environment
         * -----------------------------------------------------------------------
         */

        getEnvironment,

        get,

        has,

        isInitialized,

        isProduction,

        isStaging,

        isDevelopment,

        isTest,

        isFeatureEnabled,

        getFingerprint,

        /**
         * -----------------------------------------------------------------------
         * Discovery
         * -----------------------------------------------------------------------
         */

        buildDotenvCandidates,

        discoverEnvironmentFiles,

        buildEnvironmentLoadPlan,

        getEnvironmentDiscoveryDiagnostics,

        /**
         * -----------------------------------------------------------------------
         * Dotenv diagnostics
         * -----------------------------------------------------------------------
         */

        getDotenvDiagnostics,

        /**
         * -----------------------------------------------------------------------
         * Runtime diagnostics
         * -----------------------------------------------------------------------
         */

        getDiagnostics,

        /**
         * -----------------------------------------------------------------------
         * Utility
         * -----------------------------------------------------------------------
         */

        toBoolean,

        toInteger,

        toPositiveInteger,

        toPort,

        toList,

        toEnum,

        normalizeString,

        isDefined,

        isNonEmptyString,

        isSensitiveVariable,

        maskVariable,

        sha256,

        /**
         * -----------------------------------------------------------------------
         * Test support
         * -----------------------------------------------------------------------
         */

        reset,

        /**
         * -----------------------------------------------------------------------
         * Constants
         * -----------------------------------------------------------------------
         */

        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        ENVIRONMENT_NAMES,

        SUPPORTED_ENVIRONMENTS,

        DEFAULT_ENVIRONMENT,

        DEFAULT_TIMEZONE,

        DEFAULT_LOCALE,

        DEFAULT_ENCODING,

        DEFAULT_HOST,

        DEFAULT_PORT,

        DEFAULT_VERSION,

        ENVIRONMENT_SCHEMA_VERSION,

        DOTENV_FILENAMES,

        FINGERPRINT_ALGORITHM,

        /**
         * -----------------------------------------------------------------------
         * Errors
         * -----------------------------------------------------------------------
         */

        EnvironmentBootstrapError,

        EnvironmentValidationError,

        EnvironmentConfigurationError,

    });

/**
 * =============================================================================
 * Optional direct bootstrap
 * =============================================================================
 *
 * Running:
 *
 *   node backend/config/environment.js
 *
 * validates the environment and prints a safe diagnostic summary.
 *
 * Requiring the module remains side-effect controlled with respect to bootstrap.
 * =============================================================================
 */

if (
    require.main ===
    module
) {

    (async () => {

        try {

            await bootstrapEnvironment();

            const diagnostics =
                getDiagnostics();

            process.stdout.write(
                `${JSON.stringify(
                    diagnostics,
                    null,
                    2,
                )}\n`,
            );

        } catch (
            error
        ) {

            process.stderr.write(
                `${JSON.stringify(
                    {
                        component:
                            COMPONENT,

                        error:
                            {
                                name:
                                    error.name,

                                code:
                                    error.code,

                                message:
                                    error.message,
                            },
                    },
                    null,
                    2,
                )}\n`,
            );

            process.exitCode =
                1;

        }

    })();

}