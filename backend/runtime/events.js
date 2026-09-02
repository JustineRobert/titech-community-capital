'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Runtime Event Bus
 * =============================================================================
 *
 * File:
 *   backend/runtime/events.js
 *
 * Purpose:
 *   Central process-local event bus for runtime lifecycle, observability,
 *   bootstrap, service, authentication, financial, synchronization, HTTP,
 *   WebSocket and operational events.
 *
 * Architectural Principles
 * -----------------------------------------------------------------------------
 *   ✓ Process-local only.
 *   ✓ Events are notifications, not persistent state.
 *   ✓ Event listeners must not own application state transitions.
 *   ✓ Event emission must not crash the application.
 *   ✓ Listener failures are observable.
 *   ✓ Async listener rejections are captured.
 *   ✓ Event payloads are sanitized before dispatch.
 *   ✓ Event names are centrally defined.
 *   ✓ Listener registration is validated.
 *   ✓ Diagnostics are available without exposing internal listener objects.
 *   ✓ Test reset utilities are available.
 *   ✓ CommonJS compatibility is preserved.
 *
 * Security Principles
 * -----------------------------------------------------------------------------
 *   ✓ No raw secrets should be placed into event payloads.
 *   ✓ Diagnostic serialization avoids circular-reference failures.
 *   ✓ Sensitive-looking fields are redacted from diagnostic snapshots.
 *   ✓ Event listeners are isolated from one another.
 *
 * IMPORTANT
 * -----------------------------------------------------------------------------
 * This module is intentionally framework-independent.
 *
 * It must NOT:
 *   ✗ perform database operations
 *   ✗ perform Redis operations
 *   ✗ authenticate users
 *   ✗ authorize users
 *   ✗ mutate financial balances
 *   ✗ become a replacement for durable messaging
 *
 * Use Kafka, RabbitMQ, Redis Streams, NATS, etc. when durable/distributed
 * event delivery is required.
 * =============================================================================
 */

const {
    EventEmitter
} = require('events');

// =============================================================================
// Configuration
// =============================================================================

const DEFAULT_MAX_LISTENERS =
    Number(
        process.env.TITECH_RUNTIME_EVENT_MAX_LISTENERS ||
        250
    );

const MAX_EVENT_NAME_LENGTH =
    Number(
        process.env.TITECH_RUNTIME_EVENT_MAX_NAME_LENGTH ||
        128
    );

const MAX_PAYLOAD_DEPTH =
    Number(
        process.env.TITECH_RUNTIME_EVENT_MAX_PAYLOAD_DEPTH ||
        8
    );

const MAX_ARRAY_ITEMS =
    Number(
        process.env.TITECH_RUNTIME_EVENT_MAX_ARRAY_ITEMS ||
        100
    );

const MAX_OBJECT_KEYS =
    Number(
        process.env.TITECH_RUNTIME_EVENT_MAX_OBJECT_KEYS ||
        200
    );

const EVENT_ERROR =
    'error';

const EVENT_REJECTED =
    'runtime.event.rejected';

const IS_PRODUCTION =
    String(
        process.env.NODE_ENV ||
        ''
    ).toLowerCase() === 'production';

const FAIL_FAST_ON_INVALID_EVENT =
    String(
        process.env.TITECH_RUNTIME_EVENT_FAIL_FAST ||
        'false'
    ).toLowerCase() === 'true';

const LOG_PREFIX =
    'TITech.RuntimeEventBus';

// =============================================================================
// Runtime Event Bus
// =============================================================================

const runtimeEvents =
    new EventEmitter({
        captureRejections: true
    });

runtimeEvents.setMaxListeners(
    Math.max(
        10,
        DEFAULT_MAX_LISTENERS
    )
);

// =============================================================================
// Event Statistics
// =============================================================================

const eventStatistics = {

    emitted:
        0,

    delivered:
        0,

    errors:
        0,

    rejected:
        0,

    blocked:
        0,

    invalid:
        0,

    lastEvent:
        null,

    lastEventAt:
        null,

    lastErrorAt:
        null,

    lastRejectedAt:
        null,

    eventCounts:
        new Map(),

    errorCounts:
        new Map()
};

// =============================================================================
// Sensitive Key Detection
// =============================================================================

const SENSITIVE_KEY_PATTERN =
    /password|passwd|secret|token|authorization|cookie|private.?key|client.?secret|access.?key|api.?key|credential|connection.?string|database.?url|mongodb.?uri|redis.?url|refresh.?token|otp|pin/i;

// =============================================================================
// Event Name Validation
// =============================================================================

function validateEventName(
    eventName
) {

    if (
        typeof eventName !==
        'string'
    ) {
        return {
            valid: false,
            reason:
                'Event name must be a string.'
        };
    }

    const normalized =
        eventName.trim();

    if (
        !normalized
    ) {
        return {
            valid: false,
            reason:
                'Event name must not be empty.'
        };
    }

    if (
        normalized.length >
        MAX_EVENT_NAME_LENGTH
    ) {
        return {
            valid: false,
            reason:
                'Event name exceeds maximum permitted length.'
        };
    }

    /*
     * Event names intentionally use a conservative namespace format:
     *
     *   application.ready
     *   service.state.changed
     *   financial.operation.completed
     *
     * This prevents accidental arbitrary string injection into metrics/logging
     * systems.
     */
    if (
        !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(
            normalized
        )
    ) {
        return {
            valid: false,
            reason:
                'Event name contains invalid characters.'
        };
    }

    return {
        valid: true,
        value:
            normalized
    };

}

// =============================================================================
// Safe Error Serialization
// =============================================================================

function serializeError(
    error
) {

    if (
        !error
    ) {
        return null;
    }

    const result = {

        name:
            error.name ||
            'Error',

        message:
            error.message ||
            String(
                error
            ),

        code:
            error.code ||
            null
    };

    /*
     * Stack traces are useful in development and should normally be omitted
     * from production runtime telemetry.
     */
    if (
        !IS_PRODUCTION &&
        error.stack
    ) {
        result.stack =
            error.stack;
    }

    if (
        error.statusCode !==
        undefined
    ) {
        result.statusCode =
            error.statusCode;
    }

    return result;

}

// =============================================================================
// Safe Diagnostic Value
// =============================================================================

function sanitizeDiagnosticValue(
    value,
    depth = 0,
    seen = new WeakSet()
) {

    if (
        depth >
        MAX_PAYLOAD_DEPTH
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
        typeof value ===
        'string' ||
        typeof value ===
        'number' ||
        typeof value ===
        'boolean'
    ) {
        return value;
    }

    if (
        typeof value ===
        'bigint'
    ) {
        return value.toString();
    }

    if (
        typeof value ===
        'function'
    ) {
        return '[FUNCTION]';
    }

    if (
        value instanceof Date
    ) {
        return value.toISOString();
    }

    if (
        Buffer.isBuffer(value)
    ) {
        return `[BUFFER:${value.length}]`;
    }

    if (
        typeof value ===
        'object'
    ) {

        if (
            seen.has(value)
        ) {
            return '[CIRCULAR]';
        }

        seen.add(
            value
        );

        if (
            Array.isArray(value)
        ) {

            return value
                .slice(
                    0,
                    MAX_ARRAY_ITEMS
                )
                .map(
                    item =>
                        sanitizeDiagnosticValue(
                            item,
                            depth + 1,
                            seen
                        )
                );
        }

        const output = {};

        const entries =
            Object.entries(
                value
            )
            .slice(
                0,
                MAX_OBJECT_KEYS
            );

        for (
            const [
                key,
                entry
            ] of entries
        ) {

            if (
                SENSITIVE_KEY_PATTERN.test(
                    key
                )
            ) {
                output[key] =
                    '[REDACTED]';

                continue;
            }

            output[key] =
                sanitizeDiagnosticValue(
                    entry,
                    depth + 1,
                    seen
                );
        }

        return output;
    }

    return String(
        value
    );

}

// =============================================================================
// Event Statistics Helpers
// =============================================================================

function incrementMapCounter(
    map,
    key
) {

    const previous =
        map.get(
            key
        ) || 0;

    map.set(
        key,
        previous + 1
    );

}

function createTimestamp() {
    return new Date();
}

// =============================================================================
// Mandatory Internal Error Handler
// =============================================================================
//
// Node EventEmitter treats an emitted "error" event without an error listener
// as a process-fatal condition.
//
// TITech deliberately installs an internal error listener.
//
// =============================================================================

function handleRuntimeEventError(
    error
) {

    eventStatistics.errors +=
        1;

    eventStatistics.lastErrorAt =
        createTimestamp();

    const errorCode =
        error?.code ||
        'RUNTIME_EVENT_ERROR';

    incrementMapCounter(
        eventStatistics.errorCounts,
        errorCode
    );

    console.error(
        `[${LOG_PREFIX}]`,
        serializeError(
            error
        )
    );

}

runtimeEvents.on(
    EVENT_ERROR,
    handleRuntimeEventError
);

// =============================================================================
// Async Rejection Handler
// =============================================================================
//
// EventEmitter with captureRejections=true redirects rejected promises from
// async listeners into the "error" event.
//
// The explicit rejected event remains useful when a producer/listener wrapper
// chooses to surface rejection metadata.
//
// =============================================================================

runtimeEvents.on(
    EVENT_REJECTED,
    payload => {

        eventStatistics.rejected +=
            1;

        eventStatistics.lastRejectedAt =
            createTimestamp();

        console.error(
            `[${LOG_PREFIX}:REJECTED]`,
            sanitizeDiagnosticValue(
                payload
            )
        );

    }
);

// =============================================================================
// Centralized Event Payload Builder
// =============================================================================

function createEventPayload(
    eventName,
    payload
) {

    const safePayload =
        (
            payload &&
            typeof payload === 'object' &&
            !Array.isArray(payload)
        )
            ? sanitizeDiagnosticValue(
                payload
            )
            : {
                value:
                    sanitizeDiagnosticValue(
                        payload
                    )
            };

    return {

        ...safePayload,

        _meta: {

            event:
                eventName,

            timestamp:
                new Date()
                    .toISOString(),

            pid:
                process.pid
        }
    };

}

// =============================================================================
// Safe Event Delivery
// =============================================================================
//
// EventEmitter.emit() is synchronous. A throwing listener can therefore
// interrupt subsequent listener execution.
//
// TITech wraps listener registration so listener failures are reported rather
// than becoming application-fatal.
//
// =============================================================================

function wrapListener(
    eventName,
    listener
) {

    return async function safeRuntimeListener(
        ...args
    ) {

        try {

            const result =
                listener(
                    ...args
                );

            if (
                result &&
                typeof result.then ===
                'function'
            ) {
                await result;
            }

            eventStatistics.delivered +=
                1;

        } catch (error) {

            eventStatistics.errors +=
                1;

            eventStatistics.lastErrorAt =
                createTimestamp();

            const errorCode =
                error?.code ||
                'RUNTIME_EVENT_LISTENER_ERROR';

            incrementMapCounter(
                eventStatistics.errorCounts,
                errorCode
            );

            try {

                /*
                 * This notification is deliberately emitted using the raw
                 * emitter rather than emitEvent() to avoid recursive wrapping.
                 */
                runtimeEvents.emit(
                    EVENT_REJECTED,
                    {
                        event:
                            eventName,

                        error:
                            serializeError(
                                error
                            ),

                        timestamp:
                            new Date()
                                .toISOString(),

                        pid:
                            process.pid
                    }
                );

            } catch {
                // Never allow observability failure to crash the application.
            }

            console.error(
                `[${LOG_PREFIX}:LISTENER]`,
                {
                    event:
                        eventName,

                    error:
                        serializeError(
                            error
                        )
                }
            );

        }

    };

}

// =============================================================================
// Emit Event
// =============================================================================

function emitEvent(
    eventName,
    payload = {}
) {

    const validation =
        validateEventName(
            eventName
        );

    if (
        !validation.valid
    ) {

        eventStatistics.invalid +=
            1;

        const error =
            new TypeError(
                validation.reason
            );

        error.code =
            'TITECH_RUNTIME_EVENT_NAME_INVALID';

        if (
            FAIL_FAST_ON_INVALID_EVENT
        ) {
            throw error;
        }

        console.error(
            `[${LOG_PREFIX}:INVALID]`,
            validation.reason
        );

        return false;
    }

    const normalizedEventName =
        validation.value;

    const eventPayload =
        createEventPayload(
            normalizedEventName,
            payload
        );

    eventStatistics.emitted +=
        1;

    eventStatistics.lastEvent =
        normalizedEventName;

    eventStatistics.lastEventAt =
        createTimestamp();

    incrementMapCounter(
        eventStatistics.eventCounts,
        normalizedEventName
    );

    try {

        runtimeEvents.emit(
            normalizedEventName,
            eventPayload
        );

        return true;

    } catch (error) {

        /*
         * Synchronous errors may still occur from listeners registered directly
         * against runtimeEvents rather than through onEvent()/onceEvent().
         */
        eventStatistics.errors +=
            1;

        eventStatistics.lastErrorAt =
            createTimestamp();

        console.error(
            `[${LOG_PREFIX}:EMIT]`,
            {
                event:
                    normalizedEventName,

                error:
                    serializeError(
                        error
                    )
            }
        );

        return false;
    }

}

// =============================================================================
// Async Emit
// =============================================================================
//
// Useful when callers want to wait for async listeners to settle.
//
// EventEmitter's native emit() does not await listeners. This helper executes
// registered listeners through a controlled snapshot and waits for them.
//
// =============================================================================

async function emitEventAsync(
    eventName,
    payload = {}
) {

    const validation =
        validateEventName(
            eventName
        );

    if (
        !validation.valid
    ) {

        eventStatistics.invalid +=
            1;

        const error =
            new TypeError(
                validation.reason
            );

        error.code =
            'TITECH_RUNTIME_EVENT_NAME_INVALID';

        if (
            FAIL_FAST_ON_INVALID_EVENT
        ) {
            throw error;
        }

        return false;
    }

    const normalizedEventName =
        validation.value;

    const eventPayload =
        createEventPayload(
            normalizedEventName,
            payload
        );

    eventStatistics.emitted +=
        1;

    eventStatistics.lastEvent =
        normalizedEventName;

    eventStatistics.lastEventAt =
        createTimestamp();

    incrementMapCounter(
        eventStatistics.eventCounts,
        normalizedEventName
    );

    const listeners =
        runtimeEvents
            .listeners(
                normalizedEventName
            );

    /*
     * Native EventEmitter may contain special internal listeners such as
     * the "error" handler. They are intentionally left intact.
     *
     * Executing through Promise.allSettled keeps one failed listener from
     * preventing other listeners from receiving the event.
     */
    const results =
        await Promise.allSettled(
            listeners.map(
                listener =>
                    Promise.resolve()
                        .then(
                            () =>
                                listener(
                                    eventPayload
                                )
                        )
            )
        );

    const failures =
        results.filter(
            result =>
                result.status ===
                'rejected'
        );

    if (
        failures.length
    ) {

        for (
            const failure
            of failures
        ) {

            const error =
                failure.reason;

            eventStatistics.errors +=
                1;

            eventStatistics.rejected +=
                1;

            const errorCode =
                error?.code ||
                'RUNTIME_EVENT_ASYNC_LISTENER_ERROR';

            incrementMapCounter(
                eventStatistics.errorCounts,
                errorCode
            );

            try {

                runtimeEvents.emit(
                    EVENT_REJECTED,
                    {
                        event:
                            normalizedEventName,

                        error:
                            serializeError(
                                error
                            ),

                        timestamp:
                            new Date()
                                .toISOString(),

                        pid:
                            process.pid
                    }
                );

            } catch {
                // Never allow telemetry failure to break application flow.
            }

        }
    }

    return failures.length ===
        0;

}

// =============================================================================
// Safe Listener Registration
// =============================================================================

function validateListenerRegistration(
    eventName,
    listener
) {

    const validation =
        validateEventName(
            eventName
        );

    if (
        !validation.valid
    ) {

        throw new TypeError(
            validation.reason
        );
    }

    if (
        typeof listener !==
        'function'
    ) {

        throw new TypeError(
            'Event listener must be a function.'
        );
    }

    return validation.value;

}

// =============================================================================
// Register Listener
// =============================================================================

function onEvent(
    eventName,
    listener,
    options = {}
) {

    const normalizedEventName =
        validateListenerRegistration(
            eventName,
            listener
        );

    const wrapped =
        wrapListener(
            normalizedEventName,
            listener
        );

    if (
        options.prepend === true
    ) {

        runtimeEvents.prependListener(
            normalizedEventName,
            wrapped
        );

    } else {

        runtimeEvents.on(
            normalizedEventName,
            wrapped
        );
    }

    return () => {

        runtimeEvents.off(
            normalizedEventName,
            wrapped
        );

    };

}

// =============================================================================
// Register One-Time Listener
// =============================================================================

function onceEvent(
    eventName,
    listener
) {

    const normalizedEventName =
        validateListenerRegistration(
            eventName,
            listener
        );

    const wrapped =
        wrapListener(
            normalizedEventName,
            listener
        );

    runtimeEvents.once(
        normalizedEventName,
        wrapped
    );

    return () => {

        runtimeEvents.off(
            normalizedEventName,
            wrapped
        );

    };

}

// =============================================================================
// Remove Listener
// =============================================================================

function offEvent(
    eventName,
    listener
) {

    const normalizedEventName =
        validateListenerRegistration(
            eventName,
            listener
        );

    runtimeEvents.off(
        normalizedEventName,
        listener
    );

}

// =============================================================================
// Listener Count
// =============================================================================

function getListenerCount(
    eventName = null
) {

    if (
        eventName === null
    ) {

        return runtimeEvents
            .eventNames()
            .reduce(
                (
                    total,
                    name
                ) =>
                    total +
                    runtimeEvents
                        .listenerCount(
                            name
                        ),
                0
            );
    }

    const validation =
        validateEventName(
            eventName
        );

    if (
        !validation.valid
    ) {
        return 0;
    }

    return runtimeEvents.listenerCount(
        validation.value
    );

}

// =============================================================================
// Event Names Snapshot
// =============================================================================

function getRegisteredEventNames() {

    return runtimeEvents
        .eventNames()
        .map(
            name =>
                String(
                    name
                )
        )
        .sort();

}

// =============================================================================
// Event Statistics Snapshot
// =============================================================================

function getEventStatistics() {

    return {

        emitted:
            eventStatistics.emitted,

        delivered:
            eventStatistics.delivered,

        errors:
            eventStatistics.errors,

        rejected:
            eventStatistics.rejected,

        blocked:
            eventStatistics.blocked,

        invalid:
            eventStatistics.invalid,

        lastEvent:
            eventStatistics.lastEvent,

        lastEventAt:
            eventStatistics.lastEventAt
                ?.toISOString() ||
            null,

        lastErrorAt:
            eventStatistics.lastErrorAt
                ?.toISOString() ||
            null,

        lastRejectedAt:
            eventStatistics.lastRejectedAt
                ?.toISOString() ||
            null,

        listenerCount:
            getListenerCount(),

        registeredEvents:
            getRegisteredEventNames(),

        eventCounts:
            Object.fromEntries(
                eventStatistics
                    .eventCounts
            ),

        errorCounts:
            Object.fromEntries(
                eventStatistics
                    .errorCounts
            )
    };

}

// =============================================================================
// Runtime Event Names
// =============================================================================
//
// Central event registry.
//
// Names should remain backwards compatible once consumed by observability,
// audit, metrics or integration systems.
// =============================================================================

const RUNTIME_EVENTS =
    Object.freeze({

        // ---------------------------------------------------------------------
        // Runtime
        // ---------------------------------------------------------------------

        RUNTIME_INITIALIZED:
            'runtime.initialized',

        RUNTIME_EVENT_REJECTED:
            EVENT_REJECTED,

        // ---------------------------------------------------------------------
        // Application lifecycle
        // ---------------------------------------------------------------------

        APPLICATION_STARTED:
            'application.started',

        APPLICATION_READY:
            'application.ready',

        APPLICATION_HEALTH_CHANGED:
            'application.health.changed',

        APPLICATION_DEGRADED:
            'application.degraded',

        APPLICATION_SHUTDOWN:
            'application.shutdown',

        APPLICATION_STOPPED:
            'application.stopped',

        // ---------------------------------------------------------------------
        // Bootstrap
        // ---------------------------------------------------------------------

        BOOTSTRAP_STARTED:
            'bootstrap.started',

        BOOTSTRAP_PHASE_CHANGED:
            'bootstrap.phase.changed',

        BOOTSTRAP_COMPLETED:
            'bootstrap.completed',

        BOOTSTRAP_FAILED:
            'bootstrap.failed',

        // ---------------------------------------------------------------------
        // Services
        // ---------------------------------------------------------------------

        SERVICE_REGISTERED:
            'service.registered',

        SERVICE_STARTED:
            'service.started',

        SERVICE_STATE_CHANGED:
            'service.state.changed',

        SERVICE_DEGRADED:
            'service.degraded',

        SERVICE_FAILED:
            'service.failed',

        SERVICE_STOPPED:
            'service.stopped',

        // ---------------------------------------------------------------------
        // HTTP / requests
        // ---------------------------------------------------------------------

        REQUEST_STARTED:
            'request.started',

        REQUEST_COMPLETED:
            'request.completed',

        REQUEST_FAILED:
            'request.failed',

        REQUEST_TIMEOUT:
            'request.timeout',

        // ---------------------------------------------------------------------
        // WebSocket
        // ---------------------------------------------------------------------

        WEBSOCKET_CONNECTED:
            'websocket.connected',

        WEBSOCKET_DISCONNECTED:
            'websocket.disconnected',

        WEBSOCKET_ERROR:
            'websocket.error',

        // ---------------------------------------------------------------------
        // Authentication
        // ---------------------------------------------------------------------

        AUTHENTICATION_LOGIN:
            'authentication.login',

        AUTHENTICATION_LOGIN_FAILED:
            'authentication.login.failed',

        AUTHENTICATION_LOGOUT:
            'authentication.logout',

        AUTHENTICATION_REFRESH:
            'authentication.refresh',

        AUTHENTICATION_REVOKED:
            'authentication.revoked',

        // ---------------------------------------------------------------------
        // Tenancy
        // ---------------------------------------------------------------------

        TENANT_RESOLVED:
            'tenant.resolved',

        TENANT_ATTACHED:
            'tenant.attached',

        TENANT_CREATED:
            'tenant.created',

        TENANT_UPDATED:
            'tenant.updated',

        TENANT_SUSPENDED:
            'tenant.suspended',

        TENANT_DELETED:
            'tenant.deleted',

        TENANT_PROVISIONED:
            'tenant.provisioned',

        // ---------------------------------------------------------------------
        // Financial operations
        // ---------------------------------------------------------------------

        FINANCIAL_OPERATION_STARTED:
            'financial.operation.started',

        FINANCIAL_OPERATION_COMPLETED:
            'financial.operation.completed',

        FINANCIAL_OPERATION_FAILED:
            'financial.operation.failed',

        FINANCIAL_TRANSACTION_CREATED:
            'financial.transaction.created',

        FINANCIAL_TRANSACTION_COMPLETED:
            'financial.transaction.completed',

        FINANCIAL_TRANSACTION_REVERSED:
            'financial.transaction.reversed',

        LEDGER_ENTRY_CREATED:
            'financial.ledger.entry.created',

        BALANCE_CREDITED:
            'financial.balance.credited',

        BALANCE_DEBITED:
            'financial.balance.debited',

        // ---------------------------------------------------------------------
        // Payments / mobile money
        // ---------------------------------------------------------------------

        PAYMENT_INITIATED:
            'payment.initiated',

        PAYMENT_COMPLETED:
            'payment.completed',

        PAYMENT_FAILED:
            'payment.failed',

        PAYMENT_REVERSED:
            'payment.reversed',

        MOMO_REQUESTED:
            'momo.requested',

        MOMO_COMPLETED:
            'momo.completed',

        MOMO_FAILED:
            'momo.failed',

        MOMO_WEBHOOK_RECEIVED:
            'momo.webhook.received',

        // ---------------------------------------------------------------------
        // Loans
        // ---------------------------------------------------------------------

        LOAN_CREATED:
            'loan.created',

        LOAN_APPROVED:
            'loan.approved',

        LOAN_REJECTED:
            'loan.rejected',

        LOAN_DISBURSED:
            'loan.disbursed',

        LOAN_REPAYMENT:
            'loan.repayment',

        LOAN_REPAID:
            'loan.repaid',

        // ---------------------------------------------------------------------
        // Compliance / risk
        // ---------------------------------------------------------------------

        KYC_STARTED:
            'kyc.started',

        KYC_COMPLETED:
            'kyc.completed',

        KYC_FAILED:
            'kyc.failed',

        AML_ALERT_CREATED:
            'aml.alert.created',

        FRAUD_ALERT_CREATED:
            'fraud.alert.created',

        SANCTIONS_MATCH:
            'sanctions.match',

        // ---------------------------------------------------------------------
        // Reconciliation
        // ---------------------------------------------------------------------

        RECONCILIATION_STARTED:
            'reconciliation.started',

        RECONCILIATION_COMPLETED:
            'reconciliation.completed',

        RECONCILIATION_EXCEPTION:
            'reconciliation.exception',

        // ---------------------------------------------------------------------
        // Offline / synchronization
        // ---------------------------------------------------------------------

        OFFLINE_ENTERED:
            'offline.entered',

        ONLINE_RESTORED:
            'online.restored',

        SYNC_STARTED:
            'sync.started',

        SYNC_COMPLETED:
            'sync.completed',

        SYNC_FAILED:
            'sync.failed',

        // ---------------------------------------------------------------------
        // Operational
        // ---------------------------------------------------------------------

        INCIDENT_CREATED:
            'incident.created',

        INCIDENT_RESOLVED:
            'incident.resolved',

        ALERT_CREATED:
            'alert.created',

        CAPACITY_WARNING:
            'capacity.warning',

        CACHE_DEGRADED:
            'cache.degraded',

        DATABASE_DEGRADED:
            'database.degraded',

        QUEUE_BACKPRESSURE:
            'queue.backpressure'
    });

// =============================================================================
// Reset Statistics
// =============================================================================

function resetEventStatistics() {

    eventStatistics.emitted =
        0;

    eventStatistics.delivered =
        0;

    eventStatistics.errors =
        0;

    eventStatistics.rejected =
        0;

    eventStatistics.blocked =
        0;

    eventStatistics.invalid =
        0;

    eventStatistics.lastEvent =
        null;

    eventStatistics.lastEventAt =
        null;

    eventStatistics.lastErrorAt =
        null;

    eventStatistics.lastRejectedAt =
        null;

    eventStatistics.eventCounts.clear();

    eventStatistics.errorCounts.clear();

}

// =============================================================================
// Remove Runtime Listeners
// =============================================================================
//
// Primarily intended for tests and controlled process shutdown.
// =============================================================================

function removeAllRuntimeListeners() {

    runtimeEvents.removeAllListeners();

}

// =============================================================================
// Reset Runtime Event Bus
// =============================================================================
//
// Test utility.
//
// Restores the mandatory internal error/rejection listeners after clearing all
// listeners.
// =============================================================================

function resetRuntimeEvents() {

    runtimeEvents.removeAllListeners();

    resetEventStatistics();

    runtimeEvents.setMaxListeners(
        Math.max(
            10,
            DEFAULT_MAX_LISTENERS
        )
    );

    runtimeEvents.on(
        EVENT_ERROR,
        handleRuntimeEventError
    );

    runtimeEvents.on(
        EVENT_REJECTED,
        payload => {

            eventStatistics.rejected +=
                1;

            eventStatistics.lastRejectedAt =
                createTimestamp();

            console.error(
                `[${LOG_PREFIX}:REJECTED]`,
                sanitizeDiagnosticValue(
                    payload
                )
            );

        }
    );

}

// =============================================================================
// Runtime Event Bus Health
// =============================================================================

function getHealth() {

    const statistics =
        getEventStatistics();

    const listenerCount =
        statistics.listenerCount;

    const healthy =
        listenerCount <
            (
                DEFAULT_MAX_LISTENERS *
                2
            ) &&
        statistics.errors <
            Math.max(
                100,
                statistics.emitted * 0.05
            );

    return {

        healthy,

        status:
            healthy
                ? 'healthy'
                : 'degraded',

        listenerCount,

        maxListeners:
            DEFAULT_MAX_LISTENERS,

        emitted:
            statistics.emitted,

        errors:
            statistics.errors,

        rejected:
            statistics.rejected,

        invalid:
            statistics.invalid,

        timestamp:
            new Date().toISOString()
    };

}

// =============================================================================
// Shutdown
// =============================================================================

function shutdownEventBus() {

    /*
     * Remove application listeners while retaining the ability to inspect the
     * statistics collected so far.
     */
    runtimeEvents.removeAllListeners();

    resetEventStatistics();

}

// =============================================================================
// Public API
// =============================================================================

module.exports = {

    // -------------------------------------------------------------------------
    // Event bus
    // -------------------------------------------------------------------------

    runtimeEvents,

    RUNTIME_EVENTS,

    // -------------------------------------------------------------------------
    // Emission
    // -------------------------------------------------------------------------

    emitEvent,

    emitEventAsync,

    // -------------------------------------------------------------------------
    // Listener management
    // -------------------------------------------------------------------------

    onEvent,

    onceEvent,

    offEvent,

    getListenerCount,

    getRegisteredEventNames,

    // -------------------------------------------------------------------------
    // Diagnostics
    // -------------------------------------------------------------------------

    getEventStatistics,

    getHealth,

    // -------------------------------------------------------------------------
    // Lifecycle / testing
    // -------------------------------------------------------------------------

    resetEventStatistics,

    removeAllRuntimeListeners,

    resetRuntimeEvents,

    shutdownEventBus,

    // -------------------------------------------------------------------------
    // Configuration
    // -------------------------------------------------------------------------

    DEFAULT_MAX_LISTENERS,

    MAX_EVENT_NAME_LENGTH
};