"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Saga Context
 * ============================================================================
 *
 * File:
 *   backend/modules/transactions/orchestration/SagaContext.js
 *
 * Purpose:
 *   Enterprise-grade execution context for distributed transaction
 *   orchestration / Saga workflows.
 *
 * Responsibilities:
 *   - Correlation and causation tracking
 *   - Saga identity and idempotency
 *   - Tenant isolation
 *   - Actor/request context propagation
 *   - Saga lifecycle state
 *   - Step execution tracking
 *   - Compensation tracking
 *   - Retry metadata
 *   - Timeout / deadline management
 *   - Audit correlation
 *   - Error normalization
 *   - Safe context serialization
 *   - Context cloning
 *   - Context validation
 *
 * Non-responsibilities:
 *   - Database persistence
 *   - Transaction commits / rollbacks
 *   - Business-domain decisions
 *   - Queue publishing
 *   - Compensation execution
 *
 * Design Principles:
 *   - Context is the source of orchestration metadata, not business state.
 *   - Never silently mutate identity fields.
 *   - Never expose secrets through serialization.
 *   - Preserve correlation across retries and compensations.
 *   - Keep the object framework-independent.
 *
 * ============================================================================
 */

const crypto = require("crypto");

/**
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

const SAGA_STATUS = Object.freeze({
    CREATED: "CREATED",
    RUNNING: "RUNNING",
    WAITING: "WAITING",
    COMPENSATING: "COMPENSATING",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
    COMPENSATED: "COMPENSATED",
    CANCELLED: "CANCELLED",
    TIMED_OUT: "TIMED_OUT"
});

const STEP_STATUS = Object.freeze({
    PENDING: "PENDING",
    RUNNING: "RUNNING",
    WAITING: "WAITING",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
    COMPENSATING: "COMPENSATING",
    COMPENSATED: "COMPENSATED",
    SKIPPED: "SKIPPED"
});

const COMPENSATION_STATUS = Object.freeze({
    PENDING: "PENDING",
    RUNNING: "RUNNING",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
    SKIPPED: "SKIPPED"
});

const TERMINAL_SAGA_STATES = new Set([
    SAGA_STATUS.COMPLETED,
    SAGA_STATUS.FAILED,
    SAGA_STATUS.COMPENSATED,
    SAGA_STATUS.CANCELLED,
    SAGA_STATUS.TIMED_OUT
]);

const SENSITIVE_KEYS = new Set([
    "password",
    "passwd",
    "secret",
    "token",
    "accessToken",
    "refreshToken",
    "authorization",
    "cookie",
    "apiKey",
    "privateKey",
    "clientSecret",
    "credential",
    "credentials",
    "pin",
    "otp",
    "securityAnswer"
]);

const DEFAULTS = Object.freeze({
    maxSteps: 100,
    maxHistoryEntries: 500,
    maxMetadataKeys: 100,
    defaultTimeoutMs: 300000,
    defaultMaxRetries: 3
});

/**
 * ============================================================================
 * UTILITY FUNCTIONS
 * ============================================================================
 */

/**
 * Generate cryptographically strong identifiers.
 *
 * @param {string} prefix
 * @returns {string}
 */
function generateId(prefix) {
    return `${prefix}_${crypto.randomUUID()}`;
}

/**
 * Return a safe Date instance.
 *
 * @param {*} value
 * @param {Date} fallback
 * @returns {Date}
 */
function toDate(value, fallback = new Date()) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return new Date(value.getTime());
    }

    if (value) {
        const parsed = new Date(value);

        if (!Number.isNaN(parsed.getTime())) {
            return parsed;
        }
    }

    return new Date(fallback.getTime());
}

/**
 * Safely clone JSON-compatible data.
 *
 * This intentionally avoids structured cloning because SagaContext should
 * remain compatible with supported Node.js runtime variants and Mongoose
 * document values.
 *
 * @param {*} value
 * @returns {*}
 */
function cloneValue(value) {
    if (value === undefined || value === null) {
        return value;
    }

    if (value instanceof Date) {
        return new Date(value.getTime());
    }

    if (Buffer.isBuffer(value)) {
        return Buffer.from(value);
    }

    if (Array.isArray(value)) {
        return value.map(cloneValue);
    }

    if (typeof value === "object") {
        const result = {};

        for (const [key, childValue] of Object.entries(value)) {
            result[key] = cloneValue(childValue);
        }

        return result;
    }

    return value;
}

/**
 * Remove secrets from arbitrary metadata.
 *
 * @param {*} value
 * @param {number} depth
 * @returns {*}
 */
function sanitizeValue(value, depth = 0) {
    if (depth > 10) {
        return "[MAX_DEPTH]";
    }

    if (value === null || value === undefined) {
        return value;
    }

    if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
    ) {
        return value;
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (Buffer.isBuffer(value)) {
        return "[BUFFER]";
    }

    if (Array.isArray(value)) {
        return value.map((item) => sanitizeValue(item, depth + 1));
    }

    if (typeof value === "object") {
        const result = {};

        for (const [key, childValue] of Object.entries(value)) {
            if (SENSITIVE_KEYS.has(key)) {
                result[key] = "[REDACTED]";
                continue;
            }

            result[key] = sanitizeValue(childValue, depth + 1);
        }

        return result;
    }

    return String(value);
}

/**
 * Ensure a value is a positive integer.
 *
 * @param {*} value
 * @param {number} fallback
 * @returns {number}
 */
function positiveInteger(value, fallback) {
    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed <= 0) {
        return fallback;
    }

    return parsed;
}

/**
 * Ensure a finite non-negative number.
 *
 * @param {*} value
 * @param {number} fallback
 * @returns {number}
 */
function nonNegativeNumber(value, fallback = 0) {
    const parsed = Number(value);

    if (!Number.isFinite(parsed) || parsed < 0) {
        return fallback;
    }

    return parsed;
}

/**
 * ============================================================================
 * SAGA CONTEXT
 * ============================================================================
 */

class SagaContext {
    /**
     * @param {Object} options
     */
    constructor(options = {}) {
        const now = new Date();

        this.version = 1;

        /**
         * ---------------------------------------------------------------------
         * Identity
         * ---------------------------------------------------------------------
         */

        this.sagaId =
            options.sagaId ||
            generateId("saga");

        this.executionId =
            options.executionId ||
            generateId("exec");

        this.correlationId =
            options.correlationId ||
            this.sagaId;

        this.causationId =
            options.causationId ||
            null;

        this.parentSagaId =
            options.parentSagaId ||
            null;

        this.parentExecutionId =
            options.parentExecutionId ||
            null;

        this.idempotencyKey =
            options.idempotencyKey ||
            null;

        /**
         * ---------------------------------------------------------------------
         * Tenant / actor context
         * ---------------------------------------------------------------------
         */

        this.tenantId =
            options.tenantId ||
            null;

        this.actor = {
            userId: options.actor?.userId || null,
            role: options.actor?.role || null,
            service: options.actor?.service || null,
            source: options.actor?.source || null
        };

        /**
         * ---------------------------------------------------------------------
         * Request context
         * ---------------------------------------------------------------------
         */

        this.request = {
            requestId: options.request?.requestId || null,
            traceId: options.request?.traceId || null,
            spanId: options.request?.spanId || null,
            ip: options.request?.ip || null,
            userAgent: options.request?.userAgent || null
        };

        /**
         * ---------------------------------------------------------------------
         * Saga state
         * ---------------------------------------------------------------------
         */

        this.status =
            options.status ||
            SAGA_STATUS.CREATED;

        this.currentStep =
            options.currentStep ||
            null;

        this.stepIndex =
            Number.isInteger(options.stepIndex)
                ? options.stepIndex
                : -1;

        this.totalSteps =
            Number.isInteger(options.totalSteps)
                ? options.totalSteps
                : 0;

        /**
         * ---------------------------------------------------------------------
         * Timing / deadlines
         * ---------------------------------------------------------------------
         */

        this.createdAt =
            toDate(options.createdAt, now);

        this.startedAt =
            options.startedAt
                ? toDate(options.startedAt)
                : null;

        this.completedAt =
            options.completedAt
                ? toDate(options.completedAt)
                : null;

        this.updatedAt =
            toDate(options.updatedAt, now);

        this.timeoutMs =
            positiveInteger(
                options.timeoutMs,
                DEFAULTS.defaultTimeoutMs
            );

        this.deadline =
            options.deadline
                ? toDate(options.deadline)
                : new Date(
                      this.createdAt.getTime() +
                          this.timeoutMs
                  );

        /**
         * ---------------------------------------------------------------------
         * Retry configuration
         * ---------------------------------------------------------------------
         */

        this.retry = {
            attempt:
                nonNegativeNumber(
                    options.retry?.attempt,
                    0
                ),

            maxAttempts:
                positiveInteger(
                    options.retry?.maxAttempts,
                    DEFAULTS.defaultMaxRetries
                ),

            lastAttemptAt:
                options.retry?.lastAttemptAt
                    ? toDate(options.retry.lastAttemptAt)
                    : null,

            nextRetryAt:
                options.retry?.nextRetryAt
                    ? toDate(options.retry.nextRetryAt)
                    : null
        };

        /**
         * ---------------------------------------------------------------------
         * Workflow state
         * ---------------------------------------------------------------------
         */

        this.input =
            cloneValue(options.input || {});

        this.output =
            cloneValue(options.output || {});

        this.state =
            cloneValue(options.state || {});

        this.metadata =
            cloneValue(options.metadata || {});

        /**
         * ---------------------------------------------------------------------
         * Step tracking
         * ---------------------------------------------------------------------
         */

        this.steps = Array.isArray(options.steps)
            ? options.steps.map((step) =>
                  this.normalizeStep(step)
              )
            : [];

        /**
         * ---------------------------------------------------------------------
         * Compensation
         * ---------------------------------------------------------------------
         */

        this.compensation = {
            required:
                Boolean(
                    options.compensation?.required
                ),

            status:
                options.compensation?.status ||
                COMPENSATION_STATUS.PENDING,

            currentStep:
                options.compensation?.currentStep ||
                null,

            completedSteps: Array.isArray(
                options.compensation?.completedSteps
            )
                ? [
                      ...options.compensation.completedSteps
                  ]
                : [],

            failedSteps: Array.isArray(
                options.compensation?.failedSteps
            )
                ? [
                      ...options.compensation.failedSteps
                  ]
                : []
        };

        /**
         * ---------------------------------------------------------------------
         * Errors
         * ---------------------------------------------------------------------
         */

        this.error =
            options.error
                ? this.normalizeError(options.error)
                : null;

        this.errors = Array.isArray(options.errors)
            ? options.errors.map((error) =>
                  this.normalizeError(error)
              )
            : [];

        /**
         * ---------------------------------------------------------------------
         * Audit / lifecycle history
         * ---------------------------------------------------------------------
         */

        this.history = Array.isArray(options.history)
            ? options.history.map((entry) =>
                  this.normalizeHistoryEntry(entry)
              )
            : [];

        /**
         * ---------------------------------------------------------------------
         * Internal controls
         * ---------------------------------------------------------------------
         */

        this.limits = {
            maxSteps:
                positiveInteger(
                    options.limits?.maxSteps,
                    DEFAULTS.maxSteps
                ),

            maxHistoryEntries:
                positiveInteger(
                    options.limits?.maxHistoryEntries,
                    DEFAULTS.maxHistoryEntries
                ),

            maxMetadataKeys:
                positiveInteger(
                    options.limits?.maxMetadataKeys,
                    DEFAULTS.maxMetadataKeys
                )
        };

        this._assertIdentity();
    }

    /**
     * =========================================================================
     * FACTORY
     * =========================================================================
     */

    static create(options = {}) {
        return new SagaContext(options);
    }

    /**
     * Rehydrate context from persisted state.
     *
     * @param {Object} data
     * @returns {SagaContext}
     */
    static fromJSON(data) {
        if (!data || typeof data !== "object") {
            throw new TypeError(
                "Saga context data must be an object"
            );
        }

        return new SagaContext(data);
    }

    /**
     * =========================================================================
     * IDENTITY
     * =========================================================================
     */

    _assertIdentity() {
        if (!this.sagaId) {
            throw new Error(
                "Saga context requires sagaId"
            );
        }

        if (!this.executionId) {
            throw new Error(
                "Saga context requires executionId"
            );
        }

        if (!this.correlationId) {
            throw new Error(
                "Saga context requires correlationId"
            );
        }
    }

    /**
     * Update causation while preserving correlation.
     *
     * @param {string} causationId
     * @returns {SagaContext}
     */
    setCausationId(causationId) {
        this.causationId =
            causationId || null;

        this.touch();

        return this;
    }

    /**
     * Create a child execution context.
     *
     * @param {Object} options
     * @returns {SagaContext}
     */
    createChildContext(options = {}) {
        return new SagaContext({
            ...this.toJSON(),

            sagaId:
                options.sagaId ||
                generateId("saga"),

            executionId:
                options.executionId ||
                generateId("exec"),

            parentSagaId:
                this.sagaId,

            parentExecutionId:
                this.executionId,

            correlationId:
                this.correlationId,

            causationId:
                this.executionId,

            status:
                SAGA_STATUS.CREATED,

            currentStep: null,

            stepIndex: -1,

            totalSteps: 0,

            steps: [],

            history: [],

            errors: [],

            error: null,

            compensation: {
                required: false,
                status: COMPENSATION_STATUS.PENDING,
                currentStep: null,
                completedSteps: [],
                failedSteps: []
            },

            input:
                cloneValue(
                    options.input || {}
                ),

            output: {},

            state:
                cloneValue(
                    options.state || {}
                ),

            metadata: {
                ...cloneValue(this.metadata),
                ...cloneValue(options.metadata || {})
            }
        });
    }

    /**
     * =========================================================================
     * LIFECYCLE
     * =========================================================================
     */

    start() {
        this.assertNotTerminal();

        if (!this.startedAt) {
            this.startedAt = new Date();
        }

        this.status = SAGA_STATUS.RUNNING;

        this.touch();

        this.recordHistory(
            "SAGA_STARTED"
        );

        return this;
    }

    setWaiting(reason = null) {
        this.assertNotTerminal();

        this.status = SAGA_STATUS.WAITING;

        this.setMetadata(
            "waitingReason",
            reason
        );

        this.touch();

        this.recordHistory(
            "SAGA_WAITING",
            { reason }
        );

        return this;
    }

    complete(output = {}) {
        this.assertNotTerminal();

        this.status = SAGA_STATUS.COMPLETED;

        this.output =
            cloneValue(output);

        this.completedAt =
            new Date();

        this.touch();

        this.recordHistory(
            "SAGA_COMPLETED"
        );

        return this;
    }

    fail(error) {
        this.status = SAGA_STATUS.FAILED;

        this.error =
            this.normalizeError(error);

        this.errors.push(
            cloneValue(this.error)
        );

        this.completedAt =
            new Date();

        this.touch();

        this.recordHistory(
            "SAGA_FAILED",
            {
                error: this.error
            }
        );

        return this;
    }

    cancel(reason = null) {
        this.status =
            SAGA_STATUS.CANCELLED;

        this.error = reason
            ? this.normalizeError(
                  reason
              )
            : null;

        this.completedAt =
            new Date();

        this.touch();

        this.recordHistory(
            "SAGA_CANCELLED",
            { reason }
        );

        return this;
    }

    timeout(reason = "Saga deadline exceeded") {
        this.status =
            SAGA_STATUS.TIMED_OUT;

        this.error =
            this.normalizeError(
                new Error(reason)
            );

        this.completedAt =
            new Date();

        this.touch();

        this.recordHistory(
            "SAGA_TIMED_OUT",
            { reason }
        );

        return this;
    }

    beginCompensation() {
        this.status =
            SAGA_STATUS.COMPENSATING;

        this.compensation.required =
            true;

        this.compensation.status =
            COMPENSATION_STATUS.RUNNING;

        this.touch();

        this.recordHistory(
            "COMPENSATION_STARTED"
        );

        return this;
    }

    completeCompensation() {
        this.compensation.status =
            COMPENSATION_STATUS.COMPLETED;

        this.status =
            SAGA_STATUS.COMPENSATED;

        this.completedAt =
            new Date();

        this.touch();

        this.recordHistory(
            "COMPENSATION_COMPLETED"
        );

        return this;
    }

    failCompensation(error) {
        this.compensation.status =
            COMPENSATION_STATUS.FAILED;

        this.error =
            this.normalizeError(error);

        this.errors.push(
            cloneValue(this.error)
        );

        this.status =
            SAGA_STATUS.FAILED;

        this.completedAt =
            new Date();

        this.touch();

        this.recordHistory(
            "COMPENSATION_FAILED",
            {
                error: this.error
            }
        );

        return this;
    }

    /**
     * =========================================================================
     * STEP MANAGEMENT
     * =========================================================================
     */

    normalizeStep(step = {}) {
        return {
            stepId:
                step.stepId ||
                generateId("step"),

            name:
                step.name ||
                null,

            status:
                step.status ||
                STEP_STATUS.PENDING,

            index:
                Number.isInteger(step.index)
                    ? step.index
                    : this.steps
                        ? this.steps.length
                        : 0,

            attempts:
                nonNegativeNumber(
                    step.attempts,
                    0
                ),

            maxAttempts:
                positiveInteger(
                    step.maxAttempts,
                    this.retry.maxAttempts
                ),

            startedAt:
                step.startedAt
                    ? toDate(step.startedAt)
                    : null,

            completedAt:
                step.completedAt
                    ? toDate(step.completedAt)
                    : null,

            lastAttemptAt:
                step.lastAttemptAt
                    ? toDate(step.lastAttemptAt)
                    : null,

            timeoutMs:
                positiveInteger(
                    step.timeoutMs,
                    this.timeoutMs
                ),

            input:
                cloneValue(step.input || {}),

            output:
                cloneValue(step.output || {}),

            compensation:
                cloneValue(
                    step.compensation || {
                        required: false,
                        status:
                            COMPENSATION_STATUS.PENDING
                    }
                ),

            error:
                step.error
                    ? this.normalizeError(
                          step.error
                      )
                    : null,

            metadata:
                cloneValue(
                    step.metadata || {}
                )
        };
    }

    addStep(name, options = {}) {
        if (this.steps.length >= this.limits.maxSteps) {
            throw new Error(
                `Saga step limit exceeded: ${this.limits.maxSteps}`
            );
        }

        const step = this.normalizeStep({
            ...options,
            name,
            index: this.steps.length
        });

        this.steps.push(step);

        this.totalSteps =
            this.steps.length;

        this.touch();

        this.recordHistory(
            "STEP_REGISTERED",
            {
                stepId: step.stepId,
                name: step.name
            }
        );

        return step;
    }

    getStep(stepIdOrName) {
        return (
            this.steps.find(
                (step) =>
                    step.stepId ===
                        stepIdOrName ||
                    step.name ===
                        stepIdOrName
            ) || null
        );
    }

    startStep(stepIdOrName) {
        const step =
            this.getStep(stepIdOrName);

        if (!step) {
            throw new Error(
                `Saga step not found: ${stepIdOrName}`
            );
        }

        if (
            step.status ===
            STEP_STATUS.COMPLETED
        ) {
            return step;
        }

        step.status =
            STEP_STATUS.RUNNING;

        step.attempts += 1;

        step.startedAt =
            step.startedAt ||
            new Date();

        step.lastAttemptAt =
            new Date();

        this.currentStep =
            step.stepId;

        this.stepIndex =
            step.index;

        this.status =
            SAGA_STATUS.RUNNING;

        this.touch();

        this.recordHistory(
            "STEP_STARTED",
            {
                stepId: step.stepId,
                name: step.name,
                attempt: step.attempts
            }
        );

        return step;
    }

    completeStep(
        stepIdOrName,
        output = {}
    ) {
        const step =
            this.getStep(stepIdOrName);

        if (!step) {
            throw new Error(
                `Saga step not found: ${stepIdOrName}`
            );
        }

        step.status =
            STEP_STATUS.COMPLETED;

        step.output =
            cloneValue(output);

        step.completedAt =
            new Date();

        step.error = null;

        this.touch();

        this.recordHistory(
            "STEP_COMPLETED",
            {
                stepId: step.stepId,
                name: step.name
            }
        );

        return step;
    }

    failStep(
        stepIdOrName,
        error
    ) {
        const step =
            this.getStep(stepIdOrName);

        if (!step) {
            throw new Error(
                `Saga step not found: ${stepIdOrName}`
            );
        }

        step.status =
            STEP_STATUS.FAILED;

        step.error =
            this.normalizeError(error);

        step.lastAttemptAt =
            new Date();

        this.errors.push(
            cloneValue(step.error)
        );

        this.touch();

        this.recordHistory(
            "STEP_FAILED",
            {
                stepId: step.stepId,
                name: step.name,
                error: step.error
            }
        );

        return step;
    }

    skipStep(
        stepIdOrName,
        reason = null
    ) {
        const step =
            this.getStep(stepIdOrName);

        if (!step) {
            throw new Error(
                `Saga step not found: ${stepIdOrName}`
            );
        }

        step.status =
            STEP_STATUS.SKIPPED;

        step.metadata.skipReason =
            reason;

        this.touch();

        this.recordHistory(
            "STEP_SKIPPED",
            {
                stepId: step.stepId,
                reason
            }
        );

        return step;
    }

    /**
     * =========================================================================
     * COMPENSATION STEP MANAGEMENT
     * =========================================================================
     */

    markStepCompensating(stepIdOrName) {
        const step =
            this.getStep(stepIdOrName);

        if (!step) {
            throw new Error(
                `Saga step not found: ${stepIdOrName}`
            );
        }

        step.status =
            STEP_STATUS.COMPENSATING;

        this.compensation.currentStep =
            step.stepId;

        this.compensation.required =
            true;

        this.touch();

        this.recordHistory(
            "STEP_COMPENSATION_STARTED",
            {
                stepId: step.stepId
            }
        );

        return step;
    }

    markStepCompensated(stepIdOrName) {
        const step =
            this.getStep(stepIdOrName);

        if (!step) {
            throw new Error(
                `Saga step not found: ${stepIdOrName}`
            );
        }

        step.status =
            STEP_STATUS.COMPENSATED;

        if (
            !this.compensation.completedSteps.includes(
                step.stepId
            )
        ) {
            this.compensation.completedSteps.push(
                step.stepId
            );
        }

        this.touch();

        this.recordHistory(
            "STEP_COMPENSATED",
            {
                stepId: step.stepId
            }
        );

        return step;
    }

    markStepCompensationFailed(
        stepIdOrName,
        error
    ) {
        const step =
            this.getStep(stepIdOrName);

        if (!step) {
            throw new Error(
                `Saga step not found: ${stepIdOrName}`
            );
        }

        step.error =
            this.normalizeError(error);

        if (
            !this.compensation.failedSteps.includes(
                step.stepId
            )
        ) {
            this.compensation.failedSteps.push(
                step.stepId
            );
        }

        this.touch();

        this.recordHistory(
            "STEP_COMPENSENSATION_FAILED",
            {
                stepId: step.stepId,
                error: step.error
            }
        );

        return step;
    }

    /**
     * =========================================================================
     * RETRY MANAGEMENT
     * =========================================================================
     */

    canRetry(step = null) {
        const target =
            step ||
            this.getStep(
                this.currentStep
            );

        if (target) {
            return (
                target.attempts <
                target.maxAttempts
            );
        }

        return (
            this.retry.attempt <
            this.retry.maxAttempts
        );
    }

    registerRetry(delayMs = 0) {
        this.retry.attempt += 1;

        this.retry.lastAttemptAt =
            new Date();

        this.retry.nextRetryAt =
            delayMs > 0
                ? new Date(
                      Date.now() +
                          delayMs
                  )
                : new Date();

        this.touch();

        this.recordHistory(
            "SAGA_RETRY_SCHEDULED",
            {
                attempt:
                    this.retry.attempt,

                maxAttempts:
                    this.retry.maxAttempts,

                delayMs
            }
        );

        return this.retry;
    }

    /**
     * =========================================================================
     * TIMEOUT / DEADLINE
     * =========================================================================
     */

    isExpired(now = new Date()) {
        return (
            toDate(now).getTime() >=
            this.deadline.getTime()
        );
    }

    getRemainingTimeMs(
        now = new Date()
    ) {
        return Math.max(
            0,
            this.deadline.getTime() -
                toDate(now).getTime()
        );
    }

    assertWithinDeadline(
        now = new Date()
    ) {
        if (this.isExpired(now)) {
            throw new Error(
                "Saga execution deadline exceeded"
            );
        }

        return true;
    }

    /**
     * =========================================================================
     * STATE / METADATA
     * =========================================================================
     */

    setState(key, value) {
        if (!key) {
            throw new Error(
                "State key is required"
            );
        }

        this.state[key] =
            cloneValue(value);

        this.touch();

        return this;
    }

    getState(key, fallback = null) {
        if (
            Object.prototype.hasOwnProperty.call(
                this.state,
                key
            )
        ) {
            return cloneValue(
                this.state[key]
            );
        }

        return fallback;
    }

    deleteState(key) {
        delete this.state[key];

        this.touch();

        return this;
    }

    setMetadata(key, value) {
        if (!key) {
            throw new Error(
                "Metadata key is required"
            );
        }

        const existingKeys =
            Object.keys(
                this.metadata
            );

        if (
            !Object.prototype.hasOwnProperty.call(
                this.metadata,
                key
            ) &&
            existingKeys.length >=
                this.limits.maxMetadataKeys
        ) {
            throw new Error(
                `Saga metadata limit exceeded: ${this.limits.maxMetadataKeys}`
            );
        }

        this.metadata[key] =
            cloneValue(value);

        this.touch();

        return this;
    }

    getMetadata(
        key,
        fallback = null
    ) {
        if (
            Object.prototype.hasOwnProperty.call(
                this.metadata,
                key
            )
        ) {
            return cloneValue(
                this.metadata[key]
            );
        }

        return fallback;
    }

    /**
     * =========================================================================
     * HISTORY / AUDIT CORRELATION
     * =========================================================================
     */

    normalizeHistoryEntry(
        entry = {}
    ) {
        return {
            eventId:
                entry.eventId ||
                generateId("event"),

            type:
                entry.type ||
                "UNKNOWN",

            timestamp:
                entry.timestamp
                    ? toDate(
                          entry.timestamp
                      )
                    : new Date(),

            sagaId:
                entry.sagaId ||
                this.sagaId,

            executionId:
                entry.executionId ||
                this.executionId,

            correlationId:
                entry.correlationId ||
                this.correlationId,

            causationId:
                entry.causationId ||
                this.causationId,

            stepId:
                entry.stepId ||
                null,

            actor:
                cloneValue(
                    entry.actor ||
                    this.actor
                ),

            data:
                cloneValue(
                    entry.data || {}
                )
        };
    }

    recordHistory(
        type,
        data = {}
    ) {
        const entry =
            this.normalizeHistoryEntry({
                type,
                data
            });

        this.history.push(entry);

        if (
            this.history.length >
            this.limits.maxHistoryEntries
        ) {
            this.history =
                this.history.slice(
                    -this
                        .limits
                        .maxHistoryEntries
                );
        }

        return entry;
    }

    /**
     * =========================================================================
     * ERROR MANAGEMENT
     * =========================================================================
     */

    normalizeError(error) {
        if (!error) {
            return {
                name: "UnknownError",
                message: "Unknown error",
                code: null,
                stack: null,
                retryable: false,
                timestamp: new Date()
            };
        }

        if (typeof error === "string") {
            return {
                name: "Error",
                message: error,
                code: null,
                stack: null,
                retryable: false,
                timestamp: new Date()
            };
        }

        return {
            name:
                error.name ||
                "Error",

            message:
                error.message ||
                String(error),

            code:
                error.code ||
                null,

            stack:
                error.stack ||
                null,

            retryable:
                Boolean(
                    error.retryable
                ),

            statusCode:
                Number.isInteger(
                    error.statusCode
                )
                    ? error.statusCode
                    : null,

            timestamp:
                error.timestamp
                    ? toDate(
                          error.timestamp
                      )
                    : new Date()
        };
    }

    /**
     * =========================================================================
     * STATUS / VALIDATION
     * =========================================================================
     */

    isTerminal() {
        return TERMINAL_SAGA_STATES.has(
            this.status
        );
    }

    assertNotTerminal() {
        if (this.isTerminal()) {
            throw new Error(
                `Saga is already in terminal state: ${this.status}`
            );
        }

        return true;
    }

    validate() {
        const errors = [];

        if (!this.sagaId) {
            errors.push(
                "sagaId is required"
            );
        }

        if (!this.executionId) {
            errors.push(
                "executionId is required"
            );
        }

        if (!this.correlationId) {
            errors.push(
                "correlationId is required"
            );
        }

        if (!this.status) {
            errors.push(
                "status is required"
            );
        }

        if (
            this.deadline.getTime() <
            this.createdAt.getTime()
        ) {
            errors.push(
                "deadline cannot be before createdAt"
            );
        }

        if (
            this.steps.length >
            this.limits.maxSteps
        ) {
            errors.push(
                "maximum step count exceeded"
            );
        }

        if (
            !Object.values(
                SAGA_STATUS
            ).includes(this.status)
        ) {
            errors.push(
                `Invalid saga status: ${this.status}`
            );
        }

        return {
            valid:
                errors.length === 0,
            errors
        };
    }

    assertValid() {
        const result =
            this.validate();

        if (!result.valid) {
            const error =
                new Error(
                    `Invalid SagaContext: ${result.errors.join(
                        "; "
                    )}`
                );

            error.code =
                "INVALID_SAGA_CONTEXT";

            error.validationErrors =
                result.errors;

            throw error;
        }

        return true;
    }

    /**
     * =========================================================================
     * SERIALIZATION
     * =========================================================================
     */

    /**
     * Return complete internal representation.
     *
     * Suitable for persistence by a repository layer.
     *
     * @returns {Object}
     */
    toJSON() {
        return {
            version: this.version,

            sagaId: this.sagaId,
            executionId:
                this.executionId,
            correlationId:
                this.correlationId,
            causationId:
                this.causationId,

            parentSagaId:
                this.parentSagaId,
            parentExecutionId:
                this.parentExecutionId,

            idempotencyKey:
                this.idempotencyKey,

            tenantId:
                this.tenantId,

            actor:
                cloneValue(this.actor),

            request:
                cloneValue(this.request),

            status:
                this.status,

            currentStep:
                this.currentStep,

            stepIndex:
                this.stepIndex,

            totalSteps:
                this.totalSteps,

            createdAt:
                new Date(
                    this.createdAt
                ),

            startedAt:
                this.startedAt
                    ? new Date(
                          this.startedAt
                      )
                    : null,

            completedAt:
                this.completedAt
                    ? new Date(
                          this.completedAt
                      )
                    : null,

            updatedAt:
                new Date(
                    this.updatedAt
                ),

            timeoutMs:
                this.timeoutMs,

            deadline:
                new Date(
                    this.deadline
                ),

            retry:
                cloneValue(this.retry),

            input:
                cloneValue(this.input),

            output:
                cloneValue(this.output),

            state:
                cloneValue(this.state),

            metadata:
                cloneValue(this.metadata),

            steps:
                cloneValue(this.steps),

            compensation:
                cloneValue(
                    this.compensation
                ),

            error:
                cloneValue(this.error),

            errors:
                cloneValue(this.errors),

            history:
                cloneValue(this.history),

            limits:
                cloneValue(this.limits)
        };
    }

    /**
     * Safe representation for logs, events, telemetry and audit systems.
     *
     * Secrets are redacted and large internal execution data is not exposed
     * unnecessarily.
     *
     * @returns {Object}
     */
    toSafeJSON() {
        return sanitizeValue({
            version: this.version,

            sagaId: this.sagaId,
            executionId:
                this.executionId,
            correlationId:
                this.correlationId,
            causationId:
                this.causationId,

            parentSagaId:
                this.parentSagaId,
            parentExecutionId:
                this.parentExecutionId,

            idempotencyKey:
                this.idempotencyKey,

            tenantId:
                this.tenantId,

            actor:
                this.actor,

            request:
                this.request,

            status:
                this.status,

            currentStep:
                this.currentStep,

            stepIndex:
                this.stepIndex,

            totalSteps:
                this.totalSteps,

            createdAt:
                this.createdAt,

            startedAt:
                this.startedAt,

            completedAt:
                this.completedAt,

            updatedAt:
                this.updatedAt,

            deadline:
                this.deadline,

            retry:
                this.retry,

            compensation:
                this.compensation,

            error:
                this.error,

            steps:
                this.steps.map(
                    (step) => ({
                        stepId:
                            step.stepId,

                        name:
                            step.name,

                        status:
                            step.status,

                        index:
                            step.index,

                        attempts:
                            step.attempts,

                        maxAttempts:
                            step.maxAttempts,

                        startedAt:
                            step.startedAt,

                        completedAt:
                            step.completedAt,

                        error:
                            step.error,

                        metadata:
                            step.metadata
                    })
                ),

            metadata:
                this.metadata
        });
    }

    /**
     * Deep clone this context.
     *
     * @returns {SagaContext}
     */
    clone() {
        return SagaContext.fromJSON(
            this.toJSON()
        );
    }

    /**
     * =========================================================================
     * EXECUTION SUMMARY
     * =========================================================================
     */

    getSummary() {
        const completedSteps =
            this.steps.filter(
                (step) =>
                    step.status ===
                    STEP_STATUS.COMPLETED
            ).length;

        const failedSteps =
            this.steps.filter(
                (step) =>
                    step.status ===
                    STEP_STATUS.FAILED
            ).length;

        const compensatedSteps =
            this.steps.filter(
                (step) =>
                    step.status ===
                    STEP_STATUS.COMPENSATED
            ).length;

        return {
            sagaId:
                this.sagaId,

            executionId:
                this.executionId,

            correlationId:
                this.correlationId,

            tenantId:
                this.tenantId,

            status:
                this.status,

            currentStep:
                this.currentStep,

            stepIndex:
                this.stepIndex,

            totalSteps:
                this.steps.length,

            completedSteps,
            failedSteps,
            compensatedSteps,

            compensationRequired:
                this.compensation.required,

            compensationStatus:
                this.compensation.status,

            retryAttempt:
                this.retry.attempt,

            maxRetryAttempts:
                this.retry.maxAttempts,

            isTerminal:
                this.isTerminal(),

            isExpired:
                this.isExpired(),

            remainingTimeMs:
                this.getRemainingTimeMs(),

            createdAt:
                this.createdAt.toISOString(),

            startedAt:
                this.startedAt
                    ? this.startedAt.toISOString()
                    : null,

            completedAt:
                this.completedAt
                    ? this.completedAt.toISOString()
                    : null,

            updatedAt:
                this.updatedAt.toISOString()
        };
    }

    /**
     * =========================================================================
     * TIMESTAMP MANAGEMENT
     * =========================================================================
     */

    touch() {
        this.updatedAt =
            new Date();

        return this;
    }
}

/**
 * ============================================================================
 * STATIC EXPORTS
 * ============================================================================
 */

SagaContext.STATUS =
    SAGA_STATUS;

SagaContext.SAGA_STATUS =
    SAGA_STATUS;

SagaContext.STEP_STATUS =
    STEP_STATUS;

SagaContext.COMPENSATION_STATUS =
    COMPENSATION_STATUS;

/**
 * ============================================================================
 * MODULE EXPORT
 * ============================================================================
 */

module.exports = SagaContext;