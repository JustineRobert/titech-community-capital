'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * BranchPerformanceAnalyzer
 * ============================================================================
 *
 * Location:
 *   backend/modules/finance/statements/operations/BranchPerformanceAnalyzer.js
 *
 * Purpose
 * -------
 * Enterprise analytics engine for evaluating financial-statement processing,
 * reconciliation, repair, settlement, and operational performance at branch
 * level.
 *
 * Design goals
 * -----------
 * - Tenant-aware
 * - Branch-scoped
 * - Persistence agnostic
 * - Deterministic
 * - Explainable
 * - Null-safe
 * - Idempotent
 * - Suitable for scheduled analytics jobs
 * - Suitable for real-time operational analysis
 * - Suitable for executive reporting
 * - Suitable for forecasting and scheduling consumers
 * - Does not mutate source transactions
 * - Does not perform repairs
 * - Does not make accounting postings
 *
 * Primary consumers
 * -----------------
 *   - OperationalMetrics
 *   - RepairAnalyticsSnapshot
 *   - RepairForecastEngine
 *   - PredictiveRepairScheduler
 *   - SettlementReliabilityEngine
 *   - FraudCorrelationEngine
 *   - ExecutiveReportingExporter
 *
 * Expected input
 * --------------
 * analyze({
 *     tenantId,
 *     branchId,
 *     period,
 *     statements,
 *     transactions,
 *     repairs,
 *     settlements,
 *     reconciliations,
 *     capacity,
 *     targets,
 *     metadata
 * })
 *
 * The analyzer intentionally accepts plain objects so it can consume data from
 * repositories, services, MongoDB documents, SQL adapters, event consumers,
 * jobs, or test fixtures without imposing a persistence dependency.
 *
 * ============================================================================
 */

const crypto = require('crypto');

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const MODEL_NAME =
    'BranchPerformanceAnalyzer';

const SCHEMA_VERSION =
    '1.0.0';

const STATUS = Object.freeze({
    HEALTHY: 'HEALTHY',
    STABLE: 'STABLE',
    WATCH: 'WATCH',
    AT_RISK: 'AT_RISK',
    CRITICAL: 'CRITICAL',
    INSUFFICIENT_DATA: 'INSUFFICIENT_DATA'
});

const TREND = Object.freeze({
    IMPROVING: 'IMPROVING',
    STABLE: 'STABLE',
    DETERIORATING: 'DETERIORATING',
    VOLATILE: 'VOLATILE',
    UNKNOWN: 'UNKNOWN'
});

const PERFORMANCE_LEVEL = Object.freeze({
    EXCELLENT: 'EXCELLENT',
    GOOD: 'GOOD',
    ACCEPTABLE: 'ACCEPTABLE',
    BELOW_TARGET: 'BELOW_TARGET',
    POOR: 'POOR',
    CRITICAL: 'CRITICAL',
    UNKNOWN: 'UNKNOWN'
});

const RISK_LEVEL = Object.freeze({
    LOW: 'LOW',
    MEDIUM: 'MEDIUM',
    HIGH: 'HIGH',
    CRITICAL: 'CRITICAL',
    UNKNOWN: 'UNKNOWN'
});

const DATA_QUALITY = Object.freeze({
    EXCELLENT: 'EXCELLENT',
    GOOD: 'GOOD',
    FAIR: 'FAIR',
    POOR: 'POOR',
    INSUFFICIENT: 'INSUFFICIENT'
});

const DEFAULTS = Object.freeze({

    minimumSampleSize: 5,

    targetRepairRate: 0.05,

    targetReconciliationRate: 0.98,

    targetSettlementSuccessRate: 0.98,

    targetRepairResolutionRate: 0.95,

    targetSlaComplianceRate: 0.95,

    targetFirstPassMatchRate: 0.95,

    targetAverageResolutionTimeMs:
        24 * 60 * 60 * 1000,

    warningScore: 70,

    criticalScore: 50,

    maximumRecords: 100000,

    maximumIssues: 100,

    maximumRecommendations: 100,

    maximumDrivers: 100,

    maximumTrendPoints: 100,

    maximumBenchmarks: 100
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
        return new Date(
            value.getTime()
        );
    }

    if (Array.isArray(value)) {
        return value.map(clone);
    }

    if (isObject(value)) {

        const result = {};

        for (const key of Object.keys(value)) {
            result[key] =
                clone(value[key]);
        }

        return result;
    }

    return value;
}

function normalizeString(
    value,
    fallback = null
) {

    if (
        value === null ||
        value === undefined
    ) {
        return fallback;
    }

    const normalized =
        String(value).trim();

    return normalized.length
        ? normalized
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

    const number =
        Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}

function clamp(
    value,
    minimum,
    maximum
) {

    const number =
        toNumber(
            value,
            minimum
        );

    return Math.min(
        maximum,
        Math.max(
            minimum,
            number
        )
    );
}

function round(
    value,
    decimals = 4
) {

    const number =
        toNumber(
            value,
            0
        );

    const factor =
        10 ** decimals;

    return (
        Math.round(
            number * factor
        ) / factor
    );
}

function percentage(
    numerator,
    denominator
) {

    const n =
        toNumber(numerator);

    const d =
        toNumber(denominator);

    if (
        n === null ||
        d === null ||
        d === 0
    ) {
        return null;
    }

    return round(
        (n / d) * 100,
        4
    );
}

function ratio(
    numerator,
    denominator
) {

    const n =
        toNumber(numerator);

    const d =
        toNumber(denominator);

    if (
        n === null ||
        d === null ||
        d === 0
    ) {
        return null;
    }

    return round(
        n / d,
        6
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

function normalizeArray(
    value,
    maximum
) {

    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .slice(
            0,
            maximum
        )
        .map(clone);
}

function average(values) {

    if (!Array.isArray(values)) {
        return null;
    }

    const valid =
        values
            .map(
                value =>
                    toNumber(value)
            )
            .filter(
                value =>
                    value !== null
            );

    if (!valid.length) {
        return null;
    }

    return round(
        valid.reduce(
            (sum, value) =>
                sum + value,
            0
        ) / valid.length,
        4
    );
}

function median(values) {

    if (!Array.isArray(values)) {
        return null;
    }

    const valid =
        values
            .map(
                value =>
                    toNumber(value)
            )
            .filter(
                value =>
                    value !== null
            )
            .sort(
                (a, b) =>
                    a - b
            );

    if (!valid.length) {
        return null;
    }

    const middle =
        Math.floor(
            valid.length / 2
        );

    if (
        valid.length % 2 === 0
    ) {
        return round(
            (
                valid[middle - 1] +
                valid[middle]
            ) / 2,
            4
        );
    }

    return round(
        valid[middle],
        4
    );
}

function percentile(
    values,
    percentileValue
) {

    if (!Array.isArray(values)) {
        return null;
    }

    const valid =
        values
            .map(
                value =>
                    toNumber(value)
            )
            .filter(
                value =>
                    value !== null
            )
            .sort(
                (a, b) =>
                    a - b
            );

    if (!valid.length) {
        return null;
    }

    const p =
        clamp(
            percentileValue,
            0,
            100
        ) / 100;

    const index =
        (valid.length - 1) * p;

    const lower =
        Math.floor(index);

    const upper =
        Math.ceil(index);

    if (lower === upper) {
        return round(
            valid[lower],
            4
        );
    }

    const weight =
        index - lower;

    return round(
        valid[lower] +
        (
            valid[upper] -
            valid[lower]
        ) * weight,
        4
    );
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
 * BranchPerformanceAnalyzer
 * ============================================================================
 */

class BranchPerformanceAnalyzer {

    constructor(options = {}) {

        if (!isObject(options)) {
            throw new TypeError(
                'BranchPerformanceAnalyzer options must be an object.'
            );
        }

        this.options = {

            ...DEFAULTS,

            ...clone(options)
        };

        this.model =
            MODEL_NAME;

        this.schemaVersion =
            SCHEMA_VERSION;
    }

    /**
     * =========================================================================
     * Public API
     * =========================================================================
     */

    analyze(input = {}) {

        const context =
            this._normalizeInput(
                input
            );

        const startedAt =
            Date.now();

        const dataQuality =
            this._calculateDataQuality(
                context
            );

        if (
            dataQuality.level ===
            DATA_QUALITY.INSUFFICIENT
        ) {

            return this._buildInsufficientDataResult(
                context,
                dataQuality,
                startedAt
            );
        }

        const volume =
            this._analyzeVolume(
                context
            );

        const repairs =
            this._analyzeRepairs(
                context
            );

        const reconciliation =
            this._analyzeReconciliation(
                context
            );

        const settlements =
            this._analyzeSettlements(
                context
            );

        const sla =
            this._analyzeSla(
                context
            );

        const capacity =
            this._analyzeCapacity(
                context
            );

        const financial =
            this._analyzeFinancialImpact(
                context
            );

        const quality =
            this._analyzeProcessingQuality(
                context
            );

        const trends =
            this._analyzeTrends(
                context
            );

        const score =
            this._calculatePerformanceScore({
                volume,
                repairs,
                reconciliation,
                settlements,
                sla,
                capacity,
                financial,
                quality
            });

        const status =
            this._classifyStatus(
                score,
                dataQuality
            );

        const risks =
            this._identifyRisks({
                context,
                repairs,
                reconciliation,
                settlements,
                sla,
                capacity,
                financial,
                quality,
                score
            });

        const drivers =
            this._identifyPerformanceDrivers({
                repairs,
                reconciliation,
                settlements,
                sla,
                capacity,
                financial,
                quality
            });

        const recommendations =
            this._generateRecommendations({
                context,
                status,
                score,
                repairs,
                reconciliation,
                settlements,
                sla,
                capacity,
                financial,
                quality,
                risks
            });

        const benchmarks =
            this._calculateBenchmarks(
                context,
                {
                    repairs,
                    reconciliation,
                    settlements,
                    sla,
                    capacity,
                    financial,
                    quality,
                    score
                }
            );

        const result = {

            model:
                this.model,

            schemaVersion:
                this.schemaVersion,

            analysisId:
                this._generateAnalysisId(),

            tenantId:
                context.tenantId,

            organizationId:
                context.organizationId,

            branchId:
                context.branchId,

            branchName:
                context.branchName,

            branchCode:
                context.branchCode,

            period:
                context.period,

            status,

            score,

            dataQuality,

            volume,

            repairs,

            reconciliation,

            settlements,

            sla,

            capacity,

            financial,

            quality,

            trends,

            risks,

            drivers,

            recommendations,

            benchmarks,

            sampleSize:
                context.records.total,

            calculatedAt:
                new Date(),

            durationMs:
                Date.now() -
                startedAt,

            metadata:
                clone(
                    context.metadata
                )
        };

        result.fingerprint =
            this.generateFingerprint(
                result
            );

        return result;
    }

    /**
     * =========================================================================
     * Input normalization
     * =========================================================================
     */

    _normalizeInput(input) {

        const source =
            isObject(input)
                ? input
                : {};

        const statements =
            normalizeArray(
                source.statements,
                this.options.maximumRecords
            );

        const transactions =
            normalizeArray(
                source.transactions,
                this.options.maximumRecords
            );

        const repairs =
            normalizeArray(
                source.repairs,
                this.options.maximumRecords
            );

        const settlements =
            normalizeArray(
                source.settlements,
                this.options.maximumRecords
            );

        const reconciliations =
            normalizeArray(
                source.reconciliations,
                this.options.maximumRecords
            );

        const periods =
            normalizeArray(
                source.history ||
                source.periods,
                this.options.maximumTrendPoints
            );

        return {

            tenantId:
                normalizeString(
                    source.tenantId
                ),

            organizationId:
                normalizeString(
                    source.organizationId
                ),

            branchId:
                normalizeString(
                    source.branchId
                ),

            branchName:
                normalizeString(
                    source.branchName
                ),

            branchCode:
                normalizeString(
                    source.branchCode
                ),

            period:
                this._normalizePeriod(
                    source.period
                ),

            statements,

            transactions,

            repairs,

            settlements,

            reconciliations,

            periods,

            capacity:
                isObject(
                    source.capacity
                )
                    ? clone(
                        source.capacity
                    )
                    : {},

            targets:
                isObject(
                    source.targets
                )
                    ? {
                        ...this._defaultTargets(),
                        ...clone(
                            source.targets
                        )
                    }
                    : this._defaultTargets(),

            benchmark:
                isObject(
                    source.benchmark
                )
                    ? clone(
                        source.benchmark
                    )
                    : null,

            metadata:
                isObject(
                    source.metadata
                )
                    ? clone(
                        source.metadata
                    )
                    : {},

            records: {

                statements:
                    statements.length,

                transactions:
                    transactions.length,

                repairs:
                    repairs.length,

                settlements:
                    settlements.length,

                reconciliations:
                    reconciliations.length,

                total:
                    statements.length +
                    transactions.length +
                    repairs.length +
                    settlements.length +
                    reconciliations.length
            }
        };
    }

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

            label:
                normalizeString(
                    source.label
                )
        };
    }

    _defaultTargets() {

        return {

            repairRate:
                this.options.targetRepairRate,

            reconciliationRate:
                this.options.targetReconciliationRate,

            settlementSuccessRate:
                this.options.targetSettlementSuccessRate,

            repairResolutionRate:
                this.options.targetRepairResolutionRate,

            slaComplianceRate:
                this.options.targetSlaComplianceRate,

            firstPassMatchRate:
                this.options.targetFirstPassMatchRate,

            averageResolutionTimeMs:
                this.options.targetAverageResolutionTimeMs
        };
    }

    /**
     * =========================================================================
     * Data quality
     * =========================================================================
     */

    _calculateDataQuality(
        context
    ) {

        const counts =
            context.records;

        const populated =
            [
                counts.statements,
                counts.transactions,
                counts.repairs,
                counts.settlements,
                counts.reconciliations
            ]
            .filter(
                value =>
                    value > 0
            )
            .length;

        const completeness =
            round(
                (
                    populated / 5
                ) * 100,
                2
            );

        if (
            counts.total <
            this.options.minimumSampleSize
        ) {

            return {

                score:
                    round(
                        (
                            counts.total /
                            this.options.minimumSampleSize
                        ) * 100,
                        2
                    ),

                level:
                    DATA_QUALITY.INSUFFICIENT,

                completeness,

                sampleSize:
                    counts.total,

                reasons: [
                    'Insufficient records for reliable branch analysis.'
                ]
            };
        }

        let score =
            completeness;

        if (
            counts.transactions > 0 &&
            counts.statements === 0
        ) {
            score -= 10;
        }

        if (
            counts.repairs > 0 &&
            counts.reconciliations === 0
        ) {
            score -= 10;
        }

        score =
            clamp(
                score,
                0,
                100
            );

        let level;

        if (score >= 90) {
            level =
                DATA_QUALITY.EXCELLENT;
        } else if (score >= 75) {
            level =
                DATA_QUALITY.GOOD;
        } else if (score >= 55) {
            level =
                DATA_QUALITY.FAIR;
        } else {
            level =
                DATA_QUALITY.POOR;
        }

        return {

            score:
                round(
                    score,
                    2
                ),

            level,

            completeness,

            sampleSize:
                counts.total,

            records:
                clone(counts),

            reasons: []
        };
    }

    _buildInsufficientDataResult(
        context,
        dataQuality,
        startedAt
    ) {

        const result = {

            model:
                this.model,

            schemaVersion:
                this.schemaVersion,

            analysisId:
                this._generateAnalysisId(),

            tenantId:
                context.tenantId,

            organizationId:
                context.organizationId,

            branchId:
                context.branchId,

            branchName:
                context.branchName,

            branchCode:
                context.branchCode,

            period:
                context.period,

            status:
                STATUS.INSUFFICIENT_DATA,

            score: {

                overall:
                    null,

                level:
                    PERFORMANCE_LEVEL.UNKNOWN,

                components: {}
            },

            dataQuality,

            sampleSize:
                context.records.total,

            recommendations: [
                {
                    priority: 1,
                    severity: 'HIGH',
                    action:
                        'Increase branch operational data coverage before relying on performance analytics.',
                    rationale:
                        'The current sample size is insufficient for a reliable branch assessment.'
                }
            ],

            risks: [
                {
                    code:
                        'INSUFFICIENT_DATA',
                    level:
                        RISK_LEVEL.HIGH,
                    description:
                        'Branch performance cannot be reliably assessed from the available records.'
                }
            ],

            calculatedAt:
                new Date(),

            durationMs:
                Date.now() -
                startedAt,

            metadata:
                clone(
                    context.metadata
                )
        };

        result.fingerprint =
            this.generateFingerprint(
                result
            );

        return result;
    }

    /**
     * =========================================================================
     * Volume analysis
     * =========================================================================
     */

    _analyzeVolume(context) {

        const transactions =
            context.transactions;

        const statements =
            context.statements;

        const transactionCount =
            transactions.length;

        const statementCount =
            statements.length;

        const transactionAmounts =
            transactions
                .map(
                    item =>
                        this._amount(
                            item
                        )
                )
                .filter(
                    value =>
                        value !== null
                );

        const totalAmount =
            transactionAmounts.reduce(
                (sum, value) =>
                    sum + value,
                0
            );

        const averageTransactionAmount =
            average(
                transactionAmounts
            );

        return {

            transactions:
                transactionCount,

            statements:
                statementCount,

            totalAmount:
                round(
                    totalAmount,
                    4
                ),

            averageTransactionAmount,

            medianTransactionAmount:
                median(
                    transactionAmounts
                ),

            p95TransactionAmount:
                percentile(
                    transactionAmounts,
                    95
                ),

            statementToTransactionRatio:
                ratio(
                    statementCount,
                    transactionCount
                )
        };
    }

    /**
     * =========================================================================
     * Repair analysis
     * =========================================================================
     */

    _analyzeRepairs(context) {

        const repairs =
            context.repairs;

        const transactionCount =
            context.transactions.length;

        const repairCount =
            repairs.length;

        const resolvedCount =
            repairs.filter(
                repair =>
                    this._isResolved(
                        repair
                    )
            ).length;

        const failedCount =
            repairs.filter(
                repair =>
                    this._isFailed(
                        repair
                    )
            ).length;

        const pendingCount =
            repairs.filter(
                repair =>
                    this._isPending(
                        repair
                    )
            ).length;

        const highRiskCount =
            repairs.filter(
                repair =>
                    this._isHighRisk(
                        repair
                    )
            ).length;

        const amounts =
            repairs
                .map(
                    repair =>
                        this._amount(
                            repair
                        )
                )
                .filter(
                    value =>
                        value !== null
                );

        const resolutionTimes =
            repairs
                .map(
                    repair =>
                        this._resolutionTime(
                            repair
                        )
                )
                .filter(
                    value =>
                        value !== null
                );

        const repairRate =
            percentage(
                repairCount,
                transactionCount
            );

        const resolutionRate =
            percentage(
                resolvedCount,
                repairCount
            );

        const failureRate =
            percentage(
                failedCount,
                repairCount
            );

        const pendingRate =
            percentage(
                pendingCount,
                repairCount
            );

        return {

            count:
                repairCount,

            resolved:
                resolvedCount,

            failed:
                failedCount,

            pending:
                pendingCount,

            highRisk:
                highRiskCount,

            repairRate,

            resolutionRate,

            failureRate,

            pendingRate,

            totalAmount:
                round(
                    amounts.reduce(
                        (sum, value) =>
                            sum + value,
                        0
                    ),
                    4
                ),

            averageAmount:
                average(
                    amounts
                ),

            averageResolutionTimeMs:
                average(
                    resolutionTimes
                ),

            medianResolutionTimeMs:
                median(
                    resolutionTimes
                ),

            p95ResolutionTimeMs:
                percentile(
                    resolutionTimes,
                    95
                ),

            slaComplianceRate:
                this._calculateSlaCompliance(
                    repairs,
                    context.targets
                ),

            byType:
                this._groupRepairsByType(
                    repairs
                ),

            bySeverity:
                this._groupRepairsBySeverity(
                    repairs
                )
        };
    }

    _groupRepairsByType(
        repairs
    ) {

        const result = {};

        for (const repair of repairs) {

            const type =
                normalizeString(
                    repair.type ||
                    repair.repairType,
                    'UNKNOWN'
                );

            if (!result[type]) {
                result[type] = 0;
            }

            result[type] += 1;
        }

        return result;
    }

    _groupRepairsBySeverity(
        repairs
    ) {

        const result = {};

        for (const repair of repairs) {

            const severity =
                normalizeString(
                    repair.severity,
                    'UNKNOWN'
                );

            if (!result[severity]) {
                result[severity] = 0;
            }

            result[severity] += 1;
        }

        return result;
    }

    /**
     * =========================================================================
     * Reconciliation analysis
     * =========================================================================
     */

    _analyzeReconciliation(
        context
    ) {

        const records =
            context.reconciliations;

        const total =
            records.length;

        const matched =
            records.filter(
                item =>
                    this._isMatched(
                        item
                    )
            ).length;

        const unmatched =
            records.filter(
                item =>
                    this._isUnmatched(
                        item
                    )
            ).length;

        const variances =
            records.filter(
                item =>
                    this._hasVariance(
                        item
                    )
            ).length;

        const varianceAmounts =
            records
                .map(
                    item =>
                        this._varianceAmount(
                            item
                        )
                )
                .filter(
                    value =>
                        value !== null
                );

        const reconciliationRate =
            percentage(
                matched,
                total
            );

        return {

            total,

            matched,

            unmatched,

            variances,

            matchRate:
                reconciliationRate,

            mismatchRate:
                percentage(
                    unmatched,
                    total
                ),

            varianceRate:
                percentage(
                    variances,
                    total
                ),

            totalVarianceAmount:
                round(
                    varianceAmounts.reduce(
                        (sum, value) =>
                            sum + Math.abs(value),
                        0
                    ),
                    4
                ),

            averageVarianceAmount:
                average(
                    varianceAmounts
                        .map(
                            value =>
                                Math.abs(
                                    value
                                )
                        )
                )
        };
    }

    /**
     * =========================================================================
     * Settlement analysis
     * =========================================================================
     */

    _analyzeSettlements(
        context
    ) {

        const settlements =
            context.settlements;

        const total =
            settlements.length;

        const successful =
            settlements.filter(
                item =>
                    this._isSuccessful(
                        item
                    )
            ).length;

        const failed =
            settlements.filter(
                item =>
                    this._isFailed(
                        item
                    )
            ).length;

        const pending =
            settlements.filter(
                item =>
                    this._isPending(
                        item
                    )
            ).length;

        const amounts =
            settlements
                .map(
                    item =>
                        this._amount(
                            item
                        )
                )
                .filter(
                    value =>
                        value !== null
                );

        const processingTimes =
            settlements
                .map(
                    item =>
                        this._processingTime(
                            item
                        )
                )
                .filter(
                    value =>
                        value !== null
                );

        return {

            total,

            successful,

            failed,

            pending,

            successRate:
                percentage(
                    successful,
                    total
                ),

            failureRate:
                percentage(
                    failed,
                    total
                ),

            pendingRate:
                percentage(
                    pending,
                    total
                ),

            totalAmount:
                round(
                    amounts.reduce(
                        (sum, value) =>
                            sum + value,
                        0
                    ),
                    4
                ),

            averageAmount:
                average(
                    amounts
                ),

            averageProcessingTimeMs:
                average(
                    processingTimes
                ),

            p95ProcessingTimeMs:
                percentile(
                    processingTimes,
                    95
                )
        };
    }

    /**
     * =========================================================================
     * SLA analysis
     * =========================================================================
     */

    _analyzeSla(context) {

        const repairs =
            context.repairs;

        const eligible =
            repairs.filter(
                repair =>
                    this._resolutionTime(
                        repair
                    ) !== null
            );

        const compliant =
            eligible.filter(
                repair =>
                    this._isSlaCompliant(
                        repair,
                        context.targets
                    )
            ).length;

        return {

            eligible:
                eligible.length,

            compliant,

            breached:
                eligible.length -
                compliant,

            complianceRate:
                percentage(
                    compliant,
                    eligible.length
                ),

            target:
                context.targets
                    .slaComplianceRate,

            gap:
                this._targetGap(
                    percentage(
                        compliant,
                        eligible.length
                    ),
                    context.targets
                        .slaComplianceRate * 100
                )
        };
    }

    /**
     * =========================================================================
     * Capacity analysis
     * =========================================================================
     */

    _analyzeCapacity(context) {

        const capacity =
            context.capacity;

        const available =
            toNumber(
                capacity.available
            );

        const utilized =
            toNumber(
                capacity.utilized
            );

        const backlog =
            toNumber(
                capacity.backlog,
                context.repairs.filter(
                    repair =>
                        this._isPending(
                            repair
                        )
                ).length
            );

        const utilization =
            percentage(
                utilized,
                available
            );

        const staffCount =
            toNumber(
                capacity.staffCount
            );

        const averageRepairsPerStaff =
            staffCount &&
            staffCount > 0
                ? ratio(
                    context.repairs.length,
                    staffCount
                )
                : null;

        return {

            available,

            utilized,

            utilizationRate:
                utilization,

            backlog,

            staffCount,

            averageRepairsPerStaff,

            capacityGap:
                available !== null &&
                utilized !== null
                    ? round(
                        available -
                        utilized,
                        4
                    )
                    : null,

            overloaded:
                utilization !== null &&
                utilization > 100,

            constrained:
                utilization !== null &&
                utilization >= 85
        };
    }

    /**
     * =========================================================================
     * Financial impact
     * =========================================================================
     */

    _analyzeFinancialImpact(
        context
    ) {

        const repairAmounts =
            context.repairs
                .map(
                    repair =>
                        this._amount(
                            repair
                        )
                )
                .filter(
                    value =>
                        value !== null
                );

        const varianceAmounts =
            context.reconciliations
                .map(
                    item =>
                        this._varianceAmount(
                            item
                        )
                )
                .filter(
                    value =>
                        value !== null
                );

        const settlementAmounts =
            context.settlements
                .map(
                    item =>
                        this._amount(
                            item
                        )
                )
                .filter(
                    value =>
                        value !== null
                );

        return {

            repairExposure:
                round(
                    repairAmounts.reduce(
                        (sum, value) =>
                            sum + Math.abs(value),
                        0
                    ),
                    4
                ),

            reconciliationVariance:
                round(
                    varianceAmounts.reduce(
                        (sum, value) =>
                            sum + Math.abs(value),
                        0
                    ),
                    4
                ),

            settlementVolume:
                round(
                    settlementAmounts.reduce(
                        (sum, value) =>
                            sum + Math.abs(value),
                        0
                    ),
                    4
                ),

            averageRepairExposure:
                average(
                    repairAmounts.map(
                        value =>
                            Math.abs(value)
                    )
                ),

            largestRepairExposure:
                repairAmounts.length
                    ? Math.max(
                        ...repairAmounts.map(
                            value =>
                                Math.abs(value)
                        )
                    )
                    : null,

            largestVariance:
                varianceAmounts.length
                    ? Math.max(
                        ...varianceAmounts.map(
                            value =>
                                Math.abs(value)
                        )
                    )
                    : null,

            currency:
                this._resolveCurrency(
                    context
                )
        };
    }

    /**
     * =========================================================================
     * Processing quality
     * =========================================================================
     */

    _analyzeProcessingQuality(
        context
    ) {

        const transactions =
            context.transactions;

        const firstPassMatches =
            transactions.filter(
                transaction =>
                    this._isFirstPassMatch(
                        transaction
                    )
            ).length;

        const cleanTransactions =
            transactions.filter(
                transaction =>
                    this._isClean(
                        transaction
                    )
            ).length;

        return {

            firstPassMatchRate:
                percentage(
                    firstPassMatches,
                    transactions.length
                ),

            cleanProcessingRate:
                percentage(
                    cleanTransactions,
                    transactions.length
                ),

            firstPassMatches,

            cleanTransactions,

            targetFirstPassMatchRate:
                context.targets
                    .firstPassMatchRate * 100
        };
    }

    /**
     * =========================================================================
     * Trend analysis
     * =========================================================================
     */

    _analyzeTrends(context) {

        const periods =
            context.periods;

        if (
            periods.length < 2
        ) {

            return {

                available:
                    false,

                direction:
                    TREND.UNKNOWN,

                confidence:
                    0,

                points:
                    periods.length
            };
        }

        const scores =
            periods
                .map(
                    period =>
                        toNumber(
                            period.score ||
                            period.performanceScore ||
                            period.overallScore
                        )
                )
                .filter(
                    value =>
                        value !== null
                );

        if (
            scores.length < 2
        ) {

            return {

                available:
                    false,

                direction:
                    TREND.UNKNOWN,

                confidence:
                    0,

                points:
                    scores.length
            };
        }

        const first =
            scores[0];

        const last =
            scores[
                scores.length - 1
            ];

        const change =
            last - first;

        const changes = [];

        for (
            let index = 1;
            index < scores.length;
            index += 1
        ) {

            changes.push(
                scores[index] -
                scores[index - 1]
            );
        }

        const averageChange =
            average(
                changes
            );

        const variance =
            this._variance(
                changes
            );

        const volatility =
            variance !== null
                ? Math.sqrt(
                    variance
                )
                : null;

        let direction;

        if (
            volatility !== null &&
            volatility > 15
        ) {

            direction =
                TREND.VOLATILE;

        } else if (
            change > 5
        ) {

            direction =
                TREND.IMPROVING;

        } else if (
            change < -5
        ) {

            direction =
                TREND.DETERIORATING;

        } else {

            direction =
                TREND.STABLE;
        }

        return {

            available:
                true,

            direction,

            firstScore:
                round(
                    first,
                    2
                ),

            latestScore:
                round(
                    last,
                    2
                ),

            change:
                round(
                    change,
                    2
                ),

            averageChange,

            volatility:
                round(
                    volatility,
                    2
                ),

            confidence:
                clamp(
                    scores.length * 10,
                    0,
                    100
                ),

            points:
                scores.length,

            series:
                scores
        };
    }

    /**
     * =========================================================================
     * Performance score
     * =========================================================================
     */

    _calculatePerformanceScore(
        metrics
    ) {

        const components = {

            repair:
                this._scoreRate(
                    metrics.repairs.repairRate,
                    metrics.repairs.repairRate === null
                        ? null
                        : this.options.targetRepairRate * 100,
                    true
                ),

            repairResolution:
                this._scoreRate(
                    metrics.repairs.resolutionRate,
                    this.options.targetRepairResolutionRate * 100
                ),

            reconciliation:
                this._scoreRate(
                    metrics.reconciliation.matchRate,
                    this.options.targetReconciliationRate * 100
                ),

            settlement:
                this._scoreRate(
                    metrics.settlements.successRate,
                    this.options.targetSettlementSuccessRate * 100
                ),

            sla:
                this._scoreRate(
                    metrics.sla.complianceRate,
                    this.options.targetSlaComplianceRate * 100
                ),

            firstPass:
                this._scoreRate(
                    metrics.quality.firstPassMatchRate,
                    this.options.targetFirstPassMatchRate * 100
                ),

            capacity:
                this._capacityScore(
                    metrics.capacity
                )
        };

        const weights = {

            repair:
                0.15,

            repairResolution:
                0.15,

            reconciliation:
                0.20,

            settlement:
                0.15,

            sla:
                0.15,

            firstPass:
                0.10,

            capacity:
                0.10
        };

        let weightedTotal = 0;
        let totalWeight = 0;

        for (
            const key of Object.keys(weights)
        ) {

            const value =
                components[key];

            if (
                value === null ||
                value === undefined
            ) {
                continue;
            }

            weightedTotal +=
                value *
                weights[key];

            totalWeight +=
                weights[key];
        }

        const overall =
            totalWeight > 0
                ? weightedTotal /
                  totalWeight
                : null;

        return {

            overall:
                overall === null
                    ? null
                    : round(
                        overall,
                        2
                    ),

            level:
                this._performanceLevel(
                    overall
                ),

            components,

            weights
        };
    }

    _scoreRate(
        actual,
        target,
        lowerIsBetter = false
    ) {

        const actualValue =
            toNumber(actual);

        const targetValue =
            toNumber(target);

        if (
            actualValue === null ||
            targetValue === null
        ) {
            return null;
        }

        if (
            lowerIsBetter
        ) {

            if (
                actualValue <=
                targetValue
            ) {
                return 100;
            }

            if (
                actualValue >=
                targetValue * 2
            ) {
                return 0;
            }

            return clamp(
                100 -
                (
                    (
                        actualValue -
                        targetValue
                    ) /
                    targetValue
                ) *
                100,
                0,
                100
            );
        }

        if (
            actualValue >=
            targetValue
        ) {
            return 100;
        }

        if (
            targetValue === 0
        ) {
            return actualValue === 0
                ? 100
                : 0;
        }

        return clamp(
            (
                actualValue /
                targetValue
            ) * 100,
            0,
            100
        );
    }

    _capacityScore(capacity) {

        const utilization =
            toNumber(
                capacity.utilizationRate
            );

        if (
            utilization === null
        ) {
            return null;
        }

        if (
            utilization <= 70
        ) {
            return 100;
        }

        if (
            utilization <= 85
        ) {
            return 90;
        }

        if (
            utilization <= 100
        ) {
            return 75;
        }

        if (
            utilization <= 120
        ) {
            return 50;
        }

        return 20;
    }

    _performanceLevel(score) {

        if (
            score === null ||
            score === undefined
        ) {
            return PERFORMANCE_LEVEL.UNKNOWN;
        }

        if (score >= 90) {
            return PERFORMANCE_LEVEL.EXCELLENT;
        }

        if (score >= 80) {
            return PERFORMANCE_LEVEL.GOOD;
        }

        if (score >= 70) {
            return PERFORMANCE_LEVEL.ACCEPTABLE;
        }

        if (score >= 60) {
            return PERFORMANCE_LEVEL.BELOW_TARGET;
        }

        if (score >= 40) {
            return PERFORMANCE_LEVEL.POOR;
        }

        return PERFORMANCE_LEVEL.CRITICAL;
    }

    _classifyStatus(
        score,
        dataQuality
    ) {

        if (
            dataQuality.level ===
            DATA_QUALITY.INSUFFICIENT
        ) {
            return STATUS.INSUFFICIENT_DATA;
        }

        const overall =
            toNumber(
                score.overall
            );

        if (
            overall === null
        ) {
            return STATUS.INSUFFICIENT_DATA;
        }

        if (
            overall >= 90
        ) {
            return STATUS.HEALTHY;
        }

        if (
            overall >= 80
        ) {
            return STATUS.STABLE;
        }

        if (
            overall >= 70
        ) {
            return STATUS.WATCH;
        }

        if (
            overall >= 50
        ) {
            return STATUS.AT_RISK;
        }

        return STATUS.CRITICAL;
    }

    /**
     * =========================================================================
     * Risk detection
     * =========================================================================
     */

    _identifyRisks(metrics) {

        const risks = [];

        const {
            repairs,
            reconciliation,
            settlements,
            sla,
            capacity,
            financial,
            quality,
            score
        } = metrics;

        if (
            repairs.repairRate !== null &&
            repairs.repairRate >
            this.options.targetRepairRate * 100
        ) {

            risks.push({

                code:
                    'HIGH_REPAIR_RATE',

                level:
                    this._riskLevelFromGap(
                        repairs.repairRate,
                        this.options.targetRepairRate * 100,
                        true
                    ),

                description:
                    'Branch repair volume is above the operational target.',

                metric:
                    repairs.repairRate,

                target:
                    this.options.targetRepairRate * 100
            });
        }

        if (
            reconciliation.matchRate !== null &&
            reconciliation.matchRate <
            this.options.targetReconciliationRate * 100
        ) {

            risks.push({

                code:
                    'RECONCILIATION_DEGRADATION',

                level:
                    this._riskLevelFromGap(
                        reconciliation.matchRate,
                        this.options.targetReconciliationRate * 100
                    ),

                description:
                    'Branch reconciliation performance is below target.',

                metric:
                    reconciliation.matchRate,

                target:
                    this.options.targetReconciliationRate * 100
            });
        }

        if (
            settlements.failureRate !== null &&
            settlements.failureRate > 2
        ) {

            risks.push({

                code:
                    'SETTLEMENT_FAILURE_RATE',

                level:
                    settlements.failureRate > 10
                        ? RISK_LEVEL.CRITICAL
                        : settlements.failureRate > 5
                            ? RISK_LEVEL.HIGH
                            : RISK_LEVEL.MEDIUM,

                description:
                    'Settlement failures require operational investigation.',

                metric:
                    settlements.failureRate
            });
        }

        if (
            sla.complianceRate !== null &&
            sla.complianceRate <
            this.options.targetSlaComplianceRate * 100
        ) {

            risks.push({

                code:
                    'SLA_BREACH_RISK',

                level:
                    this._riskLevelFromGap(
                        sla.complianceRate,
                        this.options.targetSlaComplianceRate * 100
                    ),

                description:
                    'Repair resolution is failing to consistently meet SLA expectations.',

                metric:
                    sla.complianceRate,

                target:
                    this.options.targetSlaComplianceRate * 100
            });
        }

        if (
            capacity.utilizationRate !== null &&
            capacity.utilizationRate > 100
        ) {

            risks.push({

                code:
                    'CAPACITY_OVERLOAD',

                level:
                    capacity.utilizationRate > 120
                        ? RISK_LEVEL.CRITICAL
                        : RISK_LEVEL.HIGH,

                description:
                    'Branch operational capacity is overloaded.',

                metric:
                    capacity.utilizationRate
            });
        }

        if (
            financial.largestRepairExposure !== null &&
            financial.largestRepairExposure > 0
        ) {

            risks.push({

                code:
                    'FINANCIAL_REPAIR_EXPOSURE',

                level:
                    RISK_LEVEL.MEDIUM,

                description:
                    'One or more repairs represent material financial exposure.',

                metric:
                    financial.largestRepairExposure
            });
        }

        if (
            quality.firstPassMatchRate !== null &&
            quality.firstPassMatchRate <
            this.options.targetFirstPassMatchRate * 100
        ) {

            risks.push({

                code:
                    'LOW_FIRST_PASS_MATCH_RATE',

                level:
                    RISK_LEVEL.MEDIUM,

                description:
                    'Transactions are requiring excessive downstream intervention.',

                metric:
                    quality.firstPassMatchRate
            });
        }

        if (
            score.overall !== null &&
            score.overall < 50
        ) {

            risks.push({

                code:
                    'BRANCH_PERFORMANCE_CRITICAL',

                level:
                    RISK_LEVEL.CRITICAL,

                description:
                    'Composite branch performance score indicates critical operational degradation.',

                metric:
                    score.overall
            });
        }

        return risks
            .slice(
                0,
                this.options.maximumIssues
            );
    }

    _riskLevelFromGap(
        actual,
        target,
        lowerIsBetter = false
    ) {

        if (
            actual === null ||
            target === null
        ) {
            return RISK_LEVEL.UNKNOWN;
        }

        if (
            lowerIsBetter
        ) {

            const excess =
                actual -
                target;

            if (
                excess <= 0
            ) {
                return RISK_LEVEL.LOW;
            }

            const ratio =
                target === 0
                    ? Infinity
                    : excess /
                      target;

            if (
                ratio >= 1
            ) {
                return RISK_LEVEL.CRITICAL;
            }

            if (
                ratio >= 0.5
            ) {
                return RISK_LEVEL.HIGH;
            }

            return RISK_LEVEL.MEDIUM;
        }

        const deficit =
            target -
            actual;

        if (
            deficit <= 0
        ) {
            return RISK_LEVEL.LOW;
        }

        const ratio =
            target === 0
                ? Infinity
                : deficit /
                  target;

        if (
            ratio >= 0.2
        ) {
            return RISK_LEVEL.CRITICAL;
        }

        if (
            ratio >= 0.1
        ) {
            return RISK_LEVEL.HIGH;
        }

        return RISK_LEVEL.MEDIUM;
    }

    /**
     * =========================================================================
     * Performance drivers
     * =========================================================================
     */

    _identifyPerformanceDrivers(
        metrics
    ) {

        const drivers = [];

        const {
            repairs,
            reconciliation,
            settlements,
            sla,
            capacity,
            financial,
            quality
        } = metrics;

        this._addDriver(
            drivers,
            'REPAIR_RATE',
            repairs.repairRate,
            this.options.targetRepairRate * 100,
            'lower-is-better',
            'Repair rate is materially affecting branch performance.'
        );

        this._addDriver(
            drivers,
            'RECONCILIATION_RATE',
            reconciliation.matchRate,
            this.options.targetReconciliationRate * 100,
            'higher-is-better',
            'Reconciliation quality is materially affecting branch performance.'
        );

        this._addDriver(
            drivers,
            'SETTLEMENT_SUCCESS_RATE',
            settlements.successRate,
            this.options.targetSettlementSuccessRate * 100,
            'higher-is-better',
            'Settlement reliability is materially affecting branch performance.'
        );

        this._addDriver(
            drivers,
            'SLA_COMPLIANCE',
            sla.complianceRate,
            this.options.targetSlaComplianceRate * 100,
            'higher-is-better',
            'SLA compliance is materially affecting branch performance.'
        );

        this._addDriver(
            drivers,
            'CAPACITY_UTILIZATION',
            capacity.utilizationRate,
            85,
            'lower-is-better',
            'Capacity utilization is materially affecting branch performance.'
        );

        this._addDriver(
            drivers,
            'FIRST_PASS_MATCH_RATE',
            quality.firstPassMatchRate,
            this.options.targetFirstPassMatchRate * 100,
            'higher-is-better',
            'First-pass processing quality is materially affecting branch performance.'
        );

        if (
            financial.reconciliationVariance > 0
        ) {

            drivers.push({

                metric:
                    'FINANCIAL_VARIANCE',

                direction:
                    'NEGATIVE',

                severity:
                    'MEDIUM',

                magnitude:
                    financial.reconciliationVariance,

                description:
                    'Reconciliation variance is creating financial exposure.'
            });
        }

        return drivers
            .sort(
                (a, b) =>
                    (
                        toNumber(
                            b.magnitude,
                            0
                        ) -
                        toNumber(
                            a.magnitude,
                            0
                        )
                    )
            )
            .slice(
                0,
                this.options.maximumDrivers
            );
    }

    _addDriver(
        drivers,
        metric,
        actual,
        target,
        directionType,
        description
    ) {

        if (
            actual === null ||
            actual === undefined
        ) {
            return;
        }

        const gap =
            directionType ===
            'lower-is-better'
                ? actual - target
                : target - actual;

        if (
            gap <= 0
        ) {
            return;
        }

        drivers.push({

            metric,

            direction:
                'NEGATIVE',

            severity:
                gap >= 10
                    ? 'HIGH'
                    : 'MEDIUM',

            magnitude:
                round(
                    Math.abs(gap),
                    4
                ),

            actual:
                round(
                    actual,
                    4
                ),

            target:
                round(
                    target,
                    4
                ),

            description
        });
    }

    /**
     * =========================================================================
     * Recommendations
     * =========================================================================
     */

    _generateRecommendations(
        metrics
    ) {

        const recommendations = [];

        const {
            context,
            status,
            score,
            repairs,
            reconciliation,
            settlements,
            sla,
            capacity,
            quality,
            risks
        } = metrics;

        if (
            repairs.repairRate !== null &&
            repairs.repairRate >
            context.targets.repairRate * 100
        ) {

            recommendations.push({

                priority:
                    1,

                severity:
                    'HIGH',

                action:
                    'Investigate and reduce the highest-frequency statement repair causes.',

                rationale:
                    `Repair rate is ${repairs.repairRate}% against a target of ${context.targets.repairRate * 100}%.`,

                category:
                    'REPAIR_REDUCTION'
            });
        }

        if (
            reconciliation.matchRate !== null &&
            reconciliation.matchRate <
            context.targets.reconciliationRate * 100
        ) {

            recommendations.push({

                priority:
                    1,

                severity:
                    'HIGH',

                action:
                    'Review unmatched transactions and reconciliation variance sources.',

                rationale:
                    `Reconciliation match rate is ${reconciliation.matchRate}%.`,

                category:
                    'RECONCILIATION'
            });
        }

        if (
            settlements.failureRate !== null &&
            settlements.failureRate > 2
        ) {

            recommendations.push({

                priority:
                    2,

                severity:
                    settlements.failureRate > 5
                        ? 'HIGH'
                        : 'MEDIUM',

                action:
                    'Review settlement failures by provider, transaction type, and failure reason.',

                rationale:
                    `Settlement failure rate is ${settlements.failureRate}%.`,

                category:
                    'SETTLEMENT'
            });
        }

        if (
            sla.complianceRate !== null &&
            sla.complianceRate <
            context.targets.slaComplianceRate * 100
        ) {

            recommendations.push({

                priority:
                    2,

                severity:
                    'HIGH',

                action:
                    'Rebalance repair workload and prioritize SLA-breaching repairs.',

                rationale:
                    `SLA compliance is ${sla.complianceRate}%.`,

                category:
                    'SLA'
            });
        }

        if (
            capacity.utilizationRate !== null &&
            capacity.utilizationRate > 85
        ) {

            recommendations.push({

                priority:
                    2,

                severity:
                    capacity.utilizationRate > 100
                        ? 'CRITICAL'
                        : 'HIGH',

                action:
                    'Increase branch repair-processing capacity or redistribute workload.',

                rationale:
                    `Capacity utilization is ${capacity.utilizationRate}%.`,

                category:
                    'CAPACITY'
            });
        }

        if (
            quality.firstPassMatchRate !== null &&
            quality.firstPassMatchRate <
            context.targets.firstPassMatchRate * 100
        ) {

            recommendations.push({

                priority:
                    3,

                severity:
                    'MEDIUM',

                action:
                    'Investigate transaction validation and matching rules causing downstream repair activity.',

                rationale:
                    `First-pass match rate is ${quality.firstPassMatchRate}%.`,

                category:
                    'PROCESSING_QUALITY'
            });
        }

        if (
            score.overall !== null &&
            score.overall >= 90
        ) {

            recommendations.push({

                priority:
                    4,

                severity:
                    'LOW',

                action:
                    'Maintain current controls and identify branch practices that can be reused across the network.',

                rationale:
                    'Branch performance is operating at a high level.',

                category:
                    'BEST_PRACTICE'
            });
        }

        if (
            status === STATUS.CRITICAL
        ) {

            recommendations.unshift({

                priority:
                    0,

                severity:
                    'CRITICAL',

                action:
                    'Escalate branch operational degradation for immediate management review.',

                rationale:
                    'Composite branch performance is in the critical range.',

                category:
                    'ESCALATION'
            });
        }

        return recommendations
            .sort(
                (a, b) =>
                    a.priority -
                    b.priority
            )
            .slice(
                0,
                this.options.maximumRecommendations
            );
    }

    /**
     * =========================================================================
     * Benchmarking
     * =========================================================================
     */

    _calculateBenchmarks(
        context,
        metrics
    ) {

        const benchmark =
            context.benchmark;

        if (
            !benchmark
        ) {

            return {

                available:
                    false,

                branchRank:
                    null,

                totalBranches:
                    null,

                percentile:
                    null,

                comparison:
                    null
            };
        }

        const branchScore =
            toNumber(
                metrics.score.overall
            );

        const benchmarkScore =
            toNumber(
                benchmark.averageScore ||
                benchmark.score
            );

        if (
            branchScore === null ||
            benchmarkScore === null
        ) {

            return {

                available:
                    false,

                branchRank:
                    null,

                totalBranches:
                    null,

                percentile:
                    null,

                comparison:
                    null
            };
        }

        const difference =
            branchScore -
            benchmarkScore;

        return {

            available:
                true,

            branchRank:
                toNumber(
                    benchmark.branchRank
                ),

            totalBranches:
                toNumber(
                    benchmark.totalBranches
                ),

            percentile:
                toNumber(
                    benchmark.percentile
                ),

            averageScore:
                round(
                    benchmarkScore,
                    2
                ),

            branchScore:
                round(
                    branchScore,
                    2
                ),

            difference:
                round(
                    difference,
                    2
                ),

            comparison:
                difference > 5
                    ? 'ABOVE_BENCHMARK'
                    : difference < -5
                        ? 'BELOW_BENCHMARK'
                        : 'AT_BENCHMARK'
        };
    }

    /**
     * =========================================================================
     * Data helpers
     * =========================================================================
     */

    _amount(record) {

        if (!isObject(record)) {
            return null;
        }

        return toNumber(
            record.amount ??
            record.transactionAmount ??
            record.repairAmount ??
            record.settlementAmount ??
            record.value
        );
    }

    _varianceAmount(record) {

        if (!isObject(record)) {
            return null;
        }

        return toNumber(
            record.varianceAmount ??
            record.amountVariance ??
            record.variance
        );
    }

    _resolutionTime(record) {

        if (!isObject(record)) {
            return null;
        }

        const explicit =
            toNumber(
                record.resolutionTimeMs ??
                record.processingTimeMs ??
                record.durationMs
            );

        if (
            explicit !== null
        ) {
            return explicit;
        }

        const created =
            normalizeDate(
                record.createdAt ??
                record.detectedAt ??
                record.openedAt
            );

        const resolved =
            normalizeDate(
                record.resolvedAt ??
                record.completedAt ??
                record.closedAt
            );

        if (
            !created ||
            !resolved
        ) {
            return null;
        }

        return Math.max(
            0,
            resolved.getTime() -
            created.getTime()
        );
    }

    _processingTime(record) {

        if (!isObject(record)) {
            return null;
        }

        const explicit =
            toNumber(
                record.processingTimeMs ??
                record.durationMs
            );

        if (
            explicit !== null
        ) {
            return explicit;
        }

        const started =
            normalizeDate(
                record.startedAt ??
                record.createdAt
            );

        const completed =
            normalizeDate(
                record.completedAt ??
                record.settledAt
            );

        if (
            !started ||
            !completed
        ) {
            return null;
        }

        return Math.max(
            0,
            completed.getTime() -
            started.getTime()
        );
    }

    _isResolved(record) {

        const status =
            normalizeString(
                record.status ||
                record.state
            );

        return [
            'RESOLVED',
            'COMPLETED',
            'CLOSED',
            'SUCCESS',
            'REPAIRED'
        ].includes(
            String(
                status || ''
            ).toUpperCase()
        );
    }

    _isFailed(record) {

        const status =
            normalizeString(
                record.status ||
                record.state
            );

        return [
            'FAILED',
            'ERROR',
            'REJECTED',
            'DECLINED'
        ].includes(
            String(
                status || ''
            ).toUpperCase()
        );
    }

    _isPending(record) {

        const status =
            normalizeString(
                record.status ||
                record.state
            );

        return [
            'PENDING',
            'OPEN',
            'QUEUED',
            'PROCESSING',
            'IN_PROGRESS',
            'AWAITING_REVIEW'
        ].includes(
            String(
                status || ''
            ).toUpperCase()
        );
    }

    _isHighRisk(record) {

        const severity =
            normalizeString(
                record.severity ||
                record.riskLevel
            );

        return [
            'HIGH',
            'CRITICAL',
            'SEVERE'
        ].includes(
            String(
                severity || ''
            ).toUpperCase()
        );
    }

    _isMatched(record) {

        if (
            record.matched === true ||
            record.isMatched === true
        ) {
            return true;
        }

        const status =
            normalizeString(
                record.status ||
                record.matchStatus
            );

        return [
            'MATCHED',
            'RECONCILED',
            'SUCCESS',
            'COMPLETE'
        ].includes(
            String(
                status || ''
            ).toUpperCase()
        );
    }

    _isUnmatched(record) {

        if (
            record.matched === false ||
            record.isMatched === false
        ) {
            return true;
        }

        const status =
            normalizeString(
                record.status ||
                record.matchStatus
            );

        return [
            'UNMATCHED',
            'MISMATCHED',
            'PENDING',
            'EXCEPTION'
        ].includes(
            String(
                status || ''
            ).toUpperCase()
        );
    }

    _hasVariance(record) {

        const variance =
            this._varianceAmount(
                record
            );

        return (
            variance !== null &&
            Math.abs(
                variance
            ) > 0
        );
    }

    _isSuccessful(record) {

        if (
            record.success === true ||
            record.succeeded === true
        ) {
            return true;
        }

        const status =
            normalizeString(
                record.status ||
                record.state
            );

        return [
            'SUCCESS',
            'SUCCESSFUL',
            'COMPLETED',
            'SETTLED'
        ].includes(
            String(
                status || ''
            ).toUpperCase()
        );
    }

    _isFirstPassMatch(
        transaction
    ) {

        return (
            transaction.firstPassMatch === true ||
            transaction.matchedOnFirstPass === true ||
            transaction.repaired === false
        );
    }

    _isClean(transaction) {

        if (
            transaction.clean === true
        ) {
            return true;
        }

        if (
            transaction.repaired === true ||
            transaction.requiresRepair === true
        ) {
            return false;
        }

        return true;
    }

    _isSlaCompliant(
        repair,
        targets
    ) {

        const resolutionTime =
            this._resolutionTime(
                repair
            );

        if (
            resolutionTime === null
        ) {
            return false;
        }

        const sla =
            toNumber(
                repair.slaMs ??
                repair.slaDurationMs ??
                targets.averageResolutionTimeMs
            );

        if (
            sla === null
        ) {
            return false;
        }

        return (
            resolutionTime <=
            sla
        );
    }

    _calculateSlaCompliance(
        repairs,
        targets
    ) {

        const eligible =
            repairs.filter(
                repair =>
                    this._resolutionTime(
                        repair
                    ) !== null
            );

        const compliant =
            eligible.filter(
                repair =>
                    this._isSlaCompliant(
                        repair,
                        targets
                    )
            ).length;

        return percentage(
            compliant,
            eligible.length
        );
    }

    _resolveCurrency(context) {

        const candidates = [

            ...context.transactions,
            ...context.repairs,
            ...context.settlements
        ];

        for (
            const record of candidates
        ) {

            const currency =
                normalizeString(
                    record.currency ||
                    record.currencyCode
                );

            if (currency) {
                return currency;
            }
        }

        return null;
    }

    /**
     * =========================================================================
     * Math helpers
     * =========================================================================
     */

    _variance(values) {

        const valid =
            values
                .map(
                    value =>
                        toNumber(value)
                )
                .filter(
                    value =>
                        value !== null
                );

        if (
            valid.length < 2
        ) {
            return null;
        }

        const mean =
            valid.reduce(
                (sum, value) =>
                    sum + value,
                0
            ) /
            valid.length;

        return round(
            valid.reduce(
                (sum, value) =>
                    sum +
                    (
                        value -
                        mean
                    ) ** 2,
                0
            ) /
            valid.length,
            6
        );
    }

    _targetGap(
        actual,
        target
    ) {

        if (
            actual === null ||
            target === null
        ) {
            return null;
        }

        return round(
            actual - target,
            4
        );
    }

    /**
     * =========================================================================
     * Identity / integrity
     * =========================================================================
     */

    _generateAnalysisId() {

        return [
            'branch-performance',
            Date.now().toString(36),
            crypto
                .randomBytes(10)
                .toString('hex')
        ].join('-');
    }

    generateFingerprint(
        result
    ) {

        if (
            !isObject(result)
        ) {
            throw new TypeError(
                'Fingerprint input must be an object.'
            );
        }

        const fingerprintPayload = {

            model:
                result.model,

            schemaVersion:
                result.schemaVersion,

            tenantId:
                result.tenantId,

            organizationId:
                result.organizationId,

            branchId:
                result.branchId,

            period:
                result.period,

            status:
                result.status,

            score:
                result.score,

            dataQuality:
                result.dataQuality,

            volume:
                result.volume,

            repairs:
                result.repairs,

            reconciliation:
                result.reconciliation,

            settlements:
                result.settlements,

            sla:
                result.sla,

            capacity:
                result.capacity,

            financial:
                result.financial,

            quality:
                result.quality,

            trends:
                result.trends,

            risks:
                result.risks,

            drivers:
                result.drivers,

            recommendations:
                result.recommendations,

            benchmarks:
                result.benchmarks
        };

        return sha256(
            fingerprintPayload
        );
    }

    verifyFingerprint(
        result
    ) {

        if (
            !result ||
            !result.fingerprint
        ) {
            return false;
        }

        return (
            result.fingerprint ===
            this.generateFingerprint(
                result
            )
        );
    }

    /**
     * =========================================================================
     * Comparison API
     * =========================================================================
     */

    compare(
        current,
        previous
    ) {

        if (
            !isObject(current) ||
            !isObject(previous)
        ) {
            throw new TypeError(
                'Both current and previous branch analyses are required.'
            );
        }

        const metrics = [

            'score.overall',
            'repairs.repairRate',
            'repairs.resolutionRate',
            'reconciliation.matchRate',
            'settlements.successRate',
            'sla.complianceRate',
            'capacity.utilizationRate',
            'quality.firstPassMatchRate'
        ];

        const result = {};

        for (
            const path of metrics
        ) {

            const currentValue =
                this._getPath(
                    current,
                    path
                );

            const previousValue =
                this._getPath(
                    previous,
                    path
                );

            const currentNumber =
                toNumber(
                    currentValue
                );

            const previousNumber =
                toNumber(
                    previousValue
                );

            result[path] = {

                current:
                    currentNumber,

                previous:
                    previousNumber,

                change:
                    currentNumber !== null &&
                    previousNumber !== null
                        ? round(
                            currentNumber -
                            previousNumber,
                            4
                        )
                        : null,

                changePercent:
                    currentNumber !== null &&
                    previousNumber !== null &&
                    previousNumber !== 0
                        ? round(
                            (
                                (
                                    currentNumber -
                                    previousNumber
                                ) /
                                Math.abs(
                                    previousNumber
                                )
                            ) *
                            100,
                            4
                        )
                        : null
            };
        }

        return result;
    }

    _getPath(
        object,
        path
    ) {

        return path
            .split('.')
            .reduce(
                (
                    current,
                    key
                ) =>
                    current === null ||
                    current === undefined
                        ? undefined
                        : current[key],
                object
            );
    }

    /**
     * =========================================================================
     * Export helpers
     * =========================================================================
     */

    toObject(
        result
    ) {

        return clone(
            result
        );
    }

    toJSON(
        result
    ) {

        return this.toObject(
            result
        );
    }

    /**
     * =========================================================================
     * Static factory
     * =========================================================================
     */

    static create(
        options = {}
    ) {

        return new BranchPerformanceAnalyzer(
            options
        );
    }

    static analyze(
        input,
        options = {}
    ) {

        return new BranchPerformanceAnalyzer(
            options
        ).analyze(
            input
        );
    }

    /**
     * =========================================================================
     * Constants
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

    static get TREND() {
        return TREND;
    }

    static get PERFORMANCE_LEVEL() {
        return PERFORMANCE_LEVEL;
    }

    static get RISK_LEVEL() {
        return RISK_LEVEL;
    }

    static get DATA_QUALITY() {
        return DATA_QUALITY;
    }
}

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports =
    BranchPerformanceAnalyzer;

module.exports.BranchPerformanceAnalyzer =
    BranchPerformanceAnalyzer;

module.exports.STATUS =
    STATUS;

module.exports.TREND =
    TREND;

module.exports.PERFORMANCE_LEVEL =
    PERFORMANCE_LEVEL;

module.exports.RISK_LEVEL =
    RISK_LEVEL;

module.exports.DATA_QUALITY =
    DATA_QUALITY;

module.exports.SCHEMA_VERSION =
    SCHEMA_VERSION;
