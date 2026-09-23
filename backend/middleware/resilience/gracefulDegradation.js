'use strict';

/**
 * =============================================================================
 * TITech Community Capital Ltd
 * Community Savings Platform
 * =============================================================================
 *
 * Enterprise Graceful Degradation Engine
 *
 * File:
 *   backend/middleware/resilience/gracefulDegradation.js
 *
 * -----------------------------------------------------------------------------
 * Overview
 * -----------------------------------------------------------------------------
 *
 * Enterprise-grade graceful degradation engine responsible for maintaining
 * application availability when dependencies become degraded, unavailable,
 * overloaded, or temporarily unhealthy.
 *
 * Rather than failing entire requests, the engine intelligently executes
 * configurable fallback strategies while preserving critical business
 * functionality.
 *
 * This module is designed for cloud-native, multi-tenant, enterprise systems
 * and integrates with:
 *
 * • Circuit Breakers
 * • Retry Runtime
 * • Timeout Middleware
 * • Health Registry
 * • Feature Flags
 * • Runtime Bootstrap
 * • Diagnostics
 * • Structured Logging
 * • OpenTelemetry
 * • Prometheus
 *
 * =============================================================================
 */

const EventEmitter = require('events');
const crypto = require('crypto');

const MODULE_NAME = 'gracefulDegradation';

const MODULE_VERSION = '1.0.0';

const MODULE_DESCRIPTION =
    'Enterprise Graceful Degradation Engine';

const MODULE_AUTHOR =
    'TITech Community Capital Ltd';

const MODULE_NAMESPACE =
    'middleware.resilience.gracefulDegradation';

const MODULE_CREATED =
    new Date().toISOString();

/* ============================================================================
 * Symbols
 * ========================================================================== */

const kInternalState = Symbol('internalState');

const kMetrics = Symbol('metrics');

const kPolicies = Symbol('policies');

const kFallbacks = Symbol('fallbacks');

const kDiagnostics = Symbol('diagnostics');

/* ============================================================================
 * Runtime Metadata
 * ========================================================================== */

const METADATA = Object.freeze({

    name: MODULE_NAME,

    version: MODULE_VERSION,

    namespace: MODULE_NAMESPACE,

    description: MODULE_DESCRIPTION,

    author: MODULE_AUTHOR,

    created: MODULE_CREATED,

    runtime: process.release.name,

    nodeVersion: process.version
});

/* ============================================================================
 * Degradation Levels
 * ========================================================================== */

const DEGRADATION_LEVELS = Object.freeze({

    NORMAL: 'NORMAL',

    MINOR: 'MINOR',

    MODERATE: 'MODERATE',

    SEVERE: 'SEVERE',

    CRITICAL: 'CRITICAL'
});

/* ============================================================================
 * Middleware State
 * ========================================================================== */

const ENGINE_STATE = Object.freeze({

    STARTING: 'STARTING',

    READY: 'READY',

    DEGRADED: 'DEGRADED',

    RECOVERING: 'RECOVERING',

    STOPPING: 'STOPPING',

    STOPPED: 'STOPPED'
});

/* ============================================================================
 * Fallback Strategies
 * ========================================================================== */

const FALLBACK_STRATEGIES = Object.freeze({

    NONE: 'NONE',

    CACHE: 'CACHE',

    STATIC: 'STATIC',

    DEFAULT: 'DEFAULT',

    EMPTY: 'EMPTY',

    FUNCTION: 'FUNCTION',

    SERVICE: 'SERVICE',

    READ_ONLY: 'READ_ONLY',

    PARTIAL: 'PARTIAL',

    RETRY_LATER: 'RETRY_LATER',

    QUEUE: 'QUEUE'
});

/* ============================================================================
 * Dependency Health
 * ========================================================================== */

const HEALTH_STATUS = Object.freeze({

    HEALTHY: 'HEALTHY',

    DEGRADED: 'DEGRADED',

    UNAVAILABLE: 'UNAVAILABLE',

    MAINTENANCE: 'MAINTENANCE',

    UNKNOWN: 'UNKNOWN'
});

/* ============================================================================
 * Events
 * ========================================================================== */

const EVENTS = Object.freeze({

    INITIALIZED: 'initialized',

    STARTED: 'started',

    STOPPED: 'stopped',

    DEGRADATION_STARTED: 'degradationStarted',

    DEGRADATION_ENDED: 'degradationEnded',

    FALLBACK_EXECUTED: 'fallbackExecuted',

    FALLBACK_FAILED: 'fallbackFailed',

    RECOVERY_STARTED: 'recoveryStarted',

    RECOVERY_COMPLETED: 'recoveryCompleted',

    CONFIG_UPDATED: 'configurationUpdated',

    ERROR: 'error'
});

/* ============================================================================
 * Business Priorities
 * ========================================================================== */

const PRIORITY = Object.freeze({

    CRITICAL: 1,

    HIGH: 2,

    MEDIUM: 3,

    LOW: 4
});

/* ============================================================================
 * Enterprise Errors
 * ========================================================================== */

class GracefulDegradationError extends Error {

    constructor(message, metadata = {}) {

        super(message);

        this.name = this.constructor.name;

        this.code = 'GRACEFUL_DEGRADATION_ERROR';

        this.metadata = metadata;

        Error.captureStackTrace(
            this,
            this.constructor
        );
    }
}

class InvalidFallbackError
    extends GracefulDegradationError {

    constructor(strategy) {

        super(`Unsupported fallback strategy: ${strategy}`);

        this.code = 'INVALID_FALLBACK_STRATEGY';
    }
}

class PolicyResolutionError
    extends GracefulDegradationError {

    constructor(policy) {

        super(`Unable to resolve degradation policy: ${policy}`);

        this.code = 'POLICY_RESOLUTION_ERROR';
    }
}

class DependencyUnavailableError
    extends GracefulDegradationError {

    constructor(service) {

        super(`Dependency unavailable: ${service}`);

        this.code = 'DEPENDENCY_UNAVAILABLE';
    }
}

class FallbackExecutionError
    extends GracefulDegradationError {

    constructor(strategy) {

        super(`Fallback execution failed: ${strategy}`);

        this.code = 'FALLBACK_EXECUTION_FAILED';
    }
}

/* ============================================================================
 * Default Configuration
 * ========================================================================== */

const DEFAULT_CONFIGURATION = Object.freeze({

    enabled: true,

    autoRecovery: true,

    emitEvents: true,

    diagnostics: true,

    metrics: true,

    logging: true,

    tracing: true,

    strictMode: false,

    cacheFallbacks: true,

    maximumFallbackDepth: 3,

    recoveryInterval: 30000,

    healthCheckInterval: 10000,

    defaultPriority: PRIORITY.MEDIUM,

    degradationLevel:
        DEGRADATION_LEVELS.NORMAL,

    defaultStrategy:
        FALLBACK_STRATEGIES.DEFAULT
});

/* ============================================================================
 * Immutable Runtime Defaults
 * ========================================================================== */

const EMPTY_OBJECT = Object.freeze({});

const EMPTY_ARRAY = Object.freeze([]);

/* ============================================================================
 * Validation Helpers
 * ========================================================================== */

function isFunction(value) {

    return typeof value === 'function';
}

function isObject(value) {

    return value !== null &&
        typeof value === 'object';
}

function isString(value) {

    return typeof value === 'string';
}

function isBoolean(value) {

    return typeof value === 'boolean';
}

function assertFunction(fn, name) {

    if (!isFunction(fn)) {

        throw new TypeError(
            `${name} must be a function.`
        );
    }
}

function assertObject(obj, name) {

    if (!isObject(obj)) {

        throw new TypeError(
            `${name} must be an object.`
        );
    }
}

/* ============================================================================
 * Utility Helpers
 * ========================================================================== */

function now() {

    return Date.now();
}

function generateIdentifier() {

    return crypto.randomUUID
        ? crypto.randomUUID()
        : crypto.randomBytes(16).toString('hex');
}

function deepFreeze(object) {

    Object.freeze(object);

    Object.getOwnPropertyNames(object).forEach(key => {

        const value = object[key];

        if (
            value &&
            typeof value === 'object' &&
            !Object.isFrozen(value)
        ) {
            deepFreeze(value);
        }

    });

    return object;
}

/* ============================================================================
 * Initial Runtime State
 * ========================================================================== */

const INITIAL_STATE = deepFreeze({

    status: ENGINE_STATE.STARTING,

    degradationLevel:
        DEGRADATION_LEVELS.NORMAL,

    initialized: false,

    startedAt: null,

    lastRecovery: null,

    requestCount: 0,

    degradedRequests: 0,

    fallbackExecutions: 0
});

/* =============================================================================
 * 2.1.1.1 Internal Runtime Symbols
 * -----------------------------------------------------------------------------
 * Enterprise internal runtime infrastructure.
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Private symbol definitions
 * • Hidden runtime state
 * • Internal storage keys
 * • Runtime capability flags
 * • Symbol registry
 * • Hidden metadata containers
 * * ========================================================================== */

/**
 * Global symbol namespace.
 *
 * Using Symbol.for() ensures that symbols are shared across modules within the
 * same Node.js runtime while remaining hidden from normal property enumeration.
 */

const SYMBOL_NAMESPACE =
    'titech.resilience.gracefulDegradation';

/* -----------------------------------------------------------------------------
 * Runtime Identity
 * -------------------------------------------------------------------------- */

const kEngineId =
    Symbol.for(`${SYMBOL_NAMESPACE}.engineId`);

const kInstanceId =
    Symbol.for(`${SYMBOL_NAMESPACE}.instanceId`);

const kRuntimeId =
    Symbol.for(`${SYMBOL_NAMESPACE}.runtimeId`);

/* -----------------------------------------------------------------------------
 * Internal State
 * -------------------------------------------------------------------------- */

const kState =
    Symbol.for(`${SYMBOL_NAMESPACE}.state`);

const kStatus =
    Symbol.for(`${SYMBOL_NAMESPACE}.status`);

const kLifecycle =
    Symbol.for(`${SYMBOL_NAMESPACE}.lifecycle`);

const kInitialized =
    Symbol.for(`${SYMBOL_NAMESPACE}.initialized`);

const kStarted =
    Symbol.for(`${SYMBOL_NAMESPACE}.started`);

const kShutdown =
    Symbol.for(`${SYMBOL_NAMESPACE}.shutdown`);

/* -----------------------------------------------------------------------------
 * Configuration
 * -------------------------------------------------------------------------- */

const kConfiguration =
    Symbol.for(`${SYMBOL_NAMESPACE}.configuration`);

const kResolvedConfiguration =
    Symbol.for(`${SYMBOL_NAMESPACE}.resolvedConfiguration`);

const kPolicy =
    Symbol.for(`${SYMBOL_NAMESPACE}.policy`);

const kPolicies =
    Symbol.for(`${SYMBOL_NAMESPACE}.policies`);

/* -----------------------------------------------------------------------------
 * Strategy Infrastructure
 * -------------------------------------------------------------------------- */

const kStrategy =
    Symbol.for(`${SYMBOL_NAMESPACE}.strategy`);

const kStrategies =
    Symbol.for(`${SYMBOL_NAMESPACE}.strategies`);

const kStrategyRegistry =
    Symbol.for(`${SYMBOL_NAMESPACE}.strategyRegistry`);

const kFallback =
    Symbol.for(`${SYMBOL_NAMESPACE}.fallback`);

const kFallbackChain =
    Symbol.for(`${SYMBOL_NAMESPACE}.fallbackChain`);

/* -----------------------------------------------------------------------------
 * Request Context
 * -------------------------------------------------------------------------- */

const kContext =
    Symbol.for(`${SYMBOL_NAMESPACE}.context`);

const kExecutionContext =
    Symbol.for(`${SYMBOL_NAMESPACE}.executionContext`);

const kRequestContext =
    Symbol.for(`${SYMBOL_NAMESPACE}.requestContext`);

const kTenantContext =
    Symbol.for(`${SYMBOL_NAMESPACE}.tenantContext`);

const kCorrelationContext =
    Symbol.for(`${SYMBOL_NAMESPACE}.correlationContext`);

/* -----------------------------------------------------------------------------
 * Execution
 * -------------------------------------------------------------------------- */

const kExecution =
    Symbol.for(`${SYMBOL_NAMESPACE}.execution`);

const kExecutionResult =
    Symbol.for(`${SYMBOL_NAMESPACE}.executionResult`);

const kExecutionMetadata =
    Symbol.for(`${SYMBOL_NAMESPACE}.executionMetadata`);

const kExecutionStart =
    Symbol.for(`${SYMBOL_NAMESPACE}.executionStart`);

const kExecutionEnd =
    Symbol.for(`${SYMBOL_NAMESPACE}.executionEnd`);

/* -----------------------------------------------------------------------------
 * Health
 * -------------------------------------------------------------------------- */

const kHealth =
    Symbol.for(`${SYMBOL_NAMESPACE}.health`);

const kHealthSnapshot =
    Symbol.for(`${SYMBOL_NAMESPACE}.healthSnapshot`);

const kHealthProvider =
    Symbol.for(`${SYMBOL_NAMESPACE}.healthProvider`);

/* -----------------------------------------------------------------------------
 * Observability
 * -------------------------------------------------------------------------- */

const kMetrics =
    Symbol.for(`${SYMBOL_NAMESPACE}.metrics`);

const kLogger =
    Symbol.for(`${SYMBOL_NAMESPACE}.logger`);

const kTracer =
    Symbol.for(`${SYMBOL_NAMESPACE}.tracer`);

const kDiagnostics =
    Symbol.for(`${SYMBOL_NAMESPACE}.diagnostics`);

const kTelemetry =
    Symbol.for(`${SYMBOL_NAMESPACE}.telemetry`);

const kAudit =
    Symbol.for(`${SYMBOL_NAMESPACE}.audit`);

/* -----------------------------------------------------------------------------
 * Events
 * -------------------------------------------------------------------------- */

const kEvents =
    Symbol.for(`${SYMBOL_NAMESPACE}.events`);

const kEmitter =
    Symbol.for(`${SYMBOL_NAMESPACE}.eventEmitter`);

const kListeners =
    Symbol.for(`${SYMBOL_NAMESPACE}.listeners`);

/* -----------------------------------------------------------------------------
 * Runtime Storage
 * -------------------------------------------------------------------------- */

const kCache =
    Symbol.for(`${SYMBOL_NAMESPACE}.cache`);

const kQueue =
    Symbol.for(`${SYMBOL_NAMESPACE}.queue`);

const kServices =
    Symbol.for(`${SYMBOL_NAMESPACE}.services`);

const kDependencies =
    Symbol.for(`${SYMBOL_NAMESPACE}.dependencies`);

const kRuntime =
    Symbol.for(`${SYMBOL_NAMESPACE}.runtime`);

/* -----------------------------------------------------------------------------
 * Hidden Runtime State
 * -------------------------------------------------------------------------- */

/**
 * Creates the hidden runtime state for an engine instance.
 *
 * This object is never exposed publicly.
 */

function createHiddenRuntimeState() {

    return {

        [kInitialized]: false,

        [kStarted]: false,

        [kShutdown]: false,

        [kState]: null,

        [kStatus]: null,

        [kConfiguration]: null,

        [kResolvedConfiguration]: null,

        [kPolicies]: new Map(),

        [kStrategies]: new Map(),

        [kCache]: new Map(),

        [kQueue]: null,

        [kMetrics]: null,

        [kLogger]: null,

        [kTracer]: null,

        [kDiagnostics]: null,

        [kTelemetry]: null,

        [kAudit]: null,

        [kServices]: new Map(),

        [kDependencies]: new Map(),

        [kEmitter]: null,

        [kListeners]: new Map(),

        [kRuntime]: Object.create(null)
    };
}

/* -----------------------------------------------------------------------------
 * Runtime Symbol Registry
 * -------------------------------------------------------------------------- */

/**
 * Frozen registry used by diagnostics and runtime inspection without exposing
 * internal implementation details.
 */

const RUNTIME_SYMBOLS = Object.freeze({

    kEngineId,
    kInstanceId,
    kRuntimeId,

    kState,
    kStatus,
    kLifecycle,

    kInitialized,
    kStarted,
    kShutdown,

    kConfiguration,
    kResolvedConfiguration,

    kPolicy,
    kPolicies,

    kStrategy,
    kStrategies,
    kStrategyRegistry,

    kFallback,
    kFallbackChain,

    kContext,
    kExecutionContext,
    kRequestContext,
    kTenantContext,
    kCorrelationContext,

    kExecution,
    kExecutionResult,
    kExecutionMetadata,
    kExecutionStart,
    kExecutionEnd,

    kHealth,
    kHealthSnapshot,
    kHealthProvider,

    kMetrics,
    kLogger,
    kTracer,
    kDiagnostics,
    kTelemetry,
    kAudit,

    kEvents,
    kEmitter,
    kListeners,

    kCache,
    kQueue,
    kServices,
    kDependencies,
    kRuntime
});

Object.freeze(RUNTIME_SYMBOLS);

/* -----------------------------------------------------------------------------
 * Internal Helper
 * -------------------------------------------------------------------------- */

/**
 * Returns a fresh hidden runtime state.
 *
 * Every engine instance receives its own isolated internal state while sharing
 * the same symbol definitions.
 */

function initializeRuntimeSymbols(target) {

    Object.defineProperty(
        target,
        kRuntime,
        {
            value: createHiddenRuntimeState(),
            enumerable: false,
            configurable: false,
            writable: false
        }
    );

    return target;
}

/* =============================================================================
 * 2.1.1.2.1 Execution Status & Lifecycle Enums
 * -----------------------------------------------------------------------------
 *
 * Enterprise runtime state definitions.
 *
 * Responsibilities:
 *
 * ✓ Execution lifecycle tracking
 * ✓ Engine lifecycle management
 * ✓ Recovery state management
 * ✓ Dependency health classification
 * ✓ Runtime diagnostics support
 * ✓ Immutable state definitions
 *
 * ============================================================================= */


/**
 * -----------------------------------------------------------------------------
 * Execution Status
 * -----------------------------------------------------------------------------
 *
 * Represents the lifecycle of an individual degradation execution request.
 *
 * Flow:
 *
 * CREATED
 *    |
 *    v
 * STARTED
 *    |
 *    +----------------+
 *    |                |
 *    v                v
 * COMPLETED       FAILED
 *
 * Additional states support:
 *
 * - fallback execution
 * - cancellation
 * - timeout
 * - recovery processing
 */

const EXECUTION_STATUS = Object.freeze({

    CREATED: 'CREATED',

    VALIDATING:
        'VALIDATING',

    STARTED:
        'STARTED',

    RUNNING:
        'RUNNING',

    FALLBACK_REQUIRED:
        'FALLBACK_REQUIRED',

    FALLBACK_RUNNING:
        'FALLBACK_RUNNING',

    FALLBACK_COMPLETED:
        'FALLBACK_COMPLETED',

    COMPLETED:
        'COMPLETED',

    FAILED:
        'FAILED',

    TIMEOUT:
        'TIMEOUT',

    CANCELLED:
        'CANCELLED',

    REJECTED:
        'REJECTED',

    UNKNOWN:
        'UNKNOWN'
});


/**
 * -----------------------------------------------------------------------------
 * Lifecycle Status
 * -----------------------------------------------------------------------------
 *
 * Represents the lifecycle state of the degradation engine itself.
 *
 * Engine lifecycle:
 *
 * CREATED
 *    |
 * INITIALIZING
 *    |
 * READY
 *    |
 * DEGRADED
 *    |
 * RECOVERING
 *    |
 * STOPPING
 *    |
 * STOPPED
 */

const LIFECYCLE_STATUS = Object.freeze({

    CREATED:
        'CREATED',

    INITIALIZING:
        'INITIALIZING',

    INITIALIZED:
        'INITIALIZED',

    STARTING:
        'STARTING',

    READY:
        'READY',

    RUNNING:
        'RUNNING',

    DEGRADED:
        'DEGRADED',

    RECOVERING:
        'RECOVERING',

    DRAINING:
        'DRAINING',

    STOPPING:
        'STOPPING',

    STOPPED:
        'STOPPED',

    FAILED:
        'FAILED'
});


/**
 * -----------------------------------------------------------------------------
 * Recovery Status
 * -----------------------------------------------------------------------------
 *
 * Tracks dependency and service recovery workflows.
 *
 * Used by:
 *
 * - Circuit breaker integration
 * - Health monitoring
 * - Automatic recovery
 * - Dependency restoration
 */

const RECOVERY_STATUS = Object.freeze({

    NOT_REQUIRED:
        'NOT_REQUIRED',

    DETECTED:
        'DETECTED',

    SCHEDULED:
        'SCHEDULED',

    STARTED:
        'STARTED',

    IN_PROGRESS:
        'IN_PROGRESS',

    VALIDATING:
        'VALIDATING',

    SUCCESSFUL:
        'SUCCESSFUL',

    PARTIAL:
        'PARTIAL',

    FAILED:
        'FAILED',

    ABORTED:
        'ABORTED',

    UNKNOWN:
        'UNKNOWN'
});


/**
 * -----------------------------------------------------------------------------
 * Health Status
 * -----------------------------------------------------------------------------
 *
 * Standard dependency health classification.
 *
 * Compatible with:
 *
 * - Kubernetes probes
 * - Service registry
 * - Runtime diagnostics
 * - Dependency monitoring
 */

const HEALTH_STATUS = Object.freeze({

    HEALTHY:
        'HEALTHY',

    DEGRADED:
        'DEGRADED',

    LIMITED:
        'LIMITED',

    UNAVAILABLE:
        'UNAVAILABLE',

    TIMEOUT:
        'TIMEOUT',

    FAILED:
        'FAILED',

    UNKNOWN:
        'UNKNOWN',

    MAINTENANCE:
        'MAINTENANCE'
});


/**
 * -----------------------------------------------------------------------------
 * Lifecycle Transitions
 * -----------------------------------------------------------------------------
 *
 * Allowed transitions prevent invalid runtime state changes.
 *
 * Example:
 *
 * READY -> STOPPED
 *
 * is invalid unless shutdown begins.
 */

const LIFECYCLE_TRANSITIONS = Object.freeze({

    CREATED: [
        LIFECYCLE_STATUS.INITIALIZING
    ],

    INITIALIZING: [
        LIFECYCLE_STATUS.INITIALIZED,
        LIFECYCLE_STATUS.FAILED
    ],

    INITIALIZED: [
        LIFECYCLE_STATUS.STARTING,
        LIFECYCLE_STATUS.STOPPING
    ],

    STARTING: [
        LIFECYCLE_STATUS.READY,
        LIFECYCLE_STATUS.FAILED
    ],

    READY: [
        LIFECYCLE_STATUS.RUNNING,
        LIFECYCLE_STATUS.DEGRADED,
        LIFECYCLE_STATUS.STOPPING
    ],

    RUNNING: [
        LIFECYCLE_STATUS.DEGRADED,
        LIFECYCLE_STATUS.STOPPING
    ],

    DEGRADED: [
        LIFECYCLE_STATUS.RECOVERING,
        LIFECYCLE_STATUS.STOPPING
    ],

    RECOVERING: [
        LIFECYCLE_STATUS.READY,
        LIFECYCLE_STATUS.RUNNING,
        LIFECYCLE_STATUS.DEGRADED
    ],

    DRAINING: [
        LIFECYCLE_STATUS.STOPPED
    ],

    STOPPING: [
        LIFECYCLE_STATUS.STOPPED
    ],

    STOPPED: [],

    FAILED: [
        LIFECYCLE_STATUS.STOPPING
    ]
});


/**
 * -----------------------------------------------------------------------------
 * Execution Terminal States
 * -----------------------------------------------------------------------------
 *
 * Used by metrics and diagnostics to determine completed executions.
 */

const TERMINAL_EXECUTION_STATES = Object.freeze([

    EXECUTION_STATUS.COMPLETED,

    EXECUTION_STATUS.FAILED,

    EXECUTION_STATUS.TIMEOUT,

    EXECUTION_STATUS.CANCELLED,

    EXECUTION_STATUS.REJECTED
]);


/**
 * -----------------------------------------------------------------------------
 * Recovery Terminal States
 * -----------------------------------------------------------------------------
 */

const TERMINAL_RECOVERY_STATES = Object.freeze([

    RECOVERY_STATUS.SUCCESSFUL,

    RECOVERY_STATUS.PARTIAL,

    RECOVERY_STATUS.FAILED,

    RECOVERY_STATUS.ABORTED
]);


/**
 * -----------------------------------------------------------------------------
 * State Helper Utilities
 * -----------------------------------------------------------------------------
 */

function isExecutionCompleted(status) {

    return TERMINAL_EXECUTION_STATES.includes(
        status
    );
}


function isRecoveryCompleted(status) {

    return TERMINAL_RECOVERY_STATES.includes(
        status
    );
}


function isLifecycleTransitionAllowed(
    current,
    next
) {

    const allowed =
        LIFECYCLE_TRANSITIONS[current];

    if (!allowed) {
        return false;
    }

    return allowed.includes(next);
}


function isHealthy(status) {

    return status === HEALTH_STATUS.HEALTHY;
}


function isDegraded(status) {

    return [

        HEALTH_STATUS.DEGRADED,

        HEALTH_STATUS.LIMITED

    ].includes(status);
}

/* =============================================================================
 * 2.1.1.2.2 Strategy & Result Enums
 * -----------------------------------------------------------------------------
 *
 * Enterprise fallback strategy classification.
 *
 * Responsibilities:
 *
 * ✓ Fallback strategy definitions
 * ✓ Execution result classification
 * ✓ Severity modelling
 * ✓ Priority handling
 * ✓ Execution mode control
 * ✓ Response behaviour classification
 * ✓ Strategy engine integration
 *
 * ============================================================================= */


/**
 * -----------------------------------------------------------------------------
 * Fallback Strategy Types
 * -----------------------------------------------------------------------------
 *
 * Defines all supported degradation strategies.
 *
 * Strategy selection is performed by:
 *
 * - degradation policy
 * - dependency health
 * - tenant configuration
 * - business criticality
 * - runtime conditions
 */

const STRATEGY_TYPES = Object.freeze({

    NONE:
        'NONE',

    STATIC:
        'STATIC',

    CACHE:
        'CACHE',

    ASYNC:
        'ASYNC',

    DELEGATE:
        'DELEGATE',

    READ_ONLY:
        'READ_ONLY',

    PARTIAL:
        'PARTIAL',

    QUEUE:
        'QUEUE',

    DEFAULT:
        'DEFAULT',

    EMPTY:
        'EMPTY',

    RETRY_LATER:
        'RETRY_LATER',

    CUSTOM:
        'CUSTOM'
});


/**
 * -----------------------------------------------------------------------------
 * Strategy Execution Modes
 * -----------------------------------------------------------------------------
 *
 * Controls how a strategy is executed.
 */

const EXECUTION_MODES = Object.freeze({

    SYNCHRONOUS:
        'SYNCHRONOUS',

    ASYNCHRONOUS:
        'ASYNCHRONOUS',

    PARALLEL:
        'PARALLEL',

    SEQUENTIAL:
        'SEQUENTIAL',

    FAIL_FAST:
        'FAIL_FAST',

    BEST_EFFORT:
        'BEST_EFFORT',

    BACKGROUND:
        'BACKGROUND',

    DEFERRED:
        'DEFERRED'
});


/**
 * -----------------------------------------------------------------------------
 * Result Status
 * -----------------------------------------------------------------------------
 *
 * Represents the outcome of strategy execution.
 *
 * Used by:
 *
 * - StrategyResult
 * - Metrics
 * - Diagnostics
 * - API response mapping
 */

const RESULT_STATUS = Object.freeze({

    SUCCESS:
        'SUCCESS',

    DEGRADED_SUCCESS:
        'DEGRADED_SUCCESS',

    FALLBACK_SUCCESS:
        'FALLBACK_SUCCESS',

    PARTIAL_SUCCESS:
        'PARTIAL_SUCCESS',

    QUEUED:
        'QUEUED',

    RETRY_REQUIRED:
        'RETRY_REQUIRED',

    FAILED:
        'FAILED',

    TIMEOUT:
        'TIMEOUT',

    CANCELLED:
        'CANCELLED',

    REJECTED:
        'REJECTED',

    UNKNOWN:
        'UNKNOWN'
});


/**
 * -----------------------------------------------------------------------------
 * Severity Levels
 * -----------------------------------------------------------------------------
 *
 * Used for:
 *
 * - Logging
 * - Alerts
 * - Diagnostics
 * - Incident management
 */

const SEVERITY_LEVELS = Object.freeze({

    TRACE:
        'TRACE',

    DEBUG:
        'DEBUG',

    INFO:
        'INFO',

    WARNING:
        'WARNING',

    ERROR:
        'ERROR',

    CRITICAL:
        'CRITICAL',

    EMERGENCY:
        'EMERGENCY'
});


/**
 * -----------------------------------------------------------------------------
 * Priority Classes
 * -----------------------------------------------------------------------------
 *
 * Determines execution preference during degraded operation.
 *
 * Lower number = higher priority.
 */

const PRIORITY_CLASSES = Object.freeze({

    CRITICAL:
        Object.freeze({

            value: 1,

            name: 'CRITICAL',

            description:
                'Financial and security operations'
        }),


    HIGH:
        Object.freeze({

            value: 2,

            name: 'HIGH',

            description:
                'Important business workflows'
        }),


    MEDIUM:
        Object.freeze({

            value: 3,

            name: 'MEDIUM',

            description:
                'Standard business operations'
        }),


    LOW:
        Object.freeze({

            value: 4,

            name: 'LOW',

            description:
                'Optional functionality'
        })
});


/**
 * -----------------------------------------------------------------------------
 * Response Behaviour Classification
 * -----------------------------------------------------------------------------
 *
 * Defines how degraded responses should be returned.
 */

const RESPONSE_BEHAVIOURS = Object.freeze({

    NORMAL:

        'NORMAL',


    FALLBACK:

        'FALLBACK',


    CACHED:

        'CACHED',


    PARTIAL:

        'PARTIAL',


    EMPTY:

        'EMPTY',


    READ_ONLY:

        'READ_ONLY',


    ACCEPTED:

        'ACCEPTED',


    QUEUED:

        'QUEUED',


    UNAVAILABLE:

        'UNAVAILABLE'
});


/**
 * -----------------------------------------------------------------------------
 * Data Freshness Levels
 * -----------------------------------------------------------------------------
 *
 * Used mainly by cached fallback strategies.
 */

const DATA_FRESHNESS = Object.freeze({

    LIVE:
        'LIVE',

    RECENT:
        'RECENT',

    STALE:
        'STALE',

    EXPIRED:
        'EXPIRED',

    UNKNOWN:
        'UNKNOWN'
});


/**
 * -----------------------------------------------------------------------------
 * Strategy Capabilities
 * -----------------------------------------------------------------------------
 *
 * Used by Strategy Registry when selecting compatible strategies.
 */

const STRATEGY_CAPABILITIES = Object.freeze({

    SUPPORTS_CACHE:
        'SUPPORTS_CACHE',

    SUPPORTS_ASYNC:
        'SUPPORTS_ASYNC',

    SUPPORTS_QUEUE:
        'SUPPORTS_QUEUE',

    SUPPORTS_PARTIAL:
        'SUPPORTS_PARTIAL',

    SUPPORTS_READ_ONLY:
        'SUPPORTS_READ_ONLY',

    SUPPORTS_TENANT_POLICY:
        'SUPPORTS_TENANT_POLICY',

    SUPPORTS_RECOVERY:
        'SUPPORTS_RECOVERY'
});


/**
 * -----------------------------------------------------------------------------
 * Failure Classification
 * -----------------------------------------------------------------------------
 *
 * Helps determine whether degradation should activate.
 */

const FAILURE_TYPES = Object.freeze({

    TIMEOUT:
        'TIMEOUT',

    NETWORK:
        'NETWORK',

    DEPENDENCY:
        'DEPENDENCY',

    RATE_LIMIT:
        'RATE_LIMIT',

    VALIDATION:
        'VALIDATION',

    AUTHENTICATION:
        'AUTHENTICATION',

    AUTHORIZATION:
        'AUTHORIZATION',

    SYSTEM:
        'SYSTEM',

    UNKNOWN:
        'UNKNOWN'
});


/**
 * -----------------------------------------------------------------------------
 * Strategy Helper Utilities
 * -----------------------------------------------------------------------------
 */


function isFallbackStrategy(type) {

    return Object.values(
        STRATEGY_TYPES
    ).includes(type);
}


function isSuccessfulResult(status) {

    return [

        RESULT_STATUS.SUCCESS,

        RESULT_STATUS.DEGRADED_SUCCESS,

        RESULT_STATUS.FALLBACK_SUCCESS,

        RESULT_STATUS.PARTIAL_SUCCESS,

        RESULT_STATUS.QUEUED

    ].includes(status);
}


function requiresFallback(status) {

    return [

        RESULT_STATUS.FAILED,

        RESULT_STATUS.TIMEOUT,

        RESULT_STATUS.RETRY_REQUIRED

    ].includes(status);
}


function isCriticalPriority(priority) {

    return (
        priority &&
        priority.value ===
        PRIORITY_CLASSES.CRITICAL.value
    );
}


function supportsCapability(
    capabilities,
    capability
) {

    return Array.isArray(capabilities) &&
        capabilities.includes(capability);
}

/* =============================================================================
 * 2.1.1.2.3 Enterprise Error Codes & Reserved Metadata
 * -----------------------------------------------------------------------------
 *
 * Enterprise error classification and metadata contract.
 *
 * Responsibilities:
 *
 * ✓ Graceful degradation error taxonomy
 * ✓ Runtime error codes
 * ✓ Diagnostic identifiers
 * ✓ Correlation metadata
 * ✓ Tenant context metadata
 * ✓ Distributed tracing metadata
 * ✓ Audit metadata
 * ✓ Response metadata contracts
 * ✓ Observability standardization
 *
 * ============================================================================= */


/**
 * -----------------------------------------------------------------------------
 * Enterprise Error Domains
 * -----------------------------------------------------------------------------
 *
 * Provides logical grouping for operational diagnosis.
 */

const ERROR_DOMAINS = Object.freeze({

    ENGINE:
        'ENGINE',

    STRATEGY:
        'STRATEGY',

    FALLBACK:
        'FALLBACK',

    DEPENDENCY:
        'DEPENDENCY',

    EXECUTION:
        'EXECUTION',

    POLICY:
        'POLICY',

    CACHE:
        'CACHE',

    QUEUE:
        'QUEUE',

    SECURITY:
        'SECURITY',

    TENANT:
        'TENANT',

    SYSTEM:
        'SYSTEM'
});


/**
 * -----------------------------------------------------------------------------
 * Enterprise Error Codes
 * -----------------------------------------------------------------------------
 *
 * Stable machine-readable error identifiers.
 *
 * These codes must not change because they are consumed by:
 *
 * - Monitoring
 * - Alerting
 * - Dashboards
 * - Incident response
 * - Audit systems
 */

const ERROR_CODES = Object.freeze({

    /* Engine Errors */

    ENGINE_NOT_INITIALIZED:
        'GD_ENGINE_001',

    ENGINE_NOT_READY:
        'GD_ENGINE_002',

    ENGINE_SHUTDOWN:
        'GD_ENGINE_003',


    /* Strategy Errors */

    INVALID_STRATEGY:
        'GD_STRATEGY_001',

    STRATEGY_NOT_FOUND:
        'GD_STRATEGY_002',

    STRATEGY_EXECUTION_FAILED:
        'GD_STRATEGY_003',

    STRATEGY_TIMEOUT:
        'GD_STRATEGY_004',


    /* Fallback Errors */

    FALLBACK_UNAVAILABLE:
        'GD_FALLBACK_001',

    FALLBACK_EXECUTION_FAILED:
        'GD_FALLBACK_002',

    FALLBACK_CHAIN_EXHAUSTED:
        'GD_FALLBACK_003',

    FALLBACK_CONFIGURATION_INVALID:
        'GD_FALLBACK_004',


    /* Dependency Errors */

    DEPENDENCY_UNAVAILABLE:
        'GD_DEPENDENCY_001',

    DEPENDENCY_TIMEOUT:
        'GD_DEPENDENCY_002',

    DEPENDENCY_DEGRADED:
        'GD_DEPENDENCY_003',


    /* Execution Errors */

    EXECUTION_CANCELLED:
        'GD_EXECUTION_001',

    EXECUTION_TIMEOUT:
        'GD_EXECUTION_002',

    EXECUTION_REJECTED:
        'GD_EXECUTION_003',


    /* Policy Errors */

    POLICY_NOT_FOUND:
        'GD_POLICY_001',

    POLICY_INVALID:
        'GD_POLICY_002',


    /* Cache Errors */

    CACHE_MISS:
        'GD_CACHE_001',

    CACHE_EXPIRED:
        'GD_CACHE_002',

    CACHE_PROVIDER_FAILED:
        'GD_CACHE_003',


    /* Queue Errors */

    QUEUE_SUBMISSION_FAILED:
        'GD_QUEUE_001',

    QUEUE_UNAVAILABLE:
        'GD_QUEUE_002',


    /* Tenant Errors */

    TENANT_POLICY_INVALID:
        'GD_TENANT_001',

    TENANT_CONTEXT_MISSING:
        'GD_TENANT_002',


    /* System Errors */

    INTERNAL_ERROR:
        'GD_SYSTEM_001',

    UNKNOWN_ERROR:
        'GD_SYSTEM_999'
});


/**
 * -----------------------------------------------------------------------------
 * Diagnostic Identifiers
 * -----------------------------------------------------------------------------
 *
 * Used by logging, tracing, and incident investigation.
 */

const DIAGNOSTIC_KEYS = Object.freeze({

    ERROR_ID:
        'errorId',

    ERROR_CODE:
        'errorCode',

    ERROR_DOMAIN:
        'errorDomain',

    ERROR_MESSAGE:
        'errorMessage',

    FAILURE_REASON:
        'failureReason',

    FAILURE_TYPE:
        'failureType',

    COMPONENT:
        'component',

    MODULE:
        'module',

    OPERATION:
        'operation',

    STRATEGY:
        'strategy',

    DEPENDENCY:
        'dependency',

    TIMESTAMP:
        'timestamp'
});


/**
 * -----------------------------------------------------------------------------
 * Correlation Metadata
 * -----------------------------------------------------------------------------
 *
 * Distributed request tracking.
 */

const CORRELATION_METADATA = Object.freeze({

    REQUEST_ID:
        'requestId',

    CORRELATION_ID:
        'correlationId',

    TRACE_ID:
        'traceId',

    SPAN_ID:
        'spanId',

    PARENT_SPAN_ID:
        'parentSpanId',

    SESSION_ID:
        'sessionId'
});


/**
 * -----------------------------------------------------------------------------
 * Tenant Metadata
 * -----------------------------------------------------------------------------
 *
 * Multi-tenant SaaS context.
 */

const TENANT_METADATA = Object.freeze({

    TENANT_ID:
        'tenantId',

    TENANT_NAME:
        'tenantName',

    TENANT_PLAN:
        'tenantPlan',

    TENANT_FEATURES:
        'tenantFeatures',

    TENANT_LIMITS:
        'tenantLimits',

    TENANT_CONFIGURATION:
        'tenantConfiguration'
});


/**
 * -----------------------------------------------------------------------------
 * Distributed Trace Metadata
 * -----------------------------------------------------------------------------
 */

const TRACE_METADATA = Object.freeze({

    TRACE_FLAGS:
        'traceFlags',

    TRACE_STATE:
        'traceState',

    RESOURCE_NAME:
        'resourceName',

    SERVICE_NAME:
        'serviceName',

    SERVICE_VERSION:
        'serviceVersion',

    ENVIRONMENT:
        'environment'
});


/**
 * -----------------------------------------------------------------------------
 * Audit Metadata
 * -----------------------------------------------------------------------------
 *
 * Supports compliance and financial audit requirements.
 */

const AUDIT_METADATA = Object.freeze({

    ACTOR_ID:
        'actorId',

    ACTOR_TYPE:
        'actorType',

    ACTION:
        'action',

    RESOURCE:
        'resource',

    RESOURCE_ID:
        'resourceId',

    BEFORE_STATE:
        'beforeState',

    AFTER_STATE:
        'afterState',

    SOURCE:
        'source',

    IP_ADDRESS:
        'ipAddress',

    USER_AGENT:
        'userAgent'
});


/**
 * -----------------------------------------------------------------------------
 * Response Metadata Contract
 * -----------------------------------------------------------------------------
 *
 * Standard response enrichment returned during degradation.
 */

const RESPONSE_METADATA = Object.freeze({

    STATUS:
        'status',

    DEGRADED:
        'degraded',

    DEGRADED_LEVEL:
        'degradedLevel',

    FALLBACK_USED:
        'fallbackUsed',

    FALLBACK_STRATEGY:
        'fallbackStrategy',

    ORIGINAL_ERROR:
        'originalError',

    CACHE_STATUS:
        'cacheStatus',

    DATA_FRESHNESS:
        'dataFreshness',

    RETRY_AFTER:
        'retryAfter',

    WARNING:
        'warning'
});


/**
 * -----------------------------------------------------------------------------
 * Runtime Metadata Contract
 * -----------------------------------------------------------------------------
 */

const RUNTIME_METADATA = Object.freeze({

    NODE_ENV:
        'nodeEnv',

    INSTANCE_ID:
        'instanceId',

    HOSTNAME:
        'hostname',

    REGION:
        'region',

    VERSION:
        'version',

    START_TIME:
        'startTime'
});


/**
 * -----------------------------------------------------------------------------
 * Error Factory Helpers
 * -----------------------------------------------------------------------------
 */


function createErrorMetadata(data = {}) {

    return Object.freeze({

        [DIAGNOSTIC_KEYS.ERROR_ID]:

            generateErrorId(),

        [DIAGNOSTIC_KEYS.TIMESTAMP]:

            Date.now(),

        ...data
    });
}


function generateErrorId() {

    return (
        'err_' +
        Math.random()
            .toString(36)
            .substring(2, 15)
    );
}


/**
 * -----------------------------------------------------------------------------
 * Error Classification Helpers
 * -----------------------------------------------------------------------------
 */


function isKnownErrorCode(code) {

    return Object.values(
        ERROR_CODES
    ).includes(code);
}


function getErrorDomain(code) {

    const prefix =
        String(code)
            .split('_')[1];


    switch(prefix) {

        case 'ENGINE':
            return ERROR_DOMAINS.ENGINE;

        case 'STRATEGY':
            return ERROR_DOMAINS.STRATEGY;

        case 'FALLBACK':
            return ERROR_DOMAINS.FALLBACK;

        case 'DEPENDENCY':
            return ERROR_DOMAINS.DEPENDENCY;

        case 'EXECUTION':
            return ERROR_DOMAINS.EXECUTION;

        case 'POLICY':
            return ERROR_DOMAINS.POLICY;

        default:
            return ERROR_DOMAINS.SYSTEM;
    }
}

/* =============================================================================
 * 2.1.1.3 Validation Utilities
 * -----------------------------------------------------------------------------
 *
 * Enterprise validation framework.
 *
 * Responsibilities:
 *
 * ✓ Strategy validation
 * ✓ Context validation
 * ✓ Metadata validation
 * ✓ Configuration validation
 * ✓ Error validation
 * ✓ Runtime assertions
 * ✓ Type guards
 * ✓ Safe validation helpers
 *
 * ============================================================================= */


/**
 * -----------------------------------------------------------------------------
 * Primitive Type Guards
 * -----------------------------------------------------------------------------
 */

function isUndefined(value) {

    return typeof value === 'undefined';
}


function isNull(value) {

    return value === null;
}


function isDefined(value) {

    return (
        !isUndefined(value) &&
        !isNull(value)
    );
}


function isString(value) {

    return typeof value === 'string';
}


function isNonEmptyString(value) {

    return (
        isString(value) &&
        value.trim().length > 0
    );
}


function isNumber(value) {

    return (
        typeof value === 'number' &&
        !Number.isNaN(value)
    );
}


function isPositiveNumber(value) {

    return (
        isNumber(value) &&
        value > 0
    );
}


function isBoolean(value) {

    return typeof value === 'boolean';
}


function isFunction(value) {

    return typeof value === 'function';
}


function isArray(value) {

    return Array.isArray(value);
}


function isObject(value) {

    return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
    );
}


function isPromise(value) {

    return (
        value &&
        isFunction(value.then)
    );
}


/**
 * -----------------------------------------------------------------------------
 * Generic Runtime Assertions
 * -----------------------------------------------------------------------------
 */

function assert(condition, message, ErrorType = Error) {

    if (!condition) {

        throw new ErrorType(message);
    }
}


function assertDefined(
    value,
    name
) {

    assert(
        isDefined(value),
        `${name} is required.`
    );

    return value;
}


function assertString(
    value,
    name
) {

    assert(
        isNonEmptyString(value),
        `${name} must be a non-empty string.`
    );

    return value;
}


function assertFunction(
    value,
    name
) {

    assert(
        isFunction(value),
        `${name} must be a function.`
    );

    return value;
}


function assertObject(
    value,
    name
) {

    assert(
        isObject(value),
        `${name} must be an object.`
    );

    return value;
}


/**
 * -----------------------------------------------------------------------------
 * Strategy Validation
 * -----------------------------------------------------------------------------
 */

function validateStrategyType(
    strategy
) {

    assertString(
        strategy,
        'Strategy type'
    );


    assert(

        Object.values(
            STRATEGY_TYPES
        )
        .includes(strategy),

        `Unsupported strategy type: ${strategy}`

    );

    return true;
}


function validateStrategyDefinition(
    strategy
) {

    assertObject(
        strategy,
        'Strategy definition'
    );


    assertString(
        strategy.name,
        'Strategy name'
    );


    assertString(
        strategy.type,
        'Strategy type'
    );


    validateStrategyType(
        strategy.type
    );


    if (strategy.execute) {

        assertFunction(
            strategy.execute,
            'Strategy execute handler'
        );
    }


    return true;
}


/**
 * -----------------------------------------------------------------------------
 * Execution Context Validation
 * -----------------------------------------------------------------------------
 */

function validateExecutionContext(
    context
) {

    assertObject(
        context,
        'Execution context'
    );


    assertString(
        context.operation,
        'Context operation'
    );


    if (
        context.tenantId
    ) {

        assertString(
            context.tenantId,
            'Tenant ID'
        );
    }


    if (
        context.metadata
    ) {

        validateMetadata(
            context.metadata
        );
    }


    return true;
}


/**
 * -----------------------------------------------------------------------------
 * Metadata Validation
 * -----------------------------------------------------------------------------
 */

function validateMetadata(
    metadata
) {

    assertObject(
        metadata,
        'Metadata'
    );


    const maxKeys = 100;


    assert(

        Object.keys(metadata).length <= maxKeys,

        `Metadata exceeds maximum keys (${maxKeys}).`

    );


    return true;
}


/**
 * -----------------------------------------------------------------------------
 * Configuration Validation
 * -----------------------------------------------------------------------------
 */

function validateConfiguration(
    configuration
) {

    assertObject(
        configuration,
        'Configuration'
    );


    if (
        configuration.enabled !== undefined
    ) {

        assert(

            isBoolean(
                configuration.enabled
            ),

            'Configuration enabled must be boolean.'

        );
    }


    if (
        configuration.timeout
    ) {

        assert(

            isPositiveNumber(
                configuration.timeout
            ),

            'Timeout must be positive.'

        );
    }


    if (
        configuration.priority
    ) {

        assert(

            isObject(
                configuration.priority
            ),

            'Priority must be object.'

        );
    }


    return true;
}


/**
 * -----------------------------------------------------------------------------
 * Error Validation
 * -----------------------------------------------------------------------------
 */

function validateError(
    error
) {

    assert(

        error instanceof Error,

        'Invalid error object.'

    );


    if (
        error.code
    ) {

        assertString(
            error.code,
            'Error code'
        );
    }


    return true;
}


/**
 * -----------------------------------------------------------------------------
 * Result Validation
 * -----------------------------------------------------------------------------
 */

function validateResult(
    result
) {

    assertObject(
        result,
        'Execution result'
    );


    if (
        result.status
    ) {

        assert(

            Object.values(
                RESULT_STATUS
            )
            .includes(result.status),

            `Invalid result status: ${result.status}`

        );
    }


    return true;
}


/**
 * -----------------------------------------------------------------------------
 * Fallback Validation
 * -----------------------------------------------------------------------------
 */

function validateFallbackHandler(
    handler
) {

    assertFunction(
        handler,
        'Fallback handler'
    );


    return true;
}


/**
 * -----------------------------------------------------------------------------
 * Registry Validation
 * -----------------------------------------------------------------------------
 */

function validateRegistryName(
    name
) {

    assertString(
        name,
        'Registry name'
    );


    assert(

        /^[a-zA-Z0-9._-]+$/.test(name),

        'Invalid registry name.'

    );


    return true;
}


/**
 * -----------------------------------------------------------------------------
 * Runtime Safety Helpers
 * -----------------------------------------------------------------------------
 */

function safeExecute(
    fn,
    fallback = null
) {

    try {

        return fn();

    } catch(error) {

        return fallback;
    }
}


async function safeExecuteAsync(
    fn,
    fallback = null
) {

    try {

        return await fn();

    } catch(error) {

        return fallback;
    }
}


/**
 * -----------------------------------------------------------------------------
 * Validation Export Contract
 * -----------------------------------------------------------------------------
 *
 * Internal reference object for later Strategy classes.
 */

const VALIDATION_UTILITIES = Object.freeze({

    isDefined,

    isString,

    isNonEmptyString,

    isNumber,

    isPositiveNumber,

    isBoolean,

    isFunction,

    isArray,

    isObject,

    isPromise,

    assert,

    assertDefined,

    assertString,

    assertFunction,

    assertObject,

    validateStrategyType,

    validateStrategyDefinition,

    validateExecutionContext,

    validateMetadata,

    validateConfiguration,

    validateError,

    validateResult,

    validateFallbackHandler,

    validateRegistryName,

    safeExecute,

    safeExecuteAsync
});

/* =============================================================================
 * 2.1.2 StrategyExecutionContext
 * -----------------------------------------------------------------------------
 *
 * Enterprise execution context model.
 *
 * Responsibilities:
 *
 * ✓ Immutable execution context
 * ✓ Tenant propagation
 * ✓ Request context binding
 * ✓ Correlation tracking
 * ✓ Trace propagation
 * ✓ Dependency state tracking
 * ✓ Runtime metadata
 * ✓ Strategy helper methods
 * ✓ Context cloning
 * ✓ Context enrichment
 *
 * ============================================================================= */


class StrategyExecutionContext {


    /**
     * -------------------------------------------------------------------------
     * Constructor
     * -------------------------------------------------------------------------
     */

    constructor(options = {}) {


        validateConfiguration(
            options
        );


        this[kExecutionContext] =
            Object.freeze({

                id:
                    options.id ||
                    generateErrorId(),


                operation:
                    options.operation ||
                    'unknown',


                strategy:
                    options.strategy ||
                    null,


                tenant:
                    Object.freeze(
                        this.#buildTenantContext(
                            options.tenant
                        )
                    ),


                request:
                    Object.freeze(
                        this.#buildRequestContext(
                            options.request
                        )
                    ),


                correlation:
                    Object.freeze(
                        this.#buildCorrelationContext(
                            options.correlation
                        )
                    ),


                trace:
                    Object.freeze(
                        this.#buildTraceContext(
                            options.trace
                        )
                    ),


                dependency:
                    Object.freeze(
                        this.#buildDependencyContext(
                            options.dependency
                        )
                    ),


                runtime:
                    Object.freeze(
                        this.#buildRuntimeContext(
                            options.runtime
                        )
                    ),


                metadata:
                    Object.freeze(
                        {
                            ...(options.metadata || {})
                        }
                    ),


                createdAt:
                    Date.now()

            });


        Object.freeze(this);
    }



    /**
     * -------------------------------------------------------------------------
     * Tenant Context
     * -------------------------------------------------------------------------
     */

    #buildTenantContext(
        tenant = {}
    ) {

        return {

            tenantId:
                tenant.tenantId ||
                null,


            tenantPlan:
                tenant.tenantPlan ||
                null,


            features:
                tenant.features ||
                [],


            limits:
                tenant.limits ||
                {},


            configuration:
                tenant.configuration ||
                {}
        };
    }



    /**
     * -------------------------------------------------------------------------
     * Request Context
     * -------------------------------------------------------------------------
     */

    #buildRequestContext(
        request = {}
    ) {

        return {

            requestId:
                request.requestId ||
                null,


            method:
                request.method ||
                null,


            path:
                request.path ||
                null,


            userAgent:
                request.userAgent ||
                null,


            ip:
                request.ip ||
                null
        };
    }



    /**
     * -------------------------------------------------------------------------
     * Correlation Context
     * -------------------------------------------------------------------------
     */

    #buildCorrelationContext(
        correlation = {}
    ) {

        return {

            correlationId:

                correlation.correlationId ||
                generateErrorId(),


            sessionId:

                correlation.sessionId ||
                null,


            parentId:

                correlation.parentId ||
                null
        };
    }



    /**
     * -------------------------------------------------------------------------
     * Trace Context
     * -------------------------------------------------------------------------
     */

    #buildTraceContext(
        trace = {}
    ) {

        return {

            traceId:

                trace.traceId ||
                null,


            spanId:

                trace.spanId ||
                null,


            traceFlags:

                trace.traceFlags ||
                null,


            serviceName:

                trace.serviceName ||
                MODULE_NAME,


            serviceVersion:

                trace.serviceVersion ||
                MODULE_VERSION
        };
    }



    /**
     * -------------------------------------------------------------------------
     * Dependency Context
     * -------------------------------------------------------------------------
     */

    #buildDependencyContext(
        dependency = {}
    ) {

        return {

            name:

                dependency.name ||
                null,


            status:

                dependency.status ||
                HEALTH_STATUS.UNKNOWN,


            latency:

                dependency.latency ||
                null,


            attempts:

                dependency.attempts ||
                0,


            metadata:

                dependency.metadata ||
                {}
        };
    }



    /**
     * -------------------------------------------------------------------------
     * Runtime Context
     * -------------------------------------------------------------------------
     */

    #buildRuntimeContext(
        runtime = {}
    ) {

        return {

            environment:

                runtime.environment ||
                process.env.NODE_ENV ||
                'development',


            instanceId:

                runtime.instanceId ||
                null,


            region:

                runtime.region ||
                null,


            version:

                runtime.version ||
                MODULE_VERSION,


            hostname:

                runtime.hostname ||
                require('os').hostname()
        };
    }



    /**
     * -------------------------------------------------------------------------
     * Getters
     * -------------------------------------------------------------------------
     */


    get id() {

        return this[kExecutionContext].id;
    }


    get operation() {

        return this[kExecutionContext].operation;
    }


    get strategy() {

        return this[kExecutionContext].strategy;
    }


    get tenant() {

        return this[kExecutionContext].tenant;
    }


    get request() {

        return this[kExecutionContext].request;
    }


    get correlation() {

        return this[kExecutionContext].correlation;
    }


    get trace() {

        return this[kExecutionContext].trace;
    }


    get dependency() {

        return this[kExecutionContext].dependency;
    }


    get runtime() {

        return this[kExecutionContext].runtime;
    }


    get metadata() {

        return this[kExecutionContext].metadata;
    }



    /**
     * -------------------------------------------------------------------------
     * Strategy Helpers
     * -------------------------------------------------------------------------
     */


    hasTenant() {

        return Boolean(
            this.tenant.tenantId
        );
    }



    hasTrace() {

        return Boolean(
            this.trace.traceId
        );
    }



    isDependencyHealthy() {

        return (
            this.dependency.status ===
            HEALTH_STATUS.HEALTHY
        );
    }



    isDegraded() {

        return (
            this.dependency.status ===
                HEALTH_STATUS.DEGRADED ||
            this.dependency.status ===
                HEALTH_STATUS.LIMITED
        );
    }



    getMetadata(
        key
    ) {

        return this.metadata[key];
    }



    /**
     * -------------------------------------------------------------------------
     * Context Cloning
     * -------------------------------------------------------------------------
     *
     * Creates a new immutable context while preserving the original.
     */

    clone(
        changes = {}
    ) {

        return new StrategyExecutionContext({

            ...this.toJSON(),

            ...changes
        });
    }



    /**
     * -------------------------------------------------------------------------
     * Context Enrichment
     * -------------------------------------------------------------------------
     */

    enrich(
        metadata = {}
    ) {

        return this.clone({

            metadata: {

                ...this.metadata,

                ...metadata
            }
        });
    }



    /**
     * -------------------------------------------------------------------------
     * Serialization
     * -------------------------------------------------------------------------
     */

    toJSON() {

        return {

            ...this[kExecutionContext]
        };
    }



    /**
     * -------------------------------------------------------------------------
     * Diagnostics Snapshot
     * -------------------------------------------------------------------------
     */

    snapshot() {

        return Object.freeze({

            id:
                this.id,


            operation:
                this.operation,


            strategy:
                this.strategy,


            tenant:
                this.tenant.tenantId,


            correlationId:
                this.correlation.correlationId,


            traceId:
                this.trace.traceId,


            dependency:
                this.dependency.status,


            createdAt:
                this[kExecutionContext].createdAt
        });
    }
}

/* =============================================================================
 * 2.1.3 StrategyExecutionResult
 * -----------------------------------------------------------------------------
 *
 * Enterprise execution result model.
 *
 * Responsibilities:
 *
 * ✓ Immutable result object
 * ✓ Success/failure modelling
 * ✓ Fallback result tracking
 * ✓ Response metadata
 * ✓ Warning management
 * ✓ Timing information
 * ✓ Diagnostics
 * ✓ Serialization
 * ✓ Observability integration
 *
 * ============================================================================= */


class StrategyExecutionResult {


    /**
     * -------------------------------------------------------------------------
     * Constructor
     * -------------------------------------------------------------------------
     */

    constructor(options = {}) {


        validateConfiguration(
            options
        );


        const nowTime =
            Date.now();



        this[kExecutionResult] =
            Object.freeze({


                id:

                    options.id ||
                    generateErrorId(),



                status:

                    options.status ||
                    RESULT_STATUS.SUCCESS,



                strategy:

                    options.strategy ||
                    null,



                operation:

                    options.operation ||
                    null,



                data:

                    options.data !== undefined

                        ? options.data

                        : null,



                error:

                    options.error ||
                    null,



                fallback:

                    Object.freeze(
                        this.#buildFallback(
                            options.fallback
                        )
                    ),



                response:

                    Object.freeze(
                        this.#buildResponseMetadata(
                            options.response
                        )
                    ),



                warnings:

                    Object.freeze(
                        [
                            ...(options.warnings || [])
                        ]
                    ),



                timing:

                    Object.freeze(
                        this.#buildTiming(
                            options.timing,
                            nowTime
                        )
                    ),



                diagnostics:

                    Object.freeze(
                        this.#buildDiagnostics(
                            options.diagnostics
                        )
                    ),



                observability:

                    Object.freeze(
                        this.#buildObservability(
                            options.observability
                        )
                    ),



                createdAt:

                    nowTime

            });



        Object.freeze(this);
    }



    /**
     * -------------------------------------------------------------------------
     * Fallback Information
     * -------------------------------------------------------------------------
     */

    #buildFallback(
        fallback = {}
    ) {

        return {


            used:

                Boolean(
                    fallback.used
                ),



            strategy:

                fallback.strategy ||
                null,



            source:

                fallback.source ||
                null,



            degraded:

                Boolean(
                    fallback.degraded
                ),



            freshness:

                fallback.freshness ||
                DATA_FRESHNESS.UNKNOWN,



            reason:

                fallback.reason ||
                null
        };
    }



    /**
     * -------------------------------------------------------------------------
     * Response Metadata
     * -------------------------------------------------------------------------
     */

    #buildResponseMetadata(
        response = {}
    ) {

        return {


            behaviour:

                response.behaviour ||
                RESPONSE_BEHAVIOURS.NORMAL,



            statusCode:

                response.statusCode ||
                200,



            headers:

                response.headers ||
                {},



            retryAfter:

                response.retryAfter ||
                null,



            warning:

                response.warning ||
                null
        };
    }



    /**
     * -------------------------------------------------------------------------
     * Timing Metadata
     * -------------------------------------------------------------------------
     */

    #buildTiming(
        timing = {},
        nowTime
    ) {

        return {


            startedAt:

                timing.startedAt ||
                nowTime,



            completedAt:

                timing.completedAt ||
                nowTime,



            duration:

                timing.duration ||
                0,



            queueTime:

                timing.queueTime ||
                0,



            fallbackDuration:

                timing.fallbackDuration ||
                0
        };
    }



    /**
     * -------------------------------------------------------------------------
     * Diagnostics Metadata
     * -------------------------------------------------------------------------
     */

    #buildDiagnostics(
        diagnostics = {}
    ) {

        return {


            errorId:

                diagnostics.errorId ||
                null,



            errorCode:

                diagnostics.errorCode ||
                null,



            errorDomain:

                diagnostics.errorDomain ||
                null,



            dependency:

                diagnostics.dependency ||
                null,



            failureType:

                diagnostics.failureType ||
                null,



            details:

                diagnostics.details ||
                {}
        };
    }



    /**
     * -------------------------------------------------------------------------
     * Observability Metadata
     * -------------------------------------------------------------------------
     */

    #buildObservability(
        observability = {}
    ) {

        return {


            traceId:

                observability.traceId ||
                null,



            spanId:

                observability.spanId ||
                null,



            metrics:

                observability.metrics ||
                {},



            events:

                observability.events ||
                []
        };
    }



    /**
     * -------------------------------------------------------------------------
     * Getters
     * -------------------------------------------------------------------------
     */


    get id() {

        return this[kExecutionResult].id;
    }


    get status() {

        return this[kExecutionResult].status;
    }


    get data() {

        return this[kExecutionResult].data;
    }


    get error() {

        return this[kExecutionResult].error;
    }


    get strategy() {

        return this[kExecutionResult].strategy;
    }


    get fallback() {

        return this[kExecutionResult].fallback;
    }


    get response() {

        return this[kExecutionResult].response;
    }


    get warnings() {

        return this[kExecutionResult].warnings;
    }


    get timing() {

        return this[kExecutionResult].timing;
    }


    get diagnostics() {

        return this[kExecutionResult].diagnostics;
    }


    get observability() {

        return this[kExecutionResult].observability;
    }



    /**
     * -------------------------------------------------------------------------
     * Status Helpers
     * -------------------------------------------------------------------------
     */


    isSuccessful() {

        return isSuccessfulResult(
            this.status
        );
    }



    isFailed() {

        return [

            RESULT_STATUS.FAILED,

            RESULT_STATUS.TIMEOUT,

            RESULT_STATUS.REJECTED

        ].includes(
            this.status
        );
    }



    isFallbackUsed() {

        return (
            this.fallback.used === true
        );
    }



    isDegraded() {

        return (
            this.fallback.degraded === true
        );
    }



    /**
     * -------------------------------------------------------------------------
     * Warning Management
     * -------------------------------------------------------------------------
     */

    hasWarnings() {

        return (
            this.warnings.length > 0
        );
    }



    /**
     * -------------------------------------------------------------------------
     * Serialization
     * -------------------------------------------------------------------------
     */

    toJSON() {

        return {

            ...this[kExecutionResult]
        };
    }



    /**
     * -------------------------------------------------------------------------
     * Diagnostic Snapshot
     * -------------------------------------------------------------------------
     */

    snapshot() {

        return Object.freeze({

            id:

                this.id,


            status:

                this.status,


            strategy:

                this.strategy,


            fallback:

                this.fallback.strategy,


            degraded:

                this.isDegraded(),


            duration:

                this.timing.duration
        });
    }



    /**
     * -------------------------------------------------------------------------
     * Factory Helpers
     * -------------------------------------------------------------------------
     */


    static success(
        data,
        options = {}
    ) {

        return new StrategyExecutionResult({

            ...options,

            data,

            status:
                RESULT_STATUS.SUCCESS
        });
    }



    static fallback(
        data,
        options = {}
    ) {

        return new StrategyExecutionResult({

            ...options,

            data,

            status:
                RESULT_STATUS.FALLBACK_SUCCESS,

            fallback: {

                used: true,

                degraded: true,

                ...options.fallback
            }
        });
    }



    static failure(
        error,
        options = {}
    ) {

        return new StrategyExecutionResult({

            ...options,

            error,

            status:
                RESULT_STATUS.FAILED
        });
    }
}

/* =============================================================================
 * 2.1.4 FallbackStrategy Base Class
 * -----------------------------------------------------------------------------
 *
 * Enterprise fallback strategy abstraction.
 *
 * Responsibilities:
 *
 * ✓ Abstract strategy contract
 * ✓ Strategy lifecycle hooks
 * ✓ Execution pipeline
 * ✓ Validation
 * ✓ Metrics collection
 * ✓ Context binding
 * ✓ Result normalization
 * ✓ Error handling
 * ✓ Capability declaration
 *
 * ============================================================================= */


class FallbackStrategy {


    /**
     * -------------------------------------------------------------------------
     * Constructor
     * -------------------------------------------------------------------------
     */

    constructor(options = {}) {


        validateConfiguration(
            options
        );


        this[kStrategy] =
            Object.freeze({


                name:

                    options.name ||
                    this.constructor.name,



                type:

                    options.type ||
                    STRATEGY_TYPES.CUSTOM,



                version:

                    options.version ||
                    MODULE_VERSION,



                priority:

                    options.priority ||
                    PRIORITY_CLASSES.MEDIUM,



                capabilities:

                    Object.freeze(
                        [
                            ...(options.capabilities || [])
                        ]
                    ),



                enabled:

                    options.enabled !== false,


                metadata:

                    Object.freeze(
                        {
                            ...(options.metadata || {})
                        }
                    )

            });



        this[kMetrics] =
            {

                executions: 0,

                successes: 0,

                failures: 0,

                fallbacks: 0,

                duration: 0
            };


        Object.freeze(this);
    }



    /**
     * -------------------------------------------------------------------------
     * Abstract Execute Contract
     * -------------------------------------------------------------------------
     *
     * Child classes MUST implement.
     */

    async execute(
        context
    ) {

        throw new Error(
            `${this.name}.execute() must be implemented`
        );
    }



    /**
     * -------------------------------------------------------------------------
     * Main Execution Pipeline
     * -------------------------------------------------------------------------
     */

    async run(
        context
    ) {


        const started =
            Date.now();



        this.#validateContext(
            context
        );


        if (!this.enabled) {


            return StrategyExecutionResult.failure(

                new Error(
                    `Strategy ${this.name} disabled`
                ),

                {

                    strategy:
                        this.name
                }

            );
        }



        this.metrics.executions++;



        await this.beforeExecute(
            context
        );


        try {


            const output =
                await this.execute(
                    context
                );



            const result =
                this.normalizeResult(
                    output,
                    context
                );



            this.metrics.successes++;


            if (
                result.isFallbackUsed()
            ) {

                this.metrics.fallbacks++;
            }



            await this.afterExecute(
                context,
                result
            );



            return result;



        } catch(error) {


            this.metrics.failures++;



            const result =
                await this.handleError(
                    error,
                    context
                );



            await this.onFailure(
                error,
                context
            );


            return result;



        } finally {


            const duration =
                Date.now() -
                started;


            this.metrics.duration +=
                duration;
        }
    }



    /**
     * -------------------------------------------------------------------------
     * Lifecycle Hooks
     * -------------------------------------------------------------------------
     */


    async initialize() {

        return true;
    }



    async destroy() {

        return true;
    }



    async beforeExecute(
        context
    ) {

        return context;
    }



    async afterExecute(
        context,
        result
    ) {

        return result;
    }



    async onFailure(
        error,
        context
    ) {

        return {

            error,

            context
        };
    }



    /**
     * -------------------------------------------------------------------------
     * Error Handling
     * -------------------------------------------------------------------------
     */

    async handleError(
        error,
        context
    ) {


        validateError(
            error
        );


        return StrategyExecutionResult.failure(

            error,

            {

                strategy:

                    this.name,


                operation:

                    context.operation,


                diagnostics:

                    {

                        errorCode:

                            error.code || 
                            ERROR_CODES.INTERNAL_ERROR

                    }

            }
        );
    }



    /**
     * -------------------------------------------------------------------------
     * Result Normalization
     * -------------------------------------------------------------------------
     */

    normalizeResult(
        output,
        context
    ) {


        if (
            output instanceof StrategyExecutionResult
        ) {

            return output;
        }



        return StrategyExecutionResult.success(

            output,

            {

                strategy:

                    this.name,


                operation:

                    context.operation

            }
        );
    }



    /**
     * -------------------------------------------------------------------------
     * Context Validation
     * -------------------------------------------------------------------------
     */

    #validateContext(
        context
    ) {


        validateExecutionContext(
            context
        );

    }



    /**
     * -------------------------------------------------------------------------
     * Metadata
     * -------------------------------------------------------------------------
     */


    get name() {

        return this[kStrategy].name;
    }



    get type() {

        return this[kStrategy].type;
    }



    get version() {

        return this[kStrategy].version;
    }



    get priority() {

        return this[kStrategy].priority;
    }



    get capabilities() {

        return this[kStrategy].capabilities;
    }



    get enabled() {

        return this[kStrategy].enabled;
    }



    get metadata() {

        return this[kStrategy].metadata;
    }



    /**
     * -------------------------------------------------------------------------
     * Capability Checks
     * -------------------------------------------------------------------------
     */

    supports(
        capability
    ) {

        return this.capabilities.includes(
            capability
        );
    }



    /**
     * -------------------------------------------------------------------------
     * Metrics
     * -------------------------------------------------------------------------
     */

    metrics() {

        return Object.freeze({

            name:

                this.name,


            ...this[kMetrics]

        });
    }



    /**
     * -------------------------------------------------------------------------
     * Diagnostics
     * -------------------------------------------------------------------------
     */

    snapshot() {

        return Object.freeze({

            name:

                this.name,


            type:

                this.type,


            version:

                this.version,


            enabled:

                this.enabled,


            capabilities:

                this.capabilities,


            metrics:

                this.metrics()

        });
    }
}

/* =============================================================================
 * 2.1.5 StrategyRegistry
 * -----------------------------------------------------------------------------
 *
 * Enterprise fallback strategy registry.
 *
 * Responsibilities:
 *
 * ✓ Strategy registration
 * ✓ Strategy discovery
 * ✓ Strategy resolution
 * ✓ Runtime replacement
 * ✓ Capability matching
 * ✓ Health reporting
 * ✓ Diagnostics snapshots
 * ✓ Lifecycle management
 * ✓ Shutdown handling
 *
 * ============================================================================= */


class StrategyRegistry {


    /**
     * -------------------------------------------------------------------------
     * Constructor
     * -------------------------------------------------------------------------
     */

    constructor(options = {}) {


        this[kStrategyRegistry] =
        {

            name:

                options.name ||
                'default-strategy-registry',


            strategies:

                new Map(),


            initialized:

                false,


            shutdown:

                false,


            metrics:

            {

                registered: 0,

                executions: 0,

                replacements: 0,

                failures: 0

            }

        };


        Object.freeze(this);
    }



    /**
     * -------------------------------------------------------------------------
     * Initialize Registry
     * -------------------------------------------------------------------------
     */

    async initialize() {


        if (
            this[kStrategyRegistry].initialized
        ) {

            return;
        }


        this[kStrategyRegistry]
            .initialized = true;


        return true;
    }



    /**
     * -------------------------------------------------------------------------
     * Register Strategy
     * -------------------------------------------------------------------------
     */

    async register(
        strategy
    ) {


        this.#assertAvailable();


        assertDefined(
            strategy,
            'Strategy'
        );


        assert(

            strategy instanceof FallbackStrategy,

            'Strategy must extend FallbackStrategy'

        );


        validateRegistryName(
            strategy.name
        );



        if (
            this.has(strategy.name)
        ) {

            throw new Error(
                `Strategy already registered: ${strategy.name}`
            );
        }



        await strategy.initialize();



        this[kStrategyRegistry]
            .strategies
            .set(

                strategy.name,

                strategy

            );



        this[kStrategyRegistry]
            .metrics
            .registered++;


        return strategy;
    }



    /**
     * -------------------------------------------------------------------------
     * Replace Existing Strategy
     * -------------------------------------------------------------------------
     */

    async replace(
        name,
        strategy
    ) {


        this.#assertAvailable();


        validateRegistryName(
            name
        );


        assert(

            strategy instanceof FallbackStrategy,

            'Replacement must be a strategy'

        );



        const existing =
            this.get(name);



        if(existing) {

            await existing.destroy();

        }



        await strategy.initialize();



        this[kStrategyRegistry]
            .strategies
            .set(

                name,

                strategy

            );



        this[kStrategyRegistry]
            .metrics
            .replacements++;


        return strategy;
    }



    /**
     * -------------------------------------------------------------------------
     * Remove Strategy
     * -------------------------------------------------------------------------
     */

    async unregister(
        name
    ) {


        const strategy =
            this.get(name);



        if(!strategy) {

            return false;
        }



        await strategy.destroy();



        return this[kStrategyRegistry]
            .strategies
            .delete(name);
    }



    /**
     * -------------------------------------------------------------------------
     * Strategy Discovery
     * -------------------------------------------------------------------------
     */

    discover(
        filter = {}
    ) {


        let strategies =
            Array.from(

                this[kStrategyRegistry]
                    .strategies
                    .values()

            );



        if(filter.type) {


            strategies =
                strategies.filter(

                    strategy =>
                        strategy.type === filter.type

                );
        }



        if(filter.capability) {


            strategies =
                strategies.filter(

                    strategy =>
                        strategy.supports(
                            filter.capability
                        )

                );
        }



        if(filter.enabled !== undefined) {


            strategies =
                strategies.filter(

                    strategy =>
                        strategy.enabled ===
                        filter.enabled

                );
        }



        return strategies;
    }



    /**
     * -------------------------------------------------------------------------
     * Resolve Strategy
     * -------------------------------------------------------------------------
     *
     * Finds the best matching strategy.
     */

    resolve(
        requirements = {}
    ) {


        const candidates =
            this.discover(
                requirements
            );



        if(
            candidates.length === 0
        ) {

            throw new Error(

                'No matching degradation strategy found'

            );
        }



        return candidates.sort(

            (a,b) =>

                a.priority.value -
                b.priority.value

        )[0];
    }



    /**
     * -------------------------------------------------------------------------
     * Get Strategy
     * -------------------------------------------------------------------------
     */

    get(
        name
    ) {

        return this[kStrategyRegistry]
            .strategies
            .get(name);
    }



    /**
     * -------------------------------------------------------------------------
     * Exists Check
     * -------------------------------------------------------------------------
     */

    has(
        name
    ) {

        return this[kStrategyRegistry]
            .strategies
            .has(name);
    }



    /**
     * -------------------------------------------------------------------------
     * Execute Strategy
     * -------------------------------------------------------------------------
     */

    async execute(
        name,
        context
    ) {


        const strategy =
            this.get(name);



        if(!strategy) {


            throw new Error(

                `Unknown strategy ${name}`

            );
        }



        this[kStrategyRegistry]
            .metrics
            .executions++;



        try {


            return await strategy.run(
                context
            );


        } catch(error) {


            this[kStrategyRegistry]
                .metrics
                .failures++;


            throw error;
        }
    }



    /**
     * -------------------------------------------------------------------------
     * Health Reporting
     * -------------------------------------------------------------------------
     */

    health() {


        const strategies =
            this.discover();



        return {

            registry:

                this[kStrategyRegistry]
                    .name,


            healthy:

                !this[kStrategyRegistry]
                    .shutdown,


            count:

                strategies.length,


            strategies:

                strategies.map(

                    strategy =>

                        ({

                            name:

                                strategy.name,


                            enabled:

                                strategy.enabled,


                            metrics:

                                strategy.metrics()

                        })

                )

        };
    }



    /**
     * -------------------------------------------------------------------------
     * Diagnostics Snapshot
     * -------------------------------------------------------------------------
     */

    snapshot() {


        return Object.freeze({

            name:

                this[kStrategyRegistry]
                    .name,


            initialized:

                this[kStrategyRegistry]
                    .initialized,


            shutdown:

                this[kStrategyRegistry]
                    .shutdown,


            metrics:

                {

                    ...this[kStrategyRegistry]
                        .metrics

                },


            strategies:

                Array.from(

                    this[kStrategyRegistry]
                        .strategies
                        .values()

                )
                .map(

                    strategy =>
                        strategy.snapshot()

                )

        });
    }



    /**
     * -------------------------------------------------------------------------
     * Shutdown
     * -------------------------------------------------------------------------
     */

    async shutdown() {


        for(
            const strategy of
            this[kStrategyRegistry]
                .strategies
                .values()
        ) {


            await strategy.destroy();

        }



        this[kStrategyRegistry]
            .strategies
            .clear();



        this[kStrategyRegistry]
            .shutdown = true;


        return true;
    }



    /**
     * -------------------------------------------------------------------------
     * Internal Guard
     * -------------------------------------------------------------------------
     */

    #assertAvailable()
    {

        assert(

            !this[kStrategyRegistry]
                .shutdown,

            'Strategy registry is shutdown'

        );
    }
}

/* =============================================================================
 * 2.2.1 StaticFallbackStrategy
 * -----------------------------------------------------------------------------
 *
 * Enterprise static fallback strategy.
 *
 * Extends:
 *
 * FallbackStrategy
 *
 * Responsibilities:
 *
 * ✓ Constant response fallback
 * ✓ Configuration driven responses
 * ✓ Tenant aware payloads
 * ✓ Default response handling
 * ✓ Metadata enrichment
 * ✓ Metrics integration
 *
 * ============================================================================= */


class StaticFallbackStrategy extends FallbackStrategy {


    /**
     * -------------------------------------------------------------------------
     * Constructor
     * -------------------------------------------------------------------------
     */

    constructor(options = {}) {


        super({

            name:

                options.name ||
                'static-fallback',


            type:

                STRATEGY_TYPES.STATIC,


            priority:

                options.priority ||
                PRIORITY_CLASSES.MEDIUM,


            capabilities:

                [

                    STRATEGY_CAPABILITIES
                        .SUPPORTS_TENANT_POLICY

                ],


            metadata:

                options.metadata || {}

        });



        assertDefined(

            options.payload,

            'Static fallback payload'

        );



        this[kStaticConfiguration] =
            Object.freeze({

                payload:

                    options.payload,


                tenantOverrides:

                    options.tenantOverrides ||
                    {},


                metadata:

                    options.responseMetadata ||
                    {},


                clonePayload:

                    options.clonePayload !== false

            });


        Object.freeze(this);
    }



    /**
     * -------------------------------------------------------------------------
     * Execute Static Fallback
     * -------------------------------------------------------------------------
     */

    async execute(
        context
    ) {


        validateExecutionContext(
            context
        );



        const payload =
            this.resolvePayload(
                context
            );



        return StrategyExecutionResult.fallback(

            payload,

            {

                strategy:

                    this.name,


                operation:

                    context.operation,


                fallback:

                    {

                        used:

                            true,


                        strategy:

                            STRATEGY_TYPES.STATIC,


                        source:

                            'STATIC_CONFIGURATION',


                        degraded:

                            true,


                        reason:

                            'Static fallback activated'

                    },


                response:

                    {

                        behaviour:

                            RESPONSE_BEHAVIOURS.FALLBACK

                    },


                diagnostics:

                    {

                        errorDomain:

                            ERROR_DOMAINS.FALLBACK

                    }

            }
        );
    }



    /**
     * -------------------------------------------------------------------------
     * Resolve Payload
     * -------------------------------------------------------------------------
     *
     * Applies tenant specific overrides.
     */

    resolvePayload(
        context
    ) {


        let payload =
            this[kStaticConfiguration]
                .payload;



        if(
            context.hasTenant()
        ) {


            const override =
                this[kStaticConfiguration]
                    .tenantOverrides
                    [
                        context.tenant.tenantId
                    ];



            if(
                override
            ) {

                payload =
                    {

                        ...payload,

                        ...override

                    };
            }
        }



        return this.clonePayload(
            payload
        );
    }



    /**
     * -------------------------------------------------------------------------
     * Payload Clone
     * -------------------------------------------------------------------------
     *
     * Prevents mutation of shared fallback data.
     */

    clonePayload(
        payload
    ) {


        if(
            !this[kStaticConfiguration]
                .clonePayload
        ) {

            return payload;
        }



        return JSON.parse(

            JSON.stringify(
                payload
            )

        );
    }



    /**
     * -------------------------------------------------------------------------
     * Lifecycle Hook
     * -------------------------------------------------------------------------
     */

    async initialize()
    {

        return true;

    }



    /**
     * -------------------------------------------------------------------------
     * Diagnostics
     * -------------------------------------------------------------------------
     */

    snapshot()
    {

        return {

            ...super.snapshot(),


            configuration:

                {

                    hasTenantOverrides:

                        Object.keys(

                            this[kStaticConfiguration]
                                .tenantOverrides

                        ).length > 0

                }

        };
    }
}

/* =============================================================================
 * 2.2.2 CachedFallbackStrategy
 * -----------------------------------------------------------------------------
 *
 * Enterprise cached fallback strategy.
 *
 * Extends:
 *
 * FallbackStrategy
 *
 * Responsibilities:
 *
 * ✓ Distributed cache fallback
 * ✓ Redis integration support
 * ✓ Memory cache fallback
 * ✓ TTL validation
 * ✓ Freshness evaluation
 * ✓ Tenant isolation
 * ✓ Cache metrics
 * ✓ Cache invalidation
 * ✓ Recovery refresh
 *
 * ============================================================================= */


class CachedFallbackStrategy extends FallbackStrategy {


    constructor(options = {}) {


        super({

            name:

                options.name ||
                'cached-fallback',


            type:

                STRATEGY_TYPES.CACHE,


            priority:

                options.priority ||
                PRIORITY_CLASSES.HIGH,


            capabilities:

                [

                    STRATEGY_CAPABILITIES
                        .SUPPORTS_CACHE,


                    STRATEGY_CAPABILITIES
                        .SUPPORTS_RECOVERY,


                    STRATEGY_CAPABILITIES
                        .SUPPORTS_TENANT_POLICY

                ],


            metadata:

                options.metadata || {}

        });



        assertFunction(

            options.cacheProvider?.get,

            'Cache provider get()'

        );



        this[kCacheConfiguration] =
            Object.freeze({

                provider:

                    options.cacheProvider,


                memory:

                    new Map(),


                ttl:

                    options.ttl ||
                    60000,


                stalePolicy:

                    options.stalePolicy ||
                    'ALLOW_STALE',


                namespace:

                    options.namespace ||
                    'graceful-degradation',


                tenantAware:

                    options.tenantAware !== false,


                refresh:

                    options.refresh || null

            });



        this[kCacheMetrics] =
        {

            hits: 0,

            misses: 0,

            staleHits: 0,

            refreshes: 0,

            invalidations: 0

        };


        Object.freeze(this);
    }



    /**
     * -------------------------------------------------------------------------
     * Execute Cached Fallback
     * -------------------------------------------------------------------------
     */

    async execute(
        context
    ) {


        validateExecutionContext(
            context
        );



        const key =
            this.buildCacheKey(
                context
            );



        let cached =
            await this.getCache(
                key
            );



        if(!cached)
        {

            this[kCacheMetrics]
                .misses++;


            throw this.createCacheError(
                key
            );
        }



        const freshness =
            this.evaluateFreshness(
                cached
            );



        if(
            freshness === DATA_FRESHNESS.STALE
        ) {


            this[kCacheMetrics]
                .staleHits++;


            await this.triggerRefresh(
                context,
                key
            );
        }



        this[kCacheMetrics]
            .hits++;



        return StrategyExecutionResult.fallback(

            cached.value,

            {

                strategy:

                    this.name,


                operation:

                    context.operation,


                fallback:

                    {

                        used:

                            true,


                        strategy:

                            STRATEGY_TYPES.CACHE,


                        source:

                            'CACHE',


                        degraded:

                            true,


                        freshness

                    },


                response:

                    {

                        behaviour:

                            RESPONSE_BEHAVIOURS.CACHED

                    }

            }
        );
    }



    /**
     * -------------------------------------------------------------------------
     * Cache Key Builder
     * -------------------------------------------------------------------------
     */

    buildCacheKey(
        context
    ) {


        const tenant =
            this[kCacheConfiguration]
                .tenantAware

                ?

                context.tenant.tenantId || 'global'

                :

                'global';



        return [

            this[kCacheConfiguration]
                .namespace,

            tenant,

            context.operation

        ]
        .join(':');
    }



    /**
     * -------------------------------------------------------------------------
     * Read Cache
     * -------------------------------------------------------------------------
     */

    async getCache(
        key
    ) {


        let value =
            await this[kCacheConfiguration]
                .provider
                .get(key);



        if(value)
        {

            return value;
        }



        const memory =
            this[kCacheConfiguration]
                .memory
                .get(key);



        return memory || null;
    }



    /**
     * -------------------------------------------------------------------------
     * Store Memory Cache
     * -------------------------------------------------------------------------
     */

    setMemoryCache(
        key,
        value
    ) {


        this[kCacheConfiguration]
            .memory
            .set(

                key,

                {

                    value,

                    createdAt:

                        Date.now()

                }

            );
    }



    /**
     * -------------------------------------------------------------------------
     * Freshness Evaluation
     * -------------------------------------------------------------------------
     */

    evaluateFreshness(
        cached
    ) {


        const age =
            Date.now() -
            cached.createdAt;



        if(
            age <
            this[kCacheConfiguration].ttl
        ) {

            return DATA_FRESHNESS.RECENT;
        }



        if(
            this[kCacheConfiguration]
                .stalePolicy ===
                'ALLOW_STALE'
        ) {

            return DATA_FRESHNESS.STALE;
        }



        return DATA_FRESHNESS.EXPIRED;
    }



    /**
     * -------------------------------------------------------------------------
     * Refresh Hook
     * -------------------------------------------------------------------------
     */

    async triggerRefresh(
        context,
        key
    ) {


        if(
            !this[kCacheConfiguration]
                .refresh
        ) {

            return;
        }



        this[kCacheMetrics]
            .refreshes++;



        await this[kCacheConfiguration]
            .refresh(
                context,
                key
            );
    }



    /**
     * -------------------------------------------------------------------------
     * Invalidate Cache
     * -------------------------------------------------------------------------
     */

    async invalidate(
        key
    ) {


        this[kCacheMetrics]
            .invalidations++;



        this[kCacheConfiguration]
            .memory
            .delete(key);



        if(
            this[kCacheConfiguration]
                .provider
                .delete
        ) {

            await this[kCacheConfiguration]
                .provider
                .delete(key);
        }
    }



    /**
     * -------------------------------------------------------------------------
     * Cache Error
     * -------------------------------------------------------------------------
     */

    createCacheError(
        key
    ) {


        const error =
            new Error(

                `Cache miss: ${key}`

            );


        error.code =
            ERROR_CODES.CACHE_MISS;


        return error;
    }



    /**
     * -------------------------------------------------------------------------
     * Recovery Refresh
     * -------------------------------------------------------------------------
     */

    async refreshAfterRecovery(
        context
    ) {


        if(
            this[kCacheConfiguration]
                .refresh
        ) {


            await this[kCacheConfiguration]
                .refresh(
                    context
                );
        }
    }



    /**
     * -------------------------------------------------------------------------
     * Metrics
     * -------------------------------------------------------------------------
     */

    metrics()
    {

        return {

            ...super.metrics(),

            cache:

                {

                    ...this[kCacheMetrics]

                }

        };
    }



    /**
     * -------------------------------------------------------------------------
     * Diagnostics
     * -------------------------------------------------------------------------
     */

    snapshot()
    {

        return {

            ...super.snapshot(),


            cache:

                {

                    namespace:

                        this[kCacheConfiguration]
                            .namespace,


                    ttl:

                        this[kCacheConfiguration]
                            .ttl,


                    metrics:

                        this[kCacheMetrics]

                }

        };
    }
}

/* =============================================================================
 * 2.2.3 AsyncFallbackStrategy
 * -----------------------------------------------------------------------------
 *
 * Enterprise asynchronous fallback strategy.
 *
 * Extends:
 *
 * FallbackStrategy
 *
 * Responsibilities:
 *
 * ✓ Background execution
 * ✓ Deferred processing
 * ✓ Async delegates
 * ✓ Non-blocking responses
 * ✓ Timeout handling
 * ✓ Queue integration
 * ✓ Event publishing
 * ✓ Long-running workflows
 *
 * ============================================================================= */


class AsyncFallbackStrategy extends FallbackStrategy {


    constructor(options = {}) {


        super({

            name:

                options.name ||
                'async-fallback',


            type:

                STRATEGY_TYPES.ASYNC,


            priority:

                options.priority ||
                PRIORITY_CLASSES.HIGH,


            capabilities:

                [

                    STRATEGY_CAPABILITIES
                        .SUPPORTS_ASYNC,


                    STRATEGY_CAPABILITIES
                        .SUPPORTS_QUEUE,


                    STRATEGY_CAPABILITIES
                        .SUPPORTS_RECOVERY

                ],


            metadata:

                options.metadata || {}

        });



        assertFunction(

            options.handler,

            'Async fallback handler'

        );



        this[kAsyncConfiguration] =
            Object.freeze({

                handler:

                    options.handler,


                queue:

                    options.queue || null,


                eventBus:

                    options.eventBus || null,


                timeout:

                    options.timeout ||
                    30000,


                mode:

                    options.mode ||
                    EXECUTION_MODES.BACKGROUND,


                returnImmediate:

                    options.returnImmediate !== false

            });



        this[kAsyncMetrics] =
        {

            submitted: 0,

            completed: 0,

            failed: 0,

            timeout: 0,

            queued: 0

        };


        Object.freeze(this);
    }



    /**
     * -------------------------------------------------------------------------
     * Execute Async Fallback
     * -------------------------------------------------------------------------
     */

    async execute(
        context
    ) {


        validateExecutionContext(
            context
        );


        const taskId =
            generateErrorId();



        this.publishEvent(

            'ASYNC_FALLBACK_STARTED',

            {

                taskId,

                strategy:

                    this.name

            }

        );



        if(
            this[kAsyncConfiguration]
                .queue
        ) {


            return this.enqueue(

                taskId,

                context

            );
        }



        const promise =
            this.executeBackground(

                taskId,

                context

            );



        this[kAsyncMetrics]
            .submitted++;



        if(
            this[kAsyncConfiguration]
                .returnImmediate
        ) {


            return StrategyExecutionResult.fallback(

                {

                    accepted:

                        true,


                    taskId,


                    status:

                        'PROCESSING'

                },


                {

                    strategy:

                        this.name,


                    operation:

                        context.operation,


                    fallback:

                        {

                            used:

                                true,


                            strategy:

                                STRATEGY_TYPES.ASYNC,


                            source:

                                'BACKGROUND_EXECUTION',


                            degraded:

                                true

                        },


                    response:

                        {

                            behaviour:

                                RESPONSE_BEHAVIOURS.ACCEPTED,


                            statusCode:

                                202

                        }

                }

            );
        }



        return promise;
    }



    /**
     * -------------------------------------------------------------------------
     * Background Execution
     * -------------------------------------------------------------------------
     */

    async executeBackground(
        taskId,
        context
    ) {


        try {


            const result =
                await this.withTimeout(

                    this[kAsyncConfiguration]
                        .handler(context),


                    this[kAsyncConfiguration]
                        .timeout

                );



            this[kAsyncMetrics]
                .completed++;



            this.publishEvent(

                'ASYNC_FALLBACK_COMPLETED',

                {

                    taskId,

                    result

                }

            );



            return result;



        } catch(error) {


            this[kAsyncMetrics]
                .failed++;



            this.publishEvent(

                'ASYNC_FALLBACK_FAILED',

                {

                    taskId,

                    error

                }

            );


            throw error;
        }
    }



    /**
     * -------------------------------------------------------------------------
     * Timeout Protection
     * -------------------------------------------------------------------------
     */

    async withTimeout(
        promise,
        timeout
    ) {


        return Promise.race([


            promise,


            new Promise(

                (_, reject)=>{


                    setTimeout(

                        ()=>{


                            const error =
                                new Error(
                                    'Async fallback timeout'
                                );


                            error.code =
                                ERROR_CODES
                                .STRATEGY_TIMEOUT;


                            this[kAsyncMetrics]
                                .timeout++;


                            reject(error);


                        },

                        timeout

                    );

                }

            )


        ]);
    }



    /**
     * -------------------------------------------------------------------------
     * Queue Integration
     * -------------------------------------------------------------------------
     */

    async enqueue(
        taskId,
        context
    ) {


        this[kAsyncMetrics]
            .queued++;



        await this[kAsyncConfiguration]
            .queue
            .add(

                {

                    taskId,

                    context:

                        context.toJSON()

                }

            );



        return StrategyExecutionResult.fallback(

            {

                queued:

                    true,


                taskId

            },


            {

                strategy:

                    this.name,


                fallback:

                    {

                        used:

                            true,


                        strategy:

                            STRATEGY_TYPES.QUEUE,


                        degraded:

                            true

                    },


                response:

                    {

                        behaviour:

                            RESPONSE_BEHAVIOURS.QUEUED,


                        statusCode:

                            202

                    }

            }

        );
    }



    /**
     * -------------------------------------------------------------------------
     * Event Publication
     * -------------------------------------------------------------------------
     */

    publishEvent(
        event,
        payload
    ) {


        if(
            this[kAsyncConfiguration]
                .eventBus
        ) {


            this[kAsyncConfiguration]
                .eventBus
                .emit(

                    event,

                    payload

                );
        }
    }



    /**
     * -------------------------------------------------------------------------
     * Metrics
     * -------------------------------------------------------------------------
     */

    metrics()
    {

        return {

            ...super.metrics(),

            async:

                {

                    ...this[kAsyncMetrics]

                }

        };
    }



    /**
     * -------------------------------------------------------------------------
     * Diagnostics
     * -------------------------------------------------------------------------
     */

    snapshot()
    {

        return {


            ...super.snapshot(),


            async:

                {

                    timeout:

                        this[kAsyncConfiguration]
                            .timeout,


                    mode:

                        this[kAsyncConfiguration]
                            .mode,


                    metrics:

                        this[kAsyncMetrics]

                }

        };
    }
}

/* =============================================================================
 * 2.2.4 DelegateFallbackStrategy
 * -----------------------------------------------------------------------------
 *
 * Enterprise delegation fallback strategy.
 *
 * Extends:
 *
 * FallbackStrategy
 *
 * Responsibilities:
 *
 * ✓ Strategy chaining
 * ✓ Alternate provider routing
 * ✓ Multi-provider failover
 * ✓ Priority selection
 * ✓ Dependency health checks
 * ✓ Cross-service fallback
 * ✓ Delegated tracing
 *
 * ============================================================================= */


class DelegateFallbackStrategy extends FallbackStrategy {


    constructor(options = {}) {


        super({

            name:

                options.name ||
                'delegate-fallback',


            type:

                STRATEGY_TYPES.DELEGATE,


            priority:

                options.priority ||
                PRIORITY_CLASSES.CRITICAL,


            capabilities:

                [

                    STRATEGY_CAPABILITIES
                        .SUPPORTS_RECOVERY,


                    STRATEGY_CAPABILITIES
                        .SUPPORTS_TENANT_POLICY

                ],


            metadata:

                options.metadata || {}

        });



        assert(

            Array.isArray(
                options.delegates
            ),

            'Delegates array required'

        );



        assert(

            options.delegates.length > 0,

            'At least one delegate required'

        );



        this[kDelegateConfiguration] =
            Object.freeze({

                delegates:

                    Object.freeze(

                        options.delegates.map(

                            delegate =>

                                Object.freeze({

                                    name:

                                        delegate.name,


                                    priority:

                                        delegate.priority ||
                                        PRIORITY_CLASSES.MEDIUM,


                                    execute:

                                        delegate.execute,


                                    health:

                                        delegate.health || null,


                                    metadata:

                                        delegate.metadata || {}

                                })

                        )

                    ),


                failFast:

                    options.failFast === true,


                tracing:

                    options.tracing !== false

            });



        this[kDelegateMetrics] =
        {

            attempts: 0,

            successfulDelegations: 0,

            failedDelegations: 0,

            healthFailures: 0

        };


        Object.freeze(this);
    }



    /**
     * -------------------------------------------------------------------------
     * Execute Delegated Fallback
     * -------------------------------------------------------------------------
     */

    async execute(
        context
    ) {


        validateExecutionContext(
            context
        );



        const delegates =
            this.selectDelegates();



        const errors = [];



        for(
            const delegate of delegates
        ) {


            try {


                this[kDelegateMetrics]
                    .attempts++;



                if(
                    !await this.isHealthy(
                        delegate
                    )
                ) {


                    this[kDelegateMetrics]
                        .healthFailures++;


                    continue;
                }



                const result =
                    await this.executeDelegate(

                        delegate,

                        context

                    );



                this[kDelegateMetrics]
                    .successfulDelegations++;



                return StrategyExecutionResult.fallback(

                    result,

                    {

                        strategy:

                            this.name,


                        operation:

                            context.operation,


                        fallback:

                            {

                                used:

                                    true,


                                strategy:

                                    STRATEGY_TYPES.DELEGATE,


                                source:

                                    delegate.name,


                                degraded:

                                    true

                            },


                        diagnostics:

                            {

                                dependency:

                                    delegate.name

                            }

                    }

                );



            } catch(error) {


                errors.push({

                    delegate:

                        delegate.name,


                    error

                });



                this[kDelegateMetrics]
                    .failedDelegations++;



                if(
                    this[kDelegateConfiguration]
                        .failFast
                ) {

                    break;
                }
            }
        }



        const error =
            new Error(

                'All delegate providers failed'

            );


        error.code =
            ERROR_CODES.FALLBACK_CHAIN_EXHAUSTED;


        error.details =
            errors;



        throw error;
    }



    /**
     * -------------------------------------------------------------------------
     * Delegate Selection
     * -------------------------------------------------------------------------
     */

    selectDelegates()
    {

        return [

            ...this[kDelegateConfiguration]
                .delegates

        ]

        .sort(

            (a,b)=>

                a.priority.value -
                b.priority.value

        );
    }



    /**
     * -------------------------------------------------------------------------
     * Delegate Health Check
     * -------------------------------------------------------------------------
     */

    async isHealthy(
        delegate
    ) {


        if(
            !delegate.health
        ) {

            return true;
        }



        return await delegate.health();
    }



    /**
     * -------------------------------------------------------------------------
     * Delegate Execution
     * -------------------------------------------------------------------------
     */

    async executeDelegate(
        delegate,
        context
    ) {


        assertFunction(

            delegate.execute,

            `Delegate ${delegate.name} execute handler`

        );



        const delegatedContext =
            this.createDelegatedContext(

                context,

                delegate

            );



        return await delegate.execute(
            delegatedContext
        );
    }



    /**
     * -------------------------------------------------------------------------
     * Delegated Context
     * -------------------------------------------------------------------------
     */

    createDelegatedContext(
        context,
        delegate
    ) {


        if(
            !this[kDelegateConfiguration]
                .tracing
        ) {

            return context;
        }



        return context.enrich({

            delegated:

                true,


            delegate:

                delegate.name,


            delegatedAt:

                Date.now()

        });
    }



    /**
     * -------------------------------------------------------------------------
     * Add Delegate Runtime
     * -------------------------------------------------------------------------
     */

    addDelegate(
        delegate
    ) {


        this[kDelegateConfiguration]
            .delegates
            .push(
                delegate
            );
    }



    /**
     * -------------------------------------------------------------------------
     * Metrics
     * -------------------------------------------------------------------------
     */

    metrics()
    {

        return {

            ...super.metrics(),


            delegation:

                {

                    ...this[kDelegateMetrics]

                }

        };
    }



    /**
     * -------------------------------------------------------------------------
     * Diagnostics
     * -------------------------------------------------------------------------
     */

    snapshot()
    {

        return {


            ...super.snapshot(),


            delegates:

                this[kDelegateConfiguration]
                    .delegates
                    .map(

                        delegate =>

                            ({

                                name:

                                    delegate.name,


                                priority:

                                    delegate.priority

                            })

                    ),


            metrics:

                this[kDelegateMetrics]

        };
    }
}

/* =============================================================================
 * 2.2.5 ReadOnlyFallbackStrategy
 * -----------------------------------------------------------------------------
 *
 * Enterprise read-only degradation strategy.
 *
 * Extends:
 *
 * FallbackStrategy
 *
 * Responsibilities:
 *
 * ✓ Read-only degraded mode
 * ✓ Write protection
 * ✓ Financial safety controls
 * ✓ Tenant policies
 * ✓ Audit logging
 * ✓ Transaction freezing
 *
 * ============================================================================= */


class ReadOnlyFallbackStrategy extends FallbackStrategy {


    constructor(options = {}) {


        super({

            name:

                options.name ||
                'read-only-fallback',


            type:

                STRATEGY_TYPES.READ_ONLY,


            priority:

                options.priority ||
                PRIORITY_CLASSES.CRITICAL,


            capabilities:

                [

                    STRATEGY_CAPABILITIES
                        .SUPPORTS_READ_ONLY,


                    STRATEGY_CAPABILITIES
                        .SUPPORTS_COMPLIANCE,


                    STRATEGY_CAPABILITIES
                        .SUPPORTS_TENANT_POLICY

                ],


            metadata:

                options.metadata || {}

        });



        this[kReadOnlyConfiguration] =
            Object.freeze({

                allowedOperations:

                    Object.freeze(

                        options.allowedOperations ||

                        [

                            'READ',

                            'QUERY',

                            'REPORT',

                            'BALANCE_CHECK'

                        ]

                    ),



                blockedOperations:

                    Object.freeze(

                        options.blockedOperations ||

                        [

                            'CREATE',

                            'UPDATE',

                            'DELETE',

                            'TRANSFER',

                            'PAYMENT',

                            'WITHDRAWAL'

                        ]

                    ),



                tenantPolicies:

                    options.tenantPolicies ||
                    {},



                auditLogger:

                    options.auditLogger ||
                    null,


                transactionFreeze:

                    options.transactionFreeze !== false,


                strict:

                    options.strict !== false

            });



        this[kReadOnlyMetrics] =
        {

            readsAllowed: 0,

            writesBlocked: 0,

            violations: 0,

            freezes: 0

        };


        Object.freeze(this);
    }



    /**
     * -------------------------------------------------------------------------
     * Execute Read Only Fallback
     * -------------------------------------------------------------------------
     */

    async execute(
        context
    ) {


        validateExecutionContext(
            context
        );



        const operation =
            this.resolveOperation(
                context
            );



        if(
            this.isWriteOperation(
                operation
            )
        ) {


            return this.blockWrite(
                context
            );
        }



        return this.executeRead(
            context
        );
    }



    /**
     * -------------------------------------------------------------------------
     * Execute Safe Read
     * -------------------------------------------------------------------------
     */

    async executeRead(
        context
    ) {


        this[kReadOnlyMetrics]
            .readsAllowed++;



        await this.audit(

            'READ_ALLOWED',

            context

        );



        return StrategyExecutionResult.fallback(

            {

                mode:

                    'READ_ONLY',


                operation:

                    context.operation,


                allowed:

                    true

            },


            {

                strategy:

                    this.name,


                fallback:

                    {

                        used:

                            true,


                        strategy:

                            STRATEGY_TYPES.READ_ONLY,


                        source:

                            'READ_ONLY_MODE',


                        degraded:

                            true

                    },


                response:

                    {

                        behaviour:

                            RESPONSE_BEHAVIOURS.READ_ONLY

                    }

            }

        );
    }



    /**
     * -------------------------------------------------------------------------
     * Block Writes
     * -------------------------------------------------------------------------
     */

    async blockWrite(
        context
    ) {


        this[kReadOnlyMetrics]
            .writesBlocked++;


        this[kReadOnlyMetrics]
            .violations++;



        if(
            this[kReadOnlyConfiguration]
                .transactionFreeze
        ) {

            this[kReadOnlyMetrics]
                .freezes++;
        }



        await this.audit(

            'WRITE_BLOCKED',

            context

        );



        const error =
            new Error(

                'System operating in read-only mode'

            );


        error.code =
            ERROR_CODES
                .READ_ONLY_OPERATION_BLOCKED;



        return StrategyExecutionResult.failure(

            error,

            {

                strategy:

                    this.name,


                response:

                    {

                        behaviour:

                            RESPONSE_BEHAVIOURS
                                .READ_ONLY,


                        statusCode:

                            423

                    },


                diagnostics:

                    {

                        errorCode:

                            error.code

                    }

            }

        );
    }



    /**
     * -------------------------------------------------------------------------
     * Resolve Operation Type
     * -------------------------------------------------------------------------
     */

    resolveOperation(
        context
    ) {


        return (

            context.operationType ||

            context.operation ||

            'UNKNOWN'

        )
        .toUpperCase();
    }



    /**
     * -------------------------------------------------------------------------
     * Write Detection
     * -------------------------------------------------------------------------
     */

    isWriteOperation(
        operation
    ) {


        return this[kReadOnlyConfiguration]
            .blockedOperations
            .includes(
                operation
            );
    }



    /**
     * -------------------------------------------------------------------------
     * Tenant Policy Check
     * -------------------------------------------------------------------------
     */

    tenantAllowsReadOnly(
        tenantId
    ) {


        const policy =
            this[kReadOnlyConfiguration]
                .tenantPolicies
                [
                    tenantId
                ];



        if(!policy)
        {

            return true;
        }



        return policy.readOnlyAllowed !== false;
    }



    /**
     * -------------------------------------------------------------------------
     * Audit Logging
     * -------------------------------------------------------------------------
     */

    async audit(
        event,
        context
    ) {


        if(
            !this[kReadOnlyConfiguration]
                .auditLogger
        ) {

            return;
        }



        await this[kReadOnlyConfiguration]
            .auditLogger
            .log({

                event,


                strategy:

                    this.name,


                tenant:

                    context.tenant,


                operation:

                    context.operation,


                timestamp:

                    Date.now()

            });
    }



    /**
     * -------------------------------------------------------------------------
     * Recovery
     * -------------------------------------------------------------------------
     */

    async exitReadOnlyMode()
    {


        await this.audit(

            'READ_ONLY_DISABLED',

            {}

        );


        return true;
    }



    /**
     * -------------------------------------------------------------------------
     * Metrics
     * -------------------------------------------------------------------------
     */

    metrics()
    {

        return {

            ...super.metrics(),


            readOnly:

                {

                    ...this[kReadOnlyMetrics]

                }

        };
    }



    /**
     * -------------------------------------------------------------------------
     * Diagnostics
     * -------------------------------------------------------------------------
     */

    snapshot()
    {

        return {


            ...super.snapshot(),


            configuration:

                {

                    strict:

                        this[kReadOnlyConfiguration]
                            .strict,


                    transactionFreeze:

                        this[kReadOnlyConfiguration]
                            .transactionFreeze

                },


            metrics:

                this[kReadOnlyMetrics]

        };
    }
}

/* =============================================================================
 * 2.2.6 PartialResponseStrategy
 * -----------------------------------------------------------------------------
 *
 * Enterprise partial response degradation strategy.
 *
 * Extends:
 *
 * FallbackStrategy
 *
 * Responsibilities:
 *
 * ✓ Partial payload generation
 * ✓ Field level degradation
 * ✓ Missing dependency masking
 * ✓ Completeness scoring
 * ✓ Warning enrichment
 * ✓ Contract preservation
 *
 * ============================================================================= */


class PartialResponseStrategy extends FallbackStrategy {


    constructor(options = {}) {


        super({

            name:

                options.name ||
                'partial-response-fallback',


            type:

                STRATEGY_TYPES.PARTIAL_RESPONSE,


            priority:

                options.priority ||
                PRIORITY_CLASSES.HIGH,


            capabilities:

                [

                    STRATEGY_CAPABILITIES
                        .SUPPORTS_PARTIAL_RESPONSE,


                    STRATEGY_CAPABILITIES
                        .SUPPORTS_API_COMPATIBILITY

                ],


            metadata:

                options.metadata || {}

        });



        assertFunction(

            options.provider,

            'Partial response provider'

        );



        this[kPartialConfiguration] =
            Object.freeze({

                provider:

                    options.provider,


                requiredFields:

                    Object.freeze(

                        options.requiredFields ||

                        []

                    ),


                optionalFields:

                    Object.freeze(

                        options.optionalFields ||

                        []

                    ),


                masking:

                    options.masking !== false,


                minimumCompleteness:

                    options.minimumCompleteness ||
                    50

            });



        this[kPartialMetrics] =
        {

            partialResponses: 0,

            fullResponses: 0,

            missingFields: 0,

            warnings: 0

        };


        Object.freeze(this);
    }



    /**
     * -------------------------------------------------------------------------
     * Execute Partial Response
     * -------------------------------------------------------------------------
     */

    async execute(
        context
    ) {


        validateExecutionContext(
            context
        );



        const response =
            await this.collectPartialData(
                context
            );



        const completeness =
            this.calculateCompleteness(
                response
            );



        const warnings =
            this.generateWarnings(
                response
            );



        if(
            completeness === 100
        ) {


            this[kPartialMetrics]
                .fullResponses++;



            return StrategyExecutionResult.success(

                response.data,

                {

                    strategy:

                        this.name

                }

            );
        }



        this[kPartialMetrics]
            .partialResponses++;



        this[kPartialMetrics]
            .warnings +=
                warnings.length;



        return StrategyExecutionResult.fallback(

            {

                data:

                    response.data,


                completeness,


                degraded:

                    true

            },

            {

                strategy:

                    this.name,


                operation:

                    context.operation,


                fallback:

                    {

                        used:

                            true,


                        strategy:

                            STRATEGY_TYPES
                                .PARTIAL_RESPONSE,


                        source:

                            'PARTIAL_DATA_PROVIDER',


                        degraded:

                            true

                    },


                warnings,


                response:

                    {

                        behaviour:

                            RESPONSE_BEHAVIOURS
                                .PARTIAL

                    }

            }

        );
    }



    /**
     * -------------------------------------------------------------------------
     * Collect Available Data
     * -------------------------------------------------------------------------
     */

    async collectPartialData(
        context
    ) {


        const result =
            await this[kPartialConfiguration]
                .provider(
                    context
                );



        const data = {};

        const missing = [];



        for(
            const field of
            [

                ...this[kPartialConfiguration]
                    .requiredFields,


                ...this[kPartialConfiguration]
                    .optionalFields

            ]
        ) {


            if(
                result[field] !== undefined
            ) {


                data[field] =
                    result[field];


            } else {


                missing.push(
                    field
                );


                this[kPartialMetrics]
                    .missingFields++;

            }
        }



        return {

            data,

            missing

        };
    }



    /**
     * -------------------------------------------------------------------------
     * Completeness Calculation
     * -------------------------------------------------------------------------
     */

    calculateCompleteness(
        response
    ) {


        const totalFields =

            this[kPartialConfiguration]
                .requiredFields.length +

            this[kPartialConfiguration]
                .optionalFields.length;



        if(
            totalFields === 0
        ) {

            return 100;
        }



        const available =

            Object.keys(
                response.data
            )
            .length;



        return Math.round(

            (

                available /

                totalFields

            ) *

            100

        );
    }



    /**
     * -------------------------------------------------------------------------
     * Warning Generation
     * -------------------------------------------------------------------------
     */

    generateWarnings(
        response
    ) {


        return response.missing.map(

            field =>

            ({

                code:

                    'FIELD_UNAVAILABLE',


                field,


                message:

                    `${field} temporarily unavailable`

            })

        );
    }



    /**
     * -------------------------------------------------------------------------
     * Response Schema Protection
     * -------------------------------------------------------------------------
     */

    preserveContract(
        payload
    ) {


        for(
            const field of
            this[kPartialConfiguration]
                .requiredFields
        ) {


            if(
                payload[field] === undefined
            ) {


                payload[field] = null;

            }
        }



        return payload;
    }



    /**
     * -------------------------------------------------------------------------
     * Metrics
     * -------------------------------------------------------------------------
     */

    metrics()
    {

        return {

            ...super.metrics(),


            partial:

                {

                    ...this[kPartialMetrics]

                }

        };
    }



    /**
     * -------------------------------------------------------------------------
     * Diagnostics
     * -------------------------------------------------------------------------
     */

    snapshot()
    {

        return {


            ...super.snapshot(),


            configuration:

                {

                    requiredFields:

                        this[kPartialConfiguration]
                            .requiredFields,


                    optionalFields:

                        this[kPartialConfiguration]
                            .optionalFields

                },


            metrics:

                this[kPartialMetrics]

        };
    }
}

/* =============================================================================
 * 2.2.7 QueueFallbackStrategy
 * -----------------------------------------------------------------------------
 *
 * Enterprise durable queue fallback strategy.
 *
 * Extends:
 *
 * FallbackStrategy
 *
 * Responsibilities:
 *
 * ✓ Durable recovery jobs
 * ✓ Queue execution
 * ✓ Retry scheduling
 * ✓ Dead-letter handling
 * ✓ Job tracking
 * ✓ Idempotent recovery
 *
 * ============================================================================= */


class QueueFallbackStrategy extends FallbackStrategy {


    constructor(options = {}) {


        super({

            name:

                options.name ||
                'queue-fallback',


            type:

                STRATEGY_TYPES.QUEUE,


            priority:

                options.priority ||
                PRIORITY_CLASSES.CRITICAL,


            capabilities:

                [

                    STRATEGY_CAPABILITIES
                        .SUPPORTS_QUEUE,


                    STRATEGY_CAPABILITIES
                        .SUPPORTS_RECOVERY,


                    STRATEGY_CAPABILITIES
                        .SUPPORTS_FINANCIAL_OPERATIONS

                ],


            metadata:

                options.metadata || {}

        });



        assertDefined(

            options.queue,

            'Queue provider required'

        );



        this[kQueueConfiguration] =
            Object.freeze({

                queue:

                    options.queue,


                deadLetterQueue:

                    options.deadLetterQueue ||
                    null,


                retries:

                    options.retries ||
                    5,


                backoff:

                    options.backoff ||
                    {

                        type:
                            'exponential',

                        delay:
                            5000

                    },


                idempotency:

                    options.idempotency !== false,


                jobPrefix:

                    options.jobPrefix ||
                    'degradation',


                audit:

                    options.audit || null

            });



        this[kQueueMetrics] =
        {

            queued: 0,

            retries: 0,

            completed: 0,

            failed: 0,

            deadLetters: 0

        };


        Object.freeze(this);
    }



    /**
     * -------------------------------------------------------------------------
     * Execute Queue Fallback
     * -------------------------------------------------------------------------
     */

    async execute(
        context
    ) {


        validateExecutionContext(
            context
        );



        const job =
            this.createJob(
                context
            );



        await this.enqueue(
            job
        );



        this[kQueueMetrics]
            .queued++;



        await this.audit(

            'RECOVERY_JOB_CREATED',

            job

        );



        return StrategyExecutionResult.fallback(

            {

                queued:

                    true,


                jobId:

                    job.id,


                status:

                    'QUEUED'

            },


            {

                strategy:

                    this.name,


                operation:

                    context.operation,


                fallback:

                    {

                        used:

                            true,


                        strategy:

                            STRATEGY_TYPES.QUEUE,


                        source:

                            'RECOVERY_QUEUE',


                        degraded:

                            true

                    },


                response:

                    {

                        behaviour:

                            RESPONSE_BEHAVIOURS.QUEUED,


                        statusCode:

                            202

                    }

            }

        );
    }



    /**
     * -------------------------------------------------------------------------
     * Create Recovery Job
     * -------------------------------------------------------------------------
     */

    createJob(
        context
    ) {


        const id =
            this.generateJobId(
                context
            );



        return {


            id,


            name:

                `${this[kQueueConfiguration].jobPrefix}:${context.operation}`,



            tenant:

                context.tenant,



            operation:

                context.operation,



            payload:

                context.toJSON(),



            metadata:

                {

                    createdAt:

                        Date.now(),


                    strategy:

                        this.name

                }

        };
    }



    /**
     * -------------------------------------------------------------------------
     * Queue Submit
     * -------------------------------------------------------------------------
     */

    async enqueue(
        job
    ) {


        const options = {


            attempts:

                this[kQueueConfiguration]
                    .retries,


            backoff:

                this[kQueueConfiguration]
                    .backoff,


            removeOnComplete:

                true,


            removeOnFail:

                false

        };



        if(
            this[kQueueConfiguration]
                .idempotency
        ) {


            options.jobId =
                job.id;
        }



        await this[kQueueConfiguration]
            .queue
            .add(

                job.name,

                job,

                options

            );
    }



    /**
     * -------------------------------------------------------------------------
     * Generate Idempotency Key
     * -------------------------------------------------------------------------
     */

    generateJobId(
        context
    ) {


        return [

            this.name,

            context.tenant.tenantId,

            context.operation,

            context.correlationId

        ]
        .join(':');
    }



    /**
     * -------------------------------------------------------------------------
     * Retry Tracking
     * -------------------------------------------------------------------------
     */

    recordRetry()
    {

        this[kQueueMetrics]
            .retries++;
    }



    /**
     * -------------------------------------------------------------------------
     * Completion Hook
     * -------------------------------------------------------------------------
     */

    recordCompletion()
    {

        this[kQueueMetrics]
            .completed++;
    }



    /**
     * -------------------------------------------------------------------------
     * Failure Hook
     * -------------------------------------------------------------------------
     */

    async recordFailure(
        job,
        error
    ) {


        this[kQueueMetrics]
            .failed++;



        if(
            this[kQueueConfiguration]
                .deadLetterQueue
        ) {


            await this[kQueueConfiguration]
                .deadLetterQueue
                .add(

                    job,

                    {

                        error:

                            error.message

                    }

                );


            this[kQueueMetrics]
                .deadLetters++;

        }
    }



    /**
     * -------------------------------------------------------------------------
     * Audit
     * -------------------------------------------------------------------------
     */

    async audit(
        event,
        data
    ) {


        if(
            !this[kQueueConfiguration]
                .audit
        ) {

            return;
        }



        await this[kQueueConfiguration]
            .audit
            .log({

                event,

                strategy:

                    this.name,


                data,

                timestamp:

                    Date.now()

            });
    }



    /**
     * -------------------------------------------------------------------------
     * Metrics
     * -------------------------------------------------------------------------
     */

    metrics()
    {

        return {

            ...super.metrics(),


            queue:

                {

                    ...this[kQueueMetrics]

                }

        };
    }



    /**
     * -------------------------------------------------------------------------
     * Diagnostics
     * -------------------------------------------------------------------------
     */

    snapshot()
    {

        return {


            ...super.snapshot(),


            queue:

                {

                    retries:

                        this[kQueueConfiguration]
                            .retries,


                    idempotent:

                        this[kQueueConfiguration]
                            .idempotency,


                    metrics:

                        this[kQueueMetrics]

                }

        };
    }
}

/* =============================================================================
 * 2.3 GracefulDegradationEngine
 * -----------------------------------------------------------------------------
 *
 * Enterprise resilience orchestration runtime.
 *
 * Responsibilities:
 *
 * ✓ Strategy orchestration
 * ✓ Policy evaluation
 * ✓ Strategy selection
 * ✓ Failure classification
 * ✓ Dependency awareness
 * ✓ Circuit breaker integration
 * ✓ Retry integration
 * ✓ Tenant policies
 * ✓ Runtime switching
 * ✓ Observability events
 *
 * ============================================================================= */


class GracefulDegradationEngine extends EventEmitter {


    constructor(options = {}) {


        super();


        assertDefined(
            options.registry,
            'Strategy registry'
        );



        this[kDegradationEngine] =
        {


            registry:

                options.registry,


            circuitBreaker:

                options.circuitBreaker || null,


            retryEngine:

                options.retryEngine || null,


            policies:

                new Map(),



            dependencyStates:

                new Map(),



            mode:

                RUNTIME_MODES.NORMAL,



            tenantPolicies:

                new Map(),



            metrics:

            {

                executions: 0,

                degraded: 0,

                failures: 0,

                recovered: 0

            }

        };


        Object.freeze(this);
    }



    /**
     * -------------------------------------------------------------------------
     * Register Degradation Policy
     * -------------------------------------------------------------------------
     */

    registerPolicy(
        name,
        policy
    ) {


        validatePolicy(
            policy
        );


        this[kDegradationEngine]
            .policies
            .set(

                name,

                Object.freeze(policy)

            );


        return policy;
    }



    /**
     * -------------------------------------------------------------------------
     * Tenant Policy
     * -------------------------------------------------------------------------
     */

    registerTenantPolicy(
        tenantId,
        policy
    ) {


        this[kDegradationEngine]
            .tenantPolicies
            .set(

                tenantId,

                Object.freeze(policy)

            );
    }



    /**
     * -------------------------------------------------------------------------
     * Main Execution Pipeline
     * -------------------------------------------------------------------------
     */

    async execute(
        operation,
        context,
        handler
    ) {


        this[kDegradationEngine]
            .metrics
            .executions++;



        const dependency =
            context.dependency ||
            operation;



        try {


            const result =
                await this.executePrimary(

                    handler,

                    context

                );


            this.markHealthy(
                dependency
            );


            return result;



        } catch(error) {


            this[kDegradationEngine]
                .metrics
                .failures++;



            return this.handleFailure(

                error,

                operation,

                context

            );
        }
    }



    /**
     * -------------------------------------------------------------------------
     * Primary Execution
     * -------------------------------------------------------------------------
     */

    async executePrimary(
        handler,
        context
    ) {


        if(
            this[kDegradationEngine]
                .retryEngine
        ) {


            return this[kDegradationEngine]
                .retryEngine
                .execute(

                    ()=>handler(context)

                );
        }



        return handler(context);
    }



    /**
     * -------------------------------------------------------------------------
     * Failure Handler
     * -------------------------------------------------------------------------
     */

    async handleFailure(
        error,
        operation,
        context
    ) {


        const classification =
            this.classifyFailure(
                error
            );



        const policy =
            this.resolvePolicy(

                operation,

                context,

                classification

            );



        const strategy =
            this.selectStrategy(
                policy
            );



        this.emit(

            'degradation.started',

            {

                operation,

                strategy:

                    strategy.name,

                error

            }

        );



        const result =
            await strategy.run(
                context
            );



        this[kDegradationEngine]
            .metrics
            .degraded++;



        this.emit(

            'degradation.completed',

            {

                operation,

                result

            }

        );



        return result;
    }



    /**
     * -------------------------------------------------------------------------
     * Failure Classification
     * -------------------------------------------------------------------------
     */

    classifyFailure(
        error
    ) {


        if(
            error.code ===
            'CIRCUIT_OPEN'
        ) {

            return FAILURE_TYPES.CIRCUIT_OPEN;
        }



        if(
            error.code ===
            'CIRCUIT_TIMEOUT'
        ) {

            return FAILURE_TYPES.TIMEOUT;
        }



        if(
            error.code ===
            'ECONNREFUSED'
        ) {

            return FAILURE_TYPES.NETWORK;
        }



        return FAILURE_TYPES.UNKNOWN;
    }



    /**
     * -------------------------------------------------------------------------
     * Policy Resolution
     * -------------------------------------------------------------------------
     */

    resolvePolicy(
        operation,
        context,
        failureType
    ) {


        const tenantPolicy =
            this[kDegradationEngine]
                .tenantPolicies
                .get(

                    context.tenant.tenantId

                );



        if(
            tenantPolicy
        ) {

            return tenantPolicy;
        }



        return (

            this[kDegradationEngine]
                .policies
                .get(operation)

            ||

            this[kDegradationEngine]
                .policies
                .get('default')

        );
    }



    /**
     * -------------------------------------------------------------------------
     * Strategy Selection
     * -------------------------------------------------------------------------
     */

    selectStrategy(
        policy
    ) {


        assertDefined(

            policy,

            'Degradation policy'

        );



        return this[kDegradationEngine]
            .registry
            .resolve({

                type:

                    policy.strategyType,


                capability:

                    policy.capability

            });
    }



    /**
     * -------------------------------------------------------------------------
     * Dependency State
     * -------------------------------------------------------------------------
     */

    markHealthy(
        dependency
    ) {


        this[kDegradationEngine]
            .dependencyStates
            .set(

                dependency,

                DEPENDENCY_STATUS.HEALTHY

            );
    }



    markFailed(
        dependency
    ) {


        this[kDegradationEngine]
            .dependencyStates
            .set(

                dependency,

                DEPENDENCY_STATUS.FAILED

            );
    }



    dependencyHealth(
        dependency
    ) {


        return this[kDegradationEngine]
            .dependencyStates
            .get(
                dependency
            )
            ||
            DEPENDENCY_STATUS.UNKNOWN;
    }



    /**
     * -------------------------------------------------------------------------
     * Runtime Mode Switching
     * -------------------------------------------------------------------------
     */

    setMode(
        mode
    ) {


        validateRuntimeMode(
            mode
        );


        this[kDegradationEngine]
            .mode =
            mode;


        this.emit(

            'runtime.mode.changed',

            {

                mode

            }

        );
    }



    getMode()
    {

        return this[kDegradationEngine]
            .mode;
    }



    /**
     * -------------------------------------------------------------------------
     * Middleware Adapter
     * -------------------------------------------------------------------------
     */

    middleware()
    {


        return async(
            req,
            res,
            next
        )=>{


            req.gracefulDegradation =
                this;


            next();

        };
    }



    /**
     * -------------------------------------------------------------------------
     * Health
     * -------------------------------------------------------------------------
     */

    health()
    {

        return {

            mode:

                this.getMode(),


            metrics:

                {

                    ...this[kDegradationEngine]
                        .metrics

                }

        };
    }



    /**
     * -------------------------------------------------------------------------
     * Shutdown
     * -------------------------------------------------------------------------
     */

    async shutdown()
    {


        this.removeAllListeners();


        this[kDegradationEngine]
            .mode =
            RUNTIME_MODES.SHUTDOWN;
    }
}

/* =============================================================================
 * 2.4 Degradation Policy Engine
 * -----------------------------------------------------------------------------
 *
 * Enterprise policy driven resilience engine.
 *
 * Responsibilities:
 *
 * ✓ Declarative policies
 * ✓ Rule evaluation
 * ✓ Strategy selection
 * ✓ Tenant controls
 * ✓ SLA awareness
 * ✓ Regulatory protection
 *
 * ============================================================================= */


class DegradationPolicyEngine extends EventEmitter {


    constructor(options = {}) {


        super();



        this.policies =
            new Map();



        this.operationPolicies =
            new Map();



        this.tenantPolicies =
            new Map();



        this.dependencyPolicies =
            new Map();



        this.version =
            options.version || "1.0.0";



        this.metrics =
        {

            evaluations:0,

            matches:0,

            failures:0

        };
    }



    /**
     * -------------------------------------------------------------------------
     * Register General Policy
     * -------------------------------------------------------------------------
     */

    registerPolicy(
        name,
        policy
    ) {


        this.validatePolicy(
            policy
        );



        this.policies.set(

            name,

            this.freezePolicy(
                policy
            )

        );


        return this;
    }



    /**
     * -------------------------------------------------------------------------
     * Operation Policy
     * -------------------------------------------------------------------------
     */

    registerOperationPolicy(
        operation,
        policy
    ) {


        this.operationPolicies.set(

            operation,

            this.freezePolicy(
                policy
            )

        );


        return this;
    }



    /**
     * -------------------------------------------------------------------------
     * Tenant Policy
     * -------------------------------------------------------------------------
     */

    registerTenantPolicy(
        tenantId,
        policy
    ) {


        this.tenantPolicies.set(

            tenantId,

            this.freezePolicy(
                policy
            )

        );


        return this;
    }



    /**
     * -------------------------------------------------------------------------
     * Dependency Policy
     * -------------------------------------------------------------------------
     */

    registerDependencyPolicy(
        dependency,
        policy
    ) {


        this.dependencyPolicies.set(

            dependency,

            this.freezePolicy(
                policy
            )

        );


        return this;
    }



    /**
     * -------------------------------------------------------------------------
     * Main Policy Evaluation
     * -------------------------------------------------------------------------
     */

    evaluate(
        context
    ) {


        this.metrics.evaluations++;



        const candidates = [];



        const operation =
            this.operationPolicies.get(

                context.operation

            );



        if(operation)
        {
            candidates.push(operation);
        }



        const tenant =
            this.tenantPolicies.get(

                context.tenant?.tenantId

            );



        if(tenant)
        {
            candidates.push(tenant);
        }



        const dependency =
            this.dependencyPolicies.get(

                context.dependency

            );



        if(dependency)
        {
            candidates.push(dependency);
        }



        const defaultPolicy =
            this.policies.get(
                "default"
            );



        if(defaultPolicy)
        {
            candidates.push(defaultPolicy);
        }



        const selected =
            this.selectHighestPriority(

                candidates

            );



        if(selected)
        {

            this.metrics.matches++;


            this.emit(

                "policy.selected",

                {

                    policy:selected

                }

            );
        }



        return selected;
    }



    /**
     * -------------------------------------------------------------------------
     * Priority Resolution
     * -------------------------------------------------------------------------
     */

    selectHighestPriority(
        policies
    ) {


        if(
            !policies.length
        )
        {
            return null;
        }



        return policies.sort(

            (a,b)=>

                (

                    b.priority || 0

                )

                -

                (

                    a.priority || 0

                )

        )[0];
    }



    /**
     * -------------------------------------------------------------------------
     * SLA Evaluation
     * -------------------------------------------------------------------------
     */

    evaluateSLA(
        policy,
        context
    ) {


        if(
            !policy.sla
        )
        {
            return true;
        }



        if(
            context.latency >
            policy.sla.maxLatency
        )
        {

            return false;
        }



        return true;
    }



    /**
     * -------------------------------------------------------------------------
     * Regulatory Validation
     * -------------------------------------------------------------------------
     */

    validateRegulatoryControls(
        policy,
        context
    ) {


        if(
            !policy.regulatory
        )
        {
            return true;
        }



        if(
            context.operation ===
            "LEDGER_WRITE"
            &&
            policy.regulatory.blockLedgerWrites
        )
        {

            return false;
        }



        return true;
    }



    /**
     * -------------------------------------------------------------------------
     * Financial Protection Rules
     * -------------------------------------------------------------------------
     */

    protectsFinancialOperation(
        policy,
        context
    ) {


        if(
            !policy.financial
        )
        {
            return false;
        }



        return (

            context.operation

            .includes(

                "PAYMENT"

            )

            ||

            context.operation

            .includes(

                "LEDGER"

            )

        );
    }



    /**
     * -------------------------------------------------------------------------
     * Strategy Resolution
     * -------------------------------------------------------------------------
     */

    resolveStrategy(
        policy
    ) {


        return {

            strategy:

                policy.strategy,


            retry:

                policy.retry || null,


            timeout:

                policy.timeout || null

        };
    }



    /**
     * -------------------------------------------------------------------------
     * Policy Validation
     * -------------------------------------------------------------------------
     */

    validatePolicy(
        policy
    ) {


        if(
            !policy.strategy
        )
        {

            throw new Error(

                "Policy requires strategy"

            );
        }
    }



    freezePolicy(
        policy
    )
    {


        return Object.freeze({

            ...policy,


            version:

                this.version,


            createdAt:

                Date.now()

        });
    }



    /**
     * -------------------------------------------------------------------------
     * Diagnostics
     * -------------------------------------------------------------------------
     */

    snapshot()
    {

        return {

            version:

                this.version,


            policies:

                this.policies.size,


            operations:

                this.operationPolicies.size,


            tenants:

                this.tenantPolicies.size,


            dependencies:

                this.dependencyPolicies.size,


            metrics:

                this.metrics

        };
    }



    shutdown()
    {

        this.removeAllListeners();


        this.policies.clear();

        this.operationPolicies.clear();

        this.tenantPolicies.clear();

        this.dependencyPolicies.clear();
    }
}

/* =============================================================================
 * 2.5 Resilience Decision Orchestrator
 * -----------------------------------------------------------------------------
 *
 * Enterprise resilience decision brain.
 *
 * Coordinates:
 *
 * ✓ Circuit breakers
 * ✓ Retry engine
 * ✓ Policy engine
 * ✓ Graceful degradation
 * ✓ Fallback strategies
 * ✓ Tenant protection
 * ✓ Financial safety
 * ✓ Observability
 *
 * ============================================================================= */


class ResilienceDecisionOrchestrator extends EventEmitter {


    constructor(options = {}) {


        super();


        this.circuitBreaker =
            options.circuitBreaker || null;


        this.retryEngine =
            options.retryEngine || null;


        this.policyEngine =
            options.policyEngine || null;


        this.degradationEngine =
            options.degradationEngine || null;


        this.audit =
            options.audit || null;


        this.metrics =
        {

            executions:0,

            successes:0,

            failures:0,

            degraded:0,

            blocked:0

        };


        this.mode =
            "ACTIVE";
    }



    /**
     * -------------------------------------------------------------------------
     * Main Runtime Pipeline
     * -------------------------------------------------------------------------
     */

    async execute(
        operation,
        context,
        handler
    ) {


        this.metrics.executions++;



        const decisionContext =
            this.createDecisionContext(

                operation,

                context

            );



        this.emit(

            "resilience.started",

            decisionContext

        );



        try {


            this.validateTenantIsolation(
                context
            );



            this.validateFinancialSafety(
                context
            );



            const policy =
                this.resolvePolicy(
                    decisionContext
                );



            const result =
                await this.executeProtected(

                    operation,

                    context,

                    handler,

                    policy

                );



            this.metrics.successes++;



            await this.recordSuccess(
                decisionContext
            );



            return result;



        } catch(error) {


            this.metrics.failures++;



            return this.handleFailure(

                error,

                decisionContext,

                context

            );
        }
    }



    /**
     * -------------------------------------------------------------------------
     * Protected Execution Pipeline
     * -------------------------------------------------------------------------
     */

    async executeProtected(
        operation,
        context,
        handler,
        policy
    ) {


        const execute =
            async()=>{


                if(
                    this.circuitBreaker
                )
                {

                    return this.circuitBreaker.execute(

                        ()=>handler(context),

                        context

                    );
                }



                return handler(context);

            };



        if(
            this.retryEngine
        )
        {

            return this.retryEngine.execute(

                execute,

                {

                    operation,

                    policy

                }

            );
        }



        return execute();
    }



    /**
     * -------------------------------------------------------------------------
     * Failure Processing
     * -------------------------------------------------------------------------
     */

    async handleFailure(
        error,
        decisionContext,
        context
    ) {


        const failure =
            this.classifyFailure(
                error
            );



        const score =
            this.calculateFailureScore(

                failure,

                error

            );



        this.emit(

            "failure.detected",

            {

                failure,

                score,

                error

            }

        );



        const policy =
            this.resolvePolicy(

                decisionContext

            );



        if(
            this.isFinancialRisk(
                context
            )
        )
        {


            return this.activateSafetyGate(

                error,

                context

            );
        }



        if(
            this.degradationEngine
        )
        {


            this.metrics.degraded++;



            return this.degradationEngine.execute(

                decisionContext.operation,

                context,

                ()=>{

                    throw error;

                }

            );
        }



        throw error;
    }



    /**
     * -------------------------------------------------------------------------
     * Policy Resolution
     * -------------------------------------------------------------------------
     */

    resolvePolicy(
        context
    )
    {


        if(
            !this.policyEngine
        )
        {
            return null;
        }



        return this.policyEngine.evaluate(
            context
        );
    }



    /**
     * -------------------------------------------------------------------------
     * Failure Classification
     * -------------------------------------------------------------------------
     */

    classifyFailure(
        error
    )
    {


        if(
            error.code ===
            "CIRCUIT_OPEN"
        )
        {
            return "DEPENDENCY_UNAVAILABLE";
        }



        if(
            error.code ===
            "TIMEOUT"
        )
        {
            return "TIMEOUT";
        }



        if(
            error.name ===
            "ValidationError"
        )
        {
            return "VALIDATION";
        }



        return "UNKNOWN";
    }



    /**
     * -------------------------------------------------------------------------
     * Failure Scoring
     * -------------------------------------------------------------------------
     */

    calculateFailureScore(
        type,
        error
    )
    {


        const weights =
        {

            DEPENDENCY_UNAVAILABLE:90,

            TIMEOUT:70,

            VALIDATION:20,

            UNKNOWN:50

        };



        return weights[type] || 50;
    }



    /**
     * -------------------------------------------------------------------------
     * Tenant Isolation
     * -------------------------------------------------------------------------
     */

    validateTenantIsolation(
        context
    )
    {


        if(
            !context.tenant
        )
        {

            throw new Error(

                "Tenant context missing"

            );
        }
    }



    /**
     * -------------------------------------------------------------------------
     * Financial Safety Gate
     * -------------------------------------------------------------------------
     */

    validateFinancialSafety(
        context
    )
    {


        if(
            !context.operation
        )
        {
            return;
        }



        if(

            context.operation.includes(
                "LEDGER"
            )

            &&

            !context.transactionContext

        )
        {

            throw new Error(

                "Unsafe financial operation"

            );
        }
    }



    /**
     * -------------------------------------------------------------------------
     * Financial Risk Detection
     * -------------------------------------------------------------------------
     */

    isFinancialRisk(
        context
    )
    {


        return (

            context.operation.includes(
                "PAYMENT"
            )

            ||

            context.operation.includes(
                "LEDGER"
            )

            ||

            context.operation.includes(
                "DISBURSE"
            )

        );
    }



    /**
     * -------------------------------------------------------------------------
     * Safety Gate
     * -------------------------------------------------------------------------
     */

    async activateSafetyGate(
        error,
        context
    )
    {


        this.metrics.blocked++;



        await this.audit?.log({

            event:

                "FINANCIAL_OPERATION_BLOCKED",


            tenant:

                context.tenant,


            operation:

                context.operation,


            error:

                error.message

        });



        return {

            status:

                "BLOCKED",


            reason:

                "FINANCIAL_SAFETY_GATE",


            recoverable:

                true

        };
    }



    /**
     * -------------------------------------------------------------------------
     * Context Builder
     * -------------------------------------------------------------------------
     */

    createDecisionContext(
        operation,
        context
    )
    {


        return {

            operation,

            dependency:

                context.dependency,


            tenant:

                context.tenant,


            correlationId:

                context.correlationId,


            timestamp:

                Date.now()

        };
    }



    async recordSuccess(
        context
    )
    {


        this.emit(

            "resilience.completed",

            context

        );
    }



    /**
     * -------------------------------------------------------------------------
     * Health
     * -------------------------------------------------------------------------
     */

    health()
    {

        return {

            mode:

                this.mode,


            metrics:

                this.metrics

        };
    }



    async shutdown()
    {

        this.mode =
            "STOPPED";


        this.removeAllListeners();
    }
}
