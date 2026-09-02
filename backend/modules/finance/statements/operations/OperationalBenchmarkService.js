'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * OperationalBenchmarkService
 * ============================================================================
 *
 * Location:
 *   backend/modules/finance/statements/operations/OperationalBenchmarkService.js
 *
 * Purpose
 * -------
 * Enterprise operational benchmarking engine for the financial statement
 * intelligence subsystem.
 *
 * Responsibilities
 * ----------------
 * - Benchmark operational performance against peer branches/entities.
 * - Benchmark current performance against historical performance.
 * - Calculate normalized operational KPIs.
 * - Calculate percentile and relative performance.
 * - Detect operational outliers.
 * - Identify performance gaps.
 * - Produce benchmark scores.
 * - Produce confidence scores.
 * - Generate actionable recommendations.
 * - Support branch, tenant, organization and network-level analysis.
 * - Provide deterministic benchmark fingerprints.
 *
 * Non-responsibilities
 * --------------------
 * - Does not mutate financial records.
 * - Does not execute repairs.
 * - Does not modify ledger entries.
 * - Does not persist data directly.
 * - Does not schedule jobs.
 * - Does not make autonomous accounting decisions.
 *
 * Designed consumers
 * ------------------
 * - BranchPerformanceAnalyzer
 * - CapacityPlanner
 * - RepairAnalyticsSnapshot
 * - OperationalMetrics
 * - RepairForecastEngine
 * - PredictiveRepairScheduler
 * - ExecutiveReportingExporter
 *
 * Architectural principles
 * -------------------------
 * - Tenant isolation.
 * - No persistence coupling.
 * - Deterministic calculations.
 * - Defensive input normalization.
 * - Explainable scoring.
 * - Explicit data-quality handling.
 * - Backward-compatible CommonJS exports.
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
    'OperationalBenchmarkService';

const SCHEMA_VERSION =
    '1.0.0';

const BENCHMARK_TYPE = Object.freeze({

    PEER:
        'PEER',

    HISTORICAL:
        'HISTORICAL',

    NETWORK:
        'NETWORK',

    TARGET:
        'TARGET',

    COMBINED:
        'COMBINED'
});

const PERFORMANCE_LEVEL = Object.freeze({

    EXCEPTIONAL:
        'EXCEPTIONAL',

    STRONG:
        'STRONG',

    HEALTHY:
        'HEALTHY',

    WATCH:
        'WATCH',

    UNDERPERFORMING:
        'UNDERPERFORMING',

    CRITICAL:
        'CRITICAL',

    UNKNOWN:
        'UNKNOWN'
});

const RISK_LEVEL = Object.freeze({

    LOW:
        'LOW',

    MEDIUM:
        'MEDIUM',

    HIGH:
        'HIGH',

    CRITICAL:
        'CRITICAL',

    UNKNOWN:
        'UNKNOWN'
});

const DIRECTION = Object.freeze({

    HIGHER_IS_BETTER:
        'HIGHER_IS_BETTER',

    LOWER_IS_BETTER:
        'LOWER_IS_BETTER',

    TARGET:
        'TARGET'
});

const DEFAULTS = Object.freeze({

    minimumPeerSampleSize:
        3,

    minimumHistoricalSampleSize:
        3,

    maximumRecords:
        100000,

    maximumRecommendations:
        25,

    maximumOutliers:
        100,

    maximumBenchmarks:
        100,

    defaultConfidence:
        50,

    exceptionalPercentile:
        90,

    strongPercentile:
        75,

    healthyPercentile:
        50,

    watchPercentile:
        35,

    underperformingPercentile:
        20,

    zScoreThreshold:
        2,

    criticalZScoreThreshold:
        3,

    defaultRepairRateWeight:
        0.20,

    defaultResolutionRateWeight:
        0.20,

    defaultProcessingEfficiencyWeight:
        0.15,

    defaultSettlementReliabilityWeight:
        0.15,

    defaultReconciliationRateWeight:
        0.15,

    defaultSlaComplianceWeight:
        0.15,

    defaultDataQualityWeight:
        0.10,

    defaultUtilizationWeight:
        0.10
});

/**
 * ============================================================================
 * KPI Definitions
 * ============================================================================
 *
 * Higher/lower direction is critical because operational metrics have
 * different optimization directions.
 */

const KPI_DEFINITIONS = Object.freeze({

    repairRate: {

        direction:
            DIRECTION.LOWER_IS_BETTER,

        unit:
            'percent',

        label:
            'Repair Rate'
    },

    resolutionRate: {

        direction:
            DIRECTION.HIGHER_IS_BETTER,

        unit:
            'percent',

        label:
            'Resolution Rate'
    },

    processingEfficiency: {

        direction:
            DIRECTION.HIGHER_IS_BETTER,

        unit:
            'percent',

        label:
            'Processing Efficiency'
    },

    settlementReliability: {

        direction:
            DIRECTION.HIGHER_IS_BETTER,

        unit:
            'percent',

        label:
            'Settlement Reliability'
    },

    reconciliationRate: {

        direction:
            DIRECTION.HIGHER_IS_BETTER,

        unit:
            'percent',

        label:
            'Reconciliation Rate'
    },

    slaCompliance: {

        direction:
            DIRECTION.HIGHER_IS_BETTER,

        unit:
            'percent',

        label:
            'SLA Compliance'
    },

    dataQuality: {

        direction:
            DIRECTION.HIGHER_IS_BETTER,

        unit:
            'percent',

        label:
            'Data Quality'
    },

    utilization: {

        direction:
            DIRECTION.TARGET,

        unit:
            'percent',

        label:
            'Capacity Utilization',

        target:
            80,

        tolerance:
            10
    },

    averageRepairTime: {

        direction:
            DIRECTION.LOWER_IS_BETTER,

        unit:
            'minutes',

        label:
            'Average Repair Time'
    },

    averageProcessingTime: {

        direction:
            DIRECTION.LOWER_IS_BETTER,

        unit:
            'minutes',

        label:
            'Average Processing Time'
    },

    backlog: {

        direction:
            DIRECTION.LOWER_IS_BETTER,

        unit:
            'units',

        label:
            'Operational Backlog'
    },

    throughput: {

        direction:
            DIRECTION.HIGHER_IS_BETTER,

        unit:
            'units',

        label:
            'Operational Throughput'
    }
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

        return value.map(
            clone
        );
    }

    if (isObject(value)) {

        const result = {};

        Object.keys(value)
            .forEach(
                key => {
                    result[key] =
                        clone(value[key]);
                }
            );

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

    const result =
        String(value).trim();

    return result.length > 0
        ? result
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
        ) /
        factor
    );
}

function mean(values) {

    if (
        !Array.isArray(values) ||
        values.length === 0
    ) {
        return null;
    }

    return (
        values.reduce(
            (
                sum,
                value
            ) =>
                sum + value,
            0
        ) /
        values.length
    );
}

function median(values) {

    if (
        !Array.isArray(values) ||
        values.length === 0
    ) {
        return null;
    }

    const sorted =
        values
            .slice()
            .sort(
                (a, b) =>
                    a - b
            );

    const middle =
        Math.floor(
            sorted.length / 2
        );

    if (
        sorted.length % 2 === 0
    ) {

        return (
            sorted[middle - 1] +
            sorted[middle]
        ) / 2;
    }

    return sorted[middle];
}

function standardDeviation(
    values
) {

    if (
        !Array.isArray(values) ||
        values.length < 2
    ) {
        return 0;
    }

    const average =
        mean(values);

    const variance =
        values.reduce(
            (
                sum,
                value
            ) =>
                sum +
                (
                    value -
                    average
                ) ** 2,
            0
        ) /
        values.length;

    return Math.sqrt(
        variance
    );
}

function percentile(
    values,
    target
) {

    if (
        !Array.isArray(values) ||
        values.length === 0
    ) {
        return null;
    }

    const sorted =
        values
            .slice()
            .sort(
                (a, b) =>
                    a - b
            );

    const rank =
        (
            clamp(
                target,
                0,
                100
            ) /
            100
        ) *
        (
            sorted.length - 1
        );

    const lower =
        Math.floor(rank);

    const upper =
        Math.ceil(rank);

    if (
        lower === upper
    ) {
        return sorted[lower];
    }

    const weight =
        rank - lower;

    return (
        sorted[lower] +
        (
            sorted[upper] -
            sorted[lower]
        ) *
        weight
    );
}

function rankPercentile(
    values,
    value
) {

    if (
        !Array.isArray(values) ||
        values.length === 0 ||
        value === null
    ) {
        return null;
    }

    const valid =
        values.filter(
            item =>
                Number.isFinite(item)
        );

    if (
        valid.length === 0
    ) {
        return null;
    }

    const belowOrEqual =
        valid.filter(
            item =>
                item <= value
        ).length;

    return round(
        (
            belowOrEqual /
            valid.length
        ) *
        100,
        4
    );
}

function stableSerialize(value) {

    if (
        value === null
    ) {
        return 'null';
    }

    if (
        value === undefined
    ) {
        return 'undefined';
    }

    if (
        value instanceof Date
    ) {
        return JSON.stringify(
            value.toISOString()
        );
    }

    if (
        Array.isArray(value)
    ) {

        return `[${value
            .map(
                stableSerialize
            )
            .join(',')}]`;
    }

    if (
        isObject(value)
    ) {

        return `{${Object.keys(value)
            .sort()
            .map(
                key =>
                    `${JSON.stringify(key)}:${stableSerialize(value[key])}`
            )
            .join(',')}}`;
    }

    return JSON.stringify(
        value
    );
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
 * OperationalBenchmarkService
 * ============================================================================
 */

class OperationalBenchmarkService {

    constructor(
        options = {}
    ) {

        if (
            !isObject(options)
        ) {
            throw new TypeError(
                'OperationalBenchmarkService options must be an object.'
            );
        }

        this.options = {

            ...DEFAULTS,

            ...clone(options),

            weights:
                {
                    ...this._defaultWeights(),

                    ...(
                        isObject(
                            options.weights
                        )
                            ? clone(
                                options.weights
                            )
                            : {}
                    )
                }
        };

        this.model =
            MODEL_NAME;

        this.schemaVersion =
            SCHEMA_VERSION;
    }

    /**
     * =========================================================================
     * Public benchmark API
     * =========================================================================
     */

    benchmark(
        input = {}
    ) {

        const startedAt =
            Date.now();

        const context =
            this._normalizeInput(
                input
            );

        const dataQuality =
            this.calculateDataQuality(
                context
            );

        if (
            dataQuality.status ===
            'INSUFFICIENT_DATA'
        ) {

            return this._buildInsufficientResult(
                context,
                dataQuality,
                startedAt
            );
        }

        const current =
            context.current;

        const peers =
            context.peers;

        const historical =
            context.historical;

        const peerBenchmark =
            this.benchmarkAgainstPeers(
                current,
                peers
            );

        const historicalBenchmark =
            this.benchmarkAgainstHistory(
                current,
                historical
            );

        const targetBenchmark =
            this.benchmarkAgainstTargets(
                current,
                context.targets
            );

        const combined =
            this.combineBenchmarks({
                current,
                peerBenchmark,
                historicalBenchmark,
                targetBenchmark
            });

        const outliers =
            this.detectOutliers(
                current,
                peers
            );

        const recommendations =
            this.generateRecommendations({
                current,
                peerBenchmark,
                historicalBenchmark,
                targetBenchmark,
                combined,
                outliers,
                dataQuality
            });

        const result = {

            model:
                this.model,

            schemaVersion:
                this.schemaVersion,

            benchmarkId:
                this._generateBenchmarkId(),

            tenantId:
                context.tenantId,

            organizationId:
                context.organizationId,

            branchId:
                context.branchId,

            branchName:
                context.branchName,

            period:
                context.period,

            benchmarkType:
                BENCHMARK_TYPE.COMBINED,

            current:
                clone(current),

            peerBenchmark,

            historicalBenchmark,

            targetBenchmark,

            combined,

            outliers,

            dataQuality,

            recommendations,

            generatedAt:
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

    _normalizeInput(
        input
    ) {

        const source =
            isObject(input)
                ? input
                : {};

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

            period:
                this._normalizePeriod(
                    source.period
                ),

            current:
                this.normalizeMetrics(
                    source.current ||
                    source.metrics ||
                    {}
                ),

            peers:
                this._normalizeRecords(
                    source.peers ||
                    source.peerBranches ||
                    []
                ),

            historical:
                this._normalizeRecords(
                    source.historical ||
                    source.history ||
                    []
                ),

            targets:
                this.normalizeMetrics(
                    source.targets ||
                    {}
                ),

            metadata:
                isObject(
                    source.metadata
                )
                    ? clone(
                        source.metadata
                    )
                    : {}
        };
    }

    _normalizeRecords(
        records
    ) {

        if (
            !Array.isArray(records)
        ) {
            return [];
        }

        return records
            .slice(
                0,
                this.options.maximumRecords
            )
            .map(
                record =>
                    this.normalizeMetrics(
                        record
                    )
            );
    }

    _normalizePeriod(
        period
    ) {

        if (
            !isObject(period)
        ) {
            return {};
        }

        return {

            start:
                period.start
                    ? new Date(
                        period.start
                    )
                    : null,

            end:
                period.end
                    ? new Date(
                        period.end
                    )
                    : null,

            label:
                normalizeString(
                    period.label
                ),

            timezone:
                normalizeString(
                    period.timezone
                )
        };
    }

    /**
     * =========================================================================
     * Metric normalization
     * =========================================================================
     */

    normalizeMetrics(
        input = {}
    ) {

        const source =
            isObject(input)
                ? input
                : {};

        return {

            entityId:
                normalizeString(
                    source.entityId ??
                    source.branchId ??
                    source.id
                ),

            entityName:
                normalizeString(
                    source.entityName ??
                    source.branchName ??
                    source.name
                ),

            repairRate:
                this._normalizePercent(
                    source.repairRate
                ),

            resolutionRate:
                this._normalizePercent(
                    source.resolutionRate
                ),

            processingEfficiency:
                this._normalizePercent(
                    source.processingEfficiency
                ),

            settlementReliability:
                this._normalizePercent(
                    source.settlementReliability
                ),

            reconciliationRate:
                this._normalizePercent(
                    source.reconciliationRate
                ),

            slaCompliance:
                this._normalizePercent(
                    source.slaCompliance
                ),

            dataQuality:
                this._normalizePercent(
                    source.dataQuality
                ),

            utilization:
                this._normalizePercent(
                    source.utilization
                ),

            averageRepairTime:
                toNumber(
                    source.averageRepairTime ??
                    source.avgRepairTime
                ),

            averageProcessingTime:
                toNumber(
                    source.averageProcessingTime ??
                    source.avgProcessingTime
                ),

            backlog:
                toNumber(
                    source.backlog ??
                    source.backlogUnits
                ),

            throughput:
                toNumber(
                    source.throughput ??
                    source.processedUnits
                ),

            totalTransactions:
                toNumber(
                    source.totalTransactions ??
                    source.transactionCount
                ),

            totalRepairs:
                toNumber(
                    source.totalRepairs ??
                    source.repairCount
                ),

            totalSettlements:
                toNumber(
                    source.totalSettlements ??
                    source.settlementCount
                ),

            totalReconciliations:
                toNumber(
                    source.totalReconciliations ??
                    source.reconciliationCount
                ),

            period:
                source.period
                    ? clone(
                        source.period
                    )
                    : null,

            metadata:
                isObject(
                    source.metadata
                )
                    ? clone(
                        source.metadata
                    )
                    : {}
        };
    }

    _normalizePercent(
        value
    ) {

        const number =
            toNumber(value);

        if (
            number === null
        ) {
            return null;
        }

        /*
         * Supports both:
         *
         *   0.95
         *   95
         *
         * for ratios that are clearly supplied in decimal form.
         */

        if (
            number >= 0 &&
            number <= 1
        ) {

            return round(
                number * 100,
                4
            );
        }

        return clamp(
            number,
            0,
            100
        );
    }

    /**
     * =========================================================================
     * Data quality
     * =========================================================================
     */

    calculateDataQuality(
        context
    ) {

        const current =
            context.current;

        const peerCount =
            context.peers.length;

        const historicalCount =
            context.historical.length;

        const requiredMetrics =
            Object.keys(
                KPI_DEFINITIONS
            );

        const availableMetrics =
            requiredMetrics.filter(
                key =>
                    toNumber(
                        current[key]
                    ) !== null
            );

        const coverage =
            requiredMetrics.length > 0
                ? (
                    availableMetrics.length /
                    requiredMetrics.length
                ) * 100
                : 0;

        let score =
            coverage * 0.60;

        if (
            peerCount >=
            this.options.minimumPeerSampleSize
        ) {
            score += 20;
        } else if (
            peerCount > 0
        ) {
            score += 10;
        }

        if (
            historicalCount >=
            this.options.minimumHistoricalSampleSize
        ) {
            score += 20;
        } else if (
            historicalCount > 0
        ) {
            score += 10;
        }

        const status =
            availableMetrics.length === 0
                ? 'INSUFFICIENT_DATA'
                : score < 40
                    ? 'LOW'
                    : score < 70
                        ? 'MODERATE'
                        : 'HEALTHY';

        return {

            status,

            score:
                round(
                    clamp(
                        score,
                        0,
                        100
                    ),
                    2
                ),

            metricCoverage:
                round(
                    coverage,
                    2
                ),

            availableMetrics,

            missingMetrics:
                requiredMetrics.filter(
                    key =>
                        !availableMetrics.includes(
                            key
                        )
                ),

            peerSampleSize:
                peerCount,

            historicalSampleSize:
                historicalCount
        };
    }

    _buildInsufficientResult(
        context,
        dataQuality,
        startedAt
    ) {

        const result = {

            model:
                this.model,

            schemaVersion:
                this.schemaVersion,

            benchmarkId:
                this._generateBenchmarkId(),

            tenantId:
                context.tenantId,

            organizationId:
                context.organizationId,

            branchId:
                context.branchId,

            branchName:
                context.branchName,

            benchmarkType:
                BENCHMARK_TYPE.COMBINED,

            status:
                'INSUFFICIENT_DATA',

            dataQuality,

            peerBenchmark:
                null,

            historicalBenchmark:
                null,

            targetBenchmark:
                null,

            combined:
                null,

            outliers: [],

            recommendations: [

                {

                    priority:
                        1,

                    severity:
                        'HIGH',

                    category:
                        'DATA_QUALITY',

                    action:
                        'Collect additional operational benchmark data before making performance decisions.',

                    rationale:
                        'The current metric sample is insufficient for reliable benchmarking.'
                }
            ],

            generatedAt:
                new Date(),

            durationMs:
                Date.now() -
                startedAt
        };

        result.fingerprint =
            this.generateFingerprint(
                result
            );

        return result;
    }

    /**
     * =========================================================================
     * Peer benchmarking
     * =========================================================================
     */

    benchmarkAgainstPeers(
        current,
        peers = []
    ) {

        if (
            !Array.isArray(peers) ||
            peers.length === 0
        ) {

            return {

                benchmarkType:
                    BENCHMARK_TYPE.PEER,

                status:
                    'NO_PEERS',

                sampleSize:
                    0,

                metrics: {},

                score:
                    null,

                confidence:
                    0
            };
        }

        const metrics = {};

        Object.keys(
            KPI_DEFINITIONS
        ).forEach(
            metric => {

                metrics[metric] =
                    this._benchmarkMetric(
                        metric,
                        current[metric],
                        peers
                            .map(
                                peer =>
                                    peer[metric]
                            )
                            .filter(
                                value =>
                                    toNumber(
                                        value
                                    ) !== null
                            )
                    );
            }
        );

        const score =
            this._aggregateBenchmarkScore(
                metrics
            );

        return {

            benchmarkType:
                BENCHMARK_TYPE.PEER,

            status:
                peers.length >=
                this.options.minimumPeerSampleSize
                    ? 'VALID'
                    : 'LIMITED_SAMPLE',

            sampleSize:
                peers.length,

            metrics,

            score,

            confidence:
                this._benchmarkConfidence(
                    peers.length,
                    metrics
                )
        };
    }

    /**
     * =========================================================================
     * Historical benchmarking
     * =========================================================================
     */

    benchmarkAgainstHistory(
        current,
        historical = []
    ) {

        if (
            !Array.isArray(historical) ||
            historical.length === 0
        ) {

            return {

                benchmarkType:
                    BENCHMARK_TYPE.HISTORICAL,

                status:
                    'NO_HISTORY',

                sampleSize:
                    0,

                metrics: {},

                score:
                    null,

                confidence:
                    0
            };
        }

        const metrics = {};

        Object.keys(
            KPI_DEFINITIONS
        ).forEach(
            metric => {

                const historicalValues =
                    historical
                        .map(
                            period =>
                                period[metric]
                        )
                        .filter(
                            value =>
                                toNumber(
                                    value
                                ) !== null
                        );

                const currentValue =
                    toNumber(
                        current[metric]
                    );

                metrics[metric] =
                    this._benchmarkAgainstBaseline(
                        metric,
                        currentValue,
                        historicalValues
                    );
            }
        );

        const score =
            this._aggregateBenchmarkScore(
                metrics
            );

        return {

            benchmarkType:
                BENCHMARK_TYPE.HISTORICAL,

            status:
                historical.length >=
                this.options.minimumHistoricalSampleSize
                    ? 'VALID'
                    : 'LIMITED_SAMPLE',

            sampleSize:
                historical.length,

            metrics,

            score,

            confidence:
                this._benchmarkConfidence(
                    historical.length,
                    metrics
                )
        };
    }

    /**
     * =========================================================================
     * Target benchmarking
     * =========================================================================
     */

    benchmarkAgainstTargets(
        current,
        targets = {}
    ) {

        const metrics = {};

        Object.keys(
            KPI_DEFINITIONS
        ).forEach(
            metric => {

                const currentValue =
                    toNumber(
                        current[metric]
                    );

                const targetValue =
                    toNumber(
                        targets[metric] ??
                        KPI_DEFINITIONS[
                            metric
                        ].target
                    );

                if (
                    currentValue === null ||
                    targetValue === null
                ) {

                    metrics[metric] = {

                        available:
                            false,

                        current:
                            currentValue,

                        target:
                            targetValue
                    };

                    return;
                }

                metrics[metric] =
                    this._benchmarkAgainstTarget(
                        metric,
                        currentValue,
                        targetValue
                    );
            }
        );

        const score =
            this._aggregateTargetScore(
                metrics
            );

        return {

            benchmarkType:
                BENCHMARK_TYPE.TARGET,

            status:
                Object.keys(
                    metrics
                ).length > 0
                    ? 'VALID'
                    : 'NO_TARGETS',

            metrics,

            score,

            confidence:
                this._targetConfidence(
                    metrics
                )
        };
    }

    /**
     * =========================================================================
     * Metric benchmark
     * =========================================================================
     */

    _benchmarkMetric(
        metric,
        currentValue,
        peerValues
    ) {

        const value =
            toNumber(
                currentValue
            );

        const values =
            peerValues
                .map(
                    toNumber
                )
                .filter(
                    item =>
                        item !== null
                );

        if (
            value === null ||
            values.length === 0
        ) {

            return {

                available:
                    false,

                current:
                    value,

                sampleSize:
                    values.length
            };
        }

        const average =
            mean(values);

        const medianValue =
            median(values);

        const minimum =
            Math.min(
                ...values
            );

        const maximum =
            Math.max(
                ...values
            );

        const stdDev =
            standardDeviation(
                values
            );

        const direction =
            KPI_DEFINITIONS[
                metric
            ].direction;

        const rawDifference =
            value -
            average;

        const performanceDifference =
            this._directionalDifference(
                direction,
                value,
                average
            );

        const peerPercentile =
            rankPercentile(
                values,
                value
            );

        const zScore =
            stdDev > 0
                ? (
                    value -
                    average
                ) /
                stdDev
                : 0;

        const performancePercentile =
            this._performancePercentile(
                metric,
                value,
                values
            );

        return {

            available:
                true,

            current:
                round(
                    value,
                    4
                ),

            average:
                round(
                    average,
                    4
                ),

            median:
                round(
                    medianValue,
                    4
                ),

            minimum:
                round(
                    minimum,
                    4
                ),

            maximum:
                round(
                    maximum,
                    4
                ),

            standardDeviation:
                round(
                    stdDev,
                    4
                ),

            rawDifference:
                round(
                    rawDifference,
                    4
                ),

            performanceDifference:
                round(
                    performanceDifference,
                    4
                ),

            peerPercentile,

            performancePercentile,

            zScore:
                round(
                    zScore,
                    4
                ),

            direction,

            performanceLevel:
                this.classifyPercentile(
                    performancePercentile
                ),

            outlier:
                Math.abs(
                    zScore
                ) >=
                this.options.zScoreThreshold,

            severeOutlier:
                Math.abs(
                    zScore
                ) >=
                this.options.criticalZScoreThreshold
        };
    }

    _benchmarkAgainstBaseline(
        metric,
        currentValue,
        values
    ) {

        if (
            currentValue === null ||
            values.length === 0
        ) {

            return {

                available:
                    false,

                current:
                    currentValue,

                sampleSize:
                    values.length
            };
        }

        const average =
            mean(values);

        const medianValue =
            median(values);

        const direction =
            KPI_DEFINITIONS[
                metric
            ].direction;

        const change =
            currentValue -
            average;

        const directionalChange =
            this._directionalDifference(
                direction,
                currentValue,
                average
            );

        const changePercent =
            average !== 0
                ? (
                    change /
                    Math.abs(
                        average
                    )
                ) * 100
                : null;

        const performanceScore =
            this._directionalPerformanceScore(
                direction,
                currentValue,
                average
            );

        return {

            available:
                true,

            current:
                round(
                    currentValue,
                    4
                ),

            historicalAverage:
                round(
                    average,
                    4
                ),

            historicalMedian:
                round(
                    medianValue,
                    4
                ),

            change:
                round(
                    change,
                    4
                ),

            changePercent:
                changePercent === null
                    ? null
                    : round(
                        changePercent,
                        4
                    ),

            directionalChange:
                round(
                    directionalChange,
                    4
                ),

            performanceScore:
                round(
                    performanceScore,
                    2
                ),

            direction,

            improving:
                directionalChange > 0,

            declining:
                directionalChange < 0
        };
    }

    _benchmarkAgainstTarget(
        metric,
        currentValue,
        targetValue
    ) {

        const definition =
            KPI_DEFINITIONS[
                metric
            ];

        const direction =
            definition.direction;

        const tolerance =
            toNumber(
                definition.tolerance,
                0
            );

        let score;

        let status;

        if (
            direction ===
            DIRECTION.HIGHER_IS_BETTER
        ) {

            score =
                targetValue > 0
                    ? (
                        currentValue /
                        targetValue
                    ) * 100
                    : currentValue >=
                        targetValue
                        ? 100
                        : 0;

            status =
                currentValue >= targetValue
                    ? 'MEETING_TARGET'
                    : 'BELOW_TARGET';

        } else if (
            direction ===
            DIRECTION.LOWER_IS_BETTER
        ) {

            score =
                currentValue <= targetValue
                    ? 100
                    : (
                        targetValue /
                        currentValue
                    ) * 100;

            status =
                currentValue <= targetValue
                    ? 'MEETING_TARGET'
                    : 'ABOVE_TARGET';

        } else {

            const deviation =
                Math.abs(
                    currentValue -
                    targetValue
                );

            score =
                deviation <= tolerance
                    ? 100
                    : Math.max(
                        0,
                        100 -
                        (
                            (
                                deviation -
                                tolerance
                            ) /
                            Math.max(
                                targetValue,
                                1
                            )
                        ) *
                        100
                    );

            status =
                deviation <= tolerance
                    ? 'WITHIN_TARGET_BAND'
                    : 'OUTSIDE_TARGET_BAND';
        }

        return {

            available:
                true,

            current:
                round(
                    currentValue,
                    4
                ),

            target:
                round(
                    targetValue,
                    4
                ),

            variance:
                round(
                    currentValue -
                    targetValue,
                    4
                ),

            score:
                round(
                    clamp(
                        score,
                        0,
                        100
                    ),
                    2
                ),

            status,

            direction,

            tolerance
        };
    }

    /**
     * =========================================================================
     * Directional calculations
     * =========================================================================
     */

    _directionalDifference(
        direction,
        current,
        baseline
    ) {

        if (
            direction ===
            DIRECTION.LOWER_IS_BETTER
        ) {
            return baseline - current;
        }

        if (
            direction ===
            DIRECTION.TARGET
        ) {

            const target =
                KPI_DEFINITIONS
                    .utilization
                    .target;

            return (
                Math.abs(
                    current -
                    target
                ) <=
                Math.abs(
                    baseline -
                    target
                )
            )
                ? 1
                : -1;
        }

        return current - baseline;
    }

    _directionalPerformanceScore(
        direction,
        current,
        baseline
    ) {

        if (
            baseline === 0
        ) {
            return current >= 0
                ? 100
                : 0;
        }

        let score;

        if (
            direction ===
            DIRECTION.LOWER_IS_BETTER
        ) {

            score =
                (
                    baseline /
                    Math.max(
                        current,
                        Number.EPSILON
                    )
                ) * 100;

        } else if (
            direction ===
            DIRECTION.TARGET
        ) {

            const target =
                KPI_DEFINITIONS
                    .utilization
                    .target;

            const currentDistance =
                Math.abs(
                    current -
                    target
                );

            const baselineDistance =
                Math.abs(
                    baseline -
                    target
                );

            score =
                baselineDistance === 0
                    ? 100
                    : (
                        1 -
                        (
                            currentDistance /
                            baselineDistance
                        )
                    ) * 100;

        } else {

            score =
                (
                    current /
                    baseline
                ) * 100;
        }

        return clamp(
            score,
            0,
            200
        );
    }

    _performancePercentile(
        metric,
        current,
        values
    ) {

        const direction =
            KPI_DEFINITIONS[
                metric
            ].direction;

        if (
            direction ===
            DIRECTION.LOWER_IS_BETTER
        ) {

            const inverted =
                values.map(
                    value =>
                        -value
                );

            return rankPercentile(
                inverted,
                -current
            );
        }

        if (
            direction ===
            DIRECTION.TARGET
        ) {

            const target =
                KPI_DEFINITIONS[
                    metric
                ].target;

            const distances =
                values.map(
                    value =>
                        Math.abs(
                            value -
                            target
                        )
                );

            const currentDistance =
                Math.abs(
                    current -
                    target
                );

            return rankPercentile(
                distances.map(
                    distance =>
                        -distance
                ),
                -currentDistance
            );
        }

        return rankPercentile(
            values,
            current
        );
    }

    /**
     * =========================================================================
     * Score aggregation
     * =========================================================================
     */

    _aggregateBenchmarkScore(
        metrics
    ) {

        let weightedScore = 0;

        let totalWeight = 0;

        Object.keys(
            metrics
        ).forEach(
            metric => {

                const result =
                    metrics[metric];

                if (
                    !result ||
                    !result.available
                ) {
                    return;
                }

                const score =
                    toNumber(
                        result.performancePercentile ??
                        result.performanceScore
                    );

                if (
                    score === null
                ) {
                    return;
                }

                const weight =
                    toNumber(
                        this.options
                            .weights[
                                metric
                            ],
                        0
                    );

                weightedScore +=
                    (
                        score *
                        weight
                    );

                totalWeight +=
                    weight;
            }
        );

        if (
            totalWeight === 0
        ) {
            return null;
        }

        return {

            score:
                round(
                    weightedScore /
                    totalWeight,
                    2
                ),

            level:
                this.classifyPercentile(
                    weightedScore /
                    totalWeight
                ),

            weightCoverage:
                round(
                    totalWeight /
                    this._totalConfiguredWeight() *
                    100,
                    2
                )
        };
    }

    _aggregateTargetScore(
        metrics
    ) {

        const values =
            Object.values(
                metrics
            )
                .map(
                    metric =>
                        toNumber(
                            metric.score
                        )
                )
                .filter(
                    value =>
                        value !== null
                );

        if (
            values.length === 0
        ) {
            return null;
        }

        const score =
            mean(values);

        return {

            score:
                round(
                    score,
                    2
                ),

            level:
                this.classifyPercentile(
                    score
                ),

            metricCount:
                values.length
        };
    }

    _benchmarkConfidence(
        sampleSize,
        metrics
    ) {

        const metricCount =
            Object.values(
                metrics
            )
                .filter(
                    metric =>
                        metric &&
                        metric.available
                )
                .length;

        const metricCoverage =
            Object.keys(
                KPI_DEFINITIONS
            ).length > 0
                ? (
                    metricCount /
                    Object.keys(
                        KPI_DEFINITIONS
                    ).length
                ) * 100
                : 0;

        let sampleScore;

        if (
            sampleSize >= 30
        ) {
            sampleScore = 100;
        } else if (
            sampleSize >= 15
        ) {
            sampleScore = 90;
        } else if (
            sampleSize >= 10
        ) {
            sampleScore = 80;
        } else if (
            sampleSize >= 5
        ) {
            sampleScore = 65;
        } else if (
            sampleSize >= 3
        ) {
            sampleScore = 50;
        } else {
            sampleScore = 25;
        }

        return round(
            (
                sampleScore * 0.60
            ) +
            (
                metricCoverage * 0.40
            ),
            2
        );
    }

    _targetConfidence(
        metrics
    ) {

        const available =
            Object.values(
                metrics
            )
                .filter(
                    metric =>
                        metric &&
                        metric.available
                ).length;

        const total =
            Object.keys(
                KPI_DEFINITIONS
            ).length;

        if (
            total === 0
        ) {
            return 0;
        }

        return round(
            (
                available /
                total
            ) * 100,
            2
        );
    }

    _totalConfiguredWeight() {

        return Object.values(
            this.options.weights
        )
            .reduce(
                (
                    sum,
                    weight
                ) =>
                    sum +
                    toNumber(
                        weight,
                        0
                    ),
                0
            );
    }

    _defaultWeights() {

        return {

            repairRate:
                this.options?.defaultRepairRateWeight ??
                DEFAULTS.defaultRepairRateWeight,

            resolutionRate:
                this.options?.defaultResolutionRateWeight ??
                DEFAULTS.defaultResolutionRateWeight,

            processingEfficiency:
                this.options?.defaultProcessingEfficiencyWeight ??
                DEFAULTS.defaultProcessingEfficiencyWeight,

            settlementReliability:
                this.options?.defaultSettlementReliabilityWeight ??
                DEFAULTS.defaultSettlementReliabilityWeight,

            reconciliationRate:
                this.options?.defaultReconciliationRateWeight ??
                DEFAULTS.defaultReconciliationRateWeight,

            slaCompliance:
                this.options?.defaultSlaComplianceWeight ??
                DEFAULTS.defaultSlaComplianceWeight,

            dataQuality:
                this.options?.defaultDataQualityWeight ??
                DEFAULTS.defaultDataQualityWeight,

            utilization:
                this.options?.defaultUtilizationWeight ??
                DEFAULTS.defaultUtilizationWeight
        };
    }

    /**
     * =========================================================================
     * Percentile classification
     * =========================================================================
     */

    classifyPercentile(
        value
    ) {

        const percentileValue =
            toNumber(
                value
            );

        if (
            percentileValue === null
        ) {
            return PERFORMANCE_LEVEL.UNKNOWN;
        }

        if (
            percentileValue >=
            this.options.exceptionalPercentile
        ) {
            return PERFORMANCE_LEVEL.EXCEPTIONAL;
        }

        if (
            percentileValue >=
            this.options.strongPercentile
        ) {
            return PERFORMANCE_LEVEL.STRONG;
        }

        if (
            percentileValue >=
            this.options.healthyPercentile
        ) {
            return PERFORMANCE_LEVEL.HEALTHY;
        }

        if (
            percentileValue >=
            this.options.watchPercentile
        ) {
            return PERFORMANCE_LEVEL.WATCH;
        }

        if (
            percentileValue >=
            this.options.underperformingPercentile
        ) {
            return PERFORMANCE_LEVEL.UNDERPERFORMING;
        }

        return PERFORMANCE_LEVEL.CRITICAL;
    }

    /**
     * =========================================================================
     * Combined benchmarking
     * =========================================================================
     */

    combineBenchmarks(
        input
    ) {

        const peerScore =
            toNumber(
                input.peerBenchmark
                    ?.score
                    ?.score
            );

        const historicalScore =
            toNumber(
                input.historicalBenchmark
                    ?.score
                    ?.score
            );

        const targetScore =
            toNumber(
                input.targetBenchmark
                    ?.score
                    ?.score
            );

        const scores = [];

        if (
            peerScore !== null
        ) {
            scores.push({
                type:
                    BENCHMARK_TYPE.PEER,
                score:
                    peerScore,
                weight:
                    0.40
            });
        }

        if (
            historicalScore !== null
        ) {
            scores.push({
                type:
                    BENCHMARK_TYPE.HISTORICAL,
                score:
                    historicalScore,
                weight:
                    0.30
            });
        }

        if (
            targetScore !== null
        ) {
            scores.push({
                type:
                    BENCHMARK_TYPE.TARGET,
                score:
                    targetScore,
                weight:
                    0.30
            });
        }

        if (
            scores.length === 0
        ) {

            return {

                score:
                    null,

                level:
                    PERFORMANCE_LEVEL.UNKNOWN,

                confidence:
                    0,

                components: []
            };
        }

        const totalWeight =
            scores.reduce(
                (
                    sum,
                    item
                ) =>
                    sum +
                    item.weight,
                0
            );

        const weightedScore =
            scores.reduce(
                (
                    sum,
                    item
                ) =>
                    sum +
                    (
                        item.score *
                        item.weight
                    ),
                0
            ) /
            totalWeight;

        const confidence =
            this._combinedConfidence(
                input,
                scores
            );

        return {

            score:
                round(
                    weightedScore,
                    2
                ),

            level:
                this.classifyPercentile(
                    weightedScore
                ),

            confidence,

            components:
                scores.map(
                    item => ({
                        type:
                            item.type,

                        score:
                            round(
                                item.score,
                                2
                            ),

                        weight:
                            item.weight
                    })
                )
        };
    }

    _combinedConfidence(
        input,
        scores
    ) {

        const confidences = [];

        if (
            input.peerBenchmark
        ) {
            const value =
                toNumber(
                    input.peerBenchmark
                        .confidence
                );

            if (
                value !== null
            ) {
                confidences.push(
                    value
                );
            }
        }

        if (
            input.historicalBenchmark
        ) {
            const value =
                toNumber(
                    input.historicalBenchmark
                        .confidence
                );

            if (
                value !== null
            ) {
                confidences.push(
                    value
                );
            }
        }

        if (
            input.targetBenchmark
        ) {
            const value =
                toNumber(
                    input.targetBenchmark
                        .confidence
                );

            if (
                value !== null
            ) {
                confidences.push(
                    value
                );
            }
        }

        if (
            confidences.length === 0
        ) {
            return 0;
        }

        return round(
            mean(
                confidences
            ),
            2
        );
    }

    /**
     * =========================================================================
     * Outlier detection
     * =========================================================================
     */

    detectOutliers(
        current,
        peers = []
    ) {

        const outliers = [];

        Object.keys(
            KPI_DEFINITIONS
        ).forEach(
            metric => {

                const currentValue =
                    toNumber(
                        current[metric]
                    );

                if (
                    currentValue === null
                ) {
                    return;
                }

                const values =
                    peers
                        .map(
                            peer =>
                                toNumber(
                                    peer[metric]
                                )
                        )
                        .filter(
                            value =>
                                value !== null
                        );

                if (
                    values.length <
                    this.options.minimumPeerSampleSize
                ) {
                    return;
                }

                const average =
                    mean(values);

                const stdDev =
                    standardDeviation(
                        values
                    );

                if (
                    stdDev === 0
                ) {
                    return;
                }

                const zScore =
                    (
                        currentValue -
                        average
                    ) /
                    stdDev;

                if (
                    Math.abs(
                        zScore
                    ) <
                    this.options.zScoreThreshold
                ) {
                    return;
                }

                const direction =
                    KPI_DEFINITIONS[
                        metric
                    ].direction;

                const operationallyBad =
                    this._isOperationallyBadOutlier(
                        direction,
                        currentValue,
                        average
                    );

                outliers.push({

                    metric,

                    label:
                        KPI_DEFINITIONS[
                            metric
                        ].label,

                    current:
                        round(
                            currentValue,
                            4
                        ),

                    peerAverage:
                        round(
                            average,
                            4
                        ),

                    zScore:
                        round(
                            zScore,
                            4
                        ),

                    severity:
                        Math.abs(
                            zScore
                        ) >=
                        this.options.criticalZScoreThreshold
                            ? RISK_LEVEL.CRITICAL
                            : RISK_LEVEL.HIGH,

                    operationallyBad,

                    direction
                });
            }
        );

        return outliers
            .sort(
                (a, b) =>
                    Math.abs(
                        b.zScore
                    ) -
                    Math.abs(
                        a.zScore
                    )
            )
            .slice(
                0,
                this.options.maximumOutliers
            );
    }

    _isOperationallyBadOutlier(
        direction,
        current,
        average
    ) {

        if (
            direction ===
            DIRECTION.LOWER_IS_BETTER
        ) {
            return current > average;
        }

        if (
            direction ===
            DIRECTION.HIGHER_IS_BETTER
        ) {
            return current < average;
        }

        if (
            direction ===
            DIRECTION.TARGET
        ) {

            const target =
                KPI_DEFINITIONS
                    .utilization
                    .target;

            return (
                Math.abs(
                    current -
                    target
                ) >
                Math.abs(
                    average -
                    target
                )
            );
        }

        return false;
    }

    /**
     * =========================================================================
     * Recommendations
     * =========================================================================
     */

    generateRecommendations(
        input
    ) {

        const recommendations = [];

        const combinedScore =
            toNumber(
                input.combined
                    ?.score
            );

        if (
            combinedScore !== null &&
            combinedScore < 35
        ) {

            recommendations.push({

                priority:
                    1,

                severity:
                    RISK_LEVEL.CRITICAL,

                category:
                    'PERFORMANCE_RECOVERY',

                action:
                    'Initiate an operational performance recovery plan.',

                rationale:
                    `Combined benchmark score is ${round(combinedScore, 2)}.`
            });
        }

        const peerMetrics =
            input.peerBenchmark
                ?.metrics ||
            {};

        Object.keys(
            peerMetrics
        ).forEach(
            metric => {

                const benchmark =
                    peerMetrics[metric];

                if (
                    !benchmark ||
                    !benchmark.available
                ) {
                    return;
                }

                const level =
                    benchmark.performanceLevel;

                if (
                    level !==
                        PERFORMANCE_LEVEL.CRITICAL &&
                    level !==
                        PERFORMANCE_LEVEL.UNDERPERFORMING
                ) {
                    return;
                }

                const definition =
                    KPI_DEFINITIONS[
                        metric
                    ];

                const direction =
                    definition.direction;

                let action;

                if (
                    direction ===
                    DIRECTION.LOWER_IS_BETTER
                ) {

                    action =
                        `Reduce ${definition.label.toLowerCase()} through root-cause analysis, workflow optimization and targeted repair prevention.`;

                } else if (
                    direction ===
                    DIRECTION.HIGHER_IS_BETTER
                ) {

                    action =
                        `Improve ${definition.label.toLowerCase()} through process controls, exception reduction and capacity optimization.`;

                } else {

                    action =
                        `Bring ${definition.label.toLowerCase()} closer to its operational target.`;
                }

                recommendations.push({

                    priority:
                        level ===
                        PERFORMANCE_LEVEL.CRITICAL
                            ? 1
                            : 2,

                    severity:
                        level ===
                        PERFORMANCE_LEVEL.CRITICAL
                            ? RISK_LEVEL.CRITICAL
                            : RISK_LEVEL.HIGH,

                    category:
                        'KPI_IMPROVEMENT',

                    metric,

                    action,

                    rationale:
                        `${definition.label} is performing below the peer benchmark at approximately the ${benchmark.performancePercentile}th performance percentile.`
                });
            }
        );

        const historicalMetrics =
            input.historicalBenchmark
                ?.metrics ||
            {};

        Object.keys(
            historicalMetrics
        ).forEach(
            metric => {

                const benchmark =
                    historicalMetrics[
                        metric
                    ];

                if (
                    !benchmark ||
                    !benchmark.available
                ) {
                    return;
                }

                if (
                    benchmark.declining
                ) {

                    recommendations.push({

                        priority:
                            3,

                        severity:
                            RISK_LEVEL.MEDIUM,

                        category:
                            'TREND_REVERSAL',

                        metric,

                        action:
                            `Investigate the deterioration in ${KPI_DEFINITIONS[metric].label.toLowerCase()} and establish corrective controls.`,

                        rationale:
                            `Current performance is below the historical baseline.`
                    });
                }
            }
        );

        for (
            const outlier
            of input.outliers || []
        ) {

            if (
                !outlier.operationallyBad
            ) {
                continue;
            }

            recommendations.push({

                priority:
                    outlier.severity ===
                    RISK_LEVEL.CRITICAL
                        ? 1
                        : 2,

                severity:
                    outlier.severity,

                category:
                    'OUTLIER_INVESTIGATION',

                metric:
                    outlier.metric,

                action:
                    `Investigate the operational outlier in ${outlier.label.toLowerCase()}.`,

                rationale:
                    `The metric is ${Math.abs(outlier.zScore).toFixed(2)} standard deviations from the peer average.`
            });
        }

        return recommendations
            .sort(
                (
                    a,
                    b
                ) => {

                    if (
                        a.priority !==
                        b.priority
                    ) {
                        return (
                            a.priority -
                            b.priority
                        );
                    }

                    const severityOrder = {

                        CRITICAL: 1,

                        HIGH: 2,

                        MEDIUM: 3,

                        LOW: 4,

                        UNKNOWN: 5
                    };

                    return (
                        (
                            severityOrder[
                                a.severity
                            ] ||
                            99
                        ) -
                        (
                            severityOrder[
                                b.severity
                            ] ||
                            99
                        )
                    );
                }
            )
            .slice(
                0,
                this.options.maximumRecommendations
            );
    }

    /**
     * =========================================================================
     * Network benchmarking
     * =========================================================================
     */

    benchmarkNetwork(
        current,
        entities = []
    ) {

        const normalized =
            Array.isArray(entities)
                ? entities.map(
                    entity =>
                        this.normalizeMetrics(
                            entity
                        )
                )
                : [];

        return this.benchmarkAgainstPeers(
            this.normalizeMetrics(
                current
            ),
            normalized
        );
    }

    /**
     * =========================================================================
     * Branch comparison
     * =========================================================================
     */

    compareBranches(
        branches = [],
        metrics = Object.keys(
            KPI_DEFINITIONS
        )
    ) {

        if (
            !Array.isArray(branches)
        ) {
            return [];
        }

        const normalized =
            branches.map(
                branch =>
                    this.normalizeMetrics(
                        branch
                    )
            );

        return normalized
            .map(
                branch => {

                    const benchmark =
                        this.benchmarkAgainstPeers(
                            branch,
                            normalized.filter(
                                peer =>
                                    peer.entityId !==
                                    branch.entityId
                            )
                        );

                    return {

                        entityId:
                            branch.entityId,

                        entityName:
                            branch.entityName,

                        metrics:
                            this._selectMetrics(
                                benchmark.metrics,
                                metrics
                            ),

                        score:
                            benchmark.score,

                        confidence:
                            benchmark.confidence,

                        performanceLevel:
                            benchmark.score
                                ?.level ||
                            PERFORMANCE_LEVEL.UNKNOWN
                    };
                }
            )
            .sort(
                (
                    a,
                    b
                ) =>
                    (
                        b.score?.score ??
                        -1
                    ) -
                    (
                        a.score?.score ??
                        -1
                    )
            );
    }

    _selectMetrics(
        source,
        metrics
    ) {

        const result = {};

        for (
            const metric
            of metrics
        ) {

            if (
                source[
                    metric
                ]
            ) {

                result[metric] =
                    source[
                        metric
                    ];
            }
        }

        return result;
    }

    /**
     * =========================================================================
     * Benchmark snapshot
     * =========================================================================
     */

    createSnapshot(
        result
    ) {

        if (
            !isObject(result)
        ) {
            throw new TypeError(
                'Benchmark result is required.'
            );
        }

        return {

            model:
                this.model,

            schemaVersion:
                this.schemaVersion,

            snapshotId:
                this._generateSnapshotId(),

            benchmarkId:
                result.benchmarkId,

            tenantId:
                result.tenantId,

            organizationId:
                result.organizationId,

            branchId:
                result.branchId,

            branchName:
                result.branchName,

            period:
                clone(
                    result.period
                ),

            benchmarkType:
                result.benchmarkType,

            score:
                clone(
                    result.combined
                ),

            peerBenchmark:
                clone(
                    result.peerBenchmark
                ),

            historicalBenchmark:
                clone(
                    result.historicalBenchmark
                ),

            targetBenchmark:
                clone(
                    result.targetBenchmark
                ),

            outlierCount:
                Array.isArray(
                    result.outliers
                )
                    ? result.outliers.length
                    : 0,

            recommendationCount:
                Array.isArray(
                    result.recommendations
                )
                    ? result.recommendations.length
                    : 0,

            dataQuality:
                clone(
                    result.dataQuality
                ),

            generatedAt:
                new Date(),

            fingerprint:
                this.generateFingerprint(
                    result
                )
        };
    }

    /**
     * =========================================================================
     * Benchmark trend
     * =========================================================================
     */

    calculateTrend(
        snapshots = []
    ) {

        if (
            !Array.isArray(snapshots) ||
            snapshots.length < 2
        ) {

            return {

                status:
                    'INSUFFICIENT_DATA',

                direction:
                    'UNKNOWN',

                change:
                    null,

                changePercent:
                    null
            };
        }

        const values =
            snapshots
                .map(
                    snapshot =>
                        toNumber(
                            snapshot.score?.score ??
                            snapshot.combined?.score ??
                            snapshot.score
                        )
                )
                .filter(
                    value =>
                        value !== null
                );

        if (
            values.length < 2
        ) {

            return {

                status:
                    'INSUFFICIENT_DATA',

                direction:
                    'UNKNOWN',

                change:
                    null,

                changePercent:
                    null
            };
        }

        const previous =
            values[
                values.length - 2
            ];

        const current =
            values[
                values.length - 1
            ];

        const change =
            current -
            previous;

        const changePercent =
            previous !== 0
                ? (
                    change /
                    Math.abs(
                        previous
                    )
                ) * 100
                : null;

        return {

            status:
                'VALID',

            direction:
                change > 0
                    ? 'IMPROVING'
                    : change < 0
                        ? 'DECLINING'
                        : 'STABLE',

            current:
                round(
                    current,
                    2
                ),

            previous:
                round(
                    previous,
                    2
                ),

            change:
                round(
                    change,
                    2
                ),

            changePercent:
                changePercent === null
                    ? null
                    : round(
                        changePercent,
                        2
                    )
        };
    }

    /**
     * =========================================================================
     * Benchmark matrix
     * =========================================================================
     */

    buildBenchmarkMatrix(
        entities = [],
        options = {}
    ) {

        const normalized =
            Array.isArray(entities)
                ? entities.map(
                    entity =>
                        this.normalizeMetrics(
                            entity
                        )
                )
                : [];

        const metricNames =
            Array.isArray(
                options.metrics
            )
                ? options.metrics
                : Object.keys(
                    KPI_DEFINITIONS
                );

        const matrix = [];

        for (
            const metric
            of metricNames
        ) {

            const values =
                normalized
                    .map(
                        entity =>
                            toNumber(
                                entity[metric]
                            )
                    )
                    .filter(
                        value =>
                            value !== null
                    );

            if (
                values.length === 0
            ) {
                continue;
            }

            const definition =
                KPI_DEFINITIONS[
                    metric
                ];

            const ordered =
                normalized
                    .map(
                        entity => {

                            const value =
                                toNumber(
                                    entity[metric]
                                );

                            return {

                                entityId:
                                    entity.entityId,

                                entityName:
                                    entity.entityName,

                                value,

                                performancePercentile:
                                    value === null
                                        ? null
                                        : this._performancePercentile(
                                            metric,
                                            value,
                                            values
                                        )
                            };
                        }
                    )
                    .filter(
                        item =>
                            item.value !== null
                    )
                    .sort(
                        (
                            a,
                            b
                        ) =>
                            b.performancePercentile -
                            a.performancePercentile
                    );

            matrix.push({

                metric,

                label:
                    definition.label,

                direction:
                    definition.direction,

                average:
                    round(
                        mean(values),
                        4
                    ),

                median:
                    round(
                        median(values),
                        4
                    ),

                minimum:
                    round(
                        Math.min(
                            ...values
                        ),
                        4
                    ),

                maximum:
                    round(
                        Math.max(
                            ...values
                        ),
                        4
                    ),

                participants:
                    ordered
            });
        }

        return matrix;
    }

    /**
     * =========================================================================
     * Ranking
     * =========================================================================
     */

    rankEntities(
        entities = []
    ) {

        const normalized =
            Array.isArray(entities)
                ? entities.map(
                    entity =>
                        this.normalizeMetrics(
                            entity
                        )
                )
                : [];

        const results =
            normalized.map(
                entity => {

                    const benchmark =
                        this.benchmarkAgainstPeers(
                            entity,
                            normalized.filter(
                                peer =>
                                    peer.entityId !==
                                    entity.entityId
                            )
                        );

                    return {

                        entityId:
                            entity.entityId,

                        entityName:
                            entity.entityName,

                        score:
                            benchmark.score
                                ?.score ??
                            null,

                        level:
                            benchmark.score
                                ?.level ??
                            PERFORMANCE_LEVEL.UNKNOWN,

                        confidence:
                            benchmark.confidence,

                        benchmark
                    };
                }
            );

        return results
            .sort(
                (
                    a,
                    b
                ) =>
                    (
                        b.score ??
                        -1
                    ) -
                    (
                        a.score ??
                        -1
                    )
            )
            .map(
                (
                    item,
                    index
                ) => ({

                    ...item,

                    rank:
                        index + 1
                })
            );
    }

    /**
     * =========================================================================
     * Fingerprint and integrity
     * =========================================================================
     */

    generateFingerprint(
        result
    ) {

        if (
            !isObject(result)
        ) {
            throw new TypeError(
                'Benchmark result must be an object.'
            );
        }

        return sha256({

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

            benchmarkType:
                result.benchmarkType,

            current:
                result.current,

            peerBenchmark:
                result.peerBenchmark,

            historicalBenchmark:
                result.historicalBenchmark,

            targetBenchmark:
                result.targetBenchmark,

            combined:
                result.combined,

            outliers:
                result.outliers,

            dataQuality:
                result.dataQuality,

            recommendations:
                result.recommendations
        });
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
     * Result comparison
     * =========================================================================
     */

    compareResults(
        current,
        previous
    ) {

        if (
            !isObject(current) ||
            !isObject(previous)
        ) {
            throw new TypeError(
                'Current and previous benchmark results are required.'
            );
        }

        const metrics = [

            'combined.score',

            'combined.confidence',

            'peerBenchmark.score.score',

            'historicalBenchmark.score.score',

            'targetBenchmark.score.score',

            'dataQuality.score'
        ];

        const comparison = {};

        for (
            const path
            of metrics
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

            comparison[path] = {

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

        return comparison;
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
     * Serialization
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
     * IDs
     * =========================================================================
     */

    _generateBenchmarkId() {

        return [
            'benchmark',
            Date.now().toString(36),
            crypto
                .randomBytes(10)
                .toString('hex')
        ].join('-');
    }

    _generateSnapshotId() {

        return [
            'benchmark-snapshot',
            Date.now().toString(36),
            crypto
                .randomBytes(10)
                .toString('hex')
        ].join('-');
    }

    /**
     * =========================================================================
     * Factory APIs
     * =========================================================================
     */

    static create(
        options = {}
    ) {

        return new OperationalBenchmarkService(
            options
        );
    }

    static benchmark(
        input,
        options = {}
    ) {

        return new OperationalBenchmarkService(
            options
        ).benchmark(
            input
        );
    }

    static compareBranches(
        branches,
        options = {}
    ) {

        return new OperationalBenchmarkService(
            options
        ).compareBranches(
            branches
        );
    }

    static rankEntities(
        entities,
        options = {}
    ) {

        return new OperationalBenchmarkService(
            options
        ).rankEntities(
            entities
        );
    }

    /**
     * =========================================================================
     * Public constants
     * =========================================================================
     */

    static get MODEL_NAME() {
        return MODEL_NAME;
    }

    static get SCHEMA_VERSION() {
        return SCHEMA_VERSION;
    }

    static get BENCHMARK_TYPE() {
        return BENCHMARK_TYPE;
    }

    static get PERFORMANCE_LEVEL() {
        return PERFORMANCE_LEVEL;
    }

    static get RISK_LEVEL() {
        return RISK_LEVEL;
    }

    static get DIRECTION() {
        return DIRECTION;
    }

    static get KPI_DEFINITIONS() {
        return KPI_DEFINITIONS;
    }
}

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports =
    OperationalBenchmarkService;

module.exports.OperationalBenchmarkService =
    OperationalBenchmarkService;

module.exports.BENCHMARK_TYPE =
    BENCHMARK_TYPE;

module.exports.PERFORMANCE_LEVEL =
    PERFORMANCE_LEVEL;

module.exports.RISK_LEVEL =
    RISK_LEVEL;

module.exports.DIRECTION =
    DIRECTION;

module.exports.KPI_DEFINITIONS =
    KPI_DEFINITIONS;

module.exports.SCHEMA_VERSION =
    SCHEMA_VERSION;