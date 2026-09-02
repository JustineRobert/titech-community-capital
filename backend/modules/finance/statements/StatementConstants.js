/**
 * ============================================================================
 * TITech Community Capital LTD
 * StatementConstants.js
 * ============================================================================
 *
 * Enterprise Statement Processing Domain Constants
 *
 * Purpose:
 *
 * - Centralize immutable statement lifecycle states.
 * - Centralize statement batch lifecycle states.
 * - Standardize statement origins/providers.
 * - Define processing actions and operational classifications.
 * - Define processing events for event-driven workflows.
 * - Support validation, reconciliation, repair, reporting, and auditing.
 * - Provide stable vocabulary across the Statement Intelligence subsystem.
 *
 * Used By:
 *
 * Statement Processing Pipeline:
 *
 * IMPORT
 *    ↓
 * VALIDATION
 *    ↓
 * PERSISTENCE
 *    ↓
 * RECONCILIATION
 *    ↓
 * REPAIR
 *    ↓
 * REPORTING
 *    ↓
 * CLOSE
 *
 * Design Principles:
 *
 * - Immutable constants.
 * - No business logic.
 * - Database/API safe values.
 * - Workflow engine compatible.
 * - Event-driven ready.
 * - Audit friendly.
 * - Multi-tenant safe.
 * - Backward compatible.
 *
 * ============================================================================
 */

'use strict';

/**
 * ============================================================================
 * Statement Lifecycle Status
 * ============================================================================
 *
 * Represents the state machine of an individual statement.
 *
 * IMPORTANT:
 * Do not use these values for batch lifecycle management.
 * Use STATEMENT_BATCH_STATUS for batches.
 */
const STATEMENT_STATUS = Object.freeze({

    /**
     * Initial state after successful ingestion.
     */
    IMPORTED:
        'IMPORTED',

    /**
     * Validation process started.
     */
    VALIDATING:
        'VALIDATING',

    /**
     * Validation completed successfully.
     */
    VALIDATED:
        'VALIDATED',

    /**
     * Validation or processing failure.
     */
    FAILED:
        'FAILED',

    /**
     * Statement successfully persisted.
     */
    PERSISTED:
        'PERSISTED',

    /**
     * Reconciliation process started.
     */
    RECONCILING:
        'RECONCILING',

    /**
     * Reconciliation completed successfully.
     */
    RECONCILED:
        'RECONCILED',

    /**
     * Statement contains unresolved issues.
     */
    EXCEPTION:
        'EXCEPTION',

    /**
     * Statement processing completed.
     */
    COMPLETED:
        'COMPLETED',

    /**
     * Statement processing was cancelled.
     */
    CANCELLED:
        'CANCELLED'

});

/**
 * ============================================================================
 * Statement Batch Lifecycle Status
 * ============================================================================
 *
 * Represents the lifecycle of a statement processing batch.
 *
 * State model:
 *
 * CREATED
 *    ↓
 * PROCESSING
 *    ├───────────────┐
 *    ↓               ↓
 * COMPLETED        FAILED
 *
 * CREATED
 *    ↓
 * CANCELLED
 */
const STATEMENT_BATCH_STATUS = Object.freeze({

    /**
     * Batch created but processing has not started.
     */
    CREATED:
        'CREATED',

    /**
     * Batch processing is active.
     */
    PROCESSING:
        'PROCESSING',

    /**
     * All batch processing completed successfully.
     */
    COMPLETED:
        'COMPLETED',

    /**
     * Batch processing failed.
     */
    FAILED:
        'FAILED',

    /**
     * Batch processing was cancelled.
     */
    CANCELLED:
        'CANCELLED'

});

/**
 * ============================================================================
 * Statement Source Types
 * ============================================================================
 *
 * Identifies where a statement originated.
 */
const STATEMENT_SOURCE = Object.freeze({

    /**
     * Traditional banking source.
     */
    BANK:
        'BANK',

    /**
     * MTN Mobile Money settlement/import.
     */
    MTN_MOMO:
        'MTN_MOMO',

    /**
     * Airtel Money settlement/import.
     */
    AIRTEL_MONEY:
        'AIRTEL_MONEY',

    /**
     * User uploaded or manually entered statement.
     */
    MANUAL:
        'MANUAL',

    /**
     * Internal system-generated statement.
     */
    SYSTEM:
        'SYSTEM',

    /**
     * External API integration.
     */
    API:
        'API'

});

/**
 * ============================================================================
 * Statement Provider Types
 * ============================================================================
 *
 * Identifies the external institution/provider responsible for a statement.
 *
 * This is deliberately separate from STATEMENT_SOURCE because:
 *
 * source = HOW the statement entered the system
 * provider = WHO produced the underlying financial data
 */
const STATEMENT_PROVIDER = Object.freeze({

    BANK:
        'BANK',

    MTN:
        'MTN',

    MTN_MOMO:
        'MTN_MOMO',

    AIRTEL:
        'AIRTEL',

    AIRTEL_MONEY:
        'AIRTEL_MONEY',

    INTERNAL:
        'INTERNAL',

    UNKNOWN:
        'UNKNOWN'

});

/**
 * ============================================================================
 * Statement Processing Actions
 * ============================================================================
 *
 * Used by:
 *
 * - Audit logs
 * - Workflow engines
 * - Authorization policies
 * - Operational telemetry
 * - Activity history
 */
const STATEMENT_ACTION = Object.freeze({

    IMPORT:
        'IMPORT',

    VALIDATE:
        'VALIDATE',

    PERSIST:
        'PERSIST',

    RECONCILE:
        'RECONCILE',

    REPAIR:
        'REPAIR',

    REPORT:
        'REPORT',

    CLOSE:
        'CLOSE',

    CANCEL:
        'CANCEL',

    RETRY:
        'RETRY',

    REPROCESS:
        'REPROCESS'

});

/**
 * ============================================================================
 * Statement Processing Event Types
 * ============================================================================
 *
 * Event-bus compatible event vocabulary.
 *
 * Event names are intentionally stable and namespaced.
 */
const STATEMENT_EVENTS = Object.freeze({

    /**
     * Import lifecycle.
     */
    IMPORT_STARTED:
        'STATEMENT_IMPORT_STARTED',

    IMPORT_COMPLETED:
        'STATEMENT_IMPORT_COMPLETED',

    IMPORT_FAILED:
        'STATEMENT_IMPORT_FAILED',

    /**
     * Validation lifecycle.
     */
    VALIDATION_STARTED:
        'STATEMENT_VALIDATION_STARTED',

    VALIDATION_COMPLETED:
        'STATEMENT_VALIDATION_COMPLETED',

    VALIDATION_FAILED:
        'STATEMENT_VALIDATION_FAILED',

    /**
     * Persistence lifecycle.
     */
    PERSISTENCE_STARTED:
        'STATEMENT_PERSISTENCE_STARTED',

    PERSISTENCE_COMPLETED:
        'STATEMENT_PERSISTENCE_COMPLETED',

    PERSISTENCE_FAILED:
        'STATEMENT_PERSISTENCE_FAILED',

    /**
     * Reconciliation lifecycle.
     */
    RECONCILIATION_STARTED:
        'STATEMENT_RECONCILIATION_STARTED',

    RECONCILIATION_COMPLETED:
        'STATEMENT_RECONCILIATION_COMPLETED',

    RECONCILIATION_FAILED:
        'STATEMENT_RECONCILIATION_FAILED',

    /**
     * Repair lifecycle.
     */
    REPAIR_STARTED:
        'STATEMENT_REPAIR_STARTED',

    REPAIR_COMPLETED:
        'STATEMENT_REPAIR_COMPLETED',

    REPAIR_FAILED:
        'STATEMENT_REPAIR_FAILED',

    /**
     * Reporting lifecycle.
     */
    REPORT_GENERATION_STARTED:
        'STATEMENT_REPORT_GENERATION_STARTED',

    REPORT_GENERATION_COMPLETED:
        'STATEMENT_REPORT_GENERATION_COMPLETED',

    REPORT_GENERATION_FAILED:
        'STATEMENT_REPORT_GENERATION_FAILED',

    /**
     * Processing lifecycle.
     */
    PROCESSING_COMPLETED:
        'STATEMENT_PROCESSING_COMPLETED',

    PROCESSING_FAILED:
        'STATEMENT_PROCESSING_FAILED',

    PROCESSING_CANCELLED:
        'STATEMENT_PROCESSING_CANCELLED',

    /**
     * Retry/reprocessing lifecycle.
     */
    PROCESSING_RETRY:
        'STATEMENT_PROCESSING_RETRY',

    PROCESSING_REPROCESS:
        'STATEMENT_PROCESSING_REPROCESS',

    /**
     * Batch lifecycle.
     */
    BATCH_CREATED:
        'STATEMENT_BATCH_CREATED',

    BATCH_STARTED:
        'STATEMENT_BATCH_STARTED',

    BATCH_PROGRESS:
        'STATEMENT_BATCH_PROGRESS',

    BATCH_COMPLETED:
        'STATEMENT_BATCH_COMPLETED',

    BATCH_FAILED:
        'STATEMENT_BATCH_FAILED',

    BATCH_CANCELLED:
        'STATEMENT_BATCH_CANCELLED'

});

/**
 * ============================================================================
 * Statement Validation Result
 * ============================================================================
 */
const STATEMENT_VALIDATION_RESULT = Object.freeze({

    PASSED:
        'PASSED',

    FAILED:
        'FAILED',

    WARNING:
        'WARNING'

});

/**
 * ============================================================================
 * Statement Validation Severity
 * ============================================================================
 *
 * Used when validation detects a specific issue.
 */
const STATEMENT_VALIDATION_SEVERITY = Object.freeze({

    INFO:
        'INFO',

    WARNING:
        'WARNING',

    ERROR:
        'ERROR',

    CRITICAL:
        'CRITICAL'

});

/**
 * ============================================================================
 * Statement Processing Priority
 * ============================================================================
 */
const STATEMENT_PRIORITY = Object.freeze({

    LOW:
        'LOW',

    NORMAL:
        'NORMAL',

    HIGH:
        'HIGH',

    CRITICAL:
        'CRITICAL'

});

/**
 * ============================================================================
 * Statement Processing Outcome
 * ============================================================================
 *
 * Normalized terminal/operational outcomes for orchestration and reporting.
 */
const STATEMENT_OUTCOME = Object.freeze({

    SUCCESS:
        'SUCCESS',

    PARTIAL_SUCCESS:
        'PARTIAL_SUCCESS',

    FAILED:
        'FAILED',

    CANCELLED:
        'CANCELLED',

    REQUIRES_REPAIR:
        'REQUIRES_REPAIR',

    REQUIRES_RECONCILIATION:
        'REQUIRES_RECONCILIATION',

    REQUIRES_REVIEW:
        'REQUIRES_REVIEW'

});

/**
 * ============================================================================
 * Statement Error Categories
 * ============================================================================
 *
 * Stable classification vocabulary for StatementErrors,
 * StatementProcessor, StatementImporter, validators, and observability.
 */
const STATEMENT_ERROR_CATEGORY = Object.freeze({

    INVALID_CONTEXT:
        'INVALID_CONTEXT',

    INVALID_INPUT:
        'INVALID_INPUT',

    INVALID_FORMAT:
        'INVALID_FORMAT',

    INVALID_SCHEMA:
        'INVALID_SCHEMA',

    VALIDATION:
        'VALIDATION',

    PERSISTENCE:
        'PERSISTENCE',

    RECONCILIATION:
        'RECONCILIATION',

    REPAIR:
        'REPAIR',

    REPORTING:
        'REPORTING',

    BATCH:
        'BATCH',

    DUPLICATE:
        'DUPLICATE',

    TENANT_ISOLATION:
        'TENANT_ISOLATION',

    IDEMPOTENCY:
        'IDEMPOTENCY',

    AUTHORIZATION:
        'AUTHORIZATION',

    CONFIGURATION:
        'CONFIGURATION',

    DEPENDENCY:
        'DEPENDENCY',

    TIMEOUT:
        'TIMEOUT',

    SYSTEM:
        'SYSTEM',

    UNKNOWN:
        'UNKNOWN'

});

/**
 * ============================================================================
 * Statement Reconciliation Status
 * ============================================================================
 *
 * Provides stable vocabulary for reconciliation results.
 */
const STATEMENT_RECONCILIATION_STATUS = Object.freeze({

    NOT_STARTED:
        'NOT_STARTED',

    IN_PROGRESS:
        'IN_PROGRESS',

    RECONCILED:
        'RECONCILED',

    PARTIALLY_RECONCILED:
        'PARTIALLY_RECONCILED',

    UNMATCHED:
        'UNMATCHED',

    VARIANCE:
        'VARIANCE',

    FAILED:
        'FAILED',

    REQUIRES_REPAIR:
        'REQUIRES_REPAIR'

});

/**
 * ============================================================================
 * Statement Repair Status
 * ============================================================================
 *
 * Compatible with the Statement Intelligence repair subsystem.
 */
const STATEMENT_REPAIR_STATUS = Object.freeze({

    CREATED:
        'CREATED',

    VALIDATED:
        'VALIDATED',

    APPROVED:
        'APPROVED',

    EXECUTING:
        'EXECUTING',

    EXECUTED:
        'EXECUTED',

    FAILED:
        'FAILED',

    REJECTED:
        'REJECTED',

    REVERSED:
        'REVERSED'

});

/**
 * ============================================================================
 * Statement Processing Modes
 * ============================================================================
 *
 * Used to distinguish synchronous and distributed execution.
 */
const STATEMENT_PROCESSING_MODE = Object.freeze({

    SYNCHRONOUS:
        'SYNCHRONOUS',

    ASYNCHRONOUS:
        'ASYNCHRONOUS',

    BATCH:
        'BATCH',

    DISTRIBUTED:
        'DISTRIBUTED'

});

/**
 * ============================================================================
 * Export Constants
 * ============================================================================
 *
 * The exported object is frozen to prevent accidental runtime mutation.
 */
module.exports = Object.freeze({

    STATEMENT_STATUS,

    STATEMENT_BATCH_STATUS,

    STATEMENT_SOURCE,

    STATEMENT_PROVIDER,

    STATEMENT_ACTION,

    STATEMENT_EVENTS,

    STATEMENT_VALIDATION_RESULT,

    STATEMENT_VALIDATION_SEVERITY,

    STATEMENT_PRIORITY,

    STATEMENT_OUTCOME,

    STATEMENT_ERROR_CATEGORY,

    STATEMENT_RECONCILIATION_STATUS,

    STATEMENT_REPAIR_STATUS,

    STATEMENT_PROCESSING_MODE

});