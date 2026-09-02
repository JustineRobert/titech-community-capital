'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Regulatory Validation Service
 * ============================================================================
 *
 * File:
 * backend/modules/compliance/regulatory/RegulatoryValidationService.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Application-service boundary for regulatory report validation.
 *
 * This service orchestrates validation but does NOT contain jurisdiction-
 * specific regulatory rules.
 *
 * Jurisdiction-specific rules remain inside the concrete adapter resolved
 * through RegulatoryAdapterRegistry.
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - Resolve tenant-scoped regulatory adapter
 * - Validate report identity
 * - Validate tenant isolation
 * - Validate report type support
 * - Validate adapter capabilities
 * - Validate regulatory schema
 * - Invoke jurisdiction-specific adapter validation
 * - Invoke reporting calendar validation when available
 * - Invoke threshold validation when available
 * - Normalize errors and warnings
 * - Produce deterministic validation fingerprints
 * - Provide validation provenance
 * - Support strict/warning validation modes
 * - Support validation of transformed regulator payloads
 * - Provide operational diagnostics
 *
 * Explicitly NOT Responsible For
 * ----------------------------------------------------------------------------
 * - Country-specific legislation
 * - Hardcoded regulator thresholds
 * - Hardcoded filing calendars
 * - Regulator schema definitions
 * - Regulator submission transport
 * - Regulator authentication
 * - Ledger posting
 * - Financial calculations
 *
 * Architecture
 * ----------------------------------------------------------------------------
 *
 *                  RegulatoryReportingService
 *                            │
 *                            ▼
 *                RegulatoryValidationService
 *                            │
 *             ┌──────────────┼──────────────┐
 *             ▼              ▼              ▼
 *       Adapter Registry  Calendar       Adapter
 *             │           Service       Validation
 *             │              │              │
 *             └──────────────┼──────────────┘
 *                            ▼
 *                   Validation Result
 *                            │
 *                  ┌─────────┴─────────┐
 *                  ▼                   ▼
 *                VALID               INVALID
 *
 * ============================================================================
 */

const crypto = require('crypto');

const {
    CAPABILITIES,
    REPORT_TYPES,
} = require('./RegulatoryAdapterInterface');

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const SERVICE_NAME =
    'RegulatoryValidationService';

const SERVICE_VERSION =
    '1.0.0';

const DEFAULT_MODE =
    'STRICT';

const VALIDATION_MODES =
    Object.freeze({
        STRICT:
            'STRICT',

        WARN:
            'WARN',

        AUDIT:
            'AUDIT',
    });

const VALIDATION_STATUS =
    Object.freeze({
        VALID:
            'VALID',

        INVALID:
            'INVALID',

        VALID_WITH_WARNINGS:
            'VALID_WITH_WARNINGS',

        NOT_SUPPORTED:
            'NOT_SUPPORTED',

        ERROR:
            'ERROR',
    });

const MAX_REPORT_ID_LENGTH =
    256;

const MAX_TENANT_ID_LENGTH =
    256;

const MAX_ERROR_MESSAGE_LENGTH =
    2000;

const MAX_ERRORS =
    500;

const MAX_WARNINGS =
    500;

const MAX_SCHEMA_ERRORS =
    500;

const MAX_SCHEMA_WARNINGS =
    500;

const MAX_METADATA_KEYS =
    100;

/**
 * ============================================================================
 * Error
 * ============================================================================
 */

class RegulatoryValidationServiceError
    extends Error {

    constructor(
        message,
        code =
            'REGULATORY_VALIDATION_ERROR',
        options = {}
    ) {
        super(
            message
        );

        this.name =
            'RegulatoryValidationServiceError';

        this.code =
            code;

        this.statusCode =
            Number.isInteger(
                options.statusCode
            )
                ? options.statusCode
                : 500;

        this.retryable =
            options.retryable === true;

        this.tenantId =
            options.tenantId ||
            null;

        this.reportId =
            options.reportId ||
            null;

        this.reportType =
            options.reportType ||
            null;

        this.adapterName =
            options.adapterName ||
            null;

        this.jurisdiction =
            options.jurisdiction ||
            null;

        this.regulatorCode =
            options.regulatorCode ||
            null;

        this.requestId =
            options.requestId ||
            null;

        this.correlationId =
            options.correlationId ||
            null;

        this.operation =
            options.operation ||
            null;

        this.cause =
            options.cause;

        this.timestamp =
            new Date();

        Error.captureStackTrace?.(
            this,
            RegulatoryValidationServiceError
        );
    }

    toJSON() {
        return {
            name:
                this.name,

            code:
                this.code,

            message:
                this.message,

            statusCode:
                this.statusCode,

            retryable:
                this.retryable,

            tenantId:
                this.tenantId,

            reportId:
                this.reportId,

            reportType:
                this.reportType,

            adapterName:
                this.adapterName,

            jurisdiction:
                this.jurisdiction,

            regulatorCode:
                this.regulatorCode,

            requestId:
                this.requestId,

            correlationId:
                this.correlationId,

            operation:
                this.operation,

            timestamp:
                this.timestamp,
        };
    }
}

/**
 * ============================================================================
 * Helpers
 * ============================================================================
 */

function isPlainObject(
    value
) {
    if (
        value === null ||
        typeof value !== 'object'
    ) {
        return false;
    }

    const prototype =
        Object.getPrototypeOf(value);

    return (
        prototype === Object.prototype ||
        prototype === null
    );
}

function normalizeRequiredString(
    value,
    field,
    maxLength
) {
    if (
        typeof value !== 'string' ||
        value.trim() === ''
    ) {
        throw new RegulatoryValidationServiceError(
            `${field} is required.`,
            'REGULATORY_VALIDATION_INVALID_INPUT',
            {
                statusCode:
                    400,
            }
        );
    }

    const normalized =
        value.trim();

    if (
        normalized.length >
        maxLength
    ) {
        throw new RegulatoryValidationServiceError(
            `${field} exceeds maximum length.`,
            'REGULATORY_VALIDATION_INPUT_TOO_LONG',
            {
                statusCode:
                    400,
            }
        );
    }

    return normalized;
}

function normalizeOptionalString(
    value,
    field,
    maxLength
) {
    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {
        return null;
    }

    if (
        typeof value !== 'string'
    ) {
        throw new RegulatoryValidationServiceError(
            `${field} must be a string.`,
            'REGULATORY_VALIDATION_INVALID_INPUT',
            {
                statusCode:
                    400,
            }
        );
    }

    const normalized =
        value.trim();

    if (
        !normalized
    ) {
        return null;
    }

    if (
        normalized.length >
        maxLength
    ) {
        throw new RegulatoryValidationServiceError(
            `${field} exceeds maximum length.`,
            'REGULATORY_VALIDATION_INPUT_TOO_LONG',
            {
                statusCode:
                    400,
            }
        );
    }

    return normalized;
}

function normalizeReportType(
    value
) {
    const type =
        normalizeRequiredString(
            value,
            'report.type',
            64
        ).toUpperCase();

    if (
        !Object.values(
            REPORT_TYPES
        ).includes(
            type
        )
    ) {
        throw new RegulatoryValidationServiceError(
            `Unsupported report type: ${type}`,
            'REGULATORY_VALIDATION_UNSUPPORTED_REPORT_TYPE',
            {
                statusCode:
                    400,
            }
        );
    }

    return type;
}

function normalizeMode(
    value
) {
    const mode =
        String(
            value ||
            DEFAULT_MODE
        )
            .trim()
            .toUpperCase();

    if (
        !Object.values(
            VALIDATION_MODES
        ).includes(
            mode
        )
    ) {
        throw new RegulatoryValidationServiceError(
            `Unsupported validation mode: ${mode}`,
            'REGULATORY_VALIDATION_MODE_INVALID',
            {
                statusCode:
                    400,
            }
        );
    }

    return mode;
}

function cloneValue(
    value,
    seen = new WeakMap()
) {
    if (
        value === null ||
        value === undefined ||
        typeof value !== 'object'
    ) {
        return value;
    }

    if (
        value instanceof Date
    ) {
        return new Date(
            value.getTime()
        );
    }

    if (
        seen.has(value)
    ) {
        return seen.get(
            value
        );
    }

    if (
        Array.isArray(value)
    ) {
        const result = [];

        seen.set(
            value,
            result
        );

        for (
            const item
            of value
        ) {
            result.push(
                cloneValue(
                    item,
                    seen
                )
            );
        }

        return result;
    }

    const result = {};

    seen.set(
        value,
        result
    );

    for (
        const [
            key,
            child
        ] of Object.entries(
            value
        )
    ) {
        result[key] =
            cloneValue(
                child,
                seen
            );
    }

    return result;
}

function deepFreeze(
    value,
    seen = new WeakSet()
) {
    if (
        value === null ||
        typeof value !== 'object' ||
        seen.has(value)
    ) {
        return value;
    }

    if (
        value instanceof Date
    ) {
        return value;
    }

    seen.add(
        value
    );

    for (
        const child
        of Object.values(
            value
        )
    ) {
        deepFreeze(
            child,
            seen
        );
    }

    return Object.freeze(
        value
    );
}

function stableSerialize(
    value
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
        value instanceof Date
    ) {
        return JSON.stringify(
            value.toISOString()
        );
    }

    if (
        Array.isArray(value)
    ) {
        return `[${value
            .map(
                stableSerialize
            )
            .join(',')}]`;
    }

    if (
        typeof value === 'object'
    ) {
        return `{${Object.keys(
            value
        )
            .sort()
            .map(
                key =>
                    `${JSON.stringify(
                        key
                    )}:${stableSerialize(
                        value[key]
                    )}`
            )
            .join(',')}}`;
    }

    return JSON.stringify(
        value
    );
}

function sha256(
    value
) {
    return crypto
        .createHash(
            'sha256'
        )
        .update(
            value,
            'utf8'
        )
        .digest('hex');
}

function normalizeIssue(
    issue,
    fallbackCode,
    fallbackSeverity
) {
    if (
        typeof issue === 'string'
    ) {
        return {
            code:
                fallbackCode,

            message:
                issue.slice(
                    0,
                    MAX_ERROR_MESSAGE_LENGTH
                ),

            severity:
                fallbackSeverity,
        };
    }

    if (
        !issue ||
        typeof issue !== 'object'
    ) {
        return {
            code:
                fallbackCode,

            message:
                'Regulatory validation issue.',

            severity:
                fallbackSeverity,
        };
    }

    return {
        code:
            issue.code ||
            fallbackCode,

        message:
            String(
                issue.message ||
                'Regulatory validation issue.'
            ).slice(
                0,
                MAX_ERROR_MESSAGE_LENGTH
            ),

        field:
            issue.field ||
            issue.path ||
            null,

        path:
            issue.path ||
            null,

        severity:
            issue.severity ||
            fallbackSeverity,

        regulatorCode:
            issue.regulatorCode ||
            null,

        metadata:
            isPlainObject(
                issue.metadata
            )
                ? cloneValue(
                    issue.metadata
                )
                : {},
    };
}

function normalizeIssueList(
    issues,
    {
        fallbackCode,
        severity,
        max,
    }
) {
    if (
        !Array.isArray(
            issues
        )
    ) {
        return [];
    }

    return issues
        .slice(
            0,
            max
        )
        .map(
            issue =>
                normalizeIssue(
                    issue,
                    fallbackCode,
                    severity
                )
        );
}

/**
 * ============================================================================
 * Service
 * ============================================================================
 */

class RegulatoryValidationService {

    constructor(
        options = {}
    ) {

        this.registry =
            options.registry ||
            options.adapterRegistry ||
            null;

        this.calendarService =
            options.calendarService ||
            options.regulatoryCalendarService ||
            null;

        this.logger =
            options.logger ||
            console;

        this.metrics =
            options.metrics ||
            null;

        this.audit =
            options.audit ||
            options.auditService ||
            null;

        this.strict =
            options.strict !== false;

        this.requireAdapter =
            options.requireAdapter !==
                undefined
                ? Boolean(
                    options.requireAdapter
                )
                : true;

        this.requireCalendar =
            options.requireCalendar === true;

        this.allowWarnings =
            options.allowWarnings !==
                undefined
                ? Boolean(
                    options.allowWarnings
                )
                : true;
    }

    /**
     * =========================================================================
     * Main Validation Entry Point
     * =========================================================================
     */

    async validateReport(
        report,
        context = {}
    ) {

        const normalizedContext =
            this.normalizeContext(
                report,
                context
            );

        const startedAt =
            Date.now();

        const validationTrace = {
            checks:
                [],

            errors:
                [],

            warnings:
                [],

            adapter:
                null,

            calendar:
                null,

            schema:
                null,

            thresholds:
                null,

            transformed:
                null,
        };

        try {

            /**
             * ---------------------------------------------------------------
             * Basic report integrity
             * ---------------------------------------------------------------
             */

            this.validateReportIdentity(
                report,
                normalizedContext,
                validationTrace
            );

            /**
             * ---------------------------------------------------------------
             * Resolve adapter
             * ---------------------------------------------------------------
             */

            const adapter =
                this.resolveAdapter(
                    normalizedContext
                );

            validationTrace.adapter =
                adapter?.getIdentity?.() ||
                null;

            this.addCheck(
                validationTrace,
                'ADAPTER_RESOLUTION',
                'PASSED'
            );

            /**
             * ---------------------------------------------------------------
             * Tenant isolation
             * ---------------------------------------------------------------
             */

            this.assertTenantContext(
                report,
                normalizedContext,
                adapter
            );

            this.addCheck(
                validationTrace,
                'TENANT_ISOLATION',
                'PASSED'
            );

            /**
             * ---------------------------------------------------------------
             * Report-type capability
             * ---------------------------------------------------------------
             */

            this.assertReportTypeSupport(
                adapter,
                normalizedContext.reportType
            );

            this.addCheck(
                validationTrace,
                'REPORT_TYPE_SUPPORT',
                'PASSED'
            );

            /**
             * ---------------------------------------------------------------
             * Adapter validation capability
             * ---------------------------------------------------------------
             */

            this.assertCapability(
                adapter,
                CAPABILITIES.VALIDATION
            );

            this.addCheck(
                validationTrace,
                'ADAPTER_VALIDATION_CAPABILITY',
                'PASSED'
            );

            /**
             * ---------------------------------------------------------------
             * Schema validation
             * ---------------------------------------------------------------
             */

            const schemaResult =
                await this.validateSchema(
                    adapter,
                    report,
                    normalizedContext
                );

            validationTrace.schema =
                schemaResult;

            this.addCheck(
                validationTrace,
                'SCHEMA_VALIDATION',
                schemaResult.valid
                    ? 'PASSED'
                    : 'FAILED'
            );

            this.mergeIssues(
                validationTrace,
                schemaResult
            );

            /**
             * ---------------------------------------------------------------
             * Calendar validation
             * ---------------------------------------------------------------
             */

            if (
                this.calendarService
            ) {

                const calendarResult =
                    await this.validateCalendar(
                        report,
                        normalizedContext
                    );

                validationTrace.calendar =
                    calendarResult;

                this.addCheck(
                    validationTrace,
                    'CALENDAR_VALIDATION',
                    calendarResult.valid
                        ? 'PASSED'
                        : 'FAILED'
                );

                this.mergeIssues(
                    validationTrace,
                    calendarResult
                );

            } else if (
                this.requireCalendar
            ) {

                validationTrace.errors.push({
                    code:
                        'REGULATORY_CALENDAR_SERVICE_REQUIRED',

                    message:
                        'Regulatory calendar service is required.',

                    severity:
                        'ERROR',
                });

                this.addCheck(
                    validationTrace,
                    'CALENDAR_VALIDATION',
                    'FAILED'
                );
            }

            /**
             * ---------------------------------------------------------------
             * Threshold validation
             * ---------------------------------------------------------------
             *
             * Threshold rules belong to the adapter.
             */

            const thresholdResult =
                await this.validateThresholds(
                    adapter,
                    report,
                    normalizedContext
                );

            validationTrace.thresholds =
                thresholdResult;

            this.addCheck(
                validationTrace,
                'THRESHOLD_VALIDATION',
                thresholdResult.valid
                    ? 'PASSED'
                    : 'FAILED'
            );

            this.mergeIssues(
                validationTrace,
                thresholdResult
            );

            /**
             * ---------------------------------------------------------------
             * Jurisdiction-specific adapter validation
             * ---------------------------------------------------------------
             */

            const adapterResult =
                await this.validateThroughAdapter(
                    adapter,
                    report,
                    normalizedContext
                );

            this.mergeIssues(
                validationTrace,
                adapterResult
            );

            this.addCheck(
                validationTrace,
                'ADAPTER_VALIDATION',
                adapterResult.valid
                    ? 'PASSED'
                    : 'FAILED'
            );

            /**
             * ---------------------------------------------------------------
             * Optional transformation validation
             * ---------------------------------------------------------------
             *
             * This checks whether the report can be transformed for the
             * regulator without actually submitting it.
             */

            if (
                normalizedContext.validateTransformation
            ) {

                const transformationResult =
                    await this.validateTransformation(
                        adapter,
                        report,
                        normalizedContext
                    );

                validationTrace.transformed =
                    transformationResult;

                this.addCheck(
                    validationTrace,
                    'TRANSFORMATION_VALIDATION',
                    transformationResult.valid
                        ? 'PASSED'
                        : 'FAILED'
                );

                this.mergeIssues(
                    validationTrace,
                    transformationResult
                );
            }

            /**
             * ---------------------------------------------------------------
             * Finalize
             * ---------------------------------------------------------------
             */

            const result =
                this.buildValidationResult(
                    report,
                    normalizedContext,
                    validationTrace,
                    startedAt
                );

            await this.persistAudit(
                'REGULATORY_REPORT_VALIDATED',
                result,
                normalizedContext
            );

            this.incrementMetric(
                'regulatory_validation_total',
                {
                    tenantId:
                        normalizedContext.tenantId,

                    reportType:
                        normalizedContext.reportType,

                    status:
                        result.status,
                }
            );

            return result;

        } catch (
            error
        ) {

            const normalizedError =
                this.normalizeError(
                    error,
                    normalizedContext
                );

            validationTrace.errors.push(
                normalizedError
            );

            const result =
                this.buildValidationResult(
                    report,
                    normalizedContext,
                    validationTrace,
                    startedAt,
                    {
                        fatalError:
                            normalizedError,
                    }
                );

            await this.persistAudit(
                'REGULATORY_REPORT_VALIDATION_ERROR',
                result,
                normalizedContext
            );

            this.incrementMetric(
                'regulatory_validation_errors_total',
                {
                    tenantId:
                        normalizedContext.tenantId,

                    reportType:
                        normalizedContext.reportType,

                    code:
                        normalizedError.code,
                }
            );

            /**
             * Service-level validation errors are returned as structured
             * validation results unless configured as fatal.
             */
            if (
                normalizedContext.throwOnError
            ) {
                throw error;
            }

            return result;
        }
    }

    /**
     * =========================================================================
     * Validate Transformed Payload
     * =========================================================================
     *
     * Useful immediately before submission or in integration tests.
     */

    async validateTransformedReport(
        report,
        transformed,
        context = {}
    ) {

        const normalizedContext =
            this.normalizeContext(
                report,
                {
                    ...context,

                    validateTransformation:
                        true,
                }
            );

        const adapter =
            this.resolveAdapter(
                normalizedContext
            );

        this.assertTenantContext(
            report,
            normalizedContext,
            adapter
        );

        const issues = [];

        if (
            transformed ===
                undefined ||
            transformed === null
        ) {
            issues.push({
                code:
                    'REGULATORY_TRANSFORMED_PAYLOAD_REQUIRED',

                message:
                    'Transformed regulatory payload is required.',

                severity:
                    'ERROR',
            });
        }

        if (
            typeof transformed !==
                'object'
        ) {
            issues.push({
                code:
                    'REGULATORY_TRANSFORMED_PAYLOAD_INVALID',

                message:
                    'Transformed regulatory payload must be an object.',

                severity:
                    'ERROR',
            });
        }

        const result = {
            valid:
                issues.length === 0,

            errors:
                issues.filter(
                    issue =>
                        issue.severity ===
                        'ERROR'
                ),

            warnings:
                issues.filter(
                    issue =>
                        issue.severity ===
                        'WARNING'
                ),

            fingerprint:
                sha256(
                    stableSerialize(
                        transformed
                    )
                ),

            adapter:
                adapter?.getIdentity?.() ||
                null,

            reportId:
                normalizedContext.reportId,

            tenantId:
                normalizedContext.tenantId,

            reportType:
                normalizedContext.reportType,
        };

        return deepFreeze(
            result
        );
    }

    /**
     * =========================================================================
     * Basic Report Identity
     * =========================================================================
     */

    validateReportIdentity(
        report,
        context,
        trace
    ) {

        if (
            !report ||
            typeof report !==
                'object'
        ) {
            throw this.createError(
                'REGULATORY_REPORT_REQUIRED',
                'Regulatory report is required.',
                context,
                {
                    statusCode:
                        400,
                }
            );
        }

        normalizeRequiredString(
            context.tenantId ||
                report.tenantId,
            'tenantId',
            MAX_TENANT_ID_LENGTH
        );

        normalizeRequiredString(
            context.reportId ||
                report.id ||
                report.reportId,
            'reportId',
            MAX_REPORT_ID_LENGTH
        );

        normalizeReportType(
            report.type
        );

        trace.checks.push({
            code:
                'REPORT_IDENTITY',

            status:
                'PASSED',
        });
    }

    /**
     * =========================================================================
     * Adapter Resolution
     * =========================================================================
     */

    resolveAdapter(
        context
    ) {

        if (
            context.adapter
        ) {
            return context.adapter;
        }

        if (
            !this.registry
        ) {

            if (
                this.requireAdapter
            ) {
                throw this.createError(
                    'REGULATORY_VALIDATION_REGISTRY_REQUIRED',
                    'Regulatory adapter registry is required.',
                    context,
                    {
                        retryable:
                            false,
                    }
                );
            }

            return null;
        }

        if (
            typeof this.registry.resolveForReport ===
                'function' &&
            context.report
        ) {
            return this.registry.resolveForReport(
                context.report,
                context
            );
        }

        if (
            typeof this.registry.resolve !==
                'function'
        ) {
            throw this.createError(
                'REGULATORY_VALIDATION_REGISTRY_INVALID',
                'Regulatory adapter registry does not provide resolve().',
                context
            );
        }

        return this.registry.resolve({
            tenantId:
                context.tenantId,

            adapterName:
                context.adapterName,

            version:
                context.adapterVersion ||
                context.version,

            countryCode:
                context.countryCode,

            jurisdiction:
                context.jurisdiction,

            regulatorCode:
                context.regulatorCode,

            reportType:
                context.reportType,

            capability:
                CAPABILITIES.VALIDATION,
        });
    }

    /**
     * =========================================================================
     * Tenant Isolation
     * =========================================================================
     */

    assertTenantContext(
        report,
        context,
        adapter
    ) {

        if (
            !context.tenantId
        ) {
            throw this.createError(
                'REGULATORY_VALIDATION_TENANT_REQUIRED',
                'tenantId is required.',
                context,
                {
                    statusCode:
                        403,

                    retryable:
                        false,
                }
            );
        }

        if (
            report?.tenantId &&
            String(
                report.tenantId
            ) !==
                String(
                    context.tenantId
                )
        ) {
            throw this.createError(
                'REGULATORY_VALIDATION_TENANT_MISMATCH',
                'Report tenant does not match trusted validation context.',
                context,
                {
                    statusCode:
                        403,

                    retryable:
                        false,
                }
            );
        }

        if (
            adapter &&
            typeof adapter.assertTenantContext ===
                'function'
        ) {
            adapter.assertTenantContext(
                report,
                context
            );
        }

        return true;
    }

    /**
     * =========================================================================
     * Report Type Support
     * =========================================================================
     */

    assertReportTypeSupport(
        adapter,
        reportType
    ) {

        if (
            !adapter
        ) {
            if (
                this.requireAdapter
            ) {
                throw this.createError(
                    'REGULATORY_VALIDATION_ADAPTER_REQUIRED',
                    'Regulatory adapter is required.',
                    {
                        reportType,
                    }
                );
            }

            return true;
        }

        if (
            typeof adapter.supportsReportType !==
                'function'
        ) {
            throw this.createError(
                'REGULATORY_VALIDATION_ADAPTER_INVALID',
                'Regulatory adapter cannot determine report-type support.'
            );
        }

        if (
            !adapter.supportsReportType(
                reportType
            )
        ) {
            throw this.createError(
                'REGULATORY_VALIDATION_REPORT_TYPE_UNSUPPORTED',
                `Regulatory adapter does not support report type ${reportType}.`,
                {
                    reportType,
                },
                {
                    statusCode:
                        422,

                    retryable:
                        false,
                }
            );
        }

        return true;
    }

    /**
     * =========================================================================
     * Capability Assertion
     * =========================================================================
     */

    assertCapability(
        adapter,
        capability
    ) {

        if (
            !adapter
        ) {
            throw this.createError(
                'REGULATORY_VALIDATION_ADAPTER_REQUIRED',
                'Regulatory adapter is required.'
            );
        }

        if (
            typeof adapter.supports !==
                'function'
        ) {
            throw this.createError(
                'REGULATORY_VALIDATION_ADAPTER_INVALID',
                'Regulatory adapter does not expose capability discovery.'
            );
        }

        if (
            !adapter.supports(
                capability
            )
        ) {
            throw this.createError(
                'REGULATORY_VALIDATION_CAPABILITY_UNSUPPORTED',
                `Regulatory adapter does not support capability ${capability}.`,
                {
                    capability,
                },
                {
                    retryable:
                        false,
                }
            );
        }

        return true;
    }

    /**
     * =========================================================================
     * Schema Validation
     * =========================================================================
     */

    async validateSchema(
        adapter,
        report,
        context
    ) {

        if (
            !adapter ||
            typeof adapter.getReportSchema !==
                'function'
        ) {
            return {
                valid:
                    true,

                errors:
                    [],

                warnings:
                    [],

                supported:
                    false,
            };
        }

        let schema;

        try {

            schema =
                await adapter.getReportSchema(
                    context.reportType
                );

        } catch (
            error
        ) {

            return {
                valid:
                    false,

                errors: [
                    {
                        code:
                            'REGULATORY_SCHEMA_RESOLUTION_FAILED',

                        message:
                            error?.message ||
                            'Unable to resolve regulatory report schema.',

                        severity:
                            'ERROR',
                    },
                ],

                warnings:
                    [],
            };
        }

        /**
         * Adapter may return:
         *
         * - JSON-schema-like metadata
         * - custom schema object
         * - {supported:false}
         *
         * Schema interpretation remains adapter-owned.
         */

        if (
            schema &&
            schema.supported ===
                false
        ) {
            return {
                valid:
                    false,

                errors: [
                    {
                        code:
                            'REGULATORY_REPORT_SCHEMA_NOT_SUPPORTED',

                        message:
                            'Regulatory schema is not supported for this report type.',

                        severity:
                            'ERROR',
                    },
                ],

                warnings:
                    [],
            };
        }

        /**
         * If the adapter exposes validateSchema(), use it.
         */
        if (
            typeof adapter.validateSchema ===
                'function'
        ) {

            try {

                const result =
                    await adapter.validateSchema(
                        report,
                        schema,
                        context
                    );

                return this.normalizeValidationResult(
                    result,
                    'REGULATORY_SCHEMA_VALIDATION_FAILED'
                );

            } catch (
                error
            ) {

                return {
                    valid:
                        false,

                    errors: [
                        {
                            code:
                                'REGULATORY_SCHEMA_VALIDATION_ERROR',

                            message:
                                error?.message ||
                                'Regulatory schema validation failed.',

                            severity:
                                'ERROR',
                        },
                    ],

                    warnings:
                        [],
                };
            }
        }

        /**
         * Schema presence alone is not enough to claim that a report is valid.
         * Actual semantic validation remains the adapter's responsibility.
         */
        return {
            valid:
                true,

            errors:
                [],

            warnings:
                [],

            schemaResolved:
                true,
        };
    }

    /**
     * =========================================================================
     * Calendar Validation
     * =========================================================================
     */

    async validateCalendar(
        report,
        context
    ) {

        if (
            !this.calendarService
        ) {
            return {
                valid:
                    true,

                errors:
                    [],

                warnings:
                    [],

                supported:
                    false,
            };
        }

        try {

            /**
             * Filing window check.
             */
            if (
                typeof this.calendarService.getFilingWindow ===
                    'function'
            ) {

                const window =
                    await this.calendarService.getFilingWindow(
                        report,
                        context
                    );

                if (
                    window?.status ===
                        'NOT_YET_OPEN'
                ) {
                    return {
                        valid:
                            false,

                        errors: [
                            {
                                code:
                                    'REGULATORY_FILING_WINDOW_NOT_OPEN',

                                message:
                                    'Regulatory filing window is not yet open.',

                                severity:
                                    'ERROR',
                            },
                        ],

                        warnings:
                            [],
                    };
                }

                if (
                    window?.status ===
                        'CLOSED'
                ) {
                    return {
                        valid:
                            false,

                        errors: [
                            {
                                code:
                                    'REGULATORY_FILING_WINDOW_CLOSED',

                                message:
                                    'Regulatory filing window is closed.',

                                severity:
                                    'ERROR',
                            },
                        ],

                        warnings:
                            [],
                    };
                }
            }

            /**
             * Due-date evaluation is informational during validation unless the
             * adapter/calendar explicitly marks a filing as invalid.
             */
            if (
                typeof this.calendarService.isReportDue ===
                    'function'
            ) {

                const due =
                    await this.calendarService.isReportDue(
                        report,
                        context
                    );

                if (
                    due?.overdue ===
                    true
                ) {
                    return {
                        valid:
                            false,

                        errors: [
                            {
                                code:
                                    'REGULATORY_REPORT_OVERDUE',

                                message:
                                    'Regulatory report is past its filing deadline.',

                                severity:
                                    'ERROR',
                            },
                        ],

                        warnings:
                            [],
                    };
                }

                if (
                    due?.dueSoon ===
                    true
                ) {
                    return {
                        valid:
                            true,

                        errors:
                            [],

                        warnings: [
                            {
                                code:
                                    'REGULATORY_REPORT_DUE_SOON',

                                message:
                                    'Regulatory report is approaching its filing deadline.',

                                severity:
                                    'WARNING',
                            },
                        ],
                    };
                }
            }

            return {
                valid:
                    true,

                errors:
                    [],

                warnings:
                    [],
            };

        } catch (
            error
        ) {

            return {
                valid:
                    false,

                errors: [
                    {
                        code:
                            error?.code ||
                            'REGULATORY_CALENDAR_VALIDATION_FAILED',

                        message:
                            error?.message ||
                            'Regulatory calendar validation failed.',

                        severity:
                            'ERROR',
                    },
                ],

                warnings:
                    [],
            };
        }
    }

    /**
     * =========================================================================
     * Threshold Validation
     * =========================================================================
     *
     * Threshold definitions remain adapter-owned.
     */

    async validateThresholds(
        adapter,
        report,
        context
    ) {

        if (
            !adapter
        ) {
            return {
                valid:
                    true,

                errors:
                    [],

                warnings:
                    [],

                supported:
                    false,
            };
        }

        let thresholds;

        try {

            if (
                typeof adapter.getThresholds !==
                    'function'
            ) {
                return {
                    valid:
                        true,

                    errors:
                        [],

                    warnings:
                        [],

                    supported:
                        false,
                };
            }

            thresholds =
                await adapter.getThresholds(
                    context
                );

        } catch (
            error
        ) {

            return {
                valid:
                    false,

                errors: [
                    {
                        code:
                            'REGULATORY_THRESHOLD_RESOLUTION_FAILED',

                        message:
                            error?.message ||
                            'Unable to resolve regulatory thresholds.',

                        severity:
                            'ERROR',
                    },
                ],

                warnings:
                    [],
            };
        }

        /**
         * If the adapter exposes a specific threshold evaluator, use it.
         */
        if (
            typeof adapter.validateThresholds ===
                'function'
        ) {

            try {

                return this.normalizeValidationResult(
                    await adapter.validateThresholds(
                        report,
                        thresholds,
                        context
                    ),
                    'REGULATORY_THRESHOLD_VALIDATION_FAILED'
                );

            } catch (
                error
            ) {

                return {
                    valid:
                        false,

                    errors: [
                        {
                            code:
                                'REGULATORY_THRESHOLD_VALIDATION_ERROR',

                            message:
                                error?.message ||
                                'Regulatory threshold validation failed.',

                            severity:
                                'ERROR',
                        },
                    ],

                    warnings:
                        [],
                };
            }
        }

        /**
         * No generic threshold interpretation is performed here.
         *
         * This is deliberate: threshold semantics are jurisdiction-specific.
         */
        return {
            valid:
                true,

            errors:
                [],

            warnings:
                [],

            resolved:
                true,

            thresholds:
                cloneValue(
                    thresholds
                ),
        };
    }

    /**
     * =========================================================================
     * Adapter Validation
     * =========================================================================
     */

    async validateThroughAdapter(
        adapter,
        report,
        context
    ) {

        if (
            !adapter ||
            typeof adapter.validateReport !==
                'function'
        ) {
            throw this.createError(
                'REGULATORY_VALIDATION_ADAPTER_INVALID',
                'Regulatory adapter does not implement validateReport().',
                context
            );
        }

        try {

            const result =
                await adapter.validateReport(
                    report,
                    context
                );

            return this.normalizeValidationResult(
                result,
                'REGULATORY_ADAPTER_VALIDATION_FAILED'
            );

        } catch (
            error
        ) {

            return {
                valid:
                    false,

                errors: [
                    {
                        code:
                            error?.code ||
                            'REGULATORY_ADAPTER_VALIDATION_ERROR',

                        message:
                            error?.message ||
                            'Regulatory adapter validation failed.',

                        severity:
                            'ERROR',
                    },
                ],

                warnings:
                    [],
            };
        }
    }

    /**
     * =========================================================================
     * Transformation Validation
     * =========================================================================
     */

    async validateTransformation(
        adapter,
        report,
        context
    ) {

        if (
            typeof adapter.transformReport !==
                'function'
        ) {
            return {
                valid:
                    false,

                errors: [
                    {
                        code:
                            'REGULATORY_TRANSFORMATION_UNAVAILABLE',

                        message:
                            'Regulatory report transformation is unavailable.',

                        severity:
                            'ERROR',
                    },
                ],

                warnings:
                    [],
            };
        }

        try {

            const transformed =
                await adapter.transformReport(
                    report,
                    context
                );

            if (
                transformed ===
                    undefined ||
                transformed ===
                    null
            ) {
                return {
                    valid:
                        false,

                    errors: [
                        {
                            code:
                                'REGULATORY_TRANSFORMATION_EMPTY',

                            message:
                                'Regulatory adapter returned an empty transformed report.',

                            severity:
                                'ERROR',
                        },
                    ],

                    warnings:
                        [],
                };
            }

            return {
                valid:
                    true,

                errors:
                    [],

                warnings:
                    [],

                fingerprint:
                    sha256(
                        stableSerialize(
                            transformed
                        )
                    ),
            };

        } catch (
            error
        ) {

            return {
                valid:
                    false,

                errors: [
                    {
                        code:
                            error?.code ||
                            'REGULATORY_TRANSFORMATION_FAILED',

                        message:
                            error?.message ||
                            'Regulatory report transformation failed.',

                        severity:
                            'ERROR',
                    },
                ],

                warnings:
                    [],
            };
        }
    }

    /**
     * =========================================================================
     * Normalize Adapter Validation Result
     * =========================================================================
     */

    normalizeValidationResult(
        result,
        fallbackErrorCode
    ) {

        if (
            result ===
                true
        ) {
            return {
                valid:
                    true,

                errors:
                    [],

                warnings:
                    [],
            };
        }

        if (
            result ===
                false
        ) {
            return {
                valid:
                    false,

                errors: [
                    {
                        code:
                            fallbackErrorCode,

                        message:
                            'Regulatory validation failed.',

                        severity:
                            'ERROR',
                    },
                ],

                warnings:
                    [],
            };
        }

        if (
            !result ||
            typeof result !==
                'object'
        ) {
            return {
                valid:
                    false,

                errors: [
                    {
                        code:
                            fallbackErrorCode,

                        message:
                            'Regulatory validator returned an invalid result.',

                        severity:
                            'ERROR',
                    },
                ],

                warnings:
                    [],
            };
        }

        const errors =
            normalizeIssueList(
                result.errors,
                {
                    fallbackCode:
                        fallbackErrorCode,

                    severity:
                        'ERROR',

                    max:
                        MAX_SCHEMA_ERRORS,
                }
            );

        const warnings =
            normalizeIssueList(
                result.warnings,
                {
                    fallbackCode:
                        'REGULATORY_VALIDATION_WARNING',

                    severity:
                        'WARNING',

                    max:
                        MAX_SCHEMA_WARNINGS,
                }
            );

        return {
            ...cloneValue(
                result
            ),

            valid:
                result.valid !==
                    false &&
                errors.length ===
                    0,

            errors,

            warnings,
        };
    }

    /**
     * =========================================================================
     * Add Check
     * =========================================================================
     */

    addCheck(
        trace,
        code,
        status
    ) {
        trace.checks.push({
            code,

            status,
        });
    }

    /**
     * =========================================================================
     * Merge Issues
     * =========================================================================
     */

    mergeIssues(
        trace,
        result
    ) {

        if (
            Array.isArray(
                result?.errors
            )
        ) {
            trace.errors.push(
                ...result.errors
            );
        }

        if (
            Array.isArray(
                result?.warnings
            )
        ) {
            trace.warnings.push(
                ...result.warnings
            );
        }

        if (
            trace.errors.length >
            MAX_ERRORS
        ) {
            trace.errors =
                trace.errors.slice(
                    0,
                    MAX_ERRORS
                );
        }

        if (
            trace.warnings.length >
            MAX_WARNINGS
        ) {
            trace.warnings =
                trace.warnings.slice(
                    0,
                    MAX_WARNINGS
                );
        }
    }

    /**
     * =========================================================================
     * Build Final Result
     * =========================================================================
     */

    buildValidationResult(
        report,
        context,
        trace,
        startedAt,
        options = {}
    ) {

        const errors =
            trace.errors || [];

        const warnings =
            trace.warnings || [];

        let status;

        if (
            options.fatalError
        ) {
            status =
                VALIDATION_STATUS.ERROR;

        } else if (
            errors.length > 0
        ) {
            status =
                VALIDATION_STATUS.INVALID;

        } else if (
            warnings.length > 0
        ) {
            status =
                VALIDATION_STATUS.VALID_WITH_WARNINGS;

        } else {
            status =
                VALIDATION_STATUS.VALID;
        }

        /**
         * WARN mode can intentionally permit validation warnings.
         *
         * STRICT mode still returns a warning-bearing result, leaving the
         * submission service to decide whether a report with warnings may
         * proceed.
         */
        const fingerprintMaterial = {
            service:
                SERVICE_NAME,

            version:
                SERVICE_VERSION,

            tenantId:
                context.tenantId,

            reportId:
                context.reportId,

            reportType:
                context.reportType,

            adapter:
                trace.adapter,

            mode:
                context.mode,

            status,

            errors,

            warnings,

            checks:
                trace.checks,
        };

        const result = {
            valid:
                (
                    errors.length ===
                    0
                ),

            status,

            mode:
                context.mode,

            tenantId:
                context.tenantId,

            reportId:
                context.reportId,

            reportType:
                context.reportType,

            adapter:
                trace.adapter,

            errors:
                errors.slice(
                    0,
                    MAX_ERRORS
                ),

            warnings:
                warnings.slice(
                    0,
                    MAX_WARNINGS
                ),

            checks:
                trace.checks.slice(),

            schema:
                trace.schema ||
                null,

            calendar:
                trace.calendar ||
                null,

            thresholds:
                trace.thresholds
                    ? {
                        resolved:
                            trace.thresholds.resolved ===
                            true,
                    }
                    : null,

            transformation:
                trace.transformed ||
                null,

            durationMs:
                Math.max(
                    0,
                    Date.now() -
                        startedAt
                ),

            validatedAt:
                new Date(),

            fingerprint:
                sha256(
                    stableSerialize(
                        fingerprintMaterial
                    )
                ),
        };

        return deepFreeze(
            result
        );
    }

    /**
     * =========================================================================
     * Context Normalization
     * =========================================================================
     */

    normalizeContext(
        report,
        context = {}
    ) {

        if (
            !isPlainObject(
                context
            )
        ) {
            throw this.createError(
                'REGULATORY_VALIDATION_CONTEXT_INVALID',
                'Validation context must be an object.',
                {},
                {
                    statusCode:
                        400,
                }
            );
        }

        const tenantId =
            normalizeRequiredString(
                context.tenantId ||
                    report?.tenantId,
                'tenantId',
                MAX_TENANT_ID_LENGTH
            );

        const reportId =
            normalizeRequiredString(
                context.reportId ||
                    report?.id ||
                    report?.reportId,
                'reportId',
                MAX_REPORT_ID_LENGTH
            );

        const reportType =
            normalizeReportType(
                context.reportType ||
                    report?.type
            );

        return {
            ...context,

            report,

            tenantId,

            reportId,

            reportType,

            adapterName:
                normalizeOptionalString(
                    context.adapterName ||
                        report?.adapterName,
                    'adapterName',
                    128
                ),

            adapterVersion:
                normalizeOptionalString(
                    context.adapterVersion ||
                        context.version ||
                        report?.adapterVersion,
                    'adapterVersion',
                    64
                ),

            countryCode:
                normalizeOptionalString(
                    context.countryCode ||
                        report?.countryCode,
                    'countryCode',
                    8
                )?.toUpperCase() ||
                null,

            jurisdiction:
                normalizeOptionalString(
                    context.jurisdiction ||
                        report?.jurisdiction,
                    'jurisdiction',
                    128
                ),

            regulatorCode:
                normalizeOptionalString(
                    context.regulatorCode ||
                        report?.regulatorCode,
                    'regulatorCode',
                    128
                )?.toUpperCase() ||
                null,

            mode:
                normalizeMode(
                    context.mode
                ),

            requestId:
                normalizeOptionalString(
                    context.requestId,
                    'requestId',
                    256
                ),

            correlationId:
                normalizeOptionalString(
                    context.correlationId ||
                        context.requestId,
                    'correlationId',
                    256
                ),

            asOf:
                context.asOf
                    ? new Date(
                        context.asOf
                    )
                    : new Date(),

            validateTransformation:
                context.validateTransformation ===
                true,

            throwOnError:
                context.throwOnError ===
                true,
        };
    }

    /**
     * =========================================================================
     * Audit
     * =========================================================================
     */

    async persistAudit(
        action,
        result,
        context
    ) {

        try {

            const payload = {
                action,

                tenantId:
                    context.tenantId,

                reportId:
                    context.reportId,

                reportType:
                    context.reportType,

                adapter:
                    result.adapter,

                status:
                    result.status,

                valid:
                    result.valid,

                fingerprint:
                    result.fingerprint,

                requestId:
                    context.requestId ||
                    null,

                correlationId:
                    context.correlationId ||
                    null,

                timestamp:
                    new Date(),
            };

            if (
                typeof this.audit ===
                    'function'
            ) {
                await this.audit(
                    action,
                    payload
                );

                return;
            }

            if (
                this.audit &&
                typeof this.audit.record ===
                    'function'
            ) {
                await this.audit.record(
                    action,
                    payload
                );
            }

        } catch (
            error
        ) {

            this.logger.error?.({
                event:
                    'compliance.regulatory_validation.audit_failed',

                action,

                reportId:
                    context.reportId,

                error:
                    error?.message,
            });
        }
    }

    /**
     * =========================================================================
     * Metrics
     * =========================================================================
     */

    incrementMetric(
        name,
        labels = {}
    ) {
        try {

            if (
                this.metrics &&
                typeof this.metrics.counter ===
                    'function'
            ) {
                this.metrics.counter(
                    name,
                    labels
                );

                return;
            }

            if (
                this.metrics &&
                typeof this.metrics.increment ===
                    'function'
            ) {
                this.metrics.increment(
                    name,
                    labels
                );
            }

        } catch (
            error
        ) {

            this.logger.warn?.({
                event:
                    'compliance.regulatory_validation.metric_failed',

                metric:
                    name,

                error:
                    error?.message,
            });
        }
    }

    /**
     * =========================================================================
     * Error Normalization
     * =========================================================================
     */

    normalizeError(
        error,
        context
    ) {

        if (
            error instanceof
            RegulatoryValidationServiceError
        ) {
            return {
                code:
                    error.code,

                message:
                    String(
                        error.message
                    ).slice(
                        0,
                        MAX_ERROR_MESSAGE_LENGTH
                    ),

                severity:
                    'ERROR',
            };
        }

        return {
            code:
                error?.code ||
                'REGULATORY_VALIDATION_ERROR',

            message:
                String(
                    error?.message ||
                    'Regulatory validation failed.'
                ).slice(
                    0,
                    MAX_ERROR_MESSAGE_LENGTH
                ),

            severity:
                'ERROR',
        };
    }

    /**
     * =========================================================================
     * Fingerprint
     * =========================================================================
     */

    fingerprint(
        result
    ) {
        if (
            !result ||
            typeof result !==
                'object'
        ) {
            return null;
        }

        return sha256(
            stableSerialize({
                tenantId:
                    result.tenantId,

                reportId:
                    result.reportId,

                reportType:
                    result.reportType,

                adapter:
                    result.adapter,

                status:
                    result.status,

                errors:
                    result.errors,

                warnings:
                    result.warnings,
            })
        );
    }

    /**
     * =========================================================================
     * Health
     * =========================================================================
     */

    async health() {

        let registryAvailable =
            Boolean(
                this.registry
            );

        let calendarAvailable =
            !this.requireCalendar ||
            Boolean(
                this.calendarService
            );

        return {
            healthy:
                registryAvailable &&
                calendarAvailable,

            service:
                SERVICE_NAME,

            version:
                SERVICE_VERSION,

            registryAvailable,

            calendarAvailable,

            strict:
                this.strict,

            requireAdapter:
                this.requireAdapter,

            requireCalendar:
                this.requireCalendar,

            timestamp:
                new Date().toISOString(),
        };
    }

    /**
     * =========================================================================
     * Readiness
     * =========================================================================
     */

    readiness() {

        return {
            ready:
                Boolean(
                    (
                        this.registry ||
                        !this.requireAdapter
                    ) &&
                    (
                        this.calendarService ||
                        !this.requireCalendar
                    )
                ),

            service:
                SERVICE_NAME,

            version:
                SERVICE_VERSION,

            registryAvailable:
                Boolean(
                    this.registry
                ),

            calendarAvailable:
                Boolean(
                    this.calendarService
                ),

            requireAdapter:
                this.requireAdapter,

            requireCalendar:
                this.requireCalendar,
        };
    }

    /**
     * =========================================================================
     * Diagnostics
     * =========================================================================
     */

    diagnostics() {
        return {
            service:
                SERVICE_NAME,

            version:
                SERVICE_VERSION,

            strict:
                this.strict,

            allowWarnings:
                this.allowWarnings,

            requireAdapter:
                this.requireAdapter,

            requireCalendar:
                this.requireCalendar,

            registryAvailable:
                Boolean(
                    this.registry
                ),

            calendarServiceAvailable:
                Boolean(
                    this.calendarService
                ),

            metricsAvailable:
                Boolean(
                    this.metrics
                ),

            auditAvailable:
                Boolean(
                    this.audit
                ),
        };
    }

    /**
     * =========================================================================
     * Error Factory
     * =========================================================================
     */

    createError(
        code,
        message,
        context = {},
        options = {}
    ) {
        return new RegulatoryValidationServiceError(
            message,
            code,
            {
                ...options,

                tenantId:
                    context.tenantId ||
                    options.tenantId ||
                    null,

                reportId:
                    context.reportId ||
                    options.reportId ||
                    null,

                reportType:
                    context.reportType ||
                    options.reportType ||
                    null,

                adapterName:
                    context.adapterName ||
                    options.adapterName ||
                    null,

                jurisdiction:
                    context.jurisdiction ||
                    options.jurisdiction ||
                    null,

                regulatorCode:
                    context.regulatorCode ||
                    options.regulatorCode ||
                    null,

                requestId:
                    context.requestId ||
                    options.requestId ||
                    null,

                correlationId:
                    context.correlationId ||
                    options.correlationId ||
                    null,
            }
        );
    }
}

/**
 * ============================================================================
 * Static Constants
 * ============================================================================
 */

RegulatoryValidationService.SERVICE_NAME =
    SERVICE_NAME;

RegulatoryValidationService.SERVICE_VERSION =
    SERVICE_VERSION;

RegulatoryValidationService.VALIDATION_MODES =
    VALIDATION_MODES;

RegulatoryValidationService.VALIDATION_STATUS =
    VALIDATION_STATUS;

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports =
    RegulatoryValidationService;

module.exports.RegulatoryValidationService =
    RegulatoryValidationService;

module.exports.RegulatoryValidationServiceError =
    RegulatoryValidationServiceError;

module.exports.VALIDATION_MODES =
    VALIDATION_MODES;

module.exports.VALIDATION_STATUS =
    VALIDATION_STATUS;

module.exports.SERVICE_NAME =
    SERVICE_NAME;

module.exports.SERVICE_VERSION =
    SERVICE_VERSION;