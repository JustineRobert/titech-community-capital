"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Community Savings Platform
 * =============================================================================
 *
 * File: loanAuditRepository.js
 * Module: Loan Management
 * Layer: Repository (Persistence)
 *
 * -----------------------------------------------------------------------------
 * PURPOSE
 * -----------------------------------------------------------------------------
 *
 * Enterprise repository responsible for persisting immutable loan audit records.
 *
 * This repository is the single persistence gateway for all loan audit events
 * generated throughout the loan lifecycle including:
 *
 * • Loan application
 * • Eligibility assessment
 * • Credit scoring
 * • Approval workflow
 * • Supervisor override
 * • Disbursement
 * • Repayment
 * • Restructuring
 * • Write-off
 * • Default
 * • Recovery
 * • Settlement
 * • Manual adjustments
 * • Regulatory actions
 *
 * -----------------------------------------------------------------------------
 * ARCHITECTURE
 * -----------------------------------------------------------------------------
 *
 * Controller
 *      │
 *      ▼
 * Loan Workflow Service
 *      │
 *      ▼
 * LoanAuditRepository
 *      │
 *      ▼
 * LoanAuditModel (MongoDB)
 *
 * The repository owns ALL database interactions.
 * Business rules MUST remain inside services.
 *
 * -----------------------------------------------------------------------------
 * ENTERPRISE FEATURES
 * -----------------------------------------------------------------------------
 *
 * ✔ Multi-tenant isolation
 * ✔ MongoDB transaction support
 * ✔ Session propagation
 * ✔ Immutable audit trail
 * ✔ Regulatory compliance
 * ✔ Repository validation
 * ✔ Optimistic concurrency support
 * ✔ Structured logging
 * ✔ Correlation ID propagation
 * ✔ Pagination
 * ✔ Aggregation
 * ✔ Analytics support
 * ✔ Bulk persistence
 * ✔ Idempotency helpers
 * ✔ Health diagnostics
 * ✔ Production observability
 *
 * -----------------------------------------------------------------------------
 * DESIGN PRINCIPLES
 * -----------------------------------------------------------------------------
 *
 * • No business logic
 * • No authorization logic
 * • No controller logic
 * • Repository owns persistence only
 * • Immutable audit records
 * • Every query tenant scoped
 * • Every write transaction aware
 *
 * -----------------------------------------------------------------------------
 * SECURITY
 * -----------------------------------------------------------------------------
 *
 * This repository MUST NEVER:
 *
 * • bypass tenant isolation
 * • expose cross-tenant data
 * • mutate historical audit entries
 * • silently swallow persistence errors
 *
 * -----------------------------------------------------------------------------
 * AUTHOR
 * -----------------------------------------------------------------------------
 *
 * TITech Community Capital Engineering
 *
 * -----------------------------------------------------------------------------
 * VERSION
 * -----------------------------------------------------------------------------
 *
 * 3.0.0
 * Enterprise Production Edition
 *
 * =============================================================================
 */

const mongoose = require("mongoose");

const {
    Types,
    ClientSession,
    isValidObjectId
} = mongoose;

const LoanAudit = require("../models/loanAudit.model");

/**
 * Shared repository error hierarchy.
 * These will be expanded in the next foundation section.
 */
const {
    Error: NativeError
} = global;

/**
 * Optional enterprise logger.
 *
 * If a centralized logger exists it will be used.
 * Otherwise the repository falls back to the console
 * without breaking application startup.
 */
let logger;

try {
    logger = require("../../../shared/utils/logger");
} catch (error) {
    logger = console;
}

/**
 * Optional request context helper.
 *
 * Used for correlation IDs, request IDs,
 * actor context and distributed tracing.
 *
 * Repository remains functional when unavailable.
 */
let requestContext = null;

try {
    requestContext = require("../../../shared/utils/requestContext");
} catch (error) {
    requestContext = null;
}

/**
 * Optional metrics collector.
 *
 * Allows Prometheus/OpenTelemetry integration
 * without introducing a hard dependency.
 */
let metrics = null;

try {
    metrics = require("../../../shared/observability/metrics");
} catch (error) {
    metrics = null;
}
/**
 * =============================================================================
 * Repository Constants & Enumerations
 * =============================================================================
 */

const REPOSITORY_NAME = "LoanAuditRepository";
const REPOSITORY_VERSION = "3.0.0";

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 500;

const DEFAULT_SORT_FIELD = "createdAt";
const DEFAULT_SORT_ORDER = -1;

const DEFAULT_READ_CONCERN = "majority";
const DEFAULT_WRITE_CONCERN = {
    w: "majority",
    j: true,
    wtimeout: 10000
};

const DEFAULT_MAX_TIME_MS = 30000;

const DEFAULT_PROJECTION = {
    __v: 0
};

const DEFAULT_LEAN_OPTIONS = {
    virtuals: true
};

/**
 * =============================================================================
 * Loan Audit Events
 * =============================================================================
 */

const AUDIT_EVENT = Object.freeze({

    APPLICATION_CREATED: "APPLICATION_CREATED",

    APPLICATION_UPDATED: "APPLICATION_UPDATED",

    APPLICATION_CANCELLED: "APPLICATION_CANCELLED",

    ELIGIBILITY_ASSESSED: "ELIGIBILITY_ASSESSED",

    CREDIT_SCORE_GENERATED: "CREDIT_SCORE_GENERATED",

    RISK_SCORE_GENERATED: "RISK_SCORE_GENERATED",

    LOAN_SUBMITTED: "LOAN_SUBMITTED",

    LOAN_APPROVED: "LOAN_APPROVED",

    LOAN_REJECTED: "LOAN_REJECTED",

    LOAN_DISBURSED: "LOAN_DISBURSED",

    LOAN_REPAYMENT: "LOAN_REPAYMENT",

    LOAN_RESCHEDULED: "LOAN_RESCHEDULED",

    LOAN_RESTRUCTURED: "LOAN_RESTRUCTURED",

    LOAN_DEFAULTED: "LOAN_DEFAULTED",

    LOAN_RECOVERED: "LOAN_RECOVERED",

    LOAN_WRITTEN_OFF: "LOAN_WRITTEN_OFF",

    LOAN_SETTLED: "LOAN_SETTLED",

    MANUAL_OVERRIDE: "MANUAL_OVERRIDE",

    MANUAL_ADJUSTMENT: "MANUAL_ADJUSTMENT",

    STATUS_CHANGED: "STATUS_CHANGED",

    NOTE_ADDED: "NOTE_ADDED",

    DOCUMENT_ATTACHED: "DOCUMENT_ATTACHED",

    COLLATERAL_UPDATED: "COLLATERAL_UPDATED",

    FRAUD_ALERT: "FRAUD_ALERT",

    AML_FLAG: "AML_FLAG",

    COMPLIANCE_ACTION: "COMPLIANCE_ACTION",

    SYSTEM_EVENT: "SYSTEM_EVENT"

});

/**
 * =============================================================================
 * Repository Operations
 * =============================================================================
 */

const REPOSITORY_OPERATION = Object.freeze({

    SAVE: "SAVE",

    SAVE_MANY: "SAVE_MANY",

    FIND_BY_ID: "FIND_BY_ID",

    FIND_BY_LOAN: "FIND_BY_LOAN",

    FIND_BY_MEMBER: "FIND_BY_MEMBER",

    FIND_BY_TRANSACTION: "FIND_BY_TRANSACTION",

    PAGINATE: "PAGINATE",

    UPDATE: "UPDATE",

    DELETE: "DELETE",

    BULK_INSERT: "BULK_INSERT",

    AGGREGATE: "AGGREGATE",

    HEALTH_CHECK: "HEALTH_CHECK"

});

/**
 * =============================================================================
 * Actor Types
 * =============================================================================
 */

const ACTOR_TYPE = Object.freeze({

    MEMBER: "MEMBER",

    STAFF: "STAFF",

    ADMIN: "ADMIN",

    SUPERVISOR: "SUPERVISOR",

    SYSTEM: "SYSTEM",

    API: "API",

    SCHEDULER: "SCHEDULER"

});

/**
 * =============================================================================
 * Pagination Defaults
 * =============================================================================
 */

const PAGINATION_DEFAULTS = Object.freeze({

    page: DEFAULT_PAGE,

    limit: DEFAULT_LIMIT,

    maxLimit: MAX_LIMIT,

    sortBy: DEFAULT_SORT_FIELD,

    sortOrder: DEFAULT_SORT_ORDER

});

/**
 * =============================================================================
 * Default Query Options
 * =============================================================================
 */

const DEFAULT_QUERY_OPTIONS = Object.freeze({

    lean: true,

    projection: DEFAULT_PROJECTION,

    maxTimeMS: DEFAULT_MAX_TIME_MS

});

/**
 * =============================================================================
 * Repository Configuration
 * =============================================================================
 */

const REPOSITORY_CONFIG = Object.freeze({

    repository: REPOSITORY_NAME,

    version: REPOSITORY_VERSION,

    pagination: PAGINATION_DEFAULTS,

    readConcern: DEFAULT_READ_CONCERN,

    writeConcern: DEFAULT_WRITE_CONCERN,

    query: DEFAULT_QUERY_OPTIONS,

    lean: DEFAULT_LEAN_OPTIONS

});
/**
 * =============================================================================
 * Repository Configuration Defaults
 * =============================================================================
 *
 * All operational defaults for the repository are defined here to ensure
 * consistency, simplify testing, and support environment-specific overrides.
 *
 * NOTE:
 * These values are immutable and should never be modified at runtime.
 * Environment-specific values should be supplied through process.env before
 * constructing the repository.
 * =============================================================================
 */

/**
 * Repository timing configuration.
 */
const TIMEOUT_CONFIG = Object.freeze({

    /**
     * Maximum MongoDB query execution time.
     */
    queryTimeoutMs:
        Number(process.env.LOAN_AUDIT_QUERY_TIMEOUT_MS) || 30000,

    /**
     * Maximum transaction execution time.
     */
    transactionTimeoutMs:
        Number(process.env.LOAN_AUDIT_TRANSACTION_TIMEOUT_MS) || 60000,

    /**
     * Health check timeout.
     */
    healthCheckTimeoutMs:
        Number(process.env.LOAN_AUDIT_HEALTHCHECK_TIMEOUT_MS) || 5000,

    /**
     * Repository operation timeout.
     */
    operationTimeoutMs:
        Number(process.env.LOAN_AUDIT_OPERATION_TIMEOUT_MS) || 30000

});

/**
 * Pagination defaults.
 */
const PAGINATION_CONFIG = Object.freeze({

    defaultPage:
        Number(process.env.LOAN_AUDIT_DEFAULT_PAGE) || 1,

    defaultLimit:
        Number(process.env.LOAN_AUDIT_DEFAULT_LIMIT) || 25,

    maxLimit:
        Number(process.env.LOAN_AUDIT_MAX_LIMIT) || 500,

    defaultSortField:
        process.env.LOAN_AUDIT_SORT_FIELD || "createdAt",

    defaultSortOrder:
        Number(process.env.LOAN_AUDIT_SORT_ORDER) || -1

});

/**
 * MongoDB read preferences.
 */
const READ_CONFIG = Object.freeze({

    readConcern:
        process.env.LOAN_AUDIT_READ_CONCERN || "majority",

    readPreference:
        process.env.LOAN_AUDIT_READ_PREFERENCE || "primary",

    lean: true,

    maxTimeMS:
        TIMEOUT_CONFIG.queryTimeoutMs

});

/**
 * MongoDB write configuration.
 */
const WRITE_CONFIG = Object.freeze({

    writeConcern: {

        w:
            process.env.LOAN_AUDIT_WRITE_CONCERN || "majority",

        j:
            process.env.LOAN_AUDIT_JOURNAL !== "false",

        wtimeout:
            Number(process.env.LOAN_AUDIT_WRITE_TIMEOUT_MS) || 10000

    }

});

/**
 * MongoDB transaction defaults.
 */
const TRANSACTION_CONFIG = Object.freeze({

    readConcern: {
        level:
            READ_CONFIG.readConcern
    },

    writeConcern:
        WRITE_CONFIG.writeConcern,

    readPreference:
        READ_CONFIG.readPreference,

    maxCommitTimeMS:
        TIMEOUT_CONFIG.transactionTimeoutMs

});

/**
 * Retry policy for transient MongoDB failures.
 */
const RETRY_POLICY = Object.freeze({

    enabled:
        process.env.LOAN_AUDIT_RETRY_ENABLED !== "false",

    maxRetries:
        Number(process.env.LOAN_AUDIT_MAX_RETRIES) || 3,

    initialDelayMs:
        Number(process.env.LOAN_AUDIT_RETRY_DELAY_MS) || 250,

    maxDelayMs:
        Number(process.env.LOAN_AUDIT_RETRY_MAX_DELAY_MS) || 5000,

    exponentialBackoff: true,

    retryableErrorLabels: Object.freeze([
        "TransientTransactionError",
        "UnknownTransactionCommitResult",
        "RetryableWriteError"
    ])

});

/**
 * Validation defaults.
 */
const VALIDATION_CONFIG = Object.freeze({

    requireTenantId: true,

    requireLoanId: true,

    requireMemberId: false,

    requireActorId: false,

    strictObjectIdValidation: true,

    trimStrings: true

});

/**
 * Repository observability defaults.
 */
const OBSERVABILITY_CONFIG = Object.freeze({

    enableMetrics:
        process.env.LOAN_AUDIT_ENABLE_METRICS !== "false",

    enableStructuredLogging:
        process.env.LOAN_AUDIT_ENABLE_LOGGING !== "false",

    slowQueryThresholdMs:
        Number(process.env.LOAN_AUDIT_SLOW_QUERY_MS) || 1000,

    includeCorrelationId: true,

    includeRequestId: true

});

/**
 * Composite immutable repository configuration.
 */
const REPOSITORY_DEFAULTS = Object.freeze({

    timeout: TIMEOUT_CONFIG,

    pagination: PAGINATION_CONFIG,

    read: READ_CONFIG,

    write: WRITE_CONFIG,

    transaction: TRANSACTION_CONFIG,

    retry: RETRY_POLICY,

    validation: VALIDATION_CONFIG,

    observability: OBSERVABILITY_CONFIG

});
/**
 * =============================================================================
 * Foundation 1.1.3.2.1
 * Internal Symbol Declarations
 * =============================================================================
 *
 * Enterprise repositories should avoid exposing implementation details through
 * enumerable properties. Symbols provide collision-resistant private keys for
 * repository internals while remaining compatible with modern Node.js.
 *
 * These symbols are intentionally centralized so the remainder of the
 * repository references a single source of truth.
 * =============================================================================
 */

/* -------------------------------------------------------------------------- */
/* Repository Metadata                                                        */
/* -------------------------------------------------------------------------- */

const $repositoryName = Symbol("LoanAuditRepository.repositoryName");
const $repositoryVersion = Symbol("LoanAuditRepository.repositoryVersion");
const $repositoryConfig = Symbol("LoanAuditRepository.repositoryConfig");

/* -------------------------------------------------------------------------- */
/* Dependencies                                                               */
/* -------------------------------------------------------------------------- */

const $logger = Symbol("LoanAuditRepository.logger");
const $metrics = Symbol("LoanAuditRepository.metrics");
const $requestContext = Symbol("LoanAuditRepository.requestContext");
const $loanAuditModel = Symbol("LoanAuditRepository.loanAuditModel");

/* -------------------------------------------------------------------------- */
/* Session & Transaction State                                                */
/* -------------------------------------------------------------------------- */

const $session = Symbol("LoanAuditRepository.session");
const $transaction = Symbol("LoanAuditRepository.transaction");
const $transactionOptions = Symbol("LoanAuditRepository.transactionOptions");
const $activeSession = Symbol("LoanAuditRepository.activeSession");

/* -------------------------------------------------------------------------- */
/* Repository Context                                                         */
/* -------------------------------------------------------------------------- */

const $tenantId = Symbol("LoanAuditRepository.tenantId");
const $actor = Symbol("LoanAuditRepository.actor");
const $requestId = Symbol("LoanAuditRepository.requestId");
const $correlationId = Symbol("LoanAuditRepository.correlationId");

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

const $validateTenant = Symbol("LoanAuditRepository.validateTenant");
const $validateLoan = Symbol("LoanAuditRepository.validateLoan");
const $validateMember = Symbol("LoanAuditRepository.validateMember");
const $validateAuditRecord = Symbol("LoanAuditRepository.validateAuditRecord");
const $validatePagination = Symbol("LoanAuditRepository.validatePagination");

/* -------------------------------------------------------------------------- */
/* Internal Repository Operations                                             */
/* -------------------------------------------------------------------------- */

const $execute = Symbol("LoanAuditRepository.execute");
const $executeWithRetry = Symbol("LoanAuditRepository.executeWithRetry");
const $executeTransaction = Symbol("LoanAuditRepository.executeTransaction");
const $buildQuery = Symbol("LoanAuditRepository.buildQuery");
const $buildProjection = Symbol("LoanAuditRepository.buildProjection");
const $buildSort = Symbol("LoanAuditRepository.buildSort");

/* -------------------------------------------------------------------------- */
/* Pagination                                                                 */
/* -------------------------------------------------------------------------- */

const $normalizePagination = Symbol(
    "LoanAuditRepository.normalizePagination"
);

const $buildPaginationResult = Symbol(
    "LoanAuditRepository.buildPaginationResult"
);

/* -------------------------------------------------------------------------- */
/* Observability                                                              */
/* -------------------------------------------------------------------------- */

const $startTimer = Symbol("LoanAuditRepository.startTimer");
const $stopTimer = Symbol("LoanAuditRepository.stopTimer");
const $recordMetric = Symbol("LoanAuditRepository.recordMetric");
const $logOperation = Symbol("LoanAuditRepository.logOperation");

/* -------------------------------------------------------------------------- */
/* Mongo Helpers                                                              */
/* -------------------------------------------------------------------------- */

const $createSession = Symbol("LoanAuditRepository.createSession");
const $endSession = Symbol("LoanAuditRepository.endSession");
const $commitTransaction = Symbol(
    "LoanAuditRepository.commitTransaction"
);
const $abortTransaction = Symbol(
    "LoanAuditRepository.abortTransaction"
);

/* -------------------------------------------------------------------------- */
/* Compliance & Audit                                                         */
/* -------------------------------------------------------------------------- */

const $buildAuditMetadata = Symbol(
    "LoanAuditRepository.buildAuditMetadata"
);

const $buildComplianceMetadata = Symbol(
    "LoanAuditRepository.buildComplianceMetadata"
);

const $buildActorMetadata = Symbol(
    "LoanAuditRepository.buildActorMetadata"
);

/* -------------------------------------------------------------------------- */
/* Health & Diagnostics                                                       */
/* -------------------------------------------------------------------------- */

const $healthCheck = Symbol("LoanAuditRepository.healthCheck");
const $diagnostics = Symbol("LoanAuditRepository.diagnostics");

/* -------------------------------------------------------------------------- */
/* Repository Registry                                                        */
/* -------------------------------------------------------------------------- */

const INTERNAL_SYMBOLS = Object.freeze({

    repositoryName: $repositoryName,
    repositoryVersion: $repositoryVersion,
    repositoryConfig: $repositoryConfig,

    logger: $logger,
    metrics: $metrics,
    requestContext: $requestContext,
    loanAuditModel: $loanAuditModel,

    session: $session,
    transaction: $transaction,
    transactionOptions: $transactionOptions,
    activeSession: $activeSession,

    tenantId: $tenantId,
    actor: $actor,
    requestId: $requestId,
    correlationId: $correlationId,

    validateTenant: $validateTenant,
    validateLoan: $validateLoan,
    validateMember: $validateMember,
    validateAuditRecord: $validateAuditRecord,
    validatePagination: $validatePagination,

    execute: $execute,
    executeWithRetry: $executeWithRetry,
    executeTransaction: $executeTransaction,

    buildQuery: $buildQuery,
    buildProjection: $buildProjection,
    buildSort: $buildSort,

    normalizePagination: $normalizePagination,
    buildPaginationResult: $buildPaginationResult,

    startTimer: $startTimer,
    stopTimer: $stopTimer,
    recordMetric: $recordMetric,
    logOperation: $logOperation,

    createSession: $createSession,
    endSession: $endSession,
    commitTransaction: $commitTransaction,
    abortTransaction: $abortTransaction,

    buildAuditMetadata: $buildAuditMetadata,
    buildComplianceMetadata: $buildComplianceMetadata,
    buildActorMetadata: $buildActorMetadata,

    healthCheck: $healthCheck,
    diagnostics: $diagnostics

});

/**
 * =============================================================================
 * Foundation B1
 * Enterprise Repository Error Hierarchy
 * =============================================================================
 *
 * Purpose
 * -------
 * Provides strongly typed repository errors to:
 *
 * • simplify service-layer error handling
 * • improve structured logging
 * • support REST error mapping
 * • support retry logic
 * • improve observability
 * • preserve original MongoDB errors
 *
 * All repository exceptions ultimately inherit from
 * LoanAuditRepositoryError.
 * =============================================================================
 */

class LoanAuditRepositoryError extends Error {

    /**
     * @param {string} message
     * @param {Object} [options]
     */
    constructor(message, options = {}) {

        super(message);

        Error.captureStackTrace?.(
            this,
            this.constructor
        );

        this.name = this.constructor.name;

        this.code =
            options.code ??
            "LOAN_AUDIT_REPOSITORY_ERROR";

        this.statusCode =
            options.statusCode ??
            500;

        this.retryable =
            options.retryable ??
            false;

        this.details =
            options.details ??
            {};

        this.cause =
            options.cause;

        this.timestamp =
            new Date();

        this.repository =
            REPOSITORY_NAME;

        this.version =
            REPOSITORY_VERSION;

    }

}

/**
 * -------------------------------------------------------------------------
 * Validation
 * -------------------------------------------------------------------------
 */

class LoanAuditValidationError
    extends LoanAuditRepositoryError {

    constructor(message, details = {}) {

        super(message, {

            code: "LOAN_AUDIT_VALIDATION_ERROR",

            statusCode: 400,

            details

        });

    }

}

/**
 * -------------------------------------------------------------------------
 * Persistence
 * -------------------------------------------------------------------------
 */

class LoanAuditPersistenceError
    extends LoanAuditRepositoryError {

    constructor(message, cause) {

        super(message, {

            code: "LOAN_AUDIT_PERSISTENCE_ERROR",

            statusCode: 500,

            cause

        });

    }

}

/**
 * -------------------------------------------------------------------------
 * Not Found
 * -------------------------------------------------------------------------
 */

class LoanAuditNotFoundError
    extends LoanAuditRepositoryError {

    constructor(message, details = {}) {

        super(message, {

            code: "LOAN_AUDIT_NOT_FOUND",

            statusCode: 404,

            details

        });

    }

}

/**
 * -------------------------------------------------------------------------
 * Tenant Isolation
 * -------------------------------------------------------------------------
 */

class LoanAuditTenantIsolationError
    extends LoanAuditRepositoryError {

    constructor(message, details = {}) {

        super(message, {

            code:
                "LOAN_AUDIT_TENANT_ISOLATION_ERROR",

            statusCode: 403,

            details

        });

    }

}

/**
 * -------------------------------------------------------------------------
 * Transactions
 * -------------------------------------------------------------------------
 */

class LoanAuditTransactionError
    extends LoanAuditRepositoryError {

    constructor(message, cause) {

        super(message, {

            code:
                "LOAN_AUDIT_TRANSACTION_ERROR",

            statusCode: 500,

            retryable: true,

            cause

        });

    }

}

/**
 * -------------------------------------------------------------------------
 * Optimistic Concurrency
 * -------------------------------------------------------------------------
 */

class LoanAuditConcurrencyError
    extends LoanAuditRepositoryError {

    constructor(message, details = {}) {

        super(message, {

            code:
                "LOAN_AUDIT_CONCURRENCY_ERROR",

            statusCode: 409,

            retryable: true,

            details

        });

    }

}

/**
 * -------------------------------------------------------------------------
 * Repository Configuration
 * -------------------------------------------------------------------------
 */

class LoanAuditConfigurationError
    extends LoanAuditRepositoryError {

    constructor(message, details = {}) {

        super(message, {

            code:
                "LOAN_AUDIT_CONFIGURATION_ERROR",

            statusCode: 500,

            details

        });

    }

}

/**
 * -------------------------------------------------------------------------
 * Health Check
 * -------------------------------------------------------------------------
 */

class LoanAuditHealthCheckError
    extends LoanAuditRepositoryError {

    constructor(message, cause) {

        super(message, {

            code:
                "LOAN_AUDIT_HEALTH_CHECK_ERROR",

            statusCode: 503,

            retryable: true,

            cause

        });

    }

}

/**
 * -------------------------------------------------------------------------
 * Bulk Operations
 * -------------------------------------------------------------------------
 */

class LoanAuditBulkOperationError
    extends LoanAuditRepositoryError {

    constructor(message, details = {}) {

        super(message, {

            code:
                "LOAN_AUDIT_BULK_OPERATION_ERROR",

            statusCode: 500,

            retryable: true,

            details

        });

    }

}

/**
 * =============================================================================
 * Repository Error Registry
 * =============================================================================
 */

const REPOSITORY_ERRORS = Object.freeze({

    RepositoryError:
        LoanAuditRepositoryError,

    ValidationError:
        LoanAuditValidationError,

    PersistenceError:
        LoanAuditPersistenceError,

    NotFoundError:
        LoanAuditNotFoundError,

    TenantIsolationError:
        LoanAuditTenantIsolationError,

    TransactionError:
        LoanAuditTransactionError,

    ConcurrencyError:
        LoanAuditConcurrencyError,

    ConfigurationError:
        LoanAuditConfigurationError,

    HealthCheckError:
        LoanAuditHealthCheckError,

    BulkOperationError:
        LoanAuditBulkOperationError

});

/**
 * =============================================================================
 * Error Classification Helpers
 * =============================================================================
 */

const TRANSIENT_MONGO_ERROR_LABELS = Object.freeze([

    "TransientTransactionError",

    "RetryableWriteError",

    "UnknownTransactionCommitResult"

]);

const DUPLICATE_KEY_ERROR_CODE = 11000;

const NETWORK_ERROR_NAMES = Object.freeze([

    "MongoNetworkError",

    "MongoNetworkTimeoutError",

    "MongoServerSelectionError"

]);

const CONCURRENCY_ERROR_NAMES = Object.freeze([

    "VersionError",

    "DocumentNotFoundError"

]);
/**
 * =============================================================================
 * Foundation B2.1.1
 * Core Assertion Helpers
 * =============================================================================
 *
 * PURPOSE
 * -------
 * Centralized validation primitives used throughout the repository.
 *
 * These helpers:
 *
 * • eliminate duplicated validation logic
 * • produce consistent repository exceptions
 * • improve readability
 * • simplify unit testing
 * • enforce fail-fast behavior
 *
 * IMPORTANT
 * ---------
 * Repository methods should NEVER throw raw Error objects.
 * Always throw repository-specific exceptions.
 * =============================================================================
 */

/**
 * Ensures a condition evaluates to true.
 *
 * @param {boolean} condition
 * @param {string} message
 * @param {Object} [details]
 */
function assert(condition, message, details = {}) {

    if (condition) {
        return;
    }

    throw new LoanAuditValidationError(
        message,
        details
    );

}

/**
 * Ensures a value is neither undefined nor null.
 *
 * @param {*} value
 * @param {string} field
 */
function assertDefined(value, field) {

    assert(

        value !== undefined &&
        value !== null,

        `${field} is required.`,

        {
            field
        }

    );

}

/**
 * Ensures a string contains non-whitespace characters.
 *
 * @param {*} value
 * @param {string} field
 */
function assertNonEmptyString(value, field) {

    assertDefined(value, field);

    assert(

        typeof value === "string",

        `${field} must be a string.`,

        {
            field,
            actualType: typeof value
        }

    );

    assert(

        value.trim().length > 0,

        `${field} cannot be empty.`,

        {
            field
        }

    );

}

/**
 * Ensures a value is boolean.
 *
 * @param {*} value
 * @param {string} field
 */
function assertBoolean(value, field) {

    assertDefined(value, field);

    assert(

        typeof value === "boolean",

        `${field} must be a boolean.`,

        {
            field,
            actualType: typeof value
        }

    );

}

/**
 * Ensures a value is numeric.
 *
 * @param {*} value
 * @param {string} field
 */
function assertNumber(value, field) {

    assertDefined(value, field);

    assert(

        typeof value === "number",

        `${field} must be a number.`

    );

    assert(

        Number.isFinite(value),

        `${field} must be a finite number.`

    );

}

/**
 * Ensures a value is a positive integer.
 *
 * @param {*} value
 * @param {string} field
 */
function assertPositiveInteger(value, field) {

    assertNumber(value, field);

    assert(

        Number.isInteger(value),

        `${field} must be an integer.`

    );

    assert(

        value > 0,

        `${field} must be greater than zero.`

    );

}

/**
 * Ensures a value is an object.
 *
 * @param {*} value
 * @param {string} field
 */
function assertObject(value, field) {

    assertDefined(value, field);

    assert(

        typeof value === "object",

        `${field} must be an object.`

    );

    assert(

        !Array.isArray(value),

        `${field} cannot be an array.`

    );

}

/**
 * Ensures a value is an array.
 *
 * @param {*} value
 * @param {string} field
 */
function assertArray(value, field) {

    assertDefined(value, field);

    assert(

        Array.isArray(value),

        `${field} must be an array.`

    );

}

/**
 * Ensures an array is not empty.
 *
 * @param {*} value
 * @param {string} field
 */
function assertNonEmptyArray(value, field) {

    assertArray(value, field);

    assert(

        value.length > 0,

        `${field} cannot be empty.`

    );

}

/**
 * Ensures an enum value is valid.
 *
 * @param {*} value
 * @param {Object} enumeration
 * @param {string} field
 */
function assertEnum(value, enumeration, field) {

    assertDefined(value, field);

    const values =
        Object.values(enumeration);

    assert(

        values.includes(value),

        `${field} contains an invalid value.`,

        {
            field,
            value,
            allowedValues: values
        }

    );

}

/**
 * Ensures a function parameter exists.
 *
 * Useful for dependency injection.
 *
 * @param {*} value
 * @param {string} dependency
 */
function assertDependency(value, dependency) {

    assertDefined(

        value,

        dependency

    );

}

/**
 * =============================================================================
 * Validation Helper Registry
 * =============================================================================
 */

const VALIDATORS = Object.freeze({

    assert,

    assertDefined,

    assertNonEmptyString,

    assertBoolean,

    assertNumber,

    assertPositiveInteger,

    assertObject,

    assertArray,

    assertNonEmptyArray,

    assertEnum,

    assertDependency

});