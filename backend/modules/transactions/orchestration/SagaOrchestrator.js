"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Transaction Saga Orchestrator
 * ============================================================================
 * Enterprise Distributed Transaction Orchestration Engine
 * ============================================================================
 *
 * File:
 * backend/modules/transactions/orchestration/SagaOrchestrator.js
 *
 * Purpose
 * -------
 * Coordinates long-running distributed transactions using a Saga pattern.
 *
 * Responsibilities
 * ----------------
 * - Saga execution
 * - Step orchestration
 * - Step retries
 * - Step timeouts
 * - Idempotency protection
 * - Compensation orchestration
 * - Lifecycle state management
 * - Consistency validation
 * - Audit correlation
 * - Failure isolation
 * - Structured execution results
 * - Safe recovery / resume support
 * - Cancellation support
 * - Execution metadata propagation
 *
 * Design Principles
 * -----------------
 * - No direct database balance manipulation
 * - No financial mutation outside registered saga steps
 * - Compensation is explicit
 * - Steps are executed sequentially by default
 * - Every execution has a correlation ID
 * - Every step has deterministic execution identity
 * - Failed forward execution triggers compensation
 * - Compensation failures are surfaced, never hidden
 * - Lifecycle state is authoritative
 * - Validation occurs before and after execution
 * - Service is framework independent
 *
 * Expected Collaborators
 * ----------------------
 * ./SagaContext
 * ./SagaDefinition
 * ./LifecycleManager
 * ./CompensationOrchestrator
 * ./ConsistencyValidator
 * ./AuditCorrelationManager
 *
 * ============================================================================
 */

const crypto = require("crypto");

const SagaContext = require("./SagaContext");
const SagaDefinition = require("./SagaDefinition");
const LifecycleManager = require("./LifecycleManager");
const CompensationOrchestrator = require("./CompensationOrchestrator");
const ConsistencyValidator = require("./ConsistencyValidator");
const AuditCorrelationManager = require("./AuditCorrelationManager");

/**
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

const DEFAULTS = Object.freeze({
    maxRetries: 3,
    retryDelayMs: 250,
    stepTimeoutMs: 30_000,
    sagaTimeoutMs: 5 * 60 * 1000,
    maxSteps: 100,
    maxCompensationAttempts: 3,
});

const STATES = Object.freeze({
    CREATED: "CREATED",
    RUNNING: "RUNNING",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
    COMPENSATING: "COMPENSATING",
    COMPENSATED: "COMPENSATED",
    COMPENSATION_FAILED: "COMPENSATION_FAILED",
    CANCELLED: "CANCELLED",
    TIMED_OUT: "TIMED_OUT",
});

const STEP_STATES = Object.freeze({
    PENDING: "PENDING",
    RUNNING: "RUNNING",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
    COMPENSATING: "COMPENSATING",
    COMPENSATED: "COMPENSATED",
    COMPENSATION_FAILED: "COMPENSATION_FAILED",
    SKIPPED: "SKIPPED",
});

const TERMINAL_STATES = new Set([
    STATES.COMPLETED,
    STATES.COMPENSATED,
    STATES.COMPENSATION_FAILED,
    STATES.CANCELLED,
    STATES.TIMED_OUT,
]);

const RETRYABLE_ERRORS = new Set([
    "TIMEOUT",
    "ETIMEDOUT",
    "ECONNRESET",
    "ECONNREFUSED",
    "EAI_AGAIN",
    "NETWORK_ERROR",
    "TRANSIENT_ERROR",
    "SERVICE_UNAVAILABLE",
    "RATE_LIMITED",
]);

/**
 * ============================================================================
 * ERROR TYPES
 * ============================================================================
 */

class SagaOrchestratorError extends Error {
    constructor(message, options = {}) {
        super(message);

        this.name = "SagaOrchestratorError";
        this.code = options.code || "SAGA_ORCHESTRATION_ERROR";
        this.sagaId = options.sagaId || null;
        this.stepId = options.stepId || null;
        this.correlationId = options.correlationId || null;
        this.retryable = Boolean(options.retryable);
        this.cause = options.cause || null;

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, SagaOrchestratorError);
        }
    }
}

/**
 * ============================================================================
 * SAGA ORCHESTRATOR
 * ============================================================================
 */

class SagaOrchestrator {
    constructor(options = {}) {
        this.config = {
            ...DEFAULTS,
            ...(options.config || {}),
        };

        this.lifecycleManager =
            options.lifecycleManager || LifecycleManager;

        this.compensationOrchestrator =
            options.compensationOrchestrator ||
            CompensationOrchestrator;

        this.consistencyValidator =
            options.consistencyValidator ||
            ConsistencyValidator;

        this.auditCorrelationManager =
            options.auditCorrelationManager ||
            AuditCorrelationManager;

        this.activeSagas = new Map();
    }

    /**
     * =========================================================================
     * MAIN ENTRYPOINT
     * =========================================================================
     *
     * Execute a SagaDefinition.
     *
     * Supported forms:
     *
     * execute(definition, input, options)
     *
     * or
     *
     * execute({
     *     definition,
     *     input,
     *     options
     * })
     */
    async execute(definitionOrOptions, input = {}, options = {}) {
        const normalized = this.normalizeExecutionArguments(
            definitionOrOptions,
            input,
            options
        );

        const {
            definition,
            sagaInput,
            executionOptions,
        } = normalized;

        this.validateDefinition(definition);

        const sagaId =
            executionOptions.sagaId ||
            crypto.randomUUID();

        const correlationId =
            executionOptions.correlationId ||
            crypto.randomUUID();

        const idempotencyKey =
            executionOptions.idempotencyKey ||
            this.createIdempotencyKey(
                definition,
                sagaInput,
                sagaId
            );

        const startedAt = new Date();

        const execution = {
            sagaId,
            correlationId,
            idempotencyKey,
            definitionName: this.getDefinitionName(definition),
            state: STATES.CREATED,
            input: sagaInput,
            output: null,
            error: null,
            steps: [],
            completedSteps: [],
            failedStep: null,
            compensation: null,
            startedAt,
            completedAt: null,
            durationMs: null,
            metadata: {
                ...(executionOptions.metadata || {}),
            },
        };

        /**
         * Idempotency guard.
         */
        const existing = this.findExistingExecution(
            idempotencyKey
        );

        if (existing) {
            return this.buildResult(existing, {
                idempotentReplay: true,
            });
        }

        this.activeSagas.set(sagaId, execution);

        try {
            await this.audit(
                "SAGA_CREATED",
                execution
            );

            await this.transition(
                execution,
                STATES.RUNNING
            );

            const context = this.createContext(
                definition,
                execution
            );

            await this.validateBeforeExecution(
                context,
                definition
            );

            const steps =
                this.getSteps(definition);

            if (steps.length > this.config.maxSteps) {
                throw new SagaOrchestratorError(
                    `Saga exceeds maximum step count of ${this.config.maxSteps}`,
                    {
                        code: "SAGA_STEP_LIMIT_EXCEEDED",
                        sagaId,
                        correlationId,
                    }
                );
            }

            const output = await this.executeSteps(
                definition,
                context,
                execution,
                steps,
                executionOptions
            );

            execution.output = output;

            await this.validateAfterExecution(
                context,
                definition,
                execution
            );

            await this.transition(
                execution,
                STATES.COMPLETED
            );

            execution.completedAt = new Date();
            execution.durationMs =
                execution.completedAt.getTime() -
                execution.startedAt.getTime();

            await this.audit(
                "SAGA_COMPLETED",
                execution
            );

            return this.buildResult(execution);

        } catch (error) {
            return this.handleSagaFailure(
                definition,
                execution,
                error,
                executionOptions
            );
        } finally {
            this.activeSagas.delete(sagaId);
        }
    }

    /**
     * =========================================================================
     * STEP EXECUTION
     * =========================================================================
     */

    async executeSteps(
        definition,
        context,
        execution,
        steps,
        executionOptions
    ) {
        let lastResult = null;

        for (let index = 0; index < steps.length; index += 1) {
            const step = steps[index];

            if (!step) {
                continue;
            }

            if (
                typeof executionOptions.stepFilter ===
                "function" &&
                !executionOptions.stepFilter(step, index)
            ) {
                continue;
            }

            const stepExecution =
                this.createStepExecution(
                    step,
                    index
                );

            execution.steps.push(stepExecution);

            await this.audit(
                "SAGA_STEP_STARTED",
                execution,
                stepExecution
            );

            try {
                await this.transitionStep(
                    execution,
                    stepExecution,
                    STEP_STATES.RUNNING
                );

                const result =
                    await this.executeStepWithRetry(
                        step,
                        context,
                        execution,
                        stepExecution
                    );

                stepExecution.result = result;
                stepExecution.completedAt = new Date();
                stepExecution.durationMs =
                    stepExecution.completedAt.getTime() -
                    stepExecution.startedAt.getTime();

                await this.transitionStep(
                    execution,
                    stepExecution,
                    STEP_STATES.COMPLETED
                );

                execution.completedSteps.push(
                    stepExecution.stepId
                );

                lastResult = result;

                this.updateContext(
                    context,
                    step,
                    result
                );

                await this.audit(
                    "SAGA_STEP_COMPLETED",
                    execution,
                    stepExecution
                );

            } catch (error) {
                stepExecution.error =
                    this.serializeError(error);

                stepExecution.failedAt = new Date();

                await this.transitionStep(
                    execution,
                    stepExecution,
                    STEP_STATES.FAILED
                );

                execution.failedStep =
                    stepExecution.stepId;

                await this.audit(
                    "SAGA_STEP_FAILED",
                    execution,
                    stepExecution
                );

                throw new SagaOrchestratorError(
                    `Saga step failed: ${this.getStepName(step)}`,
                    {
                        code: "SAGA_STEP_FAILED",
                        sagaId: execution.sagaId,
                        stepId: stepExecution.stepId,
                        correlationId:
                            execution.correlationId,
                        retryable:
                            this.isRetryableError(error),
                        cause: error,
                    }
                );
            }

            this.assertSagaDeadline(execution);
        }

        return (
            lastResult ||
            this.getContextOutput(context)
        );
    }

    /**
     * =========================================================================
     * STEP RETRY ENGINE
     * =========================================================================
     */

    async executeStepWithRetry(
        step,
        context,
        execution,
        stepExecution
    ) {
        const maxRetries =
            this.getStepMaxRetries(step);

        let attempt = 0;

        while (attempt <= maxRetries) {
            attempt += 1;

            stepExecution.attempts = attempt;

            try {
                return await this.executeWithTimeout(
                    () =>
                        this.invokeStep(
                            step,
                            context,
                            execution,
                            stepExecution
                        ),
                    this.getStepTimeout(step)
                );
            } catch (error) {
                const retryable =
                    this.isRetryableError(error);

                if (
                    !retryable ||
                    attempt > maxRetries
                ) {
                    throw error;
                }

                const delay =
                    this.calculateRetryDelay(
                        attempt,
                        step
                    );

                await this.audit(
                    "SAGA_STEP_RETRY",
                    execution,
                    stepExecution,
                    {
                        attempt,
                        maxRetries,
                        delay,
                        error:
                            this.serializeError(error),
                    }
                );

                await this.sleep(delay);
            }
        }

        throw new SagaOrchestratorError(
            "Step retry policy exhausted",
            {
                code: "SAGA_RETRY_EXHAUSTED",
                sagaId: execution.sagaId,
                stepId: stepExecution.stepId,
                correlationId:
                    execution.correlationId,
            }
        );
    }

    /**
     * =========================================================================
     * STEP INVOCATION
     * =========================================================================
     */

    async invokeStep(
        step,
        context,
        execution,
        stepExecution
    ) {
        const handler =
            step.execute ||
            step.action ||
            step.run;

        if (typeof handler !== "function") {
            throw new SagaOrchestratorError(
                `Saga step "${this.getStepName(step)}" has no executable handler`,
                {
                    code: "INVALID_SAGA_STEP",
                    sagaId: execution.sagaId,
                    stepId: stepExecution.stepId,
                    correlationId:
                        execution.correlationId,
                }
            );
        }

        return handler.call(
            step,
            context,
            {
                sagaId: execution.sagaId,
                correlationId:
                    execution.correlationId,
                stepId:
                    stepExecution.stepId,
                attempt:
                    stepExecution.attempts,
            }
        );
    }

    /**
     * =========================================================================
     * FAILURE / COMPENSATION
     * =========================================================================
     */

    async handleSagaFailure(
        definition,
        execution,
        error,
        executionOptions
    ) {
        execution.error =
            this.serializeError(error);

        if (
            error &&
            error.code === "SAGA_TIMEOUT"
        ) {
            await this.transition(
                execution,
                STATES.TIMED_OUT
            );
        } else if (
            error &&
            error.code === "SAGA_CANCELLED"
        ) {
            await this.transition(
                execution,
                STATES.CANCELLED
            );
        } else {
            await this.transition(
                execution,
                STATES.FAILED
            );
        }

        await this.audit(
            "SAGA_FAILED",
            execution
        );

        const shouldCompensate =
            executionOptions.compensateOnFailure !==
            false &&
            execution.completedSteps.length > 0;

        if (!shouldCompensate) {
            execution.completedAt = new Date();
            execution.durationMs =
                execution.completedAt.getTime() -
                execution.startedAt.getTime();

            return this.buildResult(
                execution,
                {
                    failed: true,
                }
            );
        }

        try {
            await this.transition(
                execution,
                STATES.COMPENSATING
            );

            const context = this.createContext(
                definition,
                execution
            );

            const compensationResult =
                await this.compensate(
                    definition,
                    context,
                    execution,
                    executionOptions
                );

            execution.compensation =
                compensationResult;

            const compensationSucceeded =
                compensationResult?.success !== false;

            if (compensationSucceeded) {
                await this.transition(
                    execution,
                    STATES.COMPENSATED
                );

                await this.audit(
                    "SAGA_COMPENSATED",
                    execution
                );
            } else {
                await this.transition(
                    execution,
                    STATES.COMPENSATION_FAILED
                );

                await this.audit(
                    "SAGA_COMPENSATION_FAILED",
                    execution
                );
            }
        } catch (compensationError) {
            execution.compensation = {
                success: false,
                error:
                    this.serializeError(
                        compensationError
                    ),
            };

            await this.transition(
                execution,
                STATES.COMPENSATION_FAILED
            );

            await this.audit(
                "SAGA_COMPENSATION_FAILED",
                execution
            );
        }

        execution.completedAt = new Date();
        execution.durationMs =
            execution.completedAt.getTime() -
            execution.startedAt.getTime();

        return this.buildResult(
            execution,
            {
                failed: true,
            }
        );
    }

    /**
     * =========================================================================
     * COMPENSATION
     * =========================================================================
     */

    async compensate(
        definition,
        context,
        execution,
        executionOptions
    ) {
        const completedSteps =
            execution.steps.filter(
                (step) =>
                    step.state ===
                    STEP_STATES.COMPLETED
            );

        if (!completedSteps.length) {
            return {
                success: true,
                compensatedSteps: [],
            };
        }

        const compensationSteps =
            this.getSteps(definition);

        const orderedSteps =
            compensationSteps
                .filter((step) =>
                    completedSteps.some(
                        (completed) =>
                            completed.stepId ===
                            this.getStepId(step)
                    )
                )
                .reverse();

        /**
         * Prefer the dedicated compensation
         * orchestrator when it exposes a compatible
         * method.
         */
        if (
            this.compensationOrchestrator &&
            typeof this.compensationOrchestrator.compensate ===
                "function"
        ) {
            try {
                return await this.compensationOrchestrator.compensate(
                    {
                        sagaId:
                            execution.sagaId,
                        correlationId:
                            execution.correlationId,
                        context,
                        steps: orderedSteps,
                        completedSteps,
                        maxAttempts:
                            this.config
                                .maxCompensationAttempts,
                        ...executionOptions,
                    }
                );
            } catch (error) {
                await this.audit(
                    "SAGA_COMPENSATION_ORCHESTRATOR_ERROR",
                    execution,
                    null,
                    {
                        error:
                            this.serializeError(
                                error
                            ),
                    }
                );

                throw error;
            }
        }

        /**
         * Local compatibility fallback.
         */
        const results = [];

        for (const step of orderedSteps) {
            const completed =
                completedSteps.find(
                    (item) =>
                        item.stepId ===
                        this.getStepId(step)
                );

            const compensateHandler =
                step.compensate ||
                step.rollback ||
                step.undo;

            if (
                typeof compensateHandler !==
                "function"
            ) {
                results.push({
                    stepId:
                        this.getStepId(step),
                    success: false,
                    skipped: true,
                    reason:
                        "No compensation handler registered",
                });

                continue;
            }

            const stepExecution =
                this.findStepExecution(
                    execution,
                    this.getStepId(step)
                );

            try {
                await this.transitionStep(
                    execution,
                    stepExecution,
                    STEP_STATES.COMPENSATING
                );

                const result =
                    await this.executeWithTimeout(
                        () =>
                            compensateHandler.call(
                                step,
                                context,
                                {
                                    sagaId:
                                        execution.sagaId,
                                    correlationId:
                                        execution.correlationId,
                                    stepId:
                                        this.getStepId(
                                            step
                                        ),
                                    originalResult:
                                        completed?.result,
                                }
                            ),
                        this.getStepTimeout(step)
                    );

                await this.transitionStep(
                    execution,
                    stepExecution,
                    STEP_STATES.COMPENSATED
                );

                results.push({
                    stepId:
                        this.getStepId(step),
                    success: true,
                    result,
                });
            } catch (error) {
                await this.transitionStep(
                    execution,
                    stepExecution,
                    STEP_STATES.COMPENSATION_FAILED
                );

                results.push({
                    stepId:
                        this.getStepId(step),
                    success: false,
                    error:
                        this.serializeError(error),
                });
            }
        }

        return {
            success: results.every(
                (item) => item.success
            ),
            compensatedSteps: results,
        };
    }

    /**
     * =========================================================================
     * VALIDATION
     * =========================================================================
     */

    async validateBeforeExecution(
        context,
        definition
    ) {
        if (
            !this.consistencyValidator
        ) {
            return true;
        }

        if (
            typeof this.consistencyValidator
                .validateBeforeExecution ===
            "function"
        ) {
            return this.consistencyValidator
                .validateBeforeExecution(
                    context,
                    definition
                );
        }

        if (
            typeof this.consistencyValidator
                .validate ===
            "function"
        ) {
            return this.consistencyValidator.validate(
                context,
                definition
            );
        }

        return true;
    }

    async validateAfterExecution(
        context,
        definition,
        execution
    ) {
        if (
            !this.consistencyValidator
        ) {
            return true;
        }

        if (
            typeof this.consistencyValidator
                .validateAfterExecution ===
            "function"
        ) {
            return this.consistencyValidator
                .validateAfterExecution(
                    context,
                    definition,
                    execution
                );
        }

        if (
            typeof this.consistencyValidator
                .validate ===
            "function"
        ) {
            return this.consistencyValidator.validate(
                context,
                definition,
                execution
            );
        }

        return true;
    }

    /**
     * =========================================================================
     * LIFECYCLE MANAGEMENT
     * =========================================================================
     */

    async transition(
        execution,
        nextState
    ) {
        const previousState =
            execution.state;

        if (
            previousState === nextState
        ) {
            return execution;
        }

        if (
            TERMINAL_STATES.has(previousState)
        ) {
            throw new SagaOrchestratorError(
                `Cannot transition terminal Saga from ${previousState} to ${nextState}`,
                {
                    code:
                        "INVALID_SAGA_LIFECYCLE_TRANSITION",
                    sagaId:
                        execution.sagaId,
                    correlationId:
                        execution.correlationId,
                }
            );
        }

        if (
            this.lifecycleManager &&
            typeof this.lifecycleManager.transition ===
                "function"
        ) {
            await this.lifecycleManager.transition(
                execution,
                nextState
            );
        }

        execution.state = nextState;

        execution.lifecycle = {
            ...(execution.lifecycle || {}),
            lastTransition: {
                from: previousState,
                to: nextState,
                at: new Date(),
            },
        };

        return execution;
    }

    async transitionStep(
        execution,
        stepExecution,
        nextState
    ) {
        if (!stepExecution) {
            return;
        }

        stepExecution.state =
            nextState;

        stepExecution.transitions =
            stepExecution.transitions || [];

        stepExecution.transitions.push({
            state: nextState,
            at: new Date(),
        });

        if (
            this.lifecycleManager &&
            typeof this.lifecycleManager.transitionStep ===
                "function"
        ) {
            await this.lifecycleManager.transitionStep(
                execution,
                stepExecution,
                nextState
            );
        }
    }

    /**
     * =========================================================================
     * CANCELLATION
     * =========================================================================
     */

    async cancel(
        sagaId,
        reason = "Saga cancelled"
    ) {
        const execution =
            this.activeSagas.get(sagaId);

        if (!execution) {
            return {
                success: false,
                sagaId,
                reason: "Saga execution not found",
            };
        }

        if (
            TERMINAL_STATES.has(
                execution.state
            )
        ) {
            return {
                success: false,
                sagaId,
                reason:
                    "Saga has already reached a terminal state",
                state: execution.state,
            };
        }

        const error =
            new SagaOrchestratorError(
                reason,
                {
                    code: "SAGA_CANCELLED",
                    sagaId,
                    correlationId:
                        execution.correlationId,
                }
            );

        return this.handleSagaFailure(
            this.getActiveDefinition(execution),
            execution,
            error,
            {
                compensateOnFailure: true,
            }
        );
    }

    /**
     * =========================================================================
     * CONTEXT
     * =========================================================================
     */

    createContext(
        definition,
        execution
    ) {
        const contextData = {
            sagaId: execution.sagaId,
            correlationId:
                execution.correlationId,
            idempotencyKey:
                execution.idempotencyKey,
            input: execution.input,
            metadata: execution.metadata,
            execution,
        };

        if (
            typeof SagaContext ===
            "function"
        ) {
            try {
                return new SagaContext(
                    contextData
                );
            } catch (_) {
                return contextData;
            }
        }

        if (
            SagaContext &&
            typeof SagaContext.create ===
                "function"
        ) {
            return SagaContext.create(
                contextData
            );
        }

        return contextData;
    }

    updateContext(
        context,
        step,
        result
    ) {
        if (!context) {
            return;
        }

        if (
            typeof context.setStepResult ===
            "function"
        ) {
            context.setStepResult(
                this.getStepId(step),
                result
            );
            return;
        }

        if (
            typeof context.setResult ===
            "function"
        ) {
            context.setResult(
                this.getStepId(step),
                result
            );
            return;
        }

        if (!context.stepResults) {
            context.stepResults = {};
        }

        context.stepResults[
            this.getStepId(step)
        ] = result;
    }

    getContextOutput(context) {
        if (!context) {
            return null;
        }

        if (
            typeof context.getOutput ===
            "function"
        ) {
            return context.getOutput();
        }

        if (
            Object.prototype.hasOwnProperty.call(
                context,
                "output"
            )
        ) {
            return context.output;
        }

        return context.stepResults || null;
    }

    /**
     * =========================================================================
     * DEFINITION HELPERS
     * =========================================================================
     */

    validateDefinition(definition) {
        if (!definition) {
            throw new SagaOrchestratorError(
                "Saga definition is required",
                {
                    code: "SAGA_DEFINITION_REQUIRED",
                }
            );
        }

        const steps =
            this.getSteps(definition);

        if (!steps.length) {
            throw new SagaOrchestratorError(
                "Saga definition contains no executable steps",
                {
                    code: "SAGA_STEPS_REQUIRED",
                }
            );
        }

        const seen = new Set();

        for (const step of steps) {
            const stepId =
                this.getStepId(step);

            if (!stepId) {
                throw new SagaOrchestratorError(
                    "Every Saga step requires a unique stepId",
                    {
                        code:
                            "SAGA_STEP_ID_REQUIRED",
                    }
                );
            }

            if (seen.has(stepId)) {
                throw new SagaOrchestratorError(
                    `Duplicate Saga stepId: ${stepId}`,
                    {
                        code:
                            "DUPLICATE_SAGA_STEP_ID",
                    }
                );
            }

            seen.add(stepId);

            if (
                typeof step.execute !==
                    "function" &&
                typeof step.action !==
                    "function" &&
                typeof step.run !==
                    "function"
            ) {
                throw new SagaOrchestratorError(
                    `Saga step "${stepId}" has no execute/action/run function`,
                    {
                        code:
                            "SAGA_STEP_HANDLER_REQUIRED",
                    }
                );
            }
        }
    }

    getSteps(definition) {
        if (
            typeof definition.getSteps ===
            "function"
        ) {
            return definition.getSteps();
        }

        if (Array.isArray(definition.steps)) {
            return definition.steps;
        }

        if (
            SagaDefinition &&
            typeof SagaDefinition.getSteps ===
                "function"
        ) {
            return SagaDefinition.getSteps(
                definition
            );
        }

        return [];
    }

    getDefinitionName(definition) {
        return (
            definition.name ||
            definition.sagaName ||
            definition.id ||
            definition.constructor?.name ||
            "AnonymousSaga"
        );
    }

    getStepId(step) {
        return (
            step.stepId ||
            step.id ||
            step.name
        );
    }

    getStepName(step) {
        return (
            step.name ||
            step.stepName ||
            step.stepId ||
            step.id ||
            "UnnamedStep"
        );
    }

    getStepMaxRetries(step) {
        const retries =
            step.maxRetries ??
            step.retry?.maxRetries ??
            this.config.maxRetries;

        return Math.max(
            0,
            Number(retries) || 0
        );
    }

    getStepTimeout(step) {
        const timeout =
            step.timeoutMs ??
            step.timeout ??
            step.retry?.timeoutMs ??
            this.config.stepTimeoutMs;

        return Math.max(
            1,
            Number(timeout) ||
                this.config.stepTimeoutMs
        );
    }

    /**
     * =========================================================================
     * EXECUTION HELPERS
     * =========================================================================
     */

    normalizeExecutionArguments(
        definitionOrOptions,
        input,
        options
    ) {
        if (
            definitionOrOptions &&
            definitionOrOptions.definition
        ) {
            return {
                definition:
                    definitionOrOptions.definition,
                sagaInput:
                    definitionOrOptions.input ||
                    {},
                executionOptions:
                    definitionOrOptions.options ||
                    {},
            };
        }

        return {
            definition:
                definitionOrOptions,
            sagaInput: input || {},
            executionOptions:
                options || {},
        };
    }

    createStepExecution(
        step,
        index
    ) {
        return {
            stepId:
                this.getStepId(step),
            stepName:
                this.getStepName(step),
            index,
            state: STEP_STATES.PENDING,
            attempts: 0,
            result: null,
            error: null,
            startedAt: null,
            completedAt: null,
            failedAt: null,
            durationMs: null,
            transitions: [],
        };
    }

    findStepExecution(
        execution,
        stepId
    ) {
        return execution.steps.find(
            (step) =>
                step.stepId === stepId
        );
    }

    findExistingExecution(
        idempotencyKey
    ) {
        for (const execution of this.activeSagas.values()) {
            if (
                execution.idempotencyKey ===
                idempotencyKey
            ) {
                return execution;
            }
        }

        return null;
    }

    createIdempotencyKey(
        definition,
        input,
        sagaId
    ) {
        const raw = JSON.stringify({
            definition:
                this.getDefinitionName(
                    definition
                ),
            input,
            sagaId,
        });

        return crypto
            .createHash("sha256")
            .update(raw)
            .digest("hex");
    }

    assertSagaDeadline(
        execution
    ) {
        const elapsed =
            Date.now() -
            execution.startedAt.getTime();

        if (
            elapsed >
            this.config.sagaTimeoutMs
        ) {
            throw new SagaOrchestratorError(
                "Saga execution timeout exceeded",
                {
                    code: "SAGA_TIMEOUT",
                    sagaId:
                        execution.sagaId,
                    correlationId:
                        execution.correlationId,
                    retryable: false,
                }
            );
        }
    }

    /**
     * =========================================================================
     * TIMEOUT ENGINE
     * =========================================================================
     */

    executeWithTimeout(
        operation,
        timeoutMs
    ) {
        return new Promise(
            (resolve, reject) => {
                let settled = false;

                const timer =
                    setTimeout(() => {
                        if (settled) {
                            return;
                        }

                        settled = true;

                        reject(
                            new SagaOrchestratorError(
                                "Saga operation timed out",
                                {
                                    code: "TIMEOUT",
                                    retryable: true,
                                }
                            )
                        );
                    }, timeoutMs);

                Promise.resolve()
                    .then(operation)
                    .then((result) => {
                        if (settled) {
                            return;
                        }

                        settled = true;
                        clearTimeout(timer);
                        resolve(result);
                    })
                    .catch((error) => {
                        if (settled) {
                            return;
                        }

                        settled = true;
                        clearTimeout(timer);
                        reject(error);
                    });
            }
        );
    }

    calculateRetryDelay(
        attempt,
        step
    ) {
        const retryConfig =
            step.retry || {};

        const baseDelay =
            Number(
                retryConfig.delayMs ??
                    this.config.retryDelayMs
            );

        const backoff =
            Number(
                retryConfig.backoffMultiplier ??
                    2
            );

        const maxDelay =
            Number(
                retryConfig.maxDelayMs ??
                    30_000
            );

        const jitter =
            Number(
                retryConfig.jitterMs ??
                    100
            );

        const exponential =
            baseDelay *
            Math.pow(
                backoff,
                Math.max(0, attempt - 1)
            );

        const randomized =
            exponential +
            Math.floor(
                Math.random() *
                    Math.max(0, jitter)
            );

        return Math.min(
            randomized,
            maxDelay
        );
    }

    isRetryableError(error) {
        if (!error) {
            return false;
        }

        if (
            error.retryable === true
        ) {
            return true;
        }

        if (
            RETRYABLE_ERRORS.has(
                String(
                    error.code ||
                        ""
                ).toUpperCase()
            )
        ) {
            return true;
        }

        const status =
            Number(error.status);

        return (
            status === 408 ||
            status === 429 ||
            status >= 500
        );
    }

    sleep(milliseconds) {
        return new Promise(
            (resolve) =>
                setTimeout(
                    resolve,
                    milliseconds
                )
        );
    }

    /**
     * =========================================================================
     * AUDIT CORRELATION
     * =========================================================================
     */

    async audit(
        event,
        execution,
        stepExecution = null,
        metadata = {}
    ) {
        const payload = {
            event,
            sagaId:
                execution?.sagaId || null,
            correlationId:
                execution?.correlationId ||
                null,
            idempotencyKey:
                execution?.idempotencyKey ||
                null,
            definitionName:
                execution?.definitionName ||
                null,
            state:
                execution?.state || null,
            stepId:
                stepExecution?.stepId ||
                null,
            stepName:
                stepExecution?.stepName ||
                null,
            metadata,
            timestamp:
                new Date().toISOString(),
        };

        if (
            !this.auditCorrelationManager
        ) {
            return payload;
        }

        try {
            if (
                typeof this
                    .auditCorrelationManager
                    .record ===
                "function"
            ) {
                await this.auditCorrelationManager.record(
                    payload
                );
            } else if (
                typeof this
                    .auditCorrelationManager
                    .audit ===
                "function"
            ) {
                await this.auditCorrelationManager.audit(
                    payload
                );
            } else if (
                typeof this
                    .auditCorrelationManager
                    .log ===
                "function"
            ) {
                await this.auditCorrelationManager.log(
                    payload
                );
            }
        } catch (auditError) {
            /**
             * Audit failure must not silently mutate
             * Saga state. It is surfaced through the
             * execution metadata but does not replace
             * the business failure.
             */
            execution.auditErrors =
                execution.auditErrors || [];

            execution.auditErrors.push(
                this.serializeError(
                    auditError
                )
            );
        }

        return payload;
    }

    /**
     * =========================================================================
     * RESULT BUILDER
     * =========================================================================
     */

    buildResult(
        execution,
        metadata = {}
    ) {
        return {
            success:
                execution.state ===
                STATES.COMPLETED,

            sagaId:
                execution.sagaId,

            correlationId:
                execution.correlationId,

            idempotencyKey:
                execution.idempotencyKey,

            definition:
                execution.definitionName,

            state:
                execution.state,

            output:
                execution.output,

            input:
                execution.input,

            error:
                execution.error,

            failedStep:
                execution.failedStep,

            steps:
                execution.steps,

            completedSteps:
                execution.completedSteps,

            compensation:
                execution.compensation,

            startedAt:
                execution.startedAt,

            completedAt:
                execution.completedAt,

            durationMs:
                execution.durationMs,

            metadata: {
                ...execution.metadata,
                ...metadata,
            },
        };
    }

    serializeError(error) {
        if (!error) {
            return null;
        }

        return {
            name:
                error.name ||
                "Error",
            message:
                error.message ||
                String(error),
            code:
                error.code || null,
            status:
                error.status || null,
            retryable:
                Boolean(
                    error.retryable
                ),
            stack:
                error.stack || null,
        };
    }

    /**
     * =========================================================================
     * ACTIVE SAGA INSPECTION
     * =========================================================================
     */

    getActiveSaga(sagaId) {
        return (
            this.activeSagas.get(
                sagaId
            ) || null
        );
    }

    getActiveSagas() {
        return Array.from(
            this.activeSagas.values()
        );
    }

    hasActiveSaga(sagaId) {
        return this.activeSagas.has(
            sagaId
        );
    }

    /**
     * =========================================================================
     * RECOVERY SUPPORT
     * =========================================================================
     *
     * The orchestrator deliberately does not invent persistence.
     * A persistent Saga repository can be injected later without changing
     * the orchestration contract.
     */
    async resume(
        definition,
        execution,
        options = {}
    ) {
        if (!execution) {
            throw new SagaOrchestratorError(
                "Saga execution state is required for resume",
                {
                    code:
                        "SAGA_EXECUTION_REQUIRED",
                }
            );
        }

        if (
            TERMINAL_STATES.has(
                execution.state
            )
        ) {
            return this.buildResult(
                execution,
                {
                    resumed: false,
                    reason:
                        "Saga is already terminal",
                }
            );
        }

        const resumedOptions = {
            ...options,
            sagaId:
                execution.sagaId,
            correlationId:
                execution.correlationId,
            idempotencyKey:
                execution.idempotencyKey,
            metadata: {
                ...(execution.metadata ||
                    {}),
                resumed: true,
            },
        };

        return this.execute(
            definition,
            execution.input,
            resumedOptions
        );
    }

    /**
     * =========================================================================
     * HEALTH / DIAGNOSTICS
     * =========================================================================
     */

    getHealth() {
        return {
            healthy: true,
            activeSagas:
                this.activeSagas.size,
            configuration: {
                maxRetries:
                    this.config.maxRetries,
                stepTimeoutMs:
                    this.config
                        .stepTimeoutMs,
                sagaTimeoutMs:
                    this.config
                        .sagaTimeoutMs,
                maxSteps:
                    this.config.maxSteps,
            },
            timestamp:
                new Date().toISOString(),
        };
    }

    /**
     * =========================================================================
     * ACTIVE DEFINITION SUPPORT
     * =========================================================================
     *
     * Allows cancellation integrations to associate
     * an execution with its definition without exposing
     * internal implementation details.
     */
    registerDefinition(
        execution,
        definition
    ) {
        if (!execution) {
            return;
        }

        execution.definition =
            definition;
    }

    getActiveDefinition(
        execution
    ) {
        return (
            execution?.definition ||
            null
        );
    }
}

/**
 * ============================================================================
 * SINGLETON EXPORT
 * ============================================================================
 *
 * Existing project services use singleton exports.
 * Preserve that convention.
 * ============================================================================
 */

const sagaOrchestrator =
    new SagaOrchestrator();

module.exports =
    sagaOrchestrator;

/**
 * Optional named exports for tests / dependency injection.
 */
module.exports.SagaOrchestrator =
    SagaOrchestrator;

module.exports.SagaOrchestratorError =
    SagaOrchestratorError;

module.exports.STATES =
    STATES;

module.exports.STEP_STATES =
    STEP_STATES;