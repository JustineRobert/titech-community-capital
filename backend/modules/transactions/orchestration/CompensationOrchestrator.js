"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Compensation Orchestrator
 * ============================================================================
 * Enterprise Distributed Transaction Compensation Engine
 * ============================================================================
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - Deterministic compensation execution
 * - Saga-style rollback orchestration
 * - Reverse-order compensation
 * - Compensation idempotency
 * - Retry with exponential backoff
 * - Execution timeout protection
 * - Compensation state machine
 * - Partial compensation failure handling
 * - Compensation dependency handling
 * - Audit correlation
 * - Structured operational logging
 * - Failure classification
 * - Recovery / resume support
 * - Safe duplicate execution prevention
 * - Transaction context propagation
 * - Extensible event / audit integration
 *
 * Design Principles
 * ----------------------------------------------------------------------------
 * - Never silently swallow compensation failures
 * - Never compensate the same operation twice
 * - Never mutate the original transaction
 * - Compensation must be independently traceable
 * - Compensation must be retryable
 * - Compensation must be observable
 * - Compensation must be deterministic
 *
 * Compatible with:
 * ----------------------------------------------------------------------------
 * - DistributedTransactionManager
 * - TransactionEventPublisher
 * - Outbox/Event infrastructure
 * - AuditCorrelationManager
 * - Ledger reversal services
 * - Payment rollback services
 * - Loan disbursement reversal services
 *
 * ============================================================================
 */

const crypto = require("crypto");

/**
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

const COMPENSATION_STATUS = Object.freeze({
    PENDING: "PENDING",
    RUNNING: "RUNNING",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
    RETRYING: "RETRYING",
    SKIPPED: "SKIPPED",
    CANCELLED: "CANCELLED",
    PARTIAL: "PARTIAL",
});

const COMPENSATION_RESULT = Object.freeze({
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
    SKIPPED: "SKIPPED",
});

const COMPENSATION_STRATEGY = Object.freeze({
    REVERSE_ORDER: "REVERSE_ORDER",
    FORWARD_ORDER: "FORWARD_ORDER",
    DEPENDENCY_ORDER: "DEPENDENCY_ORDER",
});

const FAILURE_TYPE = Object.freeze({
    TRANSIENT: "TRANSIENT",
    PERMANENT: "PERMANENT",
    TIMEOUT: "TIMEOUT",
    VALIDATION: "VALIDATION",
    IDEMPOTENCY: "IDEMPOTENCY",
    UNKNOWN: "UNKNOWN",
});

/**
 * ============================================================================
 * ERROR TYPES
 * ============================================================================
 */

class CompensationError extends Error {
    constructor(message, options = {}) {
        super(message);

        this.name = "CompensationError";

        this.code =
            options.code ||
            "COMPENSATION_ERROR";

        this.failureType =
            options.failureType ||
            FAILURE_TYPE.UNKNOWN;

        this.transactionId =
            options.transactionId ||
            null;

        this.compensationId =
            options.compensationId ||
            null;

        this.operationId =
            options.operationId ||
            null;

        this.retryable =
            Boolean(options.retryable);

        this.cause =
            options.cause ||
            null;

        Error.captureStackTrace?.(
            this,
            CompensationError
        );
    }
}

/**
 * ============================================================================
 * UTILITY HELPERS
 * ============================================================================
 */

function safeString(value, fallback = null) {
    if (
        value === undefined ||
        value === null
    ) {
        return fallback;
    }

    return String(value);
}

function safeNumber(value, fallback = 0) {
    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}

function clamp(value, min, max) {
    return Math.min(
        Math.max(value, min),
        max
    );
}

function serializeError(error) {
    if (!error) {
        return null;
    }

    return {
        name: error.name,
        message: error.message,
        code: error.code,
        failureType:
            error.failureType ||
            FAILURE_TYPE.UNKNOWN,
        retryable:
            Boolean(error.retryable),
        stack:
            process.env.NODE_ENV ===
            "production"
                ? undefined
                : error.stack,
    };
}

/**
 * ============================================================================
 * COMPENSATION ORCHESTRATOR
 * ============================================================================
 */

class CompensationOrchestrator {
    constructor(options = {}) {
        this.config = {
            maxRetries:
                safeNumber(
                    options.maxRetries,
                    3
                ),

            baseRetryDelayMs:
                safeNumber(
                    options.baseRetryDelayMs,
                    500
                ),

            maxRetryDelayMs:
                safeNumber(
                    options.maxRetryDelayMs,
                    10000
                ),

            defaultTimeoutMs:
                safeNumber(
                    options.defaultTimeoutMs,
                    30000
                ),

            maxTimeoutMs:
                safeNumber(
                    options.maxTimeoutMs,
                    120000
                ),

            strategy:
                options.strategy ||
                COMPENSATION_STRATEGY.REVERSE_ORDER,

            continueOnFailure:
                options.continueOnFailure ===
                undefined
                    ? true
                    : Boolean(
                          options.continueOnFailure
                      ),

            enableJitter:
                options.enableJitter ===
                undefined
                    ? true
                    : Boolean(
                          options.enableJitter
                      ),

            idempotencyCacheTtlMs:
                safeNumber(
                    options.idempotencyCacheTtlMs,
                    3600000
                ),

            maxOperations:
                safeNumber(
                    options.maxOperations,
                    100
                ),

            logger:
                options.logger ||
                console,

            auditManager:
                options.auditManager ||
                null,

            eventPublisher:
                options.eventPublisher ||
                null,

            persistence:
                options.persistence ||
                null,
        };

        /**
         * In-process protection.
         *
         * This is NOT the authoritative distributed idempotency mechanism.
         * A distributed persistence implementation should be supplied in
         * production when multiple application instances are running.
         */
        this.executionRegistry = new Map();

        this.compensationRegistry =
            new Map();
    }

    /**
     * =========================================================================
     * MAIN ENTRYPOINT
     * =========================================================================
     *
     * Compensates completed transaction operations in deterministic order.
     *
     * Expected operation structure:
     *
     * {
     *     operationId,
     *     name,
     *     compensate: async (context) => {},
     *     metadata,
     *     dependencies: []
     * }
     *
     */
    async compensate(transactionContext, operations = [], options = {}) {
        const context =
            this.normalizeTransactionContext(
                transactionContext
            );

        this.validateOperations(
            operations
        );

        const compensationId =
            safeString(
                options.compensationId,
                crypto.randomUUID()
            );

        const strategy =
            options.strategy ||
            this.config.strategy;

        const idempotencyKey =
            options.idempotencyKey ||
            this.buildIdempotencyKey(
                context.transactionId,
                compensationId,
                operations
            );

        /**
         * Distributed idempotency check.
         */
        const existing =
            await this.getExistingCompensation(
                idempotencyKey
            );

        if (existing) {
            this.log(
                "warn",
                "Compensation request already exists",
                {
                    transactionId:
                        context.transactionId,
                    compensationId,
                    idempotencyKey,
                }
            );

            return existing;
        }

        /**
         * Prevent concurrent local execution.
         */
        if (
            this.executionRegistry.has(
                idempotencyKey
            )
        ) {
            return this.executionRegistry.get(
                idempotencyKey
            );
        }

        const executionPromise =
            this.executeCompensation(
                {
                    ...context,
                    compensationId,
                    idempotencyKey,
                    strategy,
                },
                operations,
                options
            );

        this.executionRegistry.set(
            idempotencyKey,
            executionPromise
        );

        try {
            return await executionPromise;
        } finally {
            this.executionRegistry.delete(
                idempotencyKey
            );
        }
    }

    /**
     * =========================================================================
     * COMPENSATION EXECUTION
     * =========================================================================
     */

    async executeCompensation(
        context,
        operations,
        options = {}
    ) {
        const startedAt = new Date();

        const record = {
            compensationId:
                context.compensationId,

            transactionId:
                context.transactionId,

            correlationId:
                context.correlationId,

            idempotencyKey:
                context.idempotencyKey,

            status:
                COMPENSATION_STATUS.RUNNING,

            strategy:
                context.strategy,

            startedAt,

            completedAt: null,

            totalOperations:
                operations.length,

            completedOperations: 0,

            failedOperations: 0,

            skippedOperations: 0,

            results: [],

            errors: [],
        };

        await this.persist(
            "create",
            record
        );

        await this.audit(
            "COMPENSATION_STARTED",
            context,
            {
                compensationId:
                    context.compensationId,
                operationCount:
                    operations.length,
                strategy:
                    context.strategy,
            }
        );

        await this.publishEvent(
            "COMPENSATION_STARTED",
            context,
            record
        );

        let orderedOperations;

        try {
            orderedOperations =
                this.orderOperations(
                    operations,
                    context.strategy
                );
        } catch (error) {
            record.status =
                COMPENSATION_STATUS.FAILED;

            record.failedOperations =
                operations.length;

            record.completedAt =
                new Date();

            record.errors.push(
                serializeError(error)
            );

            await this.persist(
                "update",
                record
            );

            await this.audit(
                "COMPENSATION_ORDERING_FAILED",
                context,
                {
                    error:
                        serializeError(error),
                }
            );

            throw error;
        }

        for (
            const operation of
            orderedOperations
        ) {
            const result =
                await this.compensateOperation(
                    context,
                    operation,
                    options
                );

            record.results.push(
                result
            );

            if (
                result.status ===
                COMPENSATION_STATUS.COMPLETED
            ) {
                record.completedOperations++;
            } else if (
                result.status ===
                COMPENSATION_STATUS.SKIPPED
            ) {
                record.skippedOperations++;
            } else {
                record.failedOperations++;

                record.errors.push(
                    result.error
                );

                if (
                    !this.config
                        .continueOnFailure &&
                    !options.continueOnFailure
                ) {
                    break;
                }
            }

            await this.persist(
                "update",
                record
            );
        }

        record.completedAt =
            new Date();

        if (
            record.failedOperations ===
                0 &&
            record.skippedOperations ===
                0
        ) {
            record.status =
                COMPENSATION_STATUS.COMPLETED;
        } else if (
            record.completedOperations >
                0 &&
            record.failedOperations >
                0
        ) {
            record.status =
                COMPENSATION_STATUS.PARTIAL;
        } else if (
            record.failedOperations > 0
        ) {
            record.status =
                COMPENSATION_STATUS.FAILED;
        } else {
            record.status =
                COMPENSATION_STATUS.SKIPPED;
        }

        await this.persist(
            "update",
            record
        );

        await this.audit(
            this.getCompletionAuditEvent(
                record.status
            ),
            context,
            {
                compensationId:
                    context.compensationId,
                completedOperations:
                    record.completedOperations,
                failedOperations:
                    record.failedOperations,
                skippedOperations:
                    record.skippedOperations,
            }
        );

        await this.publishEvent(
            "COMPENSATION_COMPLETED",
            context,
            record
        );

        return record;
    }

    /**
     * =========================================================================
     * SINGLE OPERATION COMPENSATION
     * =========================================================================
     */

    async compensateOperation(
        context,
        operation,
        options = {}
    ) {
        const operationId =
            safeString(
                operation.operationId,
                crypto.randomUUID()
            );

        const compensationOperationId =
            this.buildOperationCompensationId(
                context.compensationId,
                operationId
            );

        /**
         * Operation-level idempotency.
         */
        const existing =
            await this.getExistingOperation(
                compensationOperationId
            );

        if (existing) {
            return {
                ...existing,
                status:
                    COMPENSATION_STATUS.SKIPPED,
                skipReason:
                    "ALREADY_COMPENSATED",
            };
        }

        const startedAt =
            new Date();

        const result = {
            compensationOperationId,

            operationId,

            operationName:
                operation.name ||
                "UNKNOWN_OPERATION",

            status:
                COMPENSATION_STATUS.RUNNING,

            attempts: 0,

            startedAt,

            completedAt: null,

            durationMs: null,

            error: null,
        };

        await this.persistOperation(
            "create",
            result,
            context
        );

        await this.audit(
            "COMPENSATION_OPERATION_STARTED",
            context,
            {
                operationId,
                compensationOperationId,
                operationName:
                    result.operationName,
            }
        );

        try {
            const compensationHandler =
                operation.compensate;

            if (
                typeof compensationHandler !==
                "function"
            ) {
                throw new CompensationError(
                    `Compensation handler missing for operation ${operationId}`,
                    {
                        code:
                            "COMPENSATION_HANDLER_MISSING",
                        failureType:
                            FAILURE_TYPE.VALIDATION,
                        transactionId:
                            context.transactionId,
                        compensationId:
                            context.compensationId,
                        operationId,
                        retryable: false,
                    }
                );
            }

            const maxRetries =
                this.resolveMaxRetries(
                    operation,
                    options
                );

            const timeoutMs =
                this.resolveTimeout(
                    operation,
                    options
                );

            let lastError = null;

            for (
                let attempt = 1;
                attempt <= maxRetries + 1;
                attempt++
            ) {
                result.attempts =
                    attempt;

                try {
                    const compensationContext =
                        this.buildOperationContext(
                            context,
                            operation,
                            result
                        );

                    const value =
                        await this.executeWithTimeout(
                            () =>
                                compensationHandler(
                                    compensationContext
                                ),
                            timeoutMs,
                            {
                                transactionId:
                                    context.transactionId,
                                compensationId:
                                    context.compensationId,
                                operationId,
                            }
                        );

                    result.status =
                        COMPENSATION_STATUS.COMPLETED;

                    result.value =
                        value;

                    result.completedAt =
                        new Date();

                    result.durationMs =
                        result.completedAt.getTime() -
                        startedAt.getTime();

                    await this.persistOperation(
                        "update",
                        result,
                        context
                    );

                    await this.audit(
                        "COMPENSATION_OPERATION_COMPLETED",
                        context,
                        {
                            operationId,
                            attempts:
                                result.attempts,
                            durationMs:
                                result.durationMs,
                        }
                    );

                    return result;
                } catch (error) {
                    lastError =
                        this.normalizeError(
                            error,
                            context,
                            operationId
                        );

                    const failureType =
                        this.classifyFailure(
                            lastError
                        );

                    lastError.failureType =
                        failureType;

                    const retryable =
                        this.isRetryable(
                            lastError,
                            operation
                        );

                    lastError.retryable =
                        retryable;

                    if (
                        !retryable ||
                        attempt >
                            maxRetries
                    ) {
                        break;
                    }

                    result.status =
                        COMPENSATION_STATUS.RETRYING;

                    result.error =
                        serializeError(
                            lastError
                        );

                    await this.persistOperation(
                        "update",
                        result,
                        context
                    );

                    await this.audit(
                        "COMPENSATION_OPERATION_RETRYING",
                        context,
                        {
                            operationId,
                            attempt,
                            nextAttempt:
                                attempt + 1,
                            error:
                                serializeError(
                                    lastError
                                ),
                        }
                    );

                    const delay =
                        this.calculateRetryDelay(
                            attempt,
                            operation
                        );

                    await this.sleep(
                        delay
                    );
                }
            }

            throw lastError;
        } catch (error) {
            const normalizedError =
                this.normalizeError(
                    error,
                    context,
                    operationId
                );

            result.status =
                COMPENSATION_STATUS.FAILED;

            result.error =
                serializeError(
                    normalizedError
                );

            result.completedAt =
                new Date();

            result.durationMs =
                result.completedAt.getTime() -
                startedAt.getTime();

            await this.persistOperation(
                "update",
                result,
                context
            );

            await this.audit(
                "COMPENSATION_OPERATION_FAILED",
                context,
                {
                    operationId,
                    attempts:
                        result.attempts,
                    error:
                        serializeError(
                            normalizedError
                        ),
                }
            );

            return result;
        }
    }

    /**
     * =========================================================================
     * OPERATION ORDERING
     * =========================================================================
     */

    orderOperations(
        operations,
        strategy
    ) {
        const cloned =
            [...operations];

        switch (strategy) {
            case COMPENSATION_STRATEGY.FORWARD_ORDER:
                return cloned;

            case COMPENSATION_STRATEGY.DEPENDENCY_ORDER:
                return this.orderByDependencies(
                    cloned
                );

            case COMPENSATION_STRATEGY.REVERSE_ORDER:
            default:
                return cloned.reverse();
        }
    }

    /**
     * =========================================================================
     * DEPENDENCY RESOLUTION
     * =========================================================================
     */

    orderByDependencies(
        operations
    ) {
        const map =
            new Map();

        for (
            const operation of
            operations
        ) {
            const operationId =
                operation.operationId;

            if (!operationId) {
                throw new CompensationError(
                    "Operation ID is required for dependency ordering",
                    {
                        code:
                            "OPERATION_ID_REQUIRED",
                        failureType:
                            FAILURE_TYPE.VALIDATION,
                        retryable: false,
                    }
                );
            }

            map.set(
                operationId,
                operation
            );
        }

        const visited =
            new Set();

        const visiting =
            new Set();

        const result = [];

        const visit = (
            operation
        ) => {
            const id =
                operation.operationId;

            if (visited.has(id)) {
                return;
            }

            if (visiting.has(id)) {
                throw new CompensationError(
                    `Circular compensation dependency detected: ${id}`,
                    {
                        code:
                            "COMPENSATION_DEPENDENCY_CYCLE",
                        failureType:
                            FAILURE_TYPE.VALIDATION,
                        retryable: false,
                    }
                );
            }

            visiting.add(id);

            const dependencies =
                Array.isArray(
                    operation.dependencies
                )
                    ? operation.dependencies
                    : [];

            for (
                const dependencyId of
                dependencies
            ) {
                const dependency =
                    map.get(
                        dependencyId
                    );

                if (!dependency) {
                    throw new CompensationError(
                        `Missing compensation dependency: ${dependencyId}`,
                        {
                            code:
                                "COMPENSATION_DEPENDENCY_MISSING",
                            failureType:
                                FAILURE_TYPE.VALIDATION,
                            retryable: false,
                        }
                    );
                }

                visit(
                    dependency
                );
            }

            visiting.delete(id);

            visited.add(id);

            result.push(
                operation
            );
        };

        for (
            const operation of
            operations
        ) {
            visit(operation);
        }

        return result;
    }

    /**
     * =========================================================================
     * VALIDATION
     * =========================================================================
     */

    validateOperations(
        operations
    ) {
        if (
            !Array.isArray(
                operations
            )
        ) {
            throw new CompensationError(
                "Compensation operations must be an array",
                {
                    code:
                        "INVALID_OPERATIONS",
                    failureType:
                        FAILURE_TYPE.VALIDATION,
                    retryable: false,
                }
            );
        }

        if (
            operations.length >
            this.config.maxOperations
        ) {
            throw new CompensationError(
                `Maximum compensation operations exceeded: ${this.config.maxOperations}`,
                {
                    code:
                        "MAX_OPERATIONS_EXCEEDED",
                    failureType:
                        FAILURE_TYPE.VALIDATION,
                    retryable: false,
                }
            );
        }

        const operationIds =
            new Set();

        for (
            const operation of
            operations
        ) {
            if (
                !operation ||
                typeof operation !==
                    "object"
            ) {
                throw new CompensationError(
                    "Invalid compensation operation",
                    {
                        code:
                            "INVALID_OPERATION",
                        failureType:
                            FAILURE_TYPE.VALIDATION,
                        retryable: false,
                    }
                );
            }

            if (
                !operation.operationId
            ) {
                throw new CompensationError(
                    "Compensation operationId is required",
                    {
                        code:
                            "OPERATION_ID_REQUIRED",
                        failureType:
                            FAILURE_TYPE.VALIDATION,
                        retryable: false,
                    }
                );
            }

            if (
                operationIds.has(
                    operation.operationId
                )
            ) {
                throw new CompensationError(
                    `Duplicate compensation operationId: ${operation.operationId}`,
                    {
                        code:
                            "DUPLICATE_OPERATION_ID",
                        failureType:
                            FAILURE_TYPE.VALIDATION,
                        retryable: false,
                    }
                );
            }

            operationIds.add(
                operation.operationId
            );

            if (
                typeof operation.compensate !==
                "function"
            ) {
                throw new CompensationError(
                    `Missing compensate handler for ${operation.operationId}`,
                    {
                        code:
                            "COMPENSATE_HANDLER_REQUIRED",
                        failureType:
                            FAILURE_TYPE.VALIDATION,
                        retryable: false,
                    }
                );
            }
        }
    }

    /**
     * =========================================================================
     * TIMEOUT PROTECTION
     * =========================================================================
     */

    executeWithTimeout(
        handler,
        timeoutMs,
        metadata = {}
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
                            new CompensationError(
                                `Compensation operation timed out after ${timeoutMs}ms`,
                                {
                                    code:
                                        "COMPENSATION_TIMEOUT",
                                    failureType:
                                        FAILURE_TYPE.TIMEOUT,
                                    transactionId:
                                        metadata.transactionId,
                                    compensationId:
                                        metadata.compensationId,
                                    operationId:
                                        metadata.operationId,
                                    retryable: true,
                                }
                            )
                        );
                    }, timeoutMs);

                Promise.resolve()
                    .then(handler)
                    .then(
                        (value) => {
                            if (
                                settled
                            ) {
                                return;
                            }

                            settled = true;

                            clearTimeout(
                                timer
                            );

                            resolve(
                                value
                            );
                        },
                        (error) => {
                            if (
                                settled
                            ) {
                                return;
                            }

                            settled = true;

                            clearTimeout(
                                timer
                            );

                            reject(
                                error
                            );
                        }
                    );
            }
        );
    }

    /**
     * =========================================================================
     * RETRY ENGINE
     * =========================================================================
     */

    calculateRetryDelay(
        attempt,
        operation = {}
    ) {
        const base =
            safeNumber(
                operation.retryDelayMs,
                this.config
                    .baseRetryDelayMs
            );

        const maximum =
            this.config
                .maxRetryDelayMs;

        let delay =
            Math.min(
                base *
                    Math.pow(
                        2,
                        Math.max(
                            attempt - 1,
                            0
                        )
                    ),
                maximum
            );

        if (
            this.config.enableJitter
        ) {
            delay += Math.floor(
                Math.random() *
                    Math.max(
                        1,
                        delay * 0.25
                    )
            );
        }

        return Math.min(
            Math.floor(delay),
            maximum
        );
    }

    resolveMaxRetries(
        operation,
        options
    ) {
        const value =
            operation.maxRetries ??
            options.maxRetries ??
            this.config.maxRetries;

        return clamp(
            Math.floor(
                safeNumber(
                    value,
                    this.config.maxRetries
                )
            ),
            0,
            10
        );
    }

    resolveTimeout(
        operation,
        options
    ) {
        const value =
            operation.timeoutMs ??
            options.timeoutMs ??
            this.config.defaultTimeoutMs;

        return clamp(
            Math.floor(
                safeNumber(
                    value,
                    this.config.defaultTimeoutMs
                )
            ),
            100,
            this.config.maxTimeoutMs
        );
    }

    /**
     * =========================================================================
     * FAILURE CLASSIFICATION
     * =========================================================================
     */

    classifyFailure(
        error
    ) {
        if (!error) {
            return FAILURE_TYPE.UNKNOWN;
        }

        if (
            error.failureType
        ) {
            return error.failureType;
        }

        if (
            error.code ===
                "COMPENSATION_TIMEOUT" ||
            error.name ===
                "TimeoutError"
        ) {
            return FAILURE_TYPE.TIMEOUT;
        }

        if (
            error.code ===
                "VALIDATION_ERROR" ||
            error.code ===
                "INVALID_OPERATION"
        ) {
            return FAILURE_TYPE.VALIDATION;
        }

        if (
            error.code ===
                "DUPLICATE_COMPENSATION"
        ) {
            return FAILURE_TYPE.IDEMPOTENCY;
        }

        if (
            error.retryable === true
        ) {
            return FAILURE_TYPE.TRANSIENT;
        }

        const status =
            safeNumber(
                error.status ||
                    error.statusCode,
                0
            );

        if (
            status >= 500 ||
            status === 429
        ) {
            return FAILURE_TYPE.TRANSIENT;
        }

        if (
            status >= 400
        ) {
            return FAILURE_TYPE.PERMANENT;
        }

        return FAILURE_TYPE.UNKNOWN;
    }

    isRetryable(
        error,
        operation = {}
    ) {
        if (
            operation.retryable ===
            false
        ) {
            return false;
        }

        if (
            operation.retryable ===
            true
        ) {
            return true;
        }

        if (
            error?.retryable !==
            undefined
        ) {
            return Boolean(
                error.retryable
            );
        }

        const failureType =
            this.classifyFailure(
                error
            );

        return (
            failureType ===
                FAILURE_TYPE.TRANSIENT ||
            failureType ===
                FAILURE_TYPE.TIMEOUT
        );
    }

    normalizeError(
        error,
        context,
        operationId
    ) {
        if (
            error instanceof
            CompensationError
        ) {
            return error;
        }

        return new CompensationError(
            error?.message ||
                "Unknown compensation error",
            {
                code:
                    error?.code ||
                    "COMPENSATION_OPERATION_FAILED",

                failureType:
                    this.classifyFailure(
                        error
                    ),

                transactionId:
                    context.transactionId,

                compensationId:
                    context.compensationId,

                operationId,

                retryable:
                    Boolean(
                        error?.retryable
                    ),

                cause: error,
            }
        );
    }

    /**
     * =========================================================================
     * CONTEXT BUILDERS
     * =========================================================================
     */

    normalizeTransactionContext(
        context
    ) {
        if (
            !context ||
            !context.transactionId
        ) {
            throw new CompensationError(
                "transactionId is required",
                {
                    code:
                        "TRANSACTION_ID_REQUIRED",
                    failureType:
                        FAILURE_TYPE.VALIDATION,
                    retryable: false,
                }
            );
        }

        return {
            transactionId:
                safeString(
                    context.transactionId
                ),

            correlationId:
                safeString(
                    context.correlationId,
                    crypto.randomUUID()
                ),

            causationId:
                safeString(
                    context.causationId,
                    null
                ),

            tenantId:
                safeString(
                    context.tenantId,
                    null
                ),

            actorId:
                safeString(
                    context.actorId,
                    null
                ),

            requestId:
                safeString(
                    context.requestId,
                    null
                ),

            traceId:
                safeString(
                    context.traceId,
                    null
                ),

            metadata:
                context.metadata &&
                typeof context.metadata ===
                    "object"
                    ? {
                          ...context.metadata,
                      }
                    : {},
        };
    }

    buildOperationContext(
        context,
        operation,
        result
    ) {
        return {
            transactionId:
                context.transactionId,

            compensationId:
                context.compensationId,

            compensationOperationId:
                result.compensationOperationId,

            operationId:
                operation.operationId,

            operationName:
                operation.name ||
                null,

            tenantId:
                context.tenantId,

            correlationId:
                context.correlationId,

            causationId:
                context.causationId,

            actorId:
                context.actorId,

            requestId:
                context.requestId,

            traceId:
                context.traceId,

            metadata:
                context.metadata,

            operationMetadata:
                operation.metadata ||
                {},

            attempt:
                result.attempts,
        };
    }

    buildIdempotencyKey(
        transactionId,
        compensationId,
        operations
    ) {
        const operationIds =
            operations
                .map(
                    (operation) =>
                        operation.operationId
                )
                .sort()
                .join("|");

        return crypto
            .createHash("sha256")
            .update(
                [
                    transactionId,
                    compensationId,
                    operationIds,
                ].join(":")
            )
            .digest("hex");
    }

    buildOperationCompensationId(
        compensationId,
        operationId
    ) {
        return crypto
            .createHash("sha256")
            .update(
                [
                    compensationId,
                    operationId,
                ].join(":")
            )
            .digest("hex");
    }

    /**
     * =========================================================================
     * PERSISTENCE ADAPTER
     * =========================================================================
     *
     * The orchestrator does not force a new model into the existing
     * architecture. An optional persistence adapter can be injected.
     *
     * Supported:
     *
     * persistence.createCompensation(record)
     * persistence.updateCompensation(record)
     * persistence.getCompensation(idempotencyKey)
     * persistence.createOperation(record, context)
     * persistence.updateOperation(record, context)
     * persistence.getOperation(compensationOperationId)
     *
     */

    async persist(
        action,
        record
    ) {
        try {
            if (
                !this.config
                    .persistence
            ) {
                this.compensationRegistry.set(
                    record.idempotencyKey,
                    record
                );

                return record;
            }

            if (
                action === "create" &&
                typeof this.config
                    .persistence
                    .createCompensation ===
                    "function"
            ) {
                return this.config
                    .persistence
                    .createCompensation(
                        record
                    );
            }

            if (
                action === "update" &&
                typeof this.config
                    .persistence
                    .updateCompensation ===
                    "function"
            ) {
                return this.config
                    .persistence
                    .updateCompensation(
                        record
                    );
            }

            return record;
        } catch (error) {
            this.log(
                "error",
                "Compensation persistence failure",
                {
                    error:
                        serializeError(
                            error
                        ),
                    compensationId:
                        record.compensationId,
                    transactionId:
                        record.transactionId,
                }
            );

            /**
             * Persistence failures are deliberately surfaced.
             * In a distributed financial system, losing the compensation
             * state must not be treated as harmless.
             */
            throw new CompensationError(
                "Unable to persist compensation state",
                {
                    code:
                        "COMPENSATION_PERSISTENCE_FAILED",
                    failureType:
                        FAILURE_TYPE.TRANSIENT,
                    retryable: true,
                    transactionId:
                        record.transactionId,
                    compensationId:
                        record.compensationId,
                    cause: error,
                }
            );
        }
    }

    async persistOperation(
        action,
        record,
        context
    ) {
        try {
            if (
                !this.config
                    .persistence
            ) {
                return record;
            }

            if (
                action === "create" &&
                typeof this.config
                    .persistence
                    .createOperation ===
                    "function"
            ) {
                return this.config
                    .persistence
                    .createOperation(
                        record,
                        context
                    );
            }

            if (
                action === "update" &&
                typeof this.config
                    .persistence
                    .updateOperation ===
                    "function"
            ) {
                return this.config
                    .persistence
                    .updateOperation(
                        record,
                        context
                    );
            }

            return record;
        } catch (error) {
            throw new CompensationError(
                "Unable to persist compensation operation",
                {
                    code:
                        "COMPENSATION_OPERATION_PERSISTENCE_FAILED",
                    failureType:
                        FAILURE_TYPE.TRANSIENT,
                    retryable: true,
                    transactionId:
                        context.transactionId,
                    compensationId:
                        context.compensationId,
                    operationId:
                        record.operationId,
                    cause: error,
                }
            );
        }
    }

    async getExistingCompensation(
        idempotencyKey
    ) {
        if (
            this.config
                .persistence &&
            typeof this.config
                .persistence
                .getCompensation ===
                "function"
        ) {
            return this.config
                .persistence
                .getCompensation(
                    idempotencyKey
                );
        }

        const existing =
            this.compensationRegistry.get(
                idempotencyKey
            );

        if (!existing) {
            return null;
        }

        return existing;
    }

    async getExistingOperation(
        compensationOperationId
    ) {
        if (
            this.config
                .persistence &&
            typeof this.config
                .persistence
                .getOperation ===
                "function"
        ) {
            return this.config
                .persistence
                .getOperation(
                    compensationOperationId
                );
        }

        return null;
    }

    /**
     * =========================================================================
     * AUDIT INTEGRATION
     * =========================================================================
     */

    async audit(
        event,
        context,
        metadata = {}
    ) {
        try {
            if (
                !this.config
                    .auditManager
            ) {
                this.log(
                    "info",
                    `[COMPENSATION] ${event}`,
                    {
                        transactionId:
                            context.transactionId,
                        compensationId:
                            context.compensationId,
                        correlationId:
                            context.correlationId,
                        ...metadata,
                    }
                );

                return;
            }

            const manager =
                this.config
                    .auditManager;

            if (
                typeof manager.record ===
                "function"
            ) {
                await manager.record({
                    event,
                    transactionId:
                        context.transactionId,
                    compensationId:
                        context.compensationId,
                    correlationId:
                        context.correlationId,
                    tenantId:
                        context.tenantId,
                    actorId:
                        context.actorId,
                    requestId:
                        context.requestId,
                    traceId:
                        context.traceId,
                    metadata,
                    timestamp:
                        new Date(),
                });

                return;
            }

            if (
                typeof manager.log ===
                "function"
            ) {
                await manager.log(
                    event,
                    {
                        ...context,
                        ...metadata,
                    }
                );
            }
        } catch (error) {
            /**
             * Audit failures should be visible but should not hide the
             * original compensation outcome.
             */
            this.log(
                "error",
                "Compensation audit failure",
                {
                    event,
                    error:
                        serializeError(
                            error
                        ),
                    transactionId:
                        context.transactionId,
                    compensationId:
                        context.compensationId,
                }
            );
        }
    }

    /**
     * =========================================================================
     * EVENT PUBLISHING
     * =========================================================================
     */

    async publishEvent(
        event,
        context,
        payload
    ) {
        try {
            if (
                !this.config
                    .eventPublisher
            ) {
                return;
            }

            const publisher =
                this.config
                    .eventPublisher;

            const eventPayload = {
                event,
                eventId:
                    crypto.randomUUID(),
                transactionId:
                    context.transactionId,
                compensationId:
                    context.compensationId,
                correlationId:
                    context.correlationId,
                causationId:
                    context.causationId,
                tenantId:
                    context.tenantId,
                timestamp:
                    new Date().toISOString(),
                payload,
            };

            if (
                typeof publisher.publish ===
                "function"
            ) {
                await publisher.publish(
                    event,
                    eventPayload
                );

                return;
            }

            if (
                typeof publisher.publishEvent ===
                "function"
            ) {
                await publisher.publishEvent(
                    eventPayload
                );
            }
        } catch (error) {
            /**
             * Event publication failure is intentionally logged.
             *
             * If events are financially authoritative, use an Outbox-backed
             * publisher rather than making this service responsible for
             * durable event delivery.
             */
            this.log(
                "error",
                "Compensation event publication failed",
                {
                    event,
                    transactionId:
                        context.transactionId,
                    compensationId:
                        context.compensationId,
                    error:
                        serializeError(
                            error
                        ),
                }
            );
        }
    }

    /**
     * =========================================================================
     * AUDIT EVENT MAPPING
     * =========================================================================
     */

    getCompletionAuditEvent(
        status
    ) {
        switch (status) {
            case COMPENSATION_STATUS.COMPLETED:
                return "COMPENSATION_COMPLETED";

            case COMPENSATION_STATUS.PARTIAL:
                return "COMPENSATION_PARTIALLY_COMPLETED";

            case COMPENSATION_STATUS.FAILED:
                return "COMPENSATION_FAILED";

            case COMPENSATION_STATUS.SKIPPED:
                return "COMPENSATION_SKIPPED";

            default:
                return "COMPENSATION_FINISHED";
        }
    }

    /**
     * =========================================================================
     * RECOVERY / RESUME
     * =========================================================================
     *
     * Allows an incomplete compensation record to be resumed when a durable
     * persistence adapter is configured.
     */

    async resume(
        compensationRecord,
        operations,
        options = {}
    ) {
        if (
            !compensationRecord ||
            !compensationRecord.transactionId
        ) {
            throw new CompensationError(
                "Valid compensation record is required",
                {
                    code:
                        "INVALID_COMPENSATION_RECORD",
                    failureType:
                        FAILURE_TYPE.VALIDATION,
                    retryable: false,
                }
            );
        }

        const completedOperationIds =
            new Set(
                (
                    compensationRecord
                        .results ||
                    []
                )
                    .filter(
                        (result) =>
                            result.status ===
                            COMPENSATION_STATUS.COMPLETED
                    )
                    .map(
                        (result) =>
                            result.operationId
                    )
            );

        const remainingOperations =
            operations.filter(
                (operation) =>
                    !completedOperationIds.has(
                        operation.operationId
                    )
            );

        return this.compensate(
            {
                transactionId:
                    compensationRecord.transactionId,

                correlationId:
                    compensationRecord.correlationId,

                tenantId:
                    compensationRecord.tenantId,

                actorId:
                    compensationRecord.actorId,

                requestId:
                    compensationRecord.requestId,

                traceId:
                    compensationRecord.traceId,

                metadata:
                    compensationRecord.metadata,
            },
            remainingOperations,
            {
                ...options,
                compensationId:
                    options.compensationId ||
                    compensationRecord.compensationId,
                idempotencyKey:
                    options.idempotencyKey ||
                    compensationRecord.idempotencyKey,
            }
        );
    }

    /**
     * =========================================================================
     * STATUS QUERY
     * =========================================================================
     */

    async getStatus(
        idempotencyKey
    ) {
        return this.getExistingCompensation(
            idempotencyKey
        );
    }

    /**
     * =========================================================================
     * HEALTH CHECK
     * =========================================================================
     */

    async healthCheck() {
        const persistenceConfigured =
            Boolean(
                this.config
                    .persistence
            );

        const auditConfigured =
            Boolean(
                this.config
                    .auditManager
            );

        const eventPublisherConfigured =
            Boolean(
                this.config
                    .eventPublisher
            );

        return {
            service:
                "CompensationOrchestrator",

            status: "READY",

            persistenceConfigured,

            auditConfigured,

            eventPublisherConfigured,

            activeExecutions:
                this.executionRegistry
                    .size,

            cachedCompensations:
                this.compensationRegistry
                    .size,

            timestamp:
                new Date().toISOString(),
        };
    }

    /**
     * =========================================================================
     * LOGGING
     * =========================================================================
     */

    log(
        level,
        message,
        metadata = {}
    ) {
        const logger =
            this.config.logger;

        const payload = {
            service:
                "CompensationOrchestrator",

            message,

            timestamp:
                new Date().toISOString(),

            ...metadata,
        };

        try {
            if (
                logger &&
                typeof logger[level] ===
                    "function"
            ) {
                logger[level](
                    payload
                );

                return;
            }

            if (
                logger &&
                typeof logger.log ===
                    "function"
            ) {
                logger.log(
                    level,
                    payload
                );
            }
        } catch (_) {
            /**
             * Logging must never crash compensation processing.
             */
        }
    }

    /**
     * =========================================================================
     * SLEEP
     * =========================================================================
     */

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
     * SHUTDOWN
     * =========================================================================
     */

    async shutdown() {
        this.executionRegistry.clear();
        this.compensationRegistry.clear();

        return {
            success: true,
            service:
                "CompensationOrchestrator",
            timestamp:
                new Date().toISOString(),
        };
    }
}

/**
 * ============================================================================
 * DEFAULT INSTANCE
 * ============================================================================
 */

const compensationOrchestrator =
    new CompensationOrchestrator();

/**
 * ============================================================================
 * EXPORTS
 * ============================================================================
 *
 * Preserve the existing singleton-style CommonJS architecture while exposing
 * constructors/constants for advanced dependency injection and testing.
 * ============================================================================
 */

module.exports =
    compensationOrchestrator;

module.exports.CompensationOrchestrator =
    CompensationOrchestrator;

module.exports.CompensationError =
    CompensationError;

module.exports.COMPENSATION_STATUS =
    COMPENSATION_STATUS;

module.exports.COMPENSATION_RESULT =
    COMPENSATION_RESULT;

module.exports.COMPENSATION_STRATEGY =
    COMPENSATION_STRATEGY;

module.exports.FAILURE_TYPE =
    FAILURE_TYPE;