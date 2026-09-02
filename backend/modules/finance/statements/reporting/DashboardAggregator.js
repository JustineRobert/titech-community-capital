'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * DashboardAggregator
 * ============================================================================
 *
 * Enterprise Financial Statement Intelligence Dashboard Aggregator
 *
 * Location:
 *   backend/modules/finance/statements/reporting/DashboardAggregator.js
 *
 * Purpose:
 *   Aggregates financial statement intelligence, operational analytics,
 *   forecasting, fraud signals, repair analytics, reconciliation state,
 *   settlement reliability, and system health into a governed dashboard
 *   read-model.
 *
 * Design Principles:
 *   - Read-only aggregation layer.
 *   - Never mutates ledger/accounting state.
 *   - Never performs financial repairs.
 *   - Never approves financial transactions.
 *   - Never bypasses reconciliation or compliance controls.
 *   - AI/forecasting outputs are advisory unless an external approved
 *     workflow explicitly authorizes execution.
 *   - Tenant isolation is mandatory.
 *   - Partial subsystem failure must not destroy the complete dashboard.
 *   - Deterministic aggregation wherever possible.
 *   - Structured diagnostics and degraded-state reporting.
 *   - No hidden side effects.
 *
 * Supported intelligence domains:
 *   - Statement processing
 *   - Reconciliation
 *   - Repair analytics
 *   - Repair forecasting
 *   - Predictive repair scheduling
 *   - Settlement reliability
 *   - Fraud correlation
 *   - Fraud alerts
 *   - Branch performance
 *   - Team performance
 *   - Operational benchmarks
 *   - Capacity planning
 *   - Workload balancing
 *   - AI confidence/recommendations
 *   - Financial/operational KPIs
 *
 * ============================================================================
 */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const DASHBOARD_STATUS = Object.freeze({
    HEALTHY: 'HEALTHY',
    DEGRADED: 'DEGRADED',
    CRITICAL: 'CRITICAL',
    UNKNOWN: 'UNKNOWN'
});

const DATA_STATUS = Object.freeze({
    AVAILABLE: 'AVAILABLE',
    PARTIAL: 'PARTIAL',
    UNAVAILABLE: 'UNAVAILABLE',
    EMPTY: 'EMPTY'
});

const SEVERITY = Object.freeze({
    CRITICAL: 'CRITICAL',
    HIGH: 'HIGH',
    MEDIUM: 'MEDIUM',
    LOW: 'LOW',
    INFO: 'INFO'
});

const DEFAULT_WINDOW_DAYS = 30;

const NUMERIC_FIELDS = Object.freeze([
    'count',
    'total',
    'amount',
    'value',
    'volume',
    'rate',
    'score',
    'confidence',
    'variance',
    'average',
    'median',
    'forecast',
    'capacity',
    'utilization',
    'reliability',
    'accuracy'
]);

/**
 * Safely convert a value to a finite number.
 *
 * @param {*} value
 * @param {number} fallback
 * @returns {number}
 */
function toNumber(value, fallback = 0) {
    if (value === null || value === undefined || value === '') {
        return fallback;
    }

    const number = Number(value);

    return Number.isFinite(number) ? number : fallback;
}

/**
 * Clamp numeric values.
 *
 * @param {*} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min = 0, max = 100) {
    return Math.min(max, Math.max(min, toNumber(value)));
}

/**
 * Safe percentage calculation.
 *
 * @param {*} numerator
 * @param {*} denominator
 * @returns {number}
 */
function percentage(numerator, denominator) {
    const denominatorNumber = toNumber(denominator);

    if (denominatorNumber === 0) {
        return 0;
    }

    return Number(
        ((toNumber(numerator) / denominatorNumber) * 100).toFixed(4)
    );
}

/**
 * Safe average.
 *
 * @param {Array<*>} values
 * @returns {number}
 */
function average(values) {
    if (!Array.isArray(values) || values.length === 0) {
        return 0;
    }

    const numericValues = values
        .map((value) => toNumber(value))
        .filter((value) => Number.isFinite(value));

    if (numericValues.length === 0) {
        return 0;
    }

    return Number(
        (
            numericValues.reduce((sum, value) => sum + value, 0) /
            numericValues.length
        ).toFixed(4)
    );
}

/**
 * Safely extract nested values.
 *
 * @param {*} object
 * @param {string} path
 * @param {*} fallback
 * @returns {*}
 */
function getPath(object, path, fallback = undefined) {
    if (!object || typeof path !== 'string') {
        return fallback;
    }

    const parts = path.split('.');

    let current = object;

    for (const part of parts) {
        if (
            current === null ||
            current === undefined ||
            typeof current !== 'object'
        ) {
            return fallback;
        }

        current = current[part];
    }

    return current === undefined ? fallback : current;
}

/**
 * Normalize arrays.
 *
 * @param {*} value
 * @returns {Array}
 */
function asArray(value) {
    if (Array.isArray(value)) {
        return value;
    }

    if (value === null || value === undefined) {
        return [];
    }

    return [value];
}

/**
 * Generate a deterministic-ish correlation ID without requiring an external
 * dependency.
 *
 * @returns {string}
 */
function generateCorrelationId() {
    return `dashboard-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;
}

/**
 * Normalize date.
 *
 * @param {*} value
 * @param {*} fallback
 * @returns {Date|null}
 */
function normalizeDate(value, fallback = null) {
    if (!value) {
        return fallback;
    }

    const date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) {
        return fallback;
    }

    return date;
}

/**
 * Normalize requested date window.
 *
 * @param {Object} options
 * @returns {{from: Date, to: Date, days: number}}
 */
function normalizeWindow(options = {}) {
    const now = normalizeDate(options.to || options.endDate, new Date());

    const requestedFrom = normalizeDate(
        options.from || options.startDate,
        null
    );

    if (requestedFrom) {
        const difference = Math.max(
            1,
            Math.ceil(
                (now.getTime() - requestedFrom.getTime()) /
                    (24 * 60 * 60 * 1000)
            )
        );

        return {
            from: requestedFrom,
            to: now,
            days: difference
        };
    }

    const days = Math.max(
        1,
        Math.min(
            MAX_LIMIT,
            toNumber(options.windowDays, DEFAULT_WINDOW_DAYS)
        )
    );

    const from = new Date(now.getTime());

    from.setDate(from.getDate() - days);

    return {
        from,
        to: now,
        days
    };
}

/**
 * Normalize pagination.
 *
 * @param {Object} options
 * @returns {{limit: number, offset: number}}
 */
function normalizePagination(options = {}) {
    const limit = Math.min(
        MAX_LIMIT,
        Math.max(1, Math.floor(toNumber(options.limit, DEFAULT_LIMIT)))
    );

    const offset = Math.max(
        0,
        Math.floor(toNumber(options.offset, 0))
    );

    return {
        limit,
        offset
    };
}

/**
 * Safely invoke a service method.
 *
 * This is deliberately defensive because dashboard aggregation should remain
 * available even when one intelligence subsystem is temporarily unavailable.
 *
 * @param {Object|null} service
 * @param {string} method
 * @param {Object} args
 * @param {Object} options
 * @returns {Promise<Object>}
 */
async function safeInvoke(
    service,
    method,
    args,
    options = {}
) {
    const {
        logger = null,
        subsystem = method,
        fallback = null
    } = options;

    if (!service || typeof service[method] !== 'function') {
        return {
            subsystem,
            status: DATA_STATUS.UNAVAILABLE,
            data: fallback,
            error: {
                code: 'SERVICE_METHOD_UNAVAILABLE',
                message: `${subsystem}.${method} is unavailable`
            }
        };
    }

    const startedAt = Date.now();

    try {
        const data = await service[method](args);

        return {
            subsystem,
            status:
                data === null ||
                data === undefined
                    ? DATA_STATUS.EMPTY
                    : DATA_STATUS.AVAILABLE,
            data,
            durationMs: Date.now() - startedAt
        };
    } catch (error) {
        if (logger && typeof logger.warn === 'function') {
            logger.warn(
                {
                    subsystem,
                    method,
                    error: error.message,
                    durationMs: Date.now() - startedAt
                },
                'Dashboard subsystem aggregation failed'
            );
        }

        return {
            subsystem,
            status: DATA_STATUS.UNAVAILABLE,
            data: fallback,
            error: {
                code: error.code || 'SUBSYSTEM_AGGREGATION_FAILED',
                message: error.message || 'Subsystem aggregation failed'
            },
            durationMs: Date.now() - startedAt
        };
    }
}

/**
 * Extract a collection from common service response shapes.
 *
 * @param {*} response
 * @returns {Array}
 */
function extractCollection(response) {
    if (Array.isArray(response)) {
        return response;
    }

    if (!response || typeof response !== 'object') {
        return [];
    }

    const candidates = [
        response.items,
        response.results,
        response.data,
        response.records,
        response.rows,
        response.alerts,
        response.recommendations,
        response.repairs,
        response.forecasts,
        response.metrics
    ];

    for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
            return candidate;
        }
    }

    return [];
}

/**
 * Extract a numeric metric from common response shapes.
 *
 * @param {*} response
 * @param {Array<string>} paths
 * @returns {number}
 */
function extractMetric(response, paths = []) {
    for (const path of paths) {
        const value = getPath(response, path, undefined);

        if (value !== undefined && value !== null) {
            return toNumber(value);
        }
    }

    return 0;
}

/**
 * Normalize a score into 0-100.
 *
 * @param {*} value
 * @returns {number}
 */
function normalizeScore(value) {
    const number = toNumber(value);

    if (number >= 0 && number <= 1) {
        return Number((number * 100).toFixed(4));
    }

    return Number(clamp(number, 0, 100).toFixed(4));
}

/**
 * ============================================================================
 * DashboardAggregator
 * ============================================================================
 */
class DashboardAggregator {
    /**
     * @param {Object} dependencies
     * @param {Object} dependencies.logger
     * @param {Object} dependencies.statementService
     * @param {Object} dependencies.reconciliationService
     * @param {Object} dependencies.repairAnalyticsService
     * @param {Object} dependencies.repairForecastEngine
     * @param {Object} dependencies.predictiveRepairScheduler
     * @param {Object} dependencies.settlementReliabilityEngine
     * @param {Object} dependencies.fraudCorrelationEngine
     * @param {Object} dependencies.fraudAlertService
     * @param {Object} dependencies.fraudPatternDetector
     * @param {Object} dependencies.suspiciousRepairScorer
     * @param {Object} dependencies.branchPerformanceAnalyzer
     * @param {Object} dependencies.teamPerformanceAnalyzer
     * @param {Object} dependencies.operationalBenchmarkService
     * @param {Object} dependencies.capacityPlanner
     * @param {Object} dependencies.workloadBalancer
     * @param {Object} dependencies.aiRepairRecommendationEngine
     * @param {Object} dependencies.aiConfidenceScorer
     * @param {Object} dependencies.metricsService
     * @param {Object} dependencies.healthService
     */
    constructor(dependencies = {}) {
        this.logger = dependencies.logger || null;

        this.services = Object.freeze({
            statementService:
                dependencies.statementService || null,

            reconciliationService:
                dependencies.reconciliationService || null,

            repairAnalyticsService:
                dependencies.repairAnalyticsService || null,

            repairForecastEngine:
                dependencies.repairForecastEngine || null,

            predictiveRepairScheduler:
                dependencies.predictiveRepairScheduler || null,

            settlementReliabilityEngine:
                dependencies.settlementReliabilityEngine || null,

            fraudCorrelationEngine:
                dependencies.fraudCorrelationEngine || null,

            fraudAlertService:
                dependencies.fraudAlertService || null,

            fraudPatternDetector:
                dependencies.fraudPatternDetector || null,

            suspiciousRepairScorer:
                dependencies.suspiciousRepairScorer || null,

            branchPerformanceAnalyzer:
                dependencies.branchPerformanceAnalyzer || null,

            teamPerformanceAnalyzer:
                dependencies.teamPerformanceAnalyzer || null,

            operationalBenchmarkService:
                dependencies.operationalBenchmarkService || null,

            capacityPlanner:
                dependencies.capacityPlanner || null,

            workloadBalancer:
                dependencies.workloadBalancer || null,

            aiRepairRecommendationEngine:
                dependencies.aiRepairRecommendationEngine || null,

            aiConfidenceScorer:
                dependencies.aiConfidenceScorer || null,

            metricsService:
                dependencies.metricsService || null,

            healthService:
                dependencies.healthService || null
        });

        this.serviceMethods = Object.freeze({
            statementService: [
                'getDashboardMetrics',
                'getMetrics',
                'getSummary'
            ],

            reconciliationService: [
                'getDashboardMetrics',
                'getMetrics',
                'getSummary'
            ],

            repairAnalyticsService: [
                'getDashboardMetrics',
                'getMetrics',
                'getSummary'
            ],

            repairForecastEngine: [
                'forecast',
                'generateForecast',
                'getDashboardMetrics',
                'getSummary'
            ],

            predictiveRepairScheduler: [
                'getSchedule',
                'schedule',
                'getDashboardMetrics',
                'getSummary'
            ],

            settlementReliabilityEngine: [
                'getDashboardMetrics',
                'getReliability',
                'analyze',
                'getSummary'
            ],

            fraudCorrelationEngine: [
                'getDashboardMetrics',
                'correlate',
                'analyze',
                'getSummary'
            ],

            fraudAlertService: [
                'getDashboardMetrics',
                'getActiveAlerts',
                'list',
                'getSummary'
            ],

            fraudPatternDetector: [
                'getDashboardMetrics',
                'detect',
                'analyze',
                'getSummary'
            ],

            suspiciousRepairScorer: [
                'getDashboardMetrics',
                'score',
                'analyze',
                'getSummary'
            ],

            branchPerformanceAnalyzer: [
                'getDashboardMetrics',
                'analyze',
                'getSummary'
            ],

            teamPerformanceAnalyzer: [
                'getDashboardMetrics',
                'analyze',
                'getSummary'
            ],

            operationalBenchmarkService: [
                'getDashboardMetrics',
                'benchmark',
                'compare',
                'getSummary'
            ],

            capacityPlanner: [
                'getDashboardMetrics',
                'plan',
                'forecast',
                'getSummary'
            ],

            workloadBalancer: [
                'getDashboardMetrics',
                'balance',
                'analyze',
                'getSummary'
            ],

            aiRepairRecommendationEngine: [
                'getDashboardMetrics',
                'recommend',
                'generateRecommendations',
                'getSummary'
            ],

            aiConfidenceScorer: [
                'getDashboardMetrics',
                'score',
                'getSummary'
            ],

            metricsService: [
                'getDashboardMetrics',
                'getMetrics',
                'snapshot'
            ],

            healthService: [
                'getDashboardMetrics',
                'getHealth',
                'check'
            ]
        });

        this.version = '1.0.0';

        this.dashboardCache = new Map();

        this.defaultCacheTtlMs = Math.max(
            1000,
            toNumber(
                dependencies.cacheTtlMs,
                30 * 1000
            )
        );
    }

    /**
     * =========================================================================
     * Public API
     * =========================================================================
     */

    /**
     * Aggregate the complete enterprise dashboard.
     *
     * @param {Object} context
     * @returns {Promise<Object>}
     */
    async aggregate(context = {}) {
        const execution = this._buildExecutionContext(context);

        const cacheKey = this._buildCacheKey(execution);

        if (!execution.options.forceRefresh) {
            const cached = this._getCached(cacheKey);

            if (cached) {
                return {
                    ...cached,
                    metadata: {
                        ...cached.metadata,
                        cacheHit: true
                    }
                };
            }
        }

        const startedAt = Date.now();

        try {
            const result = await this._aggregateDashboard(execution);

            const finalized = this._finalizeDashboard(
                result,
                execution,
                startedAt
            );

            this._setCached(
                cacheKey,
                finalized,
                execution.options.cacheTtlMs
            );

            return finalized;
        } catch (error) {
            this._logError(
                error,
                'Enterprise dashboard aggregation failed',
                execution
            );

            return this._buildFailureDashboard(
                error,
                execution,
                startedAt
            );
        }
    }

    /**
     * Alias for aggregate().
     *
     * @param {Object} context
     * @returns {Promise<Object>}
     */
    async getDashboard(context = {}) {
        return this.aggregate(context);
    }

    /**
     * Aggregate only executive-level metrics.
     *
     * @param {Object} context
     * @returns {Promise<Object>}
     */
    async getExecutiveSummary(context = {}) {
        const dashboard = await this.aggregate({
            ...context,
            options: {
                ...(context.options || {}),
                mode: 'executive'
            }
        });

        return {
            success: dashboard.success,
            status: dashboard.status,
            tenantId: dashboard.tenantId,
            period: dashboard.period,
            executive: dashboard.executive,
            governance: dashboard.governance,
            metadata: dashboard.metadata
        };
    }

    /**
     * Aggregate operational dashboard.
     *
     * @param {Object} context
     * @returns {Promise<Object>}
     */
    async getOperationalDashboard(context = {}) {
        const dashboard = await this.aggregate({
            ...context,
            options: {
                ...(context.options || {}),
                mode: 'operations'
            }
        });

        return {
            success: dashboard.success,
            status: dashboard.status,
            tenantId: dashboard.tenantId,
            period: dashboard.period,
            operations: dashboard.operations,
            repairs: dashboard.repairs,
            settlements: dashboard.settlements,
            reconciliation: dashboard.reconciliation,
            governance: dashboard.governance,
            metadata: dashboard.metadata
        };
    }

    /**
     * Aggregate fraud/risk dashboard.
     *
     * @param {Object} context
     * @returns {Promise<Object>}
     */
    async getRiskDashboard(context = {}) {
        const dashboard = await this.aggregate({
            ...context,
            options: {
                ...(context.options || {}),
                mode: 'risk'
            }
        });

        return {
            success: dashboard.success,
            status: dashboard.status,
            tenantId: dashboard.tenantId,
            period: dashboard.period,
            fraud: dashboard.fraud,
            governance: dashboard.governance,
            metadata: dashboard.metadata
        };
    }

    /**
     * Aggregate forecasting dashboard.
     *
     * @param {Object} context
     * @returns {Promise<Object>}
     */
    async getForecastDashboard(context = {}) {
        const dashboard = await this.aggregate({
            ...context,
            options: {
                ...(context.options || {}),
                mode: 'forecasting'
            }
        });

        return {
            success: dashboard.success,
            status: dashboard.status,
            tenantId: dashboard.tenantId,
            period: dashboard.period,
            forecasts: dashboard.forecasts,
            scheduling: dashboard.scheduling,
            governance: dashboard.governance,
            metadata: dashboard.metadata
        };
    }

    /**
     * Invalidate cached dashboard data.
     *
     * @param {Object} context
     */
    invalidate(context = {}) {
        const tenantId =
            context.tenantId ||
            getPath(context, 'executionContext.tenantId', null);

        if (!tenantId) {
            this.dashboardCache.clear();
            return;
        }

        for (const key of this.dashboardCache.keys()) {
            if (key.includes(`tenant:${tenantId}`)) {
                this.dashboardCache.delete(key);
            }
        }
    }

    /**
     * Clear all dashboard cache entries.
     */
    clearCache() {
        this.dashboardCache.clear();
    }

    /**
     * Return aggregator health.
     *
     * @returns {Object}
     */
    health() {
        const services = {};

        for (const [name, service] of Object.entries(this.services)) {
            services[name] = {
                available: Boolean(service),
                methods: this.serviceMethods[name] || []
            };
        }

        return {
            service: 'DashboardAggregator',
            version: this.version,
            status: DASHBOARD_STATUS.HEALTHY,
            cache: {
                entries: this.dashboardCache.size,
                ttlMs: this.defaultCacheTtlMs
            },
            services
        };
    }

    /**
     * =========================================================================
     * Main Aggregation Pipeline
     * =========================================================================
     */

    async _aggregateDashboard(execution) {
        const {
            context,
            period,
            options
        } = execution;

        const commonArgs = {
            ...context,
            tenantId: execution.tenantId,
            period,
            window: period,
            limit: options.limit,
            offset: options.offset,
            correlationId: execution.correlationId,
            dashboardMode: options.mode,
            readOnly: true
        };

        const subsystemResults = await Promise.all([
            this._aggregateStatements(commonArgs),
            this._aggregateReconciliation(commonArgs),
            this._aggregateRepairs(commonArgs),
            this._aggregateForecasts(commonArgs),
            this._aggregateSettlements(commonArgs),
            this._aggregateFraud(commonArgs),
            this._aggregateOperations(commonArgs),
            this._aggregateAI(commonArgs),
            this._aggregateHealth(commonArgs)
        ]);

        const [
            statements,
            reconciliation,
            repairs,
            forecasts,
            settlements,
            fraud,
            operations,
            ai,
            health
        ] = subsystemResults;

        const executive = this._buildExecutiveSummary({
            statements,
            reconciliation,
            repairs,
            forecasts,
            settlements,
            fraud,
            operations,
            ai,
            health
        });

        const governance = this._buildGovernanceSummary({
            statements,
            reconciliation,
            repairs,
            forecasts,
            settlements,
            fraud,
            operations,
            ai,
            health
        });

        const dataQuality = this._buildDataQuality(
            subsystemResults
        );

        return {
            tenantId: execution.tenantId,
            period,

            statements,
            reconciliation,
            repairs,
            forecasts,
            settlements,
            fraud,
            operations,
            ai,
            health,

            executive,
            governance,
            dataQuality,

            diagnostics: {
                subsystems: subsystemResults.map(
                    (result) => ({
                        subsystem: result.subsystem,
                        status: result.status,
                        durationMs: result.durationMs || 0,
                        hasError: Boolean(result.error)
                    })
                )
            }
        };
    }

    /**
     * =========================================================================
     * Statements
     * =========================================================================
     */

    async _aggregateStatements(args) {
        const service =
            this.services.statementService;

        const result =
            await this._invokeFirstAvailable(
                'statementService',
                args
            );

        const data = result.data || {};

        const transactions =
            extractMetric(data, [
                'transactions',
                'transactionCount',
                'metrics.transactions',
                'summary.transactionCount'
            ]);

        const statements =
            extractMetric(data, [
                'statements',
                'statementCount',
                'metrics.statements',
                'summary.statementCount'
            ]);

        const processed =
            extractMetric(data, [
                'processed',
                'processedCount',
                'metrics.processed'
            ]);

        const failed =
            extractMetric(data, [
                'failed',
                'failedCount',
                'metrics.failed'
            ]);

        return {
            status: result.status,

            metrics: {
                statements,
                transactions,
                processed,
                failed,

                processingSuccessRate:
                    percentage(
                        processed - failed,
                        processed
                    )
            },

            raw: this._sanitizeDashboardData(data),

            serviceAvailable: Boolean(service)
        };
    }

    /**
     * =========================================================================
     * Reconciliation
     * =========================================================================
     */

    async _aggregateReconciliation(args) {
        const result =
            await this._invokeFirstAvailable(
                'reconciliationService',
                args
            );

        const data = result.data || {};

        const matched =
            extractMetric(data, [
                'matched',
                'matchedCount',
                'metrics.matched',
                'summary.matched'
            ]);

        const unmatched =
            extractMetric(data, [
                'unmatched',
                'unmatchedCount',
                'metrics.unmatched',
                'summary.unmatched'
            ]);

        const variances =
            extractMetric(data, [
                'variances',
                'varianceCount',
                'metrics.variances',
                'summary.varianceCount'
            ]);

        const total =
            matched + unmatched;

        return {
            status: result.status,

            metrics: {
                matched,
                unmatched,
                variances,
                total,

                matchRate:
                    percentage(
                        matched,
                        total
                    ),

                exceptionRate:
                    percentage(
                        unmatched + variances,
                        total
                    )
            },

            raw: this._sanitizeDashboardData(data)
        };
    }

    /**
     * =========================================================================
     * Repairs
     * =========================================================================
     */

    async _aggregateRepairs(args) {
        const result =
            await this._invokeFirstAvailable(
                'repairAnalyticsService',
                args
            );

        const data = result.data || {};

        const repairs =
            extractMetric(data, [
                'repairs',
                'repairCount',
                'metrics.repairs',
                'summary.repairCount'
            ]);

        const repaired =
            extractMetric(data, [
                'repaired',
                'repairedCount',
                'metrics.repaired',
                'summary.repairedCount'
            ]);

        const pending =
            extractMetric(data, [
                'pending',
                'pendingCount',
                'metrics.pending',
                'summary.pendingCount'
            ]);

        const failed =
            extractMetric(data, [
                'failed',
                'failedCount',
                'metrics.failed',
                'summary.failedCount'
            ]);

        const highRisk =
            extractMetric(data, [
                'highRisk',
                'highRiskCount',
                'metrics.highRisk'
            ]);

        return {
            status: result.status,

            metrics: {
                repairs,
                repaired,
                pending,
                failed,
                highRisk,

                repairSuccessRate:
                    percentage(
                        repaired,
                        repairs
                    ),

                failureRate:
                    percentage(
                        failed,
                        repairs
                    ),

                pendingRate:
                    percentage(
                        pending,
                        repairs
                    )
            },

            raw: this._sanitizeDashboardData(data)
        };
    }

    /**
     * =========================================================================
     * Forecasting
     * =========================================================================
     */

    async _aggregateForecasts(args) {
        const result =
            await this._invokeFirstAvailable(
                'repairForecastEngine',
                args
            );

        const data = result.data || {};

        const forecasts =
            extractCollection(data);

        const confidenceValues =
            forecasts.map((forecast) =>
                normalizeScore(
                    forecast.confidence ??
                    forecast.confidenceScore ??
                    forecast.accuracy
                )
            );

        const forecastRepairVolume =
            extractMetric(data, [
                'forecastRepairVolume',
                'predictedRepairs',
                'forecast',
                'metrics.forecastRepairVolume',
                'summary.predictedRepairs'
            ]);

        const confidence =
            confidenceValues.length > 0
                ? average(confidenceValues)
                : normalizeScore(
                    getPath(
                        data,
                        'confidence',
                        getPath(
                            data,
                            'confidenceScore',
                            0
                        )
                    )
                );

        return {
            status: result.status,

            metrics: {
                forecastRepairVolume,
                forecastCount: forecasts.length,
                confidence
            },

            forecasts: forecasts
                .slice(
                    args.offset,
                    args.offset + args.limit
                )
                .map((forecast) =>
                    this._normalizeForecast(forecast)
                ),

            raw: this._sanitizeDashboardData(data)
        };
    }

    /**
     * =========================================================================
     * Settlement Reliability
     * =========================================================================
     */

    async _aggregateSettlements(args) {
        const result =
            await this._invokeFirstAvailable(
                'settlementReliabilityEngine',
                args
            );

        const data = result.data || {};

        const reliability =
            normalizeScore(
                getPath(
                    data,
                    'reliability',
                    getPath(
                        data,
                        'reliabilityScore',
                        getPath(
                            data,
                            'metrics.reliability',
                            0
                        )
                    )
                )
            );

        const settlementCount =
            extractMetric(data, [
                'settlements',
                'settlementCount',
                'metrics.settlements'
            ]);

        const successful =
            extractMetric(data, [
                'successful',
                'successfulSettlements',
                'metrics.successful'
            ]);

        const failed =
            extractMetric(data, [
                'failed',
                'failedSettlements',
                'metrics.failed'
            ]);

        return {
            status: result.status,

            metrics: {
                settlementCount,
                successful,
                failed,
                reliability,

                successRate:
                    percentage(
                        successful,
                        settlementCount
                    ),

                failureRate:
                    percentage(
                        failed,
                        settlementCount
                    )
            },

            raw: this._sanitizeDashboardData(data)
        };
    }

    /**
     * =========================================================================
     * Fraud / Risk
     * =========================================================================
     */

    async _aggregateFraud(args) {
        const [
            correlation,
            alerts,
            patterns,
            suspiciousRepairs
        ] = await Promise.all([
            this._invokeFirstAvailable(
                'fraudCorrelationEngine',
                args
            ),

            this._invokeFirstAvailable(
                'fraudAlertService',
                args
            ),

            this._invokeFirstAvailable(
                'fraudPatternDetector',
                args
            ),

            this._invokeFirstAvailable(
                'suspiciousRepairScorer',
                args
            )
        ]);

        const correlationData =
            correlation.data || {};

        const alertData =
            alerts.data || {};

        const patternData =
            patterns.data || {};

        const suspiciousData =
            suspiciousRepairs.data || {};

        const alertCollection =
            extractCollection(alertData);

        const patternCollection =
            extractCollection(patternData);

        const suspiciousCollection =
            extractCollection(suspiciousData);

        const riskScore =
            normalizeScore(
                getPath(
                    correlationData,
                    'riskScore',
                    getPath(
                        correlationData,
                        'score',
                        getPath(
                            suspiciousData,
                            'riskScore',
                            0
                        )
                    )
                )
            );

        const activeAlerts =
            extractMetric(alertData, [
                'activeAlerts',
                'active',
                'count',
                'metrics.activeAlerts'
            ]) ||
            alertCollection.length;

        const criticalAlerts =
            extractMetric(alertData, [
                'criticalAlerts',
                'critical',
                'metrics.criticalAlerts'
            ]) ||
            alertCollection.filter(
                (alert) =>
                    String(
                        alert.severity || ''
                    ).toUpperCase() ===
                    SEVERITY.CRITICAL
            ).length;

        return {
            status: this._mergeStatuses([
                correlation.status,
                alerts.status,
                patterns.status,
                suspiciousRepairs.status
            ]),

            metrics: {
                riskScore,
                activeAlerts,
                criticalAlerts,
                patternsDetected:
                    patternCollection.length ||
                    extractMetric(patternData, [
                        'patternsDetected',
                        'count'
                    ]),

                suspiciousRepairs:
                    suspiciousCollection.length ||
                    extractMetric(
                        suspiciousData,
                        [
                            'suspiciousRepairs',
                            'count'
                        ]
                    )
            },

            alerts: alertCollection
                .slice(
                    args.offset,
                    args.offset + args.limit
                )
                .map((alert) =>
                    this._normalizeFraudAlert(alert)
                ),

            patterns: patternCollection
                .slice(
                    args.offset,
                    args.offset + args.limit
                )
                .map((pattern) =>
                    this._sanitizeDashboardData(pattern)
                ),

            suspiciousRepairs:
                suspiciousCollection
                    .slice(
                        args.offset,
                        args.offset + args.limit
                    )
                    .map((item) =>
                        this._sanitizeDashboardData(item)
                    ),

            correlation:
                this._sanitizeDashboardData(
                    correlationData
                )
        };
    }

    /**
     * =========================================================================
     * Operations
     * =========================================================================
     */

    async _aggregateOperations(args) {
        const [
            branches,
            teams,
            benchmarks,
            capacity,
            workload
        ] = await Promise.all([
            this._invokeFirstAvailable(
                'branchPerformanceAnalyzer',
                args
            ),

            this._invokeFirstAvailable(
                'teamPerformanceAnalyzer',
                args
            ),

            this._invokeFirstAvailable(
                'operationalBenchmarkService',
                args
            ),

            this._invokeFirstAvailable(
                'capacityPlanner',
                args
            ),

            this._invokeFirstAvailable(
                'workloadBalancer',
                args
            )
        ]);

        const branchData = branches.data || {};
        const teamData = teams.data || {};
        const benchmarkData = benchmarks.data || {};
        const capacityData = capacity.data || {};
        const workloadData = workload.data || {};

        return {
            status: this._mergeStatuses([
                branches.status,
                teams.status,
                benchmarks.status,
                capacity.status,
                workload.status
            ]),

            branches: {
                metrics:
                    this._extractOperationalMetrics(
                        branchData
                    ),

                items: extractCollection(branchData)
                    .slice(
                        args.offset,
                        args.offset + args.limit
                    )
                    .map((item) =>
                        this._sanitizeDashboardData(item)
                    )
            },

            teams: {
                metrics:
                    this._extractOperationalMetrics(
                        teamData
                    ),

                items: extractCollection(teamData)
                    .slice(
                        args.offset,
                        args.offset + args.limit
                    )
                    .map((item) =>
                        this._sanitizeDashboardData(item)
                    )
            },

            benchmarks: {
                metrics:
                    this._extractOperationalMetrics(
                        benchmarkData
                    ),

                items: extractCollection(
                    benchmarkData
                )
                    .slice(
                        args.offset,
                        args.offset + args.limit
                    )
                    .map((item) =>
                        this._sanitizeDashboardData(item)
                    )
            },

            capacity: {
                metrics:
                    this._extractOperationalMetrics(
                        capacityData
                    ),

                data:
                    this._sanitizeDashboardData(
                        capacityData
                    )
            },

            workload: {
                metrics:
                    this._extractOperationalMetrics(
                        workloadData
                    ),

                data:
                    this._sanitizeDashboardData(
                        workloadData
                    )
            }
        };
    }

    /**
     * =========================================================================
     * AI
     * =========================================================================
     */

    async _aggregateAI(args) {
        const [
            recommendations,
            confidence
        ] = await Promise.all([
            this._invokeFirstAvailable(
                'aiRepairRecommendationEngine',
                args
            ),

            this._invokeFirstAvailable(
                'aiConfidenceScorer',
                args
            )
        ]);

        const recommendationData =
            recommendations.data || {};

        const confidenceData =
            confidence.data || {};

        const recommendationCollection =
            extractCollection(
                recommendationData
            );

        const confidenceScore =
            normalizeScore(
                getPath(
                    confidenceData,
                    'confidence',
                    getPath(
                        confidenceData,
                        'score',
                        getPath(
                            confidenceData,
                            'confidenceScore',
                            0
                        )
                    )
                )
            );

        return {
            status: this._mergeStatuses([
                recommendations.status,
                confidence.status
            ]),

            governance: {
                advisoryOnly: true,
                executionAuthority:
                    'EXTERNAL_APPROVED_WORKFLOW',
                financialMutationAllowed: false
            },

            metrics: {
                recommendationCount:
                    recommendationCollection.length ||
                    extractMetric(
                        recommendationData,
                        [
                            'recommendationCount',
                            'count'
                        ]
                    ),

                confidenceScore
            },

            recommendations:
                recommendationCollection
                    .slice(
                        args.offset,
                        args.offset + args.limit
                    )
                    .map((recommendation) =>
                        this._normalizeAIRecommendation(
                            recommendation
                        )
                    ),

            confidence:
                this._sanitizeDashboardData(
                    confidenceData
                )
        };
    }

    /**
     * =========================================================================
     * Health / Infrastructure
     * =========================================================================
     */

    async _aggregateHealth(args) {
        const result =
            await this._invokeFirstAvailable(
                'healthService',
                args
            );

        const data = result.data || {};

        const dependencies =
            getPath(
                data,
                'dependencies',
                {}
            );

        const dependencyEntries =
            dependencies &&
            typeof dependencies === 'object'
                ? Object.entries(dependencies)
                : [];

        const unhealthyDependencies =
            dependencyEntries.filter(
                ([, dependency]) =>
                    String(
                        dependency.status ||
                        ''
                    ).toUpperCase() !==
                    'HEALTHY'
            ).length;

        return {
            status: result.status,

            metrics: {
                dependencyCount:
                    dependencyEntries.length,

                unhealthyDependencies
            },

            data:
                this._sanitizeDashboardData(
                    data
                )
        };
    }

    /**
     * =========================================================================
     * Executive Summary
     * =========================================================================
     */

    _buildExecutiveSummary(data) {
        const reconciliation =
            data.reconciliation.metrics || {};

        const repairs =
            data.repairs.metrics || {};

        const settlements =
            data.settlements.metrics || {};

        const fraud =
            data.fraud.metrics || {};

        const forecasts =
            data.forecasts.metrics || {};

        const operationalScores =
            this._collectOperationalScores(
                data.operations
            );

        const overallHealth =
            average([
                reconciliation.matchRate,
                repairs.repairSuccessRate,
                settlements.successRate,
                settlements.reliability,
                100 - fraud.riskScore,
                forecasts.confidence,
                ...operationalScores
            ]);

        return {
            overallHealthScore:
                Number(
                    clamp(
                        overallHealth,
                        0,
                        100
                    ).toFixed(2)
                ),

            reconciliation: {
                matchRate:
                    reconciliation.matchRate || 0,

                exceptions:
                    (reconciliation.unmatched || 0) +
                    (reconciliation.variances || 0)
            },

            repairs: {
                total:
                    repairs.repairs || 0,

                pending:
                    repairs.pending || 0,

                failed:
                    repairs.failed || 0,

                successRate:
                    repairs.repairSuccessRate || 0
            },

            settlements: {
                reliability:
                    settlements.reliability || 0,

                successRate:
                    settlements.successRate || 0,

                failed:
                    settlements.failed || 0
            },

            risk: {
                score:
                    fraud.riskScore || 0,

                activeAlerts:
                    fraud.activeAlerts || 0,

                criticalAlerts:
                    fraud.criticalAlerts || 0
            },

            forecasting: {
                predictedRepairs:
                    forecasts.forecastRepairVolume || 0,

                confidence:
                    forecasts.confidence || 0
            }
        };
    }

    /**
     * =========================================================================
     * Governance
     * =========================================================================
     */

    _buildGovernanceSummary(data) {
        const ai =
            data.ai || {};

        const fraud =
            data.fraud || {};

        const repairs =
            data.repairs || {};

        const reconciliation =
            data.reconciliation || {};

        return {
            advisorySystems: [
                'AI_REPAIR_RECOMMENDATIONS',
                'AI_CONFIDENCE_SCORING',
                'REPAIR_FORECASTING',
                'PREDICTIVE_REPAIR_SCHEDULING',
                'SETTLEMENT_RELIABILITY_ANALYSIS',
                'FRAUD_CORRELATION'
            ],

            authorityBoundaries: {
                ledger:
                    'SYSTEM_OF_RECORD',

                reconciliation:
                    'FINANCIAL_CONTROL',

                repairExecution:
                    'APPROVAL_CONTROLLED',

                compliance:
                    'COMPLIANCE_CONTROLLED',

                ai:
                    'ADVISORY_ONLY',

                forecasting:
                    'ADVISORY_ONLY'
            },

            financialMutationAllowed:
                false,

            aiExecutionAllowed:
                false,

            approvalRequiredForRepair:
                true,

            reconciliationExceptions:
                toNumber(
                    getPath(
                        reconciliation,
                        'metrics.unmatched'
                    )
                ) +
                toNumber(
                    getPath(
                        reconciliation,
                        'metrics.variances'
                    )
                ),

            pendingRepairs:
                toNumber(
                    getPath(
                        repairs,
                        'metrics.pending'
                    )
                ),

            activeFraudAlerts:
                toNumber(
                    getPath(
                        fraud,
                        'metrics.activeAlerts'
                    )
                ),

            aiRecommendationCount:
                toNumber(
                    getPath(
                        ai,
                        'metrics.recommendationCount'
                    )
                ),

            aiConfidence:
                toNumber(
                    getPath(
                        ai,
                        'metrics.confidenceScore'
                    )
                )
        };
    }

    /**
     * =========================================================================
     * Data Quality
     * =========================================================================
     */

    _buildDataQuality(results) {
        const total = results.length;

        const available =
            results.filter(
                (result) =>
                    result.status ===
                    DATA_STATUS.AVAILABLE
            ).length;

        const unavailable =
            results.filter(
                (result) =>
                    result.status ===
                    DATA_STATUS.UNAVAILABLE
            ).length;

        const partial =
            results.filter(
                (result) =>
                    result.status ===
                    DATA_STATUS.PARTIAL
            ).length;

        const completeness =
            percentage(
                available,
                total
            );

        return {
            totalSubsystems: total,
            availableSubsystems: available,
            partialSubsystems: partial,
            unavailableSubsystems: unavailable,

            completeness,

            status:
                unavailable === total
                    ? DATA_STATUS.UNAVAILABLE
                    : unavailable > 0 ||
                      partial > 0
                        ? DATA_STATUS.PARTIAL
                        : DATA_STATUS.AVAILABLE
        };
    }

    /**
     * =========================================================================
     * Finalization
     * =========================================================================
     */

    _finalizeDashboard(
        result,
        execution,
        startedAt
    ) {
        const dataQuality =
            result.dataQuality || {};

        const status =
            this._calculateDashboardStatus(
                result,
                dataQuality
            );

        return {
            success:
                status !==
                DASHBOARD_STATUS.CRITICAL,

            status,

            service:
                'DashboardAggregator',

            version:
                this.version,

            tenantId:
                execution.tenantId,

            period:
                result.period,

            statements:
                result.statements,

            reconciliation:
                result.reconciliation,

            repairs:
                result.repairs,

            forecasts:
                result.forecasts,

            settlements:
                result.settlements,

            fraud:
                result.fraud,

            operations:
                result.operations,

            ai:
                result.ai,

            health:
                result.health,

            executive:
                result.executive,

            governance:
                result.governance,

            dataQuality,

            diagnostics: {
                ...result.diagnostics,

                durationMs:
                    Date.now() - startedAt,

                correlationId:
                    execution.correlationId,

                generatedAt:
                    new Date().toISOString(),

                cacheHit:
                    false
            },

            metadata: {
                readOnly:
                    true,

                cacheHit:
                    false,

                mode:
                    execution.options.mode,

                limit:
                    execution.options.limit,

                offset:
                    execution.options.offset,

                windowDays:
                    execution.period.days
            }
        };
    }

    /**
     * =========================================================================
     * Status Calculation
     * =========================================================================
     */

    _calculateDashboardStatus(
        dashboard,
        dataQuality
    ) {
        const criticalAlerts =
            toNumber(
                getPath(
                    dashboard,
                    'fraud.metrics.criticalAlerts'
                )
            );

        const riskScore =
            toNumber(
                getPath(
                    dashboard,
                    'fraud.metrics.riskScore'
            );

        const reconciliationExceptions =
            toNumber(
                getPath(
                    dashboard,
                    'reconciliation.metrics.unmatched'
                )
            ) +
            toNumber(
                getPath(
                    dashboard,
                    'reconciliation.metrics.variances'
                )
            );

        const unhealthyDependencies =
            toNumber(
                getPath(
                    dashboard,
                    'health.metrics.unhealthyDependencies'
                )
            );

        if (
            criticalAlerts > 0 ||
            unhealthyDependencies > 0
        ) {
            return DASHBOARD_STATUS.CRITICAL;
        }

        if (
            riskScore >= 80 ||
            reconciliationExceptions > 0 ||
            dataQuality.status !== DATA_STATUS.AVAILABLE
        ) {
            return DASHBOARD_STATUS.DEGRADED;
        }

        return DASHBOARD_STATUS.HEALTHY;
    }

    /**
     * =========================================================================
     * Service Invocation
     * =========================================================================
     */

    async _invokeFirstAvailable(
        serviceName,
        args
    ) {
        const service =
            this.services[serviceName];

        const methods =
            this.serviceMethods[serviceName] || [];

        if (!service) {
            return {
                subsystem: serviceName,
                status: DATA_STATUS.UNAVAILABLE,
                data: {},
                error: {
                    code: 'SERVICE_UNAVAILABLE',
                    message:
                        `${serviceName} is not configured`
                }
            };
        }

        for (const method of methods) {
            if (
                typeof service[method] ===
                'function'
            ) {
                return safeInvoke(
                    service,
                    method,
                    args,
                    {
                        logger: this.logger,
                        subsystem:
                            `${serviceName}.${method}`,
                        fallback: {}
                    }
                );
            }
        }

        return {
            subsystem: serviceName,
            status: DATA_STATUS.UNAVAILABLE,
            data: {},
            error: {
                code: 'NO_SUPPORTED_METHOD',
                message:
                    `No supported aggregation method found for ${serviceName}`
            }
        };
    }

    /**
     * =========================================================================
     * Execution Context
     * =========================================================================
     */

    _buildExecutionContext(context = {}) {
        const options =
            context.options || {};

        const period =
            normalizeWindow({
                from:
                    context.from ||
                    context.startDate ||
                    getPath(
                        context,
                        'period.from'
                    ),

                to:
                    context.to ||
                    context.endDate ||
                    getPath(
                        context,
                        'period.to'
                    ),

                windowDays:
                    options.windowDays ||
                    context.windowDays
            });

        const pagination =
            normalizePagination(options);

        const tenantId =
            context.tenantId ||
            getPath(
                context,
                'executionContext.tenantId'
            ) ||
            getPath(
                context,
                'request.tenantId'
            );

        if (!tenantId) {
            throw new Error(
                'Dashboard aggregation requires tenantId'
            );
        }

        return {
            context,

            tenantId,

            period,

            options: {
                mode:
                    options.mode ||
                    'full',

                forceRefresh:
                    Boolean(
                        options.forceRefresh
                    ),

                cacheTtlMs:
                    Math.max(
                        1000,
                        toNumber(
                            options.cacheTtlMs,
                            this.defaultCacheTtlMs
                        )
                    ),

                limit:
                    pagination.limit,

                offset:
                    pagination.offset
            },

            correlationId:
                context.correlationId ||
                getPath(
                    context,
                    'executionContext.correlationId'
                ) ||
                generateCorrelationId()
        };
    }

    /**
     * =========================================================================
     * Cache
     * =========================================================================
     */

    _buildCacheKey(execution) {
        return [
            `tenant:${execution.tenantId}`,
            `mode:${execution.options.mode}`,
            `from:${execution.period.from.toISOString()}`,
            `to:${execution.period.to.toISOString()}`,
            `limit:${execution.options.limit}`,
            `offset:${execution.options.offset}`
        ].join('|');
    }

    _getCached(key) {
        const entry =
            this.dashboardCache.get(key);

        if (!entry) {
            return null;
        }

        if (
            Date.now() >
            entry.expiresAt
        ) {
            this.dashboardCache.delete(key);
            return null;
        }

        return entry.value;
    }

    _setCached(
        key,
        value,
        ttlMs
    ) {
        this.dashboardCache.set(
            key,
            {
                value,
                expiresAt:
                    Date.now() +
                    Math.max(
                        1000,
                        toNumber(
                            ttlMs,
                            this.defaultCacheTtlMs
                        )
                    )
            }
        );
    }

    /**
     * =========================================================================
     * Normalizers
     * =========================================================================
     */

    _normalizeForecast(forecast) {
        if (
            !forecast ||
            typeof forecast !== 'object'
        ) {
            return forecast;
        }

        return {
            id:
                forecast.id ||
                forecast._id ||
                null,

            forecastDate:
                forecast.forecastDate ||
                forecast.date ||
                null,

            predictedRepairs:
                toNumber(
                    forecast.predictedRepairs ??
                    forecast.predictedRepairCount ??
                    forecast.value
                ),

            confidence:
                normalizeScore(
                    forecast.confidence ??
                    forecast.confidenceScore
                ),

            severity:
                forecast.severity ||
                null,

            status:
                forecast.status ||
                null
        };
    }

    _normalizeFraudAlert(alert) {
        if (
            !alert ||
            typeof alert !== 'object'
        ) {
            return alert;
        }

        return {
            id:
                alert.id ||
                alert._id ||
                null,

            severity:
                String(
                    alert.severity ||
                    SEVERITY.INFO
                ).toUpperCase(),

            type:
                alert.type ||
                alert.alertType ||
                null,

            status:
                alert.status ||
                null,

            score:
                normalizeScore(
                    alert.score ??
                    alert.riskScore
                ),

            createdAt:
                alert.createdAt ||
                alert.timestamp ||
                null,

            acknowledged:
                Boolean(
                    alert.acknowledged
                )
        };
    }

    _normalizeAIRecommendation(
        recommendation
    ) {
        if (
            !recommendation ||
            typeof recommendation !== 'object'
        ) {
            return recommendation;
        }

        return {
            id:
                recommendation.id ||
                recommendation._id ||
                null,

            type:
                recommendation.type ||
                recommendation.recommendationType ||
                null,

            action:
                recommendation.action ||
                recommendation.recommendedAction ||
                null,

            confidence:
                normalizeScore(
                    recommendation.confidence ??
                    recommendation.confidenceScore
                ),

            priority:
                recommendation.priority ||
                recommendation.severity ||
                null,

            status:
                recommendation.status ||
                'ADVISORY',

            advisoryOnly:
                true,

            executionAuthority:
                'EXTERNAL_APPROVED_WORKFLOW'
        };
    }

    _extractOperationalMetrics(
        data
    ) {
        return {
            score:
                normalizeScore(
                    data.score ??
                    data.performanceScore ??
                    data.reliability
                ),

            utilization:
                clamp(
                    data.utilization ??
                    data.utilizationRate ??
                    0
                ),

            throughput:
                toNumber(
                    data.throughput ??
                    data.completed ??
                    data.volume
                ),

            backlog:
                toNumber(
                    data.backlog ??
                    data.pending
                ),

            efficiency:
                normalizeScore(
                    data.efficiency
                )
        };
    }

    /**
     * =========================================================================
     * Utilities
     * =========================================================================
     */

    _collectOperationalScores(
        operations
    ) {
        return [
            getPath(
                operations,
                'branches.metrics.score',
                0
            ),

            getPath(
                operations,
                'teams.metrics.score',
                0
            ),

            getPath(
                operations,
                'benchmarks.metrics.score',
                0
            ),

            getPath(
                operations,
                'capacity.metrics.score',
                0
            ),

            getPath(
                operations,
                'workload.metrics.score',
                0
            )
        ]
            .map((value) =>
                normalizeScore(value)
            )
            .filter(
                (value) => value > 0
            );
    }

    _mergeStatuses(statuses) {
        const normalized =
            statuses.filter(Boolean);

        if (
            normalized.includes(
                DATA_STATUS.UNAVAILABLE
            )
        ) {
            return DATA_STATUS.PARTIAL;
        }

        if (
            normalized.includes(
                DATA_STATUS.PARTIAL
            )
        ) {
            return DATA_STATUS.PARTIAL;
        }

        if (
            normalized.includes(
                DATA_STATUS.AVAILABLE
            )
        ) {
            return DATA_STATUS.AVAILABLE;
        }

        return DATA_STATUS.EMPTY;
    }

    /**
     * Remove obvious persistence/credential/internal fields from dashboard
     * output while retaining analytical information.
     *
     * @param {*} data
     * @returns {*}
     */
    _sanitizeDashboardData(data) {
        if (
            data === null ||
            data === undefined
        ) {
            return data;
        }

        if (Array.isArray(data)) {
            return data.map((item) =>
                this._sanitizeDashboardData(item)
            );
        }

        if (
            typeof data !== 'object'
        ) {
            return data;
        }

        const sensitiveKeys =
            new Set([
                'password',
                'passwordHash',
                'token',
                'accessToken',
                'refreshToken',
                'secret',
                'apiKey',
                'privateKey',
                'authorization',
                'signature',
                'rawPayload'
            ]);

        const output = {};

        for (const [key, value] of Object.entries(data)) {
            if (
                sensitiveKeys.has(key)
            ) {
                continue;
            }

            if (
                key.startsWith('__')
            ) {
                continue;
            }

            if (
                value &&
                typeof value === 'object'
            ) {
                output[key] =
                    this._sanitizeDashboardData(
                        value
                    );
            } else {
                output[key] = value;
            }
        }

        return output;
    }

    _buildFailureDashboard(
        error,
        execution,
        startedAt
    ) {
        return {
            success: false,

            status:
                DASHBOARD_STATUS.CRITICAL,

            service:
                'DashboardAggregator',

            version:
                this.version,

            tenantId:
                execution.tenantId,

            period:
                execution.period,

            statements: {
                status:
                    DATA_STATUS.UNAVAILABLE,
                metrics: {}
            },

            reconciliation: {
                status:
                    DATA_STATUS.UNAVAILABLE,
                metrics: {}
            },

            repairs: {
                status:
                    DATA_STATUS.UNAVAILABLE,
                metrics: {}
            },

            forecasts: {
                status:
                    DATA_STATUS.UNAVAILABLE,
                metrics: {}
            },

            settlements: {
                status:
                    DATA_STATUS.UNAVAILABLE,
                metrics: {}
            },

            fraud: {
                status:
                    DATA_STATUS.UNAVAILABLE,
                metrics: {}
            },

            operations: {
                status:
                    DATA_STATUS.UNAVAILABLE
            },

            ai: {
                status:
                    DATA_STATUS.UNAVAILABLE,

                governance: {
                    advisoryOnly: true,
                    executionAuthority:
                        'EXTERNAL_APPROVED_WORKFLOW',
                    financialMutationAllowed:
                        false
                }
            },

            health: {
                status:
                    DATA_STATUS.UNAVAILABLE
            },

            executive: {
                overallHealthScore: 0
            },

            governance: {
                financialMutationAllowed: false,
                aiExecutionAllowed: false,
                approvalRequiredForRepair: true
            },

            dataQuality: {
                status:
                    DATA_STATUS.UNAVAILABLE
            },

            diagnostics: {
                durationMs:
                    Date.now() - startedAt,

                correlationId:
                    execution.correlationId,

                generatedAt:
                    new Date().toISOString(),

                error: {
                    code:
                        error.code ||
                        'DASHBOARD_AGGREGATION_FAILED',

                    message:
                        error.message ||
                        'Dashboard aggregation failed'
                }
            },

            metadata: {
                readOnly: true,
                cacheHit: false,
                mode:
                    execution.options.mode
            }
        };
    }

    _logError(
        error,
        message,
        execution
    ) {
        if (
            this.logger &&
            typeof this.logger.error ===
                'function'
        ) {
            this.logger.error(
                {
                    error:
                        error.message,

                    code:
                        error.code,

                    tenantId:
                        execution.tenantId,

                    correlationId:
                        execution.correlationId
                },
                message
            );
        }
    }
}

/**
 * ============================================================================
 * Factory
 * ============================================================================
 *
 * Supports existing dependency-injection patterns without forcing callers to
 * instantiate the class directly.
 *
 * ============================================================================
 */

function createDashboardAggregator(
    dependencies = {}
) {
    return new DashboardAggregator(
        dependencies
    );
}

/**
 * ============================================================================
 * Static Constants
 * ============================================================================
 */

DashboardAggregator.STATUS =
    DASHBOARD_STATUS;

DashboardAggregator.DATA_STATUS =
    DATA_STATUS;

DashboardAggregator.SEVERITY =
    SEVERITY;

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports = DashboardAggregator;

module.exports.DashboardAggregator =
    DashboardAggregator;

module.exports.createDashboardAggregator =
    createDashboardAggregator;

module.exports.DASHBOARD_STATUS =
    DASHBOARD_STATUS;

module.exports.DATA_STATUS =
    DATA_STATUS;

module.exports.SEVERITY =
    SEVERITY;