'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Airtel Money Enterprise Reconciliation Reporter
 * =============================================================================
 *
 * File
 * ----
 * backend/modules/payment/airtel/reconciliation/reconciliationReporter.js
 *
 * Architectural Role
 * ------------------
 * Enterprise reporting and analytics projection boundary for Airtel
 * reconciliation outcomes.
 *
 * The reporter transforms already-produced reconciliation evidence into
 * operational, exception, settlement and executive reporting artifacts.
 * It is read/projection-oriented and must never become a reconciliation engine
 * or a financial accounting boundary.
 *
 * Responsibilities
 * ----------------
 * - Generate reconciliation reports from supplied reconciliation data.
 * - Aggregate reconciliation outcomes.
 * - Produce exception-oriented reporting.
 * - Produce settlement health summaries.
 * - Produce executive operational summaries.
 * - Provide regulatory-reporting integration hooks.
 * - Maintain tenant isolation.
 * - Preserve reconciliation/report correlation identifiers.
 * - Persist generated reports.
 * - Prepare reports for export.
 * - Integrate audit recording.
 * - Publish safe report lifecycle events.
 * - Instrument metrics and tracing.
 * - Expose operational health and diagnostics.
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * - Performing reconciliation.
 * - Transaction matching.
 * - Provider API calls.
 * - Provider status polling.
 * - Settlement execution.
 * - Ledger posting.
 * - Wallet/balance mutation.
 * - Financial repair.
 * - Compliance determinations.
 * - Regulatory interpretation.
 *
 * Financial Safety Principles
 * ---------------------------
 * 1. Reports are projections of reconciliation evidence; they are not
 *    authoritative financial records.
 * 2. The reporter never mutates balances, ledgers or financial transactions.
 * 3. Monetary amounts are preserved as decimal strings or exact serialized
 *    values rather than floating-point calculations where practical.
 * 4. Raw provider requests/responses are never embedded into generated events.
 * 5. TenantId is mandatory for report generation and tenant-scoped retrieval.
 * 6. Reports must be reproducible from their supplied source data and metadata.
 *
 * Security Principles
 * -------------------
 * - Sanitize report metadata before persistence/events.
 * - Exclude credentials, access tokens, signatures and raw provider payloads.
 * - Bound arrays and object sizes.
 * - Do not expose internal persistence fields unnecessarily in lifecycle events.
 * - Preserve correlation/execution identifiers for auditability.
 *
 * Reporting Principles
 * --------------------
 * - A report summarizes supplied evidence; it does not invent missing data.
 * - "Reconciliation rate" is an operational metric, not a probability.
 * - Report status describes report generation, not settlement/accounting state.
 * - Export failures must not alter the underlying report.
 *
 * Module Format
 * -------------
 * CommonJS.
 *
 * =============================================================================
 */

const crypto = require('crypto');

const {
    normalizeError
} = require('../../shared/errors');

const PROVIDER = 'AIRTEL';
const COMPONENT = 'ReconciliationReporter';
const VERSION = '1.0.0';

const REPORT_STATUS = Object.freeze({

    GENERATED:
        'GENERATED',

    FAILED:
        'FAILED',

    PARTIAL:
        'PARTIAL'

});

const REPORT_TYPES = Object.freeze({

    DAILY:
        'DAILY',

    SETTLEMENT:
        'SETTLEMENT',

    EXCEPTION:
        'EXCEPTION',

    REGULATORY:
        'REGULATORY',

    EXECUTIVE:
        'EXECUTIVE'

});

const EXPORT_FORMATS = Object.freeze({

    JSON:
        'JSON',

    CSV:
        'CSV',

    XLSX:
        'XLSX',

    PDF:
        'PDF'

});

const SENSITIVE_KEYS = new Set([
    'authorization',
    'cookie',
    'set-cookie',
    'password',
    'passcode',
    'pin',
    'otp',
    'token',
    'access_token',
    'refresh_token',
    'client_secret',
    'clientSecret',
    'secret',
    'api_key',
    'apiKey',
    'signature',
    'x-signature',
    'raw',
    'body',
    'requestBody',
    'responseBody',
    'providerRequest',
    'providerResponse',
    'credentials'
]);

const MAX_STRING_LENGTH = 512;
const MAX_REPORT_METADATA_KEYS = 100;
const MAX_EXCEPTION_RECORDS = 10_000;
const MAX_TRANSACTION_RECORDS = 100_000;
const MAX_REPORT_DATA_DEPTH = 5;
const DEFAULT_RETENTION_DAYS = 365;

function truncate(
    value,
    maxLength = MAX_STRING_LENGTH
) {

    if (
        value === null ||
        value === undefined
    ) {
        return value;
    }

    const stringValue =
        String(value);

    return stringValue.length <= maxLength
        ? stringValue
        : `${stringValue.slice(0, maxLength)}…`;
}

function sanitizeValue(
    value,
    key = '',
    depth = 0
) {

    if (
        depth > MAX_REPORT_DATA_DEPTH
    ) {
        return '[TRUNCATED]';
    }

    if (
        value === null ||
        value === undefined
    ) {
        return value;
    }

    const normalizedKey =
        String(key || '')
            .toLowerCase();

    if (
        SENSITIVE_KEYS.has(key) ||
        SENSITIVE_KEYS.has(normalizedKey)
    ) {
        return '[REDACTED]';
    }

    if (
        typeof value === 'string'
    ) {
        return truncate(value);
    }

    if (
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        return value;
    }

    if (
        typeof value === 'bigint'
    ) {
        return value.toString();
    }

    if (
        value instanceof Date
    ) {
        return value.toISOString();
    }

    if (
        Array.isArray(value)
    ) {

        return value
            .slice(
                0,
                MAX_EXCEPTION_RECORDS
            )
            .map(
                item =>
                    sanitizeValue(
                        item,
                        '',
                        depth + 1
                    )
            );
    }

    if (
        typeof value === 'object'
    ) {

        const output = {};

        for (
            const [
                childKey,
                childValue
            ] of Object.entries(value)
                .slice(
                    0,
                    MAX_REPORT_METADATA_KEYS
                )
        ) {

            if (
                childKey === '__proto__' ||
                childKey === 'prototype' ||
                childKey === 'constructor'
            ) {
                continue;
            }

            output[childKey] =
                sanitizeValue(
                    childValue,
                    childKey,
                    depth + 1
                );
        }

        return output;
    }

    return truncate(value);
}

function safeError(
    error
) {

    return {

        name:
            truncate(
                error?.name ||
                'Error',
                128
            ),

        message:
            truncate(
                error?.message ||
                String(error || 'Unknown error'),
                1_000
            ),

        code:
            truncate(
                error?.code,
                128
            ),

        statusCode:
            Number.isFinite(
                error?.statusCode
            )
                ? error.statusCode
                : undefined

    };
}

function normalizeTenantId(
    tenantId
) {

    if (
        tenantId === null ||
        tenantId === undefined
    ) {
        return null;
    }

    const normalized =
        String(
            typeof tenantId === 'object' &&
            typeof tenantId.toString === 'function'
                ? tenantId.toString()
                : tenantId
        )
            .trim();

    return normalized
        ? truncate(
            normalized,
            128
        )
        : null;
}

function requireTenantId(
    tenantId
) {

    const normalized =
        normalizeTenantId(
            tenantId
        );

    if (!normalized) {

        throw new Error(
            'tenantId is required for Airtel reconciliation reporting'
        );
    }

    return normalized;
}

function normalizeIdentifier(
    value,
    fieldName
) {

    if (
        value === null ||
        value === undefined
    ) {

        throw new Error(
            `${fieldName} is required`
        );
    }

    const normalized =
        String(value)
            .trim();

    if (!normalized) {

        throw new Error(
            `${fieldName} is required`
        );
    }

    return truncate(
        normalized,
        256
    );
}

function normalizeReportType(
    type
) {

    const normalized =
        String(
            type ||
            REPORT_TYPES.DAILY
        )
            .trim()
            .toUpperCase();

    if (
        !Object.values(
            REPORT_TYPES
        ).includes(
            normalized
        )
    ) {

        throw new Error(
            `Unsupported reconciliation report type: ${normalized}`
        );
    }

    return normalized;
}

function normalizeExportFormat(
    format
) {

    const normalized =
        String(
            format ||
            EXPORT_FORMATS.JSON
        )
            .trim()
            .toUpperCase();

    if (
        !Object.values(
            EXPORT_FORMATS
        ).includes(
            normalized
        )
    ) {

        throw new Error(
            `Unsupported reconciliation report export format: ${normalized}`
        );
    }

    return normalized;
}

function normalizeDate(
    value
) {

    const date =
        new Date(value);

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {

        throw new Error(
            'Invalid reporting date'
        );
    }

    return date;
}

function normalizeCount(
    value
) {

    const numeric =
        Number(value);

    if (
        !Number.isFinite(
            numeric
        ) ||
        numeric < 0
    ) {
        return 0;
    }

    return Math.floor(
        numeric
    );
}

function normalizeMoney(
    value
) {

    if (
        value === null ||
        value === undefined
    ) {
        return '0';
    }

    /*
     * Report values remain strings. They are not converted into Number because
     * financial totals may exceed the exact integer/decimal precision safely
     * represented by JavaScript Number.
     */
    return String(value);
}

function normalizeRate(
    value
) {

    const numeric =
        Number(value);

    if (
        !Number.isFinite(
            numeric
        )
    ) {
        return 0;
    }

    return Math.min(
        100,
        Math.max(
            0,
            Number(
                numeric.toFixed(2)
            )
        )
    );
}

function extractTransactionCount(
    data
) {

    if (
        Number.isFinite(
            Number(
                data?.transactionCount
            )
        )
    ) {

        return normalizeCount(
            data.transactionCount
        );
    }

    if (
        Array.isArray(
            data?.transactions
        )
    ) {

        return Math.min(
            data.transactions.length,
            MAX_TRANSACTION_RECORDS
        );
    }

    return 0;
}

class ReconciliationReporter {

    constructor({

        repository,

        storage,

        auditService,

        eventBus,

        outboxService,

        eventPublisher,

        metrics,

        logger,

        tracer,

        exportService,

        tenantResolver,

        authorizationService,

        clock = Date,

        retentionDays =
            process.env.AIRTEL_RECONCILIATION_REPORT_RETENTION_DAYS ||
            DEFAULT_RETENTION_DAYS,

        maxExceptions =
            MAX_EXCEPTION_RECORDS,

        includeTransactionDetail =
            false

    } = {}) {

        this.repository =
            repository;

        this.storage =
            storage;

        this.auditService =
            auditService;

        this.eventBus =
            eventBus;

        this.outboxService =
            outboxService;

        this.eventPublisher =
            eventPublisher;

        this.metrics =
            metrics;

        this.logger =
            logger;

        this.tracer =
            tracer;

        this.exportService =
            exportService;

        this.tenantResolver =
            tenantResolver;

        this.authorizationService =
            authorizationService;

        this.clock =
            clock;

        this.retentionDays =
            this.normalizeRetentionDays(
                retentionDays
            );

        this.maxExceptions =
            Math.max(
                1,
                Math.floor(
                    Number(maxExceptions) ||
                    MAX_EXCEPTION_RECORDS
                )
            );

        this.includeTransactionDetail =
            Boolean(
                includeTransactionDetail
            );

        this.statistics = {

            generated:
                0,

            partial:
                0,

            failed:
                0,

            exported:
                0,

            exportFailed:
                0,

            exceptionsReported:
                0,

            transactionsReported:
                0

        };

        this.healthState = {

            status:
                'INITIALIZING',

            startedAt:
                this.now(),

            lastGenerated:
                null,

            lastExported:
                null,

            lastError:
                null

        };

        this.initialized =
            false;
    }

    /**
     * =========================================================================
     * Initialize
     * =========================================================================
     */

    async initialize() {

        this.validateDependencies();

        this.initialized =
            true;

        this.healthState.status =
            'READY';

        this.logger?.info?.({

            provider:
                PROVIDER,

            component:
                COMPONENT,

            message:
                'Airtel reconciliation reporter initialized'

        });

        this.metrics?.counter?.(
            'payment_airtel_reconciliation_reporter_initialized_total',
            1
        );

        return true;
    }

    /**
     * =========================================================================
     * Generate Report
     * =========================================================================
     */

    async generate({

        tenantId,

        type =
            REPORT_TYPES.DAILY,

        reconciliationId = null,

        data = {},

        correlationId =
            crypto.randomUUID(),

        executionId = null,

        generatedBy = null,

        metadata = {},

        session = null

    } = {}) {

        const span =
            this.startSpan(
                'airtel.reconciliation.report.generate',
                {
                    tenantId,
                    reconciliationId,
                    correlationId,
                    executionId
                }
            );

        const startedAt =
            Date.now();

        try {

            const normalizedTenantId =
                requireTenantId(
                    tenantId
                );

            const normalizedType =
                normalizeReportType(
                    type
                );

            const normalizedCorrelationId =
                normalizeIdentifier(
                    correlationId,
                    'correlationId'
                );

            const normalizedReconciliationId =
                reconciliationId
                    ? normalizeIdentifier(
                        reconciliationId,
                        'reconciliationId'
                    )
                    : null;

            const safeData =
                this.projectReportData(
                    data
                );

            const summary =
                this.buildSummary(
                    safeData
                );

            const exceptions =
                this.extractExceptions(
                    safeData
                );

            const generatedAt =
                this.now();

            const report = {

                id:
                    crypto.randomUUID(),

                reportId:
                    null,

                tenantId:
                    normalizedTenantId,

                provider:
                    PROVIDER,

                type:
                    normalizedType,

                reconciliationId:
                    normalizedReconciliationId,

                correlationId:
                    normalizedCorrelationId,

                executionId:
                    executionId
                        ? normalizeIdentifier(
                            executionId,
                            'executionId'
                        )
                        : null,

                status:
                    this.determineReportStatus(
                        summary,
                        exceptions
                    ),

                generatedAt,

                retentionUntil:
                    this.calculateRetentionUntil(
                        generatedAt
                    ),

                generatedBy:
                    this.safeActor(
                        generatedBy
                    ),

                metadata:
                    this.sanitizeMetadata(
                        metadata
                    ),

                summary,

                exceptions,

                /*
                 * Full detail is optional and disabled by default. The default
                 * report remains summary/exception-oriented rather than becoming
                 * an uncontrolled dump of transaction records.
                 */
                data:
                    this.includeTransactionDetail
                        ? safeData
                        : this.projectNonTransactionalData(
                            safeData
                        )

            };

            report.reportId =
                report.id;

            const stored =
                await this.createRepositoryRecord(
                    report,
                    {
                        tenantId:
                            normalizedTenantId,
                        session
                    }
                );

            this.statistics.generated++;

            this.statistics.transactionsReported +=
                summary.totalTransactions;

            this.statistics.exceptionsReported +=
                exceptions.length;

            if (
                report.status ===
                REPORT_STATUS.PARTIAL
            ) {

                this.statistics.partial++;
            }

            this.healthState.lastGenerated =
                generatedAt;

            this.healthState.lastError =
                null;

            await this.recordAuditSafe({

                action:
                    'AIRTEL_RECONCILIATION_REPORT_GENERATED',

                tenantId:
                    normalizedTenantId,

                reportId:
                    report.id,

                reconciliationId:
                    normalizedReconciliationId,

                correlationId:
                    normalizedCorrelationId,

                executionId,

                type:
                    normalizedType,

                status:
                    report.status,

                summary

            });

            await this.publishReportEvent({

                type:
                    'RECONCILIATION_REPORT_CREATED',

                tenantId:
                    normalizedTenantId,

                report:

                    this.safeReportProjection(
                        stored
                    ),

                correlationId:
                    normalizedCorrelationId,

                executionId

            });

            this.metrics?.counter?.(
                'payment_airtel_reconciliation_report_generated_total',
                1
            );

            this.metrics?.histogram?.(
                'payment_airtel_reconciliation_report_generation_duration_ms',
                Date.now() - startedAt
            );

            return stored;

        } catch (error) {

            this.statistics.failed++;

            this.setHealthError(
                error
            );

            this.metrics?.counter?.(
                'payment_airtel_reconciliation_report_generation_failure_total',
                1
            );

            this.metrics?.histogram?.(
                'payment_airtel_reconciliation_report_generation_duration_ms',
                Date.now() - startedAt
            );

            throw normalizeError(
                error,
                {
                    metadata: {

                        operation:
                            'airtel_reconciliation_report_generation'

                    }
                }
            );

        } finally {

            span?.end?.();
        }
    }

    /**
     * =========================================================================
     * Build Summary
     * =========================================================================
     */

    buildSummary(
        data = {}
    ) {

        const totalTransactions =
            extractTransactionCount(
                data
            );

        const matched =
            normalizeCount(
                data.matched ??
                data.summary?.matched
            );

        const unmatched =
            normalizeCount(
                data.unmatched ??
                data.summary?.unmatched ??
                Math.max(
                    0,
                    totalTransactions -
                    matched
                )
            );

        const partial =
            normalizeCount(
                data.partial ??
                data.summary?.partial
            );

        const missingProvider =
            normalizeCount(
                data.missingProvider ??
                data.summary?.missingProvider
            );

        const missingLedger =
            normalizeCount(
                data.missingLedger ??
                data.summary?.missingLedger
            );

        const duplicateProvider =
            normalizeCount(
                data.duplicateProvider ??
                data.summary?.duplicateProvider
            );

        const duplicateLedger =
            normalizeCount(
                data.duplicateLedger ??
                data.summary?.duplicateLedger
            );

        const amountMismatch =
            normalizeCount(
                data.amountMismatch ??
                data.summary?.amountMismatch
            );

        const currencyMismatch =
            normalizeCount(
                data.currencyMismatch ??
                data.summary?.currencyMismatch
            );

        const invalidRecords =
            normalizeCount(
                data.invalidRecords ??
                data.summary?.invalidRecords
            );

        const exceptionCount =
            normalizeCount(
                data.exceptions?.length ??
                data.summary?.exceptions ??
                0
            );

        const variance =
            normalizeMoney(
                data.variance ??
                data.summary?.variance ??
                '0'
            );

        const totalProviderAmount =
            data.totalProviderAmount ??
            data.summary?.totalProviderAmount;

        const totalLedgerAmount =
            data.totalLedgerAmount ??
            data.summary?.totalLedgerAmount;

        const reconciliationRate =
            this.calculateRate(
                matched,
                totalTransactions
            );

        return {

            totalTransactions,

            matched,

            unmatched,

            partial,

            missingProvider,

            missingLedger,

            duplicateProvider,

            duplicateLedger,

            amountMismatch,

            currencyMismatch,

            invalidRecords,

            exceptions:
                exceptionCount,

            variance,

            totalProviderAmount:
                totalProviderAmount !== undefined
                    ? normalizeMoney(
                        totalProviderAmount
                    )
                    : undefined,

            totalLedgerAmount:
                totalLedgerAmount !== undefined
                    ? normalizeMoney(
                        totalLedgerAmount
                    )
                    : undefined,

            reconciliationRate,

            exceptionRate:
                this.calculateRate(
                    exceptionCount,
                    totalTransactions
                )

        };
    }

    /**
     * =========================================================================
     * Exception Extraction
     * =========================================================================
     */

    extractExceptions(
        data = {}
    ) {

        const exceptions =
            Array.isArray(
                data.exceptions
            )
                ? data.exceptions
                : [];

        return exceptions
            .slice(
                0,
                this.maxExceptions
            )
            .map(
                exception =>
                    this.projectException(
                        exception
                    )
            );
    }

    projectException(
        exception
    ) {

        if (
            exception === null ||
            exception === undefined
        ) {
            return null;
        }

        if (
            typeof exception !== 'object'
        ) {

            return {

                exceptionId:
                    crypto.randomUUID(),

                status:
                    'UNKNOWN',

                reason:
                    truncate(
                        String(exception),
                        1_000
                    )

            };
        }

        return sanitizeValue({

            exceptionId:
                exception.exceptionId ??
                exception.id ??
                crypto.randomUUID(),

            status:
                exception.status,

            type:
                exception.type,

            reference:
                exception.reference,

            side:
                exception.side,

            reason:
                exception.reason,

            amountDifferenceMinor:
                exception.amountDifferenceMinor,

            providerAmount:
                exception.providerAmount,

            ledgerAmount:
                exception.ledgerAmount,

            providerCurrency:
                exception.providerCurrency,

            ledgerCurrency:
                exception.ledgerCurrency,

            providerCount:
                exception.providerCount,

            ledgerCount:
                exception.ledgerCount,

            createdAt:
                exception.createdAt

        });
    }

    /**
     * =========================================================================
     * Export Report
     * =========================================================================
     */

    async export({

        tenantId,

        reportId,

        format =
            EXPORT_FORMATS.JSON,

        correlationId =
            crypto.randomUUID(),

        requestedBy = null,

        session = null

    } = {}) {

        const span =
            this.startSpan(
                'airtel.reconciliation.report.export',
                {
                    tenantId,
                    reportId,
                    correlationId
                }
            );

        try {

            const normalizedTenantId =
                requireTenantId(
                    tenantId
                );

            const normalizedReportId =
                normalizeIdentifier(
                    reportId,
                    'reportId'
                );

            const normalizedFormat =
                normalizeExportFormat(
                    format
                );

            const report =
                await this.findReport({
                    tenantId:
                        normalizedTenantId,
                    reportId:
                        normalizedReportId,
                    session
                });

            if (!report) {

                const error =
                    new Error(
                        'Reconciliation report not found'
                    );

                error.code =
                    'AIRTEL_RECONCILIATION_REPORT_NOT_FOUND';

                throw error;
            }

            await this.authorizeExport({

                tenantId:
                    normalizedTenantId,

                report,

                format:
                    normalizedFormat,

                requestedBy

            });

            const exportProjection =
                this.safeReportForExport(
                    report
                );

            let result;

            if (
                this.exportService &&
                typeof this.exportService.export ===
                'function'
            ) {

                result =
                    await this.exportService.export({

                        report:
                            exportProjection,

                        format:
                            normalizedFormat,

                        tenantId:
                            normalizedTenantId,

                        correlationId

                    });

            } else if (
                this.storage &&
                typeof this.storage.write ===
                'function'
            ) {

                result =
                    await this.storage.write({

                        report:
                            exportProjection,

                        format:
                            normalizedFormat,

                        tenantId:
                            normalizedTenantId,

                        correlationId

                    });

            } else {

                if (
                    normalizedFormat !==
                    EXPORT_FORMATS.JSON
                ) {

                    const error =
                        new Error(
                            `No export service configured for ${normalizedFormat}`
                        );

                    error.code =
                        'AIRTEL_RECONCILIATION_EXPORT_SERVICE_NOT_CONFIGURED';

                    throw error;
                }

                result =
                    exportProjection;
            }

            this.statistics.exported++;

            this.healthState.lastExported =
                this.now();

            await this.recordAuditSafe({

                action:
                    'RECONCILIATION_REPORT_EXPORTED',

                tenantId:
                    normalizedTenantId,

                reportId:
                    normalizedReportId,

                format:
                    normalizedFormat,

                correlationId,

                requestedBy:
                    this.safeActor(
                        requestedBy
                    )

            });

            this.metrics?.counter?.(
                'payment_airtel_reconciliation_report_exported_total',
                1
            );

            return result;

        } catch (error) {

            this.statistics.exportFailed++;

            this.setHealthError(
                error
            );

            this.metrics?.counter?.(
                'payment_airtel_reconciliation_report_export_failure_total',
                1
            );

            throw normalizeError(
                error,
                {
                    metadata: {

                        operation:
                            'airtel_reconciliation_report_export'

                    }
                }
            );

        } finally {

            span?.end?.();
        }
    }

    /**
     * =========================================================================
     * Exception Report
     * =========================================================================
     */

    async exceptionReport({

        tenantId,

        exceptions = [],

        reconciliationId = null,

        correlationId =
            crypto.randomUUID(),

        metadata = {}

    } = {}) {

        return this.generate({

            tenantId,

            type:
                REPORT_TYPES.EXCEPTION,

            reconciliationId,

            correlationId,

            metadata,

            data: {

                exceptions,

                transactionCount:
                    exceptions.length,

                unmatched:
                    exceptions.length

            }

        });
    }

    /**
     * =========================================================================
     * Settlement Report
     * =========================================================================
     */

    async settlementReport({

        tenantId,

        reconciliationId = null,

        data = {},

        correlationId =
            crypto.randomUUID(),

        metadata = {}

    } = {}) {

        return this.generate({

            tenantId,

            type:
                REPORT_TYPES.SETTLEMENT,

            reconciliationId,

            correlationId,

            metadata,

            data

        });
    }

    /**
     * =========================================================================
     * Executive Summary
     * =========================================================================
     */

    async executiveSummary({

        tenantId,

        period,

        metrics = {},

        reconciliationId = null,

        correlationId =
            crypto.randomUUID(),

        metadata = {}

    } = {}) {

        return this.generate({

            tenantId,

            type:
                REPORT_TYPES.EXECUTIVE,

            reconciliationId,

            correlationId,

            metadata,

            data: {

                period,

                metrics

            }

        });
    }

    /**
     * =========================================================================
     * Regulatory Report Hook
     * =========================================================================
     *
     * This method provides a reporting integration point only. It does not
     * decide whether a report is legally/regulatorily required or sufficient.
     */

    async regulatoryReport({

        tenantId,

        period,

        data = {},

        reconciliationId = null,

        correlationId =
            crypto.randomUUID(),

        metadata = {}

    } = {}) {

        return this.generate({

            tenantId,

            type:
                REPORT_TYPES.REGULATORY,

            reconciliationId,

            correlationId,

            metadata,

            data: {

                period,

                ...data

            }

        });
    }

    /**
     * =========================================================================
     * Calculate Percentage
     * =========================================================================
     */

    calculateRate(
        value,
        total
    ) {

        const normalizedValue =
            normalizeCount(
                value
            );

        const normalizedTotal =
            normalizeCount(
                total
            );

        if (
            normalizedTotal === 0
        ) {
            return 0;
        }

        return normalizeRate(
            (
                normalizedValue /
                normalizedTotal
            ) * 100
        );
    }

    /**
     * =========================================================================
     * Report Status
     * =========================================================================
     */

    determineReportStatus(
        summary,
        exceptions
    ) {

        if (
            !summary ||
            !Array.isArray(
                exceptions
            )
        ) {

            return REPORT_STATUS.FAILED;
        }

        if (
            exceptions.length > 0 ||
            summary.unmatched > 0 ||
            summary.missingProvider > 0 ||
            summary.missingLedger > 0 ||
            summary.duplicateProvider > 0 ||
            summary.duplicateLedger > 0 ||
            summary.amountMismatch > 0 ||
            summary.currencyMismatch > 0 ||
            summary.invalidRecords > 0
        ) {

            return REPORT_STATUS.PARTIAL;
        }

        return REPORT_STATUS.GENERATED;
    }

    /**
     * =========================================================================
     * Repository
     * =========================================================================
     */

    async createRepositoryRecord(
        report,
        {
            tenantId,
            session = null
        } = {}
    ) {

        if (
            !this.repository ||
            typeof this.repository.create !==
            'function'
        ) {

            throw new Error(
                'Reconciliation report repository create operation required'
            );
        }

        if (
            typeof this.repository.createForTenant ===
            'function'
        ) {

            return this.repository.createForTenant(
                tenantId,
                report,
                {
                    session
                }
            );
        }

        return this.repository.create(
            report,
            {
                tenantId,
                session
            }
        );
    }

    async findReport({

        tenantId,

        reportId,

        session

    }) {

        if (
            typeof this.repository.findByIdForTenant ===
            'function'
        ) {

            return this.repository.findByIdForTenant(
                tenantId,
                reportId,
                {
                    session
                }
            );
        }

        if (
            typeof this.repository.findOne ===
            'function'
        ) {

            return this.repository.findOne({

                tenantId,

                $or: [

                    {
                        reportId
                    },

                    {
                        id:
                            reportId
                    },

                    {
                        _id:
                            reportId
                    }

                ]

            }, {
                session
            });
        }

        if (
            typeof this.repository.findById ===
            'function'
        ) {

            return this.repository.findById(
                reportId,
                {
                    tenantId,
                    session
                }
            );
        }

        throw new Error(
            'Reconciliation report repository lookup operation required'
        );
    }

    /**
     * =========================================================================
     * Authorization Hook
     * =========================================================================
     */

    async authorizeExport({
        tenantId,
        report,
        format,
        requestedBy
    }) {

        if (
            !this.authorizationService ||
            typeof this.authorizationService.authorize !==
            'function'
        ) {
            return true;
        }

        const authorized =
            await this.authorizationService.authorize({

                action:
                    'AIRTEL_RECONCILIATION_REPORT_EXPORT',

                tenantId,

                reportId:
                    report?.reportId ??
                    report?.id,

                format,

                requestedBy

            });

        if (
            authorized === false
        ) {

            const error =
                new Error(
                    'Reconciliation report export not authorized'
                );

            error.code =
                'AIRTEL_RECONCILIATION_REPORT_EXPORT_NOT_AUTHORIZED';

            throw error;
        }

        return true;
    }

    /**
     * =========================================================================
     * Audit
     * =========================================================================
     */

    async recordAuditSafe(
        record
    ) {

        if (
            !this.auditService ||
            typeof this.auditService.record !==
            'function'
        ) {
            return false;
        }

        try {

            await this.auditService.record(
                sanitizeValue({

                    provider:
                        PROVIDER,

                    component:
                        COMPONENT,

                    occurredAt:
                        this.now(),

                    ...record

                })
            );

            this.metrics?.counter?.(
                'payment_airtel_reconciliation_report_audit_success_total',
                1
            );

            return true;

        } catch (error) {

            this.metrics?.counter?.(
                'payment_airtel_reconciliation_report_audit_failure_total',
                1
            );

            this.logger?.error?.({

                provider:
                    PROVIDER,

                component:
                    COMPONENT,

                message:
                    'Failed to record Airtel reconciliation report audit',

                tenantId:
                    record?.tenantId,

                reportId:
                    record?.reportId,

                error:
                    safeError(error)

            });

            return false;
        }
    }

    /**
     * =========================================================================
     * Event Publication
     * =========================================================================
     */

    async publishReportEvent({

        type,

        tenantId,

        report,

        correlationId,

        executionId

    }) {

        const event = {

            type,

            provider:
                PROVIDER,

            component:
                COMPONENT,

            version:
                VERSION,

            occurredAt:
                this.now().toISOString(),

            tenantId,

            correlationId,

            executionId,

            payload:
                this.safeReportProjection(
                    report
                )

        };

        try {

            if (
                this.outboxService &&
                typeof this.outboxService.publish ===
                'function'
            ) {

                await this.outboxService.publish(
                    event
                );

            } else if (
                this.eventPublisher &&
                typeof this.eventPublisher.publish ===
                'function'
            ) {

                await this.eventPublisher.publish(
                    event
                );

            } else if (
                this.eventBus &&
                typeof this.eventBus.publish ===
                'function'
            ) {

                await this.eventBus.publish(
                    event
                );

            } else {

                return false;
            }

            this.metrics?.counter?.(
                'payment_airtel_reconciliation_report_event_published_total',
                1
            );

            return true;

        } catch (error) {

            this.metrics?.counter?.(
                'payment_airtel_reconciliation_report_event_publish_failure_total',
                1
            );

            this.logger?.error?.({

                provider:
                    PROVIDER,

                component:
                    COMPONENT,

                message:
                    'Failed to publish Airtel reconciliation report event',

                tenantId,

                reportId:
                    report?.reportId ??
                    report?.id,

                correlationId,

                error:
                    safeError(error)

            });

            return false;
        }
    }

    /**
     * =========================================================================
     * Report Data Projection
     * =========================================================================
     */

    projectReportData(
        data
    ) {

        if (
            data === null ||
            data === undefined
        ) {
            return {};
        }

        if (
            typeof data !== 'object' ||
            Array.isArray(data)
        ) {

            throw new TypeError(
                'Report data must be an object'
            );
        }

        const sanitized =
            sanitizeValue(
                data
            );

        if (
            Array.isArray(
                sanitized.transactions
            )
        ) {

            sanitized.transactions =
                sanitized.transactions
                    .slice(
                        0,
                        MAX_TRANSACTION_RECORDS
                    )
                    .map(
                        transaction =>
                            this.safeTransaction(
                                transaction
                            )
                    );
        }

        if (
            Array.isArray(
                sanitized.exceptions
            )
        ) {

            sanitized.exceptions =
                sanitized.exceptions
                    .slice(
                        0,
                        this.maxExceptions
                    )
                    .map(
                        exception =>
                            this.projectException(
                                exception
                            )
                    );
        }

        return sanitized;
    }

    projectNonTransactionalData(
        data
    ) {

        if (
            !data ||
            typeof data !== 'object'
        ) {
            return {};
        }

        const output = {};

        for (
            const [
                key,
                value
            ] of Object.entries(
                data
            )
        ) {

            if (
                key === 'transactions' ||
                key === 'providerTransactions' ||
                key === 'ledgerTransactions'
            ) {
                continue;
            }

            output[key] =
                sanitizeValue(
                    value
                );
        }

        return output;
    }

    safeTransaction(
        transaction
    ) {

        if (
            transaction === null ||
            transaction === undefined
        ) {
            return null;
        }

        if (
            typeof transaction !== 'object'
        ) {

            return truncate(
                transaction
            );
        }

        return sanitizeValue({

            id:
                transaction.id ??
                transaction._id ??
                transaction.transactionId,

            reference:
                transaction.reference,

            providerReference:
                transaction.providerReference,

            transactionReference:
                transaction.transactionReference,

            amount:
                transaction.amount !== undefined
                    ? String(
                        transaction.amount
                    )
                    : undefined,

            currency:
                transaction.currency,

            status:
                transaction.status ??
                transaction.state,

            settlementReference:
                transaction.settlementReference,

            transactionType:
                transaction.transactionType,

            createdAt:
                transaction.createdAt,

            occurredAt:
                transaction.occurredAt,

            transactionDate:
                transaction.transactionDate

        });
    }

    /**
     * =========================================================================
     * Export Projection
     * =========================================================================
     */

    safeReportForExport(
        report
    ) {

        if (
            !report ||
            typeof report !== 'object'
        ) {
            return null;
        }

        return sanitizeValue({

            reportId:
                report.reportId ??
                report.id,

            tenantId:
                report.tenantId,

            provider:
                report.provider,

            type:
                report.type,

            reconciliationId:
                report.reconciliationId,

            correlationId:
                report.correlationId,

            status:
                report.status,

            generatedAt:
                report.generatedAt,

            retentionUntil:
                report.retentionUntil,

            summary:
                report.summary,

            exceptions:
                this.extractExceptions(
                    report
                ),

            data:
                this.includeTransactionDetail
                    ? this.projectReportData(
                        report.data
                    )
                    : this.projectNonTransactionalData(
                        report.data
                    )

        });
    }

    safeReportProjection(
        report
    ) {

        if (
            !report
        ) {
            return null;
        }

        return sanitizeValue({

            reportId:
                report.reportId ??
                report.id,

            tenantId:
                report.tenantId,

            provider:
                PROVIDER,

            type:
                report.type,

            reconciliationId:
                report.reconciliationId,

            correlationId:
                report.correlationId,

            executionId:
                report.executionId,

            status:
                report.status,

            generatedAt:
                report.generatedAt,

            summary:
                report.summary

        });
    }

    sanitizeMetadata(
        metadata
    ) {

        if (
            metadata === null ||
            metadata === undefined
        ) {
            return {};
        }

        if (
            typeof metadata !== 'object' ||
            Array.isArray(metadata)
        ) {

            throw new TypeError(
                'Report metadata must be an object'
            );
        }

        return sanitizeValue(
            metadata
        );
    }

    safeActor(
        actor
    ) {

        if (
            actor === null ||
            actor === undefined
        ) {
            return null;
        }

        if (
            typeof actor !== 'object'
        ) {

            return truncate(
                actor,
                128
            );
        }

        return sanitizeValue({

            id:
                actor.id ??
                actor.userId ??
                actor.actorId,

            type:
                actor.type,

            role:
                actor.role

        });
    }

    /**
     * =========================================================================
     * Retention
     * =========================================================================
     */

    normalizeRetentionDays(
        value
    ) {

        const numeric =
            Number(value);

        if (
            !Number.isFinite(
                numeric
            ) ||
            numeric <= 0
        ) {

            return DEFAULT_RETENTION_DAYS;
        }

        return Math.floor(
            numeric
        );
    }

    calculateRetentionUntil(
        generatedAt
    ) {

        const retentionUntil =
            new Date(
                generatedAt.getTime()
                +
                (
                    this.retentionDays *
                    86_400_000
                )
            );

        return retentionUntil;
    }

    /**
     * =========================================================================
     * Tracing
     * =========================================================================
     */

    startSpan(
        name,
        attributes = {}
    ) {

        if (
            !this.tracer ||
            typeof this.tracer.startSpan !==
            'function'
        ) {
            return null;
        }

        try {

            const span =
                this.tracer.startSpan(
                    name
                );

            span?.setAttribute?.(
                'provider',
                PROVIDER
            );

            span?.setAttribute?.(
                'component',
                COMPONENT
            );

            for (
                const [
                    key,
                    value
                ] of Object.entries(
                    attributes
                )
            ) {

                if (
                    value !== null &&
                    value !== undefined
                ) {

                    span?.setAttribute?.(
                        key,
                        String(value)
                    );
                }
            }

            return span;

        } catch (error) {

            this.logger?.debug?.({

                provider:
                    PROVIDER,

                component:
                    COMPONENT,

                message:
                    'Unable to start Airtel reconciliation reporter trace',

                error:
                    safeError(error)

            });

            return null;
        }
    }

    /**
     * =========================================================================
     * Health
     * =========================================================================
     */

    health() {

        const repositoryAvailable =
            Boolean(
                this.repository
            );

        const repositoryCreateAvailable =
            repositoryAvailable &&
            (
                typeof this.repository.createForTenant ===
                    'function' ||
                typeof this.repository.create ===
                    'function'
            );

        const repositoryLookupAvailable =
            repositoryAvailable &&
            (
                typeof this.repository.findByIdForTenant ===
                    'function' ||
                typeof this.repository.findOne ===
                    'function' ||
                typeof this.repository.findById ===
                    'function'
            );

        let status =
            this.healthState.status;

        if (
            !repositoryCreateAvailable ||
            !repositoryLookupAvailable
        ) {

            status =
                'DOWN';

        } else if (
            status === 'INITIALIZING'
        ) {

            status =
                'DEGRADED';

        } else if (
            status === 'DEGRADED'
        ) {

            status =
                'DEGRADED';

        } else {

            status =
                'UP';
        }

        return {

            provider:
                PROVIDER,

            component:
                COMPONENT,

            version:
                VERSION,

            status,

            initialized:
                this.initialized,

            dependencies: {

                repository:
                    repositoryAvailable,

                repositoryCreate:
                    repositoryCreateAvailable,

                repositoryLookup:
                    repositoryLookupAvailable,

                exportService:
                    Boolean(
                        this.exportService
                    ),

                storage:
                    Boolean(
                        this.storage
                    ),

                auditService:
                    !this.auditService ||
                    typeof this.auditService.record ===
                    'function',

                eventPublisher:
                    Boolean(
                        (
                            this.outboxService &&
                            typeof this.outboxService.publish ===
                            'function'
                        ) ||
                        (
                            this.eventPublisher &&
                            typeof this.eventPublisher.publish ===
                            'function'
                        ) ||
                        (
                            this.eventBus &&
                            typeof this.eventBus.publish ===
                            'function'
                        )
                    )

            },

            startedAt:
                this.healthState.startedAt,

            lastGenerated:
                this.healthState.lastGenerated,

            lastExported:
                this.healthState.lastExported,

            lastError:
                this.healthState.lastError,

            statistics:
                this.stats()

        };
    }

    /**
     * =========================================================================
     * Statistics
     * =========================================================================
     */

    stats() {

        return {

            ...this.statistics,

            initialized:
                this.initialized,

            retentionDays:
                this.retentionDays,

            maxExceptions:
                this.maxExceptions,

            includeTransactionDetail:
                this.includeTransactionDetail

        };
    }

    /**
     * =========================================================================
     * Diagnostics
     * =========================================================================
     */

    diagnostics() {

        return {

            provider:
                PROVIDER,

            component:
                COMPONENT,

            version:
                VERSION,

            configuration: {

                retentionDays:
                    this.retentionDays,

                maxExceptions:
                    this.maxExceptions,

                includeTransactionDetail:
                    this.includeTransactionDetail,

                supportedReportTypes:
                    Object.values(
                        REPORT_TYPES
                    ),

                supportedExportFormats:
                    Object.values(
                        EXPORT_FORMATS
                    )

            },

            statistics:
                this.stats(),

            health: {

                status:
                    this.healthState.status,

                startedAt:
                    this.healthState.startedAt,

                lastGenerated:
                    this.healthState.lastGenerated,

                lastExported:
                    this.healthState.lastExported,

                lastError:
                    this.healthState.lastError

            }

        };
    }

    /**
     * =========================================================================
     * Health Error State
     * =========================================================================
     */

    setHealthError(
        error
    ) {

        this.healthState.status =
            'DEGRADED';

        this.healthState.lastError =
            safeError(
                error
            );
    }

    /**
     * =========================================================================
     * Validation
     * =========================================================================
     */

    validateDependencies() {

        if (
            !this.repository
        ) {

            throw new Error(
                'Reconciliation report repository required'
            );
        }

        const canCreate =
            typeof this.repository.createForTenant ===
                'function' ||
            typeof this.repository.create ===
                'function';

        if (
            !canCreate
        ) {

            throw new Error(
                'Reconciliation report repository create operation required'
            );
        }

        const canLookup =
            typeof this.repository.findByIdForTenant ===
                'function' ||
            typeof this.repository.findOne ===
                'function' ||
            typeof this.repository.findById ===
                'function';

        if (
            !canLookup
        ) {

            throw new Error(
                'Reconciliation report repository lookup operation required'
            );
        }

        return true;
    }

    /**
     * =========================================================================
     * Snapshot
     * =========================================================================
     */

    snapshot() {

        return {

            provider:
                PROVIDER,

            component:
                COMPONENT,

            version:
                VERSION,

            health:
                {
                    ...this.healthState
                },

            statistics:
                {
                    ...this.statistics
                }

        };
    }
}

module.exports = {

    ReconciliationReporter,

    REPORT_STATUS,

    REPORT_TYPES,

    EXPORT_FORMATS,

    PROVIDER,

    COMPONENT,

    VERSION
};