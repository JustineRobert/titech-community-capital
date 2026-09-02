'use strict';

/**
 * ============================================================================
 * TITech Commumity Capital LTD
 * BoardReportingService
 * ============================================================================
 *
 * Enterprise Board / Executive Reporting Service for the Statement
 * Intelligence Platform.
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - Aggregate statement-repair intelligence into board-level reporting.
 * - Consolidate operational, fraud, forecasting, settlement and performance
 *   intelligence.
 * - Produce deterministic executive KPIs.
 * - Calculate board-level risk and reliability indicators.
 * - Preserve tenant isolation.
 * - Support reporting periods and comparison periods.
 * - Normalize heterogeneous intelligence-service outputs.
 * - Handle partial service failures without corrupting the report.
 * - Provide traceable report metadata and calculation provenance.
 * - Produce executive summaries and board recommendations.
 * - Support report snapshots without coupling to persistence.
 * - Remain safe for scheduled/background execution.
 *
 * Design Principles
 * ----------------------------------------------------------------------------
 * 1. No direct database dependency.
 * 2. No hard dependency on optional intelligence modules.
 * 3. Dependency injection over module coupling.
 * 4. Fail-safe aggregation.
 * 5. Deterministic calculations.
 * 6. Tenant-aware execution.
 * 7. No mutation of caller-owned objects.
 * 8. Explicit reporting period.
 * 9. Explainable scoring.
 * 10. Suitable for API, job, dashboard and export consumers.
 *
 * Expected optional dependencies
 * ----------------------------------------------------------------------------
 * {
 *   operationalBenchmarkService,
 *   branchPerformanceAnalyzer,
 *   teamPerformanceAnalyzer,
 *   capacityPlanner,
 *   workloadBalancer,
 *   fraudCorrelationEngine,
 *   fraudPatternDetector,
 *   suspiciousRepairScorer,
 *   repairForecastEngine,
 *   settlementReliabilityEngine,
 *   predictiveRepairScheduler,
 *   repairAnalyticsService,
 *   statementReconciliationService,
 *   statementRepairService,
 *   logger,
 *   clock
 * }
 *
 * No dependency is mandatory except the service itself.
 *
 * ============================================================================
 */

const crypto = require('crypto');

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const SERVICE_NAME = 'BoardReportingService';
const SERVICE_VERSION = '1.0.0';

const REPORT_STATUS = Object.freeze({
    GENERATED: 'generated',
    PARTIAL: 'partial',
    FAILED: 'failed'
});

const HEALTH_STATUS = Object.freeze({
    HEALTHY: 'healthy',
    WARNING: 'warning',
    CRITICAL: 'critical'
});

const RISK_LEVEL = Object.freeze({
    LOW: 'low',
    MODERATE: 'moderate',
    HIGH: 'high',
    CRITICAL: 'critical'
});

const TREND = Object.freeze({
    IMPROVING: 'improving',
    STABLE: 'stable',
    DETERIORATING: 'deteriorating',
    UNKNOWN: 'unknown'
});

const DEFAULTS = Object.freeze({
    maxRecommendations: 10,
    maxRisks: 10,
    maxHighlights: 10,
    maxDataQualityIssues: 20,
    decimalPlaces: 4,

    thresholds: Object.freeze({
        repairRateWarning: 0.05,
        repairRateCritical: 0.15,

        unresolvedRateWarning: 0.03,
        unresolvedRateCritical: 0.10,

        fraudRateWarning: 0.01,
        fraudRateCritical: 0.05,

        settlementReliabilityWarning: 0.95,
        settlementReliabilityCritical: 0.85,

        forecastRiskWarning: 0.30,
        forecastRiskCritical: 0.60,

        dataCompletenessWarning: 0.90,
        dataCompletenessCritical: 0.75,

        operationalEfficiencyWarning: 0.70,
        operationalEfficiencyCritical: 0.50,

        branchPerformanceWarning: 0.70,
        branchPerformanceCritical: 0.50
    })
});

/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

/**
 * Determine whether a value is a finite number.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Safely coerce a numeric value.
 *
 * @param {*} value
 * @param {number} fallback
 * @returns {number}
 */
function toNumber(value, fallback = 0) {
    if (isFiniteNumber(value)) {
        return value;
    }

    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);

        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    return fallback;
}

/**
 * Safely clamp a number.
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min = 0, max = 1) {
    return Math.min(Math.max(toNumber(value, min), min), max);
}

/**
 * Round a number.
 *
 * @param {number} value
 * @param {number} places
 * @returns {number}
 */
function round(value, places = DEFAULTS.decimalPlaces) {
    const multiplier = Math.pow(10, places);

    return Math.round(toNumber(value) * multiplier) / multiplier;
}

/**
 * Safe percentage.
 *
 * @param {number} numerator
 * @param {number} denominator
 * @returns {number}
 */
function percentage(numerator, denominator) {
    if (!denominator) {
        return 0;
    }

    return round((toNumber(numerator) / toNumber(denominator)) * 100, 2);
}

/**
 * Safe ratio.
 *
 * @param {number} numerator
 * @param {number} denominator
 * @returns {number}
 */
function ratio(numerator, denominator) {
    if (!denominator) {
        return 0;
    }

    return round(toNumber(numerator) / toNumber(denominator), 6);
}

/**
 * Deep-ish clone for plain reporting data.
 *
 * @param {*} value
 * @returns {*}
 */
function clone(value) {
    if (value === undefined || value === null) {
        return value;
    }

    if (typeof value !== 'object') {
        return value;
    }

    try {
        return JSON.parse(JSON.stringify(value));
    } catch (error) {
        return value;
    }
}

/**
 * Generate deterministic object hash.
 *
 * @param {*} value
 * @returns {string}
 */
function hashObject(value) {
    let serialized;

    try {
        serialized = JSON.stringify(value, Object.keys(value || {}).sort());
    } catch (error) {
        serialized = String(value);
    }

    return crypto
        .createHash('sha256')
        .update(serialized)
        .digest('hex');
}

/**
 * Generate unique report identifier.
 *
 * @param {string} tenantId
 * @param {string} periodStart
 * @param {string} periodEnd
 * @returns {string}
 */
function generateReportId(tenantId, periodStart, periodEnd) {
    const seed = [
        SERVICE_NAME,
        tenantId || 'unknown',
        periodStart || 'unknown',
        periodEnd || 'unknown',
        new Date().toISOString()
    ].join(':');

    return `BR-${crypto
        .createHash('sha256')
        .update(seed)
        .digest('hex')
        .slice(0, 24)
        .toUpperCase()}`;
}

/**
 * Get nested property safely.
 *
 * @param {Object} object
 * @param {string[]} paths
 * @param {*} fallback
 * @returns {*}
 */
function firstDefined(object, paths, fallback = undefined) {
    if (!object || typeof object !== 'object') {
        return fallback;
    }

    for (const path of paths) {
        const segments = path.split('.');
        let current = object;

        for (const segment of segments) {
            if (
                current === null ||
                current === undefined ||
                typeof current !== 'object'
            ) {
                current = undefined;
                break;
            }

            current = current[segment];
        }

        if (current !== undefined && current !== null) {
            return current;
        }
    }

    return fallback;
}

/**
 * Convert an unknown collection into an array.
 *
 * @param {*} value
 * @returns {Array}
 */
function toArray(value) {
    if (Array.isArray(value)) {
        return value;
    }

    if (value && Array.isArray(value.data)) {
        return value.data;
    }

    if (value && Array.isArray(value.items)) {
        return value.items;
    }

    if (value && Array.isArray(value.results)) {
        return value.results;
    }

    return [];
}

/**
 * Normalize date.
 *
 * @param {*} value
 * @returns {string|null}
 */
function normalizeDate(value) {
    if (!value) {
        return null;
    }

    const date = value instanceof Date
        ? value
        : new Date(value);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date.toISOString();
}

/**
 * Determine trend between current and previous values.
 *
 * @param {number} current
 * @param {number} previous
 * @param {Object} options
 * @returns {string}
 */
function calculateTrend(current, previous, options = {}) {
    const threshold = toNumber(options.threshold, 0.02);
    const higherIsBetter = options.higherIsBetter !== false;

    if (!isFiniteNumber(current) || !isFiniteNumber(previous)) {
        return TREND.UNKNOWN;
    }

    if (previous === 0) {
        return current === 0
            ? TREND.STABLE
            : higherIsBetter
                ? TREND.IMPROVING
                : TREND.DETERIORATING;
    }

    const change = (current - previous) / Math.abs(previous);

    if (Math.abs(change) <= threshold) {
        return TREND.STABLE;
    }

    if (higherIsBetter) {
        return change > 0
            ? TREND.IMPROVING
            : TREND.DETERIORATING;
    }

    return change < 0
        ? TREND.IMPROVING
        : TREND.DETERIORATING;
}

/**
 * Normalize score to 0..1.
 *
 * @param {*} value
 * @returns {number}
 */
function normalizeScore(value) {
    const numeric = toNumber(value, 0);

    if (numeric > 1 && numeric <= 100) {
        return clamp(numeric / 100);
    }

    return clamp(numeric);
}

/**
 * Normalize severity/risk labels.
 *
 * @param {*} value
 * @returns {string}
 */
function normalizeRiskLevel(value) {
    if (!value) {
        return RISK_LEVEL.LOW;
    }

    const normalized = String(value).toLowerCase();

    if (
        normalized.includes('critical') ||
        normalized.includes('severe')
    ) {
        return RISK_LEVEL.CRITICAL;
    }

    if (
        normalized.includes('high') ||
        normalized.includes('major')
    ) {
        return RISK_LEVEL.HIGH;
    }

    if (
        normalized.includes('moderate') ||
        normalized.includes('medium')
    ) {
        return RISK_LEVEL.MODERATE;
    }

    return RISK_LEVEL.LOW;
}

/**
 * ============================================================================
 * BoardReportingService
 * ============================================================================
 */

class BoardReportingService {

    /**
     * ------------------------------------------------------------------------
     * Constructor
     * ------------------------------------------------------------------------
     *
     * @param {Object} dependencies
     * @param {Object} options
     */
    constructor(dependencies = {}, options = {}) {

        this.serviceName = SERVICE_NAME;
        this.version = SERVICE_VERSION;

        this.logger = dependencies.logger || console;
        this.clock = dependencies.clock || {
            now: () => new Date()
        };

        this.services = {
            operationalBenchmarkService:
                dependencies.operationalBenchmarkService || null,

            branchPerformanceAnalyzer:
                dependencies.branchPerformanceAnalyzer || null,

            teamPerformanceAnalyzer:
                dependencies.teamPerformanceAnalyzer || null,

            capacityPlanner:
                dependencies.capacityPlanner || null,

            workloadBalancer:
                dependencies.workloadBalancer || null,

            fraudCorrelationEngine:
                dependencies.fraudCorrelationEngine || null,

            fraudPatternDetector:
                dependencies.fraudPatternDetector || null,

            suspiciousRepairScorer:
                dependencies.suspiciousRepairScorer || null,

            repairForecastEngine:
                dependencies.repairForecastEngine || null,

            settlementReliabilityEngine:
                dependencies.settlementReliabilityEngine || null,

            predictiveRepairScheduler:
                dependencies.predictiveRepairScheduler || null,

            repairAnalyticsService:
                dependencies.repairAnalyticsService || null,

            statementReconciliationService:
                dependencies.statementReconciliationService || null,

            statementRepairService:
                dependencies.statementRepairService || null
        };

        this.options = {
            ...clone(DEFAULTS),
            ...clone(options),
            thresholds: {
                ...DEFAULTS.thresholds,
                ...(options.thresholds || {})
            }
        };

        this._validateConfiguration();
    }

    /**
     * ------------------------------------------------------------------------
     * Configuration Validation
     * ------------------------------------------------------------------------
     *
     * @private
     */
    _validateConfiguration() {
        if (!this.options.thresholds) {
            this.options.thresholds = {
                ...DEFAULTS.thresholds
            };
        }

        this.options.maxRecommendations = Math.max(
            1,
            Math.floor(toNumber(
                this.options.maxRecommendations,
                DEFAULTS.maxRecommendations
            ))
        );

        this.options.maxRisks = Math.max(
            1,
            Math.floor(toNumber(
                this.options.maxRisks,
                DEFAULTS.maxRisks
            ))
        );

        this.options.maxHighlights = Math.max(
            1,
            Math.floor(toNumber(
                this.options.maxHighlights,
                DEFAULTS.maxHighlights
            ))
        );

        this.options.maxDataQualityIssues = Math.max(
            1,
            Math.floor(toNumber(
                this.options.maxDataQualityIssues,
                DEFAULTS.maxDataQualityIssues
            ))
        );
    }

    /**
     * ------------------------------------------------------------------------
     * Logger Helpers
     * ------------------------------------------------------------------------
     */

    _log(level, message, metadata = {}) {
        try {
            if (this.logger && typeof this.logger[level] === 'function') {
                this.logger[level](
                    `[${SERVICE_NAME}] ${message}`,
                    metadata
                );
            }
        } catch (error) {
            // Reporting must never fail because logging failed.
        }
    }

    /**
     * ------------------------------------------------------------------------
     * Execute Optional Service
     * ------------------------------------------------------------------------
     *
     * Safely invokes an optional intelligence service.
     *
     * @private
     *
     * @param {string} serviceName
     * @param {string[]} methods
     * @param {Object} context
     * @param {Object} diagnostics
     * @returns {Promise<*>}
     */
    async _executeOptionalService(
        serviceName,
        methods,
        context,
        diagnostics
    ) {
        const service = this.services[serviceName];

        if (!service) {
            diagnostics.missingServices.push(serviceName);

            return null;
        }

        let method = null;

        for (const methodName of methods) {
            if (typeof service[methodName] === 'function') {
                method = service[methodName].bind(service);
                break;
            }
        }

        if (!method) {
            diagnostics.unsupportedServices.push({
                service: serviceName,
                expectedMethods: methods
            });

            return null;
        }

        const startedAt = this.clock.now();

        try {
            const result = await method(context);

            diagnostics.executions.push({
                service: serviceName,
                status: 'success',
                durationMs: Math.max(
                    0,
                    this.clock.now().getTime() - startedAt.getTime()
                )
            });

            return result;
        } catch (error) {
            diagnostics.failures.push({
                service: serviceName,
                message: error && error.message
                    ? error.message
                    : 'Unknown service failure'
            });

            this._log('warn', `Optional service failed: ${serviceName}`, {
                error: error && error.message
                    ? error.message
                    : undefined
            });

            return null;
        }
    }

    /**
     * =========================================================================
     * Public API
     * =========================================================================
     */

    /**
     * Generate a complete board report.
     *
     * @param {Object} context
     * @returns {Promise<Object>}
     */
    async generateReport(context = {}) {

        const startedAt = this.clock.now();

        const normalizedContext = this._normalizeContext(context);

        const diagnostics = {
            missingServices: [],
            unsupportedServices: [],
            failures: [],
            executions: [],
            warnings: [],
            dataQualityIssues: []
        };

        this._validateContext(
            normalizedContext,
            diagnostics
        );

        const reportId = generateReportId(
            normalizedContext.tenantId,
            normalizedContext.period.start,
            normalizedContext.period.end
        );

        this._log('info', 'Generating board report', {
            reportId,
            tenantId: normalizedContext.tenantId,
            period: normalizedContext.period
        });

        try {

            const intelligence = await this._collectIntelligence(
                normalizedContext,
                diagnostics
            );

            const normalized = this._normalizeIntelligence(
                intelligence,
                normalizedContext,
                diagnostics
            );

            const kpis = this._calculateKPIs(
                normalized,
                normalizedContext,
                diagnostics
            );

            const health = this._calculateOverallHealth(
                kpis,
                normalized,
                diagnostics
            );

            const risks = this._buildRiskRegister(
                kpis,
                normalized,
                diagnostics
            );

            const highlights = this._buildHighlights(
                kpis,
                normalized,
                diagnostics
            );

            const recommendations = this._buildRecommendations(
                kpis,
                normalized,
                risks,
                diagnostics
            );

            const executiveSummary = this._buildExecutiveSummary(
                kpis,
                health,
                risks,
                highlights,
                recommendations
            );

            const dataQuality = this._buildDataQualityAssessment(
                normalized,
                diagnostics
            );

            const report = {
                metadata: {
                    reportId,
                    service: this.serviceName,
                    serviceVersion: this.version,
                    generatedAt: normalizeDate(this.clock.now()),
                    tenantId: normalizedContext.tenantId,
                    organizationId: normalizedContext.organizationId,
                    branchId: normalizedContext.branchId,
                    reportingCurrency:
                        normalizedContext.reportingCurrency,
                    period: clone(normalizedContext.period),
                    comparisonPeriod:
                        clone(normalizedContext.comparisonPeriod),
                    status: this._determineReportStatus(
                        diagnostics,
                        dataQuality
                    ),
                    calculationVersion: '1.0.0'
                },

                executiveSummary,

                health,

                kpis,

                financialIntegrity: {
                    statementQuality:
                        normalized.statementQuality,

                    reconciliation:
                        normalized.reconciliation,

                    repair:
                        normalized.repair
                },

                settlementReliability:
                    normalized.settlementReliability,

                fraudAndRisk: {
                    correlations:
                        normalized.fraudCorrelations,

                    patterns:
                        normalized.fraudPatterns,

                    suspiciousRepairs:
                        normalized.suspiciousRepairs,

                    riskRegister: risks
                },

                operationalPerformance: {
                    benchmark:
                        normalized.operationalBenchmark,

                    branches:
                        normalized.branchPerformance,

                    teams:
                        normalized.teamPerformance,

                    capacity:
                        normalized.capacity,

                    workload:
                        normalized.workload
                },

                forecasting: {
                    repairForecast:
                        normalized.repairForecast,

                    predictiveSchedule:
                        normalized.predictiveSchedule
                },

                highlights,

                recommendations,

                dataQuality,

                diagnostics: {
                    ...clone(diagnostics),
                    generatedDurationMs: Math.max(
                        0,
                        this.clock.now().getTime() -
                        startedAt.getTime()
                    )
                }
            };

            report.metadata.reportHash = hashObject(report);

            this._log('info', 'Board report generated', {
                reportId,
                status: report.metadata.status,
                health: report.health.status
            });

            return report;

        } catch (error) {

            this._log('error', 'Board report generation failed', {
                reportId,
                error: error && error.message
                    ? error.message
                    : undefined
            });

            return this._buildFailureReport(
                reportId,
                normalizedContext,
                diagnostics,
                error,
                startedAt
            );
        }
    }

    /**
     * Generate executive summary only.
     *
     * @param {Object} context
     * @returns {Promise<Object>}
     */
    async generateExecutiveSummary(context = {}) {

        const report = await this.generateReport(context);

        return {
            metadata: report.metadata,
            executiveSummary: report.executiveSummary,
            health: report.health,
            keyKPIs: report.kpis.summary,
            risks: report.fraudAndRisk.riskRegister,
            recommendations: report.recommendations,
            highlights: report.highlights
        };
    }

    /**
     * Generate board scorecard.
     *
     * @param {Object} context
     * @returns {Promise<Object>}
     */
    async generateScorecard(context = {}) {

        const report = await this.generateReport(context);

        return {
            reportId: report.metadata.reportId,
            tenantId: report.metadata.tenantId,
            period: report.metadata.period,
            status: report.metadata.status,
            health: report.health,

            dimensions: {
                financialIntegrity:
                    this._scorecardDimension(
                        'Financial Integrity',
                        report.kpis.financialIntegrityScore
                    ),

                operationalEfficiency:
                    this._scorecardDimension(
                        'Operational Efficiency',
                        report.kpis.operationalEfficiencyScore
                    ),

                settlementReliability:
                    this._scorecardDimension(
                        'Settlement Reliability',
                        report.kpis.settlementReliabilityScore
                    ),

                fraudRisk:
                    this._scorecardDimension(
                        'Fraud Risk',
                        report.kpis.fraudRiskScore,
                        true
                    ),

                forecastingConfidence:
                    this._scorecardDimension(
                        'Forecasting Confidence',
                        report.kpis.forecastingConfidenceScore
                    ),

                dataQuality:
                    this._scorecardDimension(
                        'Data Quality',
                        report.dataQuality.score
                    )
            },

            overallScore:
                report.kpis.boardPerformanceScore
        };
    }

    /**
     * Generate board action list.
     *
     * @param {Object} context
     * @returns {Promise<Array>}
     */
    async generateActionPlan(context = {}) {

        const report = await this.generateReport(context);

        return [
            ...report.recommendations.map(item => ({
                ...item,
                source: 'recommendation'
            })),

            ...report.fraudAndRisk.riskRegister.map(item => ({
                actionId: `RISK-${item.id}`,
                priority: item.priority,
                severity: item.level,
                category: 'risk',
                title: item.title,
                action: item.mitigation,
                source: 'risk-register'
            }))
        ].slice(
            0,
            this.options.maxRecommendations +
            this.options.maxRisks
        );
    }

    /**
     * =========================================================================
     * Context Normalization
     * =========================================================================
     */

    _normalizeContext(context = {}) {

        const now = this.clock.now();

        const period = context.period || {};

        const start =
            normalizeDate(
                period.start ||
                context.periodStart
            );

        const end =
            normalizeDate(
                period.end ||
                context.periodEnd
            );

        return {
            tenantId:
                context.tenantId ||
                context.tenant?.id ||
                context.tenant?.tenantId ||
                null,

            organizationId:
                context.organizationId ||
                context.organization?.id ||
                null,

            branchId:
                context.branchId ||
                null,

            reportingCurrency:
                context.reportingCurrency ||
                context.currency ||
                'UGX',

            period: {
                start,
                end: end || now.toISOString()
            },

            comparisonPeriod: {
                start:
                    normalizeDate(
                        context.comparisonPeriod?.start
                    ),

                end:
                    normalizeDate(
                        context.comparisonPeriod?.end
                    )
            },

            userId:
                context.userId ||
                context.actorId ||
                null,

            requestId:
                context.requestId ||
                null,

            correlationId:
                context.correlationId ||
                null,

            data: clone(
                context.data ||
                context.input ||
                {}
            ),

            options: clone(
                context.options ||
                {}
            )
        };
    }

    _validateContext(context, diagnostics) {

        if (!context.tenantId) {
            diagnostics.dataQualityIssues.push({
                code: 'MISSING_TENANT_ID',
                severity: 'critical',
                message:
                    'Tenant identifier was not supplied.'
            });
        }

        if (!context.period.start) {
            diagnostics.dataQualityIssues.push({
                code: 'MISSING_PERIOD_START',
                severity: 'warning',
                message:
                    'Reporting period start was not supplied.'
            });
        }

        if (!context.period.end) {
            diagnostics.dataQualityIssues.push({
                code: 'MISSING_PERIOD_END',
                severity: 'warning',
                message:
                    'Reporting period end was not supplied.'
            });
        }
    }

    /**
     * =========================================================================
     * Intelligence Collection
     * =========================================================================
     */

    async _collectIntelligence(context, diagnostics) {

        const serviceContext = {
            ...clone(context),
            reportingPeriod: clone(context.period),
            comparisonPeriod: clone(context.comparisonPeriod)
        };

        const [
            operationalBenchmark,
            branchPerformance,
            teamPerformance,
            capacity,
            workload,
            fraudCorrelations,
            fraudPatterns,
            suspiciousRepairs,
            repairForecast,
            settlementReliability,
            predictiveSchedule,
            repairAnalytics,
            reconciliation,
            repair
        ] = await Promise.all([
            this._executeOptionalService(
                'operationalBenchmarkService',
                ['analyze', 'benchmark', 'calculate', 'generate'],
                serviceContext,
                diagnostics
            ),

            this._executeOptionalService(
                'branchPerformanceAnalyzer',
                ['analyze', 'analyzeBranches', 'calculate', 'generate'],
                serviceContext,
                diagnostics
            ),

            this._executeOptionalService(
                'teamPerformanceAnalyzer',
                ['analyze', 'analyzeTeams', 'calculate', 'generate'],
                serviceContext,
                diagnostics
            ),

            this._executeOptionalService(
                'capacityPlanner',
                ['analyze', 'plan', 'calculate', 'forecast'],
                serviceContext,
                diagnostics
            ),

            this._executeOptionalService(
                'workloadBalancer',
                ['analyze', 'balance', 'calculate', 'optimize'],
                serviceContext,
                diagnostics
            ),

            this._executeOptionalService(
                'fraudCorrelationEngine',
                ['analyze', 'correlate', 'detect', 'generate'],
                serviceContext,
                diagnostics
            ),

            this._executeOptionalService(
                'fraudPatternDetector',
                ['analyze', 'detect', 'scan', 'generate'],
                serviceContext,
                diagnostics
            ),

            this._executeOptionalService(
                'suspiciousRepairScorer',
                ['analyze', 'score', 'calculate', 'evaluate'],
                serviceContext,
                diagnostics
            ),

            this._executeOptionalService(
                'repairForecastEngine',
                ['forecast', 'predict', 'analyze', 'generate'],
                serviceContext,
                diagnostics
            ),

            this._executeOptionalService(
                'settlementReliabilityEngine',
                ['analyze', 'calculate', 'score', 'forecast'],
                serviceContext,
                diagnostics
            ),

            this._executeOptionalService(
                'predictiveRepairScheduler',
                ['schedule', 'predict', 'plan', 'generate'],
                serviceContext,
                diagnostics
            ),

            this._executeOptionalService(
                'repairAnalyticsService',
                ['analyze', 'snapshot', 'summarize', 'generate'],
                serviceContext,
                diagnostics
            ),

            this._executeOptionalService(
                'statementReconciliationService',
                ['reconcile', 'analyze', 'summarize'],
                serviceContext,
                diagnostics
            ),

            this._executeOptionalService(
                'statementRepairService',
                ['analyze', 'summarize', 'getMetrics'],
                serviceContext,
                diagnostics
            )
        ]);

        return {
            operationalBenchmark,
            branchPerformance,
            teamPerformance,
            capacity,
            workload,
            fraudCorrelations,
            fraudPatterns,
            suspiciousRepairs,
            repairForecast,
            settlementReliability,
            predictiveSchedule,
            repairAnalytics,
            reconciliation,
            repair,

            rawInput: clone(context.data)
        };
    }

    /**
     * =========================================================================
     * Intelligence Normalization
     * =========================================================================
     */

    _normalizeIntelligence(
        intelligence,
        context,
        diagnostics
    ) {

        return {
            statementQuality:
                this._normalizeStatementQuality(
                    intelligence,
                    diagnostics
                ),

            reconciliation:
                this._normalizeReconciliation(
                    intelligence.reconciliation,
                    diagnostics
                ),

            repair:
                this._normalizeRepair(
                    intelligence.repair,
                    intelligence.repairAnalytics,
                    diagnostics
                ),

            settlementReliability:
                this._normalizeSettlementReliability(
                    intelligence.settlementReliability,
                    diagnostics
                ),

            operationalBenchmark:
                this._normalizeOperationalBenchmark(
                    intelligence.operationalBenchmark,
                    diagnostics
                ),

            branchPerformance:
                this._normalizePerformanceCollection(
                    intelligence.branchPerformance,
                    'branch',
                    diagnostics
                ),

            teamPerformance:
                this._normalizePerformanceCollection(
                    intelligence.teamPerformance,
                    'team',
                    diagnostics
                ),

            capacity:
                this._normalizeCapacity(
                    intelligence.capacity,
                    diagnostics
                ),

            workload:
                this._normalizeWorkload(
                    intelligence.workload,
                    diagnostics
                ),

            fraudCorrelations:
                this._normalizeFraudCollection(
                    intelligence.fraudCorrelations,
                    'correlation',
                    diagnostics
                ),

            fraudPatterns:
                this._normalizeFraudCollection(
                    intelligence.fraudPatterns,
                    'pattern',
                    diagnostics
                ),

            suspiciousRepairs:
                this._normalizeSuspiciousRepairs(
                    intelligence.suspiciousRepairs,
                    diagnostics
                ),

            repairForecast:
                this._normalizeRepairForecast(
                    intelligence.repairForecast,
                    diagnostics
                ),

            predictiveSchedule:
                this._normalizePredictiveSchedule(
                    intelligence.predictiveSchedule,
                    diagnostics
                )
        };
    }

    _normalizeStatementQuality(intelligence, diagnostics) {

        const source =
            intelligence.repairAnalytics ||
            intelligence.rawInput ||
            {};

        const totalStatements = toNumber(
            firstDefined(source, [
                'totalStatements',
                'summary.totalStatements',
                'statementCount'
            ], 0)
        );

        const validatedStatements = toNumber(
            firstDefined(source, [
                'validatedStatements',
                'summary.validatedStatements'
            ], totalStatements)
        );

        const rejectedStatements = toNumber(
            firstDefined(source, [
                'rejectedStatements',
                'summary.rejectedStatements'
            ], 0)
        );

        const qualityScore =
            totalStatements > 0
                ? clamp(
                    validatedStatements / totalStatements
                )
                : 1;

        if (totalStatements === 0) {
            diagnostics.dataQualityIssues.push({
                code: 'NO_STATEMENT_VOLUME',
                severity: 'warning',
                message:
                    'No statement volume was available for quality scoring.'
            });
        }

        return {
            totalStatements,
            validatedStatements,
            rejectedStatements,
            validationRate: percentage(
                validatedStatements,
                totalStatements
            ),
            rejectionRate: percentage(
                rejectedStatements,
                totalStatements
            ),
            score: round(qualityScore, 4)
        };
    }

    _normalizeReconciliation(source, diagnostics) {

        source = source || {};

        const total =
            toNumber(firstDefined(source, [
                'totalTransactions',
                'summary.totalTransactions',
                'metrics.totalTransactions',
                'transactionCount'
            ], 0));

        const matched =
            toNumber(firstDefined(source, [
                'matchedTransactions',
                'summary.matchedTransactions',
                'metrics.matchedTransactions'
            ], 0));

        const unmatched =
            toNumber(firstDefined(source, [
                'unmatchedTransactions',
                'summary.unmatchedTransactions',
                'metrics.unmatchedTransactions'
            ], Math.max(total - matched, 0)));

        const varianceAmount =
            toNumber(firstDefined(source, [
                'varianceAmount',
                'summary.varianceAmount',
                'metrics.varianceAmount'
            ], 0));

        const varianceCount =
            toNumber(firstDefined(source, [
                'varianceCount',
                'summary.varianceCount',
                'metrics.varianceCount'
            ], 0));

        if (total === 0) {
            diagnostics.dataQualityIssues.push({
                code: 'NO_RECONCILIATION_VOLUME',
                severity: 'warning',
                message:
                    'No reconciliation transaction volume was available.'
            });
        }

        return {
            totalTransactions: total,
            matchedTransactions: matched,
            unmatchedTransactions: unmatched,
            varianceAmount,
            varianceCount,

            matchRate: percentage(
                matched,
                total
            ),

            unmatchedRate: percentage(
                unmatched,
                total
            ),

            varianceRate: percentage(
                varianceCount,
                total
            )
        };
    }

    _normalizeRepair(
        source,
        analyticsSource,
        diagnostics
    ) {

        source = source || {};
        analyticsSource = analyticsSource || {};

        const total =
            toNumber(firstDefined(source, [
                'totalRepairs',
                'summary.totalRepairs',
                'metrics.totalRepairs'
            ], firstDefined(analyticsSource, [
                'totalRepairs',
                'summary.totalRepairs'
            ], 0)));

        const resolved =
            toNumber(firstDefined(source, [
                'resolvedRepairs',
                'completedRepairs',
                'summary.resolvedRepairs',
                'metrics.resolvedRepairs'
            ], 0));

        const unresolved =
            toNumber(firstDefined(source, [
                'unresolvedRepairs',
                'openRepairs',
                'summary.unresolvedRepairs'
            ], Math.max(total - resolved, 0)));

        const failed =
            toNumber(firstDefined(source, [
                'failedRepairs',
                'summary.failedRepairs'
            ], 0));

        const amount =
            toNumber(firstDefined(source, [
                'repairAmount',
                'totalRepairAmount',
                'summary.repairAmount'
            ], 0));

        const repairRate =
            normalizeScore(
                firstDefined(source, [
                    'repairRate',
                    'summary.repairRate'
                ], 0)
            );

        if (total === 0) {
            diagnostics.dataQualityIssues.push({
                code: 'NO_REPAIR_VOLUME',
                severity: 'warning',
                message:
                    'No repair volume was available for the reporting period.'
            });
        }

        return {
            totalRepairs: total,
            resolvedRepairs: resolved,
            unresolvedRepairs: unresolved,
            failedRepairs: failed,
            repairAmount: amount,

            resolutionRate: percentage(
                resolved,
                total
            ),

            unresolvedRate: percentage(
                unresolved,
                total
            ),

            failureRate: percentage(
                failed,
                total
            ),

            repairRate: repairRate > 1
                ? repairRate / 100
                : repairRate
        };
    }

    _normalizeSettlementReliability(
        source,
        diagnostics
    ) {

        source = source || {};

        const reliability =
            normalizeScore(firstDefined(source, [
                'reliabilityScore',
                'score',
                'metrics.reliabilityScore',
                'summary.reliabilityScore'
            ], 0));

        const successRate =
            normalizeScore(firstDefined(source, [
                'successRate',
                'settlementSuccessRate',
                'metrics.successRate'
            ], reliability));

        const failureRate =
            normalizeScore(firstDefined(source, [
                'failureRate',
                'settlementFailureRate',
                'metrics.failureRate'
            ], 1 - successRate));

        const totalSettlements =
            toNumber(firstDefined(source, [
                'totalSettlements',
                'settlementCount',
                'metrics.totalSettlements'
            ], 0));

        const failedSettlements =
            toNumber(firstDefined(source, [
                'failedSettlements',
                'metrics.failedSettlements'
            ], 0));

        return {
            reliabilityScore: reliability,
            successRate,
            failureRate,
            totalSettlements,
            failedSettlements,
            averageLatencyMs:
                toNumber(firstDefined(source, [
                    'averageLatencyMs',
                    'avgLatencyMs',
                    'metrics.averageLatencyMs'
                ], 0)),
            trend:
                firstDefined(source, [
                    'trend',
                    'forecast.trend'
                ], TREND.UNKNOWN)
        };
    }

    _normalizeOperationalBenchmark(
        source,
        diagnostics
    ) {

        source = source || {};

        const score =
            normalizeScore(firstDefined(source, [
                'benchmarkScore',
                'score',
                'efficiencyScore',
                'summary.score'
            ], 0));

        const industryScore =
            normalizeScore(firstDefined(source, [
                'industryScore',
                'benchmark.industryScore'
            ], score));

        const percentile =
            toNumber(firstDefined(source, [
                'percentile',
                'benchmark.percentile'
            ], 0));

        return {
            score,
            industryScore,
            percentile,
            gap: round(score - industryScore, 4),
            status:
                score >= 0.80
                    ? HEALTH_STATUS.HEALTHY
                    : score >= 0.60
                        ? HEALTH_STATUS.WARNING
                        : HEALTH_STATUS.CRITICAL
        };
    }

    _normalizePerformanceCollection(
        source,
        entityType,
        diagnostics
    ) {

        const collection = toArray(source);

        return collection.map((item, index) => {

            const score =
                normalizeScore(firstDefined(item, [
                    'performanceScore',
                    'score',
                    'efficiencyScore',
                    'rating'
                ], 0));

            return {
                id:
                    firstDefined(item, [
                        'id',
                        `${entityType}Id`,
                        '_id'
                    ], `${entityType}-${index + 1}`),

                name:
                    firstDefined(item, [
                        'name',
                        `${entityType}Name`,
                        'label'
                    ], `${entityType} ${index + 1}`),

                score,

                productivity:
                    normalizeScore(firstDefined(item, [
                        'productivity',
                        'productivityScore'
                    ], score)),

                quality:
                    normalizeScore(firstDefined(item, [
                        'quality',
                        'qualityScore'
                    ], score)),

                workload:
                    normalizeScore(firstDefined(item, [
                        'workload',
                        'workloadScore'
                    ], 0)),

                trend:
                    firstDefined(item, [
                        'trend'
                    ], TREND.UNKNOWN)
            };
        });
    }

    _normalizeCapacity(source, diagnostics) {

        source = source || {};

        return {
            capacityScore:
                normalizeScore(firstDefined(source, [
                    'capacityScore',
                    'score',
                    'utilizationScore'
                ], 0)),

            utilization:
                normalizeScore(firstDefined(source, [
                    'utilization',
                    'capacityUtilization'
                ], 0)),

            availableCapacity:
                toNumber(firstDefined(source, [
                    'availableCapacity',
                    'remainingCapacity'
                ], 0)),

            requiredCapacity:
                toNumber(firstDefined(source, [
                    'requiredCapacity',
                    'projectedRequiredCapacity'
                ], 0)),

            capacityGap:
                toNumber(firstDefined(source, [
                    'capacityGap',
                    'gap'
                ], 0)),

            bottlenecks:
                toArray(firstDefined(source, [
                    'bottlenecks',
                    'constraints'
                ], []))
        };
    }

    _normalizeWorkload(source, diagnostics) {

        source = source || {};

        return {
            balanceScore:
                normalizeScore(firstDefined(source, [
                    'balanceScore',
                    'score',
                    'workloadBalanceScore'
                ], 0)),

            overloadedUnits:
                toNumber(firstDefined(source, [
                    'overloadedUnits',
                    'overloadedTeams',
                    'overloadedBranches'
                ], 0)),

            underutilizedUnits:
                toNumber(firstDefined(source, [
                    'underutilizedUnits'
                ], 0)),

            workloadVariance:
                toNumber(firstDefined(source, [
                    'workloadVariance',
                    'variance'
                ], 0)),

            recommendations:
                toArray(firstDefined(source, [
                    'recommendations',
                    'actions'
                ], []))
        };
    }

    _normalizeFraudCollection(
        source,
        type,
        diagnostics
    ) {

        const collection = toArray(source);

        return collection.map((item, index) => {

            const score =
                normalizeScore(firstDefined(item, [
                    'riskScore',
                    'fraudScore',
                    'score'
                ], 0));

            return {
                id:
                    firstDefined(item, [
                        'id',
                        '_id',
                        `${type}Id`
                    ], `${type}-${index + 1}`),

                type,

                category:
                    firstDefined(item, [
                        'category',
                        'pattern',
                        'type',
                        'name'
                    ], 'unknown'),

                score,

                level:
                    normalizeRiskLevel(
                        firstDefined(item, [
                            'level',
                            'severity',
                            'riskLevel'
                        ], score >= 0.75
                            ? RISK_LEVEL.HIGH
                            : RISK_LEVEL.LOW)
                    ),

                amount:
                    toNumber(firstDefined(item, [
                        'amount',
                        'exposureAmount',
                        'transactionAmount'
                    ], 0)),

                confidence:
                    normalizeScore(firstDefined(item, [
                        'confidence',
                        'confidenceScore'
                    ], score)),

                description:
                    firstDefined(item, [
                        'description',
                        'reason',
                        'explanation'
                    ], null)
            };
        });
    }

    _normalizeSuspiciousRepairs(
        source,
        diagnostics
    ) {

        const collection = toArray(source);

        return collection.map((item, index) => {

            const score =
                normalizeScore(firstDefined(item, [
                    'suspicionScore',
                    'riskScore',
                    'score'
                ], 0));

            return {
                id:
                    firstDefined(item, [
                        'id',
                        '_id',
                        'repairId'
                    ], `suspicious-repair-${index + 1}`),

                repairId:
                    firstDefined(item, [
                        'repairId'
                    ], null),

                score,

                level:
                    normalizeRiskLevel(
                        firstDefined(item, [
                            'riskLevel',
                            'severity'
                        ], score >= 0.75
                            ? RISK_LEVEL.HIGH
                            : RISK_LEVEL.LOW)
                    ),

                reason:
                    firstDefined(item, [
                        'reason',
                        'explanation',
                        'description'
                    ], null),

                amount:
                    toNumber(firstDefined(item, [
                        'amount',
                        'repairAmount'
                    ], 0))
            };
        });
    }

    _normalizeRepairForecast(
        source,
        diagnostics
    ) {

        source = source || {};

        const forecasts =
            toArray(firstDefined(source, [
                'forecasts',
                'predictions',
                'items'
            ], source));

        return {
            forecastScore:
                normalizeScore(firstDefined(source, [
                    'confidence',
                    'confidenceScore',
                    'forecastConfidence',
                    'score'
                ], 0)),

            expectedRepairs:
                toNumber(firstDefined(source, [
                    'expectedRepairs',
                    'forecast.totalRepairs',
                    'predictedRepairs'
                ], 0)),

            expectedRepairAmount:
                toNumber(firstDefined(source, [
                    'expectedRepairAmount',
                    'forecast.repairAmount'
                ], 0)),

            riskScore:
                normalizeScore(firstDefined(source, [
                    'riskScore',
                    'forecastRiskScore'
                ], 0)),

            trend:
                firstDefined(source, [
                    'trend',
                    'forecast.trend'
                ], TREND.UNKNOWN),

            horizon:
                firstDefined(source, [
                    'horizon',
                    'forecastHorizon'
                ], null),

            forecasts
        };
    }

    _normalizePredictiveSchedule(
        source,
        diagnostics
    ) {

        const collection = toArray(source);

        return {
            totalScheduled:
                toNumber(
                    firstDefined(
                        source || {},
                        [
                            'totalScheduled',
                            'scheduledCount'
                        ],
                        collection.length
                    )
                ),

            highPriority:
                collection.filter(item => {
                    const priority = String(
                        firstDefined(item, [
                            'priority',
                            'severity'
                        ], '')
                    ).toLowerCase();

                    return (
                        priority === 'critical' ||
                        priority === 'high'
                    );
                }).length,

            items: collection
        };
    }

    /**
     * =========================================================================
     * KPI Calculations
     * =========================================================================
     */

    _calculateKPIs(
        normalized,
        context,
        diagnostics
    ) {

        const financialIntegrityScore =
            this._calculateFinancialIntegrityScore(
                normalized
            );

        const operationalEfficiencyScore =
            this._calculateOperationalEfficiencyScore(
                normalized
            );

        const settlementReliabilityScore =
            normalized.settlementReliability.reliabilityScore;

        const fraudRiskScore =
            this._calculateFraudRiskScore(
                normalized
            );

        const forecastingConfidenceScore =
            normalized.repairForecast.forecastScore;

        const dataQualityScore =
            this._calculateDataQualityScore(
                normalized,
                diagnostics
            );

        const boardPerformanceScore =
            this._calculateBoardPerformanceScore({
                financialIntegrityScore,
                operationalEfficiencyScore,
                settlementReliabilityScore,
                fraudRiskScore,
                forecastingConfidenceScore,
                dataQualityScore
            });

        return {
            financialIntegrityScore:
                round(financialIntegrityScore, 4),

            operationalEfficiencyScore:
                round(operationalEfficiencyScore, 4),

            settlementReliabilityScore:
                round(settlementReliabilityScore, 4),

            fraudRiskScore:
                round(fraudRiskScore, 4),

            forecastingConfidenceScore:
                round(forecastingConfidenceScore, 4),

            dataQualityScore:
                round(dataQualityScore, 4),

            boardPerformanceScore:
                round(boardPerformanceScore, 4),

            summary: {
                totalStatements:
                    normalized.statementQuality.totalStatements,

                totalTransactions:
                    normalized.reconciliation.totalTransactions,

                reconciliationRate:
                    normalized.reconciliation.matchRate,

                totalRepairs:
                    normalized.repair.totalRepairs,

                repairResolutionRate:
                    normalized.repair.resolutionRate,

                unresolvedRepairs:
                    normalized.repair.unresolvedRepairs,

                settlementReliability:
                    round(
                        normalized.settlementReliability
                            .reliabilityScore * 100,
                        2
                    ),

                fraudRisk:
                    round(
                        fraudRiskScore * 100,
                        2
                    ),

                boardPerformance:
                    round(
                        boardPerformanceScore * 100,
                        2
                    )
            }
        };
    }

    _calculateFinancialIntegrityScore(normalized) {

        const reconciliationScore =
            clamp(
                normalized.reconciliation.matchRate / 100
            );

        const repairResolutionScore =
            clamp(
                normalized.repair.resolutionRate / 100
            );

        const statementQualityScore =
            normalized.statementQuality.score;

        const unresolvedPenalty =
            clamp(
                normalized.repair.unresolvedRate / 100
            );

        return clamp(
            (
                reconciliationScore * 0.40 +
                repairResolutionScore * 0.25 +
                statementQualityScore * 0.25 +
                (1 - unresolvedPenalty) * 0.10
            )
        );
    }

    _calculateOperationalEfficiencyScore(normalized) {

        const benchmark =
            normalized.operationalBenchmark.score;

        const workload =
            normalized.workload.balanceScore;

        const capacity =
            normalized.capacity.capacityScore;

        const branchScores =
            normalized.branchPerformance.map(
                item => item.score
            );

        const teamScores =
            normalized.teamPerformance.map(
                item => item.score
            );

        const branchScore =
            branchScores.length
                ? branchScores.reduce(
                    (sum, score) => sum + score,
                    0
                ) / branchScores.length
                : benchmark;

        const teamScore =
            teamScores.length
                ? teamScores.reduce(
                    (sum, score) => sum + score,
                    0
                ) / teamScores.length
                : benchmark;

        return clamp(
            benchmark * 0.25 +
            workload * 0.15 +
            capacity * 0.15 +
            branchScore * 0.20 +
            teamScore * 0.25
        );
    }

    _calculateFraudRiskScore(normalized) {

        const correlations =
            normalized.fraudCorrelations;

        const patterns =
            normalized.fraudPatterns;

        const suspiciousRepairs =
            normalized.suspiciousRepairs;

        const weightedScores = [];

        for (const item of [
            ...correlations,
            ...patterns,
            ...suspiciousRepairs
        ]) {
            weightedScores.push(
                clamp(item.score)
            );
        }

        if (!weightedScores.length) {
            return 0;
        }

        const average =
            weightedScores.reduce(
                (sum, score) => sum + score,
                0
            ) / weightedScores.length;

        const highRiskCount =
            [...correlations, ...patterns, ...suspiciousRepairs]
                .filter(item =>
                    item.level === RISK_LEVEL.HIGH ||
                    item.level === RISK_LEVEL.CRITICAL
                )
                .length;

        const concentrationPenalty =
            clamp(
                highRiskCount /
                Math.max(weightedScores.length, 1)
            );

        return clamp(
            average * 0.70 +
            concentrationPenalty * 0.30
        );
    }

    _calculateDataQualityScore(
        normalized,
        diagnostics
    ) {

        const availableDimensions = [
            normalized.statementQuality,
            normalized.reconciliation,
            normalized.repair,
            normalized.settlementReliability,
            normalized.operationalBenchmark
        ];

        let completeness = 0;

        for (const dimension of availableDimensions) {
            if (
                dimension &&
                typeof dimension === 'object'
            ) {
                completeness += 1;
            }
        }

        const dimensionScore =
            completeness /
            availableDimensions.length;

        const failures =
            diagnostics.failures.length;

        const missing =
            diagnostics.missingServices.length;

        const penalty =
            clamp(
                failures * 0.05 +
                missing * 0.01
            );

        return clamp(
            dimensionScore - penalty
        );
    }

    _calculateBoardPerformanceScore(scores) {

        /*
         * Fraud risk is inverted because a higher fraud-risk score is bad.
         */
        const riskAdjustedFraudScore =
            1 - clamp(scores.fraudRiskScore);

        return clamp(
            scores.financialIntegrityScore * 0.25 +
            scores.operationalEfficiencyScore * 0.20 +
            scores.settlementReliabilityScore * 0.15 +
            riskAdjustedFraudScore * 0.15 +
            scores.forecastingConfidenceScore * 0.10 +
            scores.dataQualityScore * 0.15
        );
    }

    /**
     * =========================================================================
     * Overall Health
     * =========================================================================
     */

    _calculateOverallHealth(
        kpis,
        normalized,
        diagnostics
    ) {

        const score =
            kpis.boardPerformanceScore;

        const threshold =
            this.options.thresholds;

        let status;

        if (
            score < threshold.operationalEfficiencyCritical ||
            kpis.financialIntegrityScore < 0.50 ||
            kpis.settlementReliabilityScore <
                threshold.settlementReliabilityCritical ||
            kpis.fraudRiskScore >=
                threshold.fraudRateCritical
        ) {
            status = HEALTH_STATUS.CRITICAL;

        } else if (
            score < threshold.operationalEfficiencyWarning ||
            kpis.financialIntegrityScore < 0.70 ||
            kpis.settlementReliabilityScore <
                threshold.settlementReliabilityWarning ||
            kpis.fraudRiskScore >=
                threshold.fraudRateWarning
        ) {
            status = HEALTH_STATUS.WARNING;

        } else {
            status = HEALTH_STATUS.HEALTHY;
        }

        return {
            status,
            score: round(score, 4),
            percentage: round(score * 100, 2),

            dimensions: {
                financialIntegrity:
                    this._healthFromScore(
                        kpis.financialIntegrityScore
                    ),

                operationalEfficiency:
                    this._healthFromScore(
                        kpis.operationalEfficiencyScore
                    ),

                settlementReliability:
                    this._healthFromScore(
                        kpis.settlementReliabilityScore
                    ),

                fraudRisk:
                    this._healthFromRiskScore(
                        kpis.fraudRiskScore
                    ),

                forecasting:
                    this._healthFromScore(
                        kpis.forecastingConfidenceScore
                    ),

                dataQuality:
                    this._healthFromScore(
                        kpis.dataQualityScore
                    )
            }
        };
    }

    _healthFromScore(score) {

        score = clamp(score);

        if (score >= 0.80) {
            return HEALTH_STATUS.HEALTHY;
        }

        if (score >= 0.60) {
            return HEALTH_STATUS.WARNING;
        }

        return HEALTH_STATUS.CRITICAL;
    }

    _healthFromRiskScore(score) {

        score = clamp(score);

        if (score >= 0.60) {
            return HEALTH_STATUS.CRITICAL;
        }

        if (score >= 0.30) {
            return HEALTH_STATUS.WARNING;
        }

        return HEALTH_STATUS.HEALTHY;
    }

    /**
     * =========================================================================
     * Risk Register
     * =========================================================================
     */

    _buildRiskRegister(
        kpis,
        normalized,
        diagnostics
    ) {

        const risks = [];

        const thresholds =
            this.options.thresholds;

        if (
            normalized.repair.unresolvedRate / 100 >=
            thresholds.unresolvedRateCritical
        ) {
            risks.push(
                this._createRisk({
                    id: 'UNRESOLVED_REPAIR_BACKLOG',
                    level: RISK_LEVEL.CRITICAL,
                    priority: 1,
                    title: 'Critical unresolved repair backlog',
                    description:
                        'A material proportion of detected financial repairs remains unresolved.',
                    metric:
                        normalized.repair.unresolvedRate,
                    mitigation:
                        'Escalate unresolved repairs, prioritize high-value exceptions, and enforce repair SLA controls.'
                })
            );
        } else if (
            normalized.repair.unresolvedRate / 100 >=
            thresholds.unresolvedRateWarning
        ) {
            risks.push(
                this._createRisk({
                    id: 'ELEVATED_REPAIR_BACKLOG',
                    level: RISK_LEVEL.HIGH,
                    priority: 2,
                    title: 'Elevated unresolved repair backlog',
                    description:
                        'Repair backlog is above the preferred operational threshold.',
                    metric:
                        normalized.repair.unresolvedRate,
                    mitigation:
                        'Increase repair processing capacity and review aging exceptions.'
                })
            );
        }

        if (
            normalized.settlementReliability.reliabilityScore <
            thresholds.settlementReliabilityCritical
        ) {
            risks.push(
                this._createRisk({
                    id: 'SETTLEMENT_RELIABILITY',
                    level: RISK_LEVEL.CRITICAL,
                    priority: 1,
                    title: 'Critical settlement reliability risk',
                    description:
                        'Settlement reliability is materially below the acceptable threshold.',
                    metric:
                        normalized.settlementReliability.reliabilityScore,
                    mitigation:
                        'Investigate provider failures, settlement delays, reconciliation gaps and retry effectiveness.'
                })
            );
        } else if (
            normalized.settlementReliability.reliabilityScore <
            thresholds.settlementReliabilityWarning
        ) {
            risks.push(
                this._createRisk({
                    id: 'SETTLEMENT_RELIABILITY_WARNING',
                    level: RISK_LEVEL.HIGH,
                    priority: 2,
                    title: 'Settlement reliability deterioration',
                    description:
                        'Settlement reliability has fallen below the preferred operating range.',
                    metric:
                        normalized.settlementReliability.reliabilityScore,
                    mitigation:
                        'Review settlement exceptions, provider performance and reconciliation latency.'
                })
            );
        }

        if (
            kpis.fraudRiskScore >=
            thresholds.fraudRateCritical
        ) {
            risks.push(
                this._createRisk({
                    id: 'FRAUD_RISK',
                    level: RISK_LEVEL.CRITICAL,
                    priority: 1,
                    title: 'Critical fraud-risk concentration',
                    description:
                        'Fraud intelligence indicates a material concentration of high-risk activity.',
                    metric:
                        kpis.fraudRiskScore,
                    mitigation:
                        'Escalate high-risk cases, preserve evidence, enforce review controls and investigate correlated accounts.'
                })
            );
        } else if (
            kpis.fraudRiskScore >=
            thresholds.fraudRateWarning
        ) {
            risks.push(
                this._createRisk({
                    id: 'FRAUD_RISK_WARNING',
                    level: RISK_LEVEL.HIGH,
                    priority: 2,
                    title: 'Elevated fraud-risk indicators',
                    description:
                        'Fraud intelligence indicates elevated risk signals.',
                    metric:
                        kpis.fraudRiskScore,
                    mitigation:
                        'Review suspicious patterns, correlated accounts and unusual repair activity.'
                })
            );
        }

        if (
            kpis.financialIntegrityScore < 0.60
        ) {
            risks.push(
                this._createRisk({
                    id: 'FINANCIAL_INTEGRITY',
                    level: RISK_LEVEL.CRITICAL,
                    priority: 1,
                    title: 'Financial integrity weakness',
                    description:
                        'Reconciliation, statement quality or repair resolution performance requires executive attention.',
                    metric:
                        kpis.financialIntegrityScore,
                    mitigation:
                        'Strengthen reconciliation controls, repair workflows and statement validation.'
                })
            );
        }

        if (
            kpis.operationalEfficiencyScore < 0.50
        ) {
            risks.push(
                this._createRisk({
                    id: 'OPERATIONAL_EFFICIENCY',
                    level: RISK_LEVEL.HIGH,
                    priority: 2,
                    title: 'Operational efficiency constraint',
                    description:
                        'Operational performance indicates material capacity or productivity constraints.',
                    metric:
                        kpis.operationalEfficiencyScore,
                    mitigation:
                        'Rebalance workload, address bottlenecks and increase processing capacity where required.'
                })
            );
        }

        if (
            normalized.repairForecast.riskScore >=
            thresholds.forecastRiskCritical
        ) {
            risks.push(
                this._createRisk({
                    id: 'FORECAST_REPAIR_RISK',
                    level: RISK_LEVEL.HIGH,
                    priority: 3,
                    title: 'High projected repair risk',
                    description:
                        'Forecasting indicates elevated future repair demand or financial exception risk.',
                    metric:
                        normalized.repairForecast.riskScore,
                    mitigation:
                        'Pre-position repair capacity and prioritize predicted high-impact exceptions.'
                })
            );
        }

        return risks
            .sort(
                (a, b) =>
                    a.priority - b.priority
            )
            .slice(
                0,
                this.options.maxRisks
            );
    }

    _createRisk({
        id,
        level,
        priority,
        title,
        description,
        metric,
        mitigation
    }) {

        return {
            id,
            level,
            priority,
            title,
            description,
            metric: round(
                normalizeScore(metric),
                4
            ),
            mitigation,
            boardAttentionRequired:
                level === RISK_LEVEL.CRITICAL ||
                level === RISK_LEVEL.HIGH
        };
    }

    /**
     * =========================================================================
     * Highlights
     * =========================================================================
     */

    _buildHighlights(
        kpis,
        normalized,
        diagnostics
    ) {

        const highlights = [];

        if (
            kpis.financialIntegrityScore >= 0.80
        ) {
            highlights.push({
                type: 'positive',
                category: 'financial-integrity',
                title: 'Strong financial integrity',
                message:
                    'Reconciliation and repair outcomes indicate strong financial control performance.',
                score:
                    kpis.financialIntegrityScore
            });
        }

        if (
            normalized.reconciliation.matchRate >= 98
        ) {
            highlights.push({
                type: 'positive',
                category: 'reconciliation',
                title: 'High reconciliation performance',
                message:
                    'The majority of statement transactions are matching successfully.',
                metric:
                    normalized.reconciliation.matchRate
            });
        }

        if (
            normalized.repair.resolutionRate >= 95
        ) {
            highlights.push({
                type: 'positive',
                category: 'repair',
                title: 'Strong repair resolution',
                message:
                    'Detected financial exceptions are being resolved at a high rate.',
                metric:
                    normalized.repair.resolutionRate
            });
        }

        if (
            normalized.settlementReliability.reliabilityScore >= 0.98
        ) {
            highlights.push({
                type: 'positive',
                category: 'settlement',
                title: 'Highly reliable settlements',
                message:
                    'Settlement processing is operating within a strong reliability range.',
                score:
                    normalized.settlementReliability.reliabilityScore
            });
        }

        const bestBranch =
            [...normalized.branchPerformance]
                .sort((a, b) =>
                    b.score - a.score
                )[0];

        if (bestBranch) {
            highlights.push({
                type: 'positive',
                category: 'branch-performance',
                title: 'Top branch performance',
                message:
                    `${bestBranch.name} is currently the strongest performing branch.`,
                entityId:
                    bestBranch.id,
                score:
                    bestBranch.score
            });
        }

        const worstBranch =
            [...normalized.branchPerformance]
                .sort((a, b) =>
                    a.score - b.score
                )[0];

        if (
            worstBranch &&
            worstBranch.score < 0.60
        ) {
            highlights.push({
                type: 'warning',
                category: 'branch-performance',
                title: 'Branch performance requires attention',
                message:
                    `${worstBranch.name} is performing below the preferred threshold.`,
                entityId:
                    worstBranch.id,
                score:
                    worstBranch.score
            });
        }

        if (
            normalized.capacity.capacityScore < 0.60
        ) {
            highlights.push({
                type: 'warning',
                category: 'capacity',
                title: 'Capacity constraint detected',
                message:
                    'Current operational capacity may not be sufficient for projected workload.',
                score:
                    normalized.capacity.capacityScore
            });
        }

        if (
            normalized.workload.balanceScore < 0.60
        ) {
            highlights.push({
                type: 'warning',
                category: 'workload',
                title: 'Workload imbalance detected',
                message:
                    'Workload distribution indicates operational imbalance.',
                score:
                    normalized.workload.balanceScore
            });
        }

        return highlights.slice(
            0,
            this.options.maxHighlights
        );
    }

    /**
     * =========================================================================
     * Recommendations
     * =========================================================================
     */

    _buildRecommendations(
        kpis,
        normalized,
        risks,
        diagnostics
    ) {

        const recommendations = [];

        for (const risk of risks) {
            recommendations.push({
                id:
                    `REC-${risk.id}`,

                priority:
                    risk.priority,

                category:
                    risk.id.toLowerCase(),

                title:
                    risk.title,

                action:
                    risk.mitigation,

                rationale:
                    risk.description,

                expectedOutcome:
                    this._expectedOutcomeForRisk(
                        risk.id
                    )
            });
        }

        if (
            normalized.predictiveSchedule.highPriority > 0
        ) {
            recommendations.push({
                id:
                    'REC-PREDICTIVE-REPAIR',

                priority:
                    2,

                category:
                    'predictive-repair',

                title:
                    'Prioritize predictive repair queue',

                action:
                    'Use the predictive repair schedule to pre-position processing capacity for high-priority expected exceptions.',

                rationale:
                    `${normalized.predictiveSchedule.highPriority} high-priority predictive repair items were identified.`,

                expectedOutcome:
                    'Lower future exception aging and reduce financial-period closing pressure.'
            });
        }

        if (
            normalized.workload.balanceScore < 0.70
        ) {
            recommendations.push({
                id:
                    'REC-WORKLOAD-BALANCING',

                priority:
                    3,

                category:
                    'operations',

                title:
                    'Rebalance operational workload',

                action:
                    'Redistribute repair and reconciliation workload toward available high-performing capacity.',

                rationale:
                    'Workload distribution indicates operational imbalance.',

                expectedOutcome:
                    'Improve throughput, reduce bottlenecks and strengthen repair SLA performance.'
            });
        }

        if (
            normalized.capacity.capacityScore < 0.70
        ) {
            recommendations.push({
                id:
                    'REC-CAPACITY',

                priority:
                    3,

                category:
                    'capacity',

                title:
                    'Increase exception-processing capacity',

                action:
                    'Review staffing, automation and queue allocation against projected repair demand.',

                rationale:
                    'Capacity indicators show limited headroom.',

                expectedOutcome:
                    'Reduce future repair backlog and processing delays.'
            });
        }

        if (
            kpis.dataQualityScore < 0.80
        ) {
            recommendations.push({
                id:
                    'REC-DATA-QUALITY',

                priority:
                    2,

                category:
                    'data-quality',

                title:
                    'Strengthen intelligence data completeness',

                action:
                    'Resolve missing intelligence-service outputs and improve upstream statement and reconciliation telemetry.',

                rationale:
                    'Board-level conclusions are being generated with incomplete intelligence coverage.',

                expectedOutcome:
                    'Increase board-reporting confidence and decision quality.'
            });
        }

        return recommendations
            .sort(
                (a, b) =>
                    a.priority - b.priority
            )
            .slice(
                0,
                this.options.maxRecommendations
            );
    }

    _expectedOutcomeForRisk(riskId) {

        const outcomes = {
            UNRESOLVED_REPAIR_BACKLOG:
                'Reduce unresolved financial exceptions and improve period-close readiness.',

            ELEVATED_REPAIR_BACKLOG:
                'Improve repair throughput and reduce exception aging.',

            SETTLEMENT_RELIABILITY:
                'Improve settlement success, reliability and reconciliation timeliness.',

            SETTLEMENT_RELIABILITY_WARNING:
                'Prevent further settlement deterioration and reduce exception volume.',

            FRAUD_RISK:
                'Reduce financial exposure and strengthen fraud containment.',

            FRAUD_RISK_WARNING:
                'Detect and contain emerging suspicious activity earlier.',

            FINANCIAL_INTEGRITY:
                'Strengthen the reliability of the financial system of record.',

            OPERATIONAL_EFFICIENCY:
                'Increase processing efficiency and reduce operational bottlenecks.',

            FORECAST_REPAIR_RISK:
                'Reduce future repair backlog through proactive exception management.'
        };

        return outcomes[riskId] ||
            'Reduce operational and financial risk.';
    }

    /**
     * =========================================================================
     * Executive Summary
     * =========================================================================
     */

    _buildExecutiveSummary(
        kpis,
        health,
        risks,
        highlights,
        recommendations
    ) {

        const criticalRisks =
            risks.filter(
                item =>
                    item.level === RISK_LEVEL.CRITICAL
            ).length;

        const highRisks =
            risks.filter(
                item =>
                    item.level === RISK_LEVEL.HIGH
            ).length;

        let headline;

        if (health.status === HEALTH_STATUS.CRITICAL) {
            headline =
                'Financial and operational performance requires immediate executive attention.';
        } else if (health.status === HEALTH_STATUS.WARNING) {
            headline =
                'Financial and operational performance is stable but contains material areas requiring management attention.';
        } else {
            headline =
                'Financial and operational performance remains within the preferred operating range.';
        }

        return {
            headline,

            healthStatus:
                health.status,

            boardPerformanceScore:
                round(
                    kpis.boardPerformanceScore * 100,
                    2
                ),

            criticalRiskCount:
                criticalRisks,

            highRiskCount:
                highRisks,

            keyMessage:
                this._buildKeyMessage(
                    kpis,
                    health
                ),

            managementFocus:
                recommendations
                    .slice(0, 5)
                    .map(
                        item => item.title
                    ),

            positiveHighlights:
                highlights
                    .filter(
                        item =>
                            item.type === 'positive'
                    )
                    .slice(0, 5)
                    .map(
                        item =>
                            item.title
                    ),

            boardAttentionRequired:
                criticalRisks > 0 ||
                highRisks > 0
        };
    }

    _buildKeyMessage(kpis, health) {

        if (
            health.status ===
            HEALTH_STATUS.CRITICAL
        ) {
            return (
                `Board performance is ${round(
                    kpis.boardPerformanceScore * 100,
                    2
                )}%, with material financial, operational or risk indicators requiring intervention.`
            );
        }

        if (
            health.status ===
            HEALTH_STATUS.WARNING
        ) {
            return (
                `Board performance is ${round(
                    kpis.boardPerformanceScore * 100,
                    2
                )}%, with several indicators requiring management attention.`
            );
        }

        return (
            `Board performance is ${round(
                kpis.boardPerformanceScore * 100,
                2
            )}%, indicating healthy overall financial and operational control.`
        );
    }

    /**
     * =========================================================================
     * Data Quality
     * =========================================================================
     */

    _buildDataQualityAssessment(
        normalized,
        diagnostics
    ) {

        const issues = [
            ...diagnostics.dataQualityIssues
        ];

        for (const service of diagnostics.missingServices) {
            issues.push({
                code:
                    `SERVICE_NOT_AVAILABLE_${service}`,

                severity:
                    'info',

                message:
                    `Optional intelligence service "${service}" was not available.`
            });
        }

        for (const failure of diagnostics.failures) {
            issues.push({
                code:
                    `SERVICE_FAILURE_${failure.service}`,

                severity:
                    'warning',

                message:
                    `Intelligence service "${failure.service}" failed during report generation.`
            });
        }

        const score =
            clamp(
                1 -
                (
                    issues.filter(
                        issue =>
                            issue.severity === 'critical'
                    ).length * 0.20 +

                    issues.filter(
                        issue =>
                            issue.severity === 'warning'
                    ).length * 0.05 +

                    issues.filter(
                        issue =>
                            issue.severity === 'info'
                    ).length * 0.01
                )
            );

        let status;

        if (score >= 0.90) {
            status = HEALTH_STATUS.HEALTHY;
        } else if (score >= 0.75) {
            status = HEALTH_STATUS.WARNING;
        } else {
            status = HEALTH_STATUS.CRITICAL;
        }

        return {
            score:
                round(score, 4),

            percentage:
                round(score * 100, 2),

            status,

            issueCount:
                issues.length,

            criticalIssueCount:
                issues.filter(
                    issue =>
                        issue.severity === 'critical'
                ).length,

            warningIssueCount:
                issues.filter(
                    issue =>
                        issue.severity === 'warning'
                ).length,

            issues:
                issues.slice(
                    0,
                    this.options.maxDataQualityIssues
                )
        };
    }

    /**
     * =========================================================================
     * Scorecard Helpers
     * =========================================================================
     */

    _scorecardDimension(
        name,
        score,
        invert = false
    ) {

        const normalized =
            invert
                ? 1 - clamp(score)
                : clamp(score);

        return {
            name,
            score:
                round(normalized, 4),

            percentage:
                round(normalized * 100, 2),

            status:
                this._healthFromScore(normalized)
        };
    }

    /**
     * =========================================================================
     * Report Status
     * =========================================================================
     */

    _determineReportStatus(
        diagnostics,
        dataQuality
    ) {

        if (
            diagnostics.failures.length > 0 ||
            dataQuality.status === HEALTH_STATUS.CRITICAL
        ) {
            return REPORT_STATUS.PARTIAL;
        }

        return REPORT_STATUS.GENERATED;
    }

    /**
     * =========================================================================
     * Failure Report
     * =========================================================================
     */

    _buildFailureReport(
        reportId,
        context,
        diagnostics,
        error,
        startedAt
    ) {

        return {
            metadata: {
                reportId,
                service: this.serviceName,
                serviceVersion: this.version,
                generatedAt:
                    normalizeDate(this.clock.now()),
                tenantId:
                    context.tenantId,
                organizationId:
                    context.organizationId,
                reportingCurrency:
                    context.reportingCurrency,
                period:
                    clone(context.period),
                status:
                    REPORT_STATUS.FAILED,
                calculationVersion:
                    '1.0.0'
            },

            executiveSummary: {
                headline:
                    'Board report generation failed.',
                healthStatus:
                    HEALTH_STATUS.CRITICAL,
                boardAttentionRequired:
                    true
            },

            health: {
                status:
                    HEALTH_STATUS.CRITICAL,
                score:
                    0,
                percentage:
                    0
            },

            kpis: {
                financialIntegrityScore: 0,
                operationalEfficiencyScore: 0,
                settlementReliabilityScore: 0,
                fraudRiskScore: 1,
                forecastingConfidenceScore: 0,
                dataQualityScore: 0,
                boardPerformanceScore: 0,
                summary: {}
            },

            financialIntegrity: {
                statementQuality: {},
                reconciliation: {},
                repair: {}
            },

            settlementReliability: {},

            fraudAndRisk: {
                correlations: [],
                patterns: [],
                suspiciousRepairs: [],
                riskRegister: [
                    {
                        id: 'BOARD_REPORT_FAILURE',
                        level: RISK_LEVEL.CRITICAL,
                        priority: 1,
                        title:
                            'Board report generation failure',
                        description:
                            error && error.message
                                ? error.message
                                : 'Unknown report generation failure.',
                        mitigation:
                            'Investigate the reporting pipeline before relying on this report for executive decision-making.',
                        boardAttentionRequired:
                            true
                    }
                ]
            },

            operationalPerformance: {
                benchmark: {},
                branches: [],
                teams: [],
                capacity: {},
                workload: {}
            },

            forecasting: {
                repairForecast: {},
                predictiveSchedule: {}
            },

            highlights: [],

            recommendations: [
                {
                    id:
                        'REC-REPORT-FAILURE',

                    priority:
                        1,

                    category:
                        'reporting',

                    title:
                        'Investigate reporting failure',

                    action:
                        'Review reporting-service diagnostics and restore all required intelligence dependencies.',

                    rationale:
                        'The board report could not be generated successfully.',

                    expectedOutcome:
                        'Restore reliable executive reporting.'
                }
            ],

            dataQuality: {
                score: 0,
                percentage: 0,
                status:
                    HEALTH_STATUS.CRITICAL,
                issueCount:
                    diagnostics.dataQualityIssues.length,
                issues:
                    diagnostics.dataQualityIssues
            },

            diagnostics: {
                ...clone(diagnostics),

                failure: {
                    message:
                        error && error.message
                            ? error.message
                            : 'Unknown error'
                },

                generatedDurationMs:
                    Math.max(
                        0,
                        this.clock.now().getTime() -
                        startedAt.getTime()
                    )
            }
        };
    }

    /**
     * =========================================================================
     * Snapshot / Serialization Support
     * =========================================================================
     */

    createSnapshot(report) {

        if (!report || typeof report !== 'object') {
            throw new TypeError(
                'A valid board report is required.'
            );
        }

        const snapshot = clone(report);

        return {
            snapshotVersion: '1.0.0',

            snapshotId:
                `BRS-${crypto
                    .randomBytes(12)
                    .toString('hex')
                    .toUpperCase()}`,

            createdAt:
                normalizeDate(this.clock.now()),

            reportId:
                report.metadata?.reportId || null,

            tenantId:
                report.metadata?.tenantId || null,

            period:
                clone(report.metadata?.period || {}),

            reportHash:
                report.metadata?.reportHash ||
                hashObject(report),

            payload:
                snapshot
        };
    }

    /**
     * =========================================================================
     * Health / Readiness
     * =========================================================================
     */

    healthCheck() {

        const configuredServices =
            Object.entries(this.services)
                .filter(
                    ([, service]) => Boolean(service)
                )
                .map(
                    ([name]) => name
                );

        const missingServices =
            Object.entries(this.services)
                .filter(
                    ([, service]) => !service
                )
                .map(
                    ([name]) => name
                );

        return {
            service:
                this.serviceName,

            version:
                this.version,

            status:
                HEALTH_STATUS.HEALTHY,

            ready:
                true,

            dependencyMode:
                'optional-dependency-injection',

            configuredServices,

            missingServices,

            timestamp:
                normalizeDate(this.clock.now())
        };
    }

    /**
     * =========================================================================
     * Metrics
     * =========================================================================
     */

    getMetrics(report) {

        if (!report) {
            return {};
        }

        return {
            reportId:
                report.metadata?.reportId,

            tenantId:
                report.metadata?.tenantId,

            boardPerformanceScore:
                toNumber(
                    report.kpis?.boardPerformanceScore
                ),

            financialIntegrityScore:
                toNumber(
                    report.kpis?.financialIntegrityScore
                ),

            operationalEfficiencyScore:
                toNumber(
                    report.kpis?.operationalEfficiencyScore
                ),

            settlementReliabilityScore:
                toNumber(
                    report.kpis?.settlementReliabilityScore
                ),

            fraudRiskScore:
                toNumber(
                    report.kpis?.fraudRiskScore
                ),

            forecastingConfidenceScore:
                toNumber(
                    report.kpis?.forecastingConfidenceScore
                ),

            dataQualityScore:
                toNumber(
                    report.kpis?.dataQualityScore
                ),

            criticalRiskCount:
                toNumber(
                    report.fraudAndRisk
                        ?.riskRegister
                        ?.filter(
                            item =>
                                item.level ===
                                RISK_LEVEL.CRITICAL
                        )
                        ?.length
                ),

            highRiskCount:
                toNumber(
                    report.fraudAndRisk
                        ?.riskRegister
                        ?.filter(
                            item =>
                                item.level ===
                                RISK_LEVEL.HIGH
                        )
                        ?.length
                ),

            unresolvedRepairs:
                toNumber(
                    report.kpis?.summary
                        ?.unresolvedRepairs
                ),

            reconciliationRate:
                toNumber(
                    report.kpis?.summary
                        ?.reconciliationRate
                ),

            repairResolutionRate:
                toNumber(
                    report.kpis?.summary
                        ?.repairResolutionRate
                )
        };
    }
}

/**
 * ============================================================================
 * Static Constants
 * ============================================================================
 */

BoardReportingService.SERVICE_NAME = SERVICE_NAME;
BoardReportingService.SERVICE_VERSION = SERVICE_VERSION;

BoardReportingService.REPORT_STATUS =
    REPORT_STATUS;

BoardReportingService.HEALTH_STATUS =
    HEALTH_STATUS;

BoardReportingService.RISK_LEVEL =
    RISK_LEVEL;

BoardReportingService.TREND =
    TREND;

/**
 * ============================================================================
 * Factory
 * ============================================================================
 *
 * Allows the service to be instantiated consistently by dependency-injection
 * containers without requiring callers to know the constructor details.
 *
 * @param {Object} dependencies
 * @param {Object} options
 * @returns {BoardReportingService}
 */
function createBoardReportingService(
    dependencies = {},
    options = {}
) {
    return new BoardReportingService(
        dependencies,
        options
    );
}

/**
 * ============================================================================
 * Module Exports
 * ============================================================================
 */

module.exports = BoardReportingService;

module.exports.BoardReportingService =
    BoardReportingService;

module.exports.createBoardReportingService =
    createBoardReportingService;

module.exports.REPORT_STATUS =
    REPORT_STATUS;

module.exports.HEALTH_STATUS =
    HEALTH_STATUS;

module.exports.RISK_LEVEL =
    RISK_LEVEL;

module.exports.TREND =
    TREND;