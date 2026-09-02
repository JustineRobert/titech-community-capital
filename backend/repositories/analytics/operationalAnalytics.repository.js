'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Operational Analytics Repository
 * ============================================================================
 *
 * File:
 *   backend/repositories/analytics/operationalAnalytics.repository.js
 *
 * Purpose:
 *   Enterprise operational telemetry persistence boundary for the TITech
 *   Community Capital platform.
 *
 * ============================================================================
 * CAPABILITIES
 * ============================================================================
 *
 * ✓ Strict multi-tenant isolation
 * ✓ Operational event validation with AJV
 * ✓ Deterministic idempotency
 * ✓ Queue backpressure
 * ✓ Batched ingestion
 * ✓ Retry with exponential backoff
 * ✓ Failed-batch requeue / dead-letter hooks
 * ✓ SQL / ClickHouse / custom writer support
 * ✓ Operational event querying
 * ✓ Safe aggregation with whitelisted identifiers
 * ✓ Latency analytics
 * ✓ Error analytics
 * ✓ Incident analytics
 * ✓ Capacity analytics
 * ✓ SLA calculations
 * ✓ Incident reconciliation
 * ✓ Alerting integration
 * ✓ Streaming integration
 * ✓ Retention management
 * ✓ JSONL / CSV export
 * ✓ Health checks
 * ✓ Metrics
 * ✓ Graceful shutdown
 *
 * ============================================================================
 * ARCHITECTURAL NON-RESPONSIBILITIES
 * ============================================================================
 *
 * ✗ Does not authorize users.
 * ✗ Does not perform RBAC.
 * ✗ Does not mutate financial balances.
 * ✗ Does not make compliance decisions.
 * ✗ Does not own application lifecycle.
 *
 * ============================================================================
 * TENANCY
 * ============================================================================
 *
 * Tenant identity is mandatory for operational analytics. A missing tenant
 * MUST NOT silently fall back to a public/default tenant.
 *
 * ============================================================================
 */

const EventEmitter = require('events');
const crypto = require('crypto');

let Ajv;
let addFormats;
let pRetry = null;

try {
    const ajvModule = require('ajv');

    Ajv =
        ajvModule.default ||
        ajvModule;
} catch {
    throw new Error(
        "TITech OperationalAnalyticsRepository requires the 'ajv' package."
    );
}

try {
    const formatsModule =
        require('ajv-formats');

    addFormats =
        formatsModule.default ||
        formatsModule;
} catch {
    throw new Error(
        "TITech OperationalAnalyticsRepository requires the 'ajv-formats' package."
    );
}

try {
    const retryModule =
        require('p-retry');

    pRetry =
        retryModule.default ||
        retryModule;
} catch {
    /*
     * p-retry remains optional because a built-in retry implementation is
     * provided below.
     */
}

const tenantConstants =
    require('../../tenancy/tenant.constants');

/**
 * ============================================================================
 * DEFAULTS
 * ============================================================================
 */

const DEFAULT_EVENT_TYPES = Object.freeze([
    'heartbeat',
    'incident',
    'metric',
    'alert',
    'deployment',
    'capacity',
    'latency',
    'error',
    'availability',
    'sla_breach',
    'service_start',
    'service_stop',
    'dependency_failure',
    'queue_depth',
    'database_health',
    'cache_health',
    'stream_health'
]);

const DEFAULT_SEVERITIES = Object.freeze([
    'debug',
    'info',
    'notice',
    'warn',
    'warning',
    'error',
    'critical',
    'fatal'
]);

const DEFAULTS = Object.freeze({
    BATCH_SIZE:
        positiveInteger(
            process.env.OP_ANALYTICS_BATCH_SIZE,
            500
        ),

    BATCH_INTERVAL_MS:
        positiveInteger(
            process.env.OP_ANALYTICS_BATCH_INTERVAL_MS,
            2000
        ),

    MAX_QUEUE_SIZE:
        positiveInteger(
            process.env.OP_ANALYTICS_MAX_QUEUE_SIZE,
            50000
        ),

    WRITE_RETRY_ATTEMPTS:
        positiveInteger(
            process.env.OP_ANALYTICS_WRITE_RETRY_ATTEMPTS,
            3
        ),

    WRITE_RETRY_MIN_TIMEOUT:
        positiveInteger(
            process.env.OP_ANALYTICS_WRITE_RETRY_MIN_TIMEOUT,
            100
        ),

    WRITE_RETRY_MAX_TIMEOUT:
        positiveInteger(
            process.env.OP_ANALYTICS_WRITE_RETRY_MAX_TIMEOUT,
            5000
        ),

    IDEMPOTENCY_TTL:
        positiveInteger(
            process.env.OP_ANALYTICS_IDEMPOTENCY_TTL,
            86400
        ),

    RETENTION_DAYS:
        positiveInteger(
            process.env.OP_ANALYTICS_RETENTION_DAYS,
            730
        ),

    MAX_PAGE_SIZE:
        positiveInteger(
            process.env.OP_ANALYTICS_MAX_PAGE_SIZE,
            2000
        ),

    MAX_EVENT_TYPE_LENGTH:
        128,

    MAX_SOURCE_LENGTH:
        128,

    MAX_HOST_LENGTH:
        255,

    MAX_METRIC_NAME_LENGTH:
        255,

    MAX_IDEMPOTENCY_KEY_LENGTH:
        256,

    TABLE_PREFIX:
        tenantConstants.ENV.DB_TABLE_PREFIX ||
        'titech_',

    GLOBAL_TABLE:
        `${tenantConstants.ENV.DB_TABLE_PREFIX || 'titech_'}operational_events`,

    TENANT_REGISTRY_TABLE:
        `${tenantConstants.ENV.DB_TABLE_PREFIX || 'titech_'}tenants`,

    IDEMPOTENCY_PREFIX:
        'titech:operational:analytics:idempotency:',

    LOCK_PREFIX:
        'titech:operational:analytics:lock:',

    STREAM_TOPIC:
        process.env.OP_ANALYTICS_STREAM_TOPIC ||
        'titech.operational.events',

    LOG_PREFIX:
        'TITech.OperationalAnalytics',

    DEFAULT_EVENT_TYPES,

    DEFAULT_SEVERITIES
});

/**
 * ============================================================================
 * AJV
 * ============================================================================
 */

const ajv =
    new Ajv({
        allErrors: true,
        strict: true,
        coerceTypes: false,
        removeAdditional: false,
        useDefaults: false
    });

addFormats(ajv);

const operationalEventSchema = {
    type: 'object',

    required: [
        'tenant_id',
        'event_type',
        'timestamp',
        'payload'
    ],

    properties: {
        internal_id: {
            type: 'string',
            minLength: 1,
            maxLength: 128
        },

        tenant_id: {
            type: 'string',
            minLength: 3,
            maxLength: 64
        },

        event_type: {
            type: 'string',
            minLength: 1,
            maxLength:
                DEFAULTS.MAX_EVENT_TYPE_LENGTH,
            pattern: '^[a-zA-Z0-9._:-]+$'
        },

        timestamp: {
            type: 'string',
            format: 'date-time'
        },

        source: {
            type: [
                'string',
                'null'
            ],
            maxLength:
                DEFAULTS.MAX_SOURCE_LENGTH
        },

        host: {
            type: [
                'string',
                'null'
            ],
            maxLength:
                DEFAULTS.MAX_HOST_LENGTH
        },

        severity: {
            type: [
                'string',
                'null'
            ],
            maxLength: 32
        },

        metric_name: {
            type: [
                'string',
                'null'
            ],
            maxLength:
                DEFAULTS.MAX_METRIC_NAME_LENGTH
        },

        metric_value: {
            type: [
                'number',
                'null'
            ],
            nullable: true
        },

        idempotency_key: {
            type: [
                'string',
                'null'
            ],
            minLength: 1,
            maxLength:
                DEFAULTS.MAX_IDEMPOTENCY_KEY_LENGTH
        },

        payload: {
            type: 'object',
            additionalProperties: true
        },

        metadata: {
            type: 'object',
            additionalProperties: true
        }
    },

    additionalProperties: false
};

const validateOperationalEvent =
    ajv.compile(
        operationalEventSchema
    );

/**
 * ============================================================================
 * QUERY WHITELISTS
 * ============================================================================
 */

const ALLOWED_ORDER_FIELDS = Object.freeze([
    'created_at',
    'event_type',
    'source',
    'host',
    'severity',
    'metric_name',
    'metric_value',
    'tenant_id'
]);

const ALLOWED_GROUP_FIELDS = Object.freeze([
    'event_type',
    'source',
    'host',
    'severity',
    'metric_name',
    'date',
    'tenant_id'
]);

const ALLOWED_AGGREGATIONS = Object.freeze([
    'count',
    'sum',
    'avg',
    'min',
    'max',
    'p95',
    'p99'
]);

/**
 * ============================================================================
 * HELPERS
 * ============================================================================
 */

function positiveInteger(
    value,
    fallback
) {
    const parsed =
        Number(value);

    return Number.isInteger(parsed) &&
        parsed > 0
        ? parsed
        : fallback;
}

function nowIso() {
    return new Date().toISOString();
}

function sleep(ms) {
    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                ms
            )
    );
}

function safeStringify(value) {
    try {
        return JSON.stringify(
            value
        );
    } catch {
        return '[unserializable]';
    }
}

function generateInternalId() {
    return crypto
        .randomBytes(16)
        .toString('hex');
}

function isPlainObject(value) {
    return Boolean(
        value &&
        typeof value === 'object' &&
        !Array.isArray(value)
    );
}

function createRepositoryError(
    message,
    code,
    statusCode = 500,
    details
) {
    const error =
        new Error(message);

    error.name =
        'OperationalAnalyticsRepositoryError';

    error.code =
        code;

    error.statusCode =
        statusCode;

    if (
        details !== undefined
    ) {
        error.details =
            details;
    }

    return error;
}

function normalizeTenantId(
    tenantId
) {
    if (
        tenantId === undefined ||
        tenantId === null
    ) {
        throw createRepositoryError(
            'tenantId is required.',
            'OPERATIONAL_ANALYTICS_TENANT_REQUIRED',
            400
        );
    }

    const normalized =
        String(
            tenantId
        )
            .trim()
            .toLowerCase();

    const validator =
        tenantConstants.isValidTenantId;

    if (
        typeof validator ===
        'function' &&
        !validator(
            normalized
        )
    ) {
        throw createRepositoryError(
            'Invalid TITech tenant identifier.',
            'OPERATIONAL_ANALYTICS_INVALID_TENANT',
            400
        );
    }

    return normalized;
}

function normalizeOptionalString(
    value,
    field,
    maxLength
) {
    if (
        value === undefined ||
        value === null
    ) {
        return null;
    }

    const normalized =
        String(
            value
        ).trim();

    if (
        normalized.length >
        maxLength
    ) {
        throw createRepositoryError(
            `${field} exceeds the maximum permitted length.`,
            'OPERATIONAL_ANALYTICS_FIELD_TOO_LONG',
            400,
            {
                field,
                maxLength
            }
        );
    }

    return normalized || null;
}

function parseDate(
    value,
    field
) {
    if (
        value === undefined ||
        value === null
    ) {
        return null;
    }

    const date =
        value instanceof Date
            ? new Date(
                value.getTime()
            )
            : new Date(value);

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        throw createRepositoryError(
            `${field} must be a valid date.`,
            'OPERATIONAL_ANALYTICS_INVALID_DATE',
            400,
            {
                field
            }
        );
    }

    return date;
}

function validateDateRange(
    from,
    to
) {
    if (
        from &&
        to &&
        from > to
    ) {
        throw createRepositoryError(
            'from must be earlier than or equal to to.',
            'OPERATIONAL_ANALYTICS_INVALID_DATE_RANGE',
            400
        );
    }
}

function normalizePage(
    value,
    fallback = 1
) {
    const parsed =
        Number(value);

    return Number.isInteger(parsed) &&
        parsed > 0
        ? parsed
        : fallback;
}

function normalizePageSize(
    value,
    max
) {
    const parsed =
        Number(value);

    if (
        !Number.isInteger(parsed) ||
        parsed <= 0
    ) {
        return Math.min(
            100,
            max
        );
    }

    return Math.min(
        parsed,
        max
    );
}

function normalizeOrder(
    value
) {
    const candidate =
        String(
            value ||
            'created_at'
        ).trim();

    return ALLOWED_ORDER_FIELDS.includes(
        candidate
    )
        ? candidate
        : 'created_at';
}

function normalizeDirection(
    value
) {
    return String(
        value ||
        'desc'
    ).toLowerCase() ===
        'asc'
        ? 'asc'
        : 'desc';
}

function normalizeGroupBy(
    value
) {
    const input =
        Array.isArray(value)
            ? value
            : [
                'event_type'
            ];

    const valid =
        input.filter(
            field =>
                ALLOWED_GROUP_FIELDS.includes(
                    String(field)
                )
        );

    const unique =
        Array.from(
            new Set(valid)
        );

    return unique.length
        ? unique
        : [
            'event_type'
        ];
}

function resolveTable(
    tenantId
) {
    const mode =
        tenantConstants.getTenancyMode();

    if (
        mode ===
        tenantConstants.TENANCY_MODES.SCHEMA
    ) {
        const schema =
            tenantConstants.schemaNameForTenant(
                normalizeTenantId(
                    tenantId
                )
            );

        return `${schema}.operational_events`;
    }

    return DEFAULTS.GLOBAL_TABLE;
}

function parseJson(
    value,
    fallback = {}
) {
    if (
        value === undefined ||
        value === null
    ) {
        return fallback;
    }

    if (
        typeof value === 'object'
    ) {
        return value;
    }

    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function safeCount(
    value
) {
    if (
        value === undefined ||
        value === null
    ) {
        return 0;
    }

    const text =
        String(value);

    if (
        !/^\d+$/.test(text)
    ) {
        return 0;
    }

    const bigint =
        BigInt(
            text
        );

    const max =
        BigInt(
            Number.MAX_SAFE_INTEGER
        );

    return Number(
        bigint > max
            ? max
            : bigint
    );
}

function csvEscape(
    value
) {
    if (
        value === null ||
        value === undefined
    ) {
        return '';
    }

    const text =
        String(value);

    if (
        /["\n,]/.test(
            text
        )
    ) {
        return (
            '"' +
            text.replace(
                /"/g,
                '""'
            ) +
            '"'
        );
    }

    return text;
}

function csvLine(
    values
) {
    return (
        values
            .map(csvEscape)
            .join(',') +
        '\n'
    );
}

/**
 * ============================================================================
 * RETRY FALLBACK
 * ============================================================================
 */

async function retryWithBackoff(
    fn,
    {
        attempts = 3,
        minTimeout = 100,
        maxTimeout = 5000
    } = {}
) {
    let lastError;

    for (
        let attempt = 0;
        attempt < attempts;
        attempt += 1
    ) {
        try {
            return await fn();
        } catch (
            error
        ) {
            lastError =
                error;

            if (
                attempt ===
                attempts - 1
            ) {
                break;
            }

            const delay =
                Math.min(
                    maxTimeout,
                    minTimeout *
                    Math.pow(
                        2,
                        attempt
                    )
                ) +
                Math.floor(
                    Math.random() *
                    Math.max(
                        1,
                        minTimeout
                    )
                );

            await sleep(
                delay
            );
        }
    }

    throw lastError;
}

/**
 * ============================================================================
 * REPOSITORY
 * ============================================================================
 */

class OperationalAnalyticsRepository
    extends EventEmitter {

    constructor({
        knex = null,
        clickhouseClient = null,
        writer = null,
        cacheClient = null,
        streamProducer = null,
        lockClient = null,
        alertingClient = null,
        logger = console,
        metrics = null,
        options = {}
    } = {}) {

        super();

        if (
            !logger
        ) {
            throw createRepositoryError(
                'logger is required.',
                'OPERATIONAL_ANALYTICS_LOGGER_REQUIRED'
            );
        }

        this.knex =
            knex;

        this.clickhouseClient =
            clickhouseClient;

        this.writer =
            typeof writer ===
            'function'
                ? writer
                : null;

        this.cacheClient =
            cacheClient;

        this.streamProducer =
            streamProducer;

        this.lockClient =
            lockClient;

        this.alertingClient =
            alertingClient;

        this.logger =
            logger;

        this.metrics =
            normalizeMetrics(
                metrics
            );

        this.options =
            Object.freeze({
                ...DEFAULTS,
                ...options
            });

        this._queue =
            [];

        this._queueSize =
            0;

        this._batchTimer =
            null;

        this._flushPromise =
            null;

        this._running =
            false;

        this._shuttingDown =
            false;

        this._stats = {
            enqueued: 0,
            flushed: 0,
            failed: 0,
            rejected: 0,
            requeued: 0,
            dropped: 0
        };

        this.recordOperationalEvent =
            this.recordOperationalEvent.bind(
                this
            );

        this.bulkRecordOperationalEvents =
            this.bulkRecordOperationalEvents.bind(
                this
            );

        this._flushBatch =
            this._flushBatch.bind(
                this
            );

        this.logger.info(
            `${DEFAULTS.LOG_PREFIX} initialized`,
            {
                batchSize:
                    this.options.BATCH_SIZE,

                batchIntervalMs:
                    this.options.BATCH_INTERVAL_MS,

                maxQueueSize:
                    this.options.MAX_QUEUE_SIZE,

                retentionDays:
                    this.options.RETENTION_DAYS,

                tenancyMode:
                    tenantConstants.getTenancyMode?.()
            }
        );
    }

    /**
     * =========================================================================
     * VALIDATION
     * =========================================================================
     */

    _validateEvent(
        rawEvent
    ) {

        if (
            !isPlainObject(
                rawEvent
            )
        ) {
            throw createRepositoryError(
                'Operational event must be an object.',
                'OPERATIONAL_ANALYTICS_INVALID_EVENT',
                400
            );
        }

        const event = {
            ...rawEvent
        };

        event.tenant_id =
            normalizeTenantId(
                event.tenant_id
            );

        event.event_type =
            normalizeOptionalString(
                event.event_type,
                'event_type',
                DEFAULTS.MAX_EVENT_TYPE_LENGTH
            ) ||
            'metric';

        /*
         * Permit the configurable event vocabulary, but keep custom event
         * types available for future TITech services.
         */
        if (
            !/^[a-zA-Z0-9._:-]+$/.test(
                event.event_type
            )
        ) {
            throw createRepositoryError(
                'Invalid operational event type.',
                'OPERATIONAL_ANALYTICS_INVALID_EVENT_TYPE',
                400
            );
        }

        const timestamp =
            event.timestamp
                ? parseDate(
                    event.timestamp,
                    'timestamp'
                )
                : new Date();

        event.timestamp =
            timestamp.toISOString();

        event.source =
            normalizeOptionalString(
                event.source,
                'source',
                DEFAULTS.MAX_SOURCE_LENGTH
            );

        event.host =
            normalizeOptionalString(
                event.host,
                'host',
                DEFAULTS.MAX_HOST_LENGTH
            );

        event.severity =
            normalizeOptionalString(
                event.severity,
                'severity',
                32
            );

        if (
            event.severity
        ) {
            event.severity =
                event.severity
                    .toLowerCase();
        }

        event.metric_name =
            normalizeOptionalString(
                event.metric_name,
                'metric_name',
                DEFAULTS.MAX_METRIC_NAME_LENGTH
            );

        if (
            event.metric_value !==
            undefined &&
            event.metric_value !==
            null
        ) {
            if (
                typeof event.metric_value !==
                'number' ||
                !Number.isFinite(
                    event.metric_value
                )
            ) {
                throw createRepositoryError(
                    'metric_value must be a finite number.',
                    'OPERATIONAL_ANALYTICS_INVALID_METRIC_VALUE',
                    400
                );
            }
        } else {
            event.metric_value =
                null;
        }

        if (
            !isPlainObject(
                event.payload
            )
        ) {
            event.payload =
                {};
        }

        if (
            !isPlainObject(
                event.metadata
            )
        ) {
            event.metadata =
                {};
        }

        if (
            event.idempotency_key
        ) {
            event.idempotency_key =
                String(
                    event.idempotency_key
                ).trim();
        } else {
            event.idempotency_key =
                crypto
                    .createHash(
                        'sha256'
                    )
                    .update(
                        [
                            event.tenant_id,
                            event.event_type,
                            event.timestamp,
                            event.source || '',
                            event.host || '',
                            event.metric_name || '',
                            event.metric_value ===
                                null
                                ? ''
                                : String(
                                    event.metric_value
                                ),
                            safeStringify(
                                event.payload
                            )
                        ].join('|')
                    )
                    .digest(
                        'hex'
                    );
        }

        if (
            event.idempotency_key.length >
            DEFAULTS.MAX_IDEMPOTENCY_KEY_LENGTH
        ) {
            throw createRepositoryError(
                'idempotency_key is too long.',
                'OPERATIONAL_ANALYTICS_IDEMPOTENCY_KEY_TOO_LONG',
                400
            );
        }

        event.internal_id =
            event.internal_id ||
            generateInternalId();

        const valid =
            validateOperationalEvent(
                event
            );

        if (
            !valid
        ) {
            throw createRepositoryError(
                'Invalid operational event payload.',
                'OPERATIONAL_ANALYTICS_VALIDATION_FAILED',
                400,
                {
                    errors:
                        validateOperationalEvent.errors
                }
            );
        }

        return event;
    }

    /**
     * =========================================================================
     * IDEMPOTENCY
     * =========================================================================
     */

    _idempotencyCacheKey(
        key
    ) {
        return (
            DEFAULTS.IDEMPOTENCY_PREFIX +
            key
        );
    }

    async _getIdempotent(
        key
    ) {
        if (
            !key ||
            !this.cacheClient ||
            typeof this.cacheClient.get !==
            'function'
        ) {
            return null;
        }

        try {
            const value =
                await this.cacheClient.get(
                    this._idempotencyCacheKey(
                        key
                    )
                );

            if (
                !value
            ) {
                return null;
            }

            return typeof value ===
                'string'
                ? JSON.parse(value)
                : value;
        } catch (
            error
        ) {
            this.logger.warn(
                `${DEFAULTS.LOG_PREFIX} idempotency read failed`,
                {
                    error:
                        error.message
                }
            );

            return null;
        }
    }

    async _setIdempotent(
        key,
        value
    ) {
        if (
            !key ||
            !this.cacheClient ||
            typeof this.cacheClient.set !==
            'function'
        ) {
            return;
        }

        try {
            const cacheKey =
                this._idempotencyCacheKey(
                    key
                );

            const payload =
                JSON.stringify(
                    value
                );

            try {
                await this.cacheClient.set(
                    cacheKey,
                    payload,
                    {
                        EX:
                            this.options
                                .IDEMPOTENCY_TTL
                    }
                );
            } catch {
                await this.cacheClient.set(
                    cacheKey,
                    payload,
                    'EX',
                    this.options
                        .IDEMPOTENCY_TTL
                );
            }
        } catch (
            error
        ) {
            this.logger.warn(
                `${DEFAULTS.LOG_PREFIX} idempotency write failed`,
                {
                    error:
                        error.message
                }
            );
        }
    }

    /**
     * =========================================================================
     * DISTRIBUTED LOCKING
     * =========================================================================
     */

    async _acquireLock(
        key,
        ttl = 30000
    ) {
        if (
            !this.lockClient ||
            typeof this.lockClient.acquire !==
            'function'
        ) {
            return null;
        }

        const lockKey =
            DEFAULTS.LOCK_PREFIX +
            key;

        try {
            return await this.lockClient.acquire(
                lockKey,
                ttl
            );
        } catch (
            error
        ) {
            this.logger.warn(
                `${DEFAULTS.LOG_PREFIX} lock acquisition failed`,
                {
                    lockKey,
                    error:
                        error.message
                }
            );

            return null;
        }
    }

    async _releaseLock(
        lock
    ) {
        if (
            !lock ||
            !this.lockClient ||
            typeof this.lockClient.release !==
            'function'
        ) {
            return;
        }

        try {
            await this.lockClient.release(
                lock
            );
        } catch (
            error
        ) {
            this.logger.warn(
                `${DEFAULTS.LOG_PREFIX} lock release failed`,
                {
                    error:
                        error.message
                }
            );
        }
    }

    /**
     * =========================================================================
     * INGESTION
     * =========================================================================
     */

    async recordOperationalEvent(
        rawEvent,
        options = {}
    ) {

        if (
            this._shuttingDown
        ) {
            throw createRepositoryError(
                'OperationalAnalyticsRepository is shutting down.',
                'OPERATIONAL_ANALYTICS_SHUTTING_DOWN',
                503
            );
        }

        let event;

        try {
            event =
                this._validateEvent(
                    rawEvent
                );
        } catch (
            error
        ) {
            this._stats.rejected +=
                1;

            this._metric(
                'titech.operational.analytics.invalid_event_total',
                1
            );

            throw error;
        }

        const existing =
            await this._getIdempotent(
                event.idempotency_key
            );

        if (
            existing
        ) {
            this._metric(
                'titech.operational.analytics.idempotent_hit_total',
                1,
                {
                    tenant:
                        event.tenant_id
                }
            );

            return existing;
        }

        if (
            this._queueSize >=
            this.options.MAX_QUEUE_SIZE
        ) {
            this._stats.rejected +=
                1;

            this._metric(
                'titech.operational.analytics.queue_full_total',
                1,
                {
                    tenant:
                        event.tenant_id
                }
            );

            throw createRepositoryError(
                'Operational analytics queue is full.',
                'OPERATIONAL_ANALYTICS_QUEUE_FULL',
                503,
                {
                    queueSize:
                        this._queueSize,

                    maxQueueSize:
                        this.options
                            .MAX_QUEUE_SIZE
                }
            );
        }

        this._queue.push(
            event
        );

        this._queueSize +=
            1;

        this._stats.enqueued +=
            1;

        this._metric(
            'titech.operational.analytics.enqueued_total',
            1,
            {
                tenant:
                    event.tenant_id,

                event_type:
                    event.event_type
            }
        );

        if (
            !this._batchTimer
        ) {
            this._startBatchTimer();
        }

        if (
            options.immediate ||
            this._queueSize >=
            this.options.BATCH_SIZE
        ) {
            void this._scheduleFlush();
        }

        /*
         * Alerting is intentionally non-blocking from the persistence path.
         */
        if (
            options.alertOnSeverity &&
            event.severity &&
            event.severity ===
            String(
                options.alertOnSeverity
            ).toLowerCase()
        ) {
            void this._notifyAlert(
                event
            );
        }

        return {
            accepted:
                true,

            queued:
                this._queueSize,

            internal_id:
                event.internal_id,

            idempotency_key:
                event.idempotency_key
        };
    }

    async bulkRecordOperationalEvents(
        events = [],
        options = {}
    ) {

        if (
            !Array.isArray(
                events
            )
        ) {
            throw createRepositoryError(
                'events must be an array.',
                'OPERATIONAL_ANALYTICS_EVENTS_ARRAY_REQUIRED',
                400
            );
        }

        const accepted =
            [];

        const rejected =
            [];

        for (
            const event
            of events
        ) {
            try {
                accepted.push(
                    await this.recordOperationalEvent(
                        event,
                        options
                    )
                );
            } catch (
                error
            ) {
                rejected.push({
                    code:
                        error.code,

                    error:
                        error.message,

                    event
                });
            }
        }

        return {
            accepted:
                accepted.length,

            rejected:
                rejected.length,

            items:
                accepted,

            errors:
                rejected
        };
    }

    /**
     * =========================================================================
     * QUEUE
     * =========================================================================
     */

    _startBatchTimer() {
        if (
            this._batchTimer
        ) {
            return;
        }

        this._batchTimer =
            setInterval(
                () => {
                    if (
                        this._queueSize >
                        0
                    ) {
                        void this._scheduleFlush();
                    }
                },
                this.options
                    .BATCH_INTERVAL_MS
            );

        this._batchTimer.unref?.();
    }

    _stopBatchTimer() {
        if (
            this._batchTimer
        ) {
            clearInterval(
                this._batchTimer
            );

            this._batchTimer =
                null;
        }
    }

    async _scheduleFlush() {
        if (
            this._flushPromise
        ) {
            return this._flushPromise;
        }

        this._flushPromise =
            this._flushBatch()
                .finally(
                    () => {
                        this._flushPromise =
                            null;
                    }
                );

        return this._flushPromise;
    }

    async _flushBatch() {
        if (
            this._running ||
            this._queueSize ===
            0
        ) {
            return;
        }

        this._running =
            true;

        const batch =
            this._queue.splice(
                0,
                Math.min(
                    this.options.BATCH_SIZE,
                    this._queueSize
                )
            );

        this._queueSize -=
            batch.length;

        if (
            this._queueSize ===
            0
        ) {
            this._stopBatchTimer();
        }

        try {
            await this._writeBatchWithRetry(
                batch
            );

            this._stats.flushed +=
                batch.length;

            this._metric(
                'titech.operational.analytics.flushed_total',
                batch.length
            );

            this.emit(
                'batchFlushed',
                batch
            );
        } catch (
            error
        ) {
            this._stats.failed +=
                batch.length;

            this._metric(
                'titech.operational.analytics.flush_failed_total',
                1
            );

            const available =
                Math.max(
                    0,
                    this.options
                        .MAX_QUEUE_SIZE -
                    this._queueSize
                );

            const requeue =
                batch.slice(
                    0,
                    available
                );

            const dropped =
                batch.slice(
                    available
                );

            this._queue =
                requeue.concat(
                    this._queue
                );

            this._queueSize +=
                requeue.length;

            this._stats.requeued +=
                requeue.length;

            this._stats.dropped +=
                dropped.length;

            this.emit(
                'batchError',
                error,
                batch
            );

            if (
                dropped.length
            ) {
                this.emit(
                    'batchDropped',
                    dropped
                );
            }

            this.logger.error(
                `${DEFAULTS.LOG_PREFIX} batch permanently failed`,
                {
                    error:
                        error.message,

                    batchSize:
                        batch.length,

                    requeued:
                        requeue.length,

                    dropped:
                        dropped.length
                }
            );
        } finally {
            this._running =
                false;

            if (
                this._queueSize >
                0 &&
                !this._batchTimer &&
                !this._shuttingDown
            ) {
                this._startBatchTimer();
            }
        }
    }

    async _writeBatchWithRetry(
        batch
    ) {

        const write =
            async () => {
                await this._writeBatch(
                    batch
                );

                await Promise.all(
                    batch.map(
                        event =>
                            this._setIdempotent(
                                event.idempotency_key,
                                {
                                    internal_id:
                                        event.internal_id,

                                    tenant_id:
                                        event.tenant_id,

                                    event_type:
                                        event.event_type,

                                    timestamp:
                                        nowIso()
                                }
                            )
                    )
                );
            };

        if (
            pRetry
        ) {
            return pRetry(
                write,
                {
                    retries:
                        Math.max(
                            0,
                            this.options
                                .WRITE_RETRY_ATTEMPTS -
                            1
                        ),

                    factor:
                        2,

                    minTimeout:
                        this.options
                            .WRITE_RETRY_MIN_TIMEOUT,

                    maxTimeout:
                        this.options
                            .WRITE_RETRY_MAX_TIMEOUT,

                    randomize:
                        true,

                    onFailedAttempt:
                        error => {
                            this.logger.warn(
                                `${DEFAULTS.LOG_PREFIX} batch write retry`,
                                {
                                    attempt:
                                        error.attemptNumber,

                                    retriesLeft:
                                        error.retriesLeft,

                                    error:
                                        error.message
                                }
                            );
                        }
                }
            );
        }

        return retryWithBackoff(
            write,
            {
                attempts:
                    this.options
                        .WRITE_RETRY_ATTEMPTS,

                minTimeout:
                    this.options
                        .WRITE_RETRY_MIN_TIMEOUT,

                maxTimeout:
                    this.options
                        .WRITE_RETRY_MAX_TIMEOUT
            }
        );
    }

    async _writeBatch(
        batch
    ) {

        if (
            this.writer
        ) {
            await this.writer(
                batch
            );

            return;
        }

        if (
            this.clickhouseClient
        ) {
            await this._writeToClickHouse(
                batch
            );

            return;
        }

        if (
            this.knex
        ) {
            await this._writeToSql(
                batch
            );

            return;
        }

        /*
         * Event-driven integration mode.
         */
        this.emit(
            'batch',
            batch
        );
    }

    /**
     * =========================================================================
     * SQL
     * =========================================================================
     */

    async _writeToSql(
        batch
    ) {

        if (
            !this.knex
        ) {
            throw new Error(
                'Knex client is not configured.'
            );
        }

        const groups =
            batch.reduce(
                (
                    result,
                    event
                ) => {
                    const tenant =
                        normalizeTenantId(
                            event.tenant_id
                        );

                    if (
                        !result[
                            tenant
                        ]
                    ) {
                        result[
                            tenant
                        ] = [];
                    }

                    result[
                        tenant
                    ].push(
                        event
                    );

                    return result;
                },
                {}
            );

        const mode =
            tenantConstants.getTenancyMode();

        for (
            const [
                tenantId,
                events
            ]
            of Object.entries(
                groups
            )
        ) {

            const table =
                resolveTable(
                    tenantId
                );

            const rows =
                events.map(
                    event => ({
                        internal_id:
                            event.internal_id,

                        tenant_id:
                            event.tenant_id,

                        event_type:
                            event.event_type,

                        source:
                            event.source,

                        host:
                            event.host,

                        severity:
                            event.severity,

                        metric_name:
                            event.metric_name,

                        metric_value:
                            event.metric_value,

                        payload:
                            JSON.stringify(
                                event.payload ||
                                {}
                            ),

                        metadata:
                            JSON.stringify(
                                event.metadata ||
                                {}
                            ),

                        idempotency_key:
                            event.idempotency_key,

                        created_at:
                            event.timestamp
                    })
                );

            await this.knex.batchInsert(
                table,
                rows,
                Math.min(
                    1000,
                    rows.length
                )
            );

            /*
             * Explicitly prevent accidental DATABASE-mode assumptions.
             * Database-level tenant routing should be supplied by the injected
             * knex instance in deployments using separate databases.
             */
            if (
                mode ===
                tenantConstants.TENANCY_MODES.DATABASE
            ) {
                this.logger.debug(
                    `${DEFAULTS.LOG_PREFIX} DATABASE tenancy write`,
                    {
                        tenantId,
                        rowCount:
                            rows.length
                    }
                );
            }
        }
    }

    /**
     * =========================================================================
     * CLICKHOUSE
     * =========================================================================
     */

    async _writeToClickHouse(
        batch
    ) {

        if (
            !this.clickhouseClient
        ) {
            throw new Error(
                'ClickHouse client is not configured.'
            );
        }

        const rows =
            batch.map(
                event => ({
                    internal_id:
                        event.internal_id,

                    tenant_id:
                        event.tenant_id,

                    event_type:
                        event.event_type,

                    source:
                        event.source,

                    host:
                        event.host,

                    severity:
                        event.severity,

                    metric_name:
                        event.metric_name,

                    metric_value:
                        event.metric_value,

                    payload:
                        JSON.stringify(
                            event.payload ||
                            {}
                        ),

                    metadata:
                        JSON.stringify(
                            event.metadata ||
                            {}
                        ),

                    idempotency_key:
                        event.idempotency_key,

                    created_at:
                        event.timestamp
                })
            );

        if (
            typeof this.clickhouseClient.insert ===
            'function'
        ) {
            await this.clickhouseClient.insert(
                'operational_events',
                rows
            );

            return;
        }

        if (
            typeof this.clickhouseClient.write ===
            'function'
        ) {
            await this.clickhouseClient.write(
                rows
            );

            return;
        }

        throw new Error(
            'Unsupported ClickHouse client interface.'
        );
    }

    /**
     * =========================================================================
     * QUERY
     * =========================================================================
     */

    async queryOperationalEvents(
        filters = {},
        opts = {}
    ) {

        const db =
            opts.knex ||
            this.knex;

        if (
            !db
        ) {
            throw new Error(
                'Knex is required for queryOperationalEvents.'
            );
        }

        const tenantId =
            normalizeTenantId(
                filters.tenantId
            );

        const page =
            normalizePage(
                opts.page
            );

        const pageSize =
            normalizePageSize(
                opts.pageSize,
                this.options.MAX_PAGE_SIZE
            );

        const offset =
            (
                page -
                1
            ) *
            pageSize;

        const mode =
            tenantConstants.getTenancyMode();

        const table =
            resolveTable(
                tenantId
            );

        const query =
            db
                .select('*')
                .from(table)
                .where(
                    'tenant_id',
                    tenantId
                );

        if (
            filters.eventType
        ) {
            query.where(
                'event_type',
                String(
                    filters.eventType
                )
            );
        }

        if (
            filters.source
        ) {
            query.where(
                'source',
                String(
                    filters.source
                )
            );
        }

        if (
            filters.host
        ) {
            query.where(
                'host',
                String(
                    filters.host
                )
            );
        }

        if (
            filters.severity
        ) {
            query.where(
                'severity',
                String(
                    filters.severity
                ).toLowerCase()
            );
        }

        if (
            filters.metricName
        ) {
            query.where(
                'metric_name',
                String(
                    filters.metricName
                )
            );
        }

        const from =
            parseDate(
                filters.from,
                'from'
            );

        const to =
            parseDate(
                filters.to,
                'to'
            );

        validateDateRange(
            from,
            to
        );

        if (
            from
        ) {
            query.where(
                'created_at',
                '>=',
                from
            );
        }

        if (
            to
        ) {
            query.where(
                'created_at',
                '<=',
                to
            );
        }

        if (
            filters.q
        ) {
            const search =
                String(
                    filters.q
                )
                    .slice(
                        0,
                        200
                    )
                    .replace(
                        /[%_]/g,
                        '\\$&'
                    );

            query.whereRaw(
                '(' +
                'CAST(payload AS TEXT) ILIKE ? ' +
                'OR CAST(metadata AS TEXT) ILIKE ?' +
                ')',
                [
                    `%${search}%`,
                    `%${search}%`
                ]
            );
        }

        const countQuery =
            query
                .clone()
                .clearSelect()
                .clearOrder()
                .count({
                    count:
                        '*'
                })
                .first();

        const [
            countResult,
            rows
        ] =
            await Promise.all([
                countQuery,

                query
                    .orderBy(
                        normalizeOrder(
                            opts.order
                        ),
                        normalizeDirection(
                            opts.direction
                        )
                    )
                    .offset(
                        offset
                    )
                    .limit(
                        pageSize
                    )
            ]);

        const total =
            safeCount(
                countResult?.count
            );

        return {
            page,

            pageSize,

            total,

            totalPages:
                Math.ceil(
                    total /
                    pageSize
                ),

            hasNextPage:
                offset +
                rows.length <
                total,

            tenancyMode:
                mode,

            items:
                rows.map(
                    row =>
                        this._parseRow(
                            row
                        )
                )
        };
    }

    _parseRow(
        row
    ) {
        return {
            ...row,

            payload:
                parseJson(
                    row.payload,
                    {}
                ),

            metadata:
                parseJson(
                    row.metadata,
                    {}
                )
        };
    }

    /**
     * =========================================================================
     * AGGREGATION
     * =========================================================================
     */

    async aggregate({
        type = 'count',
        groupBy = [
            'event_type'
        ],
        metric = null,
        filters = {},
        opts = {}
    } = {}) {

        const db =
            opts.knex ||
            this.knex;

        if (
            !db
        ) {
            throw new Error(
                'Knex is required for aggregate.'
            );
        }

        if (
            !ALLOWED_AGGREGATIONS.includes(
                type
            )
        ) {
            throw createRepositoryError(
                `Unsupported aggregation type: ${type}.`,
                'OPERATIONAL_ANALYTICS_UNSUPPORTED_AGGREGATION',
                400
            );
        }

        const tenantId =
            normalizeTenantId(
                filters.tenantId
            );

        const groups =
            normalizeGroupBy(
                groupBy
            );

        const table =
            resolveTable(
                tenantId
            );

        const query =
            db
                .from(table)
                .where(
                    'tenant_id',
                    tenantId
                );

        if (
            filters.eventType
        ) {
            query.where(
                'event_type',
                String(
                    filters.eventType
                )
            );
        }

        if (
            filters.source
        ) {
            query.where(
                'source',
                String(
                    filters.source
                )
            );
        }

        if (
            filters.severity
        ) {
            query.where(
                'severity',
                String(
                    filters.severity
                ).toLowerCase()
            );
        }

        const from =
            parseDate(
                filters.from,
                'from'
            );

        const to =
            parseDate(
                filters.to,
                'to'
            );

        validateDateRange(
            from,
            to
        );

        if (
            from
        ) {
            query.where(
                'created_at',
                '>=',
                from
            );
        }

        if (
            to
        ) {
            query.where(
                'created_at',
                '<=',
                to
            );
        }

        const selectGroups =
            groups.map(
                group =>
                    group ===
                    'date'
                        ? db.raw(
                            "date_trunc('day', created_at) AS date"
                        )
                        : group
            );

        for (
            const group
            of groups
        ) {
            if (
                group ===
                'date'
            ) {
                query.groupBy(
                    db.raw(
                        "date_trunc('day', created_at)"
                    )
                );
            } else {
                query.groupBy(
                    group
                );
            }
        }

        if (
            type ===
            'count'
        ) {
            return query
                .select(
                    selectGroups
                )
                .count({
                    count:
                        '*'
                });
        }

        if (
            !metric
        ) {
            throw createRepositoryError(
                'metric is required for this aggregation type.',
                'OPERATIONAL_ANALYTICS_METRIC_REQUIRED',
                400
            );
        }

        const metricField =
            String(
                metric
            );

        /*
         * Only allow known physical numeric fields. This prevents raw SQL
         * identifier injection through a user-supplied metric.
         */
        if (
            metricField !==
            'metric_value'
        ) {
            throw createRepositoryError(
                'Only metric_value is currently supported for numeric aggregation.',
                'OPERATIONAL_ANALYTICS_METRIC_NOT_ALLOWED',
                400
            );
        }

        const expressionMap = {
            sum:
                `sum(${metricField}) as value`,

            avg:
                `avg(${metricField}) as value`,

            min:
                `min(${metricField}) as value`,

            max:
                `max(${metricField}) as value`,

            p95:
                `percentile_disc(0.95) WITHIN GROUP (ORDER BY ${metricField}) as value`,

            p99:
                `percentile_disc(0.99) WITHIN GROUP (ORDER BY ${metricField}) as value`
        };

        return query
            .select(
                selectGroups
            )
            .select(
                db.raw(
                    expressionMap[
                        type
                    ]
                )
            );
    }

    /**
     * =========================================================================
     * LATENCY / SLA ANALYTICS
     * =========================================================================
     */

    async getLatencySummary({
        tenantId,
        metricName,
        from = null,
        to = null
    } = {}) {

        const normalizedTenant =
            normalizeTenantId(
                tenantId
            );

        const db =
            this.knex;

        if (
            !db
        ) {
            throw new Error(
                'Knex is required for getLatencySummary.'
            );
        }

        const table =
            resolveTable(
                normalizedTenant
            );

        const fromDate =
            parseDate(
                from,
                'from'
            );

        const toDate =
            parseDate(
                to,
                'to'
            );

        validateDateRange(
            fromDate,
            toDate
        );

        const query =
            db(table)
                .where(
                    'tenant_id',
                    normalizedTenant
                )
                .whereNotNull(
                    'metric_value'
                );

        if (
            metricName
        ) {
            query.where(
                'metric_name',
                String(
                    metricName
                )
            );
        }

        if (
            fromDate
        ) {
            query.where(
                'created_at',
                '>=',
                fromDate
            );
        }

        if (
            toDate
        ) {
            query.where(
                'created_at',
                '<=',
                toDate
            );
        }

        const result =
            await query
                .select(
                    db.raw(
                        'count(*) as sample_count'
                    )
                )
                .select(
                    db.raw(
                        'avg(metric_value) as average'
                    )
                )
                .select(
                    db.raw(
                        'min(metric_value) as minimum'
                    )
                )
                .select(
                    db.raw(
                        'max(metric_value) as maximum'
                    )
                )
                .select(
                    db.raw(
                        "percentile_disc(0.95) WITHIN GROUP (ORDER BY metric_value) as p95"
                    )
                )
                .select(
                    db.raw(
                        "percentile_disc(0.99) WITHIN GROUP (ORDER BY metric_value) as p99"
                    )
                )
                .first();

        return {
            tenantId:
                normalizedTenant,

            metricName:
                metricName ||
                null,

            sampleCount:
                safeCount(
                    result?.sample_count
                ),

            average:
                result?.average != null
                    ? Number(
                        result.average
                    )
                    : null,

            minimum:
                result?.minimum != null
                    ? Number(
                        result.minimum
                    )
                    : null,

            maximum:
                result?.maximum != null
                    ? Number(
                        result.maximum
                    )
                    : null,

            p95:
                result?.p95 != null
                    ? Number(
                        result.p95
                    )
                    : null,

            p99:
                result?.p99 != null
                    ? Number(
                        result.p99
                    )
                    : null
        };
    }

    async calculateSla({
        tenantId,
        from,
        to,
        slaTargetPercent = 99.9
    } = {}) {

        const normalizedTenant =
            normalizeTenantId(
                tenantId
            );

        const fromDate =
            parseDate(
                from,
                'from'
            );

        const toDate =
            parseDate(
                to,
                'to'
            );

        if (
            !fromDate ||
            !toDate
        ) {
            throw createRepositoryError(
                'from and to are required for SLA calculation.',
                'OPERATIONAL_ANALYTICS_SLA_DATE_RANGE_REQUIRED',
                400
            );
        }

        validateDateRange(
            fromDate,
            toDate
        );

        if (
            typeof slaTargetPercent !==
            'number' ||
            !Number.isFinite(
                slaTargetPercent
            ) ||
            slaTargetPercent < 0 ||
            slaTargetPercent > 100
        ) {
            throw createRepositoryError(
                'slaTargetPercent must be between 0 and 100.',
                'OPERATIONAL_ANALYTICS_INVALID_SLA_TARGET',
                400
            );
        }

        const db =
            this.knex;

        if (
            !db
        ) {
            throw new Error(
                'Knex is required for calculateSla.'
            );
        }

        const table =
            resolveTable(
                normalizedTenant
            );

        const incidents =
            await db(table)
                .where(
                    'tenant_id',
                    normalizedTenant
                )
                .where(
                    'event_type',
                    'incident'
                )
                .where(
                    'created_at',
                    '>=',
                    fromDate
                )
                .where(
                    'created_at',
                    '<=',
                    toDate
                )
                .whereIn(
                    'severity',
                    [
                        'error',
                        'critical',
                        'fatal'
                    ]
                )
                .count({
                    total:
                        '*'
                })
                .first();

        const breachCount =
            await db(table)
                .where(
                    'tenant_id',
                    normalizedTenant
                )
                .where(
                    'event_type',
                    'sla_breach'
                )
                .where(
                    'created_at',
                    '>=',
                    fromDate
                )
                .where(
                    'created_at',
                    '<=',
                    toDate
                )
                .count({
                    total:
                        '*'
                })
                .first();

        const incidentCount =
            safeCount(
                incidents?.total
            );

        const breachTotal =
            safeCount(
                breachCount?.total
            );

        /*
         * Operational SLA is represented as the complement of observed
         * explicit SLA breaches. This repository intentionally does not infer
         * unavailable service time from application telemetry.
         */
        const totalObservations =
            incidentCount +
            breachTotal;

        const availability =
            totalObservations ===
            0
                ? 100
                : (
                    (
                        totalObservations -
                        breachTotal
                    ) /
                    totalObservations
                ) *
                100;

        return {
            tenantId:
                normalizedTenant,

            from:
                fromDate.toISOString(),

            to:
                toDate.toISOString(),

            targetPercent:
                slaTargetPercent,

            availabilityPercent:
                Number(
                    availability.toFixed(
                        4
                    )
                ),

            breachCount:
                breachTotal,

            incidents:
                incidentCount,

            compliant:
                availability >=
                slaTargetPercent
        };
    }

    /**
     * =========================================================================
     * INCIDENT RECONCILIATION
     * =========================================================================
     */

    async reconcileIncidents(
        externalReports = [],
        opts = {}
    ) {

        const db =
            opts.knex ||
            this.knex;

        if (
            !db
        ) {
            throw new Error(
                'Knex is required for reconcileIncidents.'
            );
        }

        if (
            !Array.isArray(
                externalReports
            )
        ) {
            throw createRepositoryError(
                'externalReports must be an array.',
                'OPERATIONAL_ANALYTICS_INVALID_INCIDENT_REPORT',
                400
            );
        }

        const normalizedTenant =
            normalizeTenantId(
                opts.tenantId
            );

        const ids =
            externalReports
                .map(
                    report =>
                        report &&
                        report.incident_id
                )
                .filter(Boolean)
                .map(
                    String
                );

        if (
            !ids.length
        ) {
            return {
                matched: [],
                missing: [],
                mismatched: []
            };
        }

        const table =
            resolveTable(
                normalizedTenant
            );

        const rows =
            await db
                .select(
                    'internal_id',
                    'tenant_id',
                    'event_type',
                    'severity',
                    'payload',
                    'metadata',
                    'created_at'
                )
                .from(
                    table
                )
                .where(
                    'tenant_id',
                    normalizedTenant
                )
                .where(
                    'event_type',
                    'incident'
                );

        const indexed =
            new Map();

        for (
            const row
            of rows
        ) {
            const payload =
                parseJson(
                    row.payload,
                    {}
                );

            if (
                payload.incident_id
            ) {
                indexed.set(
                    String(
                        payload.incident_id
                    ),
                    {
                        row,
                        payload
                    }
                );
            }
        }

        const matched =
            [];

        const missing =
            [];

        const mismatched =
            [];

        for (
            const report
            of externalReports
        ) {
            const key =
                String(
                    report.incident_id
                );

            const stored =
                indexed.get(
                    key
                );

            if (
                !stored
            ) {
                missing.push({
                    incident_id:
                        key,

                    report
                });

                continue;
            }

            const storedStatus =
                stored.payload &&
                stored.payload.status;

            const storedSeverity =
                stored.payload &&
                stored.payload.severity;

            if (
                storedStatus ===
                report.status &&
                storedSeverity ===
                report.severity
            ) {
                matched.push({
                    incident_id:
                        key,

                    report,

                    stored:
                        stored.payload
                });
            } else {
                mismatched.push({
                    incident_id:
                        key,

                    report,

                    stored:
                        stored.payload
                });
            }
        }

        return {
            matched,
            missing,
            mismatched
        };
    }

    /**
     * =========================================================================
     * EXPORT
     * =========================================================================
     */

    async exportEvents(
        opts = {}
    ) {

        const db =
            opts.knex ||
            this.knex;

        if (
            !db
        ) {
            throw new Error(
                'Knex is required for exportEvents.'
            );
        }

        const tenantId =
            normalizeTenantId(
                opts.tenantId
            );

        const stream =
            opts.stream;

        if (
            !stream ||
            typeof stream.write !==
            'function'
        ) {
            throw createRepositoryError(
                'A writable stream is required.',
                'OPERATIONAL_ANALYTICS_EXPORT_STREAM_REQUIRED',
                400
            );
        }

        const format =
            String(
                opts.format ||
                'jsonl'
            ).toLowerCase();

        if (
            ![
                'jsonl',
                'csv'
            ].includes(
                format
            )
        ) {
            throw createRepositoryError(
                'Export format must be jsonl or csv.',
                'OPERATIONAL_ANALYTICS_EXPORT_FORMAT_INVALID',
                400
            );
        }

        const table =
            resolveTable(
                tenantId
            );

        const query =
            db
                .select('*')
                .from(
                    table
                )
                .where(
                    'tenant_id',
                    tenantId
                )
                .orderBy(
                    'created_at',
                    'asc'
                );

        const from =
            parseDate(
                opts.from,
                'from'
            );

        const to =
            parseDate(
                opts.to,
                'to'
            );

        validateDateRange(
            from,
            to
        );

        if (
            from
        ) {
            query.where(
                'created_at',
                '>=',
                from
            );
        }

        if (
            to
        ) {
            query.where(
                'created_at',
                '<=',
                to
            );
        }

        const source =
            query.stream();

        const headers = [
            'internal_id',
            'tenant_id',
            'event_type',
            'source',
            'host',
            'severity',
            'metric_name',
            'metric_value',
            'payload',
            'metadata',
            'idempotency_key',
            'created_at'
        ];

        let csvHeaderWritten =
            false;

        return new Promise(
            (
                resolve,
                reject
            ) => {

                source.on(
                    'data',
                    row => {
                        try {
                            const parsed =
                                this._parseRow(
                                    row
                                );

                            if (
                                format ===
                                'jsonl'
                            ) {
                                stream.write(
                                    JSON.stringify(
                                        parsed
                                    ) +
                                    '\n'
                                );

                                return;
                            }

                            if (
                                !csvHeaderWritten
                            ) {
                                stream.write(
                                    csvLine(
                                        headers
                                    )
                                );

                                csvHeaderWritten =
                                    true;
                            }

                            stream.write(
                                csvLine(
                                    [
                                        parsed.internal_id,
                                        parsed.tenant_id,
                                        parsed.event_type,
                                        parsed.source,
                                        parsed.host,
                                        parsed.severity,
                                        parsed.metric_name,
                                        parsed.metric_value,
                                        safeStringify(
                                            parsed.payload
                                        ),
                                        safeStringify(
                                            parsed.metadata
                                        ),
                                        parsed.idempotency_key,
                                        parsed.created_at
                                    ]
                                )
                            );
                        } catch (
                            error
                        ) {
                            reject(
                                error
                            );
                        }
                    }
                );

                source.on(
                    'end',
                    () => {
                        try {
                            stream.end();
                        } finally {
                            resolve(
                                true
                            );
                        }
                    }
                );

                source.on(
                    'error',
                    error => {
                        try {
                            stream.destroy?.(
                                error
                            );
                        } catch {}

                        reject(
                            error
                        );
                    }
                );
            }
        );
    }

    /**
     * =========================================================================
     * RETENTION
     * =========================================================================
     */

    async purgeOldEvents(
        opts = {}
    ) {

        const db =
            opts.knex ||
            this.knex;

        if (
            !db
        ) {
            throw new Error(
                'Knex is required for purgeOldEvents.'
            );
        }

        const olderThanDays =
            positiveInteger(
                opts.olderThanDays,
                this.options.RETENTION_DAYS
            );

        const cutoff =
            new Date(
                Date.now() -
                olderThanDays *
                86400000
            );

        const mode =
            tenantConstants.getTenancyMode();

        let affected =
            0;

        if (
            mode ===
            tenantConstants.TENANCY_MODES.SCHEMA
        ) {
            const tenants =
                await db
                    .select(
                        'tenant_id'
                    )
                    .from(
                        DEFAULTS
                            .TENANT_REGISTRY_TABLE
                    )
                    .whereNull(
                        'deleted_at'
                    );

            for (
                const tenant
                of tenants
            ) {
                const tenantId =
                    normalizeTenantId(
                        tenant.tenant_id
                    );

                const table =
                    resolveTable(
                        tenantId
                    );

                if (
                    opts.dryRun
                ) {
                    const row =
                        await db(table)
                            .where(
                                'created_at',
                                '<',
                                cutoff
                            )
                            .count({
                                count:
                                    '*'
                            })
                            .first();

                    affected +=
                        safeCount(
                            row?.count
                        );
                } else {
                    affected +=
                        safeCount(
                            await db(table)
                                .where(
                                    'created_at',
                                    '<',
                                    cutoff
                                )
                                .del()
                        );
                }
            }
        } else {
            const table =
                DEFAULTS.GLOBAL_TABLE;

            if (
                opts.dryRun
            ) {
                const row =
                    await db(table)
                        .where(
                            'created_at',
                            '<',
                            cutoff
                        )
                        .count({
                            count:
                                '*'
                        })
                        .first();

                affected =
                    safeCount(
                        row?.count
                    );
            } else {
                affected =
                    safeCount(
                        await db(table)
                            .where(
                                'created_at',
                                '<',
                                cutoff
                            )
                            .del()
                    );
            }
        }

        this._metric(
            'titech.operational.analytics.retention_affected_total',
            affected
        );

        return {
            dryRun:
                Boolean(
                    opts.dryRun
                ),

            olderThanDays,

            cutoff:
                cutoff.toISOString(),

            affected
        };
    }

    /**
     * =========================================================================
     * ALERTING
     * =========================================================================
     */

    async _notifyAlert(
        event
    ) {

        if (
            !this.alertingClient ||
            typeof this.alertingClient.notify !==
            'function'
        ) {
            return;
        }

        try {
            await this.alertingClient.notify(
                {
                    tenant:
                        event.tenant_id,

                    severity:
                        event.severity,

                    eventType:
                        event.event_type,

                    source:
                        event.source,

                    host:
                        event.host,

                    metricName:
                        event.metric_name,

                    metricValue:
                        event.metric_value,

                    payload:
                        event.payload,

                    metadata:
                        event.metadata,

                    timestamp:
                        event.timestamp,

                    service:
                        'TITech.OperationalAnalytics'
                }
            );

            this._metric(
                'titech.operational.analytics.alerts_sent_total',
                1,
                {
                    tenant:
                        event.tenant_id,

                    severity:
                        event.severity
                }
            );
        } catch (
            error
        ) {
            this.logger.warn(
                `${DEFAULTS.LOG_PREFIX} alerting failed`,
                {
                    error:
                        error.message
                }
            );

            this._metric(
                'titech.operational.analytics.alerts_failed_total',
                1
            );
        }
    }

    /**
     * =========================================================================
     * STREAMING
     * =========================================================================
     */

    async publishOperationalEvent(
        topic,
        event
    ) {

        if (
            !this.streamProducer ||
            typeof this.streamProducer.produce !==
            'function'
        ) {
            throw createRepositoryError(
                'streamProducer is not configured.',
                'OPERATIONAL_ANALYTICS_STREAM_NOT_CONFIGURED'
            );
        }

        const validated =
            this._validateEvent(
                event
            );

        const destination =
            topic ||
            DEFAULTS.STREAM_TOPIC;

        await this.streamProducer.produce(
            destination,
            Buffer.from(
                JSON.stringify(
                    validated
                )
            )
        );

        this._metric(
            'titech.operational.analytics.published_total',
            1,
            {
                tenant:
                    validated.tenant_id,

                event_type:
                    validated.event_type
            }
        );

        return {
            published:
                true,

            topic:
                destination,

            event:
                validated
        };
    }

    /**
     * =========================================================================
     * HEALTH
     * =========================================================================
     */

    async healthcheck() {

        const checks = {
            ok:
                true,

            details:
                {},

            queueSize:
                this._queueSize,

            running:
                this._running,

            shuttingDown:
                this._shuttingDown
        };

        if (
            this.knex
        ) {
            try {
                await this.knex.raw(
                    'SELECT 1'
                );

                checks.details.knex =
                    'ok';
            } catch (
                error
            ) {
                checks.ok =
                    false;

                checks.details.knex =
                    `error: ${error.message}`;
            }
        }

        if (
            this.clickhouseClient &&
            typeof this.clickhouseClient.ping ===
            'function'
        ) {
            try {
                await this.clickhouseClient.ping();

                checks.details.clickhouse =
                    'ok';
            } catch (
                error
            ) {
                checks.ok =
                    false;

                checks.details.clickhouse =
                    `error: ${error.message}`;
            }
        }

        if (
            this.cacheClient &&
            typeof this.cacheClient.ping ===
            'function'
        ) {
            try {
                await this.cacheClient.ping();

                checks.details.cache =
                    'ok';
            } catch (
                error
            ) {
                checks.ok =
                    false;

                checks.details.cache =
                    `error: ${error.message}`;
            }
        }

        if (
            this.streamProducer &&
            typeof this.streamProducer.ping ===
            'function'
        ) {
            try {
                await this.streamProducer.ping();

                checks.details.stream =
                    'ok';
            } catch (
                error
            ) {
                checks.ok =
                    false;

                checks.details.stream =
                    `error: ${error.message}`;
            }
        }

        return checks;
    }

    /**
     * =========================================================================
     * STATS
     * =========================================================================
     */

    stats() {

        return {
            queueSize:
                this._queueSize,

            enqueued:
                this._stats.enqueued,

            flushed:
                this._stats.flushed,

            failed:
                this._stats.failed,

            rejected:
                this._stats.rejected,

            requeued:
                this._stats.requeued,

            dropped:
                this._stats.dropped,

            running:
                this._running,

            shuttingDown:
                this._shuttingDown,

            options: {
                batchSize:
                    this.options
                        .BATCH_SIZE,

                batchIntervalMs:
                    this.options
                        .BATCH_INTERVAL_MS,

                maxQueueSize:
                    this.options
                        .MAX_QUEUE_SIZE,

                retentionDays:
                    this.options
                        .RETENTION_DAYS
            }
        };
    }

    /**
     * =========================================================================
     * METRICS
     * =========================================================================
     */

    _metric(
        name,
        value = 1,
        labels = {}
    ) {
        try {
            this.metrics.increment(
                name,
                value,
                labels
            );
        } catch {
            /*
             * Operational analytics must never fail merely because a metrics
             * backend is unavailable.
             */
        }
    }

    /**
     * =========================================================================
     * SHUTDOWN
     * =========================================================================
     */

    async shutdown({
        timeoutMs = 30000
    } = {}) {

        this._shuttingDown =
            true;

        this._stopBatchTimer();

        this.logger.info(
            `${DEFAULTS.LOG_PREFIX} shutdown initiated`,
            {
                queueSize:
                    this._queueSize
            }
        );

        const startedAt =
            Date.now();

        while (
            this._queueSize >
                0 &&
            Date.now() -
                startedAt <
                timeoutMs
        ) {

            await this._scheduleFlush();

            if (
                this._queueSize >
                    0
            ) {
                await sleep(
                    100
                );
            }
        }

        const complete =
            this._queueSize ===
            0;

        if (
            !complete
        ) {
            this.logger.warn(
                `${DEFAULTS.LOG_PREFIX} shutdown timed out`,
                {
                    remaining:
                        this._queueSize
                }
            );
        } else {
            this.logger.info(
                `${DEFAULTS.LOG_PREFIX} shutdown completed`
            );
        }

        return {
            complete,

            remaining:
                this._queueSize
        };
    }
}

/**
 * ============================================================================
 * METRICS NORMALIZATION
 * ============================================================================
 */

function normalizeMetrics(
    metrics
) {
    return {
        increment:
            typeof metrics?.increment ===
            'function'
                ? metrics.increment.bind(
                    metrics
                )
                : () => {},

        gauge:
            typeof metrics?.gauge ===
            'function'
                ? metrics.gauge.bind(
                    metrics
                )
                : () => {},

        timing:
            typeof metrics?.timing ===
            'function'
                ? metrics.timing.bind(
                    metrics
                )
                : () => {}
    };
}

/**
 * ============================================================================
 * FACTORY
 * ============================================================================
 */

function createOperationalAnalyticsRepository(
    deps = {}
) {
    return new OperationalAnalyticsRepository(
        deps
    );
}

/**
 * ============================================================================
 * EXPORT
 * ============================================================================
 */

module.exports = {
    OperationalAnalyticsRepository,

    createOperationalAnalyticsRepository,

    DEFAULTS,

    validateOperationalEvent
};