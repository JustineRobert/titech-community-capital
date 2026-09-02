"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * African Community Finance Operating System (ACFOS)
 * =============================================================================
 *
 * File:
 *   backend/services/financial/financialTransaction.service.js
 *
 * Purpose:
 *   Central atomic financial transaction boundary.
 *
 * Architectural Position:
 *
 *   Authentication
 *        │
 *        ▼
 *   Tenant Authorization
 *        │
 *        ▼
 *   Idempotency Middleware
 *        │
 *        ▼
 *   Financial Transaction Service
 *        │
 *        │ MongoDB session
 *        ▼
 *   ┌────────────────────────────────────────────────────────────┐
 *   │                    MongoDB Transaction                     │
 *   │                                                            │
 *   │ FinancialTransaction Repository                            │
 *   │ Balance Repository                                         │
 *   │ Loan Repository                                            │
 *   │ Ledger Repository                                          │
 *   │ Audit / Outbox Repository                                  │
 *   │ Idempotency Completion                                     │
 *   └────────────────────────────────────────────────────────────┘
 *        │
 *        ├── COMMIT  → success
 *        │
 *        └── ABORT   → rollback
 *
 * =============================================================================
 *
 * GUARANTEES
 * =============================================================================
 *
 *  ✓ One financial operation has one transaction identity.
 *  ✓ Every financial mutation executes using one MongoDB session.
 *  ✓ Financial repositories never create transactions.
 *  ✓ Financial repositories never commit transactions.
 *  ✓ Financial repositories never abort transactions.
 *  ✓ Idempotency COMPLETED state commits atomically with financial writes.
 *  ✓ Financial failures roll back financial mutations.
 *  ✓ FAILED idempotency state is persisted only after rollback.
 *  ✓ Transient transaction errors may retry.
 *  ✓ Unknown commit results are never treated as safe transaction failures.
 *  ✓ Unknown commit results never trigger financial re-execution.
 *  ✓ Commit itself may be retried when MongoDB reports an unknown result.
 *
 * =============================================================================
 */

const crypto =
    require("crypto");

const mongoose =
    require("mongoose");

const {
    completeOperation,
    failOperation
} = require(
    "../idempotency/idempotency.service"
);

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_MAX_TRANSACTION_RETRIES =
    3;

const DEFAULT_MAX_COMMIT_RETRIES =
    3;

const MIN_TRANSACTION_RETRIES =
    1;

const MAX_TRANSACTION_RETRIES =
    10;

const MIN_COMMIT_RETRIES =
    1;

const MAX_COMMIT_RETRIES =
    10;

const IDEMPOTENT_FINANCIAL_TRANSACTION_OPTIONS =
    Object.freeze({

        readConcern: {

            level:
                "snapshot"

        },

        writeConcern: {

            w:
                "majority"

        },

        readPreference:
            "primary"

    });

// =============================================================================
// Errors
// =============================================================================

class FinancialTransactionError
    extends Error {

    constructor(
        message,
        code,
        statusCode = 500,
        details = null
    ) {

        super(
            message
        );

        this.name =
            "FinancialTransactionError";

        this.code =
            code;

        this.statusCode =
            statusCode;

        this.details =
            details;

        if (
            Error.captureStackTrace
        ) {

            Error.captureStackTrace(
                this,
                FinancialTransactionError
            );
        }
    }
}

// =============================================================================
// Generic Validation
// =============================================================================

function assertFunction(
    value,
    name
) {

    if (
        typeof value !==
        "function"
    ) {

        throw new FinancialTransactionError(

            `${name} must be a function.`,

            "FINANCIAL_EXECUTOR_REQUIRED",

            500

        );
    }
}

function requireIdentifier(
    value,
    field,
    maxLength = 256
) {

    if (
        value === undefined ||
        value === null
    ) {

        throw new FinancialTransactionError(

            `${field} is required.`,

            "FINANCIAL_FIELD_REQUIRED",

            400,

            {
                field
            }

        );
    }

    const normalized =
        String(value).trim();

    if (
        normalized.length === 0
    ) {

        throw new FinancialTransactionError(

            `${field} is required.`,

            "FINANCIAL_FIELD_REQUIRED",

            400,

            {
                field
            }

        );
    }

    if (
        normalized.length >
        maxLength
    ) {

        throw new FinancialTransactionError(

            `${field} exceeds the maximum permitted length.`,

            "FINANCIAL_FIELD_TOO_LONG",

            400,

            {
                field,
                maxLength
            }

        );
    }

    return normalized;
}

// =============================================================================
// Financial Context Validation
// =============================================================================

function validateFinancialContext({

    tenantId,

    principalId,

    operation,

    resource

}) {

    requireIdentifier(
        tenantId,
        "tenantId"
    );

    requireIdentifier(
        principalId,
        "principalId"
    );

    requireIdentifier(
        operation,
        "operation"
    );

    requireIdentifier(
        resource,
        "resource"
    );
}

// =============================================================================
// Retry Validation
// =============================================================================

function normalizeRetryLimit(
    value,
    field,
    minimum,
    maximum,
    fallback
) {

    if (
        value === undefined ||
        value === null
    ) {

        return fallback;
    }

    const numeric =
        Number(value);

    if (
        !Number.isInteger(numeric) ||
        numeric < minimum ||
        numeric > maximum
    ) {

        throw new FinancialTransactionError(

            `${field} must be an integer between ${minimum} and ${maximum}.`,

            "FINANCIAL_INVALID_RETRY_LIMIT",

            500,

            {
                field,
                minimum,
                maximum
            }

        );
    }

    return numeric;
}

// =============================================================================
// MongoDB Error Classification
// =============================================================================

function hasMongoErrorLabel(
    error,
    label
) {

    return Boolean(

        error &&

        typeof error.hasErrorLabel ===
        "function" &&

        error.hasErrorLabel(
            label
        )

    );
}

function isTransientTransactionError(
    error
) {

    return hasMongoErrorLabel(

        error,

        "TransientTransactionError"

    );
}

function isUnknownCommitResult(
    error
) {

    return hasMongoErrorLabel(

        error,

        "UnknownTransactionCommitResult"

    );
}

// =============================================================================
// Transaction ID
// =============================================================================

function createTransactionId() {

    return [

        "TXN",

        Date.now(),

        crypto.randomUUID()

    ].join("-");

}

// =============================================================================
// Session
// =============================================================================

async function createSession() {

    return mongoose.startSession();

}

// =============================================================================
// Commit With Retry
// =============================================================================
//
// IMPORTANT:
//
// UnknownTransactionCommitResult means MongoDB cannot tell the client whether
// the commit succeeded.
//
// Therefore:
//
//     retry commit
//
// is safe.
//
// But:
//
//     execute financial mutation again
//
// is NOT safe.
//
// =============================================================================

async function commitWithRetry({

    session,

    maxCommitRetries =
    DEFAULT_MAX_COMMIT_RETRIES

}) {

    const retryLimit =
        normalizeRetryLimit(

            maxCommitRetries,

            "maxCommitRetries",

            MIN_COMMIT_RETRIES,

            MAX_COMMIT_RETRIES,

            DEFAULT_MAX_COMMIT_RETRIES

        );

    let attempt =
        0;

    while (
        attempt <
        retryLimit
    ) {

        attempt += 1;

        try {

            await session.commitTransaction();

            return {

                committed:
                    true,

                attempts:
                    attempt

            };

        } catch (error) {

            if (
                isUnknownCommitResult(
                    error
                ) &&
                attempt <
                retryLimit
            ) {

                continue;
            }

            if (
                isUnknownCommitResult(
                    error
                )
            ) {

                throw new FinancialTransactionError(

                    "The financial transaction commit result could not be confirmed.",

                    "FINANCIAL_COMMIT_RESULT_UNKNOWN",

                    503,

                    {

                        commitAttempts:
                            attempt

                    }

                );
            }

            throw error;
        }
    }

    throw new FinancialTransactionError(

        "Financial transaction commit failed.",

        "FINANCIAL_COMMIT_FAILED",

        503

    );
}

// =============================================================================
// Complete Idempotency
// =============================================================================
//
// This operation MUST execute while the financial MongoDB transaction is open.
//
// Therefore:
//
//     financial writes
//           +
//     idempotency COMPLETED
//
// become one atomic commit.
//
// =============================================================================

async function completeIdempotency({

    idempotencyRecord,

    executionResult,

    session

}) {

    const completed =
        await completeOperation({

            recordId:
                idempotencyRecord._id,

            httpStatus:
                executionResult.httpStatus ||
                200,

            responseBody:
                executionResult.responseBody ||
                {},

            resultType:
                executionResult.resultType ||
                "SUCCESS",

            errorCode:
                executionResult.errorCode ||
                null,

            session

        });

    if (
        !completed
    ) {

        throw new FinancialTransactionError(

            "Unable to finalize the idempotency record.",

            "IDEMPOTENCY_COMPLETION_FAILED",

            500

        );
    }

    return completed;
}

// =============================================================================
// Execute Financial Transaction
// =============================================================================

async function executeFinancialTransaction({

    transactionId,

    idempotencyRecord,

    execute,

    transactionOptions =
    IDEMPOTENT_FINANCIAL_TRANSACTION_OPTIONS,

    maxTransactionRetries =
    DEFAULT_MAX_TRANSACTION_RETRIES,

    maxCommitRetries =
    DEFAULT_MAX_COMMIT_RETRIES

}) {

    assertFunction(
        execute,
        "execute"
    );

    if (
        !idempotencyRecord ||
        !idempotencyRecord._id
    ) {

        throw new FinancialTransactionError(

            "Idempotency record is required.",

            "FINANCIAL_IDEMPOTENCY_RECORD_REQUIRED",

            500

        );
    }

    const normalizedTransactionId =
        requireIdentifier(

            transactionId,

            "transactionId",

            256

        );

    const transactionRetryLimit =
        normalizeRetryLimit(

            maxTransactionRetries,

            "maxTransactionRetries",

            MIN_TRANSACTION_RETRIES,

            MAX_TRANSACTION_RETRIES,

            DEFAULT_MAX_TRANSACTION_RETRIES

        );

    const commitRetryLimit =
        normalizeRetryLimit(

            maxCommitRetries,

            "maxCommitRetries",

            MIN_COMMIT_RETRIES,

            MAX_COMMIT_RETRIES,

            DEFAULT_MAX_COMMIT_RETRIES

        );

    const session =
        await createSession();

    let transactionAttempt =
        0;

    let transactionStarted =
        false;

    try {

        while (
            transactionAttempt <
            transactionRetryLimit
        ) {

            transactionAttempt += 1;

            transactionStarted =
                false;

            try {

                // =============================================================
                // Start transaction
                // =============================================================

                session.startTransaction(

                    transactionOptions

                );

                transactionStarted =
                    true;

                // =============================================================
                // Execute financial operation
                // =============================================================

                const executionResult =
                    await execute({

                        session,

                        transactionId:
                            normalizedTransactionId,

                        idempotencyRecord

                    });

                if (
                    !executionResult
                ) {

                    throw new FinancialTransactionError(

                        "Financial operation did not return an execution result.",

                        "FINANCIAL_EXECUTION_RESULT_MISSING",

                        500

                    );
                }

                // =============================================================
                // Idempotency completion
                // =============================================================

                if (
                    executionResult.completeIdempotency !==
                    false
                ) {

                    await completeIdempotency({

                        idempotencyRecord,

                        executionResult,

                        session

                    });
                }

                // =============================================================
                // Commit
                // =============================================================

                const commitResult =
                    await commitWithRetry({

                        session,

                        maxCommitRetries:
                            commitRetryLimit

                    });

                transactionStarted =
                    false;

                // =============================================================
                // Success
                // =============================================================

                return {

                    success:
                        true,

                    transactionId:
                        normalizedTransactionId,

                    idempotencyRecordId:
                        idempotencyRecord._id,

                    httpStatus:
                        executionResult.httpStatus ||
                        200,

                    responseBody:
                        executionResult.responseBody ||
                        {},

                    resultType:
                        executionResult.resultType ||
                        "SUCCESS",

                    transactionAttempts:
                        transactionAttempt,

                    commitAttempts:
                        commitResult.attempts

                };

            } catch (error) {

                // =============================================================
                // UNKNOWN COMMIT RESULT
                // =============================================================
                //
                // Never abort.
                //
                // Never retry execute().
                //
                // Never mark idempotency FAILED.
                //
                // Reconciliation must determine the final state.
                // =============================================================

                if (
                    isUnknownCommitResult(
                        error
                    ) ||
                    error?.code ===
                    "FINANCIAL_COMMIT_RESULT_UNKNOWN"
                ) {

                    transactionStarted =
                        false;

                    throw new FinancialTransactionError(

                        "Financial transaction outcome is unknown and requires reconciliation.",

                        "FINANCIAL_COMMIT_RESULT_UNKNOWN",

                        503,

                        {

                            transactionId:
                                normalizedTransactionId,

                            transactionAttempts:
                                transactionAttempt

                        }

                    );
                }

                // =============================================================
                // Abort current transaction
                // =============================================================

                if (
                    transactionStarted &&
                    session.inTransaction()
                ) {

                    try {

                        await session.abortTransaction();

                    } catch (
                    abortError
                    ) {

                        /*
                         * Preserve the original financial error.
                         */

                    }

                    transactionStarted =
                        false;
                }

                // =============================================================
                // Retry transient transaction errors
                // =============================================================

                if (
                    isTransientTransactionError(
                        error
                    ) &&
                    transactionAttempt <
                    transactionRetryLimit
                ) {

                    continue;
                }

                throw error;
            }
        }

        throw new FinancialTransactionError(

            "Financial transaction retry limit exceeded.",

            "FINANCIAL_TRANSACTION_RETRY_LIMIT",

            503,

            {

                transactionId:
                    normalizedTransactionId,

                transactionAttempts:
                    transactionAttempt

            }

        );

    } finally {

        // =====================================================================
        // Defensive transaction cleanup
        // =====================================================================

        if (
            transactionStarted &&
            session.inTransaction()
        ) {

            try {

                await session.abortTransaction();

            } catch (
            cleanupError
            ) {

                /*
                 * Cleanup must never replace the original financial error.
                 */

            }
        }

        await session.endSession();

    }
}

// =============================================================================
// Persist Failure After Rollback
// =============================================================================
//
// IMPORTANT:
//
// This function is deliberately outside the MongoDB financial transaction.
//
// At this point:
//
//     financial transaction = ABORTED
//
// Therefore:
//
//     FAILED idempotency state
//
// cannot accidentally roll back together with the financial failure.
//
// =============================================================================

async function persistFinancialFailure({

    recordId,

    transactionId,

    error

}) {

    try {

        await failOperation({

            recordId,

            httpStatus:
                error?.statusCode ||
                error?.status ||
                500,

            responseBody: {

                success:
                    false,

                code:
                    error?.code ||
                    "FINANCIAL_OPERATION_FAILED",

                message:
                    error?.message ||
                    "Financial operation failed.",

                transactionId

            },

            errorCode:
                error?.code ||
                "FINANCIAL_OPERATION_FAILED"

        });

    } catch (
    idempotencyError
    ) {

        /*
         * The financial error remains authoritative.
         *
         * Failure persistence should be visible to observability and
         * reconciliation infrastructure.
         *
         * Do NOT replace the original financial exception.
         */

    }
}

// =============================================================================
// Main Financial Operation
// =============================================================================

async function processFinancialOperation({

    tenantId,

    principalId,

    operation,

    resource,

    transactionId,

    idempotency,

    execute,

    transactionOptions,

    maxTransactionRetries,

    maxCommitRetries

}) {

    // =========================================================================
    // Context validation
    // =========================================================================

    validateFinancialContext({

        tenantId,

        principalId,

        operation,

        resource

    });

    // =========================================================================
    // Idempotency validation
    // =========================================================================

    if (
        !idempotency
    ) {

        throw new FinancialTransactionError(

            "Idempotency context is required for financial operations.",

            "FINANCIAL_IDEMPOTENCY_REQUIRED",

            500

        );
    }

    if (
        idempotency.state !==
        "NEW"
    ) {

        throw new FinancialTransactionError(

            "Financial execution requires a NEW idempotency operation.",

            "FINANCIAL_IDEMPOTENCY_INVALID_STATE",

            409,

            {

                state:
                    idempotency.state

            }

        );
    }

    if (
        !idempotency.recordId
    ) {

        throw new FinancialTransactionError(

            "Idempotency record identifier is missing.",

            "FINANCIAL_IDEMPOTENCY_RECORD_MISSING",

            500

        );
    }

    // =========================================================================
    // One transaction identity for the complete business operation
    // =========================================================================

    const effectiveTransactionId =
        transactionId ||
        createTransactionId();

    const idempotencyRecord = {

        _id:
            idempotency.recordId,

        key:
            idempotency.key,

        fingerprint:
            idempotency.fingerprint,

        tenantId,

        principalId,

        operation,

        resource

    };

    try {

        return await executeFinancialTransaction({

            transactionId:
                effectiveTransactionId,

            idempotencyRecord,

            execute,

            transactionOptions,

            maxTransactionRetries,

            maxCommitRetries

        });

    } catch (error) {

        // =====================================================================
        // UNKNOWN COMMIT
        // =====================================================================
        //
        // The operation may have committed.
        //
        // Therefore FAILED must NOT be written.
        // =====================================================================

        if (
            error?.code ===
            "FINANCIAL_COMMIT_RESULT_UNKNOWN"
        ) {

            throw error;
        }

        // =====================================================================
        // Financial transaction was aborted.
        //
        // Safe point for FAILED idempotency persistence.
        // =====================================================================

        await persistFinancialFailure({

            recordId:
                idempotency.recordId,

            transactionId:
                effectiveTransactionId,

            error

        });

        throw error;
    }
}

// =============================================================================
// Repository Contract
// =============================================================================
//
// This is an architectural declaration.
//
// Every financial repository must accept `session` for financial mutations.
//
// A repository violating this contract can silently break atomicity.
//
// IMPORTANT:
//
// The Financial Transaction Service owns the transaction boundary.
// Repositories only participate in the transaction through the supplied
// MongoDB session.
//
// Loan mutations:
//
//     disburse()
//         ├── validates APPROVED state atomically
//         ├── increments disbursedAmount
//         └── increments outstandingAmount
//
//     repay()
//         ├── validates outstandingAmount >= repayment
//         ├── decrements outstandingAmount atomically
//         ├── increments repaidAmount
//         └── transitions to PARTIALLY_REPAID / REPAID
//
//     markActive()
//         └── transitions DISBURSED → ACTIVE
//
// =============================================================================

const FINANCIAL_TRANSACTION_REPOSITORY_CONTRACT =
    Object.freeze({

        transaction:
            Object.freeze([

                "create",

                "findById"

            ]),

        ledger:
            Object.freeze([

                "createEntry",

                "createEntries"

            ]),

        balance:
            Object.freeze([

                "getForUpdate",

                "increment",

                "decrement"

            ]),

        loan:
            Object.freeze([

                "findById",

                "disburse",

                "repay",

                "markActive"

            ])

    });

// =============================================================================
// Exports
// =============================================================================

module.exports = {

    FinancialTransactionError,

    FINANCIAL_TRANSACTION_REPOSITORY_CONTRACT,

    executeFinancialTransaction,

    processFinancialOperation,

    createTransactionId

};