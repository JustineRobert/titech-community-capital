'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/environment/validationErrors.js
 *
 * Purpose:
 *   Enterprise production-grade environment/configuration validation error
 *   model and aggregation boundary.
 *
 * Responsibilities:
 *   - Provide structured TITech environment validation errors.
 *   - Standardize validation error codes and severities.
 *   - Preserve variable/path/namespace context.
 *   - Aggregate multiple configuration validation failures.
 *   - Support warnings, errors and critical configuration failures.
 *   - Prevent sensitive values from appearing in errors.
 *   - Provide deterministic machine-readable error serialization.
 *   - Support environment/phase/component provenance.
 *   - Support fail-fast and aggregate validation modes.
 *   - Produce safe diagnostic snapshots.
 *   - Support compatibility with centralized application error handling.
 *
 * IMPORTANT:
 *
 *   This module models VALIDATION ERRORS.
 *
 *   It does NOT:
 *     - load environment files.
 *     - normalize values.
 *     - merge configuration layers.
 *     - determine precedence.
 *     - mutate process.env.
 *     - establish database connections.
 *     - establish Redis connections.
 *     - initialize queues.
 *     - start Express.
 *     - start the HTTP server.
 *     - execute business or financial transactions.
 *
 * Related modules:
 *
 *   backend/config/environment/environmentValidator.js
 *   backend/config/environment/requiredVariables.js
 *   backend/config/environment/normalizeEnvironment.js
 *   backend/config/environment/secretMasker.js
 *   backend/config/environment/stateManager.js
 *   backend/config/environment/environmentSnapshot.js
 *
 * =============================================================================
 */

const crypto =
    require('node:crypto');

/**
 * =============================================================================
 * Optional secret masker
 * =============================================================================
 */

let secretMaskerModule = null;

try {
    // eslint-disable-next-line global-require
    secretMaskerModule =
        require('./secretMasker');
} catch {
    secretMaskerModule = null;
}

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const COMPONENT =
    'environment-validation-errors';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

const VALIDATION_SEVERITIES =
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

const VALIDATION_CATEGORIES =
    Object.freeze({
        REQUIRED:
            'required',

        TYPE:
            'type',

        FORMAT:
            'format',

        RANGE:
            'range',

        ENUM:
            'enum',

        SECURITY:
            'security',

        DEPENDENCY:
            'dependency',

        PRECEDENCE:
            'precedence',

        NAMESPACE:
            'namespace',

        NORMALIZATION:
            'normalization',

        ENVIRONMENT:
            'environment',

        FEATURE:
            'feature',

        TENANT:
            'tenant',

        DATABASE:
            'database',

        REDIS:
            'redis',

        OBSERVABILITY:
            'observability',

        INTERNAL:
            'internal',

        UNKNOWN:
            'unknown',
    });

const VALIDATION_ERROR_CODES =
    Object.freeze({
        REQUIRED_VARIABLE_MISSING:
            'ENV_REQUIRED_VARIABLE_MISSING',

        REQUIRED_VARIABLE_EMPTY:
            'ENV_REQUIRED_VARIABLE_EMPTY',

        INVALID_TYPE:
            'ENV_INVALID_TYPE',

        INVALID_BOOLEAN:
            'ENV_INVALID_BOOLEAN',

        INVALID_INTEGER:
            'ENV_INVALID_INTEGER',

        INVALID_NUMBER:
            'ENV_INVALID_NUMBER',

        INVALID_URL:
            'ENV_INVALID_URL',

        INVALID_EMAIL:
            'ENV_INVALID_EMAIL',

        INVALID_JSON:
            'ENV_INVALID_JSON',

        INVALID_ENUM:
            'ENV_INVALID_ENUM',

        INVALID_FORMAT:
            'ENV_INVALID_FORMAT',

        INVALID_RANGE:
            'ENV_INVALID_RANGE',

        INVALID_VALUE:
            'ENV_INVALID_VALUE',

        INVALID_NAMESPACE:
            'ENV_INVALID_NAMESPACE',

        PRECEDENCE_CONFLICT:
            'ENV_PRECEDENCE_CONFLICT',

        PRECEDENCE_VIOLATION:
            'ENV_PRECEDENCE_VIOLATION',

        DEPENDENCY_MISSING:
            'ENV_DEPENDENCY_MISSING',

        CONDITION_UNSATISFIED:
            'ENV_CONDITION_UNSATISFIED',

        SECURITY_POLICY_VIOLATION:
            'ENV_SECURITY_POLICY_VIOLATION',

        SECRET_POLICY_VIOLATION:
            'ENV_SECRET_POLICY_VIOLATION',

        TENANT_ISOLATION_VIOLATION:
            'ENV_TENANT_ISOLATION_VIOLATION',

        FINANCIAL_POLICY_VIOLATION:
            'ENV_FINANCIAL_POLICY_VIOLATION',

        ENVIRONMENT_UNSUPPORTED:
            'ENV_ENVIRONMENT_UNSUPPORTED',

        CONFIGURATION_INCONSISTENT:
            'ENV_CONFIGURATION_INCONSISTENT',

        VALIDATION_EXCEPTION:
            'ENV_VALIDATION_EXCEPTION',

        UNKNOWN:
            'ENV_VALIDATION_UNKNOWN',
    });

const VALIDATION_STATES =
    Object.freeze({
        OPEN:
            'open',

        RESOLVED:
            'resolved',

        IGNORED:
            'ignored',
    });

const DEFAULTS =
    Object.freeze({
        maxErrors:
            500,

        maxContextKeys:
            100,

        maxMessageLength:
            2_048,

        maxPathLength:
            512,

        maxVariableLength:
            256,

        includeStack:
            false,

        includeRawValues:
            false,

        redactSensitive:
            true,

        fingerprintAlgorithm:
            'sha256',

        fingerprintPrefix:
            'sha256:',

        sensitivePattern:
            /(password|passwd|secret|token|authorization|api[_-]?key|private[_-]?key|client[_-]?secret|encryption[_-]?key|connection[_-]?(string|uri|url)|jwt[_-]?secret|access[_-]?token|refresh[_-]?token|cookie|credential|signing[_-]?key|pin|otp|cvv|cvc)/i,

        failClosed:
            true,
    });

/**
 * =============================================================================
 * Errors
 * =============================================================================
 */

class EnvironmentValidationError extends Error {

    constructor(
        message,
        options = {},
    ) {

        super(
            message,
        );

        this.name =
            'EnvironmentValidationError';

        this.code =
            options.code ||
            VALIDATION_ERROR_CODES
                .UNKNOWN;

        this.category =
            options.category ||
            VALIDATION_CATEGORIES.UNKNOWN;

        this.severity =
            options.severity ||
            VALIDATION_SEVERITIES.ERROR;

        this.variable =
            options.variable ||
            null;

        this.path =
            options.path ||
            null;

        this.namespace =
            options.namespace ||
            null;

        this.environment =
            options.environment ||
            null;

        this.phase =
            options.phase ||
            null;

        this.component =
            options.component ||
            COMPONENT;

        this.expected =
            options.expected ===
                undefined
                ? null
                : options.expected;

        this.actual =
            options.actual ===
                undefined
                ? null
                : options.actual;

        this.context =
            cloneSafe(
                options.context ||
                {},
            );

        this.fingerprint =
            options.fingerprint ||
            null;

        this.cause =
            options.cause ||
            null;

        this.timestamp =
            options.timestamp ||
            new Date().toISOString();

        if (
            options.stack
        ) {

            this.stack =
                options.stack;
        }

        Error.captureStackTrace?.(
            this,
            EnvironmentValidationError,
        );
    }

    toJSON(
        options = {},
    ) {

        return serializeValidationError(
            this,
            options,
        );
    }
}

class EnvironmentValidationAggregateError extends EnvironmentValidationError {

    constructor(
        errors = [],
        options = {},
    ) {

        const normalizedErrors =
            errors.map(
                error =>
                    normalizeValidationError(
                        error,
                    ),
            );

        const total =
            normalizedErrors.length;

        const critical =
            normalizedErrors.filter(
                error =>
                    error.severity ===
                    VALIDATION_SEVERITIES
                        .CRITICAL,
            ).length;

        const errorCount =
            normalizedErrors.filter(
                error =>
                    error.severity ===
                    VALIDATION_SEVERITIES
                        .ERROR,
            ).length;

        const warningCount =
            normalizedErrors.filter(
                error =>
                    error.severity ===
                    VALIDATION_SEVERITIES
                        .WARNING,
            ).length;

        super(
            options.message ||
                `TITech environment validation failed with ${total} validation issue(s).`,
            {
                ...options,

                code:
                    options.code ||
                    'ENVIRONMENT_VALIDATION_FAILED',

                category:
                    options.category ||
                    VALIDATION_CATEGORIES
                        .ENVIRONMENT,

                severity:
                    critical > 0
                        ? VALIDATION_SEVERITIES
                            .CRITICAL
                        : errorCount > 0
                            ? VALIDATION_SEVERITIES
                                .ERROR
                            : VALIDATION_SEVERITIES
                                .WARNING,
            },
        );

        this.errors =
            Object.freeze(
                normalizedErrors,
            );

        this.summary =
            Object.freeze({
                total,

                critical,

                errors:
                    errorCount,

                warnings:
                    warningCount,

                resolved:
                    0,

                open:
                    total,
            });
    }

    toJSON(
        options = {},
    ) {

        const base =
            super.toJSON(
                options,
            );

        return {
            ...base,

            aggregate:
                true,

            summary:
                this.summary,

            errors:
                this.errors.map(
                    error =>
                        serializeValidationError(
                            error,
                            options,
                        ),
                ),
        };
    }
}

/**
 * =============================================================================
 * Utility functions
 * =============================================================================
 */

function cloneSafe(
    value,
    depth = 0,
    seen = new WeakSet(),
) {

    if (
        depth > 10
    ) {
        return '[MAX_DEPTH]';
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

        if (
            typeof value ===
                'string' &&
            value.length >
                DEFAULTS
                    .maxMessageLength
        ) {

            return value.slice(
                0,
                DEFAULTS
                    .maxMessageLength,
            ) + '[TRUNCATED]';
        }

        return value;
    }

    if (
        seen.has(
            value,
        )
    ) {

        return '[CIRCULAR]';
    }

    seen.add(
        value,
    );

    if (
        Array.isArray(
            value,
        )
    ) {

        return value.map(
            item =>
                cloneSafe(
                    item,
                    depth + 1,
                    seen,
                ),
        );
    }

    const output = {};

    const keys =
        Object.keys(
            value,
        )
            .slice(
                0,
                DEFAULTS
                    .maxContextKeys,
            );

    for (
        const key of
        keys
    ) {

        if (
            key ===
                '__proto__' ||
            key ===
                'prototype' ||
            key ===
                'constructor'
        ) {

            continue;
        }

        output[key] =
            cloneSafe(
                value[key],
                depth + 1,
                seen,
            );
    }

    return output;
}

function normalizeText(
    value,
    fallback = '',
    maxLength =
        DEFAULTS.maxMessageLength,
) {

    if (
        value ===
            undefined ||
        value ===
            null
    ) {

        return fallback;
    }

    const result =
        String(
            value,
        )
            .trim();

    if (
        result.length <=
        maxLength
    ) {

        return result;
    }

    return (
        result.slice(
            0,
            maxLength,
        ) +
        '[TRUNCATED]'
    );
}

function normalizeVariable(
    value,
) {

    return normalizeText(
        value,
        null,
        DEFAULTS.maxVariableLength,
    ) || null;
}

function normalizePath(
    value,
) {

    const result =
        normalizeText(
            value,
            '',
            DEFAULTS.maxPathLength,
        )
            .replace(
                /\[(\w+)\]/g,
                '.$1',
            )
            .split('.')
            .filter(Boolean)
            .join('.');

    return result || null;
}

function normalizeEnvironment(
    value,
) {

    return (
        normalizeText(
            value,
            process.env.NODE_ENV ||
                'development',
            64,
        )
            .toLowerCase()
    );
}

function isSensitive(
    key,
    options = DEFAULTS,
) {

    if (
        !key
    ) {

        return false;
    }

    return (
        options.sensitivePattern ||
        DEFAULTS.sensitivePattern
    ).test(
        String(
            key,
        ),
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

    return (
        options.fingerprintPrefix ||
        DEFAULTS.fingerprintPrefix
    ) +
    crypto
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

function maskValue(
    value,
    key,
    options = DEFAULTS,
) {

    if (
        !options.redactSensitive ||
        options.includeRawValues
    ) {

        return value;
    }

    if (
        !isSensitive(
            key,
            options,
        )
    ) {

        return value;
    }

    try {

        if (
            secretMaskerModule?.maskKeyValue
        ) {

            return secretMaskerModule
                .maskKeyValue(
                    key,
                    value,
                );
        }

        if (
            secretMaskerModule?.mask
        ) {

            return secretMaskerModule.mask(
                value,
                {
                    mode:
                        'redact',
                },
            );
        }

    } catch {
        // Fall through to local redaction.
    }

    return '[REDACTED]';
}

function normalizeCode(
    value,
) {

    return normalizeText(
        value,
        VALIDATION_ERROR_CODES
            .UNKNOWN,
        128,
    )
        .toUpperCase();
}

function normalizeSeverity(
    value,
) {

    const severity =
        normalizeText(
            value,
            VALIDATION_SEVERITIES
                .ERROR,
            32,
        )
            .toLowerCase();

    return Object.values(
        VALIDATION_SEVERITIES,
    ).includes(
        severity,
    )
        ? severity
        : VALIDATION_SEVERITIES
            .ERROR;
}

function normalizeCategory(
    value,
) {

    const category =
        normalizeText(
            value,
            VALIDATION_CATEGORIES
                .UNKNOWN,
            64,
        )
            .toLowerCase();

    return Object.values(
        VALIDATION_CATEGORIES,
    ).includes(
        category,
    )
        ? category
        : VALIDATION_CATEGORIES
            .UNKNOWN;
}

function normalizeStatus(
    value,
) {

    const status =
        normalizeText(
            value,
            VALIDATION_STATES.OPEN,
            32,
        )
            .toLowerCase();

    return Object.values(
        VALIDATION_STATES,
    ).includes(
        status,
    )
        ? status
        : VALIDATION_STATES.OPEN;
}

/**
 * =============================================================================
 * Error normalization
 * =============================================================================
 */

function normalizeValidationError(
    error,
    options = {},
) {

    if (
        error instanceof
        EnvironmentValidationError
    ) {

        return error;
    }

    if (
        error instanceof Error
    ) {

        return new EnvironmentValidationError(
            normalizeText(
                error.message,
                'Environment validation failed.',
            ),
            {
                code:
                    error.code ||
                    VALIDATION_ERROR_CODES
                        .VALIDATION_EXCEPTION,

                category:
                    options.category ||
                    VALIDATION_CATEGORIES
                        .INTERNAL,

                severity:
                    options.severity ||
                    VALIDATION_SEVERITIES
                        .ERROR,

                variable:
                    options.variable,

                path:
                    options.path,

                environment:
                    options.environment,

                phase:
                    options.phase,

                component:
                    options.component,

                cause:
                    error,
            },
        );
    }

    if (
        error &&
        typeof error ===
            'object'
    ) {

        return new EnvironmentValidationError(
            normalizeText(
                error.message,
                'Environment validation failed.',
            ),
            {
                ...error,

                code:
                    error.code ||
                    VALIDATION_ERROR_CODES
                        .VALIDATION_EXCEPTION,

                category:
                    error.category ||
                    options.category ||
                    VALIDATION_CATEGORIES
                        .INTERNAL,

                severity:
                    error.severity ||
                    options.severity ||
                    VALIDATION_SEVERITIES
                        .ERROR,
            },
        );
    }

    return new EnvironmentValidationError(
        normalizeText(
            error,
            'Environment validation failed.',
        ),
        {
            code:
                options.code ||
                VALIDATION_ERROR_CODES
                    .UNKNOWN,

            category:
                options.category ||
                VALIDATION_CATEGORIES
                    .UNKNOWN,

            severity:
                options.severity ||
                VALIDATION_SEVERITIES
                    .ERROR,

            variable:
                options.variable,

            path:
                options.path,

            environment:
                options.environment,
        },
    );
}

/**
 * =============================================================================
 * Safe serialization
 * =============================================================================
 */

function serializeValidationError(
    error,
    options = {},
) {

    const config =
        {
            ...DEFAULTS,
            ...options,
        };

    const normalized =
        normalizeValidationError(
            error,
        );

    const variable =
        normalizeVariable(
            normalized.variable,
        );

    const path =
        normalizePath(
            normalized.path,
        );

    const output = {
        name:
            normalized.name,

        code:
            normalized.code,

        category:
            normalized.category,

        severity:
            normalized.severity,

        status:
            normalizeStatus(
                normalized.status ||
                VALIDATION_STATES.OPEN,
            ),

        message:
            normalizeText(
                normalized.message,
            ),

        variable,

        path,

        namespace:
            normalized.namespace ||
            null,

        environment:
            normalized.environment
                ? normalizeEnvironment(
                    normalized.environment,
                )
                : null,

        phase:
            normalized.phase ||
            null,

        component:
            normalized.component ||
            COMPONENT,

        expected:
            normalizeDiagnosticValue(
                normalized.expected,
                'expected',
                config,
            ),

        actual:
            normalizeDiagnosticValue(
                normalized.actual,
                variable ||
                    path ||
                    'actual',
                config,
            ),

        context:
            normalizeDiagnosticValue(
                normalized.context,
                'context',
                config,
            ),

        fingerprint:
            normalized.fingerprint ||
            fingerprint(
                {
                    code:
                        normalized.code,

                    category:
                        normalized.category,

                    severity:
                        normalized.severity,

                    variable,

                    path,

                    message:
                        normalized.message,
                },
                config,
            ),

        timestamp:
            normalized.timestamp,
    };

    if (
        config.includeStack &&
        normalized.stack
    ) {

        output.stack =
            config.redactSensitive
                ? sanitizeStack(
                    normalized.stack,
                    config,
                )
                : normalized.stack;
    }

    if (
        normalized.cause
    ) {

        output.cause =
            serializeValidationErrorCause(
                normalized.cause,
                config,
            );
    }

    return removeUndefined(
        output,
    );
}

function normalizeDiagnosticValue(
    value,
    key,
    options,
) {

    if (
        value ===
            undefined ||
        value ===
            null
    ) {

        return value ===
            undefined
            ? undefined
            : null;
    }

    if (
        options.redactSensitive &&
        isSensitive(
            key,
            options,
        )
    ) {

        return maskValue(
            value,
            key,
            options,
        );
    }

    if (
        typeof value ===
        'object'
    ) {

        return sanitizeObject(
            value,
            options,
            0,
        );
    }

    return value;
}

function sanitizeObject(
    value,
    options,
    depth,
) {

    if (
        depth > 10
    ) {

        return '[MAX_DEPTH]';
    }

    if (
        value ===
        null ||
        value ===
        undefined
    ) {

        return value;
    }

    if (
        typeof value !==
        'object'
    ) {

        return value;
    }

    if (
        Array.isArray(
            value,
        )
    ) {

        return value.map(
            item =>
                sanitizeObject(
                    item,
                    options,
                    depth + 1,
                ),
        );
    }

    const output = {};

    for (
        const [
            key,
            child,
        ] of Object.entries(
            value,
        )
    ) {

        if (
            key ===
                '__proto__' ||
            key ===
                'prototype' ||
            key ===
                'constructor'
        ) {

            continue;
        }

        if (
            isSensitive(
                key,
                options,
            )
        ) {

            output[key] =
                maskValue(
                    child,
                    key,
                    options,
                );

            continue;
        }

        output[key] =
            sanitizeObject(
                child,
                options,
                depth + 1,
            );
    }

    return output;
}

function sanitizeStack(
    stack,
    options,
) {

    if (
        secretMaskerModule?.sanitizeString
    ) {

        try {

            return secretMaskerModule
                .sanitizeString(
                    String(
                        stack,
                    ),
                );

        } catch {
            // Fall through.
        }
    }

    return String(
        stack,
    )
        .replace(
            /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi,
            'Bearer [REDACTED]',
        )
        .replace(
            /(?:password|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi,
            '[REDACTED]',
        );
}

function serializeValidationErrorCause(
    cause,
    options,
) {

    if (
        cause instanceof
        EnvironmentValidationError
    ) {

        return serializeValidationError(
            cause,
            options,
        );
    }

    if (
        cause instanceof Error
    ) {

        return {
            name:
                cause.name,

            code:
                cause.code ||
                null,

            message:
                sanitizeStack(
                    cause.message,
                    options,
                ),
        };
    }

    return sanitizeObject(
        cause,
        options,
        0,
    );
}

function removeUndefined(
    value,
) {

    if (
        Array.isArray(
            value,
        )
    ) {

        return value.map(
            item =>
                removeUndefined(
                    item,
                ),
        );
    }

    if (
        value &&
        typeof value ===
            'object'
    ) {

        const output = {};

        for (
            const [
                key,
                child,
            ] of Object.entries(
                value,
            )
        ) {

            if (
                child ===
                undefined
            ) {
                continue;
            }

            output[key] =
                removeUndefined(
                    child,
                );
        }

        return output;
    }

    return value;
}

/**
 * =============================================================================
 * ValidationErrorCollection
 * =============================================================================
 */

class ValidationErrorCollection {

    constructor(
        options = {},
    ) {

        this.options =
            Object.freeze({
                ...DEFAULTS,
                ...options,
            });

        this.errors =
            [];

        this.resolved =
            [];

        this.state =
            'open';

        this.createdAt =
            new Date();

        this.closedAt =
            null;

        this.lastFingerprint =
            null;
    }

    /**
     * -------------------------------------------------------------------------
     * Add an error.
     * -------------------------------------------------------------------------
     */

    add(
        error,
        options = {},
    ) {

        if (
            this.errors.length >=
            this.options.maxErrors
        ) {

            throw new EnvironmentValidationError(
                'TITech environment validation error limit exceeded.',
                {
                    code:
                        'ENV_VALIDATION_ERROR_LIMIT_EXCEEDED',

                    category:
                        VALIDATION_CATEGORIES
                            .INTERNAL,

                    severity:
                        VALIDATION_SEVERITIES
                            .CRITICAL,
                },
            );
        }

        const normalized =
            normalizeValidationError(
                error,
                options,
            );

        this.errors.push(
            normalized,
        );

        return normalized;
    }

    /**
     * -------------------------------------------------------------------------
     * Add from fields.
     * -------------------------------------------------------------------------
     */

    addIssue(
        issue = {},
    ) {

        return this.add(
            new EnvironmentValidationError(
                issue.message ||
                    'TITech environment validation issue.',
                issue,
            ),
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Resolve error.
     * -------------------------------------------------------------------------
     */

    resolve(
        errorOrIndex,
        metadata = {},
    ) {

        let index =
            -1;

        if (
            typeof errorOrIndex ===
            'number'
        ) {

            index =
                errorOrIndex;

        } else {

            index =
                this.errors.indexOf(
                    errorOrIndex,
                );
        }

        if (
            index < 0 ||
            index >=
                this.errors.length
        ) {

            return false;
        }

        const error =
            this.errors[
                index
            ];

        error.status =
            VALIDATION_STATES.RESOLVED;

        error.resolvedAt =
            new Date().toISOString();

        error.resolution =
            cloneSafe(
                metadata,
            );

        this.resolved.push(
            error,
        );

        return true;
    }

    /**
     * -------------------------------------------------------------------------
     * Close collection.
     * -------------------------------------------------------------------------
     */

    close() {

        this.state =
            'resolved';

        this.closedAt =
            new Date();

        return this;
    }

    /**
     * -------------------------------------------------------------------------
     * Query helpers.
     * -------------------------------------------------------------------------
     */

    getOpenErrors() {

        return this.errors.filter(
            error =>
                (
                    error.status ||
                    VALIDATION_STATES.OPEN
                ) ===
                VALIDATION_STATES.OPEN,
        );
    }

    getBySeverity(
        severity,
    ) {

        return this.errors.filter(
            error =>
                error.severity ===
                severity,
        );
    }

    getByCategory(
        category,
    ) {

        return this.errors.filter(
            error =>
                error.category ===
                category,
        );
    }

    hasErrors() {

        return this.getBlockingErrors()
            .length >
            0;
    }

    hasCriticalErrors() {

        return this.errors.some(
            error =>
                error.severity ===
                VALIDATION_SEVERITIES
                    .CRITICAL &&
                (
                    error.status ||
                    VALIDATION_STATES.OPEN
                ) ===
                VALIDATION_STATES.OPEN,
        );
    }

    getBlockingErrors() {

        return this.errors.filter(
            error =>
                (
                    error.status ||
                    VALIDATION_STATES.OPEN
                ) ===
                    VALIDATION_STATES.OPEN &&
                (
                    error.severity ===
                        VALIDATION_SEVERITIES
                            .ERROR ||
                    error.severity ===
                        VALIDATION_SEVERITIES
                            .CRITICAL
                ),
        );
    }

    getWarnings() {

        return this.errors.filter(
            error =>
                error.severity ===
                VALIDATION_SEVERITIES
                    .WARNING,
        );
    }

    count() {

        return this.errors.length;
    }

    /**
     * -------------------------------------------------------------------------
     * Summary.
     * -------------------------------------------------------------------------
     */

    summary() {

        const open =
            this.getOpenErrors();

        const blocking =
            this.getBlockingErrors();

        const critical =
            this.getBySeverity(
                VALIDATION_SEVERITIES
                    .CRITICAL,
            );

        const warnings =
            this.getWarnings();

        const categories = {};

        for (
            const error of
            this.errors
        ) {

            categories[
                error.category
            ] =
                (
                    categories[
                        error.category
                    ] ||
                    0
                ) +
                1;
        }

        return {
            total:
                this.errors.length,

            open:
                open.length,

            blocking:
                blocking.length,

            critical:
                critical.length,

            errors:
                this.getBySeverity(
                    VALIDATION_SEVERITIES
                        .ERROR,
                ).length,

            warnings:
                warnings.length,

            info:
                this.getBySeverity(
                    VALIDATION_SEVERITIES
                        .INFO,
                ).length,

            resolved:
                this.resolved.length,

            categories,
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Safe serialization.
     * -------------------------------------------------------------------------
     */

    toJSON(
        options = {},
    ) {

        const config =
            {
                ...this.options,
                ...options,
            };

        const errors =
            this.errors.map(
                error =>
                    serializeValidationError(
                        error,
                        config,
                    ),
            );

        const summary =
            this.summary();

        const payload = {
            component:
                COMPONENT,

            service:
                SERVICE_NAME,

            application:
                APPLICATION_NAME,

            state:
                this.state,

            createdAt:
                this.createdAt,

            closedAt:
                this.closedAt,

            summary,

            errors,

            fingerprint:
                fingerprint(
                    {
                        summary,

                        errors:
                            errors.map(
                                error => ({
                                    code:
                                        error.code,

                                    category:
                                        error.category,

                                    severity:
                                        error.severity,

                                    variable:
                                        error.variable,

                                    path:
                                        error.path,

                                    message:
                                        error.message,
                                }),
                            ),
                    },
                    config,
                ),
        };

        this.lastFingerprint =
            payload.fingerprint;

        return deepFreeze(
            payload,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Snapshot.
     * -------------------------------------------------------------------------
     */

    snapshot(
        options = {},
    ) {

        return this.toJSON(
            options,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Throw if blocking errors exist.
     * -------------------------------------------------------------------------
     */

    throwIfInvalid(
        options = {},
    ) {

        const blocking =
            this.getBlockingErrors();

        if (
            blocking.length ===
            0
        ) {

            return this;
        }

        throw new EnvironmentValidationAggregateError(
            blocking,
            {
                message:
                    options.message ||
                    'TITech environment configuration is invalid.',

                environment:
                    options.environment,

                phase:
                    options.phase,

                component:
                    options.component ||
                    COMPONENT,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Clear.
     * -------------------------------------------------------------------------
     */

    clear() {

        this.errors.length =
            0;

        this.resolved.length =
            0;

        this.state =
            'open';

        this.closedAt =
            null;

        this.lastFingerprint =
            null;

        return this;
    }
}

/**
 * =============================================================================
 * Factory functions
 * =============================================================================
 */

function requiredVariableError(
    variable,
    options = {},
) {

    return new EnvironmentValidationError(
        options.message ||
            `Required TITech environment variable "${variable}" is missing.`,
        {
            ...options,

            code:
                options.code ||
                VALIDATION_ERROR_CODES
                    .REQUIRED_VARIABLE_MISSING,

            category:
                options.category ||
                VALIDATION_CATEGORIES
                    .REQUIRED,

            severity:
                options.severity ||
                VALIDATION_SEVERITIES
                    .ERROR,

            variable,
        },
    );
}

function invalidTypeError(
    variable,
    expected,
    actual,
    options = {},
) {

    return new EnvironmentValidationError(
        options.message ||
            `TITech environment variable "${variable}" has an invalid type.`,
        {
            ...options,

            code:
                options.code ||
                VALIDATION_ERROR_CODES
                    .INVALID_TYPE,

            category:
                options.category ||
                VALIDATION_CATEGORIES
                    .TYPE,

            severity:
                options.severity ||
                VALIDATION_SEVERITIES
                    .ERROR,

            variable,

            expected,

            actual,
        },
    );
}

function invalidFormatError(
    variable,
    expected,
    actual,
    options = {},
) {

    return new EnvironmentValidationError(
        options.message ||
            `TITech environment variable "${variable}" has an invalid format.`,
        {
            ...options,

            code:
                options.code ||
                VALIDATION_ERROR_CODES
                    .INVALID_FORMAT,

            category:
                options.category ||
                VALIDATION_CATEGORIES
                    .FORMAT,

            severity:
                options.severity ||
                VALIDATION_SEVERITIES
                    .ERROR,

            variable,

            expected,

            actual,
        },
    );
}

function invalidRangeError(
    variable,
    expected,
    actual,
    options = {},
) {

    return new EnvironmentValidationError(
        options.message ||
            `TITech environment variable "${variable}" is outside the allowed range.`,
        {
            ...options,

            code:
                options.code ||
                VALIDATION_ERROR_CODES
                    .INVALID_RANGE,

            category:
                options.category ||
                VALIDATION_CATEGORIES
                    .RANGE,

            severity:
                options.severity ||
                VALIDATION_SEVERITIES
                    .ERROR,

            variable,

            expected,

            actual,
        },
    );
}

function invalidEnumError(
    variable,
    expected,
    actual,
    options = {},
) {

    return new EnvironmentValidationError(
        options.message ||
            `TITech environment variable "${variable}" contains an unsupported value.`,
        {
            ...options,

            code:
                options.code ||
                VALIDATION_ERROR_CODES
                    .INVALID_ENUM,

            category:
                options.category ||
                VALIDATION_CATEGORIES
                    .ENUM,

            severity:
                options.severity ||
                VALIDATION_SEVERITIES
                    .ERROR,

            variable,

            expected,

            actual,
        },
    );
}

function securityPolicyError(
    variable,
    options = {},
) {

    return new EnvironmentValidationError(
        options.message ||
            `TITech environment security policy validation failed for "${variable}".`,
        {
            ...options,

            code:
                options.code ||
                VALIDATION_ERROR_CODES
                    .SECURITY_POLICY_VIOLATION,

            category:
                options.category ||
                VALIDATION_CATEGORIES
                    .SECURITY,

            severity:
                options.severity ||
                VALIDATION_SEVERITIES
                    .CRITICAL,

            variable,
        },
    );
}

function precedenceError(
    path,
    options = {},
) {

    return new EnvironmentValidationError(
        options.message ||
            `TITech configuration precedence policy was violated for "${path}".`,
        {
            ...options,

            code:
                options.code ||
                VALIDATION_ERROR_CODES
                    .PRECEDENCE_VIOLATION,

            category:
                options.category ||
                VALIDATION_CATEGORIES
                    .PRECEDENCE,

            severity:
                options.severity ||
                VALIDATION_SEVERITIES
                    .CRITICAL,

            path,
        },
    );
}

function dependencyError(
    variable,
    dependencies,
    options = {},
) {

    return new EnvironmentValidationError(
        options.message ||
            `TITech environment dependency requirements for "${variable}" are not satisfied.`,
        {
            ...options,

            code:
                options.code ||
                VALIDATION_ERROR_CODES
                    .DEPENDENCY_MISSING,

            category:
                options.category ||
                VALIDATION_CATEGORIES
                    .DEPENDENCY,

            severity:
                options.severity ||
                VALIDATION_SEVERITIES
                    .ERROR,

            variable,

            expected:
                dependencies,
        },
    );
}

function tenantIsolationError(
    variable,
    options = {},
) {

    return new EnvironmentValidationError(
        options.message ||
            `TITech tenant isolation configuration is invalid.`,
        {
            ...options,

            code:
                options.code ||
                VALIDATION_ERROR_CODES
                    .TENANT_ISOLATION_VIOLATION,

            category:
                options.category ||
                VALIDATION_CATEGORIES
                    .TENANT,

            severity:
                options.severity ||
                VALIDATION_SEVERITIES
                    .CRITICAL,

            variable,
        },
    );
}

function financialPolicyError(
    variable,
    options = {},
) {

    return new EnvironmentValidationError(
        options.message ||
            `TITech financial configuration policy validation failed.`,
        {
            ...options,

            code:
                options.code ||
                VALIDATION_ERROR_CODES
                    .FINANCIAL_POLICY_VIOLATION,

            category:
                options.category ||
                VALIDATION_CATEGORIES
                    .FEATURE,

            severity:
                options.severity ||
                VALIDATION_SEVERITIES
                    .CRITICAL,

            variable,
        },
    );
}

/**
 * =============================================================================
 * Public API
 * =============================================================================
 */

module.exports =
    Object.freeze({
        /**
         * Error classes.
         */
        EnvironmentValidationError,

        EnvironmentValidationAggregateError,

        ValidationErrorCollection,

        /**
         * Constants.
         */
        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        VALIDATION_SEVERITIES,

        VALIDATION_CATEGORIES,

        VALIDATION_ERROR_CODES,

        VALIDATION_STATES,

        DEFAULTS,

        /**
         * Normalization.
         */
        normalizeValidationError,

        serializeValidationError,

        /**
         * Error factories.
         */
        requiredVariableError,

        invalidTypeError,

        invalidFormatError,

        invalidRangeError,

        invalidEnumError,

        securityPolicyError,

        precedenceError,

        dependencyError,

        tenantIsolationError,

        financialPolicyError,

        /**
         * Utilities.
         */
        normalizeEnvironment,

        normalizeVariable,

        normalizePath,

        fingerprint,

        stableStringify,

        /**
         * Safe diagnostics.
         */
        isSensitive,
    });