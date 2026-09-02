'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Statement Repair Trend Detector
 * ============================================================================
 *
 * File:
 * backend/modules/finance/statements/intelligence/trendDetector.js
 *
 * Purpose
 * -------
 * Enterprise operational trend-analysis engine for Statement Repair
 * Intelligence.
 *
 * Responsibilities
 * ---------------
 * • Detect operational repair trends
 * • Identify recurring financial issues
 * • Compare current activity against historical baselines
 * • Detect increasing/decreasing/stable failure patterns
 * • Detect branch anomalies
 * • Detect provider-specific issues
 * • Detect integration degradation
 * • Detect month-end repair concentration
 * • Produce explainable trend analysis
 * • Support executive dashboards
 * • Support operational reporting
 * • Provide deterministic ML integration boundary
 *
 * Design Principles
 * -----------------
 * • Stateless
 * • Deterministic
 * • No database access
 * • No side effects
 * • Immutable outputs
 * • Explainable
 * • Audit friendly
 * • Multi-tenant ready
 * • BI ready
 * • ML ready
 *
 * ============================================================================
 */

/**
 * ============================================================================
 * Trend Direction
 * ============================================================================
 */

const TREND_DIRECTION = Object.freeze({

    INCREASING: 'INCREASING',

    DECREASING: 'DECREASING',

    STABLE: 'STABLE'
});

/**
 * ============================================================================
 * Trend Type
 * ============================================================================
 */

const TREND_TYPE = Object.freeze({

    SETTLEMENT_FAILURES:
        'SETTLEMENT_FAILURES',

    DUPLICATE_POSTINGS:
        'DUPLICATE_POSTINGS',

    BRANCH_ANOMALIES:
        'BRANCH_ANOMALIES',

    LEDGER_MAPPING_FAILURES:
        'LEDGER_MAPPING_FAILURES',

    PROVIDER_ISSUES:
        'PROVIDER_ISSUES',

    INTEGRATION_FAILURES:
        'INTEGRATION_FAILURES',

    MONTH_END_SPIKES:
        'MONTH_END_SPIKES'
});

/**
 * ============================================================================
 * Trend Severity
 * ============================================================================
 */

const TREND_SEVERITY = Object.freeze({

    LOW: 'LOW',

    MEDIUM: 'MEDIUM',

    HIGH: 'HIGH',

    CRITICAL: 'CRITICAL'
});

/**
 * ============================================================================
 * Default Configuration
 * ============================================================================
 *
 * sensitivity
 * -----------
 * Minimum percentage-point change required to classify a trend as increasing
 * or decreasing.
 *
 * minimumSampleSize
 * -----------------
 * Minimum number of records required before confidence can become strong.
 *
 * baselinePeriods
 * ---------------
 * Number of historical periods used for baseline comparison.
 *
 * monthEndStartDay
 * ----------------
 * Month-end concentration begins at this calendar day.
 *
 * ============================================================================
 */

const DEFAULT_OPTIONS = Object.freeze({

    sensitivity: 10,

    minimumSampleSize: 5,

    baselinePeriods: 3,

    monthEndStartDay: 27,

    highRiskRatio: 30,

    criticalRiskRatio: 50
});

/**
 * ============================================================================
 * Model Version
 * ============================================================================
 */

const MODEL_VERSION =
    'STATEMENT_REPAIR_TREND_MODEL_V1';

/**
 * ============================================================================
 * Time Constants
 * ============================================================================
 */

const MS_PER_DAY =
    86400000;

/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

/**
 * Convert value to finite number.
 *
 * @param {*} value
 * @param {number} fallback
 * @returns {number}
 */
function toFiniteNumber(
    value,
    fallback = 0
) {

    const number =
        Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}

/**
 * Clamp number.
 *
 * @param {number} value
 * @param {number} minimum
 * @param {number} maximum
 * @returns {number}
 */
function clamp(
    value,
    minimum,
    maximum
) {

    return Math.min(

        maximum,

        Math.max(
            minimum,
            value
        )
    );
}

/**
 * Normalize a string enum.
 *
 * @param {*} value
 * @param {string} fallback
 * @returns {string}
 */
function normalizeString(
    value,
    fallback = 'UNKNOWN'
) {

    if (
        typeof value !== 'string' ||
        value.trim() === ''
    ) {

        return fallback;
    }

    return value
        .trim()
        .toUpperCase();
}

/**
 * Convert date to timestamp.
 *
 * @param {*} value
 * @returns {number|null}
 */
function toTimestamp(
    value
) {

    if (
        value === null ||
        value === undefined
    ) {

        return null;
    }

    const timestamp =
        new Date(value).getTime();

    return Number.isFinite(timestamp)
        ? timestamp
        : null;
}

/**
 * Round number to fixed precision.
 *
 * @param {number} value
 * @param {number} decimals
 * @returns {number}
 */
function round(
    value,
    decimals = 2
) {

    return Number(
        Number(value).toFixed(
            decimals
        )
    );
}

/**
 * Freeze object.
 *
 * @param {object} value
 * @returns {object}
 */
function freezeObject(
    value
) {

    return Object.freeze({
        ...value
    });
}

/**
 * Freeze array copy.
 *
 * @param {Array} value
 * @returns {Array}
 */
function freezeArray(
    value
) {

    return Object.freeze([
        ...value
    ]);
}

/**
 * ============================================================================
 * Trend Detector
 * ============================================================================
 */

class TrendDetector {

    /**
     * =========================================================================
     * Constructor
     * =========================================================================
     *
     * @param {object} options
     * @param {object} options.mlProvider
     * @param {object} options.config
     */
    constructor({

        mlProvider = null,

        config = {}

    } = {}) {

        this.mlProvider =
            mlProvider;

        this.config =
            freezeObject({

                ...DEFAULT_OPTIONS,

                ...(config || {})
            });

        this.validateConfiguration();

        this.modelVersion =
            MODEL_VERSION;
    }

    /**
     * =========================================================================
     * Public API — Detect Repair Trends
     * =========================================================================
     *
     * @param {Array} history
     * @returns {object}
     */
    detectRepairTrends(
        history = []
    ) {

        this.assertHistory(
            history
        );

        const normalizedHistory =
            this.normalizeHistory(
                history
            );

        const trends =
            {

                settlementFailures:
                    this.detectSettlementFailures(
                        normalizedHistory
                    ),

                duplicatePostings:
                    this.detectDuplicatePostings(
                        normalizedHistory
                    ),

                branchAnomalies:
                    this.detectBranchAnomalies(
                        normalizedHistory
                    ),

                ledgerMappingFailures:
                    this.detectLedgerMappingFailures(
                        normalizedHistory
                    ),

                providerIssues:
                    this.detectProviderIssues(
                        normalizedHistory
                    ),

                integrationFailures:
                    this.detectIntegrationFailures(
                        normalizedHistory
                    ),

                monthEndRepairSpikes:
                    this.detectMonthEndRepairSpikes(
                        normalizedHistory
                    )
            };

        const result =
            Object.freeze({

                modelVersion:
                    this.modelVersion,

                sampleSize:
                    normalizedHistory.length,

                validRecords:
                    normalizedHistory.filter(
                        repair =>
                            repair.__validDate === true
                    ).length,

                invalidRecords:
                    normalizedHistory.filter(
                        repair =>
                            repair.__validDate !== true
                    ).length,

                trends:
                    freezeObject(
                        trends
                    ),

                generatedAt:
                    new Date()
            });

        /**
         * ML is strictly an extension layer.
         *
         * The deterministic baseline remains available to the ML provider.
         */
        if (

            this.mlProvider &&

            typeof
                this.mlProvider.detectRepairTrends ===
                'function'

        ) {

            const mlResult =
                this.mlProvider.detectRepairTrends(

                    normalizedHistory,

                    result
                );

            if (
                mlResult &&
                typeof mlResult === 'object'
            ) {

                return Object.freeze({

                    ...result,

                    ml:
                        freezeObject({
                            ...mlResult
                        })
                });
            }
        }

        return result;
    }

    /**
     * =========================================================================
     * Settlement Failures
     * =========================================================================
     */

    detectSettlementFailures(
        history
    ) {

        return this.analyzeBooleanTrend(

            history,

            repair =>
                repair.failedSettlement === true ||

                repair.settlementFailure === true,

            TREND_TYPE.SETTLEMENT_FAILURES
        );
    }

    /**
     * =========================================================================
     * Duplicate Postings
     * =========================================================================
     */

    detectDuplicatePostings(
        history
    ) {

        return this.analyzeBooleanTrend(

            history,

            repair =>
                repair.duplicate === true ||

                repair.duplicatePosting === true,

            TREND_TYPE.DUPLICATE_POSTINGS
        );
    }

    /**
     * =========================================================================
     * Ledger Mapping Failures
     * =========================================================================
     */

    detectLedgerMappingFailures(
        history
    ) {

        return this.analyzeBooleanTrend(

            history,

            repair =>
                repair.accountMappingError === true ||

                repair.invalidAccount === true ||

                repair.ledgerMappingFailure === true,

            TREND_TYPE.LEDGER_MAPPING_FAILURES
        );
    }

    /**
     * =========================================================================
     * Integration Failures
     * =========================================================================
     */

    detectIntegrationFailures(
        history
    ) {

        return this.analyzeBooleanTrend(

            history,

            repair =>
                repair.integrationFailure === true ||

                repair.processingError === true ||

                repair.systemFailure === true,

            TREND_TYPE.INTEGRATION_FAILURES
        );
    }

    /**
     * =========================================================================
     * Provider Issues
     * =========================================================================
     *
     * Provider analysis is based on failure-related repairs rather than simply
     * counting every repair associated with a provider.
     * =========================================================================
     */

    detectProviderIssues(
        history
    ) {

        const providers =
            {};

        const totalByProvider =
            {};

        history.forEach(
            repair => {

                const provider =
                    normalizeString(
                        repair.provider
                    );

                totalByProvider[
                    provider
                ] =
                    (
                        totalByProvider[
                            provider
                        ] ||
                        0
                    ) + 1;

                const isIssue =
                    this.isProviderIssue(
                        repair
                    );

                if (
                    isIssue
                ) {

                    providers[
                        provider
                    ] =
                        (
                            providers[
                                provider
                            ] ||
                            0
                        ) + 1;
                }
            }
        );

        const ranked =
            Object.entries(
                totalByProvider
            )

                .map(
                    ([provider, total]) => {

                        const issues =
                            providers[
                                provider
                            ] || 0;

                        const issueRate =
                            total === 0
                                ? 0
                                : (
                                    issues /
                                    total
                                ) *
                                100;

                        return {

                            provider,

                            repairs:
                                total,

                            issues,

                            issueRate:
                                round(
                                    issueRate
                                ),

                            severity:
                                this.resolveTrendSeverity(
                                    issueRate
                                )
                        };
                    }
                )

                .sort(
                    (a, b) => {

                        if (
                            b.issueRate !==
                            a.issueRate
                        ) {

                            return (
                                b.issueRate -
                                a.issueRate
                            );
                        }

                        if (
                            b.issues !==
                            a.issues
                        ) {

                            return (
                                b.issues -
                                a.issues
                            );
                        }

                        return a.provider.localeCompare(
                            b.provider
                        );
                    }
                );

        return Object.freeze({

            type:
                TREND_TYPE.PROVIDER_ISSUES,

            affectedProviders:
                freezeObject(
                    providers
                ),

            providers:
                freezeArray(
                    ranked
                ),

            topProvider:
                ranked[0] || null,

            direction:
                this.resolveRankingDirection(
                    ranked
                ),

            recommendation:
                ranked.length > 0 &&
                ranked[0].severity !==
                    TREND_SEVERITY.LOW

                    ? 'INVESTIGATE_PROVIDER'

                    : 'MONITOR'
        });
    }

    /**
     * =========================================================================
     * Branch Anomalies
     * =========================================================================
     *
     * A branch is not automatically "high risk" merely because it has more
     * repairs. This implementation compares each branch's repair rate against
     * the overall population.
     * =========================================================================
     */

    detectBranchAnomalies(
        history
    ) {

        const branchTotals =
            {};

        const branchIssues =
            {};

        history.forEach(
            repair => {

                const branch =
                    String(
                        repair.branchId ??
                        repair.branch ??
                        'UNKNOWN'
                    );

                branchTotals[
                    branch
                ] =
                    (
                        branchTotals[
                            branch
                        ] ||
                        0
                    ) + 1;

                if (
                    this.isOperationalIssue(
                        repair
                    )
                ) {

                    branchIssues[
                        branch
                    ] =
                        (
                            branchIssues[
                                branch
                            ] ||
                            0
                        ) + 1;
                }
            }
        );

        const totalRepairs =
            history.length;

        const totalIssues =
            Object.values(
                branchIssues
            ).reduce(
                (sum, value) =>
                    sum + value,
                0
            );

        const overallIssueRate =
            totalRepairs === 0
                ? 0
                : (
                    totalIssues /
                    totalRepairs
                ) *
                100;

        const ranked =
            Object.entries(
                branchTotals
            )

                .map(
                    ([branch, repairs]) => {

                        const issues =
                            branchIssues[
                                branch
                            ] || 0;

                        const issueRate =
                            repairs === 0
                                ? 0
                                : (
                                    issues /
                                    repairs
                                ) *
                                100;

                        const deviation =
                            issueRate -
                            overallIssueRate;

                        return {

                            branch,

                            repairs,

                            issues,

                            issueRate:
                                round(
                                    issueRate
                                ),

                            deviationFromOverallRate:
                                round(
                                    deviation
                                ),

                            anomalous:
                                deviation >=
                                this.config.sensitivity,

                            severity:
                                this.resolveTrendSeverity(
                                    issueRate
                                )
                        };
                    }
                )

                .sort(
                    (a, b) => {

                        if (
                            b.deviationFromOverallRate !==
                            a.deviationFromOverallRate
                        ) {

                            return (
                                b.deviationFromOverallRate -
                                a.deviationFromOverallRate
                            );
                        }

                        if (
                            b.issueRate !==
                            a.issueRate
                        ) {

                            return (
                                b.issueRate -
                                a.issueRate
                            );
                        }

                        return a.branch.localeCompare(
                            b.branch
                        );
                    }
                );

        const anomalousBranches =
            ranked.filter(
                branch =>
                    branch.anomalous
            );

        return Object.freeze({

            type:
                TREND_TYPE.BRANCH_ANOMALIES,

            overallIssueRate:
                round(
                    overallIssueRate
                ),

            affectedBranches:
                freezeArray(
                    ranked
                ),

            anomalousBranches:
                freezeArray(
                    anomalousBranches
                ),

            highestRiskBranch:
                anomalousBranches[0] ||
                ranked[0] ||
                null,

            recommendation:
                anomalousBranches.length > 0
                    ? 'INVESTIGATE_BRANCH'
                    : 'MONITOR'
        });
    }

    /**
     * =========================================================================
     * Month-End Repair Spikes
     * =========================================================================
     *
     * Instead of assuming that >25% of repairs near month-end is a spike,
     * compare month-end concentration against the non-month-end population.
     * =========================================================================
     */

    detectMonthEndRepairSpikes(
        history
    ) {

        const valid =
            history.filter(
                repair =>
                    repair.__validDate === true
            );

        const monthEndRepairs =
            valid.filter(
                repair =>
                    this.isMonthEndRepair(
                        repair
                    )
            );

        const nonMonthEndRepairs =
            valid.filter(
                repair =>
                    !this.isMonthEndRepair(
                        repair
                    )
            );

        const total =
            valid.length;

        const monthEndCount =
            monthEndRepairs.length;

        const monthEndRatio =
            total === 0
                ? 0
                : (
                    monthEndCount /
                    total
                ) *
                100;

        /**
         * Compare average daily volume around month-end against the rest of
         * the observed population where possible.
         */
        const monthEndDays =
            this.groupByCalendarDay(
                monthEndRepairs
            );

        const nonMonthEndDays =
            this.groupByCalendarDay(
                nonMonthEndRepairs
            );

        const monthEndAverage =
            this.averageGroupSize(
                monthEndDays
            );

        const nonMonthEndAverage =
            this.averageGroupSize(
                nonMonthEndDays
            );

        const spikeRatio =
            nonMonthEndAverage === 0
                ? monthEndAverage > 0
                    ? 100
                    : 0
                : (
                    (
                        monthEndAverage -
                        nonMonthEndAverage
                    ) /
                    nonMonthEndAverage
                ) *
                100;

        const detected =
            monthEndRatio >=
                this.config.highRiskRatio ||

            spikeRatio >=
                this.config.sensitivity;

        return Object.freeze({

            type:
                TREND_TYPE.MONTH_END_SPIKES,

            repairs:
                monthEndCount,

            totalRepairs:
                total,

            ratio:
                round(
                    monthEndRatio
                ),

            averageMonthEndDailyVolume:
                round(
                    monthEndAverage
                ),

            averageNonMonthEndDailyVolume:
                round(
                    nonMonthEndAverage
                ),

            spikeRatio:
                round(
                    spikeRatio
                ),

            detected,

            direction:
                detected
                    ? TREND_DIRECTION.INCREASING
                    : TREND_DIRECTION.STABLE,

            severity:
                this.resolveTrendSeverity(
                    Math.max(
                        monthEndRatio,
                        spikeRatio
                    )
                ),

            recommendation:
                detected
                    ? 'INVESTIGATE_MONTH_END_CAPACITY'
                    : 'MONITOR'
        });
    }

    /**
     * =========================================================================
     * Generic Boolean Trend
     * =========================================================================
     *
     * This method compares earlier records with later records.
     *
     * It therefore measures a real temporal change instead of calling a
     * high/low prevalence ratio "increasing" or "decreasing".
     * =========================================================================
     */

    analyzeBooleanTrend(
        history,
        predicate,
        type
    ) {

        const valid =
            history.filter(
                repair =>
                    repair.__validDate === true
            );

        const sorted =
            [...valid].sort(
                (a, b) =>
                    a.__timestamp -
                    b.__timestamp
            );

        const total =
            sorted.length;

        if (
            total === 0
        ) {

            return Object.freeze({

                type,

                count: 0,

                ratio: 0,

                direction:
                    TREND_DIRECTION.STABLE,

                change:
                    0,

                baselineRate:
                    0,

                currentRate:
                    0,

                confidence:
                    0,

                severity:
                    TREND_SEVERITY.LOW,

                recommendation:
                    'MONITOR',

                sampleSize:
                    0,

                explanation:
                    'No valid dated repair records available.'
            });
        }

        const midpoint =
            Math.floor(
                total / 2
            );

        const baseline =
            sorted.slice(
                0,
                midpoint
            );

        const current =
            sorted.slice(
                midpoint
            );

        const baselineMatches =
            baseline.filter(
                predicate
            ).length;

        const currentMatches =
            current.filter(
                predicate
            ).length;

        const baselineRate =
            baseline.length === 0
                ? 0
                : (
                    baselineMatches /
                    baseline.length
                ) *
                100;

        const currentRate =
            current.length === 0
                ? 0
                : (
                    currentMatches /
                    current.length
                ) *
                100;

        const change =
            currentRate -
            baselineRate;

        const direction =
            this.resolveDirection(
                change
            );

        const overallMatches =
            sorted.filter(
                predicate
            ).length;

        const overallRatio =
            total === 0
                ? 0
                : (
                    overallMatches /
                    total
                ) *
                100;

        const confidence =
            this.calculateConfidence(
                baseline.length,
                current.length,
                Math.abs(change)
            );

        const severity =
            this.resolveTrendSeverity(
                Math.max(
                    currentRate,
                    overallRatio
                )
            );

        const recommendation =
            this.resolveTrendRecommendation(
                direction,
                severity
            );

        return Object.freeze({

            type,

            count:
                overallMatches,

            ratio:
                round(
                    overallRatio
                ),

            baselineRate:
                round(
                    baselineRate
                ),

            currentRate:
                round(
                    currentRate
                ),

            change:
                round(
                    change
                ),

            direction,

            confidence,

            severity,

            recommendation,

            sampleSize:
                total,

            baselineSampleSize:
                baseline.length,

            currentSampleSize:
                current.length,

            explanation:
                this.buildTrendExplanation(
                    type,
                    direction,
                    baselineRate,
                    currentRate,
                    change
                )
        });
    }

    /**
     * =========================================================================
     * Direction Resolution
     * =========================================================================
     */

    resolveDirection(
        change
    ) {

        if (
            change >=
            this.config.sensitivity
        ) {

            return TREND_DIRECTION.INCREASING;
        }

        if (
            change <=
            -this.config.sensitivity
        ) {

            return TREND_DIRECTION.DECREASING;
        }

        return TREND_DIRECTION.STABLE;
    }

    /**
     * =========================================================================
     * Confidence
     * =========================================================================
     *
     * Confidence considers both sample size and magnitude of change.
     * It is intentionally deterministic and not a statistical probability.
     * =========================================================================
     */

    calculateConfidence(
        baselineSize,
        currentSize,
        changeMagnitude
    ) {

        const sampleSize =
            Math.min(
                baselineSize,
                currentSize
            );

        if (
            sampleSize <= 0
        ) {

            return 0;
        }

        const sampleFactor =
            clamp(

                (
                    sampleSize /
                    this.config.minimumSampleSize
                ) *
                50,

                0,

                50
            );

        const changeFactor =
            clamp(

                (
                    changeMagnitude /
                    50
                ) *
                50,

                0,

                50
            );

        return Math.round(
            sampleFactor +
            changeFactor
        );
    }

    /**
     * =========================================================================
     * Trend Severity
     * =========================================================================
     */

    resolveTrendSeverity(
        ratio
    ) {

        if (
            ratio >=
            this.config.criticalRiskRatio
        ) {

            return TREND_SEVERITY.CRITICAL;
        }

        if (
            ratio >=
            this.config.highRiskRatio
        ) {

            return TREND_SEVERITY.HIGH;
        }

        if (
            ratio >=
            this.config.sensitivity
        ) {

            return TREND_SEVERITY.MEDIUM;
        }

        return TREND_SEVERITY.LOW;
    }

    /**
     * =========================================================================
     * Trend Recommendation
     * =========================================================================
     */

    resolveTrendRecommendation(
        direction,
        severity
    ) {

        if (
            severity ===
            TREND_SEVERITY.CRITICAL
        ) {

            return 'IMMEDIATE_INVESTIGATION';
        }

        if (
            severity ===
            TREND_SEVERITY.HIGH
        ) {

            return 'INVESTIGATE';
        }

        if (
            direction ===
            TREND_DIRECTION.INCREASING
        ) {

            return 'MONITOR_CLOSELY';
        }

        return 'MONITOR';
    }

    /**
     * =========================================================================
     * Trend Explanation
     * =========================================================================
     */

    buildTrendExplanation(
        type,
        direction,
        baselineRate,
        currentRate,
        change
    ) {

        const readableType =
            String(type)
                .toLowerCase()
                .replace(
                    /_/g,
                    ' '
                );

        if (
            direction ===
            TREND_DIRECTION.INCREASING
        ) {

            return (
                `${readableType} increased from ` +
                `${round(baselineRate)}% to ` +
                `${round(currentRate)}% ` +
                `(${change >= 0 ? '+' : ''}${round(change)} percentage points).`
            );
        }

        if (
            direction ===
            TREND_DIRECTION.DECREASING
        ) {

            return (
                `${readableType} decreased from ` +
                `${round(baselineRate)}% to ` +
                `${round(currentRate)}% ` +
                `(${round(change)} percentage points).`
            );
        }

        return (
            `${readableType} remained within the configured ` +
            `stability threshold.`
        );
    }

    /**
     * =========================================================================
     * Provider Issue Detection
     * =========================================================================
     */

    isProviderIssue(
        repair
    ) {

        return (

            repair.failedSettlement === true ||

            repair.settlementFailure === true ||

            repair.integrationFailure === true ||

            repair.processingError === true ||

            repair.systemFailure === true ||

            repair.providerFailure === true
        );
    }

    /**
     * =========================================================================
     * Operational Issue Detection
     * =========================================================================
     */

    isOperationalIssue(
        repair
    ) {

        return (

            repair.failedSettlement === true ||

            repair.settlementFailure === true ||

            repair.duplicate === true ||

            repair.duplicatePosting === true ||

            repair.accountMappingError === true ||

            repair.invalidAccount === true ||

            repair.ledgerMappingFailure === true ||

            repair.integrationFailure === true ||

            repair.processingError === true ||

            repair.systemFailure === true
        );
    }

    /**
     * =========================================================================
     * Month-End Detection
     * =========================================================================
     */

    isMonthEndRepair(
        repair
    ) {

        const timestamp =
            repair.__timestamp;

        if (
            !Number.isFinite(
                timestamp
            )
        ) {

            return false;
        }

        const date =
            new Date(
                timestamp
            );

        return (
            date.getDate() >=
            this.config.monthEndStartDay
        );
    }

    /**
     * =========================================================================
     * Calendar Day Grouping
     * =========================================================================
     */

    groupByCalendarDay(
        repairs
    ) {

        const groups =
            {};

        repairs.forEach(
            repair => {

                const date =
                    new Date(
                        repair.__timestamp
                    );

                const key =
                    [
                        date.getFullYear(),

                        String(
                            date.getMonth() + 1
                        ).padStart(
                            2,
                            '0'
                        ),

                        String(
                            date.getDate()
                        ).padStart(
                            2,
                            '0'
                        )
                    ].join('-');

                groups[key] =
                    (
                        groups[key] ||
                        0
                    ) + 1;
            }
        );

        return groups;
    }

    /**
     * =========================================================================
     * Average Group Size
     * =========================================================================
     */

    averageGroupSize(
        groups
    ) {

        const values =
            Object.values(
                groups
            );

        if (
            values.length === 0
        ) {

            return 0;
        }

        return (
            values.reduce(
                (sum, value) =>
                    sum + value,
                0
            ) /
            values.length
        );
    }

    /**
     * =========================================================================
     * Ranking Direction
     * =========================================================================
     */

    resolveRankingDirection(
        ranked
    ) {

        if (
            ranked.length === 0
        ) {

            return TREND_DIRECTION.STABLE;
        }

        const top =
            ranked[0];

        if (
            top.issueRate >=
            this.config.sensitivity
        ) {

            return TREND_DIRECTION.INCREASING;
        }

        return TREND_DIRECTION.STABLE;
    }

    /**
     * =========================================================================
     * Normalize History
     * =========================================================================
     *
     * Internal metadata uses non-enumerable properties so it cannot pollute
     * consumer-facing repair objects.
     * =========================================================================
     */

    normalizeHistory(
        history
    ) {

        return history.map(
            repair => {

                const clone =
                    {
                        ...repair
                    };

                const timestamp =
                    toTimestamp(
                        repair.createdAt
                    );

                Object.defineProperty(
                    clone,
                    '__timestamp',
                    {
                        value:
                            timestamp,

                        enumerable:
                            false,

                        configurable:
                            false,

                        writable:
                            false
                    }
                );

                Object.defineProperty(
                    clone,
                    '__validDate',
                    {
                        value:
                            timestamp !== null,

                        enumerable:
                            false,

                        configurable:
                            false,

                        writable:
                            false
                    }
                );

                return clone;
            }
        );
    }

    /**
     * =========================================================================
     * Configuration Validation
     * =========================================================================
     */

    validateConfiguration() {

        const numericFields = [

            'sensitivity',

            'minimumSampleSize',

            'baselinePeriods',

            'monthEndStartDay',

            'highRiskRatio',

            'criticalRiskRatio'
        ];

        numericFields.forEach(
            field => {

                const value =
                    toFiniteNumber(
                        this.config[field],
                        NaN
                    );

                if (
                    !Number.isFinite(
                        value
                    )
                ) {

                    throw new TypeError(
                        `Trend detector configuration "${field}" ` +
                        `must be a finite number.`
                    );
                }
            }
        );

        if (
            this.config.sensitivity <= 0
        ) {

            throw new RangeError(
                'Trend sensitivity must be greater than zero.'
            );
        }

        if (
            this.config.minimumSampleSize < 1
        ) {

            throw new RangeError(
                'minimumSampleSize must be at least 1.'
            );
        }

        if (
            this.config.monthEndStartDay < 1 ||
            this.config.monthEndStartDay > 31
        ) {

            throw new RangeError(
                'monthEndStartDay must be between 1 and 31.'
            );
        }

        if (
            this.config.highRiskRatio <
            this.config.sensitivity
        ) {

            throw new RangeError(
                'highRiskRatio cannot be below sensitivity.'
            );
        }

        if (
            this.config.criticalRiskRatio <
            this.config.highRiskRatio
        ) {

            throw new RangeError(
                'criticalRiskRatio cannot be below highRiskRatio.'
            );
        }
    }

    /**
     * =========================================================================
     * Input Validation
     * =========================================================================
     */

    assertHistory(
        history
    ) {

        if (
            !Array.isArray(
                history
            )
        ) {

            throw new TypeError(
                'history must be an array.'
            );
        }

        history.forEach(
            (repair, index) => {

                if (
                    repair === null ||
                    typeof repair !== 'object' ||
                    Array.isArray(repair)
                ) {

                    throw new TypeError(
                        `history[${index}] must be an object.`
                    );
                }
            }
        );
    }

    /**
     * =========================================================================
     * Configuration Access
     * =========================================================================
     */

    getConfiguration() {

        return Object.freeze({

            modelVersion:
                this.modelVersion,

            config:
                freezeObject({
                    ...this.config
                })
        });
    }
}

/**
 * ============================================================================
 * Static Metadata
 * ============================================================================
 */

TrendDetector.TREND_TYPE =
    TREND_TYPE;

TrendDetector.TREND_DIRECTION =
    TREND_DIRECTION;

TrendDetector.TREND_SEVERITY =
    TREND_SEVERITY;

TrendDetector.DEFAULT_OPTIONS =
    DEFAULT_OPTIONS;

TrendDetector.MODEL_VERSION =
    MODEL_VERSION;

/**
 * ============================================================================
 * Module Exports
 * ============================================================================
 */

module.exports =
    TrendDetector;

module.exports.TREND_TYPE =
    TREND_TYPE;

module.exports.TREND_DIRECTION =
    TREND_DIRECTION;

module.exports.TREND_SEVERITY =
    TREND_SEVERITY;

module.exports.DEFAULT_OPTIONS =
    DEFAULT_OPTIONS;

module.exports.MODEL_VERSION =
    MODEL_VERSION;
