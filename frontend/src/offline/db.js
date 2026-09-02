'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/src/offline/db.js
 *
 * Purpose:
 *   Enterprise production-grade persistence boundary for the TITech offline
 *   subsystem.
 *
 * Responsibilities
 * =============================================================================
 *
 *   ✓ Encapsulate offline persistence.
 *   ✓ Provide a durable local operation store.
 *   ✓ Manage offline outbox/inbox records.
 *   ✓ Persist synchronization checkpoints.
 *   ✓ Persist conflict records.
 *   ✓ Persist idempotency state.
 *   ✓ Enforce optimistic version/revision metadata.
 *   ✓ Provide transactional-style serialization of local mutations.
 *   ✓ Provide atomic record replacement semantics.
 *   ✓ Provide bounded queries and pagination.
 *   ✓ Provide expiry/retention cleanup.
 *   ✓ Provide integrity metadata hooks.
 *   ✓ Support encrypted payload envelopes.
 *   ✓ Remain independent from the primary MongoDB database.
 *   ✓ Remain independent from Redis.
 *   ✓ Remain independent from queues and remote APIs.
 *   ✓ Fail closed when persistent storage is unavailable.
 *
 * IMPORTANT
 * =============================================================================
 *
 *   This module is the OFFLINE persistence boundary.
 *
 *   It does NOT:
 *
 *     - connect to the application's primary MongoDB cluster;
 *     - use Redis as durable offline storage;
 *     - call remote APIs;
 *     - execute synchronization;
 *     - resolve business conflicts;
 *     - authorize users;
 *     - post to the financial ledger;
 *     - initiate Mobile Money transactions;
 *     - mutate process.env;
 *     - decide business-level transaction validity.
 *
 * =============================================================================
 *
 * Persistence architecture:
 *
 *   offline operation
 *        ↓
 *   db.js
 *        ↓
 *   encrypted durable store
 *        ↓
 *   sync engine
 *        ↓
 *   remote API
 *        ↓
 *   reconciliation
 *
 * =============================================================================
 *
 * Storage model
 * =============================================================================
 *
 *   SQLite is used when the `better-sqlite3` package is available.
 *
 *   A deterministic JSON snapshot fallback is intentionally NOT provided:
 *
 *   - offline data can represent financial operations;
 *   - silently falling back from an ACID-capable local store to an ad-hoc JSON
 *     file would weaken durability and atomicity guarantees.
 *
 *   Therefore:
 *
 *       no SQLite driver
 *           ↓
 *       explicit initialization failure
 *
 * =============================================================================
 */

'use strict';

const fs =
    require('node:fs');

const path =
    require('node:path');

const crypto =
    require('node:crypto');

const {
    constants: fsConstants,
} =
    fs;

const {
    OFFLINE,
    OPERATION_STATES,
    OPERATION_TYPES,
    PERSISTENCE_STATES,
    SYNC_STATES,
    CONFLICT_STRATEGIES,
    IDEMPOTENCY_STATES,
    IDEMPOTENCY_OUTCOMES,
    LIMITS,
    QUEUE_DEFAULTS,
    SYNC_DEFAULTS,
    STORE_DEFAULTS,
    IDEMPOTENCY_DEFAULTS,
    FINANCIAL_DEFAULTS,
} =
    require('./constants');

const {
    createOperationHash,
    hashIdempotencyKey,
    fingerprintEnvelope,
    validateEnvelope,
} =
    require('./crypto');

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
 * Optional SQLite driver
 * =============================================================================
 */

let Database =
    null;

let sqliteLoadError =
    null;

try {
    // eslint-disable-next-line global-require
    Database =
        require('better-sqlite3');
} catch (
    error
) {
    sqliteLoadError =
        error;
}

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const COMPONENT =
    'offline.db';

const SCHEMA_VERSION =
    1;

const DEFAULT_DIRECTORY =
    path.resolve(
        process.cwd(),
        'data',
        'offline',
    );

const DEFAULT_DATABASE_FILENAME =
    'titech-offline.db';

const DEFAULT_DATABASE_PATH =
    path.join(
        DEFAULT_DIRECTORY,
        DEFAULT_DATABASE_FILENAME,
    );

const DATABASE_OPEN_MODES =
    Object.freeze({
        READ_WRITE:
            'read-write',

        READ_ONLY:
            'read-only',
    });

const RECORD_TYPES =
    Object.freeze({
        OPERATION:
            'operation',

        OUTBOX:
            'outbox',

        INBOX:
            'inbox',

        CHECKPOINT:
            'checkpoint',

        CONFLICT:
            'conflict',

        IDEMPOTENCY:
            'idempotency',

        AUDIT:
            'audit',

        METADATA:
            'metadata',
    });

const DEFAULTS =
    Object.freeze({
        path:
            process.env.OFFLINE_DB_PATH ||
            DEFAULT_DATABASE_PATH,

        directory:
            process.env.OFFLINE_DB_DIRECTORY ||
            DEFAULT_DIRECTORY,

        mode:
            DATABASE_OPEN_MODES
                .READ_WRITE,

        busyTimeoutMs:
            5_000,

        synchronous:
            'FULL',

        journalMode:
            'WAL',

        foreignKeys:
            true,

        secureDelete:
            true,

        autoVacuum:
            'INCREMENTAL',

        checkpointMode:
            'PASSIVE',

        maxPageCount:
            2_000_000,

        pageSize:
            4096,

        maxOperationPayloadBytes:
            LIMITS
                .MAX_OPERATION_PAYLOAD_BYTES,

        maxOperationMetadataBytes:
            LIMITS
                .MAX_OPERATION_METADATA_BYTES,

        maxQueueSize:
            LIMITS
                .MAX_QUEUE_SIZE,

        transactionTimeoutMs:
            30_000,

        defaultPageSize:
            100,

        maxPageSize:
            1_000,

        operationRetentionMs:
            QUEUE_DEFAULTS
                .SUCCESS_RETENTION_MS,

        failureRetentionMs:
            QUEUE_DEFAULTS
                .FAILURE_RETENTION_MS,

        conflictRetentionMs:
            SYNC_DEFAULTS
                .MAX_OPERATION_AGE_MS,

        idempotencyRetentionMs:
            IDEMPOTENCY_DEFAULTS
                .TTL_MS,

        auditRetentionMs:
            STORE_DEFAULTS
                .MAX_RECORDS,

        requireEncryptedPayload:
            STORE_DEFAULTS
                .ENCRYPTION_REQUIRED,

        requireIntegrityHash:
            true,

        requireIdempotencyForFinancial:
            FINANCIAL_DEFAULTS
                .REQUIRE_IDEMPOTENCY,

        allowPlaintextPayload:
            false,

        strict:
            true,

        createDirectory:
            true,

        initializeSchema:
            true,

        checkpointOnOpen:
            false,
    });

/**
 * =============================================================================
 * Error
 * =============================================================================
 */

class OfflineDatabaseError
    extends Error {

    constructor(
        message,
        options = {},
    ) {

        super(message);

        this.name =
            'OfflineDatabaseError';

        this.code =
            options.code ||
            'TITECH_OFFLINE_DATABASE_ERROR';

        this.operation =
            options.operation ||
            null;

        this.recordType =
            options.recordType ||
            null;

        this.recordId =
            options.recordId ||
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
            OfflineDatabaseError,
        );
    }
}

/**
 * =============================================================================
 * Utility functions
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
        // Offline persistence must not depend on logging availability.
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
        typeof structuredClone ===
        'function'
    ) {

        try {
            return structuredClone(
                value,
            );
        } catch {
            // Fallback.
        }
    }

    if (
        Buffer.isBuffer(
            value,
        )
    ) {

        return Buffer.from(
            value,
        );
    }

    if (
        Array.isArray(
            value,
        )
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

function normalizeId(
    value,
    field,
) {

    const id =
        String(
            value ||
            '',
        ).trim();

    if (
        !id
    ) {

        throw new OfflineDatabaseError(
            `${field} is required.`,
            {
                code:
                    'TITECH_OFFLINE_DATABASE_INVALID_IDENTIFIER',
            },
        );
    }

    if (
        id.length >
        255
    ) {

        throw new OfflineDatabaseError(
            `${field} exceeds the maximum supported length.`,
            {
                code:
                    'TITECH_OFFLINE_DATABASE_IDENTIFIER_TOO_LONG',
            },
        );
    }

    return id;
}

function normalizeInteger(
    value,
    fallback,
) {

    const number =
        Number(
            value,
        );

    return Number.isInteger(
        number,
    )
        ? number
        : fallback;
}

function nowMs() {

    return Date.now();
}

function isoNow() {

    return new Date().toISOString();
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

        throw new OfflineDatabaseError(
            `${field} cannot be serialized.`,
            {
                code:
                    'TITECH_OFFLINE_DATABASE_SERIALIZATION_FAILED',

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

        throw new OfflineDatabaseError(
            `${field} exceeds the configured size limit.`,
            {
                code:
                    'TITECH_OFFLINE_DATABASE_PAYLOAD_TOO_LARGE',

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
        value === null ||
        value === undefined ||
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

        throw new OfflineDatabaseError(
            `${field} contains invalid JSON.`,
            {
                code:
                    'TITECH_OFFLINE_DATABASE_INVALID_JSON',

                cause:
                    error,
            },
        );
    }
}

function normalizeState(
    value,
    allowed,
    field,
) {

    const normalized =
        String(
            value ||
            '',
        )
            .trim()
            .toLowerCase();

    if (
        !allowed.includes(
            normalized,
        )
    ) {

        throw new OfflineDatabaseError(
            `Invalid ${field}.`,
            {
                code:
                    'TITECH_OFFLINE_DATABASE_INVALID_STATE',

                details: {
                    field,
                    allowed,
                    received:
                        normalized,
                },
            },
        );
    }

    return normalized;
}

function safeBoolean(
    value,
) {

    return (
        value ===
        true ||
        value ===
        1 ||
        value ===
        '1' ||
        (
            typeof value ===
                'string' &&
            value
                .toLowerCase()
                .trim() ===
                'true'
        )
    );
}

/**
 * =============================================================================
 * Database wrapper
 * =============================================================================
 */

class OfflineDatabase {

    constructor(
        options = {},
    ) {

        this.options =
            Object.freeze({
                ...DEFAULTS,
                ...options,
            });

        this.db =
            null;

        this.initialized =
            false;

        this.closed =
            false;

        this.readOnly =
            this.options.mode ===
            DATABASE_OPEN_MODES
                .READ_ONLY;

        this.transactionDepth =
            0;

        this.schemaVersion =
            0;

        this.startedAt =
            null;

        this.lastCheckpointAt =
            null;

        this.lastCleanupAt =
            null;

        this.lastIntegrityCheckAt =
            null;

        this.lastError =
            null;

        this.metrics = {
            reads:
                0,

            writes:
                0,

            transactions:
                0,

            commits:
                0,

            rollbacks:
                0,

            operationsInserted:
                0,

            operationsUpdated:
                0,

            operationsDeleted:
                0,

            conflictsInserted:
                0,

            idempotencyHits:
                0,

            idempotencyConflicts:
                0,
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Assert database availability.
     * -------------------------------------------------------------------------
     */

    assertReady() {

        if (
            !this.initialized ||
            this.closed ||
            !this.db
        ) {

            throw new OfflineDatabaseError(
                'TITech offline database is not initialized.',
                {
                    code:
                        'TITECH_OFFLINE_DATABASE_NOT_READY',
                },
            );
        }

        return true;
    }

    /**
     * -------------------------------------------------------------------------
     * Ensure parent directory exists.
     * -------------------------------------------------------------------------
     */

    ensureDirectory() {

        if (
            !this.options
                .createDirectory
        ) {

            return;
        }

        const databasePath =
            path.resolve(
                this.options.path,
            );

        const directory =
            path.dirname(
                databasePath,
            );

        try {

            fs.mkdirSync(
                directory,
                {
                    recursive:
                        true,
                    mode:
                        0o700,
                },
            );

            try {

                fs.chmodSync(
                    directory,
                    0o700,
                );

            } catch {
                // Windows/filesystems may not support chmod semantics.
            }

        } catch (
            error
        ) {

            throw new OfflineDatabaseError(
                'Unable to create TITech offline database directory.',
                {
                    code:
                        'TITECH_OFFLINE_DATABASE_DIRECTORY_FAILED',

                    cause:
                        error,

                    details: {
                        directory,
                    },
                },
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Validate file path.
     * -------------------------------------------------------------------------
     */

    validateDatabasePath() {

        const databasePath =
            path.resolve(
                this.options.path,
            );

        if (
            databasePath ===
            path.parse(
                databasePath,
            ).root
        ) {

            throw new OfflineDatabaseError(
                'TITech offline database path cannot point to a filesystem root.',
                {
                    code:
                        'TITECH_OFFLINE_DATABASE_INVALID_PATH',
                },
            );
        }

        return databasePath;
    }

    /**
     * -------------------------------------------------------------------------
     * Initialize database.
     * -------------------------------------------------------------------------
     */

    initialize() {

        if (
            this.initialized &&
            !this.closed
        ) {

            return this;
        }

        if (
            !Database
        ) {

            throw new OfflineDatabaseError(
                'TITech offline database requires the "better-sqlite3" package. No weaker JSON/file fallback is permitted.',
                {
                    code:
                        'TITECH_OFFLINE_DATABASE_DRIVER_UNAVAILABLE',

                    cause:
                        sqliteLoadError,
                },
            );
        }

        const databasePath =
            this.validateDatabasePath();

        this.ensureDirectory();

        try {

            this.db =
                new Database(
                    databasePath,
                    this.readOnly
                        ? {
                            readonly:
                                true,

                            fileMustExist:
                                true,

                            timeout:
                                this.options
                                    .busyTimeoutMs,
                        }
                        : {
                            readonly:
                                false,

                            fileMustExist:
                                false,

                            timeout:
                                this.options
                                    .busyTimeoutMs,
                        },
                );

            this.applyPragmas();

            if (
                this.options
                    .initializeSchema &&
                !this.readOnly
            ) {

                this.initializeSchema();
            }

            this.schemaVersion =
                this.getSchemaVersion();

            this.initialized =
                true;

            this.closed =
                false;

            this.startedAt =
                isoNow();

            this.lastError =
                null;

            if (
                this.options
                    .checkpointOnOpen
            ) {

                this.checkpoint();
            }

            log(
                'info',
                {
                    path:
                        databasePath,

                    readOnly:
                        this.readOnly,

                    schemaVersion:
                        this.schemaVersion,
                },
                'TITech offline database initialized.',
            );

            return this;

        } catch (
            error
        ) {

            this.lastError =
                error;

            try {
                this.db?.close();
            } catch {
                // Ignore cleanup failure.
            }

            this.db =
                null;

            this.initialized =
                false;

            this.closed =
                true;

            if (
                error instanceof
                OfflineDatabaseError
            ) {

                throw error;
            }

            throw new OfflineDatabaseError(
                'TITech offline database initialization failed.',
                {
                    code:
                        'TITECH_OFFLINE_DATABASE_INITIALIZATION_FAILED',

                    cause:
                        error,
                },
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * SQLite pragmas.
     * -------------------------------------------------------------------------
     */

    applyPragmas() {

        this.assertDatabaseDriver();

        try {

            this.db.pragma(
                `busy_timeout = ${Number(
                    this.options
                        .busyTimeoutMs,
                )}`,
            );

            this.db.pragma(
                `journal_mode = ${
                    this.options
                        .journalMode
                }`,
            );

            this.db.pragma(
                `synchronous = ${
                    this.options
                        .synchronous
                }`,
            );

            this.db.pragma(
                `foreign_keys = ${
                    this.options
                        .foreignKeys
                        ? 'ON'
                        : 'OFF'
                }`,
            );

            this.db.pragma(
                `secure_delete = ${
                    this.options
                        .secureDelete
                        ? 'ON'
                        : 'OFF'
                }`,
            );

            this.db.pragma(
                `auto_vacuum = ${
                    this.options
                        .autoVacuum
                }`,
            );

        } catch (
            error
        ) {

            throw new OfflineDatabaseError(
                'TITech offline database security/consistency pragmas could not be applied.',
                {
                    code:
                        'TITECH_OFFLINE_DATABASE_PRAGMA_FAILED',

                    cause:
                        error,
                },
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Assert raw SQLite availability.
     * -------------------------------------------------------------------------
     */

    assertDatabaseDriver() {

        if (
            !this.db
        ) {

            throw new OfflineDatabaseError(
                'TITech offline SQLite database handle is unavailable.',
                {
                    code:
                        'TITECH_OFFLINE_DATABASE_HANDLE_UNAVAILABLE',
                },
            );
        }

        return true;
    }

    /**
     * -------------------------------------------------------------------------
     * Initialize schema.
     * -------------------------------------------------------------------------
     */

    initializeSchema() {

        this.assertDatabaseDriver();

        const schemaSql = `
            CREATE TABLE IF NOT EXISTS metadata (
                key TEXT PRIMARY KEY NOT NULL,
                value TEXT,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS operations (
                operation_id TEXT PRIMARY KEY NOT NULL,
                operation_type TEXT NOT NULL,
                state TEXT NOT NULL,
                persistence_state TEXT NOT NULL,
                priority INTEGER NOT NULL DEFAULT 50,

                tenant_id TEXT,
                user_id TEXT,
                device_id TEXT,
                client_id TEXT,

                idempotency_key TEXT,
                idempotency_hash TEXT,

                correlation_id TEXT,
                causation_id TEXT,
                trace_id TEXT,

                parent_operation_id TEXT,

                payload TEXT,
                payload_encrypted INTEGER NOT NULL DEFAULT 0,
                payload_integrity_hash TEXT,
                payload_fingerprint TEXT,

                metadata TEXT,

                version INTEGER NOT NULL DEFAULT 1,
                revision INTEGER NOT NULL DEFAULT 1,
                etag TEXT,

                attempts INTEGER NOT NULL DEFAULT 0,
                max_attempts INTEGER NOT NULL DEFAULT 5,
                next_retry_at INTEGER,

                last_error_code TEXT,
                last_error_message TEXT,

                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                expires_at INTEGER,

                reconciled_at INTEGER,
                completed_at INTEGER,

                is_financial INTEGER NOT NULL DEFAULT 0,
                requires_reconciliation INTEGER NOT NULL DEFAULT 0,
                conflict_strategy TEXT,

                created_by TEXT,
                updated_by TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_operations_state_priority
                ON operations(state, priority DESC, created_at ASC);

            CREATE INDEX IF NOT EXISTS idx_operations_retry
                ON operations(state, next_retry_at);

            CREATE INDEX IF NOT EXISTS idx_operations_type
                ON operations(operation_type);

            CREATE INDEX IF NOT EXISTS idx_operations_user
                ON operations(user_id, created_at DESC);

            CREATE INDEX IF NOT EXISTS idx_operations_tenant
                ON operations(tenant_id, created_at DESC);

            CREATE INDEX IF NOT EXISTS idx_operations_idempotency
                ON operations(idempotency_hash);

            CREATE INDEX IF NOT EXISTS idx_operations_reconciliation
                ON operations(requires_reconciliation, state);

            CREATE TABLE IF NOT EXISTS outbox (
                operation_id TEXT PRIMARY KEY NOT NULL,
                available_at INTEGER NOT NULL,
                locked_at INTEGER,
                lock_token TEXT,
                FOREIGN KEY(operation_id)
                    REFERENCES operations(operation_id)
                    ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_outbox_available
                ON outbox(available_at ASC);

            CREATE TABLE IF NOT EXISTS inbox (
                remote_operation_id TEXT PRIMARY KEY NOT NULL,
                operation_id TEXT,
                payload TEXT,
                payload_integrity_hash TEXT,
                received_at INTEGER NOT NULL,
                processed_at INTEGER,
                state TEXT NOT NULL,
                metadata TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_inbox_state
                ON inbox(state, received_at ASC);

            CREATE TABLE IF NOT EXISTS checkpoints (
                name TEXT PRIMARY KEY NOT NULL,
                cursor TEXT,
                version INTEGER NOT NULL DEFAULT 1,
                updated_at INTEGER NOT NULL,
                metadata TEXT
            );

            CREATE TABLE IF NOT EXISTS conflicts (
                conflict_id TEXT PRIMARY KEY NOT NULL,
                operation_id TEXT,
                conflict_type TEXT NOT NULL,
                severity TEXT NOT NULL,
                strategy TEXT NOT NULL,
                local_version INTEGER,
                remote_version INTEGER,
                local_hash TEXT,
                remote_hash TEXT,
                local_payload TEXT,
                remote_payload TEXT,
                state TEXT NOT NULL,
                resolution TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                resolved_at INTEGER,
                metadata TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_conflicts_state
                ON conflicts(state, created_at ASC);

            CREATE INDEX IF NOT EXISTS idx_conflicts_operation
                ON conflicts(operation_id);

            CREATE TABLE IF NOT EXISTS idempotency (
                idempotency_hash TEXT PRIMARY KEY NOT NULL,
                key_fingerprint TEXT NOT NULL,
                operation_id TEXT NOT NULL,
                request_hash TEXT NOT NULL,
                outcome TEXT NOT NULL,
                state TEXT NOT NULL,
                response_hash TEXT,
                status_code INTEGER,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                metadata TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_idempotency_operation
                ON idempotency(operation_id);

            CREATE INDEX IF NOT EXISTS idx_idempotency_expiry
                ON idempotency(expires_at);

            CREATE TABLE IF NOT EXISTS audit (
                audit_id TEXT PRIMARY KEY NOT NULL,
                operation_id TEXT,
                event_type TEXT NOT NULL,
                actor_id TEXT,
                tenant_id TEXT,
                correlation_id TEXT,
                payload TEXT,
                integrity_hash TEXT,
                created_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_audit_operation
                ON audit(operation_id, created_at ASC);

            CREATE INDEX IF NOT EXISTS idx_audit_tenant
                ON audit(tenant_id, created_at DESC);

            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY NOT NULL,
                applied_at INTEGER NOT NULL
            );
        `;

        try {

            this.db.exec(
                schemaSql,
            );

            this.setMetadata(
                'schema_version',
                String(
                    SCHEMA_VERSION,
                ),
            );

            this.setMetadata(
                'application',
                'TITech Community Capital',
            );

            this.setMetadata(
                'component',
                COMPONENT,
            );

            this.setMetadata(
                'created_at',
                isoNow(),
            );

            const migrationExists =
                this.db
                    .prepare(
                        `
                            SELECT version
                            FROM schema_migrations
                            WHERE version = ?
                        `,
                    )
                    .get(
                        SCHEMA_VERSION,
                    );

            if (
                !migrationExists
            ) {

                this.db
                    .prepare(
                        `
                            INSERT INTO schema_migrations
                                (version, applied_at)
                            VALUES
                                (?, ?)
                        `,
                    )
                    .run(
                        SCHEMA_VERSION,
                        nowMs(),
                    );
            }

            this.schemaVersion =
                SCHEMA_VERSION;

        } catch (
            error
        ) {

            throw new OfflineDatabaseError(
                'TITech offline database schema initialization failed.',
                {
                    code:
                        'TITECH_OFFLINE_DATABASE_SCHEMA_FAILED',

                    cause:
                        error,
                },
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Schema version.
     * -------------------------------------------------------------------------
     */

    getSchemaVersion() {

        this.assertDatabaseDriver();

        try {

            const row =
                this.db
                    .prepare(
                        `
                            SELECT value
                            FROM metadata
                            WHERE key = 'schema_version'
                        `,
                    )
                    .get();

            return Number(
                row?.value ||
                0,
            );

        } catch {

            return 0;
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Metadata.
     * -------------------------------------------------------------------------
     */

    setMetadata(
        key,
        value,
    ) {

        this.assertDatabaseDriver();

        const normalizedKey =
            normalizeId(
                key,
                'metadata key',
            );

        const serialized =
            typeof value ===
                'string'
                ? value
                : serializeJson(
                    value,
                    64 * 1024,
                    'metadata value',
                );

        this.db
            .prepare(
                `
                    INSERT INTO metadata
                        (key, value, updated_at)
                    VALUES
                        (?, ?, ?)
                    ON CONFLICT(key)
                    DO UPDATE SET
                        value = excluded.value,
                        updated_at = excluded.updated_at
                `,
            )
            .run(
                normalizedKey,
                serialized,
                nowMs(),
            );

        return serialized;
    }

    getMetadata(
        key,
    ) {

        this.assertDatabaseDriver();

        const normalizedKey =
            normalizeId(
                key,
                'metadata key',
            );

        const row =
            this.db
                .prepare(
                    `
                        SELECT
                            key,
                            value,
                            updated_at
                        FROM metadata
                        WHERE key = ?
                    `,
                )
                .get(
                    normalizedKey,
                );

        return row || null;
    }

    /**
     * -------------------------------------------------------------------------
     * Transaction helper.
     * -------------------------------------------------------------------------
     */

    transaction(
        callback,
    ) {

        this.assertReady();

        if (
            typeof callback !==
            'function'
        ) {

            throw new OfflineDatabaseError(
                'TITech offline database transaction requires a callback.',
                {
                    code:
                        'TITECH_OFFLINE_DATABASE_INVALID_TRANSACTION',
                },
            );
        }

        const transaction =
            this.db.transaction(
                () => {

                    this.transactionDepth +=
                        1;

                    try {

                        this.metrics
                            .transactions +=
                            1;

                        const result =
                            callback(
                                this,
                            );

                        this.metrics
                            .commits +=
                            1;

                        return result;

                    } catch (
                        error
                    ) {

                        this.metrics
                            .rollbacks +=
                            1;

                        throw error;

                    } finally {

                        this.transactionDepth -=
                            1;
                    }
                },
            );

        try {

            return transaction();

        } catch (
            error
        ) {

            if (
                error instanceof
                OfflineDatabaseError
            ) {

                throw error;
            }

            throw new OfflineDatabaseError(
                'TITech offline database transaction failed.',
                {
                    code:
                        'TITECH_OFFLINE_DATABASE_TRANSACTION_FAILED',

                    cause:
                        error,
                },
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Prepare encrypted/integrity-safe payload.
     * -------------------------------------------------------------------------
     */

    normalizePayload(
        payload,
        options = {},
    ) {

        const maxBytes =
            options.maxPayloadBytes ||
            this.options
                .maxOperationPayloadBytes;

        const serialized =
            serializeJson(
                payload,
                maxBytes,
                'operation payload',
            );

        const integrityHash =
            options.integrityHash ||
            createOperationHash(
                {
                    payload,
                },
            );

        return {
            payload:
                serialized,

            payloadEncrypted:
                Boolean(
                    options.encrypted,
                ),

            payloadIntegrityHash:
                integrityHash,

            payloadFingerprint:
                options.envelope
                    ? fingerprintEnvelope(
                        options.envelope,
                    )
                    : null,
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Validate operation payload security policy.
     * -------------------------------------------------------------------------
     */

    validateOperationPayload(
        operation,
    ) {

        const encrypted =
            Boolean(
                operation
                    .payloadEncrypted,
            );

        if (
            this.options
                .requireEncryptedPayload &&
            !encrypted &&
            !this.options
                .allowPlaintextPayload
        ) {

            throw new OfflineDatabaseError(
                'TITech offline operation payload must be encrypted.',
                {
                    code:
                        'TITECH_OFFLINE_DATABASE_ENCRYPTION_REQUIRED',
            },
        );

        if (
            encrypted &&
            operation.envelope
        ) {

            if (
                !validateEnvelope(
                    operation.envelope,
                )
            ) {

                throw new OfflineDatabaseError(
                    'TITech offline encrypted payload envelope is invalid.',
                    {
                        code:
                            'TITECH_OFFLINE_DATABASE_INVALID_ENVELOPE',
                    },
                );
            }
        }

        return true;
    }

    /**
     * -------------------------------------------------------------------------
     * Normalize operation.
     * -------------------------------------------------------------------------
     */

    normalizeOperation(
        operation,
        options = {},
    ) {

        if (
            !operation ||
            typeof operation !==
            'object'
        ) {

            throw new OfflineDatabaseError(
                'TITech offline operation must be an object.',
                {
                    code:
                        'TITECH_OFFLINE_DATABASE_INVALID_OPERATION',
                },
            );
        }

        const operationId =
            normalizeId(
                operation.operationId ||
                crypto.randomUUID(),
                'operationId',
            );

        const operationType =
            String(
                operation.operationType ||
                OPERATION_TYPES
                    .COMMAND,
            )
                .trim()
                .toLowerCase();

        const state =
            normalizeState(
                operation.state ||
                OPERATION_STATES
                    .PENDING,
                Object.values(
                    OPERATION_STATES,
                ),
                'operation state',
            );

        const persistenceState =
            normalizeState(
                operation.persistenceState ||
                PERSISTENCE_STATES
                    .DIRTY,
                Object.values(
                    PERSISTENCE_STATES,
                ),
                'persistence state',
            );

        const priority =
            normalizeInteger(
                operation.priority,
                QUEUE_DEFAULTS
                    .PRIORITY,
            );

        if (
            !Object.values(
                OPERATION_STATES,
            ).includes(
                state,
            )
        ) {

            throw new OfflineDatabaseError(
                'Invalid TITech offline operation state.',
                {
                    code:
                        'TITECH_OFFLINE_DATABASE_INVALID_STATE',
                },
            );
        }

        const financial =
            Boolean(
                operation.isFinancial ||
                FINANCIAL_OPERATION_TYPES.includes(
                    operationType,
                ),
            );

        if (
            financial &&
            this.options
                .requireIdempotencyForFinancial &&
            !operation.idempotencyKey &&
            !operation.idempotencyHash
        ) {

            throw new OfflineDatabaseError(
                'Financial TITech offline operations require idempotency protection.',
                {
                    code:
                        'TITECH_OFFLINE_DATABASE_IDEMPOTENCY_REQUIRED',

                    operation:
                        'normalizeOperation',
                },
            );
        }

        const now =
            nowMs();

        const createdAt =
            normalizeInteger(
                operation.createdAt,
                now,
            );

        const updatedAt =
            normalizeInteger(
                operation.updatedAt,
                now,
            );

        const idempotencyHash =
            operation.idempotencyHash ||
            (
                operation.idempotencyKey
                    ? hashIdempotencyKey(
                        operation.idempotencyKey,
                    )
                    : null
            );

        const payloadInfo =
            operation.payloadEncrypted !==
                undefined
                ? {
                    payload:
                        typeof operation.payload ===
                            'string'
                            ? operation.payload
                            : serializeJson(
                                operation.payload,
                                this.options
                                    .maxOperationPayloadBytes,
                                'operation payload',
                            ),

                    payloadEncrypted:
                        safeBoolean(
                            operation
                                .payloadEncrypted,
                        ),

                    payloadIntegrityHash:
                        operation
                            .payloadIntegrityHash ||
                        createOperationHash(
                            operation,
                        ),

                    payloadFingerprint:
                        operation
                            .payloadFingerprint ||
                        null,
                }
                : this.normalizePayload(
                    operation.payload,
                    options,
                );

        const metadataSerialized =
            serializeJson(
                operation.metadata ||
                {},
                this.options
                    .maxOperationMetadataBytes,
                'operation metadata',
            );

        const version =
            normalizeInteger(
                operation.version,
                1,
            );

        const revision =
            normalizeInteger(
                operation.revision,
                1,
            );

        const maxAttempts =
            normalizeInteger(
                operation.maxAttempts,
                QUEUE_DEFAULTS
                    .MAX_ATTEMPTS,
            );

        const expiresAt =
            normalizeInteger(
                operation.expiresAt,
                null,
            );

        const normalized = {
            operationId,

            operationType,

            state,

            persistenceState,

            priority,

            tenantId:
                operation.tenantId ||
                null,

            userId:
                operation.userId ||
                null,

            deviceId:
                operation.deviceId ||
                null,

            clientId:
                operation.clientId ||
                null,

            idempotencyKey:
                operation.idempotencyKey ||
                null,

            idempotencyHash,

            correlationId:
                operation.correlationId ||
                null,

            causationId:
                operation.causationId ||
                null,

            traceId:
                operation.traceId ||
                null,

            parentOperationId:
                operation.parentOperationId ||
                null,

            payload:
                payloadInfo.payload,

            payloadEncrypted:
                payloadInfo.payloadEncrypted,

            payloadIntegrityHash:
                payloadInfo
                    .payloadIntegrityHash,

            payloadFingerprint:
                payloadInfo
                    .payloadFingerprint,

            metadata:
                metadataSerialized,

            version,

            revision,

            etag:
                operation.etag ||
                crypto
                    .createHash(
                        'sha256',
                    )
                    .update(
                        `${operationId}:${version}:${revision}`,
                    )
                    .digest(
                        'hex',
                    ),

            attempts:
                normalizeInteger(
                    operation.attempts,
                    0,
                ),

            maxAttempts,

            nextRetryAt:
                normalizeInteger(
                    operation.nextRetryAt,
                    null,
                ),

            lastErrorCode:
                operation.lastErrorCode ||
                null,

            lastErrorMessage:
                operation.lastErrorMessage ||
                null,

            createdAt,

            updatedAt,

            expiresAt,

            reconciledAt:
                normalizeInteger(
                    operation.reconciledAt,
                    null,
                ),

            completedAt:
                normalizeInteger(
                    operation.completedAt,
                    null,
                ),

            isFinancial:
                financial
                    ? 1
                    : 0,

            requiresReconciliation:
                (
                    operation
                        .requiresReconciliation ??
                    financial
                )
                    ? 1
                    : 0,

            conflictStrategy:
                operation.conflictStrategy ||
                (
                    financial
                        ? CONFLICT_STRATEGIES
                            .FINANCIAL_HOLD
                        : CONFLICT_STRATEGIES
                            .MANUAL
                ),

            createdBy:
                operation.createdBy ||
                null,

            updatedBy:
                operation.updatedBy ||
                null,
        };

        this.validateOperationPayload(
            normalized,
        );

        return normalized;
    }

    /**
     * -------------------------------------------------------------------------
     * Insert operation.
     * -------------------------------------------------------------------------
     */

    insertOperation(
        operation,
        options = {},
    ) {

        this.assertReady();

        if (
            this.readOnly
        ) {

            throw new OfflineDatabaseError(
                'TITech offline database is read-only.',
                {
                    code:
                        'TITECH_OFFLINE_DATABASE_READ_ONLY',
                },
            );
        }

        const normalized =
            this.normalizeOperation(
                operation,
                options,
            );

        return this.transaction(
            () => {

                const existing =
                    this.db
                        .prepare(
                            `
                                SELECT
                                    operation_id,
                                    idempotency_hash,
                                    payload_integrity_hash
                                FROM operations
                                WHERE operation_id = ?
                            `,
                        )
                        .get(
                            normalized
                                .operationId,
                        );

                if (
                    existing
                ) {

                    throw new OfflineDatabaseError(
                        'TITech offline operation already exists.',
                        {
                            code:
                                'TITECH_OFFLINE_DATABASE_DUPLICATE_OPERATION',

                            operation:
                                normalized
                                    .operationType,

                            recordType:
                                RECORD_TYPES
                                    .OPERATION,

                            recordId:
                                normalized
                                    .operationId,
                        },
                    );
                }

                if (
                    normalized
                        .idempotencyHash
                ) {

                    const idempotencyConflict =
                        this.db
                            .prepare(
                                `
                                    SELECT
                                        operation_id
                                    FROM operations
                                    WHERE idempotency_hash = ?
                                `,
                            )
                            .get(
                                normalized
                                    .idempotencyHash,
                            );

                    if (
                        idempotencyConflict
                    ) {

                        this.metrics
                            .idempotencyConflicts +=
                            1;

                        throw new OfflineDatabaseError(
                            'TITech offline operation conflicts with an existing idempotency key.',
                            {
                                code:
                                    'TITECH_OFFLINE_DATABASE_IDEMPOTENCY_CONFLICT',

                                operation:
                                    normalized
                                        .operationType,

                                recordType:
                                    RECORD_TYPES
                                        .OPERATION,

                                recordId:
                                    normalized
                                        .operationId,
                            },
                        );
                    }
                }

                const queueCount =
                    this.db
                        .prepare(
                            `
                                SELECT COUNT(*) AS count
                                FROM outbox
                            `,
                        )
                        .get()
                        .count;

                if (
                    queueCount >=
                    this.options
                        .maxQueueSize
                ) {

                    throw new OfflineDatabaseError(
                        'TITech offline operation queue is full.',
                        {
                            code:
                                'TITECH_OFFLINE_DATABASE_QUEUE_FULL',
                        },
                    );
                }

                this.db
                    .prepare(
                        `
                            INSERT INTO operations (
                                operation_id,
                                operation_type,
                                state,
                                persistence_state,
                                priority,

                                tenant_id,
                                user_id,
                                device_id,
                                client_id,

                                idempotency_key,
                                idempotency_hash,

                                correlation_id,
                                causation_id,
                                trace_id,

                                parent_operation_id,

                                payload,
                                payload_encrypted,
                                payload_integrity_hash,
                                payload_fingerprint,

                                metadata,

                                version,
                                revision,
                                etag,

                                attempts,
                                max_attempts,
                                next_retry_at,

                                last_error_code,
                                last_error_message,

                                created_at,
                                updated_at,
                                expires_at,

                                reconciled_at,
                                completed_at,

                                is_financial,
                                requires_reconciliation,
                                conflict_strategy,

                                created_by,
                                updated_by
                            )
                            VALUES (
                                @operationId,
                                @operationType,
                                @state,
                                @persistenceState,
                                @priority,

                                @tenantId,
                                @userId,
                                @deviceId,
                                @clientId,

                                @idempotencyKey,
                                @idempotencyHash,

                                @correlationId,
                                @causationId,
                                @traceId,

                                @parentOperationId,

                                @payload,
                                @payloadEncrypted,
                                @payloadIntegrityHash,
                                @payloadFingerprint,

                                @metadata,

                                @version,
                                @revision,
                                @etag,

                                @attempts,
                                @maxAttempts,
                                @nextRetryAt,

                                @lastErrorCode,
                                @lastErrorMessage,

                                @createdAt,
                                @updatedAt,
                                @expiresAt,

                                @reconciledAt,
                                @completedAt,

                                @isFinancial,
                                @requiresReconciliation,
                                @conflictStrategy,

                                @createdBy,
                                @updatedBy
                            )
                        `,
                    )
                    .run(
                        normalized,
                    );

                if (
                    stateAllowsOutbox(
                        normalized.state,
                    )
                ) {

                    this.db
                        .prepare(
                            `
                                INSERT INTO outbox (
                                    operation_id,
                                    available_at
                                )
                                VALUES (?, ?)
                            `,
                        )
                        .run(
                            normalized
                                .operationId,
                            normalized
                                .nextRetryAt ||
                                nowMs(),
                        );
                }

                if (
                    normalized
                        .idempotencyHash
                ) {

                    this.createIdempotencyRecord(
                        {
                            idempotencyHash:
                                normalized
                                    .idempotencyHash,

                            keyFingerprint:
                                normalized
                                    .idempotencyHash,

                            operationId:
                                normalized
                                    .operationId,

                            requestHash:
                                normalized
                                    .payloadIntegrityHash,

                            outcome:
                                IDEMPOTENCY_OUTCOMES
                                    .CREATED,

                            state:
                                IDEMPOTENCY_STATES
                                    .PENDING,

                            expiresAt:
                                normalized
                                    .expiresAt ||
                                nowMs() +
                                this.options
                                    .idempotencyRetentionMs,
                        },
                    );
                }

                this.metrics
                    .writes +=
                    1;

                this.metrics
                    .operationsInserted +=
                    1;

                return this.getOperation(
                    normalized
                        .operationId,
                );
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Get operation.
     * -------------------------------------------------------------------------
     */

    getOperation(
        operationId,
    ) {

        this.assertReady();

        const id =
            normalizeId(
                operationId,
                'operationId',
            );

        const row =
            this.db
                .prepare(
                    `
                        SELECT *
                        FROM operations
                        WHERE operation_id = ?
                    `,
                )
                .get(
                    id,
                );

        this.metrics
            .reads +=
            1;

        return row
            ? this.deserializeOperation(
                row,
            )
            : null;
    }

    /**
     * -------------------------------------------------------------------------
     * Get operation by idempotency hash.
     * -------------------------------------------------------------------------
     */

    getOperationByIdempotencyHash(
        idempotencyHash,
    ) {

        this.assertReady();

        if (
            !idempotencyHash
        ) {

            return null;
        }

        const row =
            this.db
                .prepare(
                    `
                        SELECT *
                        FROM operations
                        WHERE idempotency_hash = ?
                        LIMIT 1
                    `,
                )
                .get(
                    String(
                        idempotencyHash,
                    ),
                );

        this.metrics
            .reads +=
            1;

        if (
            row
        ) {

            this.metrics
                .idempotencyHits +=
                1;
        }

        return row
            ? this.deserializeOperation(
                row,
            )
            : null;
    }

    /**
     * -------------------------------------------------------------------------
     * Deserialize operation.
     * -------------------------------------------------------------------------
     */

    deserializeOperation(
        row,
    ) {

        if (
            !row
        ) {

            return null;
        }

        return {
            operationId:
                row.operation_id,

            operationType:
                row.operation_type,

            state:
                row.state,

            persistenceState:
                row.persistence_state,

            priority:
                row.priority,

            tenantId:
                row.tenant_id,

            userId:
                row.user_id,

            deviceId:
                row.device_id,

            clientId:
                row.client_id,

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

            parentOperationId:
                row.parent_operation_id,

            payload:
                parseJson(
                    row.payload,
                    'operation payload',
                ),

            payloadEncrypted:
                Boolean(
                    row.payload_encrypted,
                ),

            payloadIntegrityHash:
                row.payload_integrity_hash,

            payloadFingerprint:
                row.payload_fingerprint,

            metadata:
                parseJson(
                    row.metadata,
                    'operation metadata',
                ),

            version:
                row.version,

            revision:
                row.revision,

            etag:
                row.etag,

            attempts:
                row.attempts,

            maxAttempts:
                row.max_attempts,

            nextRetryAt:
                row.next_retry_at,

            lastErrorCode:
                row.last_error_code,

            lastErrorMessage:
                row.last_error_message,

            createdAt:
                row.created_at,

            updatedAt:
                row.updated_at,

            expiresAt:
                row.expires_at,

            reconciledAt:
                row.reconciled_at,

            completedAt:
                row.completed_at,

            isFinancial:
                Boolean(
                    row.is_financial,
                ),

            requiresReconciliation:
                Boolean(
                    row.requires_reconciliation,
                ),

            conflictStrategy:
                row.conflict_strategy,

            createdBy:
                row.created_by,

            updatedBy:
                row.updated_by,
        };
    }

    /**
     * -------------------------------------------------------------------------
     * List operations.
     * -------------------------------------------------------------------------
     */

    listOperations(
        options = {},
    ) {

        this.assertReady();

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
                this.options
                    .maxPageSize,
                Math.max(
                    1,
                    normalizeInteger(
                        options.limit,
                        this.options
                            .defaultPageSize,
                    ),
                ),
            );

        const offset =
            (page - 1) *
            limit;

        const conditions =
            [];

        const params =
            {};

        if (
            options.state
        ) {

            conditions.push(
                'state = @state',
            );

            params.state =
                normalizeState(
                    options.state,
                    Object.values(
                        OPERATION_STATES,
                    ),
                    'operation state',
                );
        }

        if (
            options.operationType
        ) {

            conditions.push(
                'operation_type = @operationType',
            );

            params.operationType =
                String(
                    options.operationType,
                )
                    .trim()
                    .toLowerCase();
        }

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
            options.userId
        ) {

            conditions.push(
                'user_id = @userId',
            );

            params.userId =
                String(
                    options.userId,
                );
        }

        if (
            options.financialOnly ===
            true
        ) {

            conditions.push(
                'is_financial = 1',
            );
        }

        if (
            options.reconciliationRequired ===
            true
        ) {

            conditions.push(
                'requires_reconciliation = 1',
            );
        }

        if (
            options.before
        ) {

            conditions.push(
                'created_at < @before',
            );

            params.before =
                normalizeInteger(
                    options.before,
                    nowMs(),
                );
        }

        if (
            options.after
        ) {

            conditions.push(
                'created_at > @after',
            );

            params.after =
                normalizeInteger(
                    options.after,
                    0,
                );
        }

        const where =
            conditions.length
                ? `WHERE ${conditions.join(
                    ' AND ',
                )}`
                : '';

        const order =
            options.order ===
                'asc'
                ? 'ASC'
                : 'DESC';

        const rows =
            this.db
                .prepare(
                    `
                        SELECT *
                        FROM operations
                        ${where}
                        ORDER BY priority DESC, created_at ${order}
                        LIMIT @limit
                        OFFSET @offset
                    `,
                )
                .all({
                    ...params,

                    limit,

                    offset,
                });

        const total =
            this.db
                .prepare(
                    `
                        SELECT COUNT(*) AS count
                        FROM operations
                        ${where}
                    `,
                )
                .get(
                    params,
                )
                .count;

        this.metrics
            .reads +=
            2;

        return {
            data:
                rows.map(
                    row =>
                        this.deserializeOperation(
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
     * Claim the next outbox operation.
     * -------------------------------------------------------------------------
     */

    claimNextOperation(
        workerId,
    ) {

        this.assertReady();

        if (
            this.readOnly
        ) {

            throw new OfflineDatabaseError(
                'TITech offline database is read-only.',
                {
                    code:
                        'TITECH_OFFLINE_DATABASE_READ_ONLY',
                },
            );
        }

        const normalizedWorkerId =
            normalizeId(
                workerId ||
                crypto.randomUUID(),
                'workerId',
            );

        return this.transaction(
            () => {

                const now =
                    nowMs();

                const row =
                    this.db
                        .prepare(
                            `
                                SELECT
                                    o.*
                                FROM outbox AS b
                                INNER JOIN operations AS o
                                    ON o.operation_id = b.operation_id
                                WHERE
                                    (
                                        b.locked_at IS NULL
                                        OR
                                        b.locked_at < ?
                                    )
                                    AND
                                    b.available_at <= ?
                                    AND
                                    o.state IN (?, ?)
                                ORDER BY
                                    o.priority DESC,
                                    b.available_at ASC,
                                    o.created_at ASC
                                LIMIT 1
                            `,
                        )
                        .get(
                            now -
                            QUEUE_DEFAULTS
                                .VISIBILITY_TIMEOUT_MS,

                            now,

                            OPERATION_STATES
                                .PENDING,

                            OPERATION_STATES
                                .RETRYABLE_FAILURE,
                        );

                if (
                    !row
                ) {

                    return null;
                }

                const lockToken =
                    crypto
                        .createHash(
                            'sha256',
                        )
                        .update(
                            `${normalizedWorkerId}:${row.operation_id}:${now}:${crypto.randomUUID()}`,
                        )
                        .digest(
                            'hex',
                        );

                const updated =
                    this.db
                        .prepare(
                            `
                                UPDATE outbox
                                SET
                                    locked_at = ?,
                                    lock_token = ?
                                WHERE
                                    operation_id = ?
                                    AND (
                                        locked_at IS NULL
                                        OR locked_at < ?
                                    )
                            `,
                        )
                        .run(
                            now,
                            lockToken,
                            row.operation_id,
                            now -
                            QUEUE_DEFAULTS
                                .VISIBILITY_TIMEOUT_MS,
                        );

                if (
                    updated.changes !==
                    1
                ) {

                    return null;
                }

                this.db
                    .prepare(
                        `
                            UPDATE operations
                            SET
                                state = ?,
                                attempts = attempts + 1,
                                updated_at = ?
                            WHERE
                                operation_id = ?
                        `,
                    )
                    .run(
                        OPERATION_STATES
                            .PROCESSING,

                        now,

                        row.operation_id,
                    );

                return {
                    operation:
                        this.getOperation(
                            row.operation_id,
                        ),

                    lockToken,

                    workerId:
                        normalizedWorkerId,

                    lockedAt:
                        now,
                };
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Complete claimed operation.
     * -------------------------------------------------------------------------
     */

    completeOperation(
        operationId,
        lockToken,
        outcome = {},
    ) {

        this.assertReady();

        if (
            this.readOnly
        ) {

            throw new OfflineDatabaseError(
                'TITech offline database is read-only.',
                {
                    code:
                        'TITECH_OFFLINE_DATABASE_READ_ONLY',
                },
            );
        }

        const id =
            normalizeId(
                operationId,
                'operationId',
            );

        return this.transaction(
            () => {

                const lock =
                    this.db
                        .prepare(
                            `
                                SELECT
                                    lock_token
                                FROM outbox
                                WHERE operation_id = ?
                            `,
                        )
                        .get(
                            id,
                        );

                if (
                    !lock ||
                    lock.lock_token !==
                    lockToken
                ) {

                    throw new OfflineDatabaseError(
                        'TITech offline operation lock is invalid or expired.',
                        {
                            code:
                                'TITECH_OFFLINE_DATABASE_INVALID_LOCK',

                            recordId:
                                id,
                        },
                    );
                }

                const current =
                    this.getOperation(
                        id,
                    );

                if (
                    !current
                ) {

                    throw new OfflineDatabaseError(
                        'TITech offline operation does not exist.',
                        {
                            code:
                                'TITECH_OFFLINE_DATABASE_OPERATION_NOT_FOUND',

                            recordId:
                                id,
                        },
                    );
                }

                const now =
                    nowMs();

                const success =
                    outcome.success !==
                    false;

                const targetState =
                    success
                        ? OPERATION_STATES
                            .SUCCEEDED
                        : (
                            outcome.retryable
                                ? OPERATION_STATES
                                    .RETRYABLE_FAILURE
                                : OPERATION_STATES
                                    .FAILED
                        );

                const nextRetryAt =
                    outcome.retryAt ||
                    (
                        outcome.retryable
                            ? now +
                              QUEUE_DEFAULTS
                                .INITIAL_RETRY_DELAY_MS
                            : null
                    );

                const completedAt =
                    success
                        ? now
                        : null;

                this.db
                    .prepare(
                        `
                            UPDATE operations
                            SET
                                state = ?,
                                persistence_state = ?,
                                next_retry_at = ?,
                                last_error_code = ?,
                                last_error_message = ?,
                                completed_at = ?,
                                reconciled_at = ?,
                                updated_at = ?
                            WHERE operation_id = ?
                        `,
                    )
                    .run(
                        targetState,

                        success
                            ? PERSISTENCE_STATES
                                .SYNCED
                            : PERSISTENCE_STATES
                                .STALE,

                        nextRetryAt,

                        outcome.errorCode ||
                            null,

                        outcome.errorMessage ||
                            null,

                        completedAt,

                        outcome.reconciled
                            ? now
                            : null,

                        now,

                        id,
                    );

                this.db
                    .prepare(
                        `
                            DELETE FROM outbox
                            WHERE operation_id = ?
                        `,
                    )
                    .run(
                        id,
                    );

                if (
                    !success &&
                    outcome.retryable
                ) {

                    this.db
                        .prepare(
                            `
                                INSERT INTO outbox (
                                    operation_id,
                                    available_at
                                )
                                VALUES (?, ?)
                                ON CONFLICT(operation_id)
                                DO UPDATE SET
                                    available_at = excluded.available_at,
                                    locked_at = NULL,
                                    lock_token = NULL
                            `,
                        )
                        .run(
                            id,
                            nextRetryAt,
                        );
                }

                this.metrics
                    .writes +=
                    1;

                this.metrics
                    .operationsUpdated +=
                    1;

                return this.getOperation(
                    id,
                );
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Cancel operation.
     * -------------------------------------------------------------------------
     */

    cancelOperation(
        operationId,
        reason =
            'cancelled',
    ) {

        this.assertReady();

        if (
            this.readOnly
        ) {

            throw new OfflineDatabaseError(
                'TITech offline database is read-only.',
                {
                    code:
                        'TITECH_OFFLINE_DATABASE_READ_ONLY',
                },
            );
        }

        const id =
            normalizeId(
                operationId,
                'operationId',
            );

        return this.transaction(
            () => {

                const updated =
                    this.db
                        .prepare(
                            `
                                UPDATE operations
                                SET
                                    state = ?,
                                    persistence_state = ?,
                                    last_error_code = ?,
                                    last_error_message = ?,
                                    updated_at = ?
                                WHERE
                                    operation_id = ?
                                    AND state NOT IN (?, ?, ?)
                            `,
                        )
                        .run(
                            OPERATION_STATES
                                .CANCELLED,

                            PERSISTENCE_STATES
                                .DELETED,

                            'OFFLINE_OPERATION_CANCELLED',

                            String(
                                reason,
                            ).slice(
                                0,
                                1024,
                            ),

                            nowMs(),

                            id,

                            OPERATION_STATES
                                .SUCCEEDED,

                            OPERATION_STATES
                                .CANCELLED,

                            OPERATION_STATES
                                .RECONCILED,
                        );

                this.db
                    .prepare(
                        `
                            DELETE FROM outbox
                            WHERE operation_id = ?
                        `,
                    )
                    .run(
                        id,
                    );

                this.metrics
                    .writes +=
                    1;

                this.metrics
                    .operationsUpdated +=
                    updated.changes;

                return this.getOperation(
                    id,
                );
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Upsert checkpoint.
     * -------------------------------------------------------------------------
     */

    saveCheckpoint(
        name,
        cursor,
        options = {},
    ) {

        this.assertReady();

        if (
            this.readOnly
        ) {

            throw new OfflineDatabaseError(
                'TITech offline database is read-only.',
                {
                    code:
                        'TITECH_OFFLINE_DATABASE_READ_ONLY',
                },
            );
        }

        const checkpointName =
            normalizeId(
                name,
                'checkpoint name',
            );

        const serializedMetadata =
            serializeJson(
                options.metadata ||
                {},
                64 * 1024,
                'checkpoint metadata',
            );

        this.db
            .prepare(
                `
                    INSERT INTO checkpoints (
                        name,
                        cursor,
                        version,
                        updated_at,
                        metadata
                    )
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(name)
                    DO UPDATE SET
                        cursor = excluded.cursor,
                        version = excluded.version,
                        updated_at = excluded.updated_at,
                        metadata = excluded.metadata
                `,
            )
            .run(
                checkpointName,
                cursor ===
                    undefined ||
                    cursor ===
                    null
                    ? null
                    : String(
                        cursor,
                    ),
                normalizeInteger(
                    options.version,
                    1,
                ),
                nowMs(),
                serializedMetadata,
            );

        this.metrics
            .writes +=
            1;

        return this.getCheckpoint(
            checkpointName,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Get checkpoint.
     * -------------------------------------------------------------------------
     */

    getCheckpoint(
        name,
    ) {

        this.assertReady();

        const checkpointName =
            normalizeId(
                name,
                'checkpoint name',
            );

        const row =
            this.db
                .prepare(
                    `
                        SELECT
                            name,
                            cursor,
                            version,
                            updated_at,
                            metadata
                        FROM checkpoints
                        WHERE name = ?
                    `,
                )
                .get(
                    checkpointName,
                );

        return row
            ? {
                name:
                    row.name,

                cursor:
                    row.cursor,

                version:
                    row.version,

                updatedAt:
                    row.updated_at,

                metadata:
                    parseJson(
                        row.metadata,
                        'checkpoint metadata',
                    ),
            }
            : null;
    }

    /**
     * -------------------------------------------------------------------------
     * Create conflict.
     * -------------------------------------------------------------------------
     */

    createConflict(
        conflict,
    ) {

        this.assertReady();

        if (
            this.readOnly
        ) {

            throw new OfflineDatabaseError(
                'TITech offline database is read-only.',
                {
                    code:
                        'TITECH_OFFLINE_DATABASE_READ_ONLY',
                },
            );
        }

        const conflictId =
            normalizeId(
                conflict.conflictId ||
                crypto.randomUUID(),
                'conflictId',
            );

        const operationId =
            conflict.operationId ||
            null;

        const now =
            nowMs();

        const localPayload =
            conflict.localPayload ===
                undefined
                ? null
                : serializeJson(
                    conflict.localPayload,
                    this.options
                        .maxOperationPayloadBytes,
                    'local conflict payload',
                );

        const remotePayload =
            conflict.remotePayload ===
                undefined
                ? null
                : serializeJson(
                    conflict.remotePayload,
                    this.options
                        .maxOperationPayloadBytes,
                    'remote conflict payload',
                );

        this.db
            .prepare(
                `
                    INSERT INTO conflicts (
                        conflict_id,
                        operation_id,
                        conflict_type,
                        severity,
                        strategy,
                        local_version,
                        remote_version,
                        local_hash,
                        remote_hash,
                        local_payload,
                        remote_payload,
                        state,
                        resolution,
                        created_at,
                        updated_at,
                        resolved_at,
                        metadata
                    )
                    VALUES (
                        @conflictId,
                        @operationId,
                        @conflictType,
                        @severity,
                        @strategy,
                        @localVersion,
                        @remoteVersion,
                        @localHash,
                        @remoteHash,
                        @localPayload,
                        @remotePayload,
                        @state,
                        @resolution,
                        @createdAt,
                        @updatedAt,
                        @resolvedAt,
                        @metadata
                    )
                `,
            )
            .run(
                {
                    conflictId,

                    operationId,

                    conflictType:
                        conflict.conflictType ||
                        'version',

                    severity:
                        conflict.severity ||
                        'high',

                    strategy:
                        conflict.strategy ||
                        CONFLICT_STRATEGIES
                            .MANUAL,

                    localVersion:
                        normalizeInteger(
                            conflict.localVersion,
                            null,
                        ),

                    remoteVersion:
                        normalizeInteger(
                            conflict.remoteVersion,
                            null,
                        ),

                    localHash:
                        conflict.localHash ||
                        null,

                    remoteHash:
                        conflict.remoteHash ||
                        null,

                    localPayload,

                    remotePayload,

                    state:
                        conflict.state ||
                        OPERATION_STATES
                            .CONFLICT,

                    resolution:
                        conflict.resolution ||
                        null,

                    createdAt:
                        now,

                    updatedAt:
                        now,

                    resolvedAt:
                        null,

                    metadata:
                        serializeJson(
                            conflict.metadata ||
                            {},
                            64 * 1024,
                            'conflict metadata',
                        ),
                },
            );

        if (
            operationId
        ) {

            this.db
                .prepare(
                    `
                        UPDATE operations
                        SET
                            state = ?,
                            persistence_state = ?,
                            updated_at = ?
                        WHERE
                            operation_id = ?
                    `,
                )
                .run(
                    OPERATION_STATES
                        .CONFLICT,

                    PERSISTENCE_STATES
                        .STALE,

                    now,

                    operationId,
                );
        }

        this.metrics
            .writes +=
            1;

        this.metrics
            .conflictsInserted +=
            1;

        return this.getConflict(
            conflictId,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Get conflict.
     * -------------------------------------------------------------------------
     */

    getConflict(
        conflictId,
    ) {

        this.assertReady();

        const id =
            normalizeId(
                conflictId,
                'conflictId',
            );

        const row =
            this.db
                .prepare(
                    `
                        SELECT *
                        FROM conflicts
                        WHERE conflict_id = ?
                    `,
                )
                .get(
                    id,
                );

        if (
            !row
        ) {

            return null;
        }

        return {
            conflictId:
                row.conflict_id,

            operationId:
                row.operation_id,

            conflictType:
                row.conflict_type,

            severity:
                row.severity,

            strategy:
                row.strategy,

            localVersion:
                row.local_version,

            remoteVersion:
                row.remote_version,

            localHash:
                row.local_hash,

            remoteHash:
                row.remote_hash,

            localPayload:
                parseJson(
                    row.local_payload,
                    'local conflict payload',
                ),

            remotePayload:
                parseJson(
                    row.remote_payload,
                    'remote conflict payload',
                ),

            state:
                row.state,

            resolution:
                row.resolution,

            createdAt:
                row.created_at,

            updatedAt:
                row.updated_at,

            resolvedAt:
                row.resolved_at,

            metadata:
                parseJson(
                    row.metadata,
                    'conflict metadata',
                ),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Resolve conflict.
     * -------------------------------------------------------------------------
     */

    resolveConflict(
        conflictId,
        resolution,
        options = {},
    ) {

        this.assertReady();

        if (
            this.readOnly
        ) {

            throw new OfflineDatabaseError(
                'TITech offline database is read-only.',
                {
                    code:
                        'TITECH_OFFLINE_DATABASE_READ_ONLY',
                },
            );
        }

        const id =
            normalizeId(
                conflictId,
                'conflictId',
            );

        return this.transaction(
            () => {

                const conflict =
                    this.getConflict(
                        id,
                    );

                if (
                    !conflict
                ) {

                    throw new OfflineDatabaseError(
                        'TITech offline conflict was not found.',
                        {
                            code:
                                'TITECH_OFFLINE_DATABASE_CONFLICT_NOT_FOUND',

                            recordId:
                                id,
                        },
                    );
                }

                const now =
                    nowMs();

                this.db
                    .prepare(
                        `
                            UPDATE conflicts
                            SET
                                state = ?,
                                resolution = ?,
                                updated_at = ?,
                                resolved_at = ?,
                                metadata = ?
                            WHERE
                                conflict_id = ?
                        `,
                    )
                    .run(
                        OPERATION_STATES
                            .RECONCILED,

                        typeof resolution ===
                            'string'
                            ? resolution
                            : serializeJson(
                                resolution,
                                64 * 1024,
                                'conflict resolution',
                            ),

                        now,

                        now,

                        serializeJson(
                            options.metadata ||
                            {},
                            64 * 1024,
                            'conflict resolution metadata',
                        ),

                        id,
                    );

                if (
                    conflict.operationId
                ) {

                    this.db
                        .prepare(
                            `
                                UPDATE operations
                                SET
                                    state = ?,
                                    persistence_state = ?,
                                    reconciled_at = ?,
                                    updated_at = ?
                                WHERE
                                    operation_id = ?
                            `,
                        )
                        .run(
                            OPERATION_STATES
                                .RECONCILED,

                            PERSISTENCE_STATES
                                .RECONCILED,

                            now,

                            now,

                            conflict.operationId,
                        );
                }

                this.metrics
                    .writes +=
                    1;

                this.metrics
                    .operationsUpdated +=
                    conflict.operationId
                        ? 1
                        : 0;

                return this.getConflict(
                    id,
                );
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Create idempotency record.
     * -------------------------------------------------------------------------
     */

    createIdempotencyRecord(
        record,
    ) {

        this.assertReady();

        if (
            this.readOnly
        ) {

            throw new OfflineDatabaseError(
                'TITech offline database is read-only.',
                {
                    code:
                        'TITECH_OFFLINE_DATABASE_READ_ONLY',
                },
            );
        }

        const idempotencyHash =
            normalizeId(
                record.idempotencyHash,
                'idempotencyHash',
            );

        const keyFingerprint =
            normalizeId(
                record.keyFingerprint ||
                idempotencyHash,
                'keyFingerprint',
            );

        const operationId =
            normalizeId(
                record.operationId,
                'operationId',
            );

        const requestHash =
            normalizeId(
                record.requestHash,
                'requestHash',
            );

        const outcome =
            record.outcome ||
            IDEMPOTENCY_OUTCOMES
                .CREATED;

        const state =
            record.state ||
            IDEMPOTENCY_STATES
                .PENDING;

        const now =
            nowMs();

        const expiresAt =
            normalizeInteger(
                record.expiresAt,
                now +
                this.options
                    .idempotencyRetentionMs,
            );

        const existing =
            this.db
                .prepare(
                    `
                        SELECT *
                        FROM idempotency
                        WHERE idempotency_hash = ?
                    `,
                )
                .get(
                    idempotencyHash,
                );

        if (
            existing
        ) {

            if (
                existing.request_hash !==
                requestHash
            ) {

                this.metrics
                    .idempotencyConflicts +=
                    1;

                throw new OfflineDatabaseError(
                    'TITech idempotency key is already associated with a different operation payload.',
                    {
                        code:
                            'TITECH_OFFLINE_DATABASE_IDEMPOTENCY_CONFLICT',
                    },
                );
            }

            return this.getIdempotencyRecord(
                idempotencyHash,
            );
        }

        this.db
            .prepare(
                `
                    INSERT INTO idempotency (
                        idempotency_hash,
                        key_fingerprint,
                        operation_id,
                        request_hash,
                        outcome,
                        state,
                        response_hash,
                        status_code,
                        created_at,
                        updated_at,
                        expires_at,
                        metadata
                    )
                    VALUES (
                        @idempotencyHash,
                        @keyFingerprint,
                        @operationId,
                        @requestHash,
                        @outcome,
                        @state,
                        @responseHash,
                        @statusCode,
                        @createdAt,
                        @updatedAt,
                        @expiresAt,
                        @metadata
                    )
                `,
            )
            .run(
                {
                    idempotencyHash,

                    keyFingerprint,

                    operationId,

                    requestHash,

                    outcome,

                    state,

                    responseHash:
                        record.responseHash ||
                        null,

                    statusCode:
                        normalizeInteger(
                            record.statusCode,
                            null,
                        ),

                    createdAt:
                        now,

                    updatedAt:
                        now,

                    expiresAt,

                    metadata:
                        serializeJson(
                            record.metadata ||
                            {},
                            64 * 1024,
                            'idempotency metadata',
                        ),
                },
            );

        this.metrics
            .writes +=
            1;

        return this.getIdempotencyRecord(
            idempotencyHash,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Get idempotency record.
     * -------------------------------------------------------------------------
     */

    getIdempotencyRecord(
        idempotencyHash,
    ) {

        this.assertReady();

        const hash =
            normalizeId(
                idempotencyHash,
                'idempotencyHash',
            );

        const row =
            this.db
                .prepare(
                    `
                        SELECT *
                        FROM idempotency
                        WHERE idempotency_hash = ?
                    `,
                )
                .get(
                    hash,
                );

        if (
            !row
        ) {

            return null;
        }

        if (
            Number(
                row.expires_at,
            ) <=
            nowMs()
        ) {

            if (
                !this.readOnly
            ) {

                this.deleteIdempotencyRecord(
                    hash,
                );
            }

            return null;
        }

        return {
            idempotencyHash:
                row.idempotency_hash,

            keyFingerprint:
                row.key_fingerprint,

            operationId:
                row.operation_id,

            requestHash:
                row.request_hash,

            outcome:
                row.outcome,

            state:
                row.state,

            responseHash:
                row.response_hash,

            statusCode:
                row.status_code,

            createdAt:
                row.created_at,

            updatedAt:
                row.updated_at,

            expiresAt:
                row.expires_at,

            metadata:
                parseJson(
                    row.metadata,
                    'idempotency metadata',
                ),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Update idempotency record.
     * -------------------------------------------------------------------------
     */

    updateIdempotencyRecord(
        idempotencyHash,
        update = {},
    ) {

        this.assertReady();

        if (
            this.readOnly
        ) {

            throw new OfflineDatabaseError(
                'TITech offline database is read-only.',
                {
                    code:
                        'TITECH_OFFLINE_DATABASE_READ_ONLY',
                },
            );
        }

        const hash =
            normalizeId(
                idempotencyHash,
                'idempotencyHash',
            );

        const current =
            this.getIdempotencyRecord(
                hash,
            );

        if (
            !current
        ) {

            throw new OfflineDatabaseError(
                'TITech idempotency record was not found.',
                {
                    code:
                        'TITECH_OFFLINE_DATABASE_IDEMPOTENCY_NOT_FOUND',
                },
            );
        }

        const now =
            nowMs();

        this.db
            .prepare(
                `
                    UPDATE idempotency
                    SET
                        outcome = ?,
                        state = ?,
                        response_hash = ?,
                        status_code = ?,
                        updated_at = ?,
                        expires_at = ?,
                        metadata = ?
                    WHERE
                        idempotency_hash = ?
                `,
            )
            .run(
                update.outcome ||
                    current.outcome,

                update.state ||
                    current.state,

                update.responseHash ||
                    current.responseHash ||
                    null,

                update.statusCode ??
                    current.statusCode ??
                    null,

                now,

                normalizeInteger(
                    update.expiresAt,
                    current.expiresAt,
                ),

                serializeJson(
                    update.metadata ||
                    current.metadata ||
                    {},
                    64 * 1024,
                    'idempotency metadata',
                ),

                hash,
            );

        this.metrics
            .writes +=
            1;

        return this.getIdempotencyRecord(
            hash,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Delete idempotency record.
     * -------------------------------------------------------------------------
     */

    deleteIdempotencyRecord(
        idempotencyHash,
    ) {

        this.assertReady();

        if (
            this.readOnly
        ) {

            throw new OfflineDatabaseError(
                'TITech offline database is read-only.',
                {
                    code:
                        'TITECH_OFFLINE_DATABASE_READ_ONLY',
                },
            );
        }

        const hash =
            normalizeId(
                idempotencyHash,
                'idempotencyHash',
            );

        const result =
            this.db
                .prepare(
                    `
                        DELETE FROM idempotency
                        WHERE idempotency_hash = ?
                    `,
                )
                .run(
                    hash,
                );

        this.metrics
            .writes +=
            1;

        return result.changes >
            0;
    }

    /**
     * -------------------------------------------------------------------------
     * Write audit event.
     * -------------------------------------------------------------------------
     */

    appendAuditEvent(
        event,
    ) {

        this.assertReady();

        if (
            this.readOnly
        ) {

            throw new OfflineDatabaseError(
                'TITech offline database is read-only.',
                {
                    code:
                        'TITECH_OFFLINE_DATABASE_READ_ONLY',
                },
            );
        }

        const auditId =
            normalizeId(
                event.auditId ||
                crypto.randomUUID(),
                'auditId',
            );

        const payload =
            serializeJson(
                event.payload ||
                {},
                64 * 1024,
                'audit payload',
            );

        const integrityHash =
            event.integrityHash ||
            crypto
                .createHash(
                    'sha256',
                )
                .update(
                    payload,
                    'utf8',
                )
                .digest(
                    'hex',
                );

        this.db
            .prepare(
                `
                    INSERT INTO audit (
                        audit_id,
                        operation_id,
                        event_type,
                        actor_id,
                        tenant_id,
                        correlation_id,
                        payload,
                        integrity_hash,
                        created_at
                    )
                    VALUES (
                        @auditId,
                        @operationId,
                        @eventType,
                        @actorId,
                        @tenantId,
                        @correlationId,
                        @payload,
                        @integrityHash,
                        @createdAt
                    )
                `,
            )
            .run(
                {
                    auditId,

                    operationId:
                        event.operationId ||
                        null,

                    eventType:
                        event.eventType ||
                        OFFLINE.OUTBOX,

                    actorId:
                        event.actorId ||
                        null,

                    tenantId:
                        event.tenantId ||
                        null,

                    correlationId:
                        event.correlationId ||
                        null,

                    payload,

                    integrityHash,

                    createdAt:
                        nowMs(),
                },
            );

        this.metrics
            .writes +=
            1;

        return {
            auditId,

            integrityHash,

            createdAt:
                nowMs(),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Cleanup expired/retained records.
     * -------------------------------------------------------------------------
     */

    cleanup(
        options = {},
    ) {

        this.assertReady();

        if (
            this.readOnly
        ) {

            throw new OfflineDatabaseError(
                'TITech offline database is read-only.',
                {
                    code:
                        'TITECH_OFFLINE_DATABASE_READ_ONLY',
                },
            );
        }

        return this.transaction(
            () => {

                const now =
                    nowMs();

                const operationsBefore =
                    normalizeInteger(
                        options.operationsBefore,
                        now -
                        (
                            options
                                .operationRetentionMs ||
                            this.options
                                .operationRetentionMs
                        ),
                    );

                const failuresBefore =
                    normalizeInteger(
                        options.failuresBefore,
                        now -
                        (
                            options
                                .failureRetentionMs ||
                            this.options
                                .failureRetentionMs
                        ),
                    );

                const conflictsBefore =
                    normalizeInteger(
                        options.conflictsBefore,
                        now -
                        (
                            options
                                .conflictRetentionMs ||
                            this.options
                                .conflictRetentionMs
                        ),
                    );

                const idempotencyBefore =
                    normalizeInteger(
                        options.idempotencyBefore,
                        now -
                        (
                            options
                                .idempotencyRetentionMs ||
                            this.options
                                .idempotencyRetentionMs
                        ),
                    );

                const deleted = {
                    operations:
                        0,

                    failures:
                        0,

                    conflicts:
                        0,

                    idempotency:
                        0,
                };

                const operationResult =
                    this.db
                        .prepare(
                            `
                                DELETE FROM operations
                                WHERE
                                    (
                                        state IN (?, ?, ?)
                                        AND created_at < ?
                                    )
                                    OR
                                    (
                                        state IN (?, ?, ?)
                                        AND created_at < ?
                                    )
                            `,
                        )
                        .run(
                            OPERATION_STATES
                                .SUCCEEDED,

                            OPERATION_STATES
                                .RECONCILED,

                            OPERATION_STATES
                                .CANCELLED,

                            operationsBefore,

                            OPERATION_STATES
                                .FAILED,

                            OPERATION_STATES
                                .DEAD_LETTER,

                            OPERATION_STATES
                                .EXPIRED,

                            failuresBefore,
                        );

                deleted.operations =
                    operationResult.changes;

                const conflictResult =
                    this.db
                        .prepare(
                            `
                                DELETE FROM conflicts
                                WHERE
                                    updated_at < ?
                                    AND state = ?
                            `,
                        )
                        .run(
                            conflictsBefore,

                            OPERATION_STATES
                                .RECONCILED,
                        );

                deleted.conflicts =
                    conflictResult.changes;

                const idempotencyResult =
                    this.db
                        .prepare(
                            `
                                DELETE FROM idempotency
                                WHERE expires_at <= ?
                            `,
                        )
                        .run(
                            idempotencyBefore,
                        );

                deleted.idempotency =
                    idempotencyResult
                        .changes;

                const failureResult =
                    this.db
                        .prepare(
                            `
                                DELETE FROM audit
                                WHERE created_at < ?
                            `,
                        )
                        .run(
                            failuresBefore,
                        );

                deleted.failures =
                    failureResult.changes;

                this.metrics
                    .operationsDeleted +=
                    deleted.operations;

                this.lastCleanupAt =
                    isoNow();

                return {
                    deleted,

                    timestamp:
                        this.lastCleanupAt,
                };
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Database integrity check.
     * -------------------------------------------------------------------------
     */

    integrityCheck() {

        this.assertReady();

        const result =
            this.db
                .prepare(
                    `PRAGMA integrity_check`,
                )
                .all();

        const healthy =
            result.every(
                row =>
                    row.integrity_check ===
                    'ok',
            );

        this.lastIntegrityCheckAt =
            isoNow();

        if (
            !healthy
        ) {

            throw new OfflineDatabaseError(
                'TITech offline database integrity check failed.',
                {
                    code:
                        'TITECH_OFFLINE_DATABASE_INTEGRITY_FAILED',

                    details: {
                        result,
                    },
                },
            );
        }

        return {
            healthy,

            result,

            timestamp:
                this.lastIntegrityCheckAt,
        };
    }

    /**
     * -------------------------------------------------------------------------
     * WAL/checkpoint maintenance.
     * -------------------------------------------------------------------------
     */

    checkpoint(
        mode =
            this.options
                .checkpointMode,
    ) {

        this.assertReady();

        try {

            const result =
                this.db
                    .pragma(
                        `wal_checkpoint(${mode})`,
                        {
                            simple:
                                false,
                        },
                    );

            this.lastCheckpointAt =
                isoNow();

            return {
                mode,

                result,

                timestamp:
                    this.lastCheckpointAt,
            };

        } catch (
            error
        ) {

            throw new OfflineDatabaseError(
                'TITech offline database checkpoint failed.',
                {
                    code:
                        'TITECH_OFFLINE_DATABASE_CHECKPOINT_FAILED',

                    cause:
                        error,
                },
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Vacuum/optimize.
     * -------------------------------------------------------------------------
     */

    optimize() {

        this.assertReady();

        if (
            this.readOnly
        ) {

            return {
                optimized:
                    false,

                reason:
                    'read-only',
            };
        }

        try {

            this.db.pragma(
                'optimize',
            );

            return {
                optimized:
                    true,

                timestamp:
                    isoNow(),
            };

        } catch (
            error
        ) {

            throw new OfflineDatabaseError(
                'TITech offline database optimization failed.',
                {
                    code:
                        'TITECH_OFFLINE_DATABASE_OPTIMIZE_FAILED',

                    cause:
                        error,
                },
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Database statistics.
     * -------------------------------------------------------------------------
     */

    stats() {

        this.assertReady();

        const operationCount =
            this.db
                .prepare(
                    `
                        SELECT COUNT(*) AS count
                        FROM operations
                    `,
                )
                .get()
                .count;

        const outboxCount =
            this.db
                .prepare(
                    `
                        SELECT COUNT(*) AS count
                        FROM outbox
                    `,
                )
                .get()
                .count;

        const conflictCount =
            this.db
                .prepare(
                    `
                        SELECT COUNT(*) AS count
                        FROM conflicts
                        WHERE state = ?
                    `,
                )
                .get(
                    OPERATION_STATES
                        .CONFLICT,
                )
                .count;

        const idempotencyCount =
            this.db
                .prepare(
                    `
                        SELECT COUNT(*) AS count
                        FROM idempotency
                        WHERE expires_at > ?
                    `,
                )
                .get(
                    nowMs(),
                )
                .count;

        return {
            database: {
                initialized:
                    this.initialized,

                closed:
                    this.closed,

                readOnly:
                    this.readOnly,

                schemaVersion:
                    this.schemaVersion,

                path:
                    this.options.path,
            },

            records: {
                operations:
                    operationCount,

                outbox:
                    outboxCount,

                conflicts:
                    conflictCount,

                activeIdempotency:
                    idempotencyCount,
            },

            metrics:
                deepClone(
                    this.metrics,
                ),

            maintenance: {
                lastCheckpointAt:
                    this.lastCheckpointAt,

                lastCleanupAt:
                    this.lastCleanupAt,

                lastIntegrityCheckAt:
                    this.lastIntegrityCheckAt,
            },

            timestamp:
                isoNow(),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Close database.
     * -------------------------------------------------------------------------
     */

    close() {

        if (
            !this.db
        ) {

            this.initialized =
                false;

            this.closed =
                true;

            return true;
        }

        try {

            this.db.close();

        } catch (
            error
        ) {

            this.lastError =
                error;

            throw new OfflineDatabaseError(
                'TITech offline database close failed.',
                {
                    code:
                        'TITECH_OFFLINE_DATABASE_CLOSE_FAILED',

                    cause:
                        error,
                },
            );

        } finally {

            this.db =
                null;

            this.initialized =
                false;

            this.closed =
                true;
        }

        log(
            'info',
            {},
            'TITech offline database closed.',
        );

        return true;
    }
}

/**
 * =============================================================================
 * Helper: states which should have outbox records
 * =============================================================================
 */

function stateAllowsOutbox(
    state,
) {

    return [
        OPERATION_STATES
            .PENDING,

        OPERATION_STATES
            .RETRYABLE_FAILURE,
    ].includes(
        state,
    );
}

/**
 * =============================================================================
 * Singleton
 * =============================================================================
 */

const offlineDatabase =
    new OfflineDatabase();

/**
 * =============================================================================
 * Convenience API
 * =============================================================================
 */

function initialize(
    options = {},
) {

    if (
        Object.keys(
            options,
        ).length >
        0 &&
        !offlineDatabase.initialized
    ) {

        /**
         * The singleton is intentionally not mutated after construction.
         *
         * Custom callers should use:
         *
         *   new OfflineDatabase(options)
         */
    }

    return offlineDatabase.initialize();
}

function close() {

    return offlineDatabase.close();
}

function getOperation(
    operationId,
) {

    return offlineDatabase.getOperation(
        operationId,
    );
}

function insertOperation(
    operation,
    options,
) {

    return offlineDatabase.insertOperation(
        operation,
        options,
    );
}

function listOperations(
    options,
) {

    return offlineDatabase.listOperations(
        options,
    );
}

function claimNextOperation(
    workerId,
) {

    return offlineDatabase.claimNextOperation(
        workerId,
    );
}

function completeOperation(
    operationId,
    lockToken,
    outcome,
) {

    return offlineDatabase.completeOperation(
        operationId,
        lockToken,
        outcome,
    );
}

function cancelOperation(
    operationId,
    reason,
) {

    return offlineDatabase.cancelOperation(
        operationId,
        reason,
    );
}

function saveCheckpoint(
    name,
    cursor,
    options,
) {

    return offlineDatabase.saveCheckpoint(
        name,
        cursor,
        options,
    );
}

function getCheckpoint(
    name,
) {

    return offlineDatabase.getCheckpoint(
        name,
    );
}

function createConflict(
    conflict,
) {

    return offlineDatabase.createConflict(
        conflict,
    );
}

function getConflict(
    conflictId,
) {

    return offlineDatabase.getConflict(
        conflictId,
    );
}

function resolveConflict(
    conflictId,
    resolution,
    options,
) {

    return offlineDatabase.resolveConflict(
        conflictId,
        resolution,
        options,
    );
}

function createIdempotencyRecord(
    record,
) {

    return offlineDatabase
        .createIdempotencyRecord(
            record,
        );
}

function getIdempotencyRecord(
    idempotencyHash,
) {

    return offlineDatabase
        .getIdempotencyRecord(
            idempotencyHash,
        );
}

function updateIdempotencyRecord(
    idempotencyHash,
    update,
) {

    return offlineDatabase
        .updateIdempotencyRecord(
            idempotencyHash,
            update,
        );
}

function deleteIdempotencyRecord(
    idempotencyHash,
) {

    return offlineDatabase
        .deleteIdempotencyRecord(
            idempotencyHash,
        );
}

function appendAuditEvent(
    event,
) {

    return offlineDatabase
        .appendAuditEvent(
            event,
        );
}

function cleanup(
    options,
) {

    return offlineDatabase.cleanup(
        options,
    );
}

function integrityCheck() {

    return offlineDatabase
        .integrityCheck();
}

function checkpoint(
    mode,
) {

    return offlineDatabase
        .checkpoint(
            mode,
        );
}

function optimize() {

    return offlineDatabase.optimize();
}

function stats() {

    return offlineDatabase.stats();
}

/**
 * =============================================================================
 * Runtime state
 * =============================================================================
 */

function readiness() {

    return {
        status:
            offlineDatabase
                .initialized &&
            !offlineDatabase.closed
                ? 'ready'
                : 'not_ready',

        ready:
            offlineDatabase
                .initialized &&
            !offlineDatabase.closed,

        component:
            COMPONENT,

        schemaVersion:
            offlineDatabase
                .schemaVersion,

        timestamp:
            isoNow(),
    };
}

function health() {

    const ready =
        offlineDatabase
            .initialized &&
        !offlineDatabase.closed;

    return {
        status:
            ready
                ? 'healthy'
                : 'unhealthy',

        healthy:
            ready,

        component:
            COMPONENT,

        schemaVersion:
            offlineDatabase
                .schemaVersion,

        lastError:
            offlineDatabase
                .lastError
                ? {
                    name:
                        offlineDatabase
                            .lastError
                            .name,

                    code:
                        offlineDatabase
                            .lastError
                            .code,

                    message:
                        offlineDatabase
                            .lastError
                            .message,
                }
                : null,

        timestamp:
            isoNow(),
    };
}

/**
 * =============================================================================
 * Public API
 * =============================================================================
 */

module.exports = {

    COMPONENT,

    SCHEMA_VERSION,

    RECORD_TYPES,

    DATABASE_OPEN_MODES,

    DEFAULTS,

    OfflineDatabaseError,

    OfflineDatabase,

    offlineDatabase,

    /**
     * Lifecycle.
     */
    initialize,

    close,

    readiness,

    health,

    /**
     * Operations.
     */
    getOperation,

    insertOperation,

    listOperations,

    claimNextOperation,

    completeOperation,

    cancelOperation,

    /**
     * Checkpoints.
     */
    saveCheckpoint,

    getCheckpoint,

    /**
     * Conflicts.
     */
    createConflict,

    getConflict,

    resolveConflict,

    /**
     * Idempotency.
     */
    createIdempotencyRecord,

    getIdempotencyRecord,

    updateIdempotencyRecord,

    deleteIdempotencyRecord,

    /**
     * Audit.
     */
    appendAuditEvent,

    /**
     * Maintenance.
     */
    cleanup,

    integrityCheck,

    checkpoint,

    optimize,

    stats,
};