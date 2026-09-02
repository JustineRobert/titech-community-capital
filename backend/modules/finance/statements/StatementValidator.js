/**
 * ============================================================================
 * TITech Community Capital LTD
 * StatementValidator.js
 * ============================================================================
 *
 * Enterprise Statement Validation Service
 *
 * Responsibilities:
 *
 *  - Validate normalized financial statements.
 *  - Enforce transaction integrity rules.
 *  - Detect malformed financial data before persistence.
 *  - Detect duplicate transactions.
 *  - Validate tenant and statement identity.
 *  - Validate financial amounts, currencies, dates and references.
 *  - Produce structured validation results.
 *  - Support auditability and operational diagnostics.
 *  - Protect the pipeline from pathological payload sizes.
 *
 * Pipeline Position:
 *
 * StatementImporter
 *       |
 *       v
 * StatementNormalizer
 *       |
 *       v
 * StatementValidator
 *       |
 *       v
 * StatementRepository
 *       |
 *       v
 * Reconciliation / Ledger Posting
 *
 * Design Principles:
 *
 *  - No mutation of financial data.
 *  - Deterministic validation.
 *  - Detailed failure reporting.
 *  - Domain-specific errors.
 *  - Tenant aware.
 *  - Production observability ready.
 *  - Safe for distributed processing.
 *  - Provider agnostic.
 *
 * ============================================================================
 */

'use strict';

const {
    StatementValidationError
} = require('./StatementErrors');

const {
    STATEMENT_STATUS,
    STATEMENT_VALIDATION_RESULT
} = require('./StatementConstants');

/**
 * ============================================================================
 * Validation Constants
 * ============================================================================
 */

const DEFAULT_MAX_TRANSACTIONS = 100000;

const DEFAULT_ALLOWED_CURRENCIES = Object.freeze([
    'UGX',
    'USD',
    'EUR',
    'GBP',
    'KES',
    'TZS',
    'RWF',
    'ZAR',
    'NGN',
    'GHS'
]);

const ALLOWED_TRANSACTION_TYPES = Object.freeze([
    'CREDIT',
    'DEBIT'
]);

const TERMINAL_STATEMENT_STATUSES = Object.freeze([
    STATEMENT_STATUS?.COMPLETED,
    STATEMENT_STATUS?.CANCELLED
].filter(Boolean));

/**
 * ============================================================================
 * StatementValidator
 * ============================================================================
 */

class StatementValidator {

    /**
     * =========================================================================
     * Constructor
     * =========================================================================
     *
     * @param {Object} options
     * @param {number} options.maxTransactions
     * @param {string[]} options.allowedCurrencies
     * @param {boolean} options.requireTransactionType
     * @param {boolean} options.requireTransactionReference
     * @param {boolean} options.rejectTerminalStatements
     */

    constructor({

        maxTransactions =
            DEFAULT_MAX_TRANSACTIONS,

        allowedCurrencies =
            DEFAULT_ALLOWED_CURRENCIES,

        requireTransactionType =
            false,

        requireTransactionReference =
            false,

        rejectTerminalStatements =
            true

    } = {}) {

        if (
            !Number.isInteger(maxTransactions) ||
            maxTransactions <= 0
        ) {

            throw new StatementValidationError(

                'Invalid validator configuration',

                {
                    field: 'maxTransactions',
                    value: maxTransactions
                }

            );

        }

        if (
            !Array.isArray(allowedCurrencies) ||
            allowedCurrencies.length === 0
        ) {

            throw new StatementValidationError(

                'Invalid validator currency configuration',

                {
                    field: 'allowedCurrencies'
                }

            );

        }

        this.maxTransactions =
            maxTransactions;

        this.allowedCurrencies =
            new Set(

                allowedCurrencies

                    .map(currency =>
                        String(currency)
                            .trim()
                            .toUpperCase()
                    )

                    .filter(Boolean)

            );

        this.requireTransactionType =
            Boolean(requireTransactionType);

        this.requireTransactionReference =
            Boolean(requireTransactionReference);

        this.rejectTerminalStatements =
            Boolean(rejectTerminalStatements);

        Object.freeze(this);
    }

    /**
     * =========================================================================
     * Validate Statement
     * =========================================================================
     *
     * Main validation entry point.
     *
     * @param {Object} statement
     *
     * @returns {Promise<Object>}
     */

    async validate(statement) {

        const validationStartedAt =
            new Date();

        try {

            this.validateStatementStructure(
                statement
            );

            const errors = [];

            const warnings = [];

            this.validateStatementIdentity(
                statement,
                errors
            );

            this.validateStatementStatus(
                statement,
                errors
            );

            this.validateStatementMetadata(
                statement,
                errors
            );

            this.validateTransactions(
                statement.transactions,
                errors,
                warnings
            );

            const duplicateResult =
                this.validateDuplicateTransactions(
                    statement.transactions
                );

            if (duplicateResult.length > 0) {

                errors.push({

                    code:
                        'DUPLICATE_TRANSACTION_IDENTIFIERS',

                    message:
                        'Duplicate transaction identifiers detected',

                    identifiers:
                        duplicateResult

                });

            }

            const duplicateReferences =
                this.validateDuplicateReferences(
                    statement.transactions
                );

            if (duplicateReferences.length > 0) {

                warnings.push({

                    code:
                        'DUPLICATE_TRANSACTION_REFERENCES',

                    message:
                        'Duplicate transaction references detected',

                    references:
                        duplicateReferences

                });

            }

            if (errors.length > 0) {

                throw new StatementValidationError(

                    'Statement validation failed',

                    {

                        validationErrors:
                            errors,

                        validationWarnings:
                            warnings,

                        statementId:
                            statement.statementId || null,

                        tenantId:
                            statement.tenantId || null,

                        transactionCount:
                            statement.transactions.length

                    }

                );

            }

            const validationCompletedAt =
                new Date();

            return Object.freeze({

                valid:
                    true,

                result:
                    warnings.length > 0
                        ? STATEMENT_VALIDATION_RESULT.WARNING
                        : STATEMENT_VALIDATION_RESULT.PASSED,

                statementId:
                    statement.statementId || null,

                tenantId:
                    statement.tenantId || null,

                transactionCount:
                    statement.transactions.length,

                warningCount:
                    warnings.length,

                warnings,

                validationStartedAt,

                validatedAt:
                    validationCompletedAt,

                durationMs:
                    validationCompletedAt.getTime() -
                    validationStartedAt.getTime()

            });

        }

        catch (error) {

            if (
                error instanceof StatementValidationError
            ) {

                throw error;

            }

            throw new StatementValidationError(

                'Unexpected statement validation failure',

                {

                    statementId:
                        statement?.statementId || null,

                    originalError:
                        error.message

                },

                {

                    cause:
                        error

                }

            );

        }

    }

    /**
     * =========================================================================
     * Validate Statement Structure
     * =========================================================================
     */

    validateStatementStructure(statement) {

        if (
            !statement ||
            typeof statement !== 'object' ||
            Array.isArray(statement)
        ) {

            throw new StatementValidationError(

                'Statement payload required',

                {

                    code:
                        'MISSING_STATEMENT'

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

                    code:
                        'INVALID_TRANSACTION_COLLECTION',

                    receivedType:
                        typeof statement.transactions

                }

            );

        }

        if (
            statement.transactions.length === 0
        ) {

            throw new StatementValidationError(

                'Statement contains no transactions',

                {

                    code:
                        'EMPTY_STATEMENT'

                }

            );

        }

        if (
            statement.transactions.length >
            this.maxTransactions
        ) {

            throw new StatementValidationError(

                'Statement exceeds maximum transaction limit',

                {

                    code:
                        'TRANSACTION_LIMIT_EXCEEDED',

                    transactionCount:
                        statement.transactions.length,

                    maximumAllowed:
                        this.maxTransactions

                }

            );

        }

    }

    /**
     * =========================================================================
     * Validate Statement Identity
     * =========================================================================
     */

    validateStatementIdentity(
        statement,
        errors
    ) {

        if (
            !this.hasValue(
                statement.tenantId
            )
        ) {

            errors.push({

                code:
                    'MISSING_TENANT_ID',

                message:
                    'Statement tenantId is required'

            });

        }

        if (
            !this.hasValue(
                statement.statementId
            )
        ) {

            errors.push({

                code:
                    'MISSING_STATEMENT_ID',

                message:
                    'Statement statementId is required'

            });

        }

        if (
            statement.batchId !== undefined &&
            statement.batchId !== null &&
            typeof statement.batchId !== 'string'
        ) {

            errors.push({

                code:
                    'INVALID_BATCH_ID',

                message:
                    'Statement batchId must be a string'

            });

        }

    }

    /**
     * =========================================================================
     * Validate Statement Status
     * =========================================================================
     */

    validateStatementStatus(
        statement,
        errors
    ) {

        if (
            !statement.status
        ) {

            errors.push({

                code:
                    'MISSING_STATEMENT_STATUS',

                message:
                    'Statement status is required'

            });

            return;

        }

        const knownStatuses =
            Object.values(
                STATEMENT_STATUS || {}
            );

        if (
            knownStatuses.length > 0 &&
            !knownStatuses.includes(
                statement.status
            )
        ) {

            errors.push({

                code:
                    'INVALID_STATEMENT_STATUS',

                message:
                    'Statement contains an unsupported lifecycle status',

                status:
                    statement.status

            });

        }

        if (
            this.rejectTerminalStatements &&
            TERMINAL_STATEMENT_STATUSES.includes(
                statement.status
            )
        ) {

            errors.push({

                code:
                    'TERMINAL_STATEMENT_STATUS',

                message:
                    'Terminal statements cannot be processed again',

                status:
                    statement.status

            });

        }

    }

    /**
     * =========================================================================
     * Validate Statement Metadata
     * =========================================================================
     */

    validateStatementMetadata(
        statement,
        errors
    ) {

        if (
            statement.source !== undefined &&
            statement.source !== null &&
            typeof statement.source !== 'string'
        ) {

            errors.push({

                code:
                    'INVALID_STATEMENT_SOURCE',

                message:
                    'Statement source must be a string'

            });

        }

        if (
            statement.currency !== undefined &&
            statement.currency !== null
        ) {

            const currency =
                String(statement.currency)
                    .trim()
                    .toUpperCase();

            if (
                !this.isValidCurrency(
                    currency
                )
            ) {

                errors.push({

                    code:
                        'INVALID_STATEMENT_CURRENCY',

                    message:
                        'Statement currency is not supported',

                    currency

                });

            }

        }

        if (
            statement.metadata !== undefined &&
            statement.metadata !== null &&
            (
                typeof statement.metadata !== 'object' ||
                Array.isArray(statement.metadata)
            )
        ) {

            errors.push({

                code:
                    'INVALID_STATEMENT_METADATA',

                message:
                    'Statement metadata must be an object'

            });

        }

    }

    /**
     * =========================================================================
     * Validate Transactions
     * =========================================================================
     */

    validateTransactions(
        transactions,
        errors,
        warnings
    ) {

        transactions.forEach(
            (transaction, index) => {

                const transactionErrors =
                    this.validateTransaction(
                        transaction
                    );

                if (
                    transactionErrors.length
                ) {

                    errors.push({

                        code:
                            'INVALID_TRANSACTION',

                        transactionIndex:
                            index,

                        externalId:
                            transaction?.externalId ||
                            null,

                        errors:
                            transactionErrors

                    });

                }

                if (
                    transaction &&
                    transaction.metadata !== undefined &&
                    transaction.metadata !== null &&
                    (
                        typeof transaction.metadata !== 'object' ||
                        Array.isArray(transaction.metadata)
                    )
                ) {

                    warnings.push({

                        code:
                            'INVALID_TRANSACTION_METADATA',

                        transactionIndex:
                            index

                    });

                }

            }
        );

    }

    /**
     * =========================================================================
     * Validate Single Transaction
     * =========================================================================
     */

    validateTransaction(tx) {

        const errors = [];

        if (
            !tx ||
            typeof tx !== 'object' ||
            Array.isArray(tx)
        ) {

            errors.push(
                'Transaction payload missing or invalid'
            );

            return errors;
        }

        /**
         * External identifier.
         */

        if (
            !this.hasValue(
                tx.externalId
            )
        ) {

            errors.push(
                'Transaction missing identifier'
            );

        }

        /**
         * Amount.
         */

        if (
            tx.amount === undefined ||
            tx.amount === null ||
            tx.amount === ''
        ) {

            errors.push(
                'Transaction amount missing'
            );

        }

        else if (
            typeof tx.amount !== 'number' ||
            !Number.isFinite(tx.amount)
        ) {

            errors.push(
                'Transaction amount must be a finite number'
            );

        }

        else if (
            tx.amount <= 0
        ) {

            errors.push(
                'Transaction amount must be greater than zero'
            );

        }

        else if (
            !this.hasAtMostTwoDecimalPlaces(
                tx.amount
            )
        ) {

            errors.push(
                'Transaction amount must have at most two decimal places'
            );

        }

        /**
         * Currency.
         */

        if (
            !this.hasValue(
                tx.currency
            )
        ) {

            errors.push(
                'Transaction currency missing'
            );

        }

        else {

            const currency =
                String(tx.currency)
                    .trim()
                    .toUpperCase();

            if (
                !this.isValidCurrency(
                    currency
                )
            ) {

                errors.push(
                    'Unsupported transaction currency'
                );

            }

        }

        /**
         * Transaction date.
         */

        if (
            !tx.transactionDate
        ) {

            errors.push(
                'Transaction date missing'
            );

        }

        else if (
            !this.isValidDate(
                tx.transactionDate
            )
        ) {

            errors.push(
                'Invalid transaction date'
            );

        }

        /**
         * Transaction type.
         */

        if (
            this.requireTransactionType &&
            !this.hasValue(tx.type)
        ) {

            errors.push(
                'Transaction type missing'
            );

        }

        if (
            this.hasValue(tx.type)
        ) {

            const type =
                String(tx.type)
                    .trim()
                    .toUpperCase();

            if (
                !ALLOWED_TRANSACTION_TYPES.includes(
                    type
                )
            ) {

                errors.push(
                    'Transaction type must be CREDIT or DEBIT'
                );

            }

        }

        /**
         * Reference.
         */

        if (
            this.requireTransactionReference &&
            !this.hasValue(
                tx.reference
            )
        ) {

            errors.push(
                'Transaction reference missing'
            );

        }

        /**
         * Metadata.
         */

        if (
            tx.metadata !== undefined &&
            tx.metadata !== null &&
            (
                typeof tx.metadata !== 'object' ||
                Array.isArray(tx.metadata)
            )
        ) {

            errors.push(
                'Transaction metadata must be an object'
            );

        }

        return errors;

    }

    /**
     * =========================================================================
     * Validate Duplicate Transactions
     * =========================================================================
     *
     * Detect duplicate provider transaction identifiers.
     *
     * @param {Array} transactions
     *
     * @returns {Array<string>}
     */

    validateDuplicateTransactions(
        transactions
    ) {

        const identifiers =
            new Set();

        const duplicates =
            new Set();

        transactions.forEach(
            transaction => {

                const identifier =
                    transaction?.externalId;

                if (
                    !this.hasValue(
                        identifier
                    )
                ) {

                    return;

                }

                const normalized =
                    String(identifier)
                        .trim();

                if (
                    identifiers.has(
                        normalized
                    )
                ) {

                    duplicates.add(
                        normalized
                    );

                }

                identifiers.add(
                    normalized
                );

            }
        );

        return Array.from(
            duplicates
        );

    }

    /**
     * =========================================================================
     * Backwards-Compatible Duplicate API
     * =========================================================================
     */

    validateDuplicates(
        transactions
    ) {

        if (
            !Array.isArray(transactions)
        ) {

            return [];

        }

        return this.validateDuplicateTransactions(
            transactions
        );

    }

    /**
     * =========================================================================
     * Validate Duplicate References
     * =========================================================================
     */

    validateDuplicateReferences(
        transactions
    ) {

        const references =
            new Set();

        const duplicates =
            new Set();

        transactions.forEach(
            transaction => {

                const reference =
                    transaction?.reference;

                if (
                    !this.hasValue(
                        reference
                    )
                ) {

                    return;

                }

                const normalized =
                    String(reference)
                        .trim();

                if (
                    references.has(
                        normalized
                    )
                ) {

                    duplicates.add(
                        normalized
                    );

                }

                references.add(
                    normalized
                );

            }
        );

        return Array.from(
            duplicates
        );

    }

    /**
     * =========================================================================
     * Validate Currency
     * =========================================================================
     */

    isValidCurrency(
        currency
    ) {

        if (
            !/^[A-Z]{3}$/.test(
                currency
            )
        ) {

            return false;

        }

        return this.allowedCurrencies.has(
            currency
        );

    }

    /**
     * =========================================================================
     * Validate Date
     * =========================================================================
     */

    isValidDate(
        value
    ) {

        if (
            !(value instanceof Date)
        ) {

            return false;

        }

        return Number.isFinite(
            value.getTime()
        );

    }

    /**
     * =========================================================================
     * Validate Decimal Precision
     * =========================================================================
     */

    hasAtMostTwoDecimalPlaces(
        value
    ) {

        return Number.isInteger(
            Math.round(
                value * 100
            )
        );

    }

    /**
     * =========================================================================
     * Required Value Helper
     * =========================================================================
     */

    hasValue(
        value
    ) {

        return !(
            value === undefined ||
            value === null ||
            (
                typeof value === 'string' &&
                value.trim() === ''
            )
        );

    }

}

/**
 * ============================================================================
 * Export
 * ============================================================================
 */

module.exports = StatementValidator;