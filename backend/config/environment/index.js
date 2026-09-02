'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/environment/index.js
 *
 * Purpose:
 *   Canonical enterprise environment subsystem facade.
 *
 * Responsibilities:
 *   - Provide one stable public entry point for the TITech environment layer.
 *   - Coordinate environment loading, validation, lifecycle state, diagnostics
 *     and immutable snapshots without duplicating their implementations.
 *   - Expose a consistent environment API to configuration/bootstrap consumers.
 *   - Enforce deterministic bootstrap semantics.
 *   - Prevent accidental mutation of environment state.
 *   - Provide readiness/health diagnostics.
 *   - Provide safe configuration/environment fingerprints.
 *   - Support explicit bootstrap, validation and snapshot workflows.
 *   - Preserve backward compatibility with existing environment consumers.
 *
 * IMPORTANT:
 *
 *   This file is the FACADE / COMPOSITION ROOT for:
 *
 *     backend/config/environment.js
 *     backend/config/bootstrapEnvironment.js
 *     backend/config/environment/bootstrapState.js
 *     backend/config/environment/diagnostics.js
 *     backend/config/environment/environmentSnapshot.js
 *     backend/config/environment/environmentValidator.js
 *
 *   It does NOT:
 *     - implement dotenv parsing.
 *     - implement environment variable validation rules.
 *     - mutate process.env.
 *     - create database connections.
 *     - create Redis clients.
 *     - initialize queues.
 *     - create Express applications.
 *     - start HTTP servers.
 *     - execute business logic.
 *     - execute financial transactions.
 *
 * =============================================================================
 *
 * Canonical environment architecture:
 *
 *   process.env
 *       │
 *       ▼
 *   environment.js
 *       │
 *       ├───────────────┐
 *       ▼               ▼
 *   validator       bootstrapEnvironment
 *                       │
 *                       ▼
 *                  bootstrapState
 *                       │
 *           ┌───────────┴───────────┐
 *           ▼                       ▼
 *      diagnostics            environmentSnapshot
 *           │                       │
 *           └───────────┬───────────┘
 *                       ▼
 *                environment/index.js
 *                       │
 *                       ▼
 *                config/index.js
 *
 * =============================================================================
 */

const process = require('node:process');

/**
 * =============================================================================
 * Canonical environment implementation
 * =============================================================================
 *
 * backend/config/environment.js may expose either:
 *
 *   module.exports = bootstrapFunction
 *
 * or:
 *
 *   module.exports = {
 *       bootstrapEnvironment,
 *       ...
 *   }
 *
 * This facade supports both patterns.
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
 * Canonical environment bootstrap adapter
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
 * Environment lifecycle state
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
 * Environment diagnostics
 * =============================================================================
 */

let diagnosticsModule = null;

try {
    // eslint-disable-next-line global-require
    diagnosticsModule =
        require('./diagnostics');
} catch {
    diagnosticsModule = null;
}

/**
 * =============================================================================
 * Environment snapshot
 * =============================================================================
 */

let snapshotModule = null;

try {
    // eslint-disable-next-line global-require
    snapshotModule =
        require('./environmentSnapshot');
} catch {
    snapshotModule = null;
}

/**
 * =============================================================================
 * Environment validator
 * =============================================================================
 */

let validatorModule = null;

try {
    // eslint-disable-next-line global-require
    validatorModule =
        require('./environmentValidator');
} catch {
    validatorModule = null;
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
    'environment';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

const VERSION =
    '1.0.0';

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

const ENVIRONMENT_STATES =
    Object.freeze({
        CREATED:
            'created',

        BOOTSTRAPPING:
            'bootstrapping',

        READY:
            'ready',

        DEGRADED:
            'degraded',

        FAILED:
            'failed',

        STOPPED:
            'stopped',
    });

const DEFAULTS =
    Object.freeze({
        environment:
            process.env.NODE_ENV ||
            ENVIRONMENT_NAMES.DEVELOPMENT,

        strict:
            true,

        failClosed:
            true,

        validateOnBootstrap:
            true,

        diagnosticsOnBootstrap:
            true,

        snapshotOnBootstrap:
            true,

        allowWarnings:
            true,
    });

/**
 * =============================================================================
 * Error
 * =============================================================================
 */

class EnvironmentFacadeError extends Error {
    constructor(
        message,
        options = {},
    ) {
        super(message);

        this.name =
            'EnvironmentFacadeError';

        this.code =
            options.code ||
            'ENVIRONMENT_FACADE_ERROR';

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
            EnvironmentFacadeError,
        );
    }
}

/**
 * =============================================================================
 * Runtime state
 * =============================================================================
 */

let state =
    ENVIRONMENT_STATES.CREATED;

let bootstrapPromise =
    null;

let shutdownPromise =
    null;

let bootstrappedAt =
    null;

let failedAt =
    null;

let stoppedAt =
    null;

let lastError =
    null;

let lastValidation =
    null;

let lastDiagnostics =
    null;

let lastSnapshot =
    null;

/**
 * =============================================================================
 * Utilities
 * =============================================================================
 */

function normalizeEnvironment(
    value,
) {
    return String(
        value ||
        DEFAULTS.environment,
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
        // Environment composition must not fail because logging failed.
    }
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
            // Continue with recursive clone.
        }
    }

    if (
        Array.isArray(value)
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
            ] of Object.entries(value)
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
        seen.has(value)
    ) {
        return value;
    }

    seen.add(value);

    for (
        const key of
        Reflect.ownKeys(value)
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

function safeError(
    error,
) {
    if (!error) {
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
            String(error),

        phase:
            error.phase ||
            null,
    };
}

/**
 * =============================================================================
 * Module resolution helpers
 * =============================================================================
 */

function resolveEnvironmentImplementation() {
    return environmentModule;
}

function resolveBootstrapEnvironment() {
    return (
        bootstrapEnvironmentModule
            ?.bootstrapEnvironment ||
        bootstrapEnvironmentModule
            ?.initialize ||
        bootstrapEnvironmentModule
            ?.start ||
        bootstrapEnvironmentModule
            ?.run ||
        (
            typeof bootstrapEnvironmentModule ===
            'function'
                ? bootstrapEnvironmentModule
                : null
        )
    );
}

function resolveBootstrapState() {
    if (!bootstrapStateModule) {
        return null;
    }

    return (
        bootstrapStateModule
            .bootstrapState ||
        bootstrapStateModule
    );
}

function resolveValidator() {
    if (!validatorModule) {
        return null;
    }

    return (
        validatorModule
            .environmentValidator ||
        validatorModule
    );
}

function resolveDiagnostics() {
    if (!diagnosticsModule) {
        return null;
    }

    return (
        diagnosticsModule
            .diagnostics ||
        diagnosticsModule
    );
}

function resolveSnapshot() {
    if (!snapshotModule) {
        return null;
    }

    return (
        snapshotModule
            .environmentSnapshot ||
        snapshotModule
    );
}

/**
 * =============================================================================
 * Canonical environment value resolution
 * =============================================================================
 */

function getEnvironmentValue(
    key,
    fallback = undefined,
) {
    /**
     * Prefer the canonical environment implementation when it exposes a
     * getter. Fall back to process.env.
     */
    const implementation =
        resolveEnvironmentImplementation();

    try {
        if (
            typeof implementation?.get ===
            'function'
        ) {
            return implementation.get(
                key,
                fallback,
            );
        }

        if (
            typeof implementation?.getEnv ===
            'function'
        ) {
            return implementation.getEnv(
                key,
                fallback,
            );
        }

        if (
            implementation?.ENVIRONMENT &&
            Object.prototype.hasOwnProperty.call(
                implementation.ENVIRONMENT,
                key,
            )
        ) {
            return implementation
                .ENVIRONMENT[key];
        }
    } catch {
        // Fall back to process.env.
    }

    return (
        process.env[key] ??
        fallback
    );
}

function getResolvedEnvironment() {
    return normalizeEnvironment(
        getEnvironmentValue(
            'NODE_ENV',
            DEFAULTS.environment,
        ),
    );
}

/**
 * =============================================================================
 * Bootstrap
 * =============================================================================
 */

async function bootstrap(
    options = {},
) {
    if (
        (
            state ===
                ENVIRONMENT_STATES.READY ||
            state ===
                ENVIRONMENT_STATES.DEGRADED
        ) &&
        !options.force
    ) {
        return getRuntimeSnapshot();
    }

    if (
        bootstrapPromise
    ) {
        return bootstrapPromise;
    }

    bootstrapPromise =
        (async () => {
            state =
                ENVIRONMENT_STATES.BOOTSTRAPPING;

            lastError =
                null;

            const environment =
                normalizeEnvironment(
                    options.environment ||
                    process.env.NODE_ENV ||
                    DEFAULTS.environment,
                );

            if (
                !isSupportedEnvironment(
                    environment,
                ) &&
                (
                    options.rejectUnknownEnvironment !==
                        false
                )
            ) {
                const error =
                    new EnvironmentFacadeError(
                        `Unsupported TITech environment "${environment}".`,
                        {
                            code:
                                'ENVIRONMENT_UNSUPPORTED',

                            phase:
                                'environment',

                            details: {
                                supported:
                                    SUPPORTED_ENVIRONMENTS,
                            },
                        },
                    );

                state =
                    ENVIRONMENT_STATES.FAILED;

                failedAt =
                    new Date();

                lastError =
                    error;

                throw error;
            }

            const bootstrapState =
                resolveBootstrapState();

            try {
                /**
                 * -------------------------------------------------------------
                 * Start canonical state first.
                 * -------------------------------------------------------------
                 */
                if (
                    bootstrapState &&
                    typeof bootstrapState.start ===
                        'function'
                ) {
                    try {
                        bootstrapState.start(
                            {
                                environment,
                                component:
                                    COMPONENT,
                            },
                        );
                    } catch (error) {
                        /**
                         * State transition conflicts should not be swallowed
                         * unless the state provider explicitly indicates that
                         * bootstrap is already active.
                         */
                        if (
                            !(
                                error?.code ===
                                'ENVIRONMENT_STATE_TRANSITION_INVALID'
                            )
                        ) {
                            throw error;
                        }
                    }
                }

                /**
                 * -------------------------------------------------------------
                 * Canonical environment bootstrap.
                 * -------------------------------------------------------------
                 */
                const bootstrapFunction =
                    resolveBootstrapEnvironment();

                let bootstrapResult =
                    null;

                if (
                    typeof bootstrapFunction ===
                    'function'
                ) {
                    bootstrapResult =
                        await bootstrapFunction(
                            {
                                ...options,

                                environment,

                                source:
                                    COMPONENT,
                            },
                        );
                }

                /**
                 * -------------------------------------------------------------
                 * Environment validation.
                 * -------------------------------------------------------------
                 */
                if (
                    (
                        options.validateOnBootstrap ??
                        DEFAULTS
                            .validateOnBootstrap
                    )
                ) {
                    const validator =
                        resolveValidator();

                    if (
                        validator &&
                        typeof validator.validateCurrent ===
                            'function'
                    ) {
                        lastValidation =
                            await validator.validateCurrent(
                                {
                                    throwOnError:
                                        options.failClosed ??
                                        DEFAULTS.failClosed,
                                },
                            );

                    } else if (
                        validator &&
                        typeof validator.validate ===
                            'function'
                    ) {
                        lastValidation =
                            await validator.validate(
                                process.env,
                                {
                                    throwOnError:
                                        options.failClosed ??
                                        DEFAULTS.failClosed,
                                },
                            );
                    }
                }

                /**
                 * -------------------------------------------------------------
                 * Snapshot.
                 * -------------------------------------------------------------
                 */
                if (
                    (
                        options.snapshotOnBootstrap ??
                        DEFAULTS.snapshotOnBootstrap
                    )
                ) {
                    const snapshot =
                        resolveSnapshot();

                    if (
                        snapshot &&
                        typeof snapshot.refresh ===
                            'function'
                    ) {
                        lastSnapshot =
                            await snapshot.refresh(
                                {
                                    source:
                                        SNAPSHOT_SOURCE_BOOTSTRAP,
                                },
                            );
                    } else if (
                        snapshot &&
                        typeof snapshot.capture ===
                            'function'
                    ) {
                        lastSnapshot =
                            await snapshot.capture(
                                {
                                    source:
                                        SNAPSHOT_SOURCE_BOOTSTRAP,
                                },
                            );
                    }
                }

                /**
                 * -------------------------------------------------------------
                 * Diagnostics.
                 * -------------------------------------------------------------
                 */
                if (
                    (
                        options.diagnosticsOnBootstrap ??
                        DEFAULTS
                            .diagnosticsOnBootstrap
                    )
                ) {
                    const diagnostics =
                        resolveDiagnostics();

                    if (
                        diagnostics &&
                        typeof diagnostics.run ===
                            'function'
                    ) {
                        lastDiagnostics =
                            await diagnostics.run(
                                {
                                    force:
                                        true,
                                },
                            );
                    } else if (
                        diagnostics &&
                        typeof diagnostics.initialize ===
                            'function'
                    ) {
                        await diagnostics.initialize();

                        lastDiagnostics =
                            typeof diagnostics.snapshot ===
                                'function'
                                ? diagnostics.snapshot()
                                : null;
                    }
                }

                /**
                 * -------------------------------------------------------------
                 * Final readiness state.
                 * -------------------------------------------------------------
                 */
                const validationFailed =
                    Boolean(
                        lastValidation &&
                        (
                            lastValidation.valid ===
                                false ||
                            lastValidation.status ===
                                'invalid'
                        ),
                    );

                if (
                    validationFailed
                ) {
                    state =
                        ENVIRONMENT_STATES.FAILED;

                    failedAt =
                        new Date();

                    const error =
                        new EnvironmentFacadeError(
                            'TITech environment validation failed during bootstrap.',
                            {
                                code:
                                    'ENVIRONMENT_VALIDATION_FAILED',

                                phase:
                                    'validation',

                                details: {
                                    validation:
                                        lastValidation,
                                },
                            },
                        );

                    lastError =
                        error;

                    throw error;
                }

                const degraded =
                    Boolean(
                        lastValidation &&
                        (
                            lastValidation.warnings?.length >
                                0 ||
                            lastValidation.status ===
                                'degraded'
                        ),
                    ) ||
                    Boolean(
                        lastDiagnostics &&
                        (
                            lastDiagnostics.status ===
                            'degraded'
                        ),
                    );

                state =
                    degraded
                        ? ENVIRONMENT_STATES.DEGRADED
                        : ENVIRONMENT_STATES.READY;

                bootstrappedAt =
                    new Date();

                /**
                 * Canonical lifecycle state completes last.
                 */
                if (
                    bootstrapState &&
                    typeof bootstrapState.complete ===
                        'function'
                ) {
                    try {
                        bootstrapState.complete(
                            {
                                environment,

                                degraded,

                                component:
                                    COMPONENT,
                            },
                        );
                    } catch (error) {
                        /**
                         * The facade already has authoritative readiness. A
                         * compatible bootstrap-state implementation should not
                         * invalidate a successful environment initialization.
                         */
                        log(
                            'warn',
                            {
                                error:
                                    safeError(
                                        error,
                                    ),
                            },
                            'TITech environment bootstrap state completion encountered a compatibility warning.',
                        );
                    }
                }

                log(
                    degraded
                        ? 'warn'
                        : 'info',
                    {
                        environment,
                        state,
                        degraded,
                    },
                    degraded
                        ? 'TITech environment bootstrap completed with warnings.'
                        : 'TITech environment bootstrap completed successfully.',
                );

                return getRuntimeSnapshot(
                    {
                        bootstrapResult,
                    },
                );
            } catch (error) {
                const normalizedError =
                    error instanceof
                    EnvironmentFacadeError
                        ? error
                        : new EnvironmentFacadeError(
                            'TITech environment bootstrap failed.',
                            {
                                code:
                                    error?.code ||
                                    'ENVIRONMENT_BOOTSTRAP_FAILED',

                                phase:
                                    error?.phase ||
                                    null,

                                cause:
                                    error,
                            },
                        );

                state =
                    ENVIRONMENT_STATES.FAILED;

                failedAt =
                    new Date();

                lastError =
                    normalizedError;

                if (
                    bootstrapState &&
                    typeof bootstrapState.fail ===
                        'function'
                ) {
                    try {
                        bootstrapState.fail(
                            normalizedError,
                            {
                                phase:
                                    normalizedError.phase ||
                                    'environment',
                            },
                        );
                    } catch {
                        // Preserve original bootstrap failure.
                    }
                }

                log(
                    'error',
                    {
                        state,

                        error:
                            safeError(
                                normalizedError,
                            ),
                    },
                    'TITech environment bootstrap failed.',
                );

                throw normalizedError;
            }
        })();

    try {
        return await bootstrapPromise;
    } finally {
        bootstrapPromise =
            null;
    }
}

/**
 * Compatibility aliases.
 */
const bootstrapEnvironment =
    bootstrap;

const initialize =
    bootstrap;

const start =
    bootstrap;

/**
 * =============================================================================
 * Shutdown
 * =============================================================================
 */

async function shutdown(
    options = {},
) {
    if (
        shutdownPromise
    ) {
        return shutdownPromise;
    }

    shutdownPromise =
        (async () => {
            if (
                state ===
                    ENVIRONMENT_STATES.STOPPED
            ) {
                return getRuntimeSnapshot();
            }

            const bootstrapState =
                resolveBootstrapState();

            try {
                /**
                 * Diagnostics stop first.
                 */
                const diagnostics =
                    resolveDiagnostics();

                if (
                    diagnostics &&
                    typeof diagnostics.shutdown ===
                        'function'
                ) {
                    try {
                        await diagnostics.shutdown();
                    } catch (error) {
                        log(
                            'warn',
                            {
                                error:
                                    safeError(
                                        error,
                                    ),
                            },
                            'TITech environment diagnostics shutdown encountered a warning.',
                        );
                    }
                }

                /**
                 * Snapshot is immutable and requires no shutdown.
                 */
                state =
                    ENVIRONMENT_STATES.STOPPED;

                stoppedAt =
                    new Date();

                if (
                    bootstrapState &&
                    typeof bootstrapState.stop ===
                        'function'
                ) {
                    try {
                        bootstrapState.stop(
                            {
                                reason:
                                    options.reason ||
                                    'shutdown',
                            },
                        );
                    } catch {
                        // Best effort.
                    }
                }

                log(
                    'info',
                    {
                        reason:
                            options.reason ||
                            'shutdown',
                    },
                    'TITech environment subsystem stopped.',
                );

                return getRuntimeSnapshot();
            } catch (error) {
                lastError =
                    error;

                state =
                    ENVIRONMENT_STATES.FAILED;

                throw error;
            }
        })();

    try {
        return await shutdownPromise;
    } finally {
        shutdownPromise =
            null;
    }
}

/**
 ==============================================================================
 * Validation
 * ==============================================================================
 */

async function validate(
    environment = process.env,
    options = {},
) {
    const validator =
        resolveValidator();

    if (
        !validator
    ) {
        throw new EnvironmentFacadeError(
            'TITech environment validator is unavailable.',
            {
                code:
                    'ENVIRONMENT_VALIDATOR_UNAVAILABLE',

                phase:
                    'validation',
            },
        );
    }

    if (
        typeof validator.validate ===
        'function'
    ) {
        lastValidation =
            await validator.validate(
                environment,
                options,
            );

        return lastValidation;
    }

    if (
        typeof validator.validateCurrent ===
        'function'
    ) {
        lastValidation =
            await validator.validateCurrent(
                options,
            );

        return lastValidation;
    }

    throw new EnvironmentFacadeError(
        'TITech environment validator does not expose a supported validation API.',
        {
            code:
                'ENVIRONMENT_VALIDATOR_CONTRACT_INVALID',
        },
    );
}

async function validateCurrent(
    options = {},
) {
    return validate(
        process.env,
        options,
    );
}

/**
 * =============================================================================
 * Snapshot
 * =============================================================================
 */

async function captureSnapshot(
    options = {},
) {
    const snapshot =
        resolveSnapshot();

    if (
        !snapshot
    ) {
        throw new EnvironmentFacadeError(
            'TITech environment snapshot provider is unavailable.',
            {
                code:
                    'ENVIRONMENT_SNAPSHOT_UNAVAILABLE',
            },
        );
    }

    if (
        options.refresh &&
        typeof snapshot.refresh ===
            'function'
    ) {
        lastSnapshot =
            await snapshot.refresh(
                options,
            );

        return lastSnapshot;
    }

    if (
        typeof snapshot.current ===
        'function'
    ) {
        lastSnapshot =
            await snapshot.current(
                options,
            );

        return lastSnapshot;
    }

    if (
        typeof snapshot.capture ===
        'function'
    ) {
        lastSnapshot =
            await snapshot.capture(
                options.source ||
                {},
            );

        return lastSnapshot;
    }

    throw new EnvironmentFacadeError(
        'TITech environment snapshot provider does not expose a supported capture API.',
        {
            code:
                'ENVIRONMENT_SNAPSHOT_CONTRACT_INVALID',
        },
    );
}

/**
 * =============================================================================
 * Diagnostics
 * =============================================================================
 */

async function diagnostics(
    options = {},
) {
    const implementation =
        resolveDiagnostics();

    if (
        !implementation
    ) {
        throw new EnvironmentFacadeError(
            'TITech environment diagnostics provider is unavailable.',
            {
                code:
                    'ENVIRONMENT_DIAGNOSTICS_UNAVAILABLE',
            },
        );
    }

    if (
        typeof implementation.run ===
        'function'
    ) {
        lastDiagnostics =
            await implementation.run(
                options,
            );

        return lastDiagnostics;
    }

    if (
        typeof implementation.initialize ===
        'function'
    ) {
        await implementation.initialize();

        if (
            typeof implementation.snapshot ===
            'function'
        ) {
            lastDiagnostics =
                implementation.snapshot();
        }

        return lastDiagnostics;
    }

    throw new EnvironmentFacadeError(
        'TITech environment diagnostics provider does not expose a supported API.',
        {
            code:
                'ENVIRONMENT_DIAGNOSTICS_CONTRACT_INVALID',
        },
    );
}

/**
 * =============================================================================
 * Readiness
 * =============================================================================
 */

async function readiness() {
    const validator =
        resolveValidator();

    const diagnosticsProvider =
        resolveDiagnostics();

    const bootstrapState =
        resolveBootstrapState();

    let validatorReadiness =
        null;

    let diagnosticReadiness =
        null;

    let stateReadiness =
        null;

    try {
        if (
            validator &&
            typeof validator.readiness ===
            'function'
        ) {
            validatorReadiness =
                validator.readiness();
        }
    } catch {
        validatorReadiness =
            null;
    }

    try {
        if (
            diagnosticsProvider &&
            typeof diagnosticsProvider.readiness ===
            'function'
        ) {
            diagnosticReadiness =
                await diagnosticsProvider.readiness();
        }
    } catch {
        diagnosticReadiness =
            null;
    }

    try {
        if (
            bootstrapState &&
            typeof bootstrapState.readiness ===
            'function'
        ) {
            stateReadiness =
                bootstrapState.readiness();
        }
    } catch {
        stateReadiness =
            null;
    }

    const facadeReady =
        (
            state ===
                ENVIRONMENT_STATES.READY ||
            state ===
                ENVIRONMENT_STATES.DEGRADED
        );

    const valid =
        !validatorReadiness ||
        validatorReadiness.ready !== false;

    const diagnosticsReady =
        !diagnosticReadiness ||
        diagnosticReadiness.ready !== false;

    const bootstrapStateReady =
        !stateReadiness ||
        stateReadiness.ready !== false;

    const ready =
        facadeReady &&
        valid &&
        diagnosticsReady &&
        bootstrapStateReady &&
        !lastError;

    return {
        status:
            ready
                ? state ===
                  ENVIRONMENT_STATES.DEGRADED
                    ? 'degraded'
                    : 'ready'
                : 'not_ready',

        ready,

        state,

        environment:
            getResolvedEnvironment(),

        validator:
            validatorReadiness,

        diagnostics:
            diagnosticReadiness,

        bootstrap:
            stateReadiness,

        timestamp:
            new Date().toISOString(),
    };
}

/**
 * =============================================================================
 * Health
 * =============================================================================
 */

async function health() {
    const readinessState =
        await readiness();

    let diagnosticHealth =
        null;

    const diagnosticsProvider =
        resolveDiagnostics();

    try {
        if (
            diagnosticsProvider &&
            typeof diagnosticsProvider.health ===
            'function'
        ) {
            diagnosticHealth =
                await diagnosticsProvider.health();
        }
    } catch (error) {
        diagnosticHealth = {
            status:
                'unhealthy',

            healthy:
                false,

            error:
                safeError(
                    error,
                ),
        };
    }

    const healthy =
        readinessState.ready &&
        (
            !diagnosticHealth ||
            diagnosticHealth.healthy !== false
        ) &&
        state !==
            ENVIRONMENT_STATES.FAILED;

    return {
        status:
            healthy
                ? readinessState.status ===
                  'degraded'
                    ? 'degraded'
                    : 'healthy'
                : 'unhealthy',

        healthy,

        degraded:
            healthy &&
            readinessState.status ===
                'degraded',

        state,

        environment:
            getResolvedEnvironment(),

        readiness:
            readinessState,

        diagnostics:
            diagnosticHealth,

        lastError:
            safeError(
                lastError,
            ),

        timestamps: {
            bootstrappedAt:
                bootstrappedAt,

            failedAt:
                failedAt,

            stoppedAt:
                stoppedAt,
        },

        timestamp:
            new Date().toISOString(),
    };
}

/**
 * =============================================================================
 * Runtime snapshot
 * =============================================================================
 */

function getRuntimeSnapshot(
    options = {},
) {
    const bootstrapState =
        resolveBootstrapState();

    const validator =
        resolveValidator();

    const diagnosticsProvider =
        resolveDiagnostics();

    const snapshot =
        resolveSnapshot();

    const stateSnapshot =
        bootstrapState &&
        typeof bootstrapState.snapshot ===
            'function'
            ? bootstrapState.snapshot(
                {
                    exposeHistory:
                        false,

                    exposeTransitions:
                        false,
                },
            )
            : null;

    const validationSnapshot =
        lastValidation ||
        (
            validator &&
            typeof validator.snapshot ===
                'function'
                ? validator.snapshot()
                : null
        );

    const diagnosticsSnapshot =
        lastDiagnostics ||
        (
            diagnosticsProvider &&
            typeof diagnosticsProvider.snapshot ===
                'function'
                ? diagnosticsProvider.snapshot()
                : null
        );

    const environmentSnapshot =
        lastSnapshot ||
        (
            snapshot &&
            typeof snapshot.getSnapshot ===
                'function'
                ? snapshot.getSnapshot(
                    {
                        exposeValues:
                            false,
                    },
                )
                : null
        );

    return deepFreeze({
        component:
            COMPONENT,

        service:
            SERVICE_NAME,

        application:
            APPLICATION_NAME,

        version:
            VERSION,

        environment:
            getResolvedEnvironment(),

        state,

        ready:
            (
                state ===
                    ENVIRONMENT_STATES.READY ||
                state ===
                    ENVIRONMENT_STATES.DEGRADED
            ),

        degraded:
            state ===
            ENVIRONMENT_STATES.DEGRADED,

        failed:
            state ===
            ENVIRONMENT_STATES.FAILED,

        stopped:
            state ===
            ENVIRONMENT_STATES.STOPPED,

        initialized:
            bootstrappedAt !==
            null,

        bootstrappedAt,

        failedAt,

        stoppedAt,

        lastError:
            safeError(
                lastError,
            ),

        validation:
            validationSnapshot,

        diagnostics:
            diagnosticsSnapshot,

        snapshot:
            environmentSnapshot,

        bootstrap:
            stateSnapshot,

        timestamp:
            new Date().toISOString(),

        source:
            options.bootstrapResult
                ? 'bootstrap'
                : 'runtime',
    });
}

/**
 * =============================================================================
 * Fingerprint
 * =============================================================================
 */

function getFingerprint() {
    const snapshot =
        resolveSnapshot();

    if (
        lastSnapshot
            ?.fingerprint
            ?.value
    ) {
        return lastSnapshot
            .fingerprint
            .value;
    }

    if (
        snapshot &&
        typeof snapshot.getFingerprint ===
        'function'
    ) {
        return snapshot.getFingerprint();
    }

    if (
        lastValidation
            ?.fingerprint
            ?.value
    ) {
        return lastValidation
            .fingerprint
            .value;
    }

    return null;
}

/**
 * =============================================================================
 * Environment access
 * =============================================================================
 */

function get(
    key,
    fallback,
) {
    return getEnvironmentValue(
        key,
        fallback,
    );
}

function has(
    key,
) {
    return (
        getEnvironmentValue(
            key,
            undefined,
        ) !== undefined
    );
}

function getAll(
    options = {},
) {
    const values = {};

    for (
        const key of Object.keys(
            process.env,
        )
    ) {
        if (
            options.includeValues ===
            true
        ) {
            values[key] =
                process.env[key];
        } else {
            values[key] =
                '[HIDDEN]';
        }
    }

    return deepFreeze(
        values,
    );
}

/**
 * =============================================================================
 * Lifecycle state
 * =============================================================================
 */

function getState() {
    return {
        component:
            COMPONENT,

        state,

        environment:
            getResolvedEnvironment(),

        ready:
            (
                state ===
                    ENVIRONMENT_STATES.READY ||
                state ===
                    ENVIRONMENT_STATES.DEGRADED
            ),

        degraded:
            state ===
            ENVIRONMENT_STATES.DEGRADED,

        failed:
            state ===
            ENVIRONMENT_STATES.FAILED,

        stopped:
            state ===
            ENVIRONMENT_STATES.STOPPED,

        initialized:
            bootstrappedAt !==
            null,

        bootstrappedAt,

        failedAt,

        stoppedAt,

        lastError:
            safeError(
                lastError,
            ),
    };
}

/**
 * =============================================================================
 * Reset
 * =============================================================================
 */

function reset() {
    if (
        bootstrapPromise ||
        shutdownPromise
    ) {
        throw new EnvironmentFacadeError(
            'Cannot reset TITech environment facade while a lifecycle operation is active.',
            {
                code:
                    'ENVIRONMENT_RESET_NOT_ALLOWED',
            },
        );
    }

    const bootstrapState =
        resolveBootstrapState();

    const validator =
        resolveValidator();

    const diagnosticsProvider =
        resolveDiagnostics();

    const snapshot =
        resolveSnapshot();

    state =
        ENVIRONMENT_STATES.CREATED;

    bootstrappedAt =
        null;

    failedAt =
        null;

    stoppedAt =
        null;

    lastError =
        null;

    lastValidation =
        null;

    lastDiagnostics =
        null;

    lastSnapshot =
        null;

    try {
        bootstrapState?.reset?.({
            preserveHistory:
                false,
        });
    } catch {
        // Test helper; facade state is reset regardless.
    }

    try {
        validator?.reset?.();
    } catch {
        // Test helper.
    }

    try {
        diagnosticsProvider?.reset?.();
    } catch {
        // Test helper.
    }

    try {
        snapshot?.reset?.();
    } catch {
        // Test helper.
    }

    return getState();
}

/**
 * =============================================================================
 * Bootstrap source constant
 * =============================================================================
 */

const SNAPSHOT_SOURCE_BOOTSTRAP =
    'environment-bootstrap';

/**
 * =============================================================================
 * Public API
 * =============================================================================
 */

module.exports =
    Object.freeze({
        /**
         * ---------------------------------------------------------------------
         * Identity
         * ---------------------------------------------------------------------
         */

        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        VERSION,

        ENVIRONMENT_NAMES,

        SUPPORTED_ENVIRONMENTS,

        ENVIRONMENT_STATES,

        DEFAULTS,

        EnvironmentFacadeError,

        /**
         * ---------------------------------------------------------------------
         * Canonical lifecycle
         * ---------------------------------------------------------------------
         */

        bootstrap,

        bootstrapEnvironment,

        initialize,

        start,

        shutdown,

        stop:
            shutdown,

        /**
         * ---------------------------------------------------------------------
         * Validation
         * ---------------------------------------------------------------------
         */

        validate,

        validateCurrent,

        /**
         * ---------------------------------------------------------------------
         * Snapshot
         * ---------------------------------------------------------------------
         */

        captureSnapshot,

        snapshot:
            captureSnapshot,

        getRuntimeSnapshot,

        getFingerprint,

        /**
         * ---------------------------------------------------------------------
         * Diagnostics
         * ---------------------------------------------------------------------
         */

        diagnostics,

        runDiagnostics:
            diagnostics,

        readiness,

        health,

        /**
         * ---------------------------------------------------------------------
         * Environment access
         * ---------------------------------------------------------------------
         */

        get,

        has,

        getAll,

        getEnvironment:
            getResolvedEnvironment,

        normalizeEnvironment,

        isSupportedEnvironment,

        isProduction,

        /**
         * ---------------------------------------------------------------------
         * Runtime state
         * ---------------------------------------------------------------------
         */

        getState,

        isReady:
            () =>
                (
                    state ===
                        ENVIRONMENT_STATES.READY ||
                    state ===
                        ENVIRONMENT_STATES.DEGRADED
                ),

        isHealthy:
            async () =>
                (
                    await health()
                ).healthy,

        isFailed:
            () =>
                state ===
                ENVIRONMENT_STATES.FAILED,

        isStopped:
            () =>
                state ===
                ENVIRONMENT_STATES.STOPPED,

        reset,
    });