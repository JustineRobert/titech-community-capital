/**
 * ============================================================================
 * TITech Community Capital LTD
 * StatementImporter.js
 * ============================================================================
 *
 * Enterprise Statement Import Service
 *
 * File:
 * backend/modules/finance/statements/StatementImporter.js
 *
 * Responsibilities:
 *
 * - Import raw financial statement payloads.
 * - Normalize statement structure.
 * - Validate import prerequisites.
 * - Attach execution context metadata.
 * - Generate deterministic import identity.
 * - Protect tenant ownership boundaries.
 * - Prepare immutable statements for validation.
 * - Support idempotent statement ingestion.
 * - Produce audit-ready import metadata.
 * - Remain provider agnostic.
 *
 * Pipeline Position:
 *
 * StatementContext
 *       |
 *       v
 * StatementImporter
 *       |
 *       v
 * StatementValidator
 *       |
 *       v
 * StatementRepository
 *       |
 *       v
 * Reconciliation Engine
 *
 * Design Principles:
 *
 * - No persistence logic.
 * - No validation business rules.
 * - Immutable output contract.
 * - Multi-tenant aware.
 * - Audit ready.
 * - Provider agnostic.
 * - Deterministic identity.
 * - Idempotency ready.
 * - Distributed-processing ready.
 * - Defensive input handling.
 *
 * ============================================================================
 */

'use strict';

const crypto = require('crypto');

const {
    StatementImportError
} = require('./StatementErrors');

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const STATEMENT_STATUS = 'IMPORTED';

const IMPORT_VERSION = '1.0.0';

const DEFAULT_MAX_TRANSACTIONS = 100000;

const DEFAULT_MAX_METADATA_KEYS = 100;

const DEFAULT_SOURCE = 'UNKNOWN';

/**
 * ============================================================================
 * Utility: Deep Freeze
 * ============================================================================
 *
 * Prevents downstream pipeline stages from accidentally mutating the
 * imported statement or its nested transaction payload.
 *
 * @param {*} value
 * @returns {*}
 */
function deepFreeze(value) {

    if (
        value === null ||
        value === undefined ||
        typeof value !== 'object' ||
        Object.isFrozen(value)
    ) {
        return value;
    }

    Object.getOwnPropertyNames(value).forEach(property => {

        deepFreeze(value[property]);

    });

    return Object.freeze(value);
}

/**
 * ============================================================================
 * Utility: Normalize String
 * ============================================================================
 *
 * @param {*} value
 * @param {string|null} fallback
 * @returns {string|null}
 */
function normalizeString(value, fallback = null) {

    if (
        value === undefined ||
        value === null
    ) {
        return fallback;
    }

    const normalized = String(value).trim();

    return normalized || fallback;
}

/**
 * ============================================================================
 * Utility: Normalize Date
 * ============================================================================
 *
 * The importer does not perform statement business validation, but it does
 * normalize supplied dates into a predictable representation.
 *
 * Invalid dates are preserved as null and can subsequently be rejected by
 * StatementValidator.
 *
 * @param {*} value
 * @returns {Date|null}
 */
function normalizeDate(value) {

    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {
        return null;
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date;
}

/**
 * ============================================================================
 * Utility: Canonicalize Value
 * ============================================================================
 *
 * Produces deterministic JSON-safe data for identity generation.
 *
 * Object keys are sorted recursively so semantically equivalent payloads
 * generate the same statement identity.
 *
 * @param {*} value
 * @returns {*}
 */
function canonicalize(value) {

    if (value === null || value === undefined) {
        return value;
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (Array.isArray(value)) {

        return value.map(item =>
            canonicalize(item)
        );

    }

    if (typeof value === 'object') {

        return Object.keys(value)
            .sort()
            .reduce((result, key) => {

                result[key] =
                    canonicalize(value[key]);

                return result;

            }, {});

    }

    return value;
}

/**
 * ============================================================================
 * StatementImporter
 * ============================================================================
 */

class StatementImporter {

    /**
     * =========================================================================
     * Constructor
     * =========================================================================
     *
     * @param {Object} options
     * @param {number} options.maxTransactions
     * @param {number} options.maxMetadataKeys
     * @param {string} options.importVersion
     */
    constructor({

        maxTransactions =
            DEFAULT_MAX_TRANSACTIONS,

        maxMetadataKeys =
            DEFAULT_MAX_METADATA_KEYS,

        importVersion =
            IMPORT_VERSION

    } = {}) {

        this.maxTransactions =
            this.validatePositiveInteger(
                maxTransactions,
                'maxTransactions'
            );

        this.maxMetadataKeys =
            this.validatePositiveInteger(
                maxMetadataKeys,
                'maxMetadataKeys'
            );

        this.importVersion =
            normalizeString(
                importVersion,
                IMPORT_VERSION
            );

        Object.freeze(this);
    }

    /**
     * =========================================================================
     * Import Statement
     * =========================================================================
     *
     * Main public API.
     *
     * @param {Object} input
     * @param {StatementContext} context
     *
     * @returns {Promise<Object>}
     */
    async importStatement(input, context) {

        try {

            this.validateInput(input);

            this.validateContext(context);

            this.validateTransactionLimit(
                input.transactions
            );

            this.validateMetadataLimit(
                input.metadata
            );

            const importedAt = new Date();

            const statementId =
                this.generateStatementId(
                    input,
                    context
                );

            const transactions =
                this.normalizeTransactions(
                    input.transactions
                );

            const metadata =
                this.normalizeMetadata(
                    input.metadata
                );

            const importedStatement = {

                /**
                 * -------------------------------------------------------------
                 * Contract Version
                 * -------------------------------------------------------------
                 */

                importVersion:
                    this.importVersion,

                /**
                 * -------------------------------------------------------------
                 * Multi-Tenant Ownership
                 * -------------------------------------------------------------
                 */

                tenantId:
                    normalizeString(
                        context.tenantId
                    ),

                userId:
                    normalizeString(
                        context.userId
                    ),

                /**
                 * -------------------------------------------------------------
                 * Statement Origin
                 * -------------------------------------------------------------
                 */

                source:
                    normalizeString(
                        context.source,
                        DEFAULT_SOURCE
                    )
                    .toUpperCase(),

                /**
                 * -------------------------------------------------------------
                 * Distributed Execution Identity
                 * -------------------------------------------------------------
                 */

                correlationId:
                    normalizeString(
                        context.correlationId
                    ),

                requestId:
                    normalizeString(
                        context.requestId
                    ),

                executionId:
                    normalizeString(
                        context.executionId
                    ),

                traceId:
                    normalizeString(
                        context.traceId
                    ),

                batchId:
                    normalizeString(
                        context.batchId
                    ),

                /**
                 * -------------------------------------------------------------
                 * Statement Identity
                 * -------------------------------------------------------------
                 */

                statementId,

                reference:
                    normalizeString(
                        input.reference
                    ),

                accountNumber:
                    normalizeString(
                        input.accountNumber
                    ),

                currency:
                    normalizeString(
                        input.currency
                    )
                    ?.toUpperCase() || null,

                /**
                 * -------------------------------------------------------------
                 * Statement Period
                 * -------------------------------------------------------------
                 */

                periodStart:
                    normalizeDate(
                        input.periodStart
                    ),

                periodEnd:
                    normalizeDate(
                        input.periodEnd
                    ),

                /**
                 * -------------------------------------------------------------
                 * Transactions
                 * -------------------------------------------------------------
                 */

                transactions,

                transactionCount:
                    transactions.length,

                /**
                 * -------------------------------------------------------------
                 * Lifecycle
                 * -------------------------------------------------------------
                 */

                status:
                    STATEMENT_STATUS,

                /**
                 * -------------------------------------------------------------
                 * Audit Metadata
                 * -------------------------------------------------------------
                 */

                importedAt,

                metadata

            };

            return deepFreeze(
                importedStatement
            );

        } catch (error) {

            if (
                error instanceof StatementImportError
            ) {
                throw error;
            }

            throw new StatementImportError(

                'Failed to import statement',

                {

                    reason:
                        'IMPORT_PROCESSING_FAILURE',

                    originalError:
                        error?.message || 'Unknown error',

                    reference:
                        normalizeString(
                            input?.reference
                        )

                },

                {

                    cause: error,

                    retryable: false

                }

            );
        }
    }

    /**
     * =========================================================================
     * Validate Import Payload
     * =========================================================================
     *
     * Import validation intentionally remains structural.
     *
     * Financial business validation belongs to StatementValidator.
     */
    validateInput(input) {

        if (
            input === null ||
            input === undefined
        ) {

            throw new StatementImportError(

                'Statement payload required',

                {

                    reason:
                        'EMPTY_PAYLOAD'

                }

            );
        }

        if (
            typeof input !== 'object' ||
            Array.isArray(input)
        ) {

            throw new StatementImportError(

                'Invalid statement payload format',

                {

                    reason:
                        'INVALID_PAYLOAD_TYPE'

                }

            );
        }

        if (
            input.transactions !== undefined &&
            !Array.isArray(input.transactions)
        ) {

            throw new StatementImportError(

                'Statement transactions must be an array',

                {

                    reason:
                        'INVALID_TRANSACTIONS_TYPE'

                }

            );
        }

        if (
            input.metadata !== undefined &&
            (
                input.metadata === null ||
                typeof input.metadata !== 'object' ||
                Array.isArray(input.metadata)
            )
        ) {

            throw new StatementImportError(

                'Statement metadata must be an object',

                {

                    reason:
                        'INVALID_METADATA_TYPE'

                }

            );
        }
    }

    /**
     * =========================================================================
     * Validate Execution Context
     * =========================================================================
     */
    validateContext(context) {

        if (!context) {

            throw new StatementImportError(

                'Statement processing context required',

                {

                    reason:
                        'MISSING_CONTEXT'

                }

            );
        }

        if (
            typeof context !== 'object'
        ) {

            throw new StatementImportError(

                'Invalid statement processing context',

                {

                    reason:
                        'INVALID_CONTEXT_TYPE'

                }

            );
        }

        if (!context.tenantId) {

            throw new StatementImportError(

                'Tenant context required',

                {

                    reason:
                        'MISSING_TENANT'

                }

            );
        }

        if (!context.userId) {

            throw new StatementImportError(

                'Statement processing user context required',

                {

                    reason:
                        'MISSING_USER'

                }

            );
        }

        if (!context.correlationId) {

            throw new StatementImportError(

                'Statement correlation context required',

                {

                    reason:
                        'MISSING_CORRELATION_ID'

                }

            );
        }

        if (!context.requestId) {

            throw new StatementImportError(

                'Statement request context required',

                {

                    reason:
                        'MISSING_REQUEST_ID'

                }

            );
        }
    }

    /**
     * =========================================================================
     * Transaction Limit Protection
     * =========================================================================
     */
    validateTransactionLimit(transactions) {

        if (!transactions) {
            return;
        }

        if (
            transactions.length >
            this.maxTransactions
        ) {

            throw new StatementImportError(

                'Statement transaction limit exceeded',

                {

                    reason:
                        'TRANSACTION_LIMIT_EXCEEDED',

                    transactionCount:
                        transactions.length,

                    maximumAllowed:
                        this.maxTransactions

                }

            );
        }
    }

    /**
     * =========================================================================
     * Metadata Limit Protection
     * =========================================================================
     */
    validateMetadataLimit(metadata) {

        if (!metadata) {
            return;
        }

        const keyCount =
            Object.keys(metadata).length;

        if (
            keyCount >
            this.maxMetadataKeys
        ) {

            throw new StatementImportError(

                'Statement metadata limit exceeded',

                {

                    reason:
                        'METADATA_LIMIT_EXCEEDED',

                    metadataKeys:
                        keyCount,

                    maximumAllowed:
                        this.maxMetadataKeys

                }

            );
        }
    }

    /**
     * =========================================================================
     * Normalize Transactions
     * =========================================================================
     *
     * The importer does not alter financial values or apply accounting rules.
     *
     * It creates defensive copies so callers cannot mutate the source payload
     * after import.
     */
    normalizeTransactions(transactions) {

        if (!Array.isArray(transactions)) {
            return [];
        }

        return transactions.map(
            transaction => {

                if (
                    !transaction ||
                    typeof transaction !== 'object' ||
                    Array.isArray(transaction)
                ) {

                    throw new StatementImportError(

                        'Invalid statement transaction payload',

                        {

                            reason:
                                'INVALID_TRANSACTION_PAYLOAD'

                        }

                    );
                }

                return deepFreeze({
                    ...transaction
                });
            }
        );
    }

    /**
     * =========================================================================
     * Normalize Metadata
     * =========================================================================
     */
    normalizeMetadata(metadata) {

        if (!metadata) {
            return {};
        }

        return {
            ...metadata
        };
    }

    /**
     * =========================================================================
     * Generate Deterministic Statement Identifier
     * =========================================================================
     *
     * Identity components:
     *
     * tenant
     * source
     * reference
     * account
     * currency
     * statement period
     * transactions
     *
     * This prevents identical statements belonging to different tenants from
     * producing the same identity.
     */
    generateStatementId(input, context) {

        const identityPayload = {

            tenantId:
                normalizeString(
                    context.tenantId
                ),

            source:
                normalizeString(
                    context.source,
                    DEFAULT_SOURCE
                )
                .toUpperCase(),

            reference:
                normalizeString(
                    input.reference
                ),

            accountNumber:
                normalizeString(
                    input.accountNumber
                ),

            currency:
                normalizeString(
                    input.currency
                )
                ?.toUpperCase() || null,

            periodStart:
                normalizeDate(
                    input.periodStart
                )?.toISOString() || null,

            periodEnd:
                normalizeDate(
                    input.periodEnd
                )?.toISOString() || null,

            transactions:
                canonicalize(
                    input.transactions || []
                )

        };

        const canonicalIdentity =
            JSON.stringify(
                canonicalize(
                    identityPayload
                )
            );

        const digest =
            crypto
                .createHash('sha256')
                .update(
                    canonicalIdentity,
                    'utf8'
                )
                .digest('hex');

        return `STMT-${digest.substring(0, 32)}`;
    }

    /**
     * =========================================================================
     * Generate Full Identity Hash
     * =========================================================================
     *
     * Useful for repositories that need a full collision-resistant fingerprint
     * rather than the shorter public statementId.
     */
    generateIdentityHash(input, context) {

        const statementId =
            this.generateStatementId(
                input,
                context
            );

        const identity = {

            statementId,

            tenantId:
                context.tenantId,

            source:
                context.source,

            reference:
                input.reference || null,

            accountNumber:
                input.accountNumber || null,

            currency:
                input.currency || null,

            periodStart:
                input.periodStart || null,

            periodEnd:
                input.periodEnd || null,

            transactions:
                canonicalize(
                    input.transactions || []
                )

        };

        return crypto
            .createHash('sha256')
            .update(
                JSON.stringify(
                    canonicalize(identity)
                ),
                'utf8'
            )
            .digest('hex');
    }

    /**
     * =========================================================================
     * Validate Positive Integer
     * =========================================================================
     */
    validatePositiveInteger(value, fieldName) {

        if (
            !Number.isInteger(value) ||
            value <= 0
        ) {

            throw new TypeError(
                `${fieldName} must be a positive integer`
            );
        }

        return value;
    }
}

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports = StatementImporter;

module.exports.STATEMENT_STATUS =
    STATEMENT_STATUS;

module.exports.IMPORT_VERSION =
    IMPORT_VERSION;

module.exports.DEFAULT_MAX_TRANSACTIONS =
    DEFAULT_MAX_TRANSACTIONS;

module.exports.DEFAULT_MAX_METADATA_KEYS =
    DEFAULT_MAX_METADATA_KEYS;