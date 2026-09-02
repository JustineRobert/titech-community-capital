'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/environment/environmentValidator.js
 *
 * Purpose:
 *   Enterprise production-grade environment validation engine.
 *
 * Responsibilities:
 *   - Validate TITech runtime environment configuration.
 *   - Validate required and optional environment variables.
 *   - Validate types, formats and allowed values.
 *   - Validate cross-variable dependencies.
 *   - Validate environment-specific production requirements.
 *   - Validate security-sensitive configuration.
 *   - Validate infrastructure configuration shape without connecting to it.
 *   - Validate financial safety configuration.
 *   - Validate tenant-isolation configuration.
 *   - Produce structured validation diagnostics.
 *   - Produce deterministic validation summaries.
 *   - Support strict and fail-closed startup policies.
 *   - Never mutate process.env.
 *
 * IMPORTANT:
 *
 *   This module validates ENVIRONMENT INPUT.
 *
 *   It does NOT:
 *     - mutate process.env.
 *     - load dotenv files.
 *     - create application configuration.
 *     - connect to MongoDB.
 *     - connect to Redis.
 *     - initialize queues.
 *     - start Express.
 *     - start HTTP servers.
 *     - execute financial transactions.
 *     - perform database migrations.
 *
 * Environment loading remains owned by:
 *
 *   backend/config/environment.js
 *
 * Environment bootstrap orchestration remains owned by:
 *
 *   backend/config/bootstrapEnvironment.js
 *
 * Environment lifecycle state remains owned by:
 *
 *   backend/config/environment/bootstrapState.js
 *
 * Safe environment snapshot remains owned by:
 *
 *   backend/config/environment/environmentSnapshot.js
 *
 * =============================================================================
 *
 * Validation flow:
 *
 *   process.env
 *        ↓
 *   dotenv loading
 *        ↓
 *   environment normalization
 *        ↓
 *   environmentValidator.js
 *        ↓
 *   validated environment
 *        ↓
 *   configuration provider
 *
 * =============================================================================
 */

const crypto =
    require('node:crypto');

const process =
    require('node:process');

/**
 * =============================================================================
 * Optional modules
 * =============================================================================
 */

let environmentSnapshotModule =
    null;

try {
    // eslint-disable-next-line global-require
    environmentSnapshotModule =
        require('./environmentSnapshot');
} catch {
    environmentSnapshotModule =
        null;
}

let bootstrapStateModule =
    null;

try {
    // eslint-disable-next-line global-require
    bootstrapStateModule =
        require('./bootstrapState');
} catch {
    bootstrapStateModule =
        null;
}

let loggerModule =
    null;

try {
    // eslint-disable-next-line global-require
    loggerModule =
        require('../../utils/logger');
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
    'environment-validator';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

const ENVIRONMENTS =
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
        ENVIRONMENTS.DEVELOPMENT,
        ENVIRONMENTS.TEST,
        ENVIRONMENTS.STAGING,
        ENVIRONMENTS.PRODUCTION,
    ]);

const VALIDATION_STATUSES =
    Object.freeze({
        VALID:
            'valid',

        INVALID:
            'invalid',

        DEGRADED:
            'degraded',

        READY:
            'ready',
    });

const RESULT_STATUSES =
    Object.freeze({
        PASS:
            'pass',

        WARN:
            'warn',

        FAIL:
            'fail',

        SKIP:
            'skip',
    });

const SEVERITIES =
    Object.freeze({
        INFO:
            'info',

        WARNING:
            'warning',

        ERROR:
            'error',

        CRITICAL:
            'critical',
    });

const VALUE_TYPES =
    Object.freeze({
        STRING:
            'string',

        BOOLEAN:
            'boolean',

        INTEGER:
            'integer',

        NUMBER:
            'number',

        URL:
            'url',

        EMAIL:
            'email',

        REGEX:
            'regex',

        ENUM:
            'enum',

        JSON:
            'json',
    });

const DEFAULTS =
    Object.freeze({
        strict:
            true,

        failClosed:
            true,

        rejectUnknownEnvironment:
            true,

        allowEmptyOptionalValues:
            true,

        allowWarnings:
            true,

        maxErrors:
            250,

        maxWarnings:
            250,

        maxChecks:
            500,

        fingerprintAlgorithm:
            'sha256',

        /**
         * Minimum security/operational defaults.
         */
        production:
            {
                requireNodeEnv:
                    true,

                requireServiceName:
                    true,

                requireAppName:
                    true,

                requireAppVersion:
                    false,

                requireJwtSecret:
                    false,

                requireDatabaseUri:
                    false,

                requireRedisUrl:
                    false,

                requireAudit:
                    true,

                requireTenantIsolation:
                    true,

                requireIdempotency:
                    true,

                requireSecureCookies:
                    true,

                requireHttps:
                    true,

                forbidDebug:
                    true,

                forbidDefaultSecrets:
                    true,

                forbidWildcardCors:
                    true,

                forbidWeakJwtSecret:
                    true,

                minJwtSecretLength:
                    32,
            },

        /**
         * Environment variables that are always accepted but never logged
         * as raw values.
         */
        sensitivePattern:
            /(password|passwd|secret|token|authorization|api[_-]?key|private[_-]?key|client[_-]?secret|encryption[_-]?key|connection[_-]?(string|uri|url)|jwt[_-]?secret|smtp[_-]?password|access[_-]?token|refresh[_-]?token|cookie|credential|signing[_-]?key)/i,

        /**
         * Baseline type rules.
         */
        variables:
            Object.freeze({
                NODE_ENV:
                    {
                        type:
                            VALUE_TYPES.ENUM,

                        required:
                            true,

                        allowed:
                            [
                                'development',
                                'test',
                                'staging',
                                'production',
                            ],
                    },

                PORT:
                    {
                        type:
                            VALUE_TYPES.INTEGER,

                        required:
                            false,

                        min:
                            1,

                        max:
                            65535,

                        default:
                            5000,
                    },

                SERVICE_NAME:
                    {
                        type:
                            VALUE_TYPES.STRING,

                        required:
                            false,

                        minLength:
                            1,

                        maxLength:
                            200,
                    },

                APP_NAME:
                    {
                        type:
                            VALUE_TYPES.STRING,

                        required:
                            false,

                        minLength:
                            1,

                        maxLength:
                            200,
                    },

                APP_VERSION:
                    {
                        type:
                            VALUE_TYPES.STRING,

                        required:
                            false,

                        maxLength:
                            100,
                    },

                TZ:
                    {
                        type:
                            VALUE_TYPES.STRING,

                        required:
                            false,

                        maxLength:
                            100,
                    },

                MONGO_URI:
                    {
                        type:
                            VALUE_TYPES.STRING,

                        required:
                            false,

                        minLength:
                            1,
                    },

                MONGO_URI_FALLBACK:
                    {
                        type:
                            VALUE_TYPES.STRING,

                        required:
                            false,

                        minLength:
                            1,
                    },

                REDIS_URL:
                    {
                        type:
                            VALUE_TYPES.STRING,

                        required:
                            false,

                        minLength:
                            1,
                    },

                REDIS_HOST:
                    {
                        type:
                            VALUE_TYPES.STRING,

                        required:
                            false,
                    },

                REDIS_PORT:
                    {
                        type:
                            VALUE_TYPES.INTEGER,

                        required:
                            false,

                        min:
                            1,

                        max:
                            65535,
                    },

                JWT_SECRET:
                    {
                        type:
                            VALUE_TYPES.STRING,

                        required:
                            false,

                        minLength:
                            16,
                    },

                JWT_EXPIRES_IN:
                    {
                        type:
                            VALUE_TYPES.STRING,

                        required:
                            false,

                        maxLength:
                            100,
                    },

                CORS_ORIGIN:
                    {
                        type:
                            VALUE_TYPES.STRING,

                        required:
                            false,
                    },

                CLIENT_URL:
                    {
                        type:
                            VALUE_TYPES.URL,

                        required:
                            false,
                    },

                FRONTEND_URL:
                    {
                        type:
                            VALUE_TYPES.URL,

                        required:
                            false,
                    },

                LOG_LEVEL:
                    {
                        type:
                            VALUE_TYPES.ENUM,

                        required:
                            false,

                        allowed:
                            [
                                'fatal',
                                'error',
                                'warn',
                                'info',
                                'debug',
                                'trace',
                                'silent',
                            ],
                    },

                NODE_DEBUG:
                    {
                        type:
                            VALUE_TYPES.BOOLEAN,

                        required:
                            false,
                    },

                DEBUG:
                    {
                        type:
                            VALUE_TYPES.BOOLEAN,

                        required:
                            false,
                    },

                SECURE_COOKIES:
                    {
                        type:
                            VALUE_TYPES.BOOLEAN,

                        required:
                            false,
                    },

                ENABLE_METRICS:
                    {
                        type:
                            VALUE_TYPES.BOOLEAN,

                        required:
                            false,
                    },

                ENABLE_TRACING:
                    {
                        type:
                            VALUE_TYPES.BOOLEAN,

                        required:
                            false,
                    },

                ENABLE_REQUEST_METRICS:
                    {
                        type:
                            VALUE_TYPES.BOOLEAN,

                        required:
                            false,
                    },

                OBSERVABILITY_ENABLED:
                    {
                        type:
                            VALUE_TYPES.BOOLEAN,

                        required:
                            false,
                    },

                ENABLE_IDEMPOTENCY:
                    {
                        type:
                            VALUE_TYPES.BOOLEAN,

                        required:
                            false,
                    },

                IDEMPOTENCY_ENABLED:
                    {
                        type:
                            VALUE_TYPES.BOOLEAN,

                        required:
                            false,
                    },

                ENABLE_TENANT_ISOLATION:
                    {
                        type:
                            VALUE_TYPES.BOOLEAN,

                        required:
                            false,
                    },

                TENANT_ISOLATION_ENABLED:
                    {
                        type:
                            VALUE_TYPES.BOOLEAN,

                        required:
                            false,
                    },

                ENABLE_AUDIT_LOGGING:
                    {
                        type:
                            VALUE_TYPES.BOOLEAN,

                        required:
                            false,
                    },

                AUDIT_LOGGING_ENABLED:
                    {
                        type:
                            VALUE_TYPES.BOOLEAN,

                        required:
                            false,
                    },

                ALLOW_CROSS_TENANT_ACCESS:
                    {
                        type:
                            VALUE_TYPES.BOOLEAN,

                        required:
                            false,
                    },

                ALLOW_WILDCARD_CORS:
                    {
                        type:
                            VALUE_TYPES.BOOLEAN,

                        required:
                            false,
                    },
            }),
    });

/**
 * =============================================================================
 * Errors
 * =============================================================================
 */

class EnvironmentValidationError extends Error {

    constructor(
        message,
        options = {},
    ) {

        super(
            message,
        );

        this.name =
            'EnvironmentValidationError';

        this.code =
            options.code ||
            'ENVIRONMENT_VALIDATION_ERROR';

        this.severity =
            options.severity ||
            SEVERITIES.ERROR;

        this.variable =
            options.variable ||
            null;

        this.phase =
            options.phase ||
            'validation';

        this.cause =
            options.cause ||
            null;

        this.details =
            Object.freeze({
                ...(options.details || {}),
            });

        Error.captureStackTrace?.(
            this,
            EnvironmentValidationError,
        );
    }
}

/**
 * =============================================================================
 * Utility helpers
 * =============================================================================
 */

function normalizeEnvironment(
    value,
) {

    return String(
        value ||
        ENVIRONMENTS.DEVELOPMENT,
    )
        .trim()
        .toLowerCase();
}

function isProduction(
    value,
) {

    return (
        normalizeEnvironment(
            value,
        ) ===
        ENVIRONMENTS.PRODUCTION
    );
}

function isSupportedEnvironment(
    value,
) {

    return SUPPORTED_ENVIRONMENTS.includes(
        normalizeEnvironment(
            value,
        ),
    );
}

function asBoolean(
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
        typeof value === 'boolean'
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
            '1',
            'true',
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
            '0',
            'false',
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

function isEmpty(
    value,
) {

    return (
        value === undefined ||
        value === null ||
        (
            typeof value === 'string' &&
            value.trim() === ''
        )
    );
}

function deepFreeze(
    value,
    seen = new WeakSet(),
) {

    if (
        value === null ||
        value === undefined ||
        typeof value !== 'object'
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
                clone(
                    item,
                ),
        );
    }

    if (
        typeof value === 'object'
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

function fingerprint(
    value,
    algorithm =
        DEFAULTS.fingerprintAlgorithm,
) {

    return crypto
        .createHash(
            algorithm,
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

function safeError(
    error,
) {

    return (
        error
            ? {
                name:
                    error.name ||
                    'Error',

                code:
                    error.code ||
                    'UNKNOWN',

                message:
                    error.message ||
                    String(
                        error,
                    ),

                variable:
                    error.variable ||
                    null,
            }
            : null
    );
}

/**
 * =============================================================================
 * Logger
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
        // Validation must remain operational even when logger fails.
    }
}

/**
 * =============================================================================
 * Secret-safe metadata
 * =============================================================================
 */

function redactVariableName(
    variable,
) {

    return String(
        variable,
    )
        .trim();
}

function safeValuePreview(
    variable,
    value,
) {

    if (
        DEFAULTS
            .sensitivePattern
            .test(
                variable,
            )
    ) {

        return '[REDACTED]';
    }

    if (
        value === undefined
    ) {

        return undefined;
    }

    if (
        typeof value === 'string' &&
        value.length > 200
    ) {

        return `${value.slice(
            0,
            200,
        )}[TRUNCATED]`;
    }

    return value;
}

/**
 * =============================================================================
 * EnvironmentValidator
 * =============================================================================
 */

class EnvironmentValidator {

    constructor(
        options = {},
    ) {

        const production =
            isProduction(
                options.environment ||
                process.env.NODE_ENV ||
                DEFAULTS.environment,
            );

        this.options =
            Object.freeze({
                strict:
                    options.strict ??
                    DEFAULTS.strict,

                failClosed:
                    options.failClosed ??
                    DEFAULTS.failClosed,

                rejectUnknownEnvironment:
                    options.rejectUnknownEnvironment ??
                    DEFAULTS.rejectUnknownEnvironment,

                allowEmptyOptionalValues:
                    options.allowEmptyOptionalValues ??
                    DEFAULTS.allowEmptyOptionalValues,

                allowWarnings:
                    options.allowWarnings ??
                    DEFAULTS.allowWarnings,

                maxErrors:
                    options.maxErrors ||
                    DEFAULTS.maxErrors,

                maxWarnings:
                    options.maxWarnings ||
                    DEFAULTS.maxWarnings,

                maxChecks:
                    options.maxChecks ||
                    DEFAULTS.maxChecks,

                fingerprintAlgorithm:
                    options.fingerprintAlgorithm ||
                    DEFAULTS.fingerprintAlgorithm,

                production:
                    Object.freeze({
                        ...DEFAULTS.production,
                        ...(options.production || {}),
                    }),

                variables:
                    Object.freeze({
                        ...DEFAULTS.variables,
                        ...(options.variables || {}),
                    }),

                environment:
                    normalizeEnvironment(
                        options.environment ||
                        process.env.NODE_ENV ||
                        DEFAULTS.environment,
                    ),

                configuredProduction:
                    production,
            });

        this.status =
            VALIDATION_STATUSES
                .VALID;

        this.valid =
            true;

        this.environment =
            this.options.environment;

        this.startedAt =
            null;

        this.completedAt =
            null;

        this.durationMs =
            0;

        this.checks =
            [];

        this.errors =
            [];

        this.warnings =
            [];

        this.skipped =
            [];

        this.normalized =
            {};

        this.fingerprintValue =
            null;

        this.lastResult =
            null;

        this.lastError =
            null;
    }

    /**
     * -------------------------------------------------------------------------
     * Validate environment.
     * -------------------------------------------------------------------------
     */

    validate(
        environment = process.env,
        options = {},
    ) {

        const started =
            process.hrtime.bigint();

        this.startedAt =
            new Date();

        this.resetCollections();

        const source =
            environment &&
            typeof environment ===
            'object'
                ? environment
                : {};

        try {

            this.environment =
                normalizeEnvironment(
                    source.NODE_ENV ||
                    this.options.environment,
                );

            /**
             * ---------------------------------------------------------------
             * Environment identity.
             * ---------------------------------------------------------------
             */

            this.checkEnvironmentName(
                this.environment,
            );

            /**
             * ---------------------------------------------------------------
             * Typed variable rules.
             * ---------------------------------------------------------------
             */

            for (
                const [
                    variable,
                    definition,
                ] of Object.entries(
                    this.options.variables,
                )
            ) {

                this.validateVariable(
                    variable,
                    definition,
                    source,
                );
            }

            /**
             * ---------------------------------------------------------------
             * Cross-variable rules.
             * ---------------------------------------------------------------
             */

            this.validateCrossVariableDependencies(
                source,
            );

            /**
             * ---------------------------------------------------------------
             * Environment-specific rules.
             * ---------------------------------------------------------------
             */

            this.validateEnvironmentSpecificRules(
                source,
            );

            /**
             * ---------------------------------------------------------------
             * Security.
             * ---------------------------------------------------------------
             */

            this.validateSecurity(
                source,
            );

            /**
             * ---------------------------------------------------------------
             * Observability.
             * ---------------------------------------------------------------
             */

            this.validateObservability(
                source,
            );

            /**
             * ---------------------------------------------------------------
             * Database configuration shape.
             * ---------------------------------------------------------------
             */

            this.validateDatabaseShape(
                source,
            );

            /**
             * ---------------------------------------------------------------
             * Redis configuration shape.
             * ---------------------------------------------------------------
             */

            this.validateRedisShape(
                source,
            );

            /**
             * ---------------------------------------------------------------
             * Tenant isolation.
             * ---------------------------------------------------------------
             */

            this.validateTenantIsolation(
                source,
            );

            /**
             * ---------------------------------------------------------------
             * Financial controls.
             * ---------------------------------------------------------------
             */

            this.validateFinancialSafety(
                source,
            );

            /**
             * ---------------------------------------------------------------
             * Normalized environment.
             * ---------------------------------------------------------------
             */

            this.normalized =
                this.buildNormalizedEnvironment(
                    source,
                );

            /**
             * ---------------------------------------------------------------
             * Fingerprint.
             * ---------------------------------------------------------------
             */

            this.fingerprintValue =
                fingerprint(
                    this.buildFingerprintPayload(
                        source,
                    ),
                    this.options
                        .fingerprintAlgorithm,
                );

            this.completedAt =
                new Date();

            this.durationMs =
                Number(
                    process.hrtime.bigint() -
                    started,
                ) /
                1_000_000;

            this.valid =
                this.errors.length === 0;

            this.status =
                this.errors.length > 0
                    ? VALIDATION_STATUSES
                        .INVALID
                    : this.warnings.length > 0
                        ? VALIDATION_STATUSES
                            .DEGRADED
                        : VALIDATION_STATUSES
                            .READY;

            const result =
                this.buildResult();

            this.lastResult =
                deepFreeze(
                    result,
                );

            log(
                this.valid
                    ? this.warnings.length > 0
                        ? 'warn'
                        : 'info'
                    : 'error',
                {
                    environment:
                        this.environment,

                    status:
                        this.status,

                    errors:
                        this.errors.length,

                    warnings:
                        this.warnings.length,
                },
                this.valid
                    ? 'TITech environment validation completed.'
                    : 'TITech environment validation failed.',
            );

            if (
                !this.valid &&
                (
                    this.options.failClosed ||
                    options.throwOnError
                )
            ) {

                throw new EnvironmentValidationError(
                    'TITech environment validation failed.',
                    {
                        code:
                            'ENVIRONMENT_VALIDATION_FAILED',

                        phase:
                            'validation',

                        details: {
                            errors:
                                this.errors,
                        },
                    },
                );
            }

            if (
                this.valid &&
                this.warnings.length > 0 &&
                !this.options.allowWarnings &&
                (
                    this.options.strict ||
                    options.throwOnWarning
                )
            ) {

                throw new EnvironmentValidationError(
                    'TITech environment validation completed with warnings that are not permitted by policy.',
                    {
                        code:
                            'ENVIRONMENT_VALIDATION_WARNINGS_NOT_ALLOWED',

                        severity:
                            SEVERITIES.WARNING,

                        phase:
                            'validation',

                        details: {
                            warnings:
                                this.warnings,
                        },
                    },
                );
            }

            return this.lastResult;

        } catch (
            error
        ) {

            this.completedAt =
                new Date();

            this.durationMs =
                Number(
                    process.hrtime.bigint() -
                    started,
                ) /
                1_000_000;

            this.lastError =
                error;

            this.valid =
                false;

            this.status =
                VALIDATION_STATUSES
                    .INVALID;

            if (
                !(error instanceof EnvironmentValidationError)
            ) {

                this.recordError(
                    error,
                    {
                        code:
                            'ENVIRONMENT_VALIDATION_RUNTIME_ERROR',
                    },
                );
            }

            if (
                options.throwOnError ||
                this.options.failClosed
            ) {

                throw error;
            }

            return this.buildResult();
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Environment name.
     * -------------------------------------------------------------------------
     */

    checkEnvironmentName(
        environment,
    ) {

        if (
            !environment
        ) {

            return this.recordError(
                {
                    code:
                        'NODE_ENV_REQUIRED',

                    message:
                        'NODE_ENV is required.',
                },
                {
                    severity:
                        SEVERITIES.CRITICAL,

                    variable:
                        'NODE_ENV',
                },
            );
        }

        if (
            !isSupportedEnvironment(
                environment,
            )
        ) {

            const check = {
                name:
                    'environment.name',

                status:
                    RESULT_STATUSES.FAIL,

                severity:
                    this.options
                        .rejectUnknownEnvironment
                        ? SEVERITIES.CRITICAL
                        : SEVERITIES.WARNING,

                variable:
                    'NODE_ENV',

                message:
                    `Unsupported TITech runtime environment "${environment}".`,

                details: {
                    received:
                        environment,

                    allowed:
                        SUPPORTED_ENVIRONMENTS,
                },
            };

            if (
                this.options
                    .rejectUnknownEnvironment
            ) {

                return this.recordCheck(
                    check,
                );
            }

            return this.recordWarning(
                check,
            );
        }

        return this.recordPass(
            {
                name:
                    'environment.name',

                variable:
                    'NODE_ENV',

                message:
                    `TITech environment "${environment}" is supported.`,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Variable validation.
     * -------------------------------------------------------------------------
     */

    validateVariable(
        variable,
        definition,
        source,
    ) {

        const value =
            source[
                variable
            ];

        const empty =
            isEmpty(
                value,
            );

        const required =
            this.isVariableRequired(
                variable,
                definition,
            );

        if (
            empty &&
            required
        ) {

            return this.recordError(
                {
                    name:
                        `variable.${variable}`,

                    variable,

                    code:
                        'ENVIRONMENT_VARIABLE_REQUIRED',

                    message:
                        `Required TITech environment variable "${variable}" is missing.`,
                },
                {
                    variable,
                },
            );
        }

        if (
            empty
        ) {

            return this.recordSkip(
                {
                    name:
                        `variable.${variable}`,

                    variable,

                    message:
                        `Optional TITech environment variable "${variable}" is not configured.`,
                },
            );
        }

        switch (
            definition.type
        ) {

            case VALUE_TYPES.BOOLEAN:

                return this.validateBoolean(
                    variable,
                    value,
                );

            case VALUE_TYPES.INTEGER:

                return this.validateInteger(
                    variable,
                    value,
                    definition,
                );

            case VALUE_TYPES.NUMBER:

                return this.validateNumber(
                    variable,
                    value,
                    definition,
                );

            case VALUE_TYPES.URL:

                return this.validateUrl(
                    variable,
                    value,
                );

            case VALUE_TYPES.EMAIL:

                return this.validateEmail(
                    variable,
                    value,
                );

            case VALUE_TYPES.REGEX:

                return this.validateRegex(
                    variable,
                    value,
                );

            case VALUE_TYPES.ENUM:

                return this.validateEnum(
                    variable,
                    value,
                    definition,
                );

            case VALUE_TYPES.JSON:

                return this.validateJson(
                    variable,
                    value,
                );

            case VALUE_TYPES.STRING:
            default:

                return this.validateString(
                    variable,
                    value,
                    definition,
                );
        }
    }

    isVariableRequired(
        variable,
        definition,
    ) {

        if (
            definition.required ===
            true
        ) {

            return true;
        }

        if (
            !isProduction(
                this.environment,
            )
        ) {

            return false;
        }

        /**
         * Production-specific rules.
         */
        if (
            variable ===
            'NODE_ENV'
        ) {

            return this.options.production
                .requireNodeEnv;
        }

        if (
            variable ===
            'SERVICE_NAME'
        ) {

            return this.options.production
                .requireServiceName;
        }

        if (
            variable ===
            'APP_NAME'
        ) {

            return this.options.production
                .requireAppName;
        }

        if (
            variable ===
            'APP_VERSION'
        ) {

            return this.options.production
                .requireAppVersion;
        }

        if (
            variable ===
            'JWT_SECRET'
        ) {

            return this.options.production
                .requireJwtSecret;
        }

        if (
            variable ===
            'MONGO_URI'
        ) {

            return this.options.production
                .requireDatabaseUri;
        }

        if (
            variable ===
            'REDIS_URL'
        ) {

            return this.options.production
                .requireRedisUrl;
        }

        return false;
    }

    validateString(
        variable,
        value,
        definition,
    ) {

        const normalized =
            String(
                value,
            ).trim();

        if (
            definition.minLength &&
            normalized.length <
            definition.minLength
        ) {

            return this.recordError(
                {
                    name:
                        `variable.${variable}`,

                    variable,

                    code:
                        'ENVIRONMENT_STRING_TOO_SHORT',

                    message:
                        `TITech environment variable "${variable}" is shorter than the minimum allowed length.`,

                    details: {
                        minLength:
                            definition.minLength,
                    },
                },
                {
                    variable,
                },
            );
        }

        if (
            definition.maxLength &&
            normalized.length >
            definition.maxLength
        ) {

            return this.recordError(
                {
                    name:
                        `variable.${variable}`,

                    variable,

                    code:
                        'ENVIRONMENT_STRING_TOO_LONG',

                    message:
                        `TITech environment variable "${variable}" exceeds the maximum allowed length.`,

                    details: {
                        maxLength:
                            definition.maxLength,
                    },
                },
                {
                    variable,
                },
            );
        }

        return this.recordPass(
            {
                name:
                    `variable.${variable}`,

                variable,

                message:
                    `TITech environment variable "${variable}" is valid.`,
            },
        );
    }

    validateBoolean(
        variable,
        value,
    ) {

        const normalized =
            String(
                value,
            )
                .trim()
                .toLowerCase();

        const valid =
            [
                '1',
                '0',
                'true',
                'false',
                'yes',
                'no',
                'on',
                'off',
                'enabled',
                'disabled',
            ].includes(
                normalized,
            );

        if (
            !valid
        ) {

            return this.recordError(
                {
                    name:
                        `variable.${variable}`,

                    variable,

                    code:
                        'ENVIRONMENT_BOOLEAN_INVALID',

                    message:
                        `TITech environment variable "${variable}" must be a boolean value.`,

                    details: {
                        accepted:
                            [
                                'true',
                                'false',
                                '1',
                                '0',
                                'yes',
                                'no',
                                'on',
                                'off',
                            ],
                    },
                },
                {
                    variable,
                },
            );
        }

        return this.recordPass(
            {
                name:
                    `variable.${variable}`,

                variable,

                message:
                    `TITech boolean environment variable "${variable}" is valid.`,
            },
        );
    }

    validateInteger(
        variable,
        value,
        definition,
    ) {

        const parsed =
            Number(
                value,
            );

        if (
            !Number.isInteger(
                parsed,
            )
        ) {

            return this.recordError(
                {
                    name:
                        `variable.${variable}`,

                    variable,

                    code:
                        'ENVIRONMENT_INTEGER_INVALID',

                    message:
                        `TITech environment variable "${variable}" must be an integer.`,
                },
                {
                    variable,
                },
            );
        }

        if (
            definition.min !==
                undefined &&
            parsed <
                definition.min
        ) {

            return this.recordError(
                {
                    name:
                        `variable.${variable}`,

                    variable,

                    code:
                        'ENVIRONMENT_INTEGER_TOO_SMALL',

                    message:
                        `TITech environment variable "${variable}" is below the minimum value.`,

                    details: {
                        min:
                            definition.min,

                        received:
                            parsed,
                    },
                },
                {
                    variable,
                },
            );
        }

        if (
            definition.max !==
                undefined &&
            parsed >
                definition.max
        ) {

            return this.recordError(
                {
                    name:
                        `variable.${variable}`,

                    variable,

                    code:
                        'ENVIRONMENT_INTEGER_TOO_LARGE',

                    message:
                        `TITech environment variable "${variable}" exceeds the maximum value.`,

                    details: {
                        max:
                            definition.max,

                        received:
                            parsed,
                    },
                },
                {
                    variable,
                },
            );
        }

        return this.recordPass(
            {
                name:
                    `variable.${variable}`,

                variable,

                message:
                    `TITech integer environment variable "${variable}" is valid.`,
            },
        );
    }

    validateNumber(
        variable,
        value,
        definition,
    ) {

        const parsed =
            Number(
                value,
            );

        if (
            !Number.isFinite(
                parsed,
            )
        ) {

            return this.recordError(
                {
                    name:
                        `variable.${variable}`,

                    variable,

                    code:
                        'ENVIRONMENT_NUMBER_INVALID',

                    message:
                        `TITech environment variable "${variable}" must be numeric.`,
                },
                {
                    variable,
                },
            );
        }

        if (
            definition.min !==
                undefined &&
            parsed <
                definition.min
        ) {

            return this.recordError(
                {
                    name:
                        `variable.${variable}`,

                    variable,

                    code:
                        'ENVIRONMENT_NUMBER_TOO_SMALL',

                    message:
                        `TITech environment variable "${variable}" is below the minimum value.`,
                },
                {
                    variable,
                },
            );
        }

        if (
            definition.max !==
                undefined &&
            parsed >
                definition.max
        ) {

            return this.recordError(
                {
                    name:
                        `variable.${variable}`,

                    variable,

                    code:
                        'ENVIRONMENT_NUMBER_TOO_LARGE',

                    message:
                        `TITech environment variable "${variable}" exceeds the maximum value.`,
                },
                {
                    variable,
                },
            );
        }

        return this.recordPass(
            {
                name:
                    `variable.${variable}`,

                variable,

                message:
                    `TITech numeric environment variable "${variable}" is valid.`,
            },
        );
    }

    validateUrl(
        variable,
        value,
    ) {

        try {

            const parsed =
                new URL(
                    String(
                        value,
                    ),
                );

            if (
                ![
                    'http:',
                    'https:',
                    'redis:',
                    'rediss:',
                    'mongodb:',
                    'mongodb+srv:',
                    'smtp:',
                ].includes(
                    parsed.protocol,
                )
            ) {

                throw new Error(
                    'Unsupported URL protocol.',
                );
            }

            return this.recordPass(
                {
                    name:
                        `variable.${variable}`,

                    variable,

                    message:
                        `TITech URL environment variable "${variable}" is valid.`,
                },
            );

        } catch (
            error
        ) {

            return this.recordError(
                {
                    name:
                        `variable.${variable}`,

                    variable,

                    code:
                        'ENVIRONMENT_URL_INVALID',

                    message:
                        `TITech environment variable "${variable}" is not a valid supported URL.`,

                    details: {
                        reason:
                            error.message,
                    },
                },
                {
                    variable,
                },
            );
        }
    }

    validateEmail(
        variable,
        value,
    ) {

        const valid =
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
                String(
                    value,
                ).trim(),
            );

        if (
            !valid
        ) {

            return this.recordError(
                {
                    name:
                        `variable.${variable}`,

                    variable,

                    code:
                        'ENVIRONMENT_EMAIL_INVALID',

                    message:
                        `TITech environment variable "${variable}" must contain a valid email address.`,
                },
                {
                    variable,
                },
            );
        }

        return this.recordPass(
            {
                name:
                    `variable.${variable}`,

                variable,

                message:
                    `TITech email environment variable "${variable}" is valid.`,
            },
        );
    }

    validateRegex(
        variable,
        value,
    ) {

        try {

            new RegExp(
                String(
                    value,
                ),
            );

            return this.recordPass(
                {
                    name:
                        `variable.${variable}`,

                    variable,

                    message:
                        `TITech regex environment variable "${variable}" is valid.`,
                },
            );

        } catch (
            error
        ) {

            return this.recordError(
                {
                    name:
                        `variable.${variable}`,

                    variable,

                    code:
                        'ENVIRONMENT_REGEX_INVALID',

                    message:
                        `TITech environment variable "${variable}" contains an invalid regular expression.`,

                    details: {
                        reason:
                            error.message,
                    },
                },
                {
                    variable,
                },
            );
        }
    }

    validateEnum(
        variable,
        value,
        definition,
    ) {

        const normalized =
            String(
                value,
            )
                .trim()
                .toLowerCase();

        const allowed =
            (
                definition.allowed ||
                []
            ).map(
                item =>
                    String(
                        item,
                    )
                        .trim()
                        .toLowerCase(),
            );

        if (
            !allowed.includes(
                normalized,
            )
        ) {

            return this.recordError(
                {
                    name:
                        `variable.${variable}`,

                    variable,

                    code:
                        'ENVIRONMENT_ENUM_INVALID',

                    message:
                        `TITech environment variable "${variable}" contains an unsupported value.`,

                    details: {
                        allowed,
                    },
                },
                {
                    variable,
                },
            );
        }

        return this.recordPass(
            {
                name:
                    `variable.${variable}`,

                variable,

                message:
                    `TITech enum environment variable "${variable}" is valid.`,
            },
        );
    }

    validateJson(
        variable,
        value,
    ) {

        try {

            JSON.parse(
                String(
                    value,
                ),
            );

            return this.recordPass(
                {
                    name:
                        `variable.${variable}`,

                    variable,

                    message:
                        `TITech JSON environment variable "${variable}" is valid.`,
                },
            );

        } catch (
            error
        ) {

            return this.recordError(
                {
                    name:
                        `variable.${variable}`,

                    variable,

                    code:
                        'ENVIRONMENT_JSON_INVALID',

                    message:
                        `TITech environment variable "${variable}" contains invalid JSON.`,

                    details: {
                        reason:
                            error.message,
                    },
                },
                {
                    variable,
                },
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Cross-variable dependencies.
     * -------------------------------------------------------------------------
     */

    validateCrossVariableDependencies(
        source,
    ) {

        /**
         * If Redis is enabled, at least one connection strategy is expected.
         */
        const redisEnabled =
            asBoolean(
                source.ENABLE_REDIS ??
                source.REDIS_ENABLED,
                Boolean(
                    source.REDIS_URL ||
                    source.REDIS_HOST,
                ),
            );

        if (
            redisEnabled &&
            isEmpty(
                source.REDIS_URL,
            ) &&
            isEmpty(
                source.REDIS_HOST,
            )
        ) {

            this.recordError(
                {
                    name:
                        'redis.configuration',

                    code:
                        'REDIS_CONFIGURATION_MISSING',

                    message:
                        'TITech Redis is enabled but no Redis connection strategy is configured.',
                },
            );
        }

        /**
         * If tracing is enabled, OTEL service identity should be available.
         */
        const tracingEnabled =
            asBoolean(
                source.ENABLE_TRACING,
                false,
            );

        if (
            tracingEnabled &&
            isEmpty(
                source.OTEL_SERVICE_NAME,
            ) &&
            isEmpty(
                source.SERVICE_NAME,
            )
        ) {

            this.recordWarning(
                {
                    name:
                        'tracing.service-name',

                    code:
                        'OTEL_SERVICE_NAME_MISSING',

                    message:
                        'TITech tracing is enabled but no OTEL_SERVICE_NAME or SERVICE_NAME is explicitly configured.',
                },
            );
        }

        /**
         * Idempotency should not be enabled without a usable backing store.
         */
        const idempotencyEnabled =
            asBoolean(
                source.ENABLE_IDEMPOTENCY ??
                source.IDEMPOTENCY_ENABLED,
                false,
            );

        if (
            idempotencyEnabled &&
            isEmpty(
                source.REDIS_URL,
            ) &&
            isEmpty(
                source.IDEMPOTENCY_STORE,
            ) &&
            isEmpty(
                source.MONGO_URI,
            )
        ) {

            this.recordError(
                {
                    name:
                        'idempotency.configuration',

                    code:
                        'IDEMPOTENCY_BACKING_STORE_MISSING',

                    message:
                        'TITech idempotency is enabled but no recognized backing-store configuration is present.',
                },
            );
        }

        /**
         * Secure cookies should not be required in a pure HTTP local test
         * environment.
         */
        if (
            asBoolean(
                source.SECURE_COOKIES,
                false,
            ) &&
            this.environment ===
                ENVIRONMENTS.DEVELOPMENT &&
            (
                source.CLIENT_URL ||
                source.FRONTEND_URL
            )?.startsWith(
                'http://',
            )
        ) {

            this.recordWarning(
                {
                    name:
                        'cookies.secure',

                    code:
                        'SECURE_COOKIE_HTTP_DEVELOPMENT',

                    message:
                        'TITech secure cookies are enabled while the configured development client uses HTTP.',
                },
            );
        }

        return true;
    }

    /**
     * -------------------------------------------------------------------------
     * Environment-specific rules.
     * -------------------------------------------------------------------------
     */

    validateEnvironmentSpecificRules(
        source,
    ) {

        switch (
            this.environment
        ) {

            case ENVIRONMENTS.PRODUCTION:

                return this.validateProduction(
                    source,
                );

            case ENVIRONMENTS.STAGING:

                return this.validateStaging(
                    source,
                );

            case ENVIRONMENTS.TEST:

                return this.validateTest(
                    source,
                );

            case ENVIRONMENTS.DEVELOPMENT:

                return this.validateDevelopment(
                    source,
                );

            default:

                return this.recordError(
                    {
                        name:
                            'environment.mode',

                        code:
                            'ENVIRONMENT_MODE_INVALID',

                        message:
                            'TITech environment mode is invalid.',
                    },
                );
        }
    }

    validateProduction(
        source,
    ) {

        if (
            this.options.production
                .forbidDebug &&
            (
                asBoolean(
                    source.DEBUG,
                    false,
                ) ||
                asBoolean(
                    source.NODE_DEBUG,
                    false,
                )
            )
        ) {

            this.recordError(
                {
                    name:
                        'production.debug',

                    code:
                        'PRODUCTION_DEBUG_ENABLED',

                    message:
                        'TITech production environment must not run with DEBUG/NODE_DEBUG enabled.',
                },
            );
        }

        if (
            this.options.production
                .requireSecureCookies &&
            !asBoolean(
                source.SECURE_COOKIES,
                false,
            )
        ) {

            this.recordError(
                {
                    name:
                        'production.secure-cookies',

                    code:
                        'PRODUCTION_SECURE_COOKIES_REQUIRED',

                    message:
                        'TITech production requires SECURE_COOKIES=true.',
                },
            );
        }

        if (
            this.options.production
                .requireHttps
        ) {

            const clientUrl =
                source.CLIENT_URL ||
                source.FRONTEND_URL;

            if (
                clientUrl &&
                !String(
                    clientUrl,
                )
                    .startsWith(
                        'https://',
                    )
            ) {

                this.recordError(
                    {
                        name:
                            'production.https',

                        code:
                            'PRODUCTION_HTTPS_REQUIRED',

                        message:
                            'TITech production client endpoints must use HTTPS.',
                    },
                );
            }
        }

        if (
            this.options.production
                .forbidWildcardCors &&
            asBoolean(
                source.ALLOW_WILDCARD_CORS,
                false,
            )
        ) {

            this.recordError(
                {
                    name:
                        'production.cors',

                    code:
                        'PRODUCTION_WILDCARD_CORS_FORBIDDEN',

                    message:
                        'TITech production must not enable wildcard CORS.',
                },
            );
        }

        if (
            this.options.production
                .forbidDefaultSecrets
        ) {

            const defaultLikeSecrets = [
                'change-me',
                'changeme',
                'secret',
                'password',
                'your-secret',
                'your-secret-here',
                'development-secret',
                'test-secret',
            ];

            if (
                source.JWT_SECRET &&
                defaultLikeSecrets.includes(
                    String(
                        source.JWT_SECRET,
                    )
                        .trim()
                        .toLowerCase(),
                )
            ) {

                this.recordError(
                    {
                        name:
                            'production.jwt-secret',

                        code:
                            'PRODUCTION_DEFAULT_SECRET',

                        variable:
                            'JWT_SECRET',

                        message:
                            'TITech production JWT_SECRET appears to contain a default or development secret.',
                    },
                );
            }
        }

        return true;
    }

    validateStaging(
        source,
    ) {

        if (
            asBoolean(
                source.DEBUG,
                false,
            )
        ) {

            this.recordWarning(
                {
                    name:
                        'staging.debug',

                    code:
                        'STAGING_DEBUG_ENABLED',

                    message:
                        'TITech staging DEBUG mode is enabled.',
                },
            );
        }

        return true;
    }

    validateTest(
        source,
    ) {

        if (
            isEmpty(
                source.NODE_ENV,
            )
        ) {

            this.recordError(
                {
                    name:
                        'test.environment',

                    code:
                        'TEST_NODE_ENV_REQUIRED',

                    variable:
                        'NODE_ENV',

                    message:
                        'TITech test execution requires NODE_ENV=test.',
                },
            );
        }

        return true;
    }

    validateDevelopment(
        source,
    ) {

        if (
            asBoolean(
                source.SECURE_COOKIES,
                false,
            ) &&
            (
                source.CLIENT_URL ||
                source.FRONTEND_URL
            )?.startsWith(
                'http://',
            )
        ) {

            this.recordWarning(
                {
                    name:
                        'development.secure-cookies',

                    code:
                        'DEVELOPMENT_SECURE_COOKIE_HTTP',

                    message:
                        'TITech development is using secure cookies with an HTTP client URL.',
                },
            );
        }

        return true;
    }

    /**
     * -------------------------------------------------------------------------
     * Security validation.
     * -------------------------------------------------------------------------
     */

    validateSecurity(
        source,
    ) {

        /**
         * JWT secret strength.
         */
        if (
            source.JWT_SECRET &&
            (
                this.options.production
                    .forbidWeakJwtSecret &&
                (
                    String(
                        source.JWT_SECRET,
                    ).length <
                    this.options.production
                        .minJwtSecretLength
                )
            )
        ) {

            if (
                isProduction(
                    this.environment,
                )
            ) {

                this.recordError(
                    {
                        name:
                            'security.jwt-secret',

                        code:
                            'JWT_SECRET_TOO_WEAK',

                        variable:
                            'JWT_SECRET',

                        message:
                            'TITech production JWT_SECRET is below the configured minimum length.',
                    },
                );

            } else {

                this.recordWarning(
                    {
                        name:
                            'security.jwt-secret',

                        code:
                            'JWT_SECRET_WEAK',

                        variable:
                            'JWT_SECRET',

                        message:
                            'TITech JWT_SECRET is below the recommended minimum length.',
                    },
                );
            }
        }

        /**
         * Cross-tenant access.
         */
        if (
            isProduction(
                this.environment,
            ) &&
            asBoolean(
                source.ALLOW_CROSS_TENANT_ACCESS,
                false,
            )
        ) {

            this.recordError(
                {
                    name:
                        'security.tenant-isolation',

                    code:
                        'CROSS_TENANT_ACCESS_ENABLED',

                    variable:
                        'ALLOW_CROSS_TENANT_ACCESS',

                    message:
                        'TITech production must not enable unrestricted cross-tenant access.',
                },
            );
        }

        return true;
    }

    /**
     * -------------------------------------------------------------------------
     * Observability validation.
     * -------------------------------------------------------------------------
     */

    validateObservability(
        source,
    ) {

        const observabilityEnabled =
            asBoolean(
                source.OBSERVABILITY_ENABLED,
                true,
            );

        const metricsEnabled =
            asBoolean(
                source.ENABLE_METRICS,
                false,
            );

        const tracingEnabled =
            asBoolean(
                source.ENABLE_TRACING,
                false,
            );

        if (
            isProduction(
                this.environment,
            ) &&
            !observabilityEnabled
        ) {

            this.recordWarning(
                {
                    name:
                        'observability.enabled',

                    code:
                        'PRODUCTION_OBSERVABILITY_DISABLED',

                    message:
                        'TITech production observability is disabled.',
                },
            );
        }

        if (
            metricsEnabled &&
            !source.METRICS_PREFIX &&
            source.METRICS_PREFIX !==
                undefined
        ) {

            this.recordWarning(
                {
                    name:
                        'observability.metrics-prefix',

                    code:
                        'METRICS_PREFIX_MISSING',

                    message:
                        'TITech metrics are enabled without an explicit metrics prefix.',
                },
            );
        }

        if (
            tracingEnabled &&
            isProduction(
                this.environment,
            ) &&
            isEmpty(
                source.OTEL_SERVICE_NAME,
            ) &&
            isEmpty(
                source.SERVICE_NAME,
            )
        ) {

            this.recordWarning(
                {
                    name:
                        'observability.service-name',

                    code:
                        'OTEL_SERVICE_NAME_MISSING',

                    message:
                        'TITech tracing is enabled in production without an explicit OTEL service identity.',
                },
            );
        }

        return true;
    }

    /**
     * -------------------------------------------------------------------------
     * Database validation.
     * -------------------------------------------------------------------------
     */

    validateDatabaseShape(
        source,
    ) {

        const mongoUri =
            source.MONGO_URI ||
            source.MONGO_URI_FALLBACK;

        if (
            isEmpty(
                mongoUri,
            )
        ) {

            if (
                isProduction(
                    this.environment,
                ) &&
                this.options.production
                    .requireDatabaseUri
            ) {

                this.recordError(
                    {
                        name:
                            'database.uri',

                        code:
                            'MONGO_URI_REQUIRED',

                        message:
                            'TITech production database URI is required.',
                    },
                );

            } else {

                this.recordWarning(
                    {
                        name:
                            'database.uri',

                        code:
                            'MONGO_URI_NOT_CONFIGURED',

                        message:
                            'TITech MongoDB URI is not configured.',
                    },
                );
            }

            return false;
        }

        const uri =
            String(
                mongoUri,
            );

        const isMongo =
            uri.startsWith(
                'mongodb://',
            ) ||
            uri.startsWith(
                'mongodb+srv://',
            );

        if (
            !isMongo
        ) {

            this.recordError(
                {
                    name:
                        'database.uri',

                    code:
                        'MONGO_URI_INVALID',

                    variable:
                        source.MONGO_URI
                            ? 'MONGO_URI'
                            : 'MONGO_URI_FALLBACK',

                    message:
                        'TITech MongoDB URI must begin with mongodb:// or mongodb+srv://.',
                },
            );

            return false;
        }

        if (
            uri.startsWith(
                'mongodb+srv://',
            )
        ) {

            const authority =
                uri.split(
                    '://',
                )[1]?.split(
                    '/',
                )[0] || '';

            if (
                /:\d+$/.test(
                    authority,
                )
            ) {

                this.recordError(
                    {
                        name:
                            'database.srv-port',

                        code:
                            'MONGO_SRV_PORT_FORBIDDEN',

                        message:
                            'TITech mongodb+srv:// URIs must not include an explicit port.',
                    },
                );
            }
        }

        return this.recordPass(
            {
                name:
                    'database.uri',

                message:
                    'TITech MongoDB URI format is valid.',
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Redis validation.
     * -------------------------------------------------------------------------
     */

    validateRedisShape(
        source,
    ) {

        if (
            source.REDIS_URL
        ) {

            const redisUrl =
                String(
                    source.REDIS_URL,
                );

            if (
                !(
                    redisUrl.startsWith(
                        'redis://',
                    ) ||
                    redisUrl.startsWith(
                        'rediss://',
                    )
                )
            ) {

                return this.recordError(
                    {
                        name:
                            'redis.url',

                        code:
                            'REDIS_URL_INVALID',

                        variable:
                            'REDIS_URL',

                        message:
                            'TITech REDIS_URL must use redis:// or rediss://.',
                    },
                );
            }

            return this.recordPass(
                {
                    name:
                        'redis.url',

                    variable:
                        'REDIS_URL',

                    message:
                        'TITech Redis URL is valid.',
                },
            );
        }

        if (
            source.REDIS_HOST &&
            source.REDIS_PORT
        ) {

            return this.recordPass(
                {
                    name:
                        'redis.host-port',

                    message:
                        'TITech Redis host/port configuration is present.',
                },
            );
        }

        if (
            isProduction(
                this.environment,
            ) &&
            this.options.production
                .requireRedisUrl
        ) {

            return this.recordError(
                {
                    name:
                        'redis.configuration',

                    code:
                        'REDIS_CONFIGURATION_REQUIRED',

                    message:
                        'TITech production Redis configuration is required.',
                },
            );
        }

        return this.recordSkip(
            {
                name:
                    'redis.configuration',

                message:
                    'TITech Redis configuration is not required by the active policy.',
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Tenant isolation.
     * -------------------------------------------------------------------------
     */

    validateTenantIsolation(
        source,
    ) {

        const enabled =
            asBoolean(
                source.ENABLE_TENANT_ISOLATION ??
                source.TENANT_ISOLATION_ENABLED,
                true,
            );

        if (
            isProduction(
                this.environment,
            ) &&
            this.options.production
                .requireTenantIsolation &&
            !enabled
        ) {

            return this.recordError(
                {
                    name:
                        'tenant.isolation',

                    code:
                        'TENANT_ISOLATION_REQUIRED',

                    message:
                        'TITech production tenant isolation must be enabled.',
                },
            );
        }

        if (
            asBoolean(
                source.ALLOW_CROSS_TENANT_ACCESS,
                false,
            )
        ) {

            return this.recordError(
                {
                    name:
                        'tenant.cross-access',

                    code:
                        'CROSS_TENANT_ACCESS_FORBIDDEN',

                    message:
                        'TITech environment configuration cannot enable unrestricted cross-tenant access.',
                },
            );
        }

        return this.recordPass(
            {
                name:
                    'tenant.isolation',

                message:
                    'TITech tenant isolation policy is enabled.',
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Financial safety.
     * -------------------------------------------------------------------------
     */

    validateFinancialSafety(
        source,
    ) {

        const idempotencyEnabled =
            asBoolean(
                source.ENABLE_IDEMPOTENCY ??
                source.IDEMPOTENCY_ENABLED,
                true,
            );

        const auditEnabled =
            asBoolean(
                source.ENABLE_AUDIT_LOGGING ??
                source.AUDIT_LOGGING_ENABLED,
                true,
            );

        if (
            isProduction(
                this.environment,
            ) &&
            this.options.production
                .requireIdempotency &&
            !idempotencyEnabled
        ) {

            this.recordError(
                {
                    name:
                        'financial.idempotency',

                    code:
                        'IDEMPOTENCY_REQUIRED',

                    message:
                        'TITech production financial operations require idempotency protection.',
                },
            );
        } else {

            this.recordPass(
                {
                    name:
                        'financial.idempotency',

                    message:
                        'TITech idempotency policy is enabled or not prohibited by the current environment.',
                },
            );
        }

        if (
            isProduction(
                this.environment,
            ) &&
            this.options.production
                .requireAudit &&
            !auditEnabled
        ) {

            this.recordError(
                {
                    name:
                        'financial.audit',

                    code:
                        'AUDIT_LOGGING_REQUIRED',

                    message:
                        'TITech production audit logging must remain enabled.',
                },
            );
        } else {

            this.recordPass(
                {
                    name:
                        'financial.audit',

                    message:
                        'TITech audit logging policy is enabled or not prohibited by the current environment.',
                },
            );
        }

        /**
         * Financial mutation controls must never be explicitly disabled in
         * production through environment flags.
         */
        const financialWritesDisabled =
            asBoolean(
                source.DISABLE_FINANCIAL_WRITES,
                false,
            );

        if (
            isProduction(
                this.environment,
            ) &&
            financialWritesDisabled
        ) {

            this.recordWarning(
                {
                    name:
                        'financial.writes',

                    code:
                        'FINANCIAL_WRITES_DISABLED',

                    message:
                        'TITech financial writes are explicitly disabled in the production environment.',
                },
            );
        }

        return true;
    }

    /**
     * -------------------------------------------------------------------------
     * Normalized environment.
     * -------------------------------------------------------------------------
     */

    buildNormalizedEnvironment(
        source,
    ) {

        const output = {};

        for (
            const [
                variable,
                definition,
            ] of Object.entries(
                this.options.variables,
            )
        ) {

            let value =
                source[
                    variable
                ];

            if (
                isEmpty(
                    value,
                )
            ) {

                if (
                    definition.default !==
                    undefined
                ) {

                    value =
                        definition.default;
                } else {

                    continue;
                }
            }

            switch (
                definition.type
            ) {

                case VALUE_TYPES.BOOLEAN:

                    value =
                        asBoolean(
                            value,
                            false,
                        );

                    break;

                case VALUE_TYPES.INTEGER:

                    value =
                        Number.parseInt(
                            value,
                            10,
                        );

                    break;

                case VALUE_TYPES.NUMBER:

                    value =
                        Number(
                            value,
                        );

                    break;

                case VALUE_TYPES.JSON:

                    try {

                        value =
                            typeof value ===
                                'string'
                                ? JSON.parse(
                                    value,
                                )
                                : clone(
                                    value,
                                );

                    } catch {

                        value =
                            null;
                    }

                    break;

                case VALUE_TYPES.ENUM:

                case VALUE_TYPES.STRING:

                case VALUE_TYPES.URL:

                case VALUE_TYPES.EMAIL:

                case VALUE_TYPES.REGEX:

                default:

                    value =
                        String(
                            value,
                        ).trim();
            }

            output[
                variable
            ] =
                value;
        }

        return deepFreeze(
            output,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Fingerprint payload.
     * -------------------------------------------------------------------------
     */

    buildFingerprintPayload(
        source,
    ) {

        const payload = {
            environment:
                this.environment,

            normalized:
                this.normalized,

            /**
             * Secret values are represented by per-variable hashes so changes
             * remain detectable without putting the secret itself in the
             * validation fingerprint payload.
             */
            sensitive: {},
        };

        for (
            const [
                variable,
                value,
            ] of Object.entries(
                source,
            )
        ) {

            if (
                DEFAULTS
                    .sensitivePattern
                    .test(
                        variable,
                    )
            ) {

                payload.sensitive[
                    variable
                ] =
                    fingerprint(
                        String(
                            value ??
                            '',
                        ),
                        this.options
                            .fingerprintAlgorithm,
                    );
            }
        }

        return payload;
    }

    /**
     * -------------------------------------------------------------------------
     * Record check.
     * -------------------------------------------------------------------------
     */

    recordCheck(
        check,
    ) {

        if (
            this.checks.length >=
            this.options.maxChecks
        ) {

            return;
        }

        const normalized = {
            name:
                check.name ||
                'environment.check',

            variable:
                check.variable ||
                null,

            status:
                check.status ||
                RESULT_STATUSES.PASS,

            severity:
                check.severity ||
                SEVERITIES.INFO,

            code:
                check.code ||
                null,

            message:
                check.message ||
                '',

            details:
                check.details ||
                null,

            timestamp:
                new Date().toISOString(),
        };

        this.checks.push(
            normalized,
        );

        return normalized;
    }

    recordPass(
        check,
    ) {

        check.status =
            RESULT_STATUSES.PASS;

        check.severity =
            SEVERITIES.INFO;

        return this.recordCheck(
            check,
        );
    }

    recordSkip(
        check,
    ) {

        check.status =
            RESULT_STATUSES.SKIP;

        check.severity =
            SEVERITIES.INFO;

        this.skipped.push(
            {
                ...check,
                status:
                    RESULT_STATUSES.SKIP,
            },
        );

        return this.recordCheck(
            check,
        );
    }

    recordWarning(
        check,
    ) {

        check.status =
            RESULT_STATUSES.WARN;

        check.severity =
            check.severity ||
            SEVERITIES.WARNING;

        const normalized =
            this.recordCheck(
                check,
            );

        if (
            this.warnings.length <
            this.options.maxWarnings
        ) {

            this.warnings.push(
                normalized,
            );
        }

        return normalized;
    }

    recordError(
        check,
        metadata = {},
    ) {

        const normalizedInput =
            check instanceof Error
                ? {
                    name:
                        'environment.error',

                    code:
                        check.code ||
                        'ENVIRONMENT_VALIDATION_ERROR',

                    variable:
                        check.variable ||
                        metadata.variable ||
                        null,

                    message:
                        check.message ||
                        String(
                            check,
                        ),

                    severity:
                        metadata.severity ||
                        SEVERITIES.ERROR,

                    details:
                        check.details ||
                        metadata.details ||
                        null,
                }
                : {
                    ...check,

                    name:
                        check.name ||
                        'environment.error',

                    severity:
                        check.severity ||
                        metadata.severity ||
                        SEVERITIES.ERROR,
                };

        normalizedInput.status =
            RESULT_STATUSES.FAIL;

        const result =
            this.recordCheck(
                normalizedInput,
            );

        if (
            this.errors.length <
            this.options.maxErrors
        ) {

            this.errors.push(
                result,
            );
        }

        this.valid =
            false;

        return result;
    }

    /**
     * -------------------------------------------------------------------------
     * Reset collections.
     * -------------------------------------------------------------------------
     */

    resetCollections() {

        this.status =
            VALIDATION_STATUSES
                .VALID;

        this.valid =
            true;

        this.startedAt =
            null;

        this.completedAt =
            null;

        this.durationMs =
            0;

        this.checks.length =
            0;

        this.errors.length =
            0;

        this.warnings.length =
            0;

        this.skipped.length =
            0;

        this.normalized =
            {};

        this.fingerprintValue =
            null;

        this.lastError =
            null;

        return this;
    }

    /**
     * -------------------------------------------------------------------------
     * Build result.
     * -------------------------------------------------------------------------
     */

    buildResult() {

        return deepFreeze({
            status:
                this.status,

            valid:
                this.valid,

            ready:
                this.valid,

            environment:
                this.environment,

            service:
                SERVICE_NAME,

            application:
                APPLICATION_NAME,

            summary: {
                total:
                    this.checks.length,

                passed:
                    this.checks.filter(
                        check =>
                            check.status ===
                            RESULT_STATUSES.PASS,
                    ).length,

                warnings:
                    this.warnings.length,

                failures:
                    this.errors.length,

                skipped:
                    this.checks.filter(
                        check =>
                            check.status ===
                            RESULT_STATUSES.SKIP,
                    ).length,
            },

            checks:
                clone(
                    this.checks,
                ),

            errors:
                clone(
                    this.errors,
                ),

            warnings:
                clone(
                    this.warnings,
                ),

            skipped:
                clone(
                    this.skipped,
                ),

            normalized:
                clone(
                    this.normalized,
                ),

            fingerprint: {
                algorithm:
                    this.options
                        .fingerprintAlgorithm,

                value:
                    this.fingerprintValue,
            },

            durationMs:
                Number(
                    this.durationMs.toFixed(
                        3,
                    ),
                ),

            startedAt:
                this.startedAt,

            completedAt:
                this.completedAt,

            timestamp:
                new Date().toISOString(),
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Validate current process environment.
     * -------------------------------------------------------------------------
     */

    validateCurrent(
        options = {},
    ) {

        return this.validate(
            process.env,
            options,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Readiness.
     * -------------------------------------------------------------------------
     */

    readiness() {

        return {
            ready:
                this.valid &&
                this.status !==
                    VALIDATION_STATUSES.INVALID,

            status:
                this.valid
                    ? this.warnings.length > 0
                        ? 'degraded'
                        : 'ready'
                    : 'not_ready',

            environment:
                this.environment,

            errors:
                this.errors.length,

            warnings:
                this.warnings.length,

            fingerprint:
                this.fingerprintValue,

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

        return {
            status:
                this.valid
                    ? this.warnings.length > 0
                        ? 'degraded'
                        : 'healthy'
                    : 'unhealthy',

            healthy:
                this.valid,

            degraded:
                this.valid &&
                this.warnings.length > 0,

            environment:
                this.environment,

            errors:
                this.errors.length,

            warnings:
                this.warnings.length,

            fingerprint:
                this.fingerprintValue,

            timestamp:
                new Date().toISOString(),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Snapshot.
     * -------------------------------------------------------------------------
     */

    snapshot(
        options = {},
    ) {

        const result =
            this.lastResult ||
            this.buildResult();

        const output = {
            component:
                COMPONENT,

            service:
                SERVICE_NAME,

            application:
                APPLICATION_NAME,

            state:
                this.status,

            environment:
                this.environment,

            result,

            bootstrapState:
                null,

            environmentSnapshot:
                null,

            timestamp:
                new Date().toISOString(),
        };

        const bootstrapState =
            bootstrapStateModule
                ?.bootstrapState ||
            bootstrapStateModule;

        if (
            bootstrapState &&
            typeof bootstrapState.snapshot ===
                'function'
        ) {

            try {

                output.bootstrapState =
                    bootstrapState.snapshot(
                        {
                            exposeHistory:
                                false,

                            exposeTransitions:
                                false,
                        },
                    );

            } catch {
                output.bootstrapState =
                    null;
            }
        }

        const environmentSnapshot =
            environmentSnapshotModule
                ?.environmentSnapshot ||
            environmentSnapshotModule;

        if (
            environmentSnapshot &&
            typeof environmentSnapshot.getSnapshot ===
                'function'
        ) {

            try {

                output.environmentSnapshot =
                    environmentSnapshot.getSnapshot(
                        {
                            exposeValues:
                                false,
                        },
                    );

            } catch {
                output.environmentSnapshot =
                    null;
            }
        }

        return deepFreeze(
            output,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Reset.
     * -------------------------------------------------------------------------
     */

    reset() {

        this.resetCollections();

        this.lastResult =
            null;

        return this;
    }
}

/**
 * =============================================================================
 * Singleton
 * =============================================================================
 */

const environmentValidator =
    new EnvironmentValidator({
        strict:
            true,

        failClosed:
            true,

        rejectUnknownEnvironment:
            true,

        allowWarnings:
            true,

        environment:
            process.env.NODE_ENV ||
            DEFAULTS.environment,
    });

/**
 * =============================================================================
 * Convenience API
 * =============================================================================
 */

function validate(
    environment,
    options,
) {

    return environmentValidator.validate(
        environment,
        options,
    );
}

function validateCurrent(
    options,
) {

    return environmentValidator.validateCurrent(
        options,
    );
}

function readiness() {

    return environmentValidator.readiness();
}

function health() {

    return environmentValidator.health();
}

function snapshot(
    options,
) {

    return environmentValidator.snapshot(
        options,
    );
}

function reset() {

    return environmentValidator.reset();
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
        environmentValidator,

        EnvironmentValidator,

        EnvironmentValidationError,

        /**
         * Constants.
         */
        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        ENVIRONMENTS,

        SUPPORTED_ENVIRONMENTS,

        VALIDATION_STATUSES,

        RESULT_STATUSES,

        SEVERITIES,

        VALUE_TYPES,

        DEFAULTS,

        /**
         * Validation.
         */
        validate,

        validateCurrent,

        /**
         * Operational state.
         */
        readiness,

        health,

        snapshot,

        /**
         * Helpers.
         */
        normalizeEnvironment,

        isProduction,

        isSupportedEnvironment,

        asBoolean,

        fingerprint,

        /**
         * Reset/testing.
         */
        reset,
    });