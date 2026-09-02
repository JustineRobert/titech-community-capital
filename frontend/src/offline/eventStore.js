'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/src/offline/eventStore.js
 *
 * Purpose:
 *   Enterprise production-grade append-only event store for the TITech
 *   offline-first subsystem.
 *
 * Responsibilities
 * =============================================================================
 *
 *   ✓ Persist immutable domain/offline events.
 *   ✓ Provide deterministic event identifiers.
 *   ✓ Provide aggregate stream/version support.
 *   ✓ Provide optimistic concurrency protection.
 *   ✓ Provide causation/correlation/trace metadata.
 *   ✓ Support device identity metadata.
 *   ✓ Support tenant/user context.
 *   ✓ Support event sequence numbers.
 *   ✓ Support append-only event semantics.
 *   ✓ Support event replay and aggregate reconstruction.
 *   ✓ Support cursor-based/event-sequence reads.
 *   ✓ Support event-type filtering.
 *   ✓ Support aggregate filtering.
 *   ✓ Support financial event classification.
 *   ✓ Support event integrity hashes.
 *   ✓ Support encrypted event payload envelopes.
 *   ✓ Support immutable audit metadata.
 *   ✓ Detect duplicate event IDs.
 *   ✓ Detect duplicate idempotency keys.
 *   ✓ Enforce expected aggregate version.
 *   ✓ Provide safe operational snapshots.
 *   ✓ Reuse the TITech offline database boundary.
 *
 * IMPORTANT
 * =============================================================================
 *
 *   This module is an EVENT STORE, not a general-purpose document store.
 *
 *   Events are append-only.
 *
 *   Existing event records MUST NOT be mutated in place.
 *
 *   Corrections must be represented by new events.
 *
 *   Financial events must preserve:
 *
 *       event identity
 *           ↓
 *       idempotency
 *           ↓
 *       sequence/version
 *           ↓
 *       integrity
 *           ↓
 *       auditability
 *           ↓
 *       reconciliation
 *
 *   The event store does NOT make the event authoritative for the financial
 *   ledger. The authoritative financial state remains the server-side ledger
 *   and reconciliation boundary.
 *
 * =============================================================================
 *
 * Event architecture
 * =============================================================================
 *
 *   command / offline operation
 *             ↓
 *       device identity
 *             ↓
 *        event creation
 *             ↓
 *        eventStore.js
 *             ↓
 *       immutable stream
 *             ↓
 *       synchronization
 *             ↓
 *       authoritative backend
 *             ↓
 *        reconciliation
 *             ↓
 *       financial ledger
 *
 * =============================================================================
 */

const crypto =
    require('node:crypto');

const {
    offlineDatabase,
    OfflineDatabaseError,
} =
    require('./db');

const {
    EVENTS,
    OPERATION_TYPES,
    LIMITS,
    FINANCIAL_OPERATION_TYPES,
    CONSISTENCY_LEVELS,
} =
    require('./constants');

const {
    canonicalizeToString,
    createOperationHash,
    hashObject,
    encryptObject,
    decryptObject,
    validateEnvelope,
    fingerprintEnvelope,
} =
    require('./crypto');

/**
 * =============================================================================
 * Optional device identity
 * =============================================================================
 */

let deviceIdentityModule =
    null;

try {
    // eslint-disable-next-line global-require
    deviceIdentityModule =
        require('./deviceIdentity');
} catch {
    deviceIdentityModule =
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
        require('../../utils/logger');
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
    'offline.eventStore';

const EVENT_SCHEMA_VERSION =
    1;

const DEFAULT_PAGE_SIZE =
    100;

const MAX_PAGE_SIZE =
    1_000;

const MAX_EVENT_TYPE_LENGTH =
    255;

const MAX_AGGREGATE_TYPE_LENGTH =
    255;

const MAX_AGGREGATE_ID_LENGTH =
    255;

const MAX_METADATA_BYTES =
    64 * 1024;

const MAX_PAYLOAD_BYTES =
    LIMITS.MAX_OPERATION_PAYLOAD_BYTES;

const DEFAULT_ENCRYPTION_REQUIRED =
    true;

const DEFAULT_INTEGRITY_REQUIRED =
    true;

/**
 * =============================================================================
 * Event categories
 * =============================================================================
 */

const EVENT_CATEGORIES =
    Object.freeze({
        DOMAIN:
            'domain',

        SYSTEM:
            'system',

        SYNC:
            'sync',

        CONNECTIVITY:
            'connectivity',

        CONFLICT:
            'conflict',

        SECURITY:
            'security',

        AUDIT:
            'audit',

        FINANCIAL:
            'financial',

        LEDGER:
            'ledger',

        PAYMENT:
            'payment',

        MOBILE_MONEY:
            'mobile_money',

        USER:
            'user',

        GROUP:
            'group',

        LOAN:
            'loan',

        CONTRIBUTION:
            'contribution',

        RECONCILIATION:
            'reconciliation',
    });

/**
 * =============================================================================
 * Event persistence states
 * =============================================================================
 */

const EVENT_STATES =
    Object.freeze({
        APPENDED:
            'appended',

        REPLAYED:
            'replayed',

        RECONCILED:
            'reconciled',

        CONFLICTED:
            'conflicted',

        QUARANTINED:
            'quarantined',
    });

/**
 * =============================================================================
 * EventStore errors
 * =============================================================================
 */

class EventStoreError
    extends Error {

    constructor(
        message,
        options = {},
    ) {

        super(message);

        this.name =
            'EventStoreError';

        this.code =
            options.code ||
            'TITECH_OFFLINE_EVENT_STORE_ERROR';

        this.eventId =
            options.eventId ||
            null;

        this.aggregateId =
            options.aggregateId ||
            null;

        this.aggregateType =
            options.aggregateType ||
            null;

        this.streamVersion =
            options.streamVersion ??
            null;

        this.cause =
            options.cause ||
            null;

        this.details =
            Object.freeze({
                ...(options.details || {}),
            });

        Error.captureStackTrace?.(
            this,
            EventStoreError,
        );
    }
}

/**
 * =============================================================================
 * Utility helpers
 * =============================================================================
 */

function getLogger() {

    try {

        return (
            loggerModule?.getLogger?.() ||
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
            typeof logger?.[level] ===
            'function'
        ) {

            logger[level](
                {
                    component:
                        COMPONENT,

                    ...metadata,
                },
                message,
            );
        }

    } catch {
        // Event persistence must not depend on logger availability.
    }
}

function deepClone(
    value,
) {

    if (
        value === undefined ||
        value === null
    ) {

        return value;
    }

    if (
        Buffer.isBuffer(value)
    ) {

        return Buffer.from(
            value,
        );
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
            // Continue to recursive fallback.
        }
    }

    if (
        Array.isArray(value)
    ) {

        return value.map(
            item =>
                deepClone(
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
                deepClone(
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
        seen.has(value)
    ) {

        return value;
    }

    seen.add(value);

    for (
        const key of
        Reflect.ownKeys(value)
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

function normalizeString(
    value,
    name,
    maxLength = 255,
) {

    const normalized =
        String(
            value ??
            '',
        ).trim();

    if (
        !normalized
    ) {

        throw new EventStoreError(
            `${name} is required.`,
            {
                code:
                    'TITECH_OFFLINE_EVENT_INVALID_FIELD',
            },
        );
    }

    if (
        normalized.length >
        maxLength
    ) {

        throw new EventStoreError(
            `${name} exceeds the permitted length.`,
            {
                code:
                    'TITECH_OFFLINE_EVENT_FIELD_TOO_LONG',

                details: {
                    name,
                    maxLength,
                    actualLength:
                        normalized.length,
                },
            },
        );
    }

    return normalized;
}

function normalizeOptionalString(
    value,
    maxLength = 255,
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
        ).trim();

    if (
        !normalized
    ) {

        return null;
    }

    if (
        normalized.length >
        maxLength
    ) {

        throw new EventStoreError(
            'Optional event field exceeds the permitted length.',
            {
                code:
                    'TITECH_OFFLINE_EVENT_FIELD_TOO_LONG',

                details: {
                    maxLength,
                },
            },
        );
    }

    return normalized;
}

function normalizeInteger(
    value,
    fallback = null,
) {

    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {

        return fallback;
    }

    const parsed =
        Number(value);

    return Number.isInteger(
        parsed,
    )
        ? parsed
        : fallback;
}

function serializeJson(
    value,
    maxBytes,
    field,
) {

    let serialized;

    try {

        serialized =
            JSON.stringify(
                value,
            );

    } catch (
        error
    ) {

        throw new EventStoreError(
            `${field} cannot be serialized.`,
            {
                code:
                    'TITECH_OFFLINE_EVENT_SERIALIZATION_FAILED',

                cause:
                    error,
            },
        );
    }

    const bytes =
        Buffer.byteLength(
            serialized,
            'utf8',
        );

    if (
        maxBytes &&
        bytes >
        maxBytes
    ) {

        throw new EventStoreError(
            `${field} exceeds the configured size limit.`,
            {
                code:
                    'TITECH_OFFLINE_EVENT_PAYLOAD_TOO_LARGE',

                details: {
                    field,
                    maxBytes,
                    actualBytes:
                        bytes,
                },
            },
        );
    }

    return serialized;
}

function parseJson(
    value,
    field,
) {

    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {

        return null;
    }

    try {

        return JSON.parse(
            value,
        );

    } catch (
        error
    ) {

        throw new EventStoreError(
            `${field} contains invalid JSON.`,
            {
                code:
                    'TITECH_OFFLINE_EVENT_INVALID_JSON',

                cause:
                    error,
            },
        );
    }
}

function isoNow() {

    return new Date().toISOString();
}

function nowMs() {

    return Date.now();
}

function isFinancialEventType(
    eventType,
) {

    const normalized =
        String(
            eventType ||
            '',
        )
            .trim()
            .toLowerCase();

    return FINANCIAL_OPERATION_TYPES
        .some(
            type =>
                normalized ===
                    type ||
                normalized.startsWith(
                    `${type}.`,
                ),
        );
}

function normalizeCategory(
    category,
    eventType,
) {

    if (
        category
    ) {

        return String(
            category,
        )
            .trim()
            .toLowerCase();
    }

    if (
        isFinancialEventType(
            eventType,
        )
    ) {

        return EVENT_CATEGORIES
            .FINANCIAL;
    }

    return EVENT_CATEGORIES
        .DOMAIN;
}

function normalizeTimestamp(
    value,
) {

    if (
        value === undefined ||
        value === null
    ) {

        return nowMs();
    }

    if (
        value instanceof Date
    ) {

        return value.getTime();
    }

    if (
        typeof value ===
        'string'
    ) {

        const parsed =
            Date.parse(
                value,
            );

        if (
            Number.isFinite(parsed)
        ) {

            return parsed;
        }
    }

    const numeric =
        Number(value);

    if (
        Number.isFinite(
            numeric,
        )
    ) {

        return numeric;
    }

    throw new EventStoreError(
        'Invalid TITech event timestamp.',
        {
            code:
                'TITECH_OFFLINE_EVENT_INVALID_TIMESTAMP',
        },
    );
}

/**
 * =============================================================================
 * EventStore
 * =============================================================================
 */

class EventStore {

    constructor(
        options = {},
    ) {

        this.options =
            Object.freeze({
                encryptionRequired:
                    options.encryptionRequired ??
                    DEFAULT_ENCRYPTION_REQUIRED,

                integrityRequired:
                    options.integrityRequired ??
                    DEFAULT_INTEGRITY_REQUIRED,

                maxPayloadBytes:
                    options.maxPayloadBytes ||
                    MAX_PAYLOAD_BYTES,

                maxMetadataBytes:
                    options.maxMetadataBytes ||
                    MAX_METADATA_BYTES,

                pageSize:
                    Math.min(
                        MAX_PAGE_SIZE,
                        Math.max(
                            1,
                            options.pageSize ||
                            DEFAULT_PAGE_SIZE,
                        ),
                    ),

                strict:
                    options.strict !==
                    false,

                requireAggregateVersion:
                    options.requireAggregateVersion ??
                    true,

                allowGlobalEvents:
                    options.allowGlobalEvents ??
                    true,
            });

        this.initialized =
            false;

        this.lastError =
            null;

        this.lastAppendAt =
            null;

        this.lastReplayAt =
            null;

        this.metrics = {
            appends:
                0,

            reads:
                0,

            replays:
                0,

            duplicateEvents:
                0,

            concurrencyConflicts:
                0,

            integrityFailures:
                0,

            encryptionFailures:
                0,

            financialEvents:
                0,
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Ensure the shared offline database is initialized.
     * -------------------------------------------------------------------------
     */

    initialize() {

        offlineDatabase.initialize();

        this.ensureSchema();

        this.initialized =
            true;

        this.lastError =
            null;

        return this;
    }

    /**
     * -------------------------------------------------------------------------
     * Assert readiness.
     * -------------------------------------------------------------------------
     */

    assertReady() {

        if (
            !this.initialized
        ) {

            this.initialize();
        }

        try {
            offlineDatabase.assertReady();
        } catch (
            error
        ) {

            throw new EventStoreError(
                'TITech offline event store database is not ready.',
                {
                    code:
                        'TITECH_OFFLINE_EVENT_STORE_NOT_READY',

                    cause:
                        error,
                },
            );
        }

        return true;
    }

    /**
     * -------------------------------------------------------------------------
     * Get shared SQLite handle.
     * -------------------------------------------------------------------------
     *
     * eventStore.js deliberately uses the already initialized offline database
     * rather than opening a second SQLite connection against the same WAL file.
     * -------------------------------------------------------------------------
     */

    getDatabase() {

        this.assertReady();

        if (
            !offlineDatabase.db
        ) {

            throw new EventStoreError(
                'TITech offline event store SQLite handle is unavailable.',
                {
                    code:
                        'TITECH_OFFLINE_EVENT_STORE_HANDLE_UNAVAILABLE',
                },
            );
        }

        return offlineDatabase.db;
    }

    /**
     * -------------------------------------------------------------------------
     * Ensure event schema.
     * -------------------------------------------------------------------------
     */

    ensureSchema() {

        const db =
            this.getDatabase();

        try {

            db.exec(`
                CREATE TABLE IF NOT EXISTS offline_events (
                    event_id TEXT PRIMARY KEY NOT NULL,

                    event_type TEXT NOT NULL,
                    category TEXT NOT NULL,

                    aggregate_type TEXT,
                    aggregate_id TEXT,
                    aggregate_version INTEGER NOT NULL DEFAULT 1,

                    sequence INTEGER NOT NULL,

                    global_sequence INTEGER,

                    stream_id TEXT NOT NULL,

                    event_state TEXT NOT NULL DEFAULT 'appended',

                    tenant_id TEXT,
                    user_id TEXT,
                    device_id TEXT,
                    client_id TEXT,

                    operation_id TEXT,

                    idempotency_key TEXT,
                    idempotency_hash TEXT,

                    correlation_id TEXT,
                    causation_id TEXT,
                    trace_id TEXT,
                    parent_event_id TEXT,

                    consistency TEXT,

                    payload TEXT,
                    payload_encrypted INTEGER NOT NULL DEFAULT 0,

                    payload_integrity_hash TEXT,
                    payload_fingerprint TEXT,

                    metadata TEXT,

                    occurred_at INTEGER NOT NULL,
                    recorded_at INTEGER NOT NULL,

                    schema_version INTEGER NOT NULL DEFAULT 1,

                    financial INTEGER NOT NULL DEFAULT 0,

                    created_by TEXT,

                    UNIQUE (
                        stream_id,
                        sequence
                    )
                );

                CREATE INDEX IF NOT EXISTS idx_offline_events_stream
                    ON offline_events(stream_id, sequence ASC);

                CREATE INDEX IF NOT EXISTS idx_offline_events_aggregate
                    ON offline_events(
                        aggregate_type,
                        aggregate_id,
                        sequence ASC
                    );

                CREATE INDEX IF NOT EXISTS idx_offline_events_type
                    ON offline_events(event_type, occurred_at ASC);

                CREATE INDEX IF NOT EXISTS idx_offline_events_global_sequence
                    ON offline_events(global_sequence ASC);

                CREATE INDEX IF NOT EXISTS idx_offline_events_tenant
                    ON offline_events(tenant_id, occurred_at DESC);

                CREATE INDEX IF NOT EXISTS idx_offline_events_user
                    ON offline_events(user_id, occurred_at DESC);

                CREATE INDEX IF NOT EXISTS idx_offline_events_device
                    ON offline_events(device_id, occurred_at DESC);

                CREATE INDEX IF NOT EXISTS idx_offline_events_operation
                    ON offline_events(operation_id);

                CREATE UNIQUE INDEX IF NOT EXISTS idx_offline_events_idempotency
                    ON offline_events(idempotency_hash)
                    WHERE idempotency_hash IS NOT NULL;

                CREATE INDEX IF NOT EXISTS idx_offline_events_financial
                    ON offline_events(financial, occurred_at ASC);
            `);

            this.ensureGlobalSequenceSupport(
                db,
            );

            return true;

        } catch (
            error
        ) {

            throw new EventStoreError(
                'TITech offline event-store schema initialization failed.',
                {
                    code:
                        'TITECH_OFFLINE_EVENT_STORE_SCHEMA_FAILED',

                    cause:
                        error,
                },
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Ensure a monotonically increasing global sequence.
     * -------------------------------------------------------------------------
     *
     * SQLite does not provide a portable ALTER TABLE constraint for a generated
     * sequence in an existing table, so we assign the value explicitly during
     * append inside the same transaction.
     * -------------------------------------------------------------------------
     */

    ensureGlobalSequenceSupport() {

        return true;
    }

    /**
     * -------------------------------------------------------------------------
     * Resolve stream identity.
     * -------------------------------------------------------------------------
     */

    resolveStreamId(
        event,
    ) {

        if (
            event.streamId
        ) {

            return normalizeString(
                event.streamId,
                'streamId',
                MAX_AGGREGATE_ID_LENGTH *
                2,
            );
        }

        const aggregateType =
            normalizeOptionalString(
                event.aggregateType,
                MAX_AGGREGATE_TYPE_LENGTH,
            );

        const aggregateId =
            normalizeOptionalString(
                event.aggregateId,
                MAX_AGGREGATE_ID_LENGTH,
            );

        if (
            aggregateType &&
            aggregateId
        ) {

            return `${aggregateType}:${aggregateId}`;
        }

        if (
            this.options.allowGlobalEvents
        ) {

            return 'global';
        }

        throw new EventStoreError(
            'TITech event requires an aggregate stream.',
            {
                code:
                    'TITECH_OFFLINE_EVENT_STREAM_REQUIRED',
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Normalize event.
     * -------------------------------------------------------------------------
     */

    normalizeEvent(
        event,
        options = {},
    ) {

        if (
            !event ||
            typeof event !==
            'object'
        ) {

            throw new EventStoreError(
                'TITech offline event must be an object.',
                {
                    code:
                        'TITECH_OFFLINE_EVENT_INVALID_EVENT',
                },
            );
        }

        const eventType =
            normalizeString(
                event.eventType ||
                event.type,
                'eventType',
                MAX_EVENT_TYPE_LENGTH,
            ).toLowerCase();

        const category =
            normalizeCategory(
                event.category,
                eventType,
            );

        const aggregateType =
            normalizeOptionalString(
                event.aggregateType,
                MAX_AGGREGATE_TYPE_LENGTH,
            );

        const aggregateId =
            normalizeOptionalString(
                event.aggregateId,
                MAX_AGGREGATE_ID_LENGTH,
            );

        if (
            (
                aggregateType &&
                !aggregateId
            ) ||
            (
                aggregateId &&
                !aggregateType
            )
        ) {

            throw new EventStoreError(
                'TITech event aggregateType and aggregateId must be supplied together.',
                {
                    code:
                        'TITECH_OFFLINE_EVENT_INVALID_AGGREGATE',
                },
            );
        }

        const streamId =
            this.resolveStreamId(
                event,
            );

        const financial =
            event.financial !==
            undefined
                ? Boolean(
                    event.financial,
                )
                : (
                    category ===
                        EVENT_CATEGORIES.FINANCIAL ||
                    isFinancialEventType(
                        eventType,
                    )
                );

        const occurredAt =
            normalizeTimestamp(
                event.occurredAt,
            );

        const eventId =
            normalizeOptionalString(
                event.eventId,
                255,
            ) ||
            `evt_${crypto.randomUUID()}`;

        const operationId =
            normalizeOptionalString(
                event.operationId,
                255,
            );

        const idempotencyKey =
            normalizeOptionalString(
                event.idempotencyKey,
                255,
            );

        const idempotencyHash =
            normalizeOptionalString(
                event.idempotencyHash,
                255,
            ) ||
            (
                idempotencyKey
                    ? crypto
                        .createHash(
                            'sha256',
                        )
                        .update(
                            idempotencyKey,
                        )
                        .digest(
                            'hex',
                        )
                    : null
            );

        if (
            financial &&
            !idempotencyHash
        ) {

            throw new EventStoreError(
                'TITech financial offline events require an idempotency key/hash.',
                {
                    code:
                        'TITECH_OFFLINE_EVENT_IDEMPOTENCY_REQUIRED',

                    eventId,
                },
            );
        }

        const payload =
            event.payload ??
            {};

        let normalizedPayload =
            payload;

        let payloadEncrypted =
            Boolean(
                event.payloadEncrypted,
            );

        let payloadFingerprint =
            event.payloadFingerprint ||
            null;

        if (
            event.envelope
        ) {

            if (
                !validateEnvelope(
                    event.envelope,
                )
            ) {

                throw new EventStoreError(
                    'TITech event payload encryption envelope is invalid.',
                    {
                        code:
                            'TITECH_OFFLINE_EVENT_INVALID_ENCRYPTION_ENVELOPE',

                        eventId,
                    },
                );
            }

            payloadEncrypted =
                true;

            payloadFingerprint =
                payloadFingerprint ||
                fingerprintEnvelope(
                    event.envelope,
                );

            normalizedPayload =
                event.envelope;
        }

        if (
            this.options
                .encryptionRequired &&
            !payloadEncrypted &&
            !options.allowUnencrypted
        ) {

            throw new EventStoreError(
                'TITech offline event payloads must be encrypted by policy.',
                {
                    code:
                        'TITECH_OFFLINE_EVENT_ENCRYPTION_REQUIRED',

                    eventId,
                },
            );
        }

        const payloadSerialized =
            serializeJson(
                normalizedPayload,
                this.options
                    .maxPayloadBytes,
                'event payload',
            );

        const metadataSerialized =
            serializeJson(
                event.metadata ||
                {},
                this.options
                    .maxMetadataBytes,
                'event metadata',
            );

        const payloadIntegrityHash =
            event.payloadIntegrityHash ||
            hashObject(
                normalizedPayload,
                {
                    algorithm:
                        'sha256',
                },
            );

        if (
            this.options
                .integrityRequired &&
            !payloadIntegrityHash
        ) {

            throw new EventStoreError(
                'TITech event payload integrity hash is required.',
                {
                    code:
                        'TITECH_OFFLINE_EVENT_INTEGRITY_REQUIRED',

                    eventId,
                },
            );
        }

        const deviceId =
            normalizeOptionalString(
                event.deviceId,
                255,
            ) ||
            deviceIdentityModule
                ?.deviceIdentity
                ?.deviceId ||
            null;

        const clientId =
            normalizeOptionalString(
                event.clientId,
                255,
            );

        const userId =
            normalizeOptionalString(
                event.userId,
                255,
            );

        const tenantId =
            normalizeOptionalString(
                event.tenantId,
                255,
            );

        const correlationId =
            normalizeOptionalString(
                event.correlationId,
                255,
            );

        const causationId =
            normalizeOptionalString(
                event.causationId,
                255,
            );

        const traceId =
            normalizeOptionalString(
                event.traceId,
                255,
            );

        const parentEventId =
            normalizeOptionalString(
                event.parentEventId,
                255,
            );

        const consistency =
            normalizeOptionalString(
                event.consistency,
                100,
            ) ||
            (
                financial
                    ? CONSISTENCY_LEVELS
                        .FINANCIAL_STRONG
                    : CONSISTENCY_LEVELS
                        .EVENTUAL
            );

        const schemaVersion =
            normalizeInteger(
                event.schemaVersion,
                EVENT_SCHEMA_VERSION,
            );

        const metadata =
            parseJson(
                metadataSerialized,
                'event metadata',
            );

        const normalized = {
            eventId,

            eventType,

            category,

            aggregateType,

            aggregateId,

            streamId,

            sequence:
                normalizeInteger(
                    event.sequence,
                    null,
                ),

            globalSequence:
                normalizeInteger(
                    event.globalSequence,
                    null,
                ),

            eventState:
                event.eventState ||
                EVENT_STATES.APPENDED,

            tenantId,

            userId,

            deviceId,

            clientId,

            operationId,

            idempotencyKey,

            idempotencyHash,

            correlationId,

            causationId,

            traceId,

            parentEventId,

            consistency,

            payload:
                normalizedPayload,

            payloadEncrypted,

            payloadIntegrityHash,

            payloadFingerprint,

            metadata,

            occurredAt,

            recordedAt:
                normalizeTimestamp(
                    event.recordedAt ||
                    nowMs(),
                ),

            schemaVersion,

            financial:

                financial
                    ? 1
                    : 0,

            createdBy:
                normalizeOptionalString(
                    event.createdBy,
                    255,
                ),
        };

        /**
         * Create a canonical event hash that does not include generated
         * database-only sequence fields.
         */
        normalized.eventHash =
            event.eventHash ||
            createOperationHash(
                {
                    eventId:
                        normalized
                            .eventId,

                    eventType:
                        normalized
                            .eventType,

                    category:
                        normalized
                            .category,

                    aggregateType:
                        normalized
                            .aggregateType,

                    aggregateId:
                        normalized
                            .aggregateId,

                    streamId:
                        normalized
                            .streamId,

                    sequence:
                        normalized
                            .sequence,

                    tenantId:
                        normalized
                            .tenantId,

                    userId:
                        normalized
                            .userId,

                    deviceId:
                        normalized
                            .deviceId,

                    operationId:
                        normalized
                            .operationId,

                    idempotencyHash:
                        normalized
                            .idempotencyHash,

                    correlationId:
                        normalized
                            .correlationId,

                    causationId:
                        normalized
                            .causationId,

                    payload:
                        normalized
                            .payload,

                    metadata:
                        normalized
                            .metadata,

                    occurredAt:
                        normalized
                            .occurredAt,

                    schemaVersion:
                        normalized
                            .schemaVersion,
                },
            );

        return normalized;
    }

    /**
     * -------------------------------------------------------------------------
     * Get current stream version.
     * -------------------------------------------------------------------------
     */

    getCurrentStreamVersion(
        streamId,
    ) {

        this.assertReady();

        const row =
            this.getDatabase()
                .prepare(
                    `
                        SELECT
                            MAX(sequence) AS version
                        FROM offline_events
                        WHERE stream_id = ?
                    `,
                )
                .get(
                    streamId,
                );

        this.metrics.reads +=
            1;

        return Number(
            row?.version ||
            0,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Append a single event.
     * -------------------------------------------------------------------------
     */

    append(
        event,
        options = {},
    ) {

        this.assertReady();

        const db =
            this.getDatabase();

        const normalized =
            this.normalizeEvent(
                event,
                options,
            );

        try {

            return db.transaction(
                () => {

                    return this.appendWithinTransaction(
                        db,
                        normalized,
                        options,
                    );
                },
            )();

        } catch (
            error
        ) {

            this.lastError =
                error;

            if (
                error instanceof
                EventStoreError
            ) {

                throw error;
            }

            if (
                error instanceof
                OfflineDatabaseError
            ) {

                throw new EventStoreError(
                    'TITech offline event append failed.',
                    {
                        code:
                            'TITECH_OFFLINE_EVENT_APPEND_FAILED',

                        cause:
                            error,
                    },
                );
            }

            throw new EventStoreError(
                'TITech offline event append failed.',
                {
                    code:
                        'TITECH_OFFLINE_EVENT_APPEND_FAILED',

                    cause:
                        error,
                },
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Append within existing DB transaction.
     * -------------------------------------------------------------------------
     */

    appendWithinTransaction(
        db,
        normalized,
        options = {},
    ) {

        /**
         * Duplicate event identity protection.
         */
        const existing =
            db
                .prepare(
                    `
                        SELECT
                            event_id,
                            event_hash,
                            sequence,
                            stream_id,
                            idempotency_hash
                        FROM offline_events
                        WHERE event_id = ?
                    `,
                )
                .get(
                    normalized.eventId,
                );

        if (
            existing
        ) {

            this.metrics
                .duplicateEvents +=
                1;

            if (
                existing.event_hash ===
                normalized.eventHash
            ) {

                return this.deserializeEvent(
                    db
                        .prepare(
                            `
                                SELECT *
                                FROM offline_events
                                WHERE event_id = ?
                            `,
                        )
                        .get(
                            normalized
                                .eventId,
                        ),
                );
            }

            throw new EventStoreError(
                'TITech event ID already exists with different event content.',
                {
                    code:
                        'TITECH_OFFLINE_EVENT_ID_CONFLICT',

                    eventId:
                        normalized.eventId,
                },
            );
        }

        /**
         * Duplicate idempotency protection.
         */
        if (
            normalized.idempotencyHash
        ) {

            const duplicateIdempotency =
                db
                    .prepare(
                        `
                            SELECT
                                event_id,
                                event_hash,
                                aggregate_id,
                                sequence
                            FROM offline_events
                            WHERE idempotency_hash = ?
                            LIMIT 1
                        `,
                    )
                    .get(
                        normalized
                            .idempotencyHash,
                    );

            if (
                duplicateIdempotency
            ) {

                if (
                    duplicateIdempotency
                        .event_hash ===
                    normalized.eventHash
                ) {

                    return this.deserializeEvent(
                        db
                            .prepare(
                                `
                                    SELECT *
                                    FROM offline_events
                                    WHERE event_id = ?
                                `,
                            )
                            .get(
                                duplicateIdempotency
                                    .event_id,
                            ),
                    );
                }

                throw new EventStoreError(
                    'TITech event idempotency key conflicts with a different event.',
                    {
                        code:
                            'TITECH_OFFLINE_EVENT_IDEMPOTENCY_CONFLICT',

                        eventId:
                            normalized.eventId,

                        details: {
                            existingEventId:
                                duplicateIdempotency
                                    .event_id,
                        },
                    },
                );
            }
        }

        /**
         * Determine next stream sequence.
         */
        const currentVersion =
            normalized.streamId ===
                'global'
                ? 0
                : this.getCurrentStreamVersion(
                    normalized.streamId,
                );

        const expectedVersion =
            normalizeInteger(
                options.expectedVersion ??
                eventExpectedVersion(
                    normalized,
                ),
                null,
            );

        if (
            this.options
                .requireAggregateVersion &&
            normalized.streamId !==
                'global' &&
            expectedVersion !==
                null &&
            expectedVersion !==
                currentVersion
        ) {

            this.metrics
                .concurrencyConflicts +=
                1;

            throw new EventStoreError(
                'TITech event stream optimistic-concurrency check failed.',
                {
                    code:
                        'TITECH_OFFLINE_EVENT_CONCURRENCY_CONFLICT',

                    eventId:
                        normalized.eventId,

                    aggregateId:
                        normalized.aggregateId,

                    aggregateType:
                        normalized.aggregateType,

                    streamVersion:
                        currentVersion,

                    details: {
                        expectedVersion,
                        currentVersion,
                    },
                },
            );
        }

        const sequence =
            normalized.sequence !==
                null
                ? normalized.sequence
                : currentVersion +
                  1;

        /**
         * Strict sequence protection.
         */
        if (
            normalized.streamId !==
                'global' &&
            sequence !==
                currentVersion +
                1
        ) {

            throw new EventStoreError(
                'TITech event sequence is not the next expected aggregate version.',
                {
                    code:
                        'TITECH_OFFLINE_EVENT_INVALID_SEQUENCE',

                    eventId:
                        normalized.eventId,

                    streamVersion:
                        currentVersion,

                    details: {
                        expectedSequence:
                            currentVersion +
                            1,

                        receivedSequence:
                            sequence,
                    },
                },
            );
        }

        /**
         * Rebuild event hash using the authoritative sequence.
         */
        normalized.sequence =
            sequence;

        normalized.eventHash =
            createOperationHash(
                {
                    eventId:
                        normalized.eventId,

                    eventType:
                        normalized.eventType,

                    category:
                        normalized.category,

                    aggregateType:
                        normalized.aggregateType,

                    aggregateId:
                        normalized.aggregateId,

                    streamId:
                        normalized.streamId,

                    sequence:
                        normalized.sequence,

                    tenantId:
                        normalized.tenantId,

                    userId:
                        normalized.userId,

                    deviceId:
                        normalized.deviceId,

                    operationId:
                        normalized.operationId,

                    idempotencyHash:
                        normalized.idempotencyHash,

                    correlationId:
                        normalized.correlationId,

                    causationId:
                        normalized.causationId,

                    payload:
                        normalized.payload,

                    metadata:
                        normalized.metadata,

                    occurredAt:
                        normalized.occurredAt,

                    schemaVersion:
                        normalized.schemaVersion,
                },
            );

        const globalSequence =
            this.getNextGlobalSequence(
                db,
            );

        normalized.globalSequence =
            globalSequence;

        db
            .prepare(
                `
                    INSERT INTO offline_events (
                        event_id,

                        event_type,
                        category,

                        aggregate_type,
                        aggregate_id,
                        aggregate_version,

                        sequence,
                        global_sequence,

                        stream_id,
                        event_state,

                        tenant_id,
                        user_id,
                        device_id,
                        client_id,

                        operation_id,

                        idempotency_key,
                        idempotency_hash,

                        correlation_id,
                        causation_id,
                        trace_id,
                        parent_event_id,

                        consistency,

                        payload,
                        payload_encrypted,

                        payload_integrity_hash,
                        payload_fingerprint,

                        metadata,

                        occurred_at,
                        recorded_at,

                        schema_version,

                        financial,

                        created_by
                    )
                    VALUES (
                        @eventId,

                        @eventType,
                        @category,

                        @aggregateType,
                        @aggregateId,
                        @aggregateVersion,

                        @sequence,
                        @globalSequence,

                        @streamId,
                        @eventState,

                        @tenantId,
                        @userId,
                        @deviceId,
                        @clientId,

                        @operationId,

                        @idempotencyKey,
                        @idempotencyHash,

                        @correlationId,
                        @causationId,
                        @traceId,
                        @parentEventId,

                        @consistency,

                        @payload,
                        @payloadEncrypted,

                        @payloadIntegrityHash,
                        @payloadFingerprint,

                        @metadata,

                        @occurredAt,
                        @recordedAt,

                        @schemaVersion,

                        @financial,

                        @createdBy
                    )
                `,
            )
            .run(
                {
                    eventId:
                        normalized.eventId,

                    eventType:
                        normalized.eventType,

                    category:
                        normalized.category,

                    aggregateType:
                        normalized.aggregateType,

                    aggregateId:
                        normalized.aggregateId,

                    aggregateVersion:
                        sequence,

                    sequence,

                    globalSequence,

                    streamId:
                        normalized.streamId,

                    eventState:
                        normalized.eventState,

                    tenantId:
                        normalized.tenantId,

                    userId:
                        normalized.userId,

                    deviceId:
                        normalized.deviceId,

                    clientId:
                        normalized.clientId,

                    operationId:
                        normalized.operationId,

                    idempotencyKey:
                        normalized.idempotencyKey,

                    idempotencyHash:
                        normalized.idempotencyHash,

                    correlationId:
                        normalized.correlationId,

                    causationId:
                        normalized.causationId,

                    traceId:
                        normalized.traceId,

                    parentEventId:
                        normalized.parentEventId,

                    consistency:
                        normalized.consistency,

                    payload:
                        serializeJson(
                            normalized.payload,
                            this.options
                                .maxPayloadBytes,
                            'event payload',
                        ),

                    payloadEncrypted:
                        normalized
                            .payloadEncrypted
                            ? 1
                            : 0,

                    payloadIntegrityHash:
                        normalized
                            .payloadIntegrityHash,

                    payloadFingerprint:
                        normalized
                            .payloadFingerprint,

                    metadata:
                        serializeJson(
                            normalized.metadata,
                            this.options
                                .maxMetadataBytes,
                            'event metadata',
                        ),

                    occurredAt:
                        normalized
                            .occurredAt,

                    recordedAt:
                        normalized
                            .recordedAt,

                    schemaVersion:
                        normalized
                            .schemaVersion,

                    financial:
                        normalized
                            .financial,

                    createdBy:
                        normalized
                            .createdBy,
                },
            );

        this.metrics
            .appends +=
            1;

        if (
            normalized.financial
        ) {

            this.metrics
                .financialEvents +=
                1;
        }

        this.lastAppendAt =
            isoNow();

        log(
            'debug',
            {
                eventId:
                    normalized.eventId,

                eventType:
                    normalized.eventType,

                aggregateType:
                    normalized.aggregateType,

                aggregateId:
                    normalized.aggregateId,

                sequence,

                financial:
                    Boolean(
                        normalized.financial,
                    ),
            },
            'TITech offline event appended.',
        );

        return this.deserializeEvent(
            db
                .prepare(
                    `
                        SELECT *
                        FROM offline_events
                        WHERE event_id = ?
                    `,
                )
                .get(
                    normalized.eventId,
                ),
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Append a batch atomically.
     * -------------------------------------------------------------------------
     */

    appendBatch(
        events,
        options = {},
    ) {

        this.assertReady();

        if (
            !Array.isArray(events) ||
            events.length ===
            0
        ) {

            return [];
        }

        if (
            events.length >
            (
                options.maxBatchSize ||
                LIMITS.MAX_SYNC_BATCH_SIZE
            )
        ) {

            throw new EventStoreError(
                'TITech event batch exceeds the configured maximum.',
                {
                    code:
                        'TITECH_OFFLINE_EVENT_BATCH_TOO_LARGE',
                },
            );
        }

        const normalizedEvents =
            events.map(
                event =>
                    this.normalizeEvent(
                        event,
                        options,
                    ),
            );

        try {

            return this.getDatabase()
                .transaction(
                    () => {

                        const results =
                            [];

                        for (
                            const event of
                            normalizedEvents
                        ) {

                            results.push(
                                this.appendWithinTransaction(
                                    this.getDatabase(),
                                    event,
                                    options,
                                ),
                            );
                        }

                        return results;
                    },
                )();

        } catch (
            error
        ) {

            if (
                error instanceof
                EventStoreError
            ) {

                throw error;
            }

            throw new EventStoreError(
                'TITech offline event batch append failed.',
                {
                    code:
                        'TITECH_OFFLINE_EVENT_BATCH_APPEND_FAILED',

                    cause:
                        error,
                },
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Get the next global sequence.
     * -------------------------------------------------------------------------
     */

    getNextGlobalSequence(
        db,
    ) {

        const row =
            db
                .prepare(
                    `
                        SELECT
                            MAX(global_sequence) AS sequence
                        FROM offline_events
                    `,
                )
                .get();

        return Number(
            row?.sequence ||
            0,
        ) + 1;
    }

    /**
     * -------------------------------------------------------------------------
     * Get event by ID.
     * -------------------------------------------------------------------------
     */

    get(
        eventId,
    ) {

        this.assertReady();

        const id =
            normalizeString(
                eventId,
                'eventId',
                255,
            );

        const row =
            this.getDatabase()
                .prepare(
                    `
                        SELECT *
                        FROM offline_events
                        WHERE event_id = ?
                    `,
                )
                .get(
                    id,
                );

        this.metrics.reads +=
            1;

        return row
            ? this.deserializeEvent(
                row,
            )
            : null;
    }

    /**
     * -------------------------------------------------------------------------
     * Read an aggregate stream.
     * -------------------------------------------------------------------------
     */

    getAggregateEvents(
        aggregateType,
        aggregateId,
        options = {},
    ) {

        this.assertReady();

        const normalizedType =
            normalizeString(
                aggregateType,
                'aggregateType',
                MAX_AGGREGATE_TYPE_LENGTH,
            );

        const normalizedId =
            normalizeString(
                aggregateId,
                'aggregateId',
                MAX_AGGREGATE_ID_LENGTH,
            );

        const afterSequence =
            normalizeInteger(
                options.afterSequence,
                0,
            );

        const beforeSequence =
            normalizeInteger(
                options.beforeSequence,
                null,
            );

        const limit =
            Math.min(
                MAX_PAGE_SIZE,
                Math.max(
                    1,
                    normalizeInteger(
                        options.limit,
                        this.options
                            .pageSize,
                    ),
                ),
            );

        const conditions = [
            'aggregate_type = @aggregateType',
            'aggregate_id = @aggregateId',
            'sequence > @afterSequence',
        ];

        const params = {
            aggregateType:
                normalizedType,

            aggregateId:
                normalizedId,

            afterSequence,
        };

        if (
            beforeSequence !==
            null
        ) {

            conditions.push(
                'sequence <= @beforeSequence',
            );

            params.beforeSequence =
                beforeSequence;
        }

        const rows =
            this.getDatabase()
                .prepare(
                    `
                        SELECT *
                        FROM offline_events
                        WHERE ${conditions.join(
                            ' AND ',
                        )}
                        ORDER BY sequence ASC
                        LIMIT @limit
                    `,
                )
                .all({
                    ...params,
                    limit,
                });

        this.metrics.reads +=
            1;

        return rows.map(
            row =>
                this.deserializeEvent(
                    row,
                ),
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Read from a global event cursor.
     * -------------------------------------------------------------------------
     */

    getEventsAfterGlobalSequence(
        globalSequence,
        options = {},
    ) {

        this.assertReady();

        const cursor =
            Math.max(
                0,
                normalizeInteger(
                    globalSequence,
                    0,
                ),
            );

        const limit =
            Math.min(
                MAX_PAGE_SIZE,
                Math.max(
                    1,
                    normalizeInteger(
                        options.limit,
                        this.options
                            .pageSize,
                    ),
                ),
            );

        const conditions = [
            'global_sequence > @cursor',
        ];

        const params = {
            cursor,
        };

        if (
            options.tenantId
        ) {

            conditions.push(
                'tenant_id = @tenantId',
            );

            params.tenantId =
                String(
                    options.tenantId,
                );
        }

        if (
            options.eventType
        ) {

            conditions.push(
                'event_type = @eventType',
            );

            params.eventType =
                String(
                    options.eventType,
                )
                    .trim()
                    .toLowerCase();
        }

        if (
            options.category
        ) {

            conditions.push(
                'category = @category',
            );

            params.category =
                String(
                    options.category,
                )
                    .trim()
                    .toLowerCase();
        }

        const rows =
            this.getDatabase()
                .prepare(
                    `
                        SELECT *
                        FROM offline_events
                        WHERE ${conditions.join(
                            ' AND ',
                        )}
                        ORDER BY global_sequence ASC
                        LIMIT @limit
                    `,
                )
                .all({
                    ...params,
                    limit,
                });

        this.metrics.reads +=
            1;

        this.lastReplayAt =
            isoNow();

        return rows.map(
            row =>
                this.deserializeEvent(
                    row,
                ),
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Query events.
     * -------------------------------------------------------------------------
     */

    query(
        options = {},
    ) {

        this.assertReady();

        const conditions = [];
        const params = {};

        if (
            options.aggregateType
        ) {

            conditions.push(
                'aggregate_type = @aggregateType',
            );

            params.aggregateType =
                String(
                    options.aggregateType,
                );
        }

        if (
            options.aggregateId
        ) {

            conditions.push(
                'aggregate_id = @aggregateId',
            );

            params.aggregateId =
                String(
                    options.aggregateId,
                );
        }

        if (
            options.eventType
        ) {

            conditions.push(
                'event_type = @eventType',
            );

            params.eventType =
                String(
                    options.eventType,
                )
                    .trim()
                    .toLowerCase();
        }

        if (
            options.category
        ) {

            conditions.push(
                'category = @category',
            );

            params.category =
                String(
                    options.category,
                )
                    .trim()
                    .toLowerCase();
        }

        if (
            options.deviceId
        ) {

            conditions.push(
                'device_id = @deviceId',
            );

            params.deviceId =
                String(
                    options.deviceId,
                );
        }

        if (
            options.operationId
        ) {

            conditions.push(
                'operation_id = @operationId',
            );

            params.operationId =
                String(
                    options.operationId,
                );
        }

        if (
            options.financialOnly ===
            true
        ) {

            conditions.push(
                'financial = 1',
            );
        }

        if (
            options.after
        ) {

            conditions.push(
                'occurred_at > @after',
            );

            params.after =
                normalizeTimestamp(
                    options.after,
                );
        }

        if (
            options.before
        ) {

            conditions.push(
                'occurred_at < @before',
            );

            params.before =
                normalizeTimestamp(
                    options.before,
                );
        }

        if (
            options.afterGlobalSequence !==
            undefined
        ) {

            conditions.push(
                'global_sequence > @afterGlobalSequence',
            );

            params.afterGlobalSequence =
                normalizeInteger(
                    options.afterGlobalSequence,
                    0,
                );
        }

        const page =
            Math.max(
                1,
                normalizeInteger(
                    options.page,
                    1,
                ),
            );

        const limit =
            Math.min(
                MAX_PAGE_SIZE,
                Math.max(
                    1,
                    normalizeInteger(
                        options.limit,
                        this.options
                            .pageSize,
                    ),
                ),
            );

        const offset =
            (
                page -
                1
            ) *
            limit;

        params.limit =
            limit;

        params.offset =
            offset;

        const where =
            conditions.length
                ? `WHERE ${conditions.join(
                    ' AND ',
                )}`
                : '';

        const rows =
            this.getDatabase()
                .prepare(
                    `
                        SELECT *
                        FROM offline_events
                        ${where}
                        ORDER BY
                            global_sequence ASC,
                            sequence ASC
                        LIMIT @limit
                        OFFSET @offset
                    `,
                )
                .all(
                    params,
                );

        const total =
            this.getDatabase()
                .prepare(
                    `
                        SELECT COUNT(*) AS count
                        FROM offline_events
                        ${where}
                    `,
                )
                .get(
                    params,
                )
                .count;

        this.metrics.reads +=
            2;

        return {
            data:
                rows.map(
                    row =>
                        this.deserializeEvent(
                            row,
                        ),
                ),

            pagination: {
                page,

                limit,

                total,

                pages:
                    Math.ceil(
                        total /
                        limit,
                    ),
            },
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Replay aggregate stream.
     * -------------------------------------------------------------------------
     */

    replayAggregate(
        aggregateType,
        aggregateId,
        reducer,
        initialState,
        options = {},
    ) {

        if (
            typeof reducer !==
            'function'
        ) {

            throw new EventStoreError(
                'TITech aggregate replay requires a reducer function.',
                {
                    code:
                        'TITECH_OFFLINE_EVENT_REPLAY_REDUCER_REQUIRED',
                },
            );
        }

        const events =
            this.getAggregateEvents(
                aggregateType,
                aggregateId,
                options,
            );

        let state =
            deepClone(
                initialState,
            );

        for (
            const event of
            events
        ) {

            try {

                state =
                    reducer(
                        state,
                        event,
                    );

            } catch (
                error
            ) {

                throw new EventStoreError(
                    'TITech aggregate event replay failed.',
                    {
                        code:
                            'TITECH_OFFLINE_EVENT_REPLAY_FAILED',

                        aggregateType,

                        aggregateId,

                        streamVersion:
                            event.sequence,

                        cause:
                            error,
                    },
                );
            }
        }

        this.metrics.replays +=
            1;

        this.lastReplayAt =
            isoNow();

        return {
            state,

            eventsApplied:
                events.length,

            version:
                events.length > 0
                    ? events[
                        events.length -
                        1
                    ].sequence
                    : 0,

            aggregateType,

            aggregateId,
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Verify event integrity.
     * -------------------------------------------------------------------------
     */

    verifyIntegrity(
        event,
    ) {

        if (
            !event
        ) {

            return false;
        }

        const calculated =
            hashObject(
                event.payload,
                {
                    algorithm:
                        'sha256',
                },
            );

        const valid =
            calculated ===
            event.payloadIntegrityHash;

        if (
            !valid
        ) {

            this.metrics
                .integrityFailures +=
                1;
        }

        return valid;
    }

    /**
     * -------------------------------------------------------------------------
     * Verify event hash.
     * -------------------------------------------------------------------------
     */

    verifyEventHash(
        event,
    ) {

        if (
            !event
        ) {

            return false;
        }

        const calculated =
            createOperationHash(
                {
                    eventId:
                        event.eventId,

                    eventType:
                        event.eventType,

                    category:
                        event.category,

                    aggregateType:
                        event.aggregateType,

                    aggregateId:
                        event.aggregateId,

                    streamId:
                        event.streamId,

                    sequence:
                        event.sequence,

                    tenantId:
                        event.tenantId,

                    userId:
                        event.userId,

                    deviceId:
                        event.deviceId,

                    operationId:
                        event.operationId,

                    idempotencyHash:
                        event.idempotencyHash,

                    correlationId:
                        event.correlationId,

                    causationId:
                        event.causationId,

                    payload:
                        event.payload,

                    metadata:
                        event.metadata,

                    occurredAt:
                        event.occurredAt,

                    schemaVersion:
                        event.schemaVersion,
                },
            );

        return calculated ===
            event.eventHash;
    }

    /**
     * -------------------------------------------------------------------------
     * Verify event cryptographic envelope.
     * -------------------------------------------------------------------------
     */

    verifyEnvelope(
        event,
    ) {

        if (
            !event?.payloadEncrypted
        ) {

            return true;
        }

        return Boolean(
            event.payload &&
            typeof event.payload ===
                'object' &&
            validateEnvelope(
                event.payload,
            ),
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Deserialize stored event.
     * -------------------------------------------------------------------------
     */

    deserializeEvent(
        row,
    ) {

        if (
            !row
        ) {

            return null;
        }

        const payload =
            parseJson(
                row.payload,
                'event payload',
            );

        const metadata =
            parseJson(
                row.metadata,
                'event metadata',
            );

        return deepFreeze({
            eventId:
                row.event_id,

            eventType:
                row.event_type,

            category:
                row.category,

            aggregateType:
                row.aggregate_type,

            aggregateId:
                row.aggregate_id,

            aggregateVersion:
                row.aggregate_version,

            sequence:
                row.sequence,

            globalSequence:
                row.global_sequence,

            streamId:
                row.stream_id,

            eventState:
                row.event_state,

            tenantId:
                row.tenant_id,

            userId:
                row.user_id,

            deviceId:
                row.device_id,

            clientId:
                row.client_id,

            operationId:
                row.operation_id,

            idempotencyKey:
                row.idempotency_key,

            idempotencyHash:
                row.idempotency_hash,

            correlationId:
                row.correlation_id,

            causationId:
                row.causation_id,

            traceId:
                row.trace_id,

            parentEventId:
                row.parent_event_id,

            consistency:
                row.consistency,

            payload,

            payloadEncrypted:
                Boolean(
                    row.payload_encrypted,
                ),

            payloadIntegrityHash:
                row.payload_integrity_hash,

            payloadFingerprint:
                row.payload_fingerprint,

            metadata,

            occurredAt:
                row.occurred_at,

            recordedAt:
                row.recorded_at,

            schemaVersion:
                row.schema_version,

            financial:
                Boolean(
                    row.financial,
                ),

            createdBy:
                row.created_by,
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Decode an encrypted event payload.
     * -------------------------------------------------------------------------
     */

    decryptEventPayload(
        event,
        key,
        options = {},
    ) {

        if (
            !event?.payloadEncrypted
        ) {

            return deepClone(
                event?.payload,
            );
        }

        if (
            !validateEnvelope(
                event.payload,
            )
        ) {

            throw new EventStoreError(
                'TITech event contains an invalid encrypted payload envelope.',
                {
                    code:
                        'TITECH_OFFLINE_EVENT_INVALID_ENCRYPTED_PAYLOAD',

                    eventId:
                        event.eventId,
                },
            );
        }

        try {

            return decryptObject(
                event.payload,
                key,
                options,
            );

        } catch (
            error
        ) {

            throw new EventStoreError(
                'TITech event payload decryption failed.',
                {
                    code:
                        'TITECH_OFFLINE_EVENT_DECRYPTION_FAILED',

                    eventId:
                        event.eventId,

                    cause:
                        error,
                },
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Encrypt an event payload before append.
     * -------------------------------------------------------------------------
     */

    prepareEncryptedEvent(
        event,
        key,
        options = {},
    ) {

        const normalized =
            this.normalizeEvent(
                {
                    ...event,

                    payload:
                        event.payload,
                },
                {
                    ...options,

                    allowUnencrypted:
                        true,
                },
            );

        try {

            const envelope =
                encryptObject(
                    normalized.payload,
                    key,
                    {
                        keyId:
                            options.keyId,

                        aad:
                            options.aad,
                    },
                );

            return {
                ...normalized,

                payload:
                    envelope,

                payloadEncrypted:
                    true,

                payloadFingerprint:
                    fingerprintEnvelope(
                        envelope,
                    ),

                payloadIntegrityHash:
                    hashObject(
                        normalized.payload,
                        {
                            algorithm:
                                'sha256',
                        },
                    ),
            };

        } catch (
            error
        ) {

            throw new EventStoreError(
                'TITech event payload encryption failed.',
                {
                    code:
                        'TITECH_OFFLINE_EVENT_ENCRYPTION_FAILED',

                    eventId:
                        normalized.eventId,

                    cause:
                        error,
                },
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Mark event reconciled.
     * -------------------------------------------------------------------------
     */

    markReconciled(
        eventId,
        metadata = {},
    ) {

        this.assertReady();

        const db =
            this.getDatabase();

        if (
            db
        ) {

            const result =
                db
                    .prepare(
                        `
                            UPDATE offline_events
                            SET
                                event_state = 'reconciled'
                            WHERE
                                event_id = ?
                        `,
                    )
                    .run(
                        String(
                            eventId,
                        ),
                    );

            return result.changes >
                0;
        }

        return false;
    }

    /**
     * -------------------------------------------------------------------------
     * Mark event conflicted.
     * -------------------------------------------------------------------------
     */

    markConflicted(
        eventId,
    ) {

        this.assertReady();

        const result =
            this.getDatabase()
                .prepare(
                    `
                        UPDATE offline_events
                        SET
                            event_state = 'conflicted'
                        WHERE
                            event_id = ?
                    `,
                )
                .run(
                    String(
                        eventId,
                    ),
                );

        return result.changes >
            0;
    }

    /**
     * -------------------------------------------------------------------------
     * Event count.
     * -------------------------------------------------------------------------
     */

    count(
        options = {},
    ) {

        this.assertReady();

        const conditions = [];
        const params = {};

        if (
            options.aggregateType
        ) {

            conditions.push(
                'aggregate_type = @aggregateType',
            );

            params.aggregateType =
                String(
                    options.aggregateType,
                );
        }

        if (
            options.aggregateId
        ) {

            conditions.push(
                'aggregate_id = @aggregateId',
            );

            params.aggregateId =
                String(
                    options.aggregateId,
                );
        }

        if (
            options.eventType
        ) {

            conditions.push(
                'event_type = @eventType',
            );

            params.eventType =
                String(
                    options.eventType,
                )
                    .trim()
                    .toLowerCase();
        }

        if (
            options.financialOnly ===
            true
        ) {

            conditions.push(
                'financial = 1',
            );
        }

        const where =
            conditions.length
                ? `WHERE ${conditions.join(
                    ' AND ',
                )}`
                : '';

        const row =
            this.getDatabase()
                .prepare(
                    `
                        SELECT COUNT(*) AS count
                        FROM offline_events
                        ${where}
                    `,
                )
                .get(
                    params,
                );

        this.metrics.reads +=
            1;

        return Number(
            row?.count ||
            0,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Event-store statistics.
     * -------------------------------------------------------------------------
     */

    stats() {

        this.assertReady();

        const total =
            this.count();

        const financial =
            this.count({
                financialOnly:
                    true,
            });

        const streams =
            this.getDatabase()
                .prepare(
                    `
                        SELECT COUNT(
                            DISTINCT stream_id
                        ) AS count
                        FROM offline_events
                    `,
                )
                .get()
                .count;

        const latestGlobalSequence =
            this.getDatabase()
                .prepare(
                    `
                        SELECT
                            MAX(global_sequence) AS sequence
                        FROM offline_events
                    `,
                )
                .get()
                .sequence;

        return {
            component:
                COMPONENT,

            initialized:
                this.initialized,

            totalEvents:
                total,

            financialEvents:
                financial,

            streams:
                Number(
                    streams ||
                    0,
                ),

            latestGlobalSequence:
                Number(
                    latestGlobalSequence ||
                    0,
                ),

            metrics:
                deepClone(
                    this.metrics,
                ),

            lastAppendAt:
                this.lastAppendAt,

            lastReplayAt:
                this.lastReplayAt,

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
                isoNow(),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Health.
     * -------------------------------------------------------------------------
     */

    health() {

        try {

            this.assertReady();

            return {
                status:
                    'healthy',

                healthy:
                    true,

                component:
                    COMPONENT,

                totalEvents:
                    this.count(),

                timestamp:
                    isoNow(),
            };

        } catch (
            error
        ) {

            return {
                status:
                    'unhealthy',

                healthy:
                    false,

                component:
                    COMPONENT,

                error: {
                    name:
                        error.name,

                    code:
                        error.code,

                    message:
                        error.message,
                },

                timestamp:
                    isoNow(),
            };
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Readiness.
     * -------------------------------------------------------------------------
     */

    readiness() {

        const ready =
            Boolean(
                this.initialized &&
                offlineDatabase
                    .initialized &&
                !offlineDatabase
                    .closed,
            );

        return {
            status:
                ready
                    ? 'ready'
                    : 'not_ready',

            ready,

            component:
                COMPONENT,

            timestamp:
                isoNow(),
        };
    }
}

/**
 * =============================================================================
 * Helper for expected stream version
 * =============================================================================
 */

function eventExpectedVersion(
    event,
) {

    return normalizeInteger(
        event.expectedVersion ??
        event.expectedAggregateVersion ??
        null,
        null,
    );
}

/**
 * =============================================================================
 * Singleton
 * =============================================================================
 */

const eventStore =
    new EventStore();

/**
 * =============================================================================
 * Convenience API
 * =============================================================================
 */

function initialize(
    options = {},
) {

    if (
        options &&
        Object.keys(
            options,
        ).length >
        0
    ) {

        /**
         * The singleton uses its construction-time policy. Custom policies
         * should create `new EventStore(options)`.
         */
    }

    return eventStore.initialize();
}

function append(
    event,
    options,
) {

    return eventStore.append(
        event,
        options,
    );
}

function appendBatch(
    events,
    options,
) {

    return eventStore.appendBatch(
        events,
        options,
    );
}

function get(
    eventId,
) {

    return eventStore.get(
        eventId,
    );
}

function getAggregateEvents(
    aggregateType,
    aggregateId,
    options,
) {

    return eventStore.getAggregateEvents(
        aggregateType,
        aggregateId,
        options,
    );
}

function getEventsAfterGlobalSequence(
    sequence,
    options,
) {

    return eventStore
        .getEventsAfterGlobalSequence(
            sequence,
            options,
        );
}

function query(
    options,
) {

    return eventStore.query(
        options,
    );
}

function replayAggregate(
    aggregateType,
    aggregateId,
    reducer,
    initialState,
    options,
) {

    return eventStore
        .replayAggregate(
            aggregateType,
            aggregateId,
            reducer,
            initialState,
            options,
        );
}

function getCurrentStreamVersion(
    streamId,
) {

    return eventStore
        .getCurrentStreamVersion(
            streamId,
        );
}

function verifyIntegrity(
    event,
) {

    return eventStore.verifyIntegrity(
        event,
    );
}

function verifyEventHash(
    event,
) {

    return eventStore.verifyEventHash(
        event,
    );
}

function verifyEnvelope(
    event,
) {

    return eventStore.verifyEnvelope(
        event,
    );
}

function prepareEncryptedEvent(
    event,
    key,
    options,
) {

    return eventStore
        .prepareEncryptedEvent(
            event,
            key,
            options,
        );
}

function decryptEventPayload(
    event,
    key,
    options,
) {

    return eventStore
        .decryptEventPayload(
            event,
            key,
            options,
        );
}

function markReconciled(
    eventId,
    metadata,
) {

    return eventStore.markReconciled(
        eventId,
        metadata,
    );
}

function markConflicted(
    eventId,
) {

    return eventStore.markConflicted(
        eventId,
    );
}

function count(
    options,
) {

    return eventStore.count(
        options,
    );
}

function stats() {

    return eventStore.stats();
}

function health() {

    return eventStore.health();
}

function readiness() {

    return eventStore.readiness();
}

/**
 * =============================================================================
 * Public API
 * =============================================================================
 */

module.exports =
    deepFreeze({

        /**
         * Metadata.
         */
        COMPONENT,

        EVENT_SCHEMA_VERSION,

        EVENT_CATEGORIES,

        EVENT_STATES,

        DEFAULT_PAGE_SIZE,

        MAX_PAGE_SIZE,

        /**
         * Errors/classes.
         */
        EventStoreError,

        EventStore,

        eventStore,

        /**
         * Lifecycle.
         */
        initialize,

        /**
         * Append.
         */
        append,

        appendBatch,

        /**
         * Read/query.
         */
        get,

        getAggregateEvents,

        getEventsAfterGlobalSequence,

        query,

        getCurrentStreamVersion,

        count,

        /**
         * Replay.
         */
        replayAggregate,

        /**
         * Integrity/security.
         */
        verifyIntegrity,

        verifyEventHash,

        verifyEnvelope,

        prepareEncryptedEvent,

        decryptEventPayload,

        /**
         * Reconciliation state.
         */
        markReconciled,

        markConflicted,

        /**
         * Diagnostics.
         */
        stats,

        readiness,

        health,
    });