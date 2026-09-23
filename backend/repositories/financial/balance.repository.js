"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Atomic Balance Repository
 * ============================================================================
 *
 * File:
 *   backend/repositories/financial/balance.repository.js
 *
 * Purpose:
 *   Atomic account balance persistence boundary.
 *
 * ============================================================================
 * ARCHITECTURAL POSITION
 * ============================================================================
 *
 *   Financial Transaction Service
 *                │
 *                ▼
 *       Balance Repository
 *                │
 *                ▼
 *        MongoDB Account Model
 *
 * ============================================================================
 * CRITICAL FINANCIAL INVARIANT
 * ============================================================================
 *
 * Balance decrements MUST be executed as ONE conditional MongoDB update.
 *
 * NEVER:
 *
 *   1. read balance
 *   2. compare balance in JavaScript
 *   3. update balance
 *
 * REQUIRED:
 *
 *   balance >= amount
 *           │
 *           ▼
 *     atomic $inc
 *
 * inside the SAME MongoDB transaction session.
 *
 * ============================================================================
 * REPOSITORY RULES
 * ============================================================================
 *
 * ✓ Every financial mutation requires a MongoDB session.
 * ✓ Every financial mutation requires an active MongoDB transaction when the
 *   driver exposes `session.inTransaction()`.
 * ✓ Repository never starts a transaction.
 * ✓ Repository never commits a transaction.
 * ✓ Repository never aborts a transaction.
 * ✓ Tenant isolation is mandatory.
 * ✓ Currency isolation is mandatory.
 * ✓ Only ACTIVE accounts may mutate.
 * ✓ Debit/decrement is conditionally atomic.
 * ✓ Negative balances are never intentionally created.
 * ✓ Transaction identity is persisted with every mutation.
 * ✓ Mutation timestamp is persisted.
 * ✓ Financial amounts are never converted through unsafe Number arithmetic.
 * ✓ No generic update/delete methods are exposed.
 * ✓ Idempotency is NOT implemented here; coordinator/service owns it.
 *
 * ============================================================================
 * FINANCIAL SERVICE RESPONSIBILITIES
 * ============================================================================
 *
 * The financial transaction service remains responsible for:
 *
 *   - authorization
 *   - eligibility/business rules
 *   - idempotency
 *   - transaction orchestration
 *   - ledger balancing
 *   - transaction state
 *   - transaction lifecycle
 *
 * This repository is responsible for safe persistence.
 *
 * ============================================================================
 * TENANCY
 * ============================================================================
 *
 * Tenant identity is validated against:
 *
 *   backend/tenancy/tenant.constants.js
 *
 * The repository does NOT silently sanitize arbitrary tenant identifiers.
 *
 * ============================================================================
 * TITech terminology
 * ============================================================================
 *
 * All legacy ACFOS terminology has been replaced with TITech terminology.
 *
 * ============================================================================
 */

import mongoose from 'mongoose';

import Account from '../../models/Account.js';

import { FinancialTransactionError } from '../../services/financial/financialTransaction.service.js';

import tenantConstants from '../../tenancy/tenant.constants.js';

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const ACCOUNT_ID_MAX_LENGTH =
    128;

const TENANT_ID_MAX_LENGTH =
    64;

const TRANSACTION_ID_MAX_LENGTH =
    128;

const CURRENCY_MAX_LENGTH =
    16;

const ACTIVE_ACCOUNT_STATUS =
    "ACTIVE";

/**
 * Standard identifier syntax used by TITech financial persistence.
 */
const IDENTIFIER_REGEX =
    /^[a-zA-Z0-9._:-]+$/;

/**
 * ============================================================================
 * Error Factory
 * ============================================================================
 */

function createBalanceError(
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
        throw createBalanceError(
            "MongoDB transaction session is required for financial balance mutations.",
            "FINANCIAL_SESSION_REQUIRED",
            500
        );
    }

    return session;
}

/**
 * Require active transaction when the MongoDB driver exposes the capability.
 *
 * The repository deliberately does not create the transaction if it is absent.
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
            throw createBalanceError(
                "An active MongoDB transaction is required for financial balance mutation.",
                "FINANCIAL_TRANSACTION_NOT_ACTIVE",
                500
            );
        }
    }

    return session;
}

/**
 * ============================================================================
 * Generic Identifier Validation
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
        throw createBalanceError(
            `${field} is required.`,
            "BALANCE_FIELD_REQUIRED",
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
        throw createBalanceError(
            `${field} is required.`,
            "BALANCE_FIELD_REQUIRED",
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
        throw createBalanceError(
            `${field} exceeds the maximum permitted length.`,
            "BALANCE_FIELD_TOO_LONG",
            400,
            {
                field,
                maxLength
            }
        );
    }

    if (
        !IDENTIFIER_REGEX.test(
            normalized
        )
    ) {
        throw createBalanceError(
            `${field} contains invalid characters.`,
            "BALANCE_INVALID_IDENTIFIER",
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
 * Account ID
 * ============================================================================
 */

function requireAccountId(
    accountId
) {
    return requireIdentifier(
        accountId,
        "accountId",
        ACCOUNT_ID_MAX_LENGTH
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
        ).toLowerCase();

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
            throw createBalanceError(
                "Invalid tenant identifier.",
                "BALANCE_INVALID_TENANT",
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
        ).toUpperCase();

    if (
        !/^[A-Z]{3,16}$/.test(
            normalized
        )
    ) {
        throw createBalanceError(
            "Invalid account currency.",
            "BALANCE_INVALID_CURRENCY",
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
 * Exact Decimal Amount Validation
 * ============================================================================
 *
 * The repository supports:
 *
 *   - MongoDB Decimal128
 *   - exact decimal strings
 *   - safe integer JavaScript Numbers
 *
 * It does NOT perform financial arithmetic using JavaScript floating point.
 *
 * Decimal inputs are preserved as supplied for Mongoose casting.
 *
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
        throw createBalanceError(
            "Balance mutation amount is required.",
            "BALANCE_AMOUNT_REQUIRED",
            400,
            {
                field:
                    "amount"
            }
        );
    }

    let value;

    if (
        mongoose.isDecimal128(
            amount
        )
    ) {
        value =
            amount.toString();
    } else if (
        typeof amount ===
        "string"
    ) {
        value =
            amount.trim();
    } else if (
        typeof amount ===
        "number"
    ) {
        if (
            !Number.isFinite(
                amount
            )
        ) {
            throw createBalanceError(
                "Balance mutation amount must be finite.",
                "BALANCE_INVALID_AMOUNT",
                400
            );
        }

        /**
         * Reject unsafe non-integer numbers.
         *
         * Financial decimal quantities should arrive as Decimal128 or strings.
         */
        if (
            !Number.isSafeInteger(
                amount
            )
        ) {
            throw createBalanceError(
                "Financial balance amounts must not use unsafe JavaScript floating-point numbers.",
                "BALANCE_UNSAFE_NUMBER",
                400
            );
        }

        value =
            String(
                amount
            );
    } else if (
        typeof amount.toString ===
        "function"
    ) {
        value =
            amount
                .toString()
                .trim();
    } else {
        value =
            String(
                amount
            );
    }

    if (
        !value
    ) {
        throw createBalanceError(
            "Balance mutation amount is required.",
            "BALANCE_AMOUNT_REQUIRED",
            400
        );
    }

    /**
     * Canonical positive decimal notation.
     *
     * Accepted:
     *
     *   1
     *   1.00
     *   1000.50
     *   0.50
     *
     * Rejected:
     *
     *   0
     *   -1
     *   1.2.3
     *   NaN
     *   Infinity
     *   1e3
     */
    if (
        !/^(?=.{1,64}$)(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$/.test(
            value
        )
    ) {
        throw createBalanceError(
            "Balance mutation amount must be a positive decimal value in canonical notation.",
            "BALANCE_INVALID_AMOUNT",
            400,
            {
                field:
                    "amount"
            }
        );
    }

    if (
        isZeroDecimal(
            value
        )
    ) {
        throw createBalanceError(
            "Balance mutation amount must be greater than zero.",
            "BALANCE_ZERO_AMOUNT",
            400,
            {
                field:
                    "amount"
            }
        );
    }

    return amount;
}

/**
 * ============================================================================
 * Account Filter
 * ============================================================================
 */

function buildAccountFilter({
    accountId,
    tenantId,
    currency
}) {
    return {
        _id:
            requireAccountId(
                accountId
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
 * Account Inspection
 * ============================================================================
 *
 * This method exists for inspection/transactional reads.
 *
 * It is NOT used to determine whether a debit is safe.
 *
 * `decrement()` and `decrementStrict()` perform the balance condition and
 * mutation in one MongoDB update.
 * ============================================================================
 */

async function getForUpdate({
    session,
    accountId,
    tenantId,
    currency
}) {
    requireActiveTransaction(
        session
    );

    const filter =
        buildAccountFilter({
            accountId,
            tenantId,
            currency
        });

    return Account
        .findOne(
            filter
        )
        .session(
            session
        )
        .lean()
        .exec();
}

/**
 * ============================================================================
 * Atomic Credit / Increment
 * ============================================================================
 *
 * One MongoDB document update:
 *
 *   balance = balance + amount
 *
 * There is no application-level read/check/update sequence.
 * ============================================================================
 */

async function increment({
    session,
    accountId,
    tenantId,
    amount,
    currency,
    transactionId,
    metadata = {}
}) {
    requireActiveTransaction(
        session
    );

    const normalizedAccountId =
        requireAccountId(
            accountId
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

    const mutationAt =
        new Date();

    /**
     * Metadata intentionally isn't blindly persisted into the Account
     * document. The account schema remains the authoritative mutation shape.
     */
    void metadata;

    try {
        const result =
            await Account
                .findOneAndUpdate(
                    {
                        _id:
                            normalizedAccountId,

                        tenantId:
                            normalizedTenantId,

                        currency:
                            normalizedCurrency,

                        status:
                            ACTIVE_ACCOUNT_STATUS
                    },
                    {
                        $inc:
                            {
                                balance:
                                    normalizedAmount
                            },

                        $set:
                            {
                                lastTransactionId:
                                    normalizedTransactionId,

                                lastBalanceMutationAt:
                                    mutationAt
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
            throw createBalanceError(
                "Financial account could not be credited.",
                "BALANCE_ACCOUNT_UNAVAILABLE",
                404,
                {
                    accountId:
                        normalizedAccountId,

                    tenantId:
                        normalizedTenantId,

                    currency:
                        normalizedCurrency
                }
            );
        }

        return result;
    } catch (
        error
    ) {
        if (
            error instanceof
            FinancialTransactionError
        ) {
            throw error;
        }

        throw translateBalancePersistenceError(
            error,
            {
                operation:
                    "increment",

                accountId:
                    normalizedAccountId,

                tenantId:
                    normalizedTenantId,

                transactionId:
                    normalizedTransactionId
            }
        );
    }
}

/**
 * ============================================================================
 * Atomic Debit / Decrement
 * ============================================================================
 *
 * ============================================================================
 * CRITICAL FINANCIAL OPERATION
 * ============================================================================
 *
 * The WHERE clause contains:
 *
 *     balance >= amount
 *
 * and the same MongoDB operation performs:
 *
 *     balance -= amount
 *
 * Therefore there is no opportunity for two concurrent requests to both pass
 * a stale JavaScript-level balance check.
 *
 * ============================================================================
 */

async function decrement({
    session,
    accountId,
    tenantId,
    amount,
    currency,
    transactionId,
    metadata = {}
}) {
    requireActiveTransaction(
        session
    );

    const normalizedAccountId =
        requireAccountId(
            accountId
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

    const mutationAt =
        new Date();

    void metadata;

    try {
        const result =
            await Account
                .findOneAndUpdate(
                    {
                        _id:
                            normalizedAccountId,

                        tenantId:
                            normalizedTenantId,

                        currency:
                            normalizedCurrency,

                        status:
                            ACTIVE_ACCOUNT_STATUS,

                        balance:
                            {
                                $gte:
                                    normalizedAmount
                            }
                    },
                    {
                        $inc:
                            {
                                balance:
                                    negateAmount(
                                        normalizedAmount
                                    )
                            },

                        $set:
                            {
                                lastTransactionId:
                                    normalizedTransactionId,

                                lastBalanceMutationAt:
                                    mutationAt
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
            /**
             * Do not perform a second balance read here.
             *
             * The atomic update already determined that the mutation could not
             * be safely applied. The financial service can decide how this
             * domain error should be presented.
             */
            throw createBalanceError(
                "Insufficient available balance or financial account unavailable.",
                "INSUFFICIENT_AVAILABLE_BALANCE",
                409,
                {
                    accountId:
                        normalizedAccountId,

                    tenantId:
                        normalizedTenantId,

                    currency:
                        normalizedCurrency
                }
            );
        }

        return result;
    } catch (
        error
    ) {
        if (
            error instanceof
            FinancialTransactionError
        ) {
            throw error;
        }

        throw translateBalancePersistenceError(
            error,
            {
                operation:
                    "decrement",

                accountId:
                    normalizedAccountId,

                tenantId:
                    normalizedTenantId,

                transactionId:
                    normalizedTransactionId
            }
        );
    }
}

/**
 * ============================================================================
 * Strict Atomic Debit
 * ============================================================================
 *
 * Semantically identical to decrement().
 *
 * Kept as an explicit API for financial services that want a clearly named
 * "strict insufficient-balance" operation.
 *
 * No read-before-write is performed.
 * ============================================================================
 */

async function decrementStrict({
    session,
    accountId,
    tenantId,
    amount,
    currency,
    transactionId,
    metadata = {}
}) {
    return decrement({
        session,
        accountId,
        tenantId,
        amount,
        currency,
        transactionId,
        metadata
    });
}

/**
 * ============================================================================
 * Balance Mutation Verification
 * ============================================================================
 *
 * Read-only helper for diagnostics and transactional services that need the
 * current persisted balance after a mutation.
 *
 * Not a locking primitive.
 * ============================================================================
 */

async function getCurrentBalance({
    session,
    accountId,
    tenantId,
    currency
}) {
    requireActiveTransaction(
        session
    );

    const filter =
        buildAccountFilter({
            accountId,
            tenantId,
            currency
        });

    const account =
        await Account
            .findOne(
                filter
            )
            .select(
                {
                    _id:
                        1,

                    tenantId:
                        1,

                    currency:
                        1,

                    balance:
                        1,

                    status:
                        1,

                    lastTransactionId:
                        1,

                    lastBalanceMutationAt:
                        1
                }
            )
            .session(
                session
            )
            .lean()
            .exec();

    if (
        !account
    ) {
        throw createBalanceError(
            "Financial account not found.",
            "BALANCE_ACCOUNT_NOT_FOUND",
            404,
            {
                accountId:
                    filter._id,

                tenantId:
                    filter.tenantId,

                currency:
                    filter.currency
            }
        );
    }

    return account;
}

/**
 * ============================================================================
 * Account Status Inspection
 * ============================================================================
 *
 * Read-only diagnostic helper.
 * ============================================================================
 */

async function getAccountState({
    session,
    accountId,
    tenantId,
    currency
}) {
    requireActiveTransaction(
        session
    );

    const filter =
        buildAccountFilter({
            accountId,
            tenantId,
            currency
        });

    const account =
        await Account
            .findOne(
                filter
            )
            .select(
                {
                    _id:
                        1,

                    tenantId:
                        1,

                    currency:
                        1,

                    status:
                        1,

                    balance:
                        1
                }
            )
            .session(
                session
            )
            .lean()
            .exec();

    return account;
}

/**
 * ============================================================================
 * Persistence Error Translation
 * ============================================================================
 */

function translateBalancePersistenceError(
    error,
    context
) {
    if (
        error?.code ===
        11000
    ) {
        return createBalanceError(
            "Duplicate financial account identity detected.",
            "BALANCE_ACCOUNT_ALREADY_EXISTS",
            409,
            {
                accountId:
                    context
                        ?.accountId,

                tenantId:
                    context
                        ?.tenantId
            }
        );
    }

    if (
        error?.name ===
        "ValidationError"
    ) {
        return createBalanceError(
            "Financial account balance mutation failed model validation.",
            "BALANCE_MODEL_VALIDATION_FAILED",
            400,
            {
                operation:
                    context
                        ?.operation
            }
        );
    }

    if (
        error?.name ===
        "CastError"
    ) {
        return createBalanceError(
            "Financial account persistence received an invalid MongoDB value.",
            "BALANCE_MONGO_CAST_ERROR",
            400,
            {
                operation:
                    context
                        ?.operation
            }
        );
    }

    /**
     * MongoDB transient transaction errors should be allowed through so the
     * financial transaction coordinator can retry the whole transaction.
     */
    if (
        error?.hasErrorLabel?.(
            "TransientTransactionError"
        )
    ) {
        return error;
    }

    if (
        error?.hasErrorLabel?.(
            "UnknownTransactionCommitResult"
        )
    ) {
        return error;
    }

    return error;
}

/**
 * ============================================================================
 * Amount Helpers
 * ============================================================================
 */

function negateAmount(
    amount
) {
    /**
     * Decimal128 is the preferred representation for monetary balances.
     */
    if (
        mongoose.isDecimal128(
            amount
        )
    ) {
        const text =
            amount.toString();

        return mongoose.Types
            .Decimal128
            .fromString(
                `-${text}`
            );
    }

    /**
     * Exact decimal strings are passed directly to Mongoose casting.
     */
    if (
        typeof amount ===
        "string"
    ) {
        return `-${amount}`;
    }

    /**
     * Safe integer values are safe to negate.
     */
    if (
        typeof amount ===
            "number" &&
        Number.isSafeInteger(
            amount
        )
    ) {
        return -amount;
    }

    /**
     * For arbitrary decimal-like objects, explicitly construct Decimal128
     * rather than relying on floating point arithmetic.
     */
    const text =
        amount?.toString?.();

    if (
        text
    ) {
        return mongoose.Types
            .Decimal128
            .fromString(
                `-${text}`
            );
    }

    throw createBalanceError(
        "Unable to represent the balance decrement amount safely.",
        "BALANCE_NEGATION_FAILED",
        400
    );
}

function isZeroDecimal(
    value
) {
    const normalized =
        String(
            value
        )
            .trim();

    if (
        !normalized
    ) {
        return true;
    }

    return /^0+(?:\.0+)?$/.test(
        normalized
    );
}

/**
 * ============================================================================
 * Export
 * ============================================================================
 */

const repositoryModule =
    Object.freeze({
        ACTIVE_ACCOUNT_STATUS,

        requireSession,

        requireActiveTransaction,

        requireAccountId,

        requireTenantId,

        requireTransactionId,

        requireCurrency,

        normalizeAmount,

        getForUpdate,

        increment,

        decrement,

        decrementStrict,

        getCurrentBalance,

        getAccountState
    });
export default repositoryModule;
