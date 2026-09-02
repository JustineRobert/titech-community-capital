'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * TeamPerformanceAnalyzer
 * ============================================================================
 *
 * Location:
 *   backend/modules/finance/statements/operations/TeamPerformanceAnalyzer.js
 *
 * Purpose
 * -------
 * Enterprise-grade team/operations performance intelligence service for the
 * financial statement processing and repair ecosystem.
 *
 * Responsibilities
 * ----------------
 * - Analyze team operational performance.
 * - Normalize team/member performance metrics.
 * - Calculate productivity and efficiency scores.
 * - Measure quality, SLA and workload performance.
 * - Detect team/member performance gaps.
 * - Detect workload imbalance.
 * - Identify capacity pressure.
 * - Compare teams against peer teams and targets.
 * - Calculate performance rankings.
 * - Generate explainable recommendations.
 * - Produce management-ready performance summaries.
 * - Produce deterministic fingerprints for analytical integrity.
 *
 * Non-responsibilities
 * --------------------
 * - Does not modify ledger entries.
 * - Does not execute statement repairs.
 * - Does not approve financial transactions.
 * - Does not persist records directly.
 * - Does not schedule work.
 * - Does not make employment decisions.
 *
 * Integration
 * -----------
 * Intended consumers:
 *
 *   OperationalBenchmarkService
 *   BranchPerformanceAnalyzer
 *   CapacityPlanner
 *   OperationalMetrics
 *   RepairAnalyticsSnapshot
 *   RepairForecastEngine
 *   PredictiveRepairScheduler
 *   ExecutiveReportingExporter
 *
 * Design principles
 * -----------------
 * - Tenant isolation.
 * - Defensive normalization.
 * - Deterministic calculations.
 * - Explainable scoring.
 * - Explicit data-quality handling.
 * - Persistence agnostic.
 * - No hidden external dependencies.
 * - CommonJS compatibility.
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
    'TeamPerformanceAnalyzer';

const SCHEMA_VERSION =
    '1.0.0';

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

const WORKLOAD_STATUS = Object.freeze({

    BALANCED:
        'BALANCED',

    UNDERUTILIZED:
        'UNDERUTILIZED',

    PRESSURED:
        'PRESSURED',

    OVERLOADED:
        'OVERLOADED',

    UNKNOWN:
        'UNKNOWN'
});

const DATA_STATUS = Object.freeze({

    VALID:
        'VALID',

    LIMITED:
        'LIMITED',

    INSUFFICIENT:
        'INSUFFICIENT',

    INVALID:
        'INVALID'
});

const DEFAULTS = Object.freeze({

    minimumTeamSize:
        1,

    minimumPeerTeamSize:
        2,

    maximumMembers:
        10000,

    maximumTeams:
        1000,

    maximumRecommendations:
        25,

    maximumOutliers:
        100,

    utilizationTarget:
        80,

    utilizationTolerance:
        10,

    criticalUtilization:
        110,

    underutilizationThreshold:
        50,

    qualityTarget:
        95,

    slaTarget:
        95,

    resolutionTarget:
        95,

    productivityTarget:
        85,

    efficiencyTarget:
        85,

    zScoreThreshold:
        2,

    criticalZScoreThreshold:
        3,

    minimumConfidence:
        40
});

/**
 * ============================================================================
 * Metric definitions
 * ============================================================================
 *
 * scoreDirection:
 *   HIGHER = higher value is better
 *   LOWER  = lower value is better
 *   TARGET = best around a target
 */

const METRIC_DEFINITIONS = Object.freeze({

    productivity: {

        label:
            'Productivity',

        direction:
            'HIGHER',

        weight:
            0.20
    },

    efficiency: {

        label:
            'Efficiency',

        direction:
            'HIGHER',

        weight:
            0.15
    },

    quality: {

        label:
            'Quality',

        direction:
            'HIGHER',

        weight:
            0.15
    },

    slaCompliance: {

        label:
            'SLA Compliance',

        direction:
            'HIGHER',

        weight:
            0.15
    },

    resolutionRate: {

        label:
            'Resolution Rate',

        direction:
            'HIGHER',

        weight:
            0.15
    },

    utilization: {

        label:
            'Capacity Utilization',

        direction:
            'TARGET',

        target:
            DEFAULTS.utilizationTarget,

        tolerance:
            DEFAULTS.utilizationTolerance,

        weight:
            0.10
    },

    averageResolutionTime: {

        label:
            'Average Resolution Time',

        direction:
            'LOWER',

        weight:
            0.05
    },

    backlog: {

        label:
            'Backlog',

        direction:
            'LOWER',

        weight:
            0.05
    }
});

/**
 * ============================================================================
 * Utility functions
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

    if (
        value === undefined ||
        value === null
    ) {
        return value;
    }

    if (
        value instanceof Date
    ) {
        return new Date(
            value.getTime()
        );
    }

    if (
        Array.isArray(value)
    ) {
        return value.map(
            clone
        );
    }

    if (
        isObject(value)
    ) {

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

    const multiplier =
        10 ** decimals;

    return (
        Math.round(
            number * multiplier
        ) /
        multiplier
    );
}

function mean(
    values
) {

    if (
        !Array.isArray(values) ||
        values.length === 0
    ) {
        return null;
    }

    return (
        values.reduce(
            (
                total,
                value
            ) =>
                total + value,
            0
        ) /
        values.length
    );
}

function median(
    values
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
                (
                    a,
                    b
                ) =>
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
                total,
                value
            ) =>
                total +
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

function percentileRank(
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

    return round(
        (
            valid.filter(
                item =>
                    item <= value
            ).length /
            valid.length
        ) *
        100,
        2
    );
}

function stableSerialize(
    value
) {

    if (
        value === undefined
    ) {
        return 'undefined';
    }

    if (
        value === null
    ) {
        return 'null';
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

function fingerprint(
    value
) {

    return crypto
        .createHash('sha256')
        .update(
            stableSerialize(value)
        )
        .digest('hex');
}

/**
 * ============================================================================
 * TeamPerformanceAnalyzer
 * ============================================================================
 */

class TeamPerformanceAnalyzer {

    constructor(
        options = {}
    ) {

        if (
            !isObject(options)
        ) {
            throw new TypeError(
                'TeamPerformanceAnalyzer options must be an object.'
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
     * ========================================================================
     * Primary analysis API
     * ========================================================================
     */

    analyze(
        input = {}
    ) {

        const startedAt =
            Date.now();

        const context =
            this.normalizeInput(
                input
            );

        const dataQuality =
            this.calculateDataQuality(
                context
            );

        if (
            dataQuality.status ===
            DATA_STATUS.INSUFFICIENT
        ) {

            return this._buildInsufficientResult(
                context,
                dataQuality,
                startedAt
            );
        }

        const teamMetrics =
            this.analyzeTeamMetrics(
                context.team,
                context.members
            );

        const memberAnalysis =
            this.analyzeMembers(
                context.members,
                context.team
            );

        const workloadAnalysis =
            this.analyzeWorkload(
                context.members,
                context.team
            );

        const peerComparison =
            this.compareAgainstPeerTeams(
                context.team,
                context.peerTeams
            );

        const targetAnalysis =
            this.compareAgainstTargets(
                context.team,
                context.targets
            );

        const outliers =
            this.detectPerformanceOutliers(
                context.members
            );

        const balanceAnalysis =
            this.analyzePerformanceDistribution(
                context.members
            );

        const score =
            this.calculateTeamScore({
                teamMetrics,
                peerComparison,
                targetAnalysis,
                workloadAnalysis,
                balanceAnalysis
            });

        const recommendations =
            this.generateRecommendations({
                teamMetrics,
                memberAnalysis,
                workloadAnalysis,
                peerComparison,
                targetAnalysis,
                outliers,
                balanceAnalysis,
                score,
                dataQuality
            });

        const result = {

            model:
                this.model,

            schemaVersion:
                this.schemaVersion,

            analysisId:
                this._generateId(
                    'team-analysis'
                ),

            tenantId:
                context.tenantId,

            organizationId:
                context.organizationId,

            branchId:
                context.branchId,

            teamId:
                context.team.teamId,

            teamName:
                context.team.teamName,

            period:
                context.period,

            status:
                'COMPLETED',

            team:
                clone(
                    context.team
                ),

            teamMetrics,

            memberAnalysis,

            workloadAnalysis,

            peerComparison,

            targetAnalysis,

            performanceDistribution:
                balanceAnalysis,

            outliers,

            score,

            recommendations,

            dataQuality,

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
     * ========================================================================
     * Input normalization
     * ========================================================================
     */

    normalizeInput(
        input = {}
    ) {

        const source =
            isObject(input)
                ? input
                : {};

        const members =
            this.normalizeMembers(
                source.members ||
                source.teamMembers ||
                []
            );

        const team =
            this.normalizeTeam(
                source.team ||
                {}
            );

        /*
         * If team-level metrics are not supplied, derive them from members.
         */
        const normalizedTeam =
            this._deriveMissingTeamMetrics(
                team,
                members
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

            period:
                this.normalizePeriod(
                    source.period
                ),

            team:
                normalizedTeam,

            members,

            peerTeams:
                this.normalizeTeams(
                    source.peerTeams ||
                    source.peers ||
                    []
                ),

            targets:
                this.normalizeTeam(
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

    normalizeTeam(
        input = {}
    ) {

        const source =
            isObject(input)
                ? input
                : {};

        return {

            teamId:
                normalizeString(
                    source.teamId ??
                    source.id
                ),

            teamName:
                normalizeString(
                    source.teamName ??
                    source.name
                ),

            memberCount:
                toNumber(
                    source.memberCount ??
                    source.size
                ),

            productivity:
                this.normalizePercent(
                    source.productivity
                ),

            efficiency:
                this.normalizePercent(
                    source.efficiency
                ),

            quality:
                this.normalizePercent(
                    source.quality
                ),

            slaCompliance:
                this.normalizePercent(
                    source.slaCompliance
                ),

            resolutionRate:
                this.normalizePercent(
                    source.resolutionRate
                ),

            utilization:
                this.normalizePercent(
                    source.utilization
                ),

            averageResolutionTime:
                toNumber(
                    source.averageResolutionTime ??
                    source.avgResolutionTime
                ),

            backlog:
                toNumber(
                    source.backlog
                ),

            throughput:
                toNumber(
                    source.throughput
                ),

            capacity:
                toNumber(
                    source.capacity
                ),

            completed:
                toNumber(
                    source.completed ??
                    source.completedUnits
                ),

            assigned:
                toNumber(
                    source.assigned ??
                    source.assignedUnits
                ),

            errors:
                toNumber(
                    source.errors ??
                    source.errorCount
                ),

            repairs:
                toNumber(
                    source.repairs ??
                    source.repairCount
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

    normalizeTeams(
        teams
    ) {

        if (
            !Array.isArray(teams)
        ) {
            return [];
        }

        return teams
            .slice(
                0,
                this.options.maximumTeams
            )
            .map(
                team =>
                    this._deriveMissingTeamMetrics(
                        this.normalizeTeam(
                            team
                        ),
                        this.normalizeMembers(
                            team.members ||
                            []
                        )
                    )
            );
    }

    normalizeMembers(
        members
    ) {

        if (
            !Array.isArray(members)
        ) {
            return [];
        }

        return members
            .slice(
                0,
                this.options.maximumMembers
            )
            .map(
                member =>
                    this.normalizeMember(
                        member
                    )
            );
    }

    normalizeMember(
        input = {}
    ) {

        const source =
            isObject(input)
                ? input
                : {};

        return {

            memberId:
                normalizeString(
                    source.memberId ??
                    source.userId ??
                    source.id
                ),

            memberName:
                normalizeString(
                    source.memberName ??
                    source.userName ??
                    source.name
                ),

            role:
                normalizeString(
                    source.role
                ),

            productivity:
                this.normalizePercent(
                    source.productivity
                ),

            efficiency:
                this.normalizePercent(
                    source.efficiency
                ),

            quality:
                this.normalizePercent(
                    source.quality
                ),

            slaCompliance:
                this.normalizePercent(
                    source.slaCompliance
                ),

            resolutionRate:
                this.normalizePercent(
                    source.resolutionRate
                ),

            utilization:
                this.normalizePercent(
                    source.utilization
                ),

            averageResolutionTime:
                toNumber(
                    source.averageResolutionTime ??
                    source.avgResolutionTime
                ),

            backlog:
                toNumber(
                    source.backlog
                ),

            throughput:
                toNumber(
                    source.throughput ??
                    source.processedUnits
                ),

            capacity:
                toNumber(
                    source.capacity
                ),

            assigned:
                toNumber(
                    source.assigned ??
                    source.assignedUnits
                ),

            completed:
                toNumber(
                    source.completed ??
                    source.completedUnits
                ),

            errors:
                toNumber(
                    source.errors ??
                    source.errorCount
                ),

            repairs:
                toNumber(
                    source.repairs ??
                    source.repairCount
                ),

            availability:
                this.normalizePercent(
                    source.availability
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

    normalizePeriod(
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

    normalizePercent(
        value
    ) {

        const number =
            toNumber(value);

        if (
            number === null
        ) {
            return null;
        }

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
     * ========================================================================
     * Team metric derivation
     * ========================================================================
     */

    _deriveMissingTeamMetrics(
        team,
        members
    ) {

        const result =
            clone(team);

        if (
            !result.memberCount
        ) {
            result.memberCount =
                members.length;
        }

        const metricNames =
            Object.keys(
                METRIC_DEFINITIONS
            );

        for (
            const metric
            of metricNames
        ) {

            if (
                toNumber(
                    result[metric]
                ) !== null
            ) {
                continue;
            }

            const values =
                members
                    .map(
                        member =>
                            toNumber(
                                member[metric]
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

            result[metric] =
                round(
                    mean(values),
                    4
                );
        }

        if (
            result.throughput === null ||
            result.throughput === undefined
        ) {

            result.throughput =
                members
                    .reduce(
                        (
                            total,
                            member
                        ) =>
                            total +
                            toNumber(
                                member.throughput,
                                0
                            ),
                        0
                    );
        }

        if (
            result.backlog === null ||
            result.backlog === undefined
        ) {

            result.backlog =
                members
                    .reduce(
                        (
                            total,
                            member
                        ) =>
                            total +
                            toNumber(
                                member.backlog,
                                0
                            ),
                        0
                    );
        }

        if (
            result.completed === null ||
            result.completed === undefined
        ) {

            result.completed =
                members
                    .reduce(
                        (
                            total,
                            member
                        ) =>
                            total +
                            toNumber(
                                member.completed,
                                0
                            ),
                        0
                    );
        }

        if (
            result.assigned === null ||
            result.assigned === undefined
        ) {

            result.assigned =
                members
                    .reduce(
                        (
                            total,
                            member
                        ) =>
                            total +
                            toNumber(
                                member.assigned,
                                0
                            ),
                        0
                    );
        }

        return result;
    }

    /**
     * ========================================================================
     * Data quality
     * ========================================================================
     */

    calculateDataQuality(
        context
    ) {

        const requiredMetrics =
            Object.keys(
                METRIC_DEFINITIONS
            );

        const availableMetrics =
            requiredMetrics.filter(
                metric =>
                    toNumber(
                        context.team[
                            metric
                        ]
                    ) !== null
            );

        const metricCoverage =
            (
                availableMetrics.length /
                requiredMetrics.length
            ) * 100;

        const memberCount =
            context.members.length;

        let score =
            metricCoverage * 0.70;

        if (
            memberCount >=
            this.options.minimumTeamSize
        ) {
            score += 30;
        }

        let status;

        if (
            availableMetrics.length === 0 ||
            memberCount === 0
        ) {

            status =
                DATA_STATUS.INSUFFICIENT;

        } else if (
            score < 50
        ) {

            status =
                DATA_STATUS.LIMITED;

        } else {

            status =
                DATA_STATUS.VALID;
        }

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
                    metricCoverage,
                    2
                ),

            availableMetrics,

            missingMetrics:
                requiredMetrics.filter(
                    metric =>
                        !availableMetrics.includes(
                            metric
                        )
                ),

            memberCount
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

            analysisId:
                this._generateId(
                    'team-analysis'
                ),

            tenantId:
                context.tenantId,

            organizationId:
                context.organizationId,

            branchId:
                context.branchId,

            teamId:
                context.team.teamId,

            teamName:
                context.team.teamName,

            status:
                'INSUFFICIENT_DATA',

            dataQuality,

            teamMetrics:
                null,

            memberAnalysis: [],

            workloadAnalysis:
                null,

            peerComparison:
                null,

            targetAnalysis:
                null,

            performanceDistribution:
                null,

            outliers: [],

            score:
                null,

            recommendations: [

                {

                    priority:
                        1,

                    severity:
                        RISK_LEVEL.HIGH,

                    category:
                        'DATA_QUALITY',

                    action:
                        'Collect sufficient team and member performance data before making operational decisions.',

                    rationale:
                        'The available team dataset does not contain enough information for a reliable performance assessment.'
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
     * ========================================================================
     * Team-level analysis
     * ========================================================================
     */

    analyzeTeamMetrics(
        team,
        members
    ) {

        const metrics = {};

        Object.keys(
            METRIC_DEFINITIONS
        ).forEach(
            metric => {

                const value =
                    toNumber(
                        team[metric]
                    );

                const definition =
                    METRIC_DEFINITIONS[
                        metric
                    ];

                metrics[metric] = {

                    value,

                    target:
                        this._metricTarget(
                            metric
                        ),

                    direction:
                        definition.direction,

                    performance:
                        this._metricTargetPerformance(
                            metric,
                            value
                        )
                };
            }
        );

        const score =
            this._weightedMetricScore(
                team
            );

        return {

            metrics,

            score,

            performanceLevel:
                this.classifyScore(
                    score
                ),

            memberCount:
                team.memberCount ??
                members.length,

            throughput:
                team.throughput,

            backlog:
                team.backlog,

            completed:
                team.completed,

            assigned:
                team.assigned,

            productivityPerMember:
                team.throughput !== null &&
                team.memberCount > 0
                    ? round(
                        team.throughput /
                        team.memberCount,
                        4
                    )
                    : null
        };
    }

    _metricTarget(
        metric
    ) {

        const definition =
            METRIC_DEFINITIONS[
                metric
            ];

        if (
            definition.target !==
            undefined
        ) {
            return definition.target;
        }

        if (
            metric ===
            'quality'
        ) {
            return this.options.qualityTarget;
        }

        if (
            metric ===
            'slaCompliance'
        ) {
            return this.options.slaTarget;
        }

        if (
            metric ===
            'resolutionRate'
        ) {
            return this.options.resolutionTarget;
        }

        if (
            metric ===
            'productivity'
        ) {
            return this.options.productivityTarget;
        }

        if (
            metric ===
            'efficiency'
        ) {
            return this.options.efficiencyTarget;
        }

        return null;
    }

    _metricTargetPerformance(
        metric,
        value
    ) {

        if (
            value === null
        ) {
            return null;
        }

        const definition =
            METRIC_DEFINITIONS[
                metric
            ];

        const target =
            this._metricTarget(
                metric
            );

        if (
            target === null
        ) {
            return null;
        }

        if (
            definition.direction ===
            'HIGHER'
        ) {

            return {

                variance:
                    round(
                        value -
                        target,
                        4
                    ),

                achieved:
                    value >= target,

                attainment:
                    round(
                        clamp(
                            (
                                value /
                                target
                            ) * 100,
                            0,
                            200
                        ),
                        2
                    )
            };
        }

        if (
            definition.direction ===
            'LOWER'
        ) {

            return {

                variance:
                    round(
                        value -
                        target,
                        4
                    ),

                achieved:
                    value <= target,

                attainment:
                    value <= target
                        ? 100
                        : round(
                            (
                                target /
                                value
                            ) * 100,
                            2
                        )
            };
        }

        const tolerance =
            definition.tolerance ??
            this.options.utilizationTolerance;

        const distance =
            Math.abs(
                value -
                target
            );

        return {

            variance:
                round(
                    value -
                    target,
                    4
                ),

            achieved:
                distance <= tolerance,

            attainment:
                distance <= tolerance
                    ? 100
                    : round(
                        Math.max(
                            0,
                            100 -
                            (
                                (
                                    distance -
                                    tolerance
                                ) /
                                Math.max(
                                    target,
                                    1
                                )
                            ) *
                            100
                        ),
                        2
                    )
        };
    }

    _weightedMetricScore(
        metrics
    ) {

        let weightedTotal =
            0;

        let totalWeight =
            0;

        Object.keys(
            METRIC_DEFINITIONS
        ).forEach(
            metric => {

                const value =
                    toNumber(
                        metrics[metric]
                    );

                if (
                    value === null
                ) {
                    return;
                }

                const performance =
                    this._metricPerformanceScore(
                        metric,
                        value
                    );

                const weight =
                    this.options.weights[
                        metric
                    ];

                weightedTotal +=
                    performance *
                    weight;

                totalWeight +=
                    weight;
            }
        );

        if (
            totalWeight === 0
        ) {
            return null;
        }

        return round(
            weightedTotal /
            totalWeight,
            2
        );
    }

    _metricPerformanceScore(
        metric,
        value
    ) {

        const definition =
            METRIC_DEFINITIONS[
                metric
            ];

        const target =
            this._metricTarget(
                metric
            );

        if (
            target === null ||
            target === undefined
        ) {

            /*
             * Metrics without a configured target are normalized against
             * the standard 100-point operational scale.
             */
            return clamp(
                value,
                0,
                100
            );
        }

        if (
            definition.direction ===
            'HIGHER'
        ) {

            return clamp(
                (
                    value /
                    target
                ) * 100,
                0,
                120
            );
        }

        if (
            definition.direction ===
            'LOWER'
        ) {

            if (
                value <= target
            ) {
                return 100;
            }

            return clamp(
                (
                    target /
                    Math.max(
                        value,
                        Number.EPSILON
                    )
                ) * 100,
                0,
                100
            );
        }

        const tolerance =
            definition.tolerance ??
            this.options.utilizationTolerance;

        const distance =
            Math.abs(
                value -
                target
            );

        if (
            distance <= tolerance
        ) {
            return 100;
        }

        return clamp(
            100 -
            (
                (
                    distance -
                    tolerance
                ) /
                Math.max(
                    target,
                    1
                )
            ) *
            100,
            0,
            100
        );
    }

    /**
     * ========================================================================
     * Member analysis
     * ========================================================================
     */

    analyzeMembers(
        members,
        team
    ) {

        if (
            !Array.isArray(members)
        ) {
            return [];
        }

        return members
            .map(
                member => {

                    const score =
                        this._weightedMetricScore(
                            member
                        );

                    const utilizationStatus =
                        this.classifyUtilization(
                            member.utilization
                        );

                    const qualityStatus =
                        this._classifyThreshold(
                            member.quality,
                            this.options.qualityTarget
                        );

                    const slaStatus =
                        this._classifyThreshold(
                            member.slaCompliance,
                            this.options.slaTarget
                        );

                    const workload =
                        this._calculateMemberWorkload(
                            member
                        );

                    return {

                        memberId:
                            member.memberId,

                        memberName:
                            member.memberName,

                        role:
                            member.role,

                        score,

                        performanceLevel:
                            this.classifyScore(
                                score
                            ),

                        productivity:
                            member.productivity,

                        efficiency:
                            member.efficiency,

                        quality:
                            member.quality,

                        qualityStatus,

                        slaCompliance:
                            member.slaCompliance,

                        slaStatus,

                        resolutionRate:
                            member.resolutionRate,

                        utilization:
                            member.utilization,

                        utilizationStatus,

                        averageResolutionTime:
                            member.averageResolutionTime,

                        backlog:
                            member.backlog,

                        throughput:
                            member.throughput,

                        workload,

                        contribution:
                            this._calculateContribution(
                                member,
                                team
                            )
                    };
                }
            )
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
            );
    }

    _calculateMemberWorkload(
        member
    ) {

        const utilization =
            toNumber(
                member.utilization
            );

        if (
            utilization === null
        ) {

            return {

                status:
                    WORKLOAD_STATUS.UNKNOWN,

                pressure:
                    null,

                capacityGap:
                    null
            };
        }

        const pressure =
            utilization -
            this.options.utilizationTarget;

        return {

            status:
                this.classifyUtilization(
                    utilization
            ),

            pressure:
                round(
                    pressure,
                    2
                ),

            capacityGap:
                round(
                    this.options.utilizationTarget -
                    utilization,
                    2
                )
        };
    }

    _calculateContribution(
        member,
        team
    ) {

        const throughput =
            toNumber(
                member.throughput
            );

        const teamThroughput =
            toNumber(
                team.throughput
            );

        if (
            throughput === null ||
            teamThroughput === null ||
            teamThroughput <= 0
        ) {

            return null;
        }

        return round(
            (
                throughput /
                teamThroughput
            ) * 100,
            2
        );
    }

    /**
     * ========================================================================
     * Workload analysis
     * ========================================================================
     */

    analyzeWorkload(
        members,
        team
    ) {

        const utilizationValues =
            members
                .map(
                    member =>
                        toNumber(
                            member.utilization
                        )
                )
                .filter(
                    value =>
                        value !== null
                );

        const backlogValues =
            members
                .map(
                    member =>
                        toNumber(
                            member.backlog
                        )
                )
                .filter(
                    value =>
                        value !== null
                );

        const throughputValues =
            members
                .map(
                    member =>
                        toNumber(
                            member.throughput
                        )
                )
                .filter(
                    value =>
                        value !== null
                );

        const averageUtilization =
            mean(
                utilizationValues
            );

        const utilizationSpread =
            utilizationValues.length > 1
                ? Math.max(
                    ...utilizationValues
                ) -
                Math.min(
                    ...utilizationValues
                )
                : 0;

        const overloadedMembers =
            members.filter(
                member =>
                    toNumber(
                        member.utilization
                    ) >
                    this.options.criticalUtilization
            );

        const pressuredMembers =
            members.filter(
                member =>
                    toNumber(
                        member.utilization
                    ) >
                    (
                        this.options.utilizationTarget +
                        this.options.utilizationTolerance
                    ) &&
                    toNumber(
                        member.utilization
                    ) <=
                    this.options.criticalUtilization
            );

        const underutilizedMembers =
            members.filter(
                member =>
                    toNumber(
                        member.utilization
                    ) <
                    this.options.underutilizationThreshold
            );

        return {

            teamUtilization:
                team.utilization,

            averageMemberUtilization:
                averageUtilization === null
                    ? null
                    : round(
                        averageUtilization,
                        2
                    ),

            utilizationSpread:
                round(
                    utilizationSpread,
                    2
                ),

            maximumUtilization:
                utilizationValues.length
                    ? Math.max(
                        ...utilizationValues
                    )
                    : null,

            minimumUtilization:
                utilizationValues.length
                    ? Math.min(
                        ...utilizationValues
                    )
                    : null,

            totalBacklog:
                backlogValues.length
                    ? round(
                        backlogValues.reduce(
                            (
                                total,
                                value
                            ) =>
                                total +
                                value,
                            0
                        ),
                        2
                    )
                    : team.backlog,

            totalThroughput:
                throughputValues.length
                    ? round(
                        throughputValues.reduce(
                            (
                                total,
                                value
                            ) =>
                                total +
                                value,
                            0
                        ),
                        2
                    )
                    : team.throughput,

            overloadedMembers:
                overloadedMembers.map(
                    member =>
                        member.memberId
                ),

            pressuredMembers:
                pressuredMembers.map(
                    member =>
                        member.memberId
                ),

            underutilizedMembers:
                underutilizedMembers.map(
                    member =>
                        member.memberId
                ),

            workloadStatus:
                this._classifyTeamWorkload(
                    averageUtilization
                ),

            imbalance:
                this._calculateWorkloadImbalance(
                    utilizationValues
                )
        };
    }

    classifyUtilization(
        utilization
    ) {

        const value =
            toNumber(
                utilization
            );

        if (
            value === null
        ) {
            return WORKLOAD_STATUS.UNKNOWN;
        }

        if (
            value >
            this.options.criticalUtilization
        ) {
            return WORKLOAD_STATUS.OVERLOADED;
        }

        if (
            value >
            (
                this.options.utilizationTarget +
                this.options.utilizationTolerance
            )
        ) {
            return WORKLOAD_STATUS.PRESSURED;
        }

        if (
            value <
            this.options.underutilizationThreshold
        ) {
            return WORKLOAD_STATUS.UNDERUTILIZED;
        }

        return WORKLOAD_STATUS.BALANCED;
    }

    _classifyTeamWorkload(
        utilization
    ) {

        return this.classifyUtilization(
            utilization
        );
    }

    _calculateWorkloadImbalance(
        values
    ) {

        if (
            values.length < 2
        ) {

            return {

                score:
                    0,

                level:
                    'LOW',

                standardDeviation:
                    0
            };
        }

        const deviation =
            standardDeviation(
                values
            );

        const average =
            mean(
                values
            );

        const coefficient =
            average > 0
                ? (
                    deviation /
                    average
                ) * 100
                : 0;

        let level;

        if (
            coefficient >= 30
        ) {
            level = 'HIGH';
        } else if (
            coefficient >= 15
        ) {
            level = 'MEDIUM';
        } else {
            level = 'LOW';
        }

        return {

            score:
                round(
                    clamp(
                        coefficient,
                        0,
                        100
                    ),
                    2
                ),

            level,

            standardDeviation:
                round(
                    deviation,
                    2
                ),

            coefficientOfVariation:
                round(
                    coefficient,
                    2
                )
        };
    }

    /**
     * ========================================================================
     * Peer-team comparison
     * ========================================================================
     */

    compareAgainstPeerTeams(
        team,
        peerTeams
    ) {

        if (
            !Array.isArray(peerTeams) ||
            peerTeams.length === 0
        ) {

            return {

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
            METRIC_DEFINITIONS
        ).forEach(
            metric => {

                const current =
                    toNumber(
                        team[metric]
                    );

                const values =
                    peerTeams
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
                    current === null ||
                    values.length === 0
                ) {

                    metrics[metric] = {

                        available:
                            false,

                        current,

                        sampleSize:
                            values.length
                    };

                    return;
                }

                const average =
                    mean(values);

                const standardDev =
                    standardDeviation(
                        values
                    );

                const percentile =
                    this._performancePercentile(
                        metric,
                        current,
                        values
                    );

                metrics[metric] = {

                    available:
                        true,

                    current:
                        round(
                            current,
                            4
                        ),

                    peerAverage:
                        round(
                            average,
                            4
                        ),

                    peerMedian:
                        round(
                            median(values),
                            4
                        ),

                    percentile,

                    difference:
                        round(
                            this._directionalDifference(
                                metric,
                                current,
                                average
                            ),
                            4
                        ),

                    zScore:
                        standardDev > 0
                            ? round(
                                (
                                    current -
                                    average
                                ) /
                                standardDev,
                                4
                            )
                            : 0,

                    performanceLevel:
                        this.classifyScore(
                            percentile
                        )
                };
            }
        );

        const score =
            this._aggregatePeerScore(
                metrics
            );

        return {

            status:
                peerTeams.length >=
                this.options.minimumPeerTeamSize
                    ? 'VALID'
                    : 'LIMITED_SAMPLE',

            sampleSize:
                peerTeams.length,

            metrics,

            score,

            confidence:
                this._calculatePeerConfidence(
                    peerTeams.length,
                    metrics
                )
        };
    }

    _aggregatePeerScore(
        metrics
    ) {

        let total =
            0;

        let weight =
            0;

        Object.keys(
            metrics
        ).forEach(
            metric => {

                const value =
                    toNumber(
                        metrics[
                            metric
                        ]?.percentile
                    );

                if (
                    value === null
                ) {
                    return;
                }

                const metricWeight =
                    this.options.weights[
                        metric
                    ] ??
                    0;

                total +=
                    value *
                    metricWeight;

                weight +=
                    metricWeight;
            }
        );

        if (
            weight === 0
        ) {
            return null;
        }

        const score =
            total /
            weight;

        return {

            score:
                round(
                    score,
                    2
                ),

            performanceLevel:
                this.classifyScore(
                    score
                )
        };
    }

    _calculatePeerConfidence(
        sampleSize,
        metrics
    ) {

        const available =
            Object.values(
                metrics
            )
                .filter(
                    metric =>
                        metric.available
                )
                .length;

        const total =
            Object.keys(
                METRIC_DEFINITIONS
            ).length;

        const metricCoverage =
            total > 0
                ? (
                    available /
                    total
                ) * 100
                : 0;

        let sampleConfidence;

        if (
            sampleSize >= 30
        ) {
            sampleConfidence = 100;
        } else if (
            sampleSize >= 15
        ) {
            sampleConfidence = 90;
        } else if (
            sampleSize >= 10
        ) {
            sampleConfidence = 80;
        } else if (
            sampleSize >= 5
        ) {
            sampleConfidence = 65;
        } else {
            sampleConfidence = 45;
        }

        return round(
            (
                sampleConfidence * 0.60
            ) +
            (
                metricCoverage * 0.40
            ),
            2
        );
    }

    _performancePercentile(
        metric,
        current,
        values
    ) {

        const definition =
            METRIC_DEFINITIONS[
                metric
            ];

        if (
            definition.direction ===
            'LOWER'
        ) {

            return percentileRank(
                values.map(
                    value =>
                        -value
                ),
                -current
            );
        }

        if (
            definition.direction ===
            'TARGET'
        ) {

            const target =
                definition.target ??
                this.options.utilizationTarget;

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

            return percentileRank(
                distances.map(
                    value =>
                        -value
                ),
                -currentDistance
            );
        }

        return percentileRank(
            values,
            current
        );
    }

    _directionalDifference(
        metric,
        current,
        baseline
    ) {

        const direction =
            METRIC_DEFINITIONS[
                metric
            ].direction;

        if (
            direction ===
            'LOWER'
        ) {
            return baseline - current;
        }

        if (
            direction ===
            'TARGET'
        ) {

            const target =
                METRIC_DEFINITIONS[
                    metric
                ].target ??
                this.options.utilizationTarget;

            return (
                Math.abs(
                    current -
                    target
                ) <
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

    /**
     * ========================================================================
     * Target comparison
     * ========================================================================
     */

    compareAgainstTargets(
        team,
        targets
    ) {

        const metrics = {};

        Object.keys(
            METRIC_DEFINITIONS
        ).forEach(
            metric => {

                const current =
                    toNumber(
                        team[metric]
                    );

                const explicitTarget =
                    toNumber(
                        targets[
                            metric
                        ]
                    );

                const target =
                    explicitTarget !== null
                        ? explicitTarget
                        : this._metricTarget(
                            metric
                        );

                if (
                    current === null ||
                    target === null
                ) {

                    metrics[metric] = {

                        available:
                            false,

                        current,

                        target
                    };

                    return;
                }

                const definition =
                    METRIC_DEFINITIONS[
                        metric
                    ];

                let achieved;

                let attainment;

                if (
                    definition.direction ===
                    'HIGHER'
                ) {

                    achieved =
                        current >= target;

                    attainment =
                        round(
                            clamp(
                                (
                                    current /
                                    target
                                ) * 100,
                                0,
                                200
                            ),
                            2
                        );

                } else if (
                    definition.direction ===
                    'LOWER'
                ) {

                    achieved =
                        current <= target;

                    attainment =
                        current <= target
                            ? 100
                            : round(
                                clamp(
                                    (
                                        target /
                                        current
                                    ) * 100,
                                    0,
                                    100
                                ),
                                2
                            );

                } else {

                    const tolerance =
                        definition.tolerance ??
                        this.options.utilizationTolerance;

                    const distance =
                        Math.abs(
                            current -
                            target
                        );

                    achieved =
                        distance <=
                        tolerance;

                    attainment =
                        achieved
                            ? 100
                            : round(
                                clamp(
                                    100 -
                                    (
                                        (
                                            distance -
                                            tolerance
                                        ) /
                                        Math.max(
                                            target,
                                            1
                                        )
                                    ) *
                                    100,
                                    0,
                                    100
                                ),
                                2
                            );
                }

                metrics[metric] = {

                    available:
                        true,

                    current:
                        round(
                            current,
                            4
                        ),

                    target:
                        round(
                            target,
                            4
                        ),

                    variance:
                        round(
                            current -
                            target,
                            4
                        ),

                    achieved,

                    attainment
                };
            }
        );

        const values =
            Object.values(
                metrics
            )
                .map(
                    metric =>
                        toNumber(
                            metric.attainment
                        )
                )
                .filter(
                    value =>
                        value !== null
                );

        const score =
            values.length
                ? round(
                    mean(values),
                    2
                )
                : null;

        return {

            status:
                values.length
                    ? 'VALID'
                    : 'NO_TARGETS',

            metrics,

            score,

            performanceLevel:
                this.classifyScore(
                    score
                )
        };
    }

    /**
     * ========================================================================
     * Performance distribution
     * ========================================================================
     */

    analyzePerformanceDistribution(
        members
    ) {

        const scores =
            members
                .map(
                    member =>
                        this._weightedMetricScore(
                            member
                        )
                )
                .filter(
                    value =>
                        value !== null
                );

        if (
            scores.length === 0
        ) {

            return {

                status:
                    DATA_STATUS.INSUFFICIENT,

                average:
                    null,

                median:
                    null,

                standardDeviation:
                    null,

                minimum:
                    null,

                maximum:
                    null,

                distribution: {}
            };
        }

        const distribution = {

            exceptional:
                0,

            strong:
                0,

            healthy:
                0,

            watch:
                0,

            underperforming:
                0,

            critical:
                0
        };

        scores.forEach(
            score => {

                const level =
                    this.classifyScore(
                        score
                    );

                const key =
                    level.toLowerCase();

                if (
                    Object.prototype.hasOwnProperty.call(
                        distribution,
                        key
                    )
                ) {
                    distribution[key]++;
                }
            }
        );

        return {

            status:
                DATA_STATUS.VALID,

            average:
                round(
                    mean(scores),
                    2
                ),

            median:
                round(
                    median(scores),
                    2
                ),

            standardDeviation:
                round(
                    standardDeviation(
                        scores
                    ),
                    2
                ),

            minimum:
                round(
                    Math.min(
                        ...scores
                    ),
                    2
                ),

            maximum:
                round(
                    Math.max(
                        ...scores
                    ),
                    2
                ),

            distribution
        };
    }

    /**
     * ========================================================================
     * Outlier detection
     * ========================================================================
     */

    detectPerformanceOutliers(
        members
    ) {

        if (
            !Array.isArray(members) ||
            members.length < 3
        ) {
            return [];
        }

        const results = [];

        Object.keys(
            METRIC_DEFINITIONS
        ).forEach(
            metric => {

                const values =
                    members
                        .map(
                            member =>
                                toNumber(
                                    member[
                                        metric
                                    ]
                                )
                        )
                        .filter(
                            value =>
                                value !== null
                        );

                if (
                    values.length < 3
                ) {
                    return;
                }

                const average =
                    mean(values);

                const deviation =
                    standardDeviation(
                        values
                    );

                if (
                    deviation === 0
                ) {
                    return;
                }

                members.forEach(
                    member => {

                        const value =
                            toNumber(
                                member[
                                    metric
                                ]
                            );

                        if (
                            value === null
                        ) {
                            return;
                        }

                        const zScore =
                            (
                                value -
                                average
                            ) /
                            deviation;

                        if (
                            Math.abs(
                                zScore
                            ) <
                            this.options.zScoreThreshold
                        ) {
                            return;
                        }

                        const direction =
                            METRIC_DEFINITIONS[
                                metric
                            ].direction;

                        const operationallyBad =
                            this._isBadOutlier(
                                direction,
                                value,
                                average,
                                metric
                            );

                        results.push({

                            memberId:
                                member.memberId,

                            memberName:
                                member.memberName,

                            metric,

                            metricLabel:
                                METRIC_DEFINITIONS[
                                    metric
                                ].label,

                            value:
                                round(
                                    value,
                                    4
                                ),

                            teamAverage:
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
            }
        );

        return results
            .sort(
                (
                    a,
                    b
                ) =>
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

    _isBadOutlier(
        direction,
        current,
        average,
        metric
    ) {

        if (
            direction ===
            'LOWER'
        ) {
            return current > average;
        }

        if (
            direction ===
            'HIGHER'
        ) {
            return current < average;
        }

        const target =
            METRIC_DEFINITIONS[
                metric
            ].target ??
            this.options.utilizationTarget;

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

    /**
     * ========================================================================
     * Team score
     * ========================================================================
     */

    calculateTeamScore(
        input
    ) {

        const teamScore =
            toNumber(
                input.teamMetrics
                    ?.score
            );

        const peerScore =
            toNumber(
                input.peerComparison
                    ?.score
                    ?.score
            );

        const targetScore =
            toNumber(
                input.targetAnalysis
                    ?.score
            );

        const workloadPenalty =
            this._workloadPenalty(
                input.workloadAnalysis
            );

        const distributionPenalty =
            this._distributionPenalty(
                input.balanceAnalysis
            );

        const components = [];

        if (
            teamScore !== null
        ) {
            components.push({

                name:
                    'team',

                score:
                    teamScore,

                weight:
                    0.50
            });
        }

        if (
            peerScore !== null
        ) {
            components.push({

                name:
                    'peer',

                score:
                    peerScore,

                weight:
                    0.25
            });
        }

        if (
            targetScore !== null
        ) {
            components.push({

                name:
                    'target',

                score:
                    targetScore,

                weight:
                    0.25
            });
        }

        if (
            components.length === 0
        ) {

            return {

                score:
                    null,

                performanceLevel:
                    PERFORMANCE_LEVEL.UNKNOWN,

                confidence:
                    0,

                components: [],

                penalties: {

                    workload:
                        workloadPenalty,

                    distribution:
                        distributionPenalty
                }
            };
        }

        const totalWeight =
            components.reduce(
                (
                    total,
                    component
                ) =>
                    total +
                    component.weight,
                0
            );

        let score =
            components.reduce(
                (
                    total,
                    component
                ) =>
                    total +
                    (
                        component.score *
                        component.weight
                    ),
                0
            ) /
            totalWeight;

        score =
            clamp(
                score -
                workloadPenalty -
                distributionPenalty,
                0,
                100
            );

        const confidence =
            this._calculateOverallConfidence(
                input,
                components
            );

        return {

            score:
                round(
                    score,
                    2
                ),

            performanceLevel:
                this.classifyScore(
                    score
                ),

            confidence,

            components:
                components.map(
                    component => ({

                        name:
                            component.name,

                        score:
                            round(
                                component.score,
                                2
                            ),

                        weight:
                            component.weight
                    })
                ),

            penalties: {

                workload:
                    workloadPenalty,

                distribution:
                    distributionPenalty
            }
        };
    }

    _workloadPenalty(
        workload
    ) {

        if (
            !workload
        ) {
            return 0;
        }

        let penalty = 0;

        if (
            workload.workloadStatus ===
            WORKLOAD_STATUS.OVERLOADED
        ) {
            penalty += 8;
        } else if (
            workload.workloadStatus ===
            WORKLOAD_STATUS.PRESSURED
        ) {
            penalty += 4;
        }

        if (
            workload.imbalance?.level ===
            'HIGH'
        ) {
            penalty += 5;
        } else if (
            workload.imbalance?.level ===
            'MEDIUM'
        ) {
            penalty += 2;
        }

        return penalty;
    }

    _distributionPenalty(
        distribution
    ) {

        if (
            !distribution ||
            distribution.status !==
            DATA_STATUS.VALID
        ) {
            return 0;
        }

        const total =
            Object.values(
                distribution.distribution
            )
                .reduce(
                    (
                        sum,
                        value
                    ) =>
                        sum +
                        value,
                    0
                );

        if (
            total === 0
        ) {
            return 0;
        }

        const critical =
            distribution.distribution
                .critical ||
            0;

        const underperforming =
            distribution.distribution
                .underperforming ||
            0;

        return clamp(
            (
                (
                    critical /
                    total
                ) * 8
            ) +
            (
                (
                    underperforming /
                    total
                ) * 4
            ),
            0,
            10
        );
    }

    _calculateOverallConfidence(
        input,
        components
    ) {

        const dataScore =
            toNumber(
                input.dataQuality
            );

        const peerConfidence =
            toNumber(
                input.peerComparison
                    ?.confidence
            );

        const componentCoverage =
            components.length /
            3 *
            100;

        const values = [

            componentCoverage,

            peerConfidence ??
                50
        ];

        return round(
            mean(values),
            2
        );
    }

    /**
     * ========================================================================
     * Classification
     * ========================================================================
     */

    classifyScore(
        score
    ) {

        const value =
            toNumber(
                score
            );

        if (
            value === null
        ) {
            return PERFORMANCE_LEVEL.UNKNOWN;
        }

        if (
            value >= 90
        ) {
            return PERFORMANCE_LEVEL.EXCEPTIONAL;
        }

        if (
            value >= 80
        ) {
            return PERFORMANCE_LEVEL.STRONG;
        }

        if (
            value >= 70
        ) {
            return PERFORMANCE_LEVEL.HEALTHY;
        }

        if (
            value >= 60
        ) {
            return PERFORMANCE_LEVEL.WATCH;
        }

        if (
            value >= 45
        ) {
            return PERFORMANCE_LEVEL.UNDERPERFORMING;
        }

        return PERFORMANCE_LEVEL.CRITICAL;
    }

    _classifyThreshold(
        value,
        target
    ) {

        const current =
            toNumber(value);

        const threshold =
            toNumber(target);

        if (
            current === null ||
            threshold === null
        ) {
            return 'UNKNOWN';
        }

        if (
            current >= threshold
        ) {
            return 'MEETING';
        }

        if (
            current >=
            threshold * 0.90
        ) {
            return 'WATCH';
        }

        return 'BELOW_TARGET';
    }

    /**
     * ========================================================================
     * Recommendations
     * ========================================================================
     */

    generateRecommendations(
        input
    ) {

        const recommendations = [];

        const score =
            toNumber(
                input.score
                    ?.score
            );

        if (
            score !== null &&
            score < 45
        ) {

            recommendations.push({

                priority:
                    1,

                severity:
                    RISK_LEVEL.CRITICAL,

                category:
                    'TEAM_RECOVERY',

                action:
                    'Initiate a structured team performance recovery plan.',

                rationale:
                    `The team performance score is ${round(score, 2)}.`
            });
        }

        const workload =
            input.workloadAnalysis;

        if (
            workload
                ?.workloadStatus ===
            WORKLOAD_STATUS.OVERLOADED
        ) {

            recommendations.push({

                priority:
                    1,

                severity:
                    RISK_LEVEL.CRITICAL,

                category:
                    'CAPACITY',

                action:
                    'Redistribute workload and evaluate additional operational capacity.',

                rationale:
                    `Team utilization is above the configured overload threshold.`
            });
        }

        if (
            workload
                ?.workloadStatus ===
            WORKLOAD_STATUS.PRESSURED
        ) {

            recommendations.push({

                priority:
                    2,

                severity:
                    RISK_LEVEL.HIGH,

                category:
                    'CAPACITY',

                action:
                    'Review workload allocation before operational pressure becomes sustained overload.',

                rationale:
                    'Team utilization indicates elevated capacity pressure.'
            });
        }

        if (
            workload
                ?.imbalance
                ?.level ===
            'HIGH'
        ) {

            recommendations.push({

                priority:
                    2,

                severity:
                    RISK_LEVEL.HIGH,

                category:
                    'WORKLOAD_BALANCING',

                action:
                    'Rebalance assignments across team members using current capacity and skill availability.',

                rationale:
                    'Member utilization shows substantial workload dispersion.'
            });
        }

        const targetMetrics =
            input.targetAnalysis
                ?.metrics ||
            {};

        Object.keys(
            targetMetrics
        ).forEach(
            metric => {

                const item =
                    targetMetrics[
                        metric
                    ];

                if (
                    !item ||
                    !item.available ||
                    item.achieved
                ) {
                    return;
                }

                recommendations.push({

                    priority:
                        2,

                    severity:
                        RISK_LEVEL.HIGH,

                    category:
                        'TARGET_GAP',

                    metric,

                    action:
                        `Improve ${METRIC_DEFINITIONS[metric].label.toLowerCase()} toward the configured operational target.`,

                    rationale:
                        `Current value ${item.current} is below the target requirement of ${item.target}.`
                });
            }
        );

        const outliers =
            input.outliers ||
            [];

        outliers
            .filter(
                outlier =>
                    outlier.operationallyBad
            )
            .slice(
                0,
                10
            )
            .forEach(
                outlier => {

                    recommendations.push({

                        priority:
                            outlier.severity ===
                            RISK_LEVEL.CRITICAL
                                ? 1
                                : 3,

                        severity:
                            outlier.severity,

                        category:
                            'MEMBER_SUPPORT',

                        memberId:
                            outlier.memberId,

                        metric:
                            outlier.metric,

                        action:
                            `Investigate ${outlier.metricLabel.toLowerCase()} for ${outlier.memberName || outlier.memberId || 'the affected team member'}.`,

                        rationale:
                            `The metric is ${Math.abs(outlier.zScore).toFixed(2)} standard deviations from the team average.`
                    });
                }
            );

        const distribution =
            input.balanceAnalysis;

        if (
            distribution
                ?.distribution
                ?.critical > 0
        ) {

            recommendations.push({

                priority:
                    2,

                severity:
                    RISK_LEVEL.HIGH,

                category:
                    'PERFORMANCE_SUPPORT',

                action:
                    'Review low-performing members for training, process blockers, workload mismatch or operational support needs.',

                rationale:
                    `${distribution.distribution.critical} team member(s) fall into the critical performance band.`
            });
        }

        return recommendations
            .sort(
                (
                    a,
                    b
                ) =>
                    a.priority -
                    b.priority
            )
            .slice(
                0,
                this.options.maximumRecommendations
            );
    }

    /**
     * ========================================================================
     * Team ranking
     * ========================================================================
     */

    rankTeams(
        teams = []
    ) {

        if (
            !Array.isArray(teams)
        ) {
            return [];
        }

        const normalized =
            teams.map(
                team =>
                    this._deriveMissingTeamMetrics(
                        this.normalizeTeam(
                            team
                        ),
                        this.normalizeMembers(
                            team.members ||
                            []
                        )
                    )
            );

        return normalized
            .map(
                team => {

                    const score =
                        this._weightedMetricScore(
                            team
                        );

                    return {

                        teamId:
                            team.teamId,

                        teamName:
                            team.teamName,

                        score:
                            score === null
                                ? null
                                : round(
                                    score,
                                    2
                                ),

                        performanceLevel:
                            this.classifyScore(
                                score
                            )
                    };
                }
            )
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
     * ========================================================================
     * Member ranking
     * ========================================================================
     */

    rankMembers(
        members = []
    ) {

        const normalized =
            this.normalizeMembers(
                members
            );

        return normalized
            .map(
                member => {

                    const score =
                        this._weightedMetricScore(
                            member
                        );

                    return {

                        memberId:
                            member.memberId,

                        memberName:
                            member.memberName,

                        role:
                            member.role,

                        score,

                        performanceLevel:
                            this.classifyScore(
                                score
                            )
                    };
                }
            )
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
     * ========================================================================
     * Capacity signals
     * ========================================================================
     */

    calculateCapacitySignals(
        team,
        members
    ) {

        const normalizedTeam =
            this._deriveMissingTeamMetrics(
                this.normalizeTeam(
                    team
                ),
                this.normalizeMembers(
                    members
                )
            );

        const utilization =
            toNumber(
                normalizedTeam.utilization
            );

        const backlog =
            toNumber(
                normalizedTeam.backlog
            );

        const throughput =
            toNumber(
                normalizedTeam.throughput
            );

        const capacity =
            toNumber(
                normalizedTeam.capacity
            );

        const backlogToThroughput =
            backlog !== null &&
            throughput !== null &&
            throughput > 0
                ? round(
                    backlog /
                    throughput,
                    4
                )
                : null;

        const capacityGap =
            capacity !== null &&
            throughput !== null
                ? round(
                    capacity -
                    throughput,
                    4
                )
                : null;

        return {

            utilization,

            utilizationStatus:
                this.classifyUtilization(
                    utilization
                ),

            backlog,

            throughput,

            capacity,

            capacityGap,

            backlogToThroughput,

            capacityPressure:
                this._capacityPressureScore(
                    utilization,
                    backlogToThroughput
                )
        };
    }

    _capacityPressureScore(
        utilization,
        backlogToThroughput
    ) {

        let score = 0;

        if (
            utilization !== null
        ) {

            if (
                utilization >=
                this.options.criticalUtilization
            ) {
                score += 70;
            } else if (
                utilization >
                this.options.utilizationTarget +
                this.options.utilizationTolerance
            ) {
                score += 50;
            } else if (
                utilization >
                this.options.utilizationTarget
            ) {
                score += 30;
            }
        }

        if (
            backlogToThroughput !== null
        ) {

            if (
                backlogToThroughput >= 2
            ) {
                score += 30;
            } else if (
                backlogToThroughput >= 1
            ) {
                score += 20;
            } else if (
                backlogToThroughput > 0.5
            ) {
                score += 10;
            }
        }

        return {

            score:
                round(
                    clamp(
                        score,
                        0,
                        100
                    ),
                    2
                ),

            level:
                score >= 80
                    ? RISK_LEVEL.CRITICAL
                    : score >= 60
                        ? RISK_LEVEL.HIGH
                        : score >= 35
                            ? RISK_LEVEL.MEDIUM
                            : RISK_LEVEL.LOW
        };
    }

    /**
     * ========================================================================
     * Snapshot creation
     * ========================================================================
     */

    createSnapshot(
        result
    ) {

        if (
            !isObject(result)
        ) {
            throw new TypeError(
                'Analysis result is required.'
            );
        }

        return {

            model:
                this.model,

            schemaVersion:
                this.schemaVersion,

            snapshotId:
                this._generateId(
                    'team-snapshot'
                ),

            analysisId:
                result.analysisId,

            tenantId:
                result.tenantId,

            organizationId:
                result.organizationId,

            branchId:
                result.branchId,

            teamId:
                result.teamId,

            teamName:
                result.teamName,

            period:
                clone(
                    result.period
                ),

            score:
                clone(
                    result.score
                ),

            workload:
                clone(
                    result.workloadAnalysis
                ),

            performanceDistribution:
                clone(
                    result.performanceDistribution
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
     * ========================================================================
     * Trend analysis
     * ========================================================================
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
                    DATA_STATUS.INSUFFICIENT,

                direction:
                    'UNKNOWN',

                current:
                    null,

                previous:
                    null,

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
                            snapshot.teamScore ??
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
                    DATA_STATUS.INSUFFICIENT,

                direction:
                    'UNKNOWN',

                current:
                    null,

                previous:
                    null,

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

        return {

            status:
                DATA_STATUS.VALID,

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
                previous !== 0
                    ? round(
                        (
                            change /
                            Math.abs(
                                previous
                            )
                        ) *
                        100,
                        2
                    )
                    : null
        };
    }

    /**
     * ========================================================================
     * Result integrity
     * ========================================================================
     */

    generateFingerprint(
        result
    ) {

        if (
            !isObject(result)
        ) {
            throw new TypeError(
                'Result must be an object.'
            );
        }

        return fingerprint({

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

            teamId:
                result.teamId,

            period:
                result.period,

            team:
                result.team,

            teamMetrics:
                result.teamMetrics,

            memberAnalysis:
                result.memberAnalysis,

            workloadAnalysis:
                result.workloadAnalysis,

            peerComparison:
                result.peerComparison,

            targetAnalysis:
                result.targetAnalysis,

            performanceDistribution:
                result.performanceDistribution,

            outliers:
                result.outliers,

            score:
                result.score,

            recommendations:
                result.recommendations,

            dataQuality:
                result.dataQuality
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
     * ========================================================================
     * Result comparison
     * ========================================================================
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
                'Current and previous analysis results are required.'
            );
        }

        const currentScore =
            toNumber(
                current.score?.score
            );

        const previousScore =
            toNumber(
                previous.score?.score
            );

        const currentConfidence =
            toNumber(
                current.score?.confidence
            );

        const previousConfidence =
            toNumber(
                previous.score?.confidence
            );

        return {

            score:
                this._compareValues(
                    currentScore,
                    previousScore
                ),

            confidence:
                this._compareValues(
                    currentConfidence,
                    previousConfidence
                ),

            workloadPressure:
                this._compareValues(
                    current.workloadAnalysis
                        ?.imbalance
                        ?.score,
                    previous.workloadAnalysis
                        ?.imbalance
                        ?.score
                ),

            backlog:
                this._compareValues(
                    current.workloadAnalysis
                        ?.totalBacklog,
                    previous.workloadAnalysis
                        ?.totalBacklog
                ),

            outliers:
                this._compareValues(
                    Array.isArray(
                        current.outliers
                    )
                        ? current.outliers.length
                        : null,
                    Array.isArray(
                        previous.outliers
                    )
                        ? previous.outliers.length
                        : null
                )
        };
    }

    _compareValues(
        current,
        previous
    ) {

        const currentNumber =
            toNumber(
                current
            );

        const previousNumber =
            toNumber(
                previous
            );

        if (
            currentNumber === null ||
            previousNumber === null
        ) {

            return {

                current:
                    currentNumber,

                previous:
                    previousNumber,

                change:
                    null,

                changePercent:
                    null
            };
        }

        return {

            current:
                round(
                    currentNumber,
                    4
                ),

            previous:
                round(
                    previousNumber,
                    4
                ),

            change:
                round(
                    currentNumber -
                    previousNumber,
                    4
                ),

            changePercent:
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

    /**
     * ========================================================================
     * Serialization
     * ========================================================================
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
     * ========================================================================
     * IDs
     * ========================================================================
     */

    _generateId(
        prefix
    ) {

        return [

            prefix,

            Date.now()
                .toString(36),

            crypto
                .randomBytes(10)
                .toString('hex')

        ].join('-');
    }

    /**
     * ========================================================================
     * Default weights
     * ========================================================================
     */

    _defaultWeights() {

        return {

            productivity:
                METRIC_DEFINITIONS
                    .productivity
                    .weight,

            efficiency:
                METRIC_DEFINITIONS
                    .efficiency
                    .weight,

            quality:
                METRIC_DEFINITIONS
                    .quality
                    .weight,

            slaCompliance:
                METRIC_DEFINITIONS
                    .slaCompliance
                    .weight,

            resolutionRate:
                METRIC_DEFINITIONS
                    .resolutionRate
                    .weight,

            utilization:
                METRIC_DEFINITIONS
                    .utilization
                    .weight,

            averageResolutionTime:
                METRIC_DEFINITIONS
                    .averageResolutionTime
                    .weight,

            backlog:
                METRIC_DEFINITIONS
                    .backlog
                    .weight
        };
    }

    /**
     * ========================================================================
     * Static factory APIs
     * ========================================================================
     */

    static create(
        options = {}
    ) {

        return new TeamPerformanceAnalyzer(
            options
        );
    }

    static analyze(
        input,
        options = {}
    ) {

        return new TeamPerformanceAnalyzer(
            options
        ).analyze(
            input
        );
    }

    static rankTeams(
        teams,
        options = {}
    ) {

        return new TeamPerformanceAnalyzer(
            options
        ).rankTeams(
            teams
        );
    }

    static rankMembers(
        members,
        options = {}
    ) {

        return new TeamPerformanceAnalyzer(
            options
        ).rankMembers(
            members
        );
    }

    static get MODEL_NAME() {
        return MODEL_NAME;
    }

    static get SCHEMA_VERSION() {
        return SCHEMA_VERSION;
    }

    static get PERFORMANCE_LEVEL() {
        return PERFORMANCE_LEVEL;
    }

    static get RISK_LEVEL() {
        return RISK_LEVEL;
    }

    static get WORKLOAD_STATUS() {
        return WORKLOAD_STATUS;
    }

    static get METRIC_DEFINITIONS() {
        return METRIC_DEFINITIONS;
    }
}

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports =
    TeamPerformanceAnalyzer;

module.exports.TeamPerformanceAnalyzer =
    TeamPerformanceAnalyzer;

module.exports.PERFORMANCE_LEVEL =
    PERFORMANCE_LEVEL;

module.exports.RISK_LEVEL =
    RISK_LEVEL;

module.exports.WORKLOAD_STATUS =
    WORKLOAD_STATUS;

module.exports.DATA_STATUS =
    DATA_STATUS;

module.exports.METRIC_DEFINITIONS =
    METRIC_DEFINITIONS;

module.exports.SCHEMA_VERSION =
    SCHEMA_VERSION;