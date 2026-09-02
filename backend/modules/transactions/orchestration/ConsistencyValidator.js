/**
 * ============================================================================
 * TITech Community Capital LTD
 * Consistency Validator
 * ============================================================================
 * Enterprise Transaction Orchestration Infrastructure
 * ============================================================================
 *
 * File:
 * backend/modules/transactions/orchestration/ConsistencyValidator.js
 *
 * Purpose:
 * ---------------------------------------------------------------------------
 * Provides deterministic consistency validation for distributed transaction
 * orchestration.
 *
 * Responsibilities:
 * ---------------------------------------------------------------------------
 * • Validate transaction context
 * • Validate state transitions
 * • Validate required transaction identifiers
 * • Validate participant consistency
 * • Validate financial amount consistency
 * • Validate idempotency consistency
 * • Validate compensation consistency
 * • Validate orchestration step consistency
 * • Detect duplicate / conflicting execution records
 * • Produce machine-readable validation results
 * • Fail closed for unsafe financial inconsistencies
 * • Remain dependency-light and architecture-preserving
 *
 * Design Principles:
 * ---------------------------------------------------------------------------
 * • No direct database mutations
 * • No balance mutations
 * • No transaction ownership
 * • Deterministic validation
 * • Fail closed for critical inconsistencies
 * • Tenant isolation
 * • Idempotency awareness
 * • Safe for use before commit and before compensation
 *
 * ============================================================================
 */

"use strict";

const crypto = require("crypto");

/**
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

const TRANSACTION_STATES = Object.freeze([
    "PENDING",
    "PROCESSING",
    "COMMITTED",
    "COMPLETED",
    "FAILED",
    "COMPENSATING",
    "COMPENSATED",
    "CANCELLED",
    "TIMED_OUT",
]);

const TERMINAL_STATES = Object.freeze([
    "COMMITTED",
    "COMPLETED",
    "FAILED",
    "COMPENSATED",
    "CANCELLED",
    "TIMED_OUT",
]);

const ACTIVE_STATES = Object.freeze([
    "PENDING",
    "PROCESSING",
    "COMPENSATING",
]);

const COMPENSATION_STATES = Object.freeze([
    "COMPENSATING",
    "COMPENSATED",
]);

const STEP_STATES = Object.freeze([
    "PENDING",
    "RUNNING",
    "COMPLETED",
    "FAILED",
    "COMPENSATING",
    "COMPENSATED",
    "SKIPPED",
]);

const SEVERITY = Object.freeze({
    INFO: "INFO",
    WARNING: "WARNING",
    ERROR: "ERROR",
    CRITICAL: "CRITICAL",
});

const DEFAULT_LIMITS = Object.freeze({
    MAX_STEPS: 100,
    MAX_PARTICIPANTS: 100,
    MAX_ERRORS: 100,
    MAX_WARNINGS: 100,
});

const DEFAULT_CONFIG = Object.freeze({
    strictMode: true,
    requireTenantId: true,
    requireTransactionId: true,
    requireCorrelationId: false,
    requireIdempotencyKey: false,
    requireAmountForFinancialTransactions: false,
    allowUnknownState: false,
    rejectNegativeAmounts: true,
    rejectNaNAmounts: true,
    rejectInfiniteAmounts: true,
    maxSteps: DEFAULT_LIMITS.MAX_STEPS,
    maxParticipants: DEFAULT_LIMITS.MAX_PARTICIPANTS,
    maxErrors: DEFAULT_LIMITS.MAX_ERRORS,
    maxWarnings: DEFAULT_LIMITS.MAX_WARNINGS,
});

/**
 * ============================================================================
 * ERROR CLASS
 * ============================================================================
 */

class ConsistencyValidationError extends Error {
    constructor(message, details = {}) {
        super(message);

        this.name = "ConsistencyValidationError";
        this.code = "CONSISTENCY_VALIDATION_FAILED";
        this.details = details;
        this.isOperational = true;

        if (Error.captureStackTrace) {
            Error.captureStackTrace(
                this,
                ConsistencyValidationError
            );
        }
    }
}

/**
 * ============================================================================
 * SERVICE
 * ============================================================================
 */

class ConsistencyValidator {
    constructor(options = {}) {
        this.config = Object.freeze({
            ...DEFAULT_CONFIG,
            ...(options || {}),
        });
    }

    /**
     * =========================================================================
     * MAIN VALIDATION ENTRYPOINT
     * =========================================================================
     *
     * Performs all applicable consistency checks.
     *
     * Returns:
     * {
     *   valid,
     *   status,
     *   validationId,
     *   errors,
     *   warnings,
     *   checks,
     *   summary,
     *   timestamp
     * }
     */
    validate(context = {}, options = {}) {
        const validationId =
            options.validationId ||
            context.validationId ||
            crypto.randomUUID();

        const errors = [];
        const warnings = [];
        const checks = {};

        const addError = (
            code,
            message,
            field = null,
            details = {}
        ) => {
            if (errors.length >= this.config.maxErrors) {
                return;
            }

            errors.push({
                code,
                message,
                field,
                severity: SEVERITY.ERROR,
                ...details,
            });
        };

        const addWarning = (
            code,
            message,
            field = null,
            details = {}
        ) => {
            if (warnings.length >= this.config.maxWarnings) {
                return;
            }

            warnings.push({
                code,
                message,
                field,
                severity: SEVERITY.WARNING,
                ...details,
            });
        };

        checks.context = this.validateTransactionContext(
            context,
            addError,
            addWarning
        );

        checks.state = this.validateState(
            context,
            addError,
            addWarning
        );

        checks.participants =
            this.validateParticipants(
                context,
                addError,
                addWarning
            );

        checks.amount =
            this.validateAmountConsistency(
                context,
                addError,
                addWarning
            );

        checks.idempotency =
            this.validateIdempotency(
                context,
                addError,
                addWarning
            );

        checks.steps =
            this.validateSteps(
                context,
                addError,
                addWarning
            );

        checks.compensation =
            this.validateCompensation(
                context,
                addError,
                addWarning
            );

        checks.execution =
            this.validateExecutionConsistency(
                context,
                addError,
                addWarning
            );

        checks.tenantIsolation =
            this.validateTenantIsolation(
                context,
                addError,
                addWarning
            );

        checks.timestamps =
            this.validateTimestamps(
                context,
                addError,
                addWarning
            );

        checks.invariants =
            this.validateInvariants(
                context,
                addError,
                addWarning
            );

        const valid = errors.length === 0;

        const result = {
            valid,
            status: valid ? "VALID" : "INVALID",
            validationId,
            transactionId:
                context.transactionId ||
                context.transaction?._id ||
                null,
            tenantId:
                context.tenantId ||
                context.transaction?.tenantId ||
                null,
            correlationId:
                context.correlationId ||
                context.transaction?.correlationId ||
                null,
            errors,
            warnings,
            checks,
            summary: {
                errorCount: errors.length,
                warningCount: warnings.length,
                checkCount: Object.keys(checks).length,
            },
            timestamp: new Date().toISOString(),
        };

        return result;
    }

    /**
     * =========================================================================
     * ASSERT CONSISTENT
     * =========================================================================
     *
     * Convenience method for orchestration components that require fail-closed
     * behaviour.
     */
    assertConsistent(context = {}, options = {}) {
        const result = this.validate(context, options);

        if (!result.valid) {
            throw new ConsistencyValidationError(
                "Transaction consistency validation failed",
                result
            );
        }

        return result;
    }

    /**
     * =========================================================================
     * TRANSACTION CONTEXT VALIDATION
     * =========================================================================
     */

    validateTransactionContext(
        context,
        addError,
        addWarning
    ) {
        let valid = true;

        const transaction =
            context.transaction || context;

        const transactionId =
            context.transactionId ||
            transaction.transactionId ||
            transaction._id;

        if (
            this.config.requireTransactionId &&
            !this.hasValue(transactionId)
        ) {
            valid = false;

            addError(
                "MISSING_TRANSACTION_ID",
                "Transaction identifier is required",
                "transactionId"
            );
        }

        const tenantId =
            context.tenantId ||
            transaction.tenantId;

        if (
            this.config.requireTenantId &&
            !this.hasValue(tenantId)
        ) {
            valid = false;

            addError(
                "MISSING_TENANT_ID",
                "Tenant identifier is required",
                "tenantId"
            );
        }

        if (
            this.config.requireCorrelationId &&
            !this.hasValue(context.correlationId)
        ) {
            valid = false;

            addError(
                "MISSING_CORRELATION_ID",
                "Correlation identifier is required",
                "correlationId"
            );
        }

        if (
            context.transactionId &&
            transaction.transactionId &&
            String(context.transactionId) !==
                String(transaction.transactionId)
        ) {
            valid = false;

            addError(
                "TRANSACTION_ID_MISMATCH",
                "Transaction context identifier does not match transaction identifier",
                "transactionId"
            );
        }

        return valid;
    }

    /**
     * =========================================================================
     * STATE VALIDATION
     * =========================================================================
     */

    validateState(
        context,
        addError,
        addWarning
    ) {
        let valid = true;

        const transaction =
            context.transaction || context;

        const state =
            context.state ||
            transaction.state ||
            transaction.status;

        if (!state) {
            addWarning(
                "MISSING_TRANSACTION_STATE",
                "Transaction state is not available",
                "state"
            );

            return true;
        }

        if (
            !TRANSACTION_STATES.includes(state)
        ) {
            if (!this.config.allowUnknownState) {
                valid = false;

                addError(
                    "INVALID_TRANSACTION_STATE",
                    `Unknown transaction state: ${state}`,
                    "state"
                );
            } else {
                addWarning(
                    "UNKNOWN_TRANSACTION_STATE",
                    `Unknown transaction state accepted by configuration: ${state}`,
                    "state"
                );
            }
        }

        const previousState =
            context.previousState ||
            transaction.previousState;

        if (
            previousState &&
            !this.isValidStateTransition(
                previousState,
                state
            )
        ) {
            valid = false;

            addError(
                "INVALID_STATE_TRANSITION",
                `Invalid transaction state transition from ${previousState} to ${state}`,
                "state",
                {
                    previousState,
                    currentState: state,
                }
            );
        }

        return valid;
    }

    /**
     * =========================================================================
     * STATE TRANSITION VALIDATION
     * =========================================================================
     */

    isValidStateTransition(
        previousState,
        nextState
    ) {
        if (
            !previousState ||
            !nextState
        ) {
            return false;
        }

        if (previousState === nextState) {
            return true;
        }

        const transitions = {
            PENDING: [
                "PROCESSING",
                "CANCELLED",
                "TIMED_OUT",
            ],

            PROCESSING: [
                "COMMITTED",
                "COMPLETED",
                "FAILED",
                "COMPENSATING",
                "CANCELLED",
                "TIMED_OUT",
            ],

            COMMITTED: [
                "COMPLETED",
                "COMPENSATING",
            ],

            COMPLETED: [],

            FAILED: [
                "COMPENSATING",
                "COMPENSATED",
            ],

            COMPENSATING: [
                "COMPENSATED",
                "FAILED",
            ],

            COMPENSATED: [],

            CANCELLED: [],

            TIMED_OUT: [
                "COMPENSATING",
                "COMPENSATED",
            ],
        };

        return (
            Array.isArray(transitions[previousState]) &&
            transitions[previousState].includes(
                nextState
            )
        );
    }

    /**
     * =========================================================================
     * PARTICIPANT CONSISTENCY
     * =========================================================================
     */

    validateParticipants(
        context,
        addError,
        addWarning
    ) {
        let valid = true;

        const participants =
            context.participants ||
            context.transaction?.participants ||
            [];

        if (!Array.isArray(participants)) {
            addError(
                "INVALID_PARTICIPANTS",
                "Participants must be an array",
                "participants"
            );

            return false;
        }

        if (
            participants.length >
            this.config.maxParticipants
        ) {
            valid = false;

            addError(
                "PARTICIPANT_LIMIT_EXCEEDED",
                "Transaction participant limit exceeded",
                "participants"
            );
        }

        const participantIds =
            new Set();

        participants.forEach(
            (participant, index) => {
                if (!participant) {
                    valid = false;

                    addError(
                        "INVALID_PARTICIPANT",
                        "Participant cannot be null or undefined",
                        `participants[${index}]`
                    );

                    return;
                }

                const id =
                    participant.id ||
                    participant.userId ||
                    participant.accountId ||
                    participant._id;

                if (!this.hasValue(id)) {
                    addError(
                        "MISSING_PARTICIPANT_ID",
                        "Participant identifier is required",
                        `participants[${index}]`
                    );

                    valid = false;

                    return;
                }

                const normalizedId =
                    String(id);

                if (
                    participantIds.has(
                        normalizedId
                    )
                ) {
                    valid = false;

                    addError(
                        "DUPLICATE_PARTICIPANT",
                        "Duplicate transaction participant detected",
                        `participants[${index}]`,
                        {
                            participantId:
                                normalizedId,
                        }
                    );
                }

                participantIds.add(
                    normalizedId
                );
            }
        );

        return valid;
    }

    /**
     * =========================================================================
     * AMOUNT CONSISTENCY
     * =========================================================================
     */

    validateAmountConsistency(
        context,
        addError,
        addWarning
    ) {
        let valid = true;

        const transaction =
            context.transaction || context;

        const amount =
            context.amount ??
            transaction.amount;

        if (
            amount === undefined ||
            amount === null
        ) {
            if (
                this.config
                    .requireAmountForFinancialTransactions
            ) {
                valid = false;

                addError(
                    "MISSING_TRANSACTION_AMOUNT",
                    "Transaction amount is required",
                    "amount"
                );
            }

            return valid;
        }

        const numericAmount =
            Number(amount);

        if (
            this.config.rejectNaNAmounts &&
            Number.isNaN(numericAmount)
        ) {
            valid = false;

            addError(
                "INVALID_TRANSACTION_AMOUNT",
                "Transaction amount must be numeric",
                "amount"
            );

            return false;
        }

        if (
            this.config.rejectInfiniteAmounts &&
            !Number.isFinite(numericAmount)
        ) {
            valid = false;

            addError(
                "NON_FINITE_TRANSACTION_AMOUNT",
                "Transaction amount must be finite",
                "amount"
            );
        }

        if (
            this.config.rejectNegativeAmounts &&
            numericAmount < 0
        ) {
            valid = false;

            addError(
                "NEGATIVE_TRANSACTION_AMOUNT",
                "Transaction amount cannot be negative",
                "amount"
            );
        }

        const expectedAmount =
            context.expectedAmount;

        if (
            expectedAmount !== undefined &&
            expectedAmount !== null
        ) {
            const expected =
                Number(expectedAmount);

            if (
                Number.isFinite(expected) &&
                numericAmount !== expected
            ) {
                valid = false;

                addError(
                    "AMOUNT_MISMATCH",
                    "Transaction amount does not match expected amount",
                    "amount",
                    {
                        actualAmount:
                            numericAmount,
                        expectedAmount:
                            expected,
                    }
                );
            }
        }

        const debitAmount =
            context.debitAmount ??
            transaction.debitAmount;

        const creditAmount =
            context.creditAmount ??
            transaction.creditAmount;

        if (
            debitAmount !== undefined &&
            creditAmount !== undefined
        ) {
            const debit =
                Number(debitAmount);

            const credit =
                Number(creditAmount);

            if (
                Number.isFinite(debit) &&
                Number.isFinite(credit) &&
                debit !== credit
            ) {
                valid = false;

                addError(
                    "DEBIT_CREDIT_IMBALANCE",
                    "Debit and credit amounts are inconsistent",
                    "amount",
                    {
                        debitAmount: debit,
                        creditAmount: credit,
                    }
                );
            }
        }

        return valid;
    }

    /**
     * =========================================================================
     * IDEMPOTENCY VALIDATION
     * =========================================================================
     */

    validateIdempotency(
        context,
        addError,
        addWarning
    ) {
        let valid = true;

        const idempotencyKey =
            context.idempotencyKey ||
            context.transaction?.idempotencyKey;

        if (
            this.config.requireIdempotencyKey &&
            !this.hasValue(idempotencyKey)
        ) {
            valid = false;

            addError(
                "MISSING_IDEMPOTENCY_KEY",
                "Idempotency key is required",
                "idempotencyKey"
            );
        }

        const storedKey =
            context.persistedIdempotencyKey ||
            context.existingIdempotencyKey;

        if (
            idempotencyKey &&
            storedKey &&
            String(idempotencyKey) !==
                String(storedKey)
        ) {
            valid = false;

            addError(
                "IDEMPOTENCY_KEY_MISMATCH",
                "Idempotency key does not match existing transaction context",
                "idempotencyKey"
            );
        }

        const requestHash =
            context.requestHash;

        const persistedRequestHash =
            context.persistedRequestHash;

        if (
            requestHash &&
            persistedRequestHash &&
            String(requestHash) !==
                String(persistedRequestHash)
        ) {
            valid = false;

            addError(
                "IDEMPOTENCY_REQUEST_MISMATCH",
                "Request payload differs from the persisted idempotent request",
                "requestHash"
            );
        }

        return valid;
    }

    /**
     * =========================================================================
     * ORCHESTRATION STEP VALIDATION
     * =========================================================================
     */

    validateSteps(
        context,
        addError,
        addWarning
    ) {
        let valid = true;

        const steps =
            context.steps ||
            context.executionSteps ||
            context.transaction?.steps ||
            [];

        if (!Array.isArray(steps)) {
            addError(
                "INVALID_STEPS",
                "Transaction steps must be an array",
                "steps"
            );

            return false;
        }

        if (
            steps.length >
            this.config.maxSteps
        ) {
            valid = false;

            addError(
                "STEP_LIMIT_EXCEEDED",
                "Maximum transaction orchestration step count exceeded",
                "steps"
            );
        }

        const stepIds =
            new Set();

        let completedCount = 0;
        let failedCount = 0;

        steps.forEach(
            (step, index) => {
                if (!step) {
                    valid = false;

                    addError(
                        "INVALID_STEP",
                        "Orchestration step cannot be null",
                        `steps[${index}]`
                    );

                    return;
                }

                const stepId =
                    step.stepId ||
                    step.id ||
                    step.name;

                if (!this.hasValue(stepId)) {
                    valid = false;

                    addError(
                        "MISSING_STEP_ID",
                        "Orchestration step identifier is required",
                        `steps[${index}]`
                    );

                    return;
                }

                const normalizedId =
                    String(stepId);

                if (
                    stepIds.has(normalizedId)
                ) {
                    valid = false;

                    addError(
                        "DUPLICATE_STEP_ID",
                        "Duplicate orchestration step detected",
                        `steps[${index}]`,
                        {
                            stepId:
                                normalizedId,
                        }
                    );
                }

                stepIds.add(
                    normalizedId
                );

                const state =
                    step.state ||
                    step.status ||
                    "PENDING";

                if (
                    !STEP_STATES.includes(state)
                ) {
                    valid = false;

                    addError(
                        "INVALID_STEP_STATE",
                        `Invalid orchestration step state: ${state}`,
                        `steps[${index}].state`
                    );
                }

                if (
                    state === "COMPLETED" ||
                    state === "COMPENSATED"
                ) {
                    completedCount++;
                }

                if (
                    state === "FAILED"
                ) {
                    failedCount++;
                }

                if (
                    state === "COMPLETED" &&
                    step.error
                ) {
                    valid = false;

                    addError(
                        "COMPLETED_STEP_HAS_ERROR",
                        "Completed step cannot contain an execution error",
                        `steps[${index}]`
                    );
                }

                if (
                    state === "FAILED" &&
                    !step.error &&
                    !step.failureReason
                ) {
                    addWarning(
                        "FAILED_STEP_WITHOUT_REASON",
                        "Failed orchestration step has no failure reason",
                        `steps[${index}]`
                    );
                }
            }
        );

        if (
            context.state === "COMPLETED" &&
            steps.length > 0 &&
            completedCount !== steps.length
        ) {
            valid = false;

            addError(
                "INCOMPLETE_STEPS_FOR_COMPLETED_TRANSACTION",
                "Transaction cannot be completed while orchestration steps remain incomplete",
                "steps"
            );
        }

        if (
            context.state === "FAILED" &&
            failedCount === 0 &&
            steps.length > 0
        ) {
            addWarning(
                "FAILED_TRANSACTION_WITHOUT_FAILED_STEP",
                "Transaction is marked failed but no failed orchestration step was recorded",
                "steps"
            );
        }

        return valid;
    }

    /**
     * =========================================================================
     * COMPENSATION VALIDATION
     * =========================================================================
     */

    validateCompensation(
        context,
        addError,
        addWarning
    ) {
        let valid = true;

        const state =
            context.state ||
            context.transaction?.state;

        const compensation =
            context.compensation ||
            context.transaction?.compensation;

        if (
            !compensation
        ) {
            if (
                COMPENSATION_STATES.includes(
                    state
                )
            ) {
                valid = false;

                addError(
                    "MISSING_COMPENSATION_CONTEXT",
                    "Compensation context is required for a compensation state",
                    "compensation"
                );
            }

            return valid;
        }

        const compensationState =
            compensation.state ||
            compensation.status;

        if (
            compensationState &&
            ![
                "PENDING",
                "RUNNING",
                "COMPLETED",
                "FAILED",
                "PARTIAL",
            ].includes(compensationState)
        ) {
            valid = false;

            addError(
                "INVALID_COMPENSATION_STATE",
                `Invalid compensation state: ${compensationState}`,
                "compensation.state"
            );
        }

        const originalTransactionId =
            compensation.originalTransactionId;

        const transactionId =
            context.transactionId ||
            context.transaction?.transactionId ||
            context.transaction?._id;

        if (
            originalTransactionId &&
            transactionId &&
            String(originalTransactionId) !==
                String(transactionId)
        ) {
            valid = false;

            addError(
                "COMPENSATION_TRANSACTION_MISMATCH",
                "Compensation references a different transaction",
                "compensation.originalTransactionId"
            );
        }

        if (
            compensationState === "COMPLETED" &&
            !compensation.completedAt
        ) {
            addWarning(
                "COMPENSATION_MISSING_COMPLETION_TIMESTAMP",
                "Completed compensation has no completion timestamp",
                "compensation.completedAt"
            );
        }

        return valid;
    }

    /**
     * =========================================================================
     * EXECUTION CONSISTENCY
     * =========================================================================
     */

    validateExecutionConsistency(
        context,
        addError,
        addWarning
    ) {
        let valid = true;

        const executions =
            context.executions ||
            context.executionHistory ||
            [];

        if (!Array.isArray(executions)) {
            addError(
                "INVALID_EXECUTION_HISTORY",
                "Execution history must be an array",
                "executions"
            );

            return false;
        }

        const executionIds =
            new Set();

        executions.forEach(
            (execution, index) => {
                if (!execution) {
                    valid = false;

                    addError(
                        "INVALID_EXECUTION_RECORD",
                        "Execution record cannot be null",
                        `executions[${index}]`
                    );

                    return;
                }

                const executionId =
                    execution.executionId ||
                    execution.id;

                if (
                    executionId
                ) {
                    const normalized =
                        String(executionId);

                    if (
                        executionIds.has(
                            normalized
                        )
                    ) {
                        valid = false;

                        addError(
                            "DUPLICATE_EXECUTION_ID",
                            "Duplicate execution record detected",
                            `executions[${index}]`
                        );
                    }

                    executionIds.add(
                        normalized
                    );
                }

                if (
                    execution.status ===
                        "COMPLETED" &&
                    execution.error
                ) {
                    valid = false;

                    addError(
                        "COMPLETED_EXECUTION_HAS_ERROR",
                        "Completed execution cannot contain an error",
                        `executions[${index}]`
                    );
                }

                if (
                    execution.status ===
                        "FAILED" &&
                    !execution.error &&
                    !execution.failureReason
                ) {
                    addWarning(
                        "FAILED_EXECUTION_WITHOUT_REASON",
                        "Failed execution has no failure reason",
                        `executions[${index}]`
                    );
                }
            }
        );

        return valid;
    }

    /**
     * =========================================================================
     * TENANT ISOLATION
     * =========================================================================
     */

    validateTenantIsolation(
        context,
        addError,
        addWarning
    ) {
        let valid = true;

        const tenantId =
            context.tenantId ||
            context.transaction?.tenantId;

        if (!tenantId) {
            return true;
        }

        const candidateObjects = [
            context.transaction,
            context.user,
            context.member,
            context.account,
            context.sourceAccount,
            context.destinationAccount,
            ...(Array.isArray(context.participants)
                ? context.participants
                : []),
        ].filter(Boolean);

        candidateObjects.forEach(
            (object, index) => {
                if (
                    object.tenantId &&
                    String(object.tenantId) !==
                        String(tenantId)
                ) {
                    valid = false;

                    addError(
                        "TENANT_ISOLATION_VIOLATION",
                        "Related transaction object belongs to a different tenant",
                        `tenantContext[${index}].tenantId`,
                        {
                            expectedTenantId:
                                String(tenantId),
                            actualTenantId:
                                String(
                                    object.tenantId
                                ),
                        }
                    );
                }
            }
        );

        return valid;
    }

    /**
     * =========================================================================
     * TIMESTAMP CONSISTENCY
     * =========================================================================
     */

    validateTimestamps(
        context,
        addError,
        addWarning
    ) {
        let valid = true;

        const transaction =
            context.transaction || context;

        const createdAt =
            context.createdAt ||
            transaction.createdAt;

        const updatedAt =
            context.updatedAt ||
            transaction.updatedAt;

        const completedAt =
            context.completedAt ||
            transaction.completedAt;

        const createdDate =
            this.toDate(createdAt);

        const updatedDate =
            this.toDate(updatedAt);

        const completedDate =
            this.toDate(completedAt);

        if (
            createdAt &&
            !createdDate
        ) {
            valid = false;

            addError(
                "INVALID_CREATED_AT",
                "createdAt must be a valid date",
                "createdAt"
            );
        }

        if (
            updatedAt &&
            !updatedDate
        ) {
            valid = false;

            addError(
                "INVALID_UPDATED_AT",
                "updatedAt must be a valid date",
                "updatedAt"
            );
        }

        if (
            completedAt &&
            !completedDate
        ) {
            valid = false;

            addError(
                "INVALID_COMPLETED_AT",
                "completedAt must be a valid date",
                "completedAt"
            );
        }

        if (
            createdDate &&
            updatedDate &&
            updatedDate < createdDate
        ) {
            valid = false;

            addError(
                "INVALID_TIMESTAMP_ORDER",
                "updatedAt cannot be earlier than createdAt",
                "updatedAt"
            );
        }

        if (
            createdDate &&
            completedDate &&
            completedDate < createdDate
        ) {
            valid = false;

            addError(
                "INVALID_COMPLETION_TIMESTAMP",
                "completedAt cannot be earlier than createdAt",
                "completedAt"
            );
        }

        if (
            updatedDate &&
            updatedDate.getTime() >
                Date.now() + 5 * 60 * 1000
        ) {
            addWarning(
                "FUTURE_UPDATED_TIMESTAMP",
                "updatedAt is significantly in the future",
                "updatedAt"
            );
        }

        return valid;
    }

    /**
     * =========================================================================
     * CROSS-FIELD INVARIANTS
     * =========================================================================
     */

    validateInvariants(
        context,
        addError,
        addWarning
    ) {
        let valid = true;

        const state =
            context.state ||
            context.transaction?.state;

        const transaction =
            context.transaction || context;

        const decision =
            context.decision ||
            transaction.decision;

        if (
            state === "COMPLETED" &&
            decision &&
            [
                "BLOCK",
                "REJECT",
                "DENY",
            ].includes(
                String(decision).toUpperCase()
            )
        ) {
            valid = false;

            addError(
                "COMPLETED_TRANSACTION_HAS_REJECTED_DECISION",
                "A completed transaction cannot have a blocking or rejected decision",
                "decision"
            );
        }

        if (
            state === "COMPENSATED" &&
            context.compensation &&
            context.compensation.state ===
                "FAILED"
        ) {
            valid = false;

            addError(
                "COMPENSATED_TRANSACTION_HAS_FAILED_COMPENSATION",
                "Transaction cannot be compensated while compensation is marked failed",
                "compensation.state"
            );
        }

        if (
            state === "CLOSED" &&
            !context.closedAt
        ) {
            addWarning(
                "CLOSED_TRANSACTION_WITHOUT_CLOSED_AT",
                "Closed transaction has no closedAt timestamp",
                "closedAt"
            );
        }

        if (
            ACTIVE_STATES.includes(state) &&
            context.completedAt
        ) {
            valid = false;

            addError(
                "ACTIVE_TRANSACTION_HAS_COMPLETION_TIMESTAMP",
                "An active transaction cannot have a completion timestamp",
                "completedAt"
            );
        }

        return valid;
    }

    /**
     * =========================================================================
     * DUPLICATE TRANSACTION DETECTION
     * =========================================================================
     *
     * This method is intentionally deterministic and database-independent.
     * Callers may use it after retrieving candidate records from their
     * persistence layer.
     */

    detectDuplicateTransactions(
        transactions = [],
        options = {}
    ) {
        if (!Array.isArray(transactions)) {
            throw new TypeError(
                "transactions must be an array"
            );
        }

        const keyBuilder =
            options.keyBuilder ||
            ((transaction) =>
                transaction.idempotencyKey ||
                transaction.transactionId ||
                transaction._id);

        const groups =
            new Map();

        transactions.forEach(
            (transaction) => {
                const key =
                    keyBuilder(transaction);

                if (!this.hasValue(key)) {
                    return;
                }

                const normalized =
                    String(key);

                if (!groups.has(normalized)) {
                    groups.set(
                        normalized,
                        []
                    );
                }

                groups
                    .get(normalized)
                    .push(transaction);
            }
        );

        const duplicates = [];

        for (const [
            key,
            records,
        ] of groups.entries()) {
            if (records.length > 1) {
                duplicates.push({
                    key,
                    count: records.length,
                    transactions: records,
                });
            }
        }

        return {
            duplicateCount:
                duplicates.length,
            duplicates,
            valid:
                duplicates.length === 0,
        };
    }

    /**
     * =========================================================================
     * IDEMPOTENCY CONFLICT DETECTION
     * =========================================================================
     */

    detectIdempotencyConflict(
        existingTransaction,
        incomingTransaction
    ) {
        if (
            !existingTransaction ||
            !incomingTransaction
        ) {
            return {
                conflict: false,
                reason: null,
            };
        }

        const existingKey =
            existingTransaction.idempotencyKey;

        const incomingKey =
            incomingTransaction.idempotencyKey;

        if (
            !existingKey ||
            !incomingKey
        ) {
            return {
                conflict: false,
                reason: null,
            };
        }

        if (
            String(existingKey) !==
            String(incomingKey)
        ) {
            return {
                conflict: false,
                reason: null,
            };
        }

        const comparableFields = [
            "amount",
            "currency",
            "type",
            "sourceAccountId",
            "destinationAccountId",
            "beneficiaryId",
        ];

        const differences = [];

        comparableFields.forEach(
            (field) => {
                const existing =
                    existingTransaction[
                        field
                    ];

                const incoming =
                    incomingTransaction[
                        field
                    ];

                if (
                    existing !== undefined &&
                    incoming !== undefined &&
                    String(existing) !==
                        String(incoming)
                ) {
                    differences.push({
                        field,
                        existing,
                        incoming,
                    });
                }
            }
        );

        return {
            conflict:
                differences.length > 0,
            reason:
                differences.length > 0
                    ? "IDEMPOTENCY_PAYLOAD_CONFLICT"
                    : null,
            differences,
        };
    }

    /**
     * =========================================================================
     * FINANCIAL DOUBLE-ENTRY VALIDATION
     * =========================================================================
     *
     * Generic validator for orchestration payloads containing ledger entries.
     *
     * It does not post anything to the ledger.
     */

    validateLedgerBalance(
        entries = [],
        options = {}
    ) {
        if (!Array.isArray(entries)) {
            return {
                valid: false,
                reason: "INVALID_LEDGER_ENTRIES",
            };
        }

        const tolerance =
            Number.isFinite(
                Number(options.tolerance)
            )
                ? Number(options.tolerance)
                : 0.000001;

        let totalDebit = 0;
        let totalCredit = 0;

        const errors = [];

        entries.forEach(
            (entry, index) => {
                const debit =
                    Number(entry?.debit || 0);

                const credit =
                    Number(entry?.credit || 0);

                if (
                    !Number.isFinite(debit) ||
                    !Number.isFinite(credit)
                ) {
                    errors.push({
                        code: "INVALID_LEDGER_AMOUNT",
                        index,
                    });

                    return;
                }

                if (
                    debit < 0 ||
                    credit < 0
                ) {
                    errors.push({
                        code: "NEGATIVE_LEDGER_AMOUNT",
                        index,
                    });
                }

                if (
                    debit > 0 &&
                    credit > 0
                ) {
                    errors.push({
                        code: "ENTRY_HAS_BOTH_DEBIT_AND_CREDIT",
                        index,
                    });
                }

                if (
                    debit === 0 &&
                    credit === 0
                ) {
                    errors.push({
                        code: "ENTRY_HAS_ZERO_DEBIT_AND_CREDIT",
                        index,
                    });
                }

                totalDebit += debit;
                totalCredit += credit;
            }
        );

        const difference =
            Math.abs(
                totalDebit -
                    totalCredit
            );

        if (
            difference > tolerance
        ) {
            errors.push({
                code: "LEDGER_UNBALANCED",
                totalDebit,
                totalCredit,
                difference,
            });
        }

        return {
            valid:
                errors.length === 0,
            totalDebit,
            totalCredit,
            difference,
            errors,
        };
    }

    /**
     * =========================================================================
     * HASH / INTEGRITY VALIDATION
     * =========================================================================
     *
     * Supports orchestration records that maintain a previous hash/current
     * hash chain. This does not persist changes.
     */

    validateHashIntegrity(
        record,
        canonicalPayload,
        options = {}
    ) {
        if (!record) {
            return {
                valid: false,
                reason: "MISSING_RECORD",
            };
        }

        const algorithm =
            options.algorithm ||
            "sha256";

        const previousHash =
            record.previousHash || "";

        const expectedHash =
            record.hash;

        if (!expectedHash) {
            return {
                valid: false,
                reason: "MISSING_HASH",
            };
        }

        const payload =
            `${previousHash}|${this.stableSerialize(
                canonicalPayload
            )}`;

        const calculatedHash =
            crypto
                .createHash(algorithm)
                .update(payload)
                .digest("hex");

        return {
            valid:
                calculatedHash ===
                expectedHash,
            expectedHash,
            calculatedHash,
            algorithm,
        };
    }

    /**
     * =========================================================================
     * STABLE SERIALIZATION
     * =========================================================================
     */

    stableSerialize(value) {
        if (
            value === null ||
            value === undefined
        ) {
            return String(value);
        }

        if (
            typeof value !==
            "object"
        ) {
            return JSON.stringify(
                value
            );
        }

        if (Array.isArray(value)) {
            return `[${value
                .map((item) =>
                    this.stableSerialize(
                        item
                    )
                )
                .join(",")}]`;
        }

        const keys =
            Object.keys(value)
                .sort();

        return `{${keys
            .map(
                (key) =>
                    `${JSON.stringify(
                        key
                    )}:${this.stableSerialize(
                        value[key]
                    )}`
            )
            .join(",")}}`;
    }

    /**
     * =========================================================================
     * UTILITY VALIDATORS
     * =========================================================================
     */

    hasValue(value) {
        return !(
            value === undefined ||
            value === null ||
            value === ""
        );
    }

    toDate(value) {
        if (!value) {
            return null;
        }

        const date =
            value instanceof Date
                ? new Date(value.getTime())
                : new Date(value);

        return Number.isNaN(
            date.getTime()
        )
            ? null
            : date;
    }

    /**
     * =========================================================================
     * CONSTANT / METADATA ACCESSORS
     * =========================================================================
     */

    getTransactionStates() {
        return [
            ...TRANSACTION_STATES,
        ];
    }

    getTerminalStates() {
        return [
            ...TERMINAL_STATES,
        ];
    }

    getActiveStates() {
        return [
            ...ACTIVE_STATES,
        ];
    }

    getStepStates() {
        return [
            ...STEP_STATES,
        ];
    }

    getConfig() {
        return {
            ...this.config,
        };
    }
}

/**
 * ============================================================================
 * EXPORT
 * ============================================================================
 *
 * Export an instantiated service to remain compatible with the existing
 * service-oriented architecture:
 *
 * const ConsistencyValidator =
 *     require("./ConsistencyValidator");
 *
 * ============================================================================
 */

module.exports =
    new ConsistencyValidator();