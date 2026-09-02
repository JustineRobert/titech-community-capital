"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Financial Balance Repository
 * ============================================================================
 *
 * File:
 *   backend/repositories/BalanceRepository.js
 *
 * Purpose:
 *   Canonical persistence boundary for TITech financial account balance
 *   mutations.
 *
 * Architectural Position:
 *
 *   Financial Transaction Service
 *              │
 *              ▼
 *       BalanceRepository
 *              │
 *              ▼
 *         Account Model
 *              │
 *              ▼
 *            MongoDB
 *
 * ============================================================================
 * CORE FINANCIAL PRINCIPLES
 * ============================================================================
 *
 *   ✓ All account mutations are tenant-scoped.
 *   ✓ All financial mutations require a MongoDB session.
 *   ✓ Repository never starts a MongoDB transaction.
 *   ✓ Repository never commits a MongoDB transaction.
 *   ✓ Repository never aborts a MongoDB transaction.
 *   ✓ Monetary values are Decimal128.
 *   ✓ JavaScript Number is never used for monetary arithmetic.
 *   ✓ Deposits/credits are atomic.
 *   ✓ Withdrawals/debits are atomic.
 *   ✓ Reserved balances are atomic.
 *   ✓ Available-balance constraints are enforced atomically.
 *   ✓ Currency isolation is enforced.
 *   ✓ Account lifecycle is enforced.
 *   ✓ Account financial identity is never changed here.
 *   ✓ Last transaction identity is persisted atomically.
 *   ✓ Balance mutation timestamp is persisted atomically.
 *   ✓ Concurrent mutations are protected by conditional updates.
 *   ✓ Failed conditional mutations return deterministic errors.
 *   ✓ Repository does not implement business authorization.
 *   ✓ Repository does not create ledger entries.
 *   ✓ Repository does not call payment providers.
 *   ✓ Repository does not implement idempotency.
 *
 * ============================================================================
 * IMPORTANT FINANCIAL RULE
 * ============================================================================
 *
 * The repository performs atomic persistence operations.
 *
 * Business workflows such as:
 *
 *   - authorization
 *   - KYC
 *   - AML
 *   - withdrawal approval
 *   - loan approval
 *   - payment-provider interaction
 *   - transaction orchestration
 *   - idempotency
 *   - ledger posting
 *
 * belong to higher service/orchestration layers.
 *
 * ============================================================================
 * DECIMAL128
 * ============================================================================
 *
 * Never:
 *
 *   Number(amount)
 *   parseFloat(amount)
 *   parseInt(amount)
 *   balance + amount
 *   balance - amount
 *
 * Monetary values are normalized by the TITech Money utility and persisted
 * using MongoDB Decimal128.
 *
 * ============================================================================
 * ATOMICITY MODEL
 * ============================================================================
 *
 * CREDIT:
 *
 *   balance = balance + amount
 *
 * DEBIT:
 *
 *   balance = balance - amount
 *
 * while atomically requiring:
 *
 *   balance >= amount
 *
 * RESERVE:
 *
 *   reservedBalance = reservedBalance + amount
 *
 * while atomically requiring:
 *
 *   balance - reservedBalance >= amount
 *
 * RELEASE:
 *
 *   reservedBalance = reservedBalance - amount
 *
 * while atomically requiring:
 *
 *   reservedBalance >= amount
 *
 * ============================================================================
 * TENANCY
 * ============================================================================
 *
 * Every query includes tenantId.
 *
 * An account ID alone is NEVER considered sufficient authorization or
 * isolation information.
 *
 * ============================================================================
 * TITech terminology
 * ============================================================================
 *
 * All legacy ACFOS terminology has been replaced with TITech terminology.
 *
 * ============================================================================
 */

const mongoose = require("mongoose");

const {
    Account
} = require(
    "../models/account.model"
);

const Money = require(
    "../utils/money"
);

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const REPOSITORY_NAME =
    "TITechBalanceRepository";

const REPOSITORY_VERSION =
    "2026.1";

const MAX_IDENTIFIER_LENGTH =
    128;

const MAX_CURRENCY_LENGTH =
    16;

const ACCOUNT_STATUS_ACTIVE =
    "ACTIVE";

/**
 * Internal model mutation marker.
 *
 * Account.js explicitly permits financial mutations only when this option is
 * present.
 */
const INTERNAL_MUTATION_OPTION =
    "allowFinancialMutation";

/**
 * ============================================================================
 * Error Codes
 * ============================================================================
 */

const ERROR_CODES = Object.freeze({
    INVALID_ARGUMENT:
        "BALANCE_INVALID_ARGUMENT",

    INVALID_AMOUNT:
        "BALANCE_INVALID_AMOUNT",

    INVALID_CURRENCY:
        "BALANCE_INVALID_CURRENCY",

    SESSION_REQUIRED:
        "BALANCE_SESSION_REQUIRED",

    ACCOUNT_NOT_FOUND:
        "BALANCE_ACCOUNT_NOT_FOUND",

    ACCOUNT_INACTIVE:
        "BALANCE_ACCOUNT_INACTIVE",

    INSUFFICIENT_FUNDS:
        "BALANCE_INSUFFICIENT_FUNDS",

    INSUFFICIENT_RESERVED:
        "BALANCE_INSUFFICIENT_RESERVED",

    CURRENCY_MISMATCH:
        "BALANCE_CURRENCY_MISMATCH",

    INVALID_OPERATION:
        "BALANCE_INVALID_OPERATION",

    CONCURRENCY_CONFLICT:
        "BALANCE_CONCURRENCY_CONFLICT",

    DATABASE_ERROR:
        "BALANCE_DATABASE_ERROR"
});

/**
 * ============================================================================
 * Repository Error
 * ============================================================================
 */

class BalanceRepositoryError extends Error {
    constructor(
        message,
        code,
        details = undefined,
        cause = undefined
    ) {
        super(message);

        this.name =
            "BalanceRepositoryError";

        this.code =
            code;

        if (
            details !==
            undefined
        ) {
            this.details =
                details;
        }

        if (
            cause !==
            undefined
        ) {
            this.cause =
                cause;
        }

        if (
            Error.captureStackTrace
        ) {
            Error.captureStackTrace(
                this,
                BalanceRepositoryError
            );
        }
    }
}

/**
 * ============================================================================
 * Validation Helpers
 * ============================================================================
 */

function normalizeIdentifier(
    value,
    fieldName
) {
    if (
        typeof value !==
        "string"
    ) {
        throw new BalanceRepositoryError(
            `${fieldName} must be a string.`,
            ERROR_CODES.INVALID_ARGUMENT
        );
    }

    const normalized =
        value.trim();

    if (
        !normalized
    ) {
        throw new BalanceRepositoryError(
            `${fieldName} is required.`,
            ERROR_CODES.INVALID_ARGUMENT
        );
    }

    if (
        normalized.length >
        MAX_IDENTIFIER_LENGTH
    ) {
        throw new BalanceRepositoryError(
            `${fieldName} exceeds the maximum supported length.`,
            ERROR_CODES.INVALID_ARGUMENT
        );
    }

    return normalized;
}

function normalizeTenantId(
    tenantId
) {
    const normalized =
        normalizeIdentifier(
            tenantId,
            "tenantId"
        ).toLowerCase();

    if (
        normalized.length >
        64
    ) {
        throw new BalanceRepositoryError(
            "tenantId exceeds the maximum supported length.",
            ERROR_CODES.INVALID_ARGUMENT
        );
    }

    if (
        !/^[a-z0-9-]+$/.test(
            normalized
        )
    ) {
        throw new BalanceRepositoryError(
            "Invalid TITech tenant identifier.",
            ERROR_CODES.INVALID_ARGUMENT
        );
    }

    return normalized;
}

function normalizeCurrency(
    currency
) {
    const normalized =
        normalizeIdentifier(
            currency,
            "currency"
        ).toUpperCase();

    if (
        normalized.length >
        MAX_CURRENCY_LENGTH
    ) {
        throw new BalanceRepositoryError(
            "Currency exceeds the maximum supported length.",
            ERROR_CODES.INVALID_CURRENCY
        );
    }

    if (
        !/^[A-Z]{3,16}$/.test(
            normalized
        )
    ) {
        throw new BalanceRepositoryError(
            "Invalid account currency.",
            ERROR_CODES.INVALID_CURRENCY
        );
    }

    return normalized;
}

function requireSession(
    session
) {
    if (
        !session ||
        typeof session !==
            "object"
    ) {
        throw new BalanceRepositoryError(
            "A MongoDB session is required for financial balance mutations.",
            ERROR_CODES.SESSION_REQUIRED
        );
    }

    return session;
}

/**
 * ============================================================================
 * Money Adapter
 * ============================================================================
 *
 * This repository intentionally supports a small stable Money utility
 * contract. The utility is expected to expose:
 *
 *   Money.fromDecimal128(value)
 *   Money.toDecimal128(value)
 *   Money.assertPositive(value)
 *   Money.compare(a, b)
 *
 * The adapter also supports common Decimal128/string conversion forms so the
 * repository remains resilient during the Money utility implementation phase.
 * ============================================================================
 */

function toDecimal128(
    value
) {
    try {
        if (
            mongoose.isDecimal128(
                value
            )
        ) {
            return value;
        }

        if (
            typeof Money?.toDecimal128 ===
            "function"
        ) {
            return Money.toDecimal128(
                value
            );
        }

        if (
            typeof Money?.fromDecimal128 ===
            "function" &&
            mongoose.isDecimal128(
                value
            )
        ) {
            return Money.fromDecimal128(
                value
            );
        }

        return mongoose.Types
            .Decimal128
            .fromString(
                String(value)
            );
    } catch (
        error
    ) {
        throw new BalanceRepositoryError(
            "Invalid monetary value.",
            ERROR_CODES.INVALID_AMOUNT,
            undefined,
            error
        );
    }
}

function decimalString(
    value
) {
    return toDecimal128(
        value
    ).toString();
}

function assertPositiveAmount(
    value
) {
    try {
        if (
            typeof Money?.assertPositive ===
            "function"
        ) {
            return Money.assertPositive(
                value
            );
        }

        const decimal =
            toDecimal128(
                value
            );

        const text =
            decimal.toString();

        if (
            !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(
                text
            )
        ) {
            throw new Error(
                "Amount must be positive."
            );
        }

        if (
            /^0(?:\.0+)?$/.test(
                text
            )
        ) {
            throw new Error(
                "Amount must be greater than zero."
            );
        }

        return decimal;
    } catch (
        error
    ) {
        if (
            error instanceof
            BalanceRepositoryError
        ) {
            throw error;
        }

        throw new BalanceRepositoryError(
            "Amount must be a positive monetary value.",
            ERROR_CODES.INVALID_AMOUNT,
            undefined,
            error
        );
    }
}

/**
 * ============================================================================
 * Update Result Helper
 * ============================================================================
 */

function extractUpdatedDocument(
    result
) {
    if (
        result?.value
    ) {
        return result.value;
    }

    return result;
}

function toPlainAccount(
    account
) {
    if (
        !account
    ) {
        return null;
    }

    if (
        typeof account.toObject ===
        "function"
    ) {
        return account.toObject({
            virtuals: true
        });
    }

    return account;
}

/**
 * ============================================================================
 * BalanceRepository
 * ============================================================================
 */

class BalanceRepository {
    constructor(
        model = Account
    ) {
        if (
            !model
        ) {
            throw new TypeError(
                `[${REPOSITORY_NAME}] Account model is required.`
            );
        }

        this.model =
            model;
    }

    /**
     * ========================================================================
     * METADATA
     * ========================================================================
     */

    getRepositoryInfo() {
        return Object.freeze({
            name:
                REPOSITORY_NAME,
            version:
                REPOSITORY_VERSION
        });
    }

    /**
     * ========================================================================
     * READ: FIND ACCOUNT
     * ========================================================================
     */

    async findById(
        {
            tenantId,
            accountId,
            currency,
            session
        } = {}
    ) {
        const normalizedTenantId =
            normalizeTenantId(
                tenantId
            );

        const normalizedAccountId =
            normalizeIdentifier(
                accountId,
                "accountId"
            );

        const query = {
            _id:
                normalizedAccountId,
            tenantId:
                normalizedTenantId
        };

        if (
            currency !==
            undefined &&
            currency !==
            null
        ) {
            query.currency =
                normalizeCurrency(
                    currency
                );
        }

        let request =
            this.model
                .findOne(
                    query
                );

        if (
            session
        ) {
            request =
                request.session(
                    session
                );
        }

        return request.lean();
    }

    /**
     * ========================================================================
     * READ: ACTIVE ACCOUNT
     * ========================================================================
     */

    async findActiveById(
        {
            tenantId,
            accountId,
            currency,
            session
        } = {}
    ) {
        const normalizedTenantId =
            normalizeTenantId(
                tenantId
            );

        const normalizedAccountId =
            normalizeIdentifier(
                accountId,
                "accountId"
            );

        const normalizedCurrency =
            normalizeCurrency(
                currency
            );

        let request =
            this.model.findOne({
                _id:
                    normalizedAccountId,

                tenantId:
                    normalizedTenantId,

                currency:
                    normalizedCurrency,

                status:
                    ACCOUNT_STATUS_ACTIVE
            });

        if (
            session
        ) {
            request =
                request.session(
                    session
                );
        }

        return request.lean();
    }

    /**
     * ========================================================================
     * READ: AVAILABLE BALANCE
     * ========================================================================
     */

    async getAvailableBalance(
        {
            tenantId,
            accountId,
            currency,
            session
        } = {}
    ) {
        const account =
            await this.findById({
                tenantId,
                accountId,
                currency,
                session
            });

        if (
            !account
        ) {
            throw new BalanceRepositoryError(
                "Financial account was not found.",
                ERROR_CODES.ACCOUNT_NOT_FOUND,
                {
                    tenantId,
                    accountId
                }
            );
        }

        return {
            accountId:
                account._id,

            tenantId:
                account.tenantId,

            currency:
                account.currency,

            balance:
                decimalString(
                    account.balance
                ),

            reservedBalance:
                decimalString(
                    account.reservedBalance
                ),

            availableBalance:
                this.calculateAvailableBalance(
                    account.balance,
                    account.reservedBalance
                ),

            status:
                account.status
        };
    }

    /**
     * ========================================================================
     * READ: AVAILABLE BALANCE CALCULATION
     * ========================================================================
     *
     * This is for presentation/read purposes only.
     *
     * Financial mutation arithmetic remains in MongoDB.
     */

    calculateAvailableBalance(
        balance,
        reservedBalance
    ) {
        const balanceDecimal =
            toDecimal128(
                balance
            );

        const reservedDecimal =
            toDecimal128(
                reservedBalance
            );

        if (
            typeof Money?.subtract ===
            "function"
        ) {
            return decimalString(
                Money.subtract(
                    balanceDecimal,
                    reservedDecimal
                )
            );
        }

        /**
         * Decimal128 arithmetic is intentionally not performed using JS Number.
         *
         * For the fallback, convert using a fixed-scale BigInt representation.
         */
        const balanceUnits =
            decimalToScaledBigInt(
                balanceDecimal.toString()
            );

        const reservedUnits =
            decimalToScaledBigInt(
                reservedDecimal.toString()
            );

        const difference =
            balanceUnits -
            reservedUnits;

        if (
            difference <
            0n
        ) {
            return "0";
        }

        return scaledBigIntToDecimalString(
            difference
        );
    }

    /**
     * ========================================================================
     * CREDIT
     * ========================================================================
     *
     * Adds funds to an account atomically.
     *
     * Preconditions:
     *
     *   - session required
     *   - amount > 0
     *   - account exists
     *   - tenant matches
     *   - currency matches
     *   - account is ACTIVE
     *
     * Mutation:
     *
     *   balance += amount
     *
     * ========================================================================
     */

    async credit(
        {
            tenantId,
            accountId,
            amount,
            currency,
            transactionId,
            session,
            updatedBy,
            allowInactive = false
        } = {}
    ) {
        const normalized =
            this._normalizeMutationInput({
                tenantId,
                accountId,
                amount,
                currency,
                transactionId,
                session,
                updatedBy
            });

        const amountDecimal =
            assertPositiveAmount(
                normalized.amount
            );

        const query = {
            _id:
                normalized.accountId,

            tenantId:
                normalized.tenantId,

            currency:
                normalized.currency
        };

        if (
            !allowInactive
        ) {
            query.status =
                ACCOUNT_STATUS_ACTIVE;
        }

        const update = {
            $inc: {
                balance:
                    amountDecimal
            },

            $set: {
                lastTransactionId:
                    normalized.transactionId,

                lastBalanceMutationAt:
                    new Date(),

                ...(normalized.updatedBy
                    ? {
                        updatedBy:
                            normalized.updatedBy
                    }
                    : {})
            }
        };

        return this._executeFinancialMutation({
            operation:
                "credit",

            query,

            update,

            session:
                normalized.session,

            failureCode:
                allowInactive
                    ? ERROR_CODES.ACCOUNT_NOT_FOUND
                    : ERROR_CODES.ACCOUNT_INACTIVE
        });
    }

    /**
     * ========================================================================
     * DEBIT
     * ========================================================================
     *
     * Removes funds atomically.
     *
     * The critical invariant is enforced inside the MongoDB query:
     *
     *   balance >= amount
     *
     * This prevents two concurrent withdrawals from both observing the same
     * available funds and spending them twice.
     *
     * ========================================================================
     */

    async debit(
        {
            tenantId,
            accountId,
            amount,
            currency,
            transactionId,
            session,
            updatedBy
        } = {}
    ) {
        const normalized =
            this._normalizeMutationInput({
                tenantId,
                accountId,
                amount,
                currency,
                transactionId,
                session,
                updatedBy
            });

        const amountDecimal =
            assertPositiveAmount(
                normalized.amount
            );

        const query = {
            _id:
                normalized.accountId,

            tenantId:
                normalized.tenantId,

            currency:
                normalized.currency,

            status:
                ACCOUNT_STATUS_ACTIVE,

            balance: {
                $gte:
                    amountDecimal
            }
        };

        const update = {
            $inc: {
                balance:
                    mongoose.Types
                        .Decimal128
                        .fromString(
                            `-${amountDecimal.toString()}`
                        )
            },

            $set: {
                lastTransactionId:
                    normalized.transactionId,

                lastBalanceMutationAt:
                    new Date(),

                ...(normalized.updatedBy
                    ? {
                        updatedBy:
                            normalized.updatedBy
                    }
                    : {})
            }
        };

        return this._executeDebitMutation({
            query,
            update,
            session:
                normalized.session,
            tenantId:
                normalized.tenantId,
            accountId:
                normalized.accountId,
            currency:
                normalized.currency
        });
    }

    /**
     * ========================================================================
     * RESERVE
     * ========================================================================
     *
     * Reserves currently available funds.
     *
     * Invariant:
     *
     *   reservedBalance + amount <= balance
     *
     * Expressed atomically as:
     *
     *   balance - reservedBalance >= amount
     *
     * equivalent to:
     *
     *   reservedBalance <= balance - amount
     * ========================================================================
     */

    async reserve(
        {
            tenantId,
            accountId,
            amount,
            currency,
            transactionId,
            session,
            updatedBy
        } = {}
    ) {
        const normalized =
            this._normalizeMutationInput({
                tenantId,
                accountId,
                amount,
                currency,
                transactionId,
                session,
                updatedBy
            });

        const amountDecimal =
            assertPositiveAmount(
                normalized.amount
            );

        const query = {
            _id:
                normalized.accountId,

            tenantId:
                normalized.tenantId,

            currency:
                normalized.currency,

            status:
                ACCOUNT_STATUS_ACTIVE,

            $expr: {
                $gte: [
                    {
                        $subtract: [
                            "$balance",
                            "$reservedBalance"
                        ]
                    },

                    amountDecimal
                ]
            }
        };

        const update = {
            $inc: {
                reservedBalance:
                    amountDecimal
            },

            $set: {
                lastTransactionId:
                    normalized.transactionId,

                lastBalanceMutationAt:
                    new Date(),

                ...(normalized.updatedBy
                    ? {
                        updatedBy:
                            normalized.updatedBy
                    }
                    : {})
            }
        };

        return this._executeReserveMutation({
            query,
            update,
            session:
                normalized.session,
            tenantId:
                normalized.tenantId,
            accountId:
                normalized.accountId,
            currency:
                normalized.currency
        });
    }

    /**
     * ========================================================================
     * RELEASE RESERVED FUNDS
     * ========================================================================
     */

    async release(
        {
            tenantId,
            accountId,
            amount,
            currency,
            transactionId,
            session,
            updatedBy
        } = {}
    ) {
        const normalized =
            this._normalizeMutationInput({
                tenantId,
                accountId,
                amount,
                currency,
                transactionId,
                session,
                updatedBy
            });

        const amountDecimal =
            assertPositiveAmount(
                normalized.amount
            );

        const query = {
            _id:
                normalized.accountId,

            tenantId:
                normalized.tenantId,

            currency:
                normalized.currency,

            status:
                ACCOUNT_STATUS_ACTIVE,

            reservedBalance: {
                $gte:
                    amountDecimal
            }
        };

        const negativeAmount =
            mongoose.Types
                .Decimal128
                .fromString(
                    `-${amountDecimal.toString()}`
                );

        const update = {
            $inc: {
                reservedBalance:
                    negativeAmount
            },

            $set: {
                lastTransactionId:
                    normalized.transactionId,

                lastBalanceMutationAt:
                    new Date(),

                ...(normalized.updatedBy
                    ? {
                        updatedBy:
                            normalized.updatedBy
                    }
                    : {})
            }
        };

        return this._executeReleaseMutation({
            query,
            update,
            session:
                normalized.session,
            tenantId:
                normalized.tenantId,
            accountId:
                normalized.accountId,
            currency:
                normalized.currency
        });
    }

    /**
     * ========================================================================
     * SETTLE RESERVED FUNDS
     * ========================================================================
     *
     * Converts a reserved amount into a completed debit:
     *
     *   balance         -= amount
     *   reservedBalance -= amount
     *
     * Preconditions:
     *
     *   reservedBalance >= amount
     *
     * Since reservedBalance <= balance is maintained, the balance debit is
     * safe when the reservation exists.
     *
     * This is useful for a workflow such as:
     *
     *   reserve → provider processing → settlement
     *
     * ========================================================================
     */

    async settleReserved(
        {
            tenantId,
            accountId,
            amount,
            currency,
            transactionId,
            session,
            updatedBy
        } = {}
    ) {
        const normalized =
            this._normalizeMutationInput({
                tenantId,
                accountId,
                amount,
                currency,
                transactionId,
                session,
                updatedBy
            });

        const amountDecimal =
            assertPositiveAmount(
                normalized.amount
            );

        const negativeAmount =
            mongoose.Types
                .Decimal128
                .fromString(
                    `-${amountDecimal.toString()}`
                );

        const query = {
            _id:
                normalized.accountId,

            tenantId:
                normalized.tenantId,

            currency:
                normalized.currency,

            status:
                ACCOUNT_STATUS_ACTIVE,

            reservedBalance: {
                $gte:
                    amountDecimal
            },

            balance: {
                $gte:
                    amountDecimal
            }
        };

        const update = {
            $inc: {
                balance:
                    negativeAmount,

                reservedBalance:
                    negativeAmount
            },

            $set: {
                lastTransactionId:
                    normalized.transactionId,

                lastBalanceMutationAt:
                    new Date(),

                ...(normalized.updatedBy
                    ? {
                        updatedBy:
                            normalized.updatedBy
                    }
                    : {})
            }
        };

        return this._executeSettlementMutation({
            query,
            update,
            session:
                normalized.session,
            tenantId:
                normalized.tenantId,
            accountId:
                normalized.accountId,
            currency:
                normalized.currency
        });
    }

    /**
     * ========================================================================
     * TRANSFER
     * ========================================================================
     *
     * Atomic two-account transfer inside the caller's MongoDB transaction.
     *
     * IMPORTANT:
     *
     * MongoDB transaction orchestration remains outside this repository.
     *
     * The caller must provide a session associated with an active transaction.
     *
     * This method performs:
     *
     *   source.balance -= amount
     *   destination.balance += amount
     *
     * Each account mutation is conditional and tenant/currency scoped.
     *
     * ========================================================================
     */

    async transfer(
        {
            tenantId,
            fromAccountId,
            toAccountId,
            amount,
            currency,
            transactionId,
            session,
            updatedBy
        } = {}
    ) {
        const normalizedTenantId =
            normalizeTenantId(
                tenantId
            );

        const sourceId =
            normalizeIdentifier(
                fromAccountId,
                "fromAccountId"
            );

        const destinationId =
            normalizeIdentifier(
                toAccountId,
                "toAccountId"
            );

        if (
            sourceId ===
            destinationId
        ) {
            throw new BalanceRepositoryError(
                "Source and destination accounts must be different.",
                ERROR_CODES.INVALID_OPERATION
            );
        }

        const normalizedCurrency =
            normalizeCurrency(
                currency
            );

        const normalizedTransactionId =
            normalizeIdentifier(
                transactionId,
                "transactionId"
            );

        const normalizedSession =
            requireSession(
                session
            );

        const amountDecimal =
            assertPositiveAmount(
                amount
            );

        const negativeAmount =
            mongoose.Types
                .Decimal128
                .fromString(
                    `-${amountDecimal.toString()}`
                );

        const timestamp =
            new Date();

        /**
         * Source debit.
         */
        const sourceQuery = {
            _id:
                sourceId,

            tenantId:
                normalizedTenantId,

            currency:
                normalizedCurrency,

            status:
                ACCOUNT_STATUS_ACTIVE,

            balance: {
                $gte:
                    amountDecimal
            }
        };

        const sourceUpdate = {
            $inc: {
                balance:
                    negativeAmount
            },

            $set: {
                lastTransactionId:
                    normalizedTransactionId,

                lastBalanceMutationAt:
                    timestamp,

                ...(updatedBy
                    ? {
                        updatedBy:
                            String(
                                updatedBy
                            ).trim()
                    }
                    : {})
            }
        };

        const sourceResult =
            await this.model
                .findOneAndUpdate(
                    sourceQuery,
                    sourceUpdate,
                    {
                        session:
                            normalizedSession,

                        new: true,

                        returnDocument:
                            "after",

                        [INTERNAL_MUTATION_OPTION]:
                            true
                    }
                )
                .lean();

        if (
            !sourceResult
        ) {
            await this._assertDebitFailureReason({
                tenantId:
                    normalizedTenantId,
                accountId:
                    sourceId,
                currency:
                    normalizedCurrency,
                session:
                    normalizedSession
            });
        }

        /**
         * Destination credit.
         */
        const destinationQuery = {
            _id:
                destinationId,

            tenantId:
                normalizedTenantId,

            currency:
                normalizedCurrency,

            status:
                ACCOUNT_STATUS_ACTIVE
        };

        const destinationUpdate = {
            $inc: {
                balance:
                    amountDecimal
            },

            $set: {
                lastTransactionId:
                    normalizedTransactionId,

                lastBalanceMutationAt:
                    timestamp,

                ...(updatedBy
                    ? {
                        updatedBy:
                            String(
                                updatedBy
                            ).trim()
                    }
                    : {})
            }
        };

        const destinationResult =
            await this.model
                .findOneAndUpdate(
                    destinationQuery,
                    destinationUpdate,
                    {
                        session:
                            normalizedSession,

                        new: true,

                        returnDocument:
                            "after",

                        [INTERNAL_MUTATION_OPTION]:
                            true
                    }
                )
                .lean();

        if (
            !destinationResult
        ) {
            throw new BalanceRepositoryError(
                "Destination account was not found or is not active.",
                ERROR_CODES.ACCOUNT_NOT_FOUND,
                {
                    tenantId:
                        normalizedTenantId,
                    accountId:
                        destinationId,
                    currency:
                        normalizedCurrency
                }
            );
        }

        return {
            operation:
                "transfer",

            transactionId:
                normalizedTransactionId,

            amount:
                amountDecimal.toString(),

            currency:
                normalizedCurrency,

            source:
                toPlainAccount(
                    sourceResult
                ),

            destination:
                toPlainAccount(
                    destinationResult
                )
        };
    }

    /**
     * ========================================================================
     * PRIVATE: COMMON INPUT NORMALIZATION
     * ========================================================================
     */

    _normalizeMutationInput(
        {
            tenantId,
            accountId,
            amount,
            currency,
            transactionId,
            session,
            updatedBy
        }
    ) {
        const normalizedTenantId =
            normalizeTenantId(
                tenantId
            );

        const normalizedAccountId =
            normalizeIdentifier(
                accountId,
                "accountId"
            );

        const normalizedCurrency =
            normalizeCurrency(
                currency
            );

        const normalizedTransactionId =
            normalizeIdentifier(
                transactionId,
                "transactionId"
            );

        const normalizedSession =
            requireSession(
                session
            );

        let normalizedUpdatedBy =
            null;

        if (
            updatedBy !==
            undefined &&
            updatedBy !==
            null
        ) {
            normalizedUpdatedBy =
                normalizeIdentifier(
                    String(
                        updatedBy
                    ),
                    "updatedBy"
                );
        }

        return {
            tenantId:
                normalizedTenantId,

            accountId:
                normalizedAccountId,

            amount,

            currency:
                normalizedCurrency,

            transactionId:
                normalizedTransactionId,

            session:
                normalizedSession,

            updatedBy:
                normalizedUpdatedBy
        };
    }

    /**
     * ========================================================================
     * PRIVATE: FINANCIAL MUTATION EXECUTOR
     * ========================================================================
     */

    async _executeFinancialMutation(
        {
            operation,
            query,
            update,
            session,
            failureCode
        }
    ) {
        try {
            const result =
                await this.model
                    .findOneAndUpdate(
                        query,
                        update,
                        {
                            session,

                            new: true,

                            returnDocument:
                                "after",

                            [INTERNAL_MUTATION_OPTION]:
                                true
                        }
                    )
                    .lean();

            if (
                result
            ) {
                return {
                    operation,

                    account:
                        toPlainAccount(
                            result
                        )
                };
            }

            throw new BalanceRepositoryError(
                "Financial account was not found or is not eligible for this mutation.",
                failureCode
            );
        } catch (
            error
        ) {
            if (
                error instanceof
                BalanceRepositoryError
            ) {
                throw error;
            }

            throw this._wrapDatabaseError(
                operation,
                error
            );
        }
    }

    /**
     * ========================================================================
     * PRIVATE: DEBIT EXECUTOR
     * ========================================================================
     */

    async _executeDebitMutation(
        {
            query,
            update,
            session,
            tenantId,
            accountId,
            currency
        }
    ) {
        try {
            const result =
                await this.model
                    .findOneAndUpdate(
                        query,
                        update,
                        {
                            session,

                            new: true,

                            returnDocument:
                                "after",

                            [INTERNAL_MUTATION_OPTION]:
                                true
                        }
                    )
                    .lean();

            if (
                result
            ) {
                return {
                    operation:
                        "debit",

                    account:
                        toPlainAccount(
                            result
                        )
                };
            }

            await this._assertDebitFailureReason({
                tenantId,
                accountId,
                currency,
                session
            });

            throw new BalanceRepositoryError(
                "Debit could not be completed.",
                ERROR_CODES.CONCURRENCY_CONFLICT
            );
        } catch (
            error
        ) {
            if (
                error instanceof
                BalanceRepositoryError
            ) {
                throw error;
            }

            throw this._wrapDatabaseError(
                "debit",
                error
            );
        }
    }

    /**
     * ========================================================================
     * PRIVATE: RESERVE EXECUTOR
     * ========================================================================
     */

    async _executeReserveMutation(
        {
            query,
            update,
            session,
            tenantId,
            accountId,
            currency
        }
    ) {
        try {
            const result =
                await this.model
                    .findOneAndUpdate(
                        query,
                        update,
                        {
                            session,

                            new: true,

                            returnDocument:
                                "after",

                            [INTERNAL_MUTATION_OPTION]:
                                true
                        }
                    )
                    .lean();

            if (
                result
            ) {
                return {
                    operation:
                        "reserve",

                    account:
                        toPlainAccount(
                            result
                        )
                };
            }

            const account =
                await this.model
                    .findOne({
                        _id:
                            accountId,

                        tenantId,

                        currency
                    })
                    .session(
                        session
                    )
                    .lean();

            if (
                !account
            ) {
                throw new BalanceRepositoryError(
                    "Financial account was not found.",
                    ERROR_CODES.ACCOUNT_NOT_FOUND
                );
            }

            if (
                account.status !==
                ACCOUNT_STATUS_ACTIVE
            ) {
                throw new BalanceRepositoryError(
                    "Account is not active.",
                    ERROR_CODES.ACCOUNT_INACTIVE
                );
            }

            throw new BalanceRepositoryError(
                "Insufficient available balance.",
                ERROR_CODES.INSUFFICIENT_FUNDS
            );
        } catch (
            error
        ) {
            if (
                error instanceof
                BalanceRepositoryError
            ) {
                throw error;
            }

            throw this._wrapDatabaseError(
                "reserve",
                error
            );
        }
    }

    /**
     * ========================================================================
     * PRIVATE: RELEASE EXECUTOR
     * ========================================================================
     */

    async _executeReleaseMutation(
        {
            query,
            update,
            session,
            tenantId,
            accountId,
            currency
        }
    ) {
        try {
            const result =
                await this.model
                    .findOneAndUpdate(
                        query,
                        update,
                        {
                            session,

                            new: true,

                            returnDocument:
                                "after",

                            [INTERNAL_MUTATION_OPTION]:
                                true
                        }
                    )
                    .lean();

            if (
                result
            ) {
                return {
                    operation:
                        "release",

                    account:
                        toPlainAccount(
                            result
                        )
                };
            }

            const account =
                await this.model
                    .findOne({
                        _id:
                            accountId,

                        tenantId,

                        currency
                    })
                    .session(
                        session
                    )
                    .lean();

            if (
                !account
            ) {
                throw new BalanceRepositoryError(
                    "Financial account was not found.",
                    ERROR_CODES.ACCOUNT_NOT_FOUND
                );
            }

            if (
                account.status !==
                ACCOUNT_STATUS_ACTIVE
            ) {
                throw new BalanceRepositoryError(
                    "Account is not active.",
                    ERROR_CODES.ACCOUNT_INACTIVE
                );
            }

            throw new BalanceRepositoryError(
                "Reserved balance is insufficient.",
                ERROR_CODES.INSUFFICIENT_RESERVED
            );
        } catch (
            error
        ) {
            if (
                error instanceof
                BalanceRepositoryError
            ) {
                throw error;
            }

            throw this._wrapDatabaseError(
                "release",
                error
            );
        }
    }

    /**
     * ========================================================================
     * PRIVATE: SETTLEMENT EXECUTOR
     * ========================================================================
     */

    async _executeSettlementMutation(
        {
            query,
            update,
            session,
            tenantId,
            accountId,
            currency
        }
    ) {
        try {
            const result =
                await this.model
                    .findOneAndUpdate(
                        query,
                        update,
                        {
                            session,

                            new: true,

                            returnDocument:
                                "after",

                            [INTERNAL_MUTATION_OPTION]:
                                true
                        }
                    )
                    .lean();

            if (
                result
            ) {
                return {
                    operation:
                        "settleReserved",

                    account:
                        toPlainAccount(
                            result
                        )
                };
            }

            const account =
                await this.model
                    .findOne({
                        _id:
                            accountId,

                        tenantId,

                        currency
                    })
                    .session(
                        session
                    )
                    .lean();

            if (
                !account
            ) {
                throw new BalanceRepositoryError(
                    "Financial account was not found.",
                    ERROR_CODES.ACCOUNT_NOT_FOUND
                );
            }

            if (
                account.status !==
                ACCOUNT_STATUS_ACTIVE
            ) {
                throw new BalanceRepositoryError(
                    "Account is not active.",
                    ERROR_CODES.ACCOUNT_INACTIVE
                );
            }

            if (
                account.reservedBalance
            ) {
                const reserved =
                    decimalToScaledBigInt(
                        account.reservedBalance.toString()
                    );

                throw new BalanceRepositoryError(
                    "Reserved balance is insufficient.",
                    ERROR_CODES.INSUFFICIENT_RESERVED
                );
            }

            throw new BalanceRepositoryError(
                "Reserved settlement could not be completed.",
                ERROR_CODES.CONCURRENCY_CONFLICT
            );
        } catch (
            error
        ) {
            if (
                error instanceof
                BalanceRepositoryError
            ) {
                throw error;
            }

            throw this._wrapDatabaseError(
                "settleReserved",
                error
            );
        }
    }

    /**
     * ========================================================================
     * PRIVATE: DEBIT FAILURE DIAGNOSIS
     * ========================================================================
     */

    async _assertDebitFailureReason(
        {
            tenantId,
            accountId,
            currency,
            session
        }
    ) {
        const account =
            await this.model
                .findOne({
                    _id:
                        accountId,

                    tenantId,

                    currency
                })
                .session(
                    session
                )
                .lean();

        if (
            !account
        ) {
            throw new BalanceRepositoryError(
                "Financial account was not found.",
                ERROR_CODES.ACCOUNT_NOT_FOUND,
                {
                    tenantId,
                    accountId,
                    currency
                }
            );
        }

        if (
            account.status !==
            ACCOUNT_STATUS_ACTIVE
        ) {
            throw new BalanceRepositoryError(
                "Account is not active.",
                ERROR_CODES.ACCOUNT_INACTIVE
            );
        }

        throw new BalanceRepositoryError(
            "Insufficient account balance.",
            ERROR_CODES.INSUFFICIENT_FUNDS,
            {
                accountId,
                currency
            }
        );
    }

    /**
     * ========================================================================
     * PRIVATE: DATABASE ERROR WRAPPER
     * ========================================================================
     */

    _wrapDatabaseError(
        operation,
        error
    ) {
        return new BalanceRepositoryError(
            `Financial balance ${operation} failed.`,
            ERROR_CODES.DATABASE_ERROR,
            {
                operation
            },
            error
        );
    }
}

/**
 * ============================================================================
 * Decimal Fixed-Scale Helpers
 * ============================================================================
 *
 * These helpers exist only as a fallback for read-side comparison /
 * presentation. They are NOT used for MongoDB financial mutation arithmetic.
 *
 * Scale:
 *   18 decimal places
 *
 * This supports Decimal128 values without converting them to JavaScript
 * floating-point Numbers.
 * ============================================================================
 */

const DECIMAL_SCALE =
    18;

function decimalToScaledBigInt(
    value
) {
    const text =
        String(
            value
        )
            .trim();

    if (
        !/^\d+(?:\.\d+)?$/.test(
            text
        )
    ) {
        throw new Error(
            "Invalid non-negative decimal value."
        );
    }

    let [
        integerPart,
        fractionalPart = ""
    ] =
        text.split(
            "."
        );

    integerPart =
        integerPart.replace(
            /^0+(?=\d)/,
            ""
        ) ||
        "0";

    if (
        fractionalPart.length >
        DECIMAL_SCALE
    ) {
        /**
         * Decimal128 may carry more than 18 fractional digits.
         *
         * For read-side presentation we preserve the first 18 digits.
         * Financial mutation arithmetic never uses this helper.
         */
        fractionalPart =
            fractionalPart.slice(
                0,
                DECIMAL_SCALE
            );
    }

    fractionalPart =
        fractionalPart.padEnd(
            DECIMAL_SCALE,
            "0"
        );

    return BigInt(
        `${integerPart}${fractionalPart}`
    );
}

function scaledBigIntToDecimalString(
    value
) {
    const negative =
        value <
        0n;

    const absolute =
        negative
            ? -value
            : value;

    const text =
        absolute
            .toString()
            .padStart(
                DECIMAL_SCALE + 1,
                "0"
            );

    const split =
        text.length -
        DECIMAL_SCALE;

    const integerPart =
        text.slice(
            0,
            split
        );

    const fractionalPart =
        text.slice(
            split
        )
            .replace(
                /0+$/,
                ""
            );

    const result =
        fractionalPart
            ? `${integerPart}.${fractionalPart}`
            : integerPart;

    return negative
        ? `-${result}`
        : result;
}

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports = BalanceRepository;

module.exports.BalanceRepository =
    BalanceRepository;

module.exports.BalanceRepositoryError =
    BalanceRepositoryError;

module.exports.BALANCE_ERROR_CODES =
    ERROR_CODES;

module.exports.BALANCE_REPOSITORY_NAME =
    REPOSITORY_NAME;

module.exports.BALANCE_REPOSITORY_VERSION =
    REPOSITORY_VERSION;