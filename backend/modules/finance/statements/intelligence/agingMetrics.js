'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * ============================================================================
 *
 * Aging Metrics Engine
 *
 * File:
 *   backend/modules/finance/statements/intelligence/agingMetrics.js
 *
 * Responsibilities:
 *   - Calculate repair age
 *   - Assign aging buckets
 *   - Detect SLA breaches
 *   - Calculate remaining SLA time
 *   - Build aging distributions
 *   - Produce dashboard-ready metrics
 *   - Support operational reporting
 *
 * Design Principles:
 *   - Stateless calculations
 *   - Deterministic when `now` is supplied
 *   - Defensive input handling
 *   - Immutable configuration/results
 *   - Audit friendly
 *   - Dashboard ready
 *   - No database access
 *   - No side effects
 *
 * ============================================================================
 */

/**
 * ============================================================================
 * Aging Buckets
 * ============================================================================
 */

const AGING_BUCKET = Object.freeze({

    DAY_0_1:
        '0-1_DAY',

    DAY_1_3:
        '1-3_DAYS',

    DAY_3_7:
        '3-7_DAYS',

    DAY_7_30:
        '7-30_DAYS',

    DAY_30_PLUS:
        '30+_DAYS'

});

/**
 * ============================================================================
 * Default SLA Configuration
 * ============================================================================
 */

const DEFAULT_SLA_HOURS = Object.freeze({

    CRITICAL:
        2,

    HIGH:
        8,

    MEDIUM:
        24,

    LOW:
        72

});

/**
 * ============================================================================
 * Severity Constants
 * ============================================================================
 */

const REPAIR_SEVERITY = Object.freeze({

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
 * AgingMetrics
 * ============================================================================
 */

class AgingMetrics {

    /**
     * ------------------------------------------------------------------------
     * Constructor
     * ------------------------------------------------------------------------
     *
     * @param {Object} options
     * @param {Object} options.slaHours
     */

    constructor({

        slaHours =
            DEFAULT_SLA_HOURS

    } = {}) {

        this.slaHours =
            this._normalizeSLAConfiguration(
                slaHours
            );

    }

    /**
     * =========================================================================
     * Public API
     * =========================================================================
     */

    calculateRepairAge(
        repair = {},
        options = {}
    ) {

        const createdAt =
            this._parseDate(
                repair.createdAt
            );

        /**
         * Missing or invalid timestamps must not be silently represented as a
         * valid zero-age repair.
         */

        if (
            !createdAt
        ) {

            return Object.freeze({

                hoursOpen:
                    null,

                daysOpen:
                    null,

                bucket:
                    AGING_BUCKET.DAY_0_1,

                breached:
                    false,

                slaHours:
                    this.resolveSLA(
                        repair
                    ),

                remainingHours:
                    null,

                valid:
                    false,

                reason:
                    'INVALID_OR_MISSING_CREATED_AT'

            });

        }

        const now =
            this._resolveNow(
                options.now
            );

        /**
         * Future-dated records are treated as zero age rather than allowing
         * negative operational aging metrics.
         */

        const elapsedMs =
            Math.max(
                0,
                now.getTime() -
                createdAt.getTime()
            );

        const hoursOpen =
            this._round(
                elapsedMs /
                3600000
            );

        const daysOpen =
            this._round(
                elapsedMs /
                86400000
            );

        const bucket =
            this.resolveBucket(
                daysOpen
            );

        const slaHours =
            this.resolveSLA(
                repair
            );

        const breached =
            hoursOpen >
            slaHours;

        const remainingHours =
            Math.max(
                0,
                this._round(
                    slaHours -
                    hoursOpen
                )
            );

        return Object.freeze({

            hoursOpen,

            daysOpen,

            bucket,

            breached,

            slaHours,

            remainingHours,

            valid:
                true,

            createdAt:
                createdAt.toISOString(),

            evaluatedAt:
                now.toISOString()

        });

    }

    /**
     * =========================================================================
     * Batch Aging Summary
     * =========================================================================
     */

    generateAgingDistribution(
        repairs = [],
        options = {}
    ) {

        const safeRepairs =
            Array.isArray(
                repairs
            )
                ? repairs
                : [];

        const summary = {

            totalRepairs:
                safeRepairs.length,

            validRepairs:
                0,

            invalidRepairs:
                0,

            breached:
                0,

            buckets: {

                [AGING_BUCKET.DAY_0_1]:
                    0,

                [AGING_BUCKET.DAY_1_3]:
                    0,

                [AGING_BUCKET.DAY_3_7]:
                    0,

                [AGING_BUCKET.DAY_7_30]:
                    0,

                [AGING_BUCKET.DAY_30_PLUS]:
                    0

            }

        };

        let totalHoursOpen = 0;

        let totalDaysOpen = 0;

        for (
            const repair of safeRepairs
        ) {

            const metrics =
                this.calculateRepairAge(
                    repair,
                    options
                );

            if (
                !metrics.valid
            ) {

                summary.invalidRepairs++;

                continue;

            }

            summary.validRepairs++;

            summary.buckets[
                metrics.bucket
            ]++;

            if (
                metrics.breached
            ) {

                summary.breached++;

            }

            totalHoursOpen +=
                metrics.hoursOpen;

            totalDaysOpen +=
                metrics.daysOpen;

        }

        summary.complianceRate =
            summary.validRepairs === 0
                ? 100
                : this._round(
                    (
                        (
                            summary.validRepairs -
                            summary.breached
                        ) /
                        summary.validRepairs
                    ) *
                    100
                );

        summary.breachRate =
            summary.validRepairs === 0
                ? 0
                : this._round(
                    (
                        summary.breached /
                        summary.validRepairs
                    ) *
                    100
                );

        summary.averageHoursOpen =
            summary.validRepairs === 0
                ? 0
                : this._round(
                    totalHoursOpen /
                    summary.validRepairs
                );

        summary.averageDaysOpen =
            summary.validRepairs === 0
                ? 0
                : this._round(
                    totalDaysOpen /
                    summary.validRepairs
                );

        return Object.freeze(
            this._freezeDeep(
                summary
            )
        );

    }

    /**
     * =========================================================================
     * Detailed Aging Analysis
     * =========================================================================
     *
     * Provides per-repair metrics together with aggregate distribution data.
     *
     * Useful for operational dashboards and reporting pipelines.
     * =========================================================================
     */

    analyze(
        repairs = [],
        options = {}
    ) {

        const safeRepairs =
            Array.isArray(
                repairs
            )
                ? repairs
                : [];

        const items =
            safeRepairs.map(
                (
                    repair,
                    index
                ) => {

                    const metrics =
                        this.calculateRepairAge(
                            repair,
                            options
                        );

                    return Object.freeze({

                        index,

                        repairId:
                            repair &&
                            (
                                repair.repairId ||
                                repair.id ||
                                repair._id ||
                                null
                            ),

                        ...metrics

                    });

                }
            );

        const distribution =
            this.generateAgingDistribution(
                safeRepairs,
                options
            );

        return Object.freeze({

            items:

                Object.freeze(
                    items
                ),

            distribution

        });

    }

    /**
     * =========================================================================
     * SLA Breach Detection
     * =========================================================================
     */

    isSLABreached(
        repair = {},
        options = {}
    ) {

        const metrics =
            this.calculateRepairAge(
                repair,
                options
            );

        return metrics.breached === true;

    }

    /**
     * =========================================================================
     * SLA Remaining Time
     * =========================================================================
     */

    calculateRemainingSLA(
        repair = {},
        options = {}
    ) {

        const metrics =
            this.calculateRepairAge(
                repair,
                options
            );

        return Object.freeze({

            remainingHours:
                metrics.remainingHours,

            breached:
                metrics.breached,

            slaHours:
                metrics.slaHours,

            valid:
                metrics.valid

        });

    }

    /**
     * =========================================================================
     * Bucket Resolution
     * =========================================================================
     */

    resolveBucket(
        days
    ) {

        const numericDays =
            Number(
                days
            );

        if (
            !Number.isFinite(
                numericDays
            ) ||
            numericDays <= 1
        ) {

            return AGING_BUCKET.DAY_0_1;

        }

        if (
            numericDays <= 3
        ) {

            return AGING_BUCKET.DAY_1_3;

        }

        if (
            numericDays <= 7
        ) {

            return AGING_BUCKET.DAY_3_7;

        }

        if (
            numericDays <= 30
        ) {

            return AGING_BUCKET.DAY_7_30;

        }

        return AGING_BUCKET.DAY_30_PLUS;

    }

    /**
     * =========================================================================
     * SLA Resolution
     * =========================================================================
     */

    resolveSLA(
        repair = {}
    ) {

        const severity =
            String(
                repair.severity ||
                REPAIR_SEVERITY.LOW
            )
                .trim()
                .toUpperCase();

        const configuredSLA =
            this.slaHours[
                severity
            ];

        if (
            Number.isFinite(
                configuredSLA
            ) &&
            configuredSLA >= 0
        ) {

            return configuredSLA;

        }

        return this.slaHours.LOW;

    }

    /**
     * =========================================================================
     * SLA Configuration Validation
     * =========================================================================
     */

    _normalizeSLAConfiguration(
        slaHours
    ) {

        const source =
            slaHours &&
            typeof slaHours === 'object'
                ? slaHours
                : DEFAULT_SLA_HOURS;

        const normalized = {};

        for (
            const severity of
            Object.values(
                REPAIR_SEVERITY
            )
        ) {

            const value =
                Number(
                    source[
                        severity
                    ]
                );

            const fallback =
                DEFAULT_SLA_HOURS[
                    severity
                ];

            normalized[
                severity
            ] =
                Number.isFinite(
                    value
                ) &&
                value >= 0
                    ? value
                    : fallback;

        }

        return Object.freeze(
            normalized
        );

    }

    /**
     * =========================================================================
     * Date Parsing
     * =========================================================================
     */

    _parseDate(
        value
    ) {

        if (
            value instanceof Date
        ) {

            if (
                Number.isNaN(
                    value.getTime()
                )
            ) {

                return null;

            }

            return new Date(
                value.getTime()
            );

        }

        if (
            value === null ||
            value === undefined ||
            value === ''
        ) {

            return null;

        }

        const parsed =
            new Date(
                value
            );

        if (
            Number.isNaN(
                parsed.getTime()
            )
        ) {

            return null;

        }

        return parsed;

    }

    /**
     * =========================================================================
     * Current Time Resolution
     * =========================================================================
     *
     * Supplying `options.now` makes the engine deterministic and easier to
     * unit-test.
     * =========================================================================
     */

    _resolveNow(
        value
    ) {

        if (
            value instanceof Date
        ) {

            if (
                Number.isNaN(
                    value.getTime()
                )
            ) {

                throw new TypeError(
                    'options.now must contain a valid Date.'
                );

            }

            return new Date(
                value.getTime()
            );

        }

        if (
            value !== undefined &&
            value !== null
        ) {

            const parsed =
                new Date(
                    value
                );

            if (
                Number.isNaN(
                    parsed.getTime()
                )
            ) {

                throw new TypeError(
                    'options.now must contain a valid date.'
                );

            }

            return parsed;

        }

        return new Date();

    }

    /**
     * =========================================================================
     * Rounding
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
     *
     * Results are frozen to prevent accidental mutation by dashboard,
     * reporting, or downstream intelligence consumers.
     * =========================================================================
     */

    _freezeDeep(
        value
    ) {

        if (
            !value ||
            typeof value !== 'object'
        ) {

            return value;

        }

        if (
            Object.isFrozen(
                value
            )
        ) {

            return value;

        }

        for (
            const key of
            Object.keys(
                value
            )
        ) {

            this._freezeDeep(
                value[key]
            );

        }

        return Object.freeze(
            value
        );

    }

}

/**
 * ============================================================================
 * Public Exports
 * ============================================================================
 */

module.exports =
    AgingMetrics;

module.exports.AgingMetrics =
    AgingMetrics;

module.exports.AGING_BUCKET =
    AGING_BUCKET;

module.exports.DEFAULT_SLA_HOURS =
    DEFAULT_SLA_HOURS;

module.exports.REPAIR_SEVERITY =
    REPAIR_SEVERITY;