'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Transaction Service
 * ============================================================================
 *
 * File:
 *   services/transactionService.js
 *
 * Purpose
 * -------
 * Application service responsible for creating a business transaction and
 * atomically coordinating its corresponding double-entry ledger posting.
 *
 * Responsibilities
 * ----------------
 * • Validate transaction input
 * • Enforce tenant isolation
 * • Perform fast-path idempotency lookup
 * • Protect against idempotency races
 * • Create Transaction record
 * • Invoke Ledger Engine inside the same MongoDB session
 * • Complete Transaction lifecycle
 * • Commit/rollback atomically
 * • Preserve correlation/request identity
 * • Preserve monetary precision
 * • Support provider/payment context
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • Direct account balance mutation
 * • Double-entry accounting logic
 * • AML screening
 * • Fraud screening
 * • KYC
 * • Compliance decisions
 * • Payment-provider HTTP communication
 *
 * Financial Invariant
 * -------------------
 * A successful financial transaction must have:
 *
 *   Transaction
 *        +
 *   Double-entry ledger posting
 *
 * committed in the SAME MongoDB transaction.
 *
 * ============================================================================
 */

const mongoose =
    require('mongoose');

const Transaction =
    require('../models/Transaction');

const {
    postDoubleEntry
} = require('../ledger/ledger.service');


/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const DUPLICATE_KEY_ERROR_CODE =
    11000;

const DEFAULT_CURRENCY =
    'UGX';

const MAX_TRANSACTION_RETRIES =
    3;


/**
 * ============================================================================
 * Helpers
 * ============================================================================
 */

function normalizeRequiredString(
    value,
    field
) {

    if (
        typeof value !== 'string' ||
        value.trim() === ''
    ) {

        throw new TypeError(
            `${field} is required`
        );

    }

    return value.trim();

}


function normalizeOptionalString(
    value
) {

    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {

        return null;

    }

    if (
        typeof value !== 'string'
    ) {

        throw new TypeError(
            'Optional value must be a string'
        );

    }

    return value.trim() || null;

}


function normalizeAmount(
    value
) {

    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {

        throw new TypeError(
            'Amount is required'
        );

    }

    let decimal;


    try {

        decimal =
            value instanceof mongoose.Types.Decimal128
                ? value
                : mongoose.Types.Decimal128.fromString(
                    String(value).trim()
                );

    }
    catch (_) {

        throw new TypeError(
            'Amount must be a valid decimal monetary value'
        );

    }


    const text =
        decimal.toString();


    if (
        text === 'NaN' ||
        text === 'Infinity' ||
        text === '-Infinity'
    ) {

        throw new TypeError(
            'Amount must be a finite monetary value'
        );

    }


    if (
        text.startsWith('-') ||
        text === '0'
    ) {

        throw new RangeError(
            'Amount must be positive'
        );

    }


    /**
     * Decimal128.fromString() accepts scientific notation.
     * That is valid internally, but the domain is still a positive amount.
     */
    return decimal;

}


function normalizeCurrency(
    value
) {

    const currency =
        String(
            value ||
            DEFAULT_CURRENCY
        )
            .trim()
            .toUpperCase();


    if (
        !/^[A-Z]{3}$/.test(
            currency
        )
    ) {

        throw new TypeError(
            'Currency must be a valid 3-letter code'
        );

    }


    return currency;

}


function isDuplicateKeyError(
    error
) {

    return (
        error?.code ===
        DUPLICATE_KEY_ERROR_CODE
    );

}


function isTransientTransactionError(
    error
) {

    if (!error) {
        return false;
    }


    if (
        typeof error.hasErrorLabel ===
        'function'
    ) {

        return (
            error.hasErrorLabel(
                'TransientTransactionError'
            ) ||
            error.hasErrorLabel(
                'UnknownTransactionCommitResult'
            )
        );

    }


    return false;

}


function safeError(
    error
) {

    if (!error) {

        return {
            message:
                'Unknown error'
        };

    }


    return {

        name:
            error.name,

        code:
            error.code,

        message:
            String(
                error.message ||
                error
            )
                .slice(
                    0,
                    1000
                )

    };

}


/**
 * ============================================================================
 * Input Validation
 * ============================================================================
 */

function validateCreateTransactionInput({
    tenantId,
    type,
    amount,
    idempotencyKey
}) {

    normalizeRequiredString(
        tenantId,
        'TenantId'
    );

    normalizeRequiredString(
        type,
        'Transaction type'
    );

    normalizeRequiredString(
        idempotencyKey,
        'IdempotencyKey'
    );

    normalizeAmount(
        amount
    );

    return true;

}


/**
 * ============================================================================
 * Existing Transaction Lookup
 * ============================================================================
 */

async function findExistingTransaction({
    tenantId,
    idempotencyKey
}) {

    return Transaction
        .findOne({
            tenantId,
            idempotencyKey
        })
        .exec();

}


/**
 * ============================================================================
 * Main Transaction Service
 * ============================================================================
 */

async function createTransaction({

    tenantId,

    type,

    amount,

    idempotencyKey,

    currency =
        DEFAULT_CURRENCY,

    reference = null,

    description = null,

    customerId = null,

    userId = null,

    provider = null,

    providerTransactionId = null,

    operation = null,

    correlationId = null,

    requestId = null,

    debitAccountId =
        'cash_account',

    creditAccountId =
        'user_wallet',

    fraudScreeningId = null,

    amlScreeningId = null,

    complianceDecisionId = null,

    riskDecision = null,

    metadata = {}

} = {}) {

    /**
     * ------------------------------------------------------------------------
     * Validate before opening a database session.
     * ------------------------------------------------------------------------
     */

    validateCreateTransactionInput({

        tenantId,

        type,

        amount,

        idempotencyKey

    });


    const normalizedTenantId =
        tenantId.trim();


    const normalizedType =
        type.trim().toLowerCase();


    const normalizedAmount =
        normalizeAmount(
            amount
        );


    const normalizedCurrency =
        normalizeCurrency(
            currency
        );


    const normalizedIdempotencyKey =
        idempotencyKey.trim();


    const normalizedReference =
        normalizeOptionalString(
            reference
        );


    const normalizedDescription =
        normalizeOptionalString(
            description
        );


    const normalizedCustomerId =
        normalizeOptionalString(
            customerId
        );


    const normalizedUserId =
        normalizeOptionalString(
            userId
        );


    const normalizedProvider =
        normalizeOptionalString(
            provider
        )?.toUpperCase() ||
        null;


    const normalizedProviderTransactionId =
        normalizeOptionalString(
            providerTransactionId
        );


    const normalizedOperation =
        normalizeOptionalString(
            operation
        )?.toUpperCase() ||
        null;


    const normalizedCorrelationId =
        normalizeOptionalString(
            correlationId
        ) ||
        new mongoose.Types.ObjectId().toString();


    const normalizedRequestId =
        normalizeOptionalString(
            requestId
        );


    const normalizedDebitAccountId =
        normalizeRequiredString(
            debitAccountId,
            'Debit account'
        );


    const normalizedCreditAccountId =
        normalizeRequiredString(
            creditAccountId,
            'Credit account'
        );


    if (
        normalizedDebitAccountId ===
        normalizedCreditAccountId
    ) {

        throw new Error(
            'Debit and credit accounts must be different'
        );

    }


    /**
     * ------------------------------------------------------------------------
     * Fast-path idempotency lookup.
     * ------------------------------------------------------------------------
     *
     * This avoids opening a MongoDB transaction for an already-completed
     * request.
     */

    const existing =
        await findExistingTransaction({

            tenantId:
                normalizedTenantId,

            idempotencyKey:
                normalizedIdempotencyKey

        });


    if (existing) {

        return existing;

    }


    /**
     * ------------------------------------------------------------------------
     * Retry transaction only for transient MongoDB transaction failures.
     * ------------------------------------------------------------------------
     */

    let attempt =
        0;


    while (
        attempt <
        MAX_TRANSACTION_RETRIES
    ) {

        attempt++;


        const session =
            await mongoose.startSession();


        let committed =
            false;


        try {

            /**
             * --------------------------------------------------------------
             * Start MongoDB transaction
             * --------------------------------------------------------------
             */

            session.startTransaction();


            /**
             * --------------------------------------------------------------
             * Create business transaction
             * --------------------------------------------------------------
             */

            const created =
                await Transaction.create(

                    [{

                        tenantId:
                            normalizedTenantId,

                        type:
                            normalizedType,

                        amount:
                            normalizedAmount,

                        currency:
                            normalizedCurrency,

                        idempotencyKey:
                            normalizedIdempotencyKey,

                        reference:
                            normalizedReference,

                        description:
                            normalizedDescription,

                        customerId:
                            normalizedCustomerId,

                        userId:
                            normalizedUserId,

                        provider:
                            normalizedProvider,

                        providerTransactionId:
                            normalizedProviderTransactionId,

                        operation:
                            normalizedOperation,

                        correlationId:
                            normalizedCorrelationId,

                        requestId:
                            normalizedRequestId,

                        debitAccountId:
                            normalizedDebitAccountId,

                        creditAccountId:
                            normalizedCreditAccountId,

                        fraudScreeningId:
                            normalizeOptionalString(
                                fraudScreeningId
                            ),

                        amlScreeningId:
                            normalizeOptionalString(
                                amlScreeningId
                            ),

                        complianceDecisionId:
                            normalizeOptionalString(
                                complianceDecisionId
                            ),

                        riskDecision:
                            riskDecision || undefined,

                        metadata:
                            metadata &&
                            typeof metadata === 'object'
                                ? {
                                    ...metadata
                                }
                                : {}

                    }],

                    {
                        session
                    }

                );


            const transaction =
                created[0];


            if (!transaction) {

                throw new Error(
                    'Transaction creation returned no document'
                );

            }


            /**
             * --------------------------------------------------------------
             * Business transaction identity
             * --------------------------------------------------------------
             *
             * The ledger should reference transaction.transactionId rather
             * than Mongo's internal _id wherever the ledger contract permits.
             */

            const businessTransactionId =
                transaction.transactionId ||
                transaction._id.toString();


            /**
             * --------------------------------------------------------------
             * Double-entry ledger posting
             * --------------------------------------------------------------
             *
             * CRITICAL:
             *
             * The same MongoDB session MUST be propagated into the ledger
             * service.
             */

            await postDoubleEntry({

                tenantId:
                    normalizedTenantId,

                transactionId:
                    businessTransactionId,

                debitAccount:
                    normalizedDebitAccountId,

                creditAccount:
                    normalizedCreditAccountId,

                amount:
                    normalizedAmount,

                currency:
                    normalizedCurrency,

                correlationId:
                    normalizedCorrelationId,

                requestId:
                    normalizedRequestId,

                idempotencyKey:
                    normalizedIdempotencyKey,

                session

            });


            /**
             * --------------------------------------------------------------
             * Complete transaction
             * --------------------------------------------------------------
             */

            transaction.status =
                'completed';

            transaction.completedAt =
                new Date();


            /**
             * save({ session }) keeps the status transition inside
             * the same MongoDB transaction.
             */

            await transaction.save({

                session

            });


            /**
             * --------------------------------------------------------------
             * Commit
             * --------------------------------------------------------------
             */

            await session.commitTransaction();


            committed =
                true;


            return transaction;

        }
        catch (error) {

            /**
             * --------------------------------------------------------------
             * Duplicate idempotency race
             * --------------------------------------------------------------
             *
             * Another request may have passed the initial lookup first and
             * inserted the unique tenant/idempotency key concurrently.
             *
             * Do not expose Mongo's duplicate-key exception to the caller.
             */

            if (
                isDuplicateKeyError(
                    error
                )
            ) {

                try {

                    if (
                        session.inTransaction()
                    ) {

                        await session.abortTransaction();

                    }

                }
                catch (_) {
                    // Preserve duplicate-race handling.
                }


                const racedTransaction =
                    await findExistingTransaction({

                        tenantId:
                            normalizedTenantId,

                        idempotencyKey:
                            normalizedIdempotencyKey

                    });


                if (
                    racedTransaction
                ) {

                    return racedTransaction;

                }

            }


            /**
             * --------------------------------------------------------------
             * Rollback
             * --------------------------------------------------------------
             */

            if (
                !committed
            ) {

                try {

                    if (
                        session.inTransaction()
                    ) {

                        await session.abortTransaction();

                    }

                }
                catch (rollbackError) {

                    /**
                     * Rollback failure must not replace the original
                     * financial/database error.
                     *
                     * Log it through a non-fatal path if desired.
                     */
                    error.rollbackError =
                        safeError(
                            rollbackError
                        );

                }

            }


            /**
             * --------------------------------------------------------------
             * Retry only transient MongoDB transaction failures.
             * --------------------------------------------------------------
             */

            if (
                isTransientTransactionError(
                    error
                ) &&
                attempt <
                    MAX_TRANSACTION_RETRIES
            ) {

                continue;

            }


            throw error;

        }
        finally {

            /**
             * Always release the session and await completion.
             */
            try {

                await session.endSession();

            }
            catch (endSessionError) {

                /**
                 * Session cleanup failure must not overwrite a primary
                 * transaction error or committed result.
                 */
                if (committed) {

                    // Deliberately do not throw after a successful commit.

                }

            }

        }

    }


    throw new Error(
        'Transaction creation failed after maximum retry attempts'
    );

}


/**
 * ============================================================================
 * Find Transaction By Idempotency
 * ============================================================================
 */

async function findTransactionByIdempotencyKey({

    tenantId,

    idempotencyKey

}) {

    normalizeRequiredString(
        tenantId,
        'TenantId'
    );

    normalizeRequiredString(
        idempotencyKey,
        'IdempotencyKey'
    );


    return findExistingTransaction({

        tenantId:
            tenantId.trim(),

        idempotencyKey:
            idempotencyKey.trim()

    });

}


/**
 * ============================================================================
 * Find By Business Transaction ID
 * ============================================================================
 */

async function findTransactionById({

    tenantId,

    transactionId

}) {

    normalizeRequiredString(
        tenantId,
        'TenantId'
    );

    normalizeRequiredString(
        transactionId,
        'TransactionId'
    );


    return Transaction
        .findOne({

            tenantId:
                tenantId.trim(),

            transactionId:
                transactionId.trim()

        })
        .exec();

}


/**
 * ============================================================================
 * Service Health
 * ============================================================================
 */

function health() {

    return {

        service:
            'transaction-service',

        status:
            'UP',

        ledgerIntegration:
            true,

        transactionModel:
            Boolean(Transaction),

        generatedAt:
            new Date()

    };

}


/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports = {

    createTransaction,

    findTransactionByIdempotencyKey,

    findTransactionById,

    health

};