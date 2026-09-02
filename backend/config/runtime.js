'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/runtime.js
 *
 * Purpose:
 *   Enterprise production-grade runtime configuration and policy boundary.
 *
 * Responsibilities:
 *   - Centralize Node.js/application runtime configuration.
 *   - Normalize runtime environment information.
 *   - Define graceful shutdown and startup timing policy.
 *   - Define process/resource safety limits.
 *   - Define HTTP/server runtime policy.
 *   - Define worker/cluster runtime policy.
 *   - Define runtime health/readiness policy.
 *   - Define signal handling policy.
 *   - Define runtime diagnostics.
 *   - Provide immutable runtime configuration.
 *   - Integrate cleanly with bootstrap/runtime.js and lifecycle managers.
 *
 * IMPORTANT:
 *
 *   This file owns RUNTIME CONFIGURATION AND POLICY.
 *
 *   It does NOT:
 *     - start the HTTP server.
 *     - create worker threads.
 *     - initialize databases.
 *     - initialize Redis.
 *     - create Express applications.
 *     - implement process signal handlers.
 *     - mutate process.env.
 *     - terminate the process directly.
 *
 * Actual lifecycle implementation belongs to:
 *
 *   backend/bootstrap/runtime.js
 *   backend/bootstrap/lifecycle.js
 *   backend/bootstrap/shutdown.js
 *
 * =============================================================================
 *
 * Canonical architecture:
 *
 *   process.env
 *       ↓
 *   environment.js
 *       ↓
 *   defaults.js
 *       ↓
 *   config/runtime.js
 *       ↓
 *   bootstrap/runtime.js
 *       ↓
 *   lifecycle / server / workers
 *
 * =============================================================================
 */

const os =
    require('node:os');

const process =
    require('node:process');

/**
 * =============================================================================
 * Optional configuration provider
 * =============================================================================
 */

let configProvider = null;

try {
    // eslint-disable-next-line global-require
    configProvider = require('./configProvider');
} catch {
    configProvider = null;
}

/**
 * =============================================================================
 * Optional startup error integration
 * =============================================================================
 */

let startupErrors = null;

try {
    // eslint-disable-next-line global-require
    startupErrors = require('../bootstrap/startupErrors');
} catch {
    startupErrors = null;
}

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const COMPONENT =
    'runtime-config';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

const RUNTIME_STATES =
    Object.freeze({
        ENABLED:
            'enabled',

        DISABLED:
            'disabled',

        DEGRADED:
            'degraded',

        INVALID:
            'invalid',
    });

const RUNTIME_MODES =
    Object.freeze({
        SERVER:
            'server',

        WORKER:
            'worker',

        CRON:
            'cron',

        CLI:
            'cli',

        MIGRATION:
            'migration',

        TEST:
            'test',

        HYBRID:
            'hybrid',
    });

const SHUTDOWN_REASONS =
    Object.freeze({
        SIGINT:
            'SIGINT',

        SIGTERM:
            'SIGTERM',

        STARTUP_FAILURE:
            'startup_failure',

        FATAL_ERROR:
            'fatal_error',

        UNHANDLED_REJECTION:
            'unhandled_rejection',

        MANUAL:
            'manual',

        DEPLOYMENT:
            'deployment',

        HEALTH_FAILURE:
            'health_failure',
    });

/**
 * =============================================================================
 * Defaults
 * =============================================================================
 */

const DEFAULTS =
    Object.freeze({
        enabled:
            true,

        mode:
            RUNTIME_MODES.SERVER,

        environment:
            process.env.NODE_ENV ||
            'development',

        /**
         * ---------------------------------------------------------------------
         * Process metadata
         * ---------------------------------------------------------------------
         */

        appName:
            APPLICATION_NAME,

        serviceName:
            SERVICE_NAME,

        version:
            process.env.APP_VERSION ||
            process.env.npm_package_version ||
            '0.0.0',

        instanceId:
            process.env.INSTANCE_ID ||
            null,

        /**
         * ---------------------------------------------------------------------
         * HTTP/runtime
         * ---------------------------------------------------------------------
         */

        port:
            3000,

        host:
            '0.0.0.0',

        backlog:
            511,

        keepAliveTimeoutMs:
            5_000,

        headersTimeoutMs:
            6_000,

        requestTimeoutMs:
            30_000,

        idleTimeoutMs:
            30_000,

        maxConnections:
            0,

        /**
         * ---------------------------------------------------------------------
         * Startup
         * ---------------------------------------------------------------------
         */

        startupTimeoutMs:
            120_000,

        startupGracePeriodMs:
            10_000,

        startupFailureExitCode:
            1,

        failFast:
            true,

        allowDegradedStartup:
            false,

        /**
         * ---------------------------------------------------------------------
         * Shutdown
         * ---------------------------------------------------------------------
         */

        gracefulShutdown:
            true,

        shutdownTimeoutMs:
            30_000,

        forceShutdownTimeoutMs:
            10_000,

        shutdownDrainTimeoutMs:
            20_000,

        shutdownExitCode:
            0,

        stopAcceptingTrafficFirst:
            true,

        waitForActiveRequests:
            true,

        waitForWorkers:
            true,

        waitForQueues:
            true,

        closeDatabase:
            true,

        closeRedis:
            true,

        closeRealtime:
            true,

        /**
         * ---------------------------------------------------------------------
         * Signal handling
         * ---------------------------------------------------------------------
         */

        handleSIGINT:
            true,

        handleSIGTERM:
            true,

        handleSIGHUP:
            false,

        handleSIGUSR2:
            false,

        /**
         * ---------------------------------------------------------------------
         * Fatal errors
         * ---------------------------------------------------------------------
         */

        handleUncaughtException:
            true,

        handleUnhandledRejection:
            true,

        exitOnUncaughtException:
            true,

        exitOnUnhandledRejection:
            true,

        fatalErrorGracePeriodMs:
            5_000,

        /**
         * ---------------------------------------------------------------------
         * Health
         * ---------------------------------------------------------------------
         */

        healthEnabled:
            true,

        livenessEnabled:
            true,

        readinessEnabled:
            true,

        healthCheckIntervalMs:
            10_000,

        healthCheckTimeoutMs:
            5_000,

        readinessTimeoutMs:
            5_000,

        startupReadinessDelayMs:
            0,

        /**
         * ---------------------------------------------------------------------
         * Event loop
         * ---------------------------------------------------------------------
         */

        eventLoopLagMonitoring:
            true,

        eventLoopLagSampleMs:
            1_000,

        maxEventLoopLagMs:
            500,

        /**
         * ---------------------------------------------------------------------
         * Memory
         * ---------------------------------------------------------------------
         */

        memoryMonitoring:
            true,

        maxHeapUsedMb:
            0,

        maxRssMb:
            0,

        memoryWarningThresholdPercent:
            85,

        memoryCriticalThresholdPercent:
            95,

        /**
         * ---------------------------------------------------------------------
         * CPU / process
         * ---------------------------------------------------------------------
         */

        cpuMonitoring:
            true,

        maxCpuLoadPercent:
            0,

        /**
         * ---------------------------------------------------------------------
         * Cluster / workers
         * ---------------------------------------------------------------------
         */

        clusterEnabled:
            false,

        workerCount:
            1,

        maxWorkerRestarts:
            10,

        workerRestartDelayMs:
            1_000,

        workerRestartBackoffMaxMs:
            30_000,

        workerGracefulShutdown:
            true,

        /**
         * ---------------------------------------------------------------------
         * Node warnings
         * ---------------------------------------------------------------------
         */

        emitNodeWarnings:
            true,

        captureWarningEvents:
            true,

        /**
         * ---------------------------------------------------------------------
         * Diagnostics
         * ---------------------------------------------------------------------
         */

        diagnosticsEnabled:
            true,

        exposeProcessEnvironment:
            false,

        exposeSystemDetails:
            true,

        /**
         * ---------------------------------------------------------------------
         * Security
         * ---------------------------------------------------------------------
         */

        trustProxy:
            false,

        allowRuntimeEnvMutation:
            false,

        requireImmutableConfiguration:
            true,

        /**
         * ---------------------------------------------------------------------
         * Recovery
         * ---------------------------------------------------------------------
         */

        autoRestart:
            false,

        restartOnFatalError:
            false,

        restartOnMemoryPressure:
            false,

        /**
         * ---------------------------------------------------------------------
         * Time source
         * ---------------------------------------------------------------------
         */

        timezone:
            'UTC',

        locale:
            'en-US',
    });

/**
 * =============================================================================
 * Utility functions
 * =============================================================================
 */

function env(
    key,
    fallback = undefined,
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
        value,
    ).trim();

}

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

function asNonNegativeInteger(
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
        parsed < 0
    ) {

        return fallback;

    }

    return parsed;

}

function asString(
    value,
    fallback,
) {

    if (
        value === undefined ||
        value === null
    ) {

        return fallback;

    }

    const normalized =
        String(
            value,
        ).trim();

    return normalized || fallback;

}

function toEnum(
    value,
    allowed,
    fallback,
) {

    const normalized =
        asString(
            value,
            fallback,
        );

    const found =
        allowed.find(
            item =>
                String(
                    item,
                ).toLowerCase() ===
                String(
                    normalized,
                ).toLowerCase(),
        );

    return (
        found ||
        fallback
    );

}

function deepFreeze(
    object,
    seen = new WeakSet(),
) {

    if (
        object === null ||
        object === undefined ||
        typeof object !== 'object'
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

/**
 * =============================================================================
 * Configuration provider helpers
 * =============================================================================
 */

function getConfig(
    path,
    fallback,
) {

    try {

        if (
            typeof configProvider?.get ===
            'function'
        ) {

            return configProvider.get(
                path,
                fallback,
            );

        }

    } catch {
        // Fall through.
    }

    return fallback;

}

function getEnvironment() {

    try {

        if (
            typeof configProvider?.getEnvironment ===
            'function'
        ) {

            return configProvider.getEnvironment();

        }

    } catch {
        // Fall through.
    }

    return (
        getConfig(
            'app.environment',
            process.env.NODE_ENV ||
                DEFAULTS.environment,
        ) ||
        DEFAULTS.environment
    );

}

function isProduction(
    environment =
        getEnvironment(),
) {

    return (
        environment ===
        'production'
    );

}

/**
 * =============================================================================
 * Runtime metadata
 * =============================================================================
 */

function resolveHostname() {

    try {

        return os.hostname();

    } catch {

        return (
            process.env.HOSTNAME ||
            'unknown'
        );

    }

}

function resolveInstanceId(
    source,
) {

    return (
        source.instanceId ||
        env(
            'INSTANCE_ID',
        ) ||
        env(
            'HOSTNAME',
        ) ||
        null
    );

}

function getCpuCount() {

    try {

        return os.cpus().length;

    } catch {

        return 1;

    }

}

/**
 * =============================================================================
 * Configuration builder
 * =============================================================================
 */

function createRuntimeConfig(
    input = {},
) {

    const source =
        input.runtime ||
        input;

    const environment =
        asString(
            source.environment,
            getEnvironment(),
        );

    const production =
        isProduction(
            environment,
        );

    const config = {

        component:
            COMPONENT,

        enabled:
            source.enabled ??
            asBoolean(
                env(
                    'RUNTIME_ENABLED',
                ),
                DEFAULTS.enabled,
            ),

        mode:
            toEnum(
                source.mode ||
                    env(
                        'RUNTIME_MODE',
                    ),
                Object.values(
                    RUNTIME_MODES,
                ),
                production
                    ? RUNTIME_MODES.SERVER
                    : DEFAULTS.mode,
            ),

        environment,

        /**
         * ---------------------------------------------------------------------
         * Application metadata
         * ---------------------------------------------------------------------
         */

        application:
            {
                name:
                    asString(
                        source.appName ||
                            env(
                                'APP_NAME',
                            ),
                        DEFAULTS.appName,
                    ),

                serviceName:
                    asString(
                        source.serviceName ||
                            env(
                                'SERVICE_NAME',
                            ),
                        DEFAULTS.serviceName,
                    ),

                version:
                    asString(
                        source.version ||
                            env(
                                'APP_VERSION',
                            ),
                        DEFAULTS.version,
                    ),

                instanceId:
                    resolveInstanceId(
                        source,
                    ),

                hostname:
                    resolveHostname(),

                nodeVersion:
                    process.version,

                platform:
                    process.platform,

                architecture:
                    process.arch,

                cpuCount:
                    getCpuCount(),

                pid:
                    process.pid,
            },

        /**
         * ---------------------------------------------------------------------
         * Network
         * ---------------------------------------------------------------------
         */

        network:
            {
                host:
                    asString(
                        source.host ||
                            env(
                                'HOST',
                            ),
                        DEFAULTS.host,
                    ),

                port:
                    asPositiveInteger(
                        source.port ??
                            env(
                                'PORT',
                            ),
                        DEFAULTS.port,
                    ),

                backlog:
                    asPositiveInteger(
                        source.backlog ??
                            env(
                                'SERVER_BACKLOG',
                            ),
                        DEFAULTS.backlog,
                    ),

                maxConnections:
                    asNonNegativeInteger(
                        source.maxConnections ??
                            env(
                                'SERVER_MAX_CONNECTIONS',
                            ),
                        DEFAULTS.maxConnections,
                    ),

                trustProxy:
                    source.trustProxy ??
                    asBoolean(
                        env(
                            'TRUST_PROXY',
                        ),
                        DEFAULTS.trustProxy,
                    ),
            },

        /**
         * ---------------------------------------------------------------------
         * HTTP
         * ---------------------------------------------------------------------
         */

        http:
            {
                keepAliveTimeoutMs:
                    asPositiveInteger(
                        source.keepAliveTimeoutMs ??
                            env(
                                'HTTP_KEEP_ALIVE_TIMEOUT_MS',
                            ),
                        DEFAULTS.keepAliveTimeoutMs,
                    ),

                headersTimeoutMs:
                    asPositiveInteger(
                        source.headersTimeoutMs ??
                            env(
                                'HTTP_HEADERS_TIMEOUT_MS',
                            ),
                        DEFAULTS.headersTimeoutMs,
                    ),

                requestTimeoutMs:
                    asPositiveInteger(
                        source.requestTimeoutMs ??
                            env(
                                'HTTP_REQUEST_TIMEOUT_MS',
                            ),
                        DEFAULTS.requestTimeoutMs,
                    ),

                idleTimeoutMs:
                    asPositiveInteger(
                        source.idleTimeoutMs ??
                            env(
                                'HTTP_IDLE_TIMEOUT_MS',
                            ),
                        DEFAULTS.idleTimeoutMs,
                    ),
            },

        /**
         * ---------------------------------------------------------------------
         * Startup
         * ---------------------------------------------------------------------
         */

        startup:
            {
                timeoutMs:
                    asPositiveInteger(
                        source.startupTimeoutMs ??
                            env(
                                'STARTUP_TIMEOUT_MS',
                            ),
                        DEFAULTS.startupTimeoutMs,
                    ),

                gracePeriodMs:
                    asNonNegativeInteger(
                        source.startupGracePeriodMs ??
                            env(
                                'STARTUP_GRACE_PERIOD_MS',
                            ),
                        DEFAULTS.startupGracePeriodMs,
                    ),

                failureExitCode:
                    asNonNegativeInteger(
                        source.startupFailureExitCode ??
                            env(
                                'STARTUP_FAILURE_EXIT_CODE',
                            ),
                        DEFAULTS.startupFailureExitCode,
                    ),

                failFast:
                    source.failFast ??
                    asBoolean(
                        env(
                            'STARTUP_FAIL_FAST',
                        ),
                        DEFAULTS.failFast,
                    ),

                allowDegraded:
                    source.allowDegradedStartup ??
                    asBoolean(
                        env(
                            'ALLOW_DEGRADED_STARTUP',
                        ),
                        DEFAULTS.allowDegradedStartup,
                    ),
            },

        /**
         * ---------------------------------------------------------------------
         * Shutdown
         * ---------------------------------------------------------------------
         */

        shutdown:
            {
                graceful:
                    source.gracefulShutdown ??
                    asBoolean(
                        env(
                            'GRACEFUL_SHUTDOWN',
                        ),
                        DEFAULTS.gracefulShutdown,
                    ),

                timeoutMs:
                    asPositiveInteger(
                        source.shutdownTimeoutMs ??
                            env(
                                'SHUTDOWN_TIMEOUT_MS',
                            ),
                        DEFAULTS.shutdownTimeoutMs,
                    ),

                forceTimeoutMs:
                    asPositiveInteger(
                        source.forceShutdownTimeoutMs ??
                            env(
                                'FORCE_SHUTDOWN_TIMEOUT_MS',
                            ),
                        DEFAULTS.forceShutdownTimeoutMs,
                    ),

                drainTimeoutMs:
                    asPositiveInteger(
                        source.shutdownDrainTimeoutMs ??
                            env(
                                'SHUTDOWN_DRAIN_TIMEOUT_MS',
                            ),
                        DEFAULTS.shutdownDrainTimeoutMs,
                    ),

                exitCode:
                    asNonNegativeInteger(
                        source.shutdownExitCode ??
                            env(
                                'SHUTDOWN_EXIT_CODE',
                            ),
                        DEFAULTS.shutdownExitCode,
                    ),

                stopAcceptingTrafficFirst:
                    source.stopAcceptingTrafficFirst ??
                    asBoolean(
                        env(
                            'SHUTDOWN_STOP_TRAFFIC_FIRST',
                        ),
                        DEFAULTS.stopAcceptingTrafficFirst,
                    ),

                waitForActiveRequests:
                    source.waitForActiveRequests ??
                    asBoolean(
                        env(
                            'SHUTDOWN_WAIT_ACTIVE_REQUESTS',
                        ),
                        DEFAULTS.waitForActiveRequests,
                    ),

                waitForWorkers:
                    source.waitForWorkers ??
                    asBoolean(
                        env(
                            'SHUTDOWN_WAIT_WORKERS',
                        ),
                        DEFAULTS.waitForWorkers,
                    ),

                waitForQueues:
                    source.waitForQueues ??
                    asBoolean(
                        env(
                            'SHUTDOWN_WAIT_QUEUES',
                        ),
                        DEFAULTS.waitForQueues,
                    ),

                closeDatabase:
                    source.closeDatabase ??
                    asBoolean(
                        env(
                            'SHUTDOWN_CLOSE_DATABASE',
                        ),
                        DEFAULTS.closeDatabase,
                    ),

                closeRedis:
                    source.closeRedis ??
                    asBoolean(
                        env(
                            'SHUTDOWN_CLOSE_REDIS',
                        ),
                        DEFAULTS.closeRedis,
                    ),

                closeRealtime:
                    source.closeRealtime ??
                    asBoolean(
                        env(
                            'SHUTDOWN_CLOSE_REALTIME',
                        ),
                        DEFAULTS.closeRealtime,
                    ),
            },

        /**
         * ---------------------------------------------------------------------
         * Signals
         * ---------------------------------------------------------------------
         */

        signals:
            {
                SIGINT:
                    source.handleSIGINT ??
                    asBoolean(
                        env(
                            'HANDLE_SIGINT',
                        ),
                        DEFAULTS.handleSIGINT,
                    ),

                SIGTERM:
                    source.handleSIGTERM ??
                    asBoolean(
                        env(
                            'HANDLE_SIGTERM',
                        ),
                        DEFAULTS.handleSIGTERM,
                    ),

                SIGHUP:
                    source.handleSIGHUP ??
                    asBoolean(
                        env(
                            'HANDLE_SIGHUP',
                        ),
                        DEFAULTS.handleSIGHUP,
                    ),

                SIGUSR2:
                    source.handleSIGUSR2 ??
                    asBoolean(
                        env(
                            'HANDLE_SIGUSR2',
                        ),
                        DEFAULTS.handleSIGUSR2,
                    ),
            },

        /**
         * ---------------------------------------------------------------------
         * Fatal errors
         * ---------------------------------------------------------------------
         */

        fatal:
            {
                handleUncaughtException:
                    source.handleUncaughtException ??
                    asBoolean(
                        env(
                            'HANDLE_UNCAUGHT_EXCEPTION',
                        ),
                        DEFAULTS.handleUncaughtException,
                    ),

                handleUnhandledRejection:
                    source.handleUnhandledRejection ??
                    asBoolean(
                        env(
                            'HANDLE_UNHANDLED_REJECTION',
                        ),
                        DEFAULTS.handleUnhandledRejection,
                    ),

                exitOnUncaughtException:
                    source.exitOnUncaughtException ??
                    asBoolean(
                        env(
                            'EXIT_ON_UNCAUGHT_EXCEPTION',
                        ),
                        DEFAULTS.exitOnUncaughtException,
                    ),

                exitOnUnhandledRejection:
                    source.exitOnUnhandledRejection ??
                    asBoolean(
                        env(
                            'EXIT_ON_UNHANDLED_REJECTION',
                        ),
                        DEFAULTS.exitOnUnhandledRejection,
                    ),

                gracePeriodMs:
                    asPositiveInteger(
                        source.fatalErrorGracePeriodMs ??
                            env(
                                'FATAL_ERROR_GRACE_PERIOD_MS',
                            ),
                        DEFAULTS.fatalErrorGracePeriodMs,
                    ),
            },

        /**
         * ---------------------------------------------------------------------
         * Health
         * ---------------------------------------------------------------------
         */

        health:
            {
                enabled:
                    source.healthEnabled ??
                    asBoolean(
                        env(
                            'RUNTIME_HEALTH_ENABLED',
                        ),
                        DEFAULTS.healthEnabled,
                    ),

                livenessEnabled:
                    source.livenessEnabled ??
                    asBoolean(
                        env(
                            'LIVENESS_ENABLED',
                        ),
                        DEFAULTS.livenessEnabled,
                    ),

                readinessEnabled:
                    source.readinessEnabled ??
                    asBoolean(
                        env(
                            'READINESS_ENABLED',
                        ),
                        DEFAULTS.readinessEnabled,
                    ),

                checkIntervalMs:
                    asPositiveInteger(
                        source.healthCheckIntervalMs ??
                            env(
                                'HEALTH_CHECK_INTERVAL_MS',
                            ),
                        DEFAULTS.healthCheckIntervalMs,
                    ),

                checkTimeoutMs:
                    asPositiveInteger(
                        source.healthCheckTimeoutMs ??
                            env(
                                'HEALTH_CHECK_TIMEOUT_MS',
                            ),
                        DEFAULTS.healthCheckTimeoutMs,
                    ),

                readinessTimeoutMs:
                    asPositiveInteger(
                        source.readinessTimeoutMs ??
                            env(
                                'READINESS_TIMEOUT_MS',
                            ),
                        DEFAULTS.readinessTimeoutMs,
                    ),

                readinessDelayMs:
                    asNonNegativeInteger(
                        source.startupReadinessDelayMs ??
                            env(
                                'STARTUP_READINESS_DELAY_MS',
                            ),
                        DEFAULTS.startupReadinessDelayMs,
                    ),
            },

        /**
         * ---------------------------------------------------------------------
         * Event loop
         * ---------------------------------------------------------------------
         */

        eventLoop:
            {
                monitoring:
                    source.eventLoopLagMonitoring ??
                    asBoolean(
                        env(
                            'EVENT_LOOP_LAG_MONITORING',
                        ),
                        DEFAULTS.eventLoopLagMonitoring,
                    ),

                sampleIntervalMs:
                    asPositiveInteger(
                        source.eventLoopLagSampleMs ??
                            env(
                                'EVENT_LOOP_LAG_SAMPLE_MS',
                            ),
                        DEFAULTS.eventLoopLagSampleMs,
                    ),

                maxLagMs:
                    asPositiveInteger(
                        source.maxEventLoopLagMs ??
                            env(
                                'MAX_EVENT_LOOP_LAG_MS',
                            ),
                        DEFAULTS.maxEventLoopLagMs,
                    ),
            },

        /**
         * ---------------------------------------------------------------------
         * Memory
         * ---------------------------------------------------------------------
         */

        memory:
            {
                monitoring:
                    source.memoryMonitoring ??
                    asBoolean(
                        env(
                            'MEMORY_MONITORING',
                        ),
                        DEFAULTS.memoryMonitoring,
                    ),

                maxHeapUsedMb:
                    asNonNegativeInteger(
                        source.maxHeapUsedMb ??
                            env(
                                'MAX_HEAP_USED_MB',
                            ),
                        DEFAULTS.maxHeapUsedMb,
                    ),

                maxRssMb:
                    asNonNegativeInteger(
                        source.maxRssMb ??
                            env(
                                'MAX_RSS_MB',
                            ),
                        DEFAULTS.maxRssMb,
                    ),

                warningThresholdPercent:
                    Math.min(
                        100,
                        Math.max(
                            1,
                            Number(
                                source.memoryWarningThresholdPercent ??
                                    env(
                                        'MEMORY_WARNING_THRESHOLD_PERCENT',
                                    ) ??
                                    DEFAULTS.memoryWarningThresholdPercent,
                            ),
                        ),
                    ),

                criticalThresholdPercent:
                    Math.min(
                        100,
                        Math.max(
                            1,
                            Number(
                                source.memoryCriticalThresholdPercent ??
                                    env(
                                        'MEMORY_CRITICAL_THRESHOLD_PERCENT',
                                    ) ??
                                    DEFAULTS.memoryCriticalThresholdPercent,
                            ),
                        ),
                    ),
            },

        /**
         * ---------------------------------------------------------------------
         * CPU
         * ---------------------------------------------------------------------
         */

        cpu:
            {
                monitoring:
                    source.cpuMonitoring ??
                    asBoolean(
                        env(
                            'CPU_MONITORING',
                        ),
                        DEFAULTS.cpuMonitoring,
                    ),

                maxLoadPercent:
                    asNonNegativeInteger(
                        source.maxCpuLoadPercent ??
                            env(
                                'MAX_CPU_LOAD_PERCENT',
                            ),
                        DEFAULTS.maxCpuLoadPercent,
                    ),
            },

        /**
         * ---------------------------------------------------------------------
         * Cluster/workers
         * ---------------------------------------------------------------------
         */

        workers:
            {
                clusterEnabled:
                    source.clusterEnabled ??
                    asBoolean(
                        env(
                            'CLUSTER_ENABLED',
                        ),
                        DEFAULTS.clusterEnabled,
                    ),

                workerCount:
                    asPositiveInteger(
                        source.workerCount ??
                            env(
                                'WORKER_COUNT',
                            ),
                        DEFAULTS.workerCount,
                    ),

                maxRestarts:
                    asPositiveInteger(
                        source.maxWorkerRestarts ??
                            env(
                                'MAX_WORKER_RESTARTS',
                            ),
                        DEFAULTS.maxWorkerRestarts,
                    ),

                restartDelayMs:
                    asPositiveInteger(
                        source.workerRestartDelayMs ??
                            env(
                                'WORKER_RESTART_DELAY_MS',
                            ),
                        DEFAULTS.workerRestartDelayMs,
                    ),

                restartBackoffMaxMs:
                    asPositiveInteger(
                        source.workerRestartBackoffMaxMs ??
                            env(
                                'WORKER_RESTART_BACKOFF_MAX_MS',
                            ),
                        DEFAULTS.workerRestartBackoffMaxMs,
                    ),

                gracefulShutdown:
                    source.workerGracefulShutdown ??
                    asBoolean(
                        env(
                            'WORKER_GRACEFUL_SHUTDOWN',
                        ),
                        DEFAULTS.workerGracefulShutdown,
                    ),
            },

        /**
         * ---------------------------------------------------------------------
         * Node process behavior
         * ---------------------------------------------------------------------
         */

        process:
            {
                emitNodeWarnings:
                    source.emitNodeWarnings ??
                    asBoolean(
                        env(
                            'NODE_WARNINGS_ENABLED',
                        ),
                        DEFAULTS.emitNodeWarnings,
                    ),

                captureWarningEvents:
                    source.captureWarningEvents ??
                    asBoolean(
                        env(
                            'CAPTURE_NODE_WARNINGS',
                        ),
                        DEFAULTS.captureWarningEvents,
                    ),

                autoRestart:
                    source.autoRestart ??
                    asBoolean(
                        env(
                            'RUNTIME_AUTO_RESTART',
                        ),
                        DEFAULTS.autoRestart,
                    ),

                restartOnFatalError:
                    source.restartOnFatalError ??
                    asBoolean(
                        env(
                            'RESTART_ON_FATAL_ERROR',
                        ),
                        DEFAULTS.restartOnFatalError,
                    ),

                restartOnMemoryPressure:
                    source.restartOnMemoryPressure ??
                    asBoolean(
                        env(
                            'RESTART_ON_MEMORY_PRESSURE',
                        ),
                        DEFAULTS.restartOnMemoryPressure,
                    ),
            },

        /**
         * ---------------------------------------------------------------------
         * Security / immutability
         * ---------------------------------------------------------------------
         */

        security:
            {
                allowRuntimeEnvMutation:
                    source.allowRuntimeEnvMutation ??
                    asBoolean(
                        env(
                            'ALLOW_RUNTIME_ENV_MUTATION',
                        ),
                        DEFAULTS.allowRuntimeEnvMutation,
                    ),

                requireImmutableConfiguration:
                    source.requireImmutableConfiguration ??
                    asBoolean(
                        env(
                            'REQUIRE_IMMUTABLE_CONFIGURATION',
                        ),
                        DEFAULTS.requireImmutableConfiguration,
                    ),
            },

        /**
         * ---------------------------------------------------------------------
         * Diagnostics
         * ---------------------------------------------------------------------
         */

        diagnostics:
            {
                enabled:
                    source.diagnosticsEnabled ??
                    asBoolean(
                        env(
                            'RUNTIME_DIAGNOSTICS_ENABLED',
                        ),
                        DEFAULTS.diagnosticsEnabled,
                    ),

                exposeProcessEnvironment:
                    source.exposeProcessEnvironment ??
                    asBoolean(
                        env(
                            'EXPOSE_PROCESS_ENVIRONMENT',
                        ),
                        DEFAULTS.exposeProcessEnvironment,
                    ),

                exposeSystemDetails:
                    source.exposeSystemDetails ??
                    asBoolean(
                        env(
                            'EXPOSE_SYSTEM_DETAILS',
                        ),
                        DEFAULTS.exposeSystemDetails,
                    ),
            },

        /**
         * ---------------------------------------------------------------------
         * Locale
         * ---------------------------------------------------------------------
         */

        localization:
            {
                timezone:
                    asString(
                        source.timezone ||
                            env(
                                'TZ',
                            ),
                        DEFAULTS.timezone,
                    ),

                locale:
                    asString(
                        source.locale ||
                            env(
                                'LOCALE',
                            ),
                        DEFAULTS.locale,
                    ),
            },
    };

    return validateRuntimeConfig(
        config,
    );
}

/**
 * =============================================================================
 * Validation
 * =============================================================================
 */

function validateRuntimeConfig(
    config,
) {

    const errors = [];
    const warnings = [];

    const production =
        config.environment ===
        'production';

    /**
     * -------------------------------------------------------------------------
     * Network
     * -------------------------------------------------------------------------
     */

    if (
        config.network.port <
            1 ||
        config.network.port >
            65_535
    ) {

        errors.push({
            code:
                'RUNTIME_PORT_INVALID',

            field:
                'network.port',
        });

    }

    if (
        config.http.headersTimeoutMs <=
        config.http.keepAliveTimeoutMs
    ) {

        warnings.push({
            code:
                'HTTP_HEADERS_TIMEOUT_TOO_LOW',

            field:
                'http.headersTimeoutMs',

            message:
                'HTTP headers timeout should normally exceed keep-alive timeout.',
        });

    }

    /**
     * -------------------------------------------------------------------------
     * Startup
     * -------------------------------------------------------------------------
     */

    if (
        config.startup.timeoutMs <=
        config.startup.gracePeriodMs
    ) {

        warnings.push({
            code:
                'STARTUP_GRACE_PERIOD_HIGH',

            field:
                'startup.gracePeriodMs',
        });

    }

    if (
        production &&
        !config.startup.failFast &&
        !config.startup.allowDegraded
    ) {

        errors.push({
            code:
                'PRODUCTION_STARTUP_POLICY_INVALID',

            field:
                'startup',

            message:
                'TITech production startup cannot disable fail-fast behavior without explicitly allowing degraded startup.',
        });

    }

    /**
     * -------------------------------------------------------------------------
     * Shutdown
     * -------------------------------------------------------------------------
     */

    if (
        config.shutdown.forceTimeoutMs >=
        config.shutdown.timeoutMs
    ) {

        warnings.push({
            code:
                'FORCE_SHUTDOWN_TIMEOUT_HIGH',

            field:
                'shutdown.forceTimeoutMs',

            message:
                'Force-shutdown timeout is greater than or equal to the total shutdown timeout.',
        });

    }

    if (
        config.shutdown.drainTimeoutMs >
        config.shutdown.timeoutMs
    ) {

        warnings.push({
            code:
                'SHUTDOWN_DRAIN_TIMEOUT_HIGH',

            field:
                'shutdown.drainTimeoutMs',
        });

    }

    /**
     * -------------------------------------------------------------------------
     * Health
     * -------------------------------------------------------------------------
     */

    if (
        config.health.readinessDelayMs >
        config.startup.timeoutMs
    ) {

        errors.push({
            code:
                'READINESS_DELAY_EXCEEDS_STARTUP_TIMEOUT',

            field:
                'health.readinessDelayMs',
        });

    }

    /**
     * -------------------------------------------------------------------------
     * Event loop
     * -------------------------------------------------------------------------
     */

    if (
        config.eventLoop.maxLagMs <=
        config.eventLoop.sampleIntervalMs
    ) {

        warnings.push({
            code:
                'EVENT_LOOP_LAG_THRESHOLD_LOW',

            field:
                'eventLoop.maxLagMs',
        });

    }

    /**
     * -------------------------------------------------------------------------
     * Memory thresholds
     * -------------------------------------------------------------------------
     */

    if (
        config.memory.criticalThresholdPercent <=
        config.memory.warningThresholdPercent
    ) {

        errors.push({
            code:
                'MEMORY_THRESHOLDS_INVALID',

            field:
                'memory',
        });

    }

    /**
     * -------------------------------------------------------------------------
     * Worker policy
     * -------------------------------------------------------------------------
     */

    if (
        !config.workers.clusterEnabled &&
        config.workers.workerCount >
            1
    ) {

        warnings.push({
            code:
                'WORKER_COUNT_WITHOUT_CLUSTER',

            field:
                'workers.workerCount',

            message:
                'Multiple worker processes are configured while cluster mode is disabled.',
        });

    }

    if (
        production &&
        config.workers.clusterEnabled &&
        config.workers.workerCount >
            config.application?.cpuCount
    ) {

        warnings.push({
            code:
                'WORKER_COUNT_EXCEEDS_CPU_COUNT',

            field:
                'workers.workerCount',
        });

    }

    /**
     * -------------------------------------------------------------------------
     * Fatal error policy
     * -------------------------------------------------------------------------
     */

    if (
        production &&
        !config.fatal.exitOnUncaughtException
    ) {

        errors.push({
            code:
                'UNCaught_EXCEPTION_EXIT_REQUIRED',

            field:
                'fatal.exitOnUncaughtException',

            message:
                'TITech production must terminate after an uncaught exception because process integrity cannot be assumed.',
        });

    }

    if (
        production &&
        !config.fatal.exitOnUnhandledRejection
    ) {

        errors.push({
            code:
                'UNHANDLED_REJECTION_EXIT_REQUIRED',

            field:
                'fatal.exitOnUnhandledRejection',

            message:
                'TITech production must terminate after an unhandled rejection under the fail-safe runtime policy.',
        });

    }

    /**
     * -------------------------------------------------------------------------
     * Runtime configuration mutation
     * -------------------------------------------------------------------------
     */

    if (
        production &&
        config.security.allowRuntimeEnvMutation
    ) {

        errors.push({
            code:
                'RUNTIME_ENV_MUTATION_FORBIDDEN',

            field:
                'security.allowRuntimeEnvMutation',

            message:
                'TITech production runtime environment mutation is forbidden.',
        });

    }

    /**
     * -------------------------------------------------------------------------
     * Diagnostics
     * -------------------------------------------------------------------------
     */

    if (
        production &&
        config.diagnostics.exposeProcessEnvironment
    ) {

        errors.push({
            code:
                'PROCESS_ENV_EXPOSURE_FORBIDDEN',

            field:
                'diagnostics.exposeProcessEnvironment',

            message:
                'TITech production diagnostics cannot expose process.env.',
        });

    }

    /**
     * -------------------------------------------------------------------------
     * Error handling
     * -------------------------------------------------------------------------
     */

    if (
        errors.length >
        0
    ) {

        const error =
            new Error(
                'TITech runtime configuration validation failed.',
            );

        error.name =
            'RuntimeConfigError';

        error.code =
            'RUNTIME_CONFIGURATION_INVALID';

        error.details = {
            component:
                COMPONENT,

            errors,
            warnings,
        };

        if (
            startupErrors?.configurationError
        ) {

            try {

                throw startupErrors.configurationError(
                    error.message,
                    {
                        cause:
                            error,

                        critical:
                            true,

                        fatal:
                            true,

                        details:
                            error.details,
                    },
                );

            } catch (
                wrappedError
            ) {

                throw wrappedError;

            }

        }

        throw error;

    }

    const state =
        !config.enabled
            ? RUNTIME_STATES.DISABLED
            : warnings.length >
                0
                ? RUNTIME_STATES.DEGRADED
                : RUNTIME_STATES.ENABLED;

    return deepFreeze({
        ...config,

        state,

        warnings:
            Object.freeze(
                warnings,
            ),
    });

}

/**
 * =============================================================================
 * Runtime helper policies
 * =============================================================================
 */

function getServerOptions(
    config =
        defaultConfig,
) {

    return Object.freeze({
        host:
            config.network.host,

        port:
            config.network.port,

        backlog:
            config.network.backlog,

        keepAliveTimeout:
            config.http
                .keepAliveTimeoutMs,

        headersTimeout:
            config.http
                .headersTimeoutMs,

        requestTimeout:
            config.http
                .requestTimeoutMs,

        maxConnections:
            config.network
                .maxConnections,
    });

}

function getShutdownPlan(
    config =
        defaultConfig,
) {

    return Object.freeze([
        {
            order:
                1,

            component:
                'http-server',

            action:
                'stop_accepting_traffic',

            enabled:
                config.shutdown
                    .stopAcceptingTrafficFirst,
        },

        {
            order:
                2,

            component:
                'active-requests',

            action:
                'drain_active_requests',

            enabled:
                config.shutdown
                    .waitForActiveRequests,
        },

        {
            order:
                3,

            component:
                'workers',

            action:
                'drain_workers',

            enabled:
                config.shutdown
                    .waitForWorkers,
        },

        {
            order:
                4,

            component:
                'queues',

            action:
                'drain_queues',

            enabled:
                config.shutdown
                    .waitForQueues,
        },

        {
            order:
                5,

            component:
                'realtime',

            action:
                'close_realtime',

            enabled:
                config.shutdown
                    .closeRealtime,
        },

        {
            order:
                6,

            component:
                'redis',

            action:
                'close_redis',

            enabled:
                config.shutdown
                    .closeRedis,
        },

        {
            order:
                7,

            component:
                'database',

            action:
                'close_database',

            enabled:
                config.shutdown
                    .closeDatabase,
        },
    ]);

}

function getSignalPolicy(
    config =
        defaultConfig,
) {

    return Object.freeze({
        SIGINT:
            config.signals
                .SIGINT,

        SIGTERM:
            config.signals
                .SIGTERM,

        SIGHUP:
            config.signals
                .SIGHUP,

        SIGUSR2:
            config.signals
                .SIGUSR2,
    });

}

function getFatalPolicy(
    config =
        defaultConfig,
) {

    return Object.freeze({
        handleUncaughtException:
            config.fatal
                .handleUncaughtException,

        handleUnhandledRejection:
            config.fatal
                .handleUnhandledRejection,

        exitOnUncaughtException:
            config.fatal
                .exitOnUncaughtException,

        exitOnUnhandledRejection:
            config.fatal
                .exitOnUnhandledRejection,

        gracePeriodMs:
            config.fatal
                .gracePeriodMs,
    });

}

function getHealthPolicy(
    config =
        defaultConfig,
) {

    return Object.freeze({
        enabled:
            config.health
                .enabled,

        liveness:
            config.health
                .livenessEnabled,

        readiness:
            config.health
                .readinessEnabled,

        intervalMs:
            config.health
                .checkIntervalMs,

        timeoutMs:
            config.health
                .checkTimeoutMs,

        readinessTimeoutMs:
            config.health
                .readinessTimeoutMs,

        readinessDelayMs:
            config.health
                .readinessDelayMs,
    });

}

/**
 * =============================================================================
 * Safe diagnostics
 * ============================================================================= */

function getSnapshot(
    config =
        defaultConfig,
) {

    return deepFreeze({
        component:
            COMPONENT,

        service:
            config.application
                .serviceName,

        application:
            config.application
                .name,

        version:
            config.application
                .version,

        environment:
            config.environment,

        mode:
            config.mode,

        state:
            config.state,

        process:
            {
                pid:
                    config.application
                        .pid,

                hostname:
                    config.application
                        .hostname,

                nodeVersion:
                    config.application
                        .nodeVersion,

                platform:
                    config.application
                        .platform,

                architecture:
                    config.application
                        .architecture,

                cpuCount:
                    config.application
                        .cpuCount,
            },

        network:
            {
                host:
                    config.network
                        .host,

                port:
                    config.network
                        .port,

                backlog:
                    config.network
                        .backlog,

                maxConnections:
                    config.network
                        .maxConnections,

                trustProxy:
                    config.network
                        .trustProxy,
            },

        http:
            config.http,

        startup:
            config.startup,

        shutdown:
            config.shutdown,

        signals:
            config.signals,

        fatal:
            config.fatal,

        health:
            config.health,

        eventLoop:
            config.eventLoop,

        memory:
            config.memory,

        cpu:
            config.cpu,

        workers:
            config.workers,

        processPolicy:
            config.process,

        security:
            config.security,

        diagnostics:
            {
                enabled:
                    config.diagnostics
                        .enabled,

                exposeProcessEnvironment:
                    config.diagnostics
                        .exposeProcessEnvironment,

                exposeSystemDetails:
                    config.diagnostics
                        .exposeSystemDetails,
            },

        localization:
            config.localization,

        shutdownPlan:
            getShutdownPlan(
                config,
            ),

        timestamp:
            new Date().toISOString(),
    });

}

/**
 * =============================================================================
 * Runtime environment override diagnostics
 * ============================================================================= */

function getEnvironmentOverrides() {

    const keys = [
        'RUNTIME_ENABLED',
        'RUNTIME_MODE',
        'APP_NAME',
        'SERVICE_NAME',
        'APP_VERSION',
        'INSTANCE_ID',

        'HOST',
        'PORT',
        'SERVER_BACKLOG',
        'SERVER_MAX_CONNECTIONS',
        'TRUST_PROXY',

        'HTTP_KEEP_ALIVE_TIMEOUT_MS',
        'HTTP_HEADERS_TIMEOUT_MS',
        'HTTP_REQUEST_TIMEOUT_MS',
        'HTTP_IDLE_TIMEOUT_MS',

        'STARTUP_TIMEOUT_MS',
        'STARTUP_GRACE_PERIOD_MS',
        'STARTUP_FAILURE_EXIT_CODE',
        'STARTUP_FAIL_FAST',
        'ALLOW_DEGRADED_STARTUP',

        'GRACEFUL_SHUTDOWN',
        'SHUTDOWN_TIMEOUT_MS',
        'FORCE_SHUTDOWN_TIMEOUT_MS',
        'SHUTDOWN_DRAIN_TIMEOUT_MS',
        'SHUTDOWN_EXIT_CODE',
        'SHUTDOWN_STOP_TRAFFIC_FIRST',
        'SHUTDOWN_WAIT_ACTIVE_REQUESTS',
        'SHUTDOWN_WAIT_WORKERS',
        'SHUTDOWN_WAIT_QUEUES',
        'SHUTDOWN_CLOSE_DATABASE',
        'SHUTDOWN_CLOSE_REDIS',
        'SHUTDOWN_CLOSE_REALTIME',

        'HANDLE_SIGINT',
        'HANDLE_SIGTERM',
        'HANDLE_SIGHUP',
        'HANDLE_SIGUSR2',

        'HANDLE_UNCAUGHT_EXCEPTION',
        'HANDLE_UNHANDLED_REJECTION',
        'EXIT_ON_UNCAUGHT_EXCEPTION',
        'EXIT_ON_UNHANDLED_REJECTION',
        'FATAL_ERROR_GRACE_PERIOD_MS',

        'RUNTIME_HEALTH_ENABLED',
        'LIVENESS_ENABLED',
        'READINESS_ENABLED',
        'HEALTH_CHECK_INTERVAL_MS',
        'HEALTH_CHECK_TIMEOUT_MS',
        'READINESS_TIMEOUT_MS',
        'STARTUP_READINESS_DELAY_MS',

        'EVENT_LOOP_LAG_MONITORING',
        'EVENT_LOOP_LAG_SAMPLE_MS',
        'MAX_EVENT_LOOP_LAG_MS',

        'MEMORY_MONITORING',
        'MAX_HEAP_USED_MB',
        'MAX_RSS_MB',
        'MEMORY_WARNING_THRESHOLD_PERCENT',
        'MEMORY_CRITICAL_THRESHOLD_PERCENT',

        'CPU_MONITORING',
        'MAX_CPU_LOAD_PERCENT',

        'CLUSTER_ENABLED',
        'WORKER_COUNT',
        'MAX_WORKER_RESTARTS',
        'WORKER_RESTART_DELAY_MS',
        'WORKER_RESTART_BACKOFF_MAX_MS',
        'WORKER_GRACEFUL_SHUTDOWN',

        'NODE_WARNINGS_ENABLED',
        'CAPTURE_NODE_WARNINGS',

        'RUNTIME_AUTO_RESTART',
        'RESTART_ON_FATAL_ERROR',
        'RESTART_ON_MEMORY_PRESSURE',

        'ALLOW_RUNTIME_ENV_MUTATION',
        'REQUIRE_IMMUTABLE_CONFIGURATION',

        'RUNTIME_DIAGNOSTICS_ENABLED',
        'EXPOSE_PROCESS_ENVIRONMENT',
        'EXPOSE_SYSTEM_DETAILS',

        'TZ',
        'LOCALE',
    ];

    const result = {};

    for (
        const key of keys
    ) {

        result[key] =
            process.env[key];

    }

    return Object.freeze(
        result,
    );

}

/**
 * =============================================================================
 * Runtime lifecycle adapter
 * =============================================================================
 */

async function initialize(
    context = {},
    options = {},
) {

    const config =
        options.config
            ? createRuntimeConfig(
                options.config,
            )
            : defaultConfig;

    if (
        context &&
        typeof context === 'object'
    ) {

        context.runtime =
            config;

        context.runtimeConfig =
            config;
    }

    return config;

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

    return start(
        context,
        options,
    );

}

/**
 * =============================================================================
 * Default runtime configuration
 * =============================================================================
 */

const defaultConfig =
    createRuntimeConfig();

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

        runtime:
            defaultConfig,

        DEFAULTS,

        RUNTIME_STATES,

        RUNTIME_MODES,

        SHUTDOWN_REASONS,

        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        /**
         * Builder/validation.
         */
        createRuntimeConfig,

        validateRuntimeConfig,

        /**
         * Policy helpers.
         */
        getServerOptions,

        getShutdownPlan,

        getSignalPolicy,

        getFatalPolicy,

        getHealthPolicy,

        /**
         * Diagnostics.
         */
        getSnapshot,

        getEnvironmentOverrides,

        /**
         * Lifecycle compatibility.
         */
        initialize,

        start,

        bootstrap,
    });