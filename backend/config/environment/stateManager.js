'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/environment/stateManager.js
 *
 * Purpose:
 *   Enterprise production-grade environment lifecycle state manager.
 *
 * Responsibilities:
 *   - Own authoritative TITech environment lifecycle state.
 *   - Track environment bootstrap transitions.
 *   - Track initialization, readiness, degradation and failure.
 *   - Enforce valid state transitions.
 *   - Record phase and component state.
 *   - Track lifecycle timestamps and durations.
 *   - Maintain safe failure information.
 *   - Provide readiness and health projections.
 *   - Support concurrent bootstrap callers safely.
 *   - Provide immutable operational snapshots.
 *   - Support controlled recovery/reinitialization.
 *   - Support integration with bootstrapState.js and environment/index.js.
 *
 * IMPORTANT:
 *
 *   This module owns ENVIRONMENT STATE, not environment configuration itself.
 *
 *   It does NOT:
 *     - load dotenv files.
 *     - mutate process.env.
 *     - merge environment layers.
 *     - normalize values.
 *     - validate secrets.
 *     - connect MongoDB.
 *     - connect Redis.
 *     - initialize queues.
 *     - start Express.
 *     - start the HTTP server.
 *     - execute financial transactions.
 *
 * Related modules:
 *
 *   backend/config/environment.js
 *   backend/config/environment/bootstrapState.js
 *   backend/config/environment/index.js
 *   backend/config/environment/diagnostics.js
 *   backend/config/environment/environmentSnapshot.js
 *
 * =============================================================================
 *
 * Lifecycle:
 *
 *   CREATED
 *      ↓
 *   BOOTSTRAPPING
 *      ↓
 *   INITIALIZED
 *      ↓
 *   READY
 *      │
 *      ├──────────────→ DEGRADED
 *      │                    │
 *      └────────────────────┘
 *
 *   FAILED
 *      ↓
 *   RECOVERING
 *      ↓
 *   BOOTSTRAPPING
 *
 *   READY / DEGRADED
 *      ↓
 *   STOPPING
 *      ↓
 *   STOPPED
 *
 * =============================================================================
 */

const crypto =
    require('node:crypto');

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
    'environment-state-manager';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

const ENVIRONMENT_STATES =
    Object.freeze({
        CREATED:
            'created',

        BOOTSTRAPPING:
            'bootstrapping',

        INITIALIZED:
            'initialized',

        READY:
            'ready',

        DEGRADED:
            'degraded',

        FAILED:
            'failed',

        RECOVERING:
            'recovering',

        STOPPING:
            'stopping',

        STOPPED:
            'stopped',
    });

const ENVIRONMENT_PHASES =
    Object.freeze({
        DISCOVERY:
            'discovery',

        DOTENV:
            'dotenv',

        MERGING:
            'merging',

        PRECEDENCE:
            'precedence',

        NAMESPACE:
            'namespace',

        NORMALIZATION:
            'normalization',

        REQUIREMENTS:
            'requirements',

        VALIDATION:
            'validation',

        SNAPSHOT:
            'snapshot',

        DIAGNOSTICS:
            'diagnostics',

        COMPLETION:
            'completion',

        SHUTDOWN:
            'shutdown',
    });

const PHASE_STATES =
    Object.freeze({
        PENDING:
            'pending',

        RUNNING:
            'running',

        COMPLETED:
            'completed',

        DEGRADED:
            'degraded',

        FAILED:
            'failed',

        SKIPPED:
            'skipped',
    });

const EVENT_TYPES =
    Object.freeze({
        CREATED:
            'created',

        TRANSITION:
            'transition',

        PHASE_STARTED:
            'phase_started',

        PHASE_COMPLETED:
            'phase_completed',

        PHASE_FAILED:
            'phase_failed',

        READY:
            'ready',

        DEGRADED:
            'degraded',

        FAILED:
            'failed',

        RECOVERY_STARTED:
            'recovery_started',

        RECOVERY_COMPLETED:
            'recovery_completed',

        STOPPING:
            'stopping',

        STOPPED:
            'stopped',

        RESET:
            'reset',
    });

const DEFAULTS =
    Object.freeze({
        initialState:
            ENVIRONMENT_STATES.CREATED,

        maxHistory:
            250,

        maxPhaseHistory:
            250,

        maxErrors:
            100,

        maxTransitions:
            500,

        maxComponents:
            500,

        allowRecovery:
            true,

        allowReset:
            true,

        strictTransitions:
            true,

        strictPhases:
            true,

        degradedCountsAsReady:
            false,

        autoDegradeOnWarning:
            true,

        includeHistoryInSnapshot:
            false,

        includeTransitionsInSnapshot:
            false,

        includePhaseHistoryInSnapshot:
            false,

        fingerprintAlgorithm:
            'sha256',

        environment:
            process.env.NODE_ENV ||
            'development',
    });

/**
 * =============================================================================
 * Errors
 * =============================================================================
 */

class EnvironmentStateError extends Error {

    constructor(
        message,
        options = {},
    ) {

        super(
            message,
        );

        this.name =
            'EnvironmentStateError';

        this.code =
            options.code ||
            'ENVIRONMENT_STATE_ERROR';

        this.from =
            options.from ||
            null;

        this.to =
            options.to ||
            null;

        this.phase =
            options.phase ||
            null;

        this.componentName =
            options.componentName ||
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
            EnvironmentStateError,
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
            // Continue with recursive cloning.
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

function normalizeState(
    value,
) {

    return String(
        value ||
        DEFAULTS.initialState,
    )
        .trim()
        .toLowerCase();
}

function normalizePhase(
    value,
) {

    return String(
        value ||
        '',
    )
        .trim()
        .toLowerCase();
}

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

function normalizeComponentName(
    value,
) {

    return String(
        value ||
        '',
    )
        .trim();
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
    };
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

function monotonicDurationMs(
    startNs,
) {

    if (
        typeof startNs !==
        'bigint'
    ) {
        return 0;
    }

    return Number(
        process.hrtime.bigint() -
        startNs,
    ) / 1_000_000;
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
        // State transitions must remain independent of logging.
    }
}

/**
 * =============================================================================
 * State transition matrix
 * =============================================================================
 */

const TRANSITIONS =
    Object.freeze({
        [ENVIRONMENT_STATES.CREATED]:
            Object.freeze([
                ENVIRONMENT_STATES.BOOTSTRAPPING,
                ENVIRONMENT_STATES.STOPPING,
                ENVIRONMENT_STATES.STOPPED,
            ]),

        [ENVIRONMENT_STATES.BOOTSTRAPPING]:
            Object.freeze([
                ENVIRONMENT_STATES.INITIALIZED,
                ENVIRONMENT_STATES.READY,
                ENVIRONMENT_STATES.DEGRADED,
                ENVIRONMENT_STATES.FAILED,
                ENVIRONMENT_STATES.STOPPING,
            ]),

        [ENVIRONMENT_STATES.INITIALIZED]:
            Object.freeze([
                ENVIRONMENT_STATES.READY,
                ENVIRONMENT_STATES.DEGRADED,
                ENVIRONMENT_STATES.FAILED,
                ENVIRONMENT_STATES.STOPPING,
            ]),

        [ENVIRONMENT_STATES.READY]:
            Object.freeze([
                ENVIRONMENT_STATES.DEGRADED,
                ENVIRONMENT_STATES.RECOVERING,
                ENVIRONMENT_STATES.STOPPING,
                ENVIRONMENT_STATES.FAILED,
            ]),

        [ENVIRONMENT_STATES.DEGRADED]:
            Object.freeze([
                ENVIRONMENT_STATES.READY,
                ENVIRONMENT_STATES.RECOVERING,
                ENVIRONMENT_STATES.STOPPING,
                ENVIRONMENT_STATES.FAILED,
            ]),

        [ENVIRONMENT_STATES.FAILED]:
            Object.freeze([
                ENVIRONMENT_STATES.RECOVERING,
                ENVIRONMENT_STATES.BOOTSTRAPPING,
                ENVIRONMENT_STATES.STOPPING,
                ENVIRONMENT_STATES.STOPPED,
            ]),

        [ENVIRONMENT_STATES.RECOVERING]:
            Object.freeze([
                ENVIRONMENT_STATES.BOOTSTRAPPING,
                ENVIRONMENT_STATES.INITIALIZED,
                ENVIRONMENT_STATES.READY,
                ENVIRONMENT_STATES.DEGRADED,
                ENVIRONMENT_STATES.FAILED,
                ENVIRONMENT_STATES.STOPPING,
            ]),

        [ENVIRONMENT_STATES.STOPPING]:
            Object.freeze([
                ENVIRONMENT_STATES.STOPPED,
                ENVIRONMENT_STATES.FAILED,
            ]),

        [ENVIRONMENT_STATES.STOPPED]:
            Object.freeze([
                ENVIRONMENT_STATES.BOOTSTRAPPING,
                ENVIRONMENT_STATES.RECOVERING,
                ENVIRONMENT_STATES.STOPPING,
            ]),
    });

/**
 * =============================================================================
 * EnvironmentStateManager
 * =============================================================================
 */

class EnvironmentStateManager {

    constructor(
        options = {},
    ) {

        this.options =
            Object.freeze({
                ...DEFAULTS,
                ...options,
            });

        this.state =
            normalizeState(
                this.options.initialState,
            );

        this.environment =
            normalizeEnvironment(
                this.options.environment,
            );

        this.phase =
            null;

        this.phaseStates =
            new Map();

        this.components =
            new Map();

        this.errors =
            [];

        this.history =
            [];

        this.phaseHistory =
            [];

        this.transitions =
            [];

        this.startedAt =
            null;

        this.initializedAt =
            null;

        this.readyAt =
            null;

        this.degradedAt =
            null;

        this.failedAt =
            null;

        this.recoveryStartedAt =
            null;

        this.recoveryCompletedAt =
            null;

        this.stoppingAt =
            null;

        this.stoppedAt =
            null;

        this.lastTransitionAt =
            null;

        this.lastError =
            null;

        this.lastWarning =
            null;

        this.bootstrapAttempt =
            0;

        this.recoveryAttempt =
            0;

        this.active =
            false;

        this.ready =
            false;

        this.healthy =
            true;

        this.degraded =
            false;

        this.failed =
            false;

        this.stopped =
            false;

        this.version =
            0;

        this.createdAt =
            new Date();

        this._operationPromise =
            null;

        this.initializePhaseRegistry();

        this.recordEvent(
            EVENT_TYPES.CREATED,
            {
                state:
                    this.state,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Phase registry.
     * -------------------------------------------------------------------------
     */

    initializePhaseRegistry() {

        for (
            const phase of
            Object.values(
                ENVIRONMENT_PHASES,
            )
        ) {

            this.phaseStates.set(
                phase,
                {
                    phase,

                    status:
                        PHASE_STATES.PENDING,

                    startedAt:
                        null,

                    completedAt:
                        null,

                    durationMs:
                        null,

                    attempts:
                        0,

                    warning:
                        null,

                    error:
                        null,
                },
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * State getters.
     * -------------------------------------------------------------------------
     */

    getState() {

        return this.state;
    }

    is(
        state,
    ) {

        return (
            this.state ===
            normalizeState(
                state,
            )
        );
    }

    isReady() {

        return this.ready;
    }

    isHealthy() {

        return (
            this.healthy &&
            !this.failed
        );
    }

    isDegraded() {

        return this.degraded;
    }

    isFailed() {

        return this.failed;
    }

    isStopped() {

        return this.stopped;
    }

    isActive() {

        return this.active;
    }

    /**
     * -------------------------------------------------------------------------
     * Transition validation.
     * -------------------------------------------------------------------------
     */

    canTransitionTo(
        target,
    ) {

        const from =
            normalizeState(
                this.state,
            );

        const to =
            normalizeState(
                target,
            );

        if (
            from === to
        ) {
            return true;
        }

        return (
            TRANSITIONS[from] || []
        ).includes(
            to,
        );
    }

    assertTransition(
        target,
        metadata = {},
    ) {

        const from =
            normalizeState(
                this.state,
            );

        const to =
            normalizeState(
                target,
            );

        if (
            !Object.values(
                ENVIRONMENT_STATES,
            ).includes(
                to,
            )
        ) {

            throw new EnvironmentStateError(
                `Unknown TITech environment state "${to}".`,
                {
                    code:
                        'ENVIRONMENT_STATE_UNKNOWN',

                    from,

                    to,

                    details:
                        metadata,
                },
            );
        }

        if (
            from === to
        ) {
            return true;
        }

        if (
            !this.canTransitionTo(
                to,
            )
        ) {

            throw new EnvironmentStateError(
                `Invalid TITech environment state transition: ${from} → ${to}.`,
                {
                    code:
                        'ENVIRONMENT_STATE_TRANSITION_INVALID',

                    from,

                    to,

                    details:
                        metadata,
                },
            );
        }

        return true;
    }

    /**
     * -------------------------------------------------------------------------
     * Transition.
     * -------------------------------------------------------------------------
     */

    transition(
        target,
        metadata = {},
    ) {

        const to =
            normalizeState(
                target,
            );

        this.assertTransition(
            to,
            metadata,
        );

        const from =
            this.state;

        if (
            from ===
            to
        ) {
            return this.snapshot();
        }

        const now =
            new Date();

        this.state =
            to;

        this.lastTransitionAt =
            now;

        this.version +=
            1;

        this.applyStateFlags(
            to,
        );

        const record = {
            type:
                EVENT_TYPES.TRANSITION,

            from,

            to,

            reason:
                metadata.reason ||
                null,

            phase:
                metadata.phase ||
                this.phase,

            component:
                metadata.component ||
                null,

            timestamp:
                now.toISOString(),

            version:
                this.version,
        };

        this.transitions.push(
            record,
        );

        if (
            this.transitions.length >
            this.options.maxTransitions
        ) {
            this.transitions.shift();
        }

        this.recordEvent(
            EVENT_TYPES.TRANSITION,
            record,
        );

        return this.snapshot();
    }

    /**
     * -------------------------------------------------------------------------
     * Apply state flags.
     * -------------------------------------------------------------------------
     */

    applyStateFlags(
        state,
    ) {

        this.active =
            !(
                state ===
                    ENVIRONMENT_STATES.STOPPED
            );

        this.ready =
            (
                state ===
                    ENVIRONMENT_STATES.READY ||
                (
                    state ===
                        ENVIRONMENT_STATES.DEGRADED &&
                    this.options
                        .degradedCountsAsReady
                )
            );

        this.degraded =
            state ===
            ENVIRONMENT_STATES.DEGRADED;

        this.failed =
            state ===
            ENVIRONMENT_STATES.FAILED;

        this.stopped =
            state ===
            ENVIRONMENT_STATES.STOPPED;

        this.healthy =
            !this.failed;
    }

    /**
     * -------------------------------------------------------------------------
     * Bootstrap lifecycle.
     * -------------------------------------------------------------------------
     */

    startBootstrap(
        metadata = {},
    ) {

        if (
            this.state ===
                ENVIRONMENT_STATES.READY ||
            this.state ===
                ENVIRONMENT_STATES.DEGRADED
        ) {
            return this.snapshot();
        }

        if (
            this.state ===
            ENVIRONMENT_STATES.FAILED
        ) {

            if (
                !this.options
                    .allowRecovery
            ) {

                throw new EnvironmentStateError(
                    'TITech environment recovery is disabled.',
                    {
                        code:
                            'ENVIRONMENT_RECOVERY_DISABLED',
                    },
                );
            }

            this.startRecovery(
                metadata,
            );
        }

        this.bootstrapAttempt +=
            1;

        this.startedAt =
            this.startedAt ||
            new Date();

        this.stopped =
            false;

        this.failed =
            false;

        this.healthy =
            true;

        this.transition(
            ENVIRONMENT_STATES.BOOTSTRAPPING,
            {
                reason:
                    metadata.reason ||
                    'bootstrap-start',

                phase:
                    metadata.phase ||
                    ENVIRONMENT_PHASES
                        .DISCOVERY,

                component:
                    metadata.component ||
                    COMPONENT,
            },
        );

        return this.snapshot();
    }

    /**
     * -------------------------------------------------------------------------
     * Mark initialized.
     * -------------------------------------------------------------------------
     */

    markInitialized(
        metadata = {},
    ) {

        this.initializedAt =
            this.initializedAt ||
            new Date();

        this.transition(
            ENVIRONMENT_STATES.INITIALIZED,
            {
                reason:
                    metadata.reason ||
                    'bootstrap-initialized',

                phase:
                    metadata.phase ||
                    ENVIRONMENT_PHASES
                        .VALIDATION,

                component:
                    metadata.component ||
                    COMPONENT,
            },
        );

        return this.snapshot();
    }

    /**
     * -------------------------------------------------------------------------
     * Mark ready.
     * -------------------------------------------------------------------------
     */

    markReady(
        metadata = {},
    ) {

        this.initializedAt =
            this.initializedAt ||
            new Date();

        this.readyAt =
            new Date();

        this.failed =
            false;

        this.degraded =
            false;

        this.healthy =
            true;

        this.transition(
            ENVIRONMENT_STATES.READY,
            {
                reason:
                    metadata.reason ||
                    'bootstrap-ready',

                phase:
                    metadata.phase ||
                    ENVIRONMENT_PHASES
                        .COMPLETION,

                component:
                    metadata.component ||
                    COMPONENT,
            },
        );

        this.recordEvent(
            EVENT_TYPES.READY,
            {
                reason:
                    metadata.reason ||
                    null,
            },
        );

        return this.snapshot();
    }

    /**
     * -------------------------------------------------------------------------
     * Mark degraded.
     * -------------------------------------------------------------------------
     */

    markDegraded(
        reason,
        metadata = {},
    ) {

        const warning =
            normalizeErrorLike(
                reason,
            );

        this.lastWarning =
            warning;

        this.degradedAt =
            new Date();

        this.healthy =
            true;

        this.failed =
            false;

        this.recordWarning(
            warning,
        );

        this.transition(
            ENVIRONMENT_STATES.DEGRADED,
            {
                reason:
                    metadata.reason ||
                    warning.message ||
                    'environment-degraded',

                phase:
                    metadata.phase ||
                    this.phase,

                component:
                    metadata.component ||
                    COMPONENT,
            },
        );

        this.recordEvent(
            EVENT_TYPES.DEGRADED,
            {
                reason:
                    warning.message,

                code:
                    warning.code,
            },
        );

        return this.snapshot();
    }

    /**
     * -------------------------------------------------------------------------
     * Mark failed.
     * -------------------------------------------------------------------------
     */

    markFailed(
        error,
        metadata = {},
    ) {

        const normalized =
            normalizeErrorLike(
                error,
            );

        this.lastError =
            normalized;

        this.failedAt =
            new Date();

        this.healthy =
            false;

        this.failed =
            true;

        this.ready =
            false;

        this.recordError(
            normalized,
        );

        this.transition(
            ENVIRONMENT_STATES.FAILED,
            {
                reason:
                    metadata.reason ||
                    normalized.message ||
                    'environment-failed',

                phase:
                    metadata.phase ||
                    this.phase,

                component:
                    metadata.component ||
                    COMPONENT,
            },
        );

        this.recordEvent(
            EVENT_TYPES.FAILED,
            {
                code:
                    normalized.code,

                message:
                    normalized.message,
            },
        );

        return this.snapshot();
    }

    /**
     * -------------------------------------------------------------------------
     * Recovery.
     * -------------------------------------------------------------------------
     */

    startRecovery(
        metadata = {},
    ) {

        if (
            !this.options
                .allowRecovery
        ) {

            throw new EnvironmentStateError(
                'TITech environment recovery is disabled.',
                {
                    code:
                        'ENVIRONMENT_RECOVERY_DISABLED',
                },
            );
        }

        this.recoveryAttempt +=
            1;

        this.recoveryStartedAt =
            new Date();

        this.transition(
            ENVIRONMENT_STATES.RECOVERING,
            {
                reason:
                    metadata.reason ||
                    'environment-recovery-start',

                phase:
                    metadata.phase ||
                    ENVIRONMENT_PHASES
                        .DISCOVERY,

                component:
                    metadata.component ||
                    COMPONENT,
            },
        );

        this.recordEvent(
            EVENT_TYPES.RECOVERY_STARTED,
            {
                attempt:
                    this.recoveryAttempt,
            },
        );

        return this.snapshot();
    }

    markRecoveryCompleted(
        metadata = {},
    ) {

        this.recoveryCompletedAt =
            new Date();

        this.recordEvent(
            EVENT_TYPES.RECOVERY_COMPLETED,
            {
                attempt:
                    this.recoveryAttempt,

                durationMs:
                    this.recoveryStartedAt
                        ? this.recoveryCompletedAt
                            .getTime() -
                          this.recoveryStartedAt
                            .getTime()
                        : 0,
            },
        );

        return this.snapshot();
    }

    /**
     * -------------------------------------------------------------------------
     * Shutdown.
     * -------------------------------------------------------------------------
     */

    startShutdown(
        metadata = {},
    ) {

        this.stoppingAt =
            new Date();

        this.ready =
            false;

        this.transition(
            ENVIRONMENT_STATES.STOPPING,
            {
                reason:
                    metadata.reason ||
                    'environment-shutdown',

                phase:
                    ENVIRONMENT_PHASES
                        .SHUTDOWN,

                component:
                    metadata.component ||
                    COMPONENT,
            },
        );

        this.recordEvent(
            EVENT_TYPES.STOPPING,
            {
                reason:
                    metadata.reason ||
                    null,
            },
        );

        return this.snapshot();
    }

    markStopped(
        metadata = {},
    ) {

        this.stoppedAt =
            new Date();

        this.ready =
            false;

        this.active =
            false;

        this.healthy =
            true;

        this.stopped =
            true;

        this.transition(
            ENVIRONMENT_STATES.STOPPED,
            {
                reason:
                    metadata.reason ||
                    'environment-stopped',

                phase:
                    ENVIRONMENT_PHASES
                        .SHUTDOWN,

                component:
                    metadata.component ||
                    COMPONENT,
            },
        );

        this.recordEvent(
            EVENT_TYPES.STOPPED,
            {
                reason:
                    metadata.reason ||
                    null,
            },
        );

        return this.snapshot();
    }

    /**
     * -------------------------------------------------------------------------
     * Phase start.
     * -------------------------------------------------------------------------
     */

    startPhase(
        phase,
        metadata = {},
    ) {

        const normalized =
            normalizePhase(
                phase,
            );

        if (
            !Object.values(
                ENVIRONMENT_PHASES,
            ).includes(
                normalized,
            )
        ) {

            throw new EnvironmentStateError(
                `Unknown TITech environment phase "${normalized}".`,
                {
                    code:
                        'ENVIRONMENT_PHASE_UNKNOWN',

                    phase:
                        normalized,
                },
            );
        }

        if (
            this.phase &&
            this.phase !== normalized
        ) {
            const current =
                this.phaseStates.get(
                    this.phase,
                );

            if (
                current &&
                current.status ===
                    PHASE_STATES.RUNNING
            ) {

                if (
                    this.options
                        .strictPhases
                ) {

                    throw new EnvironmentStateError(
                        `Environment phase "${this.phase}" is still running.`,
                        {
                            code:
                                'ENVIRONMENT_PHASE_ALREADY_RUNNING',

                            phase:
                                this.phase,
                        },
                    );
                }
            }
        }

        const current =
            this.phaseStates.get(
                normalized,
            );

        const now =
            new Date();

        current.status =
            PHASE_STATES.RUNNING;

        current.startedAt =
            now;

        current.completedAt =
            null;

        current.durationMs =
            null;

        current.attempts +=
            1;

        current.warning =
            null;

        current.error =
            null;

        this.phase =
            normalized;

        this.recordPhaseEvent(
            EVENT_TYPES.PHASE_STARTED,
            {
                phase:
                    normalized,

                attempt:
                    current.attempts,

                reason:
                    metadata.reason ||
                    null,

                component:
                    metadata.component ||
                    COMPONENT,
            },
        );

        return this.getPhase(
            normalized,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Phase completion.
     * -------------------------------------------------------------------------
     */

    completePhase(
        phase,
        metadata = {},
    ) {

        const normalized =
            normalizePhase(
                phase,
            );

        const current =
            this.requirePhase(
                normalized,
            );

        if (
            current.status !==
            PHASE_STATES.RUNNING
        ) {

            if (
                this.options
                    .strictPhases
            ) {

                throw new EnvironmentStateError(
                    `TITech environment phase "${normalized}" is not running.`,
                    {
                        code:
                            'ENVIRONMENT_PHASE_NOT_RUNNING',

                        phase:
                            normalized,
                    },
                );
            }
        }

        const now =
            new Date();

        current.status =
            metadata.degraded
                ? PHASE_STATES.DEGRADED
                : PHASE_STATES.COMPLETED;

        current.completedAt =
            now;

        current.durationMs =
            current.startedAt
                ? now.getTime() -
                  current.startedAt.getTime()
                : null;

        current.warning =
            metadata.warning ||
            null;

        if (
            metadata.degraded
        ) {

            this.lastWarning =
                normalizeErrorLike(
                    metadata.warning ||
                    'Environment phase completed with warnings.',
                );

            if (
                this.options
                    .autoDegradeOnWarning
            ) {

                if (
                    this.state !==
                        ENVIRONMENT_STATES.DEGRADED &&
                    this.state !==
                        ENVIRONMENT_STATES.FAILED &&
                    this.state !==
                        ENVIRONMENT_STATES.STOPPING &&
                    this.state !==
                        ENVIRONMENT_STATES.STOPPED
                ) {

                    this.markDegraded(
                        this.lastWarning,
                        {
                            phase:
                                normalized,

                            reason:
                                'phase-degraded',
                        },
                    );
                }
            }
        }

        this.recordPhaseEvent(
            EVENT_TYPES.PHASE_COMPLETED,
            {
                phase:
                    normalized,

                durationMs:
                    current.durationMs,

                degraded:
                    Boolean(
                        metadata.degraded,
                    ),

                component:
                    metadata.component ||
                    COMPONENT,
            },
        );

        return this.getPhase(
            normalized,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Phase failure.
     * -------------------------------------------------------------------------
     */

    failPhase(
        phase,
        error,
        metadata = {},
    ) {

        const normalizedPhase =
            normalizePhase(
                phase,
            );

        const phaseState =
            this.requirePhase(
                normalizedPhase,
            );

        const normalizedError =
            normalizeErrorLike(
                error,
            );

        const now =
            new Date();

        phaseState.status =
            PHASE_STATES.FAILED;

        phaseState.completedAt =
            now;

        phaseState.durationMs =
            phaseState.startedAt
                ? now.getTime() -
                  phaseState.startedAt.getTime()
                : null;

        phaseState.error =
            normalizedError;

        this.recordPhaseEvent(
            EVENT_TYPES.PHASE_FAILED,
            {
                phase:
                    normalizedPhase,

                error:
                    normalizedError,

                durationMs:
                    phaseState.durationMs,

                component:
                    metadata.component ||
                    COMPONENT,
            },
        );

        this.markFailed(
            normalizedError,
            {
                phase:
                    normalizedPhase,

                reason:
                    metadata.reason ||
                    normalizedError.message,

                component:
                    metadata.component ||
                    COMPONENT,
            },
        );

        return this.getPhase(
            normalizedPhase,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Skip phase.
     * -------------------------------------------------------------------------
     */

    skipPhase(
        phase,
        reason = null,
    ) {

        const normalized =
            normalizePhase(
                phase,
            );

        const current =
            this.requirePhase(
                normalized,
            );

        current.status =
            PHASE_STATES.SKIPPED;

        current.completedAt =
            new Date();

        current.durationMs =
            0;

        current.warning =
            reason
                ? normalizeErrorLike(
                    reason,
                )
                : null;

        this.recordPhaseEvent(
            EVENT_TYPES.PHASE_COMPLETED,
            {
                phase:
                    normalized,

                skipped:
                    true,

                reason:
                    current.warning,

                component:
                    COMPONENT,
            },
        );

        return this.getPhase(
            normalized,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Phase access.
     * -------------------------------------------------------------------------
     */

    requirePhase(
        phase,
    ) {

        const normalized =
            normalizePhase(
                phase,
            );

        const state =
            this.phaseStates.get(
                normalized,
            );

        if (
            !state
        ) {

            throw new EnvironmentStateError(
                `TITech environment phase "${normalized}" does not exist.`,
                {
                    code:
                        'ENVIRONMENT_PHASE_NOT_REGISTERED',

                    phase:
                        normalized,
                },
            );
        }

        return state;
    }

    getPhase(
        phase,
    ) {

        return clone(
            this.requirePhase(
                phase,
            ),
        );
    }

    getPhaseStates() {

        return Object.fromEntries(
            [
                ...this.phaseStates.entries(),
            ].map(
                ([
                    name,
                    state,
                ]) => [
                    name,
                    clone(
                        state,
                    ),
                ],
            ),
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Component state.
     * -------------------------------------------------------------------------
     */

    registerComponent(
        name,
        metadata = {},
    ) {

        const componentName =
            normalizeComponentName(
                name,
            );

        if (
            !componentName
        ) {

            throw new EnvironmentStateError(
                'TITech environment component name is required.',
                {
                    code:
                        'ENVIRONMENT_COMPONENT_NAME_REQUIRED',
                },
            );
        }

        if (
            !this.components.has(
                componentName,
            ) &&
            this.components.size >=
                this.options.maxComponents
        ) {

            throw new EnvironmentStateError(
                'TITech environment component limit exceeded.',
                {
                    code:
                        'ENVIRONMENT_COMPONENT_LIMIT_EXCEEDED',

                    componentName,
                },
            );
        }

        if (
            !this.components.has(
                componentName,
            )
        ) {

            this.components.set(
                componentName,
                {
                    name:
                        componentName,

                    state:
                        'pending',

                    healthy:
                        true,

                    ready:
                        false,

                    startedAt:
                        null,

                    readyAt:
                        null,

                    stoppedAt:
                        null,

                    durationMs:
                        null,

                    attempts:
                        0,

                    error:
                        null,

                    warning:
                        null,

                    metadata:
                        clone(
                            metadata,
                        ),

                    updatedAt:
                        new Date(),
                },
            );
        } else {

            const current =
                this.components.get(
                    componentName,
                );

            current.metadata = {
                ...current.metadata,
                ...clone(
                    metadata,
                ),
            };

            current.updatedAt =
                new Date();
        }

        return this.getComponent(
            componentName,
        );
    }

    setComponentState(
        name,
        componentState,
        metadata = {},
    ) {

        const componentName =
            normalizeComponentName(
                name,
            );

        const component =
            this.components.get(
                componentName,
            ) ||
            this.registerComponent(
                componentName,
            );

        const state =
            String(
                componentState ||
                '',
            )
                .trim()
                .toLowerCase();

        const now =
            new Date();

        component.state =
            state;

        component.updatedAt =
            now;

        if (
            state ===
            'starting'
        ) {

            component.attempts +=
                1;

            component.startedAt =
                now;

            component.ready =
                false;

            component.healthy =
                true;

        } else if (
            state ===
                'ready' ||
            state ===
                'healthy'
        ) {

            component.ready =
                true;

            component.healthy =
                true;

            component.readyAt =
                now;

            component.error =
                null;

            component.durationMs =
                component.startedAt
                    ? now.getTime() -
                      component.startedAt
                          .getTime()
                    : null;

        } else if (
            state ===
                'degraded'
        ) {

            component.ready =
                false;

            component.healthy =
                true;

            component.warning =
                metadata.warning
                    ? normalizeErrorLike(
                        metadata.warning,
                    )
                    : null;

        } else if (
            state ===
                'failed'
        ) {

            component.ready =
                false;

            component.healthy =
                false;

            component.error =
                metadata.error
                    ? normalizeErrorLike(
                        metadata.error,
                    )
                    : null;

        } else if (
            state ===
            'stopping'
        ) {

            component.ready =
                false;

        } else if (
            state ===
                'stopped'
        ) {

            component.ready =
                false;

            component.stoppedAt =
                now;
        }

        if (
            metadata.metadata
        ) {

            component.metadata = {
                ...component.metadata,
                ...clone(
                    metadata.metadata,
                ),
            };
        }

        return this.getComponent(
            componentName,
        );
    }

    markComponentReady(
        name,
        metadata = {},
    ) {

        return this.setComponentState(
            name,
            'ready',
            metadata,
        );
    }

    markComponentFailed(
        name,
        error,
        metadata = {},
    ) {

        return this.setComponentState(
            name,
            'failed',
            {
                ...metadata,

                error,
            },
        );
    }

    markComponentDegraded(
        name,
        warning,
        metadata = {},
    ) {

        return this.setComponentState(
            name,
            'degraded',
            {
                ...metadata,

                warning,
            },
        );
    }

    markComponentStopped(
        name,
        metadata = {},
    ) {

        return this.setComponentState(
            name,
            'stopped',
            metadata,
        );
    }

    getComponent(
        name,
    ) {

        const component =
            this.components.get(
                normalizeComponentName(
                    name,
                ),
            );

        return component
            ? clone(
                component,
            )
            : null;
    }

    getComponents() {

        return Object.fromEntries(
            [
                ...this.components.entries(),
            ].map(
                ([
                    name,
                    component,
                ]) => [
                    name,
                    clone(
                        component,
                    ),
                ],
            ),
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Error/warning storage.
     * -------------------------------------------------------------------------
     */

    recordError(
        error,
    ) {

        const normalized =
            normalizeErrorLike(
                error,
            );

        this.errors.unshift(
            normalized,
        );

        if (
            this.errors.length >
            this.options.maxErrors
        ) {
            this.errors.length =
                this.options.maxErrors;
        }

        return clone(
            normalized,
        );
    }

    recordWarning(
        warning,
    ) {

        const normalized =
            normalizeErrorLike(
                warning,
            );

        this.lastWarning =
            normalized;

        return clone(
            normalized,
        );
    }

    getErrors() {

        return this.errors.map(
            clone,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Generic event history.
     * -------------------------------------------------------------------------
     */

    recordEvent(
        type,
        payload = {},
    ) {

        const record = {
            type,

            timestamp:
                new Date().toISOString(),

            state:
                this.state,

            phase:
                this.phase,

            payload:
                clone(
                    payload,
                ),

            version:
                this.version,
        };

        this.history.unshift(
            record,
        );

        if (
            this.history.length >
            this.options.maxHistory
        ) {
            this.history.length =
                this.options.maxHistory;
        }

        return clone(
            record,
        );
    }

    recordPhaseEvent(
        type,
        payload = {},
    ) {

        const record = {
            type,

            timestamp:
                new Date().toISOString(),

            state:
                this.state,

            phase:
                this.phase,

            payload:
                clone(
                    payload,
                ),

            version:
                this.version,
        };

        this.phaseHistory.unshift(
            record,
        );

        if (
            this.phaseHistory.length >
            this.options.maxPhaseHistory
        ) {
            this.phaseHistory.length =
                this.options.maxPhaseHistory;
        }

        this.recordEvent(
            type,
            payload,
        );

        return clone(
            record,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Current phase helpers.
     * -------------------------------------------------------------------------
     */

    setCurrentPhase(
        phase,
    ) {

        const normalized =
            normalizePhase(
                phase,
            );

        if (
            normalized &&
            !Object.values(
                ENVIRONMENT_PHASES,
            ).includes(
                normalized,
            )
        ) {

            throw new EnvironmentStateError(
                `Unknown TITech environment phase "${normalized}".`,
                {
                    code:
                        'ENVIRONMENT_PHASE_UNKNOWN',

                    phase:
                        normalized,
                },
            );
        }

        this.phase =
            normalized ||
            null;

        return this.phase;
    }

    getCurrentPhase() {

        return this.phase;
    }

    /**
     * -------------------------------------------------------------------------
     * Readiness calculation.
     * -------------------------------------------------------------------------
     */

    getReadinessState(
        options = {},
    ) {

        const degradedCountsAsReady =
            options
                .degradedCountsAsReady ??
            this.options
                .degradedCountsAsReady;

        const ready =
            (
                this.state ===
                    ENVIRONMENT_STATES.READY ||
                (
                    this.state ===
                        ENVIRONMENT_STATES.DEGRADED &&
                    degradedCountsAsReady
                )
            ) &&
            !this.failed &&
            !this.stopped;

        const phaseSummary =
            this.summarizePhases();

        const componentSummary =
            this.summarizeComponents();

        return {
            status:
                ready
                    ? (
                        this.state ===
                            ENVIRONMENT_STATES
                                .DEGRADED
                            ? 'degraded'
                            : 'ready'
                    )
                    : 'not_ready',

            ready,

            state:
                this.state,

            phase:
                this.phase,

            environment:
                this.environment,

            failed:
                this.failed,

            degraded:
                this.degraded,

            stopped:
                this.stopped,

            active:
                this.active,

            phaseSummary,

            componentSummary,

            errorCount:
                this.errors.length,

            timestamp:
                new Date().toISOString(),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Health calculation.
     * -------------------------------------------------------------------------
     */

    getHealthState() {

        const readiness =
            this.getReadinessState();

        const componentSummary =
            this.summarizeComponents();

        const healthy =
            !this.failed &&
            !this.stopped &&
            componentSummary
                .failed ===
                0;

        return {
            status:
                healthy
                    ? this.degraded
                        ? 'degraded'
                        : 'healthy'
                    : 'unhealthy',

            healthy,

            degraded:
                this.degraded,

            state:
                this.state,

            environment:
                this.environment,

            phase:
                this.phase,

            readiness,

            componentSummary,

            errorCount:
                this.errors.length,

            lastError:
                clone(
                    this.lastError,
                ),

            lastWarning:
                clone(
                    this.lastWarning,
                ),

            timestamp:
                new Date().toISOString(),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Phase summary.
     * -------------------------------------------------------------------------
     */

    summarizePhases() {

        const summary = {
            total:
                this.phaseStates.size,

            pending:
                0,

            running:
                0,

            completed:
                0,

            degraded:
                0,

            failed:
                0,

            skipped:
                0,
        };

        for (
            const state of
            this.phaseStates.values()
        ) {

            if (
                Object.prototype.hasOwnProperty.call(
                    summary,
                    state.status,
                )
            ) {

                summary[
                    state.status
                ] += 1;
            }
        }

        return summary;
    }

    /**
     * -------------------------------------------------------------------------
     * Component summary.
     * -------------------------------------------------------------------------
     */

    summarizeComponents() {

        const summary = {
            total:
                this.components.size,

            pending:
                0,

            starting:
                0,

            ready:
                0,

            healthy:
                0,

            degraded:
                0,

            failed:
                0,

            stopping:
                0,

            stopped:
                0,
        };

        for (
            const component of
            this.components.values()
        ) {

            if (
                Object.prototype.hasOwnProperty.call(
                    summary,
                    component.state,
                )
            ) {

                summary[
                    component.state
                ] += 1;
            }

            if (
                component.healthy
            ) {
                summary.healthy +=
                    1;
            }
        }

        return summary;
    }

    /**
     * -------------------------------------------------------------------------
     * Duration helpers.
     * -------------------------------------------------------------------------
     */

    getBootstrapDurationMs() {

        if (
            !this.startedAt
        ) {
            return null;
        }

        const end =
            this.stoppedAt ||
            new Date();

        return Math.max(
            0,
            end.getTime() -
            this.startedAt.getTime(),
        );
    }

    getStartupToReadyDurationMs() {

        if (
            !this.startedAt ||
            !this.readyAt
        ) {
            return null;
        }

        return Math.max(
            0,
            this.readyAt.getTime() -
            this.startedAt.getTime(),
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Snapshot.
     * -------------------------------------------------------------------------
     */

    snapshot(
        options = {},
    ) {

        const includeHistory =
            options
                .includeHistory ??
            this.options
                .includeHistoryInSnapshot;

        const includeTransitions =
            options
                .includeTransitions ??
            this.options
                .includeTransitionsInSnapshot;

        const includePhaseHistory =
            options
                .includePhaseHistory ??
            this.options
                .includePhaseHistoryInSnapshot;

        const snapshot = {
            component:
                COMPONENT,

            service:
                SERVICE_NAME,

            application:
                APPLICATION_NAME,

            environment:
                this.environment,

            state:
                this.state,

            phase:
                this.phase,

            active:
                this.active,

            ready:
                this.ready,

            healthy:
                this.healthy,

            degraded:
                this.degraded,

            failed:
                this.failed,

            stopped:
                this.stopped,

            version:
                this.version,

            bootstrapAttempt:
                this.bootstrapAttempt,

            recoveryAttempt:
                this.recoveryAttempt,

            timestamps: {
                createdAt:
                    this.createdAt,

                startedAt:
                    this.startedAt,

                initializedAt:
                    this.initializedAt,

                readyAt:
                    this.readyAt,

                degradedAt:
                    this.degradedAt,

                failedAt:
                    this.failedAt,

                recoveryStartedAt:
                    this.recoveryStartedAt,

                recoveryCompletedAt:
                    this.recoveryCompletedAt,

                stoppingAt:
                    this.stoppingAt,

                stoppedAt:
                    this.stoppedAt,

                lastTransitionAt:
                    this.lastTransitionAt,
            },

            durationMs:
                this.getBootstrapDurationMs(),

            startupToReadyMs:
                this.getStartupToReadyDurationMs(),

            readiness:
                this.getReadinessState(),

            health:
                this.getHealthState(),

            phases:
                this.getPhaseStates(),

            components:
                this.getComponents(),

            errors:
                this.errors.map(
                    clone,
                ),

            lastError:
                clone(
                    this.lastError,
                ),

            lastWarning:
                clone(
                    this.lastWarning,
                ),

            fingerprint:
                {
                    algorithm:
                        this.options
                            .fingerprintAlgorithm,

                    value:
                        fingerprint(
                            {
                                environment:
                                    this.environment,

                                state:
                                    this.state,

                                phase:
                                    this.phase,

                                version:
                                    this.version,

                                phases:
                                    this.getPhaseStates(),

                                components:
                                    this.getComponents(),
                            },
                            this.options
                                .fingerprintAlgorithm,
                        ),
                },

            timestamp:
                new Date().toISOString(),
        };

        if (
            includeHistory
        ) {

            snapshot.history =
                this.history
                    .slice(
                        0,
                        this.options
                            .maxHistory,
                    )
                    .map(
                        clone,
                    );
        }

        if (
            includeTransitions
        ) {

            snapshot.transitions =
                this.transitions
                    .slice(
                        -this.options
                            .maxTransitions,
                    )
                    .map(
                        clone,
                    );
        }

        if (
            includePhaseHistory
        ) {

            snapshot.phaseHistory =
                this.phaseHistory
                    .slice(
                        0,
                        this.options
                            .maxPhaseHistory,
                    )
                    .map(
                        clone,
                    );
        }

        return deepFreeze(
            snapshot,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Reset.
     * -------------------------------------------------------------------------
     */

    reset(
        options = {},
    ) {

        if (
            !this.options
                .allowReset &&
            !options.force
        ) {

            throw new EnvironmentStateError(
                'TITech environment state reset is disabled.',
                {
                    code:
                        'ENVIRONMENT_STATE_RESET_DISABLED',
                },
            );
        }

        if (
            this._operationPromise &&
            !options.force
        ) {

            throw new EnvironmentStateError(
                'Cannot reset TITech environment state while a lifecycle operation is active.',
                {
                    code:
                        'ENVIRONMENT_STATE_RESET_NOT_ALLOWED',
                },
            );
        }

        this.state =
            ENVIRONMENT_STATES.CREATED;

        this.phase =
            null;

        this.components.clear();

        this.errors.length =
            0;

        this.history.length =
            0;

        this.phaseHistory.length =
            0;

        this.transitions.length =
            0;

        this.initializePhaseRegistry();

        this.startedAt =
            null;

        this.initializedAt =
            null;

        this.readyAt =
            null;

        this.degradedAt =
            null;

        this.failedAt =
            null;

        this.recoveryStartedAt =
            null;

        this.recoveryCompletedAt =
            null;

        this.stoppingAt =
            null;

        this.stoppedAt =
            null;

        this.lastTransitionAt =
            null;

        this.lastError =
            null;

        this.lastWarning =
            null;

        this.bootstrapAttempt =
            0;

        this.recoveryAttempt =
            0;

        this.active =
            false;

        this.ready =
            false;

        this.healthy =
            true;

        this.degraded =
            false;

        this.failed =
            false;

        this.stopped =
            false;

        this.version +=
            1;

        this.recordEvent(
            EVENT_TYPES.RESET,
            {
                version:
                    this.version,
            },
        );

        return this.snapshot();
    }

    /**
     * -------------------------------------------------------------------------
     * Transaction-like lifecycle wrapper.
     * -------------------------------------------------------------------------
     *
     * This helper lets environment/index.js or bootstrapEnvironment.js execute
     * an asynchronous lifecycle with deterministic state transitions.
     * -------------------------------------------------------------------------
     */

    async executeBootstrap(
        executor,
        options = {},
    ) {

        if (
            typeof executor !==
            'function'
        ) {

            throw new TypeError(
                'executeBootstrap() requires a function.',
            );
        }

        if (
            this._operationPromise
        ) {

            return this._operationPromise;
        }

        this._operationPromise =
            (async () => {

                this.startBootstrap(
                    {
                        reason:
                            options.reason ||
                            'execute-bootstrap',

                        component:
                            options.component ||
                            COMPONENT,
                    },
                );

                try {

                    const result =
                        await executor(
                            this.createExecutionContext(),
                        );

                    if (
                        this.state ===
                            ENVIRONMENT_STATES
                                .BOOTSTRAPPING ||
                        this.state ===
                            ENVIRONMENT_STATES
                                .INITIALIZED ||
                        this.state ===
                            ENVIRONMENT_STATES
                                .RECOVERING
                    ) {

                        if (
                            options.degraded
                        ) {

                            this.markDegraded(
                                options.warning ||
                                    'Environment bootstrap completed with warnings.',
                                {
                                    reason:
                                        'bootstrap-completed-degraded',
                                },
                            );

                        } else {

                            this.markReady(
                                {
                                    reason:
                                        'bootstrap-completed',
                                },
                            );
                        }
                    }

                    if (
                        this.recoveryStartedAt &&
                        !this.recoveryCompletedAt
                    ) {

                        this.markRecoveryCompleted();
                    }

                    return result;

                } catch (
                    error
                ) {

                    this.markFailed(
                        error,
                        {
                            reason:
                                options.failureReason ||
                                'bootstrap-failed',
                        },
                    );

                    throw error;
                }
            })();

        try {
            return await this._operationPromise;
        } finally {
            this._operationPromise =
                null;
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Execution context.
     * -------------------------------------------------------------------------
     */

    createExecutionContext() {

        return Object.freeze({
            component:
                COMPONENT,

            service:
                SERVICE_NAME,

            application:
                APPLICATION_NAME,

            environment:
                this.environment,

            getState:
                () =>
                    this.getState(),

            getPhase:
                () =>
                    this.getCurrentPhase(),

            transition:
                (
                    state,
                    metadata,
                ) =>
                    this.transition(
                        state,
                        metadata,
                    ),

            startPhase:
                (
                    phase,
                    metadata,
                ) =>
                    this.startPhase(
                        phase,
                        metadata,
                    ),

            completePhase:
                (
                    phase,
                    metadata,
                ) =>
                    this.completePhase(
                        phase,
                        metadata,
                    ),

            failPhase:
                (
                    phase,
                    error,
                    metadata,
                ) =>
                    this.failPhase(
                        phase,
                        error,
                        metadata,
                    ),

            markInitialized:
                metadata =>
                    this.markInitialized(
                        metadata,
                    ),

            markReady:
                metadata =>
                    this.markReady(
                        metadata,
                    ),

            markDegraded:
                (
                    reason,
                    metadata,
                ) =>
                    this.markDegraded(
                        reason,
                        metadata,
                    ),

            markFailed:
                (
                    error,
                    metadata,
                ) =>
                    this.markFailed(
                        error,
                        metadata,
                    ),

            readiness:
                () =>
                    this.getReadinessState(),

            health:
                () =>
                    this.getHealthState(),

            snapshot:
                options =>
                    this.snapshot(
                        options,
                    ),
        });
    }
}

/**
 * =============================================================================
 * Error normalization helper
 * =============================================================================
 */

function normalizeErrorLike(
    error,
) {

    if (
        error instanceof Error
    ) {

        return {
            name:
                error.name ||
                'Error',

            code:
                error.code ||
                'UNKNOWN',

            message:
                error.message ||
                'Unknown error',

            statusCode:
                error.statusCode ||
                null,

            timestamp:
                new Date().toISOString(),
        };
    }

    if (
        error &&
        typeof error ===
            'object'
    ) {

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

            statusCode:
                error.statusCode ||
                null,

            timestamp:
                new Date().toISOString(),
        };
    }

    return {
        name:
            'Error',

        code:
            'UNKNOWN',

        message:
            String(
                error,
            ),

        timestamp:
            new Date().toISOString(),
    };
}

/**
 * =============================================================================
 * Singleton
 * =============================================================================
 */

const stateManager =
    new EnvironmentStateManager();

/**
 * =============================================================================
 * Convenience API
 * =============================================================================
 */

function startBootstrap(
    metadata,
) {
    return stateManager.startBootstrap(
        metadata,
    );
}

function markInitialized(
    metadata,
) {
    return stateManager.markInitialized(
        metadata,
    );
}

function markReady(
    metadata,
) {
    return stateManager.markReady(
        metadata,
    );
}

function markDegraded(
    reason,
    metadata,
) {
    return stateManager.markDegraded(
        reason,
        metadata,
    );
}

function markFailed(
    error,
    metadata,
) {
    return stateManager.markFailed(
        error,
        metadata,
    );
}

function startRecovery(
    metadata,
) {
    return stateManager.startRecovery(
        metadata,
    );
}

function markRecoveryCompleted(
    metadata,
) {
    return stateManager.markRecoveryCompleted(
        metadata,
    );
}

function startShutdown(
    metadata,
) {
    return stateManager.startShutdown(
        metadata,
    );
}

function markStopped(
    metadata,
) {
    return stateManager.markStopped(
        metadata,
    );
}

function startPhase(
    phase,
    metadata,
) {
    return stateManager.startPhase(
        phase,
        metadata,
    );
}

function completePhase(
    phase,
    metadata,
) {
    return stateManager.completePhase(
        phase,
        metadata,
    );
}

function failPhase(
    phase,
    error,
    metadata,
) {
    return stateManager.failPhase(
        phase,
        error,
        metadata,
    );
}

function skipPhase(
    phase,
    reason,
) {
    return stateManager.skipPhase(
        phase,
        reason,
    );
}

function registerComponent(
    name,
    metadata,
) {
    return stateManager.registerComponent(
        name,
        metadata,
    );
}

function setComponentState(
    name,
    state,
    metadata,
) {
    return stateManager.setComponentState(
        name,
        state,
        metadata,
    );
}

function markComponentReady(
    name,
    metadata,
) {
    return stateManager.markComponentReady(
        name,
        metadata,
    );
}

function markComponentFailed(
    name,
    error,
    metadata,
) {
    return stateManager.markComponentFailed(
        name,
        error,
        metadata,
    );
}

function markComponentDegraded(
    name,
    warning,
    metadata,
) {
    return stateManager.markComponentDegraded(
        name,
        warning,
        metadata,
    );
}

function markComponentStopped(
    name,
    metadata,
) {
    return stateManager.markComponentStopped(
        name,
        metadata,
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
        stateManager,

        EnvironmentStateManager,

        EnvironmentStateError,

        /**
         * Constants.
         */
        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        ENVIRONMENT_STATES,

        ENVIRONMENT_PHASES,

        PHASE_STATES,

        EVENT_TYPES,

        DEFAULTS,

        TRANSITIONS,

        /**
         * Core lifecycle.
         */
        startBootstrap,

        markInitialized,

        markReady,

        markDegraded,

        markFailed,

        startRecovery,

        markRecoveryCompleted,

        startShutdown,

        markStopped,

        /**
         * State.
         */
        getState:
            () =>
                stateManager.getState(),

        isReady:
            () =>
                stateManager.isReady(),

        isHealthy:
            () =>
                stateManager.isHealthy(),

        isDegraded:
            () =>
                stateManager.isDegraded(),

        isFailed:
            () =>
                stateManager.isFailed(),

        isStopped:
            () =>
                stateManager.isStopped(),

        isActive:
            () =>
                stateManager.isActive(),

        canTransitionTo:
            state =>
                stateManager.canTransitionTo(
                    state,
                ),

        transition:
            (
                state,
                metadata,
            ) =>
                stateManager.transition(
                    state,
                    metadata,
                ),

        /**
         * Phase management.
         */
        setCurrentPhase:
            phase =>
                stateManager.setCurrentPhase(
                    phase,
                ),

        getCurrentPhase:
            () =>
                stateManager.getCurrentPhase(),

        startPhase,

        completePhase,

        failPhase,

        skipPhase,

        getPhase:
            phase =>
                stateManager.getPhase(
                    phase,
                ),

        getPhaseStates:
            () =>
                stateManager.getPhaseStates(),

        /**
         * Component management.
         */
        registerComponent,

        setComponentState,

        markComponentReady,

        markComponentFailed,

        markComponentDegraded,

        markComponentStopped,

        getComponent:
            name =>
                stateManager.getComponent(
                    name,
                ),

        getComponents:
            () =>
                stateManager.getComponents(),

        /**
         * Diagnostics.
         */
        getReadinessState:
            () =>
                stateManager.getReadinessState(),

        getHealthState:
            () =>
                stateManager.getHealthState(),

        summarizePhases:
            () =>
                stateManager.summarizePhases(),

        summarizeComponents:
            () =>
                stateManager.summarizeComponents(),

        getBootstrapDurationMs:
            () =>
                stateManager.getBootstrapDurationMs(),

        getStartupToReadyDurationMs:
            () =>
                stateManager.getStartupToReadyDurationMs(),

        /**
         * Execution.
         */
        executeBootstrap:
            (
                executor,
                options,
            ) =>
                stateManager.executeBootstrap(
                    executor,
                    options,
                ),

        createExecutionContext:
            () =>
                stateManager.createExecutionContext(),

        /**
         * Snapshot.
         */
        snapshot:
            options =>
                stateManager.snapshot(
                    options,
                ),

        fingerprint:
            () =>
                stateManager.snapshot()
                    .fingerprint
                    .value,

        /**
         * Reset.
         */
        reset:
            options =>
                stateManager.reset(
                    options,
                ),
    });