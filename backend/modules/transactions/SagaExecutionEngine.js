'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Saga Execution Engine
 * ============================================================================
 *
 * File:
 * backend/modules/transactions/SagaExecutionEngine.js
 *
 * Purpose
 * -------
 * Low-level execution engine for distributed Saga workflows.
 *
 * The engine is responsible for executing an already-defined Saga in a
 * deterministic and observable manner.
 *
 * It DOES NOT own:
 *
 * • Saga definition construction
 * • HTTP/controller concerns
 * • Business-domain rules
 * • Transaction persistence policy
 * • Tenant provisioning
 *
 * It coordinates:
 *
 * • SagaContext
 * • SagaDefinition
 * • CompensationOrchestrator
 * • ConsistencyValidator
 * • TransactionStateMachine
 * • Audit Publisher
 * • Event Publisher
 * • Metrics
 * • Tracing
 * • Logger
 *
 * Enterprise capabilities
 * -----------------------
 * • Ordered forward execution
 * • Reverse compensation
 * • Step-level retry
 * • Exponential backoff
 * • Jitter
 * • Timeout protection
 * • Idempotency protection
 * • Execution locking
 * • Step execution history
 * • Compensation history
 * • Lifecycle events
 * • Audit hooks
 * • Metrics hooks
 * • Distributed tracing hooks
 * • Failure classification
 * • Cancellation support
 * • AbortSignal support
 * • Recovery-friendly status
 * • Deterministic terminal states
 * • Partial compensation detection
 * • Safe dependency injection
 *
 * IMPORTANT
 * ---------
 * This engine does not assume a specific implementation of SagaDefinition,
 * SagaContext, CompensationOrchestrator, metrics, tracer, repository, or
 * publisher. Adapters can therefore be injected without changing the engine.
 *
 * ============================================================================
 */

/**
 * ============================================================================
 * Saga States
 * ============================================================================
 */

const SagaState = Object.freeze({
    CREATED: 'CREATED',
    RUNNING: 'RUNNING',
    COMPLETED: 'COMPLETED',
    COMPENSATING: 'COMPENSATING',
    COMPENSATED: 'COMPENSATED',
    FAILED: 'FAILED',
    PARTIALLY_COMPENSATED: 'PARTIALLY_COMPENSATED',
    CANCELLED: 'CANCELLED',
    TIMED_OUT: 'TIMED_OUT'
});

/**
 * ============================================================================
 * Step States
 * ============================================================================
 */

const StepState = Object.freeze({
    PENDING: 'PENDING',
    RUNNING: 'RUNNING',
    RETRYING: 'RETRYING',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
    COMPENSATING: 'COMPENSATING',
    COMPENSATED: 'COMPENSATED',
    COMPENSATION_FAILED: 'COMPENSATION_FAILED',
    SKIPPED: 'SKIPPED'
});

/**
 * ============================================================================
 * Failure Categories
 * ============================================================================
 */

const FailureCategory = Object.freeze({
    VALIDATION: 'VALIDATION',
    TIMEOUT: 'TIMEOUT',
    ABORTED: 'ABORTED',
    IDEMPOTENCY: 'IDEMPOTENCY',
    DEPENDENCY: 'DEPENDENCY',
    EXECUTION: 'EXECUTION',
    COMPENSATION: 'COMPENSATION',
    CONSISTENCY: 'CONSISTENCY',
    UNKNOWN: 'UNKNOWN'
});

/**
 * ============================================================================
 * Defaults
 * ============================================================================
 */

const DEFAULT_CONFIG = Object.freeze({
    enabled: true,

    strictMode: true,

    maxSteps: 100,

    defaultTimeoutMs: 60000,

    maxSagaTimeoutMs: 300000,

    retry: {
        enabled: true,
        maxAttempts: 3,
        initialDelayMs: 500,
        maxDelayMs: 30000,
        backoffFactor: 2,
        jitterRatio: 0.20
    },

    compensation: {
        enabled: true,
        continueOnFailure: true,
        maxAttempts: 3,
        timeoutMs: 60000
    },

    idempotency: {
        enabled: true,
        rejectDuplicateExecution: true
    },

    validation: {
        enabled: true,
        validateBeforeExecution: true,
        validateAfterExecution: true
    },

    lifecycle: {
        publishEvents: true,
        persistState: true
    },

    observability: {
        auditEnabled: true,
        metricsEnabled: true,
        tracingEnabled: true
    }
});

/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

/**
 * Deep merge configuration without mutating defaults.
 */
function mergeConfig(base, override) {
    const result = {
        ...base
    };

    if (!override || typeof override !== 'object') {
        return result;
    }

    for (const [key, value] of Object.entries(override)) {
        if (
            value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            base[key] &&
            typeof base[key] === 'object' &&
            !Array.isArray(base[key])
        ) {
            result[key] = mergeConfig(
                base[key],
                value
            );
        } else {
            result[key] = value;
        }
    }

    return result;
}

/**
 * Generate an execution identifier.
 */
function generateExecutionId(prefix = 'saga-exec') {
    if (typeof cryptoRandomUUID === 'function') {
        return `${prefix}-${cryptoRandomUUID()}`;
    }

    return [
        prefix,
        Date.now(),
        process.pid,
        Math.random()
            .toString(36)
            .slice(2, 14)
    ].join('-');
}

/**
 * Node.js crypto.randomUUID compatibility helper.
 */
let cryptoRandomUUID;

try {
    const crypto = require('crypto');
    cryptoRandomUUID = crypto.randomUUID;
} catch (_) {
    cryptoRandomUUID = null;
}

/**
 * Sleep helper.
 */
function sleep(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

/**
 * Normalize a positive integer.
 */
function positiveInteger(
    value,
    fallback
) {
    const number = Number(value);

    if (
        Number.isSafeInteger(number) &&
        number > 0
    ) {
        return number;
    }

    return fallback;
}

/**
 * Normalize retry configuration.
 */
function normalizeRetryConfig(config) {
    return {
        enabled: config.enabled !== false,

        maxAttempts: positiveInteger(
            config.maxAttempts,
            DEFAULT_CONFIG.retry.maxAttempts
        ),

        initialDelayMs: positiveInteger(
            config.initialDelayMs,
            DEFAULT_CONFIG.retry.initialDelayMs
        ),

        maxDelayMs: positiveInteger(
            config.maxDelayMs,
            DEFAULT_CONFIG.retry.maxDelayMs
        ),

        backoffFactor:
            Number.isFinite(
                Number(config.backoffFactor)
            ) &&
            Number(config.backoffFactor) >= 1
                ? Number(config.backoffFactor)
                : DEFAULT_CONFIG.retry.backoffFactor,

        jitterRatio:
            Number.isFinite(
                Number(config.jitterRatio)
            ) &&
            Number(config.jitterRatio) >= 0
                ? Number(config.jitterRatio)
                : DEFAULT_CONFIG.retry.jitterRatio
    };
}

/**
 * Determine whether an error is retryable.
 */
function isRetryableError(error) {
    if (!error) {
        return false;
    }

    if (error.retryable === true) {
        return true;
    }

    if (error.retryable === false) {
        return false;
    }

    const nonRetryableCodes = new Set([
        'VALIDATION_ERROR',
        'INVALID_TRANSACTION',
        'INVALID_SAGA',
        'IDEMPOTENCY_CONFLICT',
        'DUPLICATE_TRANSACTION_EXECUTION',
        'ABORT_ERR',
        'CONSISTENCY_VALIDATION_FAILED',
        'COMPENSATION_FAILED'
    ]);

    if (
        error.code &&
        nonRetryableCodes.has(error.code)
    ) {
        return false;
    }

    const retryableCodes = new Set([
        'ETIMEDOUT',
        'ECONNRESET',
        'ECONNREFUSED',
        'EAI_AGAIN',
        'NETWORK_ERROR',
        'SERVICE_UNAVAILABLE',
        'TEMPORARY_FAILURE',
        'RATE_LIMITED'
    ]);

    if (
        error.code &&
        retryableCodes.has(error.code)
    ) {
        return true;
    }

    return true;
}

/**
 * Create structured execution error.
 */
function createExecutionError(
    message,
    code,
    details = {}
) {
    const error = new Error(message);

    error.code = code;
    error.details = details;
    error.timestamp = new Date();

    return error;
}

/**
 * ============================================================================
 * Saga Execution Engine
 * ============================================================================
 */

class SagaExecutionEngine {

    /**
     * -------------------------------------------------------------------------
     * Constructor
     * -------------------------------------------------------------------------
     */

    constructor(options = {}) {
        this.config = mergeConfig(
            DEFAULT_CONFIG,
            options.config || {}
        );

        this.logger =
            options.logger ||
            console;

        this.metrics =
            options.metrics ||
            null;

        this.tracer =
            options.tracer ||
            null;

        this.auditPublisher =
            options.auditPublisher ||
            null;

        this.eventPublisher =
            options.eventPublisher ||
            null;

        this.stateMachine =
            options.stateMachine ||
            null;

        this.compensationOrchestrator =
            options.compensationOrchestrator ||
            null;

        this.consistencyValidator =
            options.consistencyValidator ||
            null;

        this.lifecycleManager =
            options.lifecycleManager ||
            null;

        this.repository =
            options.repository ||
            null;

        this.retryOrchestrator =
            options.retryOrchestrator ||
            null;

        /**
         * Active executions.
         *
         * executionId -> execution record
         */
        this.activeExecutions = new Map();

        /**
         * Completed idempotency keys.
         *
         * idempotencyKey -> completion metadata
         */
        this.completedExecutions = new Map();

        /**
         * Execution locks.
         *
         * idempotencyKey -> lock
         */
        this.executionLocks = new Map();

        /**
         * Runtime metrics.
         */
        this.statistics = {
            started: 0,
            completed: 0,
            failed: 0,
            cancelled: 0,
            timedOut: 0,
            compensated: 0,
            partiallyCompensated: 0,
            retries: 0,
            compensationFailures: 0
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Execute Saga
     * -------------------------------------------------------------------------
     *
     * Main execution entrypoint.
     *
     * @param {Object} sagaDefinition
     * @param {Object} context
     * @param {Object} options
     * @returns {Promise<Object>}
     */

    async execute(
        sagaDefinition,
        context,
        options = {}
    ) {
        const startedAt = Date.now();

        this.ensureEnabled();

        const executionId =
            options.executionId ||
            context?.executionId ||
            generateExecutionId();

        const request = {
            executionId,

            sagaId:
                sagaDefinition?.sagaId ||
                sagaDefinition?.id ||
                options.sagaId ||
                context?.sagaId ||
                null,

            tenantId:
                context?.tenantId ||
                options.tenantId ||
                null,

            transactionId:
                context?.transactionId ||
                options.transactionId ||
                null,

            correlationId:
                context?.correlationId ||
                options.correlationId ||
                null,

            idempotencyKey:
                options.idempotencyKey ||
                context?.idempotencyKey ||
                executionId
        };

        let execution = null;
        let span = null;

        try {
            this.validateDefinition(
                sagaDefinition
            );

            this.validateContext(
                context
            );

            this.validateRequest(
                request
            );

            this.acquireExecutionLock(
                request
            );

            execution = this.createExecutionRecord(
                sagaDefinition,
                context,
                request,
                options
            );

            this.activeExecutions.set(
                execution.executionId,
                execution
            );

            this.statistics.started++;

            span =
                this.startSpan(
                    'saga.execute',
                    execution
                );

            await this.publishLifecycle(
                'saga.started',
                execution
            );

            await this.audit(
                'SAGA_STARTED',
                execution
            );

            this.incrementMetric(
                'saga.executions.started'
            );

            if (
                this.config.validation.enabled &&
                this.config.validation.validateBeforeExecution
            ) {
                await this.validateConsistency(
                    'before',
                    execution
                );
            }

            execution.state =
                SagaState.RUNNING;

            await this.persistState(
                execution
            );

            const result =
                await this.executeSteps(
                    execution
                );

            if (
                this.config.validation.enabled &&
                this.config.validation.validateAfterExecution
            ) {
                await this.validateConsistency(
                    'after',
                    execution
                );
            }

            execution.state =
                SagaState.COMPLETED;

            execution.finishedAt =
                new Date();

            execution.durationMs =
                Date.now() - startedAt;

            this.statistics.completed++;

            await this.persistState(
                execution
            );

            await this.publishLifecycle(
                'saga.completed',
                execution
            );

            await this.audit(
                'SAGA_COMPLETED',
                execution
            );

            this.incrementMetric(
                'saga.executions.completed'
            );

            this.recordDuration(
                'saga.execution.duration',
                execution.durationMs
            );

            this.markCompleted(
                execution
            );

            return this.buildResult(
                execution,
                result
            );

        } catch (error) {
            if (!execution) {
                throw error;
            }

            return this.handleExecutionFailure(
                execution,
                error
            );

        } finally {
            if (span) {
                this.endSpan(
                    span
                );
            }

            if (execution) {
                this.releaseExecutionLock(
                    execution.idempotencyKey
                );

                this.activeExecutions.delete(
                    execution.executionId
                );
            }
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Execute Saga Steps
     * -------------------------------------------------------------------------
     */

    async executeSteps(execution) {
        const steps =
            this.resolveSteps(
                execution.definition
            );

        if (
            steps.length >
            this.config.maxSteps
        ) {
            throw createExecutionError(
                `Saga contains ${steps.length} steps; maximum allowed is ${this.config.maxSteps}`,
                'SAGA_STEP_LIMIT_EXCEEDED',
                {
                    executionId:
                        execution.executionId,
                    stepCount:
                        steps.length
                }
            );
        }

        const results = [];

        for (
            let index = 0;
            index < steps.length;
            index++
        ) {
            this.ensureNotCancelled(
                execution
            );

            const step = steps[index];

            const stepRecord =
                this.createStepRecord(
                    step,
                    index
                );

            execution.steps.push(
                stepRecord
            );

            try {
                const result =
                    await this.executeStep(
                        execution,
                        stepRecord
                    );

                stepRecord.result =
                    result;

                stepRecord.state =
                    StepState.COMPLETED;

                execution.completedSteps.push(
                    stepRecord
                );

                results.push({
                    stepId:
                        stepRecord.stepId,
                    name:
                        stepRecord.name,
                    result
                });

            } catch (error) {
                stepRecord.state =
                    StepState.FAILED;

                stepRecord.error =
                    this.serializeError(
                        error
                    );

                throw this.attachStepFailure(
                    error,
                    stepRecord
                );
            }
        }

        return results;
    }

    /**
     * -------------------------------------------------------------------------
     * Execute Single Step
     * -------------------------------------------------------------------------
     */

    async executeStep(
        execution,
        step
    ) {
        this.validateStep(
            step
        );

        const span =
            this.startSpan(
                'saga.step',
                execution,
                {
                    stepId:
                        step.stepId,
                    stepName:
                        step.name
                }
            );

        step.state =
            StepState.RUNNING;

        step.startedAt =
            new Date();

        await this.publishLifecycle(
            'saga.step.started',
            execution,
            {
                step
            }
        );

        this.incrementMetric(
            'saga.steps.started'
        );

        try {
            const result =
                await this.executeWithRetry(
                    execution,
                    step
                );

            step.finishedAt =
                new Date();

            step.durationMs =
                step.finishedAt -
                step.startedAt;

            await this.publishLifecycle(
                'saga.step.completed',
                execution,
                {
                    step
                }
            );

            this.incrementMetric(
                'saga.steps.completed'
            );

            return result;

        } catch (error) {
            step.finishedAt =
                new Date();

            step.durationMs =
                step.finishedAt -
                step.startedAt;

            step.error =
                this.serializeError(
                    error
                );

            await this.publishLifecycle(
                'saga.step.failed',
                execution,
                {
                    step,
                    error:
                        step.error
                }
            );

            this.incrementMetric(
                'saga.steps.failed'
            );

            throw error;

        } finally {
            this.endSpan(
                span
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Retryable Step Execution
     * -------------------------------------------------------------------------
     */

    async executeWithRetry(
        execution,
        step
    ) {
        const retryConfig =
            normalizeRetryConfig({
                ...this.config.retry,
                ...(step.retry || {})
            });

        const maxAttempts =
            positiveInteger(
                step.maxAttempts ||
                step.retries
                    ? (
                        Number(
                            step.maxAttempts ||
                            step.retries
                        ) + 1
                    )
                    : retryConfig.maxAttempts,
                retryConfig.maxAttempts
            );

        let attempt = 0;

        while (attempt < maxAttempts) {
            attempt++;

            step.attempts =
                attempt;

            try {
                return await this.executeStepAttempt(
                    execution,
                    step,
                    attempt
                );

            } catch (error) {
                const retryable =
                    retryConfig.enabled &&
                    attempt < maxAttempts &&
                    isRetryableError(error);

                if (!retryable) {
                    throw error;
                }

                step.state =
                    StepState.RETRYING;

                this.statistics.retries++;

                this.incrementMetric(
                    'saga.steps.retries'
                );

                const delay =
                    this.calculateRetryDelay(
                        attempt,
                        retryConfig
                    );

                await this.publishLifecycle(
                    'saga.step.retrying',
                    execution,
                    {
                        step,
                        attempt,
                        delay,
                        error:
                            this.serializeError(
                                error
                            )
                    }
                );

                this.logger.warn?.(
                    '[SagaExecutionEngine] Step retry scheduled',
                    {
                        executionId:
                            execution.executionId,
                        sagaId:
                            execution.sagaId,
                        stepId:
                            step.stepId,
                        attempt,
                        delay,
                        error:
                            error.message
                    }
                );

                await this.sleepWithCancellation(
                    delay,
                    execution
                );
            }
        }

        throw createExecutionError(
            'Saga step retry policy exhausted',
            'SAGA_RETRY_EXHAUSTED',
            {
                stepId:
                    step.stepId
            }
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Execute Step Attempt
     * -------------------------------------------------------------------------
     */

    async executeStepAttempt(
        execution,
        step,
        attempt
    ) {
        this.ensureNotCancelled(
            execution
        );

        const timeoutMs =
            positiveInteger(
                step.timeout ||
                step.timeoutMs,
                this.config.defaultTimeoutMs
            );

        const operation =
            this.resolveExecuteFunction(
                step
            );

        const stepContext =
            this.createStepContext(
                execution,
                step,
                attempt
            );

        const startedAt =
            Date.now();

        try {
            const result =
                await this.withTimeout(
                    Promise.resolve(
                        operation(
                            stepContext
                        )
                    ),
                    timeoutMs,
                    execution,
                    step
                );

            step.executionHistory.push({
                attempt,
                success: true,
                durationMs:
                    Date.now() - startedAt,
                timestamp:
                    new Date()
            });

            return result;

        } catch (error) {
            step.executionHistory.push({
                attempt,
                success: false,
                durationMs:
                    Date.now() - startedAt,
                error:
                    this.serializeError(
                        error
                    ),
                timestamp:
                    new Date()
            });

            throw error;
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Compensation
     * -------------------------------------------------------------------------
     */

    async compensate(
        execution,
        originalError
    ) {
        if (
            !this.config.compensation.enabled
        ) {
            return {
                attempted: false,
                compensated: false,
                failures: []
            };
        }

        if (
            execution.completedSteps.length === 0
        ) {
            return {
                attempted: false,
                compensated: true,
                failures: []
            };
        }

        execution.state =
            SagaState.COMPENSATING;

        await this.persistState(
            execution
        );

        await this.publishLifecycle(
            'saga.compensation.started',
            execution,
            {
                reason:
                    this.serializeError(
                        originalError
                    )
            }
        );

        this.incrementMetric(
            'saga.compensation.started'
        );

        let result;

        try {
            if (
                this.compensationOrchestrator
            ) {
                result =
                    await this.delegateCompensation(
                        execution,
                        originalError
                    );
            } else {
                result =
                    await this.executeLocalCompensation(
                        execution,
                        originalError
                    );
            }
        } catch (error) {
            result = {
                attempted: true,
                compensated: false,
                failures: [
                    {
                        stepId: null,
                        error:
                            this.serializeError(
                                error
                            )
                    }
                ]
            };
        }

        const failures =
            result.failures ||
            [];

        if (failures.length === 0) {
            execution.state =
                SagaState.COMPENSATED;

            this.statistics.compensated++;

            this.incrementMetric(
                'saga.compensation.completed'
            );

        } else {
            execution.state =
                SagaState.PARTIALLY_COMPENSATED;

            this.statistics.partiallyCompensated++;

            this.statistics.compensationFailures +=
                failures.length;

            this.incrementMetric(
                'saga.compensation.failed'
            );
        }

        execution.compensation =
            result;

        await this.persistState(
            execution
        );

        await this.publishLifecycle(
            failures.length === 0
                ? 'saga.compensation.completed'
                : 'saga.compensation.failed',
            execution,
            {
                compensation:
                    result
            }
        );

        await this.audit(
            failures.length === 0
                ? 'SAGA_COMPENSATED'
                : 'SAGA_COMPENSATION_FAILED',
            execution,
            {
                compensation:
                    result
            }
        );

        return result;
    }

    /**
     * -------------------------------------------------------------------------
     * Delegate Compensation
     * -------------------------------------------------------------------------
     */

    async delegateCompensation(
        execution,
        originalError
    ) {
        const orchestrator =
            this.compensationOrchestrator;

        const payload = {
            executionId:
                execution.executionId,

            sagaId:
                execution.sagaId,

            transactionId:
                execution.transactionId,

            context:
                execution.context,

            steps:
                execution.completedSteps,

            error:
                originalError
        };

        if (
            typeof orchestrator.compensate === 'function'
        ) {
            const result =
                await orchestrator.compensate(
                    payload
                );

            return this.normalizeCompensationResult(
                result
            );
        }

        if (
            typeof orchestrator.execute === 'function'
        ) {
            const result =
                await orchestrator.execute(
                    payload
                );

            return this.normalizeCompensationResult(
                result
            );
        }

        throw createExecutionError(
            'Compensation orchestrator does not expose compensate() or execute()',
            'INVALID_COMPENSATION_ORCHESTRATOR'
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Local Compensation
     * -------------------------------------------------------------------------
     */

    async executeLocalCompensation(
        execution,
        originalError
    ) {
        const failures = [];
        const completed =
            [...execution.completedSteps]
                .reverse();

        for (const step of completed) {
            if (
                typeof step.compensate !== 'function'
            ) {
                step.state =
                    StepState.SKIPPED;

                continue;
            }

            step.state =
                StepState.COMPENSATING;

            try {
                const result =
                    await this.withTimeout(
                        Promise.resolve(
                            step.compensate(
                                this.createCompensationContext(
                                    execution,
                                    step,
                                    originalError
                                )
                            )
                        ),
                        this.config.compensation.timeoutMs,
                        execution,
                        step
                    );

                step.compensationResult =
                    result;

                step.compensatedAt =
                    new Date();

                step.state =
                    StepState.COMPENSATED;

            } catch (error) {
                step.state =
                    StepState.COMPENSATION_FAILED;

                const failure = {
                    stepId:
                        step.stepId,

                    name:
                        step.name,

                    error:
                        this.serializeError(
                            error
                        )
                };

                failures.push(
                    failure
                );

                this.logger.error?.(
                    '[SagaExecutionEngine] Compensation failed',
                    {
                        executionId:
                            execution.executionId,
                        stepId:
                            step.stepId,
                        error:
                            error.message
                    }
                );

                if (
                    !this.config.compensation.continueOnFailure
                ) {
                    break;
                }
            }
        }

        return {
            attempted: true,
            compensated:
                failures.length === 0,
            failures
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Failure Handling
     * -------------------------------------------------------------------------
     */

    async handleExecutionFailure(
        execution,
        error
    ) {
        execution.error =
            this.serializeError(
                error
            );

        execution.failureCategory =
            this.classifyFailure(
                error
            );

        if (
            execution.failureCategory ===
            FailureCategory.ABORTED
        ) {
            execution.state =
                SagaState.CANCELLED;

            this.statistics.cancelled++;

            this.incrementMetric(
                'saga.executions.cancelled'
            );

        } else if (
            execution.failureCategory ===
            FailureCategory.TIMEOUT
        ) {
            execution.state =
                SagaState.TIMED_OUT;

            this.statistics.timedOut++;

            this.incrementMetric(
                'saga.executions.timeout'
            );

        } else {
            this.statistics.failed++;

            this.incrementMetric(
                'saga.executions.failed'
            );
        }

        await this.persistState(
            execution
        );

        let compensation = null;

        if (
            execution.completedSteps.length > 0 &&
            this.config.compensation.enabled &&
            execution.state !== SagaState.CANCELLED
        ) {
            compensation =
                await this.compensate(
                    execution,
                    error
                );
        }

        execution.finishedAt =
            new Date();

        execution.durationMs =
            execution.startedAt
                ? execution.finishedAt -
                  execution.startedAt
                : null;

        await this.persistState(
            execution
        );

        await this.publishLifecycle(
            'saga.failed',
            execution,
            {
                error:
                    execution.error,

                compensation
            }
        );

        await this.audit(
            'SAGA_FAILED',
            execution,
            {
                error:
                    execution.error,

                compensation
            }
        );

        const result =
            this.buildFailureResult(
                execution,
                compensation
            );

        if (
            this.config.strictMode
        ) {
            const finalError =
                this.createSagaFailureError(
                    execution,
                    error,
                    compensation
                );

            finalError.result =
                result;

            throw finalError;
        }

        return result;
    }

    /**
     * -------------------------------------------------------------------------
     * Create Saga Failure Error
     * -------------------------------------------------------------------------
     */

    createSagaFailureError(
        execution,
        originalError,
        compensation
    ) {
        const error =
            new Error(
                `Saga execution failed: ${originalError.message}`
            );

        error.name =
            'SagaExecutionError';

        error.code =
            'SAGA_EXECUTION_FAILED';

        error.cause =
            originalError;

        error.executionId =
            execution.executionId;

        error.sagaId =
            execution.sagaId;

        error.transactionId =
            execution.transactionId;

        error.state =
            execution.state;

        error.compensation =
            compensation;

        return error;
    }

    /**
     * -------------------------------------------------------------------------
     * Create Execution Record
     * -------------------------------------------------------------------------
     */

    createExecutionRecord(
        definition,
        context,
        request,
        options
    ) {
        const startedAt =
            new Date();

        return {
            executionId:
                request.executionId,

            sagaId:
                request.sagaId,

            transactionId:
                request.transactionId,

            tenantId:
                request.tenantId,

            correlationId:
                request.correlationId,

            idempotencyKey:
                request.idempotencyKey,

            state:
                SagaState.CREATED,

            definition,

            context,

            options,

            startedAt,

            finishedAt: null,

            durationMs: null,

            steps: [],

            completedSteps: [],

            compensation: null,

            error: null,

            failureCategory: null
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Create Step Record
     * -------------------------------------------------------------------------
     */

    createStepRecord(
        step,
        index
    ) {
        const stepId =
            step.stepId ||
            step.id ||
            `step-${index + 1}`;

        return {
            stepId,

            name:
                step.name ||
                step.operationName ||
                stepId,

            index,

            execute:
                step.execute ||
                step.action ||
                step.handler,

            compensate:
                step.compensate ||
                step.rollback ||
                step.undo,

            timeout:
                step.timeout ||
                step.timeoutMs ||
                this.config.defaultTimeoutMs,

            retries:
                step.retries ??
                0,

            maxAttempts:
                step.maxAttempts,

            retry:
                step.retry || {},

            metadata:
                step.metadata || {},

            state:
                StepState.PENDING,

            attempts: 0,

            executionHistory: [],

            result: undefined,

            compensationResult:
                undefined,

            startedAt: null,

            finishedAt: null,

            compensatedAt: null,

            durationMs: null,

            error: null
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Resolve Saga Steps
     * -------------------------------------------------------------------------
     */

    resolveSteps(
        definition
    ) {
        if (
            Array.isArray(
                definition
            )
        ) {
            return definition;
        }

        if (
            Array.isArray(
                definition?.steps
            )
        ) {
            return definition.steps;
        }

        if (
            typeof definition?.getSteps === 'function'
        ) {
            return definition.getSteps();
        }

        if (
            typeof definition?.getOperations === 'function'
        ) {
            return definition.getOperations();
        }

        throw createExecutionError(
            'Saga definition does not expose executable steps',
            'INVALID_SAGA_DEFINITION'
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Resolve Execute Function
     * -------------------------------------------------------------------------
     */

    resolveExecuteFunction(
        step
    ) {
        if (
            typeof step.execute === 'function'
        ) {
            return step.execute;
        }

        if (
            typeof step.action === 'function'
        ) {
            return step.action;
        }

        if (
            typeof step.handler === 'function'
        ) {
            return step.handler;
        }

        throw createExecutionError(
            `Saga step ${step.stepId} does not implement execute()`,
            'INVALID_SAGA_STEP',
            {
                stepId:
                    step.stepId
            }
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Create Step Context
     * -------------------------------------------------------------------------
     */

    createStepContext(
        execution,
        step,
        attempt
    ) {
        const baseContext =
            execution.context;

        const context = {
            ...baseContext,

            executionId:
                execution.executionId,

            sagaId:
                execution.sagaId,

            transactionId:
                execution.transactionId,

            tenantId:
                execution.tenantId,

            correlationId:
                execution.correlationId,

            stepId:
                step.stepId,

            stepName:
                step.name,

            attempt,

            metadata:
                step.metadata,

            saga: execution,

            signal:
                execution.abortController?.signal ||
                execution.options?.signal ||
                null
        };

        /**
         * Preserve a TransactionContext's methods/prototype where possible by
         * attaching execution metadata rather than replacing the object.
         */
        if (
            baseContext &&
            typeof baseContext === 'object'
        ) {
            Object.defineProperty(
                context,
                'transactionContext',
                {
                    value:
                        baseContext,
                    enumerable: false,
                    configurable: true
                }
            );
        }

        return context;
    }

    /**
     * -------------------------------------------------------------------------
     * Create Compensation Context
     * -------------------------------------------------------------------------
     */

    createCompensationContext(
        execution,
        step,
        originalError
    ) {
        return {
            executionId:
                execution.executionId,

            sagaId:
                execution.sagaId,

            transactionId:
                execution.transactionId,

            tenantId:
                execution.tenantId,

            correlationId:
                execution.correlationId,

            stepId:
                step.stepId,

            stepName:
                step.name,

            context:
                execution.context,

            result:
                step.result,

            originalError,

            signal:
                execution.abortController?.signal ||
                null
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Timeout Protection
     * -------------------------------------------------------------------------
     */

    async withTimeout(
        promise,
        timeoutMs,
        execution,
        step
    ) {
        const timeout =
            positiveInteger(
                timeoutMs,
                this.config.defaultTimeoutMs
            );

        let timer = null;

        const timeoutPromise =
            new Promise(
                (_, reject) => {
                    timer =
                        setTimeout(
                            () => {
                                const error =
                                    createExecutionError(
                                        `Saga step timed out after ${timeout} ms`,
                                        'SAGA_STEP_TIMEOUT',
                                        {
                                            executionId:
                                                execution.executionId,

                                            stepId:
                                                step?.stepId,

                                            timeoutMs:
                                                timeout
                                        }
                                    );

                                error.retryable =
                                    true;

                                reject(
                                    error
                                );
                            },
                            timeout
                        );
                }
            );

        try {
            return await Promise.race([
                promise,
                timeoutPromise
            ]);
        } finally {
            if (timer) {
                clearTimeout(
                    timer
                );
            }
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Retry Delay
     * -------------------------------------------------------------------------
     */

    calculateRetryDelay(
        attempt,
        config
    ) {
        const exponential =
            config.initialDelayMs *
            Math.pow(
                config.backoffFactor,
                Math.max(
                    0,
                    attempt - 1
                )
            );

        const bounded =
            Math.min(
                exponential,
                config.maxDelayMs
            );

        const jitter =
            bounded *
            config.jitterRatio *
            Math.random();

        return Math.floor(
            bounded + jitter
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Sleep With Cancellation
     * -------------------------------------------------------------------------
     */

    async sleepWithCancellation(
        ms,
        execution
    ) {
        this.ensureNotCancelled(
            execution
        );

        const signal =
            execution.abortController?.signal ||
            execution.options?.signal;

        if (!signal) {
            await sleep(ms);
            return;
        }

        if (signal.aborted) {
            throw this.createAbortError();
        }

        await new Promise(
            (resolve, reject) => {
                let timer = null;

                const onAbort = () => {
                    if (timer) {
                        clearTimeout(
                            timer
                        );
                    }

                    signal.removeEventListener(
                        'abort',
                        onAbort
                    );

                    reject(
                        this.createAbortError()
                    );
                };

                signal.addEventListener(
                    'abort',
                    onAbort,
                    {
                        once: true
                    }
                );

                timer =
                    setTimeout(
                        () => {
                            signal.removeEventListener(
                                'abort',
                                onAbort
                            );

                            resolve();
                        },
                        ms
                    );
            }
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Cancellation
     * -------------------------------------------------------------------------
     */

    cancel(
        executionId,
        reason = 'Saga execution cancelled'
    ) {
        const execution =
            this.activeExecutions.get(
                executionId
            );

        if (!execution) {
            return false;
        }

        execution.cancelled = true;
        execution.cancelReason =
            reason;

        if (
            execution.abortController
        ) {
            execution.abortController.abort();
        }

        return true;
    }

    /**
     * -------------------------------------------------------------------------
     * Ensure Not Cancelled
     * -------------------------------------------------------------------------
     */

    ensureNotCancelled(
        execution
    ) {
        if (
            execution.cancelled
        ) {
            throw this.createAbortError(
                execution.cancelReason
            );
        }

        if (
            execution.abortController?.signal?.aborted
        ) {
            throw this.createAbortError();
        }

        if (
            execution.options?.signal?.aborted
        ) {
            throw this.createAbortError();
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Abort Error
     * -------------------------------------------------------------------------
     */

    createAbortError(
        message = 'Saga execution aborted'
    ) {
        const error =
            new Error(message);

        error.name =
            'AbortError';

        error.code =
            'ABORT_ERR';

        error.retryable =
            false;

        return error;
    }

    /**
     * -------------------------------------------------------------------------
     * Validation
     * -------------------------------------------------------------------------
     */

    validateDefinition(
        definition
    ) {
        if (!definition) {
            throw createExecutionError(
                'Saga definition is required',
                'INVALID_SAGA_DEFINITION'
            );
        }

        const steps =
            this.resolveSteps(
                definition
            );

        if (
            !Array.isArray(steps) ||
            steps.length === 0
        ) {
            throw createExecutionError(
                'Saga must contain at least one step',
                'INVALID_SAGA_DEFINITION'
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Validate Context
     * -------------------------------------------------------------------------
     */

    validateContext(
        context
    ) {
        if (!context) {
            throw createExecutionError(
                'Saga execution context is required',
                'INVALID_SAGA_CONTEXT'
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Validate Request
     * -------------------------------------------------------------------------
     */

    validateRequest(
        request
    ) {
        const errors = [];

        if (!request.executionId) {
            errors.push(
                'executionId is required'
            );
        }

        if (!request.sagaId) {
            errors.push(
                'sagaId is required'
            );
        }

        if (!request.tenantId) {
            errors.push(
                'tenantId is required'
            );
        }

        if (!request.transactionId) {
            errors.push(
                'transactionId is required'
            );
        }

        if (errors.length > 0) {
            throw createExecutionError(
                'Invalid Saga execution request',
                'INVALID_SAGA_REQUEST',
                {
                    errors
                }
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Validate Step
     * -------------------------------------------------------------------------
     */

    validateStep(
        step
    ) {
        if (!step?.stepId) {
            throw createExecutionError(
                'Saga step ID is required',
                'INVALID_SAGA_STEP'
            );
        }

        if (
            typeof step.execute !== 'function'
        ) {
            throw createExecutionError(
                `Saga step ${step.stepId} has no execute function`,
                'INVALID_SAGA_STEP',
                {
                    stepId:
                        step.stepId
                }
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Consistency Validation
     * -------------------------------------------------------------------------
     */

    async validateConsistency(
        phase,
        execution
    ) {
        if (
            !this.consistencyValidator
        ) {
            return true;
        }

        const payload = {
            phase,

            executionId:
                execution.executionId,

            sagaId:
                execution.sagaId,

            transactionId:
                execution.transactionId,

            tenantId:
                execution.tenantId,

            context:
                execution.context,

            steps:
                execution.steps
        };

        let result;

        if (
            typeof this.consistencyValidator.validate ===
            'function'
        ) {
            result =
                await this.consistencyValidator.validate(
                    payload
                );
        } else if (
            typeof this.consistencyValidator.validateConsistency ===
            'function'
        ) {
            result =
                await this.consistencyValidator.validateConsistency(
                    payload
                );
        } else {
            return true;
        }

        if (
            result === false ||
            result?.valid === false
        ) {
            throw createExecutionError(
                `Saga consistency validation failed during ${phase} phase`,
                'CONSISTENCY_VALIDATION_FAILED',
                {
                    phase,
                    result
                }
            );
        }

        return result;
    }

    /**
     * -------------------------------------------------------------------------
     * Idempotency
     * -------------------------------------------------------------------------
     */

    acquireExecutionLock(
        request
    ) {
        if (
            !this.config.idempotency.enabled
        ) {
            return;
        }

        const key =
            request.idempotencyKey;

        if (
            this.executionLocks.has(key)
        ) {
            throw createExecutionError(
                'Duplicate Saga execution detected',
                'IDEMPOTENCY_CONFLICT',
                {
                    idempotencyKey:
                        key
                }
            );
        }

        if (
            this.config.idempotency.rejectDuplicateExecution &&
            this.completedExecutions.has(key)
        ) {
            throw createExecutionError(
                'Saga has already completed for the supplied idempotency key',
                'IDEMPOTENCY_CONFLICT',
                {
                    idempotencyKey:
                        key
                }
            );
        }

        this.executionLocks.set(
            key,
            {
                acquiredAt:
                    new Date(),

                executionId:
                    request.executionId,

                transactionId:
                    request.transactionId
            }
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Release Lock
     * -------------------------------------------------------------------------
     */

    releaseExecutionLock(
        idempotencyKey
    ) {
        if (!idempotencyKey) {
            return false;
        }

        return this.executionLocks.delete(
            idempotencyKey
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Mark Completed
     * -------------------------------------------------------------------------
     */

    markCompleted(
        execution
    ) {
        if (
            !this.config.idempotency.enabled
        ) {
            return;
        }

        this.completedExecutions.set(
            execution.idempotencyKey,
            {
                executionId:
                    execution.executionId,

                transactionId:
                    execution.transactionId,

                completedAt:
                    new Date(),

                state:
                    execution.state
            }
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Persist State
     * -------------------------------------------------------------------------
     */

    async persistState(
        execution
    ) {
        if (
            !this.config.lifecycle.persistState
        ) {
            return;
        }

        if (
            !this.repository
        ) {
            return;
        }

        const payload =
            this.buildPersistencePayload(
                execution
            );

        if (
            typeof this.repository.saveExecution ===
            'function'
        ) {
            await this.repository.saveExecution(
                payload
            );
            return;
        }

        if (
            typeof this.repository.updateExecution ===
            'function'
        ) {
            await this.repository.updateExecution(
                execution.executionId,
                payload
            );
            return;
        }

        if (
            typeof this.repository.save ===
            'function'
        ) {
            await this.repository.save(
                payload
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Persistence Payload
     * -------------------------------------------------------------------------
     */

    buildPersistencePayload(
        execution
    ) {
        return {
            executionId:
                execution.executionId,

            sagaId:
                execution.sagaId,

            transactionId:
                execution.transactionId,

            tenantId:
                execution.tenantId,

            correlationId:
                execution.correlationId,

            idempotencyKey:
                execution.idempotencyKey,

            state:
                execution.state,

            startedAt:
                execution.startedAt,

            finishedAt:
                execution.finishedAt,

            durationMs:
                execution.durationMs,

            steps:
                execution.steps.map(
                    step => ({
                        stepId:
                            step.stepId,

                        name:
                            step.name,

                        index:
                            step.index,

                        state:
                            step.state,

                        attempts:
                            step.attempts,

                        startedAt:
                            step.startedAt,

                        finishedAt:
                            step.finishedAt,

                        compensatedAt:
                            step.compensatedAt,

                        durationMs:
                            step.durationMs,

                        error:
                            step.error
                    })
                ),

            completedSteps:
                execution.completedSteps.map(
                    step => step.stepId
                ),

            compensation:
                execution.compensation,

            error:
                execution.error,

            failureCategory:
                execution.failureCategory,

            updatedAt:
                new Date()
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Lifecycle Publishing
     * -------------------------------------------------------------------------
     */

    async publishLifecycle(
        eventType,
        execution,
        extra = {}
    ) {
        if (
            !this.config.lifecycle.publishEvents
        ) {
            return;
        }

        const payload = {
            eventType,

            executionId:
                execution.executionId,

            sagaId:
                execution.sagaId,

            transactionId:
                execution.transactionId,

            tenantId:
                execution.tenantId,

            correlationId:
                execution.correlationId,

            state:
                execution.state,

            timestamp:
                new Date(),

            source:
                'SagaExecutionEngine',

            ...extra
        };

        try {
            if (
                this.eventPublisher &&
                typeof this.eventPublisher.publish ===
                'function'
            ) {
                await this.eventPublisher.publish(
                    payload
                );
            }
        } catch (error) {
            this.incrementMetric(
                'saga.lifecycle.publish_failures'
            );

            this.logger.error?.(
                '[SagaExecutionEngine] Lifecycle event publication failed',
                {
                    eventType,
                    executionId:
                        execution.executionId,
                    error:
                        error.message
                }
            );

            if (
                this.config.strictMode &&
                this.config.observability.auditEnabled
            ) {
                throw error;
            }
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Audit
     * -------------------------------------------------------------------------
     */

    async audit(
        type,
        execution,
        extra = {}
    ) {
        if (
            !this.config.observability.auditEnabled
        ) {
            return;
        }

        if (
            !this.auditPublisher
        ) {
            return;
        }

        const record = {
            type,

            executionId:
                execution.executionId,

            sagaId:
                execution.sagaId,

            transactionId:
                execution.transactionId,

            tenantId:
                execution.tenantId,

            correlationId:
                execution.correlationId,

            state:
                execution.state,

            timestamp:
                new Date(),

            source:
                'SagaExecutionEngine',

            ...extra
        };

        if (
            typeof this.auditPublisher.publish ===
            'function'
        ) {
            await this.auditPublisher.publish(
                record
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Metrics
     * -------------------------------------------------------------------------
     */

    incrementMetric(
        name,
        value = 1
    ) {
        if (
            !this.config.observability.metricsEnabled
        ) {
            return;
        }

        try {
            if (
                typeof this.metrics?.increment ===
                'function'
            ) {
                this.metrics.increment(
                    name,
                    value
                );
            } else if (
                typeof this.metrics?.inc ===
                'function'
            ) {
                this.metrics.inc(
                    name,
                    value
                );
            }
        } catch (error) {
            this.logger.warn?.(
                '[SagaExecutionEngine] Metric increment failed',
                {
                    metric:
                        name,
                    error:
                        error.message
                }
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Duration Metric
     * -------------------------------------------------------------------------
     */

    recordDuration(
        name,
        value
    ) {
        if (
            !this.config.observability.metricsEnabled
        ) {
            return;
        }

        try {
            if (
                typeof this.metrics?.observe ===
                'function'
            ) {
                this.metrics.observe(
                    name,
                    value
                );
            } else if (
                typeof this.metrics?.histogram ===
                'function'
            ) {
                this.metrics.histogram(
                    name,
                    value
                );
            }
        } catch (error) {
            this.logger.warn?.(
                '[SagaExecutionEngine] Duration metric failed',
                {
                    metric:
                        name,
                    error:
                        error.message
                }
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Tracing
     * -------------------------------------------------------------------------
     */

    startSpan(
        name,
        execution,
        attributes = {}
    ) {
        if (
            !this.config.observability.tracingEnabled
        ) {
            return null;
        }

        if (
            !this.tracer
        ) {
            return null;
        }

        try {
            const spanAttributes = {
                sagaId:
                    execution?.sagaId,

                executionId:
                    execution?.executionId,

                transactionId:
                    execution?.transactionId,

                tenantId:
                    execution?.tenantId,

                correlationId:
                    execution?.correlationId,

                ...attributes
            };

            if (
                typeof this.tracer.startSpan ===
                'function'
            ) {
                return this.tracer.startSpan(
                    name,
                    {
                        attributes:
                            spanAttributes
                    }
                );
            }

            if (
                typeof this.tracer.start ===
                'function'
            ) {
                return this.tracer.start(
                    name,
                    spanAttributes
                );
            }
        } catch (error) {
            this.logger.warn?.(
                '[SagaExecutionEngine] Trace span creation failed',
                {
                    name,
                    error:
                        error.message
                }
            );
        }

        return null;
    }

    /**
     * -------------------------------------------------------------------------
     * End Span
     * -------------------------------------------------------------------------
     */

    endSpan(
        span
    ) {
        if (!span) {
            return;
        }

        try {
            span.setStatus?.({
                code: 1
            });

            span.end?.();
        } catch (error) {
            this.logger.warn?.(
                '[SagaExecutionEngine] Trace span finalization failed',
                {
                    error:
                        error.message
                }
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Failure Classification
     * -------------------------------------------------------------------------
     */

    classifyFailure(
        error
    ) {
        if (!error) {
            return FailureCategory.UNKNOWN;
        }

        if (
            error.code === 'ABORT_ERR' ||
            error.name === 'AbortError'
        ) {
            return FailureCategory.ABORTED;
        }

        if (
            error.code === 'SAGA_STEP_TIMEOUT' ||
            error.code === 'SAGA_TIMEOUT'
        ) {
            return FailureCategory.TIMEOUT;
        }

        if (
            error.code === 'CONSISTENCY_VALIDATION_FAILED'
        ) {
            return FailureCategory.CONSISTENCY;
        }

        if (
            error.code === 'IDEMPOTENCY_CONFLICT'
        ) {
            return FailureCategory.IDEMPOTENCY;
        }

        if (
            error.code === 'INVALID_SAGA_DEFINITION' ||
            error.code === 'INVALID_SAGA_CONTEXT' ||
            error.code === 'INVALID_SAGA_REQUEST' ||
            error.code === 'INVALID_SAGA_STEP'
        ) {
            return FailureCategory.VALIDATION;
        }

        if (
            error.code === 'COMPENSATION_FAILED'
        ) {
            return FailureCategory.COMPENSATION;
        }

        if (
            error.code === 'SERVICE_UNAVAILABLE' ||
            error.code === 'DEPENDENCY_FAILURE'
        ) {
            return FailureCategory.DEPENDENCY;
        }

        return FailureCategory.EXECUTION;
    }

    /**
     * -------------------------------------------------------------------------
     * Attach Step Failure
     * -------------------------------------------------------------------------
     */

    attachStepFailure(
        error,
        step
    ) {
        if (!error) {
            return error;
        }

        error.stepId =
            step.stepId;

        error.stepName =
            step.name;

        error.stepIndex =
            step.index;

        error.stepAttempts =
            step.attempts;

        return error;
    }

    /**
     * -------------------------------------------------------------------------
     * Normalize Compensation Result
     * -------------------------------------------------------------------------
     */

    normalizeCompensationResult(
        result
    ) {
        if (!result) {
            return {
                attempted: true,
                compensated: true,
                failures: []
            };
        }

        if (
            Array.isArray(result)
        ) {
            return {
                attempted: true,
                compensated: true,
                failures: [],
                results: result
            };
        }

        return {
            attempted:
                result.attempted !== false,

            compensated:
                result.compensated !== false &&
                (
                    !Array.isArray(
                        result.failures
                    ) ||
                    result.failures.length === 0
                ),

            failures:
                Array.isArray(
                    result.failures
                )
                    ? result.failures
                    : [],

            results:
                result.results || null
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Ensure Engine Enabled
     * -------------------------------------------------------------------------
     */

    ensureEnabled() {
        if (
            this.config.enabled !== true
        ) {
            throw createExecutionError(
                'Saga execution engine is disabled',
                'SAGA_ENGINE_DISABLED'
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Serialize Error
     * -------------------------------------------------------------------------
     */

    serializeError(
        error
    ) {
        if (!error) {
            return null;
        }

        return {
            name:
                error.name ||
                'Error',

            message:
                error.message ||
                String(error),

            code:
                error.code ||
                null,

            retryable:
                error.retryable ??
                null,

            stepId:
                error.stepId ||
                null,

            timestamp:
                error.timestamp ||
                new Date()
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Build Successful Result
     * -------------------------------------------------------------------------
     */

    buildResult(
        execution,
        result
    ) {
        return {
            success: true,

            executionId:
                execution.executionId,

            sagaId:
                execution.sagaId,

            transactionId:
                execution.transactionId,

            tenantId:
                execution.tenantId,

            correlationId:
                execution.correlationId,

            state:
                execution.state,

            completedSteps:
                execution.completedSteps.length,

            totalSteps:
                execution.steps.length,

            durationMs:
                execution.durationMs,

            results:
                result,

            timestamp:
                new Date().toISOString()
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Build Failure Result
     * -------------------------------------------------------------------------
     */

    buildFailureResult(
        execution,
        compensation
    ) {
        return {
            success: false,

            executionId:
                execution.executionId,

            sagaId:
                execution.sagaId,

            transactionId:
                execution.transactionId,

            tenantId:
                execution.tenantId,

            correlationId:
                execution.correlationId,

            state:
                execution.state,

            failureCategory:
                execution.failureCategory,

            error:
                execution.error,

            completedSteps:
                execution.completedSteps.length,

            totalSteps:
                execution.steps.length,

            compensation,

            durationMs:
                execution.durationMs,

            timestamp:
                new Date().toISOString()
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Get Execution
     * -------------------------------------------------------------------------
     */

    getExecution(
        executionId
    ) {
        return this.activeExecutions.get(
            executionId
        ) || null;
    }

    /**
     * -------------------------------------------------------------------------
     * Get Status
     * -------------------------------------------------------------------------
     */

    getStatus(
        executionId
    ) {
        const execution =
            this.getExecution(
                executionId
            );

        if (!execution) {
            return null;
        }

        return {
            executionId:
                execution.executionId,

            sagaId:
                execution.sagaId,

            transactionId:
                execution.transactionId,

            tenantId:
                execution.tenantId,

            correlationId:
                execution.correlationId,

            state:
                execution.state,

            startedAt:
                execution.startedAt,

            finishedAt:
                execution.finishedAt,

            durationMs:
                execution.durationMs,

            steps:
                execution.steps.map(
                    step => ({
                        stepId:
                            step.stepId,

                        name:
                            step.name,

                        state:
                            step.state,

                        attempts:
                            step.attempts,

                        durationMs:
                            step.durationMs
                    })
                ),

            compensation:
                execution.compensation,

            error:
                execution.error
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Health
     * -------------------------------------------------------------------------
     */

    getHealth() {
        return {
            status:
                this.config.enabled
                    ? 'READY'
                    : 'DISABLED',

            activeExecutions:
                this.activeExecutions.size,

            executionLocks:
                this.executionLocks.size,

            completedIdempotencyKeys:
                this.completedExecutions.size,

            statistics: {
                ...this.statistics
            }
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Shutdown
     * -------------------------------------------------------------------------
     *
     * Prevents new work while allowing callers to inspect active executions.
     * Existing execution cancellation remains explicit.
     * -------------------------------------------------------------------------
     */

    async shutdown(options = {}) {
        const cancel =
            options.cancel === true;

        if (cancel) {
            for (
                const executionId of
                this.activeExecutions.keys()
            ) {
                this.cancel(
                    executionId,
                    options.reason ||
                    'Saga engine shutting down'
                );
            }
        }

        if (
            options.waitForCompletion
        ) {
            const timeoutMs =
                positiveInteger(
                    options.timeoutMs,
                    30000
                );

            const started =
                Date.now();

            while (
                this.activeExecutions.size > 0 &&
                Date.now() - started <
                    timeoutMs
            ) {
                await sleep(50);
            }
        }

        return {
            activeExecutions:
                this.activeExecutions.size,

            shutdownComplete:
                this.activeExecutions.size === 0
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Sleep
     * -------------------------------------------------------------------------
     */

    async sleep(
        ms
    ) {
        await sleep(
            ms
        );
    }
}

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports = SagaExecutionEngine;

module.exports.SagaExecutionEngine =
    SagaExecutionEngine;

module.exports.SagaState =
    SagaState;

module.exports.StepState =
    StepState;

module.exports.FailureCategory =
    FailureCategory;