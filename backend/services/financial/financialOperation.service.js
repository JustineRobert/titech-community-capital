"use strict";

import { createHash } from 'node:crypto';
import { FinancialTransactionError } from './financialTransaction.service.js';
import { add, assertDecimal, isPositive } from './money.js';

/**
 * =============================================================================
 * TITech Community Capital LTD
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
            "LOAN_REPAYMENT",

        TRANSACTION_CREATE:
            "TRANSACTION_CREATE"

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
        loanRepository,
        outboxRepository
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
            loanRepository || null,

        outboxRepository:
            outboxRepository || null

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
// Counterparty Account
// =============================================================================

function requireCounterpartyAccountId(
    value,
    metadata = {}
) {
    return requireIdentifier(
        value || metadata?.counterpartyAccountId,
        "counterpartyAccountId"
    );
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

function sumExactDecimals(values = []) {
    return values.reduce(
        (total, value) => add(total, value),
        '0'
    );
}

function requirePositiveAmount(
    amount
) {

    let normalizedAmount;

    try {
        normalizedAmount =
            assertDecimal(
                amount,
                "amount"
            );
    } catch (error) {
        throw new FinancialTransactionError(
            "Financial amount must be supplied as a non-negative fixed-point decimal string.",
            "FINANCIAL_INVALID_AMOUNT",
            400,
            undefined,
            error
        );
    }

    const fractionDigits =
        (normalizedAmount.split(".")[1] || "").length;

    if (fractionDigits > 2) {
        throw new FinancialTransactionError(
            "Financial amount supports at most two decimal places.",
            "FINANCIAL_INVALID_AMOUNT",
            400
        );
    }

    if (!isPositive(normalizedAmount)) {
        throw new FinancialTransactionError(
            "Financial amount must be greater than zero.",
            "FINANCIAL_INVALID_AMOUNT",
            400
        );
    }

    return normalizedAmount;
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
            ),

        correlationId:
            context.correlationId
                ? requireIdentifier(
                    context.correlationId,
                    "correlationId"
                )
                : null,

        idempotencyKey:
            context.idempotencyKey
                ? requireIdentifier(
                    context.idempotencyKey,
                    "idempotencyKey"
                )
                : null

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

    outboxRepository = null,

    transactionId,

    tenantId,

    principalId,

    operation,

    resource,

    correlationId = null,

    idempotencyKey = null,

    metadata = {}

}) {

    assertSession(
        session
    );

    assertFunction(
        transactionRepository.complete,
        "transactionRepository.complete"
    );

    if (outboxRepository) {
        assertFunction(
            outboxRepository.create,
            "outboxRepository.create"
        );

        const eventId =
            `financial-transaction:${transactionId}:completed:v1`;

        await outboxRepository.create(
            {
                tenantId,
                eventId,
                eventKey: eventId,
                eventType: 'financial.transaction.completed',
                eventVersion: '1',
                schemaVersion: '1',
                category: 'financial',
                fingerprint:
                    createHash('sha256')
                        .update(
                            `${tenantId}:${transactionId}:${operation}:completed:v1`
                        )
                        .digest('hex'),
                transactionId,
                correlationId,
                idempotencyKey,
                userId: principalId,
                operation,
                source: 'financial-operation-service',
                aggregate: {
                    type: 'FinancialTransaction',
                    id: transactionId,
                    version: 1,
                },
                payload: {
                    transactionId,
                    tenantId,
                    operation,
                    resource,
                    status: FINANCIAL_TRANSACTION_STATUS.COMPLETED,
                },
                metadata,
            },
            { session },
        );
    }

    return transactionRepository.complete({

        session,

        transactionId,

        tenantId,

        status:
            FINANCIAL_TRANSACTION_STATUS.COMPLETED,

        metadata

    });
}

// =============================================================================
// Ledger
// =============================================================================

async function createLedgerEntries({

    session,

    ledgerRepository,

    transactionId,

    tenantId,

    currency,

    entries

}) {

    assertSession(
        session
    );

    assertFunction(
        ledgerRepository.createEntries,
        "ledgerRepository.createEntries"
    );

    if (!Array.isArray(entries) || entries.length < 2) {
        throw new FinancialTransactionError(
            "Canonical financial posting requires a balanced ledger batch of at least two entries.",
            "FINANCIAL_LEDGER_DOUBLE_ENTRY_REQUIRED",
            500
        );
    }

    return ledgerRepository.createEntries({
        session,
        entries: entries.map((entry, index) => ({
            ...entry,
            transactionId,
            tenantId,
            currency,
            lineNumber: index + 1,
        })),
        validateBalance: true,
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

// =============================================================================
// TRANSACTION_CREATE
// =============================================================================

async function createGenericTransaction({

    session,

    context,

    repositories,

    amount,

    currency,

    entries,

    metadata = {},

}) {
    assertSession(session);

    const {
        transactionRepository,
        ledgerRepository,
        balanceRepository,
    } = assertRepositories(repositories);

    const normalized = normalizeContext(context);
    const normalizedAmount = requirePositiveAmount(amount);
    const normalizedCurrency = requireCurrency(currency);
    const normalizedMetadata = normalizeMetadata(metadata);

    if (!Array.isArray(entries) || entries.length < 2) {
        throw new FinancialTransactionError(
            'A generic financial transaction requires at least two posting lines.',
            'FINANCIAL_TRANSACTION_ENTRIES_REQUIRED',
            400
        );
    }

    const normalizedEntries = entries.map((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            throw new FinancialTransactionError(
                `Financial posting entry ${index + 1} is invalid.`,
                'FINANCIAL_TRANSACTION_ENTRY_INVALID',
                400
            );
        }

        const accountId = requireIdentifier(entry.accountId, `entries[${index}].accountId`);
        const lineAmount = requirePositiveAmount(entry.amount);
        const direction = String(entry.direction || '').trim().toUpperCase();
        const balanceEffect = String(entry.balanceEffect || '').trim().toUpperCase();

        if (!Object.values(LEDGER_DIRECTION).includes(direction)) {
            throw new FinancialTransactionError(
                `entries[${index}].direction must be DEBIT or CREDIT.`,
                'FINANCIAL_TRANSACTION_DIRECTION_INVALID',
                400
            );
        }

        if (!['INCREASE', 'DECREASE'].includes(balanceEffect)) {
            throw new FinancialTransactionError(
                `entries[${index}].balanceEffect must be INCREASE or DECREASE.`,
                'FINANCIAL_TRANSACTION_BALANCE_EFFECT_INVALID',
                400
            );
        }

        if (entry.currency && requireCurrency(entry.currency) !== normalizedCurrency) {
            throw new FinancialTransactionError(
                'All financial posting entries must use the transaction currency.',
                'FINANCIAL_CURRENCY_MISMATCH',
                400
            );
        }

        return {
            ...entry,
            accountId,
            amount: lineAmount,
            direction,
            balanceEffect,
            currency: normalizedCurrency,
            entryType: String(entry.entryType || 'GENERAL').trim().toUpperCase(),
            metadata: {
                ...normalizedMetadata,
                ...normalizeMetadata(entry.metadata),
            },
        };
    });

    const totalDebits = sumExactDecimals(
        normalizedEntries.filter((entry) => entry.direction === LEDGER_DIRECTION.DEBIT).map((entry) => entry.amount)
    );
    const totalCredits = sumExactDecimals(
        normalizedEntries.filter((entry) => entry.direction === LEDGER_DIRECTION.CREDIT).map((entry) => entry.amount)
    );

    if (totalDebits !== totalCredits || totalDebits !== normalizedAmount) {
        throw new FinancialTransactionError(
            'Financial transaction postings must balance exactly to the declared transaction amount.',
            'FINANCIAL_LEDGER_UNBALANCED',
            400,
            { totalDebits, totalCredits, declaredAmount: normalizedAmount }
        );
    }

    const transaction = await createFinancialTransaction({
        session,
        transactionRepository,
        transactionId: normalized.transactionId,
        tenantId: normalized.tenantId,
        principalId: normalized.principalId,
        operation: FINANCIAL_OPERATION.TRANSACTION_CREATE,
        resource: 'financial-transaction',
        amount: normalizedAmount,
        currency: normalizedCurrency,
        metadata: normalizedMetadata,
    });

    for (const entry of normalizedEntries) {
        if (entry.balanceEffect === 'INCREASE') {
            await incrementBalance({
                session,
                balanceRepository,
                tenantId: normalized.tenantId,
                accountId: entry.accountId,
                amount: entry.amount,
                currency: normalizedCurrency,
                transactionId: normalized.transactionId,
                metadata: entry.metadata,
            });
        } else {
            await decrementBalance({
                session,
                balanceRepository,
                tenantId: normalized.tenantId,
                accountId: entry.accountId,
                amount: entry.amount,
                currency: normalizedCurrency,
                transactionId: normalized.transactionId,
                metadata: entry.metadata,
            });
        }
    }

    const ledgerEntries = await createLedgerEntries({
        session,
        ledgerRepository,
        transactionId: normalized.transactionId,
        tenantId: normalized.tenantId,
        currency: normalizedCurrency,
        entries: normalizedEntries,
    });

    await completeFinancialTransaction({
        session,
        transactionRepository,
        outboxRepository: repositories.outboxRepository,
        transactionId: normalized.transactionId,
        tenantId: normalized.tenantId,
        principalId: normalized.principalId,
        operation: FINANCIAL_OPERATION.TRANSACTION_CREATE,
        resource: 'financial-transaction',
        correlationId: normalized.correlationId,
        idempotencyKey: normalized.idempotencyKey,
        metadata: normalizedMetadata,
    });

    return {
        transaction,
        ledgerEntries,
        responseBody: {
            success: true,
            transactionId: normalized.transactionId,
            operation: FINANCIAL_OPERATION.TRANSACTION_CREATE,
            amount: normalizedAmount,
            currency: normalizedCurrency,
            ledgerEntries,
        },
        resultType: RESULT_TYPE.SUCCESS,
    };
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

    sourceAccountId = null,

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

    const normalizedSourceAccountId =
        requireCounterpartyAccountId(
            sourceAccountId,
            normalizedMetadata
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

    const ledgerEntries =
        await createLedgerEntries({

            session,
            ledgerRepository,
            transactionId:
                normalized.transactionId,
            tenantId:
                normalized.tenantId,
            currency:
                normalizedCurrency,
            entries: [
                {
                    accountId:
                        normalizedSourceAccountId,
                    amount:
                        normalizedAmount,
                    entryType:
                        LEDGER_ENTRY_TYPE.CONTRIBUTION,
                    direction:
                        LEDGER_DIRECTION.DEBIT,
                    metadata: {
                        source: "COMMUNITY_CONTRIBUTION",
                        savingsPlanId,
                        memberId,
                        ...normalizedMetadata,
                    },
                },
                {
                    accountId:
                        normalizedAccountId,
                    amount:
                        normalizedAmount,
                    entryType:
                        LEDGER_ENTRY_TYPE.CONTRIBUTION,
                    direction:
                        LEDGER_DIRECTION.CREDIT,
                    metadata: {
                        source: "COMMUNITY_CONTRIBUTION",
                        savingsPlanId,
                        memberId,
                        ...normalizedMetadata,
                    },
                },
            ],
        });

    await completeFinancialTransaction({

        session,

        transactionRepository,
        outboxRepository:
            repositories.outboxRepository,
        transactionId:
            normalized.transactionId,
        tenantId:
            normalized.tenantId,
        principalId:
            normalized.principalId,
        operation:
            FINANCIAL_OPERATION.CONTRIBUTION_CREATE,
        resource: "financial",
        correlationId:
            normalized.correlationId,
        idempotencyKey:
            normalized.idempotencyKey

    });

    return {

        transaction,

        ledgerEntries,

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
                normalizedAccountId,

            sourceAccountId:
                normalizedSourceAccountId

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

    sourceAccountId = null,

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

    const normalizedSourceAccountId =
        requireCounterpartyAccountId(
            sourceAccountId,
            normalizedMetadata
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

    const ledgerEntries =
        await createLedgerEntries({

            session,
            ledgerRepository,
            transactionId:
                normalized.transactionId,
            tenantId:
                normalized.tenantId,
            currency:
                normalizedCurrency,
            entries: [
                {
                    accountId:
                        normalizedSourceAccountId,
                    amount:
                        normalizedAmount,
                    entryType:
                        LEDGER_ENTRY_TYPE.DEPOSIT,
                    direction:
                        LEDGER_DIRECTION.DEBIT,
                    metadata: {
                        source: "DEPOSIT",
                        provider,
                        providerReference,
                        ...normalizedMetadata,
                    },
                },
                {
                    accountId:
                        normalizedAccountId,
                    amount:
                        normalizedAmount,
                    entryType:
                        LEDGER_ENTRY_TYPE.DEPOSIT,
                    direction:
                        LEDGER_DIRECTION.CREDIT,
                    metadata: {
                        source: "DEPOSIT",
                        provider,
                        providerReference,
                        ...normalizedMetadata,
                    },
                },
            ],
        });

    await completeFinancialTransaction({

        session,

        transactionRepository,
        outboxRepository:
            repositories.outboxRepository,
        transactionId:
            normalized.transactionId,
        tenantId:
            normalized.tenantId,
        principalId:
            normalized.principalId,
        operation:
            FINANCIAL_OPERATION.DEPOSIT_CREATE,
        resource: "financial",
        correlationId:
            normalized.correlationId,
        idempotencyKey:
            normalized.idempotencyKey

    });

    return {

        transaction,

        ledgerEntries,

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
                normalizedAccountId,

            sourceAccountId:
                normalizedSourceAccountId

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

    destinationAccountId = null,

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

    const normalizedDestinationAccountId =
        requireCounterpartyAccountId(
            destinationAccountId,
            normalizedMetadata
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

    const ledgerEntries =
        await createLedgerEntries({
            session,
            ledgerRepository,
            transactionId:
                normalized.transactionId,
            tenantId:
                normalized.tenantId,
            currency:
                normalizedCurrency,
            entries: [
                {
                    accountId:
                        normalizedAccountId,
                    amount:
                        normalizedAmount,
                    entryType:
                        LEDGER_ENTRY_TYPE.WITHDRAWAL,
                    direction:
                        LEDGER_DIRECTION.DEBIT,
                    metadata: {
                        source: "WITHDRAWAL",
                        provider,
                        providerReference,
                        ...normalizedMetadata,
                    },
                },
                {
                    accountId:
                        normalizedDestinationAccountId,
                    amount:
                        normalizedAmount,
                    entryType:
                        LEDGER_ENTRY_TYPE.WITHDRAWAL,
                    direction:
                        LEDGER_DIRECTION.CREDIT,
                    metadata: {
                        source: "WITHDRAWAL",
                        provider,
                        providerReference,
                        ...normalizedMetadata,
                    },
                },
            ],
        });

    await completeFinancialTransaction({

        session,

        transactionRepository,
        outboxRepository:
            repositories.outboxRepository,
        transactionId:
            normalized.transactionId,
        tenantId:
            normalized.tenantId,
        principalId:
            normalized.principalId,
        operation:
            FINANCIAL_OPERATION.WITHDRAWAL_CREATE,
        resource: "financial",
        correlationId:
            normalized.correlationId,
        idempotencyKey:
            normalized.idempotencyKey

    });

    return {

        transaction,

        ledgerEntries,

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

    const ledgerEntries =
        await createLedgerEntries({
            session,
            ledgerRepository,
            transactionId:
                normalized.transactionId,
            tenantId:
                normalized.tenantId,
            currency:
                normalizedCurrency,
            entries: [
                {
                    accountId:
                        sourceId,
                    amount:
                        normalizedAmount,
                    entryType:
                        LEDGER_ENTRY_TYPE.TRANSFER,
                    direction:
                        LEDGER_DIRECTION.DEBIT,
                    metadata: {
                        source: "TRANSFER",
                        transferRole: "SOURCE",
                        destinationAccountId: destinationId,
                        ...normalizedMetadata,
                    },
                },
                {
                    accountId:
                        destinationId,
                    amount:
                        normalizedAmount,
                    entryType:
                        LEDGER_ENTRY_TYPE.TRANSFER,
                    direction:
                        LEDGER_DIRECTION.CREDIT,
                    metadata: {
                        source: "TRANSFER",
                        transferRole: "DESTINATION",
                        sourceAccountId: sourceId,
                        ...normalizedMetadata,
                    },
                },
            ],
        });

    await completeFinancialTransaction({

        session,

        transactionRepository,
        outboxRepository:
            repositories.outboxRepository,
        transactionId:
            normalized.transactionId,
        tenantId:
            normalized.tenantId,
        principalId:
            normalized.principalId,
        operation:
            FINANCIAL_OPERATION.TRANSFER_CREATE,
        resource: "financial",
        correlationId:
            normalized.correlationId,
        idempotencyKey:
            normalized.idempotencyKey

    });

    return {

        transaction,

        ledgerEntries,

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

    fundingAccountId = null,

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

    const normalizedFundingAccountId =
        requireCounterpartyAccountId(
            fundingAccountId,
            normalizedMetadata
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

    const ledgerEntries =
        await createLedgerEntries({
            session,
            ledgerRepository,
            transactionId:
                normalized.transactionId,
            tenantId:
                normalized.tenantId,
            currency:
                normalizedCurrency,
            entries: [
                {
                    accountId:
                        normalizedFundingAccountId,
                    amount:
                        normalizedAmount,
                    entryType:
                        LEDGER_ENTRY_TYPE.LOAN_DISBURSEMENT,
                    direction:
                        LEDGER_DIRECTION.DEBIT,
                    metadata: {
                        source: "LOAN_DISBURSEMENT",
                        loanId,
                        ...normalizedMetadata,
                    },
                },
                {
                    accountId:
                        destinationId,
                    amount:
                        normalizedAmount,
                    entryType:
                        LEDGER_ENTRY_TYPE.LOAN_DISBURSEMENT,
                    direction:
                        LEDGER_DIRECTION.CREDIT,
                    metadata: {
                        source: "LOAN_DISBURSEMENT",
                        loanId,
                        ...normalizedMetadata,
                    },
                },
            ],
        });

    await completeFinancialTransaction({

        session,

        transactionRepository,
        outboxRepository:
            repositories.outboxRepository,
        transactionId:
            normalized.transactionId,
        tenantId:
            normalized.tenantId,
        principalId:
            normalized.principalId,
        operation:
            FINANCIAL_OPERATION.LOAN_DISBURSEMENT,
        resource: "financial",
        correlationId:
            normalized.correlationId,
        idempotencyKey:
            normalized.idempotencyKey

    });

    return {

        transaction,

        loanResult,

        ledgerEntries,

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

    const ledgerEntries =
        await createLedgerEntries({
            session,
            ledgerRepository,
            transactionId:
                normalized.transactionId,
            tenantId:
                normalized.tenantId,
            currency:
                normalizedCurrency,
            entries: [
                {
                    accountId:
                        loanId,
                    amount:
                        normalizedAmount,
                    entryType:
                        LEDGER_ENTRY_TYPE.LOAN_REPAYMENT,
                    direction:
                        LEDGER_DIRECTION.DEBIT,
                    metadata: {
                        source: "LOAN_REPAYMENT",
                        loanId,
                        sourceAccountId: sourceId,
                        ...normalizedMetadata,
                    },
                },
                {
                    accountId:
                        sourceId,
                    amount:
                        normalizedAmount,
                    entryType:
                        LEDGER_ENTRY_TYPE.LOAN_REPAYMENT,
                    direction:
                        LEDGER_DIRECTION.CREDIT,
                    metadata: {
                        source: "LOAN_REPAYMENT",
                        loanId,
                        ...normalizedMetadata,
                    },
                },
            ],
        });

    await completeFinancialTransaction({

        session,

        transactionRepository,
        outboxRepository:
            repositories.outboxRepository,
        transactionId:
            normalized.transactionId,
        tenantId:
            normalized.tenantId,
        principalId:
            normalized.principalId,
        operation:
            FINANCIAL_OPERATION.LOAN_REPAYMENT,
        resource: "financial",
        correlationId:
            normalized.correlationId,
        idempotencyKey:
            normalized.idempotencyKey

    });

    return {

        transaction,

        loanResult,

        ledgerEntries,

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

        case FINANCIAL_OPERATION.TRANSACTION_CREATE:

            return createGenericTransaction({

                session,
                context,
                repositories,
                ...payload,

            });

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

            ]),

        outbox:
            Object.freeze([

                "create"

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
        ledgerRepository.createEntries,
        "ledgerRepository.createEntries"
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

export {
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

export default Object.freeze({
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
});