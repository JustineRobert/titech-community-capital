'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/provider/hooks.js
 *
 * Purpose:
 *   Enterprise production-grade configuration lifecycle hooks provider.
 *
 * Responsibilities:
 *   - Bridge configuration lifecycle into TITech bootstrap hooks.
 *   - Provide deterministic configuration startup ordering.
 *   - Integrate ConfigurationProvider with backend/bootstrap/hooks.js.
 *   - Expose configuration readiness and health checks.
 *   - Prevent duplicate hook registration.
 *   - Support graceful startup/shutdown.
 *   - Preserve the separation between configuration and application lifecycle.
 *   - Provide safe lifecycle diagnostics.
 *
 * IMPORTANT:
 *
 *   This module is a CONFIGURATION LIFECYCLE ADAPTER.
 *
 *   It does NOT:
 *     - implement configuration parsing.
 *     - mutate process.env.
 *     - initialize databases.
 *     - initialize Redis.
 *     - initialize queues.
 *     - initialize Express.
 *     - implement business logic.
 *     - execute financial transactions.
 *
 * Canonical implementation:
 *
 *   backend/config/provider/ConfigurationProvider.js
 *
 * Canonical application lifecycle:
 *
 *   backend/bootstrap/hooks.js
 *
 * This file connects the two boundaries.
 *
 * =============================================================================
 *
 * Canonical startup:
 *
 *   environment
 *       ↓
 *   configuration
 *       ↓
 *   configuration provider
 *       ↓
 *   configuration hooks
 *       ↓
 *   logger
 *       ↓
 *   observability
 *       ↓
 *   resilience
 *       ↓
 *   infrastructure
 *       ↓
 *   middleware
 *       ↓
 *   routes
 *       ↓
 *   server
 *
 * =============================================================================
 */

const COMPONENT =
    'configuration-hooks';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

/**
 * =============================================================================
 * Canonical configuration provider
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
 * Optional diagnostics provider
 * =============================================================================
 */

let diagnosticsModule =
    null;

try {

    // eslint-disable-next-line global-require
    diagnosticsModule =
        require('./diagnostics');

} catch {
    diagnosticsModule =
        null;
}

/**
 * =============================================================================
 * Bootstrap hook registry
 * =============================================================================
 *
 * `backend/bootstrap/hooks.js` is the canonical lifecycle implementation.
 *
 * This adapter intentionally supports multiple export shapes so the provider
 * remains compatible with the existing TITech bootstrap refactor.
 * =============================================================================
 */

let bootstrapHooksModule =
    null;

try {

    // eslint-disable-next-line global-require
    bootstrapHooksModule =
        require('../../bootstrap/hooks');

} catch {
    bootstrapHooksModule =
        null;
}

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const DEFAULT_PRIORITY =
    -900;

const DEFAULT_TIMEOUT_MS =
    30_000;

const DEFAULT_DEPENDENCIES =
    Object.freeze([]);

const DEFAULT_CRITICAL =
    true;

const HOOK_NAME =
    'configuration';

const HOOK_STATES =
    Object.freeze({
        CREATED:
            'created',

        REGISTERED:
            'registered',

        STARTING:
            'starting',

        READY:
            'ready',

        DEGRADED:
            'degraded',

        STOPPING:
            'stopping',

        STOPPED:
            'stopped',

        FAILED:
            'failed',
    });

/**
 * =============================================================================
 * Error
 * =============================================================================
 */

class ConfigurationHooksError extends Error {

    constructor(
        message,
        options = {},
    ) {

        super(
            message,
        );

        this.name =
            'ConfigurationHooksError';

        this.code =
            options.code ||
            'CONFIGURATION_HOOKS_ERROR';

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
            ConfigurationHooksError,
        );
    }
}

/**
 * =============================================================================
 * Internal state
 * =============================================================================
 */

let state =
    HOOK_STATES.CREATED;

let registered =
    false;

let started =
    false;

let stopped =
    false;

let failed =
    false;

let registrationResult =
    null;

let startPromise =
    null;

let stopPromise =
    null;

let lastError =
    null;

let lastStartAt =
    null;

let lastStopAt =
    null;

/**
 * =============================================================================
 * Provider resolution
 * =============================================================================
 */

function getProvider() {

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

function getDiagnostics() {

    if (
        !diagnosticsModule
    ) {

        return null;
    }

    return (
        diagnosticsModule.diagnostics ||
        diagnosticsModule
    );
}

/**
 * =============================================================================
 * Logger resolution
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

                    ...metadata,
                },
                message,
            );
        }

    } catch {
        // Bootstrap lifecycle must not fail because logging failed.
    }
}

/**
 * =============================================================================
 * Bootstrap hooks compatibility helpers
 * =============================================================================
 */

function resolveHookRegistry() {

    if (
        !bootstrapHooksModule
    ) {

        return null;
    }

    return (
        bootstrapHooksModule.hooks ||
        bootstrapHooksModule.registry ||
        null
    );
}

function resolveLifecycleRegistrar() {

    if (
        !bootstrapHooksModule
    ) {

        return null;
    }

    if (
        typeof bootstrapHooksModule.lifecycle ===
        'function'
    ) {

        return bootstrapHooksModule.lifecycle;
    }

    if (
        typeof bootstrapHooksModule.registerLifecycle ===
        'function'
    ) {

        return bootstrapHooksModule.registerLifecycle;
    }

    if (
        typeof bootstrapHooksModule.register ===
        'function'
    ) {

        return bootstrapHooksModule.register;
    }

    return null;
}

function hasExistingHook(
    name =
        HOOK_NAME,
) {

    const registry =
        resolveHookRegistry();

    if (
        registry &&
        typeof registry.has ===
        'function'
    ) {

        try {

            return registry.has(
                name,
            );

        } catch {
            return false;
        }
    }

    return false;
}

/**
 * =============================================================================
 * Contract validation
 * =============================================================================
 */

function assertProvider() {

    const provider =
        getProvider();

    if (
        !provider
    ) {

        throw new ConfigurationHooksError(
            'TITech ConfigurationProvider is unavailable.',
            {
                code:
                    'CONFIGURATION_PROVIDER_UNAVAILABLE',
            },
        );
    }

    const requiredMethods = [
        'get',
        'has',
        'snapshot',
        'operationalSnapshot',
    ];

    const missing =
        requiredMethods.filter(
            method =>
                typeof provider[
                    method
                ] !==
                'function',
        );

    if (
        missing.length >
        0
    ) {

        throw new ConfigurationHooksError(
            'TITech ConfigurationProvider does not satisfy the lifecycle contract.',
            {
                code:
                    'CONFIGURATION_PROVIDER_CONTRACT_INVALID',

                details: {
                    missingMethods:
                        missing,
                },
            },
        );
    }

    return provider;
}

/**
 * =============================================================================
 * State snapshot
 * =============================================================================
 */

function getState() {

    return Object.freeze({

        component:
            COMPONENT,

        service:
            SERVICE_NAME,

        hook:
            HOOK_NAME,

        state,

        registered,

        started,

        stopped,

        failed,

        ready:
            (
                state ===
                    HOOK_STATES.READY ||
                state ===
                    HOOK_STATES.DEGRADED
            ) &&
            started &&
            !stopped &&
            !failed,

        lastError:
            lastError
                ? {
                    name:
                        lastError.name,

                    code:
                        lastError.code,

                    message:
                        lastError.message,
                }
                : null,

        lastStartAt,

        lastStopAt,
    });
}

/**
 * =============================================================================
 * Registration options
 * =============================================================================
 */

function normalizeOptions(
    options = {},
) {

    const priority =
        Number.isInteger(
            options.priority,
        )
            ? options.priority
            : DEFAULT_PRIORITY;

    const timeoutMs =
        Number.isInteger(
            options.timeoutMs,
        ) &&
        options.timeoutMs > 0
            ? options.timeoutMs
            : DEFAULT_TIMEOUT_MS;

    const dependencies =
        Array.isArray(
            options.dependencies,
        )
            ? [
                ...new Set(
                    options.dependencies
                        .map(
                            String,
                        )
                        .map(
                            value =>
                                value.trim(),
                        )
                        .filter(Boolean),
                ),
            ]
            : [
                ...DEFAULT_DEPENDENCIES,
            ];

    return Object.freeze({

        priority,

        timeoutMs,

        dependencies,

        enabled:
            options.enabled !==
            false,

        critical:
            options.critical !==
            false,

        metadata: {
            component:
                COMPONENT,

            service:
                SERVICE_NAME,

            provider:
                'backend/config/provider/ConfigurationProvider.js',

            adapter:
                'backend/config/provider/hooks.js',

            ...(
                options.metadata ||
                {}
            ),
        },
    });
}

/**
 * =============================================================================
 * Lifecycle start
 * =============================================================================
 */

async function startProvider(
    hookContext = {},
) {

    if (
        startPromise
    ) {

        return startPromise;
    }

    startPromise =
        (async () => {

            state =
                HOOK_STATES.STARTING;

            lastStartAt =
                new Date();

            try {

                const provider =
                    assertProvider();

                /**
                 * The canonical ConfigurationProvider already performs the
                 * synchronous configuration composition. Call initialize()
                 * here for lifecycle compatibility and idempotent completion.
                 */
                if (
                    typeof provider.initialize ===
                    'function'
                ) {

                    await provider.initialize();
                }

                /**
                 * Publish the provider and immutable configuration snapshot into
                 * the shared bootstrap context.
                 */
                if (
                    hookContext &&
                    typeof hookContext ===
                    'object'
                ) {

                    hookContext.configurationProvider =
                        provider;

                    hookContext.configProvider =
                        provider;

                    hookContext.configuration =
                        provider.configuration ||
                        provider.config ||
                        (
                            typeof provider.snapshot ===
                            'function'
                                ? provider.snapshot()
                                : {}
                        );

                    hookContext.config =
                        hookContext.configuration;
                }

                /**
                 * Configuration diagnostics are deliberately non-owning.
                 * They are started after the configuration provider becomes
                 * available.
                 */
                const diagnostics =
                    getDiagnostics();

                if (
                    diagnostics &&
                    typeof diagnostics.initialize ===
                    'function'
                ) {

                    try {

                        await diagnostics.initialize();

                        if (
                            hookContext &&
                            typeof hookContext ===
                            'object'
                        ) {

                            hookContext.configurationDiagnostics =
                                diagnostics;

                            hookContext.configDiagnostics =
                                diagnostics;
                        }

                    } catch (
                        error
                    ) {

                        /**
                         * Diagnostics should not destroy a valid configuration
                         * provider unless the lifecycle is explicitly marked
                         * critical by the caller.
                         */
                        log(
                            'warn',
                            {
                                phase:
                                    'diagnostics',

                                error: {
                                    name:
                                        error?.name,

                                    code:
                                        error?.code,

                                    message:
                                        error?.message,
                                },
                            },
                            'TITech configuration diagnostics initialization failed; configuration remains available.',
                        );
                    }
                }

                registered =
                    true;

                started =
                    true;

                stopped =
                    false;

                failed =
                    false;

                state =
                    HOOK_STATES.READY;

                lastError =
                    null;

                log(
                    'info',
                    {
                        state:
                            state,
                    },
                    'TITech configuration lifecycle started.',
                );

                return provider;

            } catch (
                error
            ) {

                failed =
                    true;

                started =
                    false;

                stopped =
                    false;

                state =
                    HOOK_STATES.FAILED;

                lastError =
                    error;

                throw wrapError(
                    error,
                    'CONFIGURATION_START_FAILED',
                    'startup',
                    'TITech configuration startup failed.',
                );
            }
        })();

    try {

        return await startPromise;

    } finally {

        if (
            failed
        ) {

            startPromise =
                null;
        }
    }
}

/**
 * =============================================================================
 * Lifecycle readiness
 * =============================================================================
 */

async function checkReadiness() {

    try {

        const provider =
            assertProvider();

        /**
         * Operational provider state.
         */
        const providerState =
            typeof provider.operationalSnapshot ===
            'function'
                ? provider.operationalSnapshot()
                : null;

        if (
            providerState?.state ===
            'invalid'
        ) {

            return false;
        }

        /**
         * Diagnostics readiness is supplemental and must not replace provider
         * configuration validity.
         */
        const diagnostics =
            getDiagnostics();

        if (
            diagnostics &&
            typeof diagnostics.readiness ===
            'function'
        ) {

            try {

                const diagnosticReadiness =
                    await diagnostics.readiness();

                if (
                    diagnosticReadiness?.ready ===
                    false
                ) {

                    state =
                        HOOK_STATES.DEGRADED;

                    return false;
                }

            } catch {
                state =
                    HOOK_STATES.DEGRADED;
            }
        }

        state =
            HOOK_STATES.READY;

        return true;

    } catch (
        error
    ) {

        lastError =
            error;

        state =
            HOOK_STATES.FAILED;

        failed =
            true;

        return false;
    }
}

/**
 * =============================================================================
 * Lifecycle health
 * =============================================================================
 */

async function checkHealth() {

    try {

        const provider =
            assertProvider();

        const diagnostics =
            getDiagnostics();

        let providerHealth =
            null;

        let diagnosticsHealth =
            null;

        if (
            typeof provider.operationalSnapshot ===
            'function'
        ) {

            providerHealth =
                provider.operationalSnapshot();
        }

        if (
            diagnostics &&
            typeof diagnostics.health ===
            'function'
        ) {

            try {

                diagnosticsHealth =
                    await diagnostics.health();

            } catch (
                error
            ) {

                diagnosticsHealth = {
                    status:
                        'degraded',

                    error: {
                        name:
                            error?.name,

                        code:
                            error?.code,

                        message:
                            error?.message,
                    },
                };
            }
        }

        const healthy =
            (
                !providerHealth ||
                (
                    providerHealth.state !==
                        'invalid' &&
                    providerHealth.state !==
                        'failed'
                )
            ) &&
            (
                !diagnosticsHealth ||
                diagnosticsHealth.status !==
                    'unhealthy'
            );

        if (
            healthy
        ) {

            state =
                HOOK_STATES.READY;

        } else {

            state =
                HOOK_STATES.DEGRADED;
        }

        return {
            status:
                healthy
                    ? 'healthy'
                    : 'degraded',

            healthy,

            component:
                COMPONENT,

            service:
                SERVICE_NAME,

            provider:
                providerHealth,

            diagnostics:
                diagnosticsHealth,

            timestamp:
                new Date().toISOString(),
        };

    } catch (
        error
    ) {

        lastError =
            error;

        state =
            HOOK_STATES.FAILED;

        return {
            status:
                'unhealthy',

            healthy:
                false,

            component:
                COMPONENT,

            service:
                SERVICE_NAME,

            error: {
                name:
                    error?.name,

                code:
                    error?.code,

                message:
                    error?.message,
            },

            timestamp:
                new Date().toISOString(),
        };
    }
}

/**
 * =============================================================================
 * Lifecycle stop
 * =============================================================================
 */

async function stopProvider() {

    if (
        stopPromise
    ) {

        return stopPromise;
    }

    stopPromise =
        (async () => {

            if (
                stopped
            ) {

                return true;
            }

            state =
                HOOK_STATES.STOPPING;

            try {

                const diagnostics =
                    getDiagnostics();

                if (
                    diagnostics &&
                    typeof diagnostics.shutdown ===
                    'function'
                ) {

                    try {

                        await diagnostics.shutdown();

                    } catch (
                        error
                    ) {

                        /**
                         * Configuration itself is immutable and does not own
                         * infrastructure resources. Diagnostics shutdown is
                         * therefore best-effort.
                         */
                        log(
                            'warn',
                            {
                                phase:
                                    'diagnostics-shutdown',

                                error: {
                                    name:
                                        error?.name,

                                    code:
                                        error?.code,

                                    message:
                                        error?.message,
                                },
                            },
                            'TITech configuration diagnostics shutdown encountered an error.',
                        );
                    }
                }

                started =
                    false;

                stopped =
                    true;

                failed =
                    false;

                state =
                    HOOK_STATES.STOPPED;

                lastStopAt =
                    new Date();

                log(
                    'info',
                    {
                        state:
                            state,
                    },
                    'TITech configuration lifecycle stopped.',
                );

                return true;

            } catch (
                error
            ) {

                failed =
                    true;

                stopped =
                    false;

                state =
                    HOOK_STATES.FAILED;

                lastError =
                    error;

                throw wrapError(
                    error,
                    'CONFIGURATION_STOP_FAILED',
                    'shutdown',
                    'TITech configuration shutdown failed.',
                );
            }
        })();

    return stopPromise;
}

/**
 * =============================================================================
 * Bootstrap lifecycle registration
 * ============================================================================= */

function registerConfigurationHooks(
    context = {},
    options = {},
) {

    assertProvider();

    if (
        registered &&
        registrationResult
    ) {

        return registrationResult;
    }

    const normalized =
        normalizeOptions(
            options,
        );

    /**
     * -------------------------------------------------------------------------
     * Existing hook protection.
     * -------------------------------------------------------------------------
     */

    if (
        hasExistingHook(
            HOOK_NAME,
        )
    ) {

        registered =
            true;

        state =
            HOOK_STATES.REGISTERED;

        const registry =
            resolveHookRegistry();

        if (
            registry &&
            typeof registry.get ===
            'function'
        ) {

            try {

                registrationResult =
                    registry.get(
                        HOOK_NAME,
                    );

                return registrationResult;

            } catch {
                // Fall through to local registration.
            }
        }

        return getState();
    }

    const lifecycleRegistrar =
        resolveLifecycleRegistrar();

    /**
     * -------------------------------------------------------------------------
     * No lifecycle module available.
     * -------------------------------------------------------------------------
     */

    if (
        typeof lifecycleRegistrar !==
        'function'
    ) {

        throw new ConfigurationHooksError(
            'TITech bootstrap lifecycle registrar is unavailable.',
            {
                code:
                    'BOOTSTRAP_LIFECYCLE_REGISTRAR_UNAVAILABLE',
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Register configuration lifecycle.
     * -------------------------------------------------------------------------
     */

    registrationResult =
        lifecycleRegistrar(
            HOOK_NAME,
            {
                priority:
                    normalized.priority,

                dependencies:
                    normalized.dependencies,

                timeoutMs:
                    normalized.timeoutMs,

                enabled:
                    normalized.enabled,

                critical:
                    normalized.critical,

                metadata:
                    normalized.metadata,

                /**
                 * -------------------------------------------------------------
                 * START
                 * -------------------------------------------------------------
                 */

                start:
                    async hookContext => {

                        return startProvider(
                            hookContext ||
                            context ||
                            {},
                        );
                    },

                /**
                 * -------------------------------------------------------------
                 * READY
                 * -------------------------------------------------------------
                 */

                ready:
                    async () =>
                        checkReadiness(),

                /**
                 * -------------------------------------------------------------
                 * HEALTH
                 * -------------------------------------------------------------
                 */

                health:
                    async () =>
                        checkHealth(),

                /**
                 * -------------------------------------------------------------
                 * STOP
                 * -------------------------------------------------------------
                 */

                stop:
                    async () =>
                        stopProvider(),
            },
        );

    registered =
        true;

    state =
        HOOK_STATES.REGISTERED;

    log(
        'info',
        {
            priority:
                normalized.priority,

            dependencies:
                normalized.dependencies,

            critical:
                normalized.critical,
        },
        'TITech configuration lifecycle hooks registered.',
    );

    return registrationResult;
}

/**
 * =============================================================================
 * Compatibility aliases
 * =============================================================================
 */

function registerBootstrapHooks(
    context = {},
    options = {},
) {

    return registerConfigurationHooks(
        context,
        options,
    );
}

function lifecycle(
    context = {},
    options = {},
) {

    return registerConfigurationHooks(
        context,
        options,
    );
}

/**
 * =============================================================================
 * Explicit lifecycle API
 * =============================================================================
 */

async function initialize(
    context = {},
) {

    assertProvider();

    if (
        started &&
        !stopped &&
        !failed
    ) {

        return getProvider();
    }

    return startProvider(
        context,
    );
}

async function shutdown() {

    return stopProvider();
}

async function health() {

    return checkHealth();
}

async function readiness() {

    const ready =
        await checkReadiness();

    return {
        ready,

        status:
            ready
                ? 'ready'
                : 'not_ready',

        state,

        component:
            COMPONENT,

        service:
            SERVICE_NAME,

        timestamp:
            new Date().toISOString(),
    };
}

/**
 * =============================================================================
 * Snapshot
 * ============================================================================= */

function snapshot() {

    const provider =
        getProvider();

    let providerSnapshot =
        null;

    let diagnosticsSnapshot =
        null;

    try {

        providerSnapshot =
            typeof provider?.operationalSnapshot ===
            'function'
                ? provider.operationalSnapshot()
                : typeof provider?.snapshot ===
                    'function'
                    ? provider.snapshot()
                    : null;

    } catch (
        error
    ) {

        providerSnapshot = {
            state:
                'invalid',

            error: {
                name:
                    error?.name,

                code:
                    error?.code,

                message:
                    error?.message,
            },
        };
    }

    try {

        const diagnostics =
            getDiagnostics();

        diagnosticsSnapshot =
            typeof diagnostics?.snapshot ===
            'function'
                ? diagnostics.snapshot()
                : null;

    } catch (
        error
    ) {

        diagnosticsSnapshot = {
            error: {
                name:
                    error?.name,

                code:
                    error?.code,

                message:
                    error?.message,
            },
        };
    }

    return Object.freeze({

        ...getState(),

        provider:
            providerSnapshot,

        diagnostics:
            diagnosticsSnapshot,

        timestamp:
            new Date().toISOString(),
    });
}

/**
 * =============================================================================
 * Error wrapper
 * ============================================================================= */

function wrapError(
    error,
    code,
    phase,
    message,
) {

    if (
        error instanceof
        ConfigurationHooksError
    ) {

        return error;
    }

    return new ConfigurationHooksError(
        message,
        {
            code,

            phase,

            cause:
                error,

            details: {
                originalError: {
                    name:
                        error?.name,

                    code:
                        error?.code,

                    message:
                        error?.message,
                },
            },
        },
    );
}

/**
 * =============================================================================
 * Reset
 * ============================================================================= */

function reset() {

    if (
        started &&
        !stopped
    ) {

        throw new ConfigurationHooksError(
            'Cannot reset active TITech configuration lifecycle hooks.',
            {
                code:
                    'CONFIGURATION_HOOKS_RESET_NOT_ALLOWED',
            },
        );
    }

    registered =
        false;

    started =
        false;

    stopped =
        false;

    failed =
        false;

    state =
        HOOK_STATES.CREATED;

    registrationResult =
        null;

    startPromise =
        null;

    stopPromise =
        null;

    lastError =
        null;

    lastStartAt =
        null;

    lastStopAt =
        null;

    return true;
}

/**
 * =============================================================================
 * Public API
 * =============================================================================
 */

module.exports =
    Object.freeze({

        /**
         * ---------------------------------------------------------------------
         * Constants.
         * ---------------------------------------------------------------------
         */

        COMPONENT,

        SERVICE_NAME,

        HOOK_NAME,

        HOOK_STATES,

        DEFAULT_PRIORITY,

        DEFAULT_TIMEOUT_MS,

        DEFAULT_DEPENDENCIES,

        /**
         * ---------------------------------------------------------------------
         * Errors.
         * ---------------------------------------------------------------------
         */

        ConfigurationHooksError,

        /**
         * ---------------------------------------------------------------------
         * Lifecycle registration.
         * ---------------------------------------------------------------------
         */

        registerConfigurationHooks,

        registerBootstrapHooks,

        lifecycle,

        /**
         * ---------------------------------------------------------------------
         * Explicit lifecycle.
         * ---------------------------------------------------------------------
         */

        initialize,

        start:
            initialize,

        shutdown,

        stop:
            shutdown,

        /**
         * ---------------------------------------------------------------------
         * Operational state.
         * ---------------------------------------------------------------------
         */

        getState,

        readiness,

        health,

        snapshot,

        isRegistered:
            () =>
                registered,

        isStarted:
            () =>
                started,

        isStopped:
            () =>
                stopped,

        isFailed:
            () =>
                failed,

        isReady:
            () =>
                (
                    started &&
                    !stopped &&
                    !failed &&
                    (
                        state ===
                            HOOK_STATES.READY ||
                        state ===
                            HOOK_STATES.DEGRADED
                    )
                ),

        /**
         * ---------------------------------------------------------------------
         * Reset/testing.
         * ---------------------------------------------------------------------
         */

        reset,

        /**
         * ---------------------------------------------------------------------
         * Provider access.
         * ---------------------------------------------------------------------
         */

        getProvider,
    });