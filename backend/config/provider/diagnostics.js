'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/provider/diagnostics.js
 *
 * Purpose:
 *   Enterprise production-grade configuration diagnostics and health provider.
 *
 * Responsibilities:
 *   - Inspect centralized TITech configuration safely.
 *   - Produce configuration diagnostics without exposing secrets.
 *   - Track configuration health/readiness.
 *   - Detect missing/invalid configuration.
 *   - Report loaded configuration modules.
 *   - Report configuration source metadata.
 *   - Detect environment/configuration drift.
 *   - Produce safe fingerprints.
 *   - Support bootstrap and operational diagnostics.
 *   - Integrate with the canonical ConfigurationProvider.
 *   - Gracefully degrade when optional configuration components are unavailable.
 *
 * IMPORTANT:
 *
 *   This module is OBSERVABILITY / DIAGNOSTICS ONLY.
 *
 *   It does NOT:
 *     - mutate configuration.
 *     - mutate process.env.
 *     - initialize infrastructure.
 *     - connect to databases.
 *     - connect to Redis.
 *     - create HTTP servers.
 *     - execute business logic.
 *     - execute financial transactions.
 *     - replace configuration validation.
 *
 * Canonical configuration flow:
 *
 *   process.env
 *       ↓
 *   environment.js
 *       ↓
 *   config modules
 *       ↓
 *   ConfigurationProvider
 *       ↓
 *   diagnostics.js
 *       ↓
 *   readiness / health / bootstrap diagnostics
 *
 * =============================================================================
 */

const os =
    require('node:os');

const process =
    require('node:process');

const crypto =
    require('node:crypto');

/**
 * =============================================================================
 * Canonical ConfigurationProvider
 * =============================================================================
 */

let configurationProviderModule =
    null;

try {

    // eslint-disable-next-line global-require
    configurationProviderModule =
        require('./ConfigurationProvider');

} catch {
    configurationProviderModule =
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
        require('../../utils/logger');

} catch {
    loggerModule =
        null;
}

/**
 * =============================================================================
 * Optional startup error integration
 * =============================================================================
 */

let startupErrors =
    null;

try {

    // eslint-disable-next-line global-require
    startupErrors =
        require('../../bootstrap/startupErrors');

} catch {
    startupErrors =
        null;
}

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const COMPONENT =
    'configuration-diagnostics';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

const DIAGNOSTIC_STATES =
    Object.freeze({
        CREATED:
            'created',

        INITIALIZING:
            'initializing',

        HEALTHY:
            'healthy',

        DEGRADED:
            'degraded',

        UNHEALTHY:
            'unhealthy',

        STOPPED:
            'stopped',
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

const CHECK_STATUSES =
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

const DEFAULTS =
    Object.freeze({
        enabled:
            true,

        strict:
            true,

        includeModuleDiagnostics:
            true,

        includeConfigurationFingerprint:
            true,

        includeEnvironment:
            true,

        includeRuntime:
            true,

        includeSources:
            true,

        includeWarnings:
            true,

        includeErrors:
            true,

        redactSecrets:
            true,

        exposePaths:
            false,

        exposeEnvironmentVariables:
            false,

        exposeSystemDetails:
            true,

        maxDiagnostics:
            250,

        maxWarnings:
            100,

        maxErrors:
            100,

        cacheDurationMs:
            5_000,

        healthTimeoutMs:
            5_000,

        fingerprintAlgorithm:
            'sha256',

        /**
         * Configuration expected in every production deployment.
         *
         * These are logical paths, not necessarily direct secrets.
         */
        requiredProductionPaths:
            Object.freeze([
                'app.name',
                'app.serviceName',
                'app.environment',
                'app.version',
                'runtime',
            ]),

        /**
         * Configuration that should exist when corresponding subsystems are
         * enabled.
         */
        subsystemChecks:
            Object.freeze({
                database:
                    [
                        'db',
                    ],

                redis:
                    [
                        'redis',
                    ],

                storage:
                    [
                        'storage',
                    ],

                tenants:
                    [
                        'tenants',
                    ],

                jwt:
                    [
                        'jwt',
                    ],

                mail:
                    [
                        'mail',
                    ],

                queues:
                    [
                        'queues',
                    ],

                observability:
                    [
                        'observability',
                    ],
            }),
    });

/**
 * =============================================================================
 * Utility functions
 * =============================================================================
 */

function asBoolean(
    value,
    fallback,
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

function asPositiveInteger(
    value,
    fallback,
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

    if (
        !Number.isInteger(
            parsed,
        ) ||
        parsed <= 0
    ) {

        return fallback;
    }

    return parsed;
}

function normalizeEnvironment(
    value,
) {

    const normalized =
        String(
            value ||
            process.env.NODE_ENV ||
            'development',
        )
            .trim()
            .toLowerCase();

    return (
        [
            'development',
            'test',
            'staging',
            'production',
        ].includes(
            normalized,
        )
            ? normalized
            : 'development'
    );
}

function isProduction(
    environment,
) {

    return (
        environment ===
        'production'
    );
}

function isPlainObject(
    value,
) {

    if (
        value === null ||
        typeof value !==
            'object'
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
        prototype ===
            null
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
        const key of
        Reflect.ownKeys(
            object,
        )
    ) {

        try {

            deepFreeze(
                object[key],
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
        isPlainObject(
            value,
        )
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

function getByPath(
    object,
    path,
    fallback,
) {

    if (
        !path
    ) {

        return (
            object === undefined
                ? fallback
                : object
        );
    }

    const parts =
        Array.isArray(
            path,
        )
            ? path
            : String(
                path,
            )
                .split('.')
                .filter(Boolean);

    let current =
        object;

    for (
        const part of
        parts
    ) {

        if (
            current === undefined ||
            current === null
        ) {

            return fallback;
        }

        if (
            !Object.prototype.hasOwnProperty.call(
                Object(
                    current,
                ),
                part,
            )
        ) {

            return fallback;
        }

        current =
            current[part];
    }

    return (
        current === undefined
            ? fallback
            : current
    );
}

function hasByPath(
    object,
    path,
) {

    const sentinel =
        Symbol(
            'missing',
        );

    return (
        getByPath(
            object,
            path,
            sentinel,
        ) !==
        sentinel
    );
}

function safeError(
    error,
) {

    return {
        name:
            error?.name ||
            'Error',

        code:
            error?.code ||
            'UNKNOWN',

        message:
            error?.message ||
            String(
                error,
            ),

        path:
            error?.path ||
            null,
    };
}

function fingerprint(
    value,
    algorithm =
        DEFAULTS.fingerprintAlgorithm,
) {

    const canonical =
        JSON.stringify(
            value,
        );

    return crypto
        .createHash(
            algorithm,
        )
        .update(
            canonical,
            'utf8',
        )
        .digest(
            'hex',
        );
}

/**
 * =============================================================================
 * Redaction
 * =============================================================================
 */

const SENSITIVE_KEY_PATTERN =
    /(password|passwd|secret|token|authorization|api[_-]?key|private[_-]?key|client[_-]?secret|encryption[_-]?key|signing[_-]?key|connection[_-]?(string|uri)|mongo(uri)?|redispassword|smtp[_-]?password|jwt[_-]?secret)/i;

function sanitize(
    value,
    {
        redactSecrets = true,
        exposePaths = false,
        exposeEnvironmentVariables = false,
        maxDepth = 15,
    } = {},
    path =
        '',
    seen =
        new WeakSet(),
) {

    if (
        path.split('.').length >
        maxDepth
    ) {

        return '[MAX_DEPTH]';
    }

    if (
        value === undefined
    ) {

        return undefined;
    }

    if (
        value === null
    ) {

        return null;
    }

    if (
        typeof value ===
            'string' ||
        typeof value ===
            'number' ||
        typeof value ===
            'boolean'
    ) {

        const leaf =
            path
                .split('.')
                .pop() ||
            '';

        if (
            redactSecrets &&
            SENSITIVE_KEY_PATTERN.test(
                leaf,
            )
        ) {

            return '[REDACTED]';
        }

        return value;
    }

    if (
        typeof value ===
        'function'
    ) {

        return '[FUNCTION]';
    }

    if (
        typeof value ===
        'bigint'
    ) {

        return `${value}n`;
    }

    if (
        typeof value !==
        'object'
    ) {

        return String(
            value,
        );
    }

    if (
        seen.has(
            value,
        )
    ) {

        return '[CIRCULAR]';
    }

    seen.add(
        value,
    );

    if (
        Array.isArray(
            value,
        )
    ) {

        return value.map(
            (
                item,
                index,
            ) =>
                sanitize(
                    item,
                    {
                        redactSecrets,
                        exposePaths,
                        exposeEnvironmentVariables,
                        maxDepth,
                    },
                    path
                        ? `${path}.${index}`
                        : String(index),
                    seen,
                ),
        );
    }

    const result = {};

    for (
        const [
            key,
            item,
        ] of Object.entries(
            value,
        )
    ) {

        const childPath =
            path
                ? `${path}.${key}`
                : key;

        if (
            redactSecrets &&
            SENSITIVE_KEY_PATTERN.test(
                key,
            )
        ) {

            result[key] =
                '[REDACTED]';

            continue;
        }

        /**
         * Environment variables are particularly risky to expose because they
         * commonly contain secrets even when their names are not obvious.
         */
        if (
            childPath.startsWith(
                'environment.',
            ) &&
            !exposeEnvironmentVariables
        ) {

            result[key] =
                '[HIDDEN]';

            continue;
        }

        if (
            (
                childPath.includes(
                    '.path',
                ) ||
                childPath.endsWith(
                    'file',
                )
            ) &&
            !exposePaths
        ) {

            result[key] =
                '[HIDDEN]';

            continue;
        }

        result[key] =
            sanitize(
                item,
                {
                    redactSecrets,
                    exposePaths,
                    exposeEnvironmentVariables,
                    maxDepth,
                },
                childPath,
                seen,
            );
    }

    return result;
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
        }

    } catch {
        // Diagnostics must never fail because logging failed.
    }
}

/**
 * =============================================================================
 * Configuration provider resolution
 * =============================================================================
 */

function resolveConfigurationProvider() {

    if (
        !configurationProviderModule
    ) {

        return null;
    }

    return (
        configurationProviderModule.provider ||
        configurationProviderModule
    );
}

function resolveConfigurationSnapshot() {

    const provider =
        resolveConfigurationProvider();

    if (
        !provider
    ) {

        return {
            provider:
                null,

            configuration:
                null,

            snapshot:
                null,

            operationalSnapshot:
                null,

            available:
                false,
        };
    }

    try {

        const configuration =
            typeof provider.getConfiguration ===
            'function'
                ? provider.getConfiguration()
                : provider.configuration ||
                    configurationProviderModule.configuration ||
                    null;

        const snapshot =
            typeof provider.snapshot ===
            'function'
                ? provider.snapshot()
                : typeof configurationProviderModule.snapshot ===
                    'function'
                    ? configurationProviderModule.snapshot()
                    : configuration;

        const operationalSnapshot =
            typeof provider.operationalSnapshot ===
            'function'
                ? provider.operationalSnapshot()
                : typeof configurationProviderModule.operationalSnapshot ===
                    'function'
                    ? configurationProviderModule.operationalSnapshot()
                    : null;

        return {
            provider,

            configuration,

            snapshot,

            operationalSnapshot,

            available:
                Boolean(
                    configuration ||
                    snapshot,
                ),
        };

    } catch (
        error
    ) {

        return {
            provider,

            configuration:
                null,

            snapshot:
                null,

            operationalSnapshot:
                null,

            available:
                false,

            error,
        };
    }
}

/**
 * =============================================================================
 * Diagnostic checks
 * =============================================================================
 */

class DiagnosticCheck {

    constructor(
        {
            name,
            status,
            severity =
                SEVERITIES.INFO,
            message,
            details =
                null,
            durationMs =
                0,
        },
    ) {

        this.name =
            name;

        this.status =
            status;

        this.severity =
            severity;

        this.message =
            message;

        this.details =
            details;

        this.durationMs =
            durationMs;
    }

    toJSON() {

        return {
            name:
                this.name,

            status:
                this.status,

            severity:
                this.severity,

            message:
                this.message,

            details:
                this.details,

            durationMs:
                Number(
                    this.durationMs.toFixed(
                        3,
                    ),
                ),
        };
    }
}

/**
 * =============================================================================
 * ConfigurationDiagnostics class
 * =============================================================================
 */

class ConfigurationDiagnostics {

    constructor(
        options = {},
    ) {

        this.options =
            Object.freeze({
                enabled:
                    options.enabled ??
                    asBoolean(
                        process.env.CONFIG_DIAGNOSTICS_ENABLED,
                        DEFAULTS.enabled,
                    ),

                strict:
                    options.strict ??
                    DEFAULTS.strict,

                includeModuleDiagnostics:
                    options.includeModuleDiagnostics ??
                    DEFAULTS.includeModuleDiagnostics,

                includeConfigurationFingerprint:
                    options.includeConfigurationFingerprint ??
                    DEFAULTS.includeConfigurationFingerprint,

                includeEnvironment:
                    options.includeEnvironment ??
                    DEFAULTS.includeEnvironment,

                includeRuntime:
                    options.includeRuntime ??
                    DEFAULTS.includeRuntime,

                includeSources:
                    options.includeSources ??
                    DEFAULTS.includeSources,

                includeWarnings:
                    options.includeWarnings ??
                    DEFAULTS.includeWarnings,

                includeErrors:
                    options.includeErrors ??
                    DEFAULTS.includeErrors,

                redactSecrets:
                    options.redactSecrets ??
                    true,

                exposePaths:
                    options.exposePaths ??
                    false,

                exposeEnvironmentVariables:
                    options.exposeEnvironmentVariables ??
                    false,

                exposeSystemDetails:
                    options.exposeSystemDetails ??
                    true,

                maxDiagnostics:
                    asPositiveInteger(
                        options.maxDiagnostics,
                        DEFAULTS.maxDiagnostics,
                    ),

                maxWarnings:
                    asPositiveInteger(
                        options.maxWarnings,
                        DEFAULTS.maxWarnings,
                    ),

                maxErrors:
                    asPositiveInteger(
                        options.maxErrors,
                        DEFAULTS.maxErrors,
                    ),

                cacheDurationMs:
                    asPositiveInteger(
                        options.cacheDurationMs,
                        DEFAULTS.cacheDurationMs,
                    ),

                healthTimeoutMs:
                    asPositiveInteger(
                        options.healthTimeoutMs,
                        DEFAULTS.healthTimeoutMs,
                    ),

                fingerprintAlgorithm:
                    options.fingerprintAlgorithm ||
                    DEFAULTS.fingerprintAlgorithm,

                requiredProductionPaths:
                    Object.freeze([
                        ...(
                            options.requiredProductionPaths ||
                            DEFAULTS.requiredProductionPaths
                        ),
                    ]),

                subsystemChecks:
                    Object.freeze({
                        ...DEFAULTS.subsystemChecks,
                        ...(options.subsystemChecks || {}),
                    }),
            });

        this.state =
            DIAGNOSTIC_STATES.CREATED;

        this.initializedAt =
            null;

        this.lastRunAt =
            null;

        this.lastResult =
            null;

        this.lastError =
            null;

        this.checks =
            [];

        this.warnings =
            [];

        this.errors =
            [];

        this._initializePromise =
            null;

        this._cacheTimer =
            null;
    }

    /**
     * -------------------------------------------------------------------------
     * Initialize.
     * -------------------------------------------------------------------------
     */

    async initialize() {

        if (
            this.state ===
            DIAGNOSTIC_STATES.HEALTHY ||
            this.state ===
            DIAGNOSTIC_STATES.DEGRADED
        ) {

            return this;
        }

        if (
            this._initializePromise
        ) {

            return this._initializePromise;
        }

        this._initializePromise =
            (async () => {

                this.state =
                    DIAGNOSTIC_STATES
                        .INITIALIZING;

                this.initializedAt =
                    new Date();

                try {

                    if (
                        this.options.enabled
                    ) {

                        await this.run({
                            force:
                                true,
                        });

                    } else {

                        this.state =
                            DIAGNOSTIC_STATES
                                .STOPPED;
                    }

                    return this;

                } catch (
                    error
                ) {

                    this.state =
                        DIAGNOSTIC_STATES
                            .UNHEALTHY;

                    this.lastError =
                        error;

                    throw error;
                }
            })();

        try {

            return await this._initializePromise;

        } finally {

            this._initializePromise =
                null;
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Execute diagnostic run.
     * -------------------------------------------------------------------------
     */

    async run(
        options = {},
    ) {

        if (
            !this.options.enabled
        ) {

            return this.createDisabledResult();
        }

        const now =
            Date.now();

        if (
            !options.force &&
            this.lastResult &&
            this.lastRunAt &&
            (
                now -
                this.lastRunAt.getTime()
            ) <
                this.options
                    .cacheDurationMs
        ) {

            return this.lastResult;
        }

        const started =
            process.hrtime.bigint();

        this.checks.length =
            0;

        this.warnings.length =
            0;

        this.errors.length =
            0;

        this.lastError =
            null;

        try {

            const configuration =
                resolveConfigurationSnapshot();

            this.runProviderCheck(
                configuration,
            );

            this.runEnvironmentCheck();

            this.runRequiredConfigurationCheck(
                configuration,
            );

            this.runSubsystemChecks(
                configuration,
            );

            this.runModuleChecks();

            this.runConsistencyChecks(
                configuration,
            );

            this.runSecurityChecks(
                configuration,
            );

            this.runRuntimeChecks();

            const durationMs =
                Number(
                    process.hrtime.bigint() -
                    started,
                ) /
                1_000_000;

            const result =
                this.buildResult(
                    {
                        durationMs,
                        configuration,
                    },
                );

            this.lastRunAt =
                new Date();

            this.lastResult =
                deepFreeze(
                    result,
                );

            this.state =
                result.status ===
                    'healthy'
                    ? DIAGNOSTIC_STATES
                        .HEALTHY
                    : result.status ===
                        'degraded'
                        ? DIAGNOSTIC_STATES
                            .DEGRADED
                        : DIAGNOSTIC_STATES
                            .UNHEALTHY;

            return this.lastResult;

        } catch (
            error
        ) {

            this.lastError =
                error;

            this.state =
                DIAGNOSTIC_STATES
                    .UNHEALTHY;

            log(
                'error',
                {
                    error:
                        safeError(
                            error,
                        ),
                },
                'TITech configuration diagnostics execution failed.',
            );

            const wrapped =
                error instanceof Error
                    ? error
                    : new Error(
                        String(
                            error,
                        ),
                    );

            if (
                startupErrors?.configurationError &&
                this.options.strict
            ) {

                try {

                    throw startupErrors.configurationError(
                        'TITech configuration diagnostics failed.',
                        {
                            cause:
                                wrapped,

                            critical:
                                true,

                            fatal:
                                false,

                            details: {
                                component:
                                    COMPONENT,

                                status:
                                    this.state,
                            },
                        },
                    );

                } catch (
                    startupError
                ) {

                    throw startupError;
                }
            }

            throw wrapped;
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Provider check.
     * -------------------------------------------------------------------------
     */

    runProviderCheck(
        resolved,
    ) {

        const started =
            process.hrtime.bigint();

        if (
            !resolved.available
        ) {

            return this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'configuration-provider',

                    status:
                        CHECK_STATUSES.FAIL,

                    severity:
                        SEVERITIES.CRITICAL,

                    message:
                        'TITech ConfigurationProvider is unavailable.',

                    details:
                        resolved.error
                            ? safeError(
                                resolved.error,
                            )
                            : null,

                    durationMs:
                        Number(
                            process.hrtime.bigint() -
                            started,
                        ) /
                        1_000_000,
                }),
            );
        }

        const state =
            resolved.operationalSnapshot
                ?.state;

        if (
            state ===
            'invalid'
        ) {

            return this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'configuration-provider',

                    status:
                        CHECK_STATUSES.FAIL,

                    severity:
                        SEVERITIES.CRITICAL,

                    message:
                        'TITech ConfigurationProvider reports an invalid configuration state.',

                    details:
                        resolved.operationalSnapshot,

                    durationMs:
                        Number(
                            process.hrtime.bigint() -
                            started,
                        ) /
                        1_000_000,
                }),
            );
        }

        if (
            state ===
            'degraded'
        ) {

            return this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'configuration-provider',

                    status:
                        CHECK_STATUSES.WARN,

                    severity:
                        SEVERITIES.WARNING,

                    message:
                        'TITech ConfigurationProvider is operating in degraded mode.',

                    details:
                        this.options
                            .includeModuleDiagnostics
                            ? sanitize(
                                resolved.operationalSnapshot,
                                this.options,
                            )
                            : null,

                    durationMs:
                        Number(
                            process.hrtime.bigint() -
                            started,
                        ) /
                        1_000_000,
                }),
            );
        }

        return this.recordCheck(
            new DiagnosticCheck({
                name:
                    'configuration-provider',

                status:
                    CHECK_STATUSES.PASS,

                severity:
                    SEVERITIES.INFO,

                message:
                    'TITech ConfigurationProvider is available and operational.',

                durationMs:
                    Number(
                        process.hrtime.bigint() -
                        started,
                    ) /
                    1_000_000,
            }),
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Environment check.
     * -------------------------------------------------------------------------
     */

    runEnvironmentCheck() {

        const environment =
            normalizeEnvironment(
                process.env.NODE_ENV,
            );

        const supported =
            [
                'development',
                'test',
                'staging',
                'production',
            ].includes(
                environment,
            );

        if (
            !supported
        ) {

            return this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'environment',

                    status:
                        CHECK_STATUSES.FAIL,

                    severity:
                        SEVERITIES.ERROR,

                    message:
                        'TITech runtime environment is unsupported.',

                    details: {
                        environment,
                    },
                }),
            );
        }

        if (
            isProduction(
                environment,
            )
        ) {

            return this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'environment',

                    status:
                        CHECK_STATUSES.PASS,

                    severity:
                        SEVERITIES.INFO,

                    message:
                        'TITech is running in production environment.',

                    details: {
                        environment,
                    },
                }),
            );
        }

        return this.recordCheck(
            new DiagnosticCheck({
                name:
                    'environment',

                status:
                    CHECK_STATUSES.PASS,

                severity:
                    SEVERITIES.INFO,

                message:
                    `TITech is running in ${environment} environment.`,

                details: {
                    environment,
                },
            }),
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Required configuration check.
     * -------------------------------------------------------------------------
     */

    runRequiredConfigurationCheck(
        resolved,
    ) {

        const configuration =
            resolved.configuration;

        if (
            !configuration
        ) {

            return this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'required-configuration',

                    status:
                        CHECK_STATUSES.FAIL,

                    severity:
                        SEVERITIES.CRITICAL,

                    message:
                        'TITech configuration is unavailable.',
                }),
            );
        }

        const production =
            isProduction(
                normalizeEnvironment(
                    process.env.NODE_ENV,
                ),
            );

        const requiredPaths =
            production
                ? this.options
                    .requiredProductionPaths
                : [
                    'app.environment',
                    'app.serviceName',
                ];

        const missing = [];

        for (
            const path of
            requiredPaths
        ) {

            if (
                !hasByPath(
                    configuration,
                    path,
                )
            ) {

                missing.push(
                    path,
                );
            }
        }

        if (
            missing.length >
            0
        ) {

            return this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'required-configuration',

                    status:
                        CHECK_STATUSES.FAIL,

                    severity:
                        production
                            ? SEVERITIES.CRITICAL
                            : SEVERITIES.ERROR,

                    message:
                        'Required TITech configuration values are missing.',

                    details: {
                        missing,
                    },
                }),
            );
        }

        return this.recordCheck(
            new DiagnosticCheck({
                name:
                    'required-configuration',

                status:
                    CHECK_STATUSES.PASS,

                severity:
                    SEVERITIES.INFO,

                message:
                    'Required TITech configuration values are present.',

                details: {
                    checked:
                        requiredPaths.length,
                },
            }),
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Subsystem checks.
     * -------------------------------------------------------------------------
     */

    runSubsystemChecks(
        resolved,
    ) {

        const configuration =
            resolved.configuration ||
            {};

        const definitions =
            this.options
                .subsystemChecks;

        for (
            const [
                subsystem,
                paths,
            ] of Object.entries(
                definitions,
            )
        ) {

            const enabled =
                this.isSubsystemEnabled(
                    subsystem,
                    configuration,
                );

            if (
                enabled === false
            ) {

                this.recordCheck(
                    new DiagnosticCheck({
                        name:
                            `subsystem:${subsystem}`,

                        status:
                            CHECK_STATUSES.SKIP,

                        severity:
                            SEVERITIES.INFO,

                        message:
                            `TITech ${subsystem} subsystem is disabled.`,
                    }),
                );

                continue;
            }

            const available =
                paths.some(
                    path =>
                        hasByPath(
                            configuration,
                            path,
                        ),
                );

            if (
                !available
            ) {

                this.recordCheck(
                    new DiagnosticCheck({
                        name:
                            `subsystem:${subsystem}`,

                        status:
                            CHECK_STATUSES.WARN,

                        severity:
                            SEVERITIES.WARNING,

                        message:
                            `TITech ${subsystem} configuration was not found.`,

                        details: {
                            expectedPaths:
                                paths,
                        },
                    }),
                );

                continue;
            }

            this.recordCheck(
                new DiagnosticCheck({
                    name:
                        `subsystem:${subsystem}`,

                    status:
                        CHECK_STATUSES.PASS,

                    severity:
                        SEVERITIES.INFO,

                    message:
                        `TITech ${subsystem} configuration is available.`,
                }),
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Determine whether subsystem is enabled.
     * -------------------------------------------------------------------------
     */

    isSubsystemEnabled(
        subsystem,
        configuration,
    ) {

        const candidates = [
            `${subsystem}.enabled`,
            `${subsystem}.config.enabled`,
        ];

        for (
            const path of
            candidates
        ) {

            if (
                hasByPath(
                    configuration,
                    path,
                )
            ) {

                return asBoolean(
                    getByPath(
                        configuration,
                        path,
                    ),
                    true,
                );
            }
        }

        /**
         * If there is no explicit enabled flag, presence of the configuration
         * means the subsystem is potentially active.
         */
        return true;
    }

    /**
     * -------------------------------------------------------------------------
     * Module checks.
     * -------------------------------------------------------------------------
     */

    runModuleChecks() {

        if (
            !configurationProviderModule
        ) {

            return this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'configuration-modules',

                    status:
                        CHECK_STATUSES.FAIL,

                    severity:
                        SEVERITIES.ERROR,

                    message:
                        'TITech ConfigurationProvider module is unavailable.',
                }),
            );
        }

        const provider =
            resolveConfigurationProvider();

        if (
            !provider
        ) {

            return this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'configuration-modules',

                    status:
                        CHECK_STATUSES.FAIL,

                    severity:
                        SEVERITIES.ERROR,

                    message:
                        'TITech ConfigurationProvider instance is unavailable.',
                }),
            );
        }

        let modules = [];

        try {

            modules =
                typeof provider.listModules ===
                'function'
                    ? provider.listModules()
                    : [];

        } catch (
            error
        ) {

            return this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'configuration-modules',

                    status:
                        CHECK_STATUSES.WARN,

                    severity:
                        SEVERITIES.WARNING,

                    message:
                        'Unable to obtain TITech configuration module list.',

                    details:
                        safeError(
                            error,
                        ),
                }),
            );
        }

        const unavailable =
            [];

        for (
            const name of
            modules
        ) {

            try {

                const record =
                    typeof provider.getModuleRecord ===
                    'function'
                        ? provider.getModuleRecord(
                            name,
                        )
                        : null;

                if (
                    record &&
                    record.error
                ) {

                    unavailable.push({
                        name,

                        error:
                            record.error,
                    });
                }

            } catch {
                unavailable.push({
                    name,

                    error:
                        'module-record-unavailable',
                });
            }
        }

        if (
            unavailable.length >
            0
        ) {

            return this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'configuration-modules',

                    status:
                        CHECK_STATUSES.WARN,

                    severity:
                        SEVERITIES.WARNING,

                    message:
                        'One or more optional TITech configuration modules are unavailable.',

                    details: {
                        loadedCount:
                            modules.length -
                            unavailable.length,

                        unavailable,
                    },
                }),
            );
        }

        return this.recordCheck(
            new DiagnosticCheck({
                name:
                    'configuration-modules',

                status:
                    CHECK_STATUSES.PASS,

                severity:
                    SEVERITIES.INFO,

                message:
                    'TITech configuration modules are available.',

                details: {
                    loadedCount:
                        modules.length,
                },
            }),
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Configuration consistency checks.
     * -------------------------------------------------------------------------
     */

    runConsistencyChecks(
        resolved,
    ) {

        const configuration =
            resolved.configuration ||
            {};

        /**
         * Environment consistency.
         */
        const configuredEnvironment =
            getByPath(
                configuration,
                'app.environment',
                null,
            );

        const processEnvironment =
            normalizeEnvironment(
                process.env.NODE_ENV,
            );

        if (
            configuredEnvironment &&
            normalizeEnvironment(
                configuredEnvironment,
            ) !==
                processEnvironment
        ) {

            this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'environment-consistency',

                    status:
                        CHECK_STATUSES.FAIL,

                    severity:
                        SEVERITIES.ERROR,

                    message:
                        'TITech configuration environment does not match process environment.',

                    details: {
                        configured:
                            configuredEnvironment,

                        process:
                            processEnvironment,
                    },
                }),
            );

        } else {

            this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'environment-consistency',

                    status:
                        CHECK_STATUSES.PASS,

                    severity:
                        SEVERITIES.INFO,

                    message:
                        'TITech environment configuration is consistent.',
                }),
            );
        }

        /**
         * Service identity consistency.
         */
        const configuredService =
            getByPath(
                configuration,
                'app.serviceName',
                null,
            );

        if (
            configuredService &&
            configuredService !==
                SERVICE_NAME
        ) {

            this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'service-identity',

                    status:
                        CHECK_STATUSES.WARN,

                    severity:
                        SEVERITIES.WARNING,

                    message:
                        'TITech configured service name differs from runtime service identity.',

                    details: {
                        configured:
                            configuredService,

                        runtime:
                            SERVICE_NAME,
                    },
                }),
            );

        } else {

            this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'service-identity',

                    status:
                        CHECK_STATUSES.PASS,

                    severity:
                        SEVERITIES.INFO,

                    message:
                        'TITech service identity is consistent.',
                }),
            );
        }

        /**
         * Configuration mutability.
         */
        const provider =
            resolveConfigurationProvider();

        if (
            provider?.configuration &&
            !Object.isFrozen(
                provider.configuration,
            )
        ) {

            this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'configuration-immutability',

                    status:
                        CHECK_STATUSES.FAIL,

                    severity:
                        SEVERITIES.CRITICAL,

                    message:
                        'TITech configuration is mutable when immutable configuration is expected.',
                }),
            );

        } else {

            this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'configuration-immutability',

                    status:
                        CHECK_STATUSES.PASS,

                    severity:
                        SEVERITIES.INFO,

                    message:
                        'TITech configuration is immutable.',
                }),
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Security checks.
     * -------------------------------------------------------------------------
     */

    runSecurityChecks(
        resolved,
    ) {

        const configuration =
            resolved.configuration ||
            {};

        const production =
            isProduction(
                normalizeEnvironment(
                    process.env.NODE_ENV,
                ),
            );

        /**
         * Production configuration must not expose raw environment values.
         */
        if (
            production &&
            this.options
                .exposeEnvironmentVariables
        ) {

            this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'environment-exposure',

                    status:
                        CHECK_STATUSES.FAIL,

                    severity:
                        SEVERITIES.CRITICAL,

                    message:
                        'TITech diagnostics are configured to expose process environment variables in production.',
                }),
            );

        } else {

            this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'environment-exposure',

                    status:
                        CHECK_STATUSES.PASS,

                    severity:
                        SEVERITIES.INFO,

                    message:
                        'TITech diagnostics do not expose raw environment variables.',
                }),
            );
        }

        /**
         * Secret-redaction policy.
         */
        if (
            production &&
            !this.options
                .redactSecrets
        ) {

            this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'secret-redaction',

                    status:
                        CHECK_STATUSES.FAIL,

                    severity:
                        SEVERITIES.CRITICAL,

                    message:
                        'TITech production diagnostics have secret redaction disabled.',
                }),
            );

        } else {

            this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'secret-redaction',

                    status:
                        CHECK_STATUSES.PASS,

                    severity:
                        SEVERITIES.INFO,

                    message:
                        'TITech configuration diagnostics redact sensitive values.',
                }),
            );
        }

        /**
         * Runtime override policy.
         */
        const runtimeOverridesEnabled =
            getByPath(
                configuration,
                'security.allowRuntimeEnvMutation',
                false,
            ) ||
            getByPath(
                configuration,
                'runtime.security.allowRuntimeEnvMutation',
                false,
            );

        if (
            production &&
            runtimeOverridesEnabled
        ) {

            this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'runtime-configuration-mutation',

                    status:
                        CHECK_STATUSES.FAIL,

                    severity:
                        SEVERITIES.CRITICAL,

                    message:
                        'TITech production configuration allows runtime environment mutation.',
                }),
            );

        } else {

            this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'runtime-configuration-mutation',

                    status:
                        CHECK_STATUSES.PASS,

                    severity:
                        SEVERITIES.INFO,

                    message:
                        'TITech runtime configuration mutation is not enabled.',
                }),
            );
        }

        /**
         * Tenant security policy.
         */
        const tenantConfig =
            getByPath(
                configuration,
                'tenants',
                null,
            );

        if (
            tenantConfig &&
            production
        ) {

            const crossTenantAccess =
                getByPath(
                    tenantConfig,
                    'security.allowCrossTenantAccess',
                    false,
                );

            const tenantContextRequired =
                getByPath(
                    tenantConfig,
                    'requireTenantContext',
                    true,
                );

            if (
                crossTenantAccess
            ) {

                this.recordCheck(
                    new DiagnosticCheck({
                        name:
                            'tenant-cross-access',

                        status:
                            CHECK_STATUSES.FAIL,

                        severity:
                            SEVERITIES.CRITICAL,

                        message:
                            'TITech production tenant configuration permits unrestricted cross-tenant access.',
                    }),
                );

            } else if (
                !tenantContextRequired
            ) {

                this.recordCheck(
                    new DiagnosticCheck({
                        name:
                            'tenant-context',

                        status:
                            CHECK_STATUSES.FAIL,

                        severity:
                            SEVERITIES.CRITICAL,

                        message:
                            'TITech production tenant context is not required.',
                    }),
                );

            } else {

                this.recordCheck(
                    new DiagnosticCheck({
                        name:
                            'tenant-isolation',

                        status:
                            CHECK_STATUSES.PASS,

                        severity:
                            SEVERITIES.INFO,

                        message:
                            'TITech production tenant isolation policy is enabled.',
                    }),
                );
            }
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Runtime checks.
     * -------------------------------------------------------------------------
     */

    runRuntimeChecks() {

        const memory =
            process.memoryUsage();

        const heapUsedMb =
            memory.heapUsed /
            (1024 * 1024);

        const rssMb =
            memory.rss /
            (1024 * 1024);

        this.recordCheck(
            new DiagnosticCheck({
                name:
                    'node-runtime',

                status:
                    CHECK_STATUSES.PASS,

                severity:
                    SEVERITIES.INFO,

                message:
                    'TITech Node.js runtime is available.',

                details:
                    this.options
                        .includeSystemDetails
                        ? {
                            nodeVersion:
                                process.version,

                            platform:
                                process.platform,

                            architecture:
                                process.arch,

                            pid:
                                process.pid,

                            uptimeSeconds:
                                process.uptime(),

                            heapUsedMb:
                                Number(
                                    heapUsedMb.toFixed(
                                        2,
                                    ),
                                ),

                            rssMb:
                                Number(
                                    rssMb.toFixed(
                                        2,
                                    ),
                                ),
                        }
                        : null,
            }),
        );

        /**
         * Heap pressure warning.
         */
        const heapLimit =
            Number(
                process.env.CONFIG_DIAGNOSTIC_HEAP_LIMIT_MB,
            );

        if (
            Number.isFinite(
                heapLimit,
            ) &&
            heapLimit > 0 &&
            heapUsedMb >
                heapLimit
        ) {

            this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'runtime-memory',

                    status:
                        CHECK_STATUSES.WARN,

                    severity:
                        SEVERITIES.WARNING,

                    message:
                        'TITech process heap usage exceeds configured diagnostic threshold.',

                    details: {
                        heapUsedMb:
                            Number(
                                heapUsedMb.toFixed(
                                    2,
                                ),
                            ),

                        thresholdMb:
                            heapLimit,
                    },
                }),
            );

        } else {

            this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'runtime-memory',

                    status:
                        CHECK_STATUSES.PASS,

                    severity:
                        SEVERITIES.INFO,

                    message:
                        'TITech process memory usage is within configured diagnostic thresholds.',
                }),
            );
        }
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
            this.options
                .maxDiagnostics
        ) {

            return;
        }

        const normalized =
            check instanceof DiagnosticCheck
                ? check
                : new DiagnosticCheck(
                    check,
                );

        this.checks.push(
            normalized,
        );

        if (
            normalized.status ===
                CHECK_STATUSES.WARN &&
            this.warnings.length <
                this.options
                    .maxWarnings
        ) {

            this.warnings.push(
                normalized.toJSON(),
            );
        }

        if (
            normalized.status ===
                CHECK_STATUSES.FAIL &&
            this.errors.length <
                this.options
                    .maxErrors
        ) {

            this.errors.push(
                normalized.toJSON(),
            );
        }

        return normalized;
    }

    /**
     * -------------------------------------------------------------------------
     * Build result.
     * -------------------------------------------------------------------------
     */

    buildResult(
        {
            durationMs,
            configuration,
        },
    ) {

        const checks =
            this.checks.map(
                check =>
                    check.toJSON(),
            );

        const failures =
            checks.filter(
                check =>
                    check.status ===
                    CHECK_STATUSES.FAIL,
            );

        const warnings =
            checks.filter(
                check =>
                    check.status ===
                    CHECK_STATUSES.WARN,
            );

        const criticalFailures =
            failures.filter(
                check =>
                    check.severity ===
                    SEVERITIES.CRITICAL,
            );

        let status =
            'healthy';

        if (
            failures.length >
            0
        ) {

            status =
                criticalFailures.length >
                    0
                    ? 'unhealthy'
                    : 'degraded';

        } else if (
            warnings.length >
            0
        ) {

            status =
                'degraded';
        }

        const result = {

            status,

            service:
                SERVICE_NAME,

            application:
                APPLICATION_NAME,

            environment:
                normalizeEnvironment(
                    process.env.NODE_ENV,
                ),

            component:
                COMPONENT,

            state:
                status ===
                    'healthy'
                    ? DIAGNOSTIC_STATES
                        .HEALTHY
                    : status ===
                        'degraded'
                        ? DIAGNOSTIC_STATES
                            .DEGRADED
                        : DIAGNOSTIC_STATES
                            .UNHEALTHY,

            ready:
                status !==
                'unhealthy',

            healthy:
                status ===
                'healthy',

            checks,

            summary: {
                total:
                    checks.length,

                passed:
                    checks.filter(
                        check =>
                            check.status ===
                            CHECK_STATUSES.PASS,
                    ).length,

                warnings:
                    warnings.length,

                failures:
                    failures.length,

                criticalFailures:
                    criticalFailures.length,
            },

            durationMs:
                Number(
                    durationMs.toFixed(
                        3,
                    ),
                ),

            configuration:
                this.buildConfigurationDiagnostics(
                    configuration,
                ),

            timestamp:
                new Date().toISOString(),
        };

        return result;
    }

    /**
     * -------------------------------------------------------------------------
     * Configuration diagnostics.
     * -------------------------------------------------------------------------
     */

    buildConfigurationDiagnostics(
        resolved,
    ) {

        const output = {
            available:
                Boolean(
                    resolved?.available,
                ),
        };

        if (
            this.options
                .includeConfigurationFingerprint
        ) {

            const source =
                resolved?.snapshot ||
                resolved?.configuration ||
                {};

            output.fingerprint =
                fingerprint(
                    sanitize(
                        source,
                        {
                            redactSecrets:
                                true,
                        },
                    ),
                    this.options
                        .fingerprintAlgorithm,
                );

            output.fingerprintAlgorithm =
                this.options
                    .fingerprintAlgorithm;
        }

        if (
            this.options
                .includeModuleDiagnostics
        ) {

            output.provider =
                sanitize(
                    resolved
                        ?.operationalSnapshot,
                    {
                        redactSecrets:
                            true,

                        exposePaths:
                            this.options
                                .exposePaths,
                    },
                );
        }

        if (
            this.options
                .includeEnvironment
        ) {

            output.environment =
                this.options
                    .exposeEnvironmentVariables
                    ? sanitize(
                        resolved
                            ?.configuration
                            ?.environment,
                        {
                            redactSecrets:
                                true,

                            exposeEnvironmentVariables:
                                true,
                        },
                    )
                    : {
                        nodeEnvironment:
                            normalizeEnvironment(
                                process.env.NODE_ENV,
                            ),

                        nodeVersion:
                            process.version,
                    };
        }

        if (
            this.options
                .includeRuntime
        ) {

            output.runtime =
                this.options
                    .exposeSystemDetails
                    ? {
                        pid:
                            process.pid,

                        hostname:
                            os.hostname(),

                        platform:
                            process.platform,

                        architecture:
                            process.arch,

                        nodeVersion:
                            process.version,

                        uptimeSeconds:
                            process.uptime(),
                    }
                    : {
                        nodeVersion:
                            process.version,
                    };
        }

        if (
            this.options
                .includeSources
        ) {

            try {

                const provider =
                    resolveConfigurationProvider();

                if (
                    typeof provider?.getSources ===
                    'function'
                ) {

                    output.sources =
                        provider.getSources();
                }

            } catch {
                output.sources = {};
            }
        }

        return output;
    }

    /**
     * -------------------------------------------------------------------------
     * Disabled result.
     * -------------------------------------------------------------------------
     */

    createDisabledResult() {

        return deepFreeze({
            status:
                'disabled',

            service:
                SERVICE_NAME,

            application:
                APPLICATION_NAME,

            environment:
                normalizeEnvironment(
                    process.env.NODE_ENV,
                ),

            component:
                COMPONENT,

            state:
                DIAGNOSTIC_STATES
                    .STOPPED,

            ready:
                true,

            healthy:
                true,

            checks:
                [
                    {
                        name:
                            'configuration-diagnostics',

                        status:
                            CHECK_STATUSES.SKIP,

                        severity:
                            SEVERITIES.INFO,

                        message:
                            'TITech configuration diagnostics are disabled.',
                    },
                ],

            summary: {
                total:
                    1,

                passed:
                    0,

                warnings:
                    0,

                failures:
                    0,

                criticalFailures:
                    0,
            },

            timestamp:
                new Date().toISOString(),
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Readiness.
     * -------------------------------------------------------------------------
     */

    async readiness() {

        const result =
            await this.run();

        return {
            ready:
                result.status !==
                'unhealthy',

            status:
                result.status ===
                    'healthy'
                    ? 'ready'
                    : result.status ===
                        'degraded'
                        ? 'degraded'
                        : 'not_ready',

            component:
                COMPONENT,

            service:
                SERVICE_NAME,

            summary:
                result.summary,

            timestamp:
                result.timestamp,
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Health.
     * -------------------------------------------------------------------------
     */

    async health() {

        const started =
            process.hrtime.bigint();

        try {

            const result =
                await this.run();

            const durationMs =
                Number(
                    process.hrtime.bigint() -
                    started,
                ) /
                1_000_000;

            return {
                status:
                    result.status,

                healthy:
                    result.status ===
                    'healthy',

                degraded:
                    result.status ===
                    'degraded',

                component:
                    COMPONENT,

                service:
                    SERVICE_NAME,

                summary:
                    result.summary,

                durationMs:
                    Number(
                        durationMs.toFixed(
                            3,
                        ),
                    ),

                timestamp:
                    new Date().toISOString(),
            };

        } catch (
            error
        ) {

            return {
                status:
                    'unhealthy',

                healthy:
                    false,

                degraded:
                    false,

                component:
                    COMPONENT,

                service:
                    SERVICE_NAME,

                error:
                    safeError(
                        error,
                    ),

                timestamp:
                    new Date().toISOString(),
            };
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Snapshot.
     * -------------------------------------------------------------------------
     */

    snapshot() {

        const result =
            this.lastResult ||
            this.createDisabledResult();

        return deepFreeze(
            sanitize(
                {
                    state:
                        this.state,

                    initializedAt:
                        this.initializedAt,

                    lastRunAt:
                        this.lastRunAt,

                    lastError:
                        this.lastError
                            ? safeError(
                                this.lastError,
                            )
                            : null,

                    result,

                    options:
                        this.options,
                },
                {
                    redactSecrets:
                        true,

                    exposePaths:
                        this.options
                            .exposePaths,

                    exposeEnvironmentVariables:
                        false,
                },
            ),
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Stop.
     * -------------------------------------------------------------------------
     */

    async shutdown() {

        if (
            this._cacheTimer
        ) {

            clearTimeout(
                this._cacheTimer,
            );

            this._cacheTimer =
                null;
        }

        this.state =
            DIAGNOSTIC_STATES
                .STOPPED;

        return true;
    }

    /**
     * -------------------------------------------------------------------------
     * Reset.
     * -------------------------------------------------------------------------
     *
     * Intended for isolated tests.
     * -------------------------------------------------------------------------
     */

    reset() {

        if (
            this._initializePromise
        ) {

            throw new Error(
                'Cannot reset TITech configuration diagnostics while initialization is active.',
            );
        }

        this.state =
            DIAGNOSTIC_STATES
                .CREATED;

        this.initializedAt =
            null;

        this.lastRunAt =
            null;

        this.lastResult =
            null;

        this.lastError =
            null;

        this.checks.length =
            0;

        this.warnings.length =
            0;

        this.errors.length =
            0;

        return this;
    }
}

/**
 * =============================================================================
 * Singleton
 * =============================================================================
 */

const diagnostics =
    new ConfigurationDiagnostics({
        enabled:
            asBoolean(
                process.env.CONFIG_DIAGNOSTICS_ENABLED,
                DEFAULTS.enabled,
            ),

        strict:
            true,

        redactSecrets:
            true,

        exposePaths:
            asBoolean(
                process.env.CONFIG_DIAGNOSTICS_EXPOSE_PATHS,
                DEFAULTS.exposePaths,
            ),

        exposeEnvironmentVariables:
            false,

        exposeSystemDetails:
            DEFAULTS.exposeSystemDetails,
    });

/**
 * =============================================================================
 * Singleton convenience API
 * =============================================================================
 */

async function initialize(
    context = {},
) {

    await diagnostics.initialize();

    if (
        context &&
        typeof context ===
        'object'
    ) {

        context.configurationDiagnostics =
            diagnostics;

        context.configDiagnostics =
            diagnostics;
    }

    return diagnostics;
}

async function start(
    context = {},
) {

    return initialize(
        context,
    );
}

async function bootstrap(
    context = {},
) {

    return start(
        context,
    );
}

async function run(
    options,
) {

    return diagnostics.run(
        options,
    );
}

async function readiness() {

    return diagnostics.readiness();
}

async function health() {

    return diagnostics.health();
}

function snapshot() {

    return diagnostics.snapshot();
}

function operationalSnapshot() {

    return diagnostics.lastResult ||
        diagnostics.createDisabledResult();
}

function getState() {

    return diagnostics.state;
}

/**
 * =============================================================================
 * Public API
 * =============================================================================
 */

module.exports =
    Object.freeze({

        /**
         * Canonical singleton.
         */
        diagnostics,

        ConfigurationDiagnostics,

        DiagnosticCheck,

        /**
         * Constants.
         */
        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        DIAGNOSTIC_STATES,

        SEVERITIES,

        CHECK_STATUSES,

        DEFAULTS,

        /**
         * Lifecycle.
         */
        initialize,

        start,

        bootstrap,

        shutdown:
            () =>
                diagnostics.shutdown(),

        /**
         * Diagnostics.
         */
        run,

        readiness,

        health,

        snapshot,

        operationalSnapshot,

        getState,

        /**
         * Configuration inspection.
         */
        resolveConfigurationProvider,

        resolveConfigurationSnapshot,

        getByPath,

        hasByPath,

        sanitize,

        fingerprint,

        /**
         * Test support.
         */
        reset:
            () =>
                diagnostics.reset(),
    });