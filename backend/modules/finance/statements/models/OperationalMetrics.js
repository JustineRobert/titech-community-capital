'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * OperationalMetrics
 * ============================================================================
 *
 * Enterprise-grade operational intelligence domain model for the financial
 * statement processing subsystem.
 *
 * Location:
 *   backend/modules/finance/statements/models/OperationalMetrics.js
 *
 * Purpose
 * -------
 * Provides a normalized, tenant-aware and explainable representation of
 * operational performance across:
 *
 *   - Statement ingestion
 *   - Statement validation
 *   - Reconciliation
 *   - Variance detection
 *   - Automated repair
 *   - Manual repair
 *   - Settlement processing
 *   - Fraud detection
 *   - Ledger posting
 *   - Processing latency
 *   - Failure/retry behavior
 *   - Queue/backlog health
 *   - Data quality
 *   - Operational reliability
 *
 * Design principles
 * -----------------
 * - No database dependency
 * - No framework dependency
 * - Tenant-aware
 * - Deterministic calculations
 * - Safe normalization
 * - Explicit units
 * - Bounded numeric values
 * - Explainable health scores
 * - Immutable-style snapshot serialization
 * - Compatible with analytics/reporting engines
 * - Compatible with future time-series persistence
 * - Safe for event/audit serialization
 *
 * Non-responsibilities
 * --------------------
 * This model does NOT:
 *
 * - persist itself
 * - query MongoDB
 * - publish metrics
 * - send alerts
 * - execute repairs
 * - reconcile transactions
 * - make financial decisions
 *
 * Those responsibilities belong to services/orchestrators.
 *
 * ============================================================================
 */

const crypto = require('crypto');

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const MODEL_NAME = 'OperationalMetrics';

const SCHEMA_VERSION = '1.0.0';

const STATUS = Object.freeze({
    HEALTHY: 'HEALTHY',
    DEGRADED: 'DEGRADED',
    WARNING: 'WARNING',
    CRITICAL: 'CRITICAL',
    UNKNOWN: 'UNKNOWN'
});

const HEALTH_LEVEL = Object.freeze({
    EXCELLENT: 'EXCELLENT',
    GOOD: 'GOOD',
    FAIR: 'FAIR',
    POOR: 'POOR',
    CRITICAL: 'CRITICAL',
    UNKNOWN: 'UNKNOWN'
});

const METRIC_TYPE = Object.freeze({
    COUNTER: 'COUNTER',
    GAUGE: 'GAUGE',
    RATE: 'RATE',
    RATIO: 'RATIO',
    PERCENTAGE: 'PERCENTAGE',
    DURATION: 'DURATION',
    AMOUNT: 'AMOUNT',
    SCORE: 'SCORE',
    COUNT: 'COUNT'
});

const PERIOD_TYPE = Object.freeze({
    REALTIME: 'REALTIME',
    MINUTE: 'MINUTE',
    HOUR: 'HOUR',
    DAY: 'DAY',
    WEEK: 'WEEK',
    MONTH: 'MONTH',
    QUARTER: 'QUARTER',
    YEAR: 'YEAR',
    CUSTOM: 'CUSTOM'
});

const PROCESSING_STAGE = Object.freeze({
    IMPORT: 'IMPORT',
    VALIDATION: 'VALIDATION',
    RECONCILIATION: 'RECONCILIATION',
    VARIANCE_DETECTION: 'VARIANCE_DETECTION',
    REPAIR: 'REPAIR',
    SETTLEMENT: 'SETTLEMENT',
    LEDGER_POSTING: 'LEDGER_POSTING',
    FRAUD_DETECTION: 'FRAUD_DETECTION',
    REPORTING: 'REPORTING',
    END_TO_END: 'END_TO_END',
    UNKNOWN: 'UNKNOWN'
});

const CURRENCY_AGGREGATION = Object.freeze({
    SINGLE: 'SINGLE',
    MULTI: 'MULTI',
    NONE: 'NONE'
});

const DEFAULTS = Object.freeze({
    maximumDimensions: 100,
    maximumBreakdowns: 100,
    maximumErrors: 100,
    maximumWarnings: 100,
    maximumTags: 50,
    maximumHistory: 100,
    maximumSamples: 100,
    maximumCustomMetrics: 200
});

/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

function isObject(value) {
    return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
    );
}

function clone(value) {
    if (value === undefined) {
        return undefined;
    }

    if (value === null) {
        return null;
    }

    if (value instanceof Date) {
        return new Date(value.getTime());
    }

    if (Array.isArray(value)) {
        return value.map(clone);
    }

    if (isObject(value)) {
        const result = {};

        for (const key of Object.keys(value)) {
            result[key] = clone(value[key]);
        }

        return result;
    }

    return value;
}

function normalizeString(value, fallback = null) {
    if (
        value === null ||
        value === undefined
    ) {
        return fallback;
    }

    const normalized =
        String(value).trim();

    return normalized.length > 0
        ? normalized
        : fallback;
}

function normalizeEnum(
    value,
    allowed,
    fallback
) {
    const normalized =
        normalizeString(value);

    if (!normalized) {
        return fallback;
    }

    const upper =
        normalized.toUpperCase();

    return allowed.includes(upper)
        ? upper
        : fallback;
}

function toNumber(
    value,
    fallback = null
) {
    if (
        value === null ||
        value === undefined ||
        value === ''
    ) {
        return fallback;
    }

    const numeric =
        Number(value);

    return Number.isFinite(numeric)
        ? numeric
        : fallback;
}

function clamp(
    value,
    minimum,
    maximum
) {
    const numeric =
        toNumber(
            value,
            minimum
        );

    return Math.min(
        maximum,
        Math.max(
            minimum,
            numeric
        )
    );
}

function round(
    value,
    decimals = 4
) {
    const numeric =
        toNumber(
            value,
            0
        );

    const factor =
        10 ** decimals;

    return (
        Math.round(
            numeric * factor
        ) / factor
    );
}

function normalizeDate(
    value,
    fallback = null
) {
    if (!value) {
        return fallback;
    }

    if (value instanceof Date) {
        return Number.isNaN(
            value.getTime()
        )
            ? fallback
            : new Date(
                value.getTime()
            );
    }

    const date =
        new Date(value);

    return Number.isNaN(
        date.getTime()
    )
        ? fallback
        : date;
}

function uniqueStrings(
    values,
    maximum = Infinity
) {
    if (!Array.isArray(values)) {
        return [];
    }

    const result = [];
    const seen = new Set();

    for (const value of values) {

        const normalized =
            normalizeString(value);

        if (!normalized) {
            continue;
        }

        const key =
            normalized.toLowerCase();

        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        result.push(normalized);

        if (
            result.length >=
            maximum
        ) {
            break;
        }
    }

    return result;
}

function normalizeArray(
    value,
    maximum = Infinity
) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .slice(0, maximum)
        .map(clone);
}

function stableSerialize(value) {

    if (value === null) {
        return 'null';
    }

    if (value === undefined) {
        return 'undefined';
    }

    if (value instanceof Date) {
        return JSON.stringify(
            value.toISOString()
        );
    }

    if (Array.isArray(value)) {
        return `[${value
            .map(stableSerialize)
            .join(',')}]`;
    }

    if (isObject(value)) {

        return `{${Object.keys(value)
            .sort()
            .map(
                key =>
                    `${JSON.stringify(key)}:${stableSerialize(value[key])}`
            )
            .join(',')}}`;
    }

    return JSON.stringify(value);
}

function sha256(value) {

    return crypto
        .createHash('sha256')
        .update(
            stableSerialize(value)
        )
        .digest('hex');
}

/**
 * ============================================================================
 * OperationalMetrics
 * ============================================================================
 */

class OperationalMetrics {

    /**
     * @param {Object} data
     */
    constructor(data = {}) {

        if (!isObject(data)) {
            throw new TypeError(
                'OperationalMetrics data must be an object.'
            );
        }

        this._initialize(data);
    }

    /**
     * =========================================================================
     * Initialization
     * =========================================================================
     */

    _initialize(data) {

        const source =
            clone(data);

        this.model =
            MODEL_NAME;

        this.schemaVersion =
            normalizeString(
                source.schemaVersion,
                SCHEMA_VERSION
            );

        /**
         * Identity.
         */
        this.id =
            normalizeString(
                source.id ||
                source._id ||
                source.metricsId
            );

        this.metricsId =
            this.id ||
            normalizeString(
                source.metricsId
            );

        this.snapshotId =
            normalizeString(
                source.snapshotId
            );

        /**
         * Tenant boundary.
         */
        this.tenantId =
            normalizeString(
                source.tenantId
            );

        this.organizationId =
            normalizeString(
                source.organizationId
            );

        this.groupId =
            normalizeString(
                source.groupId
            );

        this.branchId =
            normalizeString(
                source.branchId
            );

        /**
         * Scope.
         */
        this.scope =
            normalizeString(
                source.scope
            );

        this.scopeType =
            normalizeString(
                source.scopeType
            );

        this.environment =
            normalizeString(
                source.environment,
                'production'
            );

        /**
         * Metric classification.
         */
        this.metricType =
            normalizeEnum(
                source.metricType,
                Object.values(
                    METRIC_TYPE
                ),
                METRIC_TYPE.GAUGE
            );

        this.periodType =
            normalizeEnum(
                source.periodType,
                Object.values(
                    PERIOD_TYPE
                ),
                PERIOD_TYPE.CUSTOM
            );

        this.processingStage =
            normalizeEnum(
                source.processingStage ||
                source.stage,
                Object.values(
                    PROCESSING_STAGE
                ),
                PROCESSING_STAGE.END_TO_END
            );

        /**
         * Lifecycle.
         */
        this.status =
            normalizeEnum(
                source.status,
                Object.values(
                    STATUS
                ),
                STATUS.UNKNOWN
            );

        this.healthLevel =
            normalizeEnum(
                source.healthLevel,
                Object.values(
                    HEALTH_LEVEL
                ),
                HEALTH_LEVEL.UNKNOWN
            );

        /**
         * Period.
         */
        this.period =
            this._normalizePeriod(
                source.period
            );

        /**
         * Core processing metrics.
         */
        this.processing =
            this._normalizeProcessing(
                source.processing
            );

        /**
         * Statement metrics.
         */
        this.statements =
            this._normalizeStatements(
                source.statements
            );

        /**
         * Reconciliation metrics.
         */
        this.reconciliation =
            this._normalizeReconciliation(
                source.reconciliation
            );

        /**
         * Repair metrics.
         */
        this.repairs =
            this._normalizeRepairs(
                source.repairs
            );

        /**
         * Settlement metrics.
         */
        this.settlement =
            this._normalizeSettlement(
                source.settlement
            );

        /**
         * Ledger metrics.
         */
        this.ledger =
            this._normalizeLedger(
                source.ledger
            );

        /**
         * Fraud metrics.
         */
        this.fraud =
            this._normalizeFraud(
                source.fraud
            );

        /**
         * Data quality metrics.
         */
        this.dataQuality =
            this._normalizeDataQuality(
                source.dataQuality
            );

        /**
         * Reliability metrics.
         */
        this.reliability =
            this._normalizeReliability(
                source.reliability
            );

        /**
         * Queue / infrastructure metrics.
         */
        this.infrastructure =
            this._normalizeInfrastructure(
                source.infrastructure
            );

        /**
         * Financial volume metrics.
         */
        this.financial =
            this._normalizeFinancial(
                source.financial
            );

        /**
         * Performance scores.
         */
        this.scores =
            this._normalizeScores(
                source.scores
            );

        /**
         * Dimensional breakdowns.
         */
        this.dimensions =
            normalizeArray(
                source.dimensions,
                DEFAULTS.maximumDimensions
            );

        this.breakdowns =
            normalizeArray(
                source.breakdowns,
                DEFAULTS.maximumBreakdowns
            );

        /**
         * Custom metrics.
         */
        this.customMetrics =
            this._normalizeCustomMetrics(
                source.customMetrics
            );

        /**
         * Errors / warnings.
         */
        this.errors =
            normalizeArray(
                source.errors,
                DEFAULTS.maximumErrors
            );

        this.warnings =
            normalizeArray(
                source.warnings,
                DEFAULTS.maximumWarnings
            );

        /**
         * Samples / observations.
         */
        this.samples =
            normalizeArray(
                source.samples,
                DEFAULTS.maximumSamples
            );

        /**
         * Tags.
         */
        this.tags =
            uniqueStrings(
                source.tags,
                DEFAULTS.maximumTags
            );

        /**
         * Historical state.
         */
        this.history =
            normalizeArray(
                source.history,
                DEFAULTS.maximumHistory
            );

        /**
         * Detection / calculation provenance.
         */
        this.provenance =
            this._normalizeProvenance(
                source.provenance
            );

        /**
         * Observability.
         */
        this.requestId =
            normalizeString(
                source.requestId
            );

        this.traceId =
            normalizeString(
                source.traceId
            );

        this.createdBy =
            normalizeString(
                source.createdBy
            );

        this.updatedBy =
            normalizeString(
                source.updatedBy
            );

        /**
         * Timestamps.
         */
        const createdAt =
            normalizeDate(
                source.createdAt
            );

        this.createdAt =
            createdAt ||
            new Date();

        this.updatedAt =
            normalizeDate(
                source.updatedAt
            ) ||
            new Date(
                this.createdAt.getTime()
            );

        this.calculatedAt =
            normalizeDate(
                source.calculatedAt
            ) ||
            new Date(
                this.updatedAt.getTime()
            );

        this.expiresAt =
            normalizeDate(
                source.expiresAt
            );

        /**
         * Extensible metadata.
         */
        this.metadata =
            isObject(
                source.metadata
            )
                ? clone(
                    source.metadata
                )
                : {};

        /**
         * Integrity fingerprint.
         */
        this.fingerprint =
            normalizeString(
                source.fingerprint
            ) ||
            this.generateFingerprint();
    }

    /**
     * =========================================================================
     * Period
     * =========================================================================
     */

    _normalizePeriod(
        period
    ) {

        const source =
            isObject(period)
                ? period
                : {};

        return {

            start:
                normalizeDate(
                    source.start
                ),

            end:
                normalizeDate(
                    source.end
                ),

            timezone:
                normalizeString(
                    source.timezone
                ),

            fiscalYear:
                toNumber(
                    source.fiscalYear
                ),

            fiscalPeriod:
                normalizeString(
                    source.fiscalPeriod
                ),

            label:
                normalizeString(
                    source.label
                )
        };
    }

    /**
     * =========================================================================
     * Processing Metrics
     * =========================================================================
     */

    _normalizeProcessing(
        processing
    ) {

        const source =
            isObject(processing)
                ? processing
                : {};

        return {

            totalItems:
                toNumber(
                    source.totalItems,
                    0
                ),

            successfulItems:
                toNumber(
                    source.successfulItems,
                    0
                ),

            failedItems:
                toNumber(
                    source.failedItems,
                    0
                ),

            skippedItems:
                toNumber(
                    source.skippedItems,
                    0
                ),

            retriedItems:
                toNumber(
                    source.retriedItems,
                    0
                ),

            pendingItems:
                toNumber(
                    source.pendingItems,
                    0
                ),

            processingTimeMs:
                toNumber(
                    source.processingTimeMs,
                    0
                ),

            averageProcessingTimeMs:
                toNumber(
                    source.averageProcessingTimeMs,
                    0
                ),

            medianProcessingTimeMs:
                toNumber(
                    source.medianProcessingTimeMs,
                    0
                ),

            p95ProcessingTimeMs:
                toNumber(
                    source.p95ProcessingTimeMs,
                    0
                ),

            p99ProcessingTimeMs:
                toNumber(
                    source.p99ProcessingTimeMs,
                    0
                ),

            throughputPerSecond:
                toNumber(
                    source.throughputPerSecond,
                    0
                ),

            successRate:
                toNumber(
                    source.successRate
                ),

            failureRate:
                toNumber(
                    source.failureRate
                ),

            retryRate:
                toNumber(
                    source.retryRate
                )
        };
    }

    /**
     * =========================================================================
     * Statement Metrics
     * =========================================================================
     */

    _normalizeStatements(
        statements
    ) {

        const source =
            isObject(statements)
                ? statements
                : {};

        return {

            imported:
                toNumber(
                    source.imported,
                    0
                ),

            validated:
                toNumber(
                    source.validated,
                    0
                ),

            rejected:
                toNumber(
                    source.rejected,
                    0
                ),

            partiallyProcessed:
                toNumber(
                    source.partiallyProcessed,
                    0
                ),

            completed:
                toNumber(
                    source.completed,
                    0
                ),

            pending:
                toNumber(
                    source.pending,
                    0
                ),

            duplicateStatements:
                toNumber(
                    source.duplicateStatements,
                    0
                ),

            malformedStatements:
                toNumber(
                    source.malformedStatements,
                    0
                ),

            totalLines:
                toNumber(
                    source.totalLines,
                    0
                ),

            validLines:
                toNumber(
                    source.validLines,
                    0
                ),

            invalidLines:
                toNumber(
                    source.invalidLines,
                    0
                ),

            duplicateLines:
                toNumber(
                    source.duplicateLines,
                    0
                )
        };
    }

    /**
     * =========================================================================
     * Reconciliation Metrics
     * =========================================================================
     */

    _normalizeReconciliation(
        reconciliation
    ) {

        const source =
            isObject(reconciliation)
                ? reconciliation
                : {};

        return {

            totalTransactions:
                toNumber(
                    source.totalTransactions,
                    0
                ),

            matchedTransactions:
                toNumber(
                    source.matchedTransactions,
                    0
                ),

            unmatchedTransactions:
                toNumber(
                    source.unmatchedTransactions,
                    0
                ),

            partiallyMatchedTransactions:
                toNumber(
                    source.partiallyMatchedTransactions,
                    0
                ),

            duplicateTransactions:
                toNumber(
                    source.duplicateTransactions,
                    0
                ),

            missingLedgerEntries:
                toNumber(
                    source.missingLedgerEntries,
                    0
                ),

            amountVariances:
                toNumber(
                    source.amountVariances,
                    0
                ),

            countVariances:
                toNumber(
                    source.countVariances,
                    0
                ),

            matchedAmount:
                toNumber(
                    source.matchedAmount,
                    0
                ),

            unmatchedAmount:
                toNumber(
                    source.unmatchedAmount,
                    0
                ),

            varianceAmount:
                toNumber(
                    source.varianceAmount,
                    0
                ),

            matchRate:
                toNumber(
                    source.matchRate
                ),

            exceptionRate:
                toNumber(
                    source.exceptionRate
                ),

            reconciliationTimeMs:
                toNumber(
                    source.reconciliationTimeMs,
                    0
                )
        };
    }

    /**
     * =========================================================================
     * Repair Metrics
     * =========================================================================
     */

    _normalizeRepairs(
        repairs
    ) {

        const source =
            isObject(repairs)
                ? repairs
                : {};

        return {

            total:
                toNumber(
                    source.total,
                    0
                ),

            automated:
                toNumber(
                    source.automated,
                    0
                ),

            manual:
                toNumber(
                    source.manual,
                    0
                ),

            successful:
                toNumber(
                    source.successful,
                    0
                ),

            failed:
                toNumber(
                    source.failed,
                    0
                ),

            pending:
                toNumber(
                    source.pending,
                    0
                ),

            rolledBack:
                toNumber(
                    source.rolledBack,
                    0
                ),

            escalated:
                toNumber(
                    source.escalated,
                    0
                ),

            averageRepairTimeMs:
                toNumber(
                    source.averageRepairTimeMs,
                    0
                ),

            p95RepairTimeMs:
                toNumber(
                    source.p95RepairTimeMs,
                    0
                ),

            repairSuccessRate:
                toNumber(
                    source.repairSuccessRate
                ),

            automationRate:
                toNumber(
                    source.automationRate
                ),

            rollbackRate:
                toNumber(
                    source.rollbackRate
                ),

            escalationRate:
                toNumber(
                    source.escalationRate
                ),

            repairAmount:
                toNumber(
                    source.repairAmount,
                    0
                )
        };
    }

    /**
     * =========================================================================
     * Settlement Metrics
     * =========================================================================
     */

    _normalizeSettlement(
        settlement
    ) {

        const source =
            isObject(settlement)
                ? settlement
                : {};

        return {

            total:
                toNumber(
                    source.total,
                    0
                ),

            successful:
                toNumber(
                    source.successful,
                    0
                ),

            failed:
                toNumber(
                    source.failed,
                    0
                ),

            pending:
                toNumber(
                    source.pending,
                    0
                ),

            delayed:
                toNumber(
                    source.delayed,
                    0
                ),

            mismatched:
                toNumber(
                    source.mismatched,
                    0
                ),

            totalAmount:
                toNumber(
                    source.totalAmount,
                    0
                ),

            settledAmount:
                toNumber(
                    source.settledAmount,
                    0
                ),

            unsettledAmount:
                toNumber(
                    source.unsettledAmount,
                    0
                ),

            varianceAmount:
                toNumber(
                    source.varianceAmount,
                    0
                ),

            averageSettlementTimeMs:
                toNumber(
                    source.averageSettlementTimeMs,
                    0
                ),

            p95SettlementTimeMs:
                toNumber(
                    source.p95SettlementTimeMs,
                    0
                ),

            settlementSuccessRate:
                toNumber(
                    source.settlementSuccessRate
                ),

            settlementReliabilityScore:
                toNumber(
                    source.settlementReliabilityScore
                )
        };
    }

    /**
     * =========================================================================
     * Ledger Metrics
     * =========================================================================
     */

    _normalizeLedger(
        ledger
    ) {

        const source =
            isObject(ledger)
                ? ledger
                : {};

        return {

            postings:
                toNumber(
                    source.postings,
                    0
                ),

            successfulPostings:
                toNumber(
                    source.successfulPostings,
                    0
                ),

            failedPostings:
                toNumber(
                    source.failedPostings,
                    0
                ),

            balancedJournals:
                toNumber(
                    source.balancedJournals,
                    0
                ),

            unbalancedJournals:
                toNumber(
                    source.unbalancedJournals,
                    0
                ),

            integrityFailures:
                toNumber(
                    source.integrityFailures,
                    0
                ),

            postingLatencyMs:
                toNumber(
                    source.postingLatencyMs,
                    0
                ),

            ledgerVarianceAmount:
                toNumber(
                    source.ledgerVarianceAmount,
                    0
                ),

            postingSuccessRate:
                toNumber(
                    source.postingSuccessRate
                ),

            journalBalanceRate:
                toNumber(
                    source.journalBalanceRate
                ),

            ledgerIntegrityScore:
                toNumber(
                    source.ledgerIntegrityScore
                )
        };
    }

    /**
     * =========================================================================
     * Fraud Metrics
     * =========================================================================
     */

    _normalizeFraud(
        fraud
    ) {

        const source =
            isObject(fraud)
                ? fraud
                : {};

        return {

            transactionsScreened:
                toNumber(
                    source.transactionsScreened,
                    0
                ),

            alertsGenerated:
                toNumber(
                    source.alertsGenerated,
                    0
                ),

            highRiskAlerts:
                toNumber(
                    source.highRiskAlerts,
                    0
                ),

            criticalAlerts:
                toNumber(
                    source.criticalAlerts,
                    0
                ),

            confirmedCases:
                toNumber(
                    source.confirmedCases,
                    0
                ),

            falsePositives:
                toNumber(
                    source.falsePositives,
                    0
                ),

            escalations:
                toNumber(
                    source.escalations,
                    0
                ),

            fraudExposureAmount:
                toNumber(
                    source.fraudExposureAmount,
                    0
                ),

            averageRiskScore:
                toNumber(
                    source.averageRiskScore
                ),

            detectionRate:
                toNumber(
                    source.detectionRate
                ),

            falsePositiveRate:
                toNumber(
                    source.falsePositiveRate
                ),

            confirmationRate:
                toNumber(
                    source.confirmationRate
                )
        };
    }

    /**
     * =========================================================================
     * Data Quality
     * =========================================================================
     */

    _normalizeDataQuality(
        dataQuality
    ) {

        const source =
            isObject(dataQuality)
                ? dataQuality
                : {};

        return {

            recordsProcessed:
                toNumber(
                    source.recordsProcessed,
                    0
                ),

            recordsValid:
                toNumber(
                    source.recordsValid,
                    0
                ),

            recordsInvalid:
                toNumber(
                    source.recordsInvalid,
                    0
                ),

            recordsIncomplete:
                toNumber(
                    source.recordsIncomplete,
                    0
                ),

            duplicateRecords:
                toNumber(
                    source.duplicateRecords,
                    0
                ),

            missingRequiredFields:
                toNumber(
                    source.missingRequiredFields,
                    0
                ),

            malformedRecords:
                toNumber(
                    source.malformedRecords,
                    0
                ),

            qualityScore:
                toNumber(
                    source.qualityScore
                ),

            completenessRate:
                toNumber(
                    source.completenessRate
                ),

            validityRate:
                toNumber(
                    source.validityRate
                ),

            duplicateRate:
                toNumber(
                    source.duplicateRate
                )
        };
    }

    /**
     * =========================================================================
     * Reliability
     * =========================================================================
     */

    _normalizeReliability(
        reliability
    ) {

        const source =
            isObject(reliability)
                ? reliability
                : {};

        return {

            availabilityRate:
                toNumber(
                    source.availabilityRate
                ),

            successRate:
                toNumber(
                    source.successRate
                ),

            failureRate:
                toNumber(
                    source.failureRate
                ),

            retryRate:
                toNumber(
                    source.retryRate
                ),

            timeoutRate:
                toNumber(
                    source.timeoutRate
                ),

            recoveryRate:
                toNumber(
                    source.recoveryRate
                ),

            meanTimeToRecoveryMs:
                toNumber(
                    source.meanTimeToRecoveryMs
                ),

            meanTimeBetweenFailuresMs:
                toNumber(
                    source.meanTimeBetweenFailuresMs
                ),

            reliabilityScore:
                toNumber(
                    source.reliabilityScore
                )
        };
    }

    /**
     * =========================================================================
     * Infrastructure
     * =========================================================================
     */

    _normalizeInfrastructure(
        infrastructure
    ) {

        const source =
            isObject(infrastructure)
                ? infrastructure
                : {};

        return {

            queueDepth:
                toNumber(
                    source.queueDepth,
                    0
                ),

            queueAgeMs:
                toNumber(
                    source.queueAgeMs,
                    0
                ),

            activeWorkers:
                toNumber(
                    source.activeWorkers,
                    0
                ),

            failedJobs:
                toNumber(
                    source.failedJobs,
                    0
                ),

            delayedJobs:
                toNumber(
                    source.delayedJobs,
                    0
                ),

            deadLetterJobs:
                toNumber(
                    source.deadLetterJobs,
                    0
                ),

            retryBacklog:
                toNumber(
                    source.retryBacklog,
                    0
                ),

            cpuUtilizationPercent:
                toNumber(
                    source.cpuUtilizationPercent
                ),

            memoryUtilizationPercent:
                toNumber(
                    source.memoryUtilizationPercent
                ),

            storageUtilizationPercent:
                toNumber(
                    source.storageUtilizationPercent
                ),

            databaseLatencyMs:
                toNumber(
                    source.databaseLatencyMs
                ),

            cacheLatencyMs:
                toNumber(
                    source.cacheLatencyMs
                )
        };
    }

    /**
     * =========================================================================
     * Financial Volume
     * =========================================================================
     */

    _normalizeFinancial(
        financial
    ) {

        const source =
            isObject(financial)
                ? financial
                : {};

        return {

            transactionCount:
                toNumber(
                    source.transactionCount,
                    0
                ),

            transactionAmount:
                toNumber(
                    source.transactionAmount,
                    0
                ),

            debitAmount:
                toNumber(
                    source.debitAmount,
                    0
                ),

            creditAmount:
                toNumber(
                    source.creditAmount,
                    0
                ),

            netAmount:
                toNumber(
                    source.netAmount,
                    0
                ),

            repairedAmount:
                toNumber(
                    source.repairedAmount,
                    0
                ),

            reconciledAmount:
                toNumber(
                    source.reconciledAmount,
                    0
                ),

            varianceAmount:
                toNumber(
                    source.varianceAmount,
                    0
                ),

            currency:
                normalizeString(
                    source.currency
                ),

            currencyAggregation:
                normalizeEnum(
                    source.currencyAggregation,
                    Object.values(
                        CURRENCY_AGGREGATION
                    ),
                    CURRENCY_AGGREGATION.NONE
                )
        };
    }

    /**
     * =========================================================================
     * Scores
     * =========================================================================
     */

    _normalizeScores(
        scores
    ) {

        const source =
            isObject(scores)
                ? scores
                : {};

        return {

            overall:
                toNumber(
                    source.overall
                ),

            processing:
                toNumber(
                    source.processing
                ),

            reconciliation:
                toNumber(
                    source.reconciliation
                ),

            repair:
                toNumber(
                    source.repair
                ),

            settlement:
                toNumber(
                    source.settlement
                ),

            ledger:
                toNumber(
                    source.ledger
                ),

            fraud:
                toNumber(
                    source.fraud
                ),

            dataQuality:
                toNumber(
                    source.dataQuality
                ),

            reliability:
                toNumber(
                    source.reliability
                ),

            infrastructure:
                toNumber(
                    source.infrastructure
                )
        };
    }

    /**
     * =========================================================================
     * Custom Metrics
     * =========================================================================
     */

    _normalizeCustomMetrics(
        metrics
    ) {

        if (!isObject(metrics)) {
            return {};
        }

        const result = {};

        const keys =
            Object.keys(
                metrics
            ).slice(
                0,
                DEFAULTS.maximumCustomMetrics
            );

        for (const key of keys) {

            const normalizedKey =
                normalizeString(
                    key
                );

            if (!normalizedKey) {
                continue;
            }

            const value =
                metrics[key];

            if (
                typeof value ===
                'number'
            ) {
                result[
                    normalizedKey
                ] = Number.isFinite(value)
                    ? value
                    : null;

            } else if (
                typeof value ===
                'boolean'
            ) {
                result[
                    normalizedKey
                ] = value;

            } else if (
                typeof value ===
                'string'
            ) {
                result[
                    normalizedKey
                ] =
                    value.trim();

            } else {
                result[
                    normalizedKey
                ] =
                    clone(value);
            }
        }

        return result;
    }

    /**
     * =========================================================================
     * Provenance
     * =========================================================================
     */

    _normalizeProvenance(
        provenance
    ) {

        const source =
            isObject(provenance)
                ? provenance
                : {};

        return {

            source:
                normalizeString(
                    source.source
                ),

            sourceSystem:
                normalizeString(
                    source.sourceSystem
                ),

            collector:
                normalizeString(
                    source.collector
                ),

            collectorVersion:
                normalizeString(
                    source.collectorVersion
                ),

            calculationEngine:
                normalizeString(
                    source.calculationEngine
                ),

            calculationVersion:
                normalizeString(
                    source.calculationVersion
                ),

            environment:
                normalizeString(
                    source.environment
                ),

            generatedAt:
                normalizeDate(
                    source.generatedAt
                )
        };
    }

    /**
     * =========================================================================
     * Derived Rates
     * =========================================================================
     */

    calculateDerivedMetrics() {

        const processing =
            this.processing;

        processing.successRate =
            this._safeRate(
                processing.successfulItems,
                processing.totalItems
            );

        processing.failureRate =
            this._safeRate(
                processing.failedItems,
                processing.totalItems
            );

        processing.retryRate =
            this._safeRate(
                processing.retriedItems,
                processing.totalItems
            );

        this.reconciliation.matchRate =
            this._safeRate(
                this.reconciliation.matchedTransactions,
                this.reconciliation.totalTransactions
            );

        this.reconciliation.exceptionRate =
            this._safeRate(
                this.reconciliation.unmatchedTransactions +
                this.reconciliation.partiallyMatchedTransactions +
                this.reconciliation.amountVariances,
                this.reconciliation.totalTransactions
            );

        this.repairs.repairSuccessRate =
            this._safeRate(
                this.repairs.successful,
                this.repairs.total
            );

        this.repairs.automationRate =
            this._safeRate(
                this.repairs.automated,
                this.repairs.total
            );

        this.repairs.rollbackRate =
            this._safeRate(
                this.repairs.rolledBack,
                this.repairs.total
            );

        this.repairs.escalationRate =
            this._safeRate(
                this.repairs.escalated,
                this.repairs.total
            );

        this.settlement.settlementSuccessRate =
            this._safeRate(
                this.settlement.successful,
                this.settlement.total
            );

        this.ledger.postingSuccessRate =
            this._safeRate(
                this.ledger.successfulPostings,
                this.ledger.postings
            );

        this.ledger.journalBalanceRate =
            this._safeRate(
                this.ledger.balancedJournals,
                this.ledger.balancedJournals +
                this.ledger.unbalancedJournals
            );

        this.dataQuality.completenessRate =
            100 -
            this._safeRate(
                this.dataQuality.missingRequiredFields,
                Math.max(
                    this.dataQuality.recordsProcessed,
                    1
                )
            );

        this.dataQuality.validityRate =
            this._safeRate(
                this.dataQuality.recordsValid,
                this.dataQuality.recordsProcessed
            );

        this.dataQuality.duplicateRate =
            this._safeRate(
                this.dataQuality.duplicateRecords,
                this.dataQuality.recordsProcessed
            );

        this.reliability.failureRate =
            this._safeRate(
                this.processing.failedItems,
                this.processing.totalItems
            );

        this.financial.netAmount =
            round(
                this.financial.creditAmount -
                this.financial.debitAmount,
                2
            );

        this.updatedAt =
            new Date();

        this.refreshFingerprint();

        return this;
    }

    _safeRate(
        numerator,
        denominator
    ) {

        const numeratorValue =
            toNumber(
                numerator,
                0
            );

        const denominatorValue =
            toNumber(
                denominator,
                0
            );

        if (
            denominatorValue <= 0
        ) {
            return null;
        }

        return round(
            clamp(
                (
                    numeratorValue /
                    denominatorValue
                ) *
                100,
                0,
                100
            ),
            4
        );
    }

    /**
     * =========================================================================
     * Health Calculation
     * =========================================================================
     */

    calculateHealthScores() {

        this.scores.processing =
            this._processingScore();

        this.scores.reconciliation =
            this._reconciliationScore();

        this.scores.repair =
            this._repairScore();

        this.scores.settlement =
            this._settlementScore();

        this.scores.ledger =
            this._ledgerScore();

        this.scores.fraud =
            this._fraudScore();

        this.scores.dataQuality =
            this._dataQualityScore();

        this.scores.reliability =
            this._reliabilityScore();

        this.scores.infrastructure =
            this._infrastructureScore();

        const components = [
            this.scores.processing,
            this.scores.reconciliation,
            this.scores.repair,
            this.scores.settlement,
            this.scores.ledger,
            this.scores.fraud,
            this.scores.dataQuality,
            this.scores.reliability,
            this.scores.infrastructure
        ].filter(
            value =>
                Number.isFinite(value)
        );

        this.scores.overall =
            components.length > 0
                ? round(
                    components.reduce(
                        (
                            sum,
                            value
                        ) =>
                            sum + value,
                        0
                    ) /
                    components.length,
                    2
                )
                : null;

        this.healthLevel =
            this.classifyHealthLevel();

        this.status =
            this.classifyStatus();

        this.updatedAt =
            new Date();

        this.refreshFingerprint();

        return this.scores.overall;
    }

    _processingScore() {

        const success =
            this.processing.successRate;

        const latency =
            this._latencyScore(
                this.processing.p95ProcessingTimeMs
            );

        const retry =
            100 -
            clamp(
                this.processing.retryRate || 0,
                0,
                100
            );

        return this._weightedScore([
            [success, 0.50],
            [latency, 0.30],
            [retry, 0.20]
        ]);
    }

    _reconciliationScore() {

        const matchRate =
            this.reconciliation.matchRate;

        const variancePenalty =
            this._penaltyScore(
                this.reconciliation.varianceAmount,
                this.reconciliation.matchedAmount +
                this.reconciliation.unmatchedAmount
            );

        return this._weightedScore([
            [matchRate, 0.70],
            [variancePenalty, 0.30]
        ]);
    }

    _repairScore() {

        return this._weightedScore([
            [
                this.repairs.repairSuccessRate,
                0.50
            ],
            [
                this.repairs.automationRate,
                0.20
            ],
            [
                100 -
                clamp(
                    this.repairs.rollbackRate || 0,
                    0,
                    100
                ),
                0.15
            ],
            [
                100 -
                clamp(
                    this.repairs.escalationRate || 0,
                    0,
                    100
                ),
                0.15
            ]
        ]);
    }

    _settlementScore() {

        return this._weightedScore([
            [
                this.settlement.settlementSuccessRate,
                0.45
            ],
            [
                this._penaltyScore(
                    this.settlement.varianceAmount,
                    this.settlement.totalAmount
                ),
                0.35
            ],
            [
                this.settlement.settlementReliabilityScore,
                0.20
            ]
        ]);
    }

    _ledgerScore() {

        return this._weightedScore([
            [
                this.ledger.postingSuccessRate,
                0.35
            ],
            [
                this.ledger.journalBalanceRate,
                0.35
            ],
            [
                this.ledger.ledgerIntegrityScore,
                0.30
            ]
        ]);
    }

    _fraudScore() {

        const falsePositivePenalty =
            100 -
            clamp(
                this.fraud.falsePositiveRate || 0,
                0,
                100
            );

        return this._weightedScore([
            [
                this.fraud.confirmationRate,
                0.30
            ],
            [
                this.fraud.detectionRate,
                0.30
            ],
            [
                falsePositivePenalty,
                0.40
            ]
        ]);
    }

    _dataQualityScore() {

        return this._weightedScore([
            [
                this.dataQuality.validityRate,
                0.40
            ],
            [
                this.dataQuality.completenessRate,
                0.40
            ],
            [
                100 -
                clamp(
                    this.dataQuality.duplicateRate || 0,
                    0,
                    100
                ),
                0.20
            ]
        ]);
    }

    _reliabilityScore() {

        return this._weightedScore([
            [
                this.reliability.availabilityRate,
                0.30
            ],
            [
                this.reliability.successRate,
                0.30
            ],
            [
                this.reliability.recoveryRate,
                0.20
            ],
            [
                100 -
                clamp(
                    this.reliability.timeoutRate || 0,
                    0,
                    100
                ),
                0.20
            ]
        ]);
    }

    _infrastructureScore() {

        const cpu =
            this._utilizationScore(
                this.infrastructure.cpuUtilizationPercent
            );

        const memory =
            this._utilizationScore(
                this.infrastructure.memoryUtilizationPercent
            );

        const storage =
            this._utilizationScore(
                this.infrastructure.storageUtilizationPercent
            );

        return this._weightedScore([
            [cpu, 0.25],
            [memory, 0.25],
            [storage, 0.20],
            [
                this._queueHealthScore(),
                0.30
            ]
        ]);
    }

    _latencyScore(
        latencyMs
    ) {

        const latency =
            toNumber(
                latencyMs
            );

        if (latency === null) {
            return null;
        }

        if (latency <= 250) {
            return 100;
        }

        if (latency <= 500) {
            return 95;
        }

        if (latency <= 1000) {
            return 85;
        }

        if (latency <= 2500) {
            return 70;
        }

        if (latency <= 5000) {
            return 50;
        }

        if (latency <= 10000) {
            return 30;
        }

        return 10;
    }

    _utilizationScore(
        utilization
    ) {

        const value =
            toNumber(
                utilization
            );

        if (value === null) {
            return null;
        }

        if (value <= 50) {
            return 100;
        }

        if (value <= 65) {
            return 90;
        }

        if (value <= 75) {
            return 80;
        }

        if (value <= 85) {
            return 65;
        }

        if (value <= 95) {
            return 40;
        }

        return 15;
    }

    _queueHealthScore() {

        const depth =
            toNumber(
                this.infrastructure.queueDepth
            );

        if (depth === null) {
            return null;
        }

        if (depth === 0) {
            return 100;
        }

        if (depth <= 10) {
            return 95;
        }

        if (depth <= 50) {
            return 85;
        }

        if (depth <= 100) {
            return 70;
        }

        if (depth <= 500) {
            return 50;
        }

        return 20;
    }

    _penaltyScore(
        variance,
        base
    ) {

        const varianceValue =
            Math.abs(
                toNumber(
                    variance,
                    0
                )
            );

        const baseValue =
            Math.abs(
                toNumber(
                    base,
                    0
                )
            );

        if (
            baseValue <= 0
        ) {
            return 100;
        }

        const ratio =
            (
                varianceValue /
                baseValue
            ) *
            100;

        if (ratio <= 0.01) {
            return 100;
        }

        if (ratio <= 0.05) {
            return 95;
        }

        if (ratio <= 0.10) {
            return 85;
        }

        if (ratio <= 0.25) {
            return 70;
        }

        if (ratio <= 0.50) {
            return 45;
        }

        return 15;
    }

    _weightedScore(
        components
    ) {

        const valid =
            components.filter(
                item =>
                    Array.isArray(item) &&
                    Number.isFinite(
                        item[0]
                    ) &&
                    Number.isFinite(
                        item[1]
                    ) &&
                    item[1] > 0
            );

        if (
            valid.length === 0
        ) {
            return null;
        }

        const totalWeight =
            valid.reduce(
                (
                    sum,
                    item
                ) =>
                    sum + item[1],
                0
            );

        const weighted =
            valid.reduce(
                (
                    sum,
                    item
                ) =>
                    sum +
                    (
                        clamp(
                            item[0],
                            0,
                            100
                        ) *
                        item[1]
                    ),
                0
            );

        return round(
            weighted /
            totalWeight,
            2
        );
    }

    classifyHealthLevel() {

        const score =
            toNumber(
                this.scores.overall
            );

        if (score === null) {
            return HEALTH_LEVEL.UNKNOWN;
        }

        if (score >= 90) {
            return HEALTH_LEVEL.EXCELLENT;
        }

        if (score >= 75) {
            return HEALTH_LEVEL.GOOD;
        }

        if (score >= 60) {
            return HEALTH_LEVEL.FAIR;
        }

        if (score >= 40) {
            return HEALTH_LEVEL.POOR;
        }

        return HEALTH_LEVEL.CRITICAL;
    }

    classifyStatus() {

        switch (
            this.healthLevel
        ) {

            case HEALTH_LEVEL.EXCELLENT:
            case HEALTH_LEVEL.GOOD:
                return STATUS.HEALTHY;

            case HEALTH_LEVEL.FAIR:
                return STATUS.WARNING;

            case HEALTH_LEVEL.POOR:
                return STATUS.DEGRADED;

            case HEALTH_LEVEL.CRITICAL:
                return STATUS.CRITICAL;

            default:
                return STATUS.UNKNOWN;
        }
    }

    /**
     * =========================================================================
     * Operational Helper Methods
     * =========================================================================
     */

    recordError(
        error,
        context = {}
    ) {

        if (
            this.errors.length >=
            DEFAULTS.maximumErrors
        ) {
            this.errors.shift();
        }

        const entry = {

            code:
                normalizeString(
                    context.code ||
                    error?.code
                ),

            message:
                normalizeString(
                    context.message ||
                    error?.message ||
                    error
                ),

            stage:
                normalizeEnum(
                    context.stage ||
                    this.processingStage,
                    Object.values(
                        PROCESSING_STAGE
                    ),
                    PROCESSING_STAGE.UNKNOWN
                ),

            timestamp:
                new Date(),

            metadata:
                isObject(
                    context.metadata
                )
                    ? clone(
                        context.metadata
                    )
                    : {}
        };

        this.errors.push(
            entry
        );

        this.updatedAt =
            new Date();

        this.refreshFingerprint();

        return this;
    }

    recordWarning(
        message,
        context = {}
    ) {

        if (
            this.warnings.length >=
            DEFAULTS.maximumWarnings
        ) {
            this.warnings.shift();
        }

        this.warnings.push({

            code:
                normalizeString(
                    context.code
                ),

            message:
                normalizeString(
                    message
                ),

            stage:
                normalizeEnum(
                    context.stage ||
                    this.processingStage,
                    Object.values(
                        PROCESSING_STAGE
                    ),
                    PROCESSING_STAGE.UNKNOWN
                ),

            timestamp:
                new Date(),

            metadata:
                isObject(
                    context.metadata
                )
                    ? clone(
                        context.metadata
                    )
                    : {}
        });

        this.updatedAt =
            new Date();

        this.refreshFingerprint();

        return this;
    }

    addTag(tag) {

        const normalized =
            normalizeString(
                tag
            );

        if (!normalized) {
            return false;
        }

        if (
            this.tags.some(
                item =>
                    item.toLowerCase() ===
                    normalized.toLowerCase()
            )
        ) {
            return false;
        }

        if (
            this.tags.length >=
            DEFAULTS.maximumTags
        ) {
            return false;
        }

        this.tags.push(
            normalized
        );

        this.updatedAt =
            new Date();

        this.refreshFingerprint();

        return true;
    }

    setCustomMetric(
        name,
        value
    ) {

        const normalized =
            normalizeString(
                name
            );

        if (!normalized) {
            return false;
        }

        if (
            Object.keys(
                this.customMetrics
            ).length >=
            DEFAULTS.maximumCustomMetrics &&
            !Object.prototype.hasOwnProperty.call(
                this.customMetrics,
                normalized
            )
        ) {
            return false;
        }

        this.customMetrics[
            normalized
        ] =
            clone(value);

        this.updatedAt =
            new Date();

        this.refreshFingerprint();

        return true;
    }

    addBreakdown(
        breakdown
    ) {

        if (
            this.breakdowns.length >=
            DEFAULTS.maximumBreakdowns
        ) {
            return false;
        }

        this.breakdowns.push(
            clone(breakdown)
        );

        this.updatedAt =
            new Date();

        this.refreshFingerprint();

        return true;
    }

    addDimension(
        dimension
    ) {

        if (
            this.dimensions.length >=
            DEFAULTS.maximumDimensions
        ) {
            return false;
        }

        this.dimensions.push(
            clone(dimension)
        );

        this.updatedAt =
            new Date();

        this.refreshFingerprint();

        return true;
    }

    /**
     * =========================================================================
     * Historical State
     * =========================================================================
     */

    addHistory(
        event,
        details = {}
    ) {

        if (
            this.history.length >=
            DEFAULTS.maximumHistory
        ) {
            this.history.shift();
        }

        this.history.push({

            event:
                normalizeString(
                    event
                ),

            timestamp:
                new Date(),

            status:
                this.status,

            healthLevel:
                this.healthLevel,

            score:
                this.scores.overall,

            details:
                clone(details)
        });

        return this;
    }

    /**
     * =========================================================================
     * Validation
     * =========================================================================
     */

    validate(
        options = {}
    ) {

        const errors = [];
        const warnings = [];

        const requireTenant =
            options.requireTenant !== false;

        if (
            requireTenant &&
            !this.tenantId
        ) {
            errors.push({
                code:
                    'TENANT_ID_REQUIRED',
                field:
                    'tenantId',
                message:
                    'tenantId is required for tenant-scoped operational metrics.'
            });
        }

        if (
            this.period.start &&
            this.period.end &&
            this.period.start >
                this.period.end
        ) {
            errors.push({
                code:
                    'INVALID_PERIOD',
                field:
                    'period',
                message:
                    'period.start cannot be after period.end.'
            });
        }

        const scoreFields = [
            'overall',
            'processing',
            'reconciliation',
            'repair',
            'settlement',
            'ledger',
            'fraud',
            'dataQuality',
            'reliability',
            'infrastructure'
        ];

        for (
            const field of scoreFields
        ) {

            const value =
                this.scores[field];

            if (
                value !== null &&
                (
                    value < 0 ||
                    value > 100
                )
            ) {
                errors.push({
                    code:
                        'INVALID_SCORE',
                    field:
                        `scores.${field}`,
                    message:
                        `${field} score must be between 0 and 100.`
                });
            }
        }

        if (
            this.processing.totalItems <
            0
        ) {
            errors.push({
                code:
                    'INVALID_PROCESSING_TOTAL',
                field:
                    'processing.totalItems',
                message:
                    'processing.totalItems cannot be negative.'
            });
        }

        if (
            this.reconciliation.totalTransactions <
            0
        ) {
            errors.push({
                code:
                    'INVALID_RECONCILIATION_TOTAL',
                field:
                    'reconciliation.totalTransactions',
                message:
                    'reconciliation.totalTransactions cannot be negative.'
            });
        }

        if (
            this.repairs.total <
            0
        ) {
            errors.push({
                code:
                    'INVALID_REPAIR_TOTAL',
                field:
                    'repairs.total',
                message:
                    'repairs.total cannot be negative.'
            });
        }

        if (
            this.settlement.total <
            0
        ) {
            errors.push({
                code:
                    'INVALID_SETTLEMENT_TOTAL',
                field:
                    'settlement.total',
                message:
                    'settlement.total cannot be negative.'
            });
        }

        if (
            this.financial.currencyAggregation ===
                CURRENCY_AGGREGATION.MULTI &&
            this.financial.currency
        ) {
            warnings.push({
                code:
                    'MULTI_CURRENCY_WITH_SINGLE_CURRENCY',
                field:
                    'financial.currency',
                message:
                    'Multi-currency aggregation should not normally expose a single currency.'
            });
        }

        if (
            this.status ===
                STATUS.CRITICAL &&
            (
                this.scores.overall === null ||
                this.scores.overall >= 60
            )
        ) {
            warnings.push({
                code:
                    'CRITICAL_STATUS_SCORE_MISMATCH',
                message:
                    'Critical status normally corresponds to a low overall health score.'
            });
        }

        return {
            valid:
                errors.length === 0,

            errors,

            warnings
        };
    }

    isValid(
        options = {}
    ) {

        return this.validate(
            options
        ).valid;
    }

    assertValid(
        options = {}
    ) {

        const validation =
            this.validate(
                options
            );

        if (
            !validation.valid
        ) {

            const error =
                new Error(
                    'Invalid OperationalMetrics.'
                );

            error.code =
                'INVALID_OPERATIONAL_METRICS';

            error.details =
                validation.errors;

            throw error;
        }

        return this;
    }

    /**
     * =========================================================================
     * Health Helpers
     * =========================================================================
     */

    isHealthy() {

        return (
            this.status ===
            STATUS.HEALTHY
        );
    }

    isDegraded() {

        return (
            this.status ===
            STATUS.DEGRADED
        );
    }

    isCritical() {

        return (
            this.status ===
            STATUS.CRITICAL
        );
    }

    requiresAttention() {

        return [
            STATUS.WARNING,
            STATUS.DEGRADED,
            STATUS.CRITICAL
        ].includes(
            this.status
        );
    }

    /**
     * =========================================================================
     * Expiration
     * =========================================================================
     */

    isExpired(
        referenceDate = new Date()
    ) {

        if (!this.expiresAt) {
            return false;
        }

        const reference =
            normalizeDate(
                referenceDate
            );

        if (!reference) {
            return false;
        }

        return (
            this.expiresAt.getTime() <=
            reference.getTime()
        );
    }

    /**
     * =========================================================================
     * Integrity Fingerprint
     * =========================================================================
     */

    generateFingerprint() {

        return sha256({

            model:
                MODEL_NAME,

            schemaVersion:
                this.schemaVersion,

            metricsId:
                this.metricsId,

            snapshotId:
                this.snapshotId,

            tenantId:
                this.tenantId,

            organizationId:
                this.organizationId,

            groupId:
                this.groupId,

            branchId:
                this.branchId,

            scope:
                this.scope,

            scopeType:
                this.scopeType,

            environment:
                this.environment,

            metricType:
                this.metricType,

            periodType:
                this.periodType,

            processingStage:
                this.processingStage,

            period:
                this.period,

            processing:
                this.processing,

            statements:
                this.statements,

            reconciliation:
                this.reconciliation,

            repairs:
                this.repairs,

            settlement:
                this.settlement,

            ledger:
                this.ledger,

            fraud:
                this.fraud,

            dataQuality:
                this.dataQuality,

            reliability:
                this.reliability,

            infrastructure:
                this.infrastructure,

            financial:
                this.financial,

            scores:
                this.scores,

            dimensions:
                this.dimensions,

            breakdowns:
                this.breakdowns,

            customMetrics:
                this.customMetrics
        });
    }

    verifyFingerprint() {

        if (!this.fingerprint) {
            return false;
        }

        return (
            this.fingerprint ===
            this.generateFingerprint()
        );
    }

    refreshFingerprint() {

        this.fingerprint =
            this.generateFingerprint();

        return this.fingerprint;
    }

    /**
     * =========================================================================
     * Serialization
     * =========================================================================
     */

    toObject(
        options = {}
    ) {

        const includeMetadata =
            options.includeMetadata !== false;

        const includeDiagnostics =
            options.includeDiagnostics !== false;

        const includeFingerprint =
            options.includeFingerprint !== false;

        const result = {

            model:
                this.model,

            schemaVersion:
                this.schemaVersion,

            id:
                this.id,

            metricsId:
                this.metricsId,

            snapshotId:
                this.snapshotId,

            tenantId:
                this.tenantId,

            organizationId:
                this.organizationId,

            groupId:
                this.groupId,

            branchId:
                this.branchId,

            scope:
                this.scope,

            scopeType:
                this.scopeType,

            environment:
                this.environment,

            metricType:
                this.metricType,

            periodType:
                this.periodType,

            processingStage:
                this.processingStage,

            status:
                this.status,

            healthLevel:
                this.healthLevel,

            period:
                clone(
                    this.period
                ),

            processing:
                clone(
                    this.processing
                ),

            statements:
                clone(
                    this.statements
                ),

            reconciliation:
                clone(
                    this.reconciliation
                ),

            repairs:
                clone(
                    this.repairs
                ),

            settlement:
                clone(
                    this.settlement
                ),

            ledger:
                clone(
                    this.ledger
                ),

            fraud:
                clone(
                    this.fraud
                ),

            dataQuality:
                clone(
                    this.dataQuality
                ),

            reliability:
                clone(
                    this.reliability
                ),

            infrastructure:
                clone(
                    this.infrastructure
                ),

            financial:
                clone(
                    this.financial
                ),

            scores:
                clone(
                    this.scores
                ),

            dimensions:
                clone(
                    this.dimensions
                ),

            breakdowns:
                clone(
                    this.breakdowns
                ),

            customMetrics:
                clone(
                    this.customMetrics
                ),

            tags:
                clone(
                    this.tags
                ),

            provenance:
                clone(
                    this.provenance
                ),

            requestId:
                this.requestId,

            traceId:
                this.traceId,

            createdBy:
                this.createdBy,

            updatedBy:
                this.updatedBy,

            createdAt:
                clone(
                    this.createdAt
                ),

            updatedAt:
                clone(
                    this.updatedAt
                ),

            calculatedAt:
                clone(
                    this.calculatedAt
                ),

            expiresAt:
                clone(
                    this.expiresAt
                )
        };

        if (
            includeDiagnostics
        ) {

            result.errors =
                clone(
                    this.errors
                );

            result.warnings =
                clone(
                    this.warnings
                );

            result.samples =
                clone(
                    this.samples
                );

            result.history =
                clone(
                    this.history
                );
        }

        if (
            includeMetadata
        ) {

            result.metadata =
                clone(
                    this.metadata
                );
        }

        if (
            includeFingerprint
        ) {

            result.fingerprint =
                this.fingerprint;
        }

        return result;
    }

    toJSON() {
        return this.toObject();
    }

    toPersistence() {

        return this.toObject({
            includeMetadata: true,
            includeDiagnostics: true,
            includeFingerprint: true
        });
    }

    /**
     * =========================================================================
     * Static Constructors
     * =========================================================================
     */

    static create(
        data = {}
    ) {

        return new OperationalMetrics(
            data
        );
    }

    static from(
        data = {}
    ) {

        if (
            data instanceof
            OperationalMetrics
        ) {

            return new OperationalMetrics(
                data.toObject()
            );
        }

        return new OperationalMetrics(
            data
        );
    }

    static snapshot(
        data = {}
    ) {

        return new OperationalMetrics({
            ...data,
            metricType:
                METRIC_TYPE.GAUGE
        });
    }

    static realtime(
        data = {}
    ) {

        return new OperationalMetrics({
            ...data,
            periodType:
                PERIOD_TYPE.REALTIME
        });
    }

    /**
     * =========================================================================
     * Static Constants
     * =========================================================================
     */

    static get MODEL_NAME() {
        return MODEL_NAME;
    }

    static get SCHEMA_VERSION() {
        return SCHEMA_VERSION;
    }

    static get STATUS() {
        return STATUS;
    }

    static get HEALTH_LEVEL() {
        return HEALTH_LEVEL;
    }

    static get METRIC_TYPE() {
        return METRIC_TYPE;
    }

    static get PERIOD_TYPE() {
        return PERIOD_TYPE;
    }

    static get PROCESSING_STAGE() {
        return PROCESSING_STAGE;
    }

    static get CURRENCY_AGGREGATION() {
        return CURRENCY_AGGREGATION;
    }
}

/**
 * ============================================================================
 * Module Exports
 * ============================================================================
 *
 * Supports:
 *
 *   const OperationalMetrics =
 *       require('./OperationalMetrics');
 *
 * and:
 *
 *   const {
 *       OperationalMetrics,
 *       STATUS,
 *       HEALTH_LEVEL
 *   } = require('./OperationalMetrics');
 *
 * ============================================================================
 */

module.exports =
    OperationalMetrics;

module.exports.OperationalMetrics =
    OperationalMetrics;

module.exports.STATUS =
    STATUS;

module.exports.HEALTH_LEVEL =
    HEALTH_LEVEL;

module.exports.METRIC_TYPE =
    METRIC_TYPE;

module.exports.PERIOD_TYPE =
    PERIOD_TYPE;

module.exports.PROCESSING_STAGE =
    PROCESSING_STAGE;

module.exports.CURRENCY_AGGREGATION =
    CURRENCY_AGGREGATION;

module.exports.SCHEMA_VERSION =
    SCHEMA_VERSION;
