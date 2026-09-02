'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/environment/bootstrapState.js
 *
 * Purpose:
 *   Enterprise production-grade environment bootstrap state manager.
 *
 * Responsibilities:
 *   - Track deterministic environment bootstrap lifecycle.
 *   - Track environment discovery/loading state.
 *   - Track dotenv loading status.
 *   - Track environment validation status.
 *   - Track configuration fingerprint readiness.
 *   - Track bootstrap warnings and failures.
 *   - Provide safe immutable snapshots.
 *   - Support bootstrap orchestration without owning configuration loading.
 *   - Prevent invalid environment state transitions.
 *   - Provide health/readiness semantics for environment initialization.
 *   - Support concurrent initialization/shutdown safely.
 *
 * IMPORTANT:
 *
 *   This module OWNS ENVIRONMENT BOOTSTRAP STATE.
 *
 *   It does NOT:
 *     - load dotenv files.
 *     - mutate process.env.
 *     - create configuration objects.
 *     - connect databases.
 *     - connect Redis.
 *     - initialize Express.
 *     - start HTTP servers.
 *     - execute business logic.
 *     - execute financial transactions.
 *
 * Actual environment loading/validation remains owned by:
 *
 *   backend/config/environment.js
 *   backend/config/bootstrapEnvironment.js
 *
 * This module records the lifecycle state produced by those components.
 *
 * =============================================================================
 *
 * Canonical environment lifecycle:
 *
 *   CREATED
 *      ↓
 *   DISCOVERING
 *      ↓
 *   LOADING
 *      ↓
 *   NORMALIZING
 *      ↓
 *   VALIDATING
 *      ↓
 *   READY
 *
 * Any recoverable warning may produce:
 *
 *   READY_WITH_WARNINGS
 *
 * Terminal failure:
 *
 *   FAILED
 *
 * Shutdown:
 *
 *   STOPPING → STOPPED
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
    'environment-bootstrap-state';

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

const BOOTSTRAP_STATES =
    Object.freeze({
        CREATED:
            'created',

        DISCOVERING:
            'discovering',

        LOADING:
            'loading',

        NORMALIZING:
            'normalizing',

        VALIDATING:
            'validating',

        READY:
            'ready',

        READY_WITH_WARNINGS:
            'ready_with_warnings',

        FAILED:
            'failed',

        STOPPING:
            'stopping',

        STOPPED:
            'stopped',
    });

const BOOTSTRAP_PHASES =
    Object.freeze({
        DISCOVERY:
            'discovery',

        DOTENV:
            'dotenv',

        NORMALIZATION:
            'normalization',

        VALIDATION:
            'validation',

        FINGERPRINT:
            'fingerprint',

        COMPLETION:
            'completion',
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

const RESULT_STATUSES =
    Object.freeze({
        SUCCESS:
            'success',

        WARNING:
            'warning',

        FAILED:
            'failed',

        SKIPPED:
            'skipped',
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

        allowWarnings:
            true,

        allowUnknownEnvironment:
            false,

        fingerprintAlgorithm:
            'sha256',

        maxWarnings:
            100,

        maxErrors:
            100,

        maxTransitions:
            250,

        maxHistory:
            250,

        /**
         * A successful environment bootstrap must normally have at least:
         */
        requiredPhases:
            Object.freeze([
                BOOTSTRAP_PHASES.DISCOVERY,
                BOOTSTRAP_PHASES.DOTENV,
                BOOTSTRAP_PHASES.NORMALIZATION,
                BOOTSTRAP_PHASES.VALIDATION,
                BOOTSTRAP_PHASES.FINGERPRINT,
                BOOTSTRAP_PHASES.COMPLETION,
            ]),

        /**
         * Security-sensitive environment variables are never exposed by
         * diagnostic snapshots.
         */
        sensitivePattern:
            /(password|passwd|secret|token|authorization|api[_-]?key|private[_-]?key|client[_-]?secret|encryption[_-]?key|connection[_-]?(string|uri)|jwt[_-]?secret|smtp[_-]?password)/i,
    });

/**
 * =============================================================================
 * State transitions
 * =============================================================================
 *
 * Invalid transitions are rejected rather than silently producing impossible
 * startup states.
 * =============================================================================
 */

const ALLOWED_TRANSITIONS =
    Object.freeze({
        [BOOTSTRAP_STATES.CREATED]:
            Object.freeze([
                BOOTSTRAP_STATES.DISCOVERING,
                BOOTSTRAP_STATES.FAILED,
                BOOTSTRAP_STATES.STOPPING,
            ]),

        [BOOTSTRAP_STATES.DISCOVERING]:
            Object.freeze([
                BOOTSTRAP_STATES.LOADING,
                BOOTSTRAP_STATES.FAILED,
                BOOTSTRAP_STATES.STOPPING,
            ]),

        [BOOTSTRAP_STATES.LOADING]:
            Object.freeze([
                BOOTSTRAP_STATES.NORMALIZING,
                BOOTSTRAP_STATES.FAILED,
                BOOTSTRAP_STATES.STOPPING,
            ]),

        [BOOTSTRAP_STATES.NORMALIZING]:
            Object.freeze([
                BOOTSTRAP_STATES.VALIDATING,
                BOOTSTRAP_STATES.FAILED,
                BOOTSTRAP_STATES.STOPPING,
            ]),

        [BOOTSTRAP_STATES.VALIDATING]:
            Object.freeze([
                BOOTSTRAP_STATES.READY,
                BOOTSTRAP_STATES.READY_WITH_WARNINGS,
                BOOTSTRAP_STATES.FAILED,
                BOOTSTRAP_STATES.STOPPING,
            ]),

        [BOOTSTRAP_STATES.READY]:
            Object.freeze([
                BOOTSTRAP_STATES.READY_WITH_WARNINGS,
                BOOTSTRAP_STATES.STOPPING,
            ]),

        [BOOTSTRAP_STATES.READY_WITH_WARNINGS]:
            Object.freeze([
                BOOTSTRAP_STATES.READY,
                BOOTSTRAP_STATES.STOPPING,
            ]),

        [BOOTSTRAP_STATES.FAILED]:
            Object.freeze([
                BOOTSTRAP_STATES.CREATED,
                BOOTSTRAP_STATES.STOPPING,
            ]),

        [BOOTSTRAP_STATES.STOPPING]:
            Object.freeze([
                BOOTSTRAP_STATES.STOPPED,
                BOOTSTRAP_STATES.FAILED,
            ]),

        [BOOTSTRAP_STATES.STOPPED]:
            Object.freeze([
                BOOTSTRAP_STATES.CREATED,
                BOOTSTRAP_STATES.DISCOVERING,
            ]),
    });

/**
 * =============================================================================
 * Errors
 * =============================================================================
 */

class EnvironmentBootstrapStateError extends Error {

    constructor(
        message,
        options = {},
    ) {

        super(
            message,
        );

        this.name =
            'EnvironmentBootstrapStateError';

        this.code =
            options.code ||
            'ENVIRONMENT_BOOTSTRAP_STATE_ERROR';

        this.phase =
            options.phase ||
            null;

        this.from =
            options.from ||
            null;

        this.to =
            options.to ||
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
            EnvironmentBootstrapStateError,
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

    const normalized =
        String(
            value ||
            DEFAULTS.environment,
        )
            .trim()
            .toLowerCase();

    return normalized;
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

function hash(
    value,
    algorithm =
        DEFAULTS.fingerprintAlgorithm,
) {

    return crypto
        .createHash(
            algorithm,
        )
        .update(
            String(
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
 * Redaction
 * =============================================================================
 */

function sanitize(
    value,
    {
        redactSecrets = true,
        maxDepth = 12,
    } = {},
    path = '',
    seen = new WeakSet(),
) {

    if (
        path.split('.').length >
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
                path.split('.').pop() || '',
            )
        ) {

            return '[REDACTED]';
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
                        maxDepth,
                    },
                    path
                        ? `${path}.${index}`
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

        const currentPath =
            path
                ? `${path}.${key}`
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

        output[key] =
            sanitize(
                item,
                {
                    redactSecrets,
                    maxDepth,
                },
                currentPath,
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
        // State management must never depend on logger availability.
    }
}

/**
 * =============================================================================
 * EnvironmentBootstrapState
 * =============================================================================
 */

class EnvironmentBootstrapState {

    constructor(
        options = {},
    ) {

        this.options =
            Object.freeze({
                ...DEFAULTS,

                strict:
                    options.strict ??
                    DEFAULTS.strict,

                failClosed:
                    options.failClosed ??
                    DEFAULTS.failClosed,

                allowWarnings:
                    options.allowWarnings ??
                    DEFAULTS.allowWarnings,

                allowUnknownEnvironment:
                    options.allowUnknownEnvironment ??
                    DEFAULTS.allowUnknownEnvironment,

                environment:
                    normalizeEnvironment(
                        options.environment ||
                        process.env.NODE_ENV ||
                        DEFAULTS.environment,
                    ),

                fingerprintAlgorithm:
                    options.fingerprintAlgorithm ||
                    DEFAULTS.fingerprintAlgorithm,

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

                maxTransitions:
                    Number.isInteger(
                        options.maxTransitions,
                    ) &&
                    options.maxTransitions > 0
                        ? options.maxTransitions
                        : DEFAULTS.maxTransitions,

                maxHistory:
                    Number.isInteger(
                        options.maxHistory,
                    ) &&
                    options.maxHistory > 0
                        ? options.maxHistory
                        : DEFAULTS.maxHistory,
            });

        this.state =
            BOOTSTRAP_STATES.CREATED;

        this.currentPhase =
            null;

        this.environment =
            this.options.environment;

        this.initialized =
            false;

        this.ready =
            false;

        this.failed =
            false;

        this.stopping =
            false;

        this.stopped =
            false;

        this.bootstrapStartedAt =
            null;

        this.bootstrapCompletedAt =
            null;

        this.stoppedAt =
            null;

        this.lastTransitionAt =
            new Date();

        this.lastError =
            null;

        this.fingerprintValue =
            null;

        this.fingerprintAlgorithm =
            this.options
                .fingerprintAlgorithm;

        this.discovery =
            null;

        this.dotenv =
            null;

        this.normalization =
            null;

        this.validation =
            null;

        this.completion =
            null;

        this.phases =
            new Map();

        this.warnings =
            [];

        this.errors =
            [];

        this.transitions =
            [];

        this.history =
            [];

        this._operationPromise =
            null;
    }

    /**
     * -------------------------------------------------------------------------
     * Basic state flags.
     * -------------------------------------------------------------------------
     */

    isCreated() {

        return (
            this.state ===
            BOOTSTRAP_STATES.CREATED
        );
    }

    isReady() {

        return (
            (
                this.state ===
                    BOOTSTRAP_STATES.READY ||
                this.state ===
                    BOOTSTRAP_STATES.READY_WITH_WARNINGS
            ) &&
            this.ready &&
            !this.failed &&
            !this.stopped
        );
    }

    isFailed() {

        return (
            this.state ===
            BOOTSTRAP_STATES.FAILED ||
            this.failed
        );
    }

    isStopped() {

        return (
            this.state ===
            BOOTSTRAP_STATES.STOPPED ||
            this.stopped
        );
    }

    isTerminal() {

        return (
            this.isFailed() ||
            this.isStopped()
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Transition validation.
     * -------------------------------------------------------------------------
     */

    canTransition(
        nextState,
    ) {

        if (
            this.state ===
            nextState
        ) {

            return true;
        }

        const allowed =
            ALLOWED_TRANSITIONS[
                this.state
            ] ||
            [];

        return allowed.includes(
            nextState,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Transition.
     * -------------------------------------------------------------------------
     */

    transition(
        nextState,
        options = {},
    ) {

        if (
            !Object.values(
                BOOTSTRAP_STATES,
            ).includes(
                nextState,
            )
        ) {

            throw new EnvironmentBootstrapStateError(
                `Unknown TITech environment bootstrap state "${nextState}".`,
                {
                    code:
                        'ENVIRONMENT_STATE_UNKNOWN',

                    to:
                        nextState,
                },
            );
        }

        const previous =
            this.state;

        if (
            !this.canTransition(
                nextState,
            ) &&
            !options.force
        ) {

            throw new EnvironmentBootstrapStateError(
                `Invalid TITech environment bootstrap state transition: ${previous} → ${nextState}.`,
                {
                    code:
                        'ENVIRONMENT_STATE_TRANSITION_INVALID',

                    from:
                        previous,

                    to:
                        nextState,
                },
            );
        }

        this.state =
            nextState;

        this.lastTransitionAt =
            new Date();

        this.recordTransition(
            {
                from:
                    previous,

                to:
                    nextState,

                phase:
                    options.phase ||
                    this.currentPhase,

                reason:
                    options.reason ||
                    null,
            },
        );

        this.updateFlagsForState(
            nextState,
        );

        return this;
    }

    /**
     * -------------------------------------------------------------------------
     * State-dependent flags.
     * -------------------------------------------------------------------------
     */

    updateFlagsForState(
        state,
    ) {

        this.ready =
            (
                state ===
                    BOOTSTRAP_STATES.READY ||
                state ===
                    BOOTSTRAP_STATES
                        .READY_WITH_WARNINGS
            );

        this.failed =
            state ===
            BOOTSTRAP_STATES.FAILED;

        this.stopping =
            state ===
            BOOTSTRAP_STATES.STOPPING;

        this.stopped =
            state ===
            BOOTSTRAP_STATES.STOPPED;

        if (
            state ===
                BOOTSTRAP_STATES.FAILED
        ) {

            this.ready =
                false;
        }

        if (
            state ===
                BOOTSTRAP_STATES.STOPPED
        ) {

            this.ready =
                false;

            this.initialized =
                false;
        }

        return this;
    }

    /**
     * -------------------------------------------------------------------------
     * Phase management.
     * -------------------------------------------------------------------------
     */

    startPhase(
        phase,
        metadata = {},
    ) {

        if (
            !Object.values(
                BOOTSTRAP_PHASES,
            ).includes(
                phase,
            )
        ) {

            throw new EnvironmentBootstrapStateError(
                `Unknown TITech environment bootstrap phase "${phase}".`,
                {
                    code:
                        'ENVIRONMENT_PHASE_UNKNOWN',

                    phase,
                },
            );
        }

        this.currentPhase =
            phase;

        const phaseRecord = {
            phase,

            status:
                'running',

            startedAt:
                new Date(),

            completedAt:
                null,

            durationMs:
                null,

            result:
                null,

            metadata:
                sanitize(
                    metadata,
                ),
        };

        this.phases.set(
            phase,
            phaseRecord,
        );

        this.recordHistory(
            {
                type:
                    'phase.started',

                phase,

                metadata:
                    sanitize(
                        metadata,
                    ),
            },
        );

        return phaseRecord;
    }

    completePhase(
        phase,
        result = {},
    ) {

        const record =
            this.phases.get(
                phase,
            );

        if (
            !record
        ) {

            throw new EnvironmentBootstrapStateError(
                `Cannot complete unknown environment bootstrap phase "${phase}".`,
                {
                    code:
                        'ENVIRONMENT_PHASE_NOT_STARTED',

                    phase,
                },
            );
        }

        const completedAt =
            new Date();

        record.status =
            result.status ||
            RESULT_STATUSES.SUCCESS;

        record.completedAt =
            completedAt;

        record.durationMs =
            Math.max(
                0,
                completedAt.getTime() -
                record.startedAt.getTime(),
            );

        record.result =
            sanitize(
                result,
            );

        this.phases.set(
            phase,
            record,
        );

        this.recordHistory(
            {
                type:
                    'phase.completed',

                phase,

                status:
                    record.status,
            },
        );

        return record;
    }

    failPhase(
        phase,
        error,
        metadata = {},
    ) {

        const normalized =
            error instanceof Error
                ? error
                : new Error(
                    String(
                        error,
                    ),
                );

        const record =
            this.phases.get(
                phase,
            );

        if (
            record
        ) {

            const completedAt =
                new Date();

            record.status =
                RESULT_STATUSES.FAILED;

            record.completedAt =
                completedAt;

            record.durationMs =
                Math.max(
                    0,
                    completedAt.getTime() -
                    record.startedAt.getTime(),
                );

            record.result = {
                error:
                    safeError(
                        normalized,
                    ),

                ...sanitize(
                    metadata,
                ),
            };

            this.phases.set(
                phase,
                record,
            );
        } else {

            this.phases.set(
                phase,
                {
                    phase,

                    status:
                        RESULT_STATUSES.FAILED,

                    startedAt:
                        null,

                    completedAt:
                        new Date(),

                    durationMs:
                        0,

                    result: {
                        error:
                            safeError(
                                normalized,
                            ),

                        ...sanitize(
                            metadata,
                        ),
                    },

                    metadata: {},
                },
            );
        }

        this.recordError(
            normalized,
            {
                phase,
            },
        );

        return this.phases.get(
            phase,
        );
    }

    skipPhase(
        phase,
        reason = null,
    ) {

        const now =
            new Date();

        this.phases.set(
            phase,
            {
                phase,

                status:
                    RESULT_STATUSES.SKIPPED,

                startedAt:
                    now,

                completedAt:
                    now,

                durationMs:
                    0,

                result: {
                    reason:
                        reason || null,
                },

                metadata: {},
            },
        );

        this.recordHistory(
            {
                type:
                    'phase.skipped',

                phase,

                reason:
                    reason || null,
            },
        );

        return this.phases.get(
            phase,
        );
    }

    getPhase(
        phase,
    ) {

        return (
            this.phases.get(
                phase,
            ) ||
            null
        );
    }

    getPhaseStatus(
        phase,
    ) {

        return (
            this.phases.get(
                phase,
            )?.status ||
            null
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Environment metadata.
     * -------------------------------------------------------------------------
     */

    setEnvironment(
        environment,
        metadata = {},
    ) {

        const normalized =
            normalizeEnvironment(
                environment,
            );

        if (
            !this.options
                .allowUnknownEnvironment &&
            !isSupportedEnvironment(
                normalized,
            )
        ) {

            const error =
                new EnvironmentBootstrapStateError(
                    `Unsupported TITech environment "${normalized}".`,
                    {
                        code:
                            'ENVIRONMENT_UNSUPPORTED',

                        details: {
                            supported:
                                SUPPORTED_ENVIRONMENTS,
                        },
                    },
                );

            this.recordError(
                error,
            );

            if (
                this.options.failClosed
            ) {

                throw error;
            }

            this.recordWarning(
                {
                    code:
                        'ENVIRONMENT_UNKNOWN',

                    message:
                        `Unknown environment "${normalized}" accepted in non-strict mode.`,
                },
            );
        }

        this.environment =
            normalized;

        this.recordHistory(
            {
                type:
                    'environment.set',

                environment:
                    normalized,

                metadata:
                    sanitize(
                        metadata,
                    ),
            },
        );

        return this;
    }

    /**
     * -------------------------------------------------------------------------
     * Phase-specific state helpers.
     * -------------------------------------------------------------------------
     */

    beginDiscovery(
        metadata = {},
    ) {

        this.transition(
            BOOTSTRAP_STATES.DISCOVERING,
            {
                phase:
                    BOOTSTRAP_PHASES.DISCOVERY,
            },
        );

        return this.startPhase(
            BOOTSTRAP_PHASES.DISCOVERY,
            metadata,
        );
    }

    beginLoading(
        metadata = {},
    ) {

        this.transition(
            BOOTSTRAP_STATES.LOADING,
            {
                phase:
                    BOOTSTRAP_PHASES.DOTENV,
            },
        );

        return this.startPhase(
            BOOTSTRAP_PHASES.DOTENV,
            metadata,
        );
    }

    beginNormalization(
        metadata = {},
    ) {

        this.transition(
            BOOTSTRAP_STATES.NORMALIZING,
            {
                phase:
                    BOOTSTRAP_PHASES.NORMALIZATION,
            },
        );

        return this.startPhase(
            BOOTSTRAP_PHASES.NORMALIZATION,
            metadata,
        );
    }

    beginValidation(
        metadata = {},
    ) {

        this.transition(
            BOOTSTRAP_STATES.VALIDATING,
            {
                phase:
                    BOOTSTRAP_PHASES.VALIDATION,
            },
        );

        return this.startPhase(
            BOOTSTRAP_PHASES.VALIDATION,
            metadata,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Complete startup.
     * -------------------------------------------------------------------------
     */

    complete(
        metadata = {},
    ) {

        const required =
            this.options.requiredPhases;

        const incomplete =
            required.filter(
                phase =>
                    phase !==
                        BOOTSTRAP_PHASES.COMPLETION &&
                    !this.phases.has(
                        phase,
                    ),
            );

        if (
            incomplete.length >
            0
        ) {

            const error =
                new EnvironmentBootstrapStateError(
                    'TITech environment bootstrap cannot become READY because required phases are incomplete.',
                    {
                        code:
                            'ENVIRONMENT_REQUIRED_PHASES_INCOMPLETE',

                        details: {
                            incomplete,
                        },
                    },
                );

            this.recordError(
                error,
            );

            if (
                this.options.strict ||
                this.options.failClosed
            ) {

                this.fail(
                    error,
                    {
                        phase:
                            BOOTSTRAP_PHASES.COMPLETION,
                    },
                );

                throw error;
            }
        }

        this.startPhase(
            BOOTSTRAP_PHASES.COMPLETION,
            metadata,
        );

        const hasWarnings =
            this.warnings.length >
            0;

        const nextState =
            hasWarnings
                ? BOOTSTRAP_STATES
                    .READY_WITH_WARNINGS
                : BOOTSTRAP_STATES
                    .READY;

        this.transition(
            nextState,
            {
                phase:
                    BOOTSTRAP_PHASES.COMPLETION,
            },
        );

        this.completePhase(
            BOOTSTRAP_PHASES.COMPLETION,
            {
                status:
                    hasWarnings
                        ? RESULT_STATUSES.WARNING
                        : RESULT_STATUSES.SUCCESS,

                warnings:
                    this.warnings.length,

                errors:
                    this.errors.length,

                ...metadata,
            },
        );

        this.initialized =
            true;

        this.bootstrapCompletedAt =
            new Date();

        this.currentPhase =
            BOOTSTRAP_PHASES.COMPLETION;

        log(
            hasWarnings
                ? 'warn'
                : 'info',
            {
                state:
                    this.state,

                environment:
                    this.environment,

                warnings:
                    this.warnings.length,

                errors:
                    this.errors.length,
            },
            hasWarnings
                ? 'TITech environment bootstrap completed with warnings.'
                : 'TITech environment bootstrap completed successfully.',
        );

        return this;
    }

    /**
     * -------------------------------------------------------------------------
     * Fail bootstrap.
     * -------------------------------------------------------------------------
     */

    fail(
        error,
        metadata = {},
    ) {

        const normalized =
            error instanceof Error
                ? error
                : new Error(
                    String(
                        error,
                    ),
                );

        this.lastError =
            normalized;

        this.failed =
            true;

        this.ready =
            false;

        const phase =
            metadata.phase ||
            this.currentPhase ||
            null;

        if (
            phase
        ) {

            this.failPhase(
                phase,
                normalized,
                metadata,
            );
        } else {

            this.recordError(
                normalized,
                {
                    phase:
                        null,
                },
            );
        }

        if (
            this.state !==
                BOOTSTRAP_STATES.FAILED &&
            this.state !==
                BOOTSTRAP_STATES.STOPPING &&
            this.state !==
                BOOTSTRAP_STATES.STOPPED
        ) {

            this.transition(
                BOOTSTRAP_STATES.FAILED,
                {
                    phase,
                    force:
                        false,
                },
            );
        }

        log(
            'error',
            {
                phase,

                error:
                    safeError(
                        normalized,
                    ),
            },
            'TITech environment bootstrap failed.',
        );

        return this;
    }

    /**
     * -------------------------------------------------------------------------
     * Start bootstrap.
     * -------------------------------------------------------------------------
     */

    start(
        metadata = {},
    ) {

        if (
            this.isReady()
        ) {

            return this;
        }

        if (
            this.state ===
            BOOTSTRAP_STATES.FAILED
        ) {

            /**
             * Explicit restart after failure.
             */
            this.reset(
                {
                    preserveHistory:
                        true,
                },
            );
        }

        if (
            this.state ===
            BOOTSTRAP_STATES.STOPPED
        ) {

            this.transition(
                BOOTSTRAP_STATES.CREATED,
                {
                    force:
                        true,
                    reason:
                        'restart',
                },
            );
        }

        if (
            this.state !==
            BOOTSTRAP_STATES.CREATED
        ) {

            return this;
        }

        this.bootstrapStartedAt =
            new Date();

        this.bootstrapCompletedAt =
            null;

        this.setEnvironment(
            metadata.environment ||
            this.environment,
        );

        this.recordHistory(
            {
                type:
                    'bootstrap.started',

                metadata:
                    sanitize(
                        metadata,
                    ),
            },
        );

        return this;
    }

    /**
     * -------------------------------------------------------------------------
     * Stop.
     * -------------------------------------------------------------------------
     */

    stop(
        metadata = {},
    ) {

        if (
            this.stopped
        ) {

            return this;
        }

        if (
            this.state !==
            BOOTSTRAP_STATES.STOPPING &&
            this.state !==
            BOOTSTRAP_STATES.STOPPED
        ) {

            this.transition(
                BOOTSTRAP_STATES.STOPPING,
                {
                    phase:
                        this.currentPhase,
                },
            );
        }

        this.stopping =
            true;

        this.ready =
            false;

        this.stoppedAt =
            new Date();

        this.recordHistory(
            {
                type:
                    'bootstrap.stopping',

                metadata:
                    sanitize(
                        metadata,
                    ),
            },
        );

        this.transition(
            BOOTSTRAP_STATES.STOPPED,
            {
                reason:
                    metadata.reason ||
                    'shutdown',
            },
        );

        log(
            'info',
            {
                reason:
                    metadata.reason ||
                    'shutdown',
            },
            'TITech environment bootstrap state stopped.',
        );

        return this;
    }

    /**
     * -------------------------------------------------------------------------
     * Discovery metadata.
     * -------------------------------------------------------------------------
     */

    setDiscovery(
        discovery,
    ) {

        this.discovery =
            deepFreeze(
                sanitize(
                    clone(
                        discovery,
                    ),
                ),
            );

        this.recordHistory(
            {
                type:
                    'discovery.updated',
            },
        );

        return this;
    }

    /**
     * -------------------------------------------------------------------------
     * Dotenv metadata.
     * -------------------------------------------------------------------------
     */

    setDotenv(
        dotenv,
    ) {

        this.dotenv =
            deepFreeze(
                sanitize(
                    clone(
                        dotenv,
                    ),
                ),
            );

        this.recordHistory(
            {
                type:
                    'dotenv.updated',
            },
        );

        return this;
    }

    /**
     * -------------------------------------------------------------------------
     * Normalization metadata.
     * -------------------------------------------------------------------------
     */

    setNormalization(
        normalization,
    ) {

        this.normalization =
            deepFreeze(
                sanitize(
                    clone(
                        normalization,
                    ),
                ),
            );

        this.recordHistory(
            {
                type:
                    'normalization.updated',
            },
        );

        return this;
    }

    /**
     * -------------------------------------------------------------------------
     * Validation metadata.
     * -------------------------------------------------------------------------
     */

    setValidation(
        validation,
    ) {

        this.validation =
            deepFreeze(
                sanitize(
                    clone(
                        validation,
                    ),
                ),
            );

        this.recordHistory(
            {
                type:
                    'validation.updated',
            },
        );

        return this;
    }

    /**
     * -------------------------------------------------------------------------
     * Fingerprint.
     * -------------------------------------------------------------------------
     */

    setFingerprint(
        configuration,
        options = {},
    ) {

        const algorithm =
            options.algorithm ||
            this.options
                .fingerprintAlgorithm;

        const sanitized =
            sanitize(
                clone(
                    configuration,
                ),
                {
                    redactSecrets:
                        true,
                },
            );

        const canonical =
            JSON.stringify(
                sanitized,
            );

        this.fingerprintValue =
            hash(
                canonical,
                algorithm,
            );

        this.fingerprintAlgorithm =
            algorithm;

        this.recordHistory(
            {
                type:
                    'fingerprint.updated',

                algorithm,
            },
        );

        this.completePhase(
            BOOTSTRAP_PHASES.FINGERPRINT,
            {
                status:
                    RESULT_STATUSES.SUCCESS,

                algorithm,

                fingerprint:
                    this.fingerprintValue,
            },
        );

        return this.fingerprintValue;
    }

    /**
     * -------------------------------------------------------------------------
     * Warning recording.
     * -------------------------------------------------------------------------
     */

    recordWarning(
        warning,
        metadata = {},
    ) {

        if (
            this.warnings.length >=
            this.options
                .maxWarnings
        ) {

            return;
        }

        const record = {
            severity:
                metadata.severity ||
                SEVERITIES.WARNING,

            code:
                warning?.code ||
                metadata.code ||
                'ENVIRONMENT_WARNING',

            message:
                warning?.message ||
                String(
                    warning,
                ),

            phase:
                metadata.phase ||
                this.currentPhase ||
                null,

            details:
                sanitize(
                    metadata.details ||
                    warning?.details ||
                    {},
                ),

            timestamp:
                new Date().toISOString(),
        };

        this.warnings.push(
            record,
        );

        this.recordHistory(
            {
                type:
                    'warning.recorded',

                code:
                    record.code,

                phase:
                    record.phase,
            },
        );

        return record;
    }

    /**
     * -------------------------------------------------------------------------
     * Error recording.
     * -------------------------------------------------------------------------
     */

    recordError(
        error,
        metadata = {},
    ) {

        if (
            this.errors.length >=
            this.options
                .maxErrors
        ) {

            return;
        }

        const normalized =
            error instanceof Error
                ? error
                : new Error(
                    String(
                        error,
                    ),
                );

        const record = {
            severity:
                metadata.severity ||
                SEVERITIES.ERROR,

            code:
                normalized.code ||
                metadata.code ||
                'ENVIRONMENT_ERROR',

            name:
                normalized.name ||
                'Error',

            message:
                normalized.message,

            phase:
                metadata.phase ||
                this.currentPhase ||
                normalized.phase ||
                null,

            details:
                sanitize(
                    metadata.details ||
                    normalized.details ||
                    {},
                ),

            timestamp:
                new Date().toISOString(),
        };

        this.errors.push(
            record,
        );

        this.lastError =
            normalized;

        this.recordHistory(
            {
                type:
                    'error.recorded',

                code:
                    record.code,

                phase:
                    record.phase,
            },
        );

        return record;
    }

    /**
     * -------------------------------------------------------------------------
     * Transition/history management.
     * -------------------------------------------------------------------------
     */

    recordTransition(
        transition,
    ) {

        if (
            this.transitions.length >=
            this.options
                .maxTransitions
        ) {

            this.transitions.shift();
        }

        this.transitions.push(
            {
                ...transition,

                timestamp:
                    new Date().toISOString(),
            },
        );

        this.recordHistory(
            {
                type:
                    'state.transition',

                from:
                    transition.from,

                to:
                    transition.to,

                phase:
                    transition.phase ||
                    null,
            },
        );

        return this.transitions[
            this.transitions.length - 1
        ];
    }

    recordHistory(
        event,
    ) {

        if (
            this.history.length >=
            this.options
                .maxHistory
        ) {

            this.history.shift();
        }

        this.history.push(
            {
                ...sanitize(
                    event,
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
     * Required phase evaluation.
     * -------------------------------------------------------------------------
     */

    getMissingRequiredPhases() {

        return this.options
            .requiredPhases
            .filter(
                phase =>
                    !this.phases.has(
                        phase,
                    ),
            );
    }

    hasCompletedRequiredPhases() {

        return (
            this.getMissingRequiredPhases()
                .length === 0
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Readiness.
     * -------------------------------------------------------------------------
     */

    readiness() {

        const missing =
            this.getMissingRequiredPhases();

        const ready =
            this.isReady() &&
            missing.length === 0;

        return {
            status:
                ready
                    ? 'ready'
                    : 'not_ready',

            ready,

            state:
                this.state,

            environment:
                this.environment,

            phase:
                this.currentPhase,

            missingPhases:
                missing,

            warnings:
                this.warnings.length,

            errors:
                this.errors.length,

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

        const healthy =
            (
                this.state ===
                    BOOTSTRAP_STATES.READY ||
                this.state ===
                    BOOTSTRAP_STATES
                        .READY_WITH_WARNINGS
            ) &&
            this.errors.length === 0;

        return {
            status:
                healthy
                    ? 'healthy'
                    : readiness.ready
                        ? 'degraded'
                        : 'unhealthy',

            healthy,

            degraded:
                !healthy &&
                readiness.ready,

            state:
                this.state,

            environment:
                this.environment,

            phase:
                this.currentPhase,

            readiness,

            fingerprint:
                this.fingerprintValue
                    ? {
                        algorithm:
                            this.fingerprintAlgorithm,

                        value:
                            this.fingerprintValue,
                    }
                    : null,

            timestamp:
                new Date().toISOString(),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Operational snapshot.
     * -------------------------------------------------------------------------
     */

    snapshot(
        options = {},
    ) {

        const exposeHistory =
            options.exposeHistory ??
            false;

        const exposeTransitions =
            options.exposeTransitions ??
            true;

        const exposeWarnings =
            options.exposeWarnings ??
            true;

        const exposeErrors =
            options.exposeErrors ??
            true;

        const snapshot = {

            component:
                COMPONENT,

            service:
                SERVICE_NAME,

            application:
                APPLICATION_NAME,

            state:
                this.state,

            environment:
                this.environment,

            initialized:
                this.initialized,

            ready:
                this.ready,

            failed:
                this.failed,

            stopping:
                this.stopping,

            stopped:
                this.stopped,

            currentPhase:
                this.currentPhase,

            bootstrapStartedAt:
                this.bootstrapStartedAt,

            bootstrapCompletedAt:
                this.bootstrapCompletedAt,

            stoppedAt:
                this.stoppedAt,

            lastTransitionAt:
                this.lastTransitionAt,

            discovery:
                this.discovery,

            dotenv:
                this.dotenv,

            normalization:
                this.normalization,

            validation:
                this.validation,

            fingerprint:
                this.fingerprintValue
                    ? {
                        algorithm:
                            this.fingerprintAlgorithm,

                        value:
                            this.fingerprintValue,
                    }
                    : null,

            phases:
                Object.fromEntries(
                    [
                        ...this.phases.entries(),
                    ].map(
                        (
                            [
                                phase,
                                value,
                            ],
                        ) => [
                            phase,
                            clone(
                                value,
                            ),
                        ],
                    ),
                ),

            summary: {
                warnings:
                    this.warnings.length,

                errors:
                    this.errors.length,

                transitions:
                    this.transitions.length,

                history:
                    this.history.length,

                requiredPhases:
                    this.options
                        .requiredPhases
                        .length,

                missingRequiredPhases:
                    this.getMissingRequiredPhases(),
            },

            warnings:
                exposeWarnings
                    ? clone(
                        this.warnings,
                    )
                    : [],

            errors:
                exposeErrors
                    ? clone(
                        this.errors,
                    )
                    : [],

            lastError:
                safeError(
                    this.lastError,
                ),

            runtime: {
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
            },

            timestamp:
                new Date().toISOString(),
        };

        if (
            exposeTransitions
        ) {

            snapshot.transitions =
                clone(
                    this.transitions,
                );
        }

        if (
            exposeHistory
        ) {

            snapshot.history =
                clone(
                    this.history,
                );
        }

        return deepFreeze(
            sanitize(
                snapshot,
                {
                    redactSecrets:
                        true,
                },
            ),
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Reset.
     * -------------------------------------------------------------------------
     *
     * Intended for isolated tests/bootstrap replay.
     * -------------------------------------------------------------------------
     */

    reset(
        options = {},
    ) {

        const preserveHistory =
            options.preserveHistory ??
            false;

        this.state =
            BOOTSTRAP_STATES.CREATED;

        this.currentPhase =
            null;

        this.environment =
            this.options.environment;

        this.initialized =
            false;

        this.ready =
            false;

        this.failed =
            false;

        this.stopping =
            false;

        this.stopped =
            false;

        this.bootstrapStartedAt =
            null;

        this.bootstrapCompletedAt =
            null;

        this.stoppedAt =
            null;

        this.lastTransitionAt =
            new Date();

        this.lastError =
            null;

        this.fingerprintValue =
            null;

        this.discovery =
            null;

        this.dotenv =
            null;

        this.normalization =
            null;

        this.validation =
            null;

        this.completion =
            null;

        this.phases.clear();

        this.warnings.length =
            0;

        this.errors.length =
            0;

        this.transitions.length =
            0;

        if (
            !preserveHistory
        ) {

            this.history.length =
                0;
        }

        this._operationPromise =
            null;

        return this;
    }
}

/**
 * =============================================================================
 * Singleton
 * =============================================================================
 */

const bootstrapState =
    new EnvironmentBootstrapState();

/**
 * =============================================================================
 * Convenience API
 * =============================================================================
 */

function start(
    metadata,
) {

    return bootstrapState.start(
        metadata,
    );
}

function beginDiscovery(
    metadata,
) {

    return bootstrapState.beginDiscovery(
        metadata,
    );
}

function beginLoading(
    metadata,
) {

    return bootstrapState.beginLoading(
        metadata,
    );
}

function beginNormalization(
    metadata,
) {

    return bootstrapState.beginNormalization(
        metadata,
    );
}

function beginValidation(
    metadata,
) {

    return bootstrapState.beginValidation(
        metadata,
    );
}

function complete(
    metadata,
) {

    return bootstrapState.complete(
        metadata,
    );
}

function fail(
    error,
    metadata,
) {

    return bootstrapState.fail(
        error,
        metadata,
    );
}

function stop(
    metadata,
) {

    return bootstrapState.stop(
        metadata,
    );
}

function setEnvironment(
    environment,
    metadata,
) {

    return bootstrapState.setEnvironment(
        environment,
        metadata,
    );
}

function setDiscovery(
    discovery,
) {

    return bootstrapState.setDiscovery(
        discovery,
    );
}

function setDotenv(
    dotenv,
) {

    return bootstrapState.setDotenv(
        dotenv,
    );
}

function setNormalization(
    normalization,
) {

    return bootstrapState.setNormalization(
        normalization,
    );
}

function setValidation(
    validation,
) {

    return bootstrapState.setValidation(
        validation,
    );
}

function setFingerprint(
    configuration,
    options,
) {

    return bootstrapState.setFingerprint(
        configuration,
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
         * Singleton.
         */
        bootstrapState,

        EnvironmentBootstrapState,

        EnvironmentBootstrapStateError,

        /**
         * Constants.
         */
        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        ENVIRONMENT_NAMES,

        SUPPORTED_ENVIRONMENTS,

        BOOTSTRAP_STATES,

        BOOTSTRAP_PHASES,

        SEVERITIES,

        RESULT_STATUSES,

        DEFAULTS,

        ALLOWED_TRANSITIONS,

        /**
         * State lifecycle.
         */
        start,

        stop,

        complete,

        fail,

        transition:
            (
                nextState,
                options,
            ) =>
                bootstrapState.transition(
                    nextState,
                    options,
                ),

        canTransition:
            nextState =>
                bootstrapState.canTransition(
                    nextState,
                ),

        /**
         * Bootstrap phases.
         */
        beginDiscovery,

        beginLoading,

        beginNormalization,

        beginValidation,

        startPhase:
            (
                phase,
                metadata,
            ) =>
                bootstrapState.startPhase(
                    phase,
                    metadata,
                ),

        completePhase:
            (
                phase,
                result,
            ) =>
                bootstrapState.completePhase(
                    phase,
                    result,
                ),

        failPhase:
            (
                phase,
                error,
                metadata,
            ) =>
                bootstrapState.failPhase(
                    phase,
                    error,
                    metadata,
                ),

        skipPhase:
            (
                phase,
                reason,
            ) =>
                bootstrapState.skipPhase(
                    phase,
                    reason,
                ),

        getPhase:
            phase =>
                bootstrapState.getPhase(
                    phase,
                ),

        getPhaseStatus:
            phase =>
                bootstrapState.getPhaseStatus(
                    phase,
                ),

        /**
         * Environment metadata.
         */
        setEnvironment,

        isSupportedEnvironment,

        normalizeEnvironment,

        setDiscovery,

        setDotenv,

        setNormalization,

        setValidation,

        setFingerprint,

        /**
         * Diagnostics.
         */
        recordWarning:
            (
                warning,
                metadata,
            ) =>
                bootstrapState.recordWarning(
                    warning,
                    metadata,
                ),

        recordError:
            (
                error,
                metadata,
            ) =>
                bootstrapState.recordError(
                    error,
                    metadata,
                ),

        getMissingRequiredPhases:
            () =>
                bootstrapState.getMissingRequiredPhases(),

        hasCompletedRequiredPhases:
            () =>
                bootstrapState.hasCompletedRequiredPhases(),

        readiness:
            () =>
                bootstrapState.readiness(),

        health:
            () =>
                bootstrapState.health(),

        snapshot:
            options =>
                bootstrapState.snapshot(
                    options,
                ),

        /**
         * Basic state helpers.
         */
        isCreated:
            () =>
                bootstrapState.isCreated(),

        isReady:
            () =>
                bootstrapState.isReady(),

        isFailed:
            () =>
                bootstrapState.isFailed(),

        isStopped:
            () =>
                bootstrapState.isStopped(),

        isTerminal:
            () =>
                bootstrapState.isTerminal(),

        /**
         * Test support.
         */
        reset:
            options =>
                bootstrapState.reset(
                    options,
                ),
    });