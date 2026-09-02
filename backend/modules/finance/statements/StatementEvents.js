/**
 * ============================================================================
 * TITech Community Capital LTD
 * StatementEvents.js
 * ============================================================================
 *
 * Enterprise Statement Processing Event Contract
 *
 * File:
 * backend/modules/finance/statements/StatementEvents.js
 *
 * Purpose:
 *
 * - Centralize statement-processing event names.
 * - Provide a stable event contract across the statement pipeline.
 * - Support event-driven orchestration.
 * - Support audit logging and observability.
 * - Support distributed workers and queues.
 * - Preserve tenant and correlation boundaries.
 * - Support idempotent event consumers.
 * - Support retry and failure workflows.
 * - Provide deterministic event classification.
 * - Remain dependency-free.
 *
 * Pipeline:
 *
 * StatementContext
 *      |
 *      v
 * StatementBatchManager
 *      |
 *      v
 * StatementImporter
 *      |
 *      v
 * StatementValidator
 *      |
 *      v
 * StatementRepository
 *      |
 *      v
 * StatementReconciliation
 *      |
 *      v
 * StatementVarianceDetection
 *      |
 *      v
 * StatementRepair
 *      |
 *      v
 * StatementReporting
 *
 * Event Flow:
 *
 * IMPORT
 *   -> VALIDATION
 *   -> PERSISTENCE
 *   -> RECONCILIATION
 *   -> VARIANCE
 *   -> REPAIR
 *   -> REPORTING
 *   -> COMPLETION
 *
 * Design Principles:
 *
 * - Stable event names.
 * - Backward compatible values.
 * - Immutable constants.
 * - Versioned event contracts.
 * - Tenant-aware.
 * - Correlation-aware.
 * - Causation-aware.
 * - Audit friendly.
 * - Queue friendly.
 * - Idempotency friendly.
 * - No database access.
 * - No service dependencies.
 * - No business side effects.
 *
 * ============================================================================
 */

'use strict';

/**
 * ============================================================================
 * Event Contract Version
 * ============================================================================
 *
 * Consumers should treat this as the schema version of the event envelope,
 * not the version of the business event itself.
 */

const STATEMENT_EVENT_VERSION = '1.0.0';

/**
 * ============================================================================
 * Event Namespace
 * ============================================================================
 */

const STATEMENT_EVENT_NAMESPACE =
    'statement';

/**
 * ============================================================================
 * Statement Event Types
 * ============================================================================
 *
 * IMPORTANT:
 *
 * Existing event values are preserved for compatibility with the previously
 * defined StatementConstants.STATEMENT_EVENTS contract.
 */

const STATEMENT_EVENTS = Object.freeze({

    /**
     * ========================================================================
     * Import Lifecycle
     * ========================================================================
     */

    IMPORT_STARTED:
        'STATEMENT_IMPORT_STARTED',

    IMPORT_COMPLETED:
        'STATEMENT_IMPORT_COMPLETED',

    IMPORT_FAILED:
        'STATEMENT_IMPORT_FAILED',

    /**
     * ========================================================================
     * Validation Lifecycle
     * ========================================================================
     */

    VALIDATION_STARTED:
        'STATEMENT_VALIDATION_STARTED',

    VALIDATION_COMPLETED:
        'STATEMENT_VALIDATION_COMPLETED',

    VALIDATION_FAILED:
        'STATEMENT_VALIDATION_FAILED',

    /**
     * ========================================================================
     * Persistence Lifecycle
     * ========================================================================
     */

    PERSISTENCE_STARTED:
        'STATEMENT_PERSISTENCE_STARTED',

    PERSISTENCE_COMPLETED:
        'STATEMENT_PERSISTENCE_COMPLETED',

    PERSISTENCE_FAILED:
        'STATEMENT_PERSISTENCE_FAILED',

    /**
     * ========================================================================
     * Reconciliation Lifecycle
     * ========================================================================
     */

    RECONCILIATION_STARTED:
        'STATEMENT_RECONCILIATION_STARTED',

    RECONCILIATION_COMPLETED:
        'STATEMENT_RECONCILIATION_COMPLETED',

    RECONCILIATION_FAILED:
        'STATEMENT_RECONCILIATION_FAILED',

    /**
     * ========================================================================
     * Variance Lifecycle
     * ========================================================================
     */

    VARIANCE_DETECTION_STARTED:
        'STATEMENT_VARIANCE_DETECTION_STARTED',

    VARIANCE_DETECTED:
        'STATEMENT_VARIANCE_DETECTED',

    VARIANCE_RESOLVED:
        'STATEMENT_VARIANCE_RESOLVED',

    VARIANCE_DETECTION_FAILED:
        'STATEMENT_VARIANCE_DETECTION_FAILED',

    /**
     * ========================================================================
     * Repair Lifecycle
     * ========================================================================
     */

    REPAIR_STARTED:
        'STATEMENT_REPAIR_STARTED',

    REPAIR_RECOMMENDED:
        'STATEMENT_REPAIR_RECOMMENDED',

    REPAIR_APPROVED:
        'STATEMENT_REPAIR_APPROVED',

    REPAIR_REJECTED:
        'STATEMENT_REPAIR_REJECTED',

    REPAIR_EXECUTED:
        'STATEMENT_REPAIR_EXECUTED',

    REPAIR_FAILED:
        'STATEMENT_REPAIR_FAILED',

    REPAIR_REVERSED:
        'STATEMENT_REPAIR_REVERSED',

    REPAIR_COMPLETED:
        'STATEMENT_REPAIR_COMPLETED',

    /**
     * ========================================================================
     * Reporting Lifecycle
     * ========================================================================
     */

    REPORT_GENERATION_STARTED:
        'STATEMENT_REPORT_GENERATION_STARTED',

    REPORT_GENERATION_COMPLETED:
        'STATEMENT_REPORT_GENERATION_COMPLETED',

    REPORT_GENERATION_FAILED:
        'STATEMENT_REPORT_GENERATION_FAILED',

    /**
     * ========================================================================
     * Batch Lifecycle
     * ========================================================================
     */

    BATCH_CREATED:
        'STATEMENT_BATCH_CREATED',

    BATCH_STARTED:
        'STATEMENT_BATCH_STARTED',

    BATCH_PROGRESS_UPDATED:
        'STATEMENT_BATCH_PROGRESS_UPDATED',

    BATCH_COMPLETED:
        'STATEMENT_BATCH_COMPLETED',

    BATCH_FAILED:
        'STATEMENT_BATCH_FAILED',

    BATCH_CANCELLED:
        'STATEMENT_BATCH_CANCELLED',

    /**
     * ========================================================================
     * Complete Processing Lifecycle
     * ========================================================================
     */

    PROCESSING_STARTED:
        'STATEMENT_PROCESSING_STARTED',

    PROCESSING_COMPLETED:
        'STATEMENT_PROCESSING_COMPLETED',

    PROCESSING_FAILED:
        'STATEMENT_PROCESSING_FAILED',

    PROCESSING_CANCELLED:
        'STATEMENT_PROCESSING_CANCELLED',

    /**
     * ========================================================================
     * Exception Lifecycle
     * ========================================================================
     */

    EXCEPTION_DETECTED:
        'STATEMENT_EXCEPTION_DETECTED',

    EXCEPTION_RESOLVED:
        'STATEMENT_EXCEPTION_RESOLVED',

    /**
     * ========================================================================
     * SLA / Operational Intelligence
     * ========================================================================
     */

    SLA_WARNING:
        'STATEMENT_SLA_WARNING',

    SLA_BREACHED:
        'STATEMENT_SLA_BREACHED',

    SLA_ESCALATED:
        'STATEMENT_SLA_ESCALATED',

    /**
     * ========================================================================
     * Risk / Intelligence
     * ========================================================================
     */

    RISK_ASSESSED:
        'STATEMENT_RISK_ASSESSED',

    PRIORITY_ASSIGNED:
        'STATEMENT_PRIORITY_ASSIGNED',

    TREND_DETECTED:
        'STATEMENT_TREND_DETECTED'

});

/**
 * ============================================================================
 * Event Categories
 * ============================================================================
 */

const STATEMENT_EVENT_CATEGORY = Object.freeze({

    PROCESSING:
        'PROCESSING',

    IMPORT:
        'IMPORT',

    VALIDATION:
        'VALIDATION',

    PERSISTENCE:
        'PERSISTENCE',

    RECONCILIATION:
        'RECONCILIATION',

    VARIANCE:
        'VARIANCE',

    REPAIR:
        'REPAIR',

    REPORTING:
        'REPORTING',

    BATCH:
        'BATCH',

    EXCEPTION:
        'EXCEPTION',

    SLA:
        'SLA',

    INTELLIGENCE:
        'INTELLIGENCE'

});

/**
 * ============================================================================
 * Event Outcome
 * ============================================================================
 */

const STATEMENT_EVENT_OUTCOME = Object.freeze({

    STARTED:
        'STARTED',

    COMPLETED:
        'COMPLETED',

    FAILED:
        'FAILED',

    CANCELLED:
        'CANCELLED',

    DETECTED:
        'DETECTED',

    RESOLVED:
        'RESOLVED',

    APPROVED:
        'APPROVED',

    REJECTED:
        'REJECTED',

    EXECUTED:
        'EXECUTED',

    WARNING:
        'WARNING',

    ESCALATED:
        'ESCALATED',

    ASSESSED:
        'ASSESSED',

    ASSIGNED:
        'ASSIGNED',

    UPDATED:
        'UPDATED',

    RECOMMENDED:
        'RECOMMENDED'

});

/**
 * ============================================================================
 * Event Severity
 * ============================================================================
 */

const STATEMENT_EVENT_SEVERITY = Object.freeze({

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
 * Event Sources
 * ============================================================================
 *
 * Identifies the component which emitted the event.
 */

const STATEMENT_EVENT_SOURCE = Object.freeze({

    SYSTEM:
        'SYSTEM',

    API:
        'API',

    IMPORTER:
        'IMPORTER',

    VALIDATOR:
        'VALIDATOR',

    REPOSITORY:
        'REPOSITORY',

    RECONCILER:
        'RECONCILER',

    VARIANCE_ENGINE:
        'VARIANCE_ENGINE',

    REPAIR_ENGINE:
        'REPAIR_ENGINE',

    BATCH_MANAGER:
        'BATCH_MANAGER',

    REPORTING_ENGINE:
        'REPORTING_ENGINE',

    INTELLIGENCE_ENGINE:
        'INTELLIGENCE_ENGINE',

    JOB:
        'JOB',

    WORKER:
        'WORKER'

});

/**
 * ============================================================================
 * Event Classification Map
 * ============================================================================
 *
 * Provides deterministic metadata for every event.
 */

const EVENT_DEFINITIONS = Object.freeze({

    [STATEMENT_EVENTS.IMPORT_STARTED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.IMPORT,
        outcome: STATEMENT_EVENT_OUTCOME.STARTED,
        severity: STATEMENT_EVENT_SEVERITY.INFO,
        source: STATEMENT_EVENT_SOURCE.IMPORTER
    }),

    [STATEMENT_EVENTS.IMPORT_COMPLETED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.IMPORT,
        outcome: STATEMENT_EVENT_OUTCOME.COMPLETED,
        severity: STATEMENT_EVENT_SEVERITY.INFO,
        source: STATEMENT_EVENT_SOURCE.IMPORTER
    }),

    [STATEMENT_EVENTS.IMPORT_FAILED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.IMPORT,
        outcome: STATEMENT_EVENT_OUTCOME.FAILED,
        severity: STATEMENT_EVENT_SEVERITY.ERROR,
        source: STATEMENT_EVENT_SOURCE.IMPORTER
    }),

    [STATEMENT_EVENTS.VALIDATION_STARTED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.VALIDATION,
        outcome: STATEMENT_EVENT_OUTCOME.STARTED,
        severity: STATEMENT_EVENT_SEVERITY.INFO,
        source: STATEMENT_EVENT_SOURCE.VALIDATOR
    }),

    [STATEMENT_EVENTS.VALIDATION_COMPLETED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.VALIDATION,
        outcome: STATEMENT_EVENT_OUTCOME.COMPLETED,
        severity: STATEMENT_EVENT_SEVERITY.INFO,
        source: STATEMENT_EVENT_SOURCE.VALIDATOR
    }),

    [STATEMENT_EVENTS.VALIDATION_FAILED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.VALIDATION,
        outcome: STATEMENT_EVENT_OUTCOME.FAILED,
        severity: STATEMENT_EVENT_SEVERITY.ERROR,
        source: STATEMENT_EVENT_SOURCE.VALIDATOR
    }),

    [STATEMENT_EVENTS.PERSISTENCE_STARTED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.PERSISTENCE,
        outcome: STATEMENT_EVENT_OUTCOME.STARTED,
        severity: STATEMENT_EVENT_SEVERITY.INFO,
        source: STATEMENT_EVENT_SOURCE.REPOSITORY
    }),

    [STATEMENT_EVENTS.PERSISTENCE_COMPLETED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.PERSISTENCE,
        outcome: STATEMENT_EVENT_OUTCOME.COMPLETED,
        severity: STATEMENT_EVENT_SEVERITY.INFO,
        source: STATEMENT_EVENT_SOURCE.REPOSITORY
    }),

    [STATEMENT_EVENTS.PERSISTENCE_FAILED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.PERSISTENCE,
        outcome: STATEMENT_EVENT_OUTCOME.FAILED,
        severity: STATEMENT_EVENT_SEVERITY.ERROR,
        source: STATEMENT_EVENT_SOURCE.REPOSITORY
    }),

    [STATEMENT_EVENTS.RECONCILIATION_STARTED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.RECONCILIATION,
        outcome: STATEMENT_EVENT_OUTCOME.STARTED,
        severity: STATEMENT_EVENT_SEVERITY.INFO,
        source: STATEMENT_EVENT_SOURCE.RECONCILER
    }),

    [STATEMENT_EVENTS.RECONCILIATION_COMPLETED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.RECONCILIATION,
        outcome: STATEMENT_EVENT_OUTCOME.COMPLETED,
        severity: STATEMENT_EVENT_SEVERITY.INFO,
        source: STATEMENT_EVENT_SOURCE.RECONCILER
    }),

    [STATEMENT_EVENTS.RECONCILIATION_FAILED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.RECONCILIATION,
        outcome: STATEMENT_EVENT_OUTCOME.FAILED,
        severity: STATEMENT_EVENT_SEVERITY.ERROR,
        source: STATEMENT_EVENT_SOURCE.RECONCILER
    }),

    [STATEMENT_EVENTS.VARIANCE_DETECTION_STARTED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.VARIANCE,
        outcome: STATEMENT_EVENT_OUTCOME.STARTED,
        severity: STATEMENT_EVENT_SEVERITY.INFO,
        source: STATEMENT_EVENT_SOURCE.VARIANCE_ENGINE
    }),

    [STATEMENT_EVENTS.VARIANCE_DETECTED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.VARIANCE,
        outcome: STATEMENT_EVENT_OUTCOME.DETECTED,
        severity: STATEMENT_EVENT_SEVERITY.WARNING,
        source: STATEMENT_EVENT_SOURCE.VARIANCE_ENGINE
    }),

    [STATEMENT_EVENTS.VARIANCE_RESOLVED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.VARIANCE,
        outcome: STATEMENT_EVENT_OUTCOME.RESOLVED,
        severity: STATEMENT_EVENT_SEVERITY.INFO,
        source: STATEMENT_EVENT_SOURCE.VARIANCE_ENGINE
    }),

    [STATEMENT_EVENTS.VARIANCE_DETECTION_FAILED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.VARIANCE,
        outcome: STATEMENT_EVENT_OUTCOME.FAILED,
        severity: STATEMENT_EVENT_SEVERITY.ERROR,
        source: STATEMENT_EVENT_SOURCE.VARIANCE_ENGINE
    }),

    [STATEMENT_EVENTS.REPAIR_STARTED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.REPAIR,
        outcome: STATEMENT_EVENT_OUTCOME.STARTED,
        severity: STATEMENT_EVENT_SEVERITY.INFO,
        source: STATEMENT_EVENT_SOURCE.REPAIR_ENGINE
    }),

    [STATEMENT_EVENTS.REPAIR_RECOMMENDED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.REPAIR,
        outcome: STATEMENT_EVENT_OUTCOME.RECOMMENDED,
        severity: STATEMENT_EVENT_SEVERITY.INFO,
        source: STATEMENT_EVENT_SOURCE.REPAIR_ENGINE
    }),

    [STATEMENT_EVENTS.REPAIR_APPROVED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.REPAIR,
        outcome: STATEMENT_EVENT_OUTCOME.APPROVED,
        severity: STATEMENT_EVENT_SEVERITY.INFO,
        source: STATEMENT_EVENT_SOURCE.REPAIR_ENGINE
    }),

    [STATEMENT_EVENTS.REPAIR_REJECTED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.REPAIR,
        outcome: STATEMENT_EVENT_OUTCOME.REJECTED,
        severity: STATEMENT_EVENT_SEVERITY.WARNING,
        source: STATEMENT_EVENT_SOURCE.REPAIR_ENGINE
    }),

    [STATEMENT_EVENTS.REPAIR_EXECUTED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.REPAIR,
        outcome: STATEMENT_EVENT_OUTCOME.EXECUTED,
        severity: STATEMENT_EVENT_SEVERITY.INFO,
        source: STATEMENT_EVENT_SOURCE.REPAIR_ENGINE
    }),

    [STATEMENT_EVENTS.REPAIR_FAILED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.REPAIR,
        outcome: STATEMENT_EVENT_OUTCOME.FAILED,
        severity: STATEMENT_EVENT_SEVERITY.ERROR,
        source: STATEMENT_EVENT_SOURCE.REPAIR_ENGINE
    }),

    [STATEMENT_EVENTS.REPAIR_REVERSED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.REPAIR,
        outcome: STATEMENT_EVENT_OUTCOME.RESOLVED,
        severity: STATEMENT_EVENT_SEVERITY.WARNING,
        source: STATEMENT_EVENT_SOURCE.REPAIR_ENGINE
    }),

    [STATEMENT_EVENTS.REPAIR_COMPLETED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.REPAIR,
        outcome: STATEMENT_EVENT_OUTCOME.COMPLETED,
        severity: STATEMENT_EVENT_SEVERITY.INFO,
        source: STATEMENT_EVENT_SOURCE.REPAIR_ENGINE
    }),

    [STATEMENT_EVENTS.REPORT_GENERATION_STARTED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.REPORTING,
        outcome: STATEMENT_EVENT_OUTCOME.STARTED,
        severity: STATEMENT_EVENT_SEVERITY.INFO,
        source: STATEMENT_EVENT_SOURCE.REPORTING_ENGINE
    }),

    [STATEMENT_EVENTS.REPORT_GENERATION_COMPLETED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.REPORTING,
        outcome: STATEMENT_EVENT_OUTCOME.COMPLETED,
        severity: STATEMENT_EVENT_SEVERITY.INFO,
        source: STATEMENT_EVENT_SOURCE.REPORTING_ENGINE
    }),

    [STATEMENT_EVENTS.REPORT_GENERATION_FAILED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.REPORTING,
        outcome: STATEMENT_EVENT_OUTCOME.FAILED,
        severity: STATEMENT_EVENT_SEVERITY.ERROR,
        source: STATEMENT_EVENT_SOURCE.REPORTING_ENGINE
    }),

    [STATEMENT_EVENTS.BATCH_CREATED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.BATCH,
        outcome: STATEMENT_EVENT_OUTCOME.STARTED,
        severity: STATEMENT_EVENT_SEVERITY.INFO,
        source: STATEMENT_EVENT_SOURCE.BATCH_MANAGER
    }),

    [STATEMENT_EVENTS.BATCH_STARTED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.BATCH,
        outcome: STATEMENT_EVENT_OUTCOME.STARTED,
        severity: STATEMENT_EVENT_SEVERITY.INFO,
        source: STATEMENT_EVENT_SOURCE.BATCH_MANAGER
    }),

    [STATEMENT_EVENTS.BATCH_PROGRESS_UPDATED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.BATCH,
        outcome: STATEMENT_EVENT_OUTCOME.UPDATED,
        severity: STATEMENT_EVENT_SEVERITY.INFO,
        source: STATEMENT_EVENT_SOURCE.BATCH_MANAGER
    }),

    [STATEMENT_EVENTS.BATCH_COMPLETED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.BATCH,
        outcome: STATEMENT_EVENT_OUTCOME.COMPLETED,
        severity: STATEMENT_EVENT_SEVERITY.INFO,
        source: STATEMENT_EVENT_SOURCE.BATCH_MANAGER
    }),

    [STATEMENT_EVENTS.BATCH_FAILED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.BATCH,
        outcome: STATEMENT_EVENT_OUTCOME.FAILED,
        severity: STATEMENT_EVENT_SEVERITY.ERROR,
        source: STATEMENT_EVENT_SOURCE.BATCH_MANAGER
    }),

    [STATEMENT_EVENTS.BATCH_CANCELLED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.BATCH,
        outcome: STATEMENT_EVENT_OUTCOME.CANCELLED,
        severity: STATEMENT_EVENT_SEVERITY.WARNING,
        source: STATEMENT_EVENT_SOURCE.BATCH_MANAGER
    }),

    [STATEMENT_EVENTS.PROCESSING_STARTED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.PROCESSING,
        outcome: STATEMENT_EVENT_OUTCOME.STARTED,
        severity: STATEMENT_EVENT_SEVERITY.INFO,
        source: STATEMENT_EVENT_SOURCE.SYSTEM
    }),

    [STATEMENT_EVENTS.PROCESSING_COMPLETED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.PROCESSING,
        outcome: STATEMENT_EVENT_OUTCOME.COMPLETED,
        severity: STATEMENT_EVENT_SEVERITY.INFO,
        source: STATEMENT_EVENT_SOURCE.SYSTEM
    }),

    [STATEMENT_EVENTS.PROCESSING_FAILED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.PROCESSING,
        outcome: STATEMENT_EVENT_OUTCOME.FAILED,
        severity: STATEMENT_EVENT_SEVERITY.ERROR,
        source: STATEMENT_EVENT_SOURCE.SYSTEM
    }),

    [STATEMENT_EVENTS.PROCESSING_CANCELLED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.PROCESSING,
        outcome: STATEMENT_EVENT_OUTCOME.CANCELLED,
        severity: STATEMENT_EVENT_SEVERITY.WARNING,
        source: STATEMENT_EVENT_SOURCE.SYSTEM
    }),

    [STATEMENT_EVENTS.EXCEPTION_DETECTED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.EXCEPTION,
        outcome: STATEMENT_EVENT_OUTCOME.DETECTED,
        severity: STATEMENT_EVENT_SEVERITY.WARNING,
        source: STATEMENT_EVENT_SOURCE.SYSTEM
    }),

    [STATEMENT_EVENTS.EXCEPTION_RESOLVED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.EXCEPTION,
        outcome: STATEMENT_EVENT_OUTCOME.RESOLVED,
        severity: STATEMENT_EVENT_SEVERITY.INFO,
        source: STATEMENT_EVENT_SOURCE.SYSTEM
    }),

    [STATEMENT_EVENTS.SLA_WARNING]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.SLA,
        outcome: STATEMENT_EVENT_OUTCOME.WARNING,
        severity: STATEMENT_EVENT_SEVERITY.WARNING,
        source: STATEMENT_EVENT_SOURCE.INTELLIGENCE_ENGINE
    }),

    [STATEMENT_EVENTS.SLA_BREACHED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.SLA,
        outcome: STATEMENT_EVENT_OUTCOME.FAILED,
        severity: STATEMENT_EVENT_SEVERITY.ERROR,
        source: STATEMENT_EVENT_SOURCE.INTELLIGENCE_ENGINE
    }),

    [STATEMENT_EVENTS.SLA_ESCALATED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.SLA,
        outcome: STATEMENT_EVENT_OUTCOME.ESCALATED,
        severity: STATEMENT_EVENT_SEVERITY.CRITICAL,
        source: STATEMENT_EVENT_SOURCE.INTELLIGENCE_ENGINE
    }),

    [STATEMENT_EVENTS.RISK_ASSESSED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.INTELLIGENCE,
        outcome: STATEMENT_EVENT_OUTCOME.ASSESSED,
        severity: STATEMENT_EVENT_SEVERITY.INFO,
        source: STATEMENT_EVENT_SOURCE.INTELLIGENCE_ENGINE
    }),

    [STATEMENT_EVENTS.PRIORITY_ASSIGNED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.INTELLIGENCE,
        outcome: STATEMENT_EVENT_OUTCOME.ASSIGNED,
        severity: STATEMENT_EVENT_SEVERITY.INFO,
        source: STATEMENT_EVENT_SOURCE.INTELLIGENCE_ENGINE
    }),

    [STATEMENT_EVENTS.TREND_DETECTED]: Object.freeze({
        category: STATEMENT_EVENT_CATEGORY.INTELLIGENCE,
        outcome: STATEMENT_EVENT_OUTCOME.DETECTED,
        severity: STATEMENT_EVENT_SEVERITY.WARNING,
        source: STATEMENT_EVENT_SOURCE.INTELLIGENCE_ENGINE
    })

});

/**
 * ============================================================================
 * Event Registry
 * ============================================================================
 *
 * Immutable registry used by:
 *
 * - event publishers
 * - validators
 * - audit systems
 * - queue consumers
 * - observability
 */

const EVENT_REGISTRY = Object.freeze({

    ...Object.fromEntries(

        Object.entries(EVENT_DEFINITIONS)
            .map(([eventType, definition]) => [

                eventType,

                Object.freeze({

                    eventType,

                    namespace:
                        STATEMENT_EVENT_NAMESPACE,

                    version:
                        STATEMENT_EVENT_VERSION,

                    ...definition

                })

            ])

    )

});

/**
 * ============================================================================
 * Event Type Validation
 * ============================================================================
 */

function isStatementEvent(eventType) {

    return Object.prototype.hasOwnProperty.call(
        EVENT_REGISTRY,
        eventType
    );

}

/**
 * ============================================================================
 * Event Definition Lookup
 * ============================================================================
 */

function getEventDefinition(eventType) {

    if (!isStatementEvent(eventType)) {

        return null;

    }

    return EVENT_REGISTRY[eventType];

}

/**
 * ============================================================================
 * Event Envelope Factory
 * ============================================================================
 *
 * Produces a stable event envelope suitable for:
 *
 * - EventBus
 * - BullMQ
 * - Kafka-like transports
 * - audit logs
 * - structured logging
 * - distributed workers
 *
 * The function is pure and has no I/O side effects.
 */

function createStatementEvent({

    eventType,

    context = null,

    payload = {},

    metadata = {},

    eventId = null,

    occurredAt = new Date(),

    causationId = null,

    idempotencyKey = null,

    producer = null

} = {}) {

    if (!isStatementEvent(eventType)) {

        throw new TypeError(
            `Unknown statement event type: ${eventType}`
        );

    }

    const definition =
        EVENT_REGISTRY[eventType];

    const contextJSON =
        context &&
        typeof context.toJSON === 'function'
            ? context.toJSON()
            : context || {};

    const timestamp =
        occurredAt instanceof Date
            ? new Date(occurredAt)
            : new Date(occurredAt);

    if (Number.isNaN(timestamp.getTime())) {

        throw new TypeError(
            'Invalid statement event timestamp'
        );

    }

    const envelope = {

        eventId:
            eventId ||
            createEventId(),

        eventType,

        namespace:
            STATEMENT_EVENT_NAMESPACE,

        version:
            STATEMENT_EVENT_VERSION,

        category:
            definition.category,

        outcome:
            definition.outcome,

        severity:
            definition.severity,

        source:
            producer ||
            definition.source,

        occurredAt:
            timestamp,

        tenantId:
            contextJSON.tenantId || null,

        userId:
            contextJSON.userId || null,

        statementId:
            metadata.statementId || null,

        batchId:
            metadata.batchId ||
            contextJSON.batchId ||
            null,

        correlationId:
            contextJSON.correlationId || null,

        requestId:
            contextJSON.requestId || null,

        executionId:
            contextJSON.executionId || null,

        traceId:
            contextJSON.traceId || null,

        causationId:
            causationId || null,

        idempotencyKey:
            idempotencyKey || null,

        actor:
            contextJSON.actor || null,

        environment:
            contextJSON.environment || null,

        service:
            contextJSON.service || null,

        payload:
            sanitizePayload(payload),

        metadata:
            sanitizePayload(metadata)

    };

    return deepFreeze(envelope);

}

/**
 * ============================================================================
 * Event ID Generator
 * ============================================================================
 */

function createEventId() {

    return (

        `stmt_evt_${Date.now()}_` +

        Math.random()
            .toString(36)
            .slice(2, 12)

    );

}

/**
 * ============================================================================
 * Payload Sanitization
 * ============================================================================
 *
 * Prevent accidental mutation and avoid carrying Error instances directly
 * inside event payloads.
 */

function sanitizePayload(value, seen = new WeakSet()) {

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

    if (value instanceof Date) {

        return new Date(value);

    }

    if (value instanceof Error) {

        return {

            name:
                value.name,

            code:
                value.code || null,

            message:
                value.message,

            retryable:
                value.retryable === true,

            severity:
                value.severity || null

        };

    }

    if (seen.has(value)) {

        return '[Circular]';

    }

    seen.add(value);

    if (Array.isArray(value)) {

        return value.map(
            item =>
                sanitizePayload(item, seen)
        );

    }

    const result = {};

    Object.keys(value)
        .forEach(key => {

            result[key] =
                sanitizePayload(
                    value[key],
                    seen
                );

        });

    return result;

}

/**
 * ============================================================================
 * Event Name Helpers
 * ============================================================================
 */

function getEventTypesByCategory(category) {

    return Object.freeze(

        Object.entries(EVENT_REGISTRY)

            .filter(
                ([, definition]) =>
                    definition.category === category
            )

            .map(
                ([eventType]) =>
                    eventType
            )

    );

}

/**
 * ============================================================================
 * Failure Event Detection
 * ============================================================================
 */

function isFailureEvent(eventType) {

    const definition =
        getEventDefinition(eventType);

    return Boolean(
        definition &&
        (
            definition.outcome ===
                STATEMENT_EVENT_OUTCOME.FAILED
        )
    );

}

/**
 * ============================================================================
 * Terminal Event Detection
 * ============================================================================
 */

function isTerminalEvent(eventType) {

    const definition =
        getEventDefinition(eventType);

    if (!definition) {

        return false;

    }

    return [

        STATEMENT_EVENT_OUTCOME.COMPLETED,

        STATEMENT_EVENT_OUTCOME.FAILED,

        STATEMENT_EVENT_OUTCOME.CANCELLED,

        STATEMENT_EVENT_OUTCOME.RESOLVED

    ].includes(
        definition.outcome
    );

}

/**
 * ============================================================================
 * Public Exports
 * ============================================================================
 */

module.exports = {

    STATEMENT_EVENT_VERSION,

    STATEMENT_EVENT_NAMESPACE,

    STATEMENT_EVENTS,

    STATEMENT_EVENT_CATEGORY,

    STATEMENT_EVENT_OUTCOME,

    STATEMENT_EVENT_SEVERITY,

    STATEMENT_EVENT_SOURCE,

    EVENT_DEFINITIONS,

    EVENT_REGISTRY,

    isStatementEvent,

    getEventDefinition,

    getEventTypesByCategory,

    isFailureEvent,

    isTerminalEvent,

    createStatementEvent,

    createEventId

};
