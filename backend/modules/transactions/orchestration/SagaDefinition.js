"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Transaction Orchestration - Saga Definition
 * ============================================================================
 *
 * File:
 * backend/modules/transactions/orchestration/SagaDefinition.js
 *
 * Enterprise Saga Definition Contract
 * ============================================================================
 *
 * Purpose
 * -------
 * SagaDefinition describes HOW a distributed transaction saga is structured.
 *
 * It does NOT execute saga steps.
 * It does NOT perform database writes.
 * It does NOT manage transactions.
 * It does NOT perform compensation.
 *
 * Execution responsibilities belong to:
 *
 *   - SagaContext
 *   - LifecycleManager
 *   - CompensationOrchestrator
 *   - ConsistencyValidator
 *   - AuditCorrelationManager
 *   - Transaction/Saga execution engine
 *
 * ============================================================================
 *
 * Design Goals
 * ------------
 *
 * - Immutable saga definitions
 * - Deterministic execution ordering
 * - Explicit compensation semantics
 * - Retry and timeout policies
 * - Idempotency support
 * - Dependency declaration
 * - Lifecycle hooks
 * - Strong validation
 * - Definition fingerprinting
 * - Safe serialization
 * - Enterprise observability compatibility
 * - Multi-tenant transaction compatibility
 *
 * ============================================================================
 */

const crypto = require("crypto");

/**
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

const DEFAULT_VERSION = "1.0.0";

const DEFAULT_TIMEOUT_MS = 30_000;

const DEFAULT_RETRY_POLICY = Object.freeze({
    enabled: true,
    maxAttempts: 3,
    initialDelayMs: 250,
    maxDelayMs: 5_000,
    backoffMultiplier: 2,
    jitter: true,
});

const DEFAULT_IDEMPOTENCY_POLICY = Object.freeze({
    enabled: true,
    required: true,
    scope: "SAGA",
});

const DEFAULT_STEP_OPTIONS = Object.freeze({
    timeoutMs: DEFAULT_TIMEOUT_MS,
    critical: true,
    retryable: true,
    compensatable: true,
    continueOnFailure: false,
});

const VALID_IDEMPOTENCY_SCOPES = new Set([
    "SAGA",
    "STEP",
    "TENANT",
    "GLOBAL",
]);

const VALID_HOOKS = new Set([
    "beforeSaga",
    "afterSaga",
    "onSuccess",
    "onFailure",
    "onCompensation",
    "onStepStart",
    "onStepSuccess",
    "onStepFailure",
    "onStepCompensation",
]);

/**
 * ============================================================================
 * UTILITY FUNCTIONS
 * ============================================================================
 */

/**
 * Check whether a value is a plain object.
 */
function isPlainObject(value) {
    if (value === null || typeof value !== "object") {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);

    return prototype === Object.prototype || prototype === null;
}

/**
 * Clone an object while preventing callers from mutating internal state.
 *
 * JSON cloning is intentionally avoided because saga definitions may contain
 * functions in execution handlers.
 */
function cloneValue(value, seen = new WeakMap()) {
    if (value === null || typeof value !== "object") {
        return value;
    }

    if (typeof value === "function") {
        return value;
    }

    if (value instanceof Date) {
        return new Date(value.getTime());
    }

    if (Buffer.isBuffer(value)) {
        return Buffer.from(value);
    }

    if (seen.has(value)) {
        return seen.get(value);
    }

    if (Array.isArray(value)) {
        const result = [];

        seen.set(value, result);

        for (const item of value) {
            result.push(cloneValue(item, seen));
        }

        return result;
    }

    const result = {};

    seen.set(value, result);

    for (const [key, child] of Object.entries(value)) {
        result[key] = cloneValue(child, seen);
    }

    return result;
}

/**
 * Deep-freeze a definition.
 *
 * Functions are intentionally left untouched because freezing functions
 * themselves can produce unexpected behaviour for consumers.
 */
function deepFreeze(value, seen = new WeakSet()) {
    if (
        value === null ||
        typeof value !== "object" ||
        seen.has(value)
    ) {
        return value;
    }

    seen.add(value);

    for (const child of Object.values(value)) {
        deepFreeze(child, seen);
    }

    return Object.freeze(value);
}

/**
 * Remove executable functions from an object so it can be deterministically
 * serialized and fingerprinted.
 */
function sanitizeForFingerprint(value, seen = new WeakMap()) {
    if (value === null || value === undefined) {
        return value;
    }

    if (typeof value === "function") {
        return "[Function]";
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
        return value.toString("base64");
    }

    if (typeof value !== "object") {
        return String(value);
    }

    if (seen.has(value)) {
        return "[Circular]";
    }

    if (Array.isArray(value)) {
        const result = [];

        seen.set(value, result);

        for (const item of value) {
            result.push(
                sanitizeForFingerprint(item, seen)
            );
        }

        return result;
    }

    const result = {};

    seen.set(value, result);

    for (const key of Object.keys(value).sort()) {
        result[key] = sanitizeForFingerprint(
            value[key],
            seen
        );
    }

    return result;
}

/**
 * Stable JSON serialization.
 */
function stableStringify(value) {
    return JSON.stringify(
        sanitizeForFingerprint(value)
    );
}

/**
 * Generate deterministic SHA-256 fingerprint.
 */
function generateFingerprint(definition) {
    return crypto
        .createHash("sha256")
        .update(stableStringify(definition))
        .digest("hex");
}

/**
 * Validate a non-empty string.
 */
function assertNonEmptyString(value, fieldName) {
    if (
        typeof value !== "string" ||
        value.trim().length === 0
    ) {
        throw new TypeError(
            `${fieldName} must be a non-empty string`
        );
    }
}

/**
 * Validate positive integer.
 */
function assertPositiveInteger(value, fieldName) {
    if (
        !Number.isInteger(value) ||
        value <= 0
    ) {
        throw new TypeError(
            `${fieldName} must be a positive integer`
        );
    }
}

/**
 * Normalize retry configuration.
 */
function normalizeRetryPolicy(policy = {}) {
    if (!isPlainObject(policy)) {
        throw new TypeError(
            "retryPolicy must be a plain object"
        );
    }

    const normalized = {
        ...DEFAULT_RETRY_POLICY,
        ...policy,
    };

    if (
        typeof normalized.enabled !== "boolean"
    ) {
        throw new TypeError(
            "retryPolicy.enabled must be boolean"
        );
    }

    assertPositiveInteger(
        normalized.maxAttempts,
        "retryPolicy.maxAttempts"
    );

    assertPositiveInteger(
        normalized.initialDelayMs,
        "retryPolicy.initialDelayMs"
    );

    assertPositiveInteger(
        normalized.maxDelayMs,
        "retryPolicy.maxDelayMs"
    );

    if (
        typeof normalized.backoffMultiplier !== "number" ||
        normalized.backoffMultiplier < 1
    ) {
        throw new TypeError(
            "retryPolicy.backoffMultiplier must be >= 1"
        );
    }

    if (
        typeof normalized.jitter !== "boolean"
    ) {
        throw new TypeError(
            "retryPolicy.jitter must be boolean"
        );
    }

    if (
        normalized.maxDelayMs <
        normalized.initialDelayMs
    ) {
        throw new TypeError(
            "retryPolicy.maxDelayMs must be >= initialDelayMs"
        );
    }

    return normalized;
}

/**
 * Normalize idempotency policy.
 */
function normalizeIdempotencyPolicy(policy = {}) {
    if (!isPlainObject(policy)) {
        throw new TypeError(
            "idempotencyPolicy must be a plain object"
        );
    }

    const normalized = {
        ...DEFAULT_IDEMPOTENCY_POLICY,
        ...policy,
    };

    if (
        typeof normalized.enabled !== "boolean"
    ) {
        throw new TypeError(
            "idempotencyPolicy.enabled must be boolean"
        );
    }

    if (
        typeof normalized.required !== "boolean"
    ) {
        throw new TypeError(
            "idempotencyPolicy.required must be boolean"
        );
    }

    if (
        !VALID_IDEMPOTENCY_SCOPES.has(
            normalized.scope
        )
    ) {
        throw new TypeError(
            `Invalid idempotency scope: ${normalized.scope}`
        );
    }

    return normalized;
}

/**
 * ============================================================================
 * SAGA DEFINITION
 * ============================================================================
 */

class SagaDefinition {
    /**
     * Create a new Saga definition.
     *
     * @param {Object} options
     */
    constructor(options = {}) {
        if (!isPlainObject(options)) {
            throw new TypeError(
                "SagaDefinition options must be a plain object"
            );
        }

        const {
            name,
            version = DEFAULT_VERSION,
            description = "",
            category = "TRANSACTION",
            metadata = {},
            options: definitionOptions = {},
        } = options;

        assertNonEmptyString(name, "Saga name");
        assertNonEmptyString(version, "Saga version");

        if (!isPlainObject(metadata)) {
            throw new TypeError(
                "Saga metadata must be a plain object"
            );
        }

        if (!isPlainObject(definitionOptions)) {
            throw new TypeError(
                "Saga options must be a plain object"
            );
        }

        this._sealed = false;

        this.id = crypto.randomUUID();

        this.name = name.trim();

        this.version = version.trim();

        this.description =
            typeof description === "string"
                ? description.trim()
                : "";

        this.category =
            typeof category === "string" &&
            category.trim()
                ? category.trim()
                : "TRANSACTION";

        this.metadata = cloneValue(metadata);

        this.options = {
            timeoutMs:
                definitionOptions.timeoutMs ||
                DEFAULT_TIMEOUT_MS,

            retryPolicy:
                normalizeRetryPolicy(
                    definitionOptions.retryPolicy
                ),

            idempotencyPolicy:
                normalizeIdempotencyPolicy(
                    definitionOptions.idempotencyPolicy
                ),

            failFast:
                definitionOptions.failFast !== false,

            compensationRequired:
                definitionOptions.compensationRequired !== false,

            allowPartialCompletion:
                definitionOptions.allowPartialCompletion === true,
        };

        assertPositiveInteger(
            this.options.timeoutMs,
            "Saga timeoutMs"
        );

        this.steps = [];

        this.hooks = {
            beforeSaga: null,
            afterSaga: null,
            onSuccess: null,
            onFailure: null,
            onCompensation: null,
            onStepStart: null,
            onStepSuccess: null,
            onStepFailure: null,
            onStepCompensation: null,
        };

        this.createdAt = new Date();

        this.updatedAt = new Date();
    }

    /**
     * =========================================================================
     * STEP REGISTRATION
     * =========================================================================
     */

    /**
     * Add an executable saga step.
     *
     * @param {Object} definition
     * @returns {SagaDefinition}
     */
    addStep(definition = {}) {
        this.assertMutable();

        if (!isPlainObject(definition)) {
            throw new TypeError(
                "Saga step definition must be a plain object"
            );
        }

        const {
            name,
            execute,
            compensate = null,
            timeoutMs = this.options.timeoutMs,
            retryPolicy = this.options.retryPolicy,
            idempotencyKey = null,
            idempotencyPolicy =
                this.options.idempotencyPolicy,
            dependencies = [],
            critical =
                DEFAULT_STEP_OPTIONS.critical,
            retryable =
                DEFAULT_STEP_OPTIONS.retryable,
            compensatable =
                DEFAULT_STEP_OPTIONS.compensatable,
            continueOnFailure =
                DEFAULT_STEP_OPTIONS.continueOnFailure,
            metadata = {},
        } = definition;

        assertNonEmptyString(
            name,
            "Saga step name"
        );

        if (typeof execute !== "function") {
            throw new TypeError(
                `Saga step "${name}" requires an execute function`
            );
        }

        if (
            compensate !== null &&
            typeof compensate !== "function"
        ) {
            throw new TypeError(
                `Saga step "${name}" compensate must be a function`
            );
        }

        if (
            this.hasStep(name)
        ) {
            throw new Error(
                `Duplicate saga step: ${name}`
            );
        }

        assertPositiveInteger(
            timeoutMs,
            `Saga step "${name}" timeoutMs`
        );

        if (!Array.isArray(dependencies)) {
            throw new TypeError(
                `Saga step "${name}" dependencies must be an array`
            );
        }

        for (const dependency of dependencies) {
            assertNonEmptyString(
                dependency,
                `Saga step "${name}" dependency`
            );
        }

        if (!isPlainObject(metadata)) {
            throw new TypeError(
                `Saga step "${name}" metadata must be a plain object`
            );
        }

        if (
            typeof critical !== "boolean" ||
            typeof retryable !== "boolean" ||
            typeof compensatable !== "boolean" ||
            typeof continueOnFailure !== "boolean"
        ) {
            throw new TypeError(
                `Saga step "${name}" boolean options are invalid`
            );
        }

        const step = {
            stepId: crypto.randomUUID(),

            name: name.trim(),

            sequence:
                this.steps.length + 1,

            execute,

            compensate,

            timeoutMs,

            retryPolicy:
                normalizeRetryPolicy(
                    retryPolicy
                ),

            idempotencyPolicy:
                normalizeIdempotencyPolicy(
                    idempotencyPolicy
                ),

            idempotencyKey,

            dependencies: [
                ...new Set(
                    dependencies.map((item) =>
                        item.trim()
                    )
                ),
            ],

            critical,

            retryable,

            compensatable:

                compensate !== null &&
                compensatable,

            continueOnFailure,

            metadata:
                cloneValue(metadata),

            registeredAt: new Date(),
        };

        this.steps.push(step);

        this.updatedAt = new Date();

        return this;
    }

    /**
     * Backward-friendly alias.
     */
    defineStep(definition) {
        return this.addStep(definition);
    }

    /**
     * =========================================================================
     * COMPENSATION REGISTRATION
     * =========================================================================
     */

    /**
     * Attach compensation to an existing step.
     */
    addCompensation(stepName, compensate) {
        this.assertMutable();

        assertNonEmptyString(
            stepName,
            "Step name"
        );

        if (typeof compensate !== "function") {
            throw new TypeError(
                "Compensation handler must be a function"
            );
        }

        const step = this.getStep(stepName);

        if (!step) {
            throw new Error(
                `Cannot add compensation. Unknown step: ${stepName}`
            );
        }

        step.compensate = compensate;
        step.compensatable = true;

        this.updatedAt = new Date();

        return this;
    }

    /**
     * =========================================================================
     * HOOKS
     * =========================================================================
     */

    /**
     * Register lifecycle hook.
     */
    addHook(name, handler) {
        this.assertMutable();

        if (!VALID_HOOKS.has(name)) {
            throw new Error(
                `Unsupported saga hook: ${name}`
            );
        }

        if (
            handler !== null &&
            typeof handler !== "function"
        ) {
            throw new TypeError(
                `Saga hook "${name}" must be a function`
            );
        }

        this.hooks[name] = handler;

        this.updatedAt = new Date();

        return this;
    }

    /**
     * Convenience hook methods.
     */

    beforeSaga(handler) {
        return this.addHook(
            "beforeSaga",
            handler
        );
    }

    afterSaga(handler) {
        return this.addHook(
            "afterSaga",
            handler
        );
    }

    onSuccess(handler) {
        return this.addHook(
            "onSuccess",
            handler
        );
    }

    onFailure(handler) {
        return this.addHook(
            "onFailure",
            handler
        );
    }

    onCompensation(handler) {
        return this.addHook(
            "onCompensation",
            handler
        );
    }

    onStepStart(handler) {
        return this.addHook(
            "onStepStart",
            handler
        );
    }

    onStepSuccess(handler) {
        return this.addHook(
            "onStepSuccess",
            handler
        );
    }

    onStepFailure(handler) {
        return this.addHook(
            "onStepFailure",
            handler
        );
    }

    onStepCompensation(handler) {
        return this.addHook(
            "onStepCompensation",
            handler
        );
    }

    /**
     * =========================================================================
     * STEP LOOKUPS
     * =========================================================================
     */

    hasStep(stepName) {
        return this.steps.some(
            (step) => step.name === stepName
        );
    }

    getStep(stepName) {
        return (
            this.steps.find(
                (step) =>
                    step.name === stepName
            ) || null
        );
    }

    getStepById(stepId) {
        return (
            this.steps.find(
                (step) =>
                    step.stepId === stepId
            ) || null
        );
    }

    getStepNames() {
        return this.steps.map(
            (step) => step.name
        );
    }

    getCompensatableSteps() {
        return this.steps.filter(
            (step) =>
                step.compensatable &&
                typeof step.compensate ===
                    "function"
        );
    }

    /**
     * =========================================================================
     * VALIDATION
     * =========================================================================
     */

    /**
     * Validate the complete saga definition.
     *
     * This method should be called before the definition is registered with
     * the orchestration engine.
     */
    validate() {
        const errors = [];

        if (
            !this.name ||
            typeof this.name !== "string"
        ) {
            errors.push(
                "Saga name is required"
            );
        }

        if (
            !this.version ||
            typeof this.version !== "string"
        ) {
            errors.push(
                "Saga version is required"
            );
        }

        if (
            !Array.isArray(this.steps) ||
            this.steps.length === 0
        ) {
            errors.push(
                "Saga must contain at least one step"
            );
        }

        const stepNames = new Set();

        for (const step of this.steps) {
            if (stepNames.has(step.name)) {
                errors.push(
                    `Duplicate step: ${step.name}`
                );
            }

            stepNames.add(step.name);

            if (
                typeof step.execute !==
                "function"
            ) {
                errors.push(
                    `Step "${step.name}" has no execute handler`
                );
            }

            if (
                step.compensatable &&
                typeof step.compensate !==
                    "function"
            ) {
                errors.push(
                    `Step "${step.name}" is compensatable but has no compensation handler`
                );
            }

            for (
                const dependency of
                    step.dependencies
            ) {
                if (
                    !stepNames.has(
                        dependency
                    ) &&
                    !this.hasStep(
                        dependency
                    )
                ) {
                    errors.push(
                        `Step "${step.name}" depends on unknown step "${dependency}"`
                    );
                }
            }
        }

        /**
         * Compensation requirement.
         */
        if (
            this.options
                .compensationRequired
        ) {
            const uncompensatedCriticalSteps =
                this.steps.filter(
                    (step) =>
                        step.critical &&
                        step.compensatable !==
                            true
                );

            /**
             * A saga can legitimately contain an irreversible step.
             * We therefore do not fail validation merely because every
             * critical step lacks compensation.
             *
             * Instead, the metadata is exposed for the orchestration engine.
             */
            if (
                uncompensatedCriticalSteps.length >
                0
            ) {
                this.metadata = {
                    ...this.metadata,
                    hasUncompensatedCriticalSteps:
                        true,
                };
            }
        }

        /**
         * Dependency cycle detection.
         */
        const cycle = this.detectDependencyCycle();

        if (cycle) {
            errors.push(
                `Circular step dependency detected: ${cycle.join(
                    " -> "
                )}`
            );
        }

        if (errors.length > 0) {
            const error = new Error(
                `Invalid saga definition "${this.name}": ${errors.join(
                    "; "
                )}`
            );

            error.code =
                "INVALID_SAGA_DEFINITION";

            error.errors = errors;

            throw error;
        }

        return true;
    }

    /**
     * =========================================================================
     * DEPENDENCY VALIDATION
     * =========================================================================
     */

    /**
     * Detect circular dependencies.
     */
    detectDependencyCycle() {
        const graph = new Map();

        for (const step of this.steps) {
            graph.set(
                step.name,
                step.dependencies || []
            );
        }

        const visiting = new Set();
        const visited = new Set();
        const path = [];

        const visit = (node) => {
            if (visiting.has(node)) {
                const index =
                    path.indexOf(node);

                return path.slice(
                    index >= 0 ? index : 0
                ).concat(node);
            }

            if (visited.has(node)) {
                return null;
            }

            visiting.add(node);
            path.push(node);

            for (
                const dependency of
                    graph.get(node) || []
            ) {
                const cycle =
                    visit(dependency);

                if (cycle) {
                    return cycle;
                }
            }

            path.pop();
            visiting.delete(node);
            visited.add(node);

            return null;
        };

        for (const node of graph.keys()) {
            const cycle = visit(node);

            if (cycle) {
                return cycle;
            }
        }

        return null;
    }

    /**
     * =========================================================================
     * EXECUTION PLAN
     * =========================================================================
     */

    /**
     * Return steps in deterministic dependency order.
     *
     * This uses a topological sort while preserving registration order where
     * possible.
     */
    getExecutionPlan() {
        this.validate();

        const steps = this.steps;

        const remaining = new Map();

        for (const step of steps) {
            remaining.set(
                step.name,
                new Set(
                    step.dependencies
                )
            );
        }

        const plan = [];

        const unresolved = new Set(
            steps.map(
                (step) => step.name
            )
        );

        while (unresolved.size > 0) {
            let progress = false;

            for (const step of steps) {
                if (
                    !unresolved.has(
                        step.name
                    )
                ) {
                    continue;
                }

                const dependencies =
                    remaining.get(
                        step.name
                    );

                const satisfied =
                    [...dependencies].every(
                        (dependency) =>
                            !unresolved.has(
                                dependency
                            )
                    );

                if (!satisfied) {
                    continue;
                }

                plan.push(step);

                unresolved.delete(
                    step.name
                );

                progress = true;
            }

            if (!progress) {
                throw new Error(
                    `Unable to resolve saga execution plan for "${this.name}"`
                );
            }
        }

        return plan;
    }

    /**
     * =========================================================================
     * IMMUTABILITY
     * =========================================================================
     */

    /**
     * Freeze the definition.
     *
     * Once registered with the orchestration engine, definitions should not
     * change while executions are active.
     */
    seal() {
        if (this._sealed) {
            return this;
        }

        this.validate();

        this._sealed = true;

        deepFreeze(this);

        return this;
    }

    isSealed() {
        return this._sealed;
    }

    assertMutable() {
        if (this._sealed) {
            const error = new Error(
                `Saga definition "${this.name}" is sealed and cannot be modified`
            );

            error.code =
                "SAGA_DEFINITION_SEALED";

            throw error;
        }
    }

    /**
     * =========================================================================
     * FINGERPRINT
     * =========================================================================
     */

    /**
     * Generate a deterministic definition fingerprint.
     *
     * Function bodies are represented generically so fingerprints describe
     * the structural definition rather than runtime function serialization.
     */
    getFingerprint() {
        return generateFingerprint({
            name: this.name,
            version: this.version,
            category: this.category,
            description: this.description,
            metadata: this.metadata,
            options: this.options,

            steps: this.steps.map(
                (step) => ({
                    stepId: step.stepId,
                    name: step.name,
                    sequence: step.sequence,
                    timeoutMs:
                        step.timeoutMs,
                    retryPolicy:
                        step.retryPolicy,
                    idempotencyPolicy:
                        step.idempotencyPolicy,
                    idempotencyKey:
                        step.idempotencyKey,
                    dependencies:
                        step.dependencies,
                    critical:
                        step.critical,
                    retryable:
                        step.retryable,
                    compensatable:
                        step.compensatable,
                    continueOnFailure:
                        step.continueOnFailure,
                    metadata:
                        step.metadata,
                })
            ),
        });
    }

    /**
     * =========================================================================
     * SERIALIZATION
     * =========================================================================
     */

    /**
     * Return a safe serializable representation.
     *
     * Executable handlers are intentionally omitted.
     */
    toJSON() {
        return {
            id: this.id,
            name: this.name,
            version: this.version,
            description: this.description,
            category: this.category,
            metadata: cloneValue(
                this.metadata
            ),
            options: cloneValue(
                this.options
            ),

            steps: this.steps.map(
                (step) => ({
                    stepId:
                        step.stepId,
                    name:
                        step.name,
                    sequence:
                        step.sequence,
                    timeoutMs:
                        step.timeoutMs,
                    retryPolicy:
                        cloneValue(
                            step.retryPolicy
                        ),
                    idempotencyPolicy:
                        cloneValue(
                            step.idempotencyPolicy
                        ),
                    idempotencyKey:
                        step.idempotencyKey,
                    dependencies:
                        [...step.dependencies],
                    critical:
                        step.critical,
                    retryable:
                        step.retryable,
                    compensatable:
                        step.compensatable,
                    continueOnFailure:
                        step.continueOnFailure,
                    metadata:
                        cloneValue(
                            step.metadata
                        ),
                    hasExecuteHandler:
                        typeof step.execute ===
                        "function",
                    hasCompensationHandler:
                        typeof step.compensate ===
                        "function",
                })
            ),

            hooks: Object.fromEntries(
                Object.entries(
                    this.hooks
                ).map(
                    ([name, handler]) => [
                        name,
                        typeof handler ===
                            "function",
                    ]
                )
            ),

            fingerprint:
                this.getFingerprint(),

            sealed: this._sealed,

            createdAt:
                this.createdAt instanceof Date
                    ? this.createdAt.toISOString()
                    : this.createdAt,

            updatedAt:
                this.updatedAt instanceof Date
                    ? this.updatedAt.toISOString()
                    : this.updatedAt,
        };
    }

    /**
     * =========================================================================
     * CLONING
     * =========================================================================
     */

    /**
     * Clone the definition before sealing it.
     *
     * Useful when a base saga definition is reused for a specialized flow.
     */
    clone(overrides = {}) {
        if (!isPlainObject(overrides)) {
            throw new TypeError(
                "Saga clone overrides must be a plain object"
            );
        }

        const cloned =
            new SagaDefinition({
                name:
                    overrides.name ||
                    this.name,

                version:
                    overrides.version ||
                    this.version,

                description:
                    overrides.description ??
                    this.description,

                category:
                    overrides.category ||
                    this.category,

                metadata: {
                    ...cloneValue(
                        this.metadata
                    ),
                    ...cloneValue(
                        overrides.metadata ||
                            {}
                    ),
                },

                options: {
                    ...cloneValue(
                        this.options
                    ),
                    ...cloneValue(
                        overrides.options ||
                            {}
                    ),
                },
            });

        for (const step of this.steps) {
            cloned.addStep({
                name: step.name,
                execute: step.execute,
                compensate:
                    step.compensate,
                timeoutMs:
                    step.timeoutMs,
                retryPolicy:
                    step.retryPolicy,
                idempotencyKey:
                    step.idempotencyKey,
                idempotencyPolicy:
                    step.idempotencyPolicy,
                dependencies:
                    step.dependencies,
                critical:
                    step.critical,
                retryable:
                    step.retryable,
                compensatable:
                    step.compensatable,
                continueOnFailure:
                    step.continueOnFailure,
                metadata:
                    step.metadata,
            });
        }

        for (const [
            hookName,
            handler,
        ] of Object.entries(
            this.hooks
        )) {
            if (handler) {
                cloned.addHook(
                    hookName,
                    handler
                );
            }
        }

        return cloned;
    }

    /**
     * =========================================================================
     * METADATA
     * =========================================================================
     */

    setMetadata(key, value) {
        this.assertMutable();

        assertNonEmptyString(
            key,
            "Metadata key"
        );

        this.metadata[key] =
            cloneValue(value);

        this.updatedAt = new Date();

        return this;
    }

    getMetadata(key, defaultValue = null) {
        if (
            Object.prototype.hasOwnProperty.call(
                this.metadata,
                key
            )
        ) {
            return this.metadata[key];
        }

        return defaultValue;
    }

    /**
     * =========================================================================
     * SUMMARY
     * =========================================================================
     */

    getSummary() {
        return {
            id: this.id,
            name: this.name,
            version: this.version,
            category: this.category,

            stepCount:
                this.steps.length,

            compensatableStepCount:
                this.getCompensatableSteps()
                    .length,

            sealed:
                this._sealed,

            fingerprint:
                this.getFingerprint(),

            options: cloneValue(
                this.options
            ),

            executionOrder:
                this.steps.map(
                    (step) =>
                        step.name
                ),
        };
    }
}

/**
 * ============================================================================
 * FACTORY
 * ============================================================================
 */

/**
 * Create a saga definition.
 *
 * Example:
 *
 * const definition = createSagaDefinition({
 *     name: "LoanDisbursementSaga",
 *     version: "2.0.0"
 * });
 *
 * definition
 *     .addStep({
 *         name: "validateLoan",
 *         execute: async (ctx) => {},
 *         compensate: async (ctx) => {}
 *     })
 *     .addStep({
 *         name: "postLedger",
 *         execute: async (ctx) => {},
 *         compensate: async (ctx) => {},
 *         dependencies: ["validateLoan"]
 *     })
 *     .seal();
 */
function createSagaDefinition(options = {}) {
    return new SagaDefinition(options);
}

/**
 * ============================================================================
 * STATIC HELPERS
 * ============================================================================
 */

/**
 * Check whether an object is a SagaDefinition.
 */
function isSagaDefinition(value) {
    return value instanceof SagaDefinition;
}

/**
 * Validate an existing definition.
 */
function validateSagaDefinition(definition) {
    if (!isSagaDefinition(definition)) {
        throw new TypeError(
            "Expected SagaDefinition instance"
        );
    }

    return definition.validate();
}

/**
 * ============================================================================
 * EXPORTS
 * ============================================================================
 *
 * The default export remains the class for compatibility with:
 *
 * const SagaDefinition = require("./SagaDefinition");
 *
 * Additional APIs are exposed as properties.
 * ============================================================================
 */

module.exports = SagaDefinition;

module.exports.SagaDefinition =
    SagaDefinition;

module.exports.createSagaDefinition =
    createSagaDefinition;

module.exports.isSagaDefinition =
    isSagaDefinition;

module.exports.validateSagaDefinition =
    validateSagaDefinition;

module.exports.DEFAULT_VERSION =
    DEFAULT_VERSION;

module.exports.DEFAULT_TIMEOUT_MS =
    DEFAULT_TIMEOUT_MS;

module.exports.DEFAULT_RETRY_POLICY =
    DEFAULT_RETRY_POLICY;

module.exports.DEFAULT_IDEMPOTENCY_POLICY =
    DEFAULT_IDEMPOTENCY_POLICY;