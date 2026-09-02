'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * PredictiveRepairScheduler
 * ============================================================================
 *
 * Location:
 *   backend/modules/finance/statements/forecasting/PredictiveRepairScheduler.js
 *
 * Purpose:
 *   Enterprise predictive scheduling engine for financial statement repairs.
 *
 * Responsibilities:
 *
 *   - Analyze historical repair patterns
 *   - Predict future repair demand
 *   - Prioritize anticipated repairs
 *   - Estimate operational repair windows
 *   - Detect repair workload concentration
 *   - Estimate repair urgency
 *   - Detect recurring repair patterns
 *   - Produce explainable scheduling recommendations
 *   - Coordinate intelligence from:
 *       RepairForecastEngine
 *       SettlementReliabilityEngine
 *       reconciliation intelligence
 *       repair history
 *
 * Non-responsibilities:
 *
 *   - Does NOT mutate statements
 *   - Does NOT modify ledger entries
 *   - Does NOT execute repairs
 *   - Does NOT close accounting periods
 *   - Does NOT approve financial adjustments
 *   - Does NOT automatically post journal entries
 *
 * Architectural boundary:
 *
 *       Forecasting Intelligence
 *                |
 *                v
 *       PredictiveRepairScheduler
 *                |
 *        +-------+-------+
 *        |               |
 *        v               v
 *   Schedule Plan    Operational Risk
 *        |
 *        v
 *   Repair Workflow / Queue
 *
 * ============================================================================
 */

const ENGINE_NAME =
    'PredictiveRepairScheduler';

const ENGINE_VERSION =
    '1.0.0';

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const DEFAULTS = Object.freeze({

    historicalDays: 180,

    forecastHorizonDays: 30,

    minimumObservations: 10,

    minimumHistoryDays: 14,

    maxHistoryRecords: 100000,

    maxScheduledItems: 5000,

    movingAverageWindow: 14,

    ewmaAlpha: 0.35,

    planningWindowDays: 7,

    defaultRepairDurationMinutes: 30,

    defaultCapacityPerDay: 50,

    defaultConcurrentWorkers: 1,

    riskThresholds: Object.freeze({

        critical: 0.80,

        high: 0.60,

        medium: 0.35
    }),

    confidenceThresholds: Object.freeze({

        high: 0.80,

        medium: 0.55,

        low: 0.30
    }),

    severityWeights: Object.freeze({

        CRITICAL: 1.00,

        HIGH: 0.80,

        MEDIUM: 0.55,

        LOW: 0.25,

        UNKNOWN: 0.10
    }),

    repairTypeWeights: Object.freeze({

        MISSING_LEDGER_ENTRY: 1.00,

        FAILED_SETTLEMENT_POSTING: 0.95,

        LOAN_REPAYMENT_VARIANCE: 0.90,

        DUPLICATE_LEDGER_ENTRY: 0.85,

        AMOUNT_VARIANCE: 0.80,

        UNMATCHED_TRANSACTION: 0.75,

        RECONCILIATION_VARIANCE: 0.75,

        UNKNOWN: 0.25
    }),

    businessHours: Object.freeze({

        startHour: 8,

        endHour: 17
    }),

    timezone: 'UTC'
});

/**
 * ============================================================================
 * Scheduling levels
 * ============================================================================
 */

const SCHEDULE_PRIORITY = Object.freeze({

    CRITICAL: 'CRITICAL',

    HIGH: 'HIGH',

    MEDIUM: 'MEDIUM',

    LOW: 'LOW'
});

const FORECAST_CONFIDENCE = Object.freeze({

    HIGH: 'HIGH',

    MEDIUM: 'MEDIUM',

    LOW: 'LOW',

    INSUFFICIENT_DATA: 'INSUFFICIENT_DATA'
});

/**
 * ============================================================================
 * Error
 * ============================================================================
 */

class PredictiveRepairSchedulerError
    extends Error {

    constructor(
        message,
        code = 'PREDICTIVE_REPAIR_SCHEDULER_ERROR',
        metadata = {}
    ) {

        super(message);

        this.name =
            'PredictiveRepairSchedulerError';

        this.code =
            code;

        this.metadata =
            metadata;

        Error.captureStackTrace?.(
            this,
            PredictiveRepairSchedulerError
        );
    }
}

/**
 * ============================================================================
 * Utility functions
 * ============================================================================
 */

function isFiniteNumber(value) {

    return Number.isFinite(
        Number(value)
    );
}

function toNumber(
    value,
    fallback = 0
) {

    const number =
        Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}

function clamp(
    value,
    min,
    max
) {

    return Math.min(
        Math.max(
            value,
            min
        ),
        max
    );
}

function round(
    value,
    decimals = 4
) {

    const factor =
        Math.pow(
            10,
            decimals
        );

    return Math.round(
        (
            Number(value) +
            Number.EPSILON
        ) * factor
    ) / factor;
}

function sum(values) {

    return values.reduce(
        (total, value) =>
            total + value,
        0
    );
}

function average(values) {

    if (!values.length) {
        return 0;
    }

    return (
        sum(values) /
        values.length
    );
}

function median(values) {

    if (!values.length) {
        return 0;
    }

    const sorted =
        [...values].sort(
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

        return average([
            sorted[middle - 1],
            sorted[middle]
        ]);
    }

    return sorted[middle];
}

function safeDate(value) {

    if (!value) {
        return null;
    }

    const date =
        value instanceof Date
            ? new Date(
                value.getTime()
            )
            : new Date(value);

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {

        return null;
    }

    return date;
}

function startOfUtcDay(date) {

    const result =
        new Date(date);

    result.setUTCHours(
        0,
        0,
        0,
        0
    );

    return result;
}

function addDays(
    date,
    days
) {

    const result =
        new Date(date);

    result.setUTCDate(
        result.getUTCDate() +
        days
    );

    return result;
}

function addMinutes(
    date,
    minutes
) {

    const result =
        new Date(date);

    result.setUTCMinutes(
        result.getUTCMinutes() +
        minutes
    );

    return result;
}

function dateKey(date) {

    return startOfUtcDay(
        date
    )
        .toISOString()
        .slice(
            0,
            10
        );
}

function normalizeString(
    value,
    fallback = null
) {

    if (
        value === undefined ||
        value === null
    ) {

        return fallback;
    }

    const result =
        String(value).trim();

    return result.length
        ? result
        : fallback;
}

function normalizeUpperCase(
    value,
    fallback = 'UNKNOWN'
) {

    const result =
        normalizeString(
            value,
            fallback
        );

    return result
        ? result.toUpperCase()
        : fallback;
}

function createId() {

    return (
        'prs_' +
        Date.now().toString(36) +
        '_' +
        Math.random()
            .toString(36)
            .slice(2, 10)
    );
}

/**
 * ============================================================================
 * PredictiveRepairScheduler
 * ============================================================================
 */

class PredictiveRepairScheduler {

    /**
     * ========================================================================
     * Constructor
     * ========================================================================
     */

    constructor(
        options = {}
    ) {

        this.config =
            Object.freeze({
                ...DEFAULTS,
                ...(options.config || {}),

                riskThresholds:
                    Object.freeze({
                        ...DEFAULTS.riskThresholds,
                        ...(
                            options.config
                                ?.riskThresholds ||
                            {}
                        )
                    }),

                confidenceThresholds:
                    Object.freeze({
                        ...DEFAULTS.confidenceThresholds,
                        ...(
                            options.config
                                ?.confidenceThresholds ||
                            {}
                        )
                    }),

                severityWeights:
                    Object.freeze({
                        ...DEFAULTS.severityWeights,
                        ...(
                            options.config
                                ?.severityWeights ||
                            {}
                        )
                    }),

                repairTypeWeights:
                    Object.freeze({
                        ...DEFAULTS.repairTypeWeights,
                        ...(
                            options.config
                                ?.repairTypeWeights ||
                            {}
                        )
                    })
            });

        this.dataProvider =
            options.dataProvider ||
            options.repository ||
            null;

        this.repairForecastEngine =
            options.repairForecastEngine ||
            null;

        this.settlementReliabilityEngine =
            options.settlementReliabilityEngine ||
            null;

        this.logger =
            options.logger ||
            null;

        this.metrics =
            options.metrics ||
            null;

        this.clock =
            typeof options.clock ===
            'function'
                ? options.clock
                : () => new Date();
    }

    /**
     * ========================================================================
     * Primary API
     * ========================================================================
     */

    async analyze(
        options = {}
    ) {

        const startedAt =
            Date.now();

        const context =
            this._createContext(
                options
            );

        try {

            this._validateContext(
                context
            );

            const history =
                await this._loadRepairHistory(
                    context
                );

            const normalized =
                this._normalizeRepairHistory(
                    history,
                    context
                );

            const dataQuality =
                this._assessDataQuality(
                    normalized,
                    context
                );

            const demand =
                this._forecastRepairDemand(
                    normalized,
                    context
                );

            const patterns =
                this._detectRepairPatterns(
                    normalized
                );

            const workload =
                this._calculateWorkload(
                    normalized,
                    demand
                );

            const capacity =
                this._calculateCapacity(
                    options,
                    workload,
                    context
                );

            const settlementReliability =
                await this._getSettlementReliability(
                    context,
                    options
                );

            const candidates =
                this._buildScheduleCandidates(
                    normalized,
                    demand,
                    patterns,
                    settlementReliability,
                    context
                );

            const schedule =
                this._buildSchedule(
                    candidates,
                    capacity,
                    context
                );

            const risk =
                this._calculateScheduleRisk(
                    {
                        demand,
                        workload,
                        capacity,
                        schedule,
                        dataQuality,
                        settlementReliability
                    }
                );

            const recommendations =
                this._generateRecommendations(
                    {
                        demand,
                        workload,
                        capacity,
                        schedule,
                        risk,
                        dataQuality,
                        patterns,
                        settlementReliability
                    }
                );

            const result = {

                scheduleId:
                    createId(),

                engine: {

                    name:
                        ENGINE_NAME,

                    version:
                        ENGINE_VERSION
                },

                tenantId:
                    context.tenantId,

                asOf:
                    context.asOf
                        .toISOString(),

                planningPeriod: {

                    historicalDays:
                        context.historicalDays,

                    forecastHorizonDays:
                        context.forecastHorizonDays,

                    startDate:
                        context.startDate
                            .toISOString(),

                    endDate:
                        context.endDate
                            .toISOString()
                },

                dataQuality,

                demand,

                patterns,

                workload,

                capacity,

                settlementReliability,

                schedule,

                risk,

                recommendations,

                explainability:
                    this._buildExplainability(
                        {
                            demand,
                            patterns,
                            workload,
                            capacity,
                            schedule,
                            risk,
                            dataQuality,
                            settlementReliability
                        }
                    ),

                generatedAt:
                    this.clock()
                        .toISOString(),

                execution: {

                    durationMs:
                        Date.now() -
                        startedAt
                }
            };

            this._recordMetric(
                'predictive_repair_scheduler.analyzed',
                result
            );

            this._logInfo(
                'Predictive repair schedule generated',
                {
                    scheduleId:
                        result.scheduleId,

                    tenantId:
                        context.tenantId,

                    forecastedRepairs:
                        demand.totalForecastedRepairs,

                    scheduledRepairs:
                        schedule.totalScheduled,

                    riskLevel:
                        risk.level,

                    durationMs:
                        result.execution
                            .durationMs
                }
            );

            return result;

        } catch (error) {

            this._recordMetric(
                'predictive_repair_scheduler.failed',
                {
                    tenantId:
                        context.tenantId,

                    errorCode:
                        error.code
                }
            );

            this._logError(
                'Predictive repair scheduling failed',
                {
                    tenantId:
                        context.tenantId,

                    error
                }
            );

            if (
                error instanceof
                PredictiveRepairSchedulerError
            ) {

                throw error;
            }

            throw new PredictiveRepairSchedulerError(
                'Unable to generate predictive repair schedule.',
                'PREDICTIVE_SCHEDULING_FAILED',
                {
                    cause:
                        error.message
                }
            );
        }
    }

    /**
     * Semantic alias.
     */
    async schedule(
        options = {}
    ) {

        return this.analyze(
            options
        );
    }

    /**
     * Generate forecast only.
     */
    async forecastDemand(
        options = {}
    ) {

        const context =
            this._createContext(
                options
            );

        this._validateContext(
            context
        );

        const history =
            await this._loadRepairHistory(
                context
            );

        const normalized =
            this._normalizeRepairHistory(
                history,
                context
            );

        return this._forecastRepairDemand(
            normalized,
            context
        );
    }

    /**
     * Generate prioritized schedule only.
     */
    async generateSchedule(
        options = {}
    ) {

        const result =
            await this.analyze(
                options
            );

        return result.schedule;
    }

    /**
     * Dashboard-oriented output.
     */
    async getDashboard(
        options = {}
    ) {

        const result =
            await this.analyze(
                options
            );

        return {

            scheduleId:
                result.scheduleId,

            tenantId:
                result.tenantId,

            asOf:
                result.asOf,

            summary: {

                forecastedRepairs:
                    result.demand
                        .totalForecastedRepairs,

                scheduledRepairs:
                    result.schedule
                        .totalScheduled,

                unscheduledRepairs:
                    result.schedule
                        .unscheduledCount,

                capacityUtilization:
                    result.capacity
                        .utilizationRate,

                riskLevel:
                    result.risk.level,

                confidence:
                    result.demand
                        .confidence
            },

            demand:
                result.demand,

            workload:
                result.workload,

            capacity:
                result.capacity,

            schedule:
                result.schedule,

            risk:
                result.risk,

            recommendations:
                result.recommendations,

            generatedAt:
                result.generatedAt
        };
    }

    /**
     * Health endpoint.
     */
    health() {

        return {

            healthy: true,

            engine:
                ENGINE_NAME,

            version:
                ENGINE_VERSION,

            timestamp:
                this.clock()
                    .toISOString(),

            dataProviderConfigured:
                Boolean(
                    this.dataProvider
                ),

            repairForecastEngineConfigured:
                Boolean(
                    this.repairForecastEngine
                ),

            settlementReliabilityEngineConfigured:
                Boolean(
                    this.settlementReliabilityEngine
                )
        };
    }

    /**
     * Engine metadata.
     */
    getMetadata() {

        return {

            name:
                ENGINE_NAME,

            version:
                ENGINE_VERSION,

            capabilities: [

                'repair_demand_forecasting',

                'predictive_repair_scheduling',

                'repair_priority_scoring',

                'repair_workload_forecasting',

                'capacity_planning',

                'repair_pattern_detection',

                'settlement_aware_prioritization',

                'schedule_risk_analysis',

                'repair_schedule_explainability'
            ],

            analyticalOnly:
                true
        };
    }

    /**
     * ========================================================================
     * Context
     * ========================================================================
     */

    _createContext(
        options
    ) {

        const asOf =
            safeDate(
                options.asOf
            ) ||
            safeDate(
                this.clock()
            ) ||
            new Date();

        const historicalDays =
            this._positiveInteger(
                options.historicalDays,
                this.config.historicalDays
            );

        const forecastHorizonDays =
            this._positiveInteger(
                options.forecastHorizonDays ||
                options.horizonDays,
                this.config.forecastHorizonDays
            );

        const normalizedAsOf =
            startOfUtcDay(
                asOf
            );

        return {

            tenantId:
                normalizeString(
                    options.tenantId
                ),

            asOf:
                normalizedAsOf,

            startDate:
                addDays(
                    normalizedAsOf,
                    -historicalDays
                ),

            endDate:
                addDays(
                    normalizedAsOf,
                    forecastHorizonDays
                ),

            historicalDays:
                Math.min(
                    historicalDays,
                    3650
                ),

            forecastHorizonDays:
                Math.min(
                    forecastHorizonDays,
                    365
                ),

            provider:
                normalizeString(
                    options.provider
                ),

            branchId:
                normalizeString(
                    options.branchId
                ),

            capacityPerDay:
                isFiniteNumber(
                    options.capacityPerDay
                )
                    ? Math.max(
                        1,
                        Number(
                            options.capacityPerDay
                        )
                    )
                    : this.config
                        .defaultCapacityPerDay,

            concurrentWorkers:
                isFiniteNumber(
                    options.concurrentWorkers
                )
                    ? Math.max(
                        1,
                        Number(
                            options.concurrentWorkers
                        )
                    )
                    : this.config
                        .defaultConcurrentWorkers
        };
    }

    _positiveInteger(
        value,
        fallback
    ) {

        const number =
            Number(value);

        if (
            !Number.isInteger(
                number
            ) ||
            number <= 0
        ) {

            return fallback;
        }

        return number;
    }

    _validateContext(
        context
    ) {

        if (!context.tenantId) {

            throw new PredictiveRepairSchedulerError(
                'tenantId is required.',
                'TENANT_ID_REQUIRED'
            );
        }
    }

    /**
     * ========================================================================
     * Repository Loading
     * ========================================================================
     */

    async _loadRepairHistory(
        context
    ) {

        if (!this.dataProvider) {
            return [];
        }

        const request = {

            tenantId:
                context.tenantId,

            startDate:
                context.startDate,

            endDate:
                context.asOf,

            provider:
                context.provider,

            branchId:
                context.branchId,

            limit:
                this.config.maxHistoryRecords
        };

        let result;

        if (
            typeof this.dataProvider
                .getRepairHistory ===
            'function'
        ) {

            result =
                await this.dataProvider
                    .getRepairHistory(
                        request
                    );

        } else if (
            typeof this.dataProvider
                .findRepairHistory ===
            'function'
        ) {

            result =
                await this.dataProvider
                    .findRepairHistory(
                        request
                    );

        } else if (
            typeof this.dataProvider
                .listRepairs ===
            'function'
        ) {

            result =
                await this.dataProvider
                    .listRepairs(
                        request
                    );

        } else if (
            typeof this.dataProvider
                .findRepairs ===
            'function'
        ) {

            result =
                await this.dataProvider
                    .findRepairs(
                        request
                    );

        } else {

            throw new PredictiveRepairSchedulerError(
                'Configured repair data provider does not expose a supported history method.',
                'UNSUPPORTED_DATA_PROVIDER'
            );
        }

        if (
            Array.isArray(result)
        ) {

            return result;
        }

        if (
            Array.isArray(
                result?.records
            )
        ) {

            return result.records;
        }

        if (
            Array.isArray(
                result?.items
            )
        ) {

            return result.items;
        }

        return [];
    }

    /**
     * ========================================================================
     * Normalization
     * ========================================================================
     */

    _normalizeRepairHistory(
        history,
        context
    ) {

        if (
            !Array.isArray(history)
        ) {

            return [];
        }

        const normalized = [];

        for (
            const record of history
        ) {

            if (
                !record ||
                typeof record !==
                'object'
            ) {

                continue;
            }

            const createdAt =
                safeDate(
                    record.createdAt ||
                    record.detectedAt ||
                    record.repairDate ||
                    record.timestamp ||
                    record.updatedAt
                );

            if (!createdAt) {
                continue;
            }

            if (
                createdAt <
                context.startDate ||
                createdAt >
                context.asOf
            ) {

                continue;
            }

            const type =
                normalizeUpperCase(
                    record.type ||
                    record.repairType ||
                    record.issueType ||
                    record.category
                );

            const severity =
                normalizeUpperCase(
                    record.severity ||
                    record.priority
                );

            const status =
                normalizeUpperCase(
                    record.status ||
                    record.repairStatus
                );

            const durationMinutes =
                this._extractDuration(
                    record
                );

            normalized.push({

                id:
                    normalizeString(
                        record.id ||
                        record.repairId ||
                        record._id
                    ) ||
                    createId(),

                tenantId:
                    normalizeString(
                        record.tenantId
                    ),

                type,

                severity,

                status,

                createdAt,

                branchId:
                    normalizeString(
                        record.branchId
                    ),

                provider:
                    normalizeString(
                        record.provider ||
                        record.providerCode
                    ),

                amount:
                    this._extractAmount(
                        record
                    ),

                durationMinutes,

                automated:
                    this._extractBoolean(
                        record.automated
                    ),

                resolved:
                    this._isResolved(
                        record
                    )
            });
        }

        return normalized.filter(
            item =>
                !item.tenantId ||
                item.tenantId ===
                context.tenantId
        );
    }

    _extractAmount(
        record
    ) {

        const fields = [

            'amount',

            'varianceAmount',

            'transactionAmount',

            'expectedAmount'
        ];

        for (
            const field of fields
        ) {

            if (
                isFiniteNumber(
                    record[field]
                )
            ) {

                return Number(
                    record[field]
                );
            }
        }

        return null;
    }

    _extractDuration(
        record
    ) {

        if (
            isFiniteNumber(
                record.durationMinutes
            )
        ) {

            return Math.max(
                0,
                Number(
                    record.durationMinutes
                )
            );
        }

        if (
            isFiniteNumber(
                record.repairDurationMs
            )
        ) {

            return Math.max(
                0,
                Number(
                    record.repairDurationMs
                ) /
                60000
            );
        }

        const start =
            safeDate(
                record.startedAt ||
                record.createdAt
            );

        const end =
            safeDate(
                record.completedAt ||
                record.resolvedAt
            );

        if (
            start &&
            end &&
            end >= start
        ) {

            return (
                end.getTime() -
                start.getTime()
            ) / 60000;
        }

        return this.config
            .defaultRepairDurationMinutes;
    }

    _extractBoolean(
        value
    ) {

        if (
            typeof value ===
            'boolean'
        ) {

            return value;
        }

        if (
            value === 'true' ||
            value === 1 ||
            value === '1'
        ) {

            return true;
        }

        if (
            value === 'false' ||
            value === 0 ||
            value === '0'
        ) {

            return false;
        }

        return false;
    }

    _isResolved(
        record
    ) {

        if (
            typeof record.resolved ===
            'boolean'
        ) {

            return record.resolved;
        }

        const status =
            normalizeUpperCase(
                record.status ||
                record.repairStatus
            );

        return [
            'RESOLVED',
            'REPAIRED',
            'COMPLETED',
            'CLOSED',
            'SUCCESS'
        ].includes(status);
    }

    /**
     * ========================================================================
     * Data Quality
     * ========================================================================
     */

    _assessDataQuality(
        history,
        context
    ) {

        const observations =
            history.length;

        const observationDays =
            new Set(
                history.map(
                    item =>
                        dateKey(
                            item.createdAt
                        )
                )
            ).size;

        const coverageRatio =
            context.historicalDays > 0
                ? observationDays /
                  context.historicalDays
                : 0;

        const typedRatio =
            observations
                ? history.filter(
                    item =>
                        item.type !==
                        'UNKNOWN'
                ).length /
                  observations
                : 0;

        const severityRatio =
            observations
                ? history.filter(
                    item =>
                        item.severity !==
                        'UNKNOWN'
                ).length /
                  observations
                : 0;

        const observationScore =
            clamp(
                observations /
                (
                    this.config
                        .minimumObservations *
                    5
                ),
                0,
                1
            );

        const score =
            clamp(
                (
                    observationScore *
                    0.40
                ) +
                (
                    clamp(
                        coverageRatio,
                        0,
                        1
                    ) *
                    0.25
                ) +
                (
                    typedRatio *
                    0.20
                ) +
                (
                    severityRatio *
                    0.15
                ),
                0,
                1
            );

        return {

            score:
                round(score),

            observations,

            observationDays,

            coverageRatio:
                round(
                    clamp(
                        coverageRatio,
                        0,
                        1
                    )
                ),

            typedRatio:
                round(
                    typedRatio
                ),

            severityRatio:
                round(
                    severityRatio
                ),

            sufficientHistory:
                observations >=
                this.config
                    .minimumObservations &&
                observationDays >=
                this.config
                    .minimumHistoryDays
        };
    }

    /**
     * ========================================================================
     * Demand Forecast
     * ========================================================================
     */

    _forecastRepairDemand(
        history,
        context
    ) {

        const daily =
            this._buildDailyDemandSeries(
                history,
                context
            );

        const values =
            daily.map(
                item =>
                    item.count
            );

        const recent =
            values.slice(
                -this.config
                    .movingAverageWindow
            );

        const movingAverage =
            average(recent);

        const ewma =
            this._calculateEwma(
                values,
                this.config.ewmaAlpha
            );

        const trend =
            this._calculateDemandTrend(
                values
            );

        const baseline =
            (
                movingAverage *
                0.45
            ) +
            (
                ewma *
                0.35
            ) +
            (
                trend.currentDemand *
                0.20
            );

        const dailyForecast = [];

        let totalForecasted =
            0;

        for (
            let offset = 1;
            offset <=
            context.forecastHorizonDays;
            offset += 1
        ) {

            let expected =
                baseline +
                (
                    trend.slopePerDay *
                    offset
                );

            expected =
                Math.max(
                    0,
                    expected
                );

            /*
             * Demand is count-based. Preserve fractional forecast internally,
             * then round for operational scheduling.
             */
            const rounded =
                Math.max(
                    0,
                    Math.round(
                        expected
                    )
                );

            totalForecasted +=
                rounded;

            dailyForecast.push({

                date:
                    dateKey(
                        addDays(
                            context.asOf,
                            offset
                        )
                    ),

                expectedRepairs:
                    rounded
            });
        }

        const confidence =
            this._calculateForecastConfidence(
                history,
                daily,
                context
            );

        const typeForecast =
            this._forecastByRepairType(
                history,
                totalForecasted
            );

        return {

            baselineDailyDemand:
                round(
                    baseline,
                    2
                ),

            movingAverageDailyDemand:
                round(
                    movingAverage,
                    2
                ),

            ewmaDailyDemand:
                round(
                    ewma,
                    2
                ),

            trend,

            confidence:
                confidence.label,

            confidenceScore:
                confidence.score,

            totalForecastedRepairs:
                totalForecasted,

            averageDailyForecast:
                round(
                    totalForecasted /
                    Math.max(
                        context.forecastHorizonDays,
                        1
                    ),
                    2
                ),

            daily:
                dailyForecast,

            byRepairType:
                typeForecast
        };
    }

    _buildDailyDemandSeries(
        history,
        context
    ) {

        const buckets =
            new Map();

        for (
            let day = 0;
            day < context.historicalDays;
            day += 1
        ) {

            const date =
                addDays(
                    context.startDate,
                    day
                );

            buckets.set(
                dateKey(date),
                0
            );
        }

        for (
            const item of history
        ) {

            const key =
                dateKey(
                    item.createdAt
                );

            if (
                buckets.has(key)
            ) {

                buckets.set(
                    key,
                    buckets.get(key) + 1
                );
            }
        }

        return [
            ...buckets.entries()
        ].map(
            ([
                date,
                count
            ]) => ({
                date,
                count
            })
        );
    }

    _calculateEwma(
        values,
        alpha
    ) {

        if (!values.length) {
            return 0;
        }

        let result =
            values[0];

        for (
            let index = 1;
            index < values.length;
            index += 1
        ) {

            result =
                (
                    alpha *
                    values[index]
                ) +
                (
                    (
                        1 - alpha
                    ) *
                    result
                );
        }

        return result;
    }

    _calculateDemandTrend(
        values
    ) {

        if (
            values.length < 2
        ) {

            return {

                direction:
                    'INSUFFICIENT_DATA',

                slopePerDay:
                    0,

                strength:
                    0,

                currentDemand:
                    values[0] || 0
            };
        }

        const firstHalf =
            average(
                values.slice(
                    0,
                    Math.max(
                        1,
                        Math.floor(
                            values.length /
                            2
                        )
                    )
                )
            );

        const secondHalf =
            average(
                values.slice(
                    Math.floor(
                        values.length /
                        2
                    )
                )
            );

        const delta =
            secondHalf -
            firstHalf;

        const relativeDelta =
            firstHalf > 0
                ? delta /
                  firstHalf
                : delta;

        let direction =
            'STABLE';

        if (
            relativeDelta >
            0.05
        ) {

            direction =
                'INCREASING';

        } else if (
            relativeDelta <
            -0.05
        ) {

            direction =
                'DECREASING';
        }

        return {

            direction,

            slopePerDay:
                round(
                    delta /
                    Math.max(
                        values.length,
                        1
                    ),
                    4
                ),

            strength:
                round(
                    clamp(
                        Math.abs(
                            relativeDelta
                        ),
                        0,
                        1
                    )
                ),

            currentDemand:
                secondHalf
        };
    }

    _calculateForecastConfidence(
        history,
        daily,
        context
    ) {

        const observations =
            history.length;

        const daysWithData =
            daily.filter(
                item =>
                    item.count > 0
            ).length;

        const coverage =
            context.historicalDays
                ? daysWithData /
                  context.historicalDays
                : 0;

        const observationScore =
            clamp(
                observations /
                (
                    this.config
                        .minimumObservations *
                    5
                ),
                0,
                1
            );

        const score =
            clamp(
                (
                    observationScore *
                    0.60
                ) +
                (
                    coverage *
                    0.40
                ),
                0,
                1
            );

        let label =
            FORECAST_CONFIDENCE
                .LOW;

        if (
            score >=
            this.config
                .confidenceThresholds
                .high
        ) {

            label =
                FORECAST_CONFIDENCE
                    .HIGH;

        } else if (
            score >=
            this.config
                .confidenceThresholds
                .medium
        ) {

            label =
                FORECAST_CONFIDENCE
                    .MEDIUM;

        } else if (
            score <
            this.config
                .confidenceThresholds
                .low
        ) {

            label =
                FORECAST_CONFIDENCE
                    .INSUFFICIENT_DATA;
        }

        return {

            score:
                round(score),

            label
        };
    }

    _forecastByRepairType(
        history,
        totalForecasted
    ) {

        const counts =
            new Map();

        for (
            const item of history
        ) {

            counts.set(
                item.type,
                (
                    counts.get(
                        item.type
                    ) || 0
                ) + 1
            );
        }

        const total =
            history.length;

        if (!total) {
            return [];
        }

        return [
            ...counts.entries()
        ]
            .map(
                ([
                    type,
                    count
                ]) => {

                    const proportion =
                        count /
                        total;

                    return {

                        type,

                        historicalCount:
                            count,

                        historicalShare:
                            round(
                                proportion
                            ),

                        forecastedCount:
                            Math.round(
                                totalForecasted *
                                proportion
                            )
                    };
                }
            )
            .sort(
                (
                    a,
                    b
                ) =>
                    b.forecastedCount -
                    a.forecastedCount
            );
    }

    /**
     * ========================================================================
     * Pattern Detection
     * ========================================================================
     */

    _detectRepairPatterns(
        history
    ) {

        const byType =
            this._groupBy(
                history,
                item =>
                    item.type
            );

        const bySeverity =
            this._groupBy(
                history,
                item =>
                    item.severity
            );

        const byProvider =
            this._groupBy(
                history,
                item =>
                    item.provider ||
                    'UNKNOWN'
            );

        const byBranch =
            this._groupBy(
                history,
                item =>
                    item.branchId ||
                    'UNKNOWN'
            );

        const recurringTypes =
            [
                ...byType.entries()
            ]
                .map(
                    ([
                        type,
                        records
                    ]) => ({
                        type,

                        count:
                            records.length,

                        share:
                            history.length
                                ? round(
                                    records.length /
                                    history.length
                                )
                                : 0,

                        averageDurationMinutes:
                            round(
                                average(
                                    records.map(
                                        item =>
                                            item.durationMinutes
                                    )
                                ),
                                2
                            )
                    })
                )
                .sort(
                    (
                        a,
                        b
                    ) =>
                        b.count -
                        a.count
                );

        const recurringProviders =
            this._rankGroups(
                byProvider,
                history.length
            );

        const recurringBranches =
            this._rankGroups(
                byBranch,
                history.length
            );

        const severityDistribution =
            this._rankGroups(
                bySeverity,
                history.length
            );

        return {

            recurringTypes,

            recurringProviders,

            recurringBranches,

            severityDistribution,

            dominantRepairType:
                recurringTypes[0]?.type ||
                null,

            dominantProvider:
                recurringProviders[0]?.key ||
                null,

            dominantBranch:
                recurringBranches[0]?.key ||
                null
        };
    }

    _groupBy(
        values,
        selector
    ) {

        const groups =
            new Map();

        for (
            const value of values
        ) {

            const key =
                selector(value);

            if (
                !groups.has(key)
            ) {

                groups.set(
                    key,
                    []
                );
            }

            groups
                .get(key)
                .push(value);
        }

        return groups;
    }

    _rankGroups(
        groups,
        total
    ) {

        return [
            ...groups.entries()
        ]
            .map(
                ([
                    key,
                    records
                ]) => ({

                    key,

                    count:
                        records.length,

                    share:
                        total
                            ? round(
                                records.length /
                                total
                            )
                            : 0
                })
            )
            .sort(
                (
                    a,
                    b
                ) =>
                    b.count -
                    a.count
            );
    }

    /**
     * ========================================================================
     * Workload
     * ========================================================================
     */

    _calculateWorkload(
        history,
        demand
    ) {

        const averageDuration =
            history.length
                ? average(
                    history.map(
                        item =>
                            item.durationMinutes
                    )
                )
                : this.config
                    .defaultRepairDurationMinutes;

        const forecastedMinutes =
            demand.totalForecastedRepairs *
            averageDuration;

        const forecastedHours =
            forecastedMinutes /
            60;

        return {

            historicalAverageRepairMinutes:
                round(
                    averageDuration,
                    2
                ),

            forecastedRepairMinutes:
                round(
                    forecastedMinutes,
                    2
                ),

            forecastedRepairHours:
                round(
                    forecastedHours,
                    2
                ),

            averageDailyRepairMinutes:
                round(
                    forecastedMinutes /
                    Math.max(
                        demand.daily.length,
                        1
                    ),
                    2
                )
        };
    }

    /**
     * ========================================================================
     * Capacity
     * ========================================================================
     */

    _calculateCapacity(
        options,
        workload,
        context
    ) {

        const capacityPerDay =
            context.capacityPerDay;

        const totalCapacity =
            capacityPerDay *
            context.forecastHorizonDays;

        const required =
            workload
                .forecastedRepairHours *
            60 /
            Math.max(
                this.config
                    .defaultRepairDurationMinutes,
                1
            );

        const utilizationRate =
            totalCapacity > 0
                ? required /
                  totalCapacity
                : 1;

        let status =
            'HEALTHY';

        if (
            utilizationRate >=
            1
        ) {

            status =
                'OVER_CAPACITY';

        } else if (
            utilizationRate >=
            0.85
        ) {

            status =
                'AT_RISK';
        }

        return {

            capacityPerDay,

            totalCapacity,

            requiredCapacity:
                Math.ceil(
                    required
                ),

            utilizationRate:
                round(
                    utilizationRate
                ),

            utilizationPercentage:
                round(
                    utilizationRate *
                    100,
                    2
                ),

            status,

            concurrentWorkers:
                context.concurrentWorkers,

            planningWindowDays:
                this.config
                    .planningWindowDays
        };
    }

    /**
     * ========================================================================
     * Settlement Reliability Integration
     * ========================================================================
     */

    async _getSettlementReliability(
        context,
        options
    ) {

        if (
            !this.settlementReliabilityEngine
        ) {

            return {

                available:
                    false,

                score:
                    null,

                level:
                    null,

                provider:
                    null
            };
        }

        try {

            const result =
                await this
                    .settlementReliabilityEngine
                    .getReliabilityScore({
                        tenantId:
                            context.tenantId,

                        provider:
                            context.provider,

                        historicalDays:
                            context.historicalDays,

                        forecastHorizonDays:
                            context.forecastHorizonDays,

                        asOf:
                            context.asOf
                    });

            return {

                available:
                    true,

                score:
                    toNumber(
                        result.score,
                        0
                    ),

                level:
                    result.level ||
                    null,

                confidence:
                    toNumber(
                        result.confidence,
                        0
                    ),

                risk:
                    result.risk ||
                    null
            };

        } catch (error) {

            this._logWarn(
                'Settlement reliability intelligence unavailable for predictive repair scheduling',
                {
                    tenantId:
                        context.tenantId,

                    error:
                        error.message
                }
            );

            return {

                available:
                    false,

                score:
                    null,

                level:
                    null,

                provider:
                    context.provider
            };
        }
    }

    /**
     * ========================================================================
     * Schedule Candidate Construction
     * ========================================================================
     */

    _buildScheduleCandidates(
        history,
        demand,
        patterns,
        settlementReliability,
        context
    ) {

        const candidates = [];

        /*
         * Forecast future repair demand by type.
         */
        for (
            const forecastType of
            demand.byRepairType
        ) {

            const type =
                forecastType.type;

            const forecastCount =
                forecastType
                    .forecastedCount;

            const historicalRecords =
                history.filter(
                    item =>
                        item.type ===
                        type
                );

            const representative =
                this._representativeRepair(
                    historicalRecords
                );

            const severity =
                representative.severity;

            const provider =
                representative.provider;

            const duration =
                representative
                    .durationMinutes;

            const recurrenceScore =
                clamp(
                    forecastType
                        .historicalShare *
                    2,
                    0,
                    1
                );

            const severityScore =
                this._severityScore(
                    severity
                );

            const typeScore =
                this._repairTypeScore(
                    type
                );

            const settlementScore =
                this._settlementInfluence(
                    settlementReliability,
                    provider
                );

            const priorityScore =
                clamp(
                    (
                        severityScore *
                        0.35
                    ) +
                    (
                        typeScore *
                        0.20
                    ) +
                    (
                        recurrenceScore *
                        0.20
                    ) +
                    (
                        settlementScore *
                        0.15
                    ) +
                    (
                        (
                            demand
                                .confidenceScore
                        ) *
                        0.10
                    ),
                    0,
                    1
                );

            const priority =
                this._classifyPriority(
                    priorityScore
                );

            for (
                let index = 0;
                index < forecastCount;
                index += 1
            ) {

                candidates.push({

                    candidateId:
                        createId(),

                    repairType:
                        type,

                    severity,

                    provider,

                    branchId:
                        representative.branchId,

                    estimatedDurationMinutes:
                        duration,

                    recurrenceScore:
                        round(
                            recurrenceScore
                        ),

                    severityScore:
                        round(
                            severityScore
                        ),

                    typeScore:
                        round(
                            typeScore
                        ),

                    settlementScore:
                        round(
                            settlementScore
                        ),

                    priorityScore:
                        round(
                            priorityScore
                        ),

                    priority,

                    forecastSource:
                        'HISTORICAL_DEMAND_MODEL'
                });
            }
        }

        return candidates
            .slice(
                0,
                this.config.maxScheduledItems
            );
    }

    _representativeRepair(
        records
    ) {

        if (!records.length) {

            return {

                severity:
                    'UNKNOWN',

                provider:
                    null,

                branchId:
                    null,

                durationMinutes:
                    this.config
                        .defaultRepairDurationMinutes
            };
        }

        const severityCounts =
            this._countBy(
                records,
                item =>
                    item.severity
            );

        const providerCounts =
            this._countBy(
                records,
                item =>
                    item.provider
            );

        const branchCounts =
            this._countBy(
                records,
                item =>
                    item.branchId
            );

        return {

            severity:
                this._maxKey(
                    severityCounts
                ) || 'UNKNOWN',

            provider:
                this._maxKey(
                    providerCounts
                ) || null,

            branchId:
                this._maxKey(
                    branchCounts
                ) || null,

            durationMinutes:
                median(
                    records.map(
                        item =>
                            item.durationMinutes
                    )
                ) ||
                this.config
                    .defaultRepairDurationMinutes
        };
    }

    _countBy(
        values,
        selector
    ) {

        const result =
            new Map();

        for (
            const value of values
        ) {

            const key =
                selector(value);

            if (!key) {
                continue;
            }

            result.set(
                key,
                (
                    result.get(key) ||
                    0
                ) + 1
            );
        }

        return result;
    }

    _maxKey(
        map
    ) {

        let result =
            null;

        let maximum =
            -1;

        for (
            const [
                key,
                value
            ] of map
        ) {

            if (
                value >
                maximum
            ) {

                maximum =
                    value;

                result =
                    key;
            }
        }

        return result;
    }

    _severityScore(
        severity
    ) {

        return (
            this.config
                .severityWeights[
                    severity
                ] ||
            this.config
                .severityWeights
                .UNKNOWN
        );
    }

    _repairTypeScore(
        type
    ) {

        return (
            this.config
                .repairTypeWeights[
                    type
                ] ||
            this.config
                .repairTypeWeights
                .UNKNOWN
        );
    }

    _settlementInfluence(
        settlementReliability,
        provider
    ) {

        if (
            !settlementReliability.available
        ) {

            return 0.50;
        }

        if (
            !isFiniteNumber(
                settlementReliability.score
            )
        ) {

            return 0.50;
        }

        /*
         * Low settlement reliability increases the urgency of settlement-
         * related repair categories.
         */
        if (
            provider
        ) {

            return clamp(
                1 -
                settlementReliability.score,
                0,
                1
            );
        }

        return 0.50;
    }

    _classifyPriority(
        score
    ) {

        if (
            score >= 0.80
        ) {

            return SCHEDULE_PRIORITY
                .CRITICAL;
        }

        if (
            score >= 0.60
        ) {

            return SCHEDULE_PRIORITY
                .HIGH;
        }

        if (
            score >= 0.35
        ) {

            return SCHEDULE_PRIORITY
                .MEDIUM;
        }

        return SCHEDULE_PRIORITY
            .LOW;
    }

    /**
     * ========================================================================
     * Schedule Construction
     * ========================================================================
     */

    _buildSchedule(
        candidates,
        capacity,
        context
    ) {

        const priorityOrder = {

            CRITICAL: 1,

            HIGH: 2,

            MEDIUM: 3,

            LOW: 4
        };

        const ordered =
            [...candidates].sort(
                (
                    a,
                    b
                ) => {

                    const priorityDifference =
                        (
                            priorityOrder[
                                a.priority
                            ] ||
                            99
                        ) -
                        (
                            priorityOrder[
                                b.priority
                            ] ||
                            99
                        );

                    if (
                        priorityDifference !==
                        0
                    ) {

                        return priorityDifference;
                    }

                    return (
                        b.priorityScore -
                        a.priorityScore
                    );
                }
            );

        const dailyCapacity =
            Math.max(
                1,
                Math.floor(
                    capacity.capacityPerDay
                )
            );

        const buckets =
            new Map();

        const scheduleItems = [];

        let scheduledCount =
            0;

        let unscheduledCount =
            0;

        for (
            const candidate of ordered
        ) {

            let assignedDate =
                null;

            for (
                let offset = 1;
                offset <=
                context.forecastHorizonDays;
                offset += 1
            ) {

                const date =
                    dateKey(
                        addDays(
                            context.asOf,
                            offset
                        )
                    );

                const used =
                    buckets.get(date) || 0;

                if (
                    used <
                    dailyCapacity
                ) {

                    assignedDate =
                        date;

                    buckets.set(
                        date,
                        used + 1
                    );

                    break;
                }
            }

            if (!assignedDate) {

                unscheduledCount +=
                    1;

                continue;
            }

            const scheduledItem = {

                scheduleItemId:
                    createId(),

                candidateId:
                    candidate.candidateId,

                scheduledDate:
                    assignedDate,

                priority:
                    candidate.priority,

                priorityScore:
                    candidate.priorityScore,

                repairType:
                    candidate.repairType,

                severity:
                    candidate.severity,

                provider:
                    candidate.provider,

                branchId:
                    candidate.branchId,

                estimatedDurationMinutes:
                    candidate
                        .estimatedDurationMinutes,

                status:
                    'PLANNED',

                executionRequired:
                    true,

                executionBoundary:
                    'EXTERNAL_REPAIR_WORKFLOW'
            };

            scheduleItems.push(
                scheduledItem
            );

            scheduledCount +=
                1;
        }

        const daily =
            [
                ...buckets.entries()
            ]
                .map(
                    ([
                        date,
                        count
                    ]) => ({

                        date,

                        scheduledRepairs:
                            count,

                        capacity:
                            dailyCapacity,

                        utilizationRate:
                            round(
                                count /
                                dailyCapacity
                            )
                    })
                )
                .sort(
                    (
                        a,
                        b
                    ) =>
                        a.date.localeCompare(
                            b.date
                        )
                );

        return {

            totalCandidates:
                candidates.length,

            totalScheduled:
                scheduledCount,

            unscheduledCount,

            scheduleCoverage:
                candidates.length
                    ? round(
                        scheduledCount /
                        candidates.length
                    )
                    : 0,

            items:
                scheduleItems,

            daily
        };
    }

    /**
     * ========================================================================
     * Schedule Risk
     * ========================================================================
     */

    _calculateScheduleRisk({
        demand,
        workload,
        capacity,
        schedule,
        dataQuality,
        settlementReliability
    }) {

        let riskScore =
            0;

        if (
            capacity.status ===
            'OVER_CAPACITY'
        ) {

            riskScore +=
                0.40;

        } else if (
            capacity.status ===
            'AT_RISK'
        ) {

            riskScore +=
                0.25;
        }

        if (
            schedule.unscheduledCount >
            0
        ) {

            riskScore +=
                0.25;
        }

        if (
            demand.confidence ===
            FORECAST_CONFIDENCE
                .INSUFFICIENT_DATA
        ) {

            riskScore +=
                0.20;
        }

        if (
            demand.trend.direction ===
            'INCREASING'
        ) {

            riskScore +=
                Math.min(
                    demand.trend.strength *
                    0.20,
                    0.20
                );
        }

        if (
            settlementReliability.available &&
            isFiniteNumber(
                settlementReliability.score
            ) &&
            settlementReliability.score <
            0.70
        ) {

            riskScore +=
                0.15;
        }

        if (
            !dataQuality.sufficientHistory
        ) {

            riskScore +=
                0.10;
        }

        riskScore =
            clamp(
                riskScore,
                0,
                1
            );

        let level =
            'LOW';

        if (
            riskScore >=
            this.config
                .riskThresholds
                .critical
        ) {

            level =
                'CRITICAL';

        } else if (
            riskScore >=
            this.config
                .riskThresholds
                .high
        ) {

            level =
                'HIGH';

        } else if (
            riskScore >=
            this.config
                .riskThresholds
                .medium
        ) {

            level =
                'MEDIUM';
        }

        return {

            score:
                round(
                    riskScore
                ),

            level,

            indicators: {

                overCapacity:
                    capacity.status ===
                    'OVER_CAPACITY',

                capacityAtRisk:
                    capacity.status ===
                    'AT_RISK',

                unscheduledDemand:
                    schedule
                        .unscheduledCount >
                    0,

                increasingDemand:
                    demand.trend
                        .direction ===
                    'INCREASING',

                insufficientHistory:
                    !dataQuality
                        .sufficientHistory,

                weakSettlementReliability:
                    settlementReliability
                        .available &&
                    isFiniteNumber(
                        settlementReliability
                            .score
                    ) &&
                    settlementReliability
                        .score < 0.70
            }
        };
    }

    /**
     * ========================================================================
     * Recommendations
     * ========================================================================
     */

    _generateRecommendations({
        demand,
        workload,
        capacity,
        schedule,
        risk,
        dataQuality,
        patterns,
        settlementReliability
    }) {

        const recommendations = [];

        if (
            capacity.status ===
            'OVER_CAPACITY'
        ) {

            recommendations.push({

                code:
                    'REPAIR_CAPACITY_EXCEEDED',

                priority:
                    'CRITICAL',

                message:
                    'Forecast repair demand exceeds available repair capacity. Increase operational capacity, extend the repair window, or route work through approved workflow capacity controls.'
            });
        }

        if (
            schedule.unscheduledCount >
            0
        ) {

            recommendations.push({

                code:
                    'UNSCHEDULED_REPAIR_DEMAND',

                priority:
                    'HIGH',

                message:
                    `${schedule.unscheduledCount} forecasted repair items could not be placed within the planning horizon.`
            });
        }

        if (
            demand.trend.direction ===
            'INCREASING'
        ) {

            recommendations.push({

                code:
                    'REPAIR_DEMAND_INCREASING',

                priority:
                    'HIGH',

                message:
                    'Repair demand is increasing. Investigate the upstream transaction, reconciliation, settlement, or integration causes rather than treating increasing repairs only as a scheduling problem.'
            });
        }

        if (
            settlementReliability.available &&
            settlementReliability.score <
            0.70
        ) {

            recommendations.push({

                code:
                    'SETTLEMENT_RELIABILITY_REPAIR_PRESSURE',

                priority:
                    'HIGH',

                message:
                    'Weak settlement reliability is likely contributing to repair workload. Review provider settlement failures, callbacks, reconciliation exceptions, and posting controls.'
            });
        }

        if (
            demand.confidence ===
            FORECAST_CONFIDENCE
                .INSUFFICIENT_DATA
        ) {

            recommendations.push({

                code:
                    'LOW_FORECAST_CONFIDENCE',

                priority:
                    'MEDIUM',

                message:
                    'Historical repair data is insufficient for a high-confidence predictive schedule. Treat the generated schedule as advisory until sufficient history is accumulated.'
            });
        }

        if (
            patterns.dominantRepairType
        ) {

            recommendations.push({

                code:
                    'DOMINANT_REPAIR_PATTERN',

                priority:
                    'MEDIUM',

                message:
                    `Repair type ${patterns.dominantRepairType} is the dominant historical repair pattern. Prioritize root-cause analysis for this category.`
            });
        }

        if (
            capacity.status ===
            'AT_RISK'
        ) {

            recommendations.push({

                code:
                    'REPAIR_CAPACITY_AT_RISK',

                priority:
                    'HIGH',

                message:
                    'Repair capacity utilization is approaching the operational limit. Reserve capacity for critical and high-severity financial exceptions.'
            });
        }

        if (
            risk.level ===
            'CRITICAL'
        ) {

            recommendations.push({

                code:
                    'CRITICAL_SCHEDULE_RISK',

                priority:
                    'CRITICAL',

                message:
                    'Predictive repair scheduling risk is critical. Manual operational review is recommended before executing the planned repair workload.'
            });
        }

        if (
            !recommendations.length
        ) {

            recommendations.push({

                code:
                    'REPAIR_SCHEDULE_HEALTHY',

                priority:
                    'LOW',

                message:
                    'Forecast repair demand is currently within available planning capacity and no material scheduling risk has been detected.'
            });
        }

        return recommendations;
    }

    /**
     * ========================================================================
     * Explainability
     * ========================================================================
     */

    _buildExplainability({
        demand,
        patterns,
        workload,
        capacity,
        schedule,
        risk,
        dataQuality,
        settlementReliability
    }) {

        return {

            summary:
                `Forecasted repair demand is ${demand.totalForecastedRepairs} items over the planning horizon, with ${schedule.totalScheduled} currently schedulable within available capacity.`,

            drivers: [

                {

                    factor:
                        'HISTORICAL_REPAIR_DEMAND',

                    value:
                        demand
                            .movingAverageDailyDemand,

                    explanation:
                        'Recent historical repair frequency contributes to the forecast baseline.'
                },

                {

                    factor:
                        'EWMA_DEMAND',

                    value:
                        demand
                            .ewmaDailyDemand,

                    explanation:
                        'Exponentially weighted historical demand gives greater influence to recent repair activity.'
                },

                {

                    factor:
                        'DEMAND_TREND',

                    value:
                        demand.trend
                            .direction,

                    explanation:
                        'Historical demand direction modifies future expected repair volume.'
                },

                {

                    factor:
                        'CAPACITY',

                    value:
                        capacity
                            .utilizationRate,

                    explanation:
                        'Available repair capacity determines how much forecasted workload can be scheduled.'
                },

                {

                    factor:
                        'REPAIR_PATTERN',

                    value:
                        patterns
                            .dominantRepairType,

                    explanation:
                        'Recurring repair categories influence predicted workload composition.'
                },

                {

                    factor:
                        'SETTLEMENT_RELIABILITY',

                    value:
                        settlementReliability
                            .score,

                    explanation:
                        'Settlement reliability can increase scheduling urgency for settlement-related repair categories.'
                },

                {

                    factor:
                        'DATA_QUALITY',

                    value:
                        dataQuality.score,

                    explanation:
                        'Historical coverage and completeness determine forecast confidence.'
                }
            ],

            workload:

                {

                    forecastedHours:
                        workload
                            .forecastedRepairHours,

                    historicalAverageMinutes:
                        workload
                            .historicalAverageRepairMinutes
                },

            scheduling:

                {

                    scheduled:
                        schedule.totalScheduled,

                    unscheduled:
                        schedule.unscheduledCount,

                    coverage:
                        schedule
                            .scheduleCoverage
                },

            risk,

            analyticalDisclaimer:
                'This engine generates predictive and advisory scheduling intelligence. It must not directly execute financial repairs, modify ledger records, approve adjustments, or close accounting periods.'
        };
    }

    /**
     * ========================================================================
     * Metrics
     * ========================================================================
     */

    _recordMetric(
        name,
        payload
    ) {

        if (!this.metrics) {
            return;
        }

        try {

            if (
                typeof this.metrics.increment ===
                'function'
            ) {

                this.metrics.increment(
                    name
                );

                return;
            }

            if (
                typeof this.metrics.count ===
                'function'
            ) {

                this.metrics.count(
                    name,
                    1
                );
            }

        } catch (_) {
            // Metrics must never interrupt financial intelligence.
        }
    }

    /**
     * ========================================================================
     * Logging
     * ========================================================================
     */

    _logInfo(
        message,
        metadata = {}
    ) {

        if (!this.logger) {
            return;
        }

        try {

            if (
                typeof this.logger.info ===
                'function'
            ) {

                this.logger.info(
                    message,
                    metadata
                );
            }

        } catch (_) {
            // Logging must never break scheduling intelligence.
        }
    }

    _logWarn(
        message,
        metadata = {}
    ) {

        if (!this.logger) {
            return;
        }

        try {

            if (
                typeof this.logger.warn ===
                'function'
            ) {

                this.logger.warn(
                    message,
                    metadata
                );
            }

        } catch (_) {
            // Logging must never break scheduling intelligence.
        }
    }

    _logError(
        message,
        metadata = {}
    ) {

        if (!this.logger) {
            return;
        }

        try {

            if (
                typeof this.logger.error ===
                'function'
            ) {

                this.logger.error(
                    message,
                    metadata
                );
            }

        } catch (_) {
            // Logging must never break scheduling intelligence.
        }
    }
}

/**
 * ============================================================================
 * Factory
 * ============================================================================
 */

function createPredictiveRepairScheduler(
    options = {}
) {

    return new PredictiveRepairScheduler(
        options
    );
}

/**
 * ============================================================================
 * Static Metadata
 * ============================================================================
 */

PredictiveRepairScheduler.ENGINE_NAME =
    ENGINE_NAME;

PredictiveRepairScheduler.ENGINE_VERSION =
    ENGINE_VERSION;

PredictiveRepairScheduler.DEFAULTS =
    DEFAULTS;

PredictiveRepairScheduler.SCHEDULE_PRIORITY =
    SCHEDULE_PRIORITY;

PredictiveRepairScheduler.FORECAST_CONFIDENCE =
    FORECAST_CONFIDENCE;

PredictiveRepairScheduler
    .PredictiveRepairSchedulerError =
    PredictiveRepairSchedulerError;

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports =
    PredictiveRepairScheduler;

module.exports.PredictiveRepairScheduler =
    PredictiveRepairScheduler;

module.exports.PredictiveRepairSchedulerError =
    PredictiveRepairSchedulerError;

module.exports.createPredictiveRepairScheduler =
    createPredictiveRepairScheduler;