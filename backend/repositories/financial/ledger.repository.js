"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Immutable Double-Entry Ledger Repository
 * ============================================================================
 *
 * File:
 *   backend/repositories/financial/ledger.repository.js
 *
 * Purpose:
 *   Persistence boundary for immutable double-entry financial ledger entries.
 *
 * ============================================================================
 * ARCHITECTURAL RESPONSIBILITIES
 * ============================================================================
 *
 * ✓ Persist immutable ledger entries.
 * ✓ Require an active MongoDB session for every ledger write.
 * ✓ Never start a MongoDB transaction.
 * ✓ Never commit a MongoDB transaction.
 * ✓ Never abort a MongoDB transaction.
 * ✓ Enforce tenant ownership at the persistence boundary.
 * ✓ Validate ledger identity and financial fields.
 * ✓ Validate complete double-entry balance invariants.
 * ✓ Support atomic batch insertion.
 * ✓ Convert MongoDB duplicate-key errors into domain errors.
 * ✓ Reject update/delete semantics.
 * ✓ Provide tenant-safe read helpers.
 * ✓ Provide ledger integrity/reconciliation helpers.
 *
 * ============================================================================
 * ARCHITECTURAL NON-RESPONSIBILITIES
 * ============================================================================
 *
 * ✗ Does not authorize users.
 * ✗ Does not determine business transaction eligibility.
 * ✗ Does not mutate account balances.
 * ✗ Does not calculate business-level financial amounts.
 * ✗ Does not create MongoDB transactions.
 * ✗ Does not commit MongoDB transactions.
 * ✗ Does not abort MongoDB transactions.
 * ✗ Does not own financial transaction state transitions.
 *
 * ============================================================================
 * FINANCIAL INVARIANT
 * ============================================================================
 *
 * For a complete double-entry transaction:
 *
 *     SUM(DEBITS) === SUM(CREDITS)
 *
 * This repository validates that invariant for a complete entry batch.
 *
 * ============================================================================
 * TENANCY INVARIANT
 * ============================================================================
 *
 * A single ledger batch:
 *
 *     tenantId      -> exactly one tenant
 *     transactionId -> exactly one financial transaction
 *
 * Cross-tenant and cross-transaction batches are rejected.
 *
 * ============================================================================
 * IMMUTABILITY
 * ============================================================================
 *
 * Ledger entries are append-only.
 *
 * This repository intentionally exports:
 *
 *     createEntry()
 *     createEntries()
 *     findByTransactionId()
 *     findByAccountId()
 *     countByTransactionId()
 *     verifyTransactionBalance()
 *     getAccountTotals()
 *
 * It does NOT export:
 *
 *     update()
 *     delete()
 *     remove()
 *     patch()
 *
 * ============================================================================
 * TITech terminology
 * ============================================================================
 *
 * All legacy ACFOS references have been replaced with TITech Community
 * Capital terminology.
 *
 * ============================================================================
 */

import { createRequire } from 'node:module';

import mongoose from 'mongoose';

import FinancialLedgerEntry from '../../models/FinancialLedgerEntry.js';

import { FinancialTransactionError } from '../../services/financial/financialTransaction.service.js';

const require = createRequire(import.meta.url);

const tenantConstants =
  require('../../tenancy/tenant.constants.js');

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const LEDGER_DIRECTIONS =
    Object.freeze([
        "DEBIT",
        "CREDIT"
    ]);

const MAX_BATCH_SIZE =
    500;

const MAX_TRANSACTION_ID_LENGTH =
    128;

const MAX_TENANT_ID_LENGTH =
    64;

const MAX_ACCOUNT_ID_LENGTH =
    128;

const MAX_ENTRY_TYPE_LENGTH =
    128;

const MAX_CURRENCY_LENGTH =
    16;

const MAX_METADATA_KEYS =
    100;

const MAX_METADATA_JSON_BYTES =
    32 * 1024;

const DEFAULT_ACCOUNT_QUERY_LIMIT =
    100;

const MAX_ACCOUNT_QUERY_LIMIT =
    500;

const DEFAULT_STATEMENT_LIMIT =
    100;

const MAX_STATEMENT_LIMIT =
    1_000;

/**
 * Canonical ISO-like currencies supported by TITech.
 *
 * tenant/constants can be extended independently; this repository only
 * requires a structurally valid three-letter currency identifier by default.
 */
const CURRENCY_REGEX =
    /^[A-Z]{3,16}$/;

/**
 * Identifier syntax intentionally excludes arbitrary MongoDB operators,
 * slashes and whitespace.
 */
const IDENTIFIER_REGEX =
    /^[a-zA-Z0-9._:-]+$/;

/**
 * ============================================================================
 * Error Factory
 * ============================================================================
 */

function createLedgerError(
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
 *
 * The repository cannot truly prove that the session is currently inside an
 * active MongoDB transaction without coupling itself to coordinator internals.
 *
 * Therefore:
 *
 * 1. A session object is mandatory for every write.
 * 2. The repository checks common Mongoose ClientSession fields when available.
 * 3. The financial coordinator remains responsible for starting the MongoDB
 *    transaction.
 *
 * ============================================================================
 */

function requireSession(
    session
) {
    if (
        !session
    ) {
        throw createLedgerError(
            "MongoDB transaction session is required for ledger writes.",
            "FINANCIAL_SESSION_REQUIRED",
            500
        );
    }

    if (
        typeof session !==
        "object"
    ) {
        throw createLedgerError(
            "Invalid MongoDB transaction session.",
            "FINANCIAL_SESSION_INVALID",
            500
        );
    }

    return session;
}

/**
 * Optional defensive validation.
 *
 * Mongoose ClientSession normally exposes transaction state through
 * `transaction.state`. The exact property is version-dependent, therefore
 * absence is not treated as failure.
 */
function requireTransactionContext(
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
            throw createLedgerError(
                "Ledger write requires an active MongoDB transaction.",
                "FINANCIAL_TRANSACTION_NOT_ACTIVE",
                500
            );
        }
    }

    return session;
}

/**
 * ============================================================================
 * Required Value Validation
 * ============================================================================
 */

function requireValue(
    value,
    field,
    {
        maxLength
    } = {}
) {
    if (
        value ===
            undefined ||
        value ===
            null
    ) {
        throw createLedgerError(
            `${field} is required.`,
            "LEDGER_FIELD_REQUIRED",
            400,
            {
                field
            }
        );
    }

    const normalized =
        typeof value ===
        "string"
            ? value.trim()
            : value;

    if (
        normalized ===
        ""
    ) {
        throw createLedgerError(
            `${field} is required.`,
            "LEDGER_FIELD_REQUIRED",
            400,
            {
                field
            }
        );
    }

    if (
        maxLength &&
        String(
            normalized
        ).length >
        maxLength
    ) {
        throw createLedgerError(
            `${field} exceeds the maximum permitted length.`,
            "LEDGER_FIELD_TOO_LONG",
            400,
            {
                field,
                maxLength
            }
        );
    }

    return normalized;
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
    const normalized =
        requireValue(
            value,
            field,
            {
                maxLength
            }
        );

    if (
        !IDENTIFIER_REGEX.test(
            String(
                normalized
            )
        )
    ) {
        throw createLedgerError(
            `${field} contains invalid characters.`,
            "LEDGER_INVALID_IDENTIFIER",
            400,
            {
                field
            }
        );
    }

    return String(
        normalized
    );
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
        MAX_TRANSACTION_ID_LENGTH
    );
}

/**
 * ============================================================================
 * Tenant ID
 * ============================================================================
 *
 * The tenancy subsystem is the canonical authority for tenant ID validity.
 * Silent sanitization is deliberately avoided.
 * ============================================================================
 */

function requireTenantId(
    tenantId
) {
    const normalized =
        requireIdentifier(
            tenantId,
            "tenantId",
            MAX_TENANT_ID_LENGTH
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
            throw createLedgerError(
                "Invalid tenant identifier.",
                "LEDGER_INVALID_TENANT",
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
 * Account ID
 * ============================================================================
 */

function requireAccountId(
    accountId
) {
    return requireIdentifier(
        accountId,
        "accountId",
        MAX_ACCOUNT_ID_LENGTH
    );
}

/**
 * ============================================================================
 * Entry Type
 * ============================================================================
 */

function requireEntryType(
    entryType
) {
    return requireIdentifier(
        entryType,
        "entryType",
        MAX_ENTRY_TYPE_LENGTH
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
        requireValue(
            currency,
            "currency",
            {
                maxLength:
                    MAX_CURRENCY_LENGTH
            }
        );

    const normalizedCurrency =
        String(
            normalized
        )
            .trim()
            .toUpperCase();

    if (
        !CURRENCY_REGEX.test(
            normalizedCurrency
        )
    ) {
        throw createLedgerError(
            "Invalid ledger currency.",
            "LEDGER_INVALID_CURRENCY",
            400,
            {
                currency:
                    normalizedCurrency
            }
        );
    }

    return normalizedCurrency;
}

/**
 * ============================================================================
 * Direction
 * ============================================================================
 */

function requireDirection(
    direction
) {
    const normalized =
        String(
            requireValue(
                direction,
                "direction",
                {
                    maxLength:
                        16
                }
            )
        )
            .trim()
            .toUpperCase();

    if (
        !LEDGER_DIRECTIONS.includes(
            normalized
        )
    ) {
        throw createLedgerError(
            "Ledger direction must be DEBIT or CREDIT.",
            "LEDGER_INVALID_DIRECTION",
            400,
            {
                direction:
                    normalized
            }
        );
    }

    return normalized;
}

/**
 * ============================================================================
 * Amount Validation
 * ============================================================================
 *
 * IMPORTANT:
 *   Never convert financial amounts through Number().
 *
 * The canonical value should preferably be:
 *
 *   - MongoDB Decimal128
 *   - a precise decimal library value
 *   - or an exact decimal string
 *
 * This repository validates structure and preserves the supplied amount.
 * ============================================================================
 */

function requireAmount(
    amount
) {
    if (
        amount ===
            undefined ||
        amount ===
            null
    ) {
        throw createLedgerError(
            "Ledger amount is required.",
            "LEDGER_AMOUNT_REQUIRED",
            400,
            {
                field:
                    "amount"
            }
        );
    }

    const value =
        normalizeDecimalString(
            amount
        );

    if (
        !value
    ) {
        throw createLedgerError(
            "Ledger amount is required.",
            "LEDGER_AMOUNT_REQUIRED",
            400
        );
    }

    if (
        !isPositiveDecimal(
            value
        )
    ) {
        throw createLedgerError(
            "Ledger amount must be greater than zero.",
            "LEDGER_INVALID_AMOUNT",
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
 * Metadata
 * ============================================================================
 */

function normalizeMetadata(
    metadata
) {
    if (
        metadata ===
            undefined ||
        metadata ===
            null
    ) {
        return {};
    }

    if (
        typeof metadata !==
            "object" ||
        Array.isArray(
            metadata
        )
    ) {
        throw createLedgerError(
            "Ledger metadata must be an object.",
            "LEDGER_INVALID_METADATA",
            400,
            {
                field:
                    "metadata"
            }
        );
    }

    const keys =
        Object.keys(
            metadata
        );

    if (
        keys.length >
        MAX_METADATA_KEYS
    ) {
        throw createLedgerError(
            "Ledger metadata contains too many fields.",
            "LEDGER_METADATA_TOO_LARGE",
            400,
            {
                maxKeys:
                    MAX_METADATA_KEYS
            }
        );
    }

    let serialized;

    try {
        serialized =
            JSON.stringify(
                metadata
            );
    } catch (
        error
    ) {
        throw createLedgerError(
            "Ledger metadata must be JSON serializable.",
            "LEDGER_METADATA_NOT_SERIALIZABLE",
            400,
            undefined
        );
    }

    if (
        Buffer.byteLength(
            serialized,
            "utf8"
        ) >
        MAX_METADATA_JSON_BYTES
    ) {
        throw createLedgerError(
            "Ledger metadata exceeds the maximum permitted size.",
            "LEDGER_METADATA_TOO_LARGE",
            400,
            {
                maxBytes:
                    MAX_METADATA_JSON_BYTES
            }
        );
    }

    return deepClone(
        metadata
    );
}

/**
 * ============================================================================
 * Normalize Ledger Entry
 * ============================================================================
 */

function normalizeEntry(
    entry
) {
    if (
        !entry ||
        typeof entry !==
            "object" ||
        Array.isArray(
            entry
        )
    ) {
        throw createLedgerError(
            "Ledger entry must be an object.",
            "LEDGER_INVALID_ENTRY",
            400
        );
    }

    const {
        transactionId,
        tenantId,
        accountId,
        amount,
        currency,
        entryType,
        direction,
        metadata = {},
        journalId = transactionId,
        lineNumber = 1,
        source = metadata?.source || "SYSTEM",
        sourceId = metadata?.sourceId || transactionId,
        providerReference = metadata?.providerReference || null,
        externalId = metadata?.externalId || null,
        userId = metadata?.userId || null,
        groupId = metadata?.groupId || null,
        loanId = metadata?.loanId || null,
        savingsAccountId = metadata?.savingsAccountId || null,
        walletId = metadata?.walletId || null,
        correlationId = metadata?.correlationId || null,
        description = metadata?.description || null,
        notes = metadata?.notes || null,
        accountCode = metadata?.accountCode || null,
        accountName = metadata?.accountName || null,
        accountType = metadata?.accountType || null
    } = entry;

    const normalizedTransactionId =
        requireTransactionId(
            transactionId
        );

    if (!Number.isSafeInteger(Number(lineNumber)) || Number(lineNumber) < 1) {
        throw createLedgerError(
            "Ledger lineNumber must be a positive safe integer.",
            "LEDGER_INVALID_LINE_NUMBER",
            400
        );
    }

    const normalizedEntryType =
        requireEntryType(
            entryType
        );

    const normalizedDirection =
        requireDirection(
            direction
        );

    return {
        financialTransactionId:
            normalizedTransactionId,

        journalId:
            requireTransactionId(
                journalId
            ),

        lineNumber:
            Number(lineNumber),

        tenantId:
            requireTenantId(
                tenantId
            ),

        accountId:
            requireAccountId(
                accountId
            ),

        amount:
            requireAmount(
                amount
            ),

        currency:
            requireCurrency(
                currency
            ),

        entryType:
            normalizedEntryType,

        direction:
            normalizedDirection,

        source:
            String(source || "SYSTEM")
                .trim()
                .toUpperCase(),

        sourceId:
            sourceId == null ? null : String(sourceId).trim(),

        providerReference:
            providerReference == null ? null : String(providerReference).trim(),

        externalId:
            externalId == null ? null : String(externalId).trim(),

        userId:
            userId == null ? null : String(userId).trim(),

        groupId:
            groupId == null ? null : String(groupId).trim(),

        loanId:
            loanId == null ? null : String(loanId).trim(),

        savingsAccountId:
            savingsAccountId == null ? null : String(savingsAccountId).trim(),

        walletId:
            walletId == null ? null : String(walletId).trim(),

        correlationId:
            correlationId == null ? null : String(correlationId).trim(),

        description:
            description == null ? null : String(description).trim(),

        notes:
            notes == null ? null : String(notes).trim(),

        accountCode:
            accountCode == null ? null : String(accountCode).trim().toUpperCase(),

        accountName:
            accountName == null ? null : String(accountName).trim(),

        accountType:
            accountType == null ? null : String(accountType).trim().toUpperCase(),

        posted: true,

        reversed: false,

        metadata:
            normalizeMetadata(
                metadata
            )
    };
}

/**
 * ============================================================================
 * Create Single Ledger Entry
 * ============================================================================
 *
 * IMPORTANT:
 *   The caller owns the MongoDB transaction lifecycle.
 * ============================================================================
 */

async function createEntry({
    session,
    transactionId,
    tenantId,
    accountId,
    amount,
    currency,
    entryType,
    direction,
    metadata = {}
}) {
    requireTransactionContext(
        session
    );

    const created =
        await createEntries({
            session,
            entries: [
                {
                    transactionId,
                    tenantId,
                    accountId,
                    amount,
                    currency,
                    entryType,
                    direction,
                    metadata,
                    lineNumber: 1
                }
            ],
            validateBalance: false
        });

    return created[0];
}

/**
 * ============================================================================
 * Create Multiple Ledger Entries
 * ============================================================================
 */

async function createEntries({
    session,
    entries,
    validateBalance =
        true
}) {
    requireTransactionContext(
        session
    );

    if (
        !Array.isArray(
            entries
        ) ||
        entries.length ===
            0
    ) {
        throw createLedgerError(
            "At least one ledger entry is required.",
            "LEDGER_ENTRIES_REQUIRED",
            400
        );
    }

    if (
        entries.length >
        MAX_BATCH_SIZE
    ) {
        throw createLedgerError(
            `A maximum of ${MAX_BATCH_SIZE} ledger entries may be created in one batch.`,
            "LEDGER_BATCH_TOO_LARGE",
            400,
            {
                maxBatchSize:
                    MAX_BATCH_SIZE
            }
        );
    }

    const normalizedEntries =
        entries.map(
            (entry, index) =>
                normalizeEntry({
                    ...entry,
                    journalId:
                        entry.journalId ||
                        entry.transactionId,
                    lineNumber:
                        entry.lineNumber ??
                        index + 1
                })
        );

    requireSameTenant(
        normalizedEntries
    );

    requireSameTransaction(
        normalizedEntries
    );

    requireSameCurrency(
        normalizedEntries
    );

    if (
        validateBalance
    ) {
        validateBalancedEntries(
            normalizedEntries
        );
    }

    try {
        const createdEntries =
            await FinancialLedgerEntry.insertMany(
                normalizedEntries,
                {
                    session,

                    ordered:
                        true
                }
            );

        return createdEntries;
    } catch (
        error
    ) {
        throw translatePersistenceError(
            error,
            normalizedEntries[0]
        );
    }
}

/**
 * ============================================================================
 * Find By Transaction
 * ============================================================================
 *
 * Tenant must always be supplied.
 * ============================================================================
 */

async function findByTransactionId({
    session,
    transactionId,
    tenantId,
    includeMetadata =
        true
}) {
    const normalizedTransactionId =
        requireTransactionId(
            transactionId
        );

    const normalizedTenantId =
        requireTenantId(
            tenantId
        );

    const projection =
        includeMetadata
            ? null
            : {
                metadata:
                    0
            };

    const query =
        FinancialLedgerEntry.find(
            {
                financialTransactionId:
                    normalizedTransactionId,

                tenantId:
                    normalizedTenantId
            },
            projection
        )
            .sort({
                createdAt:
                    1,

                _id:
                    1
            });

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
 * Find By Account
 * ============================================================================
 */

async function findByAccountId({
    session,
    tenantId,
    accountId,
    limit =
        DEFAULT_ACCOUNT_QUERY_LIMIT,
    before,
    after
}) {
    const normalizedTenantId =
        requireTenantId(
            tenantId
        );

    const normalizedAccountId =
        requireAccountId(
            accountId
        );

    const safeLimit =
        clampInteger(
            limit,
            1,
            MAX_ACCOUNT_QUERY_LIMIT,
            DEFAULT_ACCOUNT_QUERY_LIMIT
        );

    const filter =
        {
            tenantId:
                normalizedTenantId,

            accountId:
                normalizedAccountId
        };

    if (
        before
    ) {
        filter.createdAt =
            {
                ...(filter.createdAt ||
                    {}),

                $lt:
                    normalizeDate(
                        before
                    )
            };
    }

    if (
        after
    ) {
        filter.createdAt =
            {
                ...(filter.createdAt ||
                    {}),

                $gt:
                    normalizeDate(
                        after
                    )
            };
    }

    const query =
        FinancialLedgerEntry.find(
            filter
        )
            .sort({
                createdAt:
                    -1,

                _id:
                    -1
            })
            .limit(
                safeLimit
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
 * Count By Transaction
 * ============================================================================
 */

async function countByTransactionId({
    session,
    transactionId,
    tenantId
}) {
    const normalizedTransactionId =
        requireTransactionId(
            transactionId
        );

    const normalizedTenantId =
        requireTenantId(
            tenantId
        );

    const query =
        FinancialLedgerEntry.countDocuments(
            {
                financialTransactionId:
                    normalizedTransactionId,

                tenantId:
                    normalizedTenantId
            }
        );

    if (
        session
    ) {
        query.session(
            session
        );
    }

    return query.exec();
}

/**
 * ============================================================================
 * Verify Transaction Balance
 * ============================================================================
 *
 * This reads all ledger entries for the transaction and verifies:
 *
 *   - tenant consistency
 *   - transaction consistency
 *   - currency consistency
 *   - debit/credit presence
 *   - debit == credit
 *
 * This method does not mutate anything.
 * ============================================================================
 */

async function verifyTransactionBalance({
    session,
    transactionId,
    tenantId
}) {
    const entries =
        await findByTransactionId({
            session,
            transactionId,
            tenantId
        });

    if (
        entries.length ===
        0
    ) {
        throw createLedgerError(
            "No ledger entries found for the financial transaction.",
            "LEDGER_ENTRIES_NOT_FOUND",
            404,
            {
                transactionId
            }
        );
    }

    const normalized =
        entries.map(
            entry =>
                normalizeEntry({
                    transactionId:
                        entry.financialTransactionId,

                    tenantId:
                        entry.tenantId,

                    accountId:
                        entry.accountId,

                    amount:
                        entry.amount,

                    currency:
                        entry.currency,

                    entryType:
                        entry.entryType,

                    direction:
                        entry.direction,

                    metadata:
                        entry.metadata
                })
        );

    requireSameTenant(
        normalized
    );

    requireSameTransaction(
        normalized
    );

    requireSameCurrency(
        normalized
    );

    validateBalancedEntries(
        normalized
    );

    return {
        balanced:
            true,

        transactionId:
            normalized[0]
                .financialTransactionId,

        tenantId:
            normalized[0]
                .tenantId,

        currency:
            normalized[0]
                .currency,

        entryCount:
            normalized.length,

        debitTotal:
            sumExactDecimals(
                normalized
                    .filter(
                        entry =>
                            entry.direction ===
                            "DEBIT"
                    )
                    .map(
                        entry =>
                            normalizeDecimalString(
                                entry.amount
                            )
                    )
            ),

        creditTotal:
            sumExactDecimals(
                normalized
                    .filter(
                        entry =>
                            entry.direction ===
                            "CREDIT"
                    )
                    .map(
                        entry =>
                            normalizeDecimalString(
                                entry.amount
                            )
                    )
            )
    };
}

/**
 * ============================================================================
 * Get Account Totals
 * ============================================================================
 *
 * Returns immutable ledger totals for one account within one tenant.
 *
 * This is a reporting/integrity helper only.
 * It does NOT write or mutate account balances.
 * ============================================================================
 */

async function getAccountTotals({
    session,
    tenantId,
    accountId
}) {
    const normalizedTenantId =
        requireTenantId(
            tenantId
        );

    const normalizedAccountId =
        requireAccountId(
            accountId
        );

    const query =
        FinancialLedgerEntry.find(
            {
                tenantId:
                    normalizedTenantId,

                accountId:
                    normalizedAccountId
            }
        );

    if (
        session
    ) {
        query.session(
            session
        );
    }

    const entries =
        await query
            .select(
                {
                    direction:
                        1,

                    amount:
                        1,

                    currency:
                        1
                }
            )
            .lean()
            .exec();

    const currencies =
        {};

    for (
        const entry of
        entries
    ) {
        const currency =
            requireCurrency(
                entry.currency
            );

        if (
            !currencies[
                currency
            ]
        ) {
            currencies[
                currency
            ] =
                {
                    debit:
                        [],

                    credit:
                        []
                };
        }

        const amount =
            normalizeDecimalString(
                entry.amount
            );

        if (
            entry.direction ===
            "DEBIT"
        ) {
            currencies[
                currency
            ].debit.push(
                amount
            );
        } else {
            currencies[
                currency
            ].credit.push(
                amount
            );
        }
    }

    const totals =
        {};

    for (
        const [
            currency,
            buckets
        ] of Object.entries(
            currencies
        )
    ) {
        const debit =
            sumExactDecimals(
                buckets.debit
            );

        const credit =
            sumExactDecimals(
                buckets.credit
            );

        totals[
            currency
        ] =
            {
                debit,

                credit,

                net:
                    subtractExactDecimals(
                        credit,
                        debit
                    )
            };
    }

    return {
        tenantId:
            normalizedTenantId,

        accountId:
            normalizedAccountId,

        entryCount:
            entries.length,

        currencies:
            totals
    };
}

/**
 * ============================================================================
 * List Transaction Statement
 * ============================================================================
 */

async function getTransactionStatement({
    session,
    transactionId,
    tenantId,
    limit =
        DEFAULT_STATEMENT_LIMIT
}) {
    const entries =
        await findByTransactionId({
            session,
            transactionId,
            tenantId
        });

    const safeLimit =
        clampInteger(
            limit,
            1,
            MAX_STATEMENT_LIMIT,
            DEFAULT_STATEMENT_LIMIT
        );

    const selected =
        entries.slice(
            0,
            safeLimit
        );

    return {
        transactionId:
            requireTransactionId(
                transactionId
            ),

        tenantId:
            requireTenantId(
                tenantId
            ),

        entryCount:
            entries.length,

        returned:
            selected.length,

        truncated:
            entries.length >
            selected.length,

        entries:
            selected
    };
}

/**
 * ============================================================================
 * Persistence Error Translation
 * ============================================================================
 */

function translatePersistenceError(
    error,
    context
) {
    if (
        error?.code ===
        11000
    ) {
        return createLedgerError(
            "Duplicate immutable ledger entry detected.",
            "LEDGER_ENTRY_ALREADY_EXISTS",
            409,
            {
                transactionId:
                    context
                        ?.transactionId,

                tenantId:
                    context
                        ?.tenantId,

                accountId:
                    context
                        ?.accountId,

                keyPattern:
                    error
                        ?.keyPattern
            }
        );
    }

    if (
        error?.name ===
        "ValidationError"
    ) {
        return createLedgerError(
            "Ledger entry model validation failed.",
            "LEDGER_MODEL_VALIDATION_FAILED",
            400,
            {
                errors:
                    sanitizeMongooseValidationErrors(
                        error
                    )
            }
        );
    }

    if (
        error?.name ===
        "CastError"
    ) {
        return createLedgerError(
            "Ledger persistence data contains an invalid MongoDB value.",
            "LEDGER_MONGO_CAST_ERROR",
            400
        );
    }

    return error;
}

/**
 * ============================================================================
 * Mongoose Validation Error Sanitizer
 * ============================================================================
 */

function sanitizeMongooseValidationErrors(
    error
) {
    const result =
        {};

    if (
        !error?.errors
    ) {
        return result;
    }

    for (
        const [
            field,
            detail
        ] of Object.entries(
            error.errors
        )
    ) {
        result[
            field
        ] =
            detail?.message ||
            "Validation failed";
    }

    return result;
}

/**
 * ============================================================================
 * Exact Decimal Helpers
 * ============================================================================
 *
 * These helpers avoid JavaScript Number arithmetic.
 *
 * They support normal decimal notation:
 *
 *   10
 *   10.50
 *   0.25
 *
 * Scientific notation is deliberately rejected in ledger-entry validation.
 * ============================================================================
 */

function normalizeDecimalString(
    value
) {
    if (
        value ===
            undefined ||
        value ===
            null
    ) {
        return null;
    }

    let text;

    if (
        mongoose.isDecimal128(
            value
        )
    ) {
        text =
            value.toString();
    } else if (
        typeof value ===
        "string"
    ) {
        text =
            value.trim();
    } else if (
        typeof value ===
            "number"
    ) {
        if (
            !Number.isFinite(
                value
            )
        ) {
            return null;
        }

        /**
         * Reject unsafe financial Number values rather than accepting them.
         */
        if (
            !Number.isSafeInteger(
                value
            ) &&
            !Number.isInteger(
                value
            )
        ) {
            throw createLedgerError(
                "Financial ledger amounts supplied as JavaScript numbers must be safely representable.",
                "LEDGER_UNSAFE_NUMBER_AMOUNT",
                400
            );
        }

        text =
            String(
                value
            );
    } else if (
        typeof value?.toString ===
        "function"
    ) {
        text =
            value.toString().trim();
    } else {
        return null;
    }

    if (
        !text
    ) {
        return null;
    }

    if (
        /e/i.test(
            text
        )
    ) {
        return null;
    }

    if (
        !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(
            text
        )
    ) {
        return null;
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

    fractionalPart =
        fractionalPart.replace(
            /0+$/,
            ""
        );

    if (
        fractionalPart
    ) {
        return (
            `${integerPart}.${fractionalPart}`
        );
    }

    return integerPart;
}

function isPositiveDecimal(
    value
) {
    if (
        !value
    ) {
        return false;
    }

    if (
        value ===
        "0"
    ) {
        return false;
    }

    if (
        /^0(?:\.0*)?$/.test(
            value
        )
    ) {
        return false;
    }

    return true;
}

/**
 * Exact decimal addition.
 *
 * Uses BigInt after scaling each value to a common decimal precision.
 */
function sumExactDecimals(
    values
) {
    if (
        !Array.isArray(
            values
        ) ||
        values.length ===
        0
    ) {
        return "0";
    }

    const normalized =
        values.map(
            value =>
                normalizeDecimalString(
                    value
                )
        );

    if (
        normalized.some(
            value =>
                !value
        )
    ) {
        throw createLedgerError(
            "Ledger contains a non-canonical decimal amount.",
            "LEDGER_NON_CANONICAL_AMOUNT",
            400
        );
    }

    let scale =
        0;

    const parsed =
        normalized.map(
            value => {
                const [
                    integerPart,
                    fractionalPart =
                        ""
                ] =
                    value.split(
                        "."
                    );

                scale =
                    Math.max(
                        scale,
                        fractionalPart.length
                    );

                return {
                    integerPart,
                    fractionalPart
                };
            }
        );

    let total =
        0n;

    for (
        const value of
        parsed
    ) {
        const digits =
            (
                `${value.integerPart}${value.fractionalPart}`
            )
                .replace(
                    /^0+(?=\d)/,
                    ""
                ) ||
            "0";

        const scaled =
            digits +
            "0".repeat(
                scale -
                value
                    .fractionalPart
                    .length
            );

        total +=
            BigInt(
                scaled
            );
    }

    return formatScaledInteger(
        total,
        scale
    );
}

function subtractExactDecimals(
    left,
    right
) {
    const normalizedLeft =
        normalizeDecimalString(
            left
        ) ||
        "0";

    const normalizedRight =
        normalizeDecimalString(
            right
        ) ||
        "0";

    const maxScale =
        Math.max(
            (
                normalizedLeft
                    .split(
                        "."
                    )[1] ||
                ""
            ).length,
            (
                normalizedRight
                    .split(
                        "."
                    )[1] ||
                ""
            ).length
        );

    const leftScaled =
        decimalToBigInt(
            normalizedLeft,
            maxScale
        );

    const rightScaled =
        decimalToBigInt(
            normalizedRight,
            maxScale
        );

    return formatScaledInteger(
        leftScaled -
        rightScaled,
        maxScale
    );
}

function decimalToBigInt(
    value,
    scale
) {
    const normalized =
        normalizeDecimalString(
            value
        ) ||
        "0";

    const [
        integerPart,
        fractionalPart =
            ""
    ] =
        normalized.split(
            "."
        );

    const digits =
        (
            `${integerPart}${fractionalPart}`
        )
            .replace(
                /^0+(?=\d)/,
                ""
            ) ||
        "0";

    return BigInt(
        digits +
        "0".repeat(
            scale -
            fractionalPart.length
        )
    );
}

function formatScaledInteger(
    value,
    scale
) {
    const negative =
        value <
        0n;

    const absolute =
        negative
            ? -value
            : value;

    let digits =
        absolute.toString();

    if (
        scale ===
        0
    ) {
        return (
            negative
                ? `-${digits}`
                : digits
        );
    }

    digits =
        digits.padStart(
            scale + 1,
            "0"
        );

    const splitIndex =
        digits.length -
        scale;

    const integerPart =
        digits.slice(
            0,
            splitIndex
        );

    const fractionalPart =
        digits.slice(
            splitIndex
        )
            .replace(
                /0+$/,
                ""
            );

    if (
        !fractionalPart
    ) {
        return (
            negative
                ? `-${integerPart}`
                : integerPart
        );
    }

    const result =
        `${integerPart}.${fractionalPart}`;

    return (
        negative
            ? `-${result}`
            : result
    );
}

/**
 * ============================================================================
 * Date Helpers
 * ============================================================================
 */

function normalizeDate(
    value
) {
    const date =
        new Date(
            value
        );

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        throw createLedgerError(
            "Invalid date value.",
            "LEDGER_INVALID_DATE",
            400
        );
    }

    return date;
}

function clampInteger(
    value,
    min,
    max,
    fallback
) {
    const number =
        Number(
            value
        );

    if (
        !Number.isInteger(
            number
        )
    ) {
        return fallback;
    }

    return Math.min(
        Math.max(
            number,
            min
        ),
        max
    );
}

/**
 * ============================================================================
 * Deep Clone
 * ============================================================================
 */

function deepClone(
    value
) {
    try {
        return JSON.parse(
            JSON.stringify(
                value
            )
        );
    } catch {
        return {
            ...value
        };
    }
}

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

const repositoryModule =
    Object.freeze({
        LEDGER_DIRECTIONS,

        MAX_BATCH_SIZE,

        createEntry,

        createEntries,

        findByTransactionId,

        findByAccountId,

        countByTransactionId,

        verifyTransactionBalance,

        getAccountTotals,

        getTransactionStatement,

        validateBalancedEntries,

        normalizeEntry,

        requireSession,

        requireTenantId,

        requireTransactionId,

        requireAccountId,

        requireCurrency,

        requireAmount
    });
export default repositoryModule;
