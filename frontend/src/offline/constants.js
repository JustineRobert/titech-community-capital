'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/src/offline/constants.js
 *
 * Purpose:
 *   Enterprise production-grade constants for TITech offline-first runtime.
 *
 * Responsibilities:
 *   - Define canonical offline subsystem identifiers.
 *   - Define synchronization states and operation states.
 *   - Define queue priorities.
 *   - Define retry and backoff policies.
 *   - Define conflict-resolution policies.
 *   - Define connectivity states.
 *   - Define local persistence states.
 *   - Define synchronization operation types.
 *   - Define deterministic event names.
 *   - Define validation and security limits.
 *   - Provide immutable runtime constants.
 *   - Prevent magic strings across the offline subsystem.
 *   - Provide compatibility aliases for controlled migrations.
 *
 * IMPORTANT
 * =============================================================================
 *
 *   This module MUST remain side-effect free.
 *
 *   It must NOT:
 *     - access a database.
 *     - access Redis.
 *     - access filesystem/storage providers.
 *     - access network APIs.
 *     - initialize queues.
 *     - initialize timers.
 *     - mutate process.env.
 *     - register event listeners.
 *     - start synchronization workers.
 *
 *   This file contains canonical values only.
 *
 * =============================================================================
 *
 * Offline runtime boundary:
 *
 *   Connectivity
 *       ↓
 *   Offline Store
 *       ↓
 *   Operation Queue
 *       ↓
 *   Synchronization Engine
 *       ↓
 *   Conflict Resolver
 *       ↓
 *   Remote API
 *       ↓
 *   Reconciliation
 *
 * =============================================================================
 */

/**
 * =============================================================================
 * Utility: immutable object creation
 * =============================================================================
 */

function freezeDeep(value, seen = new WeakSet()) {

    if (
        value === null ||
        value === undefined ||
        typeof value !== 'object'
    ) {
        return value;
    }

    if (seen.has(value)) {
        return value;
    }

    seen.add(value);

    for (const key of Reflect.ownKeys(value)) {
        try {
            freezeDeep(value[key], seen);
        } catch {
            // Best effort. Constants remain usable even when a nested value
            // cannot be inspected by a host object.
        }
    }

    try {
        Object.freeze(value);
    } catch {
        // Best effort.
    }

    return value;
}

/**
 * =============================================================================
 * Application identity
 * =============================================================================
 */

const APPLICATION = freezeDeep({
    NAME: 'TITech Community Capital',
    SYSTEM: 'TITech Community Capital Operating System',
    PRODUCT: 'TITech',
    SUBSYSTEM: 'offline',
    SERVICE: 'titech-backend',
});

/**
 * =============================================================================
 * Offline subsystem identifiers
 * =============================================================================
 */

const OFFLINE = freezeDeep({
    COMPONENT:
        'offline',

    STORE:
        'offline-store',

    QUEUE:
        'offline-queue',

    SYNC:
        'offline-sync',

    CONFLICT:
        'offline-conflict',

    RECONCILIATION:
        'offline-reconciliation',

    CONNECTIVITY:
        'offline-connectivity',

    OUTBOX:
        'offline-outbox',

    INBOX:
        'offline-inbox',
});

/**
 * =============================================================================
 * Connectivity states
 * =============================================================================
 */

const CONNECTIVITY_STATES = freezeDeep({
    UNKNOWN:
        'unknown',

    ONLINE:
        'online',

    OFFLINE:
        'offline',

    DEGRADED:
        'degraded',

    CAPTIVE:
        'captive',

    RECONNECTING:
        'reconnecting',
});

/**
 * =============================================================================
 * Synchronization lifecycle states
 * =============================================================================
 */

const SYNC_STATES = freezeDeep({
    IDLE:
        'idle',

    QUEUED:
        'queued',

    RUNNING:
        'running',

    RETRYING:
        'retrying',

    PAUSED:
        'paused',

    BLOCKED:
        'blocked',

    COMPLETED:
        'completed',

    FAILED:
        'failed',

    CANCELLED:
        'cancelled',

    CONFLICT:
        'conflict',
});

/**
 * =============================================================================
 * Synchronization result states
 * =============================================================================
 */

const SYNC_RESULT_STATES = freezeDeep({
    SUCCESS:
        'success',

    PARTIAL:
        'partial',

    FAILED:
        'failed',

    RETRYABLE:
        'retryable',

    NON_RETRYABLE:
        'non_retryable',

    CONFLICT:
        'conflict',

    DUPLICATE:
        'duplicate',

    SKIPPED:
        'skipped',

    CANCELLED:
        'cancelled',
});

/**
 * =============================================================================
 * Offline operation states
 * =============================================================================
 */

const OPERATION_STATES = freezeDeep({
    CREATED:
        'created',

    PENDING:
        'pending',

    PROCESSING:
        'processing',

    SUCCEEDED:
        'succeeded',

    FAILED:
        'failed',

    RETRYABLE_FAILURE:
        'retryable_failure',

    DEAD_LETTER:
        'dead_letter',

    CANCELLED:
        'cancelled',

    EXPIRED:
        'expired',

    CONFLICT:
        'conflict',

    RECONCILED:
        'reconciled',
});

/**
 * =============================================================================
 * Persistence states
 * =============================================================================
 */

const PERSISTENCE_STATES = freezeDeep({
    NEW:
        'new',

    DIRTY:
        'dirty',

    SYNCED:
        'synced',

    STALE:
        'stale',

    CORRUPTED:
        'corrupted',

    DELETED:
        'deleted',
});

/**
 * =============================================================================
 * Queue priorities
 * =============================================================================
 */

const QUEUE_PRIORITIES = freezeDeep({
    CRITICAL:
        100,

    HIGH:
        75,

    NORMAL:
        50,

    LOW:
        25,

    BACKGROUND:
        10,
});

/**
 * =============================================================================
 * Numeric queue priority aliases
 * =============================================================================
 */

const QUEUE_PRIORITY_NAMES = freezeDeep({
    100:
        'critical',

    75:
        'high',

    50:
        'normal',

    25:
        'low',

    10:
        'background',
});

/**
 * =============================================================================
 * Operation categories
 * =============================================================================
 */

const OPERATION_TYPES = freezeDeep({
    CREATE:
        'create',

    UPDATE:
        'update',

    DELETE:
        'delete',

    PATCH:
        'patch',

    UPSERT:
        'upsert',

    COMMAND:
        'command',

    QUERY:
        'query',

    SYNC:
        'sync',

    RECONCILE:
        'reconcile',

    ACK:
        'ack',

    HEARTBEAT:
        'heartbeat',
});

/**
 * =============================================================================
 * Synchronization directions
 * =============================================================================
 */

const SYNC_DIRECTIONS = freezeDeep({
    PUSH:
        'push',

    PULL:
        'pull',

    BIDIRECTIONAL:
        'bidirectional',

    REPLAY:
        'replay',

    RECONCILE:
        'reconcile',
});

/**
 * =============================================================================
 * Conflict strategies
 * =============================================================================
 */

const CONFLICT_STRATEGIES = freezeDeep({
    /**
     * Reject automatic resolution. Manual/operator intervention required.
     */
    MANUAL:
        'manual',

    /**
     * Remote version wins.
     */
    REMOTE_WINS:
        'remote_wins',

    /**
     * Local version wins.
     */
    LOCAL_WINS:
        'local_wins',

    /**
     * Latest server timestamp/version wins.
     */
    LATEST_WINS:
        'latest_wins',

    /**
     * Merge non-conflicting fields.
     */
    FIELD_MERGE:
        'field_merge',

    /**
     * Custom domain-specific resolver.
     */
    CUSTOM:
        'custom',

    /**
     * Never automatically resolve financial conflicts.
     *
     * This is important for TITech financial operations.
     */
    FINANCIAL_HOLD:
        'financial_hold',
});

/**
 * =============================================================================
 * Conflict severities
 * =============================================================================
 */

const CONFLICT_SEVERITIES = freezeDeep({
    LOW:
        'low',

    MEDIUM:
        'medium',

    HIGH:
        'high',

    CRITICAL:
        'critical',
});

/**
 * =============================================================================
 * Idempotency states
 * =============================================================================
 */

const IDEMPOTENCY_STATES = freezeDeep({
    NOT_REQUIRED:
        'not_required',

    REQUIRED:
        'required',

    PENDING:
        'pending',

    COMPLETED:
        'completed',

    CONFLICT:
        'conflict',

    EXPIRED:
        'expired',
});

/**
 * =============================================================================
 * Idempotency outcomes
 * =============================================================================
 */

const IDEMPOTENCY_OUTCOMES = freezeDeep({
    CREATED:
        'created',

    REPLAYED:
        'replayed',

    CONFLICT:
        'conflict',

    IN_PROGRESS:
        'in_progress',

    EXPIRED:
        'expired',

    INVALID:
        'invalid',
});

/**
 * =============================================================================
 * Retry classifications
 * ============================================================================= */

const RETRY_CLASSES = freezeDeep({
    NETWORK:
        'network',

    TIMEOUT:
        'timeout',

    RATE_LIMIT:
        'rate_limit',

    SERVICE_UNAVAILABLE:
        'service_unavailable',

    TRANSIENT:
        'transient',

    AUTHENTICATION:
        'authentication',

    AUTHORIZATION:
        'authorization',

    VALIDATION:
        'validation',

    CONFLICT:
        'conflict',

    NOT_FOUND:
        'not_found',

    DUPLICATE:
        'duplicate',

    BUSINESS:
        'business',

    FINANCIAL:
        'financial',

    UNKNOWN:
        'unknown',
});

/**
 * =============================================================================
 * Backoff strategies
 * ============================================================================= */

const BACKOFF_STRATEGIES = freezeDeep({
    NONE:
        'none',

    FIXED:
        'fixed',

    LINEAR:
        'linear',

    EXPONENTIAL:
        'exponential',

    EXPONENTIAL_JITTER:
        'exponential_jitter',

    FULL_JITTER:
        'full_jitter',

    DECORRELATED_JITTER:
        'decorrelated_jitter',
});

/**
 * =============================================================================
 * Synchronization policies
 * ============================================================================= */

const SYNC_POLICIES = freezeDeep({
    /**
     * Never automatically synchronize.
     */
    MANUAL:
        'manual',

    /**
     * Synchronize when a connection is restored.
     */
    ON_RECONNECT:
        'on_reconnect',

    /**
     * Synchronize periodically.
     */
    PERIODIC:
        'periodic',

    /**
     * Synchronize immediately when queued work is available.
     */
    IMMEDIATE:
        'immediate',

    /**
     * Synchronize after an explicit application event.
     */
    EVENT_DRIVEN:
        'event_driven',

    /**
     * Synchronize while the application is active.
     */
    FOREGROUND:
        'foreground',

    /**
     * Synchronize through a background worker.
     */
    BACKGROUND:
        'background',
});

/**
 * =============================================================================
 * Event names
 * =============================================================================
 */

const EVENTS = freezeDeep({
    /**
     * Connectivity lifecycle.
     */
    CONNECTIVITY_CHANGED:
        'offline.connectivity.changed',

    CONNECTED:
        'offline.connectivity.connected',

    DISCONNECTED:
        'offline.connectivity.disconnected',

    RECONNECTING:
        'offline.connectivity.reconnecting',

    /**
     * Queue lifecycle.
     */
    OPERATION_ENQUEUED:
        'offline.operation.enqueued',

    OPERATION_DEQUEUED:
        'offline.operation.dequeued',

    OPERATION_STARTED:
        'offline.operation.started',

    OPERATION_SUCCEEDED:
        'offline.operation.succeeded',

    OPERATION_FAILED:
        'offline.operation.failed',

    OPERATION_RETRYING:
        'offline.operation.retrying',

    OPERATION_CANCELLED:
        'offline.operation.cancelled',

    OPERATION_EXPIRED:
        'offline.operation.expired',

    OPERATION_DEAD_LETTERED:
        'offline.operation.dead_lettered',

    /**
     * Synchronization lifecycle.
     */
    SYNC_STARTED:
        'offline.sync.started',

    SYNC_COMPLETED:
        'offline.sync.completed',

    SYNC_PARTIAL:
        'offline.sync.partial',

    SYNC_FAILED:
        'offline.sync.failed',

    SYNC_PAUSED:
        'offline.sync.paused',

    SYNC_RESUMED:
        'offline.sync.resumed',

    /**
     * Conflict lifecycle.
     */
    CONFLICT_DETECTED:
        'offline.conflict.detected',

    CONFLICT_RESOLVED:
        'offline.conflict.resolved',

    CONFLICT_ESCALATED:
        'offline.conflict.escalated',

    /**
     * Reconciliation lifecycle.
     */
    RECONCILIATION_STARTED:
        'offline.reconciliation.started',

    RECONCILIATION_COMPLETED:
        'offline.reconciliation.completed',

    RECONCILIATION_FAILED:
        'offline.reconciliation.failed',

    /**
     * Store lifecycle.
     */
    STORE_INITIALIZED:
        'offline.store.initialized',

    STORE_CORRUPTED:
        'offline.store.corrupted',

    STORE_REPAIRED:
        'offline.store.repaired',

    STORE_RESET:
        'offline.store.reset',
});

/**
 * =============================================================================
 * Event categories
 * =============================================================================
 */

const EVENT_CATEGORIES = freezeDeep({
    CONNECTIVITY:
        'connectivity',

    OPERATION:
        'operation',

    SYNC:
        'sync',

    CONFLICT:
        'conflict',

    RECONCILIATION:
        'reconciliation',

    STORE:
        'store',

    SECURITY:
        'security',

    FINANCIAL:
        'financial',
});

/**
 * =============================================================================
 * Failure policies
 * ============================================================================= */

const FAILURE_POLICIES = freezeDeep({
    RETRY:
        'retry',

    DROP:
        'drop',

    DEAD_LETTER:
        'dead_letter',

    PAUSE:
        'pause',

    BLOCK:
        'block',

    ESCALATE:
        'escalate',

    MANUAL_REVIEW:
        'manual_review',

    COMPENSATE:
        'compensate',
});

/**
 * =============================================================================
 * Data consistency levels
 * ============================================================================= */

const CONSISTENCY_LEVELS = freezeDeep({
    EVENTUAL:
        'eventual',

    SESSION:
        'session',

    STRONG:
        'strong',

    FINANCIAL_STRONG:
        'financial_strong',

    RECONCILED:
        'reconciled',
});

/**
 * =============================================================================
 * Record versioning
 * ============================================================================= */

const VERSIONING = freezeDeep({
    FIELD:
        'version',

    REVISION_FIELD:
        'revision',

    UPDATED_AT_FIELD:
        'updatedAt',

    SERVER_VERSION_FIELD:
        'serverVersion',

    CLIENT_VERSION_FIELD:
        'clientVersion',

    ETAG_FIELD:
        'etag',

    DEFAULT_INITIAL_VERSION:
        1,
});

/**
 * =============================================================================
 * Queue defaults
 * ============================================================================= */

const QUEUE_DEFAULTS = freezeDeep({
    /**
     * Queue behavior.
     */
    PRIORITY:
        QUEUE_PRIORITIES.NORMAL,

    CONCURRENCY:
        5,

    MAX_ATTEMPTS:
        5,

    MAX_QUEUE_SIZE:
        10_000,

    MAX_IN_FLIGHT:
        1_000,

    VISIBILITY_TIMEOUT_MS:
        30_000,

    LOCK_DURATION_MS:
        30_000,

    LOCK_RENEW_INTERVAL_MS:
        10_000,

    IDLE_POLL_INTERVAL_MS:
        5_000,

    ACTIVE_POLL_INTERVAL_MS:
        1_000,

    /**
     * Retention.
     */
    SUCCESS_RETENTION_MS:
        24 * 60 * 60 * 1000,

    FAILURE_RETENTION_MS:
        7 * 24 * 60 * 60 * 1000,

    DEAD_LETTER_RETENTION_MS:
        30 * 24 * 60 * 60 * 1000,

    /**
     * Backoff.
     */
    BACKOFF_STRATEGY:
        BACKOFF_STRATEGIES.EXPONENTIAL_JITTER,

    INITIAL_RETRY_DELAY_MS:
        1_000,

    MAX_RETRY_DELAY_MS:
        60_000,

    RETRY_JITTER_RATIO:
        0.20,
});

/**
 * =============================================================================
 * Synchronization defaults
 * ============================================================================= */

const SYNC_DEFAULTS = freezeDeep({
    POLICY:
        SYNC_POLICIES.ON_RECONNECT,

    DIRECTION:
        SYNC_DIRECTIONS.BIDIRECTIONAL,

    BATCH_SIZE:
        100,

    MAX_BATCH_SIZE:
        1_000,

    MAX_CONCURRENT_BATCHES:
        2,

    INTERVAL_MS:
        30_000,

    INITIAL_DELAY_MS:
        2_000,

    MAX_SYNC_DURATION_MS:
        5 * 60 * 1000,

    MAX_OPERATION_AGE_MS:
        7 * 24 * 60 * 60 * 1000,

    STALE_AFTER_MS:
        24 * 60 * 60 * 1000,

    MAX_FAILURES_BEFORE_PAUSE:
        10,

    MAX_CONFLICTS_BEFORE_PAUSE:
        100,

    PAUSE_DURATION_MS:
        60_000,
});

/**
 * =============================================================================
 * Connectivity defaults
 * ============================================================================= */

const CONNECTIVITY_DEFAULTS = freezeDeep({
    INITIAL_STATE:
        CONNECTIVITY_STATES.UNKNOWN,

    CHECK_INTERVAL_MS:
        10_000,

    CONNECT_TIMEOUT_MS:
        5_000,

    RECONNECT_INITIAL_DELAY_MS:
        1_000,

    RECONNECT_MAX_DELAY_MS:
        30_000,

    RECONNECT_MAX_ATTEMPTS:
        10,

    HEALTHY_THRESHOLD:
        3,

    FAILURE_THRESHOLD:
        3,
});

/**
 * =============================================================================
 * Conflict defaults
 * ============================================================================= */

const CONFLICT_DEFAULTS = freezeDeep({
    STRATEGY:
        CONFLICT_STRATEGIES.MANUAL,

    MAX_AUTO_RESOLUTION_ATTEMPTS:
        3,

    ESCALATION_THRESHOLD:
        1,

    MAX_CONFLICT_AGE_MS:
        24 * 60 * 60 * 1000,

    REQUIRE_VERSION_MATCH:
        true,

    REQUIRE_AUDIT_TRAIL:
        true,

    REQUIRE_MANUAL_REVIEW_FOR_FINANCIAL:
        true,
});

/**
 * =============================================================================
 * Idempotency defaults
 * ============================================================================= */

const IDEMPOTENCY_DEFAULTS = freezeDeep({
    ENABLED:
        true,

    KEY_HEADER:
        'Idempotency-Key',

    MAX_KEY_LENGTH:
        255,

    MIN_KEY_LENGTH:
        16,

    TTL_MS:
        24 * 60 * 60 * 1000,

    IN_FLIGHT_TTL_MS:
        10 * 60 * 1000,

    REQUIRE_FOR_MUTATIONS:
        true,

    REQUIRE_FOR_FINANCIAL_OPERATIONS:
        true,

    HASH_ALGORITHM:
        'sha256',
});

/**
 * =============================================================================
 * Offline store defaults
 * ============================================================================= */

const STORE_DEFAULTS = freezeDeep({
    MAX_RECORDS:
        100_000,

    MAX_RECORD_SIZE_BYTES:
        1 * 1024 * 1024,

    MAX_TOTAL_SIZE_BYTES:
        250 * 1024 * 1024,

    COMPACTION_THRESHOLD:
        0.80,

    CHECKSUM_ALGORITHM:
        'sha256',

    ENCRYPTION_REQUIRED:
        true,

    COMPRESSION_ENABLED:
        true,

    VERSION:
        1,
});

/**
 * =============================================================================
 * Security defaults
 * ============================================================================= */

const SECURITY_DEFAULTS = freezeDeep({
    REQUIRE_AUTHENTICATION:
        true,

    REQUIRE_INTEGRITY_CHECK:
        true,

    REQUIRE_ENCRYPTED_LOCAL_STORAGE:
        true,

    ALLOW_UNTRUSTED_OFFLINE_DATA:
        false,

    MAX_PAYLOAD_BYTES:
        5 * 1024 * 1024,

    MAX_METADATA_BYTES:
        64 * 1024,

    MAX_IDEMPOTENCY_KEY_LENGTH:
        IDEMPOTENCY_DEFAULTS.MAX_KEY_LENGTH,

    REQUIRE_REQUEST_SIGNATURE:
        false,

    HASH_ALGORITHM:
        'sha256',
});

/**
 * =============================================================================
 * Financial/offline safety defaults
 * =============================================================================
 *
 * Offline mode must not silently weaken financial integrity guarantees.
 */

const FINANCIAL_DEFAULTS = freezeDeep({
    /**
     * Financial operations require stronger controls than ordinary offline
     * operations.
     */
    REQUIRE_IDEMPOTENCY:
        true,

    REQUIRE_AUDIT_EVENT:
        true,

    REQUIRE_CLIENT_OPERATION_ID:
        true,

    REQUIRE_SERVER_RECONCILIATION:
        true,

    ALLOW_FINANCIAL_AUTO_CONFLICT_RESOLUTION:
        false,

    DEFAULT_CONFLICT_STRATEGY:
        CONFLICT_STRATEGIES.FINANCIAL_HOLD,

    ALLOW_DUPLICATE_SUBMISSION:
        false,

    REQUIRE_REMOTE_ACK:
        true,

    REQUIRE_LEDGER_RECONCILIATION:
        true,
});

/**
 * =============================================================================
 * Operation metadata fields
 * ============================================================================= */

const OPERATION_FIELDS = freezeDeep({
    ID:
        'operationId',

    TYPE:
        'operationType',

    STATUS:
        'status',

    STATE:
        'state',

    PRIORITY:
        'priority',

    PAYLOAD:
        'payload',

    METADATA:
        'metadata',

    CREATED_AT:
        'createdAt',

    UPDATED_AT:
        'updatedAt',

    ATTEMPTS:
        'attempts',

    MAX_ATTEMPTS:
        'maxAttempts',

    NEXT_RETRY_AT:
        'nextRetryAt',

    LAST_ERROR:
        'lastError',

    CLIENT_ID:
        'clientId',

    DEVICE_ID:
        'deviceId',

    USER_ID:
        'userId',

    TENANT_ID:
        'tenantId',

    IDEMPOTENCY_KEY:
        'idempotencyKey',

    CORRELATION_ID:
        'correlationId',

    CAUSATION_ID:
        'causationId',

    TRACE_ID:
        'traceId',

    PARENT_OPERATION_ID:
        'parentOperationId',

    VERSION:
        'version',

    REVISION:
        'revision',

    ETAG:
        'etag',

    EXPIRES_AT:
        'expiresAt',

    RECONCILED_AT:
        'reconciledAt',

    SERVER_OPERATION_ID:
        'serverOperationId',
});

/**
 * =============================================================================
 * Sync metadata fields
 * ============================================================================= */

const SYNC_FIELDS = freezeDeep({
    SYNC_ID:
        'syncId',

    BATCH_ID:
        'batchId',

    DIRECTION:
        'direction',

    STATE:
        'state',

    STARTED_AT:
        'startedAt',

    COMPLETED_AT:
        'completedAt',

    LAST_SUCCESS_AT:
        'lastSuccessAt',

    LAST_FAILURE_AT:
        'lastFailureAt',

    CURSOR:
        'cursor',

    NEXT_CURSOR:
        'nextCursor',

    ITEMS_PROCESSED:
        'itemsProcessed',

    ITEMS_SUCCEEDED:
        'itemsSucceeded',

    ITEMS_FAILED:
        'itemsFailed',

    ITEMS_RETRIED:
        'itemsRetried',

    CONFLICTS:
        'conflicts',

    DURATION_MS:
        'durationMs',

    ERROR:
        'error',
});

/**
 * =============================================================================
 * Canonical HTTP headers
 * ============================================================================= */

const HTTP_HEADERS = freezeDeep({
    IDEMPOTENCY_KEY:
        'Idempotency-Key',

    CORRELATION_ID:
        'X-Correlation-ID',

    REQUEST_ID:
        'X-Request-ID',

    CLIENT_ID:
        'X-Client-ID',

    DEVICE_ID:
        'X-Device-ID',

    CLIENT_VERSION:
        'X-Client-Version',

    CLIENT_TIMESTAMP:
        'X-Client-Timestamp',

    SYNC_TOKEN:
        'X-Sync-Token',

    SYNC_CURSOR:
        'X-Sync-Cursor',

    ETAG:
        'ETag',

    IF_MATCH:
        'If-Match',

    IF_NONE_MATCH:
        'If-None-Match',
});

/**
 * =============================================================================
 * HTTP status categories useful for offline retry classification
 * ============================================================================= */

const HTTP_STATUS_POLICY = freezeDeep({
    RETRYABLE:
        [
            408,
            425,
            429,
            500,
            502,
            503,
            504,
        ],

    AUTHENTICATION_FAILURE:
        [
            401,
        ],

    AUTHORIZATION_FAILURE:
        [
            403,
        ],

    VALIDATION_FAILURE:
        [
            400,
            422,
        ],

    CONFLICT:
        [
            409,
        ],

    NOT_FOUND:
        [
            404,
        ],

    CLIENT_PERMANENT_FAILURE:
        [
            400,
            401,
            403,
            404,
            405,
            406,
            410,
            411,
            412,
            413,
            414,
            415,
            422,
            423,
            424,
            428,
        ],
});

/**
 * =============================================================================
 * Local storage namespaces
 * ============================================================================= */

const STORAGE_NAMESPACES = freezeDeep({
    ROOT:
        'titech.offline',

    OPERATIONS:
        'titech.offline.operations',

    OUTBOX:
        'titech.offline.outbox',

    INBOX:
        'titech.offline.inbox',

    SYNC_STATE:
        'titech.offline.sync',

    CONFLICTS:
        'titech.offline.conflicts',

    IDEMPOTENCY:
        'titech.offline.idempotency',

    CHECKPOINTS:
        'titech.offline.checkpoints',

    METADATA:
        'titech.offline.metadata',

    AUDIT:
        'titech.offline.audit',
});

/**
 * =============================================================================
 * Storage key prefixes
 * ============================================================================= */

const STORAGE_KEY_PREFIXES = freezeDeep({
    OPERATION:
        `${STORAGE_NAMESPACES.OPERATIONS}:`,

    OUTBOX:
        `${STORAGE_NAMESPACES.OUTBOX}:`,

    INBOX:
        `${STORAGE_NAMESPACES.INBOX}:`,

    SYNC:
        `${STORAGE_NAMESPACES.SYNC_STATE}:`,

    CONFLICT:
        `${STORAGE_NAMESPACES.CONFLICTS}:`,

    IDEMPOTENCY:
        `${STORAGE_NAMESPACES.IDEMPOTENCY}:`,

    CHECKPOINT:
        `${STORAGE_NAMESPACES.CHECKPOINTS}:`,

    AUDIT:
        `${STORAGE_NAMESPACES.AUDIT}:`,
});

/**
 * =============================================================================
 * Security / validation limits
 * ============================================================================= */

const LIMITS = freezeDeep({
    /**
     * Operation identity.
     */
    OPERATION_ID_MIN_LENGTH:
        16,

    OPERATION_ID_MAX_LENGTH:
        255,

    CORRELATION_ID_MAX_LENGTH:
        255,

    CLIENT_ID_MAX_LENGTH:
        255,

    DEVICE_ID_MAX_LENGTH:
        255,

    TENANT_ID_MAX_LENGTH:
        255,

    USER_ID_MAX_LENGTH:
        255,

    /**
     * Payload.
     */
    MAX_OPERATION_PAYLOAD_BYTES:
        SECURITY_DEFAULTS
            .MAX_PAYLOAD_BYTES,

    MAX_OPERATION_METADATA_BYTES:
        SECURITY_DEFAULTS
            .MAX_METADATA_BYTES,

    /**
     * Queue.
     */
    MAX_QUEUE_SIZE:
        QUEUE_DEFAULTS
            .MAX_QUEUE_SIZE,

    MAX_IN_FLIGHT:
        QUEUE_DEFAULTS
            .MAX_IN_FLIGHT,

    MAX_ATTEMPTS:
        QUEUE_DEFAULTS
            .MAX_ATTEMPTS,

    /**
     * Sync.
     */
    MAX_SYNC_BATCH_SIZE:
        SYNC_DEFAULTS
            .MAX_BATCH_SIZE,

    MAX_CONCURRENT_BATCHES:
        SYNC_DEFAULTS
            .MAX_CONCURRENT_BATCHES,

    /**
     * Store.
     */
    MAX_STORE_RECORDS:
        STORE_DEFAULTS
            .MAX_RECORDS,

    MAX_STORE_RECORD_SIZE_BYTES:
        STORE_DEFAULTS
            .MAX_RECORD_SIZE_BYTES,

    MAX_STORE_TOTAL_SIZE_BYTES:
        STORE_DEFAULTS
            .MAX_TOTAL_SIZE_BYTES,

    /**
     * Idempotency.
     */
    MIN_IDEMPOTENCY_KEY_LENGTH:
        IDEMPOTENCY_DEFAULTS
            .MIN_KEY_LENGTH,

    MAX_IDEMPOTENCY_KEY_LENGTH:
        IDEMPOTENCY_DEFAULTS
            .MAX_KEY_LENGTH,
});

/**
 * =============================================================================
 * Time constants
 * ============================================================================= */

const TIME = freezeDeep({
    SECOND_MS:
        1_000,

    MINUTE_MS:
        60_000,

    HOUR_MS:
        60 * 60 * 1_000,

    DAY_MS:
        24 * 60 * 60 * 1_000,

    WEEK_MS:
        7 * 24 * 60 * 60 * 1_000,
});

/**
 * =============================================================================
 * Retry defaults by failure class
 * ============================================================================= */

const RETRY_POLICIES = freezeDeep({
    NETWORK:
        {
            retryable:
                true,

            strategy:
                BACKOFF_STRATEGIES
                    .EXPONENTIAL_JITTER,

            maxAttempts:
                5,

            initialDelayMs:
                1_000,

            maxDelayMs:
                60_000,
        },

    TIMEOUT:
        {
            retryable:
                true,

            strategy:
                BACKOFF_STRATEGIES
                    .EXPONENTIAL_JITTER,

            maxAttempts:
                5,

            initialDelayMs:
                2_000,

            maxDelayMs:
                60_000,
        },

    RATE_LIMIT:
        {
            retryable:
                true,

            strategy:
                BACKOFF_STRATEGIES
                    .FULL_JITTER,

            maxAttempts:
                8,

            initialDelayMs:
                5_000,

            maxDelayMs:
                120_000,
        },

    SERVICE_UNAVAILABLE:
        {
            retryable:
                true,

            strategy:
                BACKOFF_STRATEGIES
                    .EXPONENTIAL_JITTER,

            maxAttempts:
                8,

            initialDelayMs:
                2_000,

            maxDelayMs:
                120_000,
        },

    AUTHENTICATION:
        {
            retryable:
                false,

            strategy:
                BACKOFF_STRATEGIES
                    .NONE,

            maxAttempts:
                1,

            initialDelayMs:
                0,

            maxDelayMs:
                0,
        },

    AUTHORIZATION:
        {
            retryable:
                false,

            strategy:
                BACKOFF_STRATEGIES
                    .NONE,

            maxAttempts:
                1,

            initialDelayMs:
                0,

            maxDelayMs:
                0,
        },

    VALIDATION:
        {
            retryable:
                false,

            strategy:
                BACKOFF_STRATEGIES
                    .NONE,

            maxAttempts:
                1,

            initialDelayMs:
                0,

            maxDelayMs:
                0,
        },

    CONFLICT:
        {
            retryable:
                false,

            strategy:
                BACKOFF_STRATEGIES
                    .NONE,

            maxAttempts:
                1,

            initialDelayMs:
                0,

            maxDelayMs:
                0,
        },

    DUPLICATE:
        {
            retryable:
                false,

            strategy:
                BACKOFF_STRATEGIES
                    .NONE,

            maxAttempts:
                1,

            initialDelayMs:
                0,

            maxDelayMs:
                0,
        },

    FINANCIAL:
        {
            retryable:
                false,

            strategy:
                BACKOFF_STRATEGIES
                    .NONE,

            maxAttempts:
                1,

            initialDelayMs:
                0,

            maxDelayMs:
                0,
        },

    BUSINESS:
        {
            retryable:
                false,

            strategy:
                BACKOFF_STRATEGIES
                    .NONE,

            maxAttempts:
                1,

            initialDelayMs:
                0,

            maxDelayMs:
                0,
        },

    UNKNOWN:
        {
            retryable:
                false,

            strategy:
                BACKOFF_STRATEGIES
                    .NONE,

            maxAttempts:
                1,

            initialDelayMs:
                0,

            maxDelayMs:
                0,
        },
});

/**
 * =============================================================================
 * Financial operation types
 * =============================================================================
 *
 * These operations receive stronger offline guarantees and must not be
 * resolved with ordinary last-write-wins semantics.
 */

const FINANCIAL_OPERATION_TYPES = freezeDeep([
    'payment',
    'payment.create',
    'payment.capture',
    'payment.authorize',
    'payment.refund',
    'payment.reverse',
    'payment.transfer',
    'mobile_money.payment',
    'mobile_money.collection',
    'mobile_money.disbursement',
    'contribution.create',
    'contribution.update',
    'loan.disbursement',
    'loan.repayment',
    'ledger.post',
    'ledger.adjust',
    'ledger.reverse',
    'transaction.create',
    'transaction.commit',
]);

/**
 * =============================================================================
 * Read-only operation types
 * =============================================================================
 */

const READ_ONLY_OPERATION_TYPES = freezeDeep([
    OPERATION_TYPES.QUERY,
    OPERATION_TYPES.HEARTBEAT,
    OPERATION_TYPES.ACK,
]);

/**
 * =============================================================================
 * Mutation operation types
 * =============================================================================
 */

const MUTATION_OPERATION_TYPES = freezeDeep([
    OPERATION_TYPES.CREATE,
    OPERATION_TYPES.UPDATE,
    OPERATION_TYPES.DELETE,
    OPERATION_TYPES.PATCH,
    OPERATION_TYPES.UPSERT,
    OPERATION_TYPES.COMMAND,
]);

/**
 * =============================================================================
 * Offline feature flags
 * =============================================================================
 *
 * Canonical names only. Runtime feature flag values belong in configuration.
 */

const FEATURE_FLAGS = freezeDeep({
    OFFLINE_ENABLED:
        'OFFLINE_ENABLED',

    OFFLINE_SYNC_ENABLED:
        'OFFLINE_SYNC_ENABLED',

    OFFLINE_QUEUE_ENABLED:
        'OFFLINE_QUEUE_ENABLED',

    OFFLINE_ENCRYPTION_ENABLED:
        'OFFLINE_ENCRYPTION_ENABLED',

    OFFLINE_CONFLICT_RESOLUTION_ENABLED:
        'OFFLINE_CONFLICT_RESOLUTION_ENABLED',

    OFFLINE_BACKGROUND_SYNC_ENABLED:
        'OFFLINE_BACKGROUND_SYNC_ENABLED',

    OFFLINE_FINANCIAL_OPERATIONS_ENABLED:
        'OFFLINE_FINANCIAL_OPERATIONS_ENABLED',

    OFFLINE_DEBUG_ENABLED:
        'OFFLINE_DEBUG_ENABLED',
});

/**
 * =============================================================================
 * Environment variable names
 * =============================================================================
 */

const ENVIRONMENT_VARIABLES = freezeDeep({
    ENABLED:
        'OFFLINE_ENABLED',

    SYNC_ENABLED:
        'OFFLINE_SYNC_ENABLED',

    QUEUE_ENABLED:
        'OFFLINE_QUEUE_ENABLED',

    ENCRYPTION_ENABLED:
        'OFFLINE_ENCRYPTION_ENABLED',

    STORAGE_PATH:
        'OFFLINE_STORAGE_PATH',

    MAX_QUEUE_SIZE:
        'OFFLINE_MAX_QUEUE_SIZE',

    MAX_ATTEMPTS:
        'OFFLINE_MAX_ATTEMPTS',

    SYNC_INTERVAL_MS:
        'OFFLINE_SYNC_INTERVAL_MS',

    SYNC_BATCH_SIZE:
        'OFFLINE_SYNC_BATCH_SIZE',

    CONNECTIVITY_CHECK_INTERVAL_MS:
        'OFFLINE_CONNECTIVITY_CHECK_INTERVAL_MS',

    IDEMPOTENCY_ENABLED:
        'OFFLINE_IDEMPOTENCY_ENABLED',

    FINANCIAL_OPERATIONS_ENABLED:
        'OFFLINE_FINANCIAL_OPERATIONS_ENABLED',
});

/**
 * =============================================================================
 * Error codes
 * ============================================================================= */

const ERROR_CODES = freezeDeep({
    /**
     * General.
     */
    OFFLINE_DISABLED:
        'OFFLINE_DISABLED',

    OFFLINE_NOT_READY:
        'OFFLINE_NOT_READY',

    OFFLINE_STORE_UNAVAILABLE:
        'OFFLINE_STORE_UNAVAILABLE',

    OFFLINE_STORE_CORRUPTED:
        'OFFLINE_STORE_CORRUPTED',

    OFFLINE_QUEUE_FULL:
        'OFFLINE_QUEUE_FULL',

    OFFLINE_OPERATION_NOT_FOUND:
        'OFFLINE_OPERATION_NOT_FOUND',

    OFFLINE_OPERATION_EXPIRED:
        'OFFLINE_OPERATION_EXPIRED',

    OFFLINE_OPERATION_CANCELLED:
        'OFFLINE_OPERATION_CANCELLED',

    OFFLINE_OPERATION_INVALID:
        'OFFLINE_OPERATION_INVALID',

    OFFLINE_SYNC_FAILED:
        'OFFLINE_SYNC_FAILED',

    OFFLINE_SYNC_PAUSED:
        'OFFLINE_SYNC_PAUSED',

    OFFLINE_SYNC_CONFLICT:
        'OFFLINE_SYNC_CONFLICT',

    OFFLINE_RECONCILIATION_FAILED:
        'OFFLINE_RECONCILIATION_FAILED',

    /**
     * Security.
     */
    OFFLINE_SIGNATURE_INVALID:
        'OFFLINE_SIGNATURE_INVALID',

    OFFLINE_PAYLOAD_INVALID:
        'OFFLINE_PAYLOAD_INVALID',

    OFFLINE_PAYLOAD_TOO_LARGE:
        'OFFLINE_PAYLOAD_TOO_LARGE',

    OFFLINE_OPERATION_UNAUTHORIZED:
        'OFFLINE_OPERATION_UNAUTHORIZED',

    OFFLINE_IDEMPOTENCY_REQUIRED:
        'OFFLINE_IDEMPOTENCY_REQUIRED',

    OFFLINE_IDEMPOTENCY_CONFLICT:
        'OFFLINE_IDEMPOTENCY_CONFLICT',

    /**
     * Financial.
     */
    OFFLINE_FINANCIAL_OPERATION_BLOCKED:
        'OFFLINE_FINANCIAL_OPERATION_BLOCKED',

    OFFLINE_FINANCIAL_CONFLICT:
        'OFFLINE_FINANCIAL_CONFLICT',

    OFFLINE_FINANCIAL_REQUIRES_RECONCILIATION:
        'OFFLINE_FINANCIAL_REQUIRES_RECONCILIATION',

    OFFLINE_DUPLICATE_FINANCIAL_OPERATION:
        'OFFLINE_DUPLICATE_FINANCIAL_OPERATION',
});

/**
 * =============================================================================
 * Operation state transition matrix
 * =============================================================================
 */

const OPERATION_STATE_TRANSITIONS = freezeDeep({
    [OPERATION_STATES.CREATED]:
        [
            OPERATION_STATES.PENDING,
            OPERATION_STATES.CANCELLED,
        ],

    [OPERATION_STATES.PENDING]:
        [
            OPERATION_STATES.PROCESSING,
            OPERATION_STATES.CANCELLED,
            OPERATION_STATES.EXPIRED,
        ],

    [OPERATION_STATES.PROCESSING]:
        [
            OPERATION_STATES.SUCCEEDED,
            OPERATION_STATES.FAILED,
            OPERATION_STATES.RETRYABLE_FAILURE,
            OPERATION_STATES.CONFLICT,
            OPERATION_STATES.CANCELLED,
        ],

    [OPERATION_STATES.RETRYABLE_FAILURE]:
        [
            OPERATION_STATES.PENDING,
            OPERATION_STATES.PROCESSING,
            OPERATION_STATES.DEAD_LETTER,
            OPERATION_STATES.CANCELLED,
            OPERATION_STATES.EXPIRED,
        ],

    [OPERATION_STATES.FAILED]:
        [
            OPERATION_STATES.RETRYABLE_FAILURE,
            OPERATION_STATES.DEAD_LETTER,
            OPERATION_STATES.RECONCILED,
        ],

    [OPERATION_STATES.CONFLICT]:
        [
            OPERATION_STATES.PENDING,
            OPERATION_STATES.PROCESSING,
            OPERATION_STATES.RECONCILED,
            OPERATION_STATES.CANCELLED,
        ],

    [OPERATION_STATES.DEAD_LETTER]:
        [
            OPERATION_STATES.RECONCILED,
            OPERATION_STATES.CANCELLED,
        ],

    [OPERATION_STATES.SUCCEEDED]:
        [
            OPERATION_STATES.RECONCILED,
        ],

    [OPERATION_STATES.RECONCILED]:
        [],

    [OPERATION_STATES.CANCELLED]:
        [],

    [OPERATION_STATES.EXPIRED]:
        [
            OPERATION_STATES.RECONCILED,
        ],
});

/**
 * =============================================================================
 * Sync state transition matrix
 * =============================================================================
 */

const SYNC_STATE_TRANSITIONS = freezeDeep({
    [SYNC_STATES.IDLE]:
        [
            SYNC_STATES.QUEUED,
            SYNC_STATES.PAUSED,
        ],

    [SYNC_STATES.QUEUED]:
        [
            SYNC_STATES.RUNNING,
            SYNC_STATES.CANCELLED,
        ],

    [SYNC_STATES.RUNNING]:
        [
            SYNC_STATES.COMPLETED,
            SYNC_STATES.RETRYING,
            SYNC_STATES.PAUSED,
            SYNC_STATES.BLOCKED,
            SYNC_STATES.CONFLICT,
            SYNC_STATES.FAILED,
        ],

    [SYNC_STATES.RETRYING]:
        [
            SYNC_STATES.RUNNING,
            SYNC_STATES.PAUSED,
            SYNC_STATES.FAILED,
        ],

    [SYNC_STATES.CONFLICT]:
        [
            SYNC_STATES.RUNNING,
            SYNC_STATES.PAUSED,
            SYNC_STATES.BLOCKED,
            SYNC_STATES.COMPLETED,
        ],

    [SYNC_STATES.BLOCKED]:
        [
            SYNC_STATES.QUEUED,
            SYNC_STATES.PAUSED,
            SYNC_STATES.FAILED,
        ],

    [SYNC_STATES.PAUSED]:
        [
            SYNC_STATES.QUEUED,
            SYNC_STATES.RUNNING,
        ],

    [SYNC_STATES.FAILED]:
        [
            SYNC_STATES.RETRYING,
            SYNC_STATES.PAUSED,
            SYNC_STATES.QUEUED,
        ],

    [SYNC_STATES.COMPLETED]:
        [
            SYNC_STATES.QUEUED,
        ],

    [SYNC_STATES.CANCELLED]:
        [
            SYNC_STATES.QUEUED,
        ],
});

/**
 * =============================================================================
 * Canonical helper functions
 * =============================================================================
 */

function isFinancialOperation(
    operationType,
) {

    if (
        !operationType
    ) {

        return false;
    }

    const normalized =
        String(
            operationType,
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

function isReadOnlyOperation(
    operationType,
) {

    return READ_ONLY_OPERATION_TYPES.includes(
        String(
            operationType ||
            '',
        )
            .trim()
            .toLowerCase(),
    );
}

function isMutationOperation(
    operationType,
) {

    return MUTATION_OPERATION_TYPES.includes(
        String(
            operationType ||
            '',
        )
            .trim()
            .toLowerCase(),
    );
}

function isTerminalOperationState(
    state,
) {

    return [
        OPERATION_STATES
            .SUCCEEDED,
        OPERATION_STATES
            .RECONCILED,
        OPERATION_STATES
            .CANCELLED,
        OPERATION_STATES
            .EXPIRED,
    ].includes(
        state,
    );
}

function isTerminalSyncState(
    state,
) {

    return [
        SYNC_STATES
            .COMPLETED,
        SYNC_STATES
            .CANCELLED,
    ].includes(
        state,
    );
}

function canTransitionOperationState(
    from,
    to,
) {

    if (
        !from ||
        !to
    ) {

        return false;
    }

    if (
        from ===
        to
    ) {

        return true;
    }

    return (
        OPERATION_STATE_TRANSITIONS[
            from
        ] ||
        []
    ).includes(
        to,
    );
}

function canTransitionSyncState(
    from,
    to,
) {

    if (
        !from ||
        !to
    ) {

        return false;
    }

    if (
        from ===
        to
    ) {

        return true;
    }

    return (
        SYNC_STATE_TRANSITIONS[
            from
        ] ||
        []
    ).includes(
        to,
    );
}

function getRetryPolicy(
    failureClass,
) {

    const normalized =
        String(
            failureClass ||
            RETRY_CLASSES
                .UNKNOWN,
        )
            .trim()
            .toUpperCase();

    return (
        RETRY_POLICIES[
            normalized
        ] ||
        RETRY_POLICIES
            .UNKNOWN
    );
}

function shouldRetry(
    failureClass,
) {

    return Boolean(
        getRetryPolicy(
            failureClass,
        ).retryable,
    );
}

function isRetryableHttpStatus(
    statusCode,
) {

    const code =
        Number(
            statusCode,
        );

    if (
        !Number.isInteger(
            code,
        )
    ) {

        return false;
    }

    return HTTP_STATUS_POLICY
        .RETRYABLE
        .includes(
            code,
        );
}

function classifyHttpStatus(
    statusCode,
) {

    const code =
        Number(
            statusCode,
        );

    if (
        !Number.isInteger(
            code,
        )
    ) {

        return RETRY_CLASSES
            .UNKNOWN;
    }

    if (
        HTTP_STATUS_POLICY
            .RETRYABLE
            .includes(
                code,
            )
    ) {

        if (
            code ===
            429
        ) {

            return RETRY_CLASSES
                .RATE_LIMIT;
        }

        if (
            [
                408,
                504,
            ].includes(
                code,
            )
        ) {

            return RETRY_CLASSES
                .TIMEOUT;
        }

        return RETRY_CLASSES
            .SERVICE_UNAVAILABLE;
    }

    if (
        HTTP_STATUS_POLICY
            .AUTHENTICATION_FAILURE
            .includes(
                code,
            )
    ) {

        return RETRY_CLASSES
            .AUTHENTICATION;
    }

    if (
        HTTP_STATUS_POLICY
            .AUTHORIZATION_FAILURE
            .includes(
                code,
            )
    ) {

        return RETRY_CLASSES
            .AUTHORIZATION;
    }

    if (
        HTTP_STATUS_POLICY
            .VALIDATION_FAILURE
            .includes(
                code,
            )
    ) {

        return RETRY_CLASSES
            .VALIDATION;
    }

    if (
        HTTP_STATUS_POLICY
            .CONFLICT
            .includes(
                code,
            )
    ) {

        return RETRY_CLASSES
            .CONFLICT;
    }

    if (
        HTTP_STATUS_POLICY
            .NOT_FOUND
            .includes(
                code,
            )
    ) {

        return RETRY_CLASSES
            .NOT_FOUND;
    }

    return RETRY_CLASSES
        .UNKNOWN;
}

function getOperationDefaultPriority(
    operationType,
) {

    if (
        isFinancialOperation(
            operationType,
        )
    ) {

        return QUEUE_PRIORITIES
            .CRITICAL;
    }

    if (
        isReadOnlyOperation(
            operationType,
        )
    ) {

        return QUEUE_PRIORITIES
            .LOW;
    }

    return QUEUE_PRIORITIES
        .NORMAL;
}

function getConflictStrategy(
    operationType,
) {

    if (
        isFinancialOperation(
            operationType,
        )
    ) {

        return FINANCIAL_DEFAULTS
            .DEFAULT_CONFLICT_STRATEGY;
    }

    return CONFLICT_DEFAULTS
        .STRATEGY;
}

function requiresIdempotency(
    operationType,
) {

    if (
        isFinancialOperation(
            operationType,
        )
    ) {

        return FINANCIAL_DEFAULTS
            .REQUIRE_IDEMPOTENCY;
    }

    return (
        isMutationOperation(
            operationType,
        ) &&
        IDEMPOTENCY_DEFAULTS
            .REQUIRE_FOR_MUTATIONS
    );
}

/**
 * =============================================================================
 * Compatibility aliases
 * =============================================================================
 *
 * These aliases make the constants layer easier to consume during migration
 * from older offline implementations without reintroducing legacy ACFOS naming.
 * =============================================================================
 */

const STATES = SYNC_STATES;

const QUEUE = QUEUE_DEFAULTS;

const SYNC = SYNC_DEFAULTS;

const CONNECTIVITY = CONNECTIVITY_DEFAULTS;

const CONFLICT = CONFLICT_DEFAULTS;

const IDEMPOTENCY = IDEMPOTENCY_DEFAULTS;

const STORE = STORE_DEFAULTS;

const SECURITY = SECURITY_DEFAULTS;

const FINANCIAL = FINANCIAL_DEFAULTS;

/**
 * =============================================================================
 * Canonical module metadata
 * =============================================================================
 */

const MODULE_METADATA = freezeDeep({
    name:
        'TITech Offline Constants',

    component:
        COMPONENT,

    version:
        '1.0.0',

    schemaVersion:
        1,

    immutable:
        true,

    sideEffectFree:
        true,
});

/**
 * =============================================================================
 * Public API
 * =============================================================================
 */

module.exports = freezeDeep({

    /**
     * Metadata.
     */
    APPLICATION,

    MODULE_METADATA,

    /**
     * Subsystem identifiers.
     */
    OFFLINE,

    /**
     * States.
     */
    CONNECTIVITY_STATES,

    SYNC_STATES,

    SYNC_RESULT_STATES,

    OPERATION_STATES,

    PERSISTENCE_STATES,

    /**
     * Queue.
     */
    QUEUE_PRIORITIES,

    QUEUE_PRIORITY_NAMES,

    QUEUE_DEFAULTS,

    /**
     * Operations.
     */
    OPERATION_TYPES,

    OPERATION_FIELDS,

    SYNC_FIELDS,

    READ_ONLY_OPERATION_TYPES,

    MUTATION_OPERATION_TYPES,

    FINANCIAL_OPERATION_TYPES,

    /**
     * Synchronization.
     */
    SYNC_DIRECTIONS,

    SYNC_POLICIES,

    SYNC_DEFAULTS,

    /**
     * Conflicts.
     */
    CONFLICT_STRATEGIES,

    CONFLICT_SEVERITIES,

    CONFLICT_DEFAULTS,

    /**
     * Idempotency.
     */
    IDEMPOTENCY_STATES,

    IDEMPOTENCY_OUTCOMES,

    IDEMPOTENCY_DEFAULTS,

    /**
     * Retry.
     */
    RETRY_CLASSES,

    BACKOFF_STRATEGIES,

    RETRY_POLICIES,

    /**
     * Failure/consistency.
     */
    FAILURE_POLICIES,

    CONSISTENCY_LEVELS,

    /**
     * Events.
     */
    EVENTS,

    EVENT_CATEGORIES,

    /**
     * Networking.
     */
    HTTP_HEADERS,

    HTTP_STATUS_POLICY,

    CONNECTIVITY_DEFAULTS,

    /**
     * Storage.
     */
    STORAGE_NAMESPACES,

    STORAGE_KEY_PREFIXES,

    STORE_DEFAULTS,

    /**
     * Security.
     */
    SECURITY_DEFAULTS,

    /**
     * Financial.
     */
    FINANCIAL_DEFAULTS,

    /**
     * Versioning.
     */
    VERSIONING,

    /**
     * Feature/configuration names.
     */
    FEATURE_FLAGS,

    ENVIRONMENT_VARIABLES,

    /**
     * Limits.
     */
    LIMITS,

    TIME,

    /**
     * State transitions.
     */
    OPERATION_STATE_TRANSITIONS,

    SYNC_STATE_TRANSITIONS,

    /**
     * Compatibility aliases.
     */
    STATES,

    QUEUE,

    SYNC,

    CONNECTIVITY,

    CONFLICT,

    IDEMPOTENCY,

    STORE,

    SECURITY,

    FINANCIAL,

    /**
     * Helpers.
     */
    isFinancialOperation,

    isReadOnlyOperation,

    isMutationOperation,

    isTerminalOperationState,

    isTerminalSyncState,

    canTransitionOperationState,

    canTransitionSyncState,

    getRetryPolicy,

    shouldRetry,

    isRetryableHttpStatus,

    classifyHttpStatus,

    getOperationDefaultPriority,

    getConflictStrategy,

    requiresIdempotency,
});