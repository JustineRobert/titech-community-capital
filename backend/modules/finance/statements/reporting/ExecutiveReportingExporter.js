'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * ExecutiveReportingExporter
 * ============================================================================
 *
 * Enterprise Executive Reporting Exporter
 *
 * Location:
 *   backend/modules/finance/statements/reporting/ExecutiveReportingExporter.js
 *
 * Purpose:
 *   Converts governed financial-statement intelligence and dashboard
 *   aggregation results into executive reporting packages suitable for:
 *
 *     - Board reporting
 *     - Executive management reporting
 *     - Financial operations reviews
 *     - Risk committee reporting
 *     - Audit support
 *     - Regulatory preparation
 *     - Management packs
 *     - API consumers
 *     - JSON archival
 *     - CSV exports
 *     - HTML report generation
 *
 * Architectural position:
 *
 *   Ledger / Statements
 *          ↓
 *   Reconciliation
 *          ↓
 *   Repair / Fraud / Forecasting
 *          ↓
 *   DashboardAggregator
 *          ↓
 *   ExecutiveReportingExporter
 *          ↓
 *   Board / Executive / Audit / Operations Outputs
 *
 * IMPORTANT:
 *   This component is READ-ONLY.
 *
 * It must NEVER:
 *   - mutate ledger records
 *   - post journal entries
 *   - execute repairs
 *   - approve repairs
 *   - modify settlements
 *   - change reconciliation results
 *   - override fraud controls
 *   - execute AI recommendations
 *   - silently alter financial values
 *
 * All financial values should originate from authoritative services.
 *
 * ============================================================================
 */

const EXPORT_FORMAT = Object.freeze({
    JSON: 'json',
    CSV: 'csv',
    HTML: 'html',
    TEXT: 'text'
});

const REPORT_TYPE = Object.freeze({
    EXECUTIVE: 'executive',
    BOARD: 'board',
    RISK: 'risk',
    OPERATIONS: 'operations',
    FINANCIAL: 'financial',
    AUDIT: 'audit',
    FORECAST: 'forecast'
});

const REPORT_STATUS = Object.freeze({
    COMPLETE: 'COMPLETE',
    PARTIAL: 'PARTIAL',
    DEGRADED: 'DEGRADED',
    FAILED: 'FAILED'
});

const DEFAULT_CURRENCY = 'UGX';

const DEFAULT_LIMIT = 100;

const MAX_LIMIT = 1000;

const DEFAULT_DECIMAL_PLACES = 2;

const DEFAULT_TIMEZONE = 'UTC';

/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

function toNumber(value, fallback = 0) {
    if (
        value === null ||
        value === undefined ||
        value === ''
    ) {
        return fallback;
    }

    const numeric = Number(value);

    return Number.isFinite(numeric)
        ? numeric
        : fallback;
}

function clamp(
    value,
    minimum = 0,
    maximum = 100
) {
    return Math.min(
        maximum,
        Math.max(
            minimum,
            toNumber(value)
        )
    );
}

function percentage(
    numerator,
    denominator
) {
    const denominatorNumber =
        toNumber(denominator);

    if (denominatorNumber === 0) {
        return 0;
    }

    return Number(
        (
            (toNumber(numerator) /
                denominatorNumber) *
            100
        ).toFixed(4)
    );
}

function round(
    value,
    decimals = DEFAULT_DECIMAL_PLACES
) {
    const factor =
        Math.pow(10, decimals);

    return (
        Math.round(
            (toNumber(value) + Number.EPSILON) *
                factor
        ) / factor
    );
}

function average(values) {
    if (
        !Array.isArray(values) ||
        values.length === 0
    ) {
        return 0;
    }

    const numericValues =
        values
            .map((value) =>
                toNumber(value)
            )
            .filter((value) =>
                Number.isFinite(value)
            );

    if (
        numericValues.length === 0
    ) {
        return 0;
    }

    return round(
        numericValues.reduce(
            (sum, value) =>
                sum + value,
            0
        ) /
            numericValues.length,
        4
    );
}

function getPath(
    object,
    path,
    fallback = undefined
) {
    if (
        !object ||
        typeof path !== 'string'
    ) {
        return fallback;
    }

    const parts =
        path.split('.');

    let current = object;

    for (const part of parts) {
        if (
            current === null ||
            current === undefined ||
            typeof current !== 'object'
        ) {
            return fallback;
        }

        current =
            current[part];
    }

    return current === undefined
        ? fallback
        : current;
}

function asArray(value) {
    if (Array.isArray(value)) {
        return value;
    }

    if (
        value === null ||
        value === undefined
    ) {
        return [];
    }

    return [value];
}

function normalizeDate(
    value,
    fallback = null
) {
    if (!value) {
        return fallback;
    }

    const date =
        value instanceof Date
            ? value
            : new Date(value);

    return Number.isNaN(
        date.getTime()
    )
        ? fallback
        : date;
}

function escapeCsv(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return '';
    }

    let normalized;

    if (
        typeof value === 'object'
    ) {
        normalized =
            JSON.stringify(value);
    } else {
        normalized =
            String(value);
    }

    return `"${normalized.replace(
        /"/g,
        '""'
    )}"`;
}

function escapeHtml(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return '';
    }

    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function generateCorrelationId() {
    return (
        `exec-report-${Date.now()}-` +
        Math.random()
            .toString(36)
            .slice(2, 10)
    );
}

function normalizeFormat(
    format
) {
    const normalized =
        String(
            format ||
                EXPORT_FORMAT.JSON
        ).toLowerCase();

    return Object.values(
        EXPORT_FORMAT
    ).includes(normalized)
        ? normalized
        : EXPORT_FORMAT.JSON;
}

function normalizeReportType(
    type
) {
    const normalized =
        String(
            type ||
                REPORT_TYPE.EXECUTIVE
        ).toLowerCase();

    return Object.values(
        REPORT_TYPE
    ).includes(normalized)
        ? normalized
        : REPORT_TYPE.EXECUTIVE;
}

/**
 * ============================================================================
 * ExecutiveReportingExporter
 * ============================================================================
 */

class ExecutiveReportingExporter {
    /**
     * @param {Object} dependencies
     * @param {Object} dependencies.logger
     * @param {Object} dependencies.dashboardAggregator
     * @param {Object} dependencies.statementService
     * @param {Object} dependencies.reportRepository
     * @param {Object} dependencies.auditLogger
     * @param {Object} dependencies.storageService
     * @param {Object} dependencies.templateService
     * @param {Object} dependencies.metricsService
     */
    constructor(
        dependencies = {}
    ) {
        this.logger =
            dependencies.logger ||
            null;

        this.dashboardAggregator =
            dependencies.dashboardAggregator ||
            null;

        this.statementService =
            dependencies.statementService ||
            null;

        this.reportRepository =
            dependencies.reportRepository ||
            null;

        this.auditLogger =
            dependencies.auditLogger ||
            null;

        this.storageService =
            dependencies.storageService ||
            null;

        this.templateService =
            dependencies.templateService ||
            null;

        this.metricsService =
            dependencies.metricsService ||
            null;

        this.version =
            '1.0.0';

        this.defaultCurrency =
            dependencies.defaultCurrency ||
            DEFAULT_CURRENCY;

        this.defaultTimezone =
            dependencies.defaultTimezone ||
            DEFAULT_TIMEZONE;

        this.maxRows =
            Math.min(
                MAX_LIMIT,
                Math.max(
                    1,
                    toNumber(
                        dependencies.maxRows,
                        DEFAULT_LIMIT
                    )
                )
            );
    }

    /**
     * =========================================================================
     * Public API
     * =========================================================================
     */

    /**
     * Generate an executive reporting package.
     *
     * @param {Object} context
     * @returns {Promise<Object>}
     */
    async generate(
        context = {}
    ) {
        const execution =
            this._buildExecutionContext(
                context
            );

        const startedAt =
            Date.now();

        try {
            const dashboard =
                await this._loadDashboard(
                    execution
                );

            const report =
                this._buildReport(
                    dashboard,
                    execution
                );

            const finalized =
                this._finalizeReport(
                    report,
                    execution,
                    startedAt
                );

            await this._recordAuditEvent(
                'EXECUTIVE_REPORT_GENERATED',
                finalized,
                execution
            );

            this._recordMetric(
                'executive_report_generated',
                execution,
                finalized
            );

            return finalized;
        } catch (error) {
            this._logError(
                error,
                'Executive report generation failed',
                execution
            );

            return this._buildFailureResponse(
                error,
                execution,
                startedAt
            );
        }
    }

    /**
     * Export a report in the requested format.
     *
     * @param {Object} context
     * @returns {Promise<Object>}
     */
    async export(
        context = {}
    ) {
        const format =
            normalizeFormat(
                context.format
            );

        const report =
            await this.generate(
                context
            );

        if (
            report.status ===
            REPORT_STATUS.FAILED
        ) {
            return report;
        }

        const startedAt =
            Date.now();

        try {
            const exported =
                await this._render(
                    report,
                    format,
                    context
                );

            const result = {
                success: true,

                status:
                    report.status,

                reportId:
                    report.reportId,

                tenantId:
                    report.tenantId,

                reportType:
                    report.reportType,

                format,

                mimeType:
                    this._getMimeType(
                        format
                    ),

                filename:
                    this._buildFilename(
                        report,
                        format
                    ),

                content:
                    exported.content,

                encoding:
                    'utf-8',

                generatedAt:
                    new Date().toISOString(),

                diagnostics: {
                    durationMs:
                        Date.now() -
                        startedAt,

                    correlationId:
                        report.metadata
                            .correlationId
                }
            };

            await this._recordAuditEvent(
                'EXECUTIVE_REPORT_EXPORTED',
                result,
                context
            );

            this._recordMetric(
                'executive_report_exported',
                context,
                result
            );

            return result;
        } catch (error) {
            this._logError(
                error,
                'Executive report export failed',
                context
            );

            return {
                success: false,

                status:
                    REPORT_STATUS.FAILED,

                reportId:
                    report.reportId,

                tenantId:
                    report.tenantId,

                format,

                error: {
                    code:
                        error.code ||
                        'REPORT_EXPORT_FAILED',

                    message:
                        error.message ||
                        'Executive report export failed'
                }
            };
        }
    }

    /**
     * Generate and persist an executive report.
     *
     * @param {Object} context
     * @returns {Promise<Object>}
     */
    async generateAndPersist(
        context = {}
    ) {
        const report =
            await this.generate(
                context
            );

        if (
            report.status ===
            REPORT_STATUS.FAILED
        ) {
            return report;
        }

        if (
            !this.reportRepository ||
            typeof this.reportRepository.save !==
                'function'
        ) {
            return {
                ...report,

                persistence: {
                    persisted: false,

                    reason:
                        'REPORT_REPOSITORY_UNAVAILABLE'
                }
            };
        }

        try {
            const persisted =
                await this.reportRepository.save(
                    this._buildPersistenceRecord(
                        report
                    )
                );

            return {
                ...report,

                persistence: {
                    persisted: true,

                    id:
                        persisted &&
                        (
                            persisted.id ||
                            persisted._id
                        )
                }
            };
        } catch (error) {
            this._logError(
                error,
                'Executive report persistence failed',
                context
            );

            return {
                ...report,

                persistence: {
                    persisted: false,

                    reason:
                        'REPORT_PERSISTENCE_FAILED',

                    error:
                        error.message
                }
            };
        }
    }

    /**
     * Generate board report.
     *
     * @param {Object} context
     * @returns {Promise<Object>}
     */
    async generateBoardReport(
        context = {}
    ) {
        return this.generate({
            ...context,

            reportType:
                REPORT_TYPE.BOARD
        });
    }

    /**
     * Generate executive management report.
     *
     * @param {Object} context
     * @returns {Promise<Object>}
     */
    async generateExecutiveReport(
        context = {}
    ) {
        return this.generate({
            ...context,

            reportType:
                REPORT_TYPE.EXECUTIVE
        });
    }

    /**
     * Generate risk report.
     *
     * @param {Object} context
     * @returns {Promise<Object>}
     */
    async generateRiskReport(
        context = {}
    ) {
        return this.generate({
            ...context,

            reportType:
                REPORT_TYPE.RISK
        });
    }

    /**
     * Generate operational report.
     *
     * @param {Object} context
     * @returns {Promise<Object>}
     */
    async generateOperationsReport(
        context = {}
    ) {
        return this.generate({
            ...context,

            reportType:
                REPORT_TYPE.OPERATIONS
        });
    }

    /**
     * Generate financial report.
     *
     * @param {Object} context
     * @returns {Promise<Object>}
     */
    async generateFinancialReport(
        context = {}
    ) {
        return this.generate({
            ...context,

            reportType:
                REPORT_TYPE.FINANCIAL
        });
    }

    /**
     * Generate audit report.
     *
     * @param {Object} context
     * @returns {Promise<Object>}
     */
    async generateAuditReport(
        context = {}
    ) {
        return this.generate({
            ...context,

            reportType:
                REPORT_TYPE.AUDIT
        });
    }

    /**
     * Generate forecasting report.
     *
     * @param {Object} context
     * @returns {Promise<Object>}
     */
    async generateForecastReport(
        context = {}
    ) {
        return this.generate({
            ...context,

            reportType:
                REPORT_TYPE.FORECAST
        });
    }

    /**
     * Return exporter health.
     *
     * @returns {Object}
     */
    health() {
        return {
            service:
                'ExecutiveReportingExporter',

            version:
                this.version,

            status:
                'HEALTHY',

            capabilities: {
                dashboardAggregation:
                    Boolean(
                        this.dashboardAggregator
                    ),

                persistence:
                    Boolean(
                        this.reportRepository
                    ),

                auditLogging:
                    Boolean(
                        this.auditLogger
                    ),

                storage:
                    Boolean(
                        this.storageService
                    ),

                templates:
                    Boolean(
                        this.templateService
                    ),

                metrics:
                    Boolean(
                        this.metricsService
                    )
            },

            formats:
                Object.values(
                    EXPORT_FORMAT
                ),

            reportTypes:
                Object.values(
                    REPORT_TYPE
                )
        };
    }

    /**
     * =========================================================================
     * Dashboard Loading
     * =========================================================================
     */

    async _loadDashboard(
        execution
    ) {
        if (
            this.dashboardAggregator &&
            typeof this.dashboardAggregator.aggregate ===
                'function'
        ) {
            return this.dashboardAggregator.aggregate(
                {
                    ...execution.context,

                    tenantId:
                        execution.tenantId,

                    from:
                        execution.period.from,

                    to:
                        execution.period.to,

                    options: {
                        ...(execution.context.options || {}),

                        mode:
                            this._dashboardModeForReport(
                                execution.reportType
                            ),

                        forceRefresh:
                            Boolean(
                                execution.context
                                    .forceRefresh
                            )
                    }
                }
            );
        }

        if (
            this.dashboardAggregator &&
            typeof this.dashboardAggregator.getDashboard ===
                'function'
        ) {
            return this.dashboardAggregator.getDashboard(
                {
                    ...execution.context,

                    tenantId:
                        execution.tenantId,

                    from:
                        execution.period.from,

                    to:
                        execution.period.to
                }
            );
        }

        throw new Error(
            'DashboardAggregator is required for executive reporting'
        );
    }

    _dashboardModeForReport(
        reportType
    ) {
        switch (reportType) {
            case REPORT_TYPE.BOARD:
            case REPORT_TYPE.EXECUTIVE:
                return 'executive';

            case REPORT_TYPE.RISK:
            case REPORT_TYPE.AUDIT:
                return 'risk';

            case REPORT_TYPE.OPERATIONS:
                return 'operations';

            case REPORT_TYPE.FORECAST:
                return 'forecasting';

            case REPORT_TYPE.FINANCIAL:
            default:
                return 'full';
        }
    }

    /**
     * =========================================================================
     * Report Construction
     * =========================================================================
     */

    _buildReport(
        dashboard,
        execution
    ) {
        const report =
            this._createReportEnvelope(
                execution
            );

        report.executive =
            this._buildExecutiveSection(
                dashboard
            );

        report.financial =
            this._buildFinancialSection(
                dashboard
            );

        report.reconciliation =
            this._buildReconciliationSection(
                dashboard
            );

        report.repairs =
            this._buildRepairSection(
                dashboard
            );

        report.settlements =
            this._buildSettlementSection(
                dashboard
            );

        report.risk =
            this._buildRiskSection(
                dashboard
            );

        report.forecasts =
            this._buildForecastSection(
                dashboard
            );

        report.operations =
            this._buildOperationsSection(
                dashboard
            );

        report.ai =
            this._buildAISection(
                dashboard
            );

        report.governance =
            this._buildGovernanceSection(
                dashboard
            );

        report.dataQuality =
            this._buildDataQualitySection(
                dashboard
            );

        report.keyIndicators =
            this._buildKeyIndicators(
                report
            );

        report.managementActions =
            this._buildManagementActions(
                report
            );

        report.boardHighlights =
            this._buildBoardHighlights(
                report
            );

        report.exceptions =
            this._buildExceptions(
                report
            );

        return report;
    }

    _createReportEnvelope(
        execution
    ) {
        return {
            reportId:
                this._generateReportId(
                    execution
                ),

            reportType:
                execution.reportType,

            reportTitle:
                this._getReportTitle(
                    execution.reportType
                ),

            status:
                REPORT_STATUS.COMPLETE,

            tenantId:
                execution.tenantId,

            period: {
                from:
                    execution.period.from
                        .toISOString(),

                to:
                    execution.period.to
                        .toISOString(),

                days:
                    execution.period.days
            },

            organization:
                this._sanitizeObject(
                    execution.context
                        .organization || {}
                ),

            currency:
                execution.context.currency ||
                this.defaultCurrency,

            timezone:
                execution.context.timezone ||
                this.defaultTimezone,

            executive: {},

            financial: {},

            reconciliation: {},

            repairs: {},

            settlements: {},

            risk: {},

            forecasts: {},

            operations: {},

            ai: {},

            governance: {},

            dataQuality: {},

            keyIndicators: [],

            managementActions: [],

            boardHighlights: [],

            exceptions: [],

            metadata: {
                exporterVersion:
                    this.version,

                generatedAt:
                    new Date()
                        .toISOString(),

                correlationId:
                    execution.correlationId,

                readOnly:
                    true,

                source:
                    'DashboardAggregator'
            }
        };
    }

    /**
     * =========================================================================
     * Executive Section
     * =========================================================================
     */

    _buildExecutiveSection(
        dashboard
    ) {
        const executive =
            dashboard.executive || {};

        return {
            overallHealthScore:
                round(
                    clamp(
                        executive.overallHealthScore
                    ),
                    2
                ),

            reconciliation:
                this._sanitizeObject(
                    executive.reconciliation ||
                    {}
                ),

            repairs:
                this._sanitizeObject(
                    executive.repairs ||
                    {}
                ),

            settlements:
                this._sanitizeObject(
                    executive.settlements ||
                    {}
                ),

            risk:
                this._sanitizeObject(
                    executive.risk ||
                    {}
                ),

            forecasting:
                this._sanitizeObject(
                    executive.forecasting ||
                    {}
                )
        };
    }

    /**
     * =========================================================================
     * Financial Section
     * =========================================================================
     */

    _buildFinancialSection(
        dashboard
    ) {
        const statements =
            dashboard.statements || {};

        const metrics =
            statements.metrics || {};

        return {
            statementCount:
                toNumber(
                    metrics.statements
                ),

            transactionCount:
                toNumber(
                    metrics.transactions
                ),

            processedCount:
                toNumber(
                    metrics.processed
                ),

            failedCount:
                toNumber(
                    metrics.failed
                ),

            processingSuccessRate:
                round(
                    metrics.processingSuccessRate
                ),

            currency:
                dashboard.currency ||
                this.defaultCurrency,

            financialAuthority:
                'AUTHORITATIVE_LEDGER_AND_STATEMENT_SERVICES'
        };
    }

    /**
     * =========================================================================
     * Reconciliation Section
     * =========================================================================
     */

    _buildReconciliationSection(
        dashboard
    ) {
        const metrics =
            getPath(
                dashboard,
                'reconciliation.metrics',
                {}
            );

        const total =
            toNumber(
                metrics.total
            );

        return {
            matched:
                toNumber(
                    metrics.matched
                ),

            unmatched:
                toNumber(
                    metrics.unmatched
                ),

            variances:
                toNumber(
                    metrics.variances
                ),

            total,

            matchRate:
                round(
                    metrics.matchRate
                ),

            exceptionRate:
                round(
                    metrics.exceptionRate
                ),

            status:
                dashboard.reconciliation &&
                dashboard.reconciliation.status
        };
    }

    /**
     * =========================================================================
     * Repair Section
     * =========================================================================
     */

    _buildRepairSection(
        dashboard
    ) {
        const metrics =
            getPath(
                dashboard,
                'repairs.metrics',
                {}
            );

        return {
            total:
                toNumber(
                    metrics.repairs
                ),

            repaired:
                toNumber(
                    metrics.repaired
                ),

            pending:
                toNumber(
                    metrics.pending
                ),

            failed:
                toNumber(
                    metrics.failed
                ),

            highRisk:
                toNumber(
                    metrics.highRisk
                ),

            successRate:
                round(
                    metrics.repairSuccessRate
                ),

            failureRate:
                round(
                    metrics.failureRate
                ),

            pendingRate:
                round(
                    metrics.pendingRate
                ),

            status:
                dashboard.repairs &&
                dashboard.repairs.status
        };
    }

    /**
     * =========================================================================
     * Settlement Section
     * =========================================================================
     */

    _buildSettlementSection(
        dashboard
    ) {
        const metrics =
            getPath(
                dashboard,
                'settlements.metrics',
                {}
            );

        return {
            settlementCount:
                toNumber(
                    metrics.settlementCount
                ),

            successful:
                toNumber(
                    metrics.successful
                ),

            failed:
                toNumber(
                    metrics.failed
                ),

            reliability:
                round(
                    metrics.reliability
                ),

            successRate:
                round(
                    metrics.successRate
                ),

            failureRate:
                round(
                    metrics.failureRate
                ),

            status:
                dashboard.settlements &&
                dashboard.settlements.status
        };
    }

    /**
     * =========================================================================
     * Risk Section
     * =========================================================================
     */

    _buildRiskSection(
        dashboard
    ) {
        const fraud =
            dashboard.fraud || {};

        const metrics =
            fraud.metrics || {};

        return {
            riskScore:
                round(
                    clamp(
                        metrics.riskScore
                    ),
                    2
                ),

            activeAlerts:
                toNumber(
                    metrics.activeAlerts
                ),

            criticalAlerts:
                toNumber(
                    metrics.criticalAlerts
                ),

            patternsDetected:
                toNumber(
                    metrics.patternsDetected
                ),

            suspiciousRepairs:
                toNumber(
                    metrics.suspiciousRepairs
                ),

            alerts:
                this._sanitizeArray(
                    fraud.alerts
                ),

            patterns:
                this._sanitizeArray(
                    fraud.patterns
                ),

            status:
                fraud.status
        };
    }

    /**
     * =========================================================================
     * Forecast Section
     * =========================================================================
     */

    _buildForecastSection(
        dashboard
    ) {
        const forecasts =
            dashboard.forecasts || {};

        const metrics =
            forecasts.metrics || {};

        return {
            forecastRepairVolume:
                toNumber(
                    metrics.forecastRepairVolume
                ),

            forecastCount:
                toNumber(
                    metrics.forecastCount
                ),

            confidence:
                round(
                    clamp(
                        metrics.confidence
                    ),
                    2
                ),

            forecasts:
                this._sanitizeArray(
                    forecasts.forecasts
                ),

            status:
                forecasts.status
        };
    }

    /**
     * =========================================================================
     * Operations Section
     * =========================================================================
     */

    _buildOperationsSection(
        dashboard
    ) {
        const operations =
            dashboard.operations || {};

        return {
            branches:
                this._buildOperationalSubsection(
                    operations.branches
                ),

            teams:
                this._buildOperationalSubsection(
                    operations.teams
                ),

            benchmarks:
                this._buildOperationalSubsection(
                    operations.benchmarks
                ),

            capacity:
                this._buildOperationalSubsection(
                    operations.capacity
                ),

            workload:
                this._buildOperationalSubsection(
                    operations.workload
                ),

            status:
                operations.status
        };
    }

    _buildOperationalSubsection(
        section = {}
    ) {
        return {
            metrics:
                this._sanitizeObject(
                    section.metrics || {}
                ),

            items:
                this._sanitizeArray(
                    section.items
                ),

            data:
                this._sanitizeObject(
                    section.data || {}
                )
        };
    }

    /**
     * =========================================================================
     * AI Section
     * =========================================================================
     */

    _buildAISection(
        dashboard
    ) {
        const ai =
            dashboard.ai || {};

        const governance =
            ai.governance || {};

        return {
            advisoryOnly:
                governance.advisoryOnly !== false,

            executionAuthority:
                governance.executionAuthority ||
                'EXTERNAL_APPROVED_WORKFLOW',

            financialMutationAllowed:
                governance.financialMutationAllowed === true,

            recommendationCount:
                toNumber(
                    getPath(
                        ai,
                        'metrics.recommendationCount'
                    )
                ),

            confidenceScore:
                round(
                    clamp(
                        getPath(
                            ai,
                            'metrics.confidenceScore',
                            0
                        )
                    ),
                    2
                ),

            recommendations:
                this._sanitizeArray(
                    ai.recommendations
                ),

            confidence:
                this._sanitizeObject(
                    ai.confidence || {}
                ),

            governance: {
                advisoryOnly:
                    true,

                executionAuthority:
                    'EXTERNAL_APPROVED_WORKFLOW',

                financialMutationAllowed:
                    false
            },

            status:
                ai.status
        };
    }

    /**
     * =========================================================================
     * Governance Section
     * =========================================================================
     */

    _buildGovernanceSection(
        dashboard
    ) {
        const governance =
            dashboard.governance || {};

        return {
            financialMutationAllowed:
                false,

            aiExecutionAllowed:
                false,

            approvalRequiredForRepair:
                governance.approvalRequiredForRepair !== false,

            authorityBoundaries:
                this._sanitizeObject(
                    governance.authorityBoundaries ||
                    {}
                ),

            advisorySystems:
                asArray(
                    governance.advisorySystems
                ),

            auditReady:
                true
        };
    }

    /**
     * =========================================================================
     * Data Quality
     * =========================================================================
     */

    _buildDataQualitySection(
        dashboard
    ) {
        const quality =
            dashboard.dataQuality || {};

        return {
            status:
                quality.status,

            completeness:
                round(
                    quality.completeness
                ),

            totalSubsystems:
                toNumber(
                    quality.totalSubsystems
                ),

            availableSubsystems:
                toNumber(
                    quality.availableSubsystems
                ),

            partialSubsystems:
                toNumber(
                    quality.partialSubsystems
                ),

            unavailableSubsystems:
                toNumber(
                    quality.unavailableSubsystems
                ),

            limitations:
                this._buildDataLimitations(
                    dashboard
                )
        };
    }

    _buildDataLimitations(
        dashboard
    ) {
        const limitations = [];

        const sections = [
            'statements',
            'reconciliation',
            'repairs',
            'forecasts',
            'settlements',
            'fraud',
            'operations',
            'ai',
            'health'
        ];

        for (const section of sections) {
            const status =
                getPath(
                    dashboard,
                    `${section}.status`
                );

            if (
                status ===
                'UNAVAILABLE'
            ) {
                limitations.push(
                    `${section} data unavailable`
                );
            } else if (
                status ===
                'PARTIAL'
            ) {
                limitations.push(
                    `${section} data partially available`
                );
            }
        }

        return limitations;
    }

    /**
     * =========================================================================
     * Key Indicators
     * =========================================================================
     */

    _buildKeyIndicators(
        report
    ) {
        return [
            {
                code:
                    'OVERALL_HEALTH',

                label:
                    'Overall Financial Operations Health',

                value:
                    report.executive
                        .overallHealthScore,

                unit:
                    'score',

                direction:
                    this._scoreDirection(
                        report.executive
                            .overallHealthScore
                    )
            },

            {
                code:
                    'RECONCILIATION_MATCH_RATE',

                label:
                    'Reconciliation Match Rate',

                value:
                    report.reconciliation
                        .matchRate,

                unit:
                    '%',

                direction:
                    this._rateDirection(
                        report.reconciliation
                            .matchRate
                    )
            },

            {
                code:
                    'REPAIR_SUCCESS_RATE',

                label:
                    'Repair Success Rate',

                value:
                    report.repairs
                        .successRate,

                unit:
                    '%',

                direction:
                    this._rateDirection(
                        report.repairs
                            .successRate
                    )
            },

            {
                code:
                    'SETTLEMENT_RELIABILITY',

                label:
                    'Settlement Reliability',

                value:
                    report.settlements
                        .reliability,

                unit:
                    '%',

                direction:
                    this._rateDirection(
                        report.settlements
                            .reliability
                    )
            },

            {
                code:
                    'RISK_SCORE',

                label:
                    'Financial Intelligence Risk Score',

                value:
                    report.risk
                        .riskScore,

                unit:
                    'score',

                direction:
                    this._riskDirection(
                        report.risk
                            .riskScore
                    )
            },

            {
                code:
                    'FORECAST_CONFIDENCE',

                label:
                    'Repair Forecast Confidence',

                value:
                    report.forecasts
                        .confidence,

                unit:
                    '%',

                direction:
                    this._rateDirection(
                        report.forecasts
                            .confidence
                    )
            }
        ];
    }

    _scoreDirection(
        score
    ) {
        if (
            score >= 80
        ) {
            return 'POSITIVE';
        }

        if (
            score >= 60
        ) {
            return 'WATCH';
        }

        return 'NEGATIVE';
    }

    _rateDirection(
        rate
    ) {
        return this._scoreDirection(
            rate
        );
    }

    _riskDirection(
        riskScore
    ) {
        if (
            riskScore >= 80
        ) {
            return 'CRITICAL';
        }

        if (
            riskScore >= 60
        ) {
            return 'HIGH';
        }

        if (
            riskScore >= 30
        ) {
            return 'WATCH';
        }

        return 'LOW';
    }

    /**
     * =========================================================================
     * Management Actions
     * =========================================================================
     */

    _buildManagementActions(
        report
    ) {
        const actions = [];

        if (
            report.reconciliation
                .unmatched > 0
        ) {
            actions.push({
                priority:
                    'HIGH',

                category:
                    'RECONCILIATION',

                action:
                    'Review unresolved reconciliation exceptions before financial close.',

                source:
                    'RECONCILIATION_ENGINE',

                executionAllowed:
                    false
            });
        }

        if (
            report.reconciliation
                .variances > 0
        ) {
            actions.push({
                priority:
                    'HIGH',

                category:
                    'FINANCIAL_CONTROL',

                action:
                    'Investigate unresolved financial variances and obtain required approvals.',

                source:
                    'RECONCILIATION_ENGINE',

                executionAllowed:
                    false
            });
        }

        if (
            report.repairs.pending > 0
        ) {
            actions.push({
                priority:
                    'MEDIUM',

                category:
                    'REPAIR_OPERATIONS',

                action:
                    'Review pending statement repair cases and prioritize approved remediation.',

                source:
                    'REPAIR_ANALYTICS',

                executionAllowed:
                    false
            });
        }

        if (
            report.risk.criticalAlerts > 0
        ) {
            actions.push({
                priority:
                    'CRITICAL',

                category:
                    'FRAUD_RISK',

                action:
                    'Escalate critical fraud intelligence alerts through the approved risk workflow.',

                source:
                    'FRAUD_INTELLIGENCE',

                executionAllowed:
                    false
            });
        }

        if (
            report.settlements.failed > 0
        ) {
            actions.push({
                priority:
                    'HIGH',

                category:
                    'SETTLEMENTS',

                action:
                    'Investigate failed settlement transactions and associated provider exceptions.',

                source:
                    'SETTLEMENT_RELIABILITY',

                executionAllowed:
                    false
            });
        }

        if (
            report.forecasts.confidence < 60
        ) {
            actions.push({
                priority:
                    'MEDIUM',

                category:
                    'FORECASTING',

                action:
                    'Treat repair forecasts cautiously until additional validated observations improve confidence.',

                source:
                    'REPAIR_FORECASTING',

                executionAllowed:
                    false
            });
        }

        return actions;
    }

    /**
     * =========================================================================
     * Board Highlights
     * =========================================================================
     */

    _buildBoardHighlights(
        report
    ) {
        const highlights = [];

        highlights.push({
            category:
                'FINANCIAL_HEALTH',

            statement:
                `Overall financial operations health score is ${report.executive.overallHealthScore}.`,

            metric:
                report.executive
                    .overallHealthScore
        });

        highlights.push({
            category:
                'RECONCILIATION',

            statement:
                `${report.reconciliation.matchRate}% of reconciliation activity is matched within the reporting period.`,

            metric:
                report.reconciliation
                    .matchRate
        });

        highlights.push({
            category:
                'REPAIRS',

            statement:
                `${report.repairs.pending} repair cases remain pending.`,

            metric:
                report.repairs
                    .pending
        });

        highlights.push({
            category:
                'SETTLEMENTS',

            statement:
                `Settlement reliability is ${report.settlements.reliability}%.`,

            metric:
                report.settlements
                    .reliability
        });

        highlights.push({
            category:
                'RISK',

            statement:
                `${report.risk.activeAlerts} active risk alerts are currently represented in the intelligence layer.`,

            metric:
                report.risk
                    .activeAlerts
        });

        return highlights;
    }

    /**
     * =========================================================================
     * Exceptions
     * =========================================================================
     */

    _buildExceptions(
        report
    ) {
        const exceptions = [];

        if (
            report.reconciliation
                .unmatched > 0
        ) {
            exceptions.push({
                category:
                    'RECONCILIATION',

                severity:
                    'HIGH',

                count:
                    report.reconciliation
                        .unmatched,

                description:
                    'Unmatched financial transactions require investigation.'
            });
        }

        if (
            report.reconciliation
                .variances > 0
        ) {
            exceptions.push({
                category:
                    'VARIANCE',

                severity:
                    'HIGH',

                count:
                    report.reconciliation
                        .variances,

                description:
                    'Financial variances require investigation and controlled resolution.'
            });
        }

        if (
            report.repairs.failed > 0
        ) {
            exceptions.push({
                category:
                    'REPAIR',

                severity:
                    'HIGH',

                count:
                    report.repairs
                        .failed,

                description:
                    'Repair workflows contain failed cases requiring operational review.'
            });
        }

        if (
            report.risk.criticalAlerts > 0
        ) {
            exceptions.push({
                category:
                    'FRAUD',

                severity:
                    'CRITICAL',

                count:
                    report.risk
                        .criticalAlerts,

                description:
                    'Critical fraud intelligence alerts require escalation.'
            });
        }

        if (
            report.settlements.failed > 0
        ) {
            exceptions.push({
                category:
                    'SETTLEMENT',

                severity:
                    'HIGH',

                count:
                    report.settlements
                        .failed,

                description:
                    'Failed settlements require investigation.'
            });
        }

        return exceptions;
    }

    /**
     * =========================================================================
     * Finalization
     * =========================================================================
     */

    _finalizeReport(
        report,
        execution,
        startedAt
    ) {
        const status =
            this._calculateReportStatus(
                report
            );

        return {
            ...report,

            status,

            metadata: {
                ...report.metadata,

                generatedAt:
                    new Date()
                        .toISOString(),

                durationMs:
                    Date.now() -
                    startedAt,

                correlationId:
                    execution.correlationId,

                reportStatus:
                    status,

                schemaVersion:
                    '1.0.0',

                readOnly:
                    true
            }
        };
    }

    _calculateReportStatus(
        report
    ) {
        const qualityStatus =
            getPath(
                report,
                'dataQuality.status'
            );

        if (
            qualityStatus ===
            'UNAVAILABLE'
        ) {
            return REPORT_STATUS.DEGRADED;
        }

        if (
            qualityStatus ===
            'PARTIAL'
        ) {
            return REPORT_STATUS.PARTIAL;
        }

        const dashboardStatus =
            getPath(
                report,
                'executive.overallHealthScore',
                100
            );

        if (
            toNumber(
                dashboardStatus
            ) < 30
        ) {
            return REPORT_STATUS.DEGRADED;
        }

        return REPORT_STATUS.COMPLETE;
    }

    /**
     * =========================================================================
     * Export Rendering
     * =========================================================================
     */

    async _render(
        report,
        format,
        context
    ) {
        switch (format) {
            case EXPORT_FORMAT.CSV:
                return {
                    content:
                        this._renderCsv(
                            report
                        )
                };

            case EXPORT_FORMAT.HTML:
                return {
                    content:
                        this._renderHtml(
                            report
                        )
                };

            case EXPORT_FORMAT.TEXT:
                return {
                    content:
                        this._renderText(
                            report
                        )
                };

            case EXPORT_FORMAT.JSON:
            default:
                return {
                    content:
                        JSON.stringify(
                            report,
                            null,
                            2
                        )
                };
        }
    }

    /**
     * =========================================================================
     * CSV
     * =========================================================================
     */

    _renderCsv(
        report
    ) {
        const rows = [];

        rows.push([
            'Section',
            'Metric',
            'Value',
            'Unit',
            'Status'
        ]);

        this._appendCsvMetric(
            rows,
            'Executive',
            'Overall Health Score',
            report.executive
                .overallHealthScore,
            'score',
            report.status
        );

        this._appendCsvMetric(
            rows,
            'Reconciliation',
            'Matched',
            report.reconciliation
                .matched,
            'count',
            report.reconciliation
                .status
        );

        this._appendCsvMetric(
            rows,
            'Reconciliation',
            'Unmatched',
            report.reconciliation
                .unmatched,
            'count',
            report.reconciliation
                .status
        );

        this._appendCsvMetric(
            rows,
            'Reconciliation',
            'Variances',
            report.reconciliation
                .variances,
            'count',
            report.reconciliation
                .status
        );

        this._appendCsvMetric(
            rows,
            'Reconciliation',
            'Match Rate',
            report.reconciliation
                .matchRate,
            '%',
            report.reconciliation
                .status
        );

        this._appendCsvMetric(
            rows,
            'Repairs',
            'Total Repairs',
            report.repairs.total,
            'count',
            report.repairs.status
        );

        this._appendCsvMetric(
            rows,
            'Repairs',
            'Pending Repairs',
            report.repairs.pending,
            'count',
            report.repairs.status
        );

        this._appendCsvMetric(
            rows,
            'Repairs',
            'Failed Repairs',
            report.repairs.failed,
            'count',
            report.repairs.status
        );

        this._appendCsvMetric(
            rows,
            'Repairs',
            'Repair Success Rate',
            report.repairs.successRate,
            '%',
            report.repairs.status
        );

        this._appendCsvMetric(
            rows,
            'Settlements',
            'Settlement Reliability',
            report.settlements.reliability,
            '%',
            report.settlements.status
        );

        this._appendCsvMetric(
            rows,
            'Settlements',
            'Successful Settlements',
            report.settlements.successful,
            'count',
            report.settlements.status
        );

        this._appendCsvMetric(
            rows,
            'Settlements',
            'Failed Settlements',
            report.settlements.failed,
            'count',
            report.settlements.status
        );

        this._appendCsvMetric(
            rows,
            'Risk',
            'Risk Score',
            report.risk.riskScore,
            'score',
            report.risk.status
        );

        this._appendCsvMetric(
            rows,
            'Risk',
            'Active Alerts',
            report.risk.activeAlerts,
            'count',
            report.risk.status
        );

        this._appendCsvMetric(
            rows,
            'Risk',
            'Critical Alerts',
            report.risk.criticalAlerts,
            'count',
            report.risk.status
        );

        this._appendCsvMetric(
            rows,
            'Forecasting',
            'Forecast Repair Volume',
            report.forecasts
                .forecastRepairVolume,
            'count',
            report.forecasts.status
        );

        this._appendCsvMetric(
            rows,
            'Forecasting',
            'Forecast Confidence',
            report.forecasts
                .confidence,
            '%',
            report.forecasts.status
        );

        return rows
            .map((row) =>
                row
                    .map((value) =>
                        escapeCsv(value)
                    )
                    .join(',')
            )
            .join('\n');
    }

    _appendCsvMetric(
        rows,
        section,
        metric,
        value,
        unit,
        status
    ) {
        rows.push([
            section,
            metric,
            value,
            unit,
            status || ''
        ]);
    }

    /**
     * =========================================================================
     * HTML
     * =========================================================================
     */

    _renderHtml(
        report
    ) {
        const highlights =
            report.boardHighlights
                .map(
                    (highlight) => `
                        <div class="highlight">
                            <div class="highlight-category">
                                ${escapeHtml(
                                    highlight.category
                                )}
                            </div>
                            <div class="highlight-statement">
                                ${escapeHtml(
                                    highlight.statement
                                )}
                            </div>
                            <div class="highlight-value">
                                ${escapeHtml(
                                    highlight.metric
                                )}
                            </div>
                        </div>
                    `
                )
                .join('');

        const indicators =
            report.keyIndicators
                .map(
                    (indicator) => `
                        <tr>
                            <td>
                                ${escapeHtml(
                                    indicator.label
                                )}
                            </td>
                            <td>
                                ${escapeHtml(
                                    indicator.value
                                )}
                            </td>
                            <td>
                                ${escapeHtml(
                                    indicator.unit
                                )}
                            </td>
                            <td>
                                ${escapeHtml(
                                    indicator.direction
                                )}
                            </td>
                        </tr>
                    `
                )
                .join('');

        const exceptions =
            report.exceptions
                .map(
                    (exception) => `
                        <tr>
                            <td>
                                ${escapeHtml(
                                    exception.category
                                )}
                            </td>
                            <td>
                                ${escapeHtml(
                                    exception.severity
                                )}
                            </td>
                            <td>
                                ${escapeHtml(
                                    exception.count
                                )}
                            </td>
                            <td>
                                ${escapeHtml(
                                    exception.description
                                )}
                            </td>
                        </tr>
                    `
                )
                .join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport"
      content="width=device-width, initial-scale=1">

<title>
    ${escapeHtml(
        report.reportTitle
    )}
</title>

<style>
    body {
        font-family:
            Arial,
            Helvetica,
            sans-serif;

        margin: 0;
        padding: 32px;

        background: #f5f7fa;
        color: #1f2937;
    }

    .report {
        max-width: 1200px;
        margin: 0 auto;
        background: #ffffff;
        padding: 32px;
    }

    h1,
    h2 {
        margin-top: 0;
    }

    .metadata {
        margin-bottom: 24px;
        font-size: 13px;
        color: #6b7280;
    }

    .highlights {
        display: grid;
        grid-template-columns:
            repeat(
                auto-fit,
                minmax(240px, 1fr)
            );

        gap: 16px;
        margin-bottom: 32px;
    }

    .highlight {
        border: 1px solid #e5e7eb;
        padding: 18px;
        border-radius: 8px;
    }

    .highlight-category {
        font-size: 12px;
        font-weight: bold;
        text-transform: uppercase;
        margin-bottom: 8px;
    }

    .highlight-statement {
        font-size: 14px;
        line-height: 1.5;
    }

    .highlight-value {
        font-size: 24px;
        font-weight: bold;
        margin-top: 12px;
    }

    table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 32px;
    }

    th,
    td {
        border: 1px solid #e5e7eb;
        padding: 10px;
        text-align: left;
        font-size: 13px;
    }

    th {
        font-weight: bold;
    }

    .governance {
        border: 1px solid #e5e7eb;
        padding: 16px;
        margin-top: 32px;
        font-size: 13px;
    }

    .footer {
        margin-top: 32px;
        padding-top: 16px;
        border-top: 1px solid #e5e7eb;
        font-size: 11px;
        color: #6b7280;
    }
</style>
</head>

<body>

<div class="report">

    <h1>
        ${escapeHtml(
            report.reportTitle
        )}
    </h1>

    <div class="metadata">
        <div>
            Report ID:
            ${escapeHtml(
                report.reportId
            )}
        </div>

        <div>
            Tenant:
            ${escapeHtml(
                report.tenantId
            )}
        </div>

        <div>
            Period:
            ${escapeHtml(
                report.period.from
            )}
            →
            ${escapeHtml(
                report.period.to
            )}
        </div>

        <div>
            Status:
            ${escapeHtml(
                report.status
            )}
        </div>
    </div>

    <h2>
        Board Highlights
    </h2>

    <div class="highlights">
        ${highlights}
    </div>

    <h2>
        Key Indicators
    </h2>

    <table>
        <thead>
            <tr>
                <th>Indicator</th>
                <th>Value</th>
                <th>Unit</th>
                <th>Direction</th>
            </tr>
        </thead>

        <tbody>
            ${indicators}
        </tbody>
    </table>

    <h2>
        Exceptions
    </h2>

    <table>
        <thead>
            <tr>
                <th>Category</th>
                <th>Severity</th>
                <th>Count</th>
                <th>Description</th>
            </tr>
        </thead>

        <tbody>
            ${
                exceptions ||
                `
                <tr>
                    <td colspan="4">
                        No material exceptions detected.
                    </td>
                </tr>
                `
            }
        </tbody>
    </table>

    <h2>
        Governance
    </h2>

    <div class="governance">
        <p>
            Financial mutation allowed:
            <strong>
                No
            </strong>
        </p>

        <p>
            AI execution allowed:
            <strong>
                No
            </strong>
        </p>

        <p>
            Repair approval required:
            <strong>
                Yes
            </strong>
        </p>

        <p>
            This report is a read-only
            management intelligence artifact.
            Authoritative financial balances
            remain governed by the financial
            ledger and controlled accounting
            workflows.
        </p>
    </div>

    <div class="footer">
        Generated by
        ExecutiveReportingExporter
        v${escapeHtml(
            this.version
        )}
        |
        Correlation ID:
        ${escapeHtml(
            report.metadata
                .correlationId
        )}
    </div>

</div>

</body>
</html>`;
    }

    /**
     * =========================================================================
     * Text
     * =========================================================================
     */

    _renderText(
        report
    ) {
        const lines = [];

        lines.push(
            report.reportTitle
        );

        lines.push(
            '='.repeat(
                report.reportTitle.length
            )
        );

        lines.push('');

        lines.push(
            `Report ID: ${report.reportId}`
        );

        lines.push(
            `Tenant: ${report.tenantId}`
        );

        lines.push(
            `Period: ${report.period.from} -> ${report.period.to}`
        );

        lines.push(
            `Status: ${report.status}`
        );

        lines.push('');

        lines.push(
            'EXECUTIVE SUMMARY'
        );

        lines.push(
            `Overall Health Score: ${report.executive.overallHealthScore}`
        );

        lines.push('');

        lines.push(
            'RECONCILIATION'
        );

        lines.push(
            `Matched: ${report.reconciliation.matched}`
        );

        lines.push(
            `Unmatched: ${report.reconciliation.unmatched}`
        );

        lines.push(
            `Variances: ${report.reconciliation.variances}`
        );

        lines.push(
            `Match Rate: ${report.reconciliation.matchRate}%`
        );

        lines.push('');

        lines.push(
            'REPAIRS'
        );

        lines.push(
            `Total: ${report.repairs.total}`
        );

        lines.push(
            `Repaired: ${report.repairs.repaired}`
        );

        lines.push(
            `Pending: ${report.repairs.pending}`
        );

        lines.push(
            `Failed: ${report.repairs.failed}`
        );

        lines.push(
            `Success Rate: ${report.repairs.successRate}%`
        );

        lines.push('');

        lines.push(
            'SETTLEMENTS'
        );

        lines.push(
            `Reliability: ${report.settlements.reliability}%`
        );

        lines.push(
            `Successful: ${report.settlements.successful}`
        );

        lines.push(
            `Failed: ${report.settlements.failed}`
        );

        lines.push('');

        lines.push(
            'RISK'
        );

        lines.push(
            `Risk Score: ${report.risk.riskScore}`
        );

        lines.push(
            `Active Alerts: ${report.risk.activeAlerts}`
        );

        lines.push(
            `Critical Alerts: ${report.risk.criticalAlerts}`
        );

        lines.push('');

        lines.push(
            'FORECASTING'
        );

        lines.push(
            `Forecast Repair Volume: ${report.forecasts.forecastRepairVolume}`
        );

        lines.push(
            `Forecast Confidence: ${report.forecasts.confidence}%`
        );

        lines.push('');

        lines.push(
            'MANAGEMENT ACTIONS'
        );

        if (
            report.managementActions.length ===
            0
        ) {
            lines.push(
                'No management actions generated.'
            );
        } else {
            report.managementActions
                .forEach(
                    (action, index) => {
                        lines.push(
                            `${index + 1}. [${action.priority}] ${action.action}`
                        );
                    }
                );
        }

        lines.push('');

        lines.push(
            'GOVERNANCE'
        );

        lines.push(
            'Financial mutation allowed: NO'
        );

        lines.push(
            'AI execution allowed: NO'
        );

        lines.push(
            'Repair approval required: YES'
        );

        lines.push('');

        lines.push(
            `Generated: ${report.metadata.generatedAt}`
        );

        lines.push(
            `Correlation ID: ${report.metadata.correlationId}`
        );

        return lines.join('\n');
    }

    /**
     * =========================================================================
     * Filename / MIME
     * =========================================================================
     */

    _getMimeType(
        format
    ) {
        switch (format) {
            case EXPORT_FORMAT.CSV:
                return 'text/csv';

            case EXPORT_FORMAT.HTML:
                return 'text/html';

            case EXPORT_FORMAT.TEXT:
                return 'text/plain';

            case EXPORT_FORMAT.JSON:
            default:
                return 'application/json';
        }
    }

    _buildFilename(
        report,
        format
    ) {
        const safeTenant =
            String(
                report.tenantId
            )
                .replace(
                    /[^a-zA-Z0-9_-]/g,
                    '_'
                );

        const safeType =
            String(
                report.reportType
            )
                .replace(
                    /[^a-zA-Z0-9_-]/g,
                    '_'
                );

        return [
            'executive-report',
            safeTenant,
            safeType,
            this._dateForFilename(
                report.period.to
            )
        ].join('_') +
            `.${format}`;
    }

    _dateForFilename(
        date
    ) {
        const normalized =
            normalizeDate(
                date,
                new Date()
            );

        return normalized
            .toISOString()
            .slice(0, 10);
    }

    /**
     * =========================================================================
     * Persistence
     * =========================================================================
     */

    _buildPersistenceRecord(
        report
    ) {
        return {
            reportId:
                report.reportId,

            tenantId:
                report.tenantId,

            reportType:
                report.reportType,

            reportTitle:
                report.reportTitle,

            status:
                report.status,

            period:
                report.period,

            currency:
                report.currency,

            timezone:
                report.timezone,

            executive:
                report.executive,

            financial:
                report.financial,

            reconciliation:
                report.reconciliation,

            repairs:
                report.repairs,

            settlements:
                report.settlements,

            risk:
                report.risk,

            forecasts:
                report.forecasts,

            operations:
                report.operations,

            ai:
                report.ai,

            governance:
                report.governance,

            dataQuality:
                report.dataQuality,

            keyIndicators:
                report.keyIndicators,

            managementActions:
                report.managementActions,

            boardHighlights:
                report.boardHighlights,

            exceptions:
                report.exceptions,

            metadata:
                report.metadata,

            createdAt:
                new Date()
        };
    }

    /**
     * =========================================================================
     * Audit / Metrics
     * =========================================================================
     */

    async _recordAuditEvent(
        event,
        payload,
        execution
    ) {
        if (
            !this.auditLogger
        ) {
            return;
        }

        try {
            if (
                typeof this.auditLogger.log ===
                'function'
            ) {
                await this.auditLogger.log({
                    event,

                    tenantId:
                        payload.tenantId ||
                        execution.tenantId,

                    reportId:
                        payload.reportId,

                    reportType:
                        payload.reportType,

                    correlationId:
                        getPath(
                            payload,
                            'metadata.correlationId',
                            getPath(
                                execution,
                                'correlationId'
                            )
                        ),

                    readOnly:
                        true
                });

                return;
            }

            if (
                typeof this.auditLogger.record ===
                'function'
            ) {
                await this.auditLogger.record({
                    event,

                    tenantId:
                        payload.tenantId ||
                        execution.tenantId,

                    reportId:
                        payload.reportId,

                    correlationId:
                        execution.correlationId,

                    readOnly:
                        true
                });
            }
        } catch (error) {
            this._logWarn(
                error,
                'Executive reporting audit logging failed'
            );
        }
    }

    _recordMetric(
        metricName,
        context,
        payload
    ) {
        if (
            !this.metricsService
        ) {
            return;
        }

        try {
            if (
                typeof this.metricsService.increment ===
                'function'
            ) {
                this.metricsService.increment(
                    metricName,
                    {
                        tenantId:
                            context.tenantId ||
                            getPath(
                                context,
                                'executionContext.tenantId'
                            ),

                        reportType:
                            payload.reportType,

                        status:
                            payload.status
                    }
                );
            }
        } catch (error) {
            this._logWarn(
                error,
                'Executive reporting metric recording failed'
            );
        }
    }

    /**
     * =========================================================================
     * Execution Context
     * =========================================================================
     */

    _buildExecutionContext(
        context = {}
    ) {
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
                'ExecutiveReportingExporter requires tenantId'
            );
        }

        const now =
            new Date();

        const to =
            normalizeDate(
                context.to ||
                context.endDate,
                now
            );

        let from =
            normalizeDate(
                context.from ||
                context.startDate,
                null
            );

        const requestedDays =
            Math.max(
                1,
                Math.min(
                    3650,
                    toNumber(
                        context.windowDays,
                        30
                    )
                )
            );

        if (!from) {
            from =
                new Date(
                    to.getTime()
                );

            from.setDate(
                from.getDate() -
                    requestedDays
            );
        }

        const days =
            Math.max(
                1,
                Math.ceil(
                    (
                        to.getTime() -
                        from.getTime()
                    ) /
                        (
                            24 *
                            60 *
                            60 *
                            1000
                        )
                )
            );

        return {
            context,

            tenantId,

            reportType:
                normalizeReportType(
                    context.reportType
                ),

            period: {
                from,

                to,

                days
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

    _generateReportId(
        execution
    ) {
        return [
            'RPT',
            execution.tenantId,
            execution.reportType
                .toUpperCase(),
            Date.now(),
            Math.random()
                .toString(36)
                .slice(2, 8)
        ].join('-');
    }

    _getReportTitle(
        reportType
    ) {
        switch (reportType) {
            case REPORT_TYPE.BOARD:
                return 'Board Financial Intelligence Report';

            case REPORT_TYPE.RISK:
                return 'Financial Risk & Fraud Intelligence Report';

            case REPORT_TYPE.OPERATIONS:
                return 'Financial Operations Performance Report';

            case REPORT_TYPE.FINANCIAL:
                return 'Financial Statement Intelligence Report';

            case REPORT_TYPE.AUDIT:
                return 'Financial Audit Intelligence Report';

            case REPORT_TYPE.FORECAST:
                return 'Financial Repair Forecasting Report';

            case REPORT_TYPE.EXECUTIVE:
            default:
                return 'Executive Financial Intelligence Report';
        }
    }

    /**
     * =========================================================================
     * Sanitization
     * =========================================================================
     */

    _sanitizeArray(
        value
    ) {
        return asArray(value)
            .slice(0, this.maxRows)
            .map((item) =>
                this._sanitizeObject(
                    item
                )
            );
    }

    _sanitizeObject(
        value
    ) {
        if (
            value === null ||
            value === undefined
        ) {
            return value;
        }

        if (
            Array.isArray(value)
        ) {
            return this._sanitizeArray(
                value
            );
        }

        if (
            typeof value !== 'object'
        ) {
            return value;
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
                'rawPayload',
                'signature'
            ]);

        const output = {};

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
                key.startsWith('__')
            ) {
                continue;
            }

            output[key] =
                child &&
                typeof child ===
                    'object'
                    ? this._sanitizeObject(
                        child
                    )
                    : child;
        }

        return output;
    }

    /**
     * =========================================================================
     * Failure / Logging
     * =========================================================================
     */

    _buildFailureResponse(
        error,
        execution,
        startedAt
    ) {
        return {
            success: false,

            status:
                REPORT_STATUS.FAILED,

            reportId:
                this._generateReportId(
                    execution
                ),

            reportType:
                execution.reportType,

            tenantId:
                execution.tenantId,

            period: {
                from:
                    execution.period.from
                        .toISOString(),

                to:
                    execution.period.to
                        .toISOString(),

                days:
                    execution.period.days
            },

            error: {
                code:
                    error.code ||
                    'EXECUTIVE_REPORT_GENERATION_FAILED',

                message:
                    error.message ||
                    'Executive report generation failed'
            },

            governance: {
                financialMutationAllowed:
                    false,

                aiExecutionAllowed:
                    false
            },

            metadata: {
                exporterVersion:
                    this.version,

                readOnly:
                    true,

                correlationId:
                    execution.correlationId,

                durationMs:
                    Date.now() -
                    startedAt,

                generatedAt:
                    new Date()
                        .toISOString()
            }
        };
    }

    _logError(
        error,
        message,
        context = {}
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
                        context.tenantId ||
                        getPath(
                            context,
                            'executionContext.tenantId'
                        ),

                    correlationId:
                        context.correlationId ||
                        getPath(
                            context,
                            'executionContext.correlationId'
                        )
                },
                message
            );
        }
    }

    _logWarn(
        error,
        message
    ) {
        if (
            this.logger &&
            typeof this.logger.warn ===
                'function'
        ) {
            this.logger.warn(
                {
                    error:
                        error.message
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
 */

function createExecutiveReportingExporter(
    dependencies = {}
) {
    return new ExecutiveReportingExporter(
        dependencies
    );
}

/**
 * ============================================================================
 * Static Constants
 * ============================================================================
 */

ExecutiveReportingExporter.EXPORT_FORMAT =
    EXPORT_FORMAT;

ExecutiveReportingExporter.REPORT_TYPE =
    REPORT_TYPE;

ExecutiveReportingExporter.REPORT_STATUS =
    REPORT_STATUS;

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports =
    ExecutiveReportingExporter;

module.exports.ExecutiveReportingExporter =
    ExecutiveReportingExporter;

module.exports.createExecutiveReportingExporter =
    createExecutiveReportingExporter;

module.exports.EXPORT_FORMAT =
    EXPORT_FORMAT;

module.exports.REPORT_TYPE =
    REPORT_TYPE;

module.exports.REPORT_STATUS =
    REPORT_STATUS;