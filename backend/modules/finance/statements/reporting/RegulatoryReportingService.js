'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * RegulatoryReportingService
 * ============================================================================
 *
 * Enterprise Regulatory Reporting Service
 *
 * Location:
 *   backend/modules/finance/statements/reporting/RegulatoryReportingService.js
 *
 * Purpose:
 *   Generate controlled regulatory reporting packages from authoritative
 *   financial and statement intelligence sources.
 *
 * Architectural position:
 *
 *   Ledger / Statements
 *          ↓
 *   Reconciliation
 *          ↓
 *   Repair / Settlement / Fraud Intelligence
 *          ↓
 *   Reporting Aggregation
 *          ↓
 *   RegulatoryReportingService
 *          ↓
 *   Regulatory Reporting Package
 *          ↓
 *   Validation / Approval / Submission
 *
 * IMPORTANT:
 *
 * This service is READ-ONLY with respect to financial accounting data.
 *
 * It MUST NOT:
 *
 *   - post journal entries
 *   - modify ledger balances
 *   - execute statement repairs
 *   - approve financial adjustments
 *   - alter reconciliation results
 *   - change settlement records
 *   - suppress fraud alerts
 *   - execute AI recommendations
 *
 * Regulatory reports are derived artifacts.
 *
 * The authoritative source of financial truth remains the accounting ledger
 * and controlled transactional services.
 *
 * ============================================================================
 *
 * Design principles:
 *
 *   1. Tenant isolation
 *   2. Deterministic report generation
 *   3. Immutable reporting snapshots
 *   4. Strong validation
 *   5. Explicit data-quality status
 *   6. Regulatory schema versioning
 *   7. Idempotent report generation
 *   8. Auditability
 *   9. Approval/submission separation
 *   10. No financial mutation
 *   11. No silent data transformation
 *   12. Safe export serialization
 *
 * ============================================================================
 */

const crypto = require('crypto');

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const REPORT_STATUS = Object.freeze({
    DRAFT: 'DRAFT',
    GENERATED: 'GENERATED',
    VALIDATED: 'VALIDATED',
    APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
    APPROVED: 'APPROVED',
    SUBMITTED: 'SUBMITTED',
    ACCEPTED: 'ACCEPTED',
    REJECTED: 'REJECTED',
    PARTIAL: 'PARTIAL',
    DEGRADED: 'DEGRADED',
    FAILED: 'FAILED'
});

const DATA_QUALITY_STATUS = Object.freeze({
    COMPLETE: 'COMPLETE',
    PARTIAL: 'PARTIAL',
    DEGRADED: 'DEGRADED',
    FAILED: 'FAILED'
});

const SUBMISSION_STATUS = Object.freeze({
    NOT_SUBMITTED: 'NOT_SUBMITTED',
    QUEUED: 'QUEUED',
    SUBMITTED: 'SUBMITTED',
    ACCEPTED: 'ACCEPTED',
    REJECTED: 'REJECTED',
    FAILED: 'FAILED'
});

const REPORT_FORMAT = Object.freeze({
    JSON: 'json',
    CSV: 'csv',
    XML: 'xml',
    TEXT: 'text'
});

const REPORT_TYPE = Object.freeze({
    PERIODIC_FINANCIAL: 'PERIODIC_FINANCIAL',
    STATEMENT: 'STATEMENT',
    LIQUIDITY: 'LIQUIDITY',
    CAPITAL: 'CAPITAL',
    ASSET_QUALITY: 'ASSET_QUALITY',
    LOAN_PORTFOLIO: 'LOAN_PORTFOLIO',
    DEPOSIT: 'DEPOSIT',
    SETTLEMENT: 'SETTLEMENT',
    RISK: 'RISK',
    FRAUD: 'FRAUD',
    AML: 'AML',
    OPERATIONS: 'OPERATIONS',
    CUSTOM: 'CUSTOM'
});

const VALIDATION_SEVERITY = Object.freeze({
    INFO: 'INFO',
    WARNING: 'WARNING',
    ERROR: 'ERROR',
    CRITICAL: 'CRITICAL'
});

const DEFAULT_CURRENCY = 'UGX';
const DEFAULT_TIMEZONE = 'UTC';
const DEFAULT_PERIOD_DAYS = 30;
const MAX_PERIOD_DAYS = 3660;
const MAX_ROWS = 10000;
const MAX_DEPTH = 20;

/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

function toNumber(
    value,
    fallback = 0
) {
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

function round(
    value,
    decimals = 2
) {
    const numeric =
        toNumber(value);

    const factor =
        Math.pow(
            10,
            decimals
        );

    return (
        Math.round(
            (
                numeric +
                Number.EPSILON
            ) *
                factor
        ) / factor
    );
}

function percentage(
    numerator,
    denominator
) {
    const denominatorNumber =
        toNumber(
            denominator
        );

    if (
        denominatorNumber === 0
    ) {
        return 0;
    }

    return round(
        (
            toNumber(
                numerator
            ) /
                denominatorNumber
        ) *
            100,
        4
    );
}

function asArray(
    value
) {
    if (
        Array.isArray(value)
    ) {
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
            ? new Date(
                value.getTime()
            )
            : new Date(value);

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        return fallback;
    }

    return date;
}

function getPath(
    object,
    path,
    fallback = undefined
) {
    if (
        !object ||
        typeof path !== 'object' &&
        typeof path !== 'string'
    ) {
        return fallback;
    }

    const parts =
        Array.isArray(path)
            ? path
            : path.split('.');

    let current =
        object;

    for (
        const part of parts
    ) {
        if (
            current === null ||
            current === undefined
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

function safeString(
    value,
    fallback = ''
) {
    if (
        value === null ||
        value === undefined
    ) {
        return fallback;
    }

    return String(value);
}

function escapeCsv(
    value
) {
    if (
        value === null ||
        value === undefined
    ) {
        return '';
    }

    const stringValue =
        String(value);

    /**
     * Spreadsheet formula injection protection.
     */
    const safeValue =
        /^[=+\-@]/.test(
            stringValue
        )
            ? `'${stringValue}`
            : stringValue;

    if (
        /[",\r\n]/.test(
            safeValue
        )
    ) {
        return `"${safeValue.replace(
            /"/g,
            '""'
        )}"`;
    }

    return safeValue;
}

function escapeXml(
    value
) {
    return safeString(
        value
    )
        .replace(
            /&/g,
            '&amp;'
        )
        .replace(
            /</g,
            '&lt;'
        )
        .replace(
            />/g,
            '&gt;'
        )
        .replace(
            /"/g,
            '&quot;'
        )
        .replace(
            /'/g,
            '&apos;'
        );
}

function generateCorrelationId() {
    return (
        `reg-report-${Date.now()}-` +
        crypto.randomBytes(6)
            .toString('hex')
    );
}

function hashObject(
    value
) {
    const normalized =
        stableStringify(
            value
        );

    return crypto
        .createHash(
            'sha256'
        )
        .update(
            normalized
        )
        .digest('hex');
}

/**
 * Deterministic JSON serialization.
 *
 * This is useful for:
 *
 * - report fingerprints
 * - idempotency
 * - evidence packages
 * - audit verification
 */
function stableStringify(
    value,
    seen = new WeakSet()
) {
    if (
        value === null ||
        value === undefined
    ) {
        return JSON.stringify(
            value
        );
    }

    if (
        typeof value !== 'object'
    ) {
        return JSON.stringify(
            value
        );
    }

    if (
        value instanceof Date
    ) {
        return JSON.stringify(
            value.toISOString()
        );
    }

    if (
        seen.has(value)
    ) {
        return JSON.stringify(
            '[CIRCULAR_REFERENCE]'
        );
    }

    seen.add(value);

    if (
        Array.isArray(value)
    ) {
        const output =
            value.map(
                (item) =>
                    stableStringify(
                        item,
                        seen
                    )
            );

        seen.delete(value);

        return `[${output.join(',')}]`;
    }

    const keys =
        Object.keys(value)
            .sort();

    const output =
        keys.map(
            (key) =>
                `${JSON.stringify(
                    key
                )}:${stableStringify(
                    value[key],
                    seen
                )}`
        );

    seen.delete(value);

    return `{${output.join(',')}}`;
}

/**
 * ============================================================================
 * RegulatoryReportingService
 * ============================================================================
 */

class RegulatoryReportingService {
    /**
     * @param {Object} dependencies
     *
     * Supported dependencies:
     *
     *   logger
     *   dashboardAggregator
     *   statementService
     *   financialStatementService
     *   reconciliationService
     *   reportRepository
     *   reportDefinitionRepository
     *   submissionRepository
     *   auditLogger
     *   metricsService
     *   regulatorAdapter
     *   schemaRegistry
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

        this.financialStatementService =
            dependencies.financialStatementService ||
            null;

        this.reconciliationService =
            dependencies.reconciliationService ||
            null;

        this.reportRepository =
            dependencies.reportRepository ||
            null;

        this.reportDefinitionRepository =
            dependencies.reportDefinitionRepository ||
            null;

        this.submissionRepository =
            dependencies.submissionRepository ||
            null;

        this.auditLogger =
            dependencies.auditLogger ||
            null;

        this.metricsService =
            dependencies.metricsService ||
            null;

        this.regulatorAdapter =
            dependencies.regulatorAdapter ||
            null;

        this.schemaRegistry =
            dependencies.schemaRegistry ||
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
                MAX_ROWS,
                Math.max(
                    1,
                    toNumber(
                        dependencies.maxRows,
                        MAX_ROWS
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
     * Generate a regulatory report.
     *
     * @param {Object} context
     * @returns {Promise<Object>}
     */
    async generate(
        context = {}
    ) {
        const startedAt =
            Date.now();

        let execution;

        try {
            execution =
                this._buildExecutionContext(
                    context
                );

            const definition =
                await this._loadReportDefinition(
                    execution
                );

            const sourceData =
                await this._collectSourceData(
                    execution
                );

            const report =
                this._buildReport(
                    execution,
                    definition,
                    sourceData
                );

            const validation =
                await this.validate(
                    report,
                    {
                        context:
                            execution.context,

                        skipSourceReload:
                            true
                    }
                );

            report.validation =
                validation;

            report.status =
                this._deriveReportStatus(
                    validation
                );

            report.metadata =
                {
                    ...report.metadata,

                    generatedAt:
                        new Date()
                            .toISOString(),

                    durationMs:
                        Date.now() -
                        startedAt,

                    fingerprint:
                        hashObject(
                            report
                        )
                };

            await this._recordAuditEvent(
                'REGULATORY_REPORT_GENERATED',
                report,
                execution
            );

            this._recordMetric(
                'regulatory_report_generated',
                execution,
                report
            );

            return report;
        } catch (
            error
        ) {
            if (
                execution
            ) {
                this._logError(
                    error,
                    'Regulatory report generation failed',
                    execution
                );
            }

            return this._failureResponse(
                error,
                execution,
                startedAt
            );
        }
    }

    /**
     * Validate an existing report.
     *
     * @param {Object} report
     * @param {Object} options
     * @returns {Promise<Object>}
     */
    async validate(
        report,
        options = {}
    ) {
        const errors = [];
        const warnings = [];
        const info = [];

        if (
            !report ||
            typeof report !== 'object'
        ) {
            return {
                valid: false,

                status:
                    DATA_QUALITY_STATUS.FAILED,

                errors: [
                    this._validationIssue(
                        VALIDATION_SEVERITY
                            .CRITICAL,
                        'REPORT_REQUIRED',
                        'A regulatory report is required.'
                    )
                ],

                warnings: [],

                info: []
            };
        }

        /**
         * Identity validation.
         */
        if (
            !report.reportId
        ) {
            errors.push(
                this._validationIssue(
                    VALIDATION_SEVERITY
                        .CRITICAL,
                    'REPORT_ID_REQUIRED',
                    'Report ID is required.'
                )
            );
        }

        if (
            !report.tenantId
        ) {
            errors.push(
                this._validationIssue(
                    VALIDATION_SEVERITY
                        .CRITICAL,
                    'TENANT_ID_REQUIRED',
                    'Tenant ID is required.'
                )
            );
        }

        if (
            !report.reportType
        ) {
            errors.push(
                this._validationIssue(
                    VALIDATION_SEVERITY
                        .CRITICAL,
                    'REPORT_TYPE_REQUIRED',
                    'Report type is required.'
                )
            );
        }

        /**
         * Period validation.
         */
        const from =
            normalizeDate(
                getPath(
                    report,
                    'period.from'
                )
            );

        const to =
            normalizeDate(
                getPath(
                    report,
                    'period.to'
                )
            );

        if (!from) {
            errors.push(
                this._validationIssue(
                    VALIDATION_SEVERITY
                        .CRITICAL,
                    'PERIOD_FROM_INVALID',
                    'Reporting period start date is invalid.'
                )
            );
        }

        if (!to) {
            errors.push(
                this._validationIssue(
                    VALIDATION_SEVERITY
                        .CRITICAL,
                    'PERIOD_TO_INVALID',
                    'Reporting period end date is invalid.'
                )
            );
        }

        if (
            from &&
            to &&
            from > to
        ) {
            errors.push(
                this._validationIssue(
                    VALIDATION_SEVERITY
                        .CRITICAL,
                    'INVALID_REPORTING_PERIOD',
                    'Reporting period start must not exceed reporting period end.'
                )
            );
        }

        /**
         * Currency validation.
         */
        if (
            !report.currency
        ) {
            warnings.push(
                this._validationIssue(
                    VALIDATION_SEVERITY
                        .WARNING,
                    'CURRENCY_MISSING',
                    'Report currency is not explicitly defined.'
                )
            );
        }

        /**
         * Data quality validation.
         */
        const dataQuality =
            report.dataQuality ||
            {};

        if (
            dataQuality.status ===
            DATA_QUALITY_STATUS.DEGRADED
        ) {
            warnings.push(
                this._validationIssue(
                    VALIDATION_SEVERITY
                        .WARNING,
                    'DATA_QUALITY_DEGRADED',
                    'One or more reporting data sources are degraded.'
                )
            );
        }

        if (
            dataQuality.status ===
            DATA_QUALITY_STATUS.PARTIAL
        ) {
            warnings.push(
                this._validationIssue(
                    VALIDATION_SEVERITY
                        .WARNING,
                    'DATA_QUALITY_PARTIAL',
                    'The report contains partially available source data.'
                )
            );
        }

        /**
         * Financial integrity checks.
         */
        const financialChecks =
            this._validateFinancialIntegrity(
                report
            );

        errors.push(
            ...financialChecks.errors
        );

        warnings.push(
            ...financialChecks.warnings
        );

        /**
         * Required-field validation.
         */
        const requiredChecks =
            this._validateRequiredSections(
                report
            );

        errors.push(
            ...requiredChecks.errors
        );

        warnings.push(
            ...requiredChecks.warnings
        );

        /**
         * Definition-specific validation.
         */
        const definition =
            report.definition ||
            {};

        const schemaChecks =
            await this._validateAgainstDefinition(
                report,
                definition,
                options
            );

        errors.push(
            ...schemaChecks.errors
        );

        warnings.push(
            ...schemaChecks.warnings
        );

        info.push(
            this._validationIssue(
                VALIDATION_SEVERITY.INFO,
                'VALIDATION_COMPLETED',
                'Regulatory report validation completed.'
            )
        );

        const valid =
            errors.length === 0;

        let status =
            DATA_QUALITY_STATUS.COMPLETE;

        if (
            !valid
        ) {
            status =
                DATA_QUALITY_STATUS.FAILED;
        } else if (
            warnings.length > 0
        ) {
            status =
                DATA_QUALITY_STATUS.PARTIAL;
        }

        return {
            valid,

            status,

            errorCount:
                errors.length,

            warningCount:
                warnings.length,

            infoCount:
                info.length,

            errors,

            warnings,

            info,

            validatedAt:
                new Date()
                    .toISOString()
        };
    }

    /**
     * Generate and persist a regulatory report.
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
            !this.reportRepository
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
            const existing =
                await this._findExistingReport(
                    report
                );

            if (
                existing
            ) {
                return {
                    ...report,

                    persistence: {
                        persisted: true,

                        idempotent: true,

                        existingReportId:
                            existing.reportId ||
                            existing._id ||
                            existing.id
                    }
                };
            }

            const record =
                this._buildPersistenceRecord(
                    report
                );

            let persisted;

            if (
                typeof this.reportRepository.create ===
                'function'
            ) {
                persisted =
                    await this.reportRepository.create(
                        record
                    );
            } else if (
                typeof this.reportRepository.save ===
                'function'
            ) {
                persisted =
                    await this.reportRepository.save(
                        record
                    );
            } else {
                throw new Error(
                    'Report repository does not implement create() or save()'
                );
            }

            await this._recordAuditEvent(
                'REGULATORY_REPORT_PERSISTED',
                report,
                context
            );

            return {
                ...report,

                persistence: {
                    persisted: true,

                    idempotent: false,

                    id:
                        persisted &&
                        (
                            persisted.reportId ||
                            persisted._id ||
                            persisted.id
                        )
                }
            };
        } catch (
            error
        ) {
            this._logError(
                error,
                'Regulatory report persistence failed',
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
     * Export a generated report.
     *
     * @param {Object} report
     * @param {string} format
     * @returns {Promise<Object>}
     */
    async export(
        report,
        format = REPORT_FORMAT.JSON
    ) {
        const normalizedFormat =
            this._normalizeFormat(
                format
            );

        if (
            !report ||
            typeof report !== 'object'
        ) {
            return {
                success: false,

                status:
                    REPORT_STATUS.FAILED,

                error: {
                    code:
                        'REPORT_REQUIRED',

                    message:
                        'A regulatory report is required for export.'
                }
            };
        }

        try {
            let content;
            let mimeType;

            switch (
                normalizedFormat
            ) {
                case REPORT_FORMAT.CSV:
                    content =
                        this._toCSV(
                            report
                        );

                    mimeType =
                        'text/csv';

                    break;

                case REPORT_FORMAT.XML:
                    content =
                        this._toXML(
                            report
                        );

                    mimeType =
                        'application/xml';

                    break;

                case REPORT_FORMAT.TEXT:
                    content =
                        this._toText(
                            report
                        );

                    mimeType =
                        'text/plain';

                    break;

                case REPORT_FORMAT.JSON:
                default:
                    content =
                        JSON.stringify(
                            this._sanitizeExportValue(
                                report
                            ),
                            null,
                            2
                        );

                    mimeType =
                        'application/json';
            }

            const filename =
                this._buildFilename(
                    report,
                    normalizedFormat
                );

            await this._recordAuditEvent(
                'REGULATORY_REPORT_EXPORTED',
                {
                    ...report,

                    exportFormat:
                        normalizedFormat,

                    filename
                },
                report.metadata ||
                {}
            );

            return {
                success: true,

                reportId:
                    report.reportId,

                tenantId:
                    report.tenantId,

                format:
                    normalizedFormat,

                mimeType,

                filename,

                content,

                encoding:
                    'utf-8',

                fingerprint:
                    hashObject(
                        content
                    )
            };
        } catch (
            error
        ) {
            this._logError(
                error,
                'Regulatory report export failed',
                report
            );

            return {
                success: false,

                status:
                    REPORT_STATUS.FAILED,

                reportId:
                    report.reportId,

                format:
                    normalizedFormat,

                error: {
                    code:
                        error.code ||
                        'REPORT_EXPORT_FAILED',

                    message:
                        error.message ||
                        'Regulatory report export failed'
                }
            };
        }
    }

    /**
     * Request approval for a report.
     *
     * This does NOT approve the report.
     *
     * @param {Object} report
     * @param {Object} context
     * @returns {Promise<Object>}
     */
    async requestApproval(
        report,
        context = {}
    ) {
        if (
            !report ||
            !report.reportId
        ) {
            throw new Error(
                'A generated regulatory report is required.'
            );
        }

        if (
            report.status !==
                REPORT_STATUS.VALIDATED &&
            report.status !==
                REPORT_STATUS.GENERATED &&
            report.status !==
                REPORT_STATUS.APPROVAL_REQUIRED
        ) {
            throw new Error(
                `Report status ${report.status} cannot enter approval workflow.`
            );
        }

        const approvalRecord = {
            reportId:
                report.reportId,

            tenantId:
                report.tenantId,

            reportType:
                report.reportType,

            status:
                REPORT_STATUS
                    .APPROVAL_REQUIRED,

            requestedAt:
                new Date()
                    .toISOString(),

            requestedBy:
                context.userId ||
                context.actorId ||
                null,

            reportFingerprint:
                getPath(
                    report,
                    'metadata.fingerprint'
                ),

            correlationId:
                context.correlationId ||
                getPath(
                    report,
                    'metadata.correlationId'
                )
        };

        if (
            this.reportRepository &&
            typeof this.reportRepository.updateStatus ===
                'function'
        ) {
            await this.reportRepository.updateStatus(
                report.reportId,
                REPORT_STATUS
                    .APPROVAL_REQUIRED,
                approvalRecord
            );
        }

        await this._recordAuditEvent(
            'REGULATORY_REPORT_APPROVAL_REQUESTED',
            approvalRecord,
            context
        );

        return {
            success: true,

            reportId:
                report.reportId,

            status:
                REPORT_STATUS
                    .APPROVAL_REQUIRED,

            approval:
                approvalRecord
        };
    }

    /**
     * Approve a report.
     *
     * Approval is explicitly separated from generation.
     *
     * @param {string} reportId
     * @param {Object} context
     * @returns {Promise<Object>}
     */
    async approve(
        reportId,
        context = {}
    ) {
        if (
            !reportId
        ) {
            throw new Error(
                'reportId is required.'
            );
        }

        if (
            !context.approverId &&
            !context.userId &&
            !context.actorId
        ) {
            throw new Error(
                'An approving actor is required.'
            );
        }

        const approverId =
            context.approverId ||
            context.userId ||
            context.actorId;

        const approval = {
            reportId,

            approvedBy:
                approverId,

            approvedAt:
                new Date()
                    .toISOString(),

            status:
                REPORT_STATUS.APPROVED,

            correlationId:
                context.correlationId ||
                generateCorrelationId()
        };

        if (
            this.reportRepository &&
            typeof this.reportRepository.updateStatus ===
                'function'
        ) {
            await this.reportRepository.updateStatus(
                reportId,
                REPORT_STATUS.APPROVED,
                approval
            );
        }

        await this._recordAuditEvent(
            'REGULATORY_REPORT_APPROVED',
            approval,
            context
        );

        return {
            success: true,

            reportId,

            status:
                REPORT_STATUS.APPROVED,

            approval
        };
    }

    /**
     * Submit an approved report through an injected regulator adapter.
     *
     * The adapter is responsible for regulator-specific transport.
     *
     * @param {Object} report
     * @param {Object} context
     * @returns {Promise<Object>}
     */
    async submit(
        report,
        context = {}
    ) {
        if (
            !report ||
            !report.reportId
        ) {
            throw new Error(
                'A regulatory report is required.'
            );
        }

        if (
            report.status !==
            REPORT_STATUS.APPROVED
        ) {
            throw new Error(
                'Only approved regulatory reports may be submitted.'
            );
        }

        if (
            !this.regulatorAdapter
        ) {
            return {
                success: false,

                status:
                    SUBMISSION_STATUS.FAILED,

                reportId:
                    report.reportId,

                error: {
                    code:
                        'REGULATOR_ADAPTER_UNAVAILABLE',

                    message:
                        'No regulator submission adapter is configured.'
                }
            };
        }

        const submissionId =
            this._generateSubmissionId(
                report
            );

        const submissionContext = {
            submissionId,

            reportId:
                report.reportId,

            tenantId:
                report.tenantId,

            reportType:
                report.reportType,

            period:
                report.period,

            fingerprint:
                getPath(
                    report,
                    'metadata.fingerprint'
                ),

            correlationId:
                context.correlationId ||
                getPath(
                    report,
                    'metadata.correlationId'
                ) ||
                generateCorrelationId()
        };

        try {
            let result;

            if (
                typeof this.regulatorAdapter.submit ===
                'function'
            ) {
                result =
                    await this.regulatorAdapter.submit(
                        report,
                        submissionContext
                    );
            } else if (
                typeof this.regulatorAdapter.send ===
                'function'
            ) {
                result =
                    await this.regulatorAdapter.send(
                        report,
                        submissionContext
                    );
            } else {
                throw new Error(
                    'Regulator adapter does not implement submit() or send().'
                );
            }

            const submission =
                {
                    ...submissionContext,

                    status:
                        result &&
                        result.accepted
                            ? SUBMISSION_STATUS
                                .ACCEPTED
                            : SUBMISSION_STATUS
                                .SUBMITTED,

                    submittedAt:
                        new Date()
                            .toISOString(),

                    regulatorReference:
                        result &&
                        (
                            result.reference ||
                            result.referenceId ||
                            result.submissionId
                        ),

                    response:
                        this._sanitizeExportValue(
                            result || {}
                        )
                };

            await this._persistSubmission(
                submission
            );

            await this._recordAuditEvent(
                'REGULATORY_REPORT_SUBMITTED',
                submission,
                context
            );

            return {
                success: true,

                reportId:
                    report.reportId,

                submission
            };
        } catch (
            error
        ) {
            const failedSubmission =
                {
                    ...submissionContext,

                    status:
                        SUBMISSION_STATUS.FAILED,

                    failedAt:
                        new Date()
                            .toISOString(),

                    error: {
                        code:
                            error.code ||
                            'REGULATORY_SUBMISSION_FAILED',

                        message:
                            error.message
                    }
                };

            await this._persistSubmission(
                failedSubmission
            );

            await this._recordAuditEvent(
                'REGULATORY_REPORT_SUBMISSION_FAILED',
                failedSubmission,
                context
            );

            return {
                success: false,

                reportId:
                    report.reportId,

                submission:
                    failedSubmission
            };
        }
    }

    /**
     * Retrieve a persisted report.
     *
     * @param {string} reportId
     * @param {string} tenantId
     * @returns {Promise<Object|null>}
     */
    async getReport(
        reportId,
        tenantId
    ) {
        if (
            !reportId ||
            !tenantId
        ) {
            throw new Error(
                'reportId and tenantId are required.'
            );
        }

        if (
            !this.reportRepository
        ) {
            return null;
        }

        if (
            typeof this.reportRepository.findByReportId ===
            'function'
        ) {
            return this.reportRepository.findByReportId(
                reportId,
                tenantId
            );
        }

        if (
            typeof this.reportRepository.findOne ===
            'function'
        ) {
            return this.reportRepository.findOne({
                reportId,
                tenantId
            });
        }

        return null;
    }

    /**
     * Return service health and capability information.
     *
     * @returns {Object}
     */
    health() {
        return {
            service:
                'RegulatoryReportingService',

            version:
                this.version,

            status:
                'HEALTHY',

            readOnly:
                true,

            financialMutationAllowed:
                false,

            capabilities: {
                dashboardAggregation:
                    Boolean(
                        this.dashboardAggregator
                    ),

                statementSource:
                    Boolean(
                        this.statementService
                    ),

                financialStatementSource:
                    Boolean(
                        this.financialStatementService
                    ),

                reconciliationSource:
                    Boolean(
                        this.reconciliationService
                    ),

                persistence:
                    Boolean(
                        this.reportRepository
                    ),

                approvalWorkflow:
                    Boolean(
                        this.reportRepository
                    ),

                submission:
                    Boolean(
                        this.regulatorAdapter
                    ),

                auditLogging:
                    Boolean(
                        this.auditLogger
                    ),

                metrics:
                    Boolean(
                        this.metricsService
                    ),

                schemaRegistry:
                    Boolean(
                        this.schemaRegistry
                    )
            },

            reportTypes:
                Object.values(
                    REPORT_TYPE
                ),

            formats:
                Object.values(
                    REPORT_FORMAT
                )
        };
    }

    /**
     * =========================================================================
     * Report Definition
     * =========================================================================
     */

    async _loadReportDefinition(
        execution
    ) {
        const requestedDefinition =
            execution.context
                .reportDefinition;

        if (
            requestedDefinition &&
            typeof requestedDefinition ===
                'object'
        ) {
            return this._sanitizeExportValue(
                requestedDefinition
            );
        }

        if (
            this.reportDefinitionRepository
        ) {
            if (
                typeof this.reportDefinitionRepository
                    .findActive ===
                'function'
            ) {
                const definition =
                    await this.reportDefinitionRepository
                        .findActive(
                            {
                                tenantId:
                                    execution.tenantId,

                                reportType:
                                    execution.reportType,

                                regulator:
                                    execution.context
                                        .regulator,

                                schemaVersion:
                                    execution.context
                                        .schemaVersion
                            }
                        );

                if (
                    definition
                ) {
                    return definition;
                }
            }

            if (
                typeof this.reportDefinitionRepository
                    .findOne ===
                'function'
            ) {
                const definition =
                    await this.reportDefinitionRepository
                        .findOne(
                            {
                                tenantId:
                                    execution.tenantId,

                                reportType:
                                    execution.reportType
                            }
                        );

                if (
                    definition
                ) {
                    return definition;
                }
            }
        }

        if (
            this.schemaRegistry
        ) {
            if (
                typeof this.schemaRegistry.getDefinition ===
                'function'
            ) {
                const definition =
                    await this.schemaRegistry
                        .getDefinition(
                            {
                                regulator:
                                    execution.context
                                        .regulator,

                                reportType:
                                    execution.reportType,

                                schemaVersion:
                                    execution.context
                                        .schemaVersion
                            }
                        );

                if (
                    definition
                ) {
                    return definition;
                }
            }
        }

        return this._defaultReportDefinition(
            execution
        );
    }

    _defaultReportDefinition(
        execution
    ) {
        return {
            regulator:
                execution.context
                    .regulator ||
                'UNSPECIFIED',

            reportType:
                execution.reportType,

            schemaVersion:
                execution.context
                    .schemaVersion ||
                '1.0.0',

            requiredSections: [
                'summary',
                'financial',
                'reconciliation',
                'risk',
                'dataQuality'
            ],

            submission: {
                approvalRequired:
                    true
            }
        };
    }

    /**
     * =========================================================================
     * Source Data Collection
     * =========================================================================
     */

    async _collectSourceData(
        execution
    ) {
        const sources = {};

        const sourceErrors = [];

        /**
         * Dashboard aggregator is the preferred
         * intelligence aggregation source.
         */
        if (
            this.dashboardAggregator
        ) {
            try {
                if (
                    typeof this.dashboardAggregator.aggregate ===
                    'function'
                ) {
                    sources.dashboard =
                        await this.dashboardAggregator
                            .aggregate(
                                {
                                    tenantId:
                                        execution.tenantId,

                                    from:
                                        execution.period
                                            .from,

                                    to:
                                        execution.period
                                            .to,

                                    options: {
                                        mode:
                                            'regulatory',

                                        forceRefresh:
                                            Boolean(
                                                execution.context
                                                    .forceRefresh
                                            )
                                    }
                                }
                            );
                } else if (
                    typeof this.dashboardAggregator
                        .getDashboard ===
                    'function'
                ) {
                    sources.dashboard =
                        await this.dashboardAggregator
                            .getDashboard(
                                {
                                    tenantId:
                                        execution.tenantId,

                                    from:
                                        execution.period
                                            .from,

                                    to:
                                        execution.period
                                            .to
                                }
                            );
                }
            } catch (
                error
            ) {
                sourceErrors.push({
                    source:
                        'dashboard',

                    error:
                        error.message
                });
            }
        }

        /**
         * Financial statement source.
         */
        if (
            this.financialStatementService
        ) {
            try {
                if (
                    typeof this.financialStatementService
                        .generate ===
                    'function'
                ) {
                    sources.financialStatements =
                        await this.financialStatementService
                            .generate(
                                {
                                    tenantId:
                                        execution.tenantId,

                                    from:
                                        execution.period
                                            .from,

                                    to:
                                        execution.period
                                            .to
                                }
                            );
                } else if (
                    typeof this.financialStatementService
                        .getStatements ===
                    'function'
                ) {
                    sources.financialStatements =
                        await this.financialStatementService
                            .getStatements(
                                {
                                    tenantId:
                                        execution.tenantId,

                                    from:
                                        execution.period
                                            .from,

                                    to:
                                        execution.period
                                            .to
                                }
                            );
                }
            } catch (
                error
            ) {
                sourceErrors.push({
                    source:
                        'financialStatements',

                    error:
                        error.message
                });
            }
        }

        /**
         * Statement source.
         */
        if (
            this.statementService
        ) {
            try {
                if (
                    typeof this.statementService
                        .getReportingData ===
                    'function'
                ) {
                    sources.statements =
                        await this.statementService
                            .getReportingData(
                                {
                                    tenantId:
                                        execution.tenantId,

                                    from:
                                        execution.period
                                            .from,

                                    to:
                                        execution.period
                                            .to
                                }
                            );
                } else if (
                    typeof this.statementService
                        .findForPeriod ===
                    'function'
                ) {
                    sources.statements =
                        await this.statementService
                            .findForPeriod(
                                {
                                    tenantId:
                                        execution.tenantId,

                                    from:
                                        execution.period
                                            .from,

                                    to:
                                        execution.period
                                            .to
                                }
                            );
                }
            } catch (
                error
            ) {
                sourceErrors.push({
                    source:
                        'statements',

                    error:
                        error.message
                });
            }
        }

        /**
         * Reconciliation source.
         */
        if (
            this.reconciliationService
        ) {
            try {
                if (
                    typeof this.reconciliationService
                        .getReportingSummary ===
                    'function'
                ) {
                    sources.reconciliation =
                        await this.reconciliationService
                            .getReportingSummary(
                                {
                                    tenantId:
                                        execution.tenantId,

                                    from:
                                        execution.period
                                            .from,

                                    to:
                                        execution.period
                                            .to
                                }
                            );
                } else if (
                    typeof this.reconciliationService
                        .summarize ===
                    'function'
                ) {
                    sources.reconciliation =
                        await this.reconciliationService
                            .summarize(
                                {
                                    tenantId:
                                        execution.tenantId,

                                    from:
                                        execution.period
                                            .from,

                                    to:
                                        execution.period
                                            .to
                                }
                            );
                }
            } catch (
                error
            ) {
                sourceErrors.push({
                    source:
                        'reconciliation',

                    error:
                        error.message
                });
            }
        }

        return {
            ...sources,

            collectionErrors:
                sourceErrors,

            collectedAt:
                new Date()
                    .toISOString()
        };
    }

    /**
     * =========================================================================
     * Report Construction
     * =========================================================================
     */

    _buildReport(
        execution,
        definition,
        sourceData
    ) {
        const dashboard =
            sourceData.dashboard ||
            {};

        const financial =
            this._buildFinancialSection(
                sourceData,
                dashboard
            );

        const reconciliation =
            this._buildReconciliationSection(
                sourceData,
                dashboard
            );

        const risk =
            this._buildRiskSection(
                sourceData,
                dashboard
            );

        const operations =
            this._buildOperationsSection(
                sourceData,
                dashboard
            );

        const liquidity =
            this._buildLiquiditySection(
                sourceData,
                dashboard
            );

        const assetQuality =
            this._buildAssetQualitySection(
                sourceData,
                dashboard
            );

        const loanPortfolio =
            this._buildLoanPortfolioSection(
                sourceData,
                dashboard
            );

        const deposits =
            this._buildDepositSection(
                sourceData,
                dashboard
            );

        const settlements =
            this._buildSettlementSection(
                sourceData,
                dashboard
            );

        const summary =
            this._buildSummary(
                financial,
                reconciliation,
                risk,
                operations
            );

        const dataQuality =
            this._buildDataQuality(
                sourceData,
                definition
            );

        const report = {
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

            regulator:
                definition.regulator ||
                execution.context
                    .regulator ||
                null,

            tenantId:
                execution.tenantId,

            period: {
                from:
                    execution.period
                        .from
                        .toISOString(),

                to:
                    execution.period
                        .to
                        .toISOString(),

                days:
                    execution.period.days
            },

            currency:
                execution.context.currency ||
                this.defaultCurrency,

            timezone:
                execution.context.timezone ||
                this.defaultTimezone,

            schema: {
                version:
                    definition.schemaVersion ||
                    '1.0.0',

                definitionId:
                    definition.definitionId ||
                    null
            },

            status:
                REPORT_STATUS.GENERATED,

            summary,

            financial,

            liquidity,

            assetQuality,

            loanPortfolio,

            deposits,

            reconciliation,

            settlements,

            risk,

            operations,

            dataQuality,

            custom:
                this._buildCustomSection(
                    execution,
                    sourceData
                ),

            definition:
                this._sanitizeExportValue(
                    definition
                ),

            metadata: {
                service:
                    'RegulatoryReportingService',

                serviceVersion:
                    this.version,

                generatedAt:
                    new Date()
                        .toISOString(),

                correlationId:
                    execution.correlationId,

                readOnly:
                    true,

                financialMutationAllowed:
                    false,

                sourceSystems:
                    this._availableSources(
                        sourceData
                    ),

                collectionErrors:
                    sourceData
                        .collectionErrors
            }
        };

        return report;
    }

    /**
     * =========================================================================
     * Financial Section
     * =========================================================================
     */

    _buildFinancialSection(
        sourceData,
        dashboard
    ) {
        const financialStatements =
            sourceData
                .financialStatements ||
            {};

        const dashboardFinancial =
            dashboard.financial ||
            {};

        const statements =
            financialStatements.statements ||
            financialStatements ||
            {};

        return {
            totalAssets:
                toNumber(
                    getPath(
                        statements,
                        'totalAssets',
                        getPath(
                            dashboardFinancial,
                            'totalAssets',
                            0
                        )
                    )
                ),

            totalLiabilities:
                toNumber(
                    getPath(
                        statements,
                        'totalLiabilities',
                        getPath(
                            dashboardFinancial,
                            'totalLiabilities',
                            0
                        )
                    )
                ),

            totalEquity:
                toNumber(
                    getPath(
                        statements,
                        'totalEquity',
                        getPath(
                            dashboardFinancial,
                            'totalEquity',
                            0
                        )
                    )
                ),

            totalIncome:
                toNumber(
                    getPath(
                        statements,
                        'totalIncome',
                        getPath(
                            dashboardFinancial,
                            'totalIncome',
                            0
                        )
                    )
                ),

            totalExpenses:
                toNumber(
                    getPath(
                        statements,
                        'totalExpenses',
                        getPath(
                            dashboardFinancial,
                            'totalExpenses',
                            0
                        )
                    )
                ),

            netIncome:
                toNumber(
                    getPath(
                        statements,
                        'netIncome',
                        getPath(
                            dashboardFinancial,
                            'netIncome',
                            0
                        )
                    )
                ),

            transactionCount:
                toNumber(
                    getPath(
                        dashboardFinancial,
                        'transactionCount',
                        getPath(
                            dashboardFinancial,
                            'transactions',
                            0
                        )
                    )
                )
        };
    }

    /**
     * =========================================================================
     * Reconciliation
     * =========================================================================
     */

    _buildReconciliationSection(
        sourceData,
        dashboard
    ) {
        const source =
            sourceData.reconciliation ||
            dashboard.reconciliation ||
            {};

        const metrics =
            source.metrics ||
            source;

        const total =
            toNumber(
                metrics.total
            );

        const matched =
            toNumber(
                metrics.matched
            );

        const unmatched =
            toNumber(
                metrics.unmatched
            );

        const variances =
            toNumber(
                metrics.variances
            );

        return {
            total,

            matched,

            unmatched,

            variances,

            matchRate:
                toNumber(
                    metrics.matchRate,
                    percentage(
                        matched,
                        total
                    )
                ),

            exceptionRate:
                toNumber(
                    metrics.exceptionRate,
                    percentage(
                        unmatched +
                            variances,
                        total
                    )
                )
        };
    }

    /**
     * =========================================================================
     * Risk
     * =========================================================================
     */

    _buildRiskSection(
        sourceData,
        dashboard
    ) {
        const fraud =
            dashboard.fraud ||
            {};

        const risk =
            dashboard.risk ||
            {};

        const metrics =
            risk.metrics ||
            fraud.metrics ||
            {};

        return {
            riskScore:
                round(
                    toNumber(
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

            highAlerts:
                toNumber(
                    metrics.highAlerts
                ),

            suspiciousRepairs:
                toNumber(
                    metrics.suspiciousRepairs
                ),

            fraudPatterns:
                toNumber(
                    metrics.patternsDetected
                ),

            status:
                risk.status ||
                fraud.status ||
                null
        };
    }

    /**
     * =========================================================================
     * Operations
     * =========================================================================
     */

    _buildOperationsSection(
        sourceData,
        dashboard
    ) {
        const operations =
            dashboard.operations ||
            {};

        return {
            branchCount:
                toNumber(
                    getPath(
                        operations,
                        'metrics.branchCount',
                        getPath(
                            operations,
                            'branchCount',
                            0
                        )
                    )
                ),

            teamCount:
                toNumber(
                    getPath(
                        operations,
                        'metrics.teamCount',
                        getPath(
                            operations,
                            'teamCount',
                            0
                        )
                    )
                ),

            workload:
                this._sanitizeExportValue(
                    operations.workload ||
                    {}
                ),

            capacity:
                this._sanitizeExportValue(
                    operations.capacity ||
                    {}
                ),

            benchmarks:
                this._sanitizeExportValue(
                    operations.benchmarks ||
                    {}
                )
        };
    }

    /**
     * =========================================================================
     * Liquidity
     * =========================================================================
     */

    _buildLiquiditySection(
        sourceData,
        dashboard
    ) {
        const liquidity =
            dashboard.liquidity ||
            {};

        const metrics =
            liquidity.metrics ||
            liquidity;

        return {
            liquidAssets:
                toNumber(
                    metrics.liquidAssets
                ),

            liquidityRatio:
                toNumber(
                    metrics.liquidityRatio
                ),

            cashRatio:
                toNumber(
                    metrics.cashRatio
                ),

            status:
                liquidity.status ||
                null
        };
    }

    /**
     * =========================================================================
     * Asset Quality
     * =========================================================================
     */

    _buildAssetQualitySection(
        sourceData,
        dashboard
    ) {
        const assetQuality =
            dashboard.assetQuality ||
            {};

        const metrics =
            assetQuality.metrics ||
            assetQuality;

        return {
            totalAssets:
                toNumber(
                    metrics.totalAssets
                ),

            impairedAssets:
                toNumber(
                    metrics.impairedAssets
                ),

            nonPerformingAssets:
                toNumber(
                    metrics.nonPerformingAssets
                ),

            impairmentRatio:
                toNumber(
                    metrics.impairmentRatio
                ),

            status:
                assetQuality.status ||
                null
        };
    }

    /**
     * =========================================================================
     * Loan Portfolio
     * =========================================================================
     */

    _buildLoanPortfolioSection(
        sourceData,
        dashboard
    ) {
        const loans =
            dashboard.loanPortfolio ||
            dashboard.loans ||
            {};

        const metrics =
            loans.metrics ||
            loans;

        return {
            grossLoanPortfolio:
                toNumber(
                    metrics.grossLoanPortfolio
                ),

            outstandingPrincipal:
                toNumber(
                    metrics.outstandingPrincipal
                ),

            delinquentPortfolio:
                toNumber(
                    metrics.delinquentPortfolio
                ),

            nonPerformingLoans:
                toNumber(
                    metrics.nonPerformingLoans
                ),

            portfolioAtRisk:
                toNumber(
                    metrics.portfolioAtRisk
                ),

            loanCount:
                toNumber(
                    metrics.loanCount
                ),

            status:
                loans.status ||
                null
        };
    }

    /**
     * =========================================================================
     * Deposits
     * =========================================================================
     */

    _buildDepositSection(
        sourceData,
        dashboard
    ) {
        const deposits =
            dashboard.deposits ||
            dashboard.depositPortfolio ||
            {};

        const metrics =
            deposits.metrics ||
            deposits;

        return {
            totalDeposits:
                toNumber(
                    metrics.totalDeposits
                ),

            memberDeposits:
                toNumber(
                    metrics.memberDeposits
                ),

            depositCount:
                toNumber(
                    metrics.depositCount
                ),

            depositGrowth:
                toNumber(
                    metrics.depositGrowth
                ),

            status:
                deposits.status ||
                null
        };
    }

    /**
     * =========================================================================
     * Settlements
     * =========================================================================
     */

    _buildSettlementSection(
        sourceData,
        dashboard
    ) {
        const settlements =
            dashboard.settlements ||
            {};

        const metrics =
            settlements.metrics ||
            settlements;

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
                toNumber(
                    metrics.reliability,
                    percentage(
                        metrics.successful,
                        metrics.settlementCount
                    )
                ),

            successRate:
                toNumber(
                    metrics.successRate,
                    percentage(
                        metrics.successful,
                        metrics.settlementCount
                    )
                ),

            failureRate:
                toNumber(
                    metrics.failureRate,
                    percentage(
                        metrics.failed,
                        metrics.settlementCount
                    )
                )
        };
    }

    /**
     * =========================================================================
     * Summary
     * =========================================================================
     */

    _buildSummary(
        financial,
        reconciliation,
        risk,
        operations
    ) {
        const financialBalanceDifference =
            round(
                financial.totalAssets -
                    (
                        financial.totalLiabilities +
                        financial.totalEquity
                    ),
                2
            );

        const financialIntegrity =
            financialBalanceDifference === 0;

        return {
            financialIntegrity,

            balanceDifference:
                financialBalanceDifference,

            reconciliationMatchRate:
                reconciliation.matchRate,

            reconciliationExceptionRate:
                reconciliation.exceptionRate,

            riskScore:
                risk.riskScore,

            activeRiskAlerts:
                risk.activeAlerts,

            criticalRiskAlerts:
                risk.criticalAlerts,

            operationalBranches:
                operations.branchCount,

            operationalTeams:
                operations.teamCount
        };
    }

    /**
     * =========================================================================
     * Data Quality
     * =========================================================================
     */

    _buildDataQuality(
        sourceData,
        definition
    ) {
        const expectedSources = [
            'dashboard',
            'financialStatements',
            'statements',
            'reconciliation'
        ];

        const available =
            expectedSources.filter(
                (source) =>
                    sourceData[source] !==
                    undefined &&
                    sourceData[source] !==
                    null
            );

        const unavailable =
            expectedSources.filter(
                (source) =>
                    !available.includes(
                        source
                    )
            );

        let status =
            DATA_QUALITY_STATUS.COMPLETE;

        if (
            unavailable.length ===
            expectedSources.length
        ) {
            status =
                DATA_QUALITY_STATUS.FAILED;
        } else if (
            unavailable.length > 0
        ) {
            status =
                DATA_QUALITY_STATUS.PARTIAL;
        }

        if (
            sourceData.collectionErrors &&
            sourceData.collectionErrors.length >
                0
        ) {
            status =
                status ===
                DATA_QUALITY_STATUS.FAILED
                    ? status
                    : DATA_QUALITY_STATUS
                        .DEGRADED;
        }

        return {
            status,

            expectedSources,

            availableSources:
                available,

            unavailableSources:
                unavailable,

            completeness:
                percentage(
                    available.length,
                    expectedSources.length
                ),

            collectionErrors:
                this._sanitizeExportValue(
                    sourceData.collectionErrors ||
                    []
                ),

            requiredSections:
                asArray(
                    definition.requiredSections
                )
        };
    }

    /**
     * =========================================================================
     * Custom Regulatory Fields
     * =========================================================================
     */

    _buildCustomSection(
        execution,
        sourceData
    ) {
        const custom =
            execution.context
                .customFields;

        if (
            !custom
        ) {
            return {};
        }

        return this._sanitizeExportValue(
            custom
        );
    }

    /**
     * =========================================================================
     * Validation Helpers
     * =========================================================================
     */

    _validateFinancialIntegrity(
        report
    ) {
        const errors = [];
        const warnings = [];

        const financial =
            report.financial ||
            {};

        const assets =
            toNumber(
                financial.totalAssets
            );

        const liabilities =
            toNumber(
                financial.totalLiabilities
            );

        const equity =
            toNumber(
                financial.totalEquity
            );

        const difference =
            round(
                assets -
                    (
                        liabilities +
                        equity
                    ),
                2
            );

        /**
         * Only enforce the balance equation when
         * financial totals are actually populated.
         *
         * This avoids falsely rejecting reports where
         * the selected regulatory schema does not require
         * a balance-sheet representation.
         */
        const hasFinancialTotals =
            assets !== 0 ||
            liabilities !== 0 ||
            equity !== 0;

        if (
            hasFinancialTotals &&
            Math.abs(
                difference
            ) > 0.01
        ) {
            errors.push(
                this._validationIssue(
                    VALIDATION_SEVERITY
                        .CRITICAL,
                    'BALANCE_SHEET_OUT_OF_BALANCE',
                    'Total assets do not equal total liabilities plus total equity.',
                    {
                        difference
                    }
                )
            );
        }

        const reconciliation =
            report.reconciliation ||
            {};

        const total =
            toNumber(
                reconciliation.total
            );

        const matched =
            toNumber(
                reconciliation.matched
            );

        const unmatched =
            toNumber(
                reconciliation.unmatched
            );

        const variances =
            toNumber(
                reconciliation.variances
            );

        if (
            total > 0 &&
            matched +
                unmatched +
                variances >
                total
        ) {
            errors.push(
                this._validationIssue(
                    VALIDATION_SEVERITY
                        .ERROR,
                    'RECONCILIATION_COUNT_INCONSISTENT',
                    'Reconciliation component counts exceed total reconciliation activity.'
                )
            );
        }

        if (
            total > 0 &&
            reconciliation.matchRate <
                0
        ) {
            errors.push(
                this._validationIssue(
                    VALIDATION_SEVERITY
                        .ERROR,
                    'INVALID_MATCH_RATE',
                    'Reconciliation match rate cannot be negative.'
                )
            );
        }

        if (
            riskScoreIsCritical(
                report.risk &&
                report.risk.riskScore
            )
        ) {
            warnings.push(
                this._validationIssue(
                    VALIDATION_SEVERITY
                        .WARNING,
                    'HIGH_RISK_PROFILE',
                    'Report contains a high or critical financial risk score.'
                )
            );
        }

        return {
            errors,

            warnings
        };
    }

    _validateRequiredSections(
        report
    ) {
        const errors = [];
        const warnings = [];

        const requiredSections =
            asArray(
                getPath(
                    report,
                    'definition.requiredSections',
                    []
                )
            );

        for (
            const section of
            requiredSections
        ) {
            if (
                !Object.prototype.hasOwnProperty.call(
                    report,
                    section
                )
            ) {
                errors.push(
                    this._validationIssue(
                        VALIDATION_SEVERITY
                            .ERROR,
                        'REQUIRED_SECTION_MISSING',
                        `Required regulatory section "${section}" is missing.`,
                        {
                            section
                        }
                    )
                );
            }
        }

        if (
            !report.dataQuality
        ) {
            warnings.push(
                this._validationIssue(
                    VALIDATION_SEVERITY
                        .WARNING,
                    'DATA_QUALITY_SECTION_MISSING',
                    'Data quality metadata is missing.'
                )
            );
        }

        return {
            errors,

            warnings
        };
    }

    async _validateAgainstDefinition(
        report,
        definition
    ) {
        const errors = [];
        const warnings = [];

        if (
            !definition ||
            typeof definition !==
                'object'
        ) {
            warnings.push(
                this._validationIssue(
                    VALIDATION_SEVERITY
                        .WARNING,
                    'REGULATORY_DEFINITION_MISSING',
                    'No explicit regulatory schema definition was supplied.'
                )
            );

            return {
                errors,
                warnings
            };
        }

        const requiredFields =
            asArray(
                definition.requiredFields
            );

        for (
            const field of
            requiredFields
        ) {
            const value =
                getPath(
                    report,
                    field
                );

            if (
                value === undefined ||
                value === null ||
                value === ''
            ) {
                errors.push(
                    this._validationIssue(
                        VALIDATION_SEVERITY
                            .ERROR,
                        'REQUIRED_FIELD_MISSING',
                        `Required regulatory field "${field}" is missing.`,
                        {
                            field
                        }
                    )
                );
            }
        }

        if (
            definition.schemaVersion
        ) {
            const supported =
                await this._isSchemaVersionSupported(
                    definition
                        .schemaVersion,
                    definition
                );

            if (
                supported === false
            ) {
                errors.push(
                    this._validationIssue(
                        VALIDATION_SEVERITY
                            .ERROR,
                        'UNSUPPORTED_SCHEMA_VERSION',
                        `Regulatory schema version "${definition.schemaVersion}" is not supported.`
                    )
                );
            }
        }

        return {
            errors,

            warnings
        };
    }

    async _isSchemaVersionSupported(
        version,
        definition
    ) {
        if (
            definition &&
            Array.isArray(
                definition.supportedVersions
            )
        ) {
            return definition
                .supportedVersions
                .includes(
                    version
                );
        }

        if (
            this.schemaRegistry &&
            typeof this.schemaRegistry.isSupported ===
                'function'
        ) {
            return this.schemaRegistry
                .isSupported(
                    version,
                    definition
                );
        }

        /**
         * When no registry is configured,
         * the definition itself is authoritative.
         */
        return true;
    }

    _validationIssue(
        severity,
        code,
        message,
        details = {}
    ) {
        return {
            severity,

            code,

            message,

            details:
                this._sanitizeExportValue(
                    details
                )
        };
    }

    /**
     * =========================================================================
     * Status
     * =========================================================================
     */

    _deriveReportStatus(
        validation
    ) {
        if (
            !validation ||
            validation.valid === false
        ) {
            return REPORT_STATUS.FAILED;
        }

        if (
            validation.warningCount > 0
        ) {
            return REPORT_STATUS.PARTIAL;
        }

        return REPORT_STATUS.VALIDATED;
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

            regulator:
                report.regulator,

            period:
                report.period,

            currency:
                report.currency,

            timezone:
                report.timezone,

            schema:
                report.schema,

            status:
                report.status,

            summary:
                report.summary,

            financial:
                report.financial,

            liquidity:
                report.liquidity,

            assetQuality:
                report.assetQuality,

            loanPortfolio:
                report.loanPortfolio,

            deposits:
                report.deposits,

            reconciliation:
                report.reconciliation,

            settlements:
                report.settlements,

            risk:
                report.risk,

            operations:
                report.operations,

            dataQuality:
                report.dataQuality,

            custom:
                report.custom,

            validation:
                report.validation,

            metadata:
                report.metadata,

            createdAt:
                new Date()
        };
    }

    async _findExistingReport(
        report
    ) {
        if (
            !this.reportRepository
        ) {
            return null;
        }

        const fingerprint =
            getPath(
                report,
                'metadata.fingerprint'
            );

        if (
            typeof this.reportRepository
                .findByFingerprint ===
            'function'
        ) {
            return this.reportRepository
                .findByFingerprint(
                    report.tenantId,
                    fingerprint
                );
        }

        if (
            typeof this.reportRepository.findOne ===
            'function'
        ) {
            return this.reportRepository.findOne({
                tenantId:
                    report.tenantId,

                reportType:
                    report.reportType,

                'period.from':
                    report.period.from,

                'period.to':
                    report.period.to,

                'schema.version':
                    report.schema.version
            });
        }

        return null;
    }

    /**
     * =========================================================================
     * Submission Persistence
     * =========================================================================
     */

    async _persistSubmission(
        submission
    ) {
        if (
            !this.submissionRepository
        ) {
            return null;
        }

        if (
            typeof this.submissionRepository.create ===
            'function'
        ) {
            return this.submissionRepository
                .create(
                    submission
                );
        }

        if (
            typeof this.submissionRepository.save ===
            'function'
        ) {
            return this.submissionRepository
                .save(
                    submission
                );
        }

        return null;
    }

    /**
     * =========================================================================
     * Export Formats
     * =========================================================================
     */

    _toCSV(
        report
    ) {
        const rows = [
            [
                'Report ID',
                'Report Type',
                'Regulator',
                'Tenant ID',
                'Period From',
                'Period To',
                'Currency',
                'Metric',
                'Value',
                'Unit'
            ]
        ];

        const metrics = [
            [
                'Total Assets',
                report.financial
                    .totalAssets,
                'amount'
            ],

            [
                'Total Liabilities',
                report.financial
                    .totalLiabilities,
                'amount'
            ],

            [
                'Total Equity',
                report.financial
                    .totalEquity,
                'amount'
            ],

            [
                'Total Income',
                report.financial
                    .totalIncome,
                'amount'
            ],

            [
                'Total Expenses',
                report.financial
                    .totalExpenses,
                'amount'
            ],

            [
                'Net Income',
                report.financial
                    .netIncome,
                'amount'
            ],

            [
                'Reconciliation Match Rate',
                report.reconciliation
                    .matchRate,
                '%'
            ],

            [
                'Reconciliation Exceptions',
                report.reconciliation
                    .unmatched +
                    report.reconciliation
                        .variances,
                'count'
            ],

            [
                'Risk Score',
                report.risk
                    .riskScore,
                'score'
            ],

            [
                'Critical Risk Alerts',
                report.risk
                    .criticalAlerts,
                'count'
            ],

            [
                'Settlement Reliability',
                report.settlements
                    .reliability,
                '%'
            ]
        ];

        for (
            const [
                metric,
                value,
                unit
            ] of metrics
        ) {
            rows.push([
                report.reportId,
                report.reportType,
                report.regulator ||
                    '',
                report.tenantId,
                report.period.from,
                report.period.to,
                report.currency,
                metric,
                value,
                unit
            ]);
        }

        return rows
            .map(
                (row) =>
                    row
                        .map(
                            (value) =>
                                escapeCsv(
                                    value
                                )
                        )
                        .join(',')
            )
            .join('\n');
    }

    _toXML(
        report
    ) {
        const sanitized =
            this._sanitizeExportValue(
                report
            );

        const sections =
            this._xmlObject(
                sanitized,
                'RegulatoryReport'
            );

        return [
            '<?xml version="1.0" encoding="UTF-8"?>',
            sections
        ].join('\n');
    }

    _xmlObject(
        object,
        rootName,
        depth = 0
    ) {
        if (
            depth > MAX_DEPTH
        ) {
            return `<${rootName}>MAX_DEPTH_EXCEEDED</${rootName}>`;
        }

        if (
            object === null ||
            object === undefined
        ) {
            return `<${rootName}></${rootName}>`;
        }

        if (
            typeof object !==
                'object'
        ) {
            return (
                `<${rootName}>` +
                escapeXml(
                    object
                ) +
                `</${rootName}>`
            );
        }

        if (
            Array.isArray(object)
        ) {
            return object
                .map(
                    (item) =>
                        this._xmlObject(
                            item,
                            rootName,
                            depth + 1
                        )
                )
                .join('');
        }

        const children =
            Object.entries(
                object
            )
                .map(
                    ([
                        key,
                        value
                    ]) => {
                        const safeKey =
                            this._xmlTagName(
                                key
                            );

                        return this._xmlObject(
                            value,
                            safeKey,
                            depth + 1
                        );
                    }
                )
                .join('');

        return (
            `<${rootName}>` +
            children +
            `</${rootName}>`
        );
    }

    _xmlTagName(
        value
    ) {
        let tag =
            safeString(
                value,
                'Field'
            )
                .replace(
                    /[^A-Za-z0-9_.-]/g,
                    '_'
                );

        if (
            !/^[A-Za-z_]/.test(
                tag
            )
        ) {
            tag =
                `Field_${tag}`;
        }

        return tag;
    }

    _toText(
        report
    ) {
        const lines = [];

        lines.push(
            report.reportTitle
        );

        lines.push(
            '='.repeat(
                Math.max(
                    20,
                    report.reportTitle.length
                )
            )
        );

        lines.push('');

        lines.push(
            `Report ID: ${report.reportId}`
        );

        lines.push(
            `Report Type: ${report.reportType}`
        );

        lines.push(
            `Regulator: ${report.regulator || 'Not specified'}`
        );

        lines.push(
            `Tenant: ${report.tenantId}`
        );

        lines.push(
            `Period: ${report.period.from} -> ${report.period.to}`
        );

        lines.push(
            `Currency: ${report.currency}`
        );

        lines.push('');

        lines.push(
            'FINANCIAL POSITION'
        );

        lines.push(
            `Total Assets: ${report.financial.totalAssets}`
        );

        lines.push(
            `Total Liabilities: ${report.financial.totalLiabilities}`
        );

        lines.push(
            `Total Equity: ${report.financial.totalEquity}`
        );

        lines.push(
            `Total Income: ${report.financial.totalIncome}`
        );

        lines.push(
            `Total Expenses: ${report.financial.totalExpenses}`
        );

        lines.push(
            `Net Income: ${report.financial.netIncome}`
        );

        lines.push('');

        lines.push(
            'RECONCILIATION'
        );

        lines.push(
            `Total: ${report.reconciliation.total}`
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
            'SETTLEMENTS'
        );

        lines.push(
            `Settlement Reliability: ${report.settlements.reliability}%`
        );

        lines.push(
            `Successful: ${report.settlements.successful}`
        );

        lines.push(
            `Failed: ${report.settlements.failed}`
        );

        lines.push('');

        lines.push(
            'DATA QUALITY'
        );

        lines.push(
            `Status: ${report.dataQuality.status}`
        );

        lines.push(
            `Completeness: ${report.dataQuality.completeness}%`
        );

        lines.push('');

        lines.push(
            'VALIDATION'
        );

        lines.push(
            `Status: ${report.validation.status}`
        );

        lines.push(
            `Valid: ${report.validation.valid}`
        );

        lines.push(
            `Errors: ${report.validation.errorCount}`
        );

        lines.push(
            `Warnings: ${report.validation.warningCount}`
        );

        lines.push('');

        lines.push(
            'GOVERNANCE'
        );

        lines.push(
            'Financial mutation allowed: NO'
        );

        lines.push(
            'Report generation is read-only.'
        );

        return lines.join('\n');
    }

    /**
     * =========================================================================
     * Export Sanitization
     * =========================================================================
     */

    _sanitizeExportValue(
        value,
        depth = 0,
        seen = new WeakSet()
    ) {
        if (
            depth > MAX_DEPTH
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
            return Number.isNaN(
                value.getTime()
            )
                ? null
                : value.toISOString();
        }

        if (
            seen.has(value)
        ) {
            return '[CIRCULAR_REFERENCE]';
        }

        seen.add(value);

        if (
            Array.isArray(value)
        ) {
            const output =
                value.map(
                    (item) =>
                        this._sanitizeExportValue(
                            item,
                            depth + 1,
                            seen
                        )
                );

            seen.delete(
                value
            );

            return output;
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
                '_id',
                '__v',
                'rawPayload',
                'rawResponse',
                'stack',
                'stackTrace',
                'debug',
                'debugData'
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
            const normalizedKey =
                safeString(
                    key
                ).toLowerCase();

            if (
                sensitiveFields.has(
                    key
                ) ||
                sensitiveFields.has(
                    normalizedKey
                )
            ) {
                continue;
            }

            if (
                internalFields.has(
                    key
                ) ||
                internalFields.has(
                    normalizedKey
                )
            ) {
                continue;
            }

            if (
                normalizedKey.includes(
                    'password'
                ) ||
                normalizedKey.includes(
                    'client_secret'
                ) ||
                normalizedKey.includes(
                    'private_key'
                ) ||
                normalizedKey.includes(
                    'access_token'
                ) ||
                normalizedKey.includes(
                    'refresh_token'
                )
            ) {
                continue;
            }

            result[key] =
                this._sanitizeExportValue(
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
     * IDs / Titles
     * =========================================================================
     */

    _generateReportId(
        execution
    ) {
        const periodKey =
            [
                execution.period.from
                    .toISOString()
                    .slice(0, 10),

                execution.period.to
                    .toISOString()
                    .slice(0, 10)
            ].join('_');

        return [
            'REG',
            safeString(
                execution.tenantId
            ),
            execution.reportType,
            periodKey,
            crypto.randomBytes(5)
                .toString('hex')
        ].join('-');
    }

    _generateSubmissionId(
        report
    ) {
        return [
            'SUB',
            safeString(
                report.reportId
            ),
            crypto.randomBytes(6)
                .toString('hex')
        ].join('-');
    }

    _getReportTitle(
        reportType
    ) {
        const titles = {
            [REPORT_TYPE.PERIODIC_FINANCIAL]:
                'Periodic Regulatory Financial Report',

            [REPORT_TYPE.STATEMENT]:
                'Regulatory Financial Statement Report',

            [REPORT_TYPE.LIQUIDITY]:
                'Regulatory Liquidity Report',

            [REPORT_TYPE.CAPITAL]:
                'Regulatory Capital Report',

            [REPORT_TYPE.ASSET_QUALITY]:
                'Regulatory Asset Quality Report',

            [REPORT_TYPE.LOAN_PORTFOLIO]:
                'Regulatory Loan Portfolio Report',

            [REPORT_TYPE.DEPOSIT]:
                'Regulatory Deposit Report',

            [REPORT_TYPE.SETTLEMENT]:
                'Regulatory Settlement Report',

            [REPORT_TYPE.RISK]:
                'Regulatory Risk Report',

            [REPORT_TYPE.FRAUD]:
                'Regulatory Fraud Intelligence Report',

            [REPORT_TYPE.AML]:
                'Regulatory AML Report',

            [REPORT_TYPE.OPERATIONS]:
                'Regulatory Operations Report',

            [REPORT_TYPE.CUSTOM]:
                'Custom Regulatory Report'
        };

        return (
            titles[
                reportType
            ] ||
            'Regulatory Financial Report'
        );
    }

    _normalizeFormat(
        format
    ) {
        const normalized =
            safeString(
                format,
                REPORT_FORMAT.JSON
            ).toLowerCase();

        return Object.values(
            REPORT_FORMAT
        ).includes(
            normalized
        )
            ? normalized
            : REPORT_FORMAT.JSON;
    }

    _buildFilename(
        report,
        format
    ) {
        const tenant =
            safeString(
                report.tenantId,
                'tenant'
            )
                .replace(
                    /[^A-Za-z0-9_-]/g,
                    '_'
                );

        const type =
            safeString(
                report.reportType,
                'report'
            )
                .replace(
                    /[^A-Za-z0-9_-]/g,
                    '_'
                );

        const date =
            safeString(
                report.period &&
                report.period.to,
                new Date()
                    .toISOString()
            )
                .slice(
                    0,
                    10
                );

        return [
            'regulatory',
            tenant,
            type,
            date
        ].join('_') +
            `.${format}`;
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

        if (
            !tenantId
        ) {
            throw new Error(
                'RegulatoryReportingService requires tenantId.'
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

        const periodDays =
            Math.min(
                MAX_PERIOD_DAYS,
                Math.max(
                    1,
                    toNumber(
                        context.periodDays,
                        DEFAULT_PERIOD_DAYS
                    )
                )
            );

        if (
            !from
        ) {
            from =
                new Date(
                    to.getTime()
                );

            from.setDate(
                from.getDate() -
                    periodDays
            );
        }

        if (
            from > to
        ) {
            throw new Error(
                'Regulatory reporting start date cannot be after end date.'
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
                this._normalizeReportType(
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

    _normalizeReportType(
        type
    ) {
        const normalized =
            safeString(
                type,
                REPORT_TYPE.PERIODIC_FINANCIAL
            ).toUpperCase();

        return Object.values(
            REPORT_TYPE
        ).includes(
            normalized
        )
            ? normalized
            : REPORT_TYPE.CUSTOM;
    }

    _availableSources(
        sourceData
    ) {
        return [
            'dashboard',
            'financialStatements',
            'statements',
            'reconciliation'
        ].filter(
            (source) =>
                sourceData[source] !==
                undefined &&
                sourceData[source] !==
                null
        );
    }

    /**
     * =========================================================================
     * Audit / Metrics
     * =========================================================================
     */

    async _recordAuditEvent(
        event,
        payload,
        context = {}
    ) {
        if (
            !this.auditLogger
        ) {
            return;
        }

        try {
            const auditPayload = {
                event,

                tenantId:
                    payload.tenantId ||
                    context.tenantId,

                reportId:
                    payload.reportId,

                reportType:
                    payload.reportType,

                correlationId:
                    getPath(
                        payload,
                        'metadata.correlationId',
                        context.correlationId
                    ),

                readOnly:
                    true,

                financialMutationAllowed:
                    false,

                timestamp:
                    new Date()
                        .toISOString()
            };

            if (
                typeof this.auditLogger.log ===
                'function'
            ) {
                await this.auditLogger.log(
                    auditPayload
                );

                return;
            }

            if (
                typeof this.auditLogger.record ===
                'function'
            ) {
                await this.auditLogger.record(
                    auditPayload
                );
            }
        } catch (
            error
        ) {
            this._logWarn(
                error,
                'Regulatory reporting audit logging failed.'
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
                typeof this.metricsService
                    .increment ===
                'function'
            ) {
                this.metricsService.increment(
                    metricName,
                    {
                        tenantId:
                            context.tenantId ||
                            payload.tenantId,

                        reportType:
                            payload.reportType,

                        status:
                            payload.status
                    }
                );
            }
        } catch (
            error
        ) {
            this._logWarn(
                error,
                'Regulatory reporting metric recording failed.'
            );
        }
    }

    /**
     * =========================================================================
     * Failure / Logging
     * =========================================================================
     */

    _failureResponse(
        error,
        execution,
        startedAt
    ) {
        return {
            success: false,

            status:
                REPORT_STATUS.FAILED,

            reportId:
                execution
                    ? this._generateReportId(
                        execution
                    )
                    : null,

            reportType:
                execution
                    ? execution.reportType
                    : null,

            tenantId:
                execution
                    ? execution.tenantId
                    : null,

            error: {
                code:
                    error.code ||
                    'REGULATORY_REPORT_GENERATION_FAILED',

                message:
                    error.message ||
                    'Regulatory report generation failed'
            },

            governance: {
                readOnly:
                    true,

                financialMutationAllowed:
                    false
            },

            metadata: {
                service:
                    'RegulatoryReportingService',

                version:
                    this.version,

                correlationId:
                    execution &&
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

                    reportId:
                        context.reportId,

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
 * Standalone Utility
 * ============================================================================
 */

function riskScoreIsCritical(
    value
) {
    const score =
        toNumber(
            value
        );

    return score >= 80;
}

/**
 * ============================================================================
 * Factory
 * ============================================================================
 */

function createRegulatoryReportingService(
    dependencies = {}
) {
    return new RegulatoryReportingService(
        dependencies
    );
}

/**
 * ============================================================================
 * Static Constants
 * ============================================================================
 */

RegulatoryReportingService.REPORT_STATUS =
    REPORT_STATUS;

RegulatoryReportingService.DATA_QUALITY_STATUS =
    DATA_QUALITY_STATUS;

RegulatoryReportingService.SUBMISSION_STATUS =
    SUBMISSION_STATUS;

RegulatoryReportingService.REPORT_FORMAT =
    REPORT_FORMAT;

RegulatoryReportingService.REPORT_TYPE =
    REPORT_TYPE;

RegulatoryReportingService.VALIDATION_SEVERITY =
    VALIDATION_SEVERITY;

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports =
    RegulatoryReportingService;

module.exports.RegulatoryReportingService =
    RegulatoryReportingService;

module.exports.createRegulatoryReportingService =
    createRegulatoryReportingService;

module.exports.REPORT_STATUS =
    REPORT_STATUS;

module.exports.DATA_QUALITY_STATUS =
    DATA_QUALITY_STATUS;

module.exports.SUBMISSION_STATUS =
    SUBMISSION_STATUS;

module.exports.REPORT_FORMAT =
    REPORT_FORMAT;

module.exports.REPORT_TYPE =
    REPORT_TYPE;

module.exports.VALIDATION_SEVERITY =
    VALIDATION_SEVERITY;