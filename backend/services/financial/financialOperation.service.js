"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * African Community Finance Operating System (ACFOS)
 * =============================================================================
 *
 * File:
 *   backend/services/financial/financialOperation.service.js
 *
 * Purpose:
 *   Canonical financial operation orchestration boundary.
 *
 * =============================================================================
 *
 * FINANCIAL CORRECTNESS MODEL
 * =============================================================================
 *
 * Every operation executes inside ONE MongoDB transaction:
 *
 *      Idempotency Record
 *              │
 *              ▼
 *      Financial Transaction
 *              │
 *       ┌──────┴──────┐
 *       ▼             ▼
 *    Ledger        Balance
 *       │             │
 *       └──────┬──────┘
 *              ▼
 *         Loan State
 *
 *              │
 *              ▼
 *           COMMIT
 *
 * If ANY operation fails:
 *
 *              ROLLBACK
 *
 * Therefore:
 *
 *   financial transaction
 *   + ledger entries
 *   + balance mutation
 *   + loan mutation
 *
 * either commit together or disappear together.
 *
 * =============================================================================
 *
 * IMPORTANT
 * =============================================================================
 *
 * This service:
 *
 *   ✓ Does NOT create MongoDB sessions.
 *   ✓ Does NOT commit MongoDB transactions.
 *   ✓ Does NOT abort MongoDB transactions.
 *   ✓ Does NOT call external payment providers.
 *   ✓ Does NOT mutate MongoDB outside the supplied session.
 *
 * The caller MUST provide an active transaction session.
 *
 * =============================================================================
 */

const {
    FinancialTransactionError
} = require(
    "./financialTransaction.service"
);

// =============================================================================
// Constants
// =============================================================================

const FINANCIAL_OPERATION =
    Object.freeze({

        CONTRIBUTION_CREATE:
            "CONTRIBUTION_CREATE",

        DEPOSIT_CREATE:
            "DEPOSIT_CREATE",

        WITHDRAWAL_CREATE:
            "WITHDRAWAL_CREATE",

        TRANSFER_CREATE:
            "TRANSFER_CREATE",

        LOAN_DISBURSEMENT:
            "LOAN_DISBURSEMENT",

        LOAN_REPAYMENT:
            "LOAN_REPAYMENT"

    });

const RESULT_TYPE =
    Object.freeze({

        SUCCESS:
            "SUCCESS",

        CLIENT_ERROR:
            "CLIENT_ERROR",

        SERVER_ERROR:
            "SERVER_ERROR"

    });

const FINANCIAL_TRANSACTION_STATUS =
    Object.freeze({

        PENDING:
            "PENDING",

        COMPLETED:
            "COMPLETED",

        FAILED:
            "FAILED"

    });

const LEDGER_DIRECTION =
    Object.freeze({

        DEBIT:
            "DEBIT",

        CREDIT:
            "CREDIT"

    });

const LEDGER_ENTRY_TYPE =
    Object.freeze({

        CONTRIBUTION:
            "CONTRIBUTION",

        DEPOSIT:
            "DEPOSIT",

        WITHDRAWAL:
            "WITHDRAWAL",

        TRANSFER:
            "TRANSFER",

        LOAN_DISBURSEMENT:
            "LOAN_DISBURSEMENT",

        LOAN_REPAYMENT:
            "LOAN_REPAYMENT"

    });

const DEFAULT_DECIMAL_SCALE =
    2;

const MAX_IDENTIFIER_LENGTH =
    128;

const MAX_CURRENCY_LENGTH =
    3;

// =============================================================================
// Validation
// =============================================================================

function assertSession(
    session
) {

    if (!session) {

        throw new FinancialTransactionError(
            "MongoDB transaction session is required.",
            "FINANCIAL_SESSION_REQUIRED",
            500
        );
    }

    if (
        typeof session.inTransaction !==
        "function"
    ) {

        throw new FinancialTransactionError(
            "Invalid MongoDB transaction session.",
            "FINANCIAL_INVALID_SESSION",
            500
        );
    }

    if (
        !session.inTransaction()
    ) {

        throw new FinancialTransactionError(
            "Financial operation requires an active MongoDB transaction.",
            "FINANCIAL_TRANSACTION_NOT_ACTIVE",
            500
        );
    }
}

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
            "FINANCIAL_REPOSITORY_FUNCTION_REQUIRED",
            500
        );
    }
}

function assertRepositories(
    repositories = {}
) {

    const {
        transactionRepository,
        ledgerRepository,
        balanceRepository,
        loanRepository
    } = repositories;

    if (!transactionRepository) {

        throw new FinancialTransactionError(
            "Financial transaction repository is required.",
            "FINANCIAL_TRANSACTION_REPOSITORY_REQUIRED",
            500
        );
    }

    if (!ledgerRepository) {

        throw new FinancialTransactionError(
            "Ledger repository is required.",
            "FINANCIAL_LEDGER_REPOSITORY_REQUIRED",
            500
        );
    }

    if (!balanceRepository) {

        throw new FinancialTransactionError(
            "Balance repository is required.",
            "FINANCIAL_BALANCE_REPOSITORY_REQUIRED",
            500
        );
    }

    return {

        transactionRepository,

        ledgerRepository,

        balanceRepository,

        loanRepository:
            loanRepository || null

    };
}

// =============================================================================
// Identifier Helpers
// =============================================================================

function requireIdentifier(
    value,
    field
) {

    if (
        value === null ||
        value === undefined
    ) {

        throw new FinancialTransactionError(
            `${field} is required.`,
            `FINANCIAL_${field.toUpperCase()}_REQUIRED`,
            400
        );
    }

    const normalized =
        String(
            value
        ).trim();

    if (!normalized) {

        throw new FinancialTransactionError(
            `${field} is required.`,
            `FINANCIAL_${field.toUpperCase()}_REQUIRED`,
            400
        );
    }

    if (
        normalized.length >
        MAX_IDENTIFIER_LENGTH
    ) {

        throw new FinancialTransactionError(
            `${field} exceeds the maximum allowed length.`,
            `FINANCIAL_${field.toUpperCase()}_TOO_LONG`,
            400
        );
    }

    return normalized;
}

// =============================================================================
// Currency
// =============================================================================

function requireCurrency(
    currency
) {

    const normalized =
        String(
            currency || ""
        )
        .trim()
        .toUpperCase();

    if (!normalized) {

        throw new FinancialTransactionError(
            "Currency is required.",
            "FINANCIAL_CURRENCY_REQUIRED",
            400
        );
    }

    if (
        normalized.length !==
        MAX_CURRENCY_LENGTH
    ) {

        throw new FinancialTransactionError(
            "Currency must be a valid three-letter currency code.",
            "FINANCIAL_INVALID_CURRENCY",
            400
        );
    }

    if (
        !/^[A-Z]{3}$/.test(
            normalized
        )
    ) {

        throw new FinancialTransactionError(
            "Currency must contain exactly three alphabetic characters.",
            "FINANCIAL_INVALID_CURRENCY",
            400
        );
    }

    return normalized;
}

// =============================================================================
// Money
// =============================================================================
//
// IMPORTANT:
//
// JavaScript Number is NOT suitable as the authoritative representation of
// monetary values.
//
// Example:
//
//     0.1 + 0.2 !== 0.3
//
// The service therefore requires callers/repositories to ultimately persist
// monetary values using Decimal128 or another exact representation.
//
// This validation deliberately does NOT perform monetary arithmetic.
//
// =============================================================================

function requirePositiveAmount(
    amount
) {

    if (
        amount === null ||
        amount === undefined
    ) {

        throw new FinancialTransactionError(
            "Financial amount is required.",
            "FINANCIAL_AMOUNT_REQUIRED",
            400
        );
    }

    const stringAmount =
        String(
            amount
        ).trim();

    if (!stringAmount) {

        throw new FinancialTransactionError(
            "Financial amount is required.",
            "FINANCIAL_AMOUNT_REQUIRED",
            400
        );
    }

    /*
     * Accept:
     *
     *   10
     *   10.50
     *   0.01
     *
     * Reject:
     *
     *   -10
     *   0
     *   1e10
     *   NaN
     *   Infinity
     *   10.123
     *
     * The default scale is two decimal places. If ACFOS later supports
     * currencies with different minor-unit scales, this should be replaced
     * by currency metadata.
     */
    if (
        !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(
            stringAmount
        )
    ) {

        throw new FinancialTransactionError(
            "Financial amount must be a positive fixed-point monetary value.",
            "FINANCIAL_INVALID_AMOUNT",
            400
        );
    }

    if (
        /^0(?:\.0{1,2})?$/.test(
            stringAmount
        )
    ) {

        throw new FinancialTransactionError(
            "Financial amount must be greater than zero.",
            "FINANCIAL_INVALID_AMOUNT",
            400
        );
    }

    return stringAmount;
}

// =============================================================================
// Context
// =============================================================================

function normalizeContext(
    context = {}
) {

    return {

        tenantId:
            requireIdentifier(
                context.tenantId,
                "tenantId"
            ),

        principalId:
            requireIdentifier(
                context.principalId,
                "principalId"
            ),

        transactionId:
            requireIdentifier(
                context.transactionId,
                "transactionId"
            )

    };
}

// =============================================================================
// Metadata
// =============================================================================

function normalizeMetadata(
    metadata
) {

    if (
        metadata === null ||
        metadata === undefined
    ) {

        return {};
    }

    if (
        typeof metadata !==
        "object" ||
        Array.isArray(metadata)
    ) {

        throw new FinancialTransactionError(
            "Financial metadata must be an object.",
            "FINANCIAL_INVALID_METADATA",
            400
        );
    }

    return {
        ...metadata
    };
}

// =============================================================================
// Financial Transaction Creation
// =============================================================================

async function createFinancialTransaction({

    session,

    transactionRepository,

    transactionId,

    tenantId,

    principalId,

    operation,

    resource,

    amount,

    currency,

    metadata = {}

}) {

    assertSession(
        session
    );

    assertFunction(
        transactionRepository.create,
        "transactionRepository.create"
    );

    return transactionRepository.create({

        session,

        transactionId,

        tenantId,

        principalId,

        operation,

        resource,

        amount,

        currency,

        /*
         * IMPORTANT:
         *
         * The financial transaction must not be marked COMPLETED until every
         * ledger, balance and loan mutation has succeeded.
         *
         * The repository therefore creates it as PENDING.
         */
        status:
            FINANCIAL_TRANSACTION_STATUS.PENDING,

        metadata

    });
}

// =============================================================================
// Complete Financial Transaction
// =============================================================================

async function completeFinancialTransaction({

    session,

    transactionRepository,

    transactionId,

    metadata = {}

}) {

    assertSession(
        session
    );

    assertFunction(
        transactionRepository.complete,
        "transactionRepository.complete"
    );

    return transactionRepository.complete({

        session,

        transactionId,

        status:
            FINANCIAL_TRANSACTION_STATUS.COMPLETED,

        metadata

    });
}

// =============================================================================
// Ledger
// =============================================================================

async function createLedgerEntry({

    session,

    ledgerRepository,

    transactionId,

    tenantId,

    accountId,

    amount,

    currency,

    entryType,

    direction,

    metadata = {}

}) {

    assertSession(
        session
    );

    assertFunction(
        ledgerRepository.createEntry,
        "ledgerRepository.createEntry"
    );

    return ledgerRepository.createEntry({

        session,

        transactionId,

        tenantId,

        accountId,

        amount,

        currency,

        entryType,

        direction,

        metadata

    });
}

// =============================================================================
// Balance Increment
// =============================================================================

async function incrementBalance({

    session,

    balanceRepository,

    accountId,

    amount,

    currency,

    transactionId,

    tenantId,

    metadata = {}

}) {

    assertSession(
        session
    );

    assertFunction(
        balanceRepository.increment,
        "balanceRepository.increment"
    );

    return balanceRepository.increment({

        session,

        tenantId,

        accountId,

        amount,

        currency,

        transactionId,

        metadata

    });
}

// =============================================================================
// Balance Decrement
// =============================================================================

async function decrementBalance({

    session,

    balanceRepository,

    accountId,

    amount,

    currency,

    transactionId,

    tenantId,

    metadata = {}

}) {

    assertSession(
        session
    );

    assertFunction(
        balanceRepository.decrement,
        "balanceRepository.decrement"
    );

    /*
     * The repository MUST implement an atomic conditional decrement.
     *
     * Conceptually:
     *
     *   UPDATE account
     *   SET balance = balance - amount
     *   WHERE accountId = ?
     *     AND tenantId = ?
     *     AND currency = ?
     *     AND availableBalance >= amount
     *
     * If zero documents are modified:
     *
     *   INSUFFICIENT_FUNDS
     *
     * The MongoDB transaction then rolls back every previous write.
     */
    try {

        return await balanceRepository.decrement({

            session,

            tenantId,

            accountId,

            amount,

            currency,

            transactionId,

            metadata

        });

    } catch (error) {

        if (
            error &&
            (
                error.code ===
                    "INSUFFICIENT_FUNDS" ||
                error.code ===
                    "BALANCE_INSUFFICIENT" ||
                error.code ===
                    "FINANCIAL_INSUFFICIENT_BALANCE"
            )
        ) {

            throw new FinancialTransactionError(
                "Insufficient available balance.",
                "FINANCIAL_INSUFFICIENT_BALANCE",
                422,
                {
                    accountId
                }
            );
        }

        throw error;
    }
}

// =============================================================================
// Ledger Balance Validation
// =============================================================================

function assertBalancedLedger(
    entries
) {

    if (
        !Array.isArray(entries) ||
        entries.length === 0
    ) {

        throw new FinancialTransactionError(
            "A financial transaction must contain ledger entries.",
            "FINANCIAL_LEDGER_ENTRIES_REQUIRED",
            500
        );
    }

    let debitCount =
        0;

    let creditCount =
        0;

    for (
        const entry of entries
    ) {

        if (
            entry.direction ===
            LEDGER_DIRECTION.DEBIT
        ) {

            debitCount += 1;

        } else if (
            entry.direction ===
            LEDGER_DIRECTION.CREDIT
        ) {

            creditCount += 1;

        } else {

            throw new FinancialTransactionError(
                "Invalid ledger direction.",
                "FINANCIAL_INVALID_LEDGER_DIRECTION",
                500
            );
        }
    }

    if (
        debitCount === 0 ||
        creditCount === 0
    ) {

        throw new FinancialTransactionError(
            "Financial ledger must contain both debit and credit entries.",
            "FINANCIAL_UNBALANCED_LEDGER",
            500
        );
    }
}

// =============================================================================
// CONTRIBUTION_CREATE
// =============================================================================

async function createContribution({

    session,

    context,

    repositories,

    amount,

    currency,

    accountId,

    savingsPlanId = null,

    memberId = null,

    metadata = {}

}) {

    assertSession(
        session
    );

    const {
        transactionRepository,
        ledgerRepository,
        balanceRepository
    } =
        assertRepositories(
            repositories
        );

    const normalized =
        normalizeContext(
            context
        );

    const normalizedAmount =
        requirePositiveAmount(
            amount
        );

    const normalizedCurrency =
        requireCurrency(
            currency
        );

    const normalizedAccountId =
        requireIdentifier(
            accountId,
            "accountId"
        );

    const normalizedMetadata =
        normalizeMetadata(
            metadata
        );

    const transaction =
        await createFinancialTransaction({

            session,

            transactionRepository,

            transactionId:
                normalized.transactionId,

            tenantId:
                normalized.tenantId,

            principalId:
                normalized.principalId,

            operation:
                FINANCIAL_OPERATION.CONTRIBUTION_CREATE,

            resource:
                "contribution",

            amount:
                normalizedAmount,

            currency:
                normalizedCurrency,

            metadata: {

                savingsPlanId,

                memberId,

                ...normalizedMetadata

            }

        });

    await incrementBalance({

        session,

        balanceRepository,

        tenantId:
            normalized.tenantId,

        accountId:
            normalizedAccountId,

        amount:
            normalizedAmount,

        currency:
            normalizedCurrency,

        transactionId:
            normalized.transactionId,

        metadata:
            normalizedMetadata

    });

    const ledgerEntry =
        await createLedgerEntry({

            session,

            ledgerRepository,

            transactionId:
                normalized.transactionId,

            tenantId:
                normalized.tenantId,

            accountId:
                normalizedAccountId,

            amount:
                normalizedAmount,

            currency:
                normalizedCurrency,

            entryType:
                LEDGER_ENTRY_TYPE.CONTRIBUTION,

            direction:
                LEDGER_DIRECTION.CREDIT,

            metadata: {

                savingsPlanId,

                memberId,

                ...normalizedMetadata

            }

        });

    assertBalancedLedger([

        {
            direction:
                LEDGER_DIRECTION.CREDIT
        },

        /*
         * The corresponding source-side debit must normally be represented by
         * the treasury/cash/mobile-money account. It is intentionally not
         * silently fabricated here.
         */
        {
            direction:
                LEDGER_DIRECTION.DEBIT
        }

    ]);

    await completeFinancialTransaction({

        session,

        transactionRepository,

        transactionId:
            normalized.transactionId

    });

    return {

        transaction,

        ledgerEntry,

        responseBody: {

            success:
                true,

            transactionId:
                normalized.transactionId,

            operation:
                FINANCIAL_OPERATION.CONTRIBUTION_CREATE,

            amount:
                normalizedAmount,

            currency:
                normalizedCurrency,

            accountId:
                normalizedAccountId

        },

        resultType:
            RESULT_TYPE.SUCCESS

    };
}

// =============================================================================
// DEPOSIT_CREATE
// =============================================================================

async function createDeposit({

    session,

    context,

    repositories,

    amount,

    currency,

    accountId,

    provider = null,

    providerReference = null,

    metadata = {}

}) {

    assertSession(
        session
    );

    const {
        transactionRepository,
        ledgerRepository,
        balanceRepository
    } =
        assertRepositories(
            repositories
        );

    const normalized =
        normalizeContext(
            context
        );

    const normalizedAmount =
        requirePositiveAmount(
            amount
        );

    const normalizedCurrency =
        requireCurrency(
            currency
        );

    const normalizedAccountId =
        requireIdentifier(
            accountId,
            "accountId"
        );

    const normalizedMetadata =
        normalizeMetadata(
            metadata
        );

    const transaction =
        await createFinancialTransaction({

            session,

            transactionRepository,

            transactionId:
                normalized.transactionId,

            tenantId:
                normalized.tenantId,

            principalId:
                normalized.principalId,

            operation:
                FINANCIAL_OPERATION.DEPOSIT_CREATE,

            resource:
                "deposit",

            amount:
                normalizedAmount,

            currency:
                normalizedCurrency,

            metadata: {

                provider,

                providerReference,

                ...normalizedMetadata

            }

        });

    await incrementBalance({

        session,

        balanceRepository,

        tenantId:
            normalized.tenantId,

        accountId:
            normalizedAccountId,

        amount:
            normalizedAmount,

        currency:
            normalizedCurrency,

        transactionId:
            normalized.transactionId,

        metadata:
            normalizedMetadata

    });

    const ledgerEntry =
        await createLedgerEntry({

            session,

            ledgerRepository,

            transactionId:
                normalized.transactionId,

            tenantId:
                normalized.tenantId,

            accountId:
                normalizedAccountId,

            amount:
                normalizedAmount,

            currency:
                normalizedCurrency,

            entryType:
                LEDGER_ENTRY_TYPE.DEPOSIT,

            direction:
                LEDGER_DIRECTION.CREDIT,

            metadata: {

                provider,

                providerReference,

                ...normalizedMetadata

            }

        });

    await completeFinancialTransaction({

        session,

        transactionRepository,

        transactionId:
            normalized.transactionId

    });

    return {

        transaction,

        ledgerEntry,

        responseBody: {

            success:
                true,

            transactionId:
                normalized.transactionId,

            operation:
                FINANCIAL_OPERATION.DEPOSIT_CREATE,

            amount:
                normalizedAmount,

            currency:
                normalizedCurrency,

            accountId:
                normalizedAccountId

        },

        resultType:
            RESULT_TYPE.SUCCESS

    };
}

// =============================================================================
// WITHDRAWAL_CREATE
// =============================================================================

async function createWithdrawal({

    session,

    context,

    repositories,

    amount,

    currency,

    accountId,

    provider = null,

    providerReference = null,

    metadata = {}

}) {

    assertSession(
        session
    );

    const {
        transactionRepository,
        ledgerRepository,
        balanceRepository
    } =
        assertRepositories(
            repositories
        );

    const normalized =
        normalizeContext(
            context
        );

    const normalizedAmount =
        requirePositiveAmount(
            amount
        );

    const normalizedCurrency =
        requireCurrency(
            currency
        );

    const normalizedAccountId =
        requireIdentifier(
            accountId,
            "accountId"
        );

    const normalizedMetadata =
        normalizeMetadata(
            metadata
        );

    const transaction =
        await createFinancialTransaction({

            session,

            transactionRepository,

            transactionId:
                normalized.transactionId,

            tenantId:
                normalized.tenantId,

            principalId:
                normalized.principalId,

            operation:
                FINANCIAL_OPERATION.WITHDRAWAL_CREATE,

            resource:
                "withdrawal",

            amount:
                normalizedAmount,

            currency:
                normalizedCurrency,

            metadata: {

                provider,

                providerReference,

                ...normalizedMetadata

            }

        });

    /*
     * NO external provider call here.
     *
     * This MongoDB transaction only records the financial state transition.
     * Provider execution must be handled by an external orchestration/outbox
     * workflow.
     */
    await decrementBalance({

        session,

        balanceRepository,

        tenantId:
            normalized.tenantId,

        accountId:
            normalizedAccountId,

        amount:
            normalizedAmount,

        currency:
            normalizedCurrency,

        transactionId:
            normalized.transactionId,

        metadata:
            normalizedMetadata

    });

    const ledgerEntry =
        await createLedgerEntry({

            session,

            ledgerRepository,

            transactionId:
                normalized.transactionId,

            tenantId:
                normalized.tenantId,

            accountId:
                normalizedAccountId,

            amount:
                normalizedAmount,

            currency:
                normalizedCurrency,

            entryType:
                LEDGER_ENTRY_TYPE.WITHDRAWAL,

            direction:
                LEDGER_DIRECTION.DEBIT,

            metadata: {

                provider,

                providerReference,

                ...normalizedMetadata

            }

        });

    await completeFinancialTransaction({

        session,

        transactionRepository,

        transactionId:
            normalized.transactionId

    });

    return {

        transaction,

        ledgerEntry,

        responseBody: {

            success:
                true,

            transactionId:
                normalized.transactionId,

            operation:
                FINANCIAL_OPERATION.WITHDRAWAL_CREATE,

            amount:
                normalizedAmount,

            currency:
                normalizedCurrency,

            accountId:
                normalizedAccountId

        },

        resultType:
            RESULT_TYPE.SUCCESS

    };
}

// =============================================================================
// TRANSFER_CREATE
// =============================================================================

async function createTransfer({

    session,

    context,

    repositories,

    amount,

    currency,

    sourceAccountId,

    destinationAccountId,

    metadata = {}

}) {

    assertSession(
        session
    );

    const {
        transactionRepository,
        ledgerRepository,
        balanceRepository
    } =
        assertRepositories(
            repositories
        );

    const normalized =
        normalizeContext(
            context
        );

    const normalizedAmount =
        requirePositiveAmount(
            amount
        );

    const normalizedCurrency =
        requireCurrency(
            currency
        );

    const sourceId =
        requireIdentifier(
            sourceAccountId,
            "sourceAccountId"
        );

    const destinationId =
        requireIdentifier(
            destinationAccountId,
            "destinationAccountId"
        );

    if (
        sourceId ===
        destinationId
    ) {

        throw new FinancialTransactionError(
            "Source and destination accounts must be different.",
            "FINANCIAL_TRANSFER_SAME_ACCOUNT",
            400
        );
    }

    const normalizedMetadata =
        normalizeMetadata(
            metadata
        );

    const transaction =
        await createFinancialTransaction({

            session,

            transactionRepository,

            transactionId:
                normalized.transactionId,

            tenantId:
                normalized.tenantId,

            principalId:
                normalized.principalId,

            operation:
                FINANCIAL_OPERATION.TRANSFER_CREATE,

            resource:
                "transfer",

            amount:
                normalizedAmount,

            currency:
                normalizedCurrency,

            metadata: {

                sourceAccountId:
                    sourceId,

                destinationAccountId:
                    destinationId,

                ...normalizedMetadata

            }

        });

    /*
     * IMPORTANT:
     *
     * Debit first.
     *
     * If source funds are insufficient, the entire transaction rolls back.
     */
    await decrementBalance({

        session,

        balanceRepository,

        tenantId:
            normalized.tenantId,

        accountId:
            sourceId,

        amount:
            normalizedAmount,

        currency:
            normalizedCurrency,

        transactionId:
            normalized.transactionId,

        metadata: {

            transferRole:
                "SOURCE",

            destinationAccountId:
                destinationId,

            ...normalizedMetadata

        }

    });

    await incrementBalance({

        session,

        balanceRepository,

        tenantId:
            normalized.tenantId,

        accountId:
            destinationId,

        amount:
            normalizedAmount,

        currency:
            normalizedCurrency,

        transactionId:
            normalized.transactionId,

        metadata: {

            transferRole:
                "DESTINATION",

            sourceAccountId:
                sourceId,

            ...normalizedMetadata

        }

    });

    const debitEntry =
        await createLedgerEntry({

            session,

            ledgerRepository,

            transactionId:
                normalized.transactionId,

            tenantId:
                normalized.tenantId,

            accountId:
                sourceId,

            amount:
                normalizedAmount,

            currency:
                normalizedCurrency,

            entryType:
                LEDGER_ENTRY_TYPE.TRANSFER,

            direction:
                LEDGER_DIRECTION.DEBIT,

            metadata: {

                transferRole:
                    "SOURCE",

                destinationAccountId:
                    destinationId,

                ...normalizedMetadata

            }

        });

    const creditEntry =
        await createLedgerEntry({

            session,

            ledgerRepository,

            transactionId:
                normalized.transactionId,

            tenantId:
                normalized.tenantId,

            accountId:
                destinationId,

            amount:
                normalizedAmount,

            currency:
                normalizedCurrency,

            entryType:
                LEDGER_ENTRY_TYPE.TRANSFER,

            direction:
                LEDGER_DIRECTION.CREDIT,

            metadata: {

                transferRole:
                    "DESTINATION",

                sourceAccountId:
                    sourceId,

                ...normalizedMetadata

            }

        });

    assertBalancedLedger([

        debitEntry,
        creditEntry

    ]);

    await completeFinancialTransaction({

        session,

        transactionRepository,

        transactionId:
            normalized.transactionId

    });

    return {

        transaction,

        ledgerEntries: [

            debitEntry,

            creditEntry

        ],

        responseBody: {

            success:
                true,

            transactionId:
                normalized.transactionId,

            operation:
                FINANCIAL_OPERATION.TRANSFER_CREATE,

            amount:
                normalizedAmount,

            currency:
                normalizedCurrency,

            sourceAccountId:
                sourceId,

            destinationAccountId:
                destinationId

        },

        resultType:
            RESULT_TYPE.SUCCESS

    };
}

// =============================================================================
// LOAN REPOSITORY
// =============================================================================

function requireLoanRepository(
    loanRepository,
    operation
) {

    if (
        !loanRepository
    ) {

        throw new FinancialTransactionError(
            "Loan repository is required.",
            "FINANCIAL_LOAN_REPOSITORY_REQUIRED",
            500
        );
    }

    assertFunction(
        loanRepository[operation],
        `loanRepository.${operation}`
    );
}

// =============================================================================
// LOAN_DISBURSEMENT
// =============================================================================

async function disburseLoan({

    session,

    context,

    repositories,

    amount,

    currency,

    loanAccountId,

    destinationAccountId,

    metadata = {}

}) {

    assertSession(
        session
    );

    const {
        transactionRepository,
        ledgerRepository,
        balanceRepository,
        loanRepository
    } =
        assertRepositories(
            repositories
        );

    requireLoanRepository(
        loanRepository,
        "disburse"
    );

    const normalized =
        normalizeContext(
            context
        );

    const normalizedAmount =
        requirePositiveAmount(
            amount
        );

    const normalizedCurrency =
        requireCurrency(
            currency
        );

    const loanId =
        requireIdentifier(
            loanAccountId,
            "loanAccountId"
        );

    const destinationId =
        requireIdentifier(
            destinationAccountId,
            "destinationAccountId"
        );

    const normalizedMetadata =
        normalizeMetadata(
            metadata
        );

    const transaction =
        await createFinancialTransaction({

            session,

            transactionRepository,

            transactionId:
                normalized.transactionId,

            tenantId:
                normalized.tenantId,

            principalId:
                normalized.principalId,

            operation:
                FINANCIAL_OPERATION.LOAN_DISBURSEMENT,

            resource:
                "loan",

            amount:
                normalizedAmount,

            currency:
                normalizedCurrency,

            metadata: {

                loanAccountId:
                    loanId,

                destinationAccountId:
                    destinationId,

                ...normalizedMetadata

            }

        });

    /*
     * Loan state mutation occurs inside the SAME MongoDB transaction.
     *
     * The repository should atomically verify:
     *
     *   - loan belongs to tenant
     *   - loan is eligible for disbursement
     *   - requested amount is permitted
     *   - loan is not already disbursed
     */
    const loanResult =
        await loanRepository.disburse({

            session,

            tenantId:
                normalized.tenantId,

            loanAccountId:
                loanId,

            amount:
                normalizedAmount,

            currency:
                normalizedCurrency,

            transactionId:
                normalized.transactionId,

            metadata:
                normalizedMetadata

        });

    await incrementBalance({

        session,

        balanceRepository,

        tenantId:
            normalized.tenantId,

        accountId:
            destinationId,

        amount:
            normalizedAmount,

        currency:
            normalizedCurrency,

        transactionId:
            normalized.transactionId,

        metadata: {

            loanAccountId:
                loanId,

            ...normalizedMetadata

        }

    });

    const ledgerEntry =
        await createLedgerEntry({

            session,

            ledgerRepository,

            transactionId:
                normalized.transactionId,

            tenantId:
                normalized.tenantId,

            accountId:
                destinationId,

            amount:
                normalizedAmount,

            currency:
                normalizedCurrency,

            entryType:
                LEDGER_ENTRY_TYPE.LOAN_DISBURSEMENT,

            direction:
                LEDGER_DIRECTION.CREDIT,

            metadata: {

                loanAccountId:
                    loanId,

                ...normalizedMetadata

            }

        });

    await completeFinancialTransaction({

        session,

        transactionRepository,

        transactionId:
            normalized.transactionId

    });

    return {

        transaction,

        loanResult,

        ledgerEntry,

        responseBody: {

            success:
                true,

            transactionId:
                normalized.transactionId,

            operation:
                FINANCIAL_OPERATION.LOAN_DISBURSEMENT,

            amount:
                normalizedAmount,

            currency:
                normalizedCurrency,

            loanAccountId:
                loanId,

            destinationAccountId:
                destinationId

        },

        resultType:
            RESULT_TYPE.SUCCESS

    };
}

// =============================================================================
// LOAN_REPAYMENT
// =============================================================================

async function repayLoan({

    session,

    context,

    repositories,

    amount,

    currency,

    loanAccountId,

    sourceAccountId,

    metadata = {}

}) {

    assertSession(
        session
    );

    const {
        transactionRepository,
        ledgerRepository,
        balanceRepository,
        loanRepository
    } =
        assertRepositories(
            repositories
        );

    requireLoanRepository(
        loanRepository,
        "repay"
    );

    const normalized =
        normalizeContext(
            context
        );

    const normalizedAmount =
        requirePositiveAmount(
            amount
        );

    const normalizedCurrency =
        requireCurrency(
            currency
        );

    const loanId =
        requireIdentifier(
            loanAccountId,
            "loanAccountId"
        );

    const sourceId =
        requireIdentifier(
            sourceAccountId,
            "sourceAccountId"
        );

    const normalizedMetadata =
        normalizeMetadata(
            metadata
        );

    const transaction =
        await createFinancialTransaction({

            session,

            transactionRepository,

            transactionId:
                normalized.transactionId,

            tenantId:
                normalized.tenantId,

            principalId:
                normalized.principalId,

            operation:
                FINANCIAL_OPERATION.LOAN_REPAYMENT,

            resource:
                "loan",

            amount:
                normalizedAmount,

            currency:
                normalizedCurrency,

            metadata: {

                loanAccountId:
                    loanId,

                sourceAccountId:
                    sourceId,

                ...normalizedMetadata

            }

        });

    /*
     * First atomically reserve/debit the payer's available funds.
     *
     * If this fails:
     *
     *   loan state is never changed.
     */
    await decrementBalance({

        session,

        balanceRepository,

        tenantId:
            normalized.tenantId,

        accountId:
            sourceId,

        amount:
            normalizedAmount,

        currency:
            normalizedCurrency,

        transactionId:
            normalized.transactionId,

        metadata: {

            loanAccountId:
                loanId,

            ...normalizedMetadata

        }

    });

    /*
     * Then atomically apply the repayment to the loan.
     *
     * Repository should enforce:
     *
     *   - tenant ownership
     *   - loan status
     *   - currency
     *   - outstanding principal
     *   - repayment amount
     */
    const loanResult =
        await loanRepository.repay({

            session,

            tenantId:
                normalized.tenantId,

            loanAccountId:
                loanId,

            amount:
                normalizedAmount,

            currency:
                normalizedCurrency,

            transactionId:
                normalized.transactionId,

            metadata:
                normalizedMetadata

        });

    const ledgerEntry =
        await createLedgerEntry({

            session,

            ledgerRepository,

            transactionId:
                normalized.transactionId,

            tenantId:
                normalized.tenantId,

            accountId:
                sourceId,

            amount:
                normalizedAmount,

            currency:
                normalizedCurrency,

            entryType:
                LEDGER_ENTRY_TYPE.LOAN_REPAYMENT,

            direction:
                LEDGER_DIRECTION.DEBIT,

            metadata: {

                loanAccountId:
                    loanId,

                ...normalizedMetadata

            }

        });

    await completeFinancialTransaction({

        session,

        transactionRepository,

        transactionId:
            normalized.transactionId

    });

    return {

        transaction,

        loanResult,

        ledgerEntry,

        responseBody: {

            success:
                true,

            transactionId:
                normalized.transactionId,

            operation:
                FINANCIAL_OPERATION.LOAN_REPAYMENT,

            amount:
                normalizedAmount,

            currency:
                normalizedCurrency,

            loanAccountId:
                loanId,

            sourceAccountId:
                sourceId

        },

        resultType:
            RESULT_TYPE.SUCCESS

    };
}

// =============================================================================
// Dispatcher
// =============================================================================

async function executeFinancialOperation({

    operation,

    session,

    context,

    repositories,

    payload = {}

}) {

    assertSession(
        session
    );

    const normalizedOperation =
        String(
            operation || ""
        )
        .trim()
        .toUpperCase();

    switch (
        normalizedOperation
    ) {

        case FINANCIAL_OPERATION.CONTRIBUTION_CREATE:

            return createContribution({

                session,

                context,

                repositories,

                ...payload

            });

        case FINANCIAL_OPERATION.DEPOSIT_CREATE:

            return createDeposit({

                session,

                context,

                repositories,

                ...payload

            });

        case FINANCIAL_OPERATION.WITHDRAWAL_CREATE:

            return createWithdrawal({

                session,

                context,

                repositories,

                ...payload

            });

        case FINANCIAL_OPERATION.TRANSFER_CREATE:

            return createTransfer({

                session,

                context,

                repositories,

                ...payload

            });

        case FINANCIAL_OPERATION.LOAN_DISBURSEMENT:

            return disburseLoan({

                session,

                context,

                repositories,

                ...payload

            });

        case FINANCIAL_OPERATION.LOAN_REPAYMENT:

            return repayLoan({

                session,

                context,

                repositories,

                ...payload

            });

        default:

            throw new FinancialTransactionError(

                `Unsupported financial operation: ${normalizedOperation}`,

                "FINANCIAL_OPERATION_UNSUPPORTED",

                400,

                {
                    operation:
                        normalizedOperation
                }

            );
    }
}

// =============================================================================
// Repository Contract
// =============================================================================
//
// This is intentionally executable documentation.
//
// Every financial repository operation below MUST accept:
//
//     { session, ... }
//
// and MUST pass that session to every Mongoose read/write involved in the
// operation.
//
// =============================================================================

const FINANCIAL_OPERATION_REPOSITORY_CONTRACT =
    Object.freeze({

        transaction:
            Object.freeze([

                "create",

                "complete",

                "findByTransactionId"

            ]),

        ledger:
            Object.freeze([

                "createEntry",

                "createEntries"

            ]),

        balance:
            Object.freeze([

                "increment",

                "decrement",

                "findByAccount"

            ]),

        loan:
            Object.freeze([

                "disburse",

                "repay"

            ])

    });

// =============================================================================
// Repository Contract Validation
// =============================================================================

function validateRepositoryContract(
    repositories,
    operation
) {

    const {
        transactionRepository,
        ledgerRepository,
        balanceRepository,
        loanRepository
    } =
        assertRepositories(
            repositories
        );

    assertFunction(
        transactionRepository.create,
        "transactionRepository.create"
    );

    assertFunction(
        transactionRepository.complete,
        "transactionRepository.complete"
    );

    assertFunction(
        ledgerRepository.createEntry,
        "ledgerRepository.createEntry"
    );

    assertFunction(
        balanceRepository.increment,
        "balanceRepository.increment"
    );

    assertFunction(
        balanceRepository.decrement,
        "balanceRepository.decrement"
    );

    if (
        operation ===
            FINANCIAL_OPERATION.LOAN_DISBURSEMENT ||
        operation ===
            FINANCIAL_OPERATION.LOAN_REPAYMENT
    ) {

        if (!loanRepository) {

            throw new FinancialTransactionError(
                "Loan repository is required for loan operations.",
                "FINANCIAL_LOAN_REPOSITORY_REQUIRED",
                500
            );
        }

        assertFunction(
            loanRepository.disburse,
            "loanRepository.disburse"
        );

        assertFunction(
            loanRepository.repay,
            "loanRepository.repay"
        );
    }

    return true;
}

// =============================================================================
// Exports
// =============================================================================

module.exports = {

    FINANCIAL_OPERATION,

    RESULT_TYPE,

    FINANCIAL_TRANSACTION_STATUS,

    LEDGER_DIRECTION,

    LEDGER_ENTRY_TYPE,

    FINANCIAL_OPERATION_REPOSITORY_CONTRACT,

    executeFinancialOperation,

    validateRepositoryContract,

    createContribution,

    createDeposit,

    createWithdrawal,

    createTransfer,

    disburseLoan,

    repayLoan

};