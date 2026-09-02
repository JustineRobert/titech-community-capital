
// ============================================================================
// TITech Community Capital LTD
// ledgerService.js
// ============================================================================
//
// Enterprise Ledger Posting Service
//
// Responsibilities:
//   - Post balanced double-entry financial records.
//   - Enforce tenant isolation.
//   - Validate financial amounts and currencies.
//   - Execute ledger writes atomically.
//   - Support idempotent financial posting.
//   - Prevent duplicate ledger references.
//   - Preserve Decimal128 precision.
//   - Provide deterministic operational errors.
//   - Remain independent from HTTP/controllers.
//
// Financial Rule:
//
//   Every posted transaction must represent:
//
//       Debit Account  -> Amount
//       Credit Account -> Amount
//
//   The Ledger model represents the complete balanced event:
//
//       debitAccount
//       creditAccount
//       amount
//
// Pipeline:
//
//   Payment / Transaction
//          |
//          v
//   Ledger Service
//          |
//          v
//   MongoDB Transaction
//          |
//          v
//   Ledger Record
//          |
//          v
//   Reconciliation / Financial Statements
//
// ============================================================================

'use strict';

const mongoose = require('mongoose');
const Ledger = require('../models/Ledger');


// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CURRENCY = 'UGX';

const SUPPORTED_CURRENCIES = Object.freeze(
    new Set([
        'UGX',
        'USD',
        'EUR',
        'GBP',
        'KES',
        'TZS',
        'RWF',
        'ZMW',
        'ZAR',
        'NGN',
        'GHS',
    ])
);

const LEDGER_STATUS = Object.freeze({
    POSTED: 'posted',
    PENDING: 'pending',
    CANCELED: 'canceled',
});

const MAX_REFERENCE_LENGTH = 128;
const MAX_ACCOUNT_LENGTH = 128;
const MAX_CURRENCY_LENGTH = 3;


// ============================================================================
// Error Helpers
// ============================================================================

class LedgerServiceError extends Error {

    constructor(
        message,
        {
            code = 'LEDGER_ERROR',
            details = {},
            cause = null,
        } = {}
    ) {

        super(message);

        this.name = 'LedgerServiceError';
        this.code = code;
        this.details = details;

        if (cause) {
            this.cause = cause;
        }

        Error.captureStackTrace?.(
            this,
            LedgerServiceError
        );
    }
}


// ============================================================================
// Validation
// ============================================================================

function requireNonEmptyString(
    value,
    fieldName,
    maxLength = 255
) {

    if (
        typeof value !== 'string' ||
        !value.trim()
    ) {

        throw new LedgerServiceError(
            `${fieldName} is required`,
            {
                code: 'INVALID_LEDGER_INPUT',
                details: {
                    field: fieldName,
                },
            }
        );

    }

    const normalized = value.trim();

    if (normalized.length > maxLength) {

        throw new LedgerServiceError(
            `${fieldName} exceeds maximum length`,
            {
                code: 'INVALID_LEDGER_INPUT',
                details: {
                    field: fieldName,
                    maxLength,
                },
            }
        );

    }

    return normalized;
}


// ============================================================================
// Amount Normalization
// ============================================================================
//
// IMPORTANT:
//
// JavaScript Number is not used as the authoritative storage type.
//
// MongoDB stores Ledger.amount as Decimal128.
//
// We therefore normalize through a decimal string and construct Decimal128
// explicitly before persistence.
//
// ============================================================================

function normalizeAmount(amount) {

    if (
        amount === undefined ||
        amount === null ||
        amount === ''
    ) {

        throw new LedgerServiceError(
            'Amount is required',
            {
                code: 'INVALID_AMOUNT',
            }
        );

    }

    const amountString =
        String(amount).trim();

    if (
        !/^\d+(?:\.\d+)?$/.test(
            amountString
        )
    ) {

        throw new LedgerServiceError(
            'Amount must be a positive decimal number',
            {
                code: 'INVALID_AMOUNT',
                details: {
                    amount: '[REDACTED]',
                },
            }
        );

    }

    const numericAmount =
        Number(amountString);

    if (
        !Number.isFinite(numericAmount) ||
        numericAmount <= 0
    ) {

        throw new LedgerServiceError(
            'Amount must be a positive number',
            {
                code: 'INVALID_AMOUNT',
            }
        );

    }

    // Financial ledger precision is two decimal places for this service.
    //
    // Reject rather than silently round values. Silent financial rounding
    // can create reconciliation discrepancies.
    const decimalParts =
        amountString.split('.');

    if (
        decimalParts[1] &&
        decimalParts[1].length > 2
    ) {

        throw new LedgerServiceError(
            'Amount must not contain more than 2 decimal places',
            {
                code: 'INVALID_AMOUNT_PRECISION',
            }
        );

    }

    const normalized =
        decimalParts[1]
            ? `${decimalParts[0]}.${decimalParts[1].padEnd(2, '0')}`
            : `${decimalParts[0]}.00`;

    return mongoose.Types.Decimal128.fromString(
        normalized
    );
}


// ============================================================================
// Currency Normalization
// ============================================================================

function normalizeCurrency(currency) {

    const normalized =
        String(
            currency || DEFAULT_CURRENCY
        )
            .trim()
            .toUpperCase();

    if (
        normalized.length !== MAX_CURRENCY_LENGTH
    ) {

        throw new LedgerServiceError(
            'Currency must be a 3-letter ISO currency code',
            {
                code: 'INVALID_CURRENCY',
                details: {
                    currency: normalized,
                },
            }
        );

    }

    if (
        !/^[A-Z]{3}$/.test(normalized)
    ) {

        throw new LedgerServiceError(
            'Currency must be a valid 3-letter ISO currency code',
            {
                code: 'INVALID_CURRENCY',
                details: {
                    currency: normalized,
                },
            }
        );

    }

    //
    // Do not unnecessarily reject currencies that may be introduced later.
    // The configured set provides validation for known currencies while the
    // ISO-format validation remains the authoritative structural rule.
    //
    if (
        !SUPPORTED_CURRENCIES.has(normalized)
    ) {

        // Deliberately accepted.
        // Multi-currency expansion remains possible without changing this API.
    }

    return normalized;
}


// ============================================================================
// Reference Normalization
// ============================================================================

function normalizeReference(reference) {

    if (
        reference === undefined ||
        reference === null ||
        reference === ''
    ) {

        return null;

    }

    return requireNonEmptyString(
        String(reference),
        'Reference',
        MAX_REFERENCE_LENGTH
    );

}


// ============================================================================
// Session Helpers
// ============================================================================

function isSessionUsable(session) {

    return Boolean(
        session &&
        typeof session.startTransaction === 'function' &&
        typeof session.commitTransaction === 'function' &&
        typeof session.abortTransaction === 'function' &&
        typeof session.endSession === 'function'
    );

}


// ============================================================================
// Post Double Entry
// ============================================================================
//
// This implementation creates ONE Ledger document representing the complete
// balanced financial event:
//
//     debitAccount  = source account
//     creditAccount = destination account
//     amount        = transaction amount
//
// This is correct for the current Ledger schema.
//
// ============================================================================

async function postDoubleEntry({

    tenantId,
    transactionId,
    debitAccount,
    creditAccount,
    amount,
    currency = DEFAULT_CURRENCY,
    reference = null,
    description = null,
    metadata = {},
    status = LEDGER_STATUS.POSTED,
    session: externalSession = null,

} = {}) {

    const normalizedTenantId =
        requireNonEmptyString(
            tenantId,
            'TenantId'
        );

    const normalizedTransactionId =
        requireNonEmptyString(
            transactionId,
            'TransactionId'
        );

    const normalizedDebitAccount =
        requireNonEmptyString(
            debitAccount,
            'Debit account',
            MAX_ACCOUNT_LENGTH
        );

    const normalizedCreditAccount =
        requireNonEmptyString(
            creditAccount,
            'Credit account',
            MAX_ACCOUNT_LENGTH
        );

    if (
        normalizedDebitAccount ===
        normalizedCreditAccount
    ) {

        throw new LedgerServiceError(
            'Debit and credit accounts must be different',
            {
                code: 'INVALID_LEDGER_ACCOUNTS',
            }
        );

    }

    const normalizedAmount =
        normalizeAmount(amount);

    const normalizedCurrency =
        normalizeCurrency(currency);

    const normalizedReference =
        normalizeReference(reference);

    const normalizedDescription =
        description === undefined ||
        description === null
            ? undefined
            : String(description)
                .trim()
                .slice(0, 1024);

    if (
        !metadata ||
        typeof metadata !== 'object' ||
        Array.isArray(metadata)
    ) {

        throw new LedgerServiceError(
            'Ledger metadata must be an object',
            {
                code: 'INVALID_METADATA',
            }
        );

    }

    if (
        !Object.values(
            LEDGER_STATUS
        ).includes(status)
    ) {

        throw new LedgerServiceError(
            'Invalid ledger status',
            {
                code: 'INVALID_LEDGER_STATUS',
                details: {
                    status,
                },
            }
        );

    }

    let session =
        externalSession;

    let ownsSession =
        false;

    try {

        // --------------------------------------------------------------------
        // Reuse caller-owned session when provided.
        // This allows the ledger operation to participate in a larger
        // transaction, e.g. repayment + transaction + ledger posting.
        // --------------------------------------------------------------------

        if (!session) {

            session =
                await mongoose.startSession();

            ownsSession = true;

        }

        if (
            !isSessionUsable(session)
        ) {

            throw new LedgerServiceError(
                'Invalid MongoDB session',
                {
                    code: 'INVALID_DATABASE_SESSION',
                }
            );

        }

        // --------------------------------------------------------------------
        // Only start/commit/abort transactions when this service owns the
        // session. Caller-owned sessions remain under caller control.
        // --------------------------------------------------------------------

        if (ownsSession) {

            session.startTransaction();

        }

        // --------------------------------------------------------------------
        // Idempotency / duplicate protection.
        //
        // Reference is the preferred business idempotency key.
        // TransactionId also participates in duplicate detection.
        //
        // We perform the lookup inside the transaction session.
        // --------------------------------------------------------------------

        const duplicateQuery = {
            tenantId:
                normalizedTenantId,

            transactionId:
                normalizedTransactionId,

            deletedAt:
                null,
        };

        const existing =
            await Ledger.findOne(
                duplicateQuery
            )
                .session(session)
                .lean();

        if (existing) {

            if (ownsSession) {

                await session.commitTransaction();

            }

            return {
                success: true,
                duplicate: true,
                transactionId:
                    normalizedTransactionId,
                ledgerId:
                    existing._id,
                entry:
                    existing,
            };

        }

        // --------------------------------------------------------------------
        // Reference-level duplicate protection.
        //
        // Because the current Ledger model declares reference as unique,
        // duplicate references must never silently create another record.
        // --------------------------------------------------------------------

        if (normalizedReference) {

            const existingReference =
                await Ledger.findOne({
                    tenantId:
                        normalizedTenantId,

                    reference:
                        normalizedReference,

                    deletedAt:
                        null,
                })
                    .session(session)
                    .lean();

            if (existingReference) {

                if (ownsSession) {

                    await session.commitTransaction();

                }

                return {
                    success: true,
                    duplicate: true,
                    transactionId:
                        normalizedTransactionId,
                    ledgerId:
                        existingReference._id,
                    entry:
                        existingReference,
                };

            }

        }

        // --------------------------------------------------------------------
        // Construct immutable financial payload.
        // --------------------------------------------------------------------

        const ledgerPayload = {

            tenantId:
                normalizedTenantId,

            transactionId:
                normalizedTransactionId,

            debitAccount:
                normalizedDebitAccount,

            creditAccount:
                normalizedCreditAccount,

            amount:
                normalizedAmount,

            currency:
                normalizedCurrency,

            status,

            ...(normalizedReference
                ? {
                    reference:
                        normalizedReference,
                }
                : {}),

            ...(normalizedDescription
                ? {
                    description:
                        normalizedDescription,
                }
                : {}),

            metadata:
                Object.freeze({
                    ...metadata,
                }),

        };

        // --------------------------------------------------------------------
        // Persist atomically.
        // --------------------------------------------------------------------

        const created =
            await Ledger.create(
                [ledgerPayload],
                {
                    session,
                }
            );

        const entry =
            created[0];

        // --------------------------------------------------------------------
        // Commit only when this service owns the transaction.
        // --------------------------------------------------------------------

        if (ownsSession) {

            await session.commitTransaction();

        }

        return {

            success:
                true,

            duplicate:
                false,

            transactionId:
                normalizedTransactionId,

            ledgerId:
                entry._id,

            entry,

        };

    }
    catch (error) {

        if (
            ownsSession &&
            session
        ) {

            try {

                await session.abortTransaction();

            }
            catch (abortError) {

                //
                // Preserve the original financial error.
                // The abort error should not hide the root cause.
                //

                error.abortError =
                    abortError;

            }

        }

        // --------------------------------------------------------------------
        // Convert Mongo duplicate-key errors into deterministic idempotency
        // semantics.
        // --------------------------------------------------------------------

        if (
            error &&
            error.code === 11000
        ) {

            throw new LedgerServiceError(
                'Duplicate ledger posting detected',
                {
                    code: 'DUPLICATE_LEDGER_POSTING',
                    details: {
                        tenantId:
                            normalizedTenantId,

                        transactionId:
                            normalizedTransactionId,

                        reference:
                            normalizedReference,
                    },
                    cause:
                        error,
                }
            );

        }

        if (
            error instanceof LedgerServiceError
        ) {

            throw error;

        }

        throw new LedgerServiceError(
            'Failed to post double-entry ledger transaction',
            {
                code: 'LEDGER_POSTING_FAILED',
                details: {
                    tenantId:
                        normalizedTenantId,

                    transactionId:
                        normalizedTransactionId,

                    reference:
                        normalizedReference,

                    originalError:
                        error?.message,
                },
                cause:
                    error,
            }
        );

    }
    finally {

        if (
            ownsSession &&
            session
        ) {

            try {

                await session.endSession();

            }
            catch (endError) {

                //
                // Session cleanup errors should not replace a successful
                // financial result or the original posting exception.
                //
            }

        }

    }

}


// ============================================================================
// Find Ledger Entry
// ============================================================================
//
// Tenant-aware lookup.
//
// ============================================================================

async function findLedgerEntry({

    tenantId,
    transactionId,
    reference = null,

} = {}) {

    const normalizedTenantId =
        requireNonEmptyString(
            tenantId,
            'TenantId'
        );

    if (
        !transactionId &&
        !reference
    ) {

        throw new LedgerServiceError(
            'TransactionId or reference is required',
            {
                code: 'INVALID_LEDGER_LOOKUP',
            }
        );

    }

    const query = {

        tenantId:
            normalizedTenantId,

        deletedAt:
            null,

    };

    if (transactionId) {

        query.transactionId =
            requireNonEmptyString(
                transactionId,
                'TransactionId'
            );

    }
    else {

        query.reference =
            requireNonEmptyString(
                reference,
                'Reference',
                MAX_REFERENCE_LENGTH
            );

    }

    try {

        return await Ledger.findOne(
            query
        )
            .lean();

    }
    catch (error) {

        throw new LedgerServiceError(
            'Failed to retrieve ledger entry',
            {
                code: 'LEDGER_LOOKUP_FAILED',
                details: {
                    tenantId:
                        normalizedTenantId,

                    transactionId:
                        transactionId || null,

                    reference:
                        reference || null,
                },
                cause:
                    error,
            }
        );

    }

}


// ============================================================================
// Get Tenant Ledger Entries
// ============================================================================

async function findByTenant({

    tenantId,
    filters = {},
    limit = 100,
    skip = 0,

} = {}) {

    const normalizedTenantId =
        requireNonEmptyString(
            tenantId,
            'TenantId'
        );

    const safeLimit =
        Math.min(
            Math.max(
                Number(limit) || 100,
                1
            ),
            1000
        );

    const safeSkip =
        Math.max(
            Number(skip) || 0,
            0
        );

    const query = {

        tenantId:
            normalizedTenantId,

        deletedAt:
            null,

        ...(filters || {}),

    };

    try {

        return await Ledger.find(
            query
        )
            .sort({
                createdAt: -1,
                _id: -1,
            })
            .skip(safeSkip)
            .limit(safeLimit)
            .lean();

    }
    catch (error) {

        throw new LedgerServiceError(
            'Failed to retrieve tenant ledger entries',
            {
                code: 'LEDGER_QUERY_FAILED',
                details: {
                    tenantId:
                        normalizedTenantId,

                    limit:
                        safeLimit,

                    skip:
                        safeSkip,
                },
                cause:
                    error,
            }
        );

    }

}


// ============================================================================
// Cancel Ledger Entry
// ============================================================================
//
// Ledger records are not physically deleted.
//
// Financial records should remain auditable.
//
// ============================================================================

async function cancelLedgerEntry({

    tenantId,
    transactionId,
    reason = 'Ledger entry canceled',
    session: externalSession = null,

} = {}) {

    const normalizedTenantId =
        requireNonEmptyString(
            tenantId,
            'TenantId'
        );

    const normalizedTransactionId =
        requireNonEmptyString(
            transactionId,
            'TransactionId'
        );

    let session =
        externalSession;

    let ownsSession =
        false;

    try {

        if (!session) {

            session =
                await mongoose.startSession();

            ownsSession =
                true;

        }

        if (!isSessionUsable(session)) {

            throw new LedgerServiceError(
                'Invalid MongoDB session',
                {
                    code: 'INVALID_DATABASE_SESSION',
                }
            );

        }

        if (ownsSession) {

            session.startTransaction();

        }

        const entry =
            await Ledger.findOneAndUpdate(
                {
                    tenantId:
                        normalizedTenantId,

                    transactionId:
                        normalizedTransactionId,

                    deletedAt:
                        null,

                    status:
                        {
                            $ne:
                                LEDGER_STATUS.CANCELED,
                        },
                },
                {
                    $set: {
                        status:
                            LEDGER_STATUS.CANCELED,

                        'metadata.cancellationReason':
                            String(reason)
                                .trim()
                                .slice(0, 1024),

                        'metadata.canceledAt':
                            new Date(),
                    },
                },
                {
                    new: true,
                    session,
                }
            );

        if (!entry) {

            throw new LedgerServiceError(
                'Ledger entry not found or already canceled',
                {
                    code: 'LEDGER_ENTRY_NOT_FOUND',
                    details: {
                        tenantId:
                            normalizedTenantId,

                        transactionId:
                            normalizedTransactionId,
                    },
                }
            );

        }

        if (ownsSession) {

            await session.commitTransaction();

        }

        return {

            success:
                true,

            transactionId:
                normalizedTransactionId,

            ledgerId:
                entry._id,

            entry,

        };

    }
    catch (error) {

        if (
            ownsSession &&
            session
        ) {

            try {

                await session.abortTransaction();

            }
            catch (abortError) {

                error.abortError =
                    abortError;

            }

        }

        if (
            error instanceof LedgerServiceError
        ) {

            throw error;

        }

        throw new LedgerServiceError(
            'Failed to cancel ledger entry',
            {
                code: 'LEDGER_CANCELLATION_FAILED',
                details: {
                    tenantId:
                        normalizedTenantId,

                    transactionId:
                        normalizedTransactionId,

                    originalError:
                        error?.message,
                },
                cause:
                    error,
            }
        );

    }
    finally {

        if (
            ownsSession &&
            session
        ) {

            try {

                await session.endSession();

            }
            catch (error) {
                // Intentionally ignored during cleanup.
            }

        }

    }

}


// ============================================================================
// Verify Ledger Balance
// ============================================================================
//
// For the current Ledger representation, every posted record is intrinsically
// balanced because the same amount is represented on both sides.
//
// This method provides a service-level invariant check and is intentionally
// conservative.
//
// ============================================================================

function verifyBalancedEntry(entry) {

    if (!entry) {

        throw new LedgerServiceError(
            'Ledger entry required',
            {
                code: 'INVALID_LEDGER_ENTRY',
            }
        );

    }

    if (
        !entry.debitAccount ||
        !entry.creditAccount
    ) {

        throw new LedgerServiceError(
            'Ledger entry must contain debit and credit accounts',
            {
                code: 'LEDGER_INVARIANT_FAILED',
            }
        );

    }

    if (
        entry.debitAccount ===
        entry.creditAccount
    ) {

        throw new LedgerServiceError(
            'Ledger debit and credit accounts cannot be identical',
            {
                code: 'LEDGER_INVARIANT_FAILED',
            }
        );

    }

    const amount =
        entry.amount?.toString
            ? entry.amount.toString()
            : String(entry.amount);

    if (
        !/^\d+(?:\.\d+)?$/.test(amount) ||
        Number(amount) <= 0
    ) {

        throw new LedgerServiceError(
            'Ledger amount is invalid',
            {
                code: 'LEDGER_INVARIANT_FAILED',
            }
        );

    }

    return true;

}


// ============================================================================
// Public API
// ============================================================================

module.exports = {

    postDoubleEntry,

    findLedgerEntry,

    findByTenant,

    cancelLedgerEntry,

    verifyBalancedEntry,

    LedgerServiceError,

    LEDGER_STATUS,

};