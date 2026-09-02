'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * CapacityPlanner
 * ============================================================================
 *
 * Location:
 *   backend/modules/finance/statements/operations/CapacityPlanner.js
 *
 * Purpose
 * -------
 * Enterprise capacity-planning engine for financial statement operations.
 *
 * Responsibilities
 * ----------------
 * - Estimate operational workload.
 * - Calculate available processing capacity.
 * - Measure current utilization.
 * - Calculate backlog pressure.
 * - Estimate staffing/capacity gaps.
 * - Recommend workload redistribution.
 * - Produce capacity scenarios.
 * - Support repair scheduling.
 * - Identify overload and under-utilization.
 * - Calculate planning confidence.
 * - Preserve tenant and branch isolation.
 *
 * Non-responsibilities
 * --------------------
 * - Does not mutate transactions.
 * - Does not execute repairs.
 * - Does not create accounting entries.
 * - Does not persist data.
 * - Does not directly schedule jobs.
 *
 * Designed consumers
 * ------------------
 * - BranchPerformanceAnalyzer
 * - PredictiveRepairScheduler
 * - RepairForecastEngine
 * - OperationalMetrics
 * - RepairAnalyticsSnapshot
 * - ExecutiveReportingExporter
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
    'CapacityPlanner';

const SCHEMA_VERSION =
    '1.0.0';

const STATUS = Object.freeze({
    OPTIMAL: 'OPTIMAL',
    HEALTHY: 'HEALTHY',
    CONSTRAINED: 'CONSTRAINED',
    OVERLOADED: 'OVERLOADED',
    CRITICAL: 'CRITICAL',
    INSUFFICIENT_DATA: 'INSUFFICIENT_DATA'
});

const RISK_LEVEL = Object.freeze({
    LOW: 'LOW',
    MEDIUM: 'MEDIUM',
    HIGH: 'HIGH',
    CRITICAL: 'CRITICAL',
    UNKNOWN: 'UNKNOWN'
});

const PLANNING_MODE = Object.freeze({
    CONSERVATIVE: 'CONSERVATIVE',
    BALANCED: 'BALANCED',
    AGGRESSIVE: 'AGGRESSIVE'
});

const WORKLOAD_TYPE = Object.freeze({
    STATEMENT: 'STATEMENT',
    TRANSACTION: 'TRANSACTION',
    REPAIR: 'REPAIR',
    RECONCILIATION: 'RECONCILIATION',
    SETTLEMENT: 'SETTLEMENT',
    MIXED: 'MIXED'
});

const DEFAULTS = Object.freeze({

    planningMode:
        PLANNING_MODE.BALANCED,

    minimumSampleSize:
        5,

    planningHorizonDays:
        7,

    workingDaysPerWeek:
        5,

    workingHoursPerDay:
        8,

    utilizationTarget:
        0.80,

    warningUtilization:
        0.85,

    criticalUtilization:
        1.00,

    minimumReserveCapacity:
        0.15,

    defaultItemsPerHour:
        25,

    defaultAverageProcessingTimeMs:
        2 * 60 * 1000,

    defaultStaffCount:
        1,

    defaultEfficiency:
        1,

    defaultShrinkage:
        0.10,

    defaultAbsenceRate:
        0.05,

    defaultGrowthRate:
        0,

    maximumRecords:
        100000,

    maximumScenarios:
        25,

    maximumRecommendations:
        50
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

        for (
            const key of Object.keys(value)
        ) {
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

    const result =
        String(value).trim();

    return result.length
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

function normalizeArray(
    value,
    maximum
) {

    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .slice(0, maximum)
        .map(clone);
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
 * CapacityPlanner
 * ============================================================================
 */

class CapacityPlanner {

    constructor(options = {}) {

        if (!isObject(options)) {

            throw new TypeError(
                'CapacityPlanner options must be an object.'
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
     * Main planning API
     * =========================================================================
     */

    plan(input = {}) {

        const startedAt =
            Date.now();

        const context =
            this._normalizeInput(
                input
            );

        const dataQuality =
            this._calculateDataQuality(
                context
            );

        if (
            dataQuality.status ===
            STATUS.INSUFFICIENT_DATA
        ) {

            return this._buildInsufficientResult(
                context,
                dataQuality,
                startedAt
            );
        }

        const workload =
            this._calculateWorkload(
                context
            );

        const workforce =
            this._calculateWorkforce(
                context
            );

        const capacity =
            this._calculateCapacity(
                context,
                workforce
            );

        const utilization =
            this._calculateUtilization(
                workload,
                capacity
            );

        const backlog =
            this._calculateBacklog(
                context,
                capacity
            );

        const demand =
            this._forecastDemand(
                context,
                workload
            );

        const gap =
            this._calculateCapacityGap(
                demand,
                capacity
            );

        const scenarios =
            this.generateScenarios(
                context,
                workload,
                workforce,
                capacity,
                demand
            );

        const status =
            this._classifyStatus(
                utilization,
                gap,
                dataQuality
            );

        const risks =
            this._identifyRisks({
                context,
                workload,
                capacity,
                utilization,
                backlog,
                demand,
                gap
            });

        const recommendations =
            this._generateRecommendations({
                context,
                workload,
                workforce,
                capacity,
                utilization,
                backlog,
                demand,
                gap,
                status,
                risks
            });

        const result = {

            model:
                this.model,

            schemaVersion:
                this.schemaVersion,

            planId:
                this._generatePlanId(),

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

            planningMode:
                context.planningMode,

            status,

            dataQuality,

            workload,

            workforce,

            capacity,

            utilization,

            backlog,

            demand,

            gap,

            scenarios,

            risks,

            recommendations,

            planningHorizon:
                context.planningHorizon,

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

        const reconciliations =
            normalizeArray(
                source.reconciliations,
                this.options.maximumRecords
            );

        const settlements =
            normalizeArray(
                source.settlements,
                this.options.maximumRecords
            );

        const history =
            normalizeArray(
                source.history ||
                source.periods,
                this.options.maximumRecords
            );

        const capacity =
            isObject(source.capacity)
                ? clone(source.capacity)
                : {};

        const targets =
            isObject(source.targets)
                ? clone(source.targets)
                : {};

        const planningHorizon =
            this._normalizePlanningHorizon(
                source.planningHorizon
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

            planningMode:
                this._normalizePlanningMode(
                    source.planningMode
                ),

            planningHorizon,

            statements,

            transactions,

            repairs,

            reconciliations,

            settlements,

            history,

            capacity,

            targets,

            metadata:
                isObject(source.metadata)
                    ? clone(
                        source.metadata
                    )
                    : {},

            assumptions:
                isObject(source.assumptions)
                    ? clone(
                        source.assumptions
                    )
                    : {}
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

    _normalizePlanningHorizon(
        horizon
    ) {

        const source =
            isObject(horizon)
                ? horizon
                : {};

        const days =
            clamp(
                source.days ??
                this.options.planningHorizonDays,
                1,
                365
            );

        return {

            days,

            workingDays:
                clamp(
                    source.workingDays ??
                    Math.min(
                        days,
                        this.options.workingDaysPerWeek
                    ),
                    1,
                    days
                ),

            start:
                normalizeDate(
                    source.start
                ),

            end:
                normalizeDate(
                    source.end
                )
        };
    }

    _normalizePlanningMode(
        value
    ) {

        const normalized =
            normalizeString(
                value,
                this.options.planningMode
            ).toUpperCase();

        return Object.values(
            PLANNING_MODE
        ).includes(
            normalized
        )
            ? normalized
            : PLANNING_MODE.BALANCED;
    }

    /**
     * =========================================================================
     * Data quality
     * =========================================================================
     */

    _calculateDataQuality(
        context
    ) {

        const counts = {

            statements:
                context.statements.length,

            transactions:
                context.transactions.length,

            repairs:
                context.repairs.length,

            reconciliations:
                context.reconciliations.length,

            settlements:
                context.settlements.length,

            history:
                context.history.length
        };

        const total =
            Object.values(counts)
                .reduce(
                    (sum, value) =>
                        sum + value,
                    0
                );

        if (
            total <
            this.options.minimumSampleSize
        ) {

            return {

                status:
                    STATUS.INSUFFICIENT_DATA,

                score:
                    round(
                        (
                            total /
                            this.options.minimumSampleSize
                        ) * 100,
                        2
                    ),

                sampleSize:
                    total,

                counts,

                missing: [
                    'Operational records are insufficient for reliable capacity planning.'
                ]
            };
        }

        let score = 100;

        if (
            counts.repairs === 0
        ) {
            score -= 10;
        }

        if (
            counts.transactions === 0
        ) {
            score -= 10;
        }

        if (
            counts.history === 0
        ) {
            score -= 15;
        }

        if (
            Object.keys(context.capacity)
                .length === 0
        ) {
            score -= 10;
        }

        return {

            status:
                STATUS.HEALTHY,

            score:
                clamp(
                    score,
                    0,
                    100
                ),

            sampleSize:
                total,

            counts,

            missing: []
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

            planId:
                this._generatePlanId(),

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

            planningMode:
                context.planningMode,

            status:
                STATUS.INSUFFICIENT_DATA,

            dataQuality,

            capacity: {

                availableUnits:
                    null,

                availableHours:
                    null,

                utilizationRate:
                    null
            },

            gap: {

                units:
                    null,

                hours:
                    null,

                additionalStaff:
                    null
            },

            recommendations: [
                {

                    priority:
                        1,

                    severity:
                        'HIGH',

                    action:
                        'Collect sufficient branch workload and workforce data before executing capacity decisions.',

                    rationale:
                        'Current operational data is insufficient for reliable capacity planning.'
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
     * Workload calculation
     * =========================================================================
     */

    _calculateWorkload(
        context
    ) {

        const statementCount =
            context.statements.length;

        const transactionCount =
            context.transactions.length;

        const repairCount =
            context.repairs.length;

        const reconciliationCount =
            context.reconciliations.length;

        const settlementCount =
            context.settlements.length;

        const explicit =
            this._readWorkload(
                context
            );

        const totalUnits =
            explicit !== null
                ? explicit
                : (
                    transactionCount +
                    repairCount +
                    reconciliationCount +
                    settlementCount
                );

        const repairRate =
            transactionCount > 0
                ? repairCount /
                  transactionCount
                : null;

        const estimatedProcessingMinutes =
            this._estimateProcessingMinutes(
                context
            );

        return {

            statements:
                statementCount,

            transactions:
                transactionCount,

            repairs:
                repairCount,

            reconciliations:
                reconciliationCount,

            settlements:
                settlementCount,

            totalUnits,

            repairRate:
                repairRate === null
                    ? null
                    : round(
                        repairRate * 100,
                        4
                    ),

            estimatedProcessingMinutes,

            estimatedProcessingHours:
                estimatedProcessingMinutes === null
                    ? null
                    : round(
                        estimatedProcessingMinutes /
                        60,
                        4
                    ),

            unitsPerDay:
                context.planningHorizon.days > 0
                    ? round(
                        totalUnits /
                        context.planningHorizon.days,
                        4
                    )
                    : null
        };
    }

    _readWorkload(
        context
    ) {

        const metadata =
            context.metadata;

        const candidates = [

            metadata.workloadUnits,

            metadata.expectedWorkload,

            context.capacity.workloadUnits,

            context.capacity.expectedWorkload
        ];

        for (
            const candidate of candidates
        ) {

            const value =
                toNumber(candidate);

            if (
                value !== null
            ) {
                return Math.max(
                    0,
                    value
                );
            }
        }

        return null;
    }

    _estimateProcessingMinutes(
        context
    ) {

        const explicit =
            toNumber(
                context.capacity
                    .estimatedProcessingMinutes
            );

        if (
            explicit !== null
        ) {
            return round(
                explicit,
                2
            );
        }

        const averageProcessingTimeMs =
            toNumber(
                context.capacity
                    .averageProcessingTimeMs ??
                context.metadata
                    .averageProcessingTimeMs ??
                this.options
                    .defaultAverageProcessingTimeMs
            );

        const units =
            this._readWorkload(
                context
            ) ??
            (
                context.transactions.length +
                context.repairs.length +
                context.reconciliations.length +
                context.settlements.length
            );

        return round(
            (
                units *
                averageProcessingTimeMs
            ) / 60000,
            2
        );
    }

    /**
     * =========================================================================
     * Workforce calculation
     * =========================================================================
     */

    _calculateWorkforce(
        context
    ) {

        const capacity =
            context.capacity;

        const staffCount =
            toNumber(
                capacity.staffCount ??
                capacity.availableStaff ??
                context.metadata.staffCount ??
                this.options.defaultStaffCount
            );

        const efficiency =
            clamp(
                toNumber(
                    capacity.efficiency ??
                    context.metadata.efficiency ??
                    this.options.defaultEfficiency
                ),
                0.1,
                2
            );

        const absenceRate =
            clamp(
                toNumber(
                    capacity.absenceRate ??
                    context.metadata.absenceRate ??
                    this.options.defaultAbsenceRate
                ),
                0,
                1
            );

        const shrinkage =
            clamp(
                toNumber(
                    capacity.shrinkage ??
                    context.metadata.shrinkage ??
                    this.options.defaultShrinkage
                ),
                0,
                0.9
            );

        const effectiveStaff =
            staffCount *
            (
                1 -
                absenceRate
            ) *
            (
                1 -
                shrinkage
            );

        return {

            staffCount:
                round(
                    staffCount,
                    4
                ),

            effectiveStaff:
                round(
                    effectiveStaff,
                    4
                ),

            efficiency:
                round(
                    efficiency,
                    4
                ),

            absenceRate:
                round(
                    absenceRate * 100,
                    4
                ),

            shrinkage:
                round(
                    shrinkage * 100,
                    4
                )
        };
    }

    /**
     * =========================================================================
     * Capacity calculation
     * =========================================================================
     */

    _calculateCapacity(
        context,
        workforce
    ) {

        const capacity =
            context.capacity;

        const hoursPerDay =
            clamp(
                toNumber(
                    capacity.workingHoursPerDay ??
                    context.metadata.workingHoursPerDay ??
                    this.options.workingHoursPerDay
                ),
                1,
                24
            );

        const workingDays =
            context.planningHorizon.workingDays;

        const effectiveStaff =
            workforce.effectiveStaff;

        const productiveHours =
            effectiveStaff *
            hoursPerDay *
            workingDays *
            workforce.efficiency;

        const explicitUnitsPerHour =
            toNumber(
                capacity.itemsPerHour ??
                capacity.unitsPerHour ??
                context.metadata.itemsPerHour
            );

        const unitsPerHour =
            explicitUnitsPerHour !== null
                ? explicitUnitsPerHour
                : this.options.defaultItemsPerHour;

        const availableUnits =
            productiveHours *
            unitsPerHour;

        return {

            workingHoursPerDay:
                hoursPerDay,

            workingDays,

            productiveHours:
                round(
                    productiveHours,
                    4
                ),

            unitsPerHour:
                round(
                    unitsPerHour,
                    4
                ),

            availableUnits:
                round(
                    availableUnits,
                    4
                ),

            availableHours:
                round(
                    productiveHours,
                    4
                ),

            reserveUnits:
                round(
                    availableUnits *
                    this._reserveRatio(
                        context
                    ),
                    4
                ),

            planningCapacityUnits:
                round(
                    availableUnits *
                    (
                        1 -
                        this._reserveRatio(
                            context
                        )
                    ),
                    4
                )
        };
    }

    _reserveRatio(context) {

        switch (
            context.planningMode
        ) {

            case PLANNING_MODE.CONSERVATIVE:
                return Math.max(
                    this.options.minimumReserveCapacity,
                    0.25
                );

            case PLANNING_MODE.AGGRESSIVE:
                return Math.min(
                    this.options.minimumReserveCapacity,
                    0.05
                );

            default:
                return this.options
                    .minimumReserveCapacity;
        }
    }

    /**
     * =========================================================================
     * Utilization
     * =========================================================================
     */

    _calculateUtilization(
        workload,
        capacity
    ) {

        const workloadUnits =
            toNumber(
                workload.totalUnits
            );

        const availableUnits =
            toNumber(
                capacity.availableUnits
            );

        const planningCapacityUnits =
            toNumber(
                capacity.planningCapacityUnits
            );

        const utilizationRate =
            availableUnits !== null &&
            availableUnits > 0
                ? (
                    workloadUnits /
                    availableUnits
                ) * 100
                : null;

        const planningUtilizationRate =
            planningCapacityUnits !== null &&
            planningCapacityUnits > 0
                ? (
                    workloadUnits /
                    planningCapacityUnits
                ) * 100
                : null;

        return {

            utilizationRate:
                utilizationRate === null
                    ? null
                    : round(
                        utilizationRate,
                        4
                    ),

            planningUtilizationRate:
                planningUtilizationRate === null
                    ? null
                    : round(
                        planningUtilizationRate,
                        4
                    ),

            availableUnits,
            workloadUnits,

            spareUnits:
                availableUnits !== null &&
                workloadUnits !== null
                    ? round(
                        availableUnits -
                        workloadUnits,
                        4
                    )
                    : null,

            spareCapacityRate:
                availableUnits !== null &&
                workloadUnits !== null &&
                availableUnits > 0
                    ? round(
                        (
                            (
                                availableUnits -
                                workloadUnits
                            ) /
                            availableUnits
                        ) * 100,
                        4
                    )
                    : null
        };
    }

    /**
     * =========================================================================
     * Backlog
     * =========================================================================
     */

    _calculateBacklog(
        context,
        capacity
    ) {

        const pendingRepairs =
            context.repairs.filter(
                repair =>
                    this._isPending(
                        repair
                    )
            ).length;

        const explicitBacklog =
            toNumber(
                context.capacity.backlog
            );

        const backlogUnits =
            explicitBacklog !== null
                ? explicitBacklog
                : pendingRepairs;

        const dailyCapacity =
            context.planningHorizon.workingDays > 0
                ? capacity.availableUnits /
                  context.planningHorizon.workingDays
                : null;

        const backlogDays =
            dailyCapacity !== null &&
            dailyCapacity > 0
                ? backlogUnits /
                  dailyCapacity
                : null;

        return {

            units:
                round(
                    backlogUnits,
                    4
                ),

            pendingRepairs,

            dailyCapacity:
                dailyCapacity === null
                    ? null
                    : round(
                        dailyCapacity,
                        4
                    ),

            estimatedDays:
                backlogDays === null
                    ? null
                    : round(
                        backlogDays,
                        4
                    ),

            pressure:
                this._backlogPressure(
                    backlogDays
                )
        };
    }

    _backlogPressure(
        days
    ) {

        if (
            days === null
        ) {
            return RISK_LEVEL.UNKNOWN;
        }

        if (
            days <= 1
        ) {
            return RISK_LEVEL.LOW;
        }

        if (
            days <= 3
        ) {
            return RISK_LEVEL.MEDIUM;
        }

        if (
            days <= 7
        ) {
            return RISK_LEVEL.HIGH;
        }

        return RISK_LEVEL.CRITICAL;
    }

    /**
     * =========================================================================
     * Demand forecast
     * =========================================================================
     */

    _forecastDemand(
        context,
        workload
    ) {

        const explicitGrowth =
            toNumber(
                context.targets.growthRate ??
                context.metadata.growthRate ??
                context.assumptions.growthRate ??
                this.options.defaultGrowthRate
            );

        const historicalGrowth =
            this._calculateHistoricalGrowth(
                context.history
            );

        const growthRate =
            explicitGrowth !== null &&
            explicitGrowth !== 0
                ? explicitGrowth
                : historicalGrowth;

        const normalizedGrowth =
            growthRate === null
                ? 0
                : growthRate;

        const forecastUnits =
            workload.totalUnits *
            (
                1 +
                normalizedGrowth
            );

        const dailyDemand =
            context.planningHorizon.days > 0
                ? forecastUnits /
                  context.planningHorizon.days
                : null;

        return {

            baselineUnits:
                round(
                    workload.totalUnits,
                    4
                ),

            growthRate:
                round(
                    normalizedGrowth * 100,
                    4
                ),

            forecastUnits:
                round(
                    Math.max(
                        0,
                        forecastUnits
                    ),
                    4
                ),

            dailyDemand:
                dailyDemand === null
                    ? null
                    : round(
                        dailyDemand,
                        4
                    ),

            confidence:
                this._forecastConfidence(
                    context,
                    historicalGrowth
                )
        };
    }

    _calculateHistoricalGrowth(
        history
    ) {

        if (
            !Array.isArray(history) ||
            history.length < 2
        ) {
            return 0;
        }

        const values =
            history
                .map(
                    item =>
                        toNumber(
                            item.workloadUnits ??
                            item.volume ??
                            item.units
                        )
                )
                .filter(
                    value =>
                        value !== null
                );

        if (
            values.length < 2
        ) {
            return 0;
        }

        const first =
            values[0];

        const last =
            values[
                values.length - 1
            ];

        if (
            first === 0
        ) {
            return 0;
        }

        return clamp(
            (
                last -
                first
            ) /
            Math.abs(first),
            -0.95,
            5
        );
    }

    _forecastConfidence(
        context,
        historicalGrowth
    ) {

        let score = 50;

        if (
            context.history.length >= 2
        ) {
            score += 20;
        }

        if (
            context.history.length >= 5
        ) {
            score += 15;
        }

        if (
            context.transactions.length >=
            this.options.minimumSampleSize
        ) {
            score += 10;
        }

        if (
            historicalGrowth !== null
        ) {
            score += 5;
        }

        return clamp(
            score,
            0,
            100
        );
    }

    /**
     * =========================================================================
     * Capacity gap
     * =========================================================================
     */

    _calculateCapacityGap(
        demand,
        capacity
    ) {

        const forecastUnits =
            demand.forecastUnits;

        const availableUnits =
            capacity.planningCapacityUnits;

        if (
            forecastUnits === null ||
            availableUnits === null
        ) {

            return {

                units:
                    null,

                hours:
                    null,

                additionalStaff:
                    null,

                status:
                    'UNKNOWN'
            };
        }

        const gapUnits =
            forecastUnits -
            availableUnits;

        const unitsPerHour =
            capacity.unitsPerHour;

        const gapHours =
            unitsPerHour > 0
                ? gapUnits /
                  unitsPerHour
                : null;

        const hoursPerStaff =
            capacity.workingHoursPerDay *
            capacity.workingDays;

        const additionalStaff =
            gapHours !== null &&
            hoursPerStaff > 0
                ? Math.ceil(
                    Math.max(
                        0,
                        gapHours /
                        hoursPerStaff
                    )
                )
                : null;

        return {

            units:
                round(
                    gapUnits,
                    4
                ),

            hours:
                gapHours === null
                    ? null
                    : round(
                        gapHours,
                        4
                    ),

            additionalStaff,

            status:
                gapUnits <= 0
                    ? 'SURPLUS'
                    : 'SHORTFALL',

            surplusUnits:
                gapUnits < 0
                    ? round(
                        Math.abs(
                            gapUnits
                        ),
                        4
                    )
                    : 0,

            shortfallUnits:
                gapUnits > 0
                    ? round(
                        gapUnits,
                        4
                    )
                    : 0
        };
    }

    /**
     * =========================================================================
     * Status
     * =========================================================================
     */

    _classifyStatus(
        utilization,
        gap,
        dataQuality
    ) {

        if (
            dataQuality.status ===
            STATUS.INSUFFICIENT_DATA
        ) {
            return STATUS.INSUFFICIENT_DATA;
        }

        const utilizationRate =
            utilization.utilizationRate;

        if (
            utilizationRate === null
        ) {
            return STATUS.INSUFFICIENT_DATA;
        }

        if (
            utilizationRate >=
            this.options.criticalUtilization * 100
        ) {

            if (
                gap.status === 'SHORTFALL'
            ) {
                return STATUS.CRITICAL;
            }

            return STATUS.OVERLOADED;
        }

        if (
            utilizationRate >=
            this.options.warningUtilization * 100
        ) {
            return STATUS.CONSTRAINED;
        }

        if (
            utilizationRate <= 60
        ) {
            return STATUS.OPTIMAL;
        }

        return STATUS.HEALTHY;
    }

    /**
     * =========================================================================
     * Risk detection
     * =========================================================================
     */

    _identifyRisks(
        metrics
    ) {

        const risks = [];

        if (
            metrics.utilization
                .utilizationRate !== null &&
            metrics.utilization
                .utilizationRate >=
            100
        ) {

            risks.push({

                code:
                    'CAPACITY_OVERLOAD',

                level:
                    metrics.utilization
                        .utilizationRate >= 120
                        ? RISK_LEVEL.CRITICAL
                        : RISK_LEVEL.HIGH,

                metric:
                    metrics.utilization
                        .utilizationRate,

                description:
                    'Forecast workload exceeds available operational capacity.'
            });
        }

        if (
            metrics.gap.status ===
            'SHORTFALL'
        ) {

            risks.push({

                code:
                    'CAPACITY_SHORTFALL',

                level:
                    metrics.gap.shortfallUnits >
                    metrics.capacity.availableUnits *
                    0.25
                        ? RISK_LEVEL.CRITICAL
                        : RISK_LEVEL.HIGH,

                metric:
                    metrics.gap.shortfallUnits,

                description:
                    'Projected workload cannot be absorbed by current branch capacity.'
            });
        }

        if (
            metrics.backlog.pressure ===
            RISK_LEVEL.CRITICAL
        ) {

            risks.push({

                code:
                    'BACKLOG_PRESSURE',

                level:
                    RISK_LEVEL.CRITICAL,

                metric:
                    metrics.backlog.estimatedDays,

                description:
                    'Existing backlog is expected to require an extended period to clear.'
            });
        }

        if (
            metrics.demand.confidence < 50
        ) {

            risks.push({

                code:
                    'LOW_FORECAST_CONFIDENCE',

                level:
                    RISK_LEVEL.MEDIUM,

                metric:
                    metrics.demand.confidence,

                description:
                    'Demand forecast is based on limited historical evidence.'
            });
        }

        if (
            metrics.workforce.effectiveStaff <
            1
        ) {

            risks.push({

                code:
                    'LOW_EFFECTIVE_WORKFORCE',

                level:
                    RISK_LEVEL.HIGH,

                metric:
                    metrics.workforce.effectiveStaff,

                description:
                    'Effective available workforce is below one full operational resource.'
            });
        }

        return risks;
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

        if (
            metrics.gap.status ===
            'SHORTFALL'
        ) {

            recommendations.push({

                priority:
                    1,

                severity:
                    metrics.gap.additionalStaff > 1
                        ? 'CRITICAL'
                        : 'HIGH',

                category:
                    'CAPACITY_EXPANSION',

                action:
                    metrics.gap.additionalStaff > 0
                        ? `Add or temporarily allocate approximately ${metrics.gap.additionalStaff} additional staff capacity.`
                        : 'Increase available processing hours or throughput.',

                rationale:
                    `Projected demand exceeds planning capacity by ${metrics.gap.shortfallUnits} units.`
            });
        }

        if (
            metrics.utilization
                .utilizationRate >= 85
        ) {

            recommendations.push({

                priority:
                    2,

                severity:
                    metrics.utilization
                        .utilizationRate >= 100
                        ? 'CRITICAL'
                        : 'HIGH',

                category:
                    'WORKLOAD_BALANCING',

                action:
                    'Redistribute workload or increase processing capacity before peak pressure materializes.',

                rationale:
                    `Projected utilization is ${metrics.utilization.utilizationRate}%.`
            });
        }

        if (
            metrics.backlog.pressure ===
            RISK_LEVEL.HIGH ||
            metrics.backlog.pressure ===
            RISK_LEVEL.CRITICAL
        ) {

            recommendations.push({

                priority:
                    2,

                severity:
                    'HIGH',

                category:
                    'BACKLOG_REDUCTION',

                action:
                    'Prioritize backlog clearance using severity, SLA exposure, and financial materiality.',

                rationale:
                    `Backlog is estimated at ${metrics.backlog.estimatedDays} processing days.`
            });
        }

        if (
            metrics.gap.status ===
            'SURPLUS' &&
            metrics.gap.surplusUnits >
            metrics.capacity.availableUnits *
            0.20
        ) {

            recommendations.push({

                priority:
                    3,

                severity:
                    'MEDIUM',

                category:
                    'CAPACITY_REBALANCING',

                action:
                    'Consider transferring suitable workload from constrained branches to this branch.',

                rationale:
                    `Projected surplus capacity is ${metrics.gap.surplusUnits} units.`
            });
        }

        if (
            metrics.demand.confidence < 60
        ) {

            recommendations.push({

                priority:
                    4,

                severity:
                    'MEDIUM',

                category:
                    'DATA_QUALITY',

                action:
                    'Increase historical operational data coverage before making long-range staffing commitments.',

                rationale:
                    `Forecast confidence is ${metrics.demand.confidence}%.`
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
     * Scenario planning
     * =========================================================================
     */

    generateScenarios(
        context,
        workload,
        workforce,
        capacity,
        demand
    ) {

        const baseStaff =
            workforce.staffCount;

        const scenarios = [

            this._scenario(
                'BASELINE',
                0,
                context,
                workload,
                workforce,
                capacity,
                demand
            ),

            this._scenario(
                'ADD_ONE_RESOURCE',
                1,
                context,
                workload,
                workforce,
                capacity,
                demand
            ),

            this._scenario(
                'REDUCE_WORKLOAD_10_PERCENT',
                0,
                context,
                workload,
                workforce,
                capacity,
                {
                    ...demand,
                    forecastUnits:
                        demand.forecastUnits *
                        0.90
                }
            ),

            this._scenario(
                'INCREASE_PRODUCTIVITY_15_PERCENT',
                0,
                context,
                workload,
                workforce,
                {
                    ...capacity,
                    unitsPerHour:
                        capacity.unitsPerHour *
                        1.15
                },
                demand
            )
        ];

        if (
            baseStaff > 1
        ) {

            scenarios.push(
                this._scenario(
                    'REDUCE_ONE_RESOURCE',
                    -1,
                    context,
                    workload,
                    workforce,
                    capacity,
                    demand
                )
            );
        }

        return scenarios
            .slice(
                0,
                this.options.maximumScenarios
            );
    }

    _scenario(
        name,
        staffDelta,
        context,
        workload,
        workforce,
        capacity,
        demand
    ) {

        const scenarioStaff =
            Math.max(
                0,
                workforce.staffCount +
                staffDelta
            );

        const effectiveStaff =
            scenarioStaff *
            (
                1 -
                workforce.absenceRate /
                100
            ) *
            (
                1 -
                workforce.shrinkage /
                100
            );

        const productiveHours =
            effectiveStaff *
            capacity.workingHoursPerDay *
            capacity.workingDays *
            workforce.efficiency;

        const availableUnits =
            productiveHours *
            capacity.unitsPerHour;

        const planningCapacity =
            availableUnits *
            (
                1 -
                this._reserveRatio(
                    context
                )
            );

        const utilization =
            planningCapacity > 0
                ? (
                    demand.forecastUnits /
                    planningCapacity
                ) * 100
                : null;

        const gap =
            demand.forecastUnits -
            planningCapacity;

        return {

            name,

            staffCount:
                round(
                    scenarioStaff,
                    4
                ),

            effectiveStaff:
                round(
                    effectiveStaff,
                    4
                ),

            availableUnits:
                round(
                    availableUnits,
                    4
                ),

            planningCapacityUnits:
                round(
                    planningCapacity,
                    4
                ),

            forecastDemand:
                round(
                    demand.forecastUnits,
                    4
                ),

            utilizationRate:
                utilization === null
                    ? null
                    : round(
                        utilization,
                        4
                    ),

            capacityGap:
                round(
                    gap,
                    4
                ),

            status:
                utilization === null
                    ? STATUS.INSUFFICIENT_DATA
                    : utilization >= 100
                        ? STATUS.OVERLOADED
                        : utilization >= 85
                            ? STATUS.CONSTRAINED
                            : utilization <= 60
                                ? STATUS.OPTIMAL
                                : STATUS.HEALTHY,

            viable:
                gap >= 0,

            staffDelta
        };
    }

    /**
     * =========================================================================
     * Workload allocation
     * =========================================================================
     */

    allocateWorkload(
        workload,
        branches = []
    ) {

        const totalWorkload =
            toNumber(
                workload,
                0
            );

        if (
            !Array.isArray(branches) ||
            branches.length === 0
        ) {
            return [];
        }

        const eligible =
            branches
                .map(
                    branch =>
                        this._normalizeBranchCapacity(
                            branch
                        )
                )
                .filter(
                    branch =>
                        branch.availableUnits > 0
                );

        const totalCapacity =
            eligible.reduce(
                (sum, branch) =>
                    sum +
                    branch.availableUnits,
                0
            );

        if (
            totalCapacity <= 0
        ) {
            return eligible.map(
                branch => ({
                    branchId:
                        branch.branchId,
                    allocatedUnits:
                        0,
                    utilizationAfterAllocation:
                        null
                })
            );
        }

        return eligible.map(
            branch => {

                const allocation =
                    totalWorkload *
                    (
                        branch.availableUnits /
                        totalCapacity
                    );

                return {

                    branchId:
                        branch.branchId,

                    branchName:
                        branch.branchName,

                    availableUnits:
                        round(
                            branch.availableUnits,
                            4
                        ),

                    allocatedUnits:
                        round(
                            allocation,
                            4
                        ),

                    utilizationAfterAllocation:
                        round(
                            (
                                allocation /
                                branch.availableUnits
                            ) * 100,
                            4
                        )
                };
            }
        );
    }

    _normalizeBranchCapacity(
        branch
    ) {

        const source =
            isObject(branch)
                ? branch
                : {};

        return {

            branchId:
                normalizeString(
                    source.branchId
                ),

            branchName:
                normalizeString(
                    source.branchName
                ),

            availableUnits:
                Math.max(
                    0,
                    toNumber(
                        source.availableUnits ??
                        source.planningCapacityUnits ??
                        source.capacity,
                        0
                    )
                )
        };
    }

    /**
     * =========================================================================
     * Capacity rebalance
     * =========================================================================
     */

    recommendRebalancing(
        branches = [],
        totalWorkload = null
    ) {

        const normalized =
            Array.isArray(branches)
                ? branches
                    .map(
                        branch =>
                            this._normalizeBranchCapacity(
                                branch
                            )
                    )
                : [];

        if (
            normalized.length === 0
        ) {
            return [];
        }

        const workload =
            toNumber(
                totalWorkload,
                normalized.reduce(
                    (sum, branch) =>
                        sum +
                        branch.availableUnits,
                    0
                )
            );

        const totalCapacity =
            normalized.reduce(
                (sum, branch) =>
                    sum +
                    branch.availableUnits,
                0
            );

        if (
            totalCapacity <= 0
        ) {
            return [];
        }

        return normalized
            .map(
                branch => {

                    const idealShare =
                        workload *
                        (
                            branch.availableUnits /
                            totalCapacity
                        );

                    return {

                        branchId:
                            branch.branchId,

                        branchName:
                            branch.branchName,

                        availableUnits:
                            round(
                                branch.availableUnits,
                                4
                            ),

                        idealAllocation:
                            round(
                                idealShare,
                                4
                            ),

                        surplus:
                            round(
                                Math.max(
                                    0,
                                    branch.availableUnits -
                                    idealShare
                                ),
                                4
                            ),

                        shortfall:
                            round(
                                Math.max(
                                    0,
                                    idealShare -
                                    branch.availableUnits
                                ),
                                4
                            )
                    };
                }
            );
    }

    /**
     * =========================================================================
     * Data helpers
     * =========================================================================
     */

    _isPending(record) {

        if (
            !isObject(record)
        ) {
            return false;
        }

        if (
            record.pending === true
        ) {
            return true;
        }

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

    /**
     * =========================================================================
     * Integrity
     * =========================================================================
     */

    _generatePlanId() {

        return [
            'capacity-plan',
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

            planningMode:
                result.planningMode,

            status:
                result.status,

            workload:
                result.workload,

            workforce:
                result.workforce,

            capacity:
                result.capacity,

            utilization:
                result.utilization,

            backlog:
                result.backlog,

            demand:
                result.demand,

            gap:
                result.gap,

            scenarios:
                result.scenarios,

            risks:
                result.risks,

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
     * Comparison
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
                'Current and previous capacity plans are required.'
            );
        }

        const metrics = [

            'capacity.availableUnits',
            'utilization.utilizationRate',
            'backlog.units',
            'backlog.estimatedDays',
            'demand.forecastUnits',
            'gap.units',
            'workforce.effectiveStaff'
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
                            ) * 100,
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
     * Factory APIs
     * =========================================================================
     */

    static create(
        options = {}
    ) {

        return new CapacityPlanner(
            options
        );
    }

    static plan(
        input,
        options = {}
    ) {

        return new CapacityPlanner(
            options
        ).plan(
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

    static get RISK_LEVEL() {
        return RISK_LEVEL;
    }

    static get PLANNING_MODE() {
        return PLANNING_MODE;
    }

    static get WORKLOAD_TYPE() {
        return WORKLOAD_TYPE;
    }
}

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports =
    CapacityPlanner;

module.exports.CapacityPlanner =
    CapacityPlanner;

module.exports.STATUS =
    STATUS;

module.exports.RISK_LEVEL =
    RISK_LEVEL;

module.exports.PLANNING_MODE =
    PLANNING_MODE;

module.exports.WORKLOAD_TYPE =
    WORKLOAD_TYPE;

module.exports.SCHEMA_VERSION =
    SCHEMA_VERSION;