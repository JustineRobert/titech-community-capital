/**
 * ============================================================================
 * TITech Community Capital LTD
 * StatementReconciliationService.js
 * ============================================================================
 *
 * Enterprise Statement Reconciliation Service
 *
 * Responsibilities:
 *
 * - Reconcile validated statements against ledger transactions.
 * - Match external statement entries with internal financial records.
 * - Detect missing statement transactions.
 * - Detect ledger-only transactions.
 * - Detect amount/date/currency/reference variances.
 * - Prevent duplicate ledger matching.
 * - Produce deterministic reconciliation outcomes.
 * - Preserve tenant isolation.
 * - Prepare unmatched items for repair workflows.
 * - Support audit and operational reporting.
 *
 * Architecture:
 *
 * StatementProcessor
 *       |
 *       v
 * StatementValidator
 *       |
 *       v
 * StatementReconciliationService
 *       |
 *       +------------------------+
 *       |                        |
 *       v                        v
 * TransactionRepository       RepairEngine
 *
 * Matching Strategy:
 *
 * 1. External Transaction ID
 * 2. Reference Number
 * 3. Amount + Currency + Transaction Date
 * 4. Controlled amount/date tolerance
 *
 * Design Principles:
 *
 * - No mutation of ledger records.
 * - No mutation of statement transactions.
 * - Tenant isolated.
 * - Deterministic.
 * - Audit friendly.
 * - Financial precision aware.
 * - Duplicate-match protected.
 * - Recovery workflow ready.
 * - Distributed-processing ready.
 *
 * ============================================================================
 */

'use strict';

const crypto = require('crypto');

const {
    StatementProcessingError
} = require('./StatementErrors');

/**
 * ============================================================================
 * Reconciliation Status
 * ============================================================================
 */

const RECONCILIATION_STATUS = Object.freeze({

    MATCHED:
        'MATCHED',

    PARTIAL:
        'PARTIAL',

    FAILED:
        'FAILED'
});

/**
 * ============================================================================
 * Match Strategy
 * ============================================================================
 */

const MATCH_STRATEGY = Object.freeze({

    EXTERNAL_ID:
        'EXTERNAL_ID',

    REFERENCE:
        'REFERENCE',

    EXACT_FINANCIAL:
        'EXACT_FINANCIAL',

    TOLERANCE:
        'TOLERANCE'
});

/**
 * ============================================================================
 * Variance Types
 * ============================================================================
 */

const VARIANCE_TYPE = Object.freeze({

    AMOUNT_VARIANCE:
        'AMOUNT_VARIANCE',

    CURRENCY_VARIANCE:
        'CURRENCY_VARIANCE',

    DATE_VARIANCE:
        'DATE_VARIANCE',

    REFERENCE_VARIANCE:
        'REFERENCE_VARIANCE',

    MULTIPLE:
        'MULTIPLE'
});

/**
 * ============================================================================
 * Default Configuration
 * ============================================================================
 *
 * Amount tolerance is expressed in the same currency units as the
 * transaction amount.
 *
 * Date tolerance is expressed in days.
 *
 * ============================================================================
 */

const DEFAULT_OPTIONS = Object.freeze({

    amountTolerance:
        0.01,

    dateToleranceDays:
        1,

    requireCurrencyMatch:
        true,

    enableToleranceMatching:
        true
});

/**
 * ============================================================================
 * StatementReconciliationService
 * ============================================================================
 */

class StatementReconciliationService {

    /**
     * =========================================================================
     * Constructor
     * =========================================================================
     *
     * @param {Object} dependencies
     * @param {Object} dependencies.ledgerRepository
     * @param {Object} dependencies.transactionRepository
     * @param {Object|null} dependencies.auditService
     * @param {Object} dependencies.options
     */

    constructor({

        ledgerRepository = null,

        transactionRepository,

        auditService = null,

        options = {}

    } = {}) {

        this.ledgerRepository =
            ledgerRepository;

        this.transactionRepository =
            transactionRepository;

        this.auditService =
            auditService;

        this.options = Object.freeze({

            ...DEFAULT_OPTIONS,

            ...options
        });

        this.validateConfiguration();

        this.validateDependencies();
    }

    /**
     * =========================================================================
     * Reconcile Statement
     * =========================================================================
     *
     * @param {Object} statement
     * @param {StatementContext} context
     *
     * @returns {Promise<Object>}
     */

    async reconcile(statement, context) {

        try {

            this.validateInput(
                statement,
                context
            );

            const reconciliationId =
                this.generateReconciliationId(
                    statement,
                    context
                );

            const ledgerTransactions =
                await this.loadLedgerTransactions(
                    context.tenantId,
                    statement
                );

            const result =
                this.matchTransactions(
                    statement.transactions,
                    ledgerTransactions
                );

            const status =
                this.determineStatus(
                    result
                );

            const reconciliation = {

                reconciliationId,

                tenantId:
                    context.tenantId,

                statementId:
                    statement.statementId || null,

                batchId:
                    statement.batchId || null,

                correlationId:
                    context.correlationId || null,

                requestId:
                    context.requestId || null,

                status,

                matched:
                    result.matched,

                unmatched:
                    result.unmatched,

                ledgerUnmatched:
                    result.ledgerUnmatched,

                variances:
                    result.variances,

                totalStatementTransactions:
                    statement.transactions.length,

                totalLedgerTransactions:
                    ledgerTransactions.length,

                totalMatched:
                    result.matched.length,

                totalUnmatched:
                    result.unmatched.length,

                totalLedgerUnmatched:
                    result.ledgerUnmatched.length,

                totalVariances:
                    result.variances.length,

                matchRate:
                    this.calculateMatchRate(
                        statement.transactions.length,
                        result.matched.length
                    ),

                varianceRate:
                    this.calculateVarianceRate(
                        statement.transactions.length,
                        result.variances.length
                    ),

                createdAt:
                    new Date()
            };

            await this.audit(
                reconciliation
            );

            return Object.freeze(
                reconciliation
            );

        } catch (error) {

            if (
                error instanceof StatementProcessingError
            ) {

                throw error;
            }

            throw new StatementProcessingError(

                'Statement reconciliation failed',

                {

                    statementId:
                        statement?.statementId || null,

                    tenantId:
                        context?.tenantId || null,

                    originalError:
                        error?.message || String(error)

                },

                {

                    cause:
                        error,

                    retryable:
                        this.isRetryableError(error)
                }
            );
        }
    }

    /**
     * =========================================================================
     * Load Ledger Transactions
     * =========================================================================
     *
     * The repository remains responsible for database access.
     *
     * Tenant ID is always included as an explicit isolation boundary.
     */

    async loadLedgerTransactions(
        tenantId,
        statement
    ) {

        if (
            typeof this.transactionRepository
                .findForReconciliation !== 'function'
        ) {

            throw new StatementProcessingError(

                'Transaction repository does not support reconciliation lookup',

                {

                    requiredMethod:
                        'findForReconciliation'
                }
            );
        }

        const query = {

            tenantId,

            statementId:
                statement.statementId || null,

            reference:
                statement.reference || null,

            accountNumber:
                statement.accountNumber || null,

            currency:
                statement.currency || null,

            periodStart:
                statement.periodStart || null,

            periodEnd:
                statement.periodEnd || null
        };

        const transactions =
            await this.transactionRepository
                .findForReconciliation(query);

        if (!Array.isArray(transactions)) {

            throw new StatementProcessingError(

                'Transaction repository returned an invalid reconciliation result',

                {

                    tenantId
                }
            );
        }

        return transactions;
    }

    /**
     * =========================================================================
     * Match Transactions
     * =========================================================================
     *
     * A ledger transaction may only be consumed once.
     *
     * This prevents:
     *
     * Statement TX A -> Ledger TX 1
     * Statement TX B -> Ledger TX 1
     *
     * which would create a false reconciliation.
     */

    matchTransactions(
        statementTransactions = [],
        ledgerTransactions = []
    ) {

        const matched = [];

        const unmatched = [];

        const variances = [];

        const consumedLedgerIndexes =
            new Set();

        for (
            let statementIndex = 0;
            statementIndex < statementTransactions.length;
            statementIndex += 1
        ) {

            const statementTx =
                statementTransactions[
                    statementIndex
                ];

            const match =
                this.findMatch(

                    statementTx,

                    ledgerTransactions,

                    consumedLedgerIndexes
                );

            if (!match) {

                unmatched.push({

                    statement:
                        statementTx,

                    reason:
                        'NO_LEDGER_MATCH',

                    statementIndex
                });

                continue;
            }

            consumedLedgerIndexes.add(
                match.index
            );

            const variance =
                this.detectVariance(

                    statementTx,

                    match.transaction
                );

            if (variance) {

                variances.push({

                    ...variance,

                    statement:
                        statementTx,

                    ledger:
                        match.transaction,

                    strategy:
                        match.strategy
                });

                continue;
            }

            matched.push({

                statement:
                    statementTx,

                ledger:
                    match.transaction,

                strategy:
                    match.strategy,

                confidence:
                    this.resolveMatchConfidence(
                        match.strategy
                    )
            });
        }

        const ledgerUnmatched =
            ledgerTransactions
                .filter(
                    (_, index) =>
                        !consumedLedgerIndexes.has(
                            index
                        )
                )
                .map(
                    ledger => ({
                        ledger,
                        reason:
                            'NO_STATEMENT_MATCH'
                    })
                );

        return {

            matched,

            unmatched,

            ledgerUnmatched,

            variances
        };
    }

    /**
     * =========================================================================
     * Find Matching Ledger Entry
     * =========================================================================
     *
     * Matching priority:
     *
     * 1. External ID
     * 2. Reference
     * 3. Exact amount/currency/date
     * 4. Tolerance amount/date
     */

    findMatch(
        statementTx,
        ledgerTransactions,
        consumedIndexes = new Set()
    ) {

        const available =
            ledgerTransactions
                .map(
                    (transaction, index) => ({
                        transaction,
                        index
                    })
                )
                .filter(
                    ({ index }) =>
                        !consumedIndexes.has(index)
                );

        /**
         * -------------------------------------------------------------
         * Strategy 1: External Transaction ID
         * -------------------------------------------------------------
         */

        const externalId =
            this.normalizeIdentifier(
                statementTx?.externalId
            );

        if (externalId) {

            const match =
                available.find(
                    ({ transaction }) =>
                        this.normalizeIdentifier(
                            transaction?.externalId
                        ) === externalId
                );

            if (match) {

                return {

                    ...match,

                    strategy:
                        MATCH_STRATEGY.EXTERNAL_ID
                };
            }
        }

        /**
         * -------------------------------------------------------------
         * Strategy 2: Reference
         * -------------------------------------------------------------
         */

        const reference =
            this.normalizeIdentifier(
                statementTx?.reference
            );

        if (reference) {

            const referenceMatch =
                available.find(
                    ({ transaction }) =>
                        this.normalizeIdentifier(
                            transaction?.reference
                        ) === reference
                );

            if (referenceMatch) {

                return {

                    ...referenceMatch,

                    strategy:
                        MATCH_STRATEGY.REFERENCE
                };
            }
        }

        /**
         * -------------------------------------------------------------
         * Strategy 3: Exact Financial Match
         * -------------------------------------------------------------
         */

        const exactMatch =
            available.find(
                ({ transaction }) =>
                    this.isExactFinancialMatch(
                        statementTx,
                        transaction
                    )
            );

        if (exactMatch) {

            return {

                ...exactMatch,

                strategy:
                    MATCH_STRATEGY.EXACT_FINANCIAL
            };
        }

        /**
         * -------------------------------------------------------------
         * Strategy 4: Controlled Tolerance Match
         * -------------------------------------------------------------
         */

        if (
            this.options.enableToleranceMatching
        ) {

            const toleranceMatch =
                this.findToleranceMatch(
                    statementTx,
                    available
                );

            if (toleranceMatch) {

                return {

                    ...toleranceMatch,

                    strategy:
                        MATCH_STRATEGY.TOLERANCE
                };
            }
        }

        return null;
    }

    /**
     * =========================================================================
     * Exact Financial Match
     * =========================================================================
     */

    isExactFinancialMatch(
        statementTx,
        ledgerTx
    ) {

        if (
            !this.amountsEqual(
                statementTx?.amount,
                ledgerTx?.amount
            )
        ) {

            return false;
        }

        if (
            this.options.requireCurrencyMatch &&
            !this.currenciesEqual(
                statementTx?.currency,
                ledgerTx?.currency
            )
        ) {

            return false;
        }

        return this.datesWithinTolerance(
            statementTx?.transactionDate,
            ledgerTx?.transactionDate,
            0
        );
    }

    /**
     * =========================================================================
     * Tolerance Match
     * =========================================================================
     *
     * Tolerance matching is intentionally conservative.
     *
     * It requires:
     *
     * - amount within configured tolerance
     * - currency match when required
     * - date within configured tolerance
     *
     * If multiple candidates qualify, the closest candidate is selected.
     */

    findToleranceMatch(
        statementTx,
        available
    ) {

        const candidates =
            available
                .filter(
                    ({ transaction }) =>
                        this.isToleranceMatch(
                            statementTx,
                            transaction
                        )
                )
                .map(
                    candidate => ({
                        ...candidate,

                        distance:
                            this.calculateMatchDistance(
                                statementTx,
                                candidate.transaction
                            )
                    })
                )
                .sort(
                    (a, b) =>
                        a.distance -
                        b.distance
                );

        return candidates[0] || null;
    }

    /**
     * =========================================================================
     * Tolerance Eligibility
     * =========================================================================
     */

    isToleranceMatch(
        statementTx,
        ledgerTx
    ) {

        if (
            !this.amountsWithinTolerance(
                statementTx?.amount,
                ledgerTx?.amount
            )
        ) {

            return false;
        }

        if (
            this.options.requireCurrencyMatch &&
            !this.currenciesEqual(
                statementTx?.currency,
                ledgerTx?.currency
            )
        ) {

            return false;
        }

        return this.datesWithinTolerance(
            statementTx?.transactionDate,
            ledgerTx?.transactionDate,
            this.options.dateToleranceDays
        );
    }

    /**
     * =========================================================================
     * Calculate Match Distance
     * =========================================================================
     */

    calculateMatchDistance(
        statementTx,
        ledgerTx
    ) {

        const amountDifference =
            Math.abs(

                this.toNumber(
                    statementTx?.amount
                ) -

                this.toNumber(
                    ledgerTx?.amount
                )
            );

        const dateDifference =
            this.calculateDateDifferenceDays(

                statementTx?.transactionDate,

                ledgerTx?.transactionDate
            );

        return (

            amountDifference * 1000 +

            dateDifference

        );
    }

    /**
     * =========================================================================
     * Detect Financial Variance
     * =========================================================================
     *
     * A transaction matched by identity/reference may still contain
     * financial differences. Those differences are returned as a repair
     * candidate rather than silently being marked as matched.
     */

    detectVariance(
        statementTx,
        ledgerTx
    ) {

        const varianceTypes = [];

        const amountDifference =
            this.toNumber(
                statementTx?.amount
            ) -
            this.toNumber(
                ledgerTx?.amount
            );

        const amountVariance =
            Math.abs(
                amountDifference
            ) >
            this.options.amountTolerance;

        if (amountVariance) {

            varianceTypes.push(
                VARIANCE_TYPE.AMOUNT_VARIANCE
            );
        }

        const currencyVariance =
            !this.currenciesEqual(
                statementTx?.currency,
                ledgerTx?.currency
            );

        if (currencyVariance) {

            varianceTypes.push(
                VARIANCE_TYPE.CURRENCY_VARIANCE
            );
        }

        const dateDifference =
            this.calculateDateDifferenceDays(

                statementTx?.transactionDate,

                ledgerTx?.transactionDate
            );

        const dateVariance =
            dateDifference >
            this.options.dateToleranceDays;

        if (dateVariance) {

            varianceTypes.push(
                VARIANCE_TYPE.DATE_VARIANCE
            );
        }

        const statementReference =
            this.normalizeIdentifier(
                statementTx?.reference
            );

        const ledgerReference =
            this.normalizeIdentifier(
                ledgerTx?.reference
            );

        const externalIdMatch =
            this.normalizeIdentifier(
                statementTx?.externalId
            ) &&
            this.normalizeIdentifier(
                statementTx?.externalId
            ) ===
            this.normalizeIdentifier(
                ledgerTx?.externalId
            );

        const referenceVariance =
            Boolean(
                statementReference &&
                ledgerReference &&
                statementReference !==
                    ledgerReference &&
                !externalIdMatch
            );

        if (referenceVariance) {

            varianceTypes.push(
                VARIANCE_TYPE.REFERENCE_VARIANCE
            );
        }

        if (
            varianceTypes.length === 0
        ) {

            return null;
        }

        return {

            type:
                varianceTypes.length === 1
                    ? varianceTypes[0]
                    : VARIANCE_TYPE.MULTIPLE,

            types:
                varianceTypes,

            externalId:
                statementTx?.externalId || null,

            statementAmount:
                this.toNumber(
                    statementTx?.amount
                ),

            ledgerAmount:
                this.toNumber(
                    ledgerTx?.amount
                ),

            amountDifference:
                Number(
                    amountDifference.toFixed(2)
                ),

            statementCurrency:
                statementTx?.currency || null,

            ledgerCurrency:
                ledgerTx?.currency || null,

            statementDate:
                statementTx?.transactionDate || null,

            ledgerDate:
                ledgerTx?.transactionDate || null,

            dateDifferenceDays:
                dateDifference,

            statementReference:
                statementTx?.reference || null,

            ledgerReference:
                ledgerTx?.reference || null,

            repairRequired:
                true
        };
    }

    /**
     * =========================================================================
     * Determine Result Status
     * =========================================================================
     */

    determineStatus(result) {

        if (

            result.unmatched.length === 0 &&

            result.ledgerUnmatched.length === 0 &&

            result.variances.length === 0

        ) {

            return RECONCILIATION_STATUS.MATCHED;
        }

        if (

            result.matched.length > 0 ||

            result.variances.length > 0

        ) {

            return RECONCILIATION_STATUS.PARTIAL;
        }

        return RECONCILIATION_STATUS.FAILED;
    }

    /**
     * =========================================================================
     * Match Confidence
     * =========================================================================
     */

    resolveMatchConfidence(
        strategy
    ) {

        switch (strategy) {

            case MATCH_STRATEGY.EXTERNAL_ID:

                return 100;

            case MATCH_STRATEGY.REFERENCE:

                return 95;

            case MATCH_STRATEGY.EXACT_FINANCIAL:

                return 90;

            case MATCH_STRATEGY.TOLERANCE:

                return 75;

            default:

                return 0;
        }
    }

    /**
     * =========================================================================
     * Calculate Match Rate
     * =========================================================================
     */

    calculateMatchRate(
        total,
        matched
    ) {

        if (!total) {

            return 100;
        }

        return Number(

            (
                matched /
                total *
                100

            ).toFixed(2)
        );
    }

    /**
     * =========================================================================
     * Calculate Variance Rate
     * =========================================================================
     */

    calculateVarianceRate(
        total,
        variances
    ) {

        if (!total) {

            return 0;
        }

        return Number(

            (
                variances /
                total *
                100

            ).toFixed(2)
        );
    }

    /**
     * =========================================================================
     * Amount Comparison
     * =========================================================================
     */

    amountsEqual(
        first,
        second
    ) {

        return (

            Math.abs(

                this.toNumber(first) -
                this.toNumber(second)

            ) <=
            this.options.amountTolerance
        );
    }

    /**
     * =========================================================================
     * Amount Tolerance Comparison
     * =========================================================================
     */

    amountsWithinTolerance(
        first,
        second
    ) {

        return this.amountsEqual(
            first,
            second
        );
    }

    /**
     * =========================================================================
     * Currency Comparison
     * =========================================================================
     */

    currenciesEqual(
        first,
        second
    ) {

        const left =
            String(
                first || ''
            )
                .trim()
                .toUpperCase();

        const right =
            String(
                second || ''
            )
                .trim()
                .toUpperCase();

        return (
            left !== '' &&
            right !== '' &&
            left === right
        );
    }

    /**
     * =========================================================================
     * Date Comparison
     * =========================================================================
     */

    datesWithinTolerance(
        first,
        second,
        toleranceDays
    ) {

        if (
            !first ||
            !second
        ) {

            return false;
        }

        const firstDate =
            this.parseDate(
                first
            );

        const secondDate =
            this.parseDate(
                second
            );

        if (
            !firstDate ||
            !secondDate
        ) {

            return false;
        }

        const difference =
            Math.abs(

                firstDate.getTime() -
                secondDate.getTime()

            );

        return (

            difference <=
            toleranceDays *
            86400000
        );
    }

    /**
     * =========================================================================
     * Calculate Date Difference
     * =========================================================================
     */

    calculateDateDifferenceDays(
        first,
        second
    ) {

        if (
            !first ||
            !second
        ) {

            return Number.POSITIVE_INFINITY;
        }

        const firstDate =
            this.parseDate(
                first
            );

        const secondDate =
            this.parseDate(
                second
            );

        if (
            !firstDate ||
            !secondDate
        ) {

            return Number.POSITIVE_INFINITY;
        }

        return Number(

            (
                Math.abs(

                    firstDate.getTime() -
                    secondDate.getTime()

                ) /
                86400000

            ).toFixed(4)
        );
    }

    /**
     * =========================================================================
     * Parse Date
     * =========================================================================
     */

    parseDate(value) {

        const date =
            new Date(value);

        if (
            Number.isNaN(
                date.getTime()
            )
        ) {

            return null;
        }

        return date;
    }

    /**
     * =========================================================================
     * Numeric Conversion
     * =========================================================================
     */

    toNumber(value) {

        const number =
            Number(value);

        return Number.isFinite(number)
            ? number
            : 0;
    }

    /**
     * =========================================================================
     * Normalize Identifier
     * =========================================================================
     */

    normalizeIdentifier(
        value
    ) {

        if (
            value === undefined ||
            value === null
        ) {

            return null;
        }

        const normalized =
            String(value)
                .trim()
                .toUpperCase();

        return normalized || null;
    }

    /**
     * =========================================================================
     * Generate Reconciliation ID
     * =========================================================================
     *
     * Includes tenant identity to prevent identical statement IDs from
     * different tenants generating the same reconciliation identity.
     */

    generateReconciliationId(
        statement,
        context = {}
    ) {

        const identity = [

            context.tenantId || '',

            statement.statementId || '',

            statement.batchId || '',

            statement.periodStart || '',

            statement.periodEnd || ''

        ].join('|');

        return (

            'RECON-' +

            crypto
                .createHash('sha256')
                .update(identity)
                .digest('hex')
                .substring(0, 24)
        );
    }

    /**
     * =========================================================================
     * Audit
     * =========================================================================
     */

    async audit(
        reconciliation
    ) {

        if (
            !this.auditService
        ) {

            return;
        }

        if (
            typeof this.auditService.log !==
            'function'
        ) {

            throw new StatementProcessingError(

                'Audit service does not support logging',

                {

                    requiredMethod:
                        'log'
                }
            );
        }

        await this.auditService.log({

            action:
                'STATEMENT_RECONCILIATED',

            tenantId:
                reconciliation.tenantId,

            statementId:
                reconciliation.statementId,

            reconciliationId:
                reconciliation.reconciliationId,

            data:
                reconciliation
        });
    }

    /**
     * =========================================================================
     * Input Validation
     * =========================================================================
     */

    validateInput(
        statement,
        context
    ) {

        if (
            !statement ||
            typeof statement !== 'object'
        ) {

            throw new StatementProcessingError(

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

            throw new StatementProcessingError(

                'Statement transactions must be an array',

                {

                    reason:
                        'INVALID_TRANSACTIONS'
                }
            );
        }

        if (
            !context ||
            typeof context !== 'object'
        ) {

            throw new StatementProcessingError(

                'Tenant context required',

                {

                    reason:
                        'MISSING_CONTEXT'
                }
            );
        }

        if (
            !context.tenantId
        ) {

            throw new StatementProcessingError(

                'Tenant context required',

                {

                    reason:
                        'MISSING_TENANT'
                }
            );
        }

        if (
            !statement.statementId
        ) {

            throw new StatementProcessingError(

                'Statement identifier required',

                {

                    reason:
                        'MISSING_STATEMENT_ID'
                }
            );
        }
    }

    /**
     * =========================================================================
     * Configuration Validation
     * =========================================================================
     */

    validateConfiguration() {

        if (
            !Number.isFinite(
                this.options.amountTolerance
            ) ||
            this.options.amountTolerance < 0
        ) {

            throw new StatementProcessingError(

                'Invalid reconciliation amount tolerance',

                {

                    amountTolerance:
                        this.options.amountTolerance
                }
            );
        }

        if (
            !Number.isFinite(
                this.options.dateToleranceDays
            ) ||
            this.options.dateToleranceDays < 0
        ) {

            throw new StatementProcessingError(

                'Invalid reconciliation date tolerance',

                {

                    dateToleranceDays:
                        this.options.dateToleranceDays
                }
            );
        }
    }

    /**
     * =========================================================================
     * Dependency Validation
     * =========================================================================
     */

    validateDependencies() {

        if (
            !this.transactionRepository
        ) {

            throw new StatementProcessingError(

                'Transaction repository required'
            );
        }

        if (
            typeof this.transactionRepository
                .findForReconciliation !==
            'function'
        ) {

            throw new StatementProcessingError(

                'Transaction repository reconciliation method required',

                {

                    requiredMethod:
                        'findForReconciliation'
                }
            );
        }
    }

    /**
     * =========================================================================
     * Retry Classification
     * =========================================================================
     *
     * Repository/network failures are generally retryable.
     * Domain mismatches are not.
     */

    isRetryableError(
        error
    ) {

        if (!error) {

            return false;
        }

        if (
            typeof error.retryable ===
            'boolean'
        ) {

            return error.retryable;
        }

        const code =
            String(
                error.code || ''
            )
                .toUpperCase();

        return (

            code.includes('TIMEOUT') ||

            code.includes('NETWORK') ||

            code.includes('CONNECTION') ||

            code.includes('REDIS') ||

            code.includes('DATABASE') ||

            code.includes('MONGO')
        );
    }
}

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports =
    StatementReconciliationService;

module.exports.RECONCILIATION_STATUS =
    RECONCILIATION_STATUS;

module.exports.MATCH_STRATEGY =
    MATCH_STRATEGY;

module.exports.VARIANCE_TYPE =
    VARIANCE_TYPE;

module.exports.DEFAULT_RECONCILIATION_OPTIONS =
    DEFAULT_OPTIONS;