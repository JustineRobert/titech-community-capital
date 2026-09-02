'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * ============================================================================
 *
 * Executive Dashboard Engine
 *
 * File:
 *   backend/modules/finance/statements/intelligence/executiveDashboard.js
 *
 * Responsibilities:
 *   - Generate executive dashboard snapshots
 *   - Aggregate operational intelligence
 *   - Calculate executive KPIs
 *   - Measure financial exposure
 *   - Summarize SLA compliance
 *   - Surface operational trends
 *   - Highlight organizational performance
 *   - Produce REST/BI-ready output
 *
 * Design Principles:
 *   - Stateless
 *   - Deterministic when `options.now` is supplied
 *   - Immutable
 *   - Audit ready
 *   - Dashboard ready
 *   - BI ready
 *   - Dependency isolated
 *   - Fail-safe
 *   - No database access
 *   - No persistence side effects
 *
 * ============================================================================
 */

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const DASHBOARD_VERSION =
    '1.0.0';

const DEFAULT_TOP_LIMIT =
    10;

const SEVERITY = Object.freeze({

    CRITICAL:
        'CRITICAL',

    HIGH:
        'HIGH',

    MEDIUM:
        'MEDIUM',

    LOW:
        'LOW'

});

/**
 * ============================================================================
 * ExecutiveDashboard
 * ============================================================================
 */

class ExecutiveDashboard {

    /**
     * ------------------------------------------------------------------------
     * Constructor
     * ------------------------------------------------------------------------
     *
     * @param {Object} options
     * @param {Object|null} options.analyticsEngine
     * @param {Object|null} options.agingMetrics
     * @param {Object|null} options.slaMonitor
     * @param {Object|null} options.trendDetector
     * @param {Object|null} options.recommendationEngine
     * @param {Object|null} options.riskIndexCalculator
     * @param {Object|null} options.logger
     */

    constructor({

        analyticsEngine = null,

        agingMetrics = null,

        slaMonitor = null,

        trendDetector = null,

        recommendationEngine = null,

        riskIndexCalculator = null,

        logger = null

    } = {}) {

        this.analyticsEngine =
            analyticsEngine;

        this.agingMetrics =
            agingMetrics;

        this.slaMonitor =
            slaMonitor;

        this.trendDetector =
            trendDetector;

        this.recommendationEngine =
            recommendationEngine;

        this.riskIndexCalculator =
            riskIndexCalculator;

        this.logger =
            logger;

    }

    /**
     * =========================================================================
     * Public API
     * =========================================================================
     */

    buildExecutiveDashboard(

        repairs = [],

        options = {}

    ) {

        const safeRepairs =
            this._normalizeRepairs(
                repairs
            );

        const safeOptions =
            options &&
            typeof options === 'object'
                ? options
                : {};

        const generatedAt =
            this._resolveNow(
                safeOptions.now
            );

        const analytics =
            this._executeDependency(
                'analyticsEngine',
                () =>
                    this.analyticsEngine.generateAnalytics(
                        safeRepairs
                    ),
                {}
            );

        const aging =
            this._executeDependency(
                'agingMetrics',
                () =>
                    this.agingMetrics.generateAgingDistribution(
                        safeRepairs,
                        {
                            now:
                                generatedAt
                        }
                    ),
                {}
            );

        const sla =
            this._executeDependency(
                'slaMonitor',
                () =>
                    this.slaMonitor.evaluateBatch(
                        safeRepairs,
                        {
                            now:
                                generatedAt
                        }
                    ),
                {}
            );

        const trends =
            this._executeDependency(
                'trendDetector',
                () =>
                    this.trendDetector.detectRepairTrends(
                        safeRepairs,
                        {
                            now:
                                generatedAt
                        }
                    ),
                {}
            );

        const financialExposure =
            this.calculateFinancialExposure(
                safeRepairs
            );

        const topBranches =
            this.calculateTopBranches(
                safeRepairs,
                safeOptions.topLimit
            );

        const topFailureReasons =
            this.calculateTopFailureReasons(
                safeRepairs,
                safeOptions.topLimit
            );

        const recommendations =
            this.generateRecommendations(
                safeRepairs
            );

        const riskSummary =
            this.calculateRiskSummary(
                safeRepairs
            );

        const overview =
            this._buildOverview(
                safeRepairs,
                analytics,
                aging,
                sla
            );

        const dashboard = {

            dashboardVersion:
                DASHBOARD_VERSION,

            generatedAt:
                generatedAt.toISOString(),

            generatedBy:
                'ExecutiveDashboard',

            tenantId:
                safeOptions.tenantId ||
                null,

            branchId:
                safeOptions.branchId ||
                null,

            period:
                this._normalizePeriod(
                    safeOptions.period
                ),

            overview,

            financialExposure,

            sla,

            aging,

            trends,

            topBranches,

            topFailureReasons,

            recommendations,

            riskSummary

        };

        return this._deepFreeze(
            dashboard
        );

    }

    /**
     * =========================================================================
     * Executive Overview
     * =========================================================================
     */

    _buildOverview(

        repairs,

        analytics,

        aging,

        sla

    ) {

        const totalRepairs =
            repairs.length;

        const criticalRepairs =
            repairs.filter(
                repair =>
                    this._normalizeSeverity(
                        repair.severity
                    ) ===
                    SEVERITY.CRITICAL
            ).length;

        const highRepairs =
            repairs.filter(
                repair =>
                    this._normalizeSeverity(
                        repair.severity
                    ) ===
                    SEVERITY.HIGH
            ).length;

        const openRepairs =
            repairs.filter(
                repair =>
                    this._isOpenRepair(
                        repair
                    )
            ).length;

        const closedRepairs =
            repairs.filter(
                repair =>
                    this._isClosedRepair(
                        repair
                    )
            ).length;

        const resolvedRepairs =
            repairs.filter(
                repair =>
                    this._isResolvedRepair(
                        repair
                    )
            ).length;

        const exposure =
            this.calculateFinancialExposure(
                repairs
            );

        return {

            totalRepairs,

            openRepairs,

            closedRepairs,

            resolvedRepairs,

            criticalRepairs,

            highRepairs,

            totalExposure:
                exposure.totalExposure,

            averageExposure:
                exposure.averageExposure,

            breachCount:
                this._extractBreachCount(
                    sla,
                    aging
                ),

            complianceRate:
                this._extractComplianceRate(
                    sla,
                    aging
                ),

            analytics

        };

    }

    /**
     * =========================================================================
     * Financial Exposure
     * =========================================================================
     */

    calculateFinancialExposure(
        repairs = []
    ) {

        const safeRepairs =
            this._normalizeRepairs(
                repairs
            );

        let total = 0;

        let critical = 0;

        let high = 0;

        let medium = 0;

        let low = 0;

        let unknown = 0;

        let exposureCount = 0;

        for (
            const repair of
            safeRepairs
        ) {

            const amount =
                this._extractAmount(
                    repair
                );

            /**
             * Invalid financial values are excluded rather than contaminating
             * the dashboard with NaN.
             */

            if (
                amount === null
            ) {

                continue;

            }

            exposureCount++;

            total +=
                amount;

            switch (
                this._normalizeSeverity(
                    repair.severity
                )
            ) {

                case SEVERITY.CRITICAL:

                    critical +=
                        amount;

                    break;

                case SEVERITY.HIGH:

                    high +=
                        amount;

                    break;

                case SEVERITY.MEDIUM:

                    medium +=
                        amount;

                    break;

                case SEVERITY.LOW:

                    low +=
                        amount;

                    break;

                default:

                    unknown +=
                        amount;

            }

        }

        return {

            totalExposure:
                this._round(
                    total
                ),

            criticalExposure:
                this._round(
                    critical
                ),

            highExposure:
                this._round(
                    high
                ),

            mediumExposure:
                this._round(
                    medium
                ),

            lowExposure:
                this._round(
                    low
                ),

            unknownExposure:
                this._round(
                    unknown
                ),

            averageExposure:
                exposureCount === 0
                    ? 0
                    : this._round(
                        total /
                        exposureCount
                    ),

            exposureCount

        };

    }

    /**
     * =========================================================================
     * Branch Ranking
     * =========================================================================
     */

    calculateTopBranches(

        repairs = [],

        limit =
            DEFAULT_TOP_LIMIT

    ) {

        const safeRepairs =
            this._normalizeRepairs(
                repairs
            );

        const safeLimit =
            this._normalizeLimit(
                limit
            );

        const map =
            new Map();

        for (
            const repair of
            safeRepairs
        ) {

            const branch =
                this._normalizeLabel(
                    repair.branchId ||
                    repair.branch ||
                    repair.branchCode,
                    'UNKNOWN'
                );

            const current =
                map.get(
                    branch
                ) || {

                    branch,

                    repairs:
                        0,

                    exposure:
                        0,

                    critical:
                        0,

                    high:
                        0

                };

            current.repairs +=
                1;

            const amount =
                this._extractAmount(
                    repair
                );

            if (
                amount !== null
            ) {

                current.exposure +=
                    amount;

            }

            const severity =
                this._normalizeSeverity(
                    repair.severity
                );

            if (
                severity ===
                SEVERITY.CRITICAL
            ) {

                current.critical++;

            }

            if (
                severity ===
                SEVERITY.HIGH
            ) {

                current.high++;

            }

            map.set(
                branch,
                current
            );

        }

        return [
            ...map.values()
        ]
            .map(
                entry => ({

                    branch:
                        entry.branch,

                    repairs:
                        entry.repairs,

                    exposure:
                        this._round(
                            entry.exposure
                        ),

                    critical:
                        entry.critical,

                    high:
                        entry.high

                })
            )
            .sort(
                (
                    a,
                    b
                ) => {

                    if (
                        b.repairs !==
                        a.repairs
                    ) {

                        return (
                            b.repairs -
                            a.repairs
                        );

                    }

                    return (
                        b.exposure -
                        a.exposure
                    );

                }
            )
            .slice(
                0,
                safeLimit
            );

    }

    /**
     * =========================================================================
     * Failure Reasons
     * =========================================================================
     */

    calculateTopFailureReasons(

        repairs = [],

        limit =
            DEFAULT_TOP_LIMIT

    ) {

        const safeRepairs =
            this._normalizeRepairs(
                repairs
            );

        const safeLimit =
            this._normalizeLimit(
                limit
            );

        const map =
            new Map();

        for (
            const repair of
            safeRepairs
        ) {

            const reason =
                this._normalizeLabel(

                    repair.failureReason ||

                    repair.reason ||

                    repair.failureCode ||

                    repair.type,

                    'UNKNOWN'
                );

            const current =
                map.get(
                    reason
                ) || {

                    reason,

                    count:
                        0,

                    exposure:
                        0

                };

            current.count++;

            const amount =
                this._extractAmount(
                    repair
                );

            if (
                amount !== null
            ) {

                current.exposure +=
                    amount;

            }

            map.set(
                reason,
                current
            );

        }

        return [
            ...map.values()
        ]
            .map(
                entry => ({

                    reason:
                        entry.reason,

                    count:
                        entry.count,

                    exposure:
                        this._round(
                            entry.exposure
                        )

                })
            )
            .sort(
                (
                    a,
                    b
                ) => {

                    if (
                        b.count !==
                        a.count
                    ) {

                        return (
                            b.count -
                            a.count
                        );

                    }

                    return (
                        b.exposure -
                        a.exposure
                    );

                }
            )
            .slice(
                0,
                safeLimit
            );

    }

    /**
     * =========================================================================
     * Recommendations
     * =========================================================================
     */

    generateRecommendations(
        repairs = []
    ) {

        if (
            !this.recommendationEngine ||
            typeof this.recommendationEngine.recommendAction !==
                'function'
        ) {

            return [];

        }

        const recommendations = [];

        for (
            let index = 0;
            index < repairs.length;
            index++
        ) {

            const repair =
                repairs[index];

            try {

                const recommendation =
                    this.recommendationEngine.recommendAction(
                        repair
                    );

                if (
                    recommendation ===
                    undefined ||
                    recommendation ===
                    null
                ) {

                    continue;

                }

                recommendations.push({

                    repairId:
                        repair.repairId ||
                        repair.id ||
                        repair._id ||
                        null,

                    recommendation

                });

            } catch (
                error
            ) {

                this._log(
                    'warn',
                    'Failed to generate repair recommendation.',
                    {
                        repairIndex:
                            index,

                        repairId:
                            repair.repairId ||
                            repair.id ||
                            repair._id ||
                            null,

                        error:
                            error.message
                    }
                );

            }

        }

        return recommendations;

    }

    /**
     * =========================================================================
     * Risk Summary
     * =========================================================================
     */

    calculateRiskSummary(
        repairs = []
    ) {

        if (
            !this.riskIndexCalculator ||
            typeof this.riskIndexCalculator.calculateRiskIndex !==
                'function'
        ) {

            return {

                averageRisk:
                    0,

                highestRisk:
                    0,

                lowestRisk:
                    0,

                riskCount:
                    0,

                highRiskCount:
                    0,

                criticalRiskCount:
                    0

            };

        }

        const scores = [];

        for (
            const repair of
            repairs
        ) {

            try {

                const result =
                    this.riskIndexCalculator.calculateRiskIndex(
                        repair
                    );

                const score =
                    this._extractRiskScore(
                        result
                    );

                if (
                    score !== null
                ) {

                    scores.push(
                        score
                    );

                }

            } catch (
                error
            ) {

                this._log(
                    'warn',
                    'Failed to calculate repair risk score.',
                    {
                        repairId:
                            repair.repairId ||
                            repair.id ||
                            repair._id ||
                            null,

                        error:
                            error.message
                    }
                );

            }

        }

        if (
            scores.length === 0
        ) {

            return {

                averageRisk:
                    0,

                highestRisk:
                    0,

                lowestRisk:
                    0,

                riskCount:
                    0,

                highRiskCount:
                    0,

                criticalRiskCount:
                    0

            };

        }

        const total =
            scores.reduce(
                (
                    sum,
                    value
                ) =>
                    sum +
                    value,
                0
            );

        return {

            averageRisk:
                this._round(
                    total /
                    scores.length
                ),

            highestRisk:
                this._round(
                    Math.max(
                        ...scores
                    )
                ),

            lowestRisk:
                this._round(
                    Math.min(
                        ...scores
                    )
                ),

            riskCount:
                scores.length,

            highRiskCount:
                scores.filter(
                    score =>
                        score >= 70
                ).length,

            criticalRiskCount:
                scores.filter(
                    score =>
                        score >= 90
                ).length

        };

    }

    /**
     * =========================================================================
     * Repair Status Helpers
     * =========================================================================
     */

    _isOpenRepair(
        repair
    ) {

        const status =
            this._normalizeStatus(
                repair.status
            );

        return [

            'OPEN',
            'PENDING',
            'IN_PROGRESS',
            'ESCALATED',
            'REPAIR_PENDING',
            'UNDER_REVIEW'

        ].includes(
            status
        );

    }

    _isClosedRepair(
        repair
    ) {

        const status =
            this._normalizeStatus(
                repair.status
            );

        return [

            'CLOSED',
            'RESOLVED',
            'COMPLETED',
            'REPAIRED',
            'CANCELLED',
            'REJECTED'

        ].includes(
            status
        );

    }

    _isResolvedRepair(
        repair
    ) {

        const status =
            this._normalizeStatus(
                repair.status
            );

        return [

            'RESOLVED',
            'COMPLETED',
            'REPAIRED',
            'CLOSED'

        ].includes(
            status
        );

    }

    /**
     * =========================================================================
     * Amount Extraction
     * =========================================================================
     */

    _extractAmount(
        repair
    ) {

        const candidates = [

            repair.amount,

            repair.exposureAmount,

            repair.evidence &&
                repair.evidence.amount,

            repair.transaction &&
                repair.transaction.amount

        ];

        for (
            const candidate of
            candidates
        ) {

            if (
                candidate ===
                null ||
                candidate ===
                undefined ||
                candidate ===
                ''
            ) {

                continue;

            }

            const amount =
                Number(
                    candidate
                );

            if (
                Number.isFinite(
                    amount
                )
            ) {

                /**
                 * Financial exposure should not silently become negative.
                 * Negative accounting values can still be represented by the
                 * underlying transaction, but exposure is an absolute risk
                 * measure.
                 */

                return Math.abs(
                    amount
                );

            }

        }

        return null;

    }

    /**
     * =========================================================================
     * Risk Score Extraction
     * =========================================================================
     */

    _extractRiskScore(
        result
    ) {

        if (
            result ===
            null ||
            result ===
            undefined
        ) {

            return null;

        }

        const raw =
            typeof result === 'object'
                ? (
                    result.score ??
                    result.riskScore ??
                    result.value
                )
                : result;

        const score =
            Number(
                raw
            );

        if (
            !Number.isFinite(
                score
            )
        ) {

            return null;

        }

        return Math.min(
            100,
            Math.max(
                0,
                score
            )
        );

    }

    /**
     * =========================================================================
     * SLA Helpers
     * =========================================================================
     */

    _extractBreachCount(
        sla,
        aging
    ) {

        const candidates = [

            sla &&
                sla.breached,

            sla &&
                sla.breachedCount,

            sla &&
                sla.slaBreaches,

            aging &&
                aging.breached

        ];

        for (
            const candidate of
            candidates
        ) {

            const value =
                Number(
                    candidate
                );

            if (
                Number.isFinite(
                    value
                )
            ) {

                return value;

            }

        }

        return 0;

    }

    _extractComplianceRate(
        sla,
        aging
    ) {

        const candidates = [

            sla &&
                sla.complianceRate,

            sla &&
                sla.slaComplianceRate,

            aging &&
                aging.complianceRate

        ];

        for (
            const candidate of
            candidates
        ) {

            const value =
                Number(
                    candidate
                );

            if (
                Number.isFinite(
                    value
                )
            ) {

                return Math.min(
                    100,
                    Math.max(
                        0,
                        this._round(
                            value
                        )
                    )
                );

            }

        }

        return 0;

    }

    /**
     * =========================================================================
     * Dependency Execution
     * =========================================================================
     *
     * Dashboard generation should degrade gracefully when an optional
     * intelligence dependency is unavailable.
     * =========================================================================
     */

    _executeDependency(

        dependencyName,

        operation,

        fallback

    ) {

        try {

            const dependency =
                this[
                    dependencyName
                ];

            if (
                !dependency
            ) {

                return fallback;

            }

            return operation();

        } catch (
            error
        ) {

            this._log(
                'warn',
                `Executive dashboard dependency failed: ${dependencyName}.`,
                {
                    dependency:
                        dependencyName,

                    error:
                        error.message
                }
            );

            return fallback;

        }

    }

    /**
     * =========================================================================
     * Input Normalization
     * =========================================================================
     */

    _normalizeRepairs(
        repairs
    ) {

        if (
            !Array.isArray(
                repairs
            )
        ) {

            return [];

        }

        return repairs.filter(
            repair =>
                repair &&
                typeof repair ===
                'object'
        );

    }

    _normalizeSeverity(
        severity
    ) {

        if (
            !severity
        ) {

            return SEVERITY.LOW;

        }

        return String(
            severity
        )
            .trim()
            .toUpperCase();

    }

    _normalizeStatus(
        status
    ) {

        if (
            !status
        ) {

            return '';

        }

        return String(
            status
        )
            .trim()
            .toUpperCase();

    }

    _normalizeLabel(
        value,
        fallback
    ) {

        if (
            value ===
            null ||
            value ===
            undefined
        ) {

            return fallback;

        }

        const normalized =
            String(
                value
            )
                .trim();

        return normalized ||
            fallback;

    }

    _normalizeLimit(
        limit
    ) {

        const numeric =
            Number(
                limit
            );

        if (
            !Number.isFinite(
                numeric
            ) ||
            numeric <= 0
        ) {

            return DEFAULT_TOP_LIMIT;

        }

        return Math.min(
            100,
            Math.floor(
                numeric
            )
        );

    }

    /**
     * =========================================================================
     * Period Normalization
     * =========================================================================
     */

    _normalizePeriod(
        period
    ) {

        if (
            !period ||
            typeof period !==
                'object'
        ) {

            return null;

        }

        const result = {};

        if (
            period.from
        ) {

            const from =
                this._parseDate(
                    period.from
                );

            if (
                from
            ) {

                result.from =
                    from.toISOString();

            }

        }

        if (
            period.to
        ) {

            const to =
                this._parseDate(
                    period.to
                );

            if (
                to
            ) {

                result.to =
                    to.toISOString();

            }

        }

        if (
            period.label
        ) {

            result.label =
                String(
                    period.label
                );

        }

        return Object.keys(
            result
        ).length > 0
            ? result
            : null;

    }

    /**
     * =========================================================================
     * Date Handling
     * =========================================================================
     */

    _resolveNow(
        value
    ) {

        if (
            value ===
            undefined ||
            value ===
            null
        ) {

            return new Date();

        }

        const date =
            this._parseDate(
                value
            );

        if (
            !date
        ) {

            throw new TypeError(
                'options.now must be a valid date.'
            );

        }

        return date;

    }

    _parseDate(
        value
    ) {

        if (
            value instanceof Date
        ) {

            return Number.isNaN(
                value.getTime()
            )
                ? null
                : new Date(
                    value.getTime()
                );

        }

        const parsed =
            new Date(
                value
            );

        return Number.isNaN(
            parsed.getTime()
        )
            ? null
            : parsed;

    }

    /**
     * =========================================================================
     * Numeric Helpers
     * =========================================================================
     */

    _round(
        value,
        decimals = 2
    ) {

        const numeric =
            Number(
                value
            );

        if (
            !Number.isFinite(
                numeric
            )
        ) {

            return 0;

        }

        const factor =
            10 ** decimals;

        return Number(
            (
                Math.round(
                    numeric *
                    factor
                ) /
                factor
            ).toFixed(
                decimals
            )
        );

    }

    /**
     * =========================================================================
     * Deep Freeze
     * =========================================================================
     */

    _deepFreeze(
        value,
        seen = new WeakSet()
    ) {

        if (
            value ===
            null ||
            typeof value !==
                'object'
        ) {

            return value;

        }

        if (
            seen.has(
                value
            )
        ) {

            return value;

        }

        seen.add(
            value
        );

        for (
            const key of
            Object.keys(
                value
            )
        ) {

            this._deepFreeze(
                value[key],
                seen
            );

        }

        return Object.freeze(
            value
        );

    }

    /**
     * =========================================================================
     * Logging
     * =========================================================================
     */

    _log(
        level,
        message,
        metadata = {}
    ) {

        if (
            !this.logger
        ) {

            return;

        }

        try {

            if (
                typeof this.logger[level] ===
                'function'
            ) {

                this.logger[level](
                    message,
                    metadata
                );

                return;

            }

            if (
                typeof this.logger.log ===
                'function'
            ) {

                this.logger.log(
                    message,
                    metadata
                );

            }

        } catch (
            error
        ) {

            /**
             * Logging must never break dashboard generation.
             */

        }

    }

}

/**
 * ============================================================================
 * Public Exports
 * ============================================================================
 */

module.exports =
    ExecutiveDashboard;

module.exports.ExecutiveDashboard =
    ExecutiveDashboard;

module.exports.DASHBOARD_VERSION =
    DASHBOARD_VERSION;

module.exports.SEVERITY =
    SEVERITY;