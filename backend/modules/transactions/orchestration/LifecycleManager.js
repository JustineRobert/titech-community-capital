"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Transaction Lifecycle Manager
 * ============================================================================
 *
 * File:
 * backend/modules/transactions/orchestration/LifecycleManager.js
 *
 * Enterprise Transaction Orchestration Lifecycle State Machine
 * ============================================================================
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - Authoritative transaction lifecycle state management
 * - Strict state transition validation
 * - Idempotent transition handling
 * - Optimistic concurrency protection
 * - Lifecycle history generation
 * - Tenant isolation
 * - Correlation / transaction context propagation
 * - Timeout / expiry handling
 * - Failure and compensation lifecycle support
 * - Terminal-state protection
 * - Transition metadata and actor tracking
 * - Event / transition hooks
 * - Persistence adapter support
 * - Audit integration hooks
 * - Structured logging hooks
 *
 * Design Principles
 * ----------------------------------------------------------------------------
 * - No financial balances are mutated here.
 * - No ledger posting is performed here.
 * - No transaction record is silently overwritten.
 * - Lifecycle transitions are explicit and deterministic.
 * - Terminal states cannot be mutated through normal transitions.
 * - Persistence is delegated to an injected repository/adapter.
 * - The service can operate in-memory when no persistence adapter is supplied,
 *   which is useful for unit testing.
 *
 * Expected persistence adapter contract:
 *
 * {
 *   findById(id, options),
 *   create(data, options),
 *   updateState(id, expectedVersion, data, options)
 * }
 *
 * Optional methods:
 *
 * {
 *   appendHistory(id, historyEntry, options),
 *   findByIdempotencyKey(key, options)
 * }
 *
 * ============================================================================
 */

const crypto = require("crypto");

/**
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

const LIFECYCLE_STATES = Object.freeze({
    CREATED: "CREATED",

    VALIDATING: "VALIDATING",
    VALIDATED: "VALIDATED",

    PROCESSING: "PROCESSING",
    PENDING: "PENDING",

    COMPLETED: "COMPLETED",

    FAILED: "FAILED",

    COMPENSATING: "COMPENSATING",
    COMPENSATED: "COMPENSATED",

    CANCELLED: "CANCELLED",

    TIMED_OUT: "TIMED_OUT"
});

const TERMINAL_STATES = Object.freeze(
    new Set([
        LIFECYCLE_STATES.COMPLETED,
        LIFECYCLE_STATES.FAILED,
        LIFECYCLE_STATES.COMPENSATED,
        LIFECYCLE_STATES.CANCELLED,
        LIFECYCLE_STATES.TIMED_OUT
    ])
);

/**
 * Explicit state transition graph.
 *
 * IMPORTANT:
 * Never add implicit transitions.
 *
 * Every lifecycle movement must be explicitly represented here.
 */
const TRANSITIONS = Object.freeze({
    CREATED: Object.freeze([
        "VALIDATING",
        "CANCELLED",
        "TIMED_OUT"
    ]),

    VALIDATING: Object.freeze([
        "VALIDATED",
        "FAILED",
        "CANCELLED",
        "TIMED_OUT"
    ]),

    VALIDATED: Object.freeze([
        "PROCESSING",
        "PENDING",
        "FAILED",
        "CANCELLED",
        "TIMED_OUT"
    ]),

    PROCESSING: Object.freeze([
        "COMPLETED",
        "PENDING",
        "FAILED",
        "COMPENSATING",
        "CANCELLED",
        "TIMED_OUT"
    ]),

    PENDING: Object.freeze([
        "PROCESSING",
        "COMPLETED",
        "FAILED",
        "COMPENSATING",
        "CANCELLED",
        "TIMED_OUT"
    ]),

    FAILED: Object.freeze([
        "COMPENSATING"
    ]),

    COMPENSATING: Object.freeze([
        "COMPENSATED",
        "FAILED"
    ]),

    COMPLETED: Object.freeze([]),

    COMPENSATED: Object.freeze([]),

    CANCELLED: Object.freeze([]),

    TIMED_OUT: Object.freeze([])
});

const DEFAULT_CONFIG = Object.freeze({
    defaultTimeoutMs: 5 * 60 * 1000,

    maxHistoryEntries: 100,

    strictTenantIsolation: true,

    allowTerminalStateOverride: false,

    allowSameStateTransition: false,

    enableHistory: true,

    enableHooks: true,

    enableLogging: true
});

/**
 * ============================================================================
 * ERROR TYPES
 * ============================================================================
 */

class LifecycleError extends Error {
    constructor(message, code = "LIFECYCLE_ERROR", details = {}) {
        super(message);

        this.name = "LifecycleError";
        this.code = code;
        this.details = details;

        Error.captureStackTrace?.(
            this,
            this.constructor
        );
    }
}

class InvalidLifecycleTransitionError extends LifecycleError {
    constructor(from, to, transactionId) {
        super(
            `Invalid lifecycle transition from ${from} to ${to}`,
            "INVALID_LIFECYCLE_TRANSITION",
            {
                transactionId,
                from,
                to
            }
        );

        this.name = "InvalidLifecycleTransitionError";
    }
}

class LifecycleNotFoundError extends LifecycleError {
    constructor(transactionId) {
        super(
            `Lifecycle record not found: ${transactionId}`,
            "LIFECYCLE_NOT_FOUND",
            {
                transactionId
            }
        );

        this.name = "LifecycleNotFoundError";
    }
}

class LifecycleConcurrencyError extends LifecycleError {
    constructor(transactionId, expectedVersion, actualVersion) {
        super(
            `Lifecycle concurrency conflict for transaction ${transactionId}`,
            "LIFECYCLE_CONCURRENCY_CONFLICT",
            {
                transactionId,
                expectedVersion,
                actualVersion
            }
        );

        this.name = "LifecycleConcurrencyError";
    }
}

class LifecycleTerminalStateError extends LifecycleError {
    constructor(transactionId, state) {
        super(
            `Transaction ${transactionId} is already in terminal state ${state}`,
            "LIFECYCLE_TERMINAL_STATE",
            {
                transactionId,
                state
            }
        );

        this.name = "LifecycleTerminalStateError";
    }
}

class LifecycleValidationError extends LifecycleError {
    constructor(message, details = {}) {
        super(
            message,
            "LIFECYCLE_VALIDATION_ERROR",
            details
        );

        this.name = "LifecycleValidationError";
    }
}

/**
 * ============================================================================
 * UTILITY FUNCTIONS
 * ============================================================================
 */

function now() {
    return new Date();
}

function toDate(value, fallback = null) {
    if (!value) {
        return fallback;
    }

    const date = value instanceof Date
        ? new Date(value.getTime())
        : new Date(value);

    if (Number.isNaN(date.getTime())) {
        return fallback;
    }

    return date;
}

function clone(value) {
    if (value === undefined || value === null) {
        return value;
    }

    if (typeof structuredClone === "function") {
        try {
            return structuredClone(value);
        } catch (_) {
            // Fall through.
        }
    }

    try {
        return JSON.parse(JSON.stringify(value));
    } catch (_) {
        return value;
    }
}

function safeError(error) {
    if (!error) {
        return null;
    }

    return {
        name: error.name || "Error",
        message: error.message || String(error),
        code: error.code || null,
        stack: error.stack || null
    };
}

/**
 * ============================================================================
 * LIFECYCLE MANAGER
 * ============================================================================
 */

class LifecycleManager {
    constructor(options = {}) {
        this.config = {
            ...DEFAULT_CONFIG,
            ...(options.config || {})
        };

        this.repository =
            options.repository ||
            options.persistenceAdapter ||
            null;

        this.logger =
            options.logger ||
            console;

        this.hooks = {
            beforeTransition:
                options.beforeTransition || null,

            afterTransition:
                options.afterTransition || null,

            onFailure:
                options.onFailure || null,

            onTerminal:
                options.onTerminal || null,

            onTimeout:
                options.onTimeout || null,

            onCompensation:
                options.onCompensation || null
        };

        /**
         * In-memory fallback store.
         *
         * This is intentionally not intended to be the production source
         * of truth. Production deployments should provide a repository.
         */
        this.store = new Map();
    }

    /**
     * =========================================================================
     * INITIALIZE LIFECYCLE
     * =========================================================================
     *
     * Creates the initial lifecycle record.
     */
    async initialize(transaction, options = {}) {
        this.validateTransaction(transaction);

        const transactionId =
            String(
                transaction.transactionId ||
                transaction.id ||
                transaction._id ||
                ""
            );

        if (!transactionId) {
            throw new LifecycleValidationError(
                "transactionId is required"
            );
        }

        const tenantId =
            transaction.tenantId ||
            options.tenantId ||
            null;

        if (
            this.config.strictTenantIsolation &&
            !tenantId
        ) {
            throw new LifecycleValidationError(
                "tenantId is required for lifecycle initialization",
                {
                    transactionId
                }
            );
        }

        const existing =
            await this.get(
                transactionId,
                {
                    tenantId
                }
            );

        if (existing) {
            return {
                created: false,
                idempotent: true,
                lifecycle: existing
            };
        }

        const timestamp = now();

        const lifecycle = {
            lifecycleId: crypto.randomUUID(),

            transactionId,

            tenantId,

            state: LIFECYCLE_STATES.CREATED,

            version: 1,

            correlationId:
                options.correlationId ||
                transaction.correlationId ||
                crypto.randomUUID(),

            causationId:
                options.causationId ||
                transaction.causationId ||
                null,

            idempotencyKey:
                options.idempotencyKey ||
                transaction.idempotencyKey ||
                null,

            createdAt: timestamp,

            updatedAt: timestamp,

            startedAt: null,

            completedAt: null,

            failedAt: null,

            cancelledAt: null,

            timedOutAt: null,

            compensatedAt: null,

            timeoutAt:
                toDate(
                    options.timeoutAt ||
                    transaction.timeoutAt
                ) ||
                new Date(
                    timestamp.getTime() +
                    this.config.defaultTimeoutMs
                ),

            lastError: null,

            failureCount: 0,

            retryCount: 0,

            metadata: clone(
                options.metadata ||
                transaction.metadata ||
                {}
            ),

            history: this.config.enableHistory
                ? [
                    this.createHistoryEntry({
                        from: null,
                        to: LIFECYCLE_STATES.CREATED,
                        actor: options.actor,
                        reason:
                            options.reason ||
                            "Transaction lifecycle initialized",
                        correlationId:
                            options.correlationId ||
                            transaction.correlationId
                    })
                ]
                : []
        };

        const persisted =
            await this.persistCreate(
                lifecycle,
                options
            );

        return {
            created: true,
            idempotent: false,
            lifecycle: persisted
        };
    }

    /**
     * =========================================================================
     * TRANSITION
     * =========================================================================
     *
     * Central lifecycle transition method.
     */
    async transition(transactionId, targetState, options = {}) {
        this.validateTransactionId(transactionId);
        this.validateState(targetState);

        const lifecycle =
            await this.get(
                transactionId,
                {
                    tenantId: options.tenantId
                }
            );

        if (!lifecycle) {
            throw new LifecycleNotFoundError(
                transactionId
            );
        }

        this.validateTenant(
            lifecycle,
            options.tenantId
        );

        const currentState = lifecycle.state;

        /**
         * Idempotent same-state transition.
         */
        if (
            currentState === targetState &&
            this.config.allowSameStateTransition
        ) {
            return {
                changed: false,
                idempotent: true,
                lifecycle
            };
        }

        /**
         * Terminal protection.
         */
        if (TERMINAL_STATES.has(currentState)) {
            throw new LifecycleTerminalStateError(
                transactionId,
                currentState
            );
        }

        this.assertTransitionAllowed(
            currentState,
            targetState,
            transactionId
        );

        /**
         * Optional expected-version protection.
         */
        if (
            options.expectedVersion !== undefined &&
            Number(options.expectedVersion) !==
            Number(lifecycle.version)
        ) {
            throw new LifecycleConcurrencyError(
                transactionId,
                options.expectedVersion,
                lifecycle.version
            );
        }

        const transitionContext =
            this.createTransitionContext(
                lifecycle,
                targetState,
                options
            );

        await this.runBeforeTransition(
            transitionContext
        );

        const updatedLifecycle =
            this.buildTransitionedLifecycle(
                lifecycle,
                targetState,
                transitionContext
            );

        const persisted =
            await this.persistTransition(
                lifecycle,
                updatedLifecycle,
                options
            );

        await this.runAfterTransition({
            ...transitionContext,
            lifecycle: persisted
        });

        if (TERMINAL_STATES.has(targetState)) {
            await this.runTerminalHook({
                ...transitionContext,
                lifecycle: persisted
            });
        }

        if (targetState === LIFECYCLE_STATES.COMPENSATING) {
            await this.runCompensationHook({
                ...transitionContext,
                lifecycle: persisted
            });
        }

        return {
            changed: true,
            idempotent: false,
            lifecycle: persisted
        };
    }

    /**
     * =========================================================================
     * CONVENIENCE TRANSITION METHODS
     * =========================================================================
     */

    async beginValidation(transactionId, options = {}) {
        return this.transition(
            transactionId,
            LIFECYCLE_STATES.VALIDATING,
            options
        );
    }

    async markValidated(transactionId, options = {}) {
        return this.transition(
            transactionId,
            LIFECYCLE_STATES.VALIDATED,
            options
        );
    }

    async beginProcessing(transactionId, options = {}) {
        return this.transition(
            transactionId,
            LIFECYCLE_STATES.PROCESSING,
            options
        );
    }

    async markPending(transactionId, options = {}) {
        return this.transition(
            transactionId,
            LIFECYCLE_STATES.PENDING,
            options
        );
    }

    async complete(transactionId, options = {}) {
        return this.transition(
            transactionId,
            LIFECYCLE_STATES.COMPLETED,
            options
        );
    }

    async fail(transactionId, error, options = {}) {
        const lifecycle =
            await this.get(
                transactionId,
                {
                    tenantId: options.tenantId
                }
            );

        if (!lifecycle) {
            throw new LifecycleNotFoundError(
                transactionId
            );
        }

        const errorObject =
            error instanceof Error
                ? error
                : new Error(
                    typeof error === "string"
                        ? error
                        : "Transaction lifecycle failure"
                );

        return this.transition(
            transactionId,
            LIFECYCLE_STATES.FAILED,
            {
                ...options,
                error: errorObject,
                reason:
                    options.reason ||
                    errorObject.message
            }
        );
    }

    async beginCompensation(transactionId, options = {}) {
        return this.transition(
            transactionId,
            LIFECYCLE_STATES.COMPENSATING,
            options
        );
    }

    async markCompensated(transactionId, options = {}) {
        return this.transition(
            transactionId,
            LIFECYCLE_STATES.COMPENSATED,
            options
        );
    }

    async cancel(transactionId, options = {}) {
        return this.transition(
            transactionId,
            LIFECYCLE_STATES.CANCELLED,
            options
        );
    }

    async timeout(transactionId, options = {}) {
        const result =
            await this.transition(
                transactionId,
                LIFECYCLE_STATES.TIMED_OUT,
                {
                    ...options,
                    reason:
                        options.reason ||
                        "Transaction lifecycle timeout"
                }
            );

        await this.runTimeoutHook({
            transactionId,
            ...options,
            lifecycle: result.lifecycle
        });

        return result;
    }

    /**
     * =========================================================================
     * FAILURE RECORDING
     * =========================================================================
     *
     * Records failure metadata without changing state.
     *
     * Useful when a retryable failure occurs while the transaction remains
     * PENDING or PROCESSING.
     */
    async recordFailure(transactionId, error, options = {}) {
        const lifecycle =
            await this.get(
                transactionId,
                {
                    tenantId: options.tenantId
                }
            );

        if (!lifecycle) {
            throw new LifecycleNotFoundError(
                transactionId
            );
        }

        this.validateTenant(
            lifecycle,
            options.tenantId
        );

        if (TERMINAL_STATES.has(lifecycle.state)) {
            throw new LifecycleTerminalStateError(
                transactionId,
                lifecycle.state
            );
        }

        const failure =
            safeError(
                error instanceof Error
                    ? error
                    : new Error(
                        String(error || "Unknown failure")
                    )
            );

        const updated = {
            ...clone(lifecycle),

            version:
                Number(lifecycle.version || 0) + 1,

            updatedAt: now(),

            lastError: failure,

            failureCount:
                Number(lifecycle.failureCount || 0) + 1
        };

        const persisted =
            await this.persistUpdate(
                lifecycle,
                updated,
                options
            );

        await this.runFailureHook({
            transactionId,
            lifecycle: persisted,
            error: failure,
            options
        });

        return persisted;
    }

    /**
     * =========================================================================
     * RETRY TRACKING
     * =========================================================================
     */
    async recordRetry(transactionId, options = {}) {
        const lifecycle =
            await this.get(
                transactionId,
                {
                    tenantId: options.tenantId
                }
            );

        if (!lifecycle) {
            throw new LifecycleNotFoundError(
                transactionId
            );
        }

        this.validateTenant(
            lifecycle,
            options.tenantId
        );

        if (TERMINAL_STATES.has(lifecycle.state)) {
            throw new LifecycleTerminalStateError(
                transactionId,
                lifecycle.state
            );
        }

        const updated = {
            ...clone(lifecycle),

            version:
                Number(lifecycle.version || 0) + 1,

            updatedAt: now(),

            retryCount:
                Number(lifecycle.retryCount || 0) + 1
        };

        return this.persistUpdate(
            lifecycle,
            updated,
            options
        );
    }

    /**
     * =========================================================================
     * TIMEOUT DETECTION
     * =========================================================================
     */

    isExpired(lifecycle) {
        if (!lifecycle) {
            return false;
        }

        if (TERMINAL_STATES.has(lifecycle.state)) {
            return false;
        }

        if (!lifecycle.timeoutAt) {
            return false;
        }

        return (
            new Date(lifecycle.timeoutAt).getTime() <=
            Date.now()
        );
    }

    async enforceTimeout(transactionId, options = {}) {
        const lifecycle =
            await this.get(
                transactionId,
                {
                    tenantId: options.tenantId
                }
            );

        if (!lifecycle) {
            throw new LifecycleNotFoundError(
                transactionId
            );
        }

        if (!this.isExpired(lifecycle)) {
            return {
                expired: false,
                lifecycle
            };
        }

        const result =
            await this.timeout(
                transactionId,
                {
                    ...options,
                    reason:
                        options.reason ||
                        "Lifecycle timeout threshold exceeded"
                }
            );

        return {
            expired: true,
            lifecycle: result.lifecycle
        };
    }

    /**
     * =========================================================================
     * STATE QUERIES
     * =========================================================================
     */

    async get(transactionId, options = {}) {
        this.validateTransactionId(transactionId);

        if (this.repository?.findById) {
            const lifecycle =
                await this.repository.findById(
                    transactionId,
                    options
                );

            if (!lifecycle) {
                return null;
            }

            this.validateTenant(
                lifecycle,
                options.tenantId
            );

            return clone(lifecycle);
        }

        const lifecycle =
            this.store.get(
                String(transactionId)
            );

        if (!lifecycle) {
            return null;
        }

        this.validateTenant(
            lifecycle,
            options.tenantId
        );

        return clone(lifecycle);
    }

    async getState(transactionId, options = {}) {
        const lifecycle =
            await this.get(
                transactionId,
                options
            );

        return lifecycle?.state || null;
    }

    async exists(transactionId, options = {}) {
        return Boolean(
            await this.get(
                transactionId,
                options
            )
        );
    }

    async isTerminal(transactionId, options = {}) {
        const state =
            await this.getState(
                transactionId,
                options
            );

        return Boolean(
            state &&
            TERMINAL_STATES.has(state)
        );
    }

    async getHistory(transactionId, options = {}) {
        const lifecycle =
            await this.get(
                transactionId,
                options
            );

        if (!lifecycle) {
            throw new LifecycleNotFoundError(
                transactionId
            );
        }

        return clone(
            lifecycle.history || []
        );
    }

    /**
     * =========================================================================
     * TRANSITION VALIDATION
     * =========================================================================
     */

    canTransition(from, to) {
        if (!from || !to) {
            return false;
        }

        if (TERMINAL_STATES.has(from)) {
            return false;
        }

        return Boolean(
            TRANSITIONS[from]?.includes(to)
        );
    }

    assertTransitionAllowed(
        from,
        to,
        transactionId
    ) {
        if (!this.canTransition(from, to)) {
            throw new InvalidLifecycleTransitionError(
                from,
                to,
                transactionId
            );
        }
    }

    validateState(state) {
        if (
            !Object.values(
                LIFECYCLE_STATES
            ).includes(state)
        ) {
            throw new LifecycleValidationError(
                `Unknown lifecycle state: ${state}`,
                {
                    state
                }
            );
        }
    }

    validateTransactionId(transactionId) {
        if (
            transactionId === undefined ||
            transactionId === null ||
            String(transactionId).trim() === ""
        ) {
            throw new LifecycleValidationError(
                "transactionId is required"
            );
        }
    }

    validateTransaction(transaction) {
        if (
            !transaction ||
            typeof transaction !== "object"
        ) {
            throw new LifecycleValidationError(
                "Transaction object is required"
            );
        }
    }

    /**
     * =========================================================================
     * TENANT ISOLATION
     * =========================================================================
     */

    validateTenant(lifecycle, requestedTenantId) {
        if (
            !this.config.strictTenantIsolation ||
            !requestedTenantId
        ) {
            return true;
        }

        if (
            String(lifecycle.tenantId) !==
            String(requestedTenantId)
        ) {
            throw new LifecycleValidationError(
                "Tenant isolation violation",
                {
                    transactionId:
                        lifecycle.transactionId,
                    tenantId:
                        requestedTenantId
                }
            );
        }

        return true;
    }

    /**
     * =========================================================================
     * TRANSITION CONTEXT
     * =========================================================================
     */

    createTransitionContext(
        lifecycle,
        targetState,
        options
    ) {
        return {
            transitionId: crypto.randomUUID(),

            lifecycleId:
                lifecycle.lifecycleId,

            transactionId:
                lifecycle.transactionId,

            tenantId:
                lifecycle.tenantId,

            from:
                lifecycle.state,

            to:
                targetState,

            actor:
                options.actor ||
                options.actorId ||
                "SYSTEM",

            reason:
                options.reason ||
                null,

            correlationId:
                options.correlationId ||
                lifecycle.correlationId,

            causationId:
                options.causationId ||
                lifecycle.causationId,

            idempotencyKey:
                options.idempotencyKey ||
                lifecycle.idempotencyKey ||
                null,

            timestamp: now(),

            metadata:
                clone(options.metadata || {}),

            error:
                options.error
                    ? safeError(options.error)
                    : null
        };
    }

    /**
     * =========================================================================
     * BUILD NEW LIFECYCLE STATE
     * =========================================================================
     */

    buildTransitionedLifecycle(
        lifecycle,
        targetState,
        context
    ) {
        const timestamp =
            context.timestamp;

        const updated = {
            ...clone(lifecycle),

            state: targetState,

            version:
                Number(lifecycle.version || 0) + 1,

            updatedAt: timestamp,

            lastError:
                context.error ||
                lifecycle.lastError ||
                null
        };

        /**
         * Lifecycle timestamps.
         */
        if (
            targetState ===
            LIFECYCLE_STATES.PROCESSING &&
            !updated.startedAt
        ) {
            updated.startedAt =
                timestamp;
        }

        if (
            targetState ===
            LIFECYCLE_STATES.COMPLETED
        ) {
            updated.completedAt =
                timestamp;
        }

        if (
            targetState ===
            LIFECYCLE_STATES.FAILED
        ) {
            updated.failedAt =
                timestamp;

            updated.failureCount =
                Number(
                    lifecycle.failureCount || 0
                ) + 1;
        }

        if (
            targetState ===
            LIFECYCLE_STATES.CANCELLED
        ) {
            updated.cancelledAt =
                timestamp;
        }

        if (
            targetState ===
            LIFECYCLE_STATES.TIMED_OUT
        ) {
            updated.timedOutAt =
                timestamp;
        }

        if (
            targetState ===
            LIFECYCLE_STATES.COMPENSATED
        ) {
            updated.compensatedAt =
                timestamp;
        }

        /**
         * Append immutable transition history.
         */
        if (this.config.enableHistory) {
            const historyEntry =
                this.createHistoryEntry({
                    from:
                        lifecycle.state,

                    to:
                        targetState,

                    actor:
                        context.actor,

                    reason:
                        context.reason,

                    correlationId:
                        context.correlationId,

                    causationId:
                        context.causationId,

                    transitionId:
                        context.transitionId,

                    metadata:
                        context.metadata,

                    error:
                        context.error
                });

            const history =
                Array.isArray(lifecycle.history)
                    ? [
                        ...lifecycle.history,
                        historyEntry
                    ]
                    : [historyEntry];

            updated.history =
                history.length >
                this.config.maxHistoryEntries
                    ? history.slice(
                        -this.config.maxHistoryEntries
                    )
                    : history;
        }

        return updated;
    }

    /**
     * =========================================================================
     * HISTORY ENTRY
     * =========================================================================
     */

    createHistoryEntry({
        from,
        to,
        actor,
        reason,
        correlationId,
        causationId,
        transitionId,
        metadata,
        error
    }) {
        return {
            historyId:
                crypto.randomUUID(),

            transitionId:
                transitionId ||
                crypto.randomUUID(),

            from:
                from || null,

            to,

            actor:
                actor || "SYSTEM",

            reason:
                reason || null,

            correlationId:
                correlationId || null,

            causationId:
                causationId || null,

            metadata:
                clone(metadata || {}),

            error:
                error || null,

            timestamp:
                now()
        };
    }

    /**
     * =========================================================================
     * PERSISTENCE
     * =========================================================================
     */

    async persistCreate(
        lifecycle,
        options = {}
    ) {
        if (this.repository?.create) {
            const created =
                await this.repository.create(
                    clone(lifecycle),
                    options
                );

            return clone(
                created || lifecycle
            );
        }

        this.store.set(
            String(lifecycle.transactionId),
            clone(lifecycle)
        );

        return clone(lifecycle);
    }

    async persistTransition(
        previous,
        next,
        options = {}
    ) {
        if (this.repository?.updateState) {
            const updated =
                await this.repository.updateState(
                    previous.transactionId,
                    previous.version,
                    clone(next),
                    options
                );

            if (!updated) {
                throw new LifecycleConcurrencyError(
                    previous.transactionId,
                    previous.version,
                    "UNKNOWN"
                );
            }

            return clone(updated);
        }

        return this.persistUpdate(
            previous,
            next,
            options
        );
    }

    async persistUpdate(
        previous,
        next,
        options = {}
    ) {
        if (this.repository?.updateState) {
            const updated =
                await this.repository.updateState(
                    previous.transactionId,
                    previous.version,
                    clone(next),
                    options
                );

            if (!updated) {
                throw new LifecycleConcurrencyError(
                    previous.transactionId,
                    previous.version,
                    "UNKNOWN"
                );
            }

            return clone(updated);
        }

        const key =
            String(previous.transactionId);

        const current =
            this.store.get(key);

        /**
         * Local optimistic concurrency protection.
         */
        if (
            current &&
            Number(current.version) !==
            Number(previous.version)
        ) {
            throw new LifecycleConcurrencyError(
                previous.transactionId,
                previous.version,
                current.version
            );
        }

        this.store.set(
            key,
            clone(next)
        );

        return clone(next);
    }

    /**
     * =========================================================================
     * HOOKS
     * =========================================================================
     */

    async runBeforeTransition(context) {
        if (
            !this.config.enableHooks ||
            typeof this.hooks.beforeTransition !==
            "function"
        ) {
            return;
        }

        await this.hooks.beforeTransition(
            clone(context)
        );
    }

    async runAfterTransition(context) {
        if (
            !this.config.enableHooks ||
            typeof this.hooks.afterTransition !==
            "function"
        ) {
            return;
        }

        await this.hooks.afterTransition(
            clone(context)
        );
    }

    async runFailureHook(context) {
        if (
            !this.config.enableHooks ||
            typeof this.hooks.onFailure !==
            "function"
        ) {
            return;
        }

        await this.hooks.onFailure(
            clone(context)
        );
    }

    async runTerminalHook(context) {
        if (
            !this.config.enableHooks ||
            typeof this.hooks.onTerminal !==
            "function"
        ) {
            return;
        }

        await this.hooks.onTerminal(
            clone(context)
        );
    }

    async runTimeoutHook(context) {
        if (
            !this.config.enableHooks ||
            typeof this.hooks.onTimeout !==
            "function"
        ) {
            return;
        }

        await this.hooks.onTimeout(
            clone(context)
        );
    }

    async runCompensationHook(context) {
        if (
            !this.config.enableHooks ||
            typeof this.hooks.onCompensation !==
            "function"
        ) {
            return;
        }

        await this.hooks.onCompensation(
            clone(context)
        );
    }

    /**
     * =========================================================================
     * STATE MACHINE INSPECTION
     * =========================================================================
     */

    getAllowedTransitions(state) {
        this.validateState(state);

        return [
            ...(TRANSITIONS[state] || [])
        ];
    }

    getTerminalStates() {
        return [
            ...TERMINAL_STATES
        ];
    }

    getStates() {
        return {
            ...LIFECYCLE_STATES
        };
    }

    getTransitionMap() {
        return clone(
            TRANSITIONS
        );
    }

    /**
     * =========================================================================
     * HEALTH / DIAGNOSTICS
     * =========================================================================
     */

    getHealth() {
        return {
            service: "LifecycleManager",

            status: "UP",

            persistence:
                this.repository
                    ? "EXTERNAL"
                    : "IN_MEMORY",

            strictTenantIsolation:
                this.config.strictTenantIsolation,

            historyEnabled:
                this.config.enableHistory,

            hookEnabled:
                this.config.enableHooks,

            timestamp:
                now().toISOString()
        };
    }

    /**
     * =========================================================================
     * LOGGER
     * =========================================================================
     */

    log(level, message, metadata = {}) {
        if (!this.config.enableLogging) {
            return;
        }

        const loggerMethod =
            typeof this.logger?.[level] === "function"
                ? this.logger[level]
                : this.logger?.log;

        if (typeof loggerMethod !== "function") {
            return;
        }

        loggerMethod.call(
            this.logger,
            `[LifecycleManager] ${message}`,
            metadata
        );
    }
}

/**
 * ============================================================================
 * EXPORTS
 * ============================================================================
 *
 * Default export remains a singleton for compatibility with the existing
 * service-oriented architecture.
 *
 * The constructor is also exported so tests or infrastructure can create
 * isolated instances with repositories, loggers and hooks.
 * ============================================================================
 */

const lifecycleManager =
    new LifecycleManager();

module.exports =
    lifecycleManager;

module.exports.LifecycleManager =
    LifecycleManager;

module.exports.LifecycleError =
    LifecycleError;

module.exports.InvalidLifecycleTransitionError =
    InvalidLifecycleTransitionError;

module.exports.LifecycleNotFoundError =
    LifecycleNotFoundError;

module.exports.LifecycleConcurrencyError =
    LifecycleConcurrencyError;

module.exports.LifecycleTerminalStateError =
    LifecycleTerminalStateError;

module.exports.LifecycleValidationError =
    LifecycleValidationError;

module.exports.LIFECYCLE_STATES =
    LIFECYCLE_STATES;

module.exports.TERMINAL_STATES =
    TERMINAL_STATES;

module.exports.TRANSITIONS =
    TRANSITIONS;