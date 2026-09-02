'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/environment/diagnostics.js
 *
 * Purpose:
 *   Enterprise production-grade environment bootstrap diagnostics provider.
 *
 * Responsibilities:
 *   - Inspect TITech environment bootstrap state.
 *   - Expose safe operational diagnostics.
 *   - Validate environment bootstrap completeness.
 *   - Report dotenv discovery/loading status.
 *   - Report normalization and validation status.
 *   - Detect unsupported environments.
 *   - Detect environment/configuration drift.
 *   - Produce safe configuration fingerprints.
 *   - Protect secrets from diagnostics.
 *   - Integrate with backend/config/environment/bootstrapState.js.
 *   - Provide readiness and health semantics.
 *   - Remain read-only.
 *
 * IMPORTANT:
 *
 *   This module is DIAGNOSTICS ONLY.
 *
 *   It does NOT:
 *     - mutate process.env.
 *     - load dotenv files.
 *     - initialize application configuration.
 *     - connect to MongoDB.
 *     - connect to Redis.
 *     - initialize queues.
 *     - initialize Express.
 *     - start HTTP servers.
 *     - execute business logic.
 *     - execute financial transactions.
 *
 * Canonical environment implementation:
 *
 *   backend/config/environment.js
 *
 * Canonical bootstrap environment orchestration:
 *
 *   backend/config/bootstrapEnvironment.js
 *
 * Canonical environment state:
 *
 *   backend/config/environment/bootstrapState.js
 *
 * =============================================================================
 *
 * Canonical diagnostics flow:
 *
 *   environment.js
 *        ↓
 *   bootstrapEnvironment.js
 *        ↓
 *   bootstrapState.js
 *        ↓
 *   environment/diagnostics.js
 *        ↓
 *   readiness / health / operational diagnostics
 *
 * =============================================================================
 */

const crypto =
    require('node:crypto');

const os =
    require('node:os');

const process =
    require('node:process');

/**
 * =============================================================================
 * Bootstrap state
 * =============================================================================
 */

let bootstrapStateModule = null;

try {
    // eslint-disable-next-line global-require
    bootstrapStateModule =
        require('./bootstrapState');
} catch {
    bootstrapStateModule = null;
}

/**
 * =============================================================================
 * Optional environment implementation
 * =============================================================================
 */

let environmentModule = null;

try {
    // eslint-disable-next-line global-require
    environmentModule =
        require('../environment');
} catch {
    environmentModule = null;
}

/**
 * =============================================================================
 * Optional bootstrap environment implementation
 * =============================================================================
 */

let bootstrapEnvironmentModule = null;

try {
    // eslint-disable-next-line global-require
    bootstrapEnvironmentModule =
        require('../bootstrapEnvironment');
} catch {
    bootstrapEnvironmentModule = null;
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
    'environment-diagnostics';

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

        READY:
            'ready',

        DEGRADED:
            'degraded',

        UNHEALTHY:
            'unhealthy',

        STOPPED:
            'stopped',
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

const DEFAULTS =
    Object.freeze({
        enabled:
            true,

        strict:
            true,

        failClosed:
            true,

        cacheDurationMs:
            5_000,

        fingerprintAlgorithm:
            'sha256',

        maxChecks:
            100,

        maxWarnings:
            100,

        maxErrors:
            100,

        maxHistory:
            100,

        exposePaths:
            false,

        exposeEnvironmentVariables:
            false,

        redactSecrets:
            true,

        includeRuntime:
            true,

        includeState:
            true,

        includePhaseDetails:
            true,

        includeFingerprint:
            true,

        includeFileDiagnostics:
            true,

        /**
         * In production these variables should normally exist, although their
         * presence is not treated as a secret leak.
         */
        baselineVariables:
            Object.freeze([
                'NODE_ENV',
            ]),

        sensitivePattern:
            /(password|passwd|secret|token|authorization|api[_-]?key|private[_-]?key|client[_-]?secret|encryption[_-]?key|connection[_-]?(string|uri)|jwt[_-]?secret|smtp[_-]?password|access[_-]?token|refresh[_-]?token)/i,
    });

/**
 * =============================================================================
 * Errors
 * =============================================================================
 */

class EnvironmentDiagnosticsError extends Error {

    constructor(
        message,
        options = {},
    ) {

        super(
            message,
        );

        this.name =
            'EnvironmentDiagnosticsError';

        this.code =
            options.code ||
            'ENVIRONMENT_DIAGNOSTICS_ERROR';

        this.phase =
            options.phase ||
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
            EnvironmentDiagnosticsError,
        );
    }
}

/**
 * =============================================================================
 * Helpers
 * =============================================================================
 */

function normalizeEnvironment(
    value,
) {

    return String(
        value ||
        process.env.NODE_ENV ||
        ENVIRONMENT_NAMES.DEVELOPMENT,
    )
        .trim()
        .toLowerCase();
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

function isProduction(
    value,
) {

    return (
        normalizeEnvironment(
            value,
        ) ===
        ENVIRONMENT_NAMES.PRODUCTION
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

function safeError(
    error,
) {

    if (
        !error
    ) {

        return null;
    }

    return {
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

        phase:
            error.phase ||
            null,
    };
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
            JSON.stringify(
                value,
            ),
            'utf8',
        )
        .digest(
            'hex',
        );
}

/**
 * =============================================================================
 * Secret-safe diagnostics sanitization
 * =============================================================================
 */

function sanitize(
    value,
    {
        redactSecrets =
            true,

        exposePaths =
            false,

        maxDepth =
            12,
    } = {},
    currentPath = '',
    seen =
        new WeakSet(),
) {

    if (
        currentPath
            .split('.')
            .length >
        maxDepth
    ) {

        return '[MAX_DEPTH]';
    }

    if (
        value === undefined ||
        value === null
    ) {

        return value;
    }

    if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {

        if (
            redactSecrets &&
            DEFAULTS.sensitivePattern.test(
                currentPath
                    .split('.')
                    .pop() ||
                '',
            )
        ) {

            return '[REDACTED]';
        }

        if (
            !exposePaths &&
            /(path|filename|filepath|directory|rootDirectory|environmentDirectory)$/i.test(
                currentPath,
            )
        ) {

            return '[HIDDEN]';
        }

        return value;
    }

    if (
        typeof value === 'function'
    ) {

        return '[FUNCTION]';
    }

    if (
        typeof value !== 'object'
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
                        maxDepth,
                    },
                    currentPath
                        ? `${currentPath}.${index}`
                        : String(index),
                    seen,
                ),
        );
    }

    const output = {};

    for (
        const [
            key,
            item,
        ] of Object.entries(
            value,
        )
    ) {

        const childPath =
            currentPath
                ? `${currentPath}.${key}`
                : key;

        if (
            redactSecrets &&
            DEFAULTS.sensitivePattern.test(
                key,
            )
        ) {

            output[key] =
                '[REDACTED]';

            continue;
        }

        if (
            !exposePaths &&
            /(path|filename|filepath|directory|rootDirectory|environmentDirectory)$/i.test(
                key,
            )
        ) {

            output[key] =
                '[HIDDEN]';

            continue;
        }

        /**
         * Raw environment variable values are never emitted.
         */
        if (
            childPath.startsWith(
                'environmentVariables.',
            )
        ) {

            output[key] =
                '[HIDDEN]';

            continue;
        }

        output[key] =
            sanitize(
                item,
                {
                    redactSecrets,
                    exposePaths,
                    maxDepth,
                },
                childPath,
                seen,
            );
    }

    return output;
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
        // Diagnostics must remain independent of logging.
    }
}

/**
 * =============================================================================
 * State resolution
 * =============================================================================
 */

function resolveBootstrapState() {

    if (
        !bootstrapStateModule
    ) {

        return null;
    }

    return (
        bootstrapStateModule.bootstrapState ||
        bootstrapStateModule
    );
}

function resolveEnvironmentModule() {

    return environmentModule;
}

function resolveBootstrapEnvironmentModule() {

    return bootstrapEnvironmentModule;
}

/**
 * =============================================================================
 * Environment state helpers
 * =============================================================================
 */

function getStateSnapshot() {

    const state =
        resolveBootstrapState();

    if (
        !state
    ) {

        return null;
    }

    try {

        if (
            typeof state.snapshot ===
            'function'
        ) {

            return state.snapshot(
                {
                    exposeHistory:
                        false,

                    exposeTransitions:
                        true,
                },
            );
        }

    } catch {
        // Continue below.
    }

    return {
        state:
            state.state ||
            null,

        environment:
            state.environment ||
            null,

        ready:
            Boolean(
                state.ready,
            ),

        failed:
            Boolean(
                state.failed,
            ),

        currentPhase:
            state.currentPhase ||
            null,
    };
}

function getReadinessState() {

    const state =
        resolveBootstrapState();

    if (
        !state
    ) {

        return null;
    }

    try {

        if (
            typeof state.readiness ===
            'function'
        ) {

            return state.readiness();
        }

    } catch {
        // Continue below.
    }

    return {
        ready:
            Boolean(
                state.ready,
            ),

        status:
            state.ready
                ? 'ready'
                : 'not_ready',
    };
}

/**
 * =============================================================================
 * Check object
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
 * EnvironmentDiagnostics
 * =============================================================================
 */

class EnvironmentDiagnostics {

    constructor(
        options = {},
    ) {

        this.options =
            Object.freeze({
                ...DEFAULTS,

                ...options,

                cacheDurationMs:
                    Number.isInteger(
                        options.cacheDurationMs,
                    ) &&
                    options.cacheDurationMs > 0
                        ? options.cacheDurationMs
                        : DEFAULTS.cacheDurationMs,

                maxChecks:
                    Number.isInteger(
                        options.maxChecks,
                    ) &&
                    options.maxChecks > 0
                        ? options.maxChecks
                        : DEFAULTS.maxChecks,

                maxWarnings:
                    Number.isInteger(
                        options.maxWarnings,
                    ) &&
                    options.maxWarnings > 0
                        ? options.maxWarnings
                        : DEFAULTS.maxWarnings,

                maxErrors:
                    Number.isInteger(
                        options.maxErrors,
                    ) &&
                    options.maxErrors > 0
                        ? options.maxErrors
                        : DEFAULTS.maxErrors,

                maxHistory:
                    Number.isInteger(
                        options.maxHistory,
                    ) &&
                    options.maxHistory > 0
                        ? options.maxHistory
                        : DEFAULTS.maxHistory,
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

        this.history =
            [];

        this._initializationPromise =
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
                DIAGNOSTIC_STATES.READY ||
            this.state ===
                DIAGNOSTIC_STATES.DEGRADED
        ) {

            return this;
        }

        if (
            this._initializationPromise
        ) {

            return this._initializationPromise;
        }

        this._initializationPromise =
            (async () => {

                this.initializedAt =
                    new Date();

                try {

                    await this.run(
                        {
                            force:
                                true,
                        },
                    );

                    return this;

                } catch (
                    error
                ) {

                    this.lastError =
                        error;

                    this.state =
                        DIAGNOSTIC_STATES
                            .UNHEALTHY;

                    throw error;
                }
            })();

        try {

            return await this._initializationPromise;

        } finally {

            this._initializationPromise =
                null;
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Run diagnostics.
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
                this.options.cacheDurationMs
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

            this.checkBootstrapState();

            this.checkRuntimeEnvironment();

            this.checkEnvironmentModule();

            this.checkBootstrapEnvironmentModule();

            this.checkEnvironmentConsistency();

            this.checkDotenvState();

            this.checkPhaseCompletion();

            this.checkValidationState();

            this.checkFingerprintState();

            this.checkProductionSafety();

            this.checkEnvironmentVariables();

            this.checkRuntime();

            const durationMs =
                Number(
                    process.hrtime.bigint() -
                    started,
                ) /
                1_000_000;

            const result =
                this.buildResult(
                    durationMs,
                );

            this.lastRunAt =
                new Date();

            this.lastResult =
                deepFreeze(
                    result,
                );

            if (
                result.status ===
                    'healthy'
            ) {

                this.state =
                    DIAGNOSTIC_STATES
                        .READY;

            } else if (
                result.status ===
                    'degraded'
            ) {

                this.state =
                    DIAGNOSTIC_STATES
                        .DEGRADED;

            } else {

                this.state =
                    DIAGNOSTIC_STATES
                        .UNHEALTHY;
            }

            this.recordHistory(
                {
                    type:
                        'diagnostics.completed',

                    status:
                        result.status,

                    durationMs:
                        result.durationMs,
                },
            );

            return this.lastResult;

        } catch (
            error
        ) {

            this.lastError =
                error;

            this.state =
                DIAGNOSTIC_STATES
                    .UNHEALTHY;

            this.recordError(
                error,
            );

            log(
                'error',
                {
                    error:
                        safeError(
                            error,
                        ),
                },
                'TITech environment diagnostics failed.',
            );

            if (
                this.options
                    .failClosed
            ) {

                throw error;
            }

            return this.buildResult(
                Number(
                    process.hrtime.bigint() -
                    started,
                ) /
                1_000_000,
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Bootstrap state check.
     * -------------------------------------------------------------------------
     */

    checkBootstrapState() {

        const started =
            process.hrtime.bigint();

        const stateSnapshot =
            getStateSnapshot();

        if (
            !stateSnapshot
        ) {

            return this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'bootstrap-state',

                    status:
                        CHECK_STATUSES.WARN,

                    severity:
                        SEVERITIES.WARNING,

                    message:
                        'TITech environment bootstrap state provider is unavailable.',

                    details:
                        null,

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
            stateSnapshot.failed ===
            true ||
            stateSnapshot.state ===
                'failed'
        ) {

            return this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'bootstrap-state',

                    status:
                        CHECK_STATUSES.FAIL,

                    severity:
                        SEVERITIES.CRITICAL,

                    message:
                        'TITech environment bootstrap is in a failed state.',

                    details:
                        {
                            state:
                                stateSnapshot.state,

                            phase:
                                stateSnapshot.currentPhase,

                            error:
                                stateSnapshot.lastError ||
                                null,
                        },

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
                    'bootstrap-state',

                status:
                    CHECK_STATUSES.PASS,

                severity:
                    SEVERITIES.INFO,

                message:
                    'TITech environment bootstrap state is available.',

                details:
                    {
                        state:
                            stateSnapshot.state,

                        phase:
                            stateSnapshot.currentPhase,

                        ready:
                            stateSnapshot.ready,
                    },

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
     * Runtime environment check.
     * -------------------------------------------------------------------------
     */

    checkRuntimeEnvironment() {

        const environment =
            normalizeEnvironment(
                process.env.NODE_ENV,
            );

        if (
            !isSupportedEnvironment(
                environment,
            )
        ) {

            return this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'runtime-environment',

                    status:
                        CHECK_STATUSES.FAIL,

                    severity:
                        this.options
                            .strict
                            ? SEVERITIES.CRITICAL
                            : SEVERITIES.ERROR,

                    message:
                        `Unsupported TITech runtime environment "${environment}".`,

                    details:
                        {
                            environment,

                            supported:
                                SUPPORTED_ENVIRONMENTS,
                        },
                }),
            );
        }

        return this.recordCheck(
            new DiagnosticCheck({
                name:
                    'runtime-environment',

                status:
                    CHECK_STATUSES.PASS,

                severity:
                    SEVERITIES.INFO,

                message:
                    `TITech runtime environment "${environment}" is supported.`,

                details:
                    {
                        environment,
                    },
            }),
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Environment module check.
     * -------------------------------------------------------------------------
     */

    checkEnvironmentModule() {

        const module =
            resolveEnvironmentModule();

        if (
            !module
        ) {

            return this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'environment-module',

                    status:
                        CHECK_STATUSES.WARN,

                    severity:
                        SEVERITIES.WARNING,

                    message:
                        'TITech environment implementation module is unavailable.',

                    details:
                        null,
                }),
            );
        }

        const hasBootstrap =
            typeof module.bootstrapEnvironment ===
            'function';

        const hasDiscovery =
            Boolean(
                module.ENVIRONMENT_DISCOVERY ||
                module.getEnvironmentDiscoveryDiagnostics ||
                module.discoverEnvironmentFiles,
            );

        return this.recordCheck(
            new DiagnosticCheck({
                name:
                    'environment-module',

                status:
                    hasBootstrap
                        ? CHECK_STATUSES.PASS
                        : CHECK_STATUSES.WARN,

                severity:
                    hasBootstrap
                        ? SEVERITIES.INFO
                        : SEVERITIES.WARNING,

                message:
                    hasBootstrap
                        ? 'TITech environment implementation is available.'
                        : 'TITech environment implementation is available but exposes no canonical bootstrap function.',

                details:
                    {
                        bootstrap:
                            hasBootstrap,

                        discovery:
                            hasDiscovery,
                    },
            }),
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Bootstrap environment module check.
     * -------------------------------------------------------------------------
     */

    checkBootstrapEnvironmentModule() {

        const module =
            resolveBootstrapEnvironmentModule();

        if (
            !module
        ) {

            return this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'bootstrap-environment-module',

                    status:
                        CHECK_STATUSES.WARN,

                    severity:
                        SEVERITIES.WARNING,

                    message:
                        'TITech bootstrapEnvironment module is unavailable.',

                    details:
                        null,
                }),
            );
        }

        const methods = [
            'bootstrapEnvironment',
            'initialize',
            'start',
            'run',
        ];

        const availableMethods =
            methods.filter(
                method =>
                    typeof module[
                        method
                    ] ===
                    'function',
            );

        if (
            availableMethods.length ===
            0
        ) {

            return this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'bootstrap-environment-module',

                    status:
                        CHECK_STATUSES.WARN,

                    severity:
                        SEVERITIES.WARNING,

                    message:
                        'TITech bootstrapEnvironment module is loaded but exposes no recognized lifecycle function.',

                    details:
                        null,
                }),
            );
        }

        return this.recordCheck(
            new DiagnosticCheck({
                name:
                    'bootstrap-environment-module',

                status:
                    CHECK_STATUSES.PASS,

                severity:
                    SEVERITIES.INFO,

                message:
                    'TITech environment bootstrap adapter is available.',

                details:
                    {
                        methods:
                            availableMethods,
                    },
            }),
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Environment consistency.
     * -------------------------------------------------------------------------
     */

    checkEnvironmentConsistency() {

        const stateSnapshot =
            getStateSnapshot();

        const processEnvironment =
            normalizeEnvironment(
                process.env.NODE_ENV,
            );

        const stateEnvironment =
            normalizeEnvironment(
                stateSnapshot?.environment ||
                processEnvironment,
            );

        if (
            processEnvironment !==
            stateEnvironment
        ) {

            return this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'environment-consistency',

                    status:
                        CHECK_STATUSES.FAIL,

                    severity:
                        SEVERITIES.ERROR,

                    message:
                        'TITech process environment and bootstrap environment state are inconsistent.',

                    details:
                        {
                            process:
                                processEnvironment,

                            bootstrap:
                                stateEnvironment,
                        },
                }),
            );
        }

        return this.recordCheck(
            new DiagnosticCheck({
                name:
                    'environment-consistency',

                status:
                    CHECK_STATUSES.PASS,

                severity:
                    SEVERITIES.INFO,

                message:
                    'TITech runtime and bootstrap environment values are consistent.',

                details:
                    {
                        environment:
                            processEnvironment,
                    },
            }),
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Dotenv diagnostics.
     * -------------------------------------------------------------------------
     */

    checkDotenvState() {

        const stateSnapshot =
            getStateSnapshot();

        if (
            !stateSnapshot
        ) {

            return this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'dotenv',

                    status:
                        CHECK_STATUSES.SKIP,

                    severity:
                        SEVERITIES.INFO,

                    message:
                        'TITech dotenv state could not be inspected.',
                }),
            );
        }

        const dotenv =
            stateSnapshot.dotenv;

        if (
            !dotenv
        ) {

            return this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'dotenv',

                    status:
                        CHECK_STATUSES.WARN,

                    severity:
                        SEVERITIES.WARNING,

                    message:
                        'No TITech dotenv diagnostics are currently recorded.',

                    details:
                        null,
                }),
            );
        }

        const failedLoads =
            Number(
                dotenv.failedLoads ||
                0,
            );

        if (
            failedLoads >
            0
        ) {

            return this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'dotenv',

                    status:
                        CHECK_STATUSES.WARN,

                    severity:
                        SEVERITIES.WARNING,

                    message:
                        'One or more TITech dotenv layers failed to load.',

                    details:
                        sanitize(
                            dotenv,
                            {
                                redactSecrets:
                                    true,

                                exposePaths:
                                    this.options
                                        .exposePaths,
                            },
                        ),
                }),
            );
        }

        return this.recordCheck(
            new DiagnosticCheck({
                name:
                    'dotenv',

                status:
                    CHECK_STATUSES.PASS,

                severity:
                    SEVERITIES.INFO,

                message:
                    'TITech dotenv/environment layers loaded without recorded errors.',

                details:
                    sanitize(
                        dotenv,
                        {
                            redactSecrets:
                                true,

                            exposePaths:
                                this.options
                                    .exposePaths,
                        },
                    ),
            }),
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Phase completion.
     * -------------------------------------------------------------------------
     */

    checkPhaseCompletion() {

        const state =
            resolveBootstrapState();

        if (
            !state
        ) {

            return this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'bootstrap-phases',

                    status:
                        CHECK_STATUSES.WARN,

                    severity:
                        SEVERITIES.WARNING,

                    message:
                        'TITech environment bootstrap phase state is unavailable.',
                }),
            );
        }

        let missing = [];

        try {

            if (
                typeof state.getMissingRequiredPhases ===
                'function'
            ) {

                missing =
                    state.getMissingRequiredPhases();
            }

        } catch {
            missing = [];
        }

        if (
            missing.length >
            0
        ) {

            return this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'bootstrap-phases',

                    status:
                        CHECK_STATUSES.FAIL,

                    severity:
                        SEVERITIES.CRITICAL,

                    message:
                        'TITech environment bootstrap has incomplete required phases.',

                    details:
                        {
                            missing,
                        },
                }),
            );
        }

        return this.recordCheck(
            new DiagnosticCheck({
                name:
                    'bootstrap-phases',

                status:
                    CHECK_STATUSES.PASS,

                severity:
                    SEVERITIES.INFO,

                message:
                    'All required TITech environment bootstrap phases are complete.',
            }),
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Validation state.
     * -------------------------------------------------------------------------
     */

    checkValidationState() {

        const stateSnapshot =
            getStateSnapshot();

        const validation =
            stateSnapshot?.validation;

        if (
            !validation
        ) {

            return this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'environment-validation',

                    status:
                        CHECK_STATUSES.WARN,

                    severity:
                        SEVERITIES.WARNING,

                    message:
                        'TITech environment validation diagnostics are unavailable.',
                }),
            );
        }

        const failed =
            Number(
                validation.failed ||
                validation.errors ||
                0,
            );

        if (
            failed >
            0
        ) {

            return this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'environment-validation',

                    status:
                        CHECK_STATUSES.FAIL,

                    severity:
                        SEVERITIES.CRITICAL,

                    message:
                        'TITech environment validation reported failures.',

                    details:
                        sanitize(
                            validation,
                            {
                                redactSecrets:
                                    true,

                                exposePaths:
                                    this.options
                                        .exposePaths,
                            },
                        ),
                }),
            );
        }

        return this.recordCheck(
            new DiagnosticCheck({
                name:
                    'environment-validation',

                status:
                    CHECK_STATUSES.PASS,

                severity:
                    SEVERITIES.INFO,

                message:
                    'TITech environment validation completed without recorded errors.',

                details:
                    sanitize(
                        validation,
                        {
                            redactSecrets:
                                true,

                            exposePaths:
                                this.options
                                    .exposePaths,
                        },
                    ),
            }),
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Fingerprint state.
     * -------------------------------------------------------------------------
     */

    checkFingerprintState() {

        if (
            !this.options
                .includeFingerprint
        ) {

            return this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'environment-fingerprint',

                    status:
                        CHECK_STATUSES.SKIP,

                    severity:
                        SEVERITIES.INFO,

                    message:
                        'TITech environment fingerprint diagnostics are disabled.',
                }),
            );
        }

        const stateSnapshot =
            getStateSnapshot();

        const fingerprintValue =
            stateSnapshot
                ?.fingerprint
                ?.value ||
            stateSnapshot
                ?.fingerprintValue ||
            null;

        if (
            !fingerprintValue
        ) {

            return this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'environment-fingerprint',

                    status:
                        CHECK_STATUSES.WARN,

                    severity:
                        SEVERITIES.WARNING,

                    message:
                        'TITech environment fingerprint has not been generated.',
                }),
            );
        }

        return this.recordCheck(
            new DiagnosticCheck({
                name:
                    'environment-fingerprint',

                status:
                    CHECK_STATUSES.PASS,

                severity:
                    SEVERITIES.INFO,

                message:
                    'TITech environment fingerprint is available.',

                details:
                    {
                        algorithm:
                            stateSnapshot
                                ?.fingerprint
                                ?.algorithm ||
                            this.options
                                .fingerprintAlgorithm,

                        fingerprint:
                            fingerprintValue,
                    },
            }),
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Production safety checks.
     * -------------------------------------------------------------------------
     */

    checkProductionSafety() {

        const environment =
            normalizeEnvironment(
                process.env.NODE_ENV,
            );

        if (
            !isProduction(
                environment,
            )
        ) {

            return this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'production-safety',

                    status:
                        CHECK_STATUSES.SKIP,

                    severity:
                        SEVERITIES.INFO,

                    message:
                        'TITech production-only environment safety checks are not active for the current environment.',
                }),
            );
        }

        const checks = [];

        /**
         * NODE_ENV must explicitly be production.
         */
        checks.push({
            name:
                'node-env',

            passed:
                process.env.NODE_ENV ===
                'production',

            message:
                'NODE_ENV must explicitly equal production.',
        });

        /**
         * Do not expose raw environment values through diagnostics.
         */
        checks.push({
            name:
                'diagnostic-redaction',

            passed:
                this.options
                    .redactSecrets ===
                true,

            message:
                'Secret redaction must remain enabled in production.',
        });

        /**
         * Do not expose environment variable values.
         */
        checks.push({
            name:
                'environment-value-exposure',

            passed:
                this.options
                    .exposeEnvironmentVariables !==
                true,

            message:
                'Raw environment variable values must not be exposed in production.',
        });

        /**
         * Fail closed is preferred for production environment bootstrap.
         */
        checks.push({
            name:
                'fail-closed',

            passed:
                this.options
                    .failClosed ===
                true,

            message:
                'Environment diagnostics should fail closed in production.',
        });

        const failures =
            checks.filter(
                check =>
                    !check.passed,
            );

        if (
            failures.length >
            0
        ) {

            return this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'production-safety',

                    status:
                        CHECK_STATUSES.FAIL,

                    severity:
                        SEVERITIES.CRITICAL,

                    message:
                        'TITech production environment safety requirements are not fully satisfied.',

                    details:
                        failures,
                }),
            );
        }

        return this.recordCheck(
            new DiagnosticCheck({
                name:
                    'production-safety',

                status:
                    CHECK_STATUSES.PASS,

                severity:
                    SEVERITIES.INFO,

                message:
                    'TITech production environment safety requirements are satisfied.',
            }),
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Environment variables.
     * -------------------------------------------------------------------------
     */

    checkEnvironmentVariables() {

        const environment =
            normalizeEnvironment(
                process.env.NODE_ENV,
            );

        const missing = [];

        for (
            const variable of
            this.options
                .baselineVariables
        ) {

            if (
                !process.env[
                    variable
                ]
            ) {

                missing.push(
                    variable,
                );
            }
        }

        if (
            missing.length >
            0 &&
            isProduction(
                environment,
            )
        ) {

            return this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'environment-variables',

                    status:
                        CHECK_STATUSES.FAIL,

                    severity:
                        SEVERITIES.ERROR,

                    message:
                        'Required baseline TITech environment variables are missing.',

                    details:
                        {
                            missing,
                        },
                }),
            );
        }

        return this.recordCheck(
            new DiagnosticCheck({
                name:
                    'environment-variables',

                status:
                    CHECK_STATUSES.PASS,

                severity:
                    SEVERITIES.INFO,

                message:
                    'TITech baseline environment variables are available.',

                details:
                    {
                        checked:
                            this.options
                                .baselineVariables
                                .length,

                        missing:
                            missing.length,
                    },
            }),
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Runtime check.
     * -------------------------------------------------------------------------
     */

    checkRuntime() {

        if (
            !this.options
                .includeRuntime
        ) {

            return this.recordCheck(
                new DiagnosticCheck({
                    name:
                        'runtime',

                    status:
                        CHECK_STATUSES.SKIP,

                    severity:
                        SEVERITIES.INFO,

                    message:
                        'TITech runtime diagnostics are disabled.',
                }),
            );
        }

        const memory =
            process.memoryUsage();

        return this.recordCheck(
            new DiagnosticCheck({
                name:
                    'runtime',

                status:
                    CHECK_STATUSES.PASS,

                severity:
                    SEVERITIES.INFO,

                message:
                    'TITech Node.js runtime is available.',

                details:
                    {
                        nodeVersion:
                            process.version,

                        pid:
                            process.pid,

                        platform:
                            process.platform,

                        architecture:
                            process.arch,

                        hostname:
                            os.hostname(),

                        uptimeSeconds:
                            process.uptime(),

                        memoryRssBytes:
                            memory.rss,

                        heapUsedBytes:
                            memory.heapUsed,

                        heapTotalBytes:
                            memory.heapTotal,
                    },
            }),
        );
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
                this.options.maxWarnings
        ) {

            this.warnings.push(
                normalized.toJSON(),
            );
        }

        if (
            normalized.status ===
                CHECK_STATUSES.FAIL &&
            this.errors.length <
                this.options.maxErrors
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
        durationMs,
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

        return {
            status,

            healthy:
                status ===
                'healthy',

            degraded:
                status ===
                'degraded',

            ready:
                status !==
                'unhealthy',

            component:
                COMPONENT,

            service:
                SERVICE_NAME,

            application:
                APPLICATION_NAME,

            environment:
                normalizeEnvironment(
                    process.env.NODE_ENV,
                ),

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

            checks,

            durationMs:
                Number(
                    durationMs.toFixed(
                        3,
                    ),
                ),

            bootstrap:
                this.options
                    .includeState
                    ? getStateSnapshot()
                    : null,

            readiness:
                getReadinessState(),

            timestamp:
                new Date().toISOString(),
        };
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
                result.ready,

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

            environment:
                result.environment,

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

        const result =
            await this.run();

        return {
            status:
                result.status,

            healthy:
                result.healthy,

            degraded:
                result.degraded,

            component:
                COMPONENT,

            service:
                SERVICE_NAME,

            environment:
                result.environment,

            summary:
                result.summary,

            timestamp:
                result.timestamp,
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
            this.createDisabledResult();

        const stateSnapshot =
            options.includeState !==
                false &&
            this.options.includeState
                ? getStateSnapshot()
                : null;

        const diagnosticsSnapshot = {

            component:
                COMPONENT,

            service:
                SERVICE_NAME,

            application:
                APPLICATION_NAME,

            state:
                this.state,

            environment:
                normalizeEnvironment(
                    process.env.NODE_ENV,
                ),

            initializedAt:
                this.initializedAt,

            lastRunAt:
                this.lastRunAt,

            lastError:
                safeError(
                    this.lastError,
                ),

            result,

            bootstrap:
                stateSnapshot,

            warnings:
                clone(
                    this.warnings,
                ),

            errors:
                clone(
                    this.errors,
                ),

            history:
                clone(
                    this.history,
                ),

            timestamp:
                new Date().toISOString(),
        };

        return deepFreeze(
            sanitize(
                diagnosticsSnapshot,
                {
                    redactSecrets:
                        true,

                    exposePaths:
                        this.options.exposePaths,
                },
            ),
        );
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

            healthy:
                true,

            degraded:
                false,

            ready:
                true,

            component:
                COMPONENT,

            service:
                SERVICE_NAME,

            application:
                APPLICATION_NAME,

            environment:
                normalizeEnvironment(
                    process.env.NODE_ENV,
                ),

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

            checks:
                [
                    {
                        name:
                            'environment-diagnostics',

                        status:
                            CHECK_STATUSES.SKIP,

                        severity:
                            SEVERITIES.INFO,

                        message:
                            'TITech environment diagnostics are disabled.',
                    },
                ],

            timestamp:
                new Date().toISOString(),
        });
    }

    /**
     * -------------------------------------------------------------------------
     * History.
     * -------------------------------------------------------------------------
     */

    recordHistory(
        event,
    ) {

        if (
            this.history.length >=
            this.options.maxHistory
        ) {

            this.history.shift();
        }

        this.history.push(
            {
                ...sanitize(
                    event,
                    {
                        redactSecrets:
                            true,

                        exposePaths:
                            this.options.exposePaths,
                    },
                ),

                timestamp:
                    new Date().toISOString(),
            },
        );

        return this.history[
            this.history.length - 1
        ];
    }

    /**
     * -------------------------------------------------------------------------
     * Stop.
     * -------------------------------------------------------------------------
     */

    shutdown() {

        this.state =
            DIAGNOSTIC_STATES
                .STOPPED;

        this.recordHistory(
            {
                type:
                    'diagnostics.stopped',
            },
        );

        return true;
    }

    /**
     * -------------------------------------------------------------------------
     * Reset.
     * -------------------------------------------------------------------------
     */

    reset() {

        if (
            this._initializationPromise
        ) {

            throw new EnvironmentDiagnosticsError(
                'Cannot reset TITech environment diagnostics during initialization.',
                {
                    code:
                        'ENVIRONMENT_DIAGNOSTICS_RESET_NOT_ALLOWED',
                },
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

        this.history.length =
            0;

        this._initializationPromise =
            null;

        return this;
    }
}

/**
 * =============================================================================
 * Singleton
 * =============================================================================
 */

const diagnostics =
    new EnvironmentDiagnostics({
        enabled:
            process.env.ENVIRONMENT_DIAGNOSTICS_ENABLED !==
                'false',

        strict:
            true,

        failClosed:
            true,

        redactSecrets:
            true,

        exposeEnvironmentVariables:
            false,

        exposePaths:
            false,
    });

/**
 * =============================================================================
 * Convenience API
 * =============================================================================
 */

async function initialize() {

    return diagnostics.initialize();
}

async function start() {

    return diagnostics.initialize();
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

function snapshot(
    options,
) {

    return diagnostics.snapshot(
        options,
    );
}

function shutdown() {

    return diagnostics.shutdown();
}

function reset() {

    return diagnostics.reset();
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
        diagnostics,

        EnvironmentDiagnostics,

        DiagnosticCheck,

        EnvironmentDiagnosticsError,

        /**
         * Constants.
         */
        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        DIAGNOSTIC_STATES,

        CHECK_STATUSES,

        SEVERITIES,

        ENVIRONMENT_NAMES,

        SUPPORTED_ENVIRONMENTS,

        DEFAULTS,

        /**
         * Lifecycle.
         */
        initialize,

        start,

        run,

        shutdown,

        /**
         * Readiness / health.
         */
        readiness,

        health,

        /**
         * Snapshot / diagnostics.
         */
        snapshot,

        /**
         * Environment helpers.
         */
        normalizeEnvironment,

        isSupportedEnvironment,

        isProduction,

        getStateSnapshot,

        getReadinessState,

        fingerprint,

        sanitize,

        /**
         * Test support.
         */
        reset,
    });