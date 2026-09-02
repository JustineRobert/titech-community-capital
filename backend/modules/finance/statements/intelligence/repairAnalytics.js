'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Repair Analytics Engine
 * ============================================================================
 *
 * File:
 * backend/modules/finance/statements/intelligence/repairAnalytics.js
 *
 * Purpose
 * -------
 * Provides deterministic, immutable analytics over statement repairs.
 *
 * Responsibilities
 * ---------------
 * • Generate repair analytics
 * • Produce executive metrics
 * • Calculate operational KPIs
 * • Measure workflow efficiency
 * • Measure repair aging
 * • Measure execution reliability
 * • Measure financial exposure
 * • Analyze priority and risk distributions
 * • Produce immutable analytics snapshots
 * • Support dashboard / BI reporting
 *
 * Design Principles
 * -----------------
 * • Stateless
 * • Deterministic
 * • Immutable outputs
 * • No database access
 * • No side effects
 * • Audit friendly
 * • BI ready
 * • Dashboard ready
 * • Fail-safe against malformed dates
 *
 * IMPORTANT
 * ---------
 * This class analyzes supplied repair data.
 *
 * It does not:
 * • persist analytics
 * • modify repairs
 * • execute repairs
 * • query databases
 * • emit events
 *
 * ============================================================================
 */

/**
 * ============================================================================
 * Repair Status
 * ============================================================================
 */

const REPAIR_STATUS = Object.freeze({

    CREATED: 'CREATED',

    VALIDATED: 'VALIDATED',

    APPROVED: 'APPROVED',

    EXECUTING: 'EXECUTING',

    EXECUTED: 'EXECUTED',

    FAILED: 'FAILED',

    REJECTED: 'REJECTED',

    REVERSED: 'REVERSED'
});

/**
 * ============================================================================
 * Terminal Statuses
 * ============================================================================
 */

const TERMINAL_STATUSES = Object.freeze([
    REPAIR_STATUS.EXECUTED,
    REPAIR_STATUS.REJECTED,
    REPAIR_STATUS.REVERSED
]);

/**
 * ============================================================================
 * Default Configuration
 * ============================================================================
 */

const DEFAULT_CONFIGURATION = Object.freeze({

    staleRepairDays: 7,

    criticalRepairDays: 30,

    highRiskAmount: 100000,

    criticalRiskAmount: 1000000

});

/**
 * ============================================================================
 * Time Constants
 * ============================================================================
 */

const MS_PER_HOUR =
    3600000;

const MS_PER_DAY =
    86400000;

/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

/**
 * Convert arbitrary input to finite number.
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
 * Parse a date safely.
 *
 * @param {*} value
 * @returns {number|null}
 */
function toTimestamp(value) {

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
 * Normalize a string enum.
 *
 * @param {*} value
 * @returns {string|null}
 */
function normalizeEnum(value) {

    if (typeof value !== 'string') {
        return null;
    }

    return value
        .trim()
        .toUpperCase();
}

/**
 * Round a number to a fixed decimal precision.
 *
 * @param {number} value
 * @param {number} decimals
 * @returns {number}
 */
function round(
    value,
    decimals = 2
) {

    const factor =
        10 ** decimals;

    return Number(
        (
            toFiniteNumber(value) *
            factor
        ).toFixed(decimals)
    ) / factor;
}

/**
 * Freeze an array.
 *
 * @param {Array} value
 * @returns {Array}
 */
function freezeArray(value) {

    return Object.freeze([
        ...value
    ]);
}

/**
 * Freeze an object.
 *
 * @param {object} value
 * @returns {object}
 */
function freezeObject(value) {

    return Object.freeze({
        ...value
    });
}

/**
 * ============================================================================
 * Repair Analytics
 * ============================================================================
 */

class RepairAnalytics {

    /**
     * =========================================================================
     * Constructor
     * =========================================================================
     *
     * @param {object} options
     * @param {object} options.configuration
     * @param {Function} options.clock
     */
    constructor({

        configuration = {},

        clock = () => new Date()

    } = {}) {

        if (
            typeof clock !== 'function'
        ) {
            throw new TypeError(
                'clock must be a function.'
            );
        }

        this.configuration =
            freezeObject({

                ...DEFAULT_CONFIGURATION,

                ...(configuration || {})

            });

        this.clock =
            clock;
    }

    /**
     * =========================================================================
     * Public API — Generate Analytics
     * =========================================================================
     *
     * @param {Array<object>} repairs
     * @returns {object}
     */
    generateAnalytics(
        repairs = []
    ) {

        this.assertRepairsArray(
            repairs
        );

        const totalRepairs =
            repairs.length;

        const statusCounts =
            this.buildStatusDistribution(
                repairs
            );

        const openRepairs =
            this.calculateOpenRepairs(
                repairs
            );

        const financial =
            this.calculateFinancialMetrics(
                repairs
            );

        const workflow =
            this.calculateWorkflowMetrics(
                repairs,
                statusCounts
            );

        const duration =
            this.calculateDurationMetrics(
                repairs
            );

        const aging =
            this.calculateAgingMetrics(
                repairs
            );

        const reliability =
            this.calculateReliabilityMetrics(
                repairs
            );

        const priority =
            this.calculatePriorityMetrics(
                repairs
            );

        const risk =
            this.calculateRiskMetrics(
                repairs
            );

        const throughput =
            this.calculateThroughputMetrics(
                repairs
            );

        return Object.freeze({

            /**
             * Snapshot metadata.
             */
            generatedAt:
                this.clock(),

            snapshotVersion:
                'REPAIR_ANALYTICS_V1',

            repairCount:
                totalRepairs,

            overview:
                freezeObject({

                    totalRepairs,

                    openRepairs,

                    approvedRepairs:
                        statusCounts
                            [REPAIR_STATUS.APPROVED],

                    rejectedRepairs:
                        statusCounts
                            [REPAIR_STATUS.REJECTED],

                    executedRepairs:
                        statusCounts
                            [REPAIR_STATUS.EXECUTED],

                    failedRepairs:
                        statusCounts
                            [REPAIR_STATUS.FAILED],

                    reversedRepairs:
                        statusCounts
                            [REPAIR_STATUS.REVERSED],

                    executingRepairs:
                        statusCounts
                            [REPAIR_STATUS.EXECUTING],

                    validatedRepairs:
                        statusCounts
                            [REPAIR_STATUS.VALIDATED],

                    createdRepairs:
                        statusCounts
                            [REPAIR_STATUS.CREATED]
                }),

            workflow,

            duration,

            aging,

            financial,

            reliability,

            priority,

            risk,

            throughput,

            statusDistribution:
                this.buildStatusDistribution(
                    repairs
                )
        });
    }

    /**
     * =========================================================================
     * Count Status
     * =========================================================================
     *
     * @param {Array<object>} repairs
     * @param {string} status
     * @returns {number}
     */
    countByStatus(
        repairs,
        status
    ) {

        if (!Array.isArray(repairs)) {
            return 0;
        }

        const normalizedStatus =
            normalizeEnum(status);

        return repairs.filter(
            repair =>
                normalizeEnum(
                    repair?.status
                ) === normalizedStatus
        ).length;
    }

    /**
     * =========================================================================
     * Open Repairs
     * =========================================================================
     *
     * @param {Array<object>} repairs
     * @returns {number}
     */
    calculateOpenRepairs(
        repairs
    ) {

        return repairs.filter(
            repair => {

                const status =
                    normalizeEnum(
                        repair?.status
                    );

                return !TERMINAL_STATUSES
                    .includes(status);
            }
        ).length;
    }

    /**
     * =========================================================================
     * Workflow Metrics
     * =========================================================================
     *
     * @param {Array<object>} repairs
     * @param {object} statusCounts
     * @returns {object}
     */
    calculateWorkflowMetrics(
        repairs,
        statusCounts
    ) {

        const approved =
            statusCounts[
                REPAIR_STATUS.APPROVED
            ];

        const rejected =
            statusCounts[
                REPAIR_STATUS.REJECTED
            ];

        const executed =
            statusCounts[
                REPAIR_STATUS.EXECUTED
            ];

        const failed =
            statusCounts[
                REPAIR_STATUS.FAILED
            ];

        return freezeObject({

            executionSuccessRate:
                this.calculateExecutionSuccessRate(
                    executed,
                    failed
                ),

            approvalRate:
                this.calculateApprovalRate(
                    approved,
                    rejected
                ),

            rejectionRate:
                this.calculatePercentage(
                    rejected,
                    repairs.length
                ),

            failureRate:
                this.calculatePercentage(
                    failed,
                    repairs.length
                ),

            executionRate:
                this.calculatePercentage(
                    executed,
                    repairs.length
                ),

            openRate:
                this.calculatePercentage(
                    this.calculateOpenRepairs(
                        repairs
                    ),
                    repairs.length
                ),

            completionRate:
                this.calculatePercentage(
                    executed +
                    rejected +
                    statusCounts[
                        REPAIR_STATUS.REVERSED
                    ],
                    repairs.length
                )
        });
    }

    /**
     * =========================================================================
     * Execution Success Rate
     * =========================================================================
     *
     * @param {number} executed
     * @param {number} failed
     * @returns {number}
     */
    calculateExecutionSuccessRate(
        executed,
        failed
    ) {

        const total =
            toFiniteNumber(executed) +
            toFiniteNumber(failed);

        if (total <= 0) {
            return 0;
        }

        return round(
            (
                executed /
                total
            ) * 100
        );
    }

    /**
     * =========================================================================
     * Approval Rate
     * =========================================================================
     *
     * @param {number} approved
     * @param {number} rejected
     * @returns {number}
     */
    calculateApprovalRate(
        approved,
        rejected
    ) {

        const total =
            toFiniteNumber(approved) +
            toFiniteNumber(rejected);

        if (total <= 0) {
            return 0;
        }

        return round(
            (
                approved /
                total
            ) * 100
        );
    }

    /**
     * =========================================================================
     * Generic Percentage
     * =========================================================================
     *
     * @param {number} value
     * @param {number} total
     * @returns {number}
     */
    calculatePercentage(
        value,
        total
    ) {

        const denominator =
            toFiniteNumber(total);

        if (denominator <= 0) {
            return 0;
        }

        return round(
            (
                toFiniteNumber(value) /
                denominator
            ) * 100
        );
    }

    /**
     * =========================================================================
     * Duration Metrics
     * =========================================================================
     *
     * @param {Array<object>} repairs
     * @returns {object}
     */
    calculateDurationMetrics(
        repairs
    ) {

        return freezeObject({

            averageRepairDurationHours:
                this.calculateAverageRepairDuration(
                    repairs
                ),

            averageApprovalDurationHours:
                this.calculateAverageApprovalDuration(
                    repairs
                ),

            averageExecutionDurationHours:
                this.calculateAverageExecutionDuration(
                    repairs
                ),

            medianRepairDurationHours:
                this.calculateMedianDuration(
                    repairs,
                    'createdAt',
                    'executedAt'
                ),

            medianApprovalDurationHours:
                this.calculateMedianDuration(
                    repairs,
                    'createdAt',
                    'approvedAt'
                )
        });
    }

    /**
     * =========================================================================
     * Average Repair Duration
     * =========================================================================
     *
     * @param {Array<object>} repairs
     * @returns {number}
     */
    calculateAverageRepairDuration(
        repairs
    ) {

        return this.calculateAverageDuration(
            repairs,
            'createdAt',
            'executedAt'
        );
    }

    /**
     * =========================================================================
     * Average Approval Duration
     * =========================================================================
     *
     * @param {Array<object>} repairs
     * @returns {number}
     */
    calculateAverageApprovalDuration(
        repairs
    ) {

        return this.calculateAverageDuration(
            repairs,
            'createdAt',
            'approvedAt'
        );
    }

    /**
     * =========================================================================
     * Average Execution Duration
     * =========================================================================
     *
     * @param {Array<object>} repairs
     * @returns {number}
     */
    calculateAverageExecutionDuration(
        repairs
    ) {

        return this.calculateAverageDuration(
            repairs,
            'approvedAt',
            'executedAt'
        );
    }

    /**
     * =========================================================================
     * Generic Average Duration
     * =========================================================================
     *
     * Invalid or negative durations are ignored rather than polluting KPIs.
     *
     * @param {Array<object>} repairs
     * @param {string} startField
     * @param {string} endField
     * @returns {number}
     */
    calculateAverageDuration(
        repairs,
        startField,
        endField
    ) {

        const durations =
            repairs
                .map(
                    repair =>
                        this.calculateDuration(
                            repair,
                            startField,
                            endField
                        )
                )
                .filter(
                    duration =>
                        duration !== null
                );

        if (!durations.length) {
            return 0;
        }

        const total =
            durations.reduce(
                (sum, value) =>
                    sum + value,
                0
            );

        return round(
            total /
            durations.length
        );
    }

    /**
     * =========================================================================
     * Calculate Duration
     * =========================================================================
     *
     * @param {object} repair
     * @param {string} startField
     * @param {string} endField
     * @returns {number|null}
     */
    calculateDuration(
        repair,
        startField,
        endField
    ) {

        const start =
            toTimestamp(
                repair?.[startField]
            );

        const end =
            toTimestamp(
                repair?.[endField]
            );

        if (
            start === null ||
            end === null ||
            end < start
        ) {
            return null;
        }

        return (
            end - start
        ) / MS_PER_HOUR;
    }

    /**
     * =========================================================================
     * Median Duration
     * =========================================================================
     *
     * @param {Array<object>} repairs
     * @param {string} startField
     * @param {string} endField
     * @returns {number}
     */
    calculateMedianDuration(
        repairs,
        startField,
        endField
    ) {

        const durations =
            repairs
                .map(
                    repair =>
                        this.calculateDuration(
                            repair,
                            startField,
                            endField
                        )
                )
                .filter(
                    duration =>
                        duration !== null
                )
                .sort(
                    (a, b) =>
                        a - b
                );

        if (!durations.length) {
            return 0;
        }

        const middle =
            Math.floor(
                durations.length / 2
            );

        if (
            durations.length % 2 === 0
        ) {

            return round(
                (
                    durations[middle - 1] +
                    durations[middle]
                ) / 2
            );
        }

        return round(
            durations[middle]
        );
    }

    /**
     * =========================================================================
     * Aging Metrics
     * =========================================================================
     *
     * @param {Array<object>} repairs
     * @returns {object}
     */
    calculateAgingMetrics(
        repairs
    ) {

        const now =
            this.getCurrentTimestamp();

        const open =
            repairs.filter(
                repair =>
                    !TERMINAL_STATUSES
                        .includes(
                            normalizeEnum(
                                repair?.status
                            )
                        )
            );

        const ages =
            open
                .map(
                    repair =>
                        this.calculateAgeDays(
                            repair,
                            now
                        )
                )
                .filter(
                    age =>
                        age !== null
                );

        const stale =
            ages.filter(
                age =>
                    age >=
                    this.configuration
                        .staleRepairDays
            ).length;

        const critical =
            ages.filter(
                age =>
                    age >=
                    this.configuration
                        .criticalRepairDays
            ).length;

        return freezeObject({

            openRepairCount:
                open.length,

            staleRepairCount:
                stale,

            criticalAgeRepairCount:
                critical,

            staleRate:
                this.calculatePercentage(
                    stale,
                    open.length
                ),

            criticalAgeRate:
                this.calculatePercentage(
                    critical,
                    open.length
                ),

            averageOpenRepairAgeDays:
                ages.length
                    ? round(
                        ages.reduce(
                            (sum, age) =>
                                sum + age,
                            0
                        ) /
                        ages.length
                    )
                    : 0,

            maximumOpenRepairAgeDays:
                ages.length
                    ? round(
                        Math.max(...ages)
                    )
                    : 0
        });
    }

    /**
     * =========================================================================
     * Repair Age
     * =========================================================================
     *
     * @param {object} repair
     * @param {number} now
     * @returns {number|null}
     */
    calculateAgeDays(
        repair,
        now
    ) {

        const createdAt =
            toTimestamp(
                repair?.createdAt
            );

        if (createdAt === null) {
            return null;
        }

        if (createdAt >= now) {
            return 0;
        }

        return (
            now - createdAt
        ) / MS_PER_DAY;
    }

    /**
     * =========================================================================
     * Financial Metrics
     * =========================================================================
     *
     * @param {Array<object>} repairs
     * @returns {object}
     */
    calculateFinancialMetrics(
        repairs
    ) {

        const amounts =
            repairs.map(
                repair =>
                    this.getRepairAmount(
                        repair
                    )
            );

        const positiveAmounts =
            amounts.filter(
                amount =>
                    amount > 0
            );

        const totalExposure =
            positiveAmounts.reduce(
                (sum, amount) =>
                    sum + amount,
                0
            );

        const averageExposure =
            positiveAmounts.length
                ? totalExposure /
                  positiveAmounts.length
                : 0;

        const maximumExposure =
            positiveAmounts.length
                ? Math.max(
                    ...positiveAmounts
                )
                : 0;

        const highExposureCount =
            positiveAmounts.filter(
                amount =>
                    amount >=
                    this.configuration
                        .highRiskAmount
            ).length;

        const criticalExposureCount =
            positiveAmounts.filter(
                amount =>
                    amount >=
                    this.configuration
                        .criticalRiskAmount
            ).length;

        return freezeObject({

            totalRepairExposure:
                round(
                    totalExposure
                ),

            averageRepairExposure:
                round(
                    averageExposure
                ),

            maximumRepairExposure:
                round(
                    maximumExposure
                ),

            highExposureRepairCount:
                highExposureCount,

            criticalExposureRepairCount:
                criticalExposureCount,

            highExposureRate:
                this.calculatePercentage(
                    highExposureCount,
                    positiveAmounts.length
                ),

            criticalExposureRate:
                this.calculatePercentage(
                    criticalExposureCount,
                    positiveAmounts.length
                )
        });
    }

    /**
     * =========================================================================
     * Repair Amount
     * =========================================================================
     *
     * @param {object} repair
     * @returns {number}
     */
    getRepairAmount(
        repair
    ) {

        const amount =
            repair?.amount ??
            repair?.evidence?.amount ??
            0;

        return Math.abs(
            toFiniteNumber(
                amount,
                0
            )
        );
    }

    /**
     * =========================================================================
     * Reliability Metrics
     * =========================================================================
     *
     * @param {Array<object>} repairs
     * @returns {object}
     */
    calculateReliabilityMetrics(
        repairs
    ) {

        const failed =
            this.countByStatus(
                repairs,
                REPAIR_STATUS.FAILED
            );

        const executed =
            this.countByStatus(
                repairs,
                REPAIR_STATUS.EXECUTED
            );

        const reversed =
            this.countByStatus(
                repairs,
                REPAIR_STATUS.REVERSED
            );

        const completed =
            executed +
            reversed;

        return freezeObject({

            failedRepairs:
                failed,

            reversedRepairs:
                reversed,

            successfulExecutions:
                executed,

            completedRepairs:
                completed,

            failureRate:
                this.calculatePercentage(
                    failed,
                    repairs.length
                ),

            reversalRate:
                this.calculatePercentage(
                    reversed,
                    completed
                ),

            executionReliability:
                this.calculateExecutionSuccessRate(
                    executed,
                    failed
                )
        });
    }

    /**
     * =========================================================================
     * Priority Metrics
     * =========================================================================
     *
     * @param {Array<object>} repairs
     * @returns {object}
     */
    calculatePriorityMetrics(
        repairs
    ) {

        const distribution = {

            LOW: 0,

            MEDIUM: 0,

            HIGH: 0,

            CRITICAL: 0
        };

        repairs.forEach(
            repair => {

                const priority =
                    normalizeEnum(
                        repair?.priority ??
                        repair?.recommendation?.priority
                    );

                if (
                    Object.prototype
                        .hasOwnProperty
                        .call(
                            distribution,
                            priority
                        )
                ) {

                    distribution[
                        priority
                    ] += 1;
                }
            }
        );

        return freezeObject({

            distribution:
                freezeObject(
                    distribution
                ),

            criticalPriorityCount:
                distribution.CRITICAL,

            highPriorityCount:
                distribution.HIGH,

            highOrCriticalCount:
                distribution.HIGH +
                distribution.CRITICAL,

            highOrCriticalRate:
                this.calculatePercentage(
                    distribution.HIGH +
                    distribution.CRITICAL,
                    repairs.length
                )
        });
    }

    /**
     * =========================================================================
     * Risk Metrics
     * =========================================================================
     *
     * @param {Array<object>} repairs
     * @returns {object}
     */
    calculateRiskMetrics(
        repairs
    ) {

        const distribution = {

            LOW: 0,

            MEDIUM: 0,

            HIGH: 0,

            CRITICAL: 0
        };

        repairs.forEach(
            repair => {

                const risk =
                    normalizeEnum(
                        repair?.riskLevel ??
                        repair?.recommendation
                            ?.riskLevel
                    );

                if (
                    Object.prototype
                        .hasOwnProperty
                        .call(
                            distribution,
                            risk
                        )
                ) {

                    distribution[
                        risk
                    ] += 1;
                }
            }
        );

        return freezeObject({

            distribution:
                freezeObject(
                    distribution
                ),

            highRiskCount:
                distribution.HIGH,

            criticalRiskCount:
                distribution.CRITICAL,

            highOrCriticalCount:
                distribution.HIGH +
                distribution.CRITICAL,

            highOrCriticalRate:
                this.calculatePercentage(
                    distribution.HIGH +
                    distribution.CRITICAL,
                    repairs.length
                )
        });
    }

    /**
     * =========================================================================
     * Throughput Metrics
     * =========================================================================
     *
     * @param {Array<object>} repairs
     * @returns {object}
     */
    calculateThroughputMetrics(
        repairs
    ) {

        const executed =
            repairs.filter(
                repair =>
                    normalizeEnum(
                        repair?.status
                    ) ===
                    REPAIR_STATUS.EXECUTED
            );

        const executionDates =
            executed
                .map(
                    repair =>
                        toTimestamp(
                            repair.executedAt
                        )
                )
                .filter(
                    timestamp =>
                        timestamp !== null
                );

        if (!executionDates.length) {

            return freezeObject({

                executedRepairs:
                    executed.length,

                executionsWithValidDates:
                    0,

                firstExecutionAt:
                    null,

                lastExecutionAt:
                    null,

                executionWindowDays:
                    0,

                averageExecutionsPerDay:
                    0
            });
        }

        const first =
            Math.min(
                ...executionDates
            );

        const last =
            Math.max(
                ...executionDates
            );

        const windowDays =
            Math.max(
                1,
                (
                    last - first
                ) / MS_PER_DAY
            );

        return freezeObject({

            executedRepairs:
                executed.length,

            executionsWithValidDates:
                executionDates.length,

            firstExecutionAt:
                new Date(first),

            lastExecutionAt:
                new Date(last),

            executionWindowDays:
                round(
                    windowDays
                ),

            averageExecutionsPerDay:
                round(
                    executionDates.length /
                    windowDays
                )
        });
    }

    /**
     * =========================================================================
     * Status Distribution
     * =========================================================================
     *
     * @param {Array<object>} repairs
     * @returns {object}
     */
    buildStatusDistribution(
        repairs
    ) {

        const distribution = {};

        Object.values(
            REPAIR_STATUS
        ).forEach(
            status => {

                distribution[status] =
                    this.countByStatus(
                        repairs,
                        status
                    );
            }
        );

        return freezeObject(
            distribution
        );
    }

    /**
     * =========================================================================
     * Current Timestamp
     * =========================================================================
     *
     * @returns {number}
     */
    getCurrentTimestamp() {

        const now =
            this.clock();

        const timestamp =
            toTimestamp(now);

        if (timestamp === null) {

            throw new Error(
                'Analytics clock returned an invalid date.'
            );
        }

        return timestamp;
    }

    /**
     * =========================================================================
     * Configuration
     * =========================================================================
     *
     * @returns {object}
     */
    getConfiguration() {

        return freezeObject({

            configuration:
                freezeObject({
                    ...this.configuration
                }),

            status:
                freezeArray(
                    Object.values(
                        REPAIR_STATUS
                    )
                ),

            terminalStatuses:
                freezeArray(
                    TERMINAL_STATUSES
                )
        });
    }

    /**
     * =========================================================================
     * Input Validation
     * =========================================================================
     *
     * @param {*} repairs
     */
    assertRepairsArray(
        repairs
    ) {

        if (!Array.isArray(repairs)) {

            throw new TypeError(
                'repairs must be an array.'
            );
        }

        repairs.forEach(
            (repair, index) => {

                if (
                    repair === null ||
                    typeof repair !== 'object' ||
                    Array.isArray(repair)
                ) {

                    throw new TypeError(
                        `Repair at index ${index} must be an object.`
                    );
                }
            }
        );
    }
}

/**
 * ============================================================================
 * Static Metadata
 * ============================================================================
 */

RepairAnalytics.REPAIR_STATUS =
    REPAIR_STATUS;

RepairAnalytics.TERMINAL_STATUSES =
    TERMINAL_STATUSES;

RepairAnalytics.DEFAULT_CONFIGURATION =
    DEFAULT_CONFIGURATION;

/**
 * ============================================================================
 * Module Exports
 * ============================================================================
 */

module.exports =
    RepairAnalytics;

module.exports.REPAIR_STATUS =
    REPAIR_STATUS;

module.exports.TERMINAL_STATUSES =
    TERMINAL_STATUSES;

module.exports.DEFAULT_CONFIGURATION =
    DEFAULT_CONFIGURATION;