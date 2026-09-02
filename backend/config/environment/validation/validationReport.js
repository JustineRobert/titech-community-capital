'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/environment/validation/validationReport.js
 *
 * Purpose:
 *   Enterprise production-grade validation reporting and diagnostics boundary.
 *
 * Responsibilities:
 *   - Aggregate configuration validation results from all validators.
 *   - Normalize validation errors and warnings.
 *   - Produce deterministic validation summaries.
 *   - Produce machine-readable and human-readable reports.
 *   - Preserve validation severity and category.
 *   - Correlate failures by environment, subsystem and variable.
 *   - Support required/schema/security/database/JWT/Mobile Money validators.
 *   - Provide safe diagnostics without exposing secrets.
 *   - Provide validation fingerprints for observability and audit correlation.
 *   - Support startup/readiness diagnostics.
 *   - Support JSON serialization.
 *   - Support concise operational summaries.
 *   - Remain immutable at the reporting boundary.
 *
 * IMPORTANT:
 *
 *   This module REPORTS validation results.
 *
 *   It does NOT:
 *     - perform configuration loading.
 *     - perform environment merging.
 *     - perform configuration normalization.
 *     - decide configuration precedence.
 *     - execute database connections.
 *     - initialize Redis.
 *     - initialize queues.
 *     - initialize Mobile Money providers.
 *     - sign or verify JWTs.
 *     - start Express.
 *     - execute financial transactions.
 *     - mutate process.env.
 *
 * =============================================================================
 *
 * Reporting boundary:
 *
 *   requiredValidator
 *          \
 *   schemaValidator
 *           \
 *   securityValidator
 *            \
 *   databaseValidator
 *             \
 *   jwtValidator
 *              \
 *   mobileMoneyValidator
 *                ↓
 *        validationReport.js
 *                ↓
 *       environmentValidator
 *                ↓
 *        bootstrap/readiness
 *
 * =============================================================================
 */

const crypto =
    require('node:crypto');

/**
 * =============================================================================
 * Optional validation error integration
 * =============================================================================
 */

let validationErrorsModule =
    null;

try {
    // eslint-disable-next-line global-require
    validationErrorsModule =
        require('../validationErrors');
} catch {
    validationErrorsModule =
        null;
}

const ValidationErrorCollection =
    validationErrorsModule
        ?.ValidationErrorCollection ||
    null;

const EnvironmentValidationAggregateError =
    validationErrorsModule
        ?.EnvironmentValidationAggregateError ||
    null;

const VALIDATION_CATEGORIES =
    validationErrorsModule
        ?.VALIDATION_CATEGORIES ||
    Object.freeze({
        CONFIGURATION:
            'configuration',

        REQUIRED:
            'required',

        SCHEMA:
            'schema',

        SECURITY:
            'security',

        DATABASE:
            'database',

        FINANCIAL:
            'financial',

        FEATURE:
            'feature',

        FORMAT:
            'format',

        TYPE:
            'type',

        ENUM:
            'enum',

        RANGE:
            'range',

        PRECEDENCE:
            'precedence',
    });

const VALIDATION_SEVERITIES =
    validationErrorsModule
        ?.VALIDATION_SEVERITIES ||
    Object.freeze({
        INFO:
            'info',

        WARNING:
            'warning',

        ERROR:
            'error',

        CRITICAL:
            'critical',
    });

/**
 * =============================================================================
 * Optional secret masker
 * =============================================================================
 */

let secretMaskerModule =
    null;

try {
    // eslint-disable-next-line global-require
    secretMaskerModule =
        require('../secretMasker');
} catch {
    secretMaskerModule =
        null;
}

/**
 * =============================================================================
 * Optional logger
 * =============================================================================
 */

let loggerModule =
    null;

try {
    // eslint-disable-next-line global-require
    loggerModule =
        require('../../../utils/logger');
} catch {
    loggerModule =
        null;
}

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const COMPONENT =
    'environment-validation-report';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

const REPORT_FORMATS =
    Object.freeze({
        OBJECT:
            'object',

        JSON:
            'json',

        TEXT:
            'text',

        SUMMARY:
            'summary',

        HEALTH:
            'health',
    });

const REPORT_STATUSES =
    Object.freeze({
        VALID:
            'valid',

        DEGRADED:
            'degraded',

        INVALID:
            'invalid',

        UNKNOWN:
            'unknown',
    });

const DEFAULTS =
    Object.freeze({
        environment:
            process.env.NODE_ENV ||
            'development',

        failClosed:
            true,

        includeWarnings:
            true,

        includeInfo:
            false,

        includeDetails:
            true,

        includeExpected:
            true,

        includeActual:
            false,

        includePaths:
            true,

        includeStack:
            false,

        includeFingerprint:
            true,

        includeTimestamps:
            true,

        redactSensitive:
            true,

        includeSensitive:
            false,

        maxErrors:
            1_000,

        maxWarnings:
            1_000,

        maxInfo:
            1_000,

        maxSubsystems:
            100,

        maxVariables:
            5_000,

        maxMessageLength:
            4_096,

        maxReportSize:
            2_000_000,

        fingerprintAlgorithm:
            'sha256',

        sensitivePattern:
            /(password|passwd|secret|token|authorization|api[_-]?key|private[_-]?key|client[_-]?secret|encryption[_-]?key|jwt|access[_-]?token|refresh[_-]?token|cookie|credential|pin|otp|cvv|cvc|passkey|subscription[_-]?key|webhook[_-]?secret|session[_-]?secret|csrf[_-]?secret|mongo_uri|database_uri|connection_string|privatekey|publickey)/i,

        severityRank:
            Object.freeze({
                info:
                    10,

                warning:
                    20,

                error:
                    30,

                critical:
                    40,
            }),
    });

/**
 * =============================================================================
 * Error
 * =============================================================================
 */

class ValidationReportError extends Error {

    constructor(
        message,
        options = {},
    ) {

        super(message);

        this.name =
            'ValidationReportError';

        this.code =
            options.code ||
            'TITECH_VALIDATION_REPORT_ERROR';

        this.cause =
            options.cause ||
            null;

        this.details =
            Object.freeze({
                ...(options.details || {}),
            });

        Error.captureStackTrace?.(
            this,
            ValidationReportError,
        );
    }
}

/**
 * =============================================================================
 * Utility helpers
 * =============================================================================
 */

function clone(
    value,
) {

    if (
        value === undefined ||
        value === null
    ) {

        return value;
    }

    if (
        typeof structuredClone ===
        'function'
    ) {

        try {
            return structuredClone(
                value,
            );
        } catch {
            // Recursive fallback.
        }
    }

    if (
        Array.isArray(
            value,
        )
    ) {

        return value.map(
            item =>
                clone(
                    item,
                ),
        );
    }

    if (
        typeof value ===
        'object'
    ) {

        const result =
            {};

        for (
            const [
                key,
                item,
            ] of Object.entries(
                value,
            )
        ) {

            result[key] =
                clone(
                    item,
                );
        }

        return result;
    }

    return value;
}

function deepFreeze(
    value,
    seen = new WeakSet(),
) {

    if (
        value === null ||
        value === undefined ||
        typeof value !==
        'object'
    ) {

        return value;
    }

    if (
        seen.has(
            value,
        )
    ) {

        return value;
    }

    seen.add(
        value,
    );

    for (
        const key of
        Reflect.ownKeys(
            value,
        )
    ) {

        try {
            deepFreeze(
                value[key],
                seen,
            );
        } catch {
            // Best effort.
        }
    }

    try {
        Object.freeze(
            value,
        );
    } catch {
        // Best effort.
    }

    return value;
}

function normalizeEnvironment(
    value,
) {

    return String(
        value ||
        process.env.NODE_ENV ||
        'development',
    )
        .trim()
        .toLowerCase();
}

function normalizeString(
    value,
) {

    if (
        value === undefined ||
        value === null
    ) {

        return null;
    }

    const normalized =
        String(
            value,
        )
            .trim();

    return normalized ||
        null;
}

function normalizeSeverity(
    value,
) {

    const normalized =
        normalizeString(
            value,
        );

    if (
        !normalized
    ) {

        return VALIDATION_SEVERITIES
            .ERROR;
    }

    const lower =
        normalized.toLowerCase();

    return Object.prototype
        .hasOwnProperty
        .call(
            DEFAULTS.severityRank,
            lower,
        )
        ? lower
        : VALIDATION_SEVERITIES
            .ERROR;
}

function normalizeCategory(
    value,
) {

    const normalized =
        normalizeString(
            value,
        );

    return normalized
        ? normalized.toLowerCase()
        : VALIDATION_CATEGORIES
            .CONFIGURATION;
}

function severityRank(
    value,
    options = DEFAULTS,
) {

    const severity =
        normalizeSeverity(
            value,
        );

    return (
        options.severityRank?.[
            severity
        ] ??
        DEFAULTS.severityRank[
            severity
        ] ??
        30
    );
}

function stableStringify(
    value,
) {

    if (
        value === null ||
        typeof value !==
        'object'
    ) {

        return JSON.stringify(
            value,
        );
    }

    if (
        Array.isArray(
            value,
        )
    ) {

        return `[${value
            .map(
                item =>
                    stableStringify(
                        item,
                    ),
            )
            .join(',')}]`;
    }

    return `{${Object.keys(
        value,
    )
        .sort()
        .map(
            key =>
                `${JSON.stringify(
                    key,
                )}:${stableStringify(
                    value[key],
                )}`,
        )
        .join(',')}}`;
}

function fingerprint(
    value,
    options = DEFAULTS,
) {

    return crypto
        .createHash(
            options.fingerprintAlgorithm ||
            DEFAULTS
                .fingerprintAlgorithm,
        )
        .update(
            stableStringify(
                value,
            ),
            'utf8',
        )
        .digest(
            'hex',
        );
}

function isSensitiveKey(
    key,
    options = DEFAULTS,
) {

    return (
        options.sensitivePattern ||
        DEFAULTS.sensitivePattern
    ).test(
        String(
            key ||
            '',
        ),
    );
}

function maskSensitiveValue(
    key,
    value,
    options = DEFAULTS,
) {

    if (
        !options.redactSensitive ||
        options.includeSensitive
    ) {

        return clone(
            value,
        );
    }

    if (
        !isSensitiveKey(
            key,
            options,
        )
    ) {

        return clone(
            value,
        );
    }

    try {

        if (
            secretMaskerModule
                ?.maskKeyValue
        ) {

            return secretMaskerModule
                .maskKeyValue(
                    key,
                    value,
                );
        }

        if (
            secretMaskerModule
                ?.mask
        ) {

            return secretMaskerModule.mask(
                value,
            );
        }

    } catch {
        // Hard fallback.
    }

    return '[REDACTED]';
}

function getLogger() {

    try {

        return (
            loggerModule
                ?.getLogger?.() ||
            loggerModule?.logger ||
            loggerModule ||
            console
        );

    } catch {

        return console;
    }
}

function log(
    level,
    metadata,
    message,
) {

    try {

        const logger =
            getLogger();

        if (
            typeof logger?.[
                level
            ] ===
            'function'
        ) {

            logger[level](
                {
                    component:
                        COMPONENT,

                    service:
                        SERVICE_NAME,

                    application:
                        APPLICATION_NAME,

                    ...metadata,
                },
                message,
            );
        }

    } catch {
        // Reporting remains logger-independent.
    }
}

function truncate(
    value,
    maxLength,
) {

    if (
        typeof value !==
        'string'
    ) {

        return value;
    }

    if (
        value.length <=
        maxLength
    ) {

        return value;
    }

    return (
        value.slice(
            0,
            maxLength,
        ) +
        '...[TRUNCATED]'
    );
}

/**
 * =============================================================================
 * Validation error extraction
 * =============================================================================
 */

function extractErrorsFromResult(
    source,
) {

    if (
        source ===
            null ||
        source ===
            undefined
    ) {

        return [];
    }

    if (
        Array.isArray(
            source,
        )
    ) {

        return source.flatMap(
            item =>
                extractErrorsFromResult(
                    item,
                ),
        );
    }

    if (
        source instanceof
        Error
    ) {

        if (
            Array.isArray(
                source.errors,
            )
        ) {

            return extractErrorsFromResult(
                source.errors,
            );
        }

        if (
            Array.isArray(
                source.details,
            )
        ) {

            return extractErrorsFromResult(
                source.details,
            );
        }

        if (
            source.details &&
            Array.isArray(
                source.details
                    .errors,
            )
        ) {

            return extractErrorsFromResult(
                source.details
                    .errors,
            );
        }

        if (
            typeof source.toJSON ===
            'function'
        ) {

            try {

                const json =
                    source.toJSON();

                if (
                    json !==
                    source
                ) {

                    return extractErrorsFromResult(
                        json,
                    );
                }

            } catch {
                // Continue.
            }
        }

        return [
            source,
        ];
    }

    if (
        typeof source !==
        'object'
    ) {

        return [];
    }

    /**
     * Common validation result shapes.
     */
    const candidates = [
        source.errors,
        source.error,
        source.issues,
        source.validationErrors,
        source.details?.errors,
        source.result?.errors,
        source.results?.errors,
    ];

    for (
        const candidate of
        candidates
    ) {

        if (
            candidate !==
                undefined &&
            candidate !==
                null
        ) {

            const errors =
                extractErrorsFromResult(
                    candidate,
                );

            if (
                errors.length >
                0
            ) {

                return errors;
            }
        }
    }

    /**
     * A single structured validation error.
     */
    if (
        source.message ||
        source.code ||
        source.variable ||
        source.path
    ) {

        return [
            source,
        ];
    }

    return [];
}

/**
 * =============================================================================
 * Validation result normalization
 * =============================================================================
 */

function normalizeValidationError(
    error,
    context = {},
    options = DEFAULTS,
) {

    const variable =
        normalizeString(
            error?.variable ||
            error?.path ||
            error?.field ||
            context.variable,
        );

    const code =
        normalizeString(
            error?.code,
        ) ||
        'TITECH_VALIDATION_ERROR';

    const category =
        normalizeCategory(
            error?.category ||
            context.category,
        );

    const severity =
        normalizeSeverity(
            error?.severity ||
            context.severity ||
            VALIDATION_SEVERITIES
                .ERROR,
        );

    const environment =
        normalizeEnvironment(
            error?.environment ||
            context.environment ||
            options.environment,
        );

    const message =
        truncate(
            normalizeString(
                error?.message,
            ) ||
            'TITech configuration validation failed.',
            options.maxMessageLength,
        );

    const result = {
        code,

        category,

        severity,

        variable,

        path:
            options.includePaths
                ? (
                    normalizeString(
                        error?.path ||
                        variable,
                    )
                )
                : undefined,

        environment,

        message,

        expected:
            options.includeExpected
                ? maskSensitiveValue(
                    variable,
                    error?.expected,
                    options,
                )
                : undefined,

        actual:
            options.includeActual
                ? maskSensitiveValue(
                    variable,
                    error?.actual,
                    options,
                )
                : undefined,

        source:
            normalizeString(
                error?.source ||
                context.source ||
                context.subsystem,
            ),

        subsystem:
            normalizeString(
                error?.subsystem ||
                context.subsystem,
            ),

        validator:
            normalizeString(
                error?.validator ||
                context.validator,
            ),

        timestamp:
            options.includeTimestamps
                ? (
                    normalizeString(
                        error?.timestamp ||
                        error?.createdAt,
                    ) ||
                    new Date().toISOString()
                )
                : undefined,
    };

    if (
        options.includeStack &&
        error?.stack
    ) {

        result.stack =
            truncate(
                String(
                    error.stack,
                ),
                options.maxMessageLength *
                    2,
            );
    }

    if (
        error?.metadata &&
        typeof error.metadata ===
            'object'
    ) {

        result.metadata =
            sanitizeMetadata(
                error.metadata,
                options,
            );
    }

    return removeUndefined(
        result,
    );
}

function removeUndefined(
    object,
) {

    if (
        !object ||
        typeof object !==
            'object'
    ) {

        return object;
    }

    if (
        Array.isArray(
            object,
        )
    ) {

        return object.map(
            removeUndefined,
        );
    }

    const result =
        {};

    for (
        const [
            key,
            value,
        ] of Object.entries(
            object,
        )
    ) {

        if (
            value ===
            undefined
        ) {

            continue;
        }

        result[key] =
            value;
    }

    return result;
}

function sanitizeMetadata(
    metadata,
    options,
) {

    if (
        !metadata ||
        typeof metadata !==
            'object'
    ) {

        return {};
    }

    const result =
        {};

    for (
        const [
            key,
            value,
        ] of Object.entries(
            metadata,
        )
    ) {

        result[key] =
            isSensitiveKey(
                key,
                options,
            )
                ? '[REDACTED]'
                : sanitizeMetadataValue(
                    key,
                    value,
                    options,
                );
    }

    return result;
}

function sanitizeMetadataValue(
    key,
    value,
    options,
) {

    if (
        value ===
            null ||
        typeof value !==
            'object'
    ) {

        return maskSensitiveValue(
            key,
            value,
            options,
        );
    }

    if (
        Array.isArray(
            value,
        )
    ) {

        return value.map(
            item =>
                sanitizeMetadataValue(
                    key,
                    item,
                    options,
                ),
        );
    }

    const result =
        {};

    for (
        const [
            childKey,
            childValue,
        ] of Object.entries(
            value,
        )
    ) {

        result[childKey] =
            isSensitiveKey(
                childKey,
                options,
            )
                ? '[REDACTED]'
                : sanitizeMetadataValue(
                    `${key}.${childKey}`,
                    childValue,
                    options,
                );
    }

    return result;
}

/**
 * =============================================================================
 * Validator result extraction
 * =============================================================================
 */

function normalizeValidatorResult(
    source,
    context = {},
    options = DEFAULTS,
) {

    const rawErrors =
        extractErrorsFromResult(
            source,
        );

    const normalizedErrors =
        rawErrors.map(
            error =>
                normalizeValidationError(
                    error,
                    context,
                    options,
                ),
        );

    const valid =
        typeof source?.valid ===
            'boolean'
            ? source.valid
            : typeof source?.ready ===
                'boolean'
                ? source.ready
                : normalizedErrors.every(
                    error =>
                        severityRank(
                            error.severity,
                            options,
                        ) <
                        severityRank(
                            VALIDATION_SEVERITIES
                                .ERROR,
                            options,
                        ),
                );

    const sourceSummary =
        source?.summary ||
        {};

    return {
        valid,

        status:
            normalizeString(
                source?.status,
            ),

        errors:
            normalizedErrors,

        summary:
            {
                total:
                    Number.isInteger(
                        sourceSummary.total,
                    )
                        ? sourceSummary.total
                        : normalizedErrors
                            .length,

                info:
                    Number.isInteger(
                        sourceSummary.info,
                    )
                        ? sourceSummary.info
                        : normalizedErrors.filter(
                            error =>
                                error.severity ===
                                VALIDATION_SEVERITIES
                                    .INFO,
                        ).length,

                warnings:
                    Number.isInteger(
                        sourceSummary.warnings,
                    )
                        ? sourceSummary.warnings
                        : normalizedErrors.filter(
                            error =>
                                error.severity ===
                                VALIDATION_SEVERITIES
                                    .WARNING,
                        ).length,

                errors:
                    Number.isInteger(
                        sourceSummary.errors,
                    )
                        ? sourceSummary.errors
                        : normalizedErrors.filter(
                            error =>
                                error.severity ===
                                VALIDATION_SEVERITIES
                                    .ERROR,
                        ).length,

                critical:
                    Number.isInteger(
                        sourceSummary.critical,
                    )
                        ? sourceSummary.critical
                        : normalizedErrors.filter(
                            error =>
                                error.severity ===
                                VALIDATION_SEVERITIES
                                    .CRITICAL,
                        ).length,
            },

        fingerprint:
            normalizeString(
                source?.fingerprint,
            ),

        diagnostics:
            sanitizeMetadata(
                source?.diagnostics ||
                {},
                options,
            ),

        validator:
            normalizeString(
                context.validator ||
                source?.validator ||
                source?.component,
            ),

        subsystem:
            normalizeString(
                context.subsystem ||
                source?.subsystem ||
                source?.component,
            ),

        durationMs:
            Number.isFinite(
                source?.durationMs,
            )
                ? source.durationMs
                : null,
    };
}

/**
 * =============================================================================
 * ValidationReport class
 * =============================================================================
 */

class ValidationReport {

    constructor(
        options = {},
    ) {

        this.options =
            Object.freeze({
                ...DEFAULTS,
                ...options,

                environment:
                    normalizeEnvironment(
                        options.environment,
                    ),
            });

        this.state =
            'created';

        this.createdAt =
            new Date().toISOString();

        this.completedAt =
            null;

        this.validationCount =
            0;

        this.entries =
            [];

        this.errors =
            [];

        this.warnings =
            [];

        this.info =
            [];

        this.critical =
            [];

        this.subsystems =
            new Map();

        this.variables =
            new Map();

        this.validators =
            new Map();

        this.lastReport =
            null;

        this.lastError =
            null;
    }

    /**
     * -------------------------------------------------------------------------
     * Add a validator result.
     * -------------------------------------------------------------------------
     */

    addResult(
        source,
        context = {},
    ) {

        const normalized =
            normalizeValidatorResult(
                source,
                {
                    ...context,

                    environment:
                        context.environment ||
                        this.options
                            .environment,
                },
                this.options,
            );

        const validator =
            normalized.validator ||
            'unknown';

        const subsystem =
            normalized.subsystem ||
            validator;

        this.entries.push({
            validator,

            subsystem,

            valid:
                normalized.valid,

            status:
                normalized.status ||
                (
                    normalized.valid
                        ? REPORT_STATUSES.VALID
                        : REPORT_STATUSES.INVALID
                ),

            durationMs:
                normalized.durationMs,

            fingerprint:
                normalized.fingerprint,

            diagnostics:
                normalized.diagnostics,

            errorCount:
                normalized.errors.length,
        });

        this.validators.set(
            validator,
            {
                validator,

                subsystem,

                valid:
                    normalized.valid,

                status:
                    normalized.status ||
                    (
                        normalized.valid
                            ? REPORT_STATUSES.VALID
                            : REPORT_STATUSES.INVALID
                    ),

                durationMs:
                    normalized.durationMs,

                fingerprint:
                    normalized.fingerprint,

                errorCount:
                    normalized.errors.length,
            },
        );

        if (
            !this.subsystems.has(
                subsystem,
            )
        ) {

            this.subsystems.set(
                subsystem,
                {
                    name:
                        subsystem,

                    validators:
                        new Set(),

                    total:
                        0,

                    info:
                        0,

                    warnings:
                        0,

                    errors:
                        0,

                    critical:
                        0,

                    valid:
                        true,
                },
            );
        }

        const subsystemState =
            this.subsystems.get(
                subsystem,
            );

        subsystemState.validators.add(
            validator,
        );

        for (
            const error of
            normalized.errors
        ) {

            this.addError(
                error,
            );
        }

        subsystemState.valid =
            subsystemState.valid &&
            normalized.valid;

        return this;
    }

    /**
     * -------------------------------------------------------------------------
     * Add multiple validator results.
     * -------------------------------------------------------------------------
     */

    addResults(
        results = [],
        context = {},
    ) {

        if (
            !Array.isArray(
                results,
            )
        ) {

            throw new ValidationReportError(
                'TITech validation report addResults() requires an array.',
                {
                    code:
                        'TITECH_VALIDATION_RESULTS_INVALID',
                },
            );
        }

        for (
            const result of
            results
        ) {

            if (
                result &&
                typeof result ===
                    'object' &&
                (
                    result.validator ||
                    result.component ||
                    result.subsystem
                )
            ) {

                this.addResult(
                    result,
                    context,
                );

            } else {

                this.addResult(
                    result,
                    context,
                );
            }
        }

        return this;
    }

    /**
     * -------------------------------------------------------------------------
     * Add a single normalized error.
     * -------------------------------------------------------------------------
     */

    addError(
        error,
    ) {

        const normalized =
            normalizeValidationError(
                error,
                {},
                this.options,
            );

        const severity =
            normalized.severity;

        if (
            severity ===
            VALIDATION_SEVERITIES
                .CRITICAL
        ) {

            if (
                this.critical.length <
                this.options.maxErrors
            ) {

                this.critical.push(
                    normalized,
                );
            }

        } else if (
            severity ===
            VALIDATION_SEVERITIES
                .ERROR
        ) {

            if (
                this.errors.length <
                this.options.maxErrors
            ) {

                this.errors.push(
                    normalized,
                );
            }

        } else if (
            severity ===
            VALIDATION_SEVERITIES
                .WARNING
        ) {

            if (
                this.warnings.length <
                this.options.maxWarnings
            ) {

                this.warnings.push(
                    normalized,
                );
            }

        } else {

            if (
                this.info.length <
                this.options.maxInfo
            ) {

                this.info.push(
                    normalized,
                );
            }
        }

        /**
         * Variable aggregation.
         */
        const variable =
            normalized.variable ||
            normalized.path ||
            '__global__';

        if (
            !this.variables.has(
                variable,
            )
        ) {

            this.variables.set(
                variable,
                {
                    variable,

                    total:
                        0,

                    info:
                        0,

                    warnings:
                        0,

                    errors:
                        0,

                    critical:
                        0,

                    codes:
                        new Set(),

                    validators:
                        new Set(),
                },
            );
        }

        const variableState =
            this.variables.get(
                variable,
            );

        variableState.total +=
            1;

        if (
            severity ===
            VALIDATION_SEVERITIES
                .CRITICAL
        ) {

            variableState.critical +=
                1;

        } else if (
            severity ===
            VALIDATION_SEVERITIES
                .ERROR
        ) {

            variableState.errors +=
                1;

        } else if (
            severity ===
            VALIDATION_SEVERITIES
                .WARNING
        ) {

            variableState.warnings +=
                1;

        } else {

            variableState.info +=
                1;
        }

        variableState.codes.add(
            normalized.code,
        );

        if (
            normalized.validator
        ) {

            variableState.validators.add(
                normalized.validator,
            );
        }

        /**
         * Subsystem aggregation.
         */
        const subsystem =
            normalized.subsystem ||
            normalized.validator ||
            'unknown';

        if (
            !this.subsystems.has(
                subsystem,
            )
        ) {

            this.subsystems.set(
                subsystem,
                {
                    name:
                        subsystem,

                    validators:
                        new Set(),

                    total:
                        0,

                    info:
                        0,

                    warnings:
                        0,

                    errors:
                        0,

                    critical:
                        0,

                    valid:
                        true,
                },
            );
        }

        const subsystemState =
            this.subsystems.get(
                subsystem,
            );

        subsystemState.total +=
            1;

        if (
            severity ===
            VALIDATION_SEVERITIES
                .CRITICAL
        ) {

            subsystemState.critical +=
                1;

            subsystemState.valid =
                false;

        } else if (
            severity ===
            VALIDATION_SEVERITIES
                .ERROR
        ) {

            subsystemState.errors +=
                1;

            subsystemState.valid =
                false;

        } else if (
            severity ===
            VALIDATION_SEVERITIES
                .WARNING
        ) {

            subsystemState.warnings +=
                1;

        } else {

            subsystemState.info +=
                1;
        }

        return this;
    }

    /**
     * -------------------------------------------------------------------------
     * Import errors from an Error/aggregate.
     * -------------------------------------------------------------------------
     */

    addErrorObject(
        error,
        context = {},
    ) {

        const extracted =
            extractErrorsFromResult(
                error,
            );

        if (
            extracted.length ===
            0
        ) {

            this.addError(
                normalizeValidationError(
                    error,
                    context,
                    this.options,
                ),
            );

            return this;
        }

        for (
            const item of
            extracted
        ) {

            this.addError(
                normalizeValidationError(
                    item,
                    context,
                    this.options,
                ),
            );
        }

        return this;
    }

    /**
     * -------------------------------------------------------------------------
     * Determine final status.
     * -------------------------------------------------------------------------
     */

    getStatus() {

        if (
            this.critical.length >
            0 ||
            this.errors.length >
            0
        ) {

            return REPORT_STATUSES
                .INVALID;
        }

        if (
            this.warnings.length >
            0
        ) {

            return REPORT_STATUSES
                .DEGRADED;
        }

        if (
            this.info.length >=
            0
        ) {

            return REPORT_STATUSES
                .VALID;
        }

        return REPORT_STATUSES
            .UNKNOWN;
    }

    /**
     * -------------------------------------------------------------------------
     * Is valid?
     * -------------------------------------------------------------------------
     */

    isValid() {

        return (
            this.critical.length ===
                0 &&
            this.errors.length ===
                0
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Is ready?
     * -------------------------------------------------------------------------
     */

    isReady() {

        return this.isValid();
    }

    /**
     * -------------------------------------------------------------------------
     * Summary.
     * -------------------------------------------------------------------------
     */

    summary() {

        const subsystemCount =
            this.subsystems.size;

        const validatorCount =
            this.validators.size;

        const total =
            this.info.length +
            this.warnings.length +
            this.errors.length +
            this.critical.length;

        return {
            total,

            info:
                this.info.length,

            warnings:
                this.warnings.length,

            errors:
                this.errors.length,

            critical:
                this.critical.length,

            blocking:
                this.errors.length +
                this.critical.length,

            subsystems:
                subsystemCount,

            validators:
                validatorCount,

            variables:
                this.variables.size,

            valid:
                this.isValid(),

            ready:
                this.isReady(),

            status:
                this.getStatus(),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * All errors in deterministic order.
     * -------------------------------------------------------------------------
     */

    getAllErrors() {

        const errors =
            [
                ...this.critical,
                ...this.errors,
                ...(
                    this.options
                        .includeWarnings
                        ? this.warnings
                        : []
                ),
                ...(
                    this.options
                        .includeInfo
                        ? this.info
                        : []
                ),
            ];

        return errors
            .sort(
                (
                    left,
                    right,
                ) =>
                    severityRank(
                        right.severity,
                        this.options,
                    ) -
                    severityRank(
                        left.severity,
                        this.options,
                    ) ||
                    String(
                        left.variable ||
                        '',
                    ).localeCompare(
                        String(
                            right.variable ||
                            '',
                        ),
                    ) ||
                    String(
                        left.code ||
                        '',
                    ).localeCompare(
                        String(
                            right.code ||
                            '',
                        ),
                    ),
            );
    }

    /**
     * -------------------------------------------------------------------------
     * Critical errors.
     * -------------------------------------------------------------------------
     */

    getCriticalErrors() {

        return [
            ...this.critical,
        ];
    }

    /**
     * -------------------------------------------------------------------------
     * Blocking errors.
     * -------------------------------------------------------------------------
     */

    getBlockingErrors() {

        return [
            ...this.critical,
            ...this.errors,
        ];
    }

    /**
     * -------------------------------------------------------------------------
     * Warning list.
     * -------------------------------------------------------------------------
     */

    getWarnings() {

        return [
            ...this.warnings,
        ];
    }

    /**
     * -------------------------------------------------------------------------
     * By subsystem.
     * -------------------------------------------------------------------------
     */

    getSubsystemReport() {

        return [
            ...this.subsystems.values(),
        ]
            .map(
                subsystem => ({
                    name:
                        subsystem.name,

                    validators:
                        [
                            ...subsystem
                                .validators,
                        ].sort(),

                    total:
                        subsystem.total,

                    info:
                        subsystem.info,

                    warnings:
                        subsystem.warnings,

                    errors:
                        subsystem.errors,

                    critical:
                        subsystem.critical,

                    blocking:
                        subsystem.errors +
                        subsystem.critical,

                    valid:
                        subsystem.valid,
                }),
            )
            .sort(
                (
                    left,
                    right,
                ) =>
                    Number(
                        right.blocking >
                        0,
                    ) -
                    Number(
                        left.blocking >
                        0,
                    ) ||
                    right.total -
                    left.total ||
                    left.name.localeCompare(
                        right.name,
                    ),
            );
    }

    /**
     * -------------------------------------------------------------------------
     * By variable.
     * -------------------------------------------------------------------------
     */

    getVariableReport() {

        return [
            ...this.variables.values(),
        ]
            .map(
                variable => ({
                    variable:
                        variable.variable,

                    total:
                        variable.total,

                    info:
                        variable.info,

                    warnings:
                        variable.warnings,

                    errors:
                        variable.errors,

                    critical:
                        variable.critical,

                    blocking:
                        variable.errors +
                        variable.critical,

                    codes:
                        [
                            ...variable
                                .codes,
                        ].sort(),

                    validators:
                        [
                            ...variable
                                .validators,
                        ].sort(),
                }),
            )
            .sort(
                (
                    left,
                    right,
                ) =>
                    right.blocking -
                    left.blocking ||
                    right.total -
                    left.total ||
                    left.variable.localeCompare(
                        right.variable,
                    ),
            );
    }

    /**
     * -------------------------------------------------------------------------
     * Validator report.
     * -------------------------------------------------------------------------
     */

    getValidatorReport() {

        return [
            ...this.validators.values(),
        ]
            .map(
                validator => ({
                    ...validator,
                }),
            )
            .sort(
                (
                    left,
                    right,
                ) =>
                    Number(
                        !left.valid,
                    ) -
                    Number(
                        !right.valid,
                    ) ||
                    left.validator.localeCompare(
                        right.validator,
                    ),
            );
    }

    /**
     * -------------------------------------------------------------------------
     * Fingerprint.
     * -------------------------------------------------------------------------
     */

    getFingerprint() {

        return fingerprint(
            {
                environment:
                    this.options
                        .environment,

                status:
                    this.getStatus(),

                summary:
                    this.summary(),

                errors:
                    this.getAllErrors()
                        .map(
                            error => ({
                                code:
                                    error.code,

                                severity:
                                    error.severity,

                                category:
                                    error.category,

                                variable:
                                    error.variable,

                                subsystem:
                                    error.subsystem,

                                validator:
                                    error.validator,

                                message:
                                    error.message,
                            }),
                        ),

                validators:
                    this.getValidatorReport()
                        .map(
                            validator => ({
                                validator:
                                    validator
                                        .validator,

                                valid:
                                    validator
                                        .valid,

                                status:
                                    validator
                                        .status,

                                fingerprint:
                                    validator
                                        .fingerprint,
                            }),
                        ),
            },
            this.options,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Machine-readable object report.
     * -------------------------------------------------------------------------
     */

    toObject(
        options = {},
    ) {

        const mergedOptions =
            {
                ...this.options,
                ...options,
            };

        const allErrors =
            this.getAllErrors();

        const result = {
            component:
                COMPONENT,

            application:
                APPLICATION_NAME,

            service:
                SERVICE_NAME,

            environment:
                mergedOptions
                    .environment,

            status:
                this.getStatus(),

            valid:
                this.isValid(),

            ready:
                this.isReady(),

            summary:
                this.summary(),

            validators:
                this.getValidatorReport(),

            subsystems:
                mergedOptions
                    .includeDetails
                    ? this.getSubsystemReport()
                    : undefined,

            variables:
                mergedOptions
                    .includeDetails
                    ? this.getVariableReport()
                    : undefined,

            errors:
                allErrors,

            fingerprint:
                mergedOptions
                    .includeFingerprint
                    ? this.getFingerprint()
                    : undefined,

            startedAt:
                this.createdAt,

            completedAt:
                this.completedAt ||
                new Date().toISOString(),

            generatedAt:
                new Date().toISOString(),
        };

        return deepFreeze(
            removeUndefinedDeep(
                result,
            ),
        );
    }

    /**
     * -------------------------------------------------------------------------
     * JSON report.
     * -------------------------------------------------------------------------
     */

    toJSON(
        options = {},
    ) {

        const object =
            this.toObject(
                {
                    ...options,
                    format:
                        REPORT_FORMATS
                            .JSON,
                },
            );

        const serialized =
            JSON.stringify(
                object,
            );

        if (
            Buffer.byteLength(
                serialized,
                'utf8',
            ) >
            this.options
                .maxReportSize
        ) {

            throw new ValidationReportError(
                'TITech validation report exceeds the configured maximum size.',
                {
                    code:
                        'TITECH_VALIDATION_REPORT_TOO_LARGE',
                },
            );
        }

        return serialized;
    }

    /**
     * -------------------------------------------------------------------------
     * Human-readable summary.
     * -------------------------------------------------------------------------
     */

    toSummary(
        options = {},
    ) {

        const summary =
            this.summary();

        const lines = [
            `TITech Configuration Validation`,
            `Environment: ${this.options.environment}`,
            `Status: ${summary.status}`,
            `Valid: ${summary.valid}`,
            `Ready: ${summary.ready}`,
            `Total findings: ${summary.total}`,
            `Critical: ${summary.critical}`,
            `Errors: ${summary.errors}`,
            `Warnings: ${summary.warnings}`,
            `Info: ${summary.info}`,
            `Validators: ${summary.validators}`,
            `Subsystems: ${summary.subsystems}`,
        ];

        return lines.join(
            '\n',
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Human-readable detailed report.
     * -------------------------------------------------------------------------
     */

    toText(
        options = {},
    ) {

        const mergedOptions =
            {
                ...this.options,
                ...options,
            };

        const summary =
            this.summary();

        const lines = [
            '===============================================================================',
            'TITech Community Capital',
            'Enterprise Configuration Validation Report',
            '===============================================================================',
            `Environment : ${mergedOptions.environment}`,
            `Status      : ${summary.status}`,
            `Valid       : ${summary.valid}`,
            `Ready       : ${summary.ready}`,
            `Generated   : ${new Date().toISOString()}`,
            '',
            'Summary',
            '-------',
            `Total       : ${summary.total}`,
            `Critical    : ${summary.critical}`,
            `Errors      : ${summary.errors}`,
            `Warnings    : ${summary.warnings}`,
            `Info        : ${summary.info}`,
            `Validators  : ${summary.validators}`,
            `Subsystems  : ${summary.subsystems}`,
            `Variables   : ${summary.variables}`,
        ];

        if (
            summary.total >
            0
        ) {

            lines.push(
                '',
                'Findings',
                '--------',
            );

            for (
                const error of
                this.getAllErrors()
            ) {

                const location =
                    error.variable ||
                    error.path ||
                    '__global__';

                const subsystem =
                    error.subsystem ||
                    error.validator ||
                    'unknown';

                lines.push(
                    `[${String(
                        error.severity,
                    ).toUpperCase()}] ` +
                    `${error.code} ` +
                    `${location} ` +
                    `(${subsystem}) - ` +
                    `${error.message}`,
                );
            }
        }

        if (
            mergedOptions.includeDetails
        ) {

            lines.push(
                '',
                'Subsystems',
                '----------',
            );

            for (
                const subsystem of
                this.getSubsystemReport()
            ) {

                lines.push(
                    `${subsystem.name}: ` +
                    `status=${
                        subsystem.valid
                            ? 'valid'
                            : 'invalid'
                    }, ` +
                    `total=${
                        subsystem.total
                    }, ` +
                    `blocking=${
                        subsystem.blocking
                    }`,
                );
            }
        }

        if (
            mergedOptions.includeFingerprint
        ) {

            lines.push(
                '',
                `Fingerprint: ${this.getFingerprint()}`,
            );
        }

        return lines.join(
            '\n',
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Health report.
     * -------------------------------------------------------------------------
     */

    toHealth(
        options = {},
    ) {

        const summary =
            this.summary();

        return deepFreeze({
            status:
                summary.status ===
                REPORT_STATUSES.INVALID
                    ? 'unhealthy'
                    : summary.status ===
                        REPORT_STATUSES.DEGRADED
                        ? 'degraded'
                        : 'healthy',

            healthy:
                summary.valid,

            ready:
                summary.ready,

            environment:
                this.options
                    .environment,

            blockingErrors:
                summary.blocking,

            warnings:
                summary.warnings,

            validators:
                summary.validators,

            subsystems:
                summary.subsystems,

            fingerprint:
                this.getFingerprint(),

            timestamp:
                new Date().toISOString(),
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Complete report.
     * -------------------------------------------------------------------------
     */

    finalize() {

        this.completedAt =
            new Date().toISOString();

        this.state =
            this.isValid()
                ? 'ready'
                : 'failed';

        this.validationCount +=
            1;

        this.lastReport =
            this.toObject();

        return this;
    }

    /**
     * -------------------------------------------------------------------------
     * Build a report from an array of validator results.
     * -------------------------------------------------------------------------
     */

    collect(
        results = [],
        context = {},
    ) {

        this.state =
            'collecting';

        this.addResults(
            results,
            context,
        );

        return this.finalize();
    }

    /**
     * -------------------------------------------------------------------------
     * Merge another report.
     * -------------------------------------------------------------------------
     */

    merge(
        report,
        options = {},
    ) {

        if (
            report instanceof
            ValidationReport
        ) {

            this.addResults(
                report
                    .getValidatorReport()
                    .map(
                        validator => ({
                            validator:
                                validator
                                    .validator,

                            subsystem:
                                validator
                                    .subsystem,

                            valid:
                                validator
                                    .valid,

                            status:
                                validator
                                    .status,

                            fingerprint:
                                validator
                                    .fingerprint,

                            errors:
                                report
                                    .getAllErrors()
                                    .filter(
                                        error =>
                                            error
                                                .validator ===
                                            validator
                                                .validator,
                                    ),
                        }),
                    ),
                options,
            );

            return this;
        }

        if (
            report &&
            typeof report ===
                'object'
        ) {

            this.addResult(
                report,
                options,
            );

            return this;
        }

        throw new ValidationReportError(
            'TITech validation report merge() requires a ValidationReport or report object.',
            {
                code:
                    'TITECH_VALIDATION_REPORT_MERGE_INVALID',
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Reset.
     * -------------------------------------------------------------------------
     */

    reset() {

        this.state =
            'created';

        this.createdAt =
            new Date().toISOString();

        this.completedAt =
            null;

        this.validationCount =
            0;

        this.entries =
            [];

        this.errors =
            [];

        this.warnings =
            [];

        this.info =
            [];

        this.critical =
            [];

        this.subsystems =
            new Map();

        this.variables =
            new Map();

        this.validators =
            new Map();

        this.lastReport =
            null;

        this.lastError =
            null;

        return this;
    }

    /**
     * -------------------------------------------------------------------------
     * Snapshot.
     * -------------------------------------------------------------------------
     */

    snapshot() {

        return deepFreeze({
            component:
                COMPONENT,

            service:
                SERVICE_NAME,

            application:
                APPLICATION_NAME,

            state:
                this.state,

            environment:
                this.options
                    .environment,

            validationCount:
                this.validationCount,

            summary:
                this.summary(),

            fingerprint:
                this.getFingerprint(),

            createdAt:
                this.createdAt,

            completedAt:
                this.completedAt,

            lastError:
                this.lastError
                    ? {
                        name:
                            this.lastError
                                .name,

                        code:
                            this.lastError
                                .code,

                        message:
                            this.lastError
                                .message,
                    }
                    : null,

            timestamp:
                new Date().toISOString(),
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Readiness.
     * -------------------------------------------------------------------------
     */

    readiness() {

        return {
            status:
                this.isReady()
                    ? 'ready'
                    : 'not_ready',

            ready:
                this.isReady(),

            state:
                this.state,

            environment:
                this.options
                    .environment,

            blockingErrors:
                this.getBlockingErrors()
                    .length,

            timestamp:
                new Date().toISOString(),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Health.
     * -------------------------------------------------------------------------
     */

    health() {

        const summary =
            this.summary();

        return {
            status:
                summary.status ===
                REPORT_STATUSES.INVALID
                    ? 'unhealthy'
                    : summary.status ===
                        REPORT_STATUSES.DEGRADED
                        ? 'degraded'
                        : 'healthy',

            healthy:
                summary.valid,

            state:
                this.state,

            summary,

            fingerprint:
                this.getFingerprint(),

            timestamp:
                new Date().toISOString(),
        };
    }
}

/**
 * =============================================================================
 * Deep undefined cleanup
 * =============================================================================
 */

function removeUndefinedDeep(
    value,
) {

    if (
        value ===
            undefined
    ) {

        return undefined;
    }

    if (
        value ===
            null
    ) {

        return null;
    }

    if (
        Array.isArray(
            value,
        )
    ) {

        return value
            .map(
                removeUndefinedDeep,
            )
            .filter(
                item =>
                    item !==
                    undefined,
            );
    }

    if (
        typeof value ===
        'object'
    ) {

        const result =
            {};

        for (
            const [
                key,
                item,
            ] of Object.entries(
                value,
            )
        ) {

            const sanitized =
                removeUndefinedDeep(
                    item,
                );

            if (
                sanitized !==
                undefined
            ) {

                result[key] =
                    sanitized;
            }
        }

        return result;
    }

    return value;
}

/**
 * =============================================================================
 * Aggregate convenience API
 * =============================================================================
 */

function createReport(
    options = {},
) {

    return new ValidationReport(
        options,
    );
}

function reportResults(
    results = [],
    options = {},
) {

    return new ValidationReport(
        options,
    )
        .collect(
            results,
        );
}

function reportError(
    error,
    options = {},
) {

    const report =
        new ValidationReport(
            options,
        );

    report.addErrorObject(
        error,
    );

    return report.finalize();
}

function isValidationFailure(
    error,
) {

    if (
        error instanceof
        EnvironmentValidationAggregateError
    ) {

        return true;
    }

    const errors =
        extractErrorsFromResult(
            error,
        );

    return errors.some(
        item =>
            severityRank(
                item?.severity,
                DEFAULTS,
            ) >=
            severityRank(
                VALIDATION_SEVERITIES
                    .ERROR,
                DEFAULTS,
            ),
    );
}

/**
 * =============================================================================
 * Singleton
 * =============================================================================
 */

const validationReport =
    new ValidationReport();

/**
 * =============================================================================
 * Public convenience functions
 * =============================================================================
 */

function validate(
    results,
    options = {},
) {

    validationReport.reset();

    validationReport.collect(
        Array.isArray(
            results,
        )
            ? results
            : [
                results,
            ],
    );

    return validationReport.toObject(
        options,
    );
}

function addResult(
    result,
    context = {},
) {

    validationReport.addResult(
        result,
        context,
    );

    return validationReport;
}

function addError(
    error,
    context = {},
) {

    validationReport.addErrorObject(
        error,
        context,
    );

    return validationReport;
}

function finalize() {

    validationReport.finalize();

    return validationReport;
}

function summary() {

    return validationReport.summary();
}

function toJSON(
    options = {},
) {

    return validationReport.toJSON(
        options,
    );
}

function toText(
    options = {},
) {

    return validationReport.toText(
        options,
    );
}

function toHealth(
    options = {},
) {

    return validationReport.toHealth(
        options,
    );
}

function snapshot() {

    return validationReport.snapshot();
}

function readiness() {

    return validationReport.readiness();
}

function health() {

    return validationReport.health();
}

function reset() {

    return validationReport.reset();
}

/**
 * =============================================================================
 * Public API
 * =============================================================================
 */

module.exports =
    Object.freeze({
        /**
         * Singleton/class.
         */
        validationReport,

        ValidationReport,

        ValidationReportError,

        /**
         * Constants.
         */
        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        REPORT_FORMATS,

        REPORT_STATUSES,

        DEFAULTS,

        /**
         * Report construction.
         */
        createReport,

        reportResults,

        reportError,

        /**
         * Convenience singleton API.
         */
        validate,

        addResult,

        addError,

        finalize,

        summary,

        toJSON,

        toText,

        toHealth,

        snapshot,

        readiness,

        health,

        reset,

        /**
         * Utility.
         */
        fingerprint,

        extractErrorsFromResult,

        normalizeValidationError,

        normalizeValidatorResult,

        isValidationFailure,
    });