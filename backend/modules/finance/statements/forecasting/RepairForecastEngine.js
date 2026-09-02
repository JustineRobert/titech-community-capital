'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * RepairForecastEngine
 * ============================================================================
 *
 * Enterprise Statement Repair Forecasting Engine
 *
 * Location:
 *   backend/modules/finance/statements/forecasting/RepairForecastEngine.js
 *
 * Purpose:
 *   Forecast future statement-repair workload using historical repair events.
 *
 * Design goals:
 *   - Production-grade
 *   - Tenant-aware
 *   - Deterministic and testable
 *   - Dependency-light
 *   - Explainable
 *   - Financial-period aware
 *   - Safe with sparse/dirty data
 *   - Repository agnostic
 *   - Extensible toward ML/AI forecasting
 *
 * Forecasting approach:
 *
 *   Historical Repairs
 *          |
 *          v
 *   Normalize / Validate
 *          |
 *          v
 *   Aggregate by Period
 *          |
 *          +--------------------+
 *          |                    |
 *          v                    v
 *      EWMA Trend          Weighted Average
 *          |                    |
 *          +---------+----------+
 *                    |
 *                    v
 *              Trend Adjustment
 *                    |
 *                    v
 *              Seasonality
 *                    |
 *                    v
 *             Forecast Baseline
 *                    |
 *                    v
 *          Confidence / Interval
 *                    |
 *                    v
 *             Capacity Forecast
 *
 * Important:
 *   This engine is intentionally NOT coupled to a particular persistence
 *   model. Production applications should inject a dataProvider/repository
 *   through the constructor.
 *
 * Expected provider contract:
 *
 *   async getRepairHistory({
 *       tenantId,
 *       startDate,
 *       endDate,
 *       limit
 *   })
 *
 * The provider should return either:
 *
 *   [
 *      {
 *          occurredAt: Date|string,
 *          type: 'DUPLICATE_LEDGER_ENTRY',
 *          severity: 'HIGH',
 *          status: 'RESOLVED'
 *      }
 *   ]
 *
 * or:
 *
 *   {
 *      records: [...]
 *   }
 *
 * The engine also accepts historical records directly through forecast().
 *
 * No database writes are performed by this engine.
 *
 * ============================================================================
 */

const ENGINE_NAME = 'RepairForecastEngine';
const ENGINE_VERSION = '1.0.0';

const DEFAULTS = Object.freeze({
    horizonDays: 30,
    historicalDays: 180,
    minimumHistoryDays: 14,
    minimumObservations: 7,

    movingAverageWindow: 14,

    // EWMA alpha:
    // Higher values respond faster to recent changes.
    ewmaAlpha: 0.35,

    trendWeight: 0.30,
    movingAverageWeight: 0.35,
    ewmaWeight: 0.35,

    seasonalityWeight: 0.15,

    confidenceFloor: 0.25,
    confidenceCeiling: 0.98,

    lowerIntervalMultiplier: 1.28,
    upperIntervalMultiplier: 1.65,

    maxForecastPerDay: 100000,

    // Default operational assumptions.
    defaultMinutesPerRepair: 20,
    highSeverityMinutes: 35,
    mediumSeverityMinutes: 20,
    lowSeverityMinutes: 10,

    // Capacity used only when explicitly provided.
    defaultDailyCapacityMinutes: null,

    maxHistoryRecords: 100000,

    // Outlier protection.
    outlierMultiplier: 5,

    // Numerical stability.
    epsilon: 0.000001,

    timezone: 'UTC'
});

const REPAIR_STATUSES = Object.freeze({
    OPEN: 'OPEN',
    PENDING: 'PENDING',
    IN_PROGRESS: 'IN_PROGRESS',
    RESOLVED: 'RESOLVED',
    FAILED: 'FAILED',
    CANCELLED: 'CANCELLED'
});

const SEVERITY_WEIGHTS = Object.freeze({
    CRITICAL: 4,
    HIGH: 3,
    MEDIUM: 2,
    LOW: 1,
    UNKNOWN: 1
});

/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

function isFiniteNumber(value) {
    return Number.isFinite(Number(value));
}

function toNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function round(value, decimals = 4) {
    const factor = Math.pow(10, decimals);
    return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function average(values) {
    if (!values.length) {
        return 0;
    }

    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sum(values) {
    return values.reduce((total, value) => total + value, 0);
}

function variance(values) {
    if (values.length < 2) {
        return 0;
    }

    const mean = average(values);

    return (
        values.reduce(
            (total, value) => total + Math.pow(value - mean, 2),
            0
        ) /
        (values.length - 1)
    );
}

function standardDeviation(values) {
    return Math.sqrt(Math.max(variance(values), 0));
}

function coefficientOfVariation(values) {
    const mean = average(values);

    if (Math.abs(mean) < DEFAULTS.epsilon) {
        return 0;
    }

    return standardDeviation(values) / Math.abs(mean);
}

function safeDate(value) {
    if (!value) {
        return null;
    }

    const date = value instanceof Date
        ? new Date(value.getTime())
        : new Date(value);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date;
}

function startOfUtcDay(date) {
    const result = new Date(date);

    result.setUTCHours(0, 0, 0, 0);

    return result;
}

function addDays(date, days) {
    const result = new Date(date);

    result.setUTCDate(result.getUTCDate() + days);

    return result;
}

function differenceInDays(start, end) {
    const milliseconds = end.getTime() - start.getTime();

    return Math.floor(milliseconds / 86400000);
}

function dateKey(date) {
    return startOfUtcDay(date).toISOString().slice(0, 10);
}

function monthDayKey(date) {
    return `${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
        date.getUTCDate()
    ).padStart(2, '0')}`;
}

function dayOfWeekKey(date) {
    return String(date.getUTCDay());
}

function normalizeString(value, fallback = null) {
    if (value === undefined || value === null) {
        return fallback;
    }

    const normalized = String(value).trim();

    return normalized.length ? normalized : fallback;
}

function normalizeUpperCase(value, fallback = 'UNKNOWN') {
    const normalized = normalizeString(value, fallback);

    return normalized ? normalized.toUpperCase() : fallback;
}

function createId() {
    return `rfe_${Date.now().toString(36)}_${Math.random()
        .toString(36)
        .slice(2, 10)}`;
}

/**
 * ============================================================================
 * Error
 * ============================================================================
 */

class RepairForecastError extends Error {
    constructor(message, code = 'REPAIR_FORECAST_ERROR', metadata = {}) {
        super(message);

        this.name = 'RepairForecastError';
        this.code = code;
        this.metadata = metadata;

        Error.captureStackTrace?.(this, RepairForecastError);
    }
}

/**
 * ============================================================================
 * RepairForecastEngine
 * ============================================================================
 */

class RepairForecastEngine {

    /**
     * @param {Object} options
     * @param {Object} [options.dataProvider]
     * @param {Object} [options.repository]
     * @param {Object} [options.logger]
     * @param {Function} [options.clock]
     * @param {Object} [options.config]
     * @param {Object} [options.metrics]
     */
    constructor(options = {}) {

        this.config = Object.freeze({
            ...DEFAULTS,
            ...(options.config || {})
        });

        this.dataProvider =
            options.dataProvider ||
            options.repository ||
            null;

        this.logger = options.logger || null;

        this.clock =
            typeof options.clock === 'function'
                ? options.clock
                : () => new Date();

        this.metrics = options.metrics || null;

        this.engineName = ENGINE_NAME;
        this.version = ENGINE_VERSION;
    }

    /**
     * ========================================================================
     * Public API
     * ========================================================================
     */

    /**
     * Main forecasting entry point.
     *
     * @param {Object} options
     * @param {String} options.tenantId
     * @param {Array<Object>} [options.history]
     * @param {Date|string} [options.asOf]
     * @param {Number} [options.horizonDays]
     * @param {Number} [options.historicalDays]
     * @param {Number} [options.dailyCapacityMinutes]
     *
     * @returns {Promise<Object>}
     */
    async forecast(options = {}) {

        const startedAt = Date.now();

        const context = this._createForecastContext(options);

        try {

            this._validateTenant(context.tenantId);

            const history = await this._loadHistory(context);

            const normalizedHistory =
                this._normalizeHistory(history, context);

            const dataQuality =
                this._assessDataQuality(
                    normalizedHistory,
                    context
                );

            const dailySeries =
                this._buildDailySeries(
                    normalizedHistory,
                    context
                );

            const baseline =
                this._calculateBaseline(dailySeries);

            const trend =
                this._calculateTrend(dailySeries);

            const seasonality =
                this._calculateSeasonality(
                    dailySeries
                );

            const volumeForecast =
                this._forecastVolume({
                    dailySeries,
                    baseline,
                    trend,
                    seasonality,
                    context
                });

            const typeForecast =
                this._forecastByType(
                    normalizedHistory,
                    volumeForecast,
                    context
                );

            const severityForecast =
                this._forecastBySeverity(
                    normalizedHistory,
                    volumeForecast,
                    context
                );

            const workloadForecast =
                this._forecastWorkload({
                    normalizedHistory,
                    volumeForecast,
                    severityForecast,
                    context
                });

            const confidence =
                this._calculateConfidence({
                    dataQuality,
                    trend,
                    seasonality,
                    dailySeries
                });

            const intervals =
                this._calculatePredictionIntervals({
                    volumeForecast,
                    dailySeries,
                    confidence,
                    context
                });

            const risk =
                this._calculateForecastRisk({
                    trend,
                    seasonality,
                    confidence,
                    dataQuality,
                    volumeForecast
                });

            const capacity =
                this._calculateCapacityForecast({
                    workloadForecast,
                    context
                });

            const result = {
                forecastId: createId(),

                engine: {
                    name: this.engineName,
                    version: this.version
                },

                tenantId: context.tenantId,

                asOf: context.asOf.toISOString(),

                horizon: {
                    days: context.horizonDays,
                    historicalDays: context.historicalDays
                },

                methodology: {
                    baseline: 'weighted_moving_average',
                    smoothing: 'exponential_weighted_moving_average',
                    trend: 'linear_regression',
                    seasonality: 'weekday_distribution',
                    uncertainty: 'historical_residual_variance'
                },

                dataQuality,

                baseline: {
                    dailyAverage: round(baseline.dailyAverage),
                    recentAverage: round(baseline.recentAverage),
                    median: round(baseline.median),
                    standardDeviation: round(
                        baseline.standardDeviation
                    )
                },

                trend,

                seasonality,

                confidence,

                risk,

                volume: {
                    ...volumeForecast,
                    intervals
                },

                repairsByType: typeForecast,

                repairsBySeverity: severityForecast,

                workload: workloadForecast,

                capacity,

                recommendations:
                    this._generateRecommendations({
                        trend,
                        seasonality,
                        confidence,
                        risk,
                        dataQuality,
                        capacity,
                        volumeForecast
                    }),

                explainability:
                    this._buildExplainability({
                        baseline,
                        trend,
                        seasonality,
                        confidence,
                        dataQuality,
                        risk,
                        volumeForecast
                    }),

                generatedAt: this.clock().toISOString(),

                execution: {
                    durationMs: Date.now() - startedAt
                }
            };

            this._recordMetric(
                'repair_forecast.generated',
                result
            );

            this._logInfo(
                'Repair forecast generated',
                {
                    forecastId: result.forecastId,
                    tenantId: context.tenantId,
                    horizonDays: context.horizonDays,
                    confidence: confidence.score,
                    riskLevel: risk.level,
                    durationMs: result.execution.durationMs
                }
            );

            return result;

        } catch (error) {

            this._recordMetric(
                'repair_forecast.failed',
                {
                    tenantId: context.tenantId,
                    errorCode: error.code
                }
            );

            this._logError(
                'Repair forecast failed',
                {
                    tenantId: context.tenantId,
                    error
                }
            );

            if (error instanceof RepairForecastError) {
                throw error;
            }

            throw new RepairForecastError(
                'Unable to generate repair forecast.',
                'FORECAST_GENERATION_FAILED',
                {
                    cause: error.message
                }
            );
        }
    }

    /**
     * Forecast directly from historical records.
     */
    async forecastFromHistory(options = {}) {

        if (!Array.isArray(options.history)) {
            throw new RepairForecastError(
                'history must be an array.',
                'INVALID_HISTORY'
            );
        }

        return this.forecast(options);
    }

    /**
     * Forecast only repair volume.
     */
    async forecastVolume(options = {}) {

        const result = await this.forecast(options);

        return {
            forecastId: result.forecastId,
            tenantId: result.tenantId,
            asOf: result.asOf,
            horizon: result.horizon,
            volume: result.volume,
            confidence: result.confidence,
            risk: result.risk
        };
    }

    /**
     * Forecast repair categories.
     */
    async forecastRepairTypes(options = {}) {

        const result = await this.forecast(options);

        return {
            forecastId: result.forecastId,
            tenantId: result.tenantId,
            repairsByType: result.repairsByType,
            confidence: result.confidence
        };
    }

    /**
     * Forecast severity distribution.
     */
    async forecastSeverity(options = {}) {

        const result = await this.forecast(options);

        return {
            forecastId: result.forecastId,
            tenantId: result.tenantId,
            repairsBySeverity: result.repairsBySeverity,
            confidence: result.confidence
        };
    }

    /**
     * Forecast operational workload.
     */
    async forecastWorkload(options = {}) {

        const result = await this.forecast(options);

        return {
            forecastId: result.forecastId,
            tenantId: result.tenantId,
            workload: result.workload,
            capacity: result.capacity,
            confidence: result.confidence
        };
    }

    /**
     * Dashboard-oriented result.
     */
    async getDashboard(options = {}) {

        const forecast = await this.forecast(options);

        return {
            forecastId: forecast.forecastId,
            tenantId: forecast.tenantId,
            asOf: forecast.asOf,

            summary: {
                expectedRepairs:
                    forecast.volume.totalExpected,

                expectedDailyRepairs:
                    forecast.volume.expectedDailyAverage,

                confidence:
                    forecast.confidence.score,

                confidenceLabel:
                    forecast.confidence.label,

                riskLevel:
                    forecast.risk.level,

                capacityStatus:
                    forecast.capacity.status
            },

            trend: forecast.trend,

            volume: forecast.volume,

            severity: forecast.repairsBySeverity,

            types: forecast.repairsByType,

            workload: forecast.workload,

            capacity: forecast.capacity,

            recommendations:
                forecast.recommendations,

            generatedAt:
                forecast.generatedAt
        };
    }

    /**
     * Health/status endpoint for operational monitoring.
     */
    health() {

        return {
            healthy: true,
            engine: this.engineName,
            version: this.version,
            timestamp: this.clock().toISOString(),
            providerConfigured: Boolean(this.dataProvider)
        };
    }

    /**
     * Returns engine metadata.
     */
    getMetadata() {

        return {
            name: this.engineName,
            version: this.version,
            methodology: [
                'weighted_moving_average',
                'exponential_weighted_moving_average',
                'linear_trend',
                'weekday_seasonality',
                'prediction_intervals'
            ],
            supports: [
                'tenant_scoped_forecasting',
                'repair_type_forecasting',
                'severity_forecasting',
                'workload_forecasting',
                'capacity_forecasting',
                'confidence_scoring',
                'risk_assessment',
                'explainability'
            ]
        };
    }

    /**
     * ========================================================================
     * Context
     * ========================================================================
     */

    _createForecastContext(options) {

        const asOf =
            safeDate(options.asOf) ||
            safeDate(this.clock()) ||
            new Date();

        const horizonDays =
            this._normalizePositiveInteger(
                options.horizonDays,
                this.config.horizonDays
            );

        const historicalDays =
            this._normalizePositiveInteger(
                options.historicalDays,
                this.config.historicalDays
            );

        return {
            tenantId:
                normalizeString(options.tenantId),

            asOf: startOfUtcDay(asOf),

            horizonDays: Math.min(
                horizonDays,
                365
            ),

            historicalDays: Math.min(
                historicalDays,
                3650
            ),

            dailyCapacityMinutes:
                isFiniteNumber(options.dailyCapacityMinutes)
                    ? Number(options.dailyCapacityMinutes)
                    : this.config.defaultDailyCapacityMinutes
        };
    }

    _normalizePositiveInteger(value, fallback) {

        const number = Number(value);

        if (!Number.isInteger(number) || number <= 0) {
            return fallback;
        }

        return number;
    }

    _validateTenant(tenantId) {

        if (!tenantId) {
            throw new RepairForecastError(
                'tenantId is required for repair forecasting.',
                'TENANT_ID_REQUIRED'
            );
        }
    }

    /**
     * ========================================================================
     * History Loading
     * ========================================================================
     */

    async _loadHistory(context) {

        /*
         * The direct-history path is intentionally handled by forecast()
         * before provider loading.
         */

        if (!this.dataProvider) {
            return [];
        }

        const startDate =
            addDays(
                context.asOf,
                -context.historicalDays
            );

        const request = {
            tenantId: context.tenantId,
            startDate,
            endDate: context.asOf,
            limit: this.config.maxHistoryRecords
        };

        let result;

        if (
            typeof this.dataProvider.getRepairHistory ===
            'function'
        ) {

            result =
                await this.dataProvider.getRepairHistory(
                    request
                );

        } else if (
            typeof this.dataProvider.findRepairHistory ===
            'function'
        ) {

            result =
                await this.dataProvider.findRepairHistory(
                    request
                );

        } else if (
            typeof this.dataProvider.listRepairs ===
            'function'
        ) {

            result =
                await this.dataProvider.listRepairs(
                    request
                );

        } else {

            throw new RepairForecastError(
                'Configured repair data provider does not expose a supported history method.',
                'UNSUPPORTED_DATA_PROVIDER'
            );
        }

        if (Array.isArray(result)) {
            return result;
        }

        if (Array.isArray(result?.records)) {
            return result.records;
        }

        if (Array.isArray(result?.items)) {
            return result.items;
        }

        return [];
    }

    /**
     * ========================================================================
     * History Normalization
     * ========================================================================
     */

    _normalizeHistory(history, context) {

        if (!Array.isArray(history)) {
            return [];
        }

        const startDate =
            addDays(
                context.asOf,
                -context.historicalDays
            );

        const endDate = context.asOf;

        const normalized = [];

        for (
            let index = 0;
            index < history.length;
            index += 1
        ) {

            const record = history[index];

            if (!record || typeof record !== 'object') {
                continue;
            }

            const occurredAt =
                safeDate(
                    record.occurredAt ||
                    record.createdAt ||
                    record.detectedAt ||
                    record.repairedAt ||
                    record.date ||
                    record.timestamp
                );

            if (!occurredAt) {
                continue;
            }

            if (
                occurredAt < startDate ||
                occurredAt > endDate
            ) {
                continue;
            }

            normalized.push({
                occurredAt,

                type:
                    normalizeUpperCase(
                        record.type ||
                        record.repairType ||
                        record.repair_code
                    ),

                severity:
                    normalizeUpperCase(
                        record.severity
                    ),

                status:
                    normalizeUpperCase(
                        record.status
                    ),

                tenantId:
                    normalizeString(
                        record.tenantId
                    ),

                estimatedMinutes:
                    isFiniteNumber(
                        record.estimatedMinutes
                    )
                        ? Number(record.estimatedMinutes)
                        : null,

                actualMinutes:
                    isFiniteNumber(
                        record.actualMinutes
                    )
                        ? Number(record.actualMinutes)
                        : null
            });
        }

        /*
         * Enforce tenant isolation even when a provider accidentally returns
         * cross-tenant records.
         */
        return normalized.filter(record => {

            if (!record.tenantId) {
                return true;
            }

            return record.tenantId === context.tenantId;
        });
    }

    /**
     * ========================================================================
     * Data Quality
     * ========================================================================
     */

    _assessDataQuality(history, context) {

        const observationCount = history.length;

        const uniqueDays = new Set(
            history.map(record =>
                dateKey(record.occurredAt)
            )
        ).size;

        const requestedDays =
            context.historicalDays;

        const coverageRatio =
            requestedDays > 0
                ? uniqueDays / requestedDays
                : 0;

        const validSeverityRatio =
            observationCount
                ? history.filter(record =>
                    record.severity !== 'UNKNOWN'
                ).length / observationCount
                : 0;

        const validTypeRatio =
            observationCount
                ? history.filter(record =>
                    record.type !== 'UNKNOWN'
                ).length / observationCount
                : 0;

        const observationScore =
            clamp(
                observationCount /
                    Math.max(
                        this.config.minimumObservations * 4,
                        1
                    ),
                0,
                1
            );

        const coverageScore =
            clamp(
                coverageRatio,
                0,
                1
            );

        const completenessScore =
            average([
                validSeverityRatio,
                validTypeRatio
            ]);

        const score =
            clamp(
                (
                    observationScore * 0.45 +
                    coverageScore * 0.35 +
                    completenessScore * 0.20
                ),
                0,
                1
            );

        let label = 'LOW';

        if (score >= 0.80) {
            label = 'HIGH';
        } else if (score >= 0.55) {
            label = 'MEDIUM';
        }

        return {
            score: round(score),
            label,

            observations: observationCount,

            observationDays: uniqueDays,

            requestedDays,

            coverageRatio:
                round(coverageRatio),

            validTypeRatio:
                round(validTypeRatio),

            validSeverityRatio:
                round(validSeverityRatio),

            sufficientHistory:
                uniqueDays >=
                this.config.minimumHistoryDays &&
                observationCount >=
                this.config.minimumObservations
        };
    }

    /**
     * ========================================================================
     * Daily Series
     * ========================================================================
     */

    _buildDailySeries(history, context) {

        const series = [];

        const startDate =
            addDays(
                context.asOf,
                -(context.historicalDays - 1)
            );

        const buckets = new Map();

        for (let day = 0; day < context.historicalDays; day++) {

            const currentDate =
                addDays(startDate, day);

            buckets.set(
                dateKey(currentDate),
                {
                    date: dateKey(currentDate),
                    count: 0
                }
            );
        }

        for (const record of history) {

            const key =
                dateKey(record.occurredAt);

            const bucket =
                buckets.get(key);

            if (bucket) {
                bucket.count += 1;
            }
        }

        for (const bucket of buckets.values()) {
            series.push(bucket);
        }

        return series;
    }

    /**
     * ========================================================================
     * Baseline
     * ========================================================================
     */

    _calculateBaseline(dailySeries) {

        const values =
            dailySeries.map(item => item.count);

        const recentWindow =
            values.slice(
                -this.config.movingAverageWindow
            );

        const recentAverage =
            average(recentWindow);

        const dailyAverage =
            average(values);

        const sorted =
            [...values].sort(
                (a, b) => a - b
            );

        const midpoint =
            Math.floor(sorted.length / 2);

        const median =
            sorted.length % 2 === 0
                ? average([
                    sorted[midpoint - 1],
                    sorted[midpoint]
                ])
                : sorted[midpoint] || 0;

        return {
            dailyAverage,
            recentAverage,
            median,
            standardDeviation:
                standardDeviation(values)
        };
    }

    /**
     * ========================================================================
     * Trend
     * ========================================================================
     */

    _calculateTrend(dailySeries) {

        const values =
            dailySeries.map(
                item => item.count
            );

        if (values.length < 2) {
            return {
                direction: 'INSUFFICIENT_DATA',
                slopePerDay: 0,
                percentagePerPeriod: 0,
                strength: 0
            };
        }

        const x = values.map(
            (_, index) => index
        );

        const xMean =
            average(x);

        const yMean =
            average(values);

        let numerator = 0;
        let denominator = 0;

        for (let index = 0; index < values.length; index++) {

            const xDeviation =
                x[index] - xMean;

            const yDeviation =
                values[index] - yMean;

            numerator +=
                xDeviation * yDeviation;

            denominator +=
                xDeviation * xDeviation;
        }

        const slope =
            denominator === 0
                ? 0
                : numerator / denominator;

        const predicted =
            values.map(
                (_, index) =>
                    yMean +
                    slope * (index - xMean)
            );

        const ssTotal =
            values.reduce(
                (total, value) =>
                    total +
                    Math.pow(
                        value - yMean,
                        2
                    ),
                0
            );

        const ssResidual =
            values.reduce(
                (total, value, index) =>
                    total +
                    Math.pow(
                        value - predicted[index],
                        2
                    ),
                0
            );

        const rSquared =
            ssTotal === 0
                ? 0
                : 1 -
                  ssResidual / ssTotal;

        const relativeSlope =
            Math.abs(yMean) < this.config.epsilon
                ? 0
                : slope / Math.abs(yMean);

        let direction = 'STABLE';

        if (relativeSlope > 0.01) {
            direction = 'INCREASING';
        } else if (relativeSlope < -0.01) {
            direction = 'DECREASING';
        }

        return {
            direction,

            slopePerDay:
                round(slope),

            percentagePerPeriod:
                round(
                    relativeSlope * 100
                ),

            strength:
                round(
                    clamp(
                        rSquared,
                        0,
                        1
                    )
                ),

            rSquared:
                round(
                    clamp(
                        rSquared,
                        0,
                        1
                    )
                )
        };
    }

    /**
     * ========================================================================
     * Seasonality
     * ========================================================================
     */

    _calculateSeasonality(dailySeries) {

        const weekdayBuckets =
            new Map();

        for (let day = 0; day < 7; day++) {
            weekdayBuckets.set(
                String(day),
                []
            );
        }

        for (const item of dailySeries) {

            const date =
                safeDate(item.date);

            if (!date) {
                continue;
            }

            weekdayBuckets
                .get(dayOfWeekKey(date))
                .push(item.count);
        }

        const globalAverage =
            average(
                dailySeries.map(
                    item => item.count
                )
            );

        const indexes = {};

        for (const [day, values] of weekdayBuckets) {

            const dayAverage =
                average(values);

            const index =
                globalAverage <= this.config.epsilon
                    ? 1
                    : dayAverage / globalAverage;

            indexes[day] =
                round(
                    clamp(
                        index,
                        0.25,
                        4
                    )
                );
        }

        const indexValues =
            Object.values(indexes);

        const strength =
            coefficientOfVariation(
                indexValues
            );

        return {
            detected:
                strength >= 0.05,

            strength:
                round(
                    clamp(
                        strength,
                        0,
                        1
                    )
                ),

            weekdayIndexes: indexes
        };
    }

    /**
     * ========================================================================
     * Volume Forecast
     * ========================================================================
     */

    _forecastVolume({
        dailySeries,
        baseline,
        trend,
        seasonality,
        context
    }) {

        const values =
            dailySeries.map(
                item => item.count
            );

        const movingAverageValues =
            values.slice(
                -this.config.movingAverageWindow
            );

        const movingAverage =
            average(
                movingAverageValues
            );

        const ewma =
            this._calculateEwma(
                values,
                this.config.ewmaAlpha
            );

        const trendAdjusted =
            Math.max(
                0,
                baseline.recentAverage +
                trend.slopePerDay *
                    context.horizonDays *
                    this.config.trendWeight
            );

        const weightedBaseline =
            (
                movingAverage *
                this.config.movingAverageWeight
            ) +
            (
                ewma *
                this.config.ewmaWeight
            ) +
            (
                trendAdjusted *
                this.config.trendWeight
            );

        const dailyForecast = [];

        let totalExpected = 0;

        for (
            let offset = 1;
            offset <= context.horizonDays;
            offset++
        ) {

            const forecastDate =
                addDays(
                    context.asOf,
                    offset
                );

            const seasonalityIndex =
                seasonality.detected
                    ? (
                        seasonality.weekdayIndexes[
                            dayOfWeekKey(forecastDate)
                        ] || 1
                    )
                    : 1;

            const trendComponent =
                trend.slopePerDay *
                offset *
                this.config.trendWeight;

            let predicted =
                weightedBaseline +
                trendComponent;

            predicted *=
                (
                    1 +
                    (
                        seasonalityIndex - 1
                    ) *
                    this.config.seasonalityWeight
                );

            predicted =
                clamp(
                    Math.max(0, predicted),
                    0,
                    this.config.maxForecastPerDay
                );

            predicted =
                round(
                    predicted,
                    2
                );

            dailyForecast.push({
                date:
                    dateKey(forecastDate),

                expected:
                    predicted,

                seasonalityIndex:
                    round(
                        seasonalityIndex
                    )
            });

            totalExpected += predicted;
        }

        return {
            totalExpected:
                round(totalExpected),

            expectedDailyAverage:
                round(
                    totalExpected /
                    Math.max(
                        context.horizonDays,
                        1
                    )
                ),

            expectedPeakDaily:
                round(
                    Math.max(
                        ...dailyForecast.map(
                            item => item.expected
                        ),
                        0
                    )
                ),

            expectedMinimumDaily:
                round(
                    Math.min(
                        ...dailyForecast.map(
                            item => item.expected
                        ),
                        0
                    )
                ),

            daily:
                dailyForecast
        };
    }

    _calculateEwma(values, alpha) {

        if (!values.length) {
            return 0;
        }

        let result =
            values[0];

        for (
            let index = 1;
            index < values.length;
            index++
        ) {

            result =
                alpha * values[index] +
                (1 - alpha) * result;
        }

        return result;
    }

    /**
     * ========================================================================
     * Repair Type Forecast
     * ========================================================================
     */

    _forecastByType(
        history,
        volumeForecast,
        context
    ) {

        const counts = new Map();

        for (const record of history) {

            const type =
                record.type || 'UNKNOWN';

            counts.set(
                type,
                (counts.get(type) || 0) + 1
            );
        }

        const total =
            history.length;

        const entries =
            [...counts.entries()]
                .sort(
                    (a, b) => b[1] - a[1]
                );

        const result = [];

        for (const [type, count] of entries) {

            const share =
                total > 0
                    ? count / total
                    : 0;

            const expected =
                volumeForecast.totalExpected *
                share;

            result.push({
                type,

                historicalCount:
                    count,

                historicalShare:
                    round(
                        share
                    ),

                expectedCount:
                    round(
                        expected
                    ),

                expectedDailyAverage:
                    round(
                        expected /
                        Math.max(
                            context.horizonDays,
                            1
                        )
                    )
            });
        }

        return result;
    }

    /**
     * ========================================================================
     * Severity Forecast
     * ========================================================================
     */

    _forecastBySeverity(
        history,
        volumeForecast,
        context
    ) {

        const counts = new Map();

        for (const record of history) {

            const severity =
                record.severity ||
                'UNKNOWN';

            counts.set(
                severity,
                (counts.get(severity) || 0) + 1
            );
        }

        const total =
            history.length;

        const result = [];

        for (const [severity, count] of counts) {

            const share =
                total > 0
                    ? count / total
                    : 0;

            const expected =
                volumeForecast.totalExpected *
                share;

            result.push({
                severity,

                historicalCount:
                    count,

                historicalShare:
                    round(
                        share
                    ),

                expectedCount:
                    round(
                        expected
                    ),

                severityWeight:
                    SEVERITY_WEIGHTS[
                        severity
                    ] ||
                    SEVERITY_WEIGHTS.UNKNOWN
            });
        }

        result.sort(
            (a, b) =>
                b.severityWeight -
                a.severityWeight
        );

        return result;
    }

    /**
     * ========================================================================
     * Workload Forecast
     * ========================================================================
     */

    _forecastWorkload({
        normalizedHistory,
        volumeForecast,
        severityForecast,
        context
    }) {

        let historicalMinutes = 0;

        for (const record of normalizedHistory) {

            historicalMinutes +=
                this._estimateRepairMinutes(
                    record
                );
        }

        const historicalAverageMinutes =
            normalizedHistory.length
                ? historicalMinutes /
                  normalizedHistory.length
                : this.config.defaultMinutesPerRepair;

        let expectedMinutes =
            volumeForecast.totalExpected *
            historicalAverageMinutes;

        /*
         * If severity data is available, calculate a severity-weighted
         * workload estimate. This prevents the workload forecast from
         * treating a critical repair as equivalent to a low-severity repair.
         */
        if (severityForecast.length) {

            const weightedMinutes =
                severityForecast.reduce(
                    (total, item) => {

                        const severityMinutes =
                            this._severityMinutes(
                                item.severity
                            );

                        return total +
                            (
                                item.expectedCount *
                                severityMinutes
                            );
                    },
                    0
                );

            if (weightedMinutes > 0) {
                expectedMinutes =
                    weightedMinutes;
            }
        }

        const expectedHours =
            expectedMinutes / 60;

        const expectedDailyMinutes =
            expectedMinutes /
            Math.max(
                context.horizonDays,
                1
            );

        return {
            historicalAverageMinutesPerRepair:
                round(
                    historicalAverageMinutes,
                    2
                ),

            expectedTotalRepairs:
                volumeForecast.totalExpected,

            expectedTotalMinutes:
                round(
                    expectedMinutes,
                    2
                ),

            expectedTotalHours:
                round(
                    expectedHours,
                    2
                ),

            expectedDailyMinutes:
                round(
                    expectedDailyMinutes,
                    2
                ),

            expectedDailyHours:
                round(
                    expectedDailyMinutes / 60,
                    2
                )
        };
    }

    _estimateRepairMinutes(record) {

        if (
            isFiniteNumber(
                record.actualMinutes
            ) &&
            record.actualMinutes >= 0
        ) {
            return record.actualMinutes;
        }

        if (
            isFiniteNumber(
                record.estimatedMinutes
            ) &&
            record.estimatedMinutes >= 0
        ) {
            return record.estimatedMinutes;
        }

        return this._severityMinutes(
            record.severity
        );
    }

    _severityMinutes(severity) {

        switch (
            normalizeUpperCase(
                severity
            )
        ) {

            case 'CRITICAL':
                return this.config.highSeverityMinutes;

            case 'HIGH':
                return this.config.highSeverityMinutes;

            case 'MEDIUM':
                return this.config.mediumSeverityMinutes;

            case 'LOW':
                return this.config.lowSeverityMinutes;

            default:
                return this.config.defaultMinutesPerRepair;
        }
    }

    /**
     * ========================================================================
     * Confidence
     * ========================================================================
     */

    _calculateConfidence({
        dataQuality,
        trend,
        seasonality,
        dailySeries
    }) {

        const values =
            dailySeries.map(
                item => item.count
            );

        const variability =
            coefficientOfVariation(
                values
            );

        const stabilityScore =
            clamp(
                1 -
                Math.min(
                    variability,
                    1
                ),
                0,
                1
            );

        const trendConfidence =
            clamp(
                trend.strength,
                0,
                1
            );

        const seasonalityConfidence =
            seasonality.detected
                ? clamp(
                    seasonality.strength,
                    0,
                    1
                )
                : 0;

        const score =
            clamp(
                (
                    dataQuality.score * 0.45 +
                    stabilityScore * 0.30 +
                    (
                        trendConfidence *
                        0.15
                    ) +
                    (
                        seasonalityConfidence *
                        0.10
                    )
                ),
                this.config.confidenceFloor,
                this.config.confidenceCeiling
            );

        let label = 'LOW';

        if (score >= 0.80) {
            label = 'HIGH';
        } else if (score >= 0.60) {
            label = 'MEDIUM';
        }

        return {
            score:
                round(score),

            label,

            factors: {
                dataQuality:
                    round(
                        dataQuality.score
                    ),

                stability:
                    round(
                        stabilityScore
                    ),

                trendStrength:
                    round(
                        trendConfidence
                    ),

                seasonalityStrength:
                    round(
                        seasonalityConfidence
                    )
            }
        };
    }

    /**
     * ========================================================================
     * Prediction Intervals
     * ========================================================================
     */

    _calculatePredictionIntervals({
        volumeForecast,
        dailySeries,
        confidence,
        context
    }) {

        const historical =
            dailySeries.map(
                item => item.count
            );

        const stdDev =
            standardDeviation(
                historical
            );

        const confidenceAdjustment =
            1 +
            (
                1 -
                confidence.score
            );

        const lowerMultiplier =
            this.config.lowerIntervalMultiplier *
            confidenceAdjustment;

        const upperMultiplier =
            this.config.upperIntervalMultiplier *
            confidenceAdjustment;

        const daily =
            volumeForecast.daily.map(
                item => {

                    const lower =
                        Math.max(
                            0,
                            item.expected -
                            stdDev *
                            lowerMultiplier
                        );

                    const upper =
                        Math.min(
                            this.config.maxForecastPerDay,
                            item.expected +
                            stdDev *
                            upperMultiplier
                        );

                    return {
                        date: item.date,

                        expected:
                            item.expected,

                        lower:
                            round(lower),

                        upper:
                            round(upper)
                    };
                }
            );

        return {
            confidenceLevel:
                round(
                    confidence.score
                ),

            historicalStandardDeviation:
                round(stdDev),

            daily
        };
    }

    /**
     * ========================================================================
     * Forecast Risk
     * ========================================================================
     */

    _calculateForecastRisk({
        trend,
        seasonality,
        confidence,
        dataQuality,
        volumeForecast
    }) {

        let score = 0;

        if (trend.direction === 'INCREASING') {
            score +=
                0.35 *
                Math.min(
                    trend.strength + 0.25,
                    1
                );
        }

        if (
            volumeForecast.expectedDailyAverage >
            10
        ) {
            score += 0.15;
        }

        if (seasonality.strength > 0.20) {
            score += 0.10;
        }

        if (confidence.score < 0.60) {
            score += 0.20;
        }

        if (!dataQuality.sufficientHistory) {
            score += 0.20;
        }

        score =
            clamp(
                score,
                0,
                1
            );

        let level = 'LOW';

        if (score >= 0.70) {
            level = 'HIGH';
        } else if (score >= 0.40) {
            level = 'MEDIUM';
        }

        return {
            score:
                round(score),

            level
        };
    }

    /**
     * ========================================================================
     * Capacity Forecast
     * ========================================================================
     */

    _calculateCapacityForecast({
        workloadForecast,
        context
    }) {

        const capacityMinutes =
            context.dailyCapacityMinutes;

        if (
            !isFiniteNumber(
                capacityMinutes
            ) ||
            capacityMinutes <= 0
        ) {

            return {
                configured: false,

                status: 'NOT_CONFIGURED',

                dailyCapacityMinutes: null,

                expectedDailyMinutes:
                    workloadForecast.expectedDailyMinutes,

                utilization: null,

                surplusMinutes: null,

                deficitMinutes: null
            };
        }

        const utilization =
            workloadForecast.expectedDailyMinutes /
            capacityMinutes;

        const surplus =
            Math.max(
                0,
                capacityMinutes -
                workloadForecast.expectedDailyMinutes
            );

        const deficit =
            Math.max(
                0,
                workloadForecast.expectedDailyMinutes -
                capacityMinutes
            );

        let status = 'ADEQUATE';

        if (utilization >= 1) {
            status = 'OVER_CAPACITY';
        } else if (utilization >= 0.85) {
            status = 'AT_RISK';
        }

        return {
            configured: true,

            status,

            dailyCapacityMinutes:
                round(
                    capacityMinutes,
                    2
                ),

            expectedDailyMinutes:
                round(
                    workloadForecast.expectedDailyMinutes,
                    2
                ),

            utilization:
                round(
                    utilization,
                    4
                ),

            utilizationPercentage:
                round(
                    utilization * 100,
                    2
                ),

            surplusMinutes:
                round(
                    surplus,
                    2
                ),

            deficitMinutes:
                round(
                    deficit,
                    2
                )
        };
    }

    /**
     * ========================================================================
     * Recommendations
     * ========================================================================
     */

    _generateRecommendations({
        trend,
        seasonality,
        confidence,
        risk,
        dataQuality,
        capacity,
        volumeForecast
    }) {

        const recommendations = [];

        if (
            trend.direction === 'INCREASING' &&
            trend.strength >= 0.30
        ) {

            recommendations.push({
                code: 'MONITOR_REPAIR_GROWTH',

                priority: 'HIGH',

                message:
                    'Repair volume is showing an increasing trend. Review upstream statement validation, reconciliation, and posting controls.'
            });
        }

        if (
            capacity.status ===
            'OVER_CAPACITY'
        ) {

            recommendations.push({
                code: 'CAPACITY_OVERLOAD',

                priority: 'CRITICAL',

                message:
                    'Forecast repair workload exceeds configured operational capacity. Increase repair capacity or reduce upstream repair generation.'
            });

        } else if (
            capacity.status ===
            'AT_RISK'
        ) {

            recommendations.push({
                code: 'CAPACITY_AT_RISK',

                priority: 'HIGH',

                message:
                    'Forecast repair workload is approaching operational capacity.'
            });
        }

        if (
            !dataQuality.sufficientHistory
        ) {

            recommendations.push({
                code: 'INSUFFICIENT_HISTORY',

                priority: 'MEDIUM',

                message:
                    'Forecast confidence is constrained by insufficient repair history. Continue collecting repair observations before relying on the forecast for major operational decisions.'
            });
        }

        if (
            seasonality.detected &&
            seasonality.strength >= 0.15
        ) {

            recommendations.push({
                code: 'SEASONAL_REPAIR_PATTERN',

                priority: 'MEDIUM',

                message:
                    'Repair volume exhibits recurring weekday patterns. Align operational staffing and reconciliation capacity with expected peaks.'
            });
        }

        if (
            confidence.score < 0.60
        ) {

            recommendations.push({
                code: 'LOW_FORECAST_CONFIDENCE',

                priority: 'MEDIUM',

                message:
                    'Forecast confidence is limited. Treat predicted repair volumes as directional rather than deterministic.'
            });
        }

        if (
            risk.level === 'HIGH'
        ) {

            recommendations.push({
                code: 'FORECAST_RISK_REVIEW',

                priority: 'HIGH',

                message:
                    'Forecast risk is elevated. Review repair drivers and financial-control exceptions before period close.'
            });
        }

        if (
            volumeForecast.expectedDailyAverage === 0
        ) {

            recommendations.push({
                code: 'ZERO_REPAIR_FORECAST',

                priority: 'LOW',

                message:
                    'No future repair workload is currently forecast from the available historical observations.'
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
        baseline,
        trend,
        seasonality,
        confidence,
        dataQuality,
        risk,
        volumeForecast
    }) {

        const factors = [];

        factors.push({
            factor: 'RECENT_BASELINE',
            impact: 'PRIMARY',
            value:
                round(
                    baseline.recentAverage
                ),
            explanation:
                'Recent repair activity forms the primary baseline for the forecast.'
        });

        if (
            trend.direction !== 'STABLE'
        ) {

            factors.push({
                factor: 'TREND',
                impact:
                    trend.direction ===
                    'INCREASING'
                        ? 'INCREASE'
                        : 'DECREASE',
                value:
                    trend.percentagePerPeriod,
                explanation:
                    `Historical repair volume is trending ${trend.direction.toLowerCase()}.`
            });
        }

        if (
            seasonality.detected
        ) {

            factors.push({
                factor: 'SEASONALITY',
                impact: 'ADJUSTMENT',
                value:
                    seasonality.strength,
                explanation:
                    'Weekday-level historical patterns are incorporated into daily forecasts.'
            });
        }

        factors.push({
            factor: 'DATA_QUALITY',
            impact:
                dataQuality.label,
            value:
                dataQuality.score,
            explanation:
                'Confidence is adjusted according to historical observation coverage and completeness.'
        });

        factors.push({
            factor: 'CONFIDENCE',
            impact:
                confidence.label,
            value:
                confidence.score,
            explanation:
                'Forecast confidence reflects data quality, historical stability, trend strength, and seasonality.'
        });

        factors.push({
            factor: 'RISK',
            impact:
                risk.level,
            value:
                risk.score,
            explanation:
                'Operational risk reflects increasing repair pressure, forecast uncertainty, seasonality, and historical sufficiency.'
        });

        return {
            summary:
                `Forecast expects approximately ${volumeForecast.totalExpected} repair events over the selected horizon.`,

            factors
        };
    }

    /**
     * ========================================================================
     * Metrics
     * ========================================================================
     */

    _recordMetric(name, payload) {

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

        } catch (error) {

            this._logWarn(
                'Unable to record forecast metric',
                {
                    metric: name,
                    error: error.message
                }
            );
        }
    }

    /**
     * ========================================================================
     * Logging
     * ========================================================================
     */

    _logInfo(message, metadata = {}) {

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
            // Logging must never break forecasting.
        }
    }

    _logWarn(message, metadata = {}) {

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
            // Logging must never break forecasting.
        }
    }

    _logError(message, metadata = {}) {

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
            // Logging must never break forecasting.
        }
    }
}

/**
 * ============================================================================
 * Factory
 * ============================================================================
 */

function createRepairForecastEngine(options = {}) {
    return new RepairForecastEngine(options);
}

/**
 * ============================================================================
 * Static Metadata
 * ============================================================================
 */

RepairForecastEngine.ENGINE_NAME =
    ENGINE_NAME;

RepairForecastEngine.ENGINE_VERSION =
    ENGINE_VERSION;

RepairForecastEngine.DEFAULTS =
    DEFAULTS;

RepairForecastEngine.REPAIR_STATUSES =
    REPAIR_STATUSES;

RepairForecastEngine.SEVERITY_WEIGHTS =
    SEVERITY_WEIGHTS;

RepairForecastEngine.RepairForecastError =
    RepairForecastError;

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports =
    RepairForecastEngine;

module.exports.RepairForecastEngine =
    RepairForecastEngine;

module.exports.RepairForecastError =
    RepairForecastError;

module.exports.createRepairForecastEngine =
    createRepairForecastEngine;