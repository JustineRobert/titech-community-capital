/**
 * ============================================================================
 * TITech Community Capital LTD
 * StatementErrors.js
 * ============================================================================
 *
 * Enterprise Statement Processing Error Framework
 *
 * Purpose:
 *
 * - Standardize all statement lifecycle failures.
 * - Provide machine-readable error codes.
 * - Support audit logging and observability.
 * - Enable retry / recovery decisions.
 * - Preserve financial processing failure context.
 * - Support distributed statement processing.
 * - Provide safe serialization for logs, queues and events.
 *
 * Used By:
 *
 * Statement Processing Pipeline:
 *
 * Import
 *   ↓
 * Validation
 *   ↓
 * Persistence
 *   ↓
 * Reconciliation
 *   ↓
 * Variance Detection
 *   ↓
 * Repair
 *   ↓
 * Reporting
 *
 * Design Principles:
 *
 * - Domain-specific errors.
 * - Serializable.
 * - Observable.
 * - Safe for distributed processing.
 * - No service dependencies.
 * - Retry-aware.
 * - Audit-friendly.
 * - Tenant-aware.
 * - Backward compatible.
 *
 * ============================================================================
 */

'use strict';

/**
 * ============================================================================
 * Error Codes
 * ============================================================================
 */

const STATEMENT_ERROR_CODES = Object.freeze({

    PROCESSING_FAILED:
        'STATEMENT_PROCESSING_FAILED',

    INVALID_CONTEXT:
        'STATEMENT_INVALID_CONTEXT',

    IMPORT_FAILED:
        'STATEMENT_IMPORT_FAILED',

    VALIDATION_FAILED:
        'STATEMENT_VALIDATION_FAILED',

    PERSISTENCE_FAILED:
        'STATEMENT_PERSISTENCE_FAILED',

    RECONCILIATION_FAILED:
        'STATEMENT_RECONCILIATION_FAILED',

    DUPLICATE_STATEMENT:
        'STATEMENT_DUPLICATE',

    INVALID_FORMAT:
        'STATEMENT_INVALID_FORMAT',

    INVALID_TRANSACTION:
        'STATEMENT_INVALID_TRANSACTION',

    SYSTEM_FAILURE:
        'STATEMENT_SYSTEM_FAILURE'

});

/**
 * ============================================================================
 * Error Severity
 * ============================================================================
 */

const STATEMENT_ERROR_SEVERITY = Object.freeze({

    INFO: 'INFO',

    WARNING: 'WARNING',

    ERROR: 'ERROR',

    CRITICAL: 'CRITICAL'

});

/**
 * ============================================================================
 * Processing Phases
 * ============================================================================
 *
 * These values intentionally remain strings so they are safe for:
 *
 * - logs
 * - metrics
 * - audit events
 * - queues
 * - persistence
 */

const STATEMENT_PROCESSING_PHASE = Object.freeze({

    CONTEXT: 'CONTEXT',

    IMPORT: 'IMPORT',

    VALIDATION: 'VALIDATION',

    PERSISTENCE: 'PERSISTENCE',

    RECONCILIATION: 'RECONCILIATION',

    VARIANCE_DETECTION: 'VARIANCE_DETECTION',

    REPAIR: 'REPAIR',

    REPORTING: 'REPORTING',

    SYSTEM: 'SYSTEM'

});

/**
 * ============================================================================
 * Utility: Safe Deep Freeze
 * ============================================================================
 *
 * Error metadata should not be mutated after construction.
 *
 * This implementation protects against:
 *
 * - circular references
 * - functions
 * - Error instances
 * - non-object values
 */

function deepFreeze(value, seen = new WeakSet()) {

    if (
        value === null ||
        typeof value !== 'object'
    ) {
        return value;
    }

    if (seen.has(value)) {
        return value;
    }

    seen.add(value);

    Object.getOwnPropertyNames(value)
        .forEach(property => {

            try {

                const child = value[property];

                if (
                    child &&
                    typeof child === 'object'
                ) {
                    deepFreeze(child, seen);
                }

            } catch (_) {

                /*
                 * Ignore inaccessible properties.
                 *
                 * Error serialization must never fail merely because
                 * diagnostic metadata contains an unusual object.
                 */

            }

        });

    try {

        Object.freeze(value);

    } catch (_) {

        /*
         * Best-effort freeze.
         */

    }

    return value;
}

/**
 * ============================================================================
 * Utility: Normalize Details
 * ============================================================================
 */

function normalizeDetails(details) {

    if (
        details === null ||
        details === undefined
    ) {
        return {};
    }

    if (
        typeof details !== 'object' ||
        Array.isArray(details)
    ) {
        return {
            value: details
        };
    }

    return {
        ...details
    };
}

/**
 * ============================================================================
 * Utility: Normalize String
 * ============================================================================
 */

function normalizeString(value, fallback = null) {

    if (
        value === undefined ||
        value === null
    ) {
        return fallback;
    }

    const normalized = String(value).trim();

    return normalized || fallback;
}

/**
 * ============================================================================
 * Base Statement Processing Error
 * ============================================================================
 */

class StatementProcessingError extends Error {

    /**
     * @param {string} message
     * @param {Object} details
     * @param {Object} options
     */
    constructor(

        message,

        details = {},

        {

            code =
                STATEMENT_ERROR_CODES.PROCESSING_FAILED,

            retryable = false,

            severity =
                STATEMENT_ERROR_SEVERITY.ERROR,

            cause = null,

            phase =
                STATEMENT_PROCESSING_PHASE.SYSTEM,

            operation = null,

            tenantId = null,

            batchId = null,

            statementId = null,

            correlationId = null,

            requestId = null,

            isOperational = true

        } = {}

    ) {

        super(
            normalizeString(
                message,
                'Statement processing failed'
            )
        );

        this.name =
            'StatementProcessingError';

        this.code =
            normalizeString(
                code,
                STATEMENT_ERROR_CODES.PROCESSING_FAILED
            );

        this.details =
            deepFreeze(
                normalizeDetails(details)
            );

        this.retryable =
            Boolean(retryable);

        this.severity =
            normalizeString(
                severity,
                STATEMENT_ERROR_SEVERITY.ERROR
            );

        this.phase =
            normalizeString(
                phase,
                STATEMENT_PROCESSING_PHASE.SYSTEM
            );

        this.operation =
            normalizeString(operation);

        this.tenantId =
            normalizeString(tenantId);

        this.batchId =
            normalizeString(batchId);

        this.statementId =
            normalizeString(statementId);

        this.correlationId =
            normalizeString(correlationId);

        this.requestId =
            normalizeString(requestId);

        this.isOperational =
            Boolean(isOperational);

        this.isDomainError = true;

        /*
         * Preserve the original cause for internal diagnostics.
         *
         * It is deliberately excluded from toJSON() to prevent leaking
         * internal stack traces, credentials, database information or
         * provider internals into external payloads.
         */
        this.cause =
            cause instanceof Error
                ? cause
                : null;

        this.timestamp =
            new Date();

        /*
         * Stable machine-readable identifier for this error occurrence.
         *
         * crypto.randomUUID() is intentionally avoided here to keep this
         * module lightweight and compatible with older Node runtimes.
         */
        this.errorId =
            `${Date.now()}-${Math.random()
                .toString(36)
                .slice(2, 10)}`;

        if (
            Error.captureStackTrace
        ) {

            Error.captureStackTrace(
                this,
                this.constructor
            );

        }

    }

    /**
     * =========================================================================
     * Safe Error Serialization
     * =========================================================================
     *
     * Suitable for:
     *
     * - structured logs
     * - audit records
     * - event payloads
     * - queue messages
     * - API error translators
     */
    toJSON() {

        return {

            errorId:
                this.errorId,

            name:
                this.name,

            code:
                this.code,

            message:
                this.message,

            details:
                this.details,

            retryable:
                this.retryable,

            severity:
                this.severity,

            phase:
                this.phase,

            operation:
                this.operation,

            tenantId:
                this.tenantId,

            batchId:
                this.batchId,

            statementId:
                this.statementId,

            correlationId:
                this.correlationId,

            requestId:
                this.requestId,

            isOperational:
                this.isOperational,

            isDomainError:
                this.isDomainError,

            timestamp:
                this.timestamp

        };

    }

    /**
     * =========================================================================
     * Convert To Safe Object
     * =========================================================================
     */

    serialize() {

        return this.toJSON();

    }

    /**
     * =========================================================================
     * Retry Decision
     * =========================================================================
     */

    shouldRetry() {

        return this.retryable === true;

    }

}

/**
 * ============================================================================
 * Statement Context Error
 * ============================================================================
 */

class StatementContextError extends StatementProcessingError {

    constructor(

        message,

        details = {},

        options = {}

    ) {

        super(

            message,

            details,

            {

                ...options,

                code:
                    STATEMENT_ERROR_CODES.INVALID_CONTEXT,

                phase:
                    STATEMENT_PROCESSING_PHASE.CONTEXT,

                retryable:
                    false

            }

        );

        this.name =
            'StatementContextError';

    }

}

/**
 * ============================================================================
 * Invalid Context Error
 * ============================================================================
 *
 * Explicit alias/class for consumers that prefer a precise semantic name.
 */

class StatementInvalidContextError
    extends StatementContextError {

    constructor(

        message,

        details = {},

        options = {}

    ) {

        super(
            message,
            details,
            options
        );

        this.name =
            'StatementInvalidContextError';

    }

}

/**
 * ============================================================================
 * Statement Import Error
 * ============================================================================
 */

class StatementImportError
    extends StatementProcessingError {

    constructor(

        message,

        details = {},

        options = {}

    ) {

        super(

            message,

            details,

            {

                ...options,

                code:
                    STATEMENT_ERROR_CODES.IMPORT_FAILED,

                phase:
                    STATEMENT_PROCESSING_PHASE.IMPORT,

                retryable:
                    options.retryable !== undefined
                        ? options.retryable
                        : true

            }

        );

        this.name =
            'StatementImportError';

    }

}

/**
 * ============================================================================
 * Statement Validation Error
 * ============================================================================
 */

class StatementValidationError
    extends StatementProcessingError {

    constructor(

        message,

        details = {},

        options = {}

    ) {

        super(

            message,

            details,

            {

                ...options,

                code:
                    STATEMENT_ERROR_CODES.VALIDATION_FAILED,

                phase:
                    STATEMENT_PROCESSING_PHASE.VALIDATION,

                retryable:
                    false

            }

        );

        this.name =
            'StatementValidationError';

    }

}

/**
 * ============================================================================
 * Statement Persistence Error
 * ============================================================================
 */

class StatementPersistenceError
    extends StatementProcessingError {

    constructor(

        message,

        details = {},

        options = {}

    ) {

        super(

            message,

            details,

            {

                ...options,

                code:
                    STATEMENT_ERROR_CODES.PERSISTENCE_FAILED,

                phase:
                    STATEMENT_PROCESSING_PHASE.PERSISTENCE,

                retryable:
                    options.retryable !== undefined
                        ? options.retryable
                        : true

            }

        );

        this.name =
            'StatementPersistenceError';

    }

}

/**
 * ============================================================================
 * Statement Reconciliation Error
 * ============================================================================
 */

class StatementReconciliationError
    extends StatementProcessingError {

    constructor(

        message,

        details = {},

        options = {}

    ) {

        super(

            message,

            details,

            {

                ...options,

                code:
                    STATEMENT_ERROR_CODES.RECONCILIATION_FAILED,

                phase:
                    STATEMENT_PROCESSING_PHASE.RECONCILIATION,

                retryable:
                    options.retryable !== undefined
                        ? options.retryable
                        : true

            }

        );

        this.name =
            'StatementReconciliationError';

    }

}

/**
 * ============================================================================
 * Duplicate Statement Error
 * ============================================================================
 */

class DuplicateStatementError
    extends StatementProcessingError {

    constructor(

        message,

        details = {},

        options = {}

    ) {

        super(

            message,

            details,

            {

                ...options,

                code:
                    STATEMENT_ERROR_CODES.DUPLICATE_STATEMENT,

                phase:
                    STATEMENT_PROCESSING_PHASE.VALIDATION,

                retryable:
                    false

            }

        );

        this.name =
            'DuplicateStatementError';

    }

}

/**
 * ============================================================================
 * Invalid Statement Format Error
 * ============================================================================
 */

class InvalidStatementFormatError
    extends StatementProcessingError {

    constructor(

        message,

        details = {},

        options = {}

    ) {

        super(

            message,

            details,

            {

                ...options,

                code:
                    STATEMENT_ERROR_CODES.INVALID_FORMAT,

                phase:
                    STATEMENT_PROCESSING_PHASE.VALIDATION,

                retryable:
                    false

            }

        );

        this.name =
            'InvalidStatementFormatError';

    }

}

/**
 * ============================================================================
 * Invalid Statement Transaction Error
 * ============================================================================
 */

class StatementInvalidTransactionError
    extends StatementProcessingError {

    constructor(

        message,

        details = {},

        options = {}

    ) {

        super(

            message,

            details,

            {

                ...options,

                code:
                    STATEMENT_ERROR_CODES.INVALID_TRANSACTION,

                phase:
                    STATEMENT_PROCESSING_PHASE.VALIDATION,

                retryable:
                    false

            }

        );

        this.name =
            'StatementInvalidTransactionError';

    }

}

/**
 * ============================================================================
 * Statement System Error
 * ============================================================================
 *
 * Reserved for infrastructure/system-level failures that are not naturally
 * represented by import, validation, persistence or reconciliation errors.
 */

class StatementSystemError
    extends StatementProcessingError {

    constructor(

        message,

        details = {},

        options = {}

    ) {

        super(

            message,

            details,

            {

                ...options,

                code:
                    STATEMENT_ERROR_CODES.SYSTEM_FAILURE,

                phase:
                    STATEMENT_PROCESSING_PHASE.SYSTEM,

                retryable:
                    options.retryable !== undefined
                        ? options.retryable
                        : true

            }

        );

        this.name =
            'StatementSystemError';

    }

}

/**
 * ============================================================================
 * Generic Statement Processing Failure
 * ============================================================================
 */

class StatementProcessingFailureError
    extends StatementProcessingError {

    constructor(

        message,

        details = {},

        options = {}

    ) {

        super(

            message,

            details,

            {

                ...options,

                code:
                    STATEMENT_ERROR_CODES.PROCESSING_FAILED

            }

        );

        this.name =
            'StatementProcessingFailureError';

    }

}

/**
 * ============================================================================
 * Error Factory
 * ============================================================================
 *
 * Centralized factory for distributed workers, orchestration services and
 * generic error translators.
 */

function createStatementError({

    code =
        STATEMENT_ERROR_CODES.PROCESSING_FAILED,

    message =
        'Statement processing failed',

    details = {},

    options = {}

} = {}) {

    switch (code) {

        case STATEMENT_ERROR_CODES.INVALID_CONTEXT:
            return new StatementInvalidContextError(
                message,
                details,
                options
            );

        case STATEMENT_ERROR_CODES.IMPORT_FAILED:
            return new StatementImportError(
                message,
                details,
                options
            );

        case STATEMENT_ERROR_CODES.VALIDATION_FAILED:
            return new StatementValidationError(
                message,
                details,
                options
            );

        case STATEMENT_ERROR_CODES.PERSISTENCE_FAILED:
            return new StatementPersistenceError(
                message,
                details,
                options
            );

        case STATEMENT_ERROR_CODES.RECONCILIATION_FAILED:
            return new StatementReconciliationError(
                message,
                details,
                options
            );

        case STATEMENT_ERROR_CODES.DUPLICATE_STATEMENT:
            return new DuplicateStatementError(
                message,
                details,
                options
            );

        case STATEMENT_ERROR_CODES.INVALID_FORMAT:
            return new InvalidStatementFormatError(
                message,
                details,
                options
            );

        case STATEMENT_ERROR_CODES.INVALID_TRANSACTION:
            return new StatementInvalidTransactionError(
                message,
                details,
                options
            );

        case STATEMENT_ERROR_CODES.SYSTEM_FAILURE:
            return new StatementSystemError(
                message,
                details,
                options
            );

        case STATEMENT_ERROR_CODES.PROCESSING_FAILED:
        default:
            return new StatementProcessingFailureError(
                message,
                details,
                options
            );

    }

}

/**
 * ============================================================================
 * Public Exports
 * ============================================================================
 */

module.exports = {

    STATEMENT_ERROR_CODES,

    STATEMENT_ERROR_SEVERITY,

    STATEMENT_PROCESSING_PHASE,

    StatementProcessingError,

    StatementProcessingFailureError,

    StatementContextError,

    StatementInvalidContextError,

    StatementImportError,

    StatementValidationError,

    StatementPersistenceError,

    StatementReconciliationError,

    DuplicateStatementError,

    InvalidStatementFormatError,

    StatementInvalidTransactionError,

    StatementSystemError,

    createStatementError

};