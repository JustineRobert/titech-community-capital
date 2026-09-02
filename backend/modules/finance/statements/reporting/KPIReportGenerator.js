'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * KPI Report Generator
 * ============================================================================
 *
 * File:
 *   backend/modules/finance/statements/reporting/KPIReportGenerator.js
 *
 * Purpose:
 *   Generates production-grade KPI reports from the statement intelligence
 *   dashboard aggregation layer.
 *
 * Responsibilities:
 *   - KPI calculation
 *   - KPI normalization
 *   - KPI status evaluation
 *   - KPI direction evaluation
 *   - KPI deduplication
 *   - Report metadata generation
 *   - Report integrity metadata
 *   - Audit integration
 *   - Metrics integration
 *   - Structured logging
 *   - JSON export
 *   - CSV export
 *   - Recursive export sanitization
 *   - Failure-safe reporting
 *
 * Design:
 *   DashboardAggregator
 *          ↓
 *   KPIReportGenerator
 *          ↓
 *   Executive / Board / Regulatory Reporting
 *
 * ============================================================================
 */

const crypto = require('crypto');

const DashboardAggregator =
    require('./DashboardAggregator');

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const KPI_STATUS = Object.freeze({
    EXCELLENT: 'EXCELLENT',
    GOOD: 'GOOD',
    WARNING: 'WARNING',
    CRITICAL: 'CRITICAL',
    UNKNOWN: 'UNKNOWN'
});

const KPI_DIRECTION = Object.freeze({
    UP: 'UP',
    DOWN: 'DOWN',
    STABLE: 'STABLE',
    UNKNOWN: 'UNKNOWN'
});

const KPI_CATEGORY = Object.freeze({
    VOLUME: 'VOLUME',
    ACCURACY: 'ACCURACY',
    REPAIR: 'REPAIR',
    RISK: 'RISK',
    FRAUD: 'FRAUD',
    PERFORMANCE: 'PERFORMANCE',
    RELIABILITY: 'RELIABILITY',
    OPERATIONS: 'OPERATIONS',
    FINANCIAL: 'FINANCIAL',
    QUALITY: 'QUALITY'
});

const REPORT_STATUS = Object.freeze({
    COMPLETE: 'COMPLETE',
    PARTIAL: 'PARTIAL',
    FAILED: 'FAILED'
});

const REPORT_SCOPE = Object.freeze({
    TENANT: 'TENANT',
    BRANCH: 'BRANCH',
    TEAM: 'TEAM',
    PORTFOLIO: 'PORTFOLIO',
    GLOBAL: 'GLOBAL'
});

/**
 * ============================================================================
 * KPIReportGenerator
 * ============================================================================
 */

class KPIReportGenerator {

    /**
     * ------------------------------------------------------------------------
     * Constructor
     * ------------------------------------------------------------------------
     */

    constructor(options = {}) {

        this.options = {
            dashboardAggregator:
                options.dashboardAggregator ||
                options.aggregator ||
                null,

            logger:
                options.logger ||
                console,

            auditService:
                options.auditService ||
                null,

            metrics:
                options.metrics ||
                null,

            strict:
                options.strict !== false,

            ...options
        };

        this.dashboardAggregator =
            this.options.dashboardAggregator ||
            new DashboardAggregator(
                options.dashboardOptions || {}
            );

    }

    /**
     * =========================================================================
     * Public API
     * =========================================================================
     */

    async generate(context = {}) {

        const executionContext =
            this._buildExecutionContext(
                context
            );

        const startedAt =
            Date.now();

        const reportId =
            this._generateReportId(
                executionContext
            );

        try {

            this._recordMetric(
                'kpi_report_generation_started',
                1,
                executionContext
            );

            const dashboard =
                await this._generateDashboard(
                    executionContext
                );

            const kpis =
                this._buildKPIs(
                    dashboard,
                    executionContext
                );

            const normalizedKPIs =
                this._normalizeKPIs(
                    kpis
                );

            const deduplicatedKPIs =
                this._deduplicateKPIs(
                    normalizedKPIs
                );

            const report =
                this._buildReport(
                    {
                        reportId,
                        dashboard,
                        kpis:
                            deduplicatedKPIs,
                        executionContext,
                        startedAt
                    }
                );

            const sanitizedReport =
                this._sanitizeObject(
                    report
                );

            await this._recordAuditEvent(
                'KPI_REPORT_GENERATED',
                sanitizedReport,
                executionContext
            );

            this._recordMetric(
                'kpi_report_generation_completed',
                1,
                executionContext
            );

            return sanitizedReport;

        } catch (error) {

            this._logError(
                'KPI report generation failed.',
                error,
                executionContext
            );

            this._recordMetric(
                'kpi_report_generation_failed',
                1,
                executionContext
            );

            if (
                this.options.strict
            ) {
                throw error;
            }

            return this._buildFailureResponse(
                {
                    reportId,
                    executionContext,
                    startedAt,
                    error
                }
            );
        }
    }

    /**
     * =========================================================================
     * Dashboard Generation
     * =========================================================================
     */

    async _generateDashboard(
        context
    ) {

        if (
            !this.dashboardAggregator
        ) {
            throw new Error(
                'DashboardAggregator is not configured.'
            );
        }

        if (
            typeof this.dashboardAggregator.aggregate ===
            'function'
        ) {

            return this.dashboardAggregator.aggregate(
                context
            );

        }

        if (
            typeof this.dashboardAggregator.generate ===
            'function'
        ) {

            return this.dashboardAggregator.generate(
                context
            );

        }

        if (
            typeof this.dashboardAggregator.build ===
            'function'
        ) {

            return this.dashboardAggregator.build(
                context
            );

        }

        throw new TypeError(
            'DashboardAggregator must expose aggregate(), generate(), or build().'
        );
    }

    /**
     * =========================================================================
     * KPI Construction
     * =========================================================================
     */

    _buildKPIs(
        dashboard,
        context
    ) {

        const source =
            dashboard || {};

        const kpis = [];

        /**
         * ---------------------------------------------------------------------
         * Statement Volume
         * ---------------------------------------------------------------------
         */

        this._pushKPI(
            kpis,
            {
                code: 'STATEMENT_VOLUME',
                name: 'Statement Volume',
                category: KPI_CATEGORY.VOLUME,
                value:
                    this._numeric(
                        source.statementVolume ??
                        source.totalStatements ??
                        source.statementsProcessed
                    ),
                unit: 'statements',
                target:
                    this._numeric(
                        source.statementVolumeTarget
                    ),
                direction:
                    KPI_DIRECTION.UP,
                source: 'DashboardAggregator'
            }
        );

        /**
         * ---------------------------------------------------------------------
         * Statement Accuracy
         * ---------------------------------------------------------------------
         */

        this._pushKPI(
            kpis,
            {
                code: 'STATEMENT_ACCURACY',
                name: 'Statement Accuracy',
                category: KPI_CATEGORY.ACCURACY,
                value:
                    this._percentage(
                        source.statementAccuracy ??
                        source.accuracyRate
                    ),
                unit: '%',
                target:
                    this._percentage(
                        source.statementAccuracyTarget
                    ),
                direction:
                    KPI_DIRECTION.UP,
                source: 'DashboardAggregator'
            }
        );

        /**
         * ---------------------------------------------------------------------
         * Repair Success Rate
         * ---------------------------------------------------------------------
         */

        this._pushKPI(
            kpis,
            {
                code: 'REPAIR_SUCCESS_RATE',
                name: 'Repair Success Rate',
                category: KPI_CATEGORY.REPAIR,
                value:
                    this._percentage(
                        source.repairSuccessRate ??
                        source.successRate
                    ),
                unit: '%',
                target:
                    this._percentage(
                        source.repairSuccessRateTarget
                    ),
                direction:
                    KPI_DIRECTION.UP,
                source: 'DashboardAggregator'
            }
        );

        /**
         * ---------------------------------------------------------------------
         * Repair Backlog
         * ---------------------------------------------------------------------
         */

        this._pushKPI(
            kpis,
            {
                code: 'REPAIR_BACKLOG',
                name: 'Repair Backlog',
                category: KPI_CATEGORY.REPAIR,
                value:
                    this._numeric(
                        source.repairBacklog ??
                        source.pendingRepairs
                    ),
                unit: 'repairs',
                target:
                    this._numeric(
                        source.repairBacklogTarget
                    ),
                direction:
                    KPI_DIRECTION.DOWN,
                source: 'DashboardAggregator'
            }
        );

        /**
         * ---------------------------------------------------------------------
         * Fraud Risk Score
         * ---------------------------------------------------------------------
         */

        this._pushKPI(
            kpis,
            {
                code: 'FRAUD_RISK_SCORE',
                name: 'Fraud Risk Score',
                category: KPI_CATEGORY.FRAUD,
                value:
                    this._numeric(
                        source.fraudRiskScore ??
                        source.riskScore
                    ),
                unit: 'score',
                target:
                    this._numeric(
                        source.fraudRiskTarget
                    ),
                direction:
                    KPI_DIRECTION.DOWN,
                source: 'DashboardAggregator'
            }
        );

        /**
         * ---------------------------------------------------------------------
         * Operational Reliability
         * ---------------------------------------------------------------------
         */

        this._pushKPI(
            kpis,
            {
                code: 'OPERATIONAL_RELIABILITY',
                name: 'Operational Reliability',
                category: KPI_CATEGORY.RELIABILITY,
                value:
                    this._percentage(
                        source.operationalReliability ??
                        source.reliability
                    ),
                unit: '%',
                target:
                    this._percentage(
                        source.operationalReliabilityTarget
                    ),
                direction:
                    KPI_DIRECTION.UP,
                source: 'DashboardAggregator'
            }
        );

        /**
         * ---------------------------------------------------------------------
         * Processing Performance
         * ---------------------------------------------------------------------
         */

        this._pushKPI(
            kpis,
            {
                code: 'PROCESSING_PERFORMANCE',
                name: 'Processing Performance',
                category: KPI_CATEGORY.PERFORMANCE,
                value:
                    this._percentage(
                        source.processingPerformance ??
                        source.performanceScore
                    ),
                unit: '%',
                target:
                    this._percentage(
                        source.processingPerformanceTarget
                    ),
                direction:
                    KPI_DIRECTION.UP,
                source: 'DashboardAggregator'
            }
        );

        /**
         * ---------------------------------------------------------------------
         * Settlement Reliability
         * ---------------------------------------------------------------------
         */

        this._pushKPI(
            kpis,
            {
                code: 'SETTLEMENT_RELIABILITY',
                name: 'Settlement Reliability',
                category: KPI_CATEGORY.RELIABILITY,
                value:
                    this._percentage(
                        source.settlementReliability
                    ),
                unit: '%',
                target:
                    this._percentage(
                        source.settlementReliabilityTarget
                    ),
                direction:
                    KPI_DIRECTION.UP,
                source: 'DashboardAggregator'
            }
        );

        /**
         * ---------------------------------------------------------------------
         * Overall Health
         * ---------------------------------------------------------------------
         */

        this._pushKPI(
            kpis,
            {
                code: 'OVERALL_HEALTH',
                name: 'Overall Financial Intelligence Health',
                category: KPI_CATEGORY.QUALITY,
                value:
                    this._percentage(
                        source.healthScore ??
                        source.overallHealth ??
                        source.overallScore
                    ),
                unit: '%',
                target: 90,
                direction:
                    KPI_DIRECTION.UP,
                source: 'DashboardAggregator'
            }
        );

        /**
         * ---------------------------------------------------------------------
         * Preserve Aggregator KPIs
         * ---------------------------------------------------------------------
         *
         * If DashboardAggregator already provides an array of KPIs, preserve
         * those KPIs as well.
         */

        if (
            Array.isArray(
                source.kpis
            )
        ) {

            for (
                const kpi of source.kpis
            ) {

                if (
                    kpi &&
                    typeof kpi === 'object'
                ) {
                    kpis.push(
                        kpi
                    );
                }
            }
        }

        return kpis;
    }

    /**
     * =========================================================================
     * KPI Push Helper
     * =========================================================================
     */

    _pushKPI(
        collection,
        kpi
    ) {

        if (
            !kpi ||
            !kpi.code
        ) {
            return;
        }

        const value =
            kpi.value;

        const status =
            this._calculateStatus(
                value,
                kpi.target,
                kpi.direction
            );

        collection.push({

            code:
                kpi.code,

            name:
                kpi.name ||
                kpi.code,

            category:
                kpi.category ||
                KPI_CATEGORY.QUALITY,

            value,

            unit:
                kpi.unit ||
                'number',

            target:
                kpi.target,

            status,

            direction:
                kpi.direction ||
                KPI_DIRECTION.UNKNOWN,

            source:
                kpi.source ||
                'DashboardAggregator',

            generatedAt:
                new Date()

        });
    }

    /**
     * =========================================================================
     * KPI Normalization
     * =========================================================================
     */

    _normalizeKPIs(
        kpis
    ) {

        if (
            !Array.isArray(kpis)
        ) {
            return [];
        }

        return kpis
            .filter(
                (kpi) =>
                    kpi &&
                    typeof kpi === 'object' &&
                    typeof kpi.code === 'string'
            )
            .map(
                (kpi) => {

                    const value =
                        this._numericOrNull(
                            kpi.value
                        );

                    const target =
                        this._numericOrNull(
                            kpi.target
                        );

                    const direction =
                        this._normalizeDirection(
                            kpi.direction
                        );

                    return {

                        code:
                            kpi.code.trim(),

                        name:
                            kpi.name ||
                            kpi.code,

                        category:
                            kpi.category ||
                            KPI_CATEGORY.QUALITY,

                        value,

                        unit:
                            kpi.unit ||
                            'number',

                        target,

                        status:
                            kpi.status ||
                            this._calculateStatus(
                                value,
                                target,
                                direction
                            ),

                        direction,

                        source:
                            kpi.source ||
                            'DashboardAggregator',

                        generatedAt:
                            kpi.generatedAt ||
                            new Date()

                    };
                }
            );
    }

    /**
     * =========================================================================
     * KPI Deduplication
     * =========================================================================
     */

    _deduplicateKPIs(
        kpis
    ) {

        const map =
            new Map();

        for (
            const kpi of
            Array.isArray(kpis)
                ? kpis
                : []
        ) {

            if (
                !kpi ||
                !kpi.code
            ) {
                continue;
            }

            const existing =
                map.get(
                    kpi.code
                );

            /**
             * Prefer an explicitly populated value over a null value.
             */
            if (
                !existing ||
                (
                    existing.value === null &&
                    kpi.value !== null
                )
            ) {
                map.set(
                    kpi.code,
                    kpi
                );
            }
        }

        return Array.from(
            map.values()
        );
    }

    /**
     * =========================================================================
     * Status Calculation
     * =========================================================================
     */

    _calculateStatus(
        value,
        target,
        direction
    ) {

        if (
            value === null ||
            value === undefined ||
            Number.isNaN(
                Number(value)
            )
        ) {
            return KPI_STATUS.UNKNOWN;
        }

        if (
            target === null ||
            target === undefined ||
            Number.isNaN(
                Number(target)
            )
        ) {
            return KPI_STATUS.UNKNOWN;
        }

        const numericValue =
            Number(value);

        const numericTarget =
            Number(target);

        if (
            numericTarget === 0
        ) {

            if (
                numericValue === 0
            ) {
                return KPI_STATUS.EXCELLENT;
            }

            return direction === KPI_DIRECTION.DOWN
                ? KPI_STATUS.CRITICAL
                : KPI_STATUS.WARNING;
        }

        let ratio;

        if (
            direction === KPI_DIRECTION.DOWN
        ) {

            ratio =
                numericTarget /
                Math.max(
                    numericValue,
                    Number.EPSILON
                );

        } else {

            ratio =
                numericValue /
                numericTarget;
        }

        if (
            ratio >= 1.1
        ) {
            return KPI_STATUS.EXCELLENT;
        }

        if (
            ratio >= 1.0
        ) {
            return KPI_STATUS.GOOD;
        }

        if (
            ratio >= 0.8
        ) {
            return KPI_STATUS.WARNING;
        }

        return KPI_STATUS.CRITICAL;
    }

    /**
     * =========================================================================
     * Direction Normalization
     * =========================================================================
     */

    _normalizeDirection(
        direction
    ) {

        if (
            !direction
        ) {
            return KPI_DIRECTION.UNKNOWN;
        }

        const normalized =
            String(
                direction
            )
                .trim()
                .toUpperCase();

        if (
            Object.values(
                KPI_DIRECTION
            ).includes(
                normalized
            )
        ) {
            return normalized;
        }

        return KPI_DIRECTION.UNKNOWN;
    }

    /**
     * =========================================================================
     * Report Builder
     * =========================================================================
     */

    _buildReport({
        reportId,
        dashboard,
        kpis,
        executionContext,
        startedAt
    }) {

        const completedAt =
            new Date();

        const status =
            this._calculateReportStatus(
                kpis
            );

        const summary =
            this._buildSummary(
                kpis
            );

        const report = {

            reportId,

            reportType:
                'KPI_REPORT',

            status,

            scope:
                executionContext.scope,

            tenantId:
                executionContext.tenantId,

            branchId:
                executionContext.branchId,

            generatedAt:
                completedAt,

            durationMs:
                Date.now() -
                startedAt,

            period:
                executionContext.period,

            filters:
                executionContext.filters,

            kpis,

            summary,

            dashboard,

            metadata: {

                generator:
                    'KPIReportGenerator',

                version:
                    '1.0.0',

                generatedBy:
                    executionContext.actorId ||
                    'system',

                correlationId:
                    executionContext.correlationId,

                requestId:
                    executionContext.requestId

            }

        };

        report.integrity =
            this._calculateIntegrityHash(
                report
            );

        return report;
    }

    /**
     * =========================================================================
     * Report Summary
     * =========================================================================
     */

    _buildSummary(
        kpis
    ) {

        const safeKPIs =
            Array.isArray(kpis)
                ? kpis
                : [];

        const total =
            safeKPIs.length;

        const excellent =
            safeKPIs.filter(
                (kpi) =>
                    kpi.status ===
                    KPI_STATUS.EXCELLENT
            ).length;

        const good =
            safeKPIs.filter(
                (kpi) =>
                    kpi.status ===
                    KPI_STATUS.GOOD
            ).length;

        const warning =
            safeKPIs.filter(
                (kpi) =>
                    kpi.status ===
                    KPI_STATUS.WARNING
            ).length;

        const critical =
            safeKPIs.filter(
                (kpi) =>
                    kpi.status ===
                    KPI_STATUS.CRITICAL
            ).length;

        const unknown =
            safeKPIs.filter(
                (kpi) =>
                    kpi.status ===
                    KPI_STATUS.UNKNOWN
            ).length;

        const healthScore =
            total === 0
                ? null
                :
                (
                    (
                        excellent * 100 +
                        good * 80 +
                        warning * 60 +
                        critical * 20
                    ) /
                    total
                );

        return {

            totalKPIs:
                total,

            excellent,
            good,
            warning,
            critical,
            unknown,

            healthScore:

                healthScore === null
                    ? null
                    : Number(
                        healthScore.toFixed(
                            2
                        )
                    ),

            overallStatus:
                this._calculateOverallStatus(
                    critical,
                    warning,
                    total
                )

        };
    }

    /**
     * =========================================================================
     * Overall Report Status
     * =========================================================================
     */

    _calculateReportStatus(
        kpis
    ) {

        if (
            !Array.isArray(kpis) ||
            kpis.length === 0
        ) {
            return REPORT_STATUS.PARTIAL;
        }

        const unknownCount =
            kpis.filter(
                (kpi) =>
                    kpi.status ===
                    KPI_STATUS.UNKNOWN
            ).length;

        if (
            unknownCount === kpis.length
        ) {
            return REPORT_STATUS.PARTIAL;
        }

        if (
            unknownCount > 0
        ) {
            return REPORT_STATUS.PARTIAL;
        }

        return REPORT_STATUS.COMPLETE;
    }

    /**
     * =========================================================================
     * Overall KPI Status
     * =========================================================================
     */

    _calculateOverallStatus(
        critical,
        warning,
        total
    ) {

        if (
            total <= 0
        ) {
            return KPI_STATUS.UNKNOWN;
        }

        if (
            critical > 0
        ) {
            return KPI_STATUS.CRITICAL;
        }

        if (
            warning > 0
        ) {
            return KPI_STATUS.WARNING;
        }

        return KPI_STATUS.GOOD;
    }

    /**
     * =========================================================================
     * Execution Context
     * =========================================================================
     */

    _buildExecutionContext(
        context = {}
    ) {

        return {

            tenantId:
                context.tenantId ||
                null,

            branchId:
                context.branchId ||
                null,

            teamId:
                context.teamId ||
                null,

            actorId:
                context.actorId ||
                context.userId ||
                null,

            correlationId:
                context.correlationId ||
                this._generateCorrelationId(),

            requestId:
                context.requestId ||
                null,

            scope:
                context.scope ||
                REPORT_SCOPE.TENANT,

            period:
                context.period ||
                null,

            filters:
                context.filters ||
                {},

            metadata:
                context.metadata ||
                {},

            generatedAt:
                new Date()

        };
    }

    /**
     * =========================================================================
     * ID Generation
     * =========================================================================
     */

    _generateReportId(
        context
    ) {

        const prefix =
            'KPI';

        const tenant =
            context.tenantId ||
            'GLOBAL';

        const timestamp =
            Date.now().toString(
                36
            );

        const random =
            crypto
                .randomBytes(
                    8
                )
                .toString(
                    'hex'
                );

        return [
            prefix,
            tenant,
            timestamp,
            random
        ].join('-');
    }

    /**
     * =========================================================================
     * Correlation ID
     * =========================================================================
     */

    _generateCorrelationId() {

        return crypto
            .randomUUID();
    }

    /**
     * =========================================================================
     * Integrity Hash
     * =========================================================================
     */

    _calculateIntegrityHash(
        report
    ) {

        const payload =
            JSON.stringify(
                this._sanitizeObject(
                    {
                        ...report,
                        integrity: undefined
                    }
                )
            );

        return crypto
            .createHash(
                'sha256'
            )
            .update(
                payload,
                'utf8'
            )
            .digest(
                'hex'
            );
    }

    /**
     * =========================================================================
     * Audit
     * =========================================================================
     */

    async _recordAuditEvent(
        event,
        payload,
        context
    ) {

        if (
            !this.options.auditService
        ) {
            return;
        }

        try {

            if (
                typeof this.options.auditService.record ===
                'function'
            ) {

                await this.options.auditService.record(
                    {
                        event,
                        payload,
                        context
                    }
                );

                return;
            }

            if (
                typeof this.options.auditService.log ===
                'function'
            ) {

                await this.options.auditService.log(
                    event,
                    payload,
                    context
                );

                return;
            }

        } catch (error) {

            this._logError(
                'Failed to record KPI report audit event.',
                error,
                context
            );

            if (
                this.options.strict
            ) {
                throw error;
            }
        }
    }

    /**
     * =========================================================================
     * Metrics
     * =========================================================================
     */

    _recordMetric(
        name,
        value,
        context
    ) {

        if (
            !this.options.metrics
        ) {
            return;
        }

        try {

            if (
                typeof this.options.metrics.increment ===
                'function'
            ) {

                this.options.metrics.increment(
                    name,
                    value,
                    {
                        tenantId:
                            context &&
                            context.tenantId
                    }
                );

                return;
            }

            if (
                typeof this.options.metrics.inc ===
                'function'
            ) {

                this.options.metrics.inc(
                    name,
                    value
                );

                return;
            }

            if (
                typeof this.options.metrics.record ===
                'function'
            ) {

                this.options.metrics.record(
                    name,
                    value,
                    context
                );
            }

        } catch (error) {

            this._logError(
                'Failed to record KPI report metric.',
                error,
                context
            );
        }
    }

    /**
     * =========================================================================
     * Logging
     * =========================================================================
     */

    _logError(
        message,
        error,
        context
    ) {

        const logger =
            this.options.logger;

        const payload = {

            message,

            error:
                error &&
                error.message,

            stack:
                error &&
                error.stack,

            code:
                error &&
                error.code,

            tenantId:
                context &&
                context.tenantId,

            correlationId:
                context &&
                context.correlationId,

            requestId:
                context &&
                context.requestId

        };

        if (
            logger &&
            typeof logger.error ===
            'function'
        ) {

            logger.error(
                message,
                payload
            );
        }
    }

    /**
     * =========================================================================
     * Failure Response
     * =========================================================================
     */

    _buildFailureResponse({
        reportId,
        executionContext,
        startedAt,
        error
    }) {

        return {

            reportId,

            reportType:
                'KPI_REPORT',

            status:
                REPORT_STATUS.FAILED,

            scope:
                executionContext.scope,

            tenantId:
                executionContext.tenantId,

            generatedAt:
                new Date(),

            durationMs:
                Date.now() -
                startedAt,

            kpis: [],

            summary: {

                totalKPIs: 0,

                excellent: 0,

                good: 0,

                warning: 0,

                critical: 0,

                unknown: 0,

                healthScore: null,

                overallStatus:
                    KPI_STATUS.UNKNOWN

            },

            error: {

                code:
                    error &&
                    error.code
                        ? error.code
                        : 'KPI_REPORT_GENERATION_FAILED',

                message:
                    error &&
                    error.message
                        ? error.message
                        : 'KPI report generation failed.'

            },

            metadata: {

                generator:
                    'KPIReportGenerator',

                version:
                    '1.0.0',

                correlationId:
                    executionContext.correlationId,

                requestId:
                    executionContext.requestId

            }

        };
    }

    /**
     * =========================================================================
     * Numeric Helpers
     * =========================================================================
     */

    _numeric(
        value
    ) {

        const numeric =
            this._numericOrNull(
                value
            );

        return numeric === null
            ? 0
            : numeric;
    }

    _numericOrNull(
        value
    ) {

        if (
            value === null ||
            value === undefined ||
            value === ''
        ) {
            return null;
        }

        const numeric =
            Number(
                value
            );

        if (
            Number.isNaN(
                numeric
            ) ||
            !Number.isFinite(
                numeric
            )
        ) {
            return null;
        }

        return numeric;
    }

    _percentage(
        value
    ) {

        const numeric =
            this._numericOrNull(
                value
            );

        if (
            numeric === null
        ) {
            return null;
        }

        /**
         * Normalize decimal percentages:
         *
         * 0.95 → 95
         * 95   → 95
         */
        if (
            numeric >= 0 &&
            numeric <= 1
        ) {
            return Number(
                (
                    numeric * 100
                ).toFixed(
                    2
                )
            );
        }

        return Number(
            numeric.toFixed(
                2
            )
        );
    }

    /**
     * =========================================================================
     * Export — JSON
     * =========================================================================
     */

    toJSON(
        report
    ) {

        return JSON.stringify(
            this._sanitizeObject(
                report
            ),
            null,
            2
        );
    }

    /**
     * =========================================================================
     * Export — CSV
     * =========================================================================
     */

    toCSV(
        report
    ) {

        const rows = [

            [
                'KPI Code',
                'KPI Name',
                'Category',
                'Value',
                'Unit',
                'Target',
                'Status',
                'Direction',
                'Source'
            ]

        ];

        const kpis =
            report &&
            Array.isArray(
                report.kpis
            )
                ? report.kpis
                : [];

        for (
            const kpi of kpis
        ) {

            rows.push([

                kpi.code,

                kpi.name,

                kpi.category,

                kpi.value,

                kpi.unit,

                kpi.target,

                kpi.status,

                kpi.direction,

                kpi.source

            ].map(
                (value) =>
                    this._escapeCSV(
                        value
                    )
            ));
        }

        return rows
            .map(
                (row) =>
                    row.join(',')
            )
            .join('\n');
    }

    /**
     * =========================================================================
     * CSV Escaping
     * =========================================================================
     */

    _escapeCSV(
        value
    ) {

        if (
            value === null ||
            value === undefined
        ) {
            return '';
        }

        let stringValue;

        if (
            typeof value === 'object'
        ) {

            try {

                stringValue =
                    JSON.stringify(
                        value
                    );

            } catch (
                error
            ) {

                stringValue =
                    '[UNSERIALIZABLE]';
            }

        } else {

            stringValue =
                String(
                    value
                );
        }

        /**
         * CSV formula-injection protection.
         *
         * Values beginning with spreadsheet formula characters are prefixed
         * with a single quote.
         */

        if (
            /^[=+\-@]/.test(
                stringValue
            )
        ) {
            stringValue =
                `'${stringValue}`;
        }

        return `"${stringValue
            .replace(
                /"/g,
                '""'
            )}"`;
    }

    /**
     * =========================================================================
     * Recursive Export Sanitization
     * =========================================================================
     */

    _sanitizeObject(
        value,
        depth = 0,
        seen = new WeakSet()
    ) {

        if (
            depth > 20
        ) {

            return '[MAX_DEPTH_EXCEEDED]';
        }

        if (
            value === null ||
            value === undefined
        ) {

            return value;
        }

        if (
            typeof value !== 'object'
        ) {

            return value;
        }

        if (
            value instanceof Date
        ) {

            return value.toISOString();
        }

        if (
            Buffer.isBuffer(
                value
            )
        ) {

            return '[BUFFER_REDACTED]';
        }

        if (
            seen.has(
                value
            )
        ) {

            return '[CIRCULAR_REFERENCE]';
        }

        seen.add(
            value
        );

        if (
            Array.isArray(
                value
            )
        ) {

            const result =
                value.map(
                    (item) =>
                        this._sanitizeObject(
                            item,
                            depth + 1,
                            seen
                        )
                );

            seen.delete(
                value
            );

            return result;
        }

        const sensitiveFields =
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
                'cookie',
                'credentials',
                'signature',
                'webhookSecret',
                'clientSecret',
                'encryptionKey'

            ]);

        const internalFields =
            new Set([

                '__v'

            ]);

        const result = {};

        for (
            const [
                key,
                child
            ] of Object.entries(
                value
            )
        ) {

            if (
                sensitiveFields.has(
                    key
                )
            ) {
                continue;
            }

            if (
                internalFields.has(
                    key
                )
            ) {
                continue;
            }

            result[key] =
                this._sanitizeObject(
                    child,
                    depth + 1,
                    seen
                );
        }

        seen.delete(
            value
        );

        return result;
    }

    /**
     * =========================================================================
     * Backward-Compatible Sanitizer Alias
     * =========================================================================
     */

    _sanitizeExportValue(
        value,
        depth = 0
    ) {

        return this._sanitizeObject(
            value,
            depth,
            new WeakSet()
        );
    }
}

/**
 * ============================================================================
 * Public Exports
 * ============================================================================
 *
 * Export the class directly for backward compatibility:
 *
 *   const KPIReportGenerator = require('./KPIReportGenerator');
 *
 * Also expose named constants:
 *
 *   const {
 *       KPIReportGenerator,
 *       KPI_STATUS
 *   } = require('./KPIReportGenerator');
 *
 * ============================================================================
 */

module.exports =
    KPIReportGenerator;

module.exports.KPIReportGenerator =
    KPIReportGenerator;

module.exports.KPI_STATUS =
    KPI_STATUS;

module.exports.KPI_DIRECTION =
    KPI_DIRECTION;

module.exports.KPI_CATEGORY =
    KPI_CATEGORY;

module.exports.REPORT_STATUS =
    REPORT_STATUS;

module.exports.REPORT_SCOPE =
    REPORT_SCOPE;