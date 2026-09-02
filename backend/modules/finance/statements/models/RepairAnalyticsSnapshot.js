'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * RepairAnalyticsSnapshot
 * ============================================================================
 *
 * Enterprise-grade immutable analytics snapshot for the financial statement
 * repair subsystem.
 *
 * Location:
 *   backend/modules/finance/statements/models/RepairAnalyticsSnapshot.js
 *
 * Purpose
 * -------
 * Represents a point-in-time analytical snapshot of statement repair activity.
 *
 * The snapshot provides a stable analytical contract for:
 *
 *   - RepairAnalytics services
 *   - RepairForecastEngine
 *   - PredictiveRepairScheduler
 *   - AIRepairClassifier
 *   - AIRepairRecommendationEngine
 *   - AIConfidenceScorer
 *   - FraudCorrelationEngine
 *   - SettlementReliabilityEngine
 *   - OperationalBenchmarkService
 *   - ExecutiveReportingExporter
 *   - dashboards / reporting pipelines
 *   - historical trend analysis
 *
 * Design principles
 * -----------------
 * - Tenant-aware
 * - Deterministic
 * - Explainable
 * - Persistence-agnostic
 * - Snapshot-oriented
 * - Versioned
 * - Safe for serialization
 * - Safe for event publication
 * - Supports historical comparison
 * - Supports dimensional analysis
 * - Supports model/AI provenance
 * - Supports integrity fingerprints
 *
 * Important
 * ---------
 * This class does NOT:
 *
 *   - execute repairs
 *   - modify transactions
 *   - modify ledger entries
 *   - perform fraud decisions
 *   - schedule jobs
 *   - persist itself
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

const MODEL_NAME = 'RepairAnalyticsSnapshot';

const SCHEMA_VERSION = '1.0.0';

const SNAPSHOT_TYPE = Object.freeze({
    REALTIME: 'REALTIME',
    PERIODIC: 'PERIODIC',
    DAILY: 'DAILY',
    WEEKLY: 'WEEKLY',
    MONTHLY: 'MONTHLY',
    ON_DEMAND: 'ON_DEMAND',
    PRE_CLOSE: 'PRE_CLOSE',
    POST_CLOSE: 'POST_CLOSE'
});

const STATUS = Object.freeze({
    COMPLETE: 'COMPLETE',
    PARTIAL: 'PARTIAL',
    STALE: 'STALE',
    INVALID: 'INVALID',
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

const REPAIR_EXECUTION_MODE = Object.freeze({
    AUTOMATED: 'AUTOMATED',
    MANUAL: 'MANUAL',
    HYBRID: 'HYBRID',
    UNKNOWN: 'UNKNOWN'
});

const REPAIR_OUTCOME = Object.freeze({
    SUCCESSFUL: 'SUCCESSFUL',
    FAILED: 'FAILED',
    PENDING: 'PENDING',
    ROLLED_BACK: 'ROLLED_BACK',
    ESCALATED: 'ESCALATED',
    SKIPPED: 'SKIPPED',
    UNKNOWN: 'UNKNOWN'
});

const CONFIDENCE_LEVEL = Object.freeze({
    VERY_LOW: 'VERY_LOW',
    LOW: 'LOW',
    MEDIUM: 'MEDIUM',
    HIGH: 'HIGH',
    VERY_HIGH: 'VERY_HIGH',
    UNKNOWN: 'UNKNOWN'
});

const FORECAST_DIRECTION = Object.freeze({
    IMPROVING: 'IMPROVING',
    STABLE: 'STABLE',
    DETERIORATING: 'DETERIORATING',
    UNKNOWN: 'UNKNOWN'
});

const TREND_DIRECTION = Object.freeze({
    UP: 'UP',
    DOWN: 'DOWN',
    FLAT: 'FLAT',
    UNKNOWN: 'UNKNOWN'
});

const RISK_LEVEL = Object.freeze({
    LOW: 'LOW',
    MEDIUM: 'MEDIUM',
    HIGH: 'HIGH',
    CRITICAL: 'CRITICAL',
    UNKNOWN: 'UNKNOWN'
});

const DEFAULTS = Object.freeze({
    maximumRepairTypes: 100,
    maximumDimensions: 100,
    maximumTrends: 100,
    maximumForecasts: 100,
    maximumRecommendations: 100,
    maximumAnomalies: 100,
    maximumAlerts: 100,
    maximumSamples: 100,
    maximumHistory: 100,
    maximumTags: 50,
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

    const normalized = String(value).trim();

    return normalized.length > 0
        ? normalized
        : fallback;
}

function normalizeEnum(
    value,
    allowed,
    fallback
) {
    const normalized = normalizeString(value);

    if (!normalized) {
        return fallback;
    }

    const upper = normalized.toUpperCase();

    return allowed.includes(upper)
        ? upper
        : fallback;
}

function toNumber(value, fallback = null) {
    if (
        value === null ||
        value === undefined ||
        value === ''
    ) {
        return fallback;
    }

    const numeric = Number(value);

    return Number.isFinite(numeric)
        ? numeric
        : fallback;
}

function clamp(
    value,
    minimum,
    maximum
) {
    const numeric = toNumber(value, minimum);

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
    const numeric = toNumber(value, 0);

    const factor = 10 ** decimals;

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
        return Number.isNaN(value.getTime())
            ? fallback
            : new Date(value.getTime());
    }

    const date = new Date(value);

    return Number.isNaN(date.getTime())
        ? fallback
        : date;
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
        const normalized = normalizeString(value);

        if (!normalized) {
            continue;
        }

        const key = normalized.toLowerCase();

        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        result.push(normalized);

        if (result.length >= maximum) {
            break;
        }
    }

    return result;
}

function stableSerialize(value) {
    if (value === null) {
        return 'null';
    }

    if (value === undefined) {
        return 'undefined';
    }

    if (value instanceof Date) {
        return JSON.stringify(value.toISOString());
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
        .update(stableSerialize(value))
        .digest('hex');
}

/**
 * ============================================================================
 * RepairAnalyticsSnapshot
 * ============================================================================
 */

class RepairAnalyticsSnapshot {

    /**
     * @param {Object} data
     */
    constructor(data = {}) {

        if (!isObject(data)) {
            throw new TypeError(
                'RepairAnalyticsSnapshot data must be an object.'
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

        const source = clone(data);

        this.model = MODEL_NAME;

        this.schemaVersion =
            normalizeString(
                source.schemaVersion,
                SCHEMA_VERSION
            );

        /**
         * ---------------------------------------------------------------------
         * Identity
         * ---------------------------------------------------------------------
         */

        this.id =
            normalizeString(
                source.id ||
                source._id
            );

        this.snapshotId =
            normalizeString(
                source.snapshotId
            ) ||
            this._generateSnapshotId();

        this.analyticsRunId =
            normalizeString(
                source.analyticsRunId
            );

        this.correlationId =
            normalizeString(
                source.correlationId
            );

        /**
         * ---------------------------------------------------------------------
         * Tenant / organizational scope
         * ---------------------------------------------------------------------
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

        this.accountId =
            normalizeString(
                source.accountId
            );

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
         * ---------------------------------------------------------------------
         * Snapshot classification
         * ---------------------------------------------------------------------
         */

        this.snapshotType =
            normalizeEnum(
                source.snapshotType,
                Object.values(SNAPSHOT_TYPE),
                SNAPSHOT_TYPE.ON_DEMAND
            );

        this.status =
            normalizeEnum(
                source.status,
                Object.values(STATUS),
                STATUS.UNKNOWN
            );

        this.healthLevel =
            normalizeEnum(
                source.healthLevel,
                Object.values(HEALTH_LEVEL),
                HEALTH_LEVEL.UNKNOWN
            );

        /**
         * ---------------------------------------------------------------------
         * Time period
         * ---------------------------------------------------------------------
         */

        this.period =
            this._normalizePeriod(
                source.period
            );

        /**
         * ---------------------------------------------------------------------
         * Core repair counters
         * ---------------------------------------------------------------------
         */

        this.summary =
            this._normalizeSummary(
                source.summary
            );

        /**
         * ---------------------------------------------------------------------
         * Repair execution analytics
         * ---------------------------------------------------------------------
         */

        this.execution =
            this._normalizeExecution(
                source.execution
            );

        /**
         * ---------------------------------------------------------------------
         * Repair outcome analytics
         * ---------------------------------------------------------------------
         */

        this.outcomes =
            this._normalizeOutcomes(
                source.outcomes
            );

        /**
         * ---------------------------------------------------------------------
         * Repair type analytics
         * ---------------------------------------------------------------------
         */

        this.repairTypes =
            this._normalizeRepairTypes(
                source.repairTypes
            );

        /**
         * ---------------------------------------------------------------------
         * Severity analytics
         * ---------------------------------------------------------------------
         */

        this.severity =
            this._normalizeSeverity(
                source.severity
            );

        /**
         * ---------------------------------------------------------------------
         * Financial impact
         * ---------------------------------------------------------------------
         */

        this.financialImpact =
            this._normalizeFinancialImpact(
                source.financialImpact
            );

        /**
         * ---------------------------------------------------------------------
         * Processing performance
         * ---------------------------------------------------------------------
         */

        this.performance =
            this._normalizePerformance(
                source.performance
            );

        /**
         * ---------------------------------------------------------------------
         * Repair quality
         * ---------------------------------------------------------------------
         */

        this.quality =
            this._normalizeQuality(
                source.quality
            );

        /**
         * ---------------------------------------------------------------------
         * Risk analytics
         * ---------------------------------------------------------------------
         */

        this.risk =
            this._normalizeRisk(
                source.risk
            );

        /**
         * ---------------------------------------------------------------------
         * AI analytics
         * ---------------------------------------------------------------------
         */

        this.ai =
            this._normalizeAI(
                source.ai
            );

        /**
         * ---------------------------------------------------------------------
         * Forecast analytics
         * ---------------------------------------------------------------------
         */

        this.forecast =
            this._normalizeForecast(
                source.forecast
            );

        /**
         * ---------------------------------------------------------------------
         * Scheduling analytics
         * ---------------------------------------------------------------------
         */

        this.scheduling =
            this._normalizeScheduling(
                source.scheduling
            );

        /**
         * ---------------------------------------------------------------------
         * Settlement correlation
         * ---------------------------------------------------------------------
         */

        this.settlement =
            this._normalizeSettlement(
                source.settlement
            );

        /**
         * ---------------------------------------------------------------------
         * Fraud correlation
         * ---------------------------------------------------------------------
         */

        this.fraud =
            this._normalizeFraud(
                source.fraud
            );

        /**
         * ---------------------------------------------------------------------
         * Trend analytics
         * ---------------------------------------------------------------------
         */

        this.trends =
            normalizeArray(
                source.trends,
                DEFAULTS.maximumTrends
            );

        /**
         * ---------------------------------------------------------------------
         * Dimensional analytics
         * ---------------------------------------------------------------------
         */

        this.dimensions =
            normalizeArray(
                source.dimensions,
                DEFAULTS.maximumDimensions
            );

        /**
         * ---------------------------------------------------------------------
         * Anomalies / alerts
         * ---------------------------------------------------------------------
         */

        this.anomalies =
            normalizeArray(
                source.anomalies,
                DEFAULTS.maximumAnomalies
            );

        this.alerts =
            normalizeArray(
                source.alerts,
                DEFAULTS.maximumAlerts
            );

        /**
         * ---------------------------------------------------------------------
         * Forecasts / recommendations
         * ---------------------------------------------------------------------
         */

        this.forecasts =
            normalizeArray(
                source.forecasts,
                DEFAULTS.maximumForecasts
            );

        this.recommendations =
            normalizeArray(
                source.recommendations,
                DEFAULTS.maximumRecommendations
            );

        /**
         * ---------------------------------------------------------------------
         * Samples
         * ---------------------------------------------------------------------
         */

        this.samples =
            normalizeArray(
                source.samples,
                DEFAULTS.maximumSamples
            );

        /**
         * ---------------------------------------------------------------------
         * Custom metrics
         * ---------------------------------------------------------------------
         */

        this.customMetrics =
            this._normalizeCustomMetrics(
                source.customMetrics
            );

        /**
         * ---------------------------------------------------------------------
         * Provenance / explainability
         * ---------------------------------------------------------------------
         */

        this.provenance =
            this._normalizeProvenance(
                source.provenance
            );

        /**
         * ---------------------------------------------------------------------
         * Tags
         * ---------------------------------------------------------------------
         */

        this.tags =
            uniqueStrings(
                source.tags,
                DEFAULTS.maximumTags
            );

        /**
         * ---------------------------------------------------------------------
         * History
         * ---------------------------------------------------------------------
         */

        this.history =
            normalizeArray(
                source.history,
                DEFAULTS.maximumHistory
            );

        /**
         * ---------------------------------------------------------------------
         * Diagnostics
         * ---------------------------------------------------------------------
         */

        this.errors =
            normalizeArray(
                source.errors,
                DEFAULTS.maximumAnomalies
            );

        this.warnings =
            normalizeArray(
                source.warnings,
                DEFAULTS.maximumAnomalies
            );

        /**
         * ---------------------------------------------------------------------
         * Observability
         * ---------------------------------------------------------------------
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
         * ---------------------------------------------------------------------
         * Timestamps
         * ---------------------------------------------------------------------
         */

        this.createdAt =
            normalizeDate(
                source.createdAt
            ) ||
            new Date();

        this.updatedAt =
            normalizeDate(
                source.updatedAt
            ) ||
            new Date(
                this.createdAt.getTime()
            );

        this.generatedAt =
            normalizeDate(
                source.generatedAt
            ) ||
            new Date();

        this.calculatedAt =
            normalizeDate(
                source.calculatedAt
            ) ||
            new Date(
                this.generatedAt.getTime()
            );

        this.expiresAt =
            normalizeDate(
                source.expiresAt
            );

        /**
         * ---------------------------------------------------------------------
         * Metadata
         * ---------------------------------------------------------------------
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
         * ---------------------------------------------------------------------
         * Integrity
         * ---------------------------------------------------------------------
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

    _normalizePeriod(period) {

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

            durationMs:
                toNumber(
                    source.durationMs
                ),

            label:
                normalizeString(
                    source.label
                ),

            fiscalYear:
                toNumber(
                    source.fiscalYear
                ),

            fiscalPeriod:
                normalizeString(
                    source.fiscalPeriod
                )
        };
    }

    /**
     * =========================================================================
     * Summary
     * =========================================================================
     */

    _normalizeSummary(summary) {

        const source =
            isObject(summary)
                ? summary
                : {};

        return {

            totalRepairs:
                toNumber(
                    source.totalRepairs,
                    0
                ),

            successfulRepairs:
                toNumber(
                    source.successfulRepairs,
                    0
                ),

            failedRepairs:
                toNumber(
                    source.failedRepairs,
                    0
                ),

            pendingRepairs:
                toNumber(
                    source.pendingRepairs,
                    0
                ),

            rolledBackRepairs:
                toNumber(
                    source.rolledBackRepairs,
                    0
                ),

            escalatedRepairs:
                toNumber(
                    source.escalatedRepairs,
                    0
                ),

            skippedRepairs:
                toNumber(
                    source.skippedRepairs,
                    0
                ),

            affectedTransactions:
                toNumber(
                    source.affectedTransactions,
                    0
                ),

            affectedStatements:
                toNumber(
                    source.affectedStatements,
                    0
                ),

            repairRate:
                toNumber(
                    source.repairRate
                ),

            successRate:
                toNumber(
                    source.successRate
                ),

            failureRate:
                toNumber(
                    source.failureRate
                )
        };
    }

    /**
     * =========================================================================
     * Execution
     * =========================================================================
     */

    _normalizeExecution(execution) {

        const source =
            isObject(execution)
                ? execution
                : {};

        return {

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

            hybrid:
                toNumber(
                    source.hybrid,
                    0
                ),

            automatedRate:
                toNumber(
                    source.automatedRate
                ),

            manualRate:
                toNumber(
                    source.manualRate
                ),

            averageAttempts:
                toNumber(
                    source.averageAttempts
                ),

            totalAttempts:
                toNumber(
                    source.totalAttempts,
                    0
                ),

            retryCount:
                toNumber(
                    source.retryCount,
                    0
                ),

            retryRate:
                toNumber(
                    source.retryRate
                ),

            rollbackCount:
                toNumber(
                    source.rollbackCount,
                    0
                ),

            rollbackRate:
                toNumber(
                    source.rollbackRate
                )
        };
    }

    /**
     * =========================================================================
     * Outcomes
     * =========================================================================
     */

    _normalizeOutcomes(outcomes) {

        const source =
            isObject(outcomes)
                ? outcomes
                : {};

        return {

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

            skipped:
                toNumber(
                    source.skipped,
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

            recoveryRate:
                toNumber(
                    source.recoveryRate
                ),

            firstAttemptSuccessRate:
                toNumber(
                    source.firstAttemptSuccessRate
                ),

            finalOutcomeSuccessRate:
                toNumber(
                    source.finalOutcomeSuccessRate
                )
        };
    }

    /**
     * =========================================================================
     * Repair Types
     * =========================================================================
     */

    _normalizeRepairTypes(repairTypes) {

        if (!Array.isArray(repairTypes)) {
            return [];
        }

        return repairTypes
            .slice(
                0,
                DEFAULTS.maximumRepairTypes
            )
            .map(item => {

                const source =
                    isObject(item)
                        ? item
                        : {};

                return {

                    type:
                        normalizeString(
                            source.type ||
                            source.repairType,
                            'UNKNOWN'
                        ),

                    count:
                        toNumber(
                            source.count,
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

                    successRate:
                        toNumber(
                            source.successRate
                        ),

                    failureRate:
                        toNumber(
                            source.failureRate
                        ),

                    averageDurationMs:
                        toNumber(
                            source.averageDurationMs
                        ),

                    totalAmount:
                        toNumber(
                            source.totalAmount,
                            0
                        ),

                    varianceAmount:
                        toNumber(
                            source.varianceAmount,
                            0
                        ),

                    riskScore:
                        toNumber(
                            source.riskScore
                        )
                };
            });
    }

    /**
     * =========================================================================
     * Severity
     * =========================================================================
     */

    _normalizeSeverity(severity) {

        const source =
            isObject(severity)
                ? severity
                : {};

        return {

            low:
                toNumber(
                    source.low,
                    0
                ),

            medium:
                toNumber(
                    source.medium,
                    0
                ),

            high:
                toNumber(
                    source.high,
                    0
                ),

            critical:
                toNumber(
                    source.critical,
                    0
                ),

            lowRate:
                toNumber(
                    source.lowRate
                ),

            mediumRate:
                toNumber(
                    source.mediumRate
                ),

            highRate:
                toNumber(
                    source.highRate
                ),

            criticalRate:
                toNumber(
                    source.criticalRate
                ),

            weightedSeverityScore:
                toNumber(
                    source.weightedSeverityScore
                )
        };
    }

    /**
     * =========================================================================
     * Financial Impact
     * =========================================================================
     */

    _normalizeFinancialImpact(
        financialImpact
    ) {

        const source =
            isObject(financialImpact)
                ? financialImpact
                : {};

        return {

            totalAffectedAmount:
                toNumber(
                    source.totalAffectedAmount,
                    0
                ),

            totalRepairedAmount:
                toNumber(
                    source.totalRepairedAmount,
                    0
                ),

            totalVarianceAmount:
                toNumber(
                    source.totalVarianceAmount,
                    0
                ),

            recoveredAmount:
                toNumber(
                    source.recoveredAmount,
                    0
                ),

            unrecoveredAmount:
                toNumber(
                    source.unrecoveredAmount,
                    0
                ),

            preventedLossAmount:
                toNumber(
                    source.preventedLossAmount,
                    0
                ),

            averageRepairAmount:
                toNumber(
                    source.averageRepairAmount
                ),

            maximumRepairAmount:
                toNumber(
                    source.maximumRepairAmount
                ),

            currency:
                normalizeString(
                    source.currency
                ),

            currencyCount:
                toNumber(
                    source.currencyCount,
                    0
                ),

            multiCurrency:
                Boolean(
                    source.multiCurrency
                )
        };
    }

    /**
     * =========================================================================
     * Performance
     * =========================================================================
     */

    _normalizePerformance(performance) {

        const source =
            isObject(performance)
                ? performance
                : {};

        return {

            totalDurationMs:
                toNumber(
                    source.totalDurationMs,
                    0
                ),

            averageDurationMs:
                toNumber(
                    source.averageDurationMs
                ),

            medianDurationMs:
                toNumber(
                    source.medianDurationMs
                ),

            p50DurationMs:
                toNumber(
                    source.p50DurationMs
                ),

            p95DurationMs:
                toNumber(
                    source.p95DurationMs
                ),

            p99DurationMs:
                toNumber(
                    source.p99DurationMs
                ),

            throughputPerSecond:
                toNumber(
                    source.throughputPerSecond
                ),

            queueWaitTimeMs:
                toNumber(
                    source.queueWaitTimeMs
                ),

            processingTimeMs:
                toNumber(
                    source.processingTimeMs
                ),

            databaseTimeMs:
                toNumber(
                    source.databaseTimeMs
                ),

            externalDependencyTimeMs:
                toNumber(
                    source.externalDependencyTimeMs
                ),

            timeoutCount:
                toNumber(
                    source.timeoutCount,
                    0
                ),

            timeoutRate:
                toNumber(
                    source.timeoutRate
                )
        };
    }

    /**
     * =========================================================================
     * Quality
     * =========================================================================
     */

    _normalizeQuality(quality) {

        const source =
            isObject(quality)
                ? quality
                : {};

        return {

            qualityScore:
                toNumber(
                    source.qualityScore
                ),

            accuracyScore:
                toNumber(
                    source.accuracyScore
                ),

            consistencyScore:
                toNumber(
                    source.consistencyScore
                ),

            completenessScore:
                toNumber(
                    source.completenessScore
                ),

            idempotencyScore:
                toNumber(
                    source.idempotencyScore
                ),

            falseRepairRate:
                toNumber(
                    source.falseRepairRate
                ),

            regressionRate:
                toNumber(
                    source.regressionRate
                ),

            repeatRepairRate:
                toNumber(
                    source.repeatRepairRate
                ),

            reopenedRepairRate:
                toNumber(
                    source.reopenedRepairRate
                )
        };
    }

    /**
     * =========================================================================
     * Risk
     * =========================================================================
     */

    _normalizeRisk(risk) {

        const source =
            isObject(risk)
                ? risk
                : {};

        return {

            overallScore:
                toNumber(
                    source.overallScore
                ),

            fraudRiskScore:
                toNumber(
                    source.fraudRiskScore
                ),

            financialRiskScore:
                toNumber(
                    source.financialRiskScore
                ),

            operationalRiskScore:
                toNumber(
                    source.operationalRiskScore
                ),

            settlementRiskScore:
                toNumber(
                    source.settlementRiskScore
                ),

            ledgerRiskScore:
                toNumber(
                    source.ledgerRiskScore
                ),

            highRiskRepairs:
                toNumber(
                    source.highRiskRepairs,
                    0
                ),

            criticalRiskRepairs:
                toNumber(
                    source.criticalRiskRepairs,
                    0
                ),

            riskLevel:
                normalizeEnum(
                    source.riskLevel,
                    Object.values(
                        RISK_LEVEL
                    ),
                    RISK_LEVEL.UNKNOWN
                )
        };
    }

    /**
     * =========================================================================
     * AI Analytics
     * =========================================================================
     */

    _normalizeAI(ai) {

        const source =
            isObject(ai)
                ? ai
                : {};

        return {

            classifications:
                toNumber(
                    source.classifications,
                    0
                ),

            recommendations:
                toNumber(
                    source.recommendations,
                    0
                ),

            acceptedRecommendations:
                toNumber(
                    source.acceptedRecommendations,
                    0
                ),

            rejectedRecommendations:
                toNumber(
                    source.rejectedRecommendations,
                    0
                ),

            overriddenRecommendations:
                toNumber(
                    source.overriddenRecommendations,
                    0
                ),

            averageConfidence:
                toNumber(
                    source.averageConfidence
                ),

            minimumConfidence:
                toNumber(
                    source.minimumConfidence
                ),

            maximumConfidence:
                toNumber(
                    source.maximumConfidence
                ),

            recommendationAcceptanceRate:
                toNumber(
                    source.recommendationAcceptanceRate
                ),

            overrideRate:
                toNumber(
                    source.overrideRate
                ),

            classificationAccuracy:
                toNumber(
                    source.classificationAccuracy
                ),

            modelVersion:
                normalizeString(
                    source.modelVersion
                ),

            modelName:
                normalizeString(
                    source.modelName
                ),

            provider:
                normalizeString(
                    source.provider
                ),

            confidenceLevel:
                normalizeEnum(
                    source.confidenceLevel,
                    Object.values(
                        CONFIDENCE_LEVEL
                    ),
                    CONFIDENCE_LEVEL.UNKNOWN
                )
        };
    }

    /**
     * =========================================================================
     * Forecast
     * =========================================================================
     */

    _normalizeForecast(forecast) {

        const source =
            isObject(forecast)
                ? forecast
                : {};

        return {

            available:
                Boolean(
                    source.available
                ),

            forecastHorizon:
                toNumber(
                    source.forecastHorizon
                ),

            predictedRepairVolume:
                toNumber(
                    source.predictedRepairVolume
                ),

            predictedFailureVolume:
                toNumber(
                    source.predictedFailureVolume
                ),

            predictedVarianceAmount:
                toNumber(
                    source.predictedVarianceAmount
                ),

            predictedRepairAmount:
                toNumber(
                    source.predictedRepairAmount
                ),

            predictedBacklog:
                toNumber(
                    source.predictedBacklog
                ),

            confidence:
                toNumber(
                    source.confidence
                ),

            direction:
                normalizeEnum(
                    source.direction,
                    Object.values(
                        FORECAST_DIRECTION
                    ),
                    FORECAST_DIRECTION.UNKNOWN
                ),

            modelVersion:
                normalizeString(
                    source.modelVersion
                ),

            generatedAt:
                normalizeDate(
                    source.generatedAt
                ),

            featuresVersion:
                normalizeString(
                    source.featuresVersion
                )
        };
    }

    /**
     * =========================================================================
     * Scheduling
     * =========================================================================
     */

    _normalizeScheduling(scheduling) {

        const source =
            isObject(scheduling)
                ? scheduling
                : {};

        return {

            eligibleRepairs:
                toNumber(
                    source.eligibleRepairs,
                    0
                ),

            scheduledRepairs:
                toNumber(
                    source.scheduledRepairs,
                    0
                ),

            deferredRepairs:
                toNumber(
                    source.deferredRepairs,
                    0
                ),

            blockedRepairs:
                toNumber(
                    source.blockedRepairs,
                    0
                ),

            urgentRepairs:
                toNumber(
                    source.urgentRepairs,
                    0
                ),

            overdueRepairs:
                toNumber(
                    source.overdueRepairs,
                    0
                ),

            averageSchedulingDelayMs:
                toNumber(
                    source.averageSchedulingDelayMs
                ),

            scheduleSuccessRate:
                toNumber(
                    source.scheduleSuccessRate
                ),

            priorityScore:
                toNumber(
                    source.priorityScore
                )
        };
    }

    /**
     * =========================================================================
     * Settlement
     * =========================================================================
     */

    _normalizeSettlement(settlement) {

        const source =
            isObject(settlement)
                ? settlement
                : {};

        return {

            affectedSettlements:
                toNumber(
                    source.affectedSettlements,
                    0
                ),

            repairedSettlements:
                toNumber(
                    source.repairedSettlements,
                    0
                ),

            failedSettlements:
                toNumber(
                    source.failedSettlements,
                    0
                ),

            settlementVarianceAmount:
                toNumber(
                    source.settlementVarianceAmount,
                    0
                ),

            settlementRecoveryAmount:
                toNumber(
                    source.settlementRecoveryAmount,
                    0
                ),

            settlementReliabilityScore:
                toNumber(
                    source.settlementReliabilityScore
                ),

            settlementFailureRate:
                toNumber(
                    source.settlementFailureRate
                ),

            averageSettlementDelayMs:
                toNumber(
                    source.averageSettlementDelayMs
                )
        };
    }

    /**
     * =========================================================================
     * Fraud
     * =========================================================================
     */

    _normalizeFraud(fraud) {

        const source =
            isObject(fraud)
                ? fraud
                : {};

        return {

            correlatedRepairs:
                toNumber(
                    source.correlatedRepairs,
                    0
                ),

            suspiciousRepairs:
                toNumber(
                    source.suspiciousRepairs,
                    0
                ),

            highRiskRepairs:
                toNumber(
                    source.highRiskRepairs,
                    0
                ),

            confirmedFraudCases:
                toNumber(
                    source.confirmedFraudCases,
                    0
                ),

            fraudExposureAmount:
                toNumber(
                    source.fraudExposureAmount,
                    0
                ),

            averageFraudScore:
                toNumber(
                    source.averageFraudScore
                ),

            correlationScore:
                toNumber(
                    source.correlationScore
                ),

            falsePositiveRate:
                toNumber(
                    source.falsePositiveRate
                )
        };
    }

    /**
     * =========================================================================
     * Custom Metrics
     * =========================================================================
     */

    _normalizeCustomMetrics(metrics) {

        if (!isObject(metrics)) {
            return {};
        }

        const result = {};

        const keys =
            Object.keys(metrics)
                .slice(
                    0,
                    DEFAULTS.maximumCustomMetrics
                );

        for (const key of keys) {

            const normalizedKey =
                normalizeString(key);

            if (!normalizedKey) {
                continue;
            }

            result[normalizedKey] =
                clone(metrics[key]);
        }

        return result;
    }

    /**
     * =========================================================================
     * Provenance
     * =========================================================================
     */

    _normalizeProvenance(provenance) {

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

            analyticsEngine:
                normalizeString(
                    source.analyticsEngine
                ),

            analyticsVersion:
                normalizeString(
                    source.analyticsVersion
                ),

            calculationEngine:
                normalizeString(
                    source.calculationEngine
                ),

            calculationVersion:
                normalizeString(
                    source.calculationVersion
                ),

            featureVersion:
                normalizeString(
                    source.featureVersion
                ),

            modelVersion:
                normalizeString(
                    source.modelVersion
                ),

            generatedBy:
                normalizeString(
                    source.generatedBy
                ),

            generatedAt:
                normalizeDate(
                    source.generatedAt
                )
        };
    }

    /**
     * =========================================================================
     * Derived Metrics
     * =========================================================================
     */

    calculateDerivedMetrics() {

        const total =
            this.summary.totalRepairs;

        this.summary.successRate =
            this._safeRate(
                this.summary.successfulRepairs,
                total
            );

        this.summary.failureRate =
            this._safeRate(
                this.summary.failedRepairs,
                total
            );

        this.execution.automatedRate =
            this._safeRate(
                this.execution.automated,
                total
            );

        this.execution.manualRate =
            this._safeRate(
                this.execution.manual,
                total
            );

        this.execution.retryRate =
            this._safeRate(
                this.execution.retryCount,
                Math.max(
                    this.execution.totalAttempts,
                    total
                )
            );

        this.execution.rollbackRate =
            this._safeRate(
                this.execution.rollbackCount,
                total
            );

        this.outcomes.successRate =
            this._safeRate(
                this.outcomes.successful,
                total
            );

        this.outcomes.failureRate =
            this._safeRate(
                this.outcomes.failed,
                total
            );

        this.quality.falseRepairRate =
            this._safeRate(
                this.quality.falseRepairRate,
                100
            );

        this.ai.recommendationAcceptanceRate =
            this._safeRate(
                this.ai.acceptedRecommendations,
                this.ai.recommendations
            );

        this.ai.overrideRate =
            this._safeRate(
                this.ai.overriddenRecommendations,
                this.ai.recommendations
            );

        this.financialImpact.unrecoveredAmount =
            Math.max(
                0,
                this.financialImpact.totalAffectedAmount -
                this.financialImpact.recoveredAmount
            );

        this.financialImpact.averageRepairAmount =
            total > 0
                ? round(
                    this.financialImpact.totalRepairedAmount /
                    total,
                    2
                )
                : null;

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

        if (denominatorValue <= 0) {
            return null;
        }

        return round(
            clamp(
                (
                    numeratorValue /
                    denominatorValue
                ) * 100,
                0,
                100
            ),
            4
        );
    }

    /**
     * =========================================================================
     * Health Scoring
     * =========================================================================
     */

    calculateHealthScore() {

        const components = [
            [
                this.summary.successRate,
                0.25
            ],
            [
                this.quality.qualityScore,
                0.20
            ],
            [
                this.ai.classificationAccuracy,
                0.10
            ],
            [
                this.risk.overallScore !== null
                    ? 100 -
                        this.risk.overallScore
                    : null,
                0.15
            ],
            [
                this.settlement.settlementReliabilityScore,
                0.15
            ],
            [
                this.performance.timeoutRate !== null
                    ? 100 -
                        this.performance.timeoutRate
                    : null,
                0.15
            ]
        ];

        const valid =
            components.filter(
                item =>
                    Number.isFinite(
                        item[0]
                    )
            );

        if (valid.length === 0) {
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

        const score =
            valid.reduce(
                (
                    sum,
                    item
                ) =>
                    sum +
                    clamp(
                        item[0],
                        0,
                        100
                    ) *
                    item[1],
                0
            ) /
            totalWeight;

        return round(
            score,
            2
        );
    }

    calculateHealth() {

        const score =
            this.calculateHealthScore();

        if (score === null) {
            this.healthLevel =
                HEALTH_LEVEL.UNKNOWN;

            return null;
        }

        if (score >= 90) {
            this.healthLevel =
                HEALTH_LEVEL.EXCELLENT;

        } else if (score >= 75) {
            this.healthLevel =
                HEALTH_LEVEL.GOOD;

        } else if (score >= 60) {
            this.healthLevel =
                HEALTH_LEVEL.FAIR;

        } else if (score >= 40) {
            this.healthLevel =
                HEALTH_LEVEL.POOR;

        } else {
            this.healthLevel =
                HEALTH_LEVEL.CRITICAL;
        }

        return score;
    }

    /**
     * =========================================================================
     * Trend Detection
     * =========================================================================
     */

    compareWith(
        previousSnapshot
    ) {

        const previous =
            previousSnapshot instanceof
            RepairAnalyticsSnapshot
                ? previousSnapshot
                : new RepairAnalyticsSnapshot(
                    previousSnapshot
                );

        return {

            repairVolume:
                this._delta(
                    this.summary.totalRepairs,
                    previous.summary.totalRepairs
                ),

            repairSuccessRate:
                this._delta(
                    this.summary.successRate,
                    previous.summary.successRate
                ),

            repairFailureRate:
                this._delta(
                    this.summary.failureRate,
                    previous.summary.failureRate
                ),

            repairedAmount:
                this._delta(
                    this.financialImpact.totalRepairedAmount,
                    previous.financialImpact.totalRepairedAmount
                ),

            varianceAmount:
                this._delta(
                    this.financialImpact.totalVarianceAmount,
                    previous.financialImpact.totalVarianceAmount
                ),

            averageDuration:
                this._delta(
                    this.performance.averageDurationMs,
                    previous.performance.averageDurationMs
                ),

            riskScore:
                this._delta(
                    this.risk.overallScore,
                    previous.risk.overallScore
                ),

            aiConfidence:
                this._delta(
                    this.ai.averageConfidence,
                    previous.ai.averageConfidence
                ),

            forecastConfidence:
                this._delta(
                    this.forecast.confidence,
                    previous.forecast.confidence
                )
        };
    }

    _delta(
        current,
        previous
    ) {

        const currentValue =
            toNumber(
                current
            );

        const previousValue =
            toNumber(
                previous
            );

        if (
            currentValue === null ||
            previousValue === null
        ) {
            return null;
        }

        return round(
            currentValue -
            previousValue,
            4
        );
    }

    classifyTrend(
        current,
        previous,
        tolerance = 0.01
    ) {

        const delta =
            this._delta(
                current,
                previous
            );

        if (
            delta === null
        ) {
            return TREND_DIRECTION.UNKNOWN;
        }

        if (
            Math.abs(delta) <=
            tolerance
        ) {
            return TREND_DIRECTION.FLAT;
        }

        return delta > 0
            ? TREND_DIRECTION.UP
            : TREND_DIRECTION.DOWN;
    }

    /**
     * =========================================================================
     * Forecast Helpers
     * =========================================================================
     */

    hasForecast() {

        return (
            this.forecast.available === true
        );
    }

    forecastIsReliable(
        minimumConfidence = 70
    ) {

        const confidence =
            toNumber(
                this.forecast.confidence
            );

        return (
            this.hasForecast() &&
            confidence !== null &&
            confidence >=
                minimumConfidence
        );
    }

    /**
     * =========================================================================
     * Risk Helpers
     * =========================================================================
     */

    isHighRisk() {

        return [
            RISK_LEVEL.HIGH,
            RISK_LEVEL.CRITICAL
        ].includes(
            this.risk.riskLevel
        );
    }

    requiresFraudReview() {

        return (
            this.fraud.suspiciousRepairs > 0 ||
            this.fraud.highRiskRepairs > 0 ||
            this.fraud.confirmedFraudCases > 0 ||
            this.risk.fraudRiskScore >= 70
        );
    }

    /**
     * =========================================================================
     * Operational Helpers
     * =========================================================================
     */

    hasOpenRepairs() {

        return (
            this.summary.pendingRepairs > 0 ||
            this.summary.escalatedRepairs > 0
        );
    }

    hasFailedRepairs() {

        return (
            this.summary.failedRepairs > 0
        );
    }

    hasMaterialVariance(
        threshold = 0
    ) {

        return (
            Math.abs(
                this.financialImpact.totalVarianceAmount
            ) >
            Math.abs(
                threshold
            )
        );
    }

    requiresAttention() {

        return (
            this.status !== STATUS.COMPLETE ||
            this.healthLevel === HEALTH_LEVEL.POOR ||
            this.healthLevel === HEALTH_LEVEL.CRITICAL ||
            this.isHighRisk() ||
            this.hasFailedRepairs() ||
            this.hasMaterialVariance()
        );
    }

    /**
     * =========================================================================
     * Tags / Custom Metrics
     * =========================================================================
     */

    addTag(tag) {

        const normalized =
            normalizeString(
                tag
            );

        if (!normalized) {
            return false;
        }

        const exists =
            this.tags.some(
                existing =>
                    existing.toLowerCase() ===
                    normalized.toLowerCase()
            );

        if (exists) {
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

        this.refreshFingerprint();

        return true;
    }

    /**
     * =========================================================================
     * Trend / Forecast / Recommendation Registration
     * =========================================================================
     */

    addTrend(trend) {

        if (
            this.trends.length >=
            DEFAULTS.maximumTrends
        ) {
            return false;
        }

        this.trends.push(
            clone(trend)
        );

        this.refreshFingerprint();

        return true;
    }

    addForecast(forecast) {

        if (
            this.forecasts.length >=
            DEFAULTS.maximumForecasts
        ) {
            return false;
        }

        this.forecasts.push(
            clone(forecast)
        );

        this.refreshFingerprint();

        return true;
    }

    addRecommendation(
        recommendation
    ) {

        if (
            this.recommendations.length >=
            DEFAULTS.maximumRecommendations
        ) {
            return false;
        }

        this.recommendations.push(
            clone(recommendation)
        );

        this.refreshFingerprint();

        return true;
    }

    addAnomaly(anomaly) {

        if (
            this.anomalies.length >=
            DEFAULTS.maximumAnomalies
        ) {
            return false;
        }

        this.anomalies.push(
            clone(anomaly)
        );

        this.refreshFingerprint();

        return true;
    }

    addAlert(alert) {

        if (
            this.alerts.length >=
            DEFAULTS.maximumAlerts
        ) {
            return false;
        }

        this.alerts.push(
            clone(alert)
        );

        this.refreshFingerprint();

        return true;
    }

    /**
     * =========================================================================
     * History
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

            details:
                clone(details)
        });

        this.refreshFingerprint();

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
                    'tenantId is required for tenant-scoped repair analytics.'
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

        const percentages = [

            [
                'summary.repairRate',
                this.summary.repairRate
            ],

            [
                'summary.successRate',
                this.summary.successRate
            ],

            [
                'summary.failureRate',
                this.summary.failureRate
            ],

            [
                'execution.automatedRate',
                this.execution.automatedRate
            ],

            [
                'execution.manualRate',
                this.execution.manualRate
            ],

            [
                'outcomes.successRate',
                this.outcomes.successRate
            ],

            [
                'outcomes.failureRate',
                this.outcomes.failureRate
            ],

            [
                'ai.averageConfidence',
                this.ai.averageConfidence
            ],

            [
                'forecast.confidence',
                this.forecast.confidence
            ]
        ];

        for (
            const [field, value]
            of percentages
        ) {

            if (
                value !== null &&
                (
                    value < 0 ||
                    value > 100
                )
            ) {
                errors.push({
                    code:
                        'INVALID_PERCENTAGE',
                    field,
                    message:
                        `${field} must be between 0 and 100.`
                });
            }
        }

        if (
            this.summary.totalRepairs <
            0
        ) {
            errors.push({
                code:
                    'INVALID_REPAIR_COUNT',
                field:
                    'summary.totalRepairs',
                message:
                    'Total repairs cannot be negative.'
            });
        }

        if (
            this.financialImpact.totalAffectedAmount <
            0
        ) {
            warnings.push({
                code:
                    'NEGATIVE_AFFECTED_AMOUNT',
                field:
                    'financialImpact.totalAffectedAmount',
                message:
                    'Affected financial amount is negative.'
            });
        }

        if (
            this.forecast.available &&
            this.forecast.confidence === null
        ) {
            warnings.push({
                code:
                    'FORECAST_WITHOUT_CONFIDENCE',
                field:
                    'forecast.confidence',
                message:
                    'Forecast is marked available but has no confidence score.'
            });
        }

        if (
            this.snapshotType ===
                SNAPSHOT_TYPE.REALTIME &&
            this.period.start &&
            this.period.end
        ) {
            const duration =
                this.period.end.getTime() -
                this.period.start.getTime();

            if (
                duration >
                60 * 60 * 1000
            ) {
                warnings.push({
                    code:
                        'REALTIME_SNAPSHOT_LONG_PERIOD',
                    field:
                        'period',
                    message:
                        'Realtime snapshots normally represent a short observation window.'
                });
            }
        }

        return {
            valid:
                errors.length === 0,

            errors,

            warnings
        };
    }

    isValid(options = {}) {

        return this.validate(
            options
        ).valid;
    }

    assertValid(options = {}) {

        const validation =
            this.validate(
                options
            );

        if (
            !validation.valid
        ) {

            const error =
                new Error(
                    'Invalid RepairAnalyticsSnapshot.'
                );

            error.code =
                'INVALID_REPAIR_ANALYTICS_SNAPSHOT';

            error.details =
                validation.errors;

            throw error;
        }

        return this;
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
     * Snapshot ID
     * =========================================================================
     */

    _generateSnapshotId() {

        const entropy =
            crypto.randomBytes(12)
                .toString('hex');

        const timestamp =
            Date.now()
                .toString(36);

        return (
            `repair-snapshot-${timestamp}-${entropy}`
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

            snapshotId:
                this.snapshotId,

            analyticsRunId:
                this.analyticsRunId,

            tenantId:
                this.tenantId,

            organizationId:
                this.organizationId,

            groupId:
                this.groupId,

            branchId:
                this.branchId,

            accountId:
                this.accountId,

            scope:
                this.scope,

            scopeType:
                this.scopeType,

            environment:
                this.environment,

            snapshotType:
                this.snapshotType,

            period:
                this.period,

            summary:
                this.summary,

            execution:
                this.execution,

            outcomes:
                this.outcomes,

            repairTypes:
                this.repairTypes,

            severity:
                this.severity,

            financialImpact:
                this.financialImpact,

            performance:
                this.performance,

            quality:
                this.quality,

            risk:
                this.risk,

            ai:
                this.ai,

            forecast:
                this.forecast,

            scheduling:
                this.scheduling,

            settlement:
                this.settlement,

            fraud:
                this.fraud,

            trends:
                this.trends,

            dimensions:
                this.dimensions,

            forecasts:
                this.forecasts,

            recommendations:
                this.recommendations,

            customMetrics:
                this.customMetrics
        });
    }

    refreshFingerprint() {

        this.fingerprint =
            this.generateFingerprint();

        return this.fingerprint;
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

    /**
     * =========================================================================
     * Serialization
     * =========================================================================
     */

    toObject(options = {}) {

        const includeDiagnostics =
            options.includeDiagnostics !== false;

        const includeHistory =
            options.includeHistory !== false;

        const includeMetadata =
            options.includeMetadata !== false;

        const includeFingerprint =
            options.includeFingerprint !== false;

        const result = {

            model:
                this.model,

            schemaVersion:
                this.schemaVersion,

            id:
                this.id,

            snapshotId:
                this.snapshotId,

            analyticsRunId:
                this.analyticsRunId,

            correlationId:
                this.correlationId,

            tenantId:
                this.tenantId,

            organizationId:
                this.organizationId,

            groupId:
                this.groupId,

            branchId:
                this.branchId,

            accountId:
                this.accountId,

            scope:
                this.scope,

            scopeType:
                this.scopeType,

            environment:
                this.environment,

            snapshotType:
                this.snapshotType,

            status:
                this.status,

            healthLevel:
                this.healthLevel,

            period:
                clone(
                    this.period
                ),

            summary:
                clone(
                    this.summary
                ),

            execution:
                clone(
                    this.execution
                ),

            outcomes:
                clone(
                    this.outcomes
                ),

            repairTypes:
                clone(
                    this.repairTypes
                ),

            severity:
                clone(
                    this.severity
                ),

            financialImpact:
                clone(
                    this.financialImpact
                ),

            performance:
                clone(
                    this.performance
                ),

            quality:
                clone(
                    this.quality
                ),

            risk:
                clone(
                    this.risk
                ),

            ai:
                clone(
                    this.ai
                ),

            forecast:
                clone(
                    this.forecast
                ),

            scheduling:
                clone(
                    this.scheduling
                ),

            settlement:
                clone(
                    this.settlement
                ),

            fraud:
                clone(
                    this.fraud
                ),

            trends:
                clone(
                    this.trends
                ),

            dimensions:
                clone(
                    this.dimensions
                ),

            forecasts:
                clone(
                    this.forecasts
                ),

            recommendations:
                clone(
                    this.recommendations
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

            generatedAt:
                clone(
                    this.generatedAt
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

        if (includeDiagnostics) {

            result.errors =
                clone(
                    this.errors
                );

            result.warnings =
                clone(
                    this.warnings
                );

            result.anomalies =
                clone(
                    this.anomalies
                );

            result.alerts =
                clone(
                    this.alerts
                );
        }

        if (includeHistory) {

            result.history =
                clone(
                    this.history
                );
        }

        if (includeMetadata) {

            result.metadata =
                clone(
                    this.metadata
                );
        }

        if (includeFingerprint) {

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
            includeDiagnostics: true,
            includeHistory: true,
            includeMetadata: true,
            includeFingerprint: true
        });
    }

    /**
     * =========================================================================
     * Static Constructors
     * =========================================================================
     */

    static create(data = {}) {

        return new RepairAnalyticsSnapshot(
            data
        );
    }

    static from(data = {}) {

        if (
            data instanceof
            RepairAnalyticsSnapshot
        ) {
            return new RepairAnalyticsSnapshot(
                data.toObject()
            );
        }

        return new RepairAnalyticsSnapshot(
            data
        );
    }

    static realtime(data = {}) {

        return new RepairAnalyticsSnapshot({
            ...data,
            snapshotType:
                SNAPSHOT_TYPE.REALTIME
        });
    }

    static periodic(data = {}) {

        return new RepairAnalyticsSnapshot({
            ...data,
            snapshotType:
                SNAPSHOT_TYPE.PERIODIC
        });
    }

    static daily(data = {}) {

        return new RepairAnalyticsSnapshot({
            ...data,
            snapshotType:
                SNAPSHOT_TYPE.DAILY
        });
    }

    static weekly(data = {}) {

        return new RepairAnalyticsSnapshot({
            ...data,
            snapshotType:
                SNAPSHOT_TYPE.WEEKLY
        });
    }

    static monthly(data = {}) {

        return new RepairAnalyticsSnapshot({
            ...data,
            snapshotType:
                SNAPSHOT_TYPE.MONTHLY
        });
    }

    static preClose(data = {}) {

        return new RepairAnalyticsSnapshot({
            ...data,
            snapshotType:
                SNAPSHOT_TYPE.PRE_CLOSE
        });
    }

    static postClose(data = {}) {

        return new RepairAnalyticsSnapshot({
            ...data,
            snapshotType:
                SNAPSHOT_TYPE.POST_CLOSE
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

    static get SNAPSHOT_TYPE() {
        return SNAPSHOT_TYPE;
    }

    static get STATUS() {
        return STATUS;
    }

    static get HEALTH_LEVEL() {
        return HEALTH_LEVEL;
    }

    static get REPAIR_EXECUTION_MODE() {
        return REPAIR_EXECUTION_MODE;
    }

    static get REPAIR_OUTCOME() {
        return REPAIR_OUTCOME;
    }

    static get CONFIDENCE_LEVEL() {
        return CONFIDENCE_LEVEL;
    }

    static get FORECAST_DIRECTION() {
        return FORECAST_DIRECTION;
    }

    static get TREND_DIRECTION() {
        return TREND_DIRECTION;
    }

    static get RISK_LEVEL() {
        return RISK_LEVEL;
    }
}

/**
 * ============================================================================
 * Module Exports
 * ============================================================================
 *
 * Supports both:
 *
 *   const RepairAnalyticsSnapshot =
 *       require('./RepairAnalyticsSnapshot');
 *
 * and:
 *
 *   const {
 *       RepairAnalyticsSnapshot,
 *       SNAPSHOT_TYPE,
 *       STATUS
 *   } = require('./RepairAnalyticsSnapshot');
 *
 * ============================================================================
 */

module.exports =
    RepairAnalyticsSnapshot;

module.exports.RepairAnalyticsSnapshot =
    RepairAnalyticsSnapshot;

module.exports.SNAPSHOT_TYPE =
    SNAPSHOT_TYPE;

module.exports.STATUS =
    STATUS;

module.exports.HEALTH_LEVEL =
    HEALTH_LEVEL;

module.exports.REPAIR_EXECUTION_MODE =
    REPAIR_EXECUTION_MODE;

module.exports.REPAIR_OUTCOME =
    REPAIR_OUTCOME;

module.exports.CONFIDENCE_LEVEL =
    CONFIDENCE_LEVEL;

module.exports.FORECAST_DIRECTION =
    FORECAST_DIRECTION;

module.exports.TREND_DIRECTION =
    TREND_DIRECTION;

module.exports.RISK_LEVEL =
    RISK_LEVEL;

module.exports.SCHEMA_VERSION =
    SCHEMA_VERSION;

