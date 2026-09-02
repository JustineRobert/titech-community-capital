"use strict";

/**
 * =============================================================================
 * TITech Community Capital Ltd
 * Enterprise Community Capital Platform
 * =============================================================================
 *
 * File: backend/middleware/resilience/retryPolicy.js
 *
 * Enterprise Retry Policy & Resilience Framework
 *
 * -----------------------------------------------------------------------------
 * PURPOSE
 * -----------------------------------------------------------------------------
 *
 * Provides a production-grade retry framework for enterprise services,
 * middleware, repositories, payment gateways, databases, external APIs,
 * messaging systems, distributed workflows, and background jobs.
 *
 * This module is intentionally framework-agnostic and integrates with Express,
 * MongoDB, Redis, BullMQ, MTN MoMo, Airtel Money, HTTP clients, queues,
 * OpenTelemetry, AsyncLocalStorage, Circuit Breakers, and enterprise
 * observability tooling.
 *
 * -----------------------------------------------------------------------------
 * DESIGN GOALS
 * -----------------------------------------------------------------------------
 *
 * ✓ Enterprise configuration
 * ✓ Immutable runtime configuration
 * ✓ Retry policy registry
 * ✓ Adaptive retry strategies
 * ✓ Deadline propagation
 * ✓ Retry budgets
 * ✓ Error classification
 * ✓ Request context propagation
 * ✓ AsyncLocalStorage integration
 * ✓ OpenTelemetry integration
 * ✓ Metrics integration
 * ✓ Structured logging
 * ✓ Hook system
 * ✓ Circuit breaker coordination
 * ✓ Graceful shutdown awareness
 * ✓ Idempotency protection
 * ✓ Express middleware support
 * ✓ Promise/async support
 * ✓ Repository/service compatibility
 *
 * -----------------------------------------------------------------------------
 * SUPPORTED RETRY TARGETS
 * -----------------------------------------------------------------------------
 *
 * • MongoDB
 * • Redis
 * • PostgreSQL
 * • MySQL
 * • External REST APIs
 * • GraphQL APIs
 * • MTN MoMo
 * • Airtel Money
 * • Payment Providers
 * • BullMQ
 * • RabbitMQ
 * • Kafka
 * • SMTP
 * • Filesystem
 * • Object Storage
 * • Webhooks
 * • Internal Microservices
 *
 * -----------------------------------------------------------------------------
 * ENTERPRISE FEATURES
 * -----------------------------------------------------------------------------
 *
 * • Exponential Backoff
 * • Linear Backoff
 * • Constant Delay
 * • Fibonacci Delay
 * • Adaptive Delay
 * • Decorrelated Exponential Backoff
 * • Full Jitter
 * • Equal Jitter
 * • Decorrelated Jitter
 * • Retry Budgets
 * • Retry Classification
 * • Retry Events
 * • Retry Metrics
 * • Retry Hooks
 * • Retry Diagnostics
 * • Retry Tracing
 * • Retry Deadlines
 * • Retry Cancellation
 *
 * -----------------------------------------------------------------------------
 * IMPLEMENTATION NOTES
 * -----------------------------------------------------------------------------
 *
 * This file forms the foundation of the enterprise resilience subsystem.
 * Subsequent sections add:
 *
 *   • Constants
 *   • Error hierarchy
 *   • Configuration engine
 *   • Delay strategies
 *   • Budget manager
 *   • Retry executor
 *   • Registry
 *   • Middleware
 *   • Diagnostics
 *
 * =============================================================================
 */

const os = require("os");
const crypto = require("crypto");
const process = require("process");
const { EventEmitter } = require("events");
const { performance } = require("perf_hooks");
const { AsyncLocalStorage } = require("async_hooks");

/* -------------------------------------------------------------------------- */
/* Optional Enterprise Dependencies                                           */
/* -------------------------------------------------------------------------- */

let logger = console;
let metrics = null;
let tracer = null;
let requestContext = null;
let shutdownManager = null;
let circuitRegistry = null;

/**
 * Safely load an optional internal dependency.
 *
 * Missing enterprise integrations must never prevent
 * the application from starting.
 */
function optionalRequire(path) {
    try {
        return require(path);
    } catch (_) {
        return null;
    }
}

/* -------------------------------------------------------------------------- */
/* Internal Enterprise Integrations                                           */
/* -------------------------------------------------------------------------- */

/**
 * These modules are optional. They are loaded only if
 * they exist within the project.
 *
 * This keeps retryPolicy.js reusable while allowing
 * deep integration with enterprise infrastructure.
 */

const StructuredLogger =
    optionalRequire("../../shared/logging/StructuredLogger");

const LoggerFactory =
    optionalRequire("../../shared/logging/LoggerFactory");

const RequestContext =
    optionalRequire("../../shared/context/RequestContext");

const RequestContextFactory =
    optionalRequire("../../shared/context/RequestContextFactory");

const MetricsProvider =
    optionalRequire("../../shared/observability/MetricsProvider");

const TelemetryProvider =
    optionalRequire("../../shared/observability/OpenTelemetryProvider");

const ShutdownManager =
    optionalRequire("../../core/shutdown/ShutdownManager");

const CircuitRegistry =
    optionalRequire("../circuitBreaker/circuitRegistry");

/* -------------------------------------------------------------------------- */
/* Initialize Enterprise Providers                                            */
/* -------------------------------------------------------------------------- */

if (LoggerFactory?.create) {
    logger = LoggerFactory.create("RetryPolicy");
} else if (StructuredLogger) {
    logger = StructuredLogger;
}

if (MetricsProvider) {
    metrics = MetricsProvider;
}

if (TelemetryProvider) {
    tracer = TelemetryProvider;
}

if (RequestContext || RequestContextFactory) {
    requestContext = RequestContext || RequestContextFactory;
}

if (ShutdownManager) {
    shutdownManager = ShutdownManager;
}

if (CircuitRegistry) {
    circuitRegistry = CircuitRegistry;
}

/* -------------------------------------------------------------------------- */
/* Runtime Feature Detection                                                  */
/* -------------------------------------------------------------------------- */

const runtime = Object.freeze({
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    hostname: os.hostname(),
    cpuCount: os.cpus().length,
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    processId: process.pid,
    uptime: process.uptime(),
    highResolutionTimer: typeof performance.now === "function",
    cryptoRandomUUID: typeof crypto.randomUUID === "function",
    asyncLocalStorage: typeof AsyncLocalStorage === "function",
    abortController: typeof globalThis.AbortController === "function",
    eventEmitter: typeof EventEmitter === "function",
    weakRef: typeof WeakRef === "function",
    finalizationRegistry: typeof FinalizationRegistry === "function",
    structuredClone: typeof globalThis.structuredClone === "function"
});

/* -------------------------------------------------------------------------- */
/* Enterprise Capability Detection                                            */
/* -------------------------------------------------------------------------- */

const capabilities = Object.freeze({
    logging: Boolean(logger),
    metrics: Boolean(metrics),
    tracing: Boolean(tracer),
    requestContext: Boolean(requestContext),
    shutdownManager: Boolean(shutdownManager),
    circuitBreaker: Boolean(circuitRegistry),
    asyncLocalStorage: runtime.asyncLocalStorage,
    deadlines: runtime.abortController,
    cryptoUUID: runtime.cryptoRandomUUID
});

/* -------------------------------------------------------------------------- */
/* Shared Runtime Objects                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Internal event bus used throughout the retry framework.
 * Lifecycle events are emitted here and can later be consumed
 * by diagnostics, metrics, tracing, and dashboards.
 */
const retryEventBus = new EventEmitter();

/**
 * AsyncLocalStorage instance for retry execution context.
 * Future sections will propagate retry metadata, trace IDs,
 * correlation IDs, tenant IDs, and request-scoped state.
 */
const retryAsyncContext = new AsyncLocalStorage();

/* -------------------------------------------------------------------------- */
/* Startup Diagnostics                                                        */
/* -------------------------------------------------------------------------- */

logger?.info?.("Enterprise Retry Policy initialized.", {
    module: "retryPolicy",
    node: runtime.nodeVersion,
    platform: runtime.platform,
    pid: runtime.processId,
    capabilities
});

/* -------------------------------------------------------------------------- */
/* End of Section 1                                                           */
/* -------------------------------------------------------------------------- */

/* =============================================================================
 * SECTION 2 — Enterprise Constants
 * =============================================================================
 *
 * This section defines the immutable contracts used throughout the enterprise
 * resilience framework.
 *
 * DO NOT modify these objects at runtime.
 * All constants are deeply immutable.
 *
 * ========================================================================== */

/**
 * Deep freeze helper.
 */
function deepFreeze(object) {
    if (!object || typeof object !== "object") {
        return object;
    }

    Object.getOwnPropertyNames(object).forEach((name) => {
        const value = object[name];

        if (
            value &&
            typeof value === "object" &&
            !Object.isFrozen(value)
        ) {
            deepFreeze(value);
        }
    });

    return Object.freeze(object);
}

/* -------------------------------------------------------------------------- */
/* Retry Strategies                                                           */
/* -------------------------------------------------------------------------- */

const RETRY_STRATEGIES = deepFreeze({

    CONSTANT: "constant",

    LINEAR: "linear",

    EXPONENTIAL: "exponential",

    EXPONENTIAL_FULL_JITTER: "exponential-full-jitter",

    EXPONENTIAL_EQUAL_JITTER: "exponential-equal-jitter",

    DECORRELATED: "decorrelated",

    DECORRELATED_EXPONENTIAL: "decorrelated-exponential",

    FIBONACCI: "fibonacci",

    ADAPTIVE: "adaptive",

    CUSTOM: "custom"

});

/* -------------------------------------------------------------------------- */
/* Jitter Algorithms                                                          */
/* -------------------------------------------------------------------------- */

const JITTER_TYPES = deepFreeze({

    NONE: "none",

    FULL: "full",

    EQUAL: "equal",

    DECORRELATED: "decorrelated",

    RANDOM: "random"

});

/* -------------------------------------------------------------------------- */
/* Retry Classifications                                                      */
/* -------------------------------------------------------------------------- */

const RETRY_CLASSIFICATIONS = deepFreeze({

    NETWORK: "network",

    DATABASE: "database",

    CACHE: "cache",

    HTTP: "http",

    FILESYSTEM: "filesystem",

    STORAGE: "storage",

    MESSAGE_QUEUE: "message-queue",

    PAYMENT_GATEWAY: "payment-gateway",

    WEBHOOK: "webhook",

    DNS: "dns",

    TLS: "tls",

    AUTHENTICATION: "authentication",

    AUTHORIZATION: "authorization",

    RATE_LIMIT: "rate-limit",

    TIMEOUT: "timeout",

    UNKNOWN: "unknown"

});

/* -------------------------------------------------------------------------- */
/* Error Classes                                                              */
/* -------------------------------------------------------------------------- */

const ERROR_CLASSES = deepFreeze({

    CONFIGURATION: "configuration",

    EXECUTION: "execution",

    TIMEOUT: "timeout",

    DEADLINE: "deadline",

    BUDGET: "budget",

    VALIDATION: "validation",

    SHUTDOWN: "shutdown",

    CIRCUIT_OPEN: "circuit-open",

    CANCELLED: "cancelled",

    CLASSIFICATION: "classification",

    REGISTRY: "registry",

    INTERNAL: "internal"

});

/* -------------------------------------------------------------------------- */
/* Cancellation Reasons                                                       */
/* -------------------------------------------------------------------------- */

const CANCELLATION_REASONS = deepFreeze({

    CLIENT_DISCONNECTED: "client-disconnected",

    SERVER_SHUTDOWN: "server-shutdown",

    DEADLINE_EXCEEDED: "deadline-exceeded",

    REQUEST_TIMEOUT: "request-timeout",

    CIRCUIT_OPEN: "circuit-open",

    MANUAL: "manual",

    KUBERNETES_SIGTERM: "kubernetes-sigterm",

    ABORT_CONTROLLER: "abort-controller"

});

/* -------------------------------------------------------------------------- */
/* Retry Lifecycle Events                                                     */
/* -------------------------------------------------------------------------- */

const RETRY_EVENTS = deepFreeze({

    STARTED: "retry.started",

    ATTEMPT_STARTED: "retry.attempt.started",

    ATTEMPT_COMPLETED: "retry.attempt.completed",

    SUCCESS: "retry.success",

    FAILURE: "retry.failure",

    GIVE_UP: "retry.give-up",

    CANCELLED: "retry.cancelled",

    TIMEOUT: "retry.timeout",

    DEADLINE_EXCEEDED: "retry.deadline",

    BUDGET_EXHAUSTED: "retry.budget.exhausted",

    CIRCUIT_OPEN: "retry.circuit.open"

});

/* -------------------------------------------------------------------------- */
/* Retry Hooks                                                                */
/* -------------------------------------------------------------------------- */

const RETRY_HOOKS = deepFreeze({

    BEFORE_EXECUTION: "beforeExecution",

    AFTER_EXECUTION: "afterExecution",

    BEFORE_ATTEMPT: "beforeAttempt",

    AFTER_ATTEMPT: "afterAttempt",

    BEFORE_RETRY: "beforeRetry",

    AFTER_RETRY: "afterRetry",

    ON_SUCCESS: "onSuccess",

    ON_FAILURE: "onFailure",

    ON_GIVE_UP: "onGiveUp",

    ON_TIMEOUT: "onTimeout",

    ON_CANCELLED: "onCancelled"

});

/* -------------------------------------------------------------------------- */
/* Enterprise Metrics                                                         */
/* -------------------------------------------------------------------------- */

const RETRY_METRICS = deepFreeze({

    ATTEMPTS_TOTAL: "retry_attempt_total",

    SUCCESS_TOTAL: "retry_success_total",

    FAILURE_TOTAL: "retry_failure_total",

    GIVEUP_TOTAL: "retry_giveup_total",

    CANCEL_TOTAL: "retry_cancel_total",

    TIMEOUT_TOTAL: "retry_timeout_total",

    BUDGET_EXHAUSTED_TOTAL: "retry_budget_exhausted_total",

    DELAY_HISTOGRAM: "retry_delay_histogram",

    DURATION_HISTOGRAM: "retry_duration_histogram",

    ATTEMPT_HISTOGRAM: "retry_attempt_histogram"

});

/* -------------------------------------------------------------------------- */
/* Enterprise Policy Names                                                    */
/* -------------------------------------------------------------------------- */

const POLICY_NAMES = deepFreeze({

    DEFAULT: "default",

    HTTP: "http",

    MONGODB: "mongodb",

    REDIS: "redis",

    POSTGRES: "postgres",

    MYSQL: "mysql",

    PAYMENT: "payment",

    WEBHOOK: "webhook",

    NOTIFICATION: "notification",

    STORAGE: "storage",

    FILESYSTEM: "filesystem",

    MESSAGE_QUEUE: "message-queue"

});

/* -------------------------------------------------------------------------- */
/* Retry Context Keys                                                         */
/* -------------------------------------------------------------------------- */

const CONTEXT_KEYS = deepFreeze({

    RETRY_ID: "retryId",

    EXECUTION_ID: "executionId",

    REQUEST_ID: "requestId",

    CORRELATION_ID: "correlationId",

    TRACE_ID: "traceId",

    SPAN_ID: "spanId",

    TENANT_ID: "tenantId",

    USER_ID: "userId",

    POLICY: "policy",

    CLASSIFICATION: "classification",

    STRATEGY: "strategy",

    DEADLINE: "deadline",

    LOGGER: "logger",

    METRICS: "metrics",

    TRACER: "tracer",

    SIGNAL: "signal",

    OPERATION: "operation",

    SERVICE: "service"

});

/* -------------------------------------------------------------------------- */
/* Retryable HTTP Status Codes                                                */
/* -------------------------------------------------------------------------- */

const RETRYABLE_HTTP_STATUS_CODES = deepFreeze([

    408, // Request Timeout

    409, // Conflict

    425, // Too Early

    429, // Too Many Requests

    500,

    502,

    503,

    504

]);

/* -------------------------------------------------------------------------- */
/* Retryable Node.js Error Codes                                              */
/* -------------------------------------------------------------------------- */

const RETRYABLE_NODE_ERRORS = deepFreeze([

    "ECONNRESET",

    "ECONNREFUSED",

    "ECONNABORTED",

    "EPIPE",

    "EHOSTUNREACH",

    "ENETDOWN",

    "ENETRESET",

    "ENOTFOUND",

    "ETIMEDOUT",

    "EAI_AGAIN",

    "ECANCELED"

]);

/* -------------------------------------------------------------------------- */
/* Retryable Mongo Errors                                                     */
/* -------------------------------------------------------------------------- */

const RETRYABLE_MONGO_ERRORS = deepFreeze([

    "MongoNetworkError",

    "MongoNetworkTimeoutError",

    "MongoServerSelectionError",

    "MongoWriteConcernError",

    "MongoTopologyClosedError",

    "MongoCursorExhaustedError"

]);

/* -------------------------------------------------------------------------- */
/* Retryable Redis Errors                                                     */
/* -------------------------------------------------------------------------- */

const RETRYABLE_REDIS_ERRORS = deepFreeze([

    "ConnectionTimeoutError",

    "AbortError",

    "MaxRetriesPerRequestError",

    "SocketClosedUnexpectedlyError",

    "ClusterAllFailedError"

]);

/* -------------------------------------------------------------------------- */
/* Retryable Axios Errors                                                     */
/* -------------------------------------------------------------------------- */

const RETRYABLE_AXIOS_ERRORS = deepFreeze([

    "ECONNABORTED",

    "ERR_NETWORK",

    "ETIMEDOUT",

    "ECONNRESET",

    "ENOTFOUND",

    "EAI_AGAIN"

]);

/* -------------------------------------------------------------------------- */
/* Export Bundle (internal use until final module.exports)                    */
/* -------------------------------------------------------------------------- */

const RETRY_CONSTANTS = deepFreeze({

    RETRY_STRATEGIES,

    JITTER_TYPES,

    RETRY_CLASSIFICATIONS,

    ERROR_CLASSES,

    CANCELLATION_REASONS,

    RETRY_EVENTS,

    RETRY_HOOKS,

    RETRY_METRICS,

    POLICY_NAMES,

    CONTEXT_KEYS,

    RETRYABLE_HTTP_STATUS_CODES,

    RETRYABLE_NODE_ERRORS,

    RETRYABLE_MONGO_ERRORS,

    RETRYABLE_REDIS_ERRORS,

    RETRYABLE_AXIOS_ERRORS

});

/* =============================================================================
 * End of Section 2
 * ============================================================================= */

/* =============================================================================
 * SECTION 3 — Enterprise Default Configuration
 * =============================================================================
 *
 * This section defines the immutable default configuration used by every retry
 * policy unless explicitly overridden.
 *
 * Configuration Philosophy
 * ------------------------
 *  • Immutable by default
 *  • Safe for fintech workloads
 *  • Production-first defaults
 *  • Cloud-native
 *  • Kubernetes-friendly
 *  • OpenTelemetry-ready
 *  • AsyncLocalStorage-aware
 *  • Circuit-breaker aware
 *  • Deadline-aware
 *  • Request-context aware
 *  • Multi-tenant compatible
 *
 * ========================================================================== */

/* -------------------------------------------------------------------------- */
/* Default Retry Budget Configuration                                         */
/* -------------------------------------------------------------------------- */

const DEFAULT_RETRY_BUDGET = deepFreeze({

    enabled: true,

    strategy: "per-execution",

    maxRetriesPerExecution: 5,

    maxBudget: 500,

    replenishIntervalMs: 60000,

    adaptive: true

});

/* -------------------------------------------------------------------------- */
/* Default Deadline Configuration                                             */
/* -------------------------------------------------------------------------- */

const DEFAULT_DEADLINE_CONFIGURATION = deepFreeze({

    enabled: true,

    timeout: 60000,

    gracePeriod: 500,

    propagate: true,

    inheritFromRequest: true,

    inheritFromParent: true

});

/* -------------------------------------------------------------------------- */
/* Default Adaptive Retry Configuration                                       */
/* -------------------------------------------------------------------------- */

const DEFAULT_ADAPTIVE_CONFIGURATION = deepFreeze({

    enabled: true,

    minDelay: 200,

    maxDelay: 30000,

    factor: 2,

    strategy: RETRY_STRATEGIES.ADAPTIVE,

    jitter: JITTER_TYPES.DECORRELATED,

    cpuAware: true,

    latencyAware: true,

    failureRateAware: true

});

/* -------------------------------------------------------------------------- */
/* Default Circuit Breaker Coordination                                       */
/* -------------------------------------------------------------------------- */

const DEFAULT_CIRCUIT_CONFIGURATION = deepFreeze({

    enabled: true,

    respectOpenCircuit: true,

    failFastWhenOpen: true,

    allowHalfOpenProbe: true,

    notifyCircuit: true

});

/* -------------------------------------------------------------------------- */
/* Default AsyncLocalStorage Configuration                                    */
/* -------------------------------------------------------------------------- */

const DEFAULT_ASYNC_CONTEXT_CONFIGURATION = deepFreeze({

    enabled: true,

    propagateRequestContext: true,

    propagateTracingContext: true,

    propagateTenantContext: true,

    propagateAuthentication: true,

    propagateMetadata: true

});

/* -------------------------------------------------------------------------- */
/* Default Tracing Configuration                                               */
/* -------------------------------------------------------------------------- */

const DEFAULT_TRACING_CONFIGURATION = deepFreeze({

    enabled: true,

    provider: "opentelemetry",

    createSpanPerExecution: true,

    createSpanPerAttempt: true,

    recordEvents: true,

    recordExceptions: true,

    propagateContext: true

});

/* -------------------------------------------------------------------------- */
/* Default Metrics Configuration                                              */
/* -------------------------------------------------------------------------- */

const DEFAULT_METRICS_CONFIGURATION = deepFreeze({

    enabled: true,

    provider: "prometheus",

    collectAttempts: true,

    collectLatency: true,

    collectDelayHistogram: true,

    collectFailureRate: true,

    collectSuccessRate: true,

    collectBudgetUsage: true

});

/* -------------------------------------------------------------------------- */
/* Default Hook Configuration                                                 */
/* -------------------------------------------------------------------------- */

const DEFAULT_HOOK_CONFIGURATION = deepFreeze({

    enabled: true,

    failOnHookError: false,

    executeSequentially: true,

    timeout: 5000

});

/* -------------------------------------------------------------------------- */
/* Default Policy Registry Configuration                                      */
/* -------------------------------------------------------------------------- */

const DEFAULT_POLICY_REGISTRY_CONFIGURATION = deepFreeze({

    enabled: true,

    immutable: false,

    autoRegisterDefaults: true,

    allowCustomPolicies: true,

    cachePolicies: true

});

/* -------------------------------------------------------------------------- */
/* Default Graceful Shutdown Configuration                                    */
/* -------------------------------------------------------------------------- */

const DEFAULT_SHUTDOWN_CONFIGURATION = deepFreeze({

    enabled: true,

    cancelOutstandingRetries: true,

    rejectNewExecutions: true,

    shutdownReason: CANCELLATION_REASONS.SERVER_SHUTDOWN

});

/* -------------------------------------------------------------------------- */
/* Default Request Context Configuration                                      */
/* -------------------------------------------------------------------------- */

const DEFAULT_REQUEST_CONTEXT_CONFIGURATION = deepFreeze({

    enabled: true,

    inheritTenantId: true,

    inheritUserId: true,

    inheritRequestId: true,

    inheritCorrelationId: true,

    inheritTraceId: true,

    inheritSpanId: true,

    inheritLogger: true,

    inheritMetrics: true,

    inheritTracer: true

});

/* -------------------------------------------------------------------------- */
/* Default Idempotency Configuration                                          */
/* -------------------------------------------------------------------------- */

const DEFAULT_IDEMPOTENCY_CONFIGURATION = deepFreeze({

    enabled: true,

    validateHttpMethod: true,

    validateIdempotencyKey: true,

    validateRequestId: true,

    allowSafePost: false,

    requirePaymentTransactionId: true,

    requireTransferReference: true,

    requireLedgerReference: true

});

/* -------------------------------------------------------------------------- */
/* Enterprise Default Retry Configuration                                     */
/* -------------------------------------------------------------------------- */

const DEFAULT_RETRY_CONFIGURATION = deepFreeze({

    policyName: POLICY_NAMES.DEFAULT,

    retries: 5,

    timeout: 60000,

    strategy: RETRY_STRATEGIES.ADAPTIVE,

    jitter: JITTER_TYPES.DECORRELATED,

    minDelay: 200,

    maxDelay: 30000,

    factor: 2,

    classifyErrors: true,

    enableRetryClassification: true,

    enableAdaptiveRetry: true,

    enableTracing: true,

    enableMetrics: true,

    enableHooks: true,

    enableDiagnostics: true,

    enableEventBus: true,

    enablePolicyRegistry: true,

    enableDeadlinePropagation: true,

    enableAsyncContext: true,

    enableRequestContext: true,

    enableGracefulShutdown: true,

    enableCircuitBreakerCoordination: true,

    enableIdempotencyValidation: true,

    validateConfiguration: true,

    freezeConfiguration: true,

    budget: DEFAULT_RETRY_BUDGET,

    deadline: DEFAULT_DEADLINE_CONFIGURATION,

    adaptive: DEFAULT_ADAPTIVE_CONFIGURATION,

    tracing: DEFAULT_TRACING_CONFIGURATION,

    metrics: DEFAULT_METRICS_CONFIGURATION,

    hooks: DEFAULT_HOOK_CONFIGURATION,

    policyRegistry: DEFAULT_POLICY_REGISTRY_CONFIGURATION,

    shutdown: DEFAULT_SHUTDOWN_CONFIGURATION,

    asyncContext: DEFAULT_ASYNC_CONTEXT_CONFIGURATION,

    requestContext: DEFAULT_REQUEST_CONTEXT_CONFIGURATION,

    circuitBreaker: DEFAULT_CIRCUIT_CONFIGURATION,

    idempotency: DEFAULT_IDEMPOTENCY_CONFIGURATION

});

/* -------------------------------------------------------------------------- */
/* Immutable Enterprise Defaults Bundle                                       */
/* -------------------------------------------------------------------------- */

const ENTERPRISE_DEFAULTS = deepFreeze({

    retry: DEFAULT_RETRY_CONFIGURATION,

    retryBudget: DEFAULT_RETRY_BUDGET,

    deadline: DEFAULT_DEADLINE_CONFIGURATION,

    adaptive: DEFAULT_ADAPTIVE_CONFIGURATION,

    tracing: DEFAULT_TRACING_CONFIGURATION,

    metrics: DEFAULT_METRICS_CONFIGURATION,

    hooks: DEFAULT_HOOK_CONFIGURATION,

    shutdown: DEFAULT_SHUTDOWN_CONFIGURATION,

    asyncContext: DEFAULT_ASYNC_CONTEXT_CONFIGURATION,

    requestContext: DEFAULT_REQUEST_CONTEXT_CONFIGURATION,

    policyRegistry: DEFAULT_POLICY_REGISTRY_CONFIGURATION,

    circuitBreaker: DEFAULT_CIRCUIT_CONFIGURATION,

    idempotency: DEFAULT_IDEMPOTENCY_CONFIGURATION

});

/* =============================================================================
 * End of Section 3
 * ============================================================================= */

/* =============================================================================
 * SECTION 4 — Configuration Validation Engine
 * =============================================================================
 *
 * This section validates and normalizes retry policy configuration before
 * execution. Invalid configuration must fail fast during application startup
 * rather than causing runtime instability.
 *
 * Validation Philosophy
 * ---------------------
 * • Fail fast
 * • Validate recursively
 * • Provide actionable error messages
 * • Normalize configuration
 * • Preserve immutability
 * • Support enterprise integrations
 *
 * ========================================================================== */

/* -------------------------------------------------------------------------- */
/* Validation Constants                                                       */
/* -------------------------------------------------------------------------- */

const VALIDATION_LIMITS = deepFreeze({

    MIN_RETRIES: 0,

    MAX_RETRIES: 100,

    MIN_DELAY: 0,

    MAX_DELAY: 300000,

    MIN_TIMEOUT: 1,

    MAX_TIMEOUT: 3600000,

    MIN_FACTOR: 1,

    MAX_FACTOR: 10,

    MIN_BUDGET: 1,

    MAX_BUDGET: 100000,

    MIN_HOOK_TIMEOUT: 1,

    MAX_HOOK_TIMEOUT: 60000

});

/* -------------------------------------------------------------------------- */
/* Validation Helper Functions                                                */
/* -------------------------------------------------------------------------- */

function createValidationError(message, path, value) {
    const error = new Error(message);
    error.name = "RetryConfigurationError";
    error.path = path;
    error.value = value;
    return error;
}

function assert(condition, message, path, value) {
    if (!condition) {
        throw createValidationError(message, path, value);
    }
}

function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFunction(value) {
    return typeof value === "function";
}

function isPositiveInteger(value) {
    return Number.isInteger(value) && value >= 0;
}

function isPositiveNumber(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/* -------------------------------------------------------------------------- */
/* Retry Count Validator                                                      */
/* -------------------------------------------------------------------------- */

function validateRetryCount(retries) {
    assert(
        isPositiveInteger(retries),
        "Retry count must be a non-negative integer",
        "retries",
        retries
    );

    assert(
        retries >= VALIDATION_LIMITS.MIN_RETRIES &&
        retries <= VALIDATION_LIMITS.MAX_RETRIES,
        `Retry count must be between ${VALIDATION_LIMITS.MIN_RETRIES} and ${VALIDATION_LIMITS.MAX_RETRIES}` ,
        "retries",
        retries
    );

    return retries;
}

/* -------------------------------------------------------------------------- */
/* Delay Validator                                                            */
/* -------------------------------------------------------------------------- */

function validateDelay(minDelay, maxDelay, factor) {
    assert(
        isPositiveNumber(minDelay),
        "Minimum delay must be a positive number",
        "minDelay",
        minDelay
    );

    assert(
        isPositiveNumber(maxDelay),
        "Maximum delay must be a positive number",
        "maxDelay",
        maxDelay
    );

    assert(
        minDelay >= VALIDATION_LIMITS.MIN_DELAY &&
        minDelay <= VALIDATION_LIMITS.MAX_DELAY,
        `Minimum delay must be between ${VALIDATION_LIMITS.MIN_DELAY} and ${VALIDATION_LIMITS.MAX_DELAY} ms`,
        "minDelay",
        minDelay
    );

    assert(
        maxDelay >= VALIDATION_LIMITS.MIN_DELAY &&
        maxDelay <= VALIDATION_LIMITS.MAX_DELAY,
        `Maximum delay must be between ${VALIDATION_LIMITS.MIN_DELAY} and ${VALIDATION_LIMITS.MAX_DELAY} ms`,
        "maxDelay",
        maxDelay
    );

    assert(
        maxDelay >= minDelay,
        "Maximum delay must be greater than or equal to minimum delay",
        "maxDelay",
        maxDelay
    );

    assert(
        typeof factor === "number" && Number.isFinite(factor),
        "Backoff factor must be a finite number",
        "factor",
        factor
    );

    assert(
        factor >= VALIDATION_LIMITS.MIN_FACTOR &&
        factor <= VALIDATION_LIMITS.MAX_FACTOR,
        `Backoff factor must be between ${VALIDATION_LIMITS.MIN_FACTOR} and ${VALIDATION_LIMITS.MAX_FACTOR}` ,
        "factor",
        factor
    );

    return { minDelay, maxDelay, factor };
}

/* -------------------------------------------------------------------------- */
/* Timeout Validator                                                          */
/* -------------------------------------------------------------------------- */

function validateTimeout(timeout) {
    assert(
        isPositiveNumber(timeout),
        "Timeout must be a positive number",
        "timeout",
        timeout
    );

    assert(
        timeout >= VALIDATION_LIMITS.MIN_TIMEOUT &&
        timeout <= VALIDATION_LIMITS.MAX_TIMEOUT,
        `Timeout must be between ${VALIDATION_LIMITS.MIN_TIMEOUT} and ${VALIDATION_LIMITS.MAX_TIMEOUT} ms`,
        "timeout",
        timeout
    );

    return timeout;
}

/* -------------------------------------------------------------------------- */
/* Strategy Validator                                                         */
/* -------------------------------------------------------------------------- */

function validateStrategy(strategy) {
    const validStrategies = Object.values(RETRY_STRATEGIES);

    assert(
        validStrategies.includes(strategy),
        `Invalid retry strategy: ${strategy}. Valid strategies are: ${validStrategies.join(", ")}` ,
        "strategy",
        strategy
    );

    return strategy;
}

/* -------------------------------------------------------------------------- */
/* Jitter Validator                                                           */
/* -------------------------------------------------------------------------- */

function validateJitter(jitter) {
    const validJitters = Object.values(JITTER_TYPES);

    assert(
        validJitters.includes(jitter),
        `Invalid jitter type: ${jitter}. Valid jitter types are: ${validJitters.join(", ")}` ,
        "jitter",
        jitter
    );

    return jitter;
}

/* -------------------------------------------------------------------------- */
/* Retry Budget Validator                                                     */
/* -------------------------------------------------------------------------- */

function validateBudget(budget) {
    assert(isObject(budget), "Budget configuration must be an object", "budget", budget);

    assert(
        typeof budget.enabled === "boolean",
        "Budget enabled flag must be a boolean",
        "budget.enabled",
        budget.enabled
    );

    assert(
        isPositiveInteger(budget.maxRetriesPerExecution),
        "Budget maxRetriesPerExecution must be a non-negative integer",
        "budget.maxRetriesPerExecution",
        budget.maxRetriesPerExecution
    );

    assert(
        isPositiveInteger(budget.maxBudget),
        "Budget maxBudget must be a positive integer",
        "budget.maxBudget",
        budget.maxBudget
    );

    assert(
        budget.maxBudget >= VALIDATION_LIMITS.MIN_BUDGET &&
        budget.maxBudget <= VALIDATION_LIMITS.MAX_BUDGET,
        `Budget maxBudget must be between ${VALIDATION_LIMITS.MIN_BUDGET} and ${VALIDATION_LIMITS.MAX_BUDGET}` ,
        "budget.maxBudget",
        budget.maxBudget
    );

    return budget;
}

/* -------------------------------------------------------------------------- */
/* Logger Validator                                                           */
/* -------------------------------------------------------------------------- */

function validateLogger(logger) {
    if (logger == null) {
        return logger;
    }

    assert(isObject(logger), "Logger must be an object", "logger", logger);

    const requiredMethods = ["info", "warn", "error", "debug"];

    for (const method of requiredMethods) {
        assert(
            isFunction(logger[method]),
            `Logger must implement method: ${method}` ,
            `logger.${method}` ,
            logger[method]
        );
    }

    return logger;
}

/* -------------------------------------------------------------------------- */
/* Metrics Validator                                                          */
/* -------------------------------------------------------------------------- */

function validateMetrics(metrics) {
    if (metrics == null) {
        return metrics;
    }

    assert(isObject(metrics), "Metrics provider must be an object", "metrics", metrics);

    const optionalMethods = [
        "increment",
        "gauge",
        "histogram",
        "timing",
        "record"
    ];

    for (const method of optionalMethods) {
        if (metrics[method] !== undefined) {
            assert(
                isFunction(metrics[method]),
                `Metrics provider method must be a function: ${method}` ,
                `metrics.${method}` ,
                metrics[method]
            );
        }
    }

    return metrics;
}

/* -------------------------------------------------------------------------- */
/* Hooks Validator                                                            */
/* -------------------------------------------------------------------------- */

function validateHooks(hooks) {
    if (hooks == null) {
        return hooks;
    }

    assert(isObject(hooks), "Hooks configuration must be an object", "hooks", hooks);

    for (const hookName of Object.values(RETRY_HOOKS)) {
        const hook = hooks[hookName];

        if (hook !== undefined) {
            assert(
                isFunction(hook) || Array.isArray(hook),
                `Hook ${hookName} must be a function or an array of functions`,
                `hooks.${hookName}` ,
                hook
            );

            if (Array.isArray(hook)) {
                hook.forEach((fn, index) => {
                    assert(
                        isFunction(fn),
                        `Hook ${hookName}[${index}] must be a function`,
                        `hooks.${hookName}[${index}]` ,
                        fn
                    );
                });
            }
        }
    }

    return hooks;
}

/* -------------------------------------------------------------------------- */
/* Event Emitter Validator                                                    */
/* -------------------------------------------------------------------------- */

function validateEventEmitter(emitter) {
    if (emitter == null) {
        return emitter;
    }

    assert(isObject(emitter), "Event emitter must be an object", "eventEmitter", emitter);

    const requiredMethods = ["emit", "on"];

    for (const method of requiredMethods) {
        assert(
            isFunction(emitter[method]),
            `Event emitter must implement method: ${method}` ,
            `eventEmitter.${method}` ,
            emitter[method]
        );
    }

    return emitter;
}

/* -------------------------------------------------------------------------- */
/* OpenTelemetry Validator                                                    */
/* -------------------------------------------------------------------------- */

function validateOpenTelemetry(tracer) {
    if (tracer == null) {
        return tracer;
    }

    assert(isObject(tracer), "OpenTelemetry tracer must be an object", "tracer", tracer);

    if (tracer.startSpan !== undefined) {
        assert(
            isFunction(tracer.startSpan),
            "OpenTelemetry tracer startSpan must be a function",
            "tracer.startSpan",
            tracer.startSpan
        );
    }

    return tracer;
}

/* -------------------------------------------------------------------------- */
/* Policy Registry Validator                                                  */
/* -------------------------------------------------------------------------- */

function validatePolicyRegistry(registry) {
    if (registry == null) {
        return registry;
    }

    assert(isObject(registry), "Policy registry must be an object", "policyRegistry", registry);

    const requiredMethods = ["register", "get", "has", "list"];

    for (const method of requiredMethods) {
        assert(
            isFunction(registry[method]),
            `Policy registry must implement method: ${method}` ,
            `policyRegistry.${method}` ,
            registry[method]
        );
    }

    return registry;
}

/* -------------------------------------------------------------------------- */
/* Main Configuration Validator                                               */
/* -------------------------------------------------------------------------- */

function validateConfiguration(config) {
    assert(isObject(config), "Retry configuration must be an object", "config", config);

    validateRetryCount(config.retries);
    validateDelay(config.minDelay, config.maxDelay, config.factor);
    validateTimeout(config.timeout);
    validateStrategy(config.strategy);
    validateJitter(config.jitter);

    if (config.budget) {
        validateBudget(config.budget);
    }

    if (config.logger) {
        validateLogger(config.logger);
    }

    if (config.metrics) {
        validateMetrics(config.metrics);
    }

    if (config.hooks) {
        validateHooks(config.hooks);
    }

    if (config.eventEmitter) {
        validateEventEmitter(config.eventEmitter);
    }

    if (config.tracer) {
        validateOpenTelemetry(config.tracer);
    }

    if (config.policyRegistry) {
        validatePolicyRegistry(config.policyRegistry);
    }

    return config;
}

/* -------------------------------------------------------------------------- */
/* Configuration Normalizer                                                   */
/* -------------------------------------------------------------------------- */

function normalizeConfiguration(userConfig = {}) {
    const merged = {
        ...DEFAULT_RETRY_CONFIGURATION,
        ...userConfig
    };

    validateConfiguration(merged);

    return deepFreeze(merged);
}

/* =============================================================================
 * End of Section 4
 * ============================================================================= */

/* =============================================================================
 * SECTION 5.1 — Enterprise Base RetryError
 * =============================================================================
 *
 * Root error class for the enterprise retry resilience framework.
 *
 * Responsibilities:
 *
 * ✓ Standardized retry error contract
 * ✓ Error metadata propagation
 * ✓ Cause preservation
 * ✓ Structured serialization
 * ✓ Logging enrichment
 * ✓ OpenTelemetry compatibility
 * ✓ Request context propagation
 * ✓ Multi-tenant diagnostics
 * ✓ Safe production debugging
 *
 * All retry-related errors inherit from this class.
 *
 * ========================================================================== */


/* -------------------------------------------------------------------------- */
/* Enterprise Retry Error Base Class                                          */
/* -------------------------------------------------------------------------- */

class RetryError extends Error {

    /**
     * Creates an enterprise retry error.
     *
     * @param {string} message
     * @param {Object} options
     */
    constructor(
        message,
        options = {}
    ) {

        super(message);


        /**
         * Required for proper
         * JavaScript inheritance.
         */
        Object.setPrototypeOf(
            this,
            new.target.prototype
        );


        /* ------------------------------------------------------------------ */
        /* Core Error Identity                                                */
        /* ------------------------------------------------------------------ */

        this.name =
            this.constructor.name;


        this.code =
            options.code ||
            "RETRY_ERROR";


        this.category =
            options.category ||
            ERROR_CLASSES.INTERNAL;


        this.message =
            message ||
            "Retry operation failed";


        /* ------------------------------------------------------------------ */
        /* Retry Execution Metadata                                           */
        /* ------------------------------------------------------------------ */

        this.retryId =
            options.retryId ||
            null;


        this.executionId =
            options.executionId ||
            null;


        this.policyName =
            options.policyName ||
            POLICY_NAMES.DEFAULT;


        this.operation =
            options.operation ||
            null;


        this.service =
            options.service ||
            null;


        this.classification =
            options.classification ||
            RETRY_CLASSIFICATIONS.UNKNOWN;


        this.attempt =
            Number.isInteger(options.attempt)
                ? options.attempt
                : null;


        this.maxAttempts =
            Number.isInteger(options.maxAttempts)
                ? options.maxAttempts
                : null;



        /* ------------------------------------------------------------------ */
        /* Request Context Metadata                                           */
        /* ------------------------------------------------------------------ */


        this.requestId =
            options.requestId ||
            null;


        this.correlationId =
            options.correlationId ||
            null;


        this.tenantId =
            options.tenantId ||
            null;


        this.userId =
            options.userId ||
            null;



        /* ------------------------------------------------------------------ */
        /* Distributed Tracing Metadata                                       */
        /* ------------------------------------------------------------------ */


        this.traceId =
            options.traceId ||
            null;


        this.spanId =
            options.spanId ||
            null;



        /* ------------------------------------------------------------------ */
        /* Timing Metadata                                                    */
        /* ------------------------------------------------------------------ */


        this.startedAt =
            options.startedAt ||
            null;


        this.failedAt =
            options.failedAt ||
            new Date();


        this.duration =
            options.duration ||
            null;


        this.deadline =
            options.deadline ||
            null;



        /* ------------------------------------------------------------------ */
        /* Cancellation / Control Metadata                                    */
        /* ------------------------------------------------------------------ */


        this.cancelled =
            Boolean(options.cancelled);


        this.cancellationReason =
            options.cancellationReason ||
            null;



        /* ------------------------------------------------------------------ */
        /* Retry Metadata                                                     */
        /* ------------------------------------------------------------------ */


        this.delay =
            options.delay ||
            null;


        this.strategy =
            options.strategy ||
            null;


        this.jitter =
            options.jitter ||
            null;


        this.budgetRemaining =
            options.budgetRemaining ||
            null;



        /* ------------------------------------------------------------------ */
        /* External Cause                                                     */
        /* ------------------------------------------------------------------ */


        this.cause =
            options.cause ||
            null;



        /*
         * Preserve native Error cause support.
         *
         * Node.js >=16 supports
         * Error.cause.
         */
        if (
            options.cause
        ) {

            this.cause =
                options.cause;

        }



        /* ------------------------------------------------------------------ */
        /* Extra Metadata                                                     */
        /* ------------------------------------------------------------------ */


        this.metadata =
            Object.freeze({
                ...(options.metadata || {})
            });



        /* ------------------------------------------------------------------ */
        /* Capture Stack Trace                                                */
        /* ------------------------------------------------------------------ */

        if (
            Error.captureStackTrace
        ) {

            Error.captureStackTrace(
                this,
                this.constructor
            );

        }


        /* ------------------------------------------------------------------ */
        /* Immutable Core Properties                                          */
        /* ------------------------------------------------------------------ */

        Object.freeze(this);

    }



    /* ---------------------------------------------------------------------- */
    /* Error Identification Helpers                                          */
    /* ---------------------------------------------------------------------- */


    /**
     * Determines whether an object
     * is a RetryError.
     */
    static isRetryError(error) {

        return (
            error instanceof RetryError
        );

    }



    /**
     * Returns the root cause.
     *
     * Useful when errors are wrapped
     * multiple times.
     */
    getRootCause() {


        let current =
            this;


        while (
            current.cause &&
            current.cause instanceof Error
        ) {

            current =
                current.cause;

        }


        return current;

    }



    /* ---------------------------------------------------------------------- */
    /* Structured Serialization                                              */
    /* ---------------------------------------------------------------------- */


    /**
     * Converts error into a safe
     * structured object.
     *
     * Used by:
     *
     * - JSON logging
     * - Audit logs
     * - APIs
     * - Metrics
     */
    toJSON() {

        return {

            name:
                this.name,


            code:
                this.code,


            category:
                this.category,


            message:
                this.message,


            retryId:
                this.retryId,


            executionId:
                this.executionId,


            policyName:
                this.policyName,


            classification:
                this.classification,


            operation:
                this.operation,


            service:
                this.service,


            attempt:
                this.attempt,


            maxAttempts:
                this.maxAttempts,


            tenantId:
                this.tenantId,


            requestId:
                this.requestId,


            correlationId:
                this.correlationId,


            traceId:
                this.traceId,


            spanId:
                this.spanId,


            startedAt:
                this.startedAt,


            failedAt:
                this.failedAt,


            duration:
                this.duration,


            deadline:
                this.deadline,


            cancelled:
                this.cancelled,


            cancellationReason:
                this.cancellationReason,


            strategy:
                this.strategy,


            jitter:
                this.jitter,


            delay:
                this.delay,


            budgetRemaining:
                this.budgetRemaining,


            metadata:
                this.metadata,


            cause:
                this.cause
                    ? {
                        name:
                            this.cause.name,

                        message:
                            this.cause.message,

                        code:
                            this.cause.code
                    }
                    : null

        };

    }



    /* ---------------------------------------------------------------------- */
    /* Logging Support                                                        */
    /* ---------------------------------------------------------------------- */


    /**
     * Returns fields suitable
     * for structured loggers.
     */
    toLogContext() {

        return {

            error:

                this.name,


            code:

                this.code,


            retry:

                this.toJSON()

        };

    }



    /* ---------------------------------------------------------------------- */
    /* OpenTelemetry Support                                                  */
    /* ---------------------------------------------------------------------- */


    /**
     * Adds retry failure metadata
     * to an OpenTelemetry span.
     */
    enrichSpan(span) {


        if (
            !span ||
            typeof span.setAttribute !== "function"
        ) {

            return;

        }



        span.setAttribute(
            "retry.error.name",
            this.name
        );


        span.setAttribute(
            "retry.error.code",
            this.code
        );


        span.setAttribute(
            "retry.policy",
            this.policyName
        );


        span.setAttribute(
            "retry.attempt",
            this.attempt ?? -1
        );


        span.setAttribute(
            "retry.classification",
            this.classification
        );



        if (
            typeof span.recordException === "function"
        ) {

            span.recordException(this);

        }

    }



    /* ---------------------------------------------------------------------- */
    /* Utility                                                               */
    /* ---------------------------------------------------------------------- */


    /**
     * Returns whether this error
     * can safely be retried.
     *
     * Child classes may override.
     */
    isRetryable() {

        return false;

    }



    /**
     * Returns HTTP-friendly status.
     *
     * Child classes may override.
     */
    getHttpStatus() {

        return 500;

    }

}


/* =============================================================================
 * End of Section 5.1
 * ============================================================================= */

/* =============================================================================
 * SECTION 5.2 — Enterprise Configuration & Validation Errors
 * =============================================================================
 *
 * Extends:
 *
 *     RetryError
 *
 * Provides:
 *
 *     RetryConfigurationError
 *     RetryValidationError
 *     RetryRegistryError
 *
 * Responsibilities:
 *
 * ✓ Configuration startup failures
 * ✓ Invalid retry options
 * ✓ Invalid policy definitions
 * ✓ Invalid registry operations
 * ✓ Safe structured diagnostics
 * ✓ Production-friendly error reporting
 *
 * ========================================================================== */


/* -------------------------------------------------------------------------- */
/* RetryConfigurationError                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Raised when retry framework configuration
 * is invalid or cannot be initialized.
 *
 * Examples:
 *
 * - Invalid retry count
 * - Invalid timeout
 * - Invalid strategy
 * - Invalid provider configuration
 * - Missing required enterprise dependency
 */
class RetryConfigurationError extends RetryError {


    constructor(
        message = "Retry configuration is invalid",
        options = {}
    ) {

        super(
            message,
            {

                ...options,

                code:
                    "RETRY_CONFIGURATION_ERROR",

                category:
                    ERROR_CLASSES.CONFIGURATION

            }
        );


        this.configurationPath =
            options.configurationPath ||
            null;


        this.configurationValue =
            options.configurationValue ||
            null;


        this.expected =
            options.expected ||
            null;


        this.received =
            options.received ||
            null;


        this.source =
            options.source ||
            "unknown";


        Object.freeze(this);

    }



    getHttpStatus() {

        return 500;

    }



    isRetryable() {

        return false;

    }

}


/* -------------------------------------------------------------------------- */
/* RetryValidationError                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Raised when runtime validation
 * detects invalid retry input.
 *
 * Examples:
 *
 * - Invalid policy override
 * - Invalid hook
 * - Invalid logger
 * - Invalid metric provider
 * - Invalid retry context
 */
class RetryValidationError extends RetryError {


    constructor(
        message = "Retry validation failed",
        options = {}
    ) {

        super(
            message,
            {

                ...options,

                code:
                    "RETRY_VALIDATION_ERROR",

                category:
                    ERROR_CLASSES.VALIDATION

            }
        );


        this.field =
            options.field ||
            null;


        this.value =
            options.value ||
            null;


        this.validationRule =
            options.validationRule ||
            null;


        this.expectedType =
            options.expectedType ||
            null;


        this.actualType =
            options.actualType ||
            null;


        Object.freeze(this);

    }



    getHttpStatus() {

        return 400;

    }



    isRetryable() {

        return false;

    }

}


/* -------------------------------------------------------------------------- */
/* RetryRegistryError                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Raised when retry policy registry
 * operations fail.
 *
 * Examples:
 *
 * - Duplicate policy registration
 * - Missing policy lookup
 * - Invalid policy definition
 * - Frozen registry modification
 */
class RetryRegistryError extends RetryError {


    constructor(
        message = "Retry policy registry operation failed",
        options = {}
    ) {

        super(
            message,
            {

                ...options,

                code:
                    "RETRY_REGISTRY_ERROR",

                category:
                    ERROR_CLASSES.REGISTRY

            }
        );


        this.policyName =
            options.policyName ||
            null;


        this.registryOperation =
            options.registryOperation ||
            null;


        this.existingPolicy =
            options.existingPolicy ||
            null;


        this.requestedPolicy =
            options.requestedPolicy ||
            null;


        Object.freeze(this);

    }



    getHttpStatus() {

        return 500;

    }



    isRetryable() {

        return false;

    }

}


/* -------------------------------------------------------------------------- */
/* Enterprise Type Guards                                                     */
/* -------------------------------------------------------------------------- */


function isRetryConfigurationError(error) {

    return (
        error instanceof RetryConfigurationError
    );

}


function isRetryValidationError(error) {

    return (
        error instanceof RetryValidationError
    );

}


function isRetryRegistryError(error) {

    return (
        error instanceof RetryRegistryError
    );

}


/* -------------------------------------------------------------------------- */
/* Error Factory Helpers                                                      */
/* -------------------------------------------------------------------------- */


/**
 * Creates configuration errors
 * consistently.
 */
function createRetryConfigurationError(
    message,
    options = {}
) {

    return new RetryConfigurationError(
        message,
        options
    );

}



/**
 * Creates validation errors
 * consistently.
 */
function createRetryValidationError(
    message,
    options = {}
) {

    return new RetryValidationError(
        message,
        options
    );

}



/**
 * Creates registry errors
 * consistently.
 */
function createRetryRegistryError(
    message,
    options = {}
) {

    return new RetryRegistryError(
        message,
        options
    );

}


/* =============================================================================
 * End of Section 5.2
 * ============================================================================= */
/* =============================================================================
 * SECTION 5.3 — Enterprise Execution & Runtime Errors
 * =============================================================================
 *
 * Extends:
 *
 *     RetryError
 *
 * Runtime Errors:
 *
 *     RetryExecutionError
 *     RetryPolicyError
 *     RetryClassificationError
 *     RetryContextError
 *     RetryHookError
 *
 * Responsibilities:
 *
 * ✓ Runtime retry execution failures
 * ✓ Policy execution failures
 * ✓ Error classification failures
 * ✓ Context propagation failures
 * ✓ Lifecycle hook failures
 * ✓ Structured observability
 * ✓ Distributed tracing compatibility
 *
 * ========================================================================== */


/* -------------------------------------------------------------------------- */
/* RetryExecutionError                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Raised when a retry operation fails during execution.
 *
 * Examples:
 *
 * - Final retry attempt failed
 * - Wrapped service failure
 * - Upstream dependency unavailable
 * - Retry executor failure
 */
class RetryExecutionError extends RetryError {


    constructor(
        message = "Retry execution failed",
        options = {}
    ) {

        super(
            message,
            {

                ...options,

                code:
                    "RETRY_EXECUTION_ERROR",

                category:
                    ERROR_CLASSES.EXECUTION

            }
        );


        this.operationName =
            options.operationName ||
            null;


        this.dependency =
            options.dependency ||
            null;


        this.lastError =
            options.lastError ||
            options.cause ||
            null;


        this.failedAttempt =
            options.failedAttempt ??
            options.attempt ??
            null;


        Object.freeze(this);

    }



    isRetryable() {

        return true;

    }



    getHttpStatus() {

        return 503;

    }

}


/* -------------------------------------------------------------------------- */
/* RetryPolicyError                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Raised when a retry policy cannot
 * execute correctly.
 *
 * Examples:
 *
 * - Missing policy
 * - Invalid policy state
 * - Policy execution blocked
 * - Unsupported policy operation
 */
class RetryPolicyError extends RetryError {


    constructor(
        message = "Retry policy execution failed",
        options = {}
    ) {

        super(
            message,
            {

                ...options,

                code:
                    "RETRY_POLICY_ERROR",

                category:
                    ERROR_CLASSES.EXECUTION

            }
        );


        this.policyName =
            options.policyName ||
            POLICY_NAMES.DEFAULT;


        this.policyState =
            options.policyState ||
            null;


        this.policyOperation =
            options.policyOperation ||
            null;


        this.policyDefinition =
            options.policyDefinition ||
            null;


        Object.freeze(this);

    }



    isRetryable() {

        return false;

    }



    getHttpStatus() {

        return 500;

    }

}


/* -------------------------------------------------------------------------- */
/* RetryClassificationError                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Raised when the framework cannot
 * classify an error.
 *
 * Classification drives:
 *
 * - Retry decision
 * - Metrics
 * - Alerting
 * - Policy selection
 */
class RetryClassificationError extends RetryError {


    constructor(
        message = "Unable to classify retry failure",
        options = {}
    ) {

        super(
            message,
            {

                ...options,

                code:
                    "RETRY_CLASSIFICATION_ERROR",

                category:
                    ERROR_CLASSES.CLASSIFICATION

            }
        );


        this.originalError =
            options.originalError ||
            options.cause ||
            null;


        this.detectedType =
            options.detectedType ||
            null;


        this.classifiersChecked =
            options.classifiersChecked ||
            [];


        Object.freeze(this);

    }



    isRetryable() {

        return false;

    }



    getHttpStatus() {

        return 500;

    }

}


/* -------------------------------------------------------------------------- */
/* RetryContextError                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Raised when retry execution context
 * is invalid or unavailable.
 *
 * Examples:
 *
 * - Missing request context
 * - Missing tenant context
 * - Invalid trace context
 * - Corrupted AsyncLocalStorage state
 */
class RetryContextError extends RetryError {


    constructor(
        message = "Retry context is invalid",
        options = {}
    ) {

        super(
            message,
            {

                ...options,

                code:
                    "RETRY_CONTEXT_ERROR",

                category:
                    ERROR_CLASSES.INTERNAL

            }
        );


        this.contextKey =
            options.contextKey ||
            null;


        this.expectedContext =
            options.expectedContext ||
            null;


        this.actualContext =
            options.actualContext ||
            null;


        this.contextSource =
            options.contextSource ||
            null;


        Object.freeze(this);

    }



    isRetryable() {

        return false;

    }



    getHttpStatus() {

        return 500;

    }

}


/* -------------------------------------------------------------------------- */
/* RetryHookError                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Raised when retry lifecycle hooks fail.
 *
 * Examples:
 *
 * - beforeRetry hook failure
 * - metrics hook failure
 * - tracing hook failure
 * - audit hook failure
 */
class RetryHookError extends RetryError {


    constructor(
        message = "Retry lifecycle hook failed",
        options = {}
    ) {

        super(
            message,
            {

                ...options,

                code:
                    "RETRY_HOOK_ERROR",

                category:
                    ERROR_CLASSES.INTERNAL

            }
        );


        this.hookName =
            options.hookName ||
            null;


        this.hookPhase =
            options.hookPhase ||
            null;


        this.originalHookError =
            options.originalHookError ||
            options.cause ||
            null;


        this.failExecution =
            Boolean(
                options.failExecution
            );


        Object.freeze(this);

    }



    isRetryable() {

        return false;

    }



    getHttpStatus() {

        return 500;

    }

}


/* -------------------------------------------------------------------------- */
/* Enterprise Type Guards                                                     */
/* -------------------------------------------------------------------------- */


function isRetryExecutionError(error) {

    return (
        error instanceof RetryExecutionError
    );

}


function isRetryPolicyError(error) {

    return (
        error instanceof RetryPolicyError
    );

}


function isRetryClassificationError(error) {

    return (
        error instanceof RetryClassificationError
    );

}


function isRetryContextError(error) {

    return (
        error instanceof RetryContextError
    );

}


function isRetryHookError(error) {

    return (
        error instanceof RetryHookError
    );

}


/* -------------------------------------------------------------------------- */
/* Enterprise Error Factories                                                */
/* -------------------------------------------------------------------------- */


function createRetryExecutionError(
    message,
    options = {}
) {

    return new RetryExecutionError(
        message,
        options
    );

}



function createRetryPolicyError(
    message,
    options = {}
) {

    return new RetryPolicyError(
        message,
        options
    );

}



function createRetryClassificationError(
    message,
    options = {}
) {

    return new RetryClassificationError(
        message,
        options
    );

}



function createRetryContextError(
    message,
    options = {}
) {

    return new RetryContextError(
        message,
        options
    );

}



function createRetryHookError(
    message,
    options = {}
) {

    return new RetryHookError(
        message,
        options
    );

}


/* =============================================================================
 * End of Section 5.3
 * ============================================================================= */

/* =============================================================================
 * SECTION 5.4 — Enterprise Operational Errors
 * =============================================================================
 *
 * Extends:
 *
 *     RetryError
 *
 * Operational Errors:
 *
 *     RetryTimeoutError
 *     RetryDeadlineExceededError
 *     RetryBudgetExceededError
 *     RetryCancelledError
 *     RetryCircuitOpenError
 *     RetryShutdownError
 *
 * Responsibilities:
 *
 * ✓ Runtime control-flow failures
 * ✓ Graceful shutdown handling
 * ✓ Circuit breaker coordination
 * ✓ Deadline enforcement
 * ✓ Retry budget protection
 * ✓ Cancellation propagation
 * ✓ Production observability
 *
 * ========================================================================== */


/* -------------------------------------------------------------------------- */
/* RetryTimeoutError                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Raised when retry execution exceeds
 * the configured timeout.
 *
 * Example:
 *
 * Payment API timeout after 60 seconds.
 */
class RetryTimeoutError extends RetryError {


    constructor(
        message = "Retry execution timeout exceeded",
        options = {}
    ) {

        super(
            message,
            {

                ...options,

                code:
                    "RETRY_TIMEOUT_ERROR",

                category:
                    ERROR_CLASSES.TIMEOUT

            }
        );


        this.timeout =
            options.timeout ||
            null;


        this.elapsed =
            options.elapsed ||
            null;


        this.lastAttempt =
            options.lastAttempt ??
            options.attempt ??
            null;


        Object.freeze(this);

    }



    isRetryable() {

        return false;

    }



    getHttpStatus() {

        return 504;

    }

}


/* -------------------------------------------------------------------------- */
/* RetryDeadlineExceededError                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Raised when an absolute execution
 * deadline has expired.
 *
 * Used for distributed systems where
 * upstream services propagate deadlines.
 */
class RetryDeadlineExceededError extends RetryError {


    constructor(
        message = "Retry deadline exceeded",
        options = {}
    ) {

        super(
            message,
            {

                ...options,

                code:
                    "RETRY_DEADLINE_EXCEEDED_ERROR",

                category:
                    ERROR_CLASSES.DEADLINE

            }
        );


        this.deadline =
            options.deadline ||
            null;


        this.currentTime =
            options.currentTime ||
            new Date();


        this.remainingTime =
            options.remainingTime ||
            0;


        Object.freeze(this);

    }



    isRetryable() {

        return false;

    }



    getHttpStatus() {

        return 504;

    }

}


/* -------------------------------------------------------------------------- */
/* RetryBudgetExceededError                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Raised when retry budget protection
 * prevents additional retries.
 *
 * Prevents retry storms.
 */
class RetryBudgetExceededError extends RetryError {


    constructor(
        message = "Retry budget exhausted",
        options = {}
    ) {

        super(
            message,
            {

                ...options,

                code:
                    "RETRY_BUDGET_EXCEEDED_ERROR",

                category:
                    ERROR_CLASSES.BUDGET

            }
        );


        this.maxBudget =
            options.maxBudget ||
            null;


        this.usedBudget =
            options.usedBudget ||
            null;


        this.remainingBudget =
            options.remainingBudget ||
            0;


        this.budgetStrategy =
            options.budgetStrategy ||
            null;


        Object.freeze(this);

    }



    isRetryable() {

        return false;

    }



    getHttpStatus() {

        return 429;

    }

}


/* -------------------------------------------------------------------------- */
/* RetryCancelledError                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Raised when retry execution is
 * cancelled.
 *
 * Sources:
 *
 * - AbortController
 * - Client disconnect
 * - Manual cancellation
 * - Request termination
 */
class RetryCancelledError extends RetryError {


    constructor(
        message = "Retry execution cancelled",
        options = {}
    ) {

        super(
            message,
            {

                ...options,

                code:
                    "RETRY_CANCELLED_ERROR",

                category:
                    ERROR_CLASSES.CANCELLED,

                cancelled:
                    true

            }
        );


        this.reason =
            options.reason ||
            options.cancellationReason ||
            CANCELLATION_REASONS.MANUAL;


        this.abortSignal =
            options.abortSignal ||
            null;


        Object.freeze(this);

    }



    isRetryable() {

        return false;

    }



    getHttpStatus() {

        return 499;

    }

}


/* -------------------------------------------------------------------------- */
/* RetryCircuitOpenError                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Raised when circuit breaker protection
 * blocks retry execution.
 *
 * Prevents cascading failures.
 */
class RetryCircuitOpenError extends RetryError {


    constructor(
        message = "Circuit breaker is open",
        options = {}
    ) {

        super(
            message,
            {

                ...options,

                code:
                    "RETRY_CIRCUIT_OPEN_ERROR",

                category:
                    ERROR_CLASSES.CIRCUIT_OPEN

            }
        );


        this.circuitName =
            options.circuitName ||
            null;


        this.circuitState =
            options.circuitState ||
            "OPEN";


        this.retryAfter =
            options.retryAfter ||
            null;


        this.failureCount =
            options.failureCount ||
            null;


        Object.freeze(this);

    }



    isRetryable() {

        return false;

    }



    getHttpStatus() {

        return 503;

    }

}


/* -------------------------------------------------------------------------- */
/* RetryShutdownError                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Raised when application shutdown
 * interrupts retry execution.
 *
 * Designed for:
 *
 * - Kubernetes SIGTERM
 * - PM2 restart
 * - Container shutdown
 * - Graceful application stop
 */
class RetryShutdownError extends RetryError {


    constructor(
        message = "Retry execution interrupted by shutdown",
        options = {}
    ) {

        super(
            message,
            {

                ...options,

                code:
                    "RETRY_SHUTDOWN_ERROR",

                category:
                    ERROR_CLASSES.SHUTDOWN

            }
        );


        this.shutdownSignal =
            options.shutdownSignal ||
            "SIGTERM";


        this.shutdownStartedAt =
            options.shutdownStartedAt ||
            new Date();


        this.gracePeriod =
            options.gracePeriod ||
            null;


        Object.freeze(this);

    }



    isRetryable() {

        return false;

    }



    getHttpStatus() {

        return 503;

    }

}


/* -------------------------------------------------------------------------- */
/* Enterprise Type Guards                                                     */
/* -------------------------------------------------------------------------- */


function isRetryTimeoutError(error) {

    return (
        error instanceof RetryTimeoutError
    );

}



function isRetryDeadlineExceededError(error) {

    return (
        error instanceof RetryDeadlineExceededError
    );

}



function isRetryBudgetExceededError(error) {

    return (
        error instanceof RetryBudgetExceededError
    );

}



function isRetryCancelledError(error) {

    return (
        error instanceof RetryCancelledError
    );

}



function isRetryCircuitOpenError(error) {

    return (
        error instanceof RetryCircuitOpenError
    );

}



function isRetryShutdownError(error) {

    return (
        error instanceof RetryShutdownError
    );

}


/* -------------------------------------------------------------------------- */
/* Enterprise Error Factories                                                 */
/* -------------------------------------------------------------------------- */


function createRetryTimeoutError(
    message,
    options = {}
) {

    return new RetryTimeoutError(
        message,
        options
    );

}



function createRetryDeadlineExceededError(
    message,
    options = {}
) {

    return new RetryDeadlineExceededError(
        message,
        options
    );

}



function createRetryBudgetExceededError(
    message,
    options = {}
) {

    return new RetryBudgetExceededError(
        message,
        options
    );

}



function createRetryCancelledError(
    message,
    options = {}
) {

    return new RetryCancelledError(
        message,
        options
    );

}



function createRetryCircuitOpenError(
    message,
    options = {}
) {

    return new RetryCircuitOpenError(
        message,
        options
    );

}



function createRetryShutdownError(
    message,
    options = {}
) {

    return new RetryShutdownError(
        message,
        options
    );

}


/* =============================================================================
 * End of Section 5.4
 * ============================================================================= */
/* =============================================================================
 * SECTION 5.5 — Enterprise Error Utilities
 * =============================================================================
 *
 * Completes:
 *
 *     Enterprise Retry Error Hierarchy
 *
 * Provides:
 *
 *     Error Registry
 *     Error Factory Resolver
 *     Serialization Helpers
 *     Safe Error Extraction
 *     Root Cause Resolver
 *     Retry Error Predicates
 *     Export Integration
 *
 * Responsibilities:
 *
 * ✓ Centralized error management
 * ✓ Safe production logging
 * ✓ Error normalization
 * ✓ API-safe serialization
 * ✓ Observability support
 * ✓ Root cause analysis
 * ✓ Retry engine integration
 *
 * ========================================================================== */


/* -------------------------------------------------------------------------- */
/* Enterprise Retry Error Registry                                            */
/* -------------------------------------------------------------------------- */

/**
 * Central registry of all retry errors.
 *
 * Used by:
 *
 * - Error factories
 * - Diagnostics
 * - Logging
 * - Serialization
 * - Testing
 */
const RETRY_ERROR_REGISTRY = Object.freeze({

    RetryError,

    RetryConfigurationError,

    RetryValidationError,

    RetryRegistryError,

    RetryExecutionError,

    RetryPolicyError,

    RetryClassificationError,

    RetryContextError,

    RetryHookError,

    RetryTimeoutError,

    RetryDeadlineExceededError,

    RetryBudgetExceededError,

    RetryCancelledError,

    RetryCircuitOpenError,

    RetryShutdownError

});


/* -------------------------------------------------------------------------- */
/* Error Constructor Lookup                                                   */
/* -------------------------------------------------------------------------- */


/**
 * Resolve error constructor by name.
 *
 * Example:
 *
 * resolveRetryErrorType(
 *     "RetryTimeoutError"
 * )
 */
function resolveRetryErrorType(
    name
) {

    return (
        RETRY_ERROR_REGISTRY[name]
        ||
        RetryError
    );

}


/* -------------------------------------------------------------------------- */
/* Enterprise Error Factory Resolver                                          */
/* -------------------------------------------------------------------------- */


/**
 * Creates retry errors dynamically.
 *
 * Example:
 *
 * createRetryError(
 *     "RetryTimeoutError",
 *     "Database timeout"
 * )
 */
function createRetryError(
    type,
    message,
    options = {}
) {


    const ErrorType =
        resolveRetryErrorType(type);


    return new ErrorType(
        message,
        options
    );

}


/* -------------------------------------------------------------------------- */
/* Root Cause Resolver                                                        */
/* -------------------------------------------------------------------------- */


/**
 * Finds deepest underlying error.
 *
 * Useful for:
 *
 * MongoError
 *   ->
 * ServiceError
 *      ->
 * RetryExecutionError
 */
function getRootRetryCause(
    error
) {


    if (!error) {

        return null;

    }


    let current =
        error;


    const visited =
        new Set();



    while (

        current.cause
        &&
        current.cause instanceof Error

    ) {


        if (
            visited.has(current)
        ) {

            break;

        }


        visited.add(current);


        current =
            current.cause;

    }


    return current;

}


/* -------------------------------------------------------------------------- */
/* Error Chain Extraction                                                     */
/* -------------------------------------------------------------------------- */


/**
 * Extracts complete error chain.
 */
function extractErrorChain(
    error
) {


    const chain = [];

    let current =
        error;


    const visited =
        new Set();



    while (
        current instanceof Error
    ) {


        if (
            visited.has(current)
        ) {

            break;

        }


        visited.add(current);



        chain.push({

            name:
                current.name,

            message:
                current.message,

            code:
                current.code || null

        });


        current =
            current.cause;

    }


    return chain;

}


/* -------------------------------------------------------------------------- */
/* Safe Error Serialization                                                   */
/* -------------------------------------------------------------------------- */


/**
 * Converts any error into a safe
 * structured object.
 *
 * Removes:
 *
 * - stack traces
 * - secrets
 * - tokens
 * - credentials
 */
function serializeRetryError(
    error
) {


    if (!error) {

        return null;

    }



    if (
        typeof error.toJSON === "function"
    ) {

        return error.toJSON();

    }



    return {

        name:
            error.name || "Error",

        message:
            error.message || "Unknown error",

        code:
            error.code || null,

        cause:
            error.cause
                ? serializeRetryError(error.cause)
                : null

    };

}


/* -------------------------------------------------------------------------- */
/* Safe Error Extraction                                                      */
/* -------------------------------------------------------------------------- */


/**
 * Extracts operational fields for logs.
 */
function extractSafeErrorDetails(
    error
) {


    if (!error) {

        return {};

    }



    return {

        name:
            error.name,

        code:
            error.code || null,

        message:
            error.message,

        retryError:
            error instanceof RetryError,

        classification:
            error.classification || null,

        policy:
            error.policyName || null,

        attempt:
            error.attempt || null,

        requestId:
            error.requestId || null,

        correlationId:
            error.correlationId || null,

        tenantId:
            error.tenantId || null

    };

}


/* -------------------------------------------------------------------------- */
/* Retry Error Predicates                                                     */
/* -------------------------------------------------------------------------- */


/**
 * Base retry error check.
 */
function isRetryError(
    error
) {

    return (
        error instanceof RetryError
    );

}



/**
 * Determines if error is operational.
 */
function isOperationalRetryError(
    error
) {


    return (

        error instanceof RetryTimeoutError
        ||

        error instanceof RetryDeadlineExceededError
        ||

        error instanceof RetryBudgetExceededError
        ||

        error instanceof RetryCancelledError
        ||

        error instanceof RetryCircuitOpenError
        ||

        error instanceof RetryShutdownError

    );

}


/**
 * Determines if error
 * should stop execution immediately.
 */
function isFatalRetryError(
    error
) {


    return (

        error instanceof RetryConfigurationError
        ||

        error instanceof RetryValidationError
        ||

        error instanceof RetryContextError

    );

}


/**
 * Determines whether retry
 * can continue.
 */
function isRetryableFailure(
    error
) {


    if (
        !error
    ) {

        return false;

    }



    if (
        typeof error.isRetryable === "function"
    ) {

        return error.isRetryable();

    }



    return false;

}


/* -------------------------------------------------------------------------- */
/* Error Normalization                                                        */
/* -------------------------------------------------------------------------- */


/**
 * Converts unknown errors
 * into RetryError instances.
 */
function normalizeRetryError(
    error,
    options = {}
) {


    if (
        error instanceof RetryError
    ) {

        return error;

    }



    return new RetryExecutionError(
        error?.message ||
            "Unknown retry failure",
        {

            ...options,

            cause:
                error

        }
    );

}


/* -------------------------------------------------------------------------- */
/* Enterprise Error Export Bundle                                            */
/* -------------------------------------------------------------------------- */


const RETRY_ERROR_UTILITIES =
Object.freeze({

    RETRY_ERROR_REGISTRY,

    resolveRetryErrorType,

    createRetryError,

    getRootRetryCause,

    extractErrorChain,

    serializeRetryError,

    extractSafeErrorDetails,

    isRetryError,

    isOperationalRetryError,

    isFatalRetryError,

    isRetryableFailure,

    normalizeRetryError

});


/* =============================================================================
 * End of Section 5.5
 * ============================================================================= */

