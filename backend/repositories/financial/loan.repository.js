"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Loan Financial Repository
 * ============================================================================
 *
 * File:
 *   backend/repositories/financial/loan.repository.js
 *
 * Purpose:
 *   Session-aware persistence boundary for loan financial mutations.
 *
 * ============================================================================
 * ARCHITECTURAL POSITION
 * ============================================================================
 *
 *   Financial Transaction Service
 *               │
 *               ▼
 *        Loan Repository
 *               │
 *               ▼
 *            Loan Model
 *               │
 *               ▼
 *            MongoDB
 *
 * ============================================================================
 * REPOSITORY RESPONSIBILITIES
 * ============================================================================
 *
 * ✓ Tenant-safe loan reads.
 * ✓ Session-required financial writes.
 * ✓ Active MongoDB transaction enforcement where supported.
 * ✓ Atomic loan disbursement.
 * ✓ Atomic loan repayment.
 * ✓ Atomic loan lifecycle transitions.
 * ✓ Decimal128-safe monetary persistence.
 * ✓ Exact outstanding-balance conditions.
 * ✓ Exact principal/disbursement limits.
 * ✓ Financial transaction identity persistence.
 * ✓ Duplicate/validation error normalization.
 *
 * ============================================================================
 * REPOSITORY NON-RESPONSIBILITIES
 * ============================================================================
 *
 * ✗ Authorization.
 * ✗ Credit approval decisions.
 * ✗ Loan eligibility calculation.
 * ✗ Interest calculation.
 * ✗ Penalty calculation.
 * ✗ Idempotency.
 * ✗ Transaction orchestration.
 * ✗ MongoDB transaction lifecycle.
 * ✗ Ledger creation.
 * ✗ Account balance mutation.
 *
 * ============================================================================
 * TRANSACTION OWNERSHIP
 * ============================================================================
 *
 * The financial transaction coordinator owns:
 *
 *   session.startTransaction()
 *   ...
 *   commitTransaction()
 *   abortTransaction()
 *
 * This repository only participates using the supplied session.
 *
 * ============================================================================
 * FINANCIAL INVARIANTS
 * ============================================================================
 *
 * Disbursement:
 *
 *   existingDisbursedAmount + requestedAmount
 *       <= principalAmount
 *
 * Repayment:
 *
 *   requestedRepayment
 *       <= outstandingAmount
 *
 * Outstanding balance:
 *
 *   outstandingAmount >= 0
 *
 * Lifecycle:
 *
 *   APPROVED -> DISBURSED
 *   DISBURSED -> ACTIVE
 *   ACTIVE/DISBURSED/PARTIALLY_REPAID -> PARTIALLY_REPAID
 *   ACTIVE/DISBURSED/PARTIALLY_REPAID -> REPAID
 *
 * ============================================================================
 * MONEY
 * ============================================================================
 *
 * JavaScript Number arithmetic is deliberately avoided.
 *
 * Monetary values must preferably be:
 *
 *   MongoDB Decimal128
 *   OR exact decimal strings
 *
 * ============================================================================
 * TITech terminology
 * ============================================================================
 *
 * All legacy ACFOS references have been replaced with TITech terminology.
 *
 * ============================================================================
 */

import mongoose from 'mongoose';

import Loan from '../../models/Loan.js';

import { FinancialTransactionError } from '../../services/financial/financialTransaction.service.js';

import tenantConstants from '../../tenancy/tenant.constants.js';

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const LOAN_ID_MAX_LENGTH =
    128;

const TENANT_ID_MAX_LENGTH =
    64;

const TRANSACTION_ID_MAX_LENGTH =
    128;

const CURRENCY_MAX_LENGTH =
    16;

const DISBURSEMENT_STATUS =
    "APPROVED";

const DISBURSED_STATUS =
    "DISBURSED";

const ACTIVE_STATUS =
    "ACTIVE";

const PARTIALLY_REPAID_STATUS =
    "PARTIALLY_REPAID";

const REPAID_STATUS =
    "REPAID";

/**
 * Common statuses that may exist before financial activation.
 *
 * Kept internal so the repository can safely query/validate state without
 * imposing authorization decisions.
 */
const REPAYABLE_STATUSES =
    Object.freeze([
        DISBURSED_STATUS,
        ACTIVE_STATUS,
        PARTIALLY_REPAID_STATUS
    ]);

/**
 * ============================================================================
 * Error Factory
 * ============================================================================
 */

function createLoanError(
    message,
    code,
    statusCode = 500,
    details = undefined
) {
    const error =
        new FinancialTransactionError(
            message,
            code,
            statusCode
        );

    if (
        details !==
            undefined
    ) {
        error.details =
            details;
    }

    return error;
}

/**
 * ============================================================================
 * Session Validation
 * ============================================================================
 */

function requireSession(
    session
) {
    if (
        !session ||
        typeof session !==
            "object"
    ) {
        throw createLoanError(
            "MongoDB transaction session is required for loan financial mutations.",
            "FINANCIAL_SESSION_REQUIRED",
            500
        );
    }

    return session;
}

/**
 * Require active transaction where the MongoDB session exposes the capability.
 *
 * The repository does not start the transaction.
 */
function requireActiveTransaction(
    session
) {
    requireSession(
        session
    );

    if (
        typeof session.inTransaction ===
        "function"
    ) {
        if (
            !session.inTransaction()
        ) {
            throw createLoanError(
                "An active MongoDB transaction is required for loan financial mutation.",
                "FINANCIAL_TRANSACTION_NOT_ACTIVE",
                500
            );
        }
    }

    return session;
}

/**
 * ============================================================================
 * Identifier Validation
 * ============================================================================
 */

function requireIdentifier(
    value,
    field,
    maxLength
) {
    if (
        value ===
            undefined ||
        value ===
            null
    ) {
        throw createLoanError(
            `${field} is required.`,
            "LOAN_FIELD_REQUIRED",
            400,
            {
                field
            }
        );
    }

    const normalized =
        String(
            value
        ).trim();

    if (
        normalized.length ===
        0
    ) {
        throw createLoanError(
            `${field} is required.`,
            "LOAN_FIELD_REQUIRED",
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
        throw createLoanError(
            `${field} exceeds the maximum permitted length.`,
            "LOAN_FIELD_TOO_LONG",
            400,
            {
                field,
                maxLength
            }
        );
    }

    if (
        !/^[a-zA-Z0-9._:-]+$/.test(
            normalized
        )
    ) {
        throw createLoanError(
            `${field} contains invalid characters.`,
            "LOAN_INVALID_IDENTIFIER",
            400,
            {
                field
            }
        );
    }

    return normalized;
}

/**
 * ============================================================================
 * Loan ID
 * ============================================================================
 */

function requireLoanId(
    loanAccountId
) {
    return requireIdentifier(
        loanAccountId,
        "loanAccountId",
        LOAN_ID_MAX_LENGTH
    );
}

/**
 * ============================================================================
 * Tenant ID
 * ============================================================================
 */

function requireTenantId(
    tenantId
) {
    const normalized =
        requireIdentifier(
            tenantId,
            "tenantId",
            TENANT_ID_MAX_LENGTH
        )
            .toLowerCase();

    if (
        typeof tenantConstants
            .isValidTenantId ===
        "function"
    ) {
        if (
            !tenantConstants.isValidTenantId(
                normalized
            )
        ) {
            throw createLoanError(
                "Invalid TITech tenant identifier.",
                "LOAN_INVALID_TENANT",
                400,
                {
                    tenantId:
                        normalized
                }
            );
        }
    }

    return normalized;
}

/**
 * ============================================================================
 * Transaction ID
 * ============================================================================
 */

function requireTransactionId(
    transactionId
) {
    return requireIdentifier(
        transactionId,
        "transactionId",
        TRANSACTION_ID_MAX_LENGTH
    );
}

/**
 * ============================================================================
 * Currency
 * ============================================================================
 */

function requireCurrency(
    currency
) {
    const normalized =
        requireIdentifier(
            currency,
            "currency",
            CURRENCY_MAX_LENGTH
        )
            .toUpperCase();

    if (
        !/^[A-Z]{3,16}$/.test(
            normalized
        )
    ) {
        throw createLoanError(
            "Invalid loan currency.",
            "LOAN_INVALID_CURRENCY",
            400,
            {
                currency:
                    normalized
            }
        );
    }

    return normalized;
}

/**
 * ============================================================================
 * Decimal128
 * ============================================================================
 */

function isDecimal128(
    value
) {
    return mongoose.isDecimal128(
        value
    );
}

/**
 * ============================================================================
 * Monetary Amount Normalization
 * ============================================================================
 *
 * Returns Decimal128 regardless of whether the caller supplies a Decimal128 or
 * exact decimal string.
 *
 * No Number(), parseFloat(), or parseInt().
 * ============================================================================
 */

function normalizeAmount(
    amount
) {
    if (
        amount ===
            undefined ||
        amount ===
            null
    ) {
        throw createLoanError(
            "Loan amount is required.",
            "LOAN_AMOUNT_REQUIRED",
            400
        );
    }

    const value =
        isDecimal128(
            amount
        )
            ? amount.toString()
            : String(
                amount
            ).trim();

    if (
        !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(
            value
        )
    ) {
        throw createLoanError(
            "Loan amount must be a positive canonical decimal value.",
            "LOAN_INVALID_AMOUNT",
            400
        );
    }

    if (
        /^0+(?:\.0+)?$/.test(
            value
        )
    ) {
        throw createLoanError(
            "Loan amount must be greater than zero.",
            "LOAN_ZERO_AMOUNT",
            400
        );
    }

    try {
        return mongoose.Types.Decimal128.fromString(
            value
        );
    } catch {
        throw createLoanError(
            "Loan amount is not a valid Decimal128 monetary value.",
            "LOAN_INVALID_AMOUNT",
            400
        );
    }
}

/**
 * ============================================================================
 * Decimal Zero
 * ============================================================================
 */

function decimalZero() {
    return mongoose.Types.Decimal128.fromString(
        "0"
    );
}

/**
 * ============================================================================
 * Decimal Negation
 * ============================================================================
 */

function decimalNegative(
    decimal
) {
    if (
        !isDecimal128(
            decimal
        )
    ) {
        throw createLoanError(
            "Amount must be Decimal128.",
            "LOAN_INVALID_DECIMAL",
            500
        );
    }

    const value =
        decimal.toString();

    if (
        value.startsWith(
            "-"
        )
    ) {
        return decimal;
    }

    return mongoose.Types.Decimal128.fromString(
        `-${value}`
    );
}

/**
 * ============================================================================
 * Decimal Equality Helper
 * ============================================================================
 */

function isZeroDecimal(
    value
) {
    if (
        value ===
            undefined ||
        value ===
            null
    ) {
        return false;
    }

    return /^0(?:\.0+)?$/.test(
        value.toString()
    );
}

/**
 * ============================================================================
 * Common Loan Filter
 * ============================================================================
 */

function buildLoanFilter({
    loanAccountId,
    tenantId,
    currency
}) {
    return {
        _id:
            requireLoanId(
                loanAccountId
            ),

        tenantId:
            requireTenantId(
                tenantId
            ),

        currency:
            requireCurrency(
                currency
            )
    };
}

/**
 * ============================================================================
 * Find Loan
 * ============================================================================
 *
 * Session is accepted for consistent reads inside the caller's transaction.
 * ============================================================================
 */

async function findById({
    session,
    loanAccountId,
    tenantId,
    currency
}) {
    const filter =
        buildLoanFilter({
            loanAccountId,
            tenantId,
            currency
        });

    const query =
        Loan.findOne(
            filter
        );

    if (
        session
    ) {
        query.session(
            session
        );
    }

    return query
        .lean()
        .exec();
}

/**
 * ============================================================================
 * Require Existing Loan
 * ============================================================================
 */

async function requireById({
    session,
    loanAccountId,
    tenantId,
    currency
}) {
    const normalizedLoanId =
        requireLoanId(
            loanAccountId
        );

    const normalizedTenantId =
        requireTenantId(
            tenantId
        );

    const normalizedCurrency =
        requireCurrency(
            currency
        );

    const record =
        await findById({
            session,
            loanAccountId:
                normalizedLoanId,
            tenantId:
                normalizedTenantId,
            currency:
                normalizedCurrency
        });

    if (
        !record
    ) {
        throw createLoanError(
            "Loan account was not found.",
            "LOAN_NOT_FOUND",
            404,
            {
                loanAccountId:
                    normalizedLoanId,

                tenantId:
                    normalizedTenantId,

                currency:
                    normalizedCurrency
            }
        );
    }

    return record;
}

/**
 * ============================================================================
 * Atomic Loan Disbursement
 * ============================================================================
 *
 * State transition:
 *
 *   APPROVED
 *      │
 *      ▼
 *   DISBURSED
 *
 * Invariant:
 *
 *   disbursedAmount + requestedAmount
 *       <= principalAmount
 *
 * MongoDB performs the condition and mutation as one update.
 * ============================================================================
 */

async function disburse({
    session,
    loanAccountId,
    tenantId,
    amount,
    currency,
    transactionId,
    metadata = {}
}) {
    requireActiveTransaction(
        session
    );

    const normalizedLoanId =
        requireLoanId(
            loanAccountId
        );

    const normalizedTenantId =
        requireTenantId(
            tenantId
        );

    const normalizedCurrency =
        requireCurrency(
            currency
        );

    const normalizedTransactionId =
        requireTransactionId(
            transactionId
        );

    const normalizedAmount =
        normalizeAmount(
            amount
        );

    void metadata;

    const now =
        new Date();

    /**
     * MongoDB expression:
     *
     *   disbursedAmount + requestedAmount <= principalAmount
     *
     * No JavaScript monetary arithmetic occurs.
     */
    const result =
        await Loan.findOneAndUpdate(
            {
                _id:
                    normalizedLoanId,

                tenantId:
                    normalizedTenantId,

                currency:
                    normalizedCurrency,

                status:
                    DISBURSEMENT_STATUS,

                $expr:
                    {
                        $lte:
                            [
                                {
                                    $add:
                                        [
                                            "$disbursedAmount",
                                            normalizedAmount
                                        ]
                                },

                                "$principalAmount"
                            ]
                    }
            },
            {
                $inc:
                    {
                        disbursedAmount:
                            normalizedAmount,

                        outstandingAmount:
                            normalizedAmount
                    },

                $set:
                    {
                        status:
                            DISBURSED_STATUS,

                        disbursedAt:
                            now,

                        lastTransactionId:
                            normalizedTransactionId,

                        lastFinancialMutationAt:
                            now
                    }
            },
            {
                new:
                    true,

                session,

                runValidators:
                    true,

                context:
                    "query"
            }
        )
            .lean()
            .exec();

    if (
        !result
    ) {
        throw createLoanError(
            "Loan is unavailable for disbursement or the requested amount exceeds the approved principal.",
            "LOAN_DISBURSEMENT_NOT_ALLOWED",
            409,
            {
                loanAccountId:
                    normalizedLoanId,

                tenantId:
                    normalizedTenantId,

                transactionId:
                    normalizedTransactionId
            }
        );
    }

    return result;
}

/**
 * ============================================================================
 * Atomic Loan Repayment
 * ============================================================================
 *
 * Invariant:
 *
 *   repaymentAmount <= outstandingAmount
 *
 * Mutation:
 *
 *   outstandingAmount -= repaymentAmount
 *   repaidAmount      += repaymentAmount
 *
 * Lifecycle:
 *
 *   outstandingAmount = 0
 *        -> REPAID
 *
 *   outstandingAmount > 0
 *        -> PARTIALLY_REPAID
 *
 * All arithmetic and post-mutation status determination occurs inside MongoDB.
 * ============================================================================
 */

async function repay({
    session,
    loanAccountId,
    tenantId,
    amount,
    currency,
    transactionId,
    metadata = {}
}) {
    requireActiveTransaction(
        session
    );

    const normalizedLoanId =
        requireLoanId(
            loanAccountId
        );

    const normalizedTenantId =
        requireTenantId(
            tenantId
        );

    const normalizedCurrency =
        requireCurrency(
            currency
        );

    const normalizedTransactionId =
        requireTransactionId(
            transactionId
        );

    const normalizedAmount =
        normalizeAmount(
            amount
        );

    void metadata;

    const now =
        new Date();

    /**
     * IMPORTANT:
     *
     * The outstanding balance condition is evaluated atomically with the
     * mutation. There is no read/check/write race.
     */
    const result =
        await Loan.findOneAndUpdate(
            {
                _id:
                    normalizedLoanId,

                tenantId:
                    normalizedTenantId,

                currency:
                    normalizedCurrency,

                status:
                    {
                        $in:
                            REPAYABLE_STATUSES
                    },

                outstandingAmount:
                    {
                        $gte:
                            normalizedAmount
                    }
            },
            [
                /**
                 * Stage 1:
                 * Apply exact Decimal128 arithmetic.
                 */
                {
                    $set:
                        {
                            outstandingAmount:
                                {
                                    $subtract:
                                        [
                                            "$outstandingAmount",
                                            normalizedAmount
                                        ]
                                },

                            repaidAmount:
                                {
                                    $add:
                                        [
                                            "$repaidAmount",
                                            normalizedAmount
                                        ]
                                },

                            lastTransactionId:
                                normalizedTransactionId,

                            lastRepaymentAt:
                                now,

                            lastFinancialMutationAt:
                                now
                        }
                },

                /**
                 * Stage 2:
                 * Derive lifecycle from the post-mutation outstanding amount.
                 */
                {
                    $set:
                        {
                            status:
                                {
                                    $cond:
                                        [
                                            {
                                                $eq:
                                                    [
                                                        "$outstandingAmount",
                                                        decimalZero()
                                                    ]
                                            },

                                            REPAID_STATUS,

                                            PARTIALLY_REPAID_STATUS
                                        ]
                                },

                            repaidAt:
                                {
                                    $cond:
                                        [
                                            {
                                                $eq:
                                                    [
                                                        "$outstandingAmount",
                                                        decimalZero()
                                                    ]
                                            },

                                            now,

                                            "$repaidAt"
                                        ]
                                }
                        }
                }
            ],
            {
                new:
                    true,

                session,

                runValidators:
                    true
            }
        )
            .lean()
            .exec();

    if (
        !result
    ) {
        throw createLoanError(
            "Loan repayment exceeds the outstanding balance or the loan is unavailable for repayment.",
            "LOAN_REPAYMENT_NOT_ALLOWED",
            409,
            {
                loanAccountId:
                    normalizedLoanId,

                tenantId:
                    normalizedTenantId,

                transactionId:
                    normalizedTransactionId
            }
        );
    }

    return result;
}

/**
 * ============================================================================
 * Activate Loan
 * ============================================================================
 *
 * State transition:
 *
 *   DISBURSED -> ACTIVE
 *
 * No monetary mutation is performed here.
 * ============================================================================
 */

async function markActive({
    session,
    loanAccountId,
    tenantId,
    currency,
    transactionId
}) {
    requireActiveTransaction(
        session
    );

    const normalizedLoanId =
        requireLoanId(
            loanAccountId
        );

    const normalizedTenantId =
        requireTenantId(
            tenantId
        );

    const normalizedCurrency =
        requireCurrency(
            currency
        );

    const normalizedTransactionId =
        requireTransactionId(
            transactionId
        );

    const now =
        new Date();

    const result =
        await Loan.findOneAndUpdate(
            {
                _id:
                    normalizedLoanId,

                tenantId:
                    normalizedTenantId,

                currency:
                    normalizedCurrency,

                status:
                    DISBURSED_STATUS
            },
            {
                $set:
                    {
                        status:
                            ACTIVE_STATUS,

                        lastTransactionId:
                            normalizedTransactionId,

                        lastFinancialMutationAt:
                            now
                    }
            },
            {
                new:
                    true,

                session,

                runValidators:
                    true,

                context:
                    "query"
            }
        )
            .lean()
            .exec();

    if (
        !result
    ) {
        throw createLoanError(
            "Loan cannot be activated from its current lifecycle state.",
            "LOAN_ACTIVATION_NOT_ALLOWED",
            409,
            {
                loanAccountId:
                    normalizedLoanId,

                tenantId:
                    normalizedTenantId
            }
        );
    }

    return result;
}

/**
 * ============================================================================
 * Reverse Disbursement
 * ============================================================================
 *
 * Intended for controlled internal reversal workflows.
 *
 * This method is deliberately explicit rather than exposing generic update
 * semantics.
 *
 * Invariant:
 *
 *   original disbursed amount must be sufficient for reversal.
 *
 * The financial transaction service should only invoke this inside a complete
 * reversal transaction with corresponding balance and ledger entries.
 * ============================================================================
 */

async function reverseDisbursement({
    session,
    loanAccountId,
    tenantId,
    amount,
    currency,
    transactionId,
    metadata = {}
}) {
    requireActiveTransaction(
        session
    );

    const normalizedLoanId =
        requireLoanId(
            loanAccountId
        );

    const normalizedTenantId =
        requireTenantId(
            tenantId
        );

    const normalizedCurrency =
        requireCurrency(
            currency
        );

    const normalizedTransactionId =
        requireTransactionId(
            transactionId
        );

    const normalizedAmount =
        normalizeAmount(
            amount
        );

    void metadata;

    const negativeAmount =
        decimalNegative(
            normalizedAmount
        );

    const now =
        new Date();

    /**
     * The reversal is constrained by the persisted disbursed amount.
     */
    const result =
        await Loan.findOneAndUpdate(
            {
                _id:
                    normalizedLoanId,

                tenantId:
                    normalizedTenantId,

                currency:
                    normalizedCurrency,

                status:
                    {
                        $in:
                            [
                                DISBURSED_STATUS,
                                ACTIVE_STATUS,
                                PARTIALLY_REPAID_STATUS
                            ]
                    },

                disbursedAmount:
                    {
                        $gte:
                            normalizedAmount
                    }
            },
            {
                $inc:
                    {
                        disbursedAmount:
                            negativeAmount,

                        outstandingAmount:
                            negativeAmount
                    },

                $set:
                    {
                        lastTransactionId:
                            normalizedTransactionId,

                        lastFinancialMutationAt:
                            now
                    }
            },
            {
                new:
                    true,

                session,

                runValidators:
                    true,

                context:
                    "query"
            }
        )
            .lean()
            .exec();

    if (
        !result
    ) {
        throw createLoanError(
            "Loan disbursement reversal is not allowed.",
            "LOAN_DISBURSEMENT_REVERSAL_NOT_ALLOWED",
            409,
            {
                loanAccountId:
                    normalizedLoanId
            }
        );
    }

    return result;
}

/**
 * ============================================================================
 * Mark Closed / Repaid
 * ============================================================================
 *
 * Explicit lifecycle helper. Only a loan whose outstanding amount is zero can
 * be finalized as REPAID.
 * ============================================================================
 */

async function finalizeRepaid({
    session,
    loanAccountId,
    tenantId,
    currency,
    transactionId
}) {
    requireActiveTransaction(
        session
    );

    const normalizedLoanId =
        requireLoanId(
            loanAccountId
        );

    const normalizedTenantId =
        requireTenantId(
            tenantId
        );

    const normalizedCurrency =
        requireCurrency(
            currency
        );

    const normalizedTransactionId =
        requireTransactionId(
            transactionId
        );

    const now =
        new Date();

    const result =
        await Loan.findOneAndUpdate(
            {
                _id:
                    normalizedLoanId,

                tenantId:
                    normalizedTenantId,

                currency:
                    normalizedCurrency,

                status:
                    PARTIALLY_REPAID_STATUS,

                outstandingAmount:
                    decimalZero()
            },
            {
                $set:
                    {
                        status:
                            REPAID_STATUS,

                        repaidAt:
                            now,

                        lastTransactionId:
                            normalizedTransactionId,

                        lastFinancialMutationAt:
                            now
                    }
            },
            {
                new:
                    true,

                session,

                runValidators:
                    true,

                context:
                    "query"
            }
        )
            .lean()
            .exec();

    if (
        !result
    ) {
        throw createLoanError(
            "Loan cannot be finalized as repaid.",
            "LOAN_FINALIZATION_NOT_ALLOWED",
            409,
            {
                loanAccountId:
                    normalizedLoanId
            }
        );
    }

    return result;
}

/**
 * ============================================================================
 * Loan Balance Integrity Check
 * ============================================================================
 *
 * Read-only helper:
 *
 *   outstandingAmount
 *     must be >= 0
 *
 *   repaidAmount
 *     must be >= 0
 *
 *   disbursedAmount
 *     must be >= 0
 *
 *   disbursedAmount
 *     <= principalAmount
 *
 * This method does not mutate the loan.
 * ============================================================================
 */

async function verifyIntegrity({
    session,
    loanAccountId,
    tenantId,
    currency
}) {
    const loan =
        await requireById({
            session,
            loanAccountId,
            tenantId,
            currency
        });

    const checks =
        {
            found:
                true,

            disbursedWithinPrincipal:
                false,

            outstandingNonNegative:
                false,

            repaidNonNegative:
                false
        };

    try {
        const principal =
            decimalToScaledBigInt(
                loan.principalAmount
            );

        const disbursed =
            decimalToScaledBigInt(
                loan.disbursedAmount
            );

        const outstanding =
            decimalToScaledBigInt(
                loan.outstandingAmount
            );

        const repaid =
            decimalToScaledBigInt(
                loan.repaidAmount
            );

        checks.disbursedWithinPrincipal =
            disbursed <=
            principal;

        checks.outstandingNonNegative =
            outstanding >=
            0n;

        checks.repaidNonNegative =
            repaid >=
            0n;
    } catch {
        checks.found =
            false;
    }

    const valid =
        checks.found &&
        checks.disbursedWithinPrincipal &&
        checks.outstandingNonNegative &&
        checks.repaidNonNegative;

    return {
        valid,

        loanAccountId:
            loan._id,

        tenantId:
            loan.tenantId,

        currency:
            loan.currency,

        status:
            loan.status,

        checks
    };
}

/**
 * ============================================================================
 * Utility: Decimal128 -> scaled BigInt
 * ============================================================================
 *
 * Used ONLY for integrity comparison.
 * It does not participate in financial mutations.
 * ============================================================================
 */

function decimalToScaledBigInt(
    value
) {
    if (
        value ===
            undefined ||
        value ===
            null
    ) {
        return 0n;
    }

    const text =
        isDecimal128(
            value
        )
            ? value.toString()
            : String(
                value
            ).trim();

    if (
        !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(
            text
        )
    ) {
        throw new Error(
            "Invalid decimal value."
        );
    }

    const [
        integerPart,
        fractionalPart =
            ""
    ] =
        text.split(
            "."
        );

    const scale =
        Math.max(
            fractionalPart.length,
            18
        );

    const paddedFraction =
        fractionalPart
            .padEnd(
                scale,
                "0"
            );

    return BigInt(
        `${integerPart}${paddedFraction}`
    );
}

/**
 * ============================================================================
 * Export
 * ============================================================================
 */

const repositoryModule =
    Object.freeze({
        DISBURSEMENT_STATUS,

        DISBURSED_STATUS,

        ACTIVE_STATUS,

        PARTIALLY_REPAID_STATUS,

        REPAID_STATUS,

        REPAYABLE_STATUSES,

        requireSession,

        requireActiveTransaction,

        requireLoanId,

        requireTenantId,

        requireTransactionId,

        requireCurrency,

        normalizeAmount,

        findById,

        requireById,

        disburse,

        repay,

        markActive,

        reverseDisbursement,

        finalizeRepaid,

        verifyIntegrity
    });
export default repositoryModule;
