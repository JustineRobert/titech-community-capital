/**
 * ============================================================================
 * TITech Community Capital LTD
 * StatementNormalizer.js
 * ============================================================================
 *
 * Enterprise Statement Normalization Service
 *
 * Responsibilities:
 *
 * - Convert imported statement payloads into canonical financial format.
 * - Normalize transaction fields across providers.
 * - Enforce consistent data types.
 * - Normalize monetary values safely.
 * - Normalize dates consistently.
 * - Normalize transaction direction/type.
 * - Prepare statements for validation, persistence, and reconciliation.
 * - Remove provider-specific payload differences.
 * - Generate deterministic normalization fingerprints.
 * - Preserve tenant and processing context.
 *
 * Pipeline Position:
 *
 * Raw Statement
 *      |
 *      v
 * StatementImporter
 *      |
 *      v
 * StatementNormalizer
 *      |
 *      v
 * StatementValidator
 *      |
 *      v
 * StatementRepository
 *      |
 *      v
 * Ledger / Reconciliation
 *
 * Supported Sources:
 *
 * - BANK
 * - MTN_MOMO
 * - AIRTEL_MONEY
 * - MANUAL
 * - API
 *
 * Design Principles:
 *
 * - Deterministic transformation.
 * - No persistence logic.
 * - No external dependencies.
 * - Provider agnostic.
 * - Financial precision aware.
 * - Immutable output.
 * - Audit ready.
 * - Multi-tenant aware.
 * - Reconciliation ready.
 *
 * ============================================================================
 */

'use strict';

const crypto = require('crypto');

const {
    StatementValidationError
} = require('./StatementErrors');

/**
 * ============================================================================
 * Normalization Constants
 * ============================================================================
 */

const DEFAULT_CURRENCY = 'UGX';

const NORMALIZED_STATUS = 'NORMALIZED';

const TRANSACTION_TYPE = Object.freeze({

    CREDIT: 'CREDIT',

    DEBIT: 'DEBIT'

});

/**
 * ============================================================================
 * Supported Statement Sources
 * ============================================================================
 */

const SUPPORTED_SOURCES = Object.freeze(new Set([

    'BANK',
    'MTN_MOMO',
    'AIRTEL_MONEY',
    'MANUAL',
    'API',
    'SYSTEM',
    'UNKNOWN'

]));

/**
 * ============================================================================
 * StatementNormalizer
 * ============================================================================
 */

class StatementNormalizer {

    /**
     * =========================================================================
     * Normalize Statement
     * =========================================================================
     *
     * Converts an imported statement into the canonical internal format.
     *
     * @param {Object} statement
     * @returns {Object}
     */

    normalize(statement) {

        try {

            this.validateStatement(statement);

            const normalizedTransactions =
                statement.transactions.map(
                    (transaction, index) =>
                        this.normalizeTransaction(
                            transaction,
                            {
                                index,
                                defaultCurrency:
                                    statement.currency
                            }
                        )
                );

            const normalizedAt =
                new Date();

            const normalized = {

                /*
                 * Preserve imported statement fields while replacing
                 * provider-specific transaction payloads.
                 */
                ...statement,

                /*
                 * Canonical statement identity.
                 */
                tenantId:
                    this.normalizeIdentifier(
                        statement.tenantId,
                        'tenantId',
                        false
                    ),

                statementId:
                    this.normalizeIdentifier(
                        statement.statementId,
                        'statementId',
                        false
                    ),

                source:
                    this.normalizeSource(
                        statement.source
                    ),

                currency:
                    this.normalizeCurrency(
                        statement.currency ||
                        DEFAULT_CURRENCY
                    ),

                /*
                 * Canonical period boundaries.
                 */
                periodStart:
                    this.normalizeDate(
                        statement.periodStart,
                        {
                            fieldName:
                                'periodStart'
                        }
                    ),

                periodEnd:
                    this.normalizeDate(
                        statement.periodEnd,
                        {
                            fieldName:
                                'periodEnd'
                        }
                    ),

                /*
                 * Canonical transaction collection.
                 */
                transactions:
                    normalizedTransactions,

                transactionCount:
                    normalizedTransactions.length,

                /*
                 * Lifecycle metadata.
                 */
                status:
                    NORMALIZED_STATUS,

                normalized:
                    true,

                normalizedAt,

                /*
                 * Deterministic normalization fingerprint.
                 *
                 * This does not replace statementId. It provides an
                 * audit/reconciliation fingerprint of the canonical form.
                 */
                normalizationHash:
                    this.generateNormalizationHash(
                        normalizedTransactions
                    ),

                /*
                 * Provider metadata is preserved but isolated.
                 */
                metadata:
                    this.cloneMetadata(
                        statement.metadata
                    )

            };

            /*
             * Enforce period consistency after normalization.
             */
            this.validatePeriod(
                normalized.periodStart,
                normalized.periodEnd
            );

            /*
             * Deep freeze prevents accidental mutation of nested
             * transaction and metadata structures.
             */
            return this.deepFreeze(
                normalized
            );

        } catch (error) {

            if (
                error instanceof StatementValidationError
            ) {

                throw error;

            }

            throw new StatementValidationError(

                'Failed to normalize statement',

                {

                    originalError:
                        error?.message ||
                        String(error),

                    statementId:
                        statement?.statementId ||
                        null

                },

                {

                    cause:
                        error,

                    retryable:
                        false

                }

            );

        }

    }

    /**
     * =========================================================================
     * Normalize Individual Transaction
     * =========================================================================
     *
     * Converts provider transaction formats into a canonical representation.
     *
     * @param {Object} tx
     * @param {Object} options
     * @returns {Object}
     */

    normalizeTransaction(

        tx = {},

        {
            index = 0,
            defaultCurrency = DEFAULT_CURRENCY
        } = {}

    ) {

        if (
            !tx ||
            typeof tx !== 'object' ||
            Array.isArray(tx)
        ) {

            throw new StatementValidationError(

                'Invalid transaction payload',

                {

                    transactionIndex:
                        index,

                    transaction:
                        tx

                },

                {

                    retryable:
                        false

                }

            );

        }

        const externalId =
            this.normalizeIdentifier(
                tx.externalId ||
                tx.id ||
                tx.transactionId,
                'externalId',
                false
            );

        const amount =
            this.normalizeAmount(
                tx.amount
            );

        const currency =
            this.normalizeCurrency(
                tx.currency ||
                defaultCurrency ||
                DEFAULT_CURRENCY
            );

        const transactionDate =
            this.normalizeDate(

                tx.transactionDate ||
                tx.date ||
                tx.timestamp,

                {
                    fieldName:
                        'transactionDate'
                }

            );

        const type =
            this.normalizeTransactionType(
                tx.type ||
                tx.direction ||
                tx.transactionType
            );

        const reference =
            this.normalizeNullableString(
                tx.reference
            );

        const description =
            this.normalizeNullableString(
                tx.description ||
                tx.narration ||
                tx.memo
            );

        const metadata =
            this.cloneMetadata(
                tx.metadata
            );

        /*
         * Preserve selected provider-specific fields without allowing
         * them to override canonical fields.
         */
        const providerReference =
            this.normalizeNullableString(
                tx.providerReference ||
                tx.providerTransactionId
            );

        const normalizedTransaction = {

            /*
             * Provider transaction identity.
             */
            externalId,

            /*
             * Financial value.
             */
            amount,

            currency,

            /*
             * Temporal identity.
             */
            transactionDate,

            /*
             * Canonical semantic fields.
             */
            description,

            type,

            reference,

            providerReference,

            /*
             * Preserve provider-specific metadata.
             */
            metadata

        };

        /*
         * Generate a deterministic transaction fingerprint.
         */
        normalizedTransaction.transactionHash =
            this.generateTransactionHash(
                normalizedTransaction
            );

        return normalizedTransaction;

    }

    /**
     * =========================================================================
     * Normalize Amount
     * =========================================================================
     *
     * Financial amounts must be finite numeric values.
     *
     * Important:
     *
     * Number("1,000") is not safely interpreted as 1000.
     * Number("") becomes 0.
     * Number(null) becomes 0.
     *
     * Those implicit conversions are unacceptable in a financial pipeline.
     */

    normalizeAmount(amount) {

        if (
            amount === null ||
            amount === undefined ||
            amount === ''
        ) {

            throw new StatementValidationError(

                'Transaction amount is required',

                {

                    amount

                },

                {

                    retryable:
                        false

                }

            );

        }

        let value;

        if (
            typeof amount === 'number'
        ) {

            value = amount;

        } else if (
            typeof amount === 'string'
        ) {

            const normalized =
                amount
                    .trim()
                    .replace(/,/g, '');

            if (!normalized) {

                throw new StatementValidationError(

                    'Invalid transaction amount',

                    {

                        amount

                    }

                );

            }

            value =
                Number(normalized);

        } else {

            throw new StatementValidationError(

                'Invalid transaction amount type',

                {

                    amount,

                    type:
                        typeof amount

                }

            );

        }

        if (
            !Number.isFinite(value)
        ) {

            throw new StatementValidationError(

                'Invalid transaction amount',

                {

                    amount

                }

            );

        }

        /*
         * Prevent silent financial precision beyond two decimal places.
         */
        const rounded =
            Number(
                value.toFixed(2)
            );

        if (
            !Number.isFinite(rounded)
        ) {

            throw new StatementValidationError(

                'Transaction amount exceeds supported numeric precision',

                {

                    amount

                }

            );

        }

        return rounded;

    }

    /**
     * =========================================================================
     * Normalize Currency
     * =========================================================================
     */

    normalizeCurrency(currency) {

        if (
            currency === null ||
            currency === undefined ||
            currency === ''
        ) {

            return DEFAULT_CURRENCY;

        }

        if (
            typeof currency !== 'string'
        ) {

            throw new StatementValidationError(

                'Invalid currency',

                {

                    currency

                }

            );

        }

        const normalized =
            currency
                .trim()
                .toUpperCase();

        /*
         * ISO 4217 currencies use three alphabetic characters.
         */
        if (
            !/^[A-Z]{3}$/.test(
                normalized
            )
        ) {

            throw new StatementValidationError(

                'Invalid currency format',

                {

                    currency

                }

            );

        }

        return normalized;

    }

    /**
     * =========================================================================
     * Normalize Date
     * =========================================================================
     */

    normalizeDate(

        date,

        {
            fieldName = 'date'
        } = {}

    ) {

        if (
            date === null ||
            date === undefined ||
            date === ''
        ) {

            return null;

        }

        const parsed =
            date instanceof Date
                ? new Date(
                    date.getTime()
                )
                : new Date(date);

        if (
            Number.isNaN(
                parsed.getTime()
            )
        ) {

            throw new StatementValidationError(

                `Invalid ${fieldName}`,

                {

                    field:
                        fieldName,

                    value:
                        date

                }

            );

        }

        return parsed;

    }

    /**
     * =========================================================================
     * Normalize Transaction Type
     * =========================================================================
     */

    normalizeTransactionType(type) {

        if (
            type === null ||
            type === undefined ||
            type === ''
        ) {

            return null;

        }

        if (
            typeof type !== 'string'
        ) {

            throw new StatementValidationError(

                'Invalid transaction type',

                {

                    type

                }

            );

        }

        const normalized =
            type
                .trim()
                .toUpperCase();

        const aliases = {

            CREDIT:
                TRANSACTION_TYPE.CREDIT,

            CR:
                TRANSACTION_TYPE.CREDIT,

            C:
                TRANSACTION_TYPE.CREDIT,

            DEPOSIT:
                TRANSACTION_TYPE.CREDIT,

            IN:
                TRANSACTION_TYPE.CREDIT,

            DEBIT:
                TRANSACTION_TYPE.DEBIT,

            DR:
                TRANSACTION_TYPE.DEBIT,

            D:
                TRANSACTION_TYPE.DEBIT,

            WITHDRAWAL:
                TRANSACTION_TYPE.DEBIT,

            OUT:
                TRANSACTION_TYPE.DEBIT

        };

        if (
            !aliases[normalized]
        ) {

            throw new StatementValidationError(

                'Unsupported transaction type',

                {

                    type,

                    supportedTypes:
                        Object.values(
                            TRANSACTION_TYPE
                        )

                }

            );

        }

        return aliases[normalized];

    }

    /**
     * =========================================================================
     * Normalize Source
     * =========================================================================
     */

    normalizeSource(source) {

        if (
            source === null ||
            source === undefined ||
            source === ''
        ) {

            return 'UNKNOWN';

        }

        if (
            typeof source !== 'string'
        ) {

            throw new StatementValidationError(

                'Invalid statement source',

                {

                    source

                }

            );

        }

        const normalized =
            source
                .trim()
                .toUpperCase();

        if (
            !SUPPORTED_SOURCES.has(
                normalized
            )
        ) {

            /*
             * Do not reject future providers outright.
             *
             * The normalizer is provider agnostic. Unknown providers can
             * continue through normalization while the validator/provider
             * adapter decides whether they are supported operationally.
             */
            return normalized;

        }

        return normalized;

    }

    /**
     * =========================================================================
     * Normalize Identifier
     * =========================================================================
     */

    normalizeIdentifier(

        value,

        fieldName,

        required = false

    ) {

        if (
            value === null ||
            value === undefined
        ) {

            if (required) {

                throw new StatementValidationError(

                    `${fieldName} is required`,

                    {

                        field:
                            fieldName

                    }

                );

            }

            return null;

        }

        if (
            typeof value !== 'string' &&
            typeof value !== 'number'
        ) {

            throw new StatementValidationError(

                `Invalid ${fieldName}`,

                {

                    field:
                        fieldName,

                    value

                }

            );

        }

        const normalized =
            String(value).trim();

        if (
            !normalized
        ) {

            if (required) {

                throw new StatementValidationError(

                    `${fieldName} is required`,

                    {

                        field:
                            fieldName

                    }

                );

            }

            return null;

        }

        return normalized;

    }

    /**
     * =========================================================================
     * Normalize Nullable String
     * =========================================================================
     */

    normalizeNullableString(value) {

        if (
            value === null ||
            value === undefined
        ) {

            return null;

        }

        if (
            typeof value !== 'string' &&
            typeof value !== 'number'
        ) {

            throw new StatementValidationError(

                'Invalid string field',

                {

                    value

                }

            );

        }

        const normalized =
            String(value).trim();

        return normalized || null;

    }

    /**
     * =========================================================================
     * Validate Statement
     * =========================================================================
     */

    validateStatement(statement) {

        if (
            !statement ||
            typeof statement !== 'object' ||
            Array.isArray(statement)
        ) {

            throw new StatementValidationError(

                'Statement required',

                {

                    reason:
                        'INVALID_STATEMENT'

                }

            );

        }

        if (
            !Array.isArray(
                statement.transactions
            )
        ) {

            throw new StatementValidationError(

                'Statement transactions must be an array',

                {

                    transactions:
                        statement.transactions

                }

            );

        }

        /*
         * Tenant ownership must survive normalization.
         */
        if (
            statement.tenantId === undefined ||
            statement.tenantId === null ||
            String(
                statement.tenantId
            ).trim() === ''
        ) {

            throw new StatementValidationError(

                'Statement tenantId is required',

                {

                    reason:
                        'MISSING_TENANT'

                }

            );

        }

        /*
         * Statement identity is expected from StatementImporter.
         */
        if (
            statement.statementId === undefined ||
            statement.statementId === null ||
            String(
                statement.statementId
            ).trim() === ''
        ) {

            throw new StatementValidationError(

                'Statement statementId is required',

                {

                    reason:
                        'MISSING_STATEMENT_ID'

                }

            );

        }

        return true;

    }

    /**
     * =========================================================================
     * Validate Statement Period
     * =========================================================================
     */

    validatePeriod(
        periodStart,
        periodEnd
    ) {

        if (
            !periodStart ||
            !periodEnd
        ) {

            return true;

        }

        if (
            periodStart.getTime() >
            periodEnd.getTime()
        ) {

            throw new StatementValidationError(

                'Statement period start cannot be after period end',

                {

                    periodStart,

                    periodEnd

                }

            );

        }

        return true;

    }

    /**
     * =========================================================================
     * Clone Metadata
     * =========================================================================
     *
     * Metadata is intentionally treated as opaque provider/audit data.
     */

    cloneMetadata(metadata) {

        if (
            metadata === null ||
            metadata === undefined
        ) {

            return Object.freeze({});

        }

        if (
            typeof metadata !== 'object' ||
            Array.isArray(metadata)
        ) {

            throw new StatementValidationError(

                'Statement metadata must be an object',

                {

                    metadata

                }

            );

        }

        return this.deepFreeze({
            ...metadata
        });

    }

    /**
     * =========================================================================
     * Generate Transaction Hash
     * =========================================================================
     *
     * Deterministic canonical transaction fingerprint.
     */

    generateTransactionHash(transaction) {

        const identity = [

            transaction.externalId || '',

            transaction.amount,

            transaction.currency,

            transaction.transactionDate
                ? transaction.transactionDate
                    .toISOString()
                : '',

            transaction.type || '',

            transaction.reference || '',

            transaction.providerReference || '',

            transaction.description || ''

        ].join('|');

        return crypto
            .createHash('sha256')
            .update(identity, 'utf8')
            .digest('hex');

    }

    /**
     * =========================================================================
     * Generate Normalization Hash
     * =========================================================================
     *
     * Represents the canonical transaction collection.
     */

    generateNormalizationHash(
        transactions = []
    ) {

        const canonical =
            transactions
                .map(transaction => ({

                    externalId:
                        transaction.externalId,

                    amount:
                        transaction.amount,

                    currency:
                        transaction.currency,

                    transactionDate:
                        transaction.transactionDate
                            ? transaction
                                .transactionDate
                                .toISOString()
                            : null,

                    type:
                        transaction.type,

                    reference:
                        transaction.reference,

                    providerReference:
                        transaction.providerReference,

                    description:
                        transaction.description,

                    transactionHash:
                        transaction.transactionHash

                }))
                .sort(
                    (a, b) =>
                        String(
                            a.transactionHash
                        ).localeCompare(
                            String(
                                b.transactionHash
                            )
                        )
                );

        return crypto
            .createHash('sha256')
            .update(
                JSON.stringify(canonical),
                'utf8'
            )
            .digest('hex');

    }

    /**
     * =========================================================================
     * Deep Freeze
     * =========================================================================
     *
     * Prevents downstream services from mutating normalized financial data.
     */

    deepFreeze(object) {

        if (
            !object ||
            typeof object !== 'object' ||
            Object.isFrozen(object)
        ) {

            return object;

        }

        Object.getOwnPropertyNames(object)
            .forEach(property => {

                const value =
                    object[property];

                if (
                    value &&
                    typeof value === 'object' &&
                    !Object.isFrozen(value)
                ) {

                    this.deepFreeze(value);

                }

            });

        return Object.freeze(object);

    }

}

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports =
    StatementNormalizer;

module.exports.TRANSACTION_TYPE =
    TRANSACTION_TYPE;

module.exports.SUPPORTED_SOURCES =
    SUPPORTED_SOURCES;