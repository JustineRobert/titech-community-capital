"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * African Community Finance Operating System (ACFOS)
 * Financial Controller
 * =============================================================================
 *
 * File:
 *   backend/controllers/financial/financial.controller.js
 *
 * Purpose:
 *   Thin HTTP controller boundary for ACFOS financial operations.
 *
 * Responsibilities:
 *
 *   ✓ Extract authenticated financial context
 *   ✓ Validate HTTP request input
 *   ✓ Delegate financial execution
 *   ✓ Invoke the atomic financial transaction service
 *   ✓ Return deterministic responses
 *
 * Explicitly NOT responsible for:
 *
 *   ✗ Balance mutation
 *   ✗ Ledger mutation
 *   ✗ Financial transaction persistence
 *   ✗ MongoDB session management
 *   ✗ Idempotency persistence
 *   ✗ Retry logic
 *   ✗ Transaction commits
 *   ✗ Transaction rollbacks
 *
 * Architecture:
 *
 *   HTTP
 *      │
 *      ▼
 *   Controller
 *      │
 *      ▼
 *   processFinancialOperation()
 *      │
 *      ▼
 *   Financial Operation Service
 *      │
 *      ▼
 *   MongoDB Transaction
 *      │
 *      ├── Financial Transaction
 *      ├── Ledger
 *      ├── Balance
 *      └── Idempotency
 *      │
 *      ▼
 *    COMMIT
 *
 * =============================================================================
 */

const {
    processFinancialOperation,
    FinancialTransactionError
} = require(
    "../../services/financial/financialTransaction.service"
);

const {
    executeFinancialOperation
} = require(
    "../../services/financial/financialOperation.service"
);

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_SUCCESS_STATUS =
    200;

// =============================================================================
// Controller Error
// =============================================================================

class FinancialControllerError
    extends Error {

    constructor(
        message,
        code,
        statusCode = 400,
        details = null
    ) {

        super(message);

        this.name =
            "FinancialControllerError";

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
                FinancialControllerError
            );
        }
    }
}

// =============================================================================
// Context Extraction
// =============================================================================

function getPrincipalId(req) {

    return normalizeIdentifier(
        req.user?.id ||
        req.user?._id ||
        req.auth?.userId ||
        req.auth?.principalId
    );
}

function getTenantId(req) {

    return normalizeIdentifier(
        req.tenantId ||
        req.auth?.tenantId ||
        req.user?.tenantId
    );
}

function getDeviceId(req) {

    return normalizeIdentifier(
        req.deviceId ||
        req.headers?.["x-device-id"]
    );
}

function getTransactionId(req) {

    return normalizeIdentifier(
        req.transactionId ||
        req.headers?.["x-transaction-id"]
    );
}

function normalizeIdentifier(value) {

    if (
        value === null ||
        value === undefined
    ) {

        return null;
    }

    const normalized =
        String(value).trim();

    return normalized || null;
}

// =============================================================================
// HTTP Request Validation
// =============================================================================

function assertRequestContext({
    req,
    res
}) {

    if (!req) {

        throw new FinancialControllerError(
            "Request context is required.",
            "FINANCIAL_REQUEST_CONTEXT_REQUIRED",
            500
        );
    }

    if (!res) {

        throw new FinancialControllerError(
            "Response context is required.",
            "FINANCIAL_RESPONSE_CONTEXT_REQUIRED",
            500
        );
    }
}

function assertFinancialContext({
    tenantId,
    principalId
}) {

    if (!tenantId) {

        throw new FinancialControllerError(
            "Tenant context is required.",
            "TENANT_CONTEXT_REQUIRED",
            400
        );
    }

    if (!principalId) {

        throw new FinancialControllerError(
            "Authenticated principal is required.",
            "AUTHENTICATED_PRINCIPAL_REQUIRED",
            401
        );
    }
}

function assertIdempotencyContext(
    idempotency
) {

    if (!idempotency) {

        throw new FinancialControllerError(
            "Financial idempotency context is required.",
            "FINANCIAL_IDEMPOTENCY_REQUIRED",
            500
        );
    }

    if (
        idempotency.state !==
        "NEW"
    ) {

        throw new FinancialControllerError(
            "A new idempotency operation is required for financial execution.",
            "FINANCIAL_IDEMPOTENCY_INVALID_STATE",
            409
        );
    }

    if (!idempotency.recordId) {

        throw new FinancialControllerError(
            "Idempotency record identifier is missing.",
            "FINANCIAL_IDEMPOTENCY_RECORD_MISSING",
            500
        );
    }
}

// =============================================================================
// Request Body
// =============================================================================

function getRequestBody(req) {

    if (
        !req.body ||
        typeof req.body !== "object" ||
        Array.isArray(req.body)
    ) {

        return {};
    }

    return req.body;
}

// =============================================================================
// Financial Operation Context
// =============================================================================

function buildFinancialContext({
    req,
    operation,
    resource
}) {

    const tenantId =
        getTenantId(req);

    const principalId =
        getPrincipalId(req);

    const deviceId =
        getDeviceId(req);

    const transactionId =
        getTransactionId(req);

    const idempotency =
        req.idempotency;

    assertFinancialContext({
        tenantId,
        principalId
    });

    assertIdempotencyContext(
        idempotency
    );

    return {

        tenantId,

        principalId,

        deviceId,

        transactionId,

        operation,

        resource,

        idempotency

    };
}

// =============================================================================
// Core Controller Executor
// =============================================================================

/**
 * Execute one financial HTTP operation.
 *
 * This is intentionally the only place where the HTTP controller crosses into
 * the financial transaction boundary.
 *
 * The actual financial mutation is delegated to:
 *
 *     executeFinancialOperation()
 *
 * while atomic transaction management is delegated to:
 *
 *     processFinancialOperation()
 */
async function executeControllerOperation({

    req,

    operation,

    resource,

    successStatus =
        DEFAULT_SUCCESS_STATUS,

    operationType,

    validate = null

}) {

    const body =
        getRequestBody(req);

    const context =
        buildFinancialContext({

            req,

            operation,

            resource

        });

    if (
        typeof validate ===
        "function"
    ) {

        await validate({

            body,

            context,

            request:
                req

        });
    }

    const result =
        await processFinancialOperation({

            tenantId:
                context.tenantId,

            principalId:
                context.principalId,

            operation:
                context.operation,

            resource:
                context.resource,

            transactionId:
                context.transactionId,

            idempotency:
                context.idempotency,

            execute:
                async ({
                    session,
                    transactionId,
                    idempotencyRecord
                }) => {

                    /*
                     * The operation service receives the SAME MongoDB session
                     * that owns the complete financial transaction.
                     *
                     * Every financial repository invoked downstream MUST
                     * receive this session.
                     */
                    return executeFinancialOperation({

                        operationType,

                        tenantId:
                            context.tenantId,

                        principalId:
                            context.principalId,

                        deviceId:
                            context.deviceId,

                        transactionId,

                        idempotencyRecord,

                        body,

                        request:
                            req,

                        session

                    });
                }

        });

    return {

        statusCode:
            result.httpStatus ||
            successStatus,

        body:
            result.responseBody || {},

        transactionId:
            result.transactionId,

        idempotencyRecordId:
            result.idempotencyRecordId,

        resultType:
            result.resultType,

        attempts:
            result.attempts

    };
}

// =============================================================================
// Response
// =============================================================================

function sendFinancialResponse(
    res,
    result
) {

    if (
        result.transactionId
    ) {

        res.setHeader(
            "X-Transaction-Id",
            result.transactionId
        );
    }

    if (
        result.idempotencyRecordId
    ) {

        res.setHeader(
            "X-Idempotency-Record-Id",
            String(
                result.idempotencyRecordId
            )
        );
    }

    res.setHeader(
        "X-Financial-Operation",
        "committed"
    );

    return res
        .status(
            result.statusCode
        )
        .json(
            result.body
        );
}

// =============================================================================
// Generic Transaction
// =============================================================================

async function createTransaction(
    req,
    res,
    next
) {

    try {

        const result =
            await executeControllerOperation({

                req,

                operation:
                    "FINANCIAL_TRANSACTION",

                resource:
                    "financial-transactions",

                operationType:
                    "TRANSACTION_CREATE"

            });

        return sendFinancialResponse(
            res,
            result
        );

    } catch (error) {

        return next(
            normalizeFinancialError(
                error
            )
        );
    }
}

// =============================================================================
// Contribution
// =============================================================================

async function createContribution(
    req,
    res,
    next
) {

    try {

        const result =
            await executeControllerOperation({

                req,

                operation:
                    "CONTRIBUTION_CREATE",

                resource:
                    "contributions",

                operationType:
                    "CONTRIBUTION_CREATE"

            });

        return sendFinancialResponse(
            res,
            result
        );

    } catch (error) {

        return next(
            normalizeFinancialError(
                error
            )
        );
    }
}

// =============================================================================
// Deposit
// =============================================================================

async function createDeposit(
    req,
    res,
    next
) {

    try {

        const result =
            await executeControllerOperation({

                req,

                operation:
                    "DEPOSIT_CREATE",

                resource:
                    "deposits",

                operationType:
                    "DEPOSIT_CREATE"

            });

        return sendFinancialResponse(
            res,
            result
        );

    } catch (error) {

        return next(
            normalizeFinancialError(
                error
            )
        );
    }
}

// =============================================================================
// Withdrawal
// =============================================================================

async function createWithdrawal(
    req,
    res,
    next
) {

    try {

        const result =
            await executeControllerOperation({

                req,

                operation:
                    "WITHDRAWAL_CREATE",

                resource:
                    "withdrawals",

                operationType:
                    "WITHDRAWAL_CREATE"

            });

        return sendFinancialResponse(
            res,
            result
        );

    } catch (error) {

        return next(
            normalizeFinancialError(
                error
            )
        );
    }
}

// =============================================================================
// Transfer
// =============================================================================

async function createTransfer(
    req,
    res,
    next
) {

    try {

        const result =
            await executeControllerOperation({

                req,

                operation:
                    "TRANSFER_CREATE",

                resource:
                    "transfers",

                operationType:
                    "TRANSFER_CREATE"

            });

        return sendFinancialResponse(
            res,
            result
        );

    } catch (error) {

        return next(
            normalizeFinancialError(
                error
            )
        );
    }
}

// =============================================================================
// Loan Disbursement
// =============================================================================

async function disburseLoan(
    req,
    res,
    next
) {

    try {

        const loanId =
            requireResourceParameter(
                req,
                "loanId"
            );

        const result =
            await executeControllerOperation({

                req,

                operation:
                    "LOAN_DISBURSEMENT",

                resource:
                    `loan-disbursement:${loanId}`,

                operationType:
                    "LOAN_DISBURSEMENT",

                validate:
                    async ({
                        body
                    }) => {

                        if (!loanId) {

                            throw new FinancialControllerError(
                                "Loan identifier is required.",
                                "LOAN_ID_REQUIRED",
                                400
                            );
                        }

                        void body;
                    }

            });

        return sendFinancialResponse(
            res,
            result
        );

    } catch (error) {

        return next(
            normalizeFinancialError(
                error
            )
        );
    }
}

// =============================================================================
// Loan Repayment
// =============================================================================

async function repayLoan(
    req,
    res,
    next
) {

    try {

        const loanId =
            requireResourceParameter(
                req,
                "loanId"
            );

        const result =
            await executeControllerOperation({

                req,

                operation:
                    "LOAN_REPAYMENT",

                resource:
                    `loan-repayment:${loanId}`,

                operationType:
                    "LOAN_REPAYMENT",

                validate:
                    async ({
                        body
                    }) => {

                        if (!loanId) {

                            throw new FinancialControllerError(
                                "Loan identifier is required.",
                                "LOAN_ID_REQUIRED",
                                400
                            );
                        }

                        void body;
                    }

            });

        return sendFinancialResponse(
            res,
            result
        );

    } catch (error) {

        return next(
            normalizeFinancialError(
                error
            )
        );
    }
}

// =============================================================================
// Resource Parameter
// =============================================================================

function requireResourceParameter(
    req,
    parameter
) {

    const value =
        normalizeIdentifier(
            req.params?.[parameter]
        );

    if (!value) {

        throw new FinancialControllerError(
            `${parameter} is required.`,
            `${parameter.toUpperCase()}_REQUIRED`,
            400
        );
    }

    return value;
}

// =============================================================================
// Read Operations
// =============================================================================
//
// Read operations intentionally do not enter the financial transaction
// boundary.
//
// They still require authentication and tenant authorization at the router.
// =============================================================================

async function getWallet(
    req,
    res,
    next
) {

    try {

        const tenantId =
            getTenantId(req);

        const principalId =
            getPrincipalId(req);

        const walletId =
            requireResourceParameter(
                req,
                "walletId"
            );

        assertFinancialContext({

            tenantId,

            principalId

        });

        /*
         * Read implementation is intentionally delegated to the read-side
         * financial operation service.
         *
         * No idempotency record is created.
         * No MongoDB financial transaction is opened.
         */

        const result =
            await executeFinancialOperation({

                operationType:
                    "WALLET_READ",

                tenantId,

                principalId,

                walletId,

                request:
                    req

            });

        return res
            .status(200)
            .json(
                result?.responseBody || {}
            );

    } catch (error) {

        return next(
            normalizeFinancialError(
                error
            )
        );
    }
}

// =============================================================================
// Transaction Read
// =============================================================================

async function getTransaction(
    req,
    res,
    next
) {

    try {

        const tenantId =
            getTenantId(req);

        const principalId =
            getPrincipalId(req);

        const transactionId =
            requireResourceParameter(
                req,
                "transactionId"
            );

        assertFinancialContext({

            tenantId,

            principalId

        });

        const result =
            await executeFinancialOperation({

                operationType:
                    "TRANSACTION_READ",

                tenantId,

                principalId,

                transactionId,

                request:
                    req

            });

        return res
            .status(200)
            .json(
                result?.responseBody || {}
            );

    } catch (error) {

        return next(
            normalizeFinancialError(
                error
            )
        );
    }
}

// =============================================================================
// Ledger Read
// =============================================================================

async function getTransactionLedger(
    req,
    res,
    next
) {

    try {

        const tenantId =
            getTenantId(req);

        const principalId =
            getPrincipalId(req);

        const transactionId =
            requireResourceParameter(
                req,
                "transactionId"
            );

        assertFinancialContext({

            tenantId,

            principalId

        });

        const result =
            await executeFinancialOperation({

                operationType:
                    "TRANSACTION_LEDGER_READ",

                tenantId,

                principalId,

                transactionId,

                request:
                    req

            });

        return res
            .status(200)
            .json(
                result?.responseBody || {}
            );

    } catch (error) {

        return next(
            normalizeFinancialError(
                error
            )
        );
    }
}

// =============================================================================
// Error Normalization
// =============================================================================

function normalizeFinancialError(
    error
) {

    if (
        error instanceof
        FinancialControllerError
    ) {

        return error;
    }

    if (
        error instanceof
        FinancialTransactionError
    ) {

        return error;
    }

    if (
        error &&
        typeof error.statusCode ===
            "number"
    ) {

        return error;
    }

    const normalized =
        new FinancialControllerError(

            error?.message ||
            "Financial operation failed.",

            error?.code ||
            "FINANCIAL_OPERATION_FAILED",

            500,

            error?.details ||
            null

        );

    /*
     * Preserve the original error for centralized logging.
     */
    normalized.cause =
        error;

    return normalized;
}

// =============================================================================
// Exports
// =============================================================================

module.exports = {

    FinancialControllerError,

    createTransaction,

    createContribution,

    createDeposit,

    createWithdrawal,

    createTransfer,

    disburseLoan,

    repayLoan,

    getWallet,

    getTransaction,

    getTransactionLedger

};