"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Member Analytics Repository
 * ============================================================================
 *
 * File:
 *   backend/repositories/analytics/memberAnalytics.repository.js
 *
 * Purpose:
 *   Enterprise analytics persistence boundary for TITech member activity,
 *   engagement, membership lifecycle and operational telemetry.
 *
 * ============================================================================
 * CAPABILITIES
 * ============================================================================
 *
 * ✓ Multi-tenant member analytics
 * ✓ Strict tenant isolation
 * ✓ AJV event validation
 * ✓ Deterministic event identity / idempotency
 * ✓ Backpressure protection
 * ✓ Batched ingestion
 * ✓ Retry with exponential backoff
 * ✓ Failed-batch requeue
 * ✓ SQL / ClickHouse / custom writer support
 * ✓ Safe query pagination
 * ✓ Safe aggregation/grouping
 * ✓ Unique-member analytics
 * ✓ Activity trends
 * ✓ Member engagement metrics
 * ✓ Streaming exports
 * ✓ Retention management
 * ✓ Cache support
 * ✓ Optional event streaming
 * ✓ Health checks
 * ✓ Operational metrics
 * ✓ Graceful shutdown
 *
 * ============================================================================
 * ARCHITECTURAL NON-RESPONSIBILITIES
 * ============================================================================
 *
 * ✗ Does not authorize users.
 * ✗ Does not mutate member balances.
 * ✗ Does not modify membership records.
 * ✗ Does not make financial decisions.
 * ✗ Does not perform RBAC.
 * ✗ Does not determine business eligibility.
 *
 * ============================================================================
 * FINANCIAL / DATA SAFETY
 * ============================================================================
 *
 * Member analytics is non-ledger telemetry, but tenant isolation remains
 * mandatory because analytics may contain sensitive member activity.
 *
 * ============================================================================
 * TITech naming
 * ============================================================================
 *
 * All legacy ACFOS terminology has been removed in favor of TITech.
 * ============================================================================
 */

const EventEmitter = require("events");
const crypto = require("crypto");

let Ajv;
let addFormats;
let pRetry = null;

try {
    const ajvModule = require("ajv");
    Ajv = ajvModule.default || ajvModule;
} catch (error) {
    throw new Error(
        "TITech MemberAnalyticsRepository requires the 'ajv' package."
    );
}

try {
    const formatsModule = require("ajv-formats");
    addFormats =
        formatsModule.default ||
        formatsModule;
} catch (error) {
    throw new Error(
        "TITech MemberAnalyticsRepository requires the 'ajv-formats' package."
    );
}

try {
    const retryModule = require("p-retry");
    pRetry =
        retryModule.default ||
        retryModule;
} catch {
    // Fallback retry implementation is provided below.
}

const tenantConstants =
    require("../../tenancy/tenant.constants");

/**
 * ============================================================================
 * DEFAULT CONFIGURATION
 * ============================================================================
 */

const DEFAULTS = Object.freeze({
    BATCH_SIZE:
        positiveInteger(
            process.env.MEMBER_ANALYTICS_BATCH_SIZE,
            500
        ),

    BATCH_INTERVAL_MS:
        positiveInteger(
            process.env.MEMBER_ANALYTICS_BATCH_INTERVAL_MS,
            2000
        ),

    MAX_QUEUE_SIZE:
        positiveInteger(
            process.env.MEMBER_ANALYTICS_MAX_QUEUE_SIZE,
            50000
        ),

    WRITE_RETRY_ATTEMPTS:
        positiveInteger(
            process.env.MEMBER_ANALYTICS_WRITE_RETRY_ATTEMPTS,
            3
        ),

    WRITE_RETRY_MIN_TIMEOUT:
        positiveInteger(
            process.env.MEMBER_ANALYTICS_WRITE_RETRY_MIN_TIMEOUT,
            100
        ),

    WRITE_RETRY_MAX_TIMEOUT:
        positiveInteger(
            process.env.MEMBER_ANALYTICS_WRITE_RETRY_MAX_TIMEOUT,
            5000
        ),

    IDEMPOTENCY_TTL:
        positiveInteger(
            process.env.MEMBER_ANALYTICS_IDEMPOTENCY_TTL,
            86400
        ),

    RETENTION_DAYS:
        positiveInteger(
            process.env.MEMBER_ANALYTICS_RETENTION_DAYS,
            1095
        ),

    MAX_PAGE_SIZE:
        positiveInteger(
            process.env.MEMBER_ANALYTICS_MAX_PAGE_SIZE,
            1000
        ),

    EXPORT_BATCH_SIZE:
        positiveInteger(
            process.env.MEMBER_ANALYTICS_EXPORT_BATCH_SIZE,
            1000
        ),

    TABLE_PREFIX:
        tenantConstants.ENV.DB_TABLE_PREFIX ||
        "titech_",

    GLOBAL_TABLE:
        `${tenantConstants.ENV.DB_TABLE_PREFIX || "titech_"}member_events`,

    IDEMPOTENCY_PREFIX:
        "titech:member:analytics:idempotency:",

    CACHE_PREFIX:
        "titech:member:analytics:",

    LOG_PREFIX:
        "TITech.MemberAnalytics",

    MAX_EVENT_TYPE_LENGTH:
        128,

    MAX_MEMBER_ID_LENGTH:
        128,

    MAX_USER_ID_LENGTH:
        128,

    MAX_SESSION_ID_LENGTH:
        256,

    MAX_IDEMPOTENCY_KEY_LENGTH:
        256,

    EVENT_TYPES: Object.freeze([
        "member_created",
        "member_registered",
        "profile_created",
        "profile_updated",
        "profile_verified",
        "membership_activated",
        "membership_suspended",
        "membership_reactivated",
        "membership_closed",
        "membership_change",
        "kyc_started",
        "kyc_completed",
        "kyc_rejected",
        "login",
        "logout",
        "session_started",
        "session_ended",
        "activity",
        "engagement",
        "notification_sent",
        "notification_opened",
        "message_sent",
        "message_received",
        "support_opened",
        "support_closed",
        "group_joined",
        "group_left",
        "savings_activity",
        "loan_activity",
        "payment_activity",
        "referral_activity",
        "ussd_activity",
        "momo_activity"
    ])
});

/**
 * ============================================================================
 * AJV VALIDATION
 * ============================================================================
 */

const ajv =
    new Ajv({
        allErrors: true,
        coerceTypes: false,
        removeAdditional: false,
        useDefaults: false,
        strict: true
    });

addFormats(ajv);

const memberEventSchema = {
    type: "object",

    required: [
        "tenant_id",
        "event_type",
        "timestamp",
        "payload"
    ],

    properties: {
        internal_id: {
            type: "string",
            minLength: 1,
            maxLength: 128
        },

        tenant_id: {
            type: "string",
            minLength: 3,
            maxLength: 64
        },

        event_type: {
            type: "string",
            minLength: 1,
            maxLength:
                DEFAULTS.MAX_EVENT_TYPE_LENGTH,
            pattern: "^[a-zA-Z0-9._:-]+$"
        },

        timestamp: {
            type: "string",
            format: "date-time"
        },

        member_id: {
            type: ["string", "null"],
            maxLength:
                DEFAULTS.MAX_MEMBER_ID_LENGTH
        },

        user_id: {
            type: ["string", "null"],
            maxLength:
                DEFAULTS.MAX_USER_ID_LENGTH
        },

        session_id: {
            type: ["string", "null"],
            maxLength:
                DEFAULTS.MAX_SESSION_ID_LENGTH
        },

        idempotency_key: {
            type: ["string", "null"],
            minLength: 1,
            maxLength:
                DEFAULTS.MAX_IDEMPOTENCY_KEY_LENGTH
        },

        payload: {
            type: "object",
            additionalProperties: true
        },

        metadata: {
            type: "object",
            additionalProperties: true
        }
    },

    additionalProperties: false
};

const validateMemberEvent =
    ajv.compile(
        memberEventSchema
    );

/**
 * ============================================================================
 * SAFE METRICS
 * ============================================================================
 */

const NOOP_METRICS = Object.freeze({
    increment() {},
    gauge() {},
    timing() {}
});

/**
 * ============================================================================
 * QUERY / SQL WHITELISTS
 * ============================================================================
 */

const ALLOWED_ORDER_FIELDS =
    Object.freeze([
        "created_at",
        "event_type",
        "member_id",
        "user_id",
        "session_id",
        "tenant_id"
    ]);

const ALLOWED_GROUP_FIELDS =
    Object.freeze([
        "event_type",
        "member_id",
        "user_id",
        "session_id",
        "date"
    ]);

/**
 * ============================================================================
 * UTILITY FUNCTIONS
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
        (resolve) =>
            setTimeout(
                resolve,
                ms
            )
    );
}

function safeStringify(
    value
) {
    try {
        return JSON.stringify(
            value
        );
    } catch {
        return "[unserializable]";
    }
}

function generateInternalId() {
    return crypto
        .randomBytes(16)
        .toString("hex");
}

function isPlainObject(
    value
) {
    return Boolean(
        value &&
        typeof value === "object" &&
        !Array.isArray(value)
    );
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
        const error =
            new Error(
                `${field} must be a valid date.`
            );

        error.code =
            "MEMBER_ANALYTICS_INVALID_DATE";

        error.statusCode =
            400;

        throw error;
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
        const error =
            new Error(
                "from must be earlier than or equal to to."
            );

        error.code =
            "MEMBER_ANALYTICS_INVALID_DATE_RANGE";

        error.statusCode =
            400;

        throw error;
    }
}

function normalizeTenantId(
    tenantId
) {
    if (
        tenantId === undefined ||
        tenantId === null
    ) {
        throw repositoryError(
            "tenantId is required.",
            "MEMBER_ANALYTICS_TENANT_REQUIRED",
            400
        );
    }

    const normalized =
        String(
            tenantId
        )
            .trim()
            .toLowerCase();

    if (
        typeof tenantConstants
            .isValidTenantId ===
        "function" &&
        !tenantConstants.isValidTenantId(
            normalized
        )
    ) {
        throw repositoryError(
            "Invalid TITech tenant identifier.",
            "MEMBER_ANALYTICS_INVALID_TENANT",
            400
        );
    }

    return normalized;
}

function normalizeIdentifier(
    value,
    field,
    maxLength
) {
    if (
        value === undefined ||
        value === null
    ) {
        throw repositoryError(
            `${field} is required.`,
            "MEMBER_ANALYTICS_FIELD_REQUIRED",
            400,
            { field }
        );
    }

    const normalized =
        String(value).trim();

    if (!normalized) {
        throw repositoryError(
            `${field} is required.`,
            "MEMBER_ANALYTICS_FIELD_REQUIRED",
            400,
            { field }
        );
    }

    if (
        normalized.length >
        maxLength
    ) {
        throw repositoryError(
            `${field} exceeds the maximum permitted length.`,
            "MEMBER_ANALYTICS_FIELD_TOO_LONG",
            400,
            {
                field,
                maxLength
            }
        );
    }

    if (
        !/^[a-zA-Z0-9._:@/+,-]+$/.test(
            normalized
        )
    ) {
        throw repositoryError(
            `${field} contains invalid characters.`,
            "MEMBER_ANALYTICS_INVALID_IDENTIFIER",
            400,
            { field }
        );
    }

    return normalized;
}

function normalizeEventType(
    eventType
) {
    const normalized =
        normalizeIdentifier(
            eventType,
            "event_type",
            DEFAULTS.MAX_EVENT_TYPE_LENGTH
        );

    if (
        !DEFAULTS.EVENT_TYPES.includes(
            normalized
        )
    ) {
        throw repositoryError(
            `Unsupported member event type: ${normalized}.`,
            "MEMBER_ANALYTICS_UNSUPPORTED_EVENT_TYPE",
            400,
            {
                eventType:
                    normalized
            }
        );
    }

    return normalized;
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
    order
) {
    const value =
        String(
            order ||
            "created_at"
        ).trim();

    return ALLOWED_ORDER_FIELDS.includes(
        value
    )
        ? value
        : "created_at";
}

function normalizeDirection(
    direction
) {
    return String(
        direction ||
        "desc"
    ).toLowerCase() ===
        "asc"
        ? "asc"
        : "desc";
}

function normalizeGroupBy(
    groupBy
) {
    const fields =
        Array.isArray(groupBy)
            ? groupBy
            : ["event_type"];

    const valid =
        fields.filter(
            (field) =>
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
        : ["event_type"];
}

function repositoryError(
    message,
    code,
    statusCode = 500,
    details
) {
    const error =
        new Error(message);

    error.name =
        "MemberAnalyticsRepositoryError";

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

function normalizeMetricsClient(
    metrics
) {
    return {
        increment:
            typeof metrics?.increment ===
            "function"
                ? metrics.increment.bind(
                    metrics
                )
                : NOOP_METRICS.increment,

        gauge:
            typeof metrics?.gauge ===
            "function"
                ? metrics.gauge.bind(
                    metrics
                )
                : NOOP_METRICS.gauge,

        timing:
            typeof metrics?.timing ===
            "function"
                ? metrics.timing.bind(
                    metrics
                )
                : NOOP_METRICS.timing
    };
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
        typeof value === "object"
    ) {
        return value;
    }

    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function toSafeInteger(
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
        BigInt(text);

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

function normalizeEventObject(
    event
) {
    const copy =
        {
            ...event
        };

    if (
        !isPlainObject(
            copy.payload
        )
    ) {
        copy.payload = {};
    }

    if (
        !isPlainObject(
            copy.metadata
        )
    ) {
        copy.metadata = {};
    }

    return copy;
}

function deterministicIdempotencyKey(
    event
) {
    return crypto
        .createHash("sha256")
        .update(
            [
                event.tenant_id,
                event.event_type,
                event.member_id || "",
                event.user_id || "",
                event.session_id || "",
                event.timestamp,
                safeStringify(
                    event.payload
                )
            ].join("|")
        )
        .digest("hex");
}

function resolveMemberEventsTable(
    tenantId,
    mode
) {
    const normalizedTenant =
        normalizeTenantId(
            tenantId
        );

    if (
        mode ===
        tenantConstants.TENANCY_MODES.SCHEMA
    ) {
        const schema =
            tenantConstants.schemaNameForTenant(
                normalizedTenant
            );

        return `${schema}.member_events`;
    }

    return DEFAULTS.GLOBAL_TABLE;
}

function groupByTenant(
    events
) {
    return events.reduce(
        (
            result,
            event
        ) => {
            const tenantId =
                normalizeTenantId(
                    event.tenant_id
                );

            if (
                !result[
                    tenantId
                ]
            ) {
                result[
                    tenantId
                ] = [];
            }

            result[
                tenantId
            ].push(
                event
            );

            return result;
        },
        {}
    );
}

/**
 * ============================================================================
 * MEMBER ANALYTICS REPOSITORY
 * ============================================================================
 */

class MemberAnalyticsRepository
    extends EventEmitter {

    constructor({
        knex = null,
        clickhouseClient = null,
        writer = null,
        cacheClient = null,
        streamProducer = null,
        lockClient = null,
        logger = console,
        metrics = null,
        options = {}
    } = {}) {

        super();

        if (!logger) {
            throw repositoryError(
                "logger is required.",
                "MEMBER_ANALYTICS_LOGGER_REQUIRED"
            );
        }

        this.knex =
            knex;

        this.clickhouseClient =
            clickhouseClient;

        this.writer =
            typeof writer ===
            "function"
                ? writer
                : null;

        this.cacheClient =
            cacheClient;

        this.streamProducer =
            streamProducer;

        this.lockClient =
            lockClient;

        this.logger =
            logger;

        this.metrics =
            normalizeMetricsClient(
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

        this._stats =
            {
                enqueued: 0,
                flushed: 0,
                failed: 0,
                rejected: 0,
                requeued: 0,
                dropped: 0
            };

        this.recordMemberEvent =
            this.recordMemberEvent.bind(
                this
            );

        this.bulkRecordMemberEvents =
            this.bulkRecordMemberEvents.bind(
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
            throw repositoryError(
                "Member analytics event must be an object.",
                "MEMBER_ANALYTICS_INVALID_EVENT",
                400
            );
        }

        const event =
            normalizeEventObject(
                rawEvent
            );

        event.tenant_id =
            normalizeTenantId(
                event.tenant_id
            );

        event.event_type =
            normalizeEventType(
                event.event_type
            );

        const timestamp =
            event.timestamp
                ? parseDate(
                    event.timestamp,
                    "timestamp"
                )
                : new Date();

        event.timestamp =
            timestamp.toISOString();

        if (
            event.member_id !==
                undefined &&
            event.member_id !==
                null
        ) {
            event.member_id =
                normalizeIdentifier(
                    event.member_id,
                    "member_id",
                    DEFAULTS.MAX_MEMBER_ID_LENGTH
                );
        } else {
            event.member_id =
                null;
        }

        if (
            event.user_id !==
                undefined &&
            event.user_id !==
                null
        ) {
            event.user_id =
                normalizeIdentifier(
                    event.user_id,
                    "user_id",
                    DEFAULTS.MAX_USER_ID_LENGTH
                );
        } else {
            event.user_id =
                null;
        }

        if (
            event.session_id !==
                undefined &&
            event.session_id !==
                null
        ) {
            event.session_id =
                normalizeIdentifier(
                    event.session_id,
                    "session_id",
                    DEFAULTS.MAX_SESSION_ID_LENGTH
                );
        } else {
            event.session_id =
                null;
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
                deterministicIdempotencyKey(
                    event
                );
        }

        if (
            event.idempotency_key.length >
            DEFAULTS.MAX_IDEMPOTENCY_KEY_LENGTH
        ) {
            throw repositoryError(
                "idempotency_key exceeds the maximum permitted length.",
                "MEMBER_ANALYTICS_IDEMPOTENCY_KEY_TOO_LONG",
                400
            );
        }

        event.internal_id =
            event.internal_id ||
            generateInternalId();

        const valid =
            validateMemberEvent(
                event
            );

        if (!valid) {
            throw repositoryError(
                "Invalid member analytics event payload.",
                "MEMBER_ANALYTICS_VALIDATION_FAILED",
                400,
                {
                    errors:
                        validateMemberEvent.errors
                }
            );
        }

        /**
         * Never permit caller-controlled prototype pollution structures
         * to reach storage.
         */
        if (
            Object.prototype.hasOwnProperty.call(
                event.payload,
                "__proto__"
            )
        ) {
            throw repositoryError(
                "Invalid payload structure.",
                "MEMBER_ANALYTICS_INVALID_PAYLOAD",
                400
            );
        }

        return event;
    }

    /**
     * =========================================================================
     * CACHE / IDEMPOTENCY
     * =========================================================================
     */

    _idempotencyKey(
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
                "function"
        ) {
            return null;
        }

        try {
            const raw =
                await this.cacheClient.get(
                    this._idempotencyKey(
                        key
                    )
                );

            if (
                !raw
            ) {
                return null;
            }

            return typeof raw ===
                "string"
                ? JSON.parse(raw)
                : raw;
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
                "function"
        ) {
            return;
        }

        try {
            const cacheKey =
                this._idempotencyKey(
                    key
                );

            const serialized =
                JSON.stringify(
                    value
                );

            try {
                await this.cacheClient.set(
                    cacheKey,
                    serialized,
                    {
                        EX:
                            this.options.IDEMPOTENCY_TTL
                    }
                );
            } catch {
                await this.cacheClient.set(
                    cacheKey,
                    serialized,
                    "EX",
                    this.options.IDEMPOTENCY_TTL
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
                "function"
        ) {
            return null;
        }

        const lockKey =
            `titech:member-analytics:lock:${key}`;

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
                "function"
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

    async recordMemberEvent(
        rawEvent,
        options = {}
    ) {

        if (
            this._shuttingDown
        ) {
            throw repositoryError(
                "MemberAnalyticsRepository is shutting down.",
                "MEMBER_ANALYTICS_SHUTTING_DOWN",
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
            this._stats.rejected++;

            this._safeMetric(
                "titech.member.analytics.invalid_event",
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
            this._safeMetric(
                "titech.member.analytics.idempotent_hit",
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
            this._stats.rejected++;

            this._safeMetric(
                "titech.member.analytics.queue_full",
                1,
                {
                    tenant:
                        event.tenant_id
                }
            );

            throw repositoryError(
                "Member analytics queue is full.",
                "MEMBER_ANALYTICS_QUEUE_FULL",
                503,
                {
                    queueSize:
                        this._queueSize,

                    maxQueueSize:
                        this.options.MAX_QUEUE_SIZE
                }
            );
        }

        this._queue.push(
            event
        );

        this._queueSize++;

        this._stats.enqueued++;

        this._safeMetric(
            "titech.member.analytics.enqueued_total",
            1,
            {
                tenant:
                    event.tenant_id
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

    async bulkRecordMemberEvents(
        events = [],
        options = {}
    ) {

        if (
            !Array.isArray(
                events
            )
        ) {
            throw repositoryError(
                "events must be an array.",
                "MEMBER_ANALYTICS_EVENTS_ARRAY_REQUIRED",
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
                    await this.recordMemberEvent(
                        event,
                        options
                    )
                );
            } catch (
                error
            ) {
                rejected.push(
                    {
                        error:
                            error.message,

                        code:
                            error.code,

                        event
                    }
                );
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
     * BATCH PROCESSING
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
                this.options.BATCH_INTERVAL_MS
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

        const batchSize =
            Math.min(
                this.options.BATCH_SIZE,
                this._queueSize
            );

        const batch =
            this._queue.splice(
                0,
                batchSize
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

            this._safeMetric(
                "titech.member.analytics.flushed_total",
                batch.length
            );

            this.logger.debug(
                `${DEFAULTS.LOG_PREFIX} batch flushed`,
                {
                    count:
                        batch.length
                }
            );
        } catch (
            error
        ) {
            this._stats.failed +=
                batch.length;

            this._safeMetric(
                "titech.member.analytics.flush_failed",
                1
            );

            /**
             * Never silently discard telemetry when durable persistence is
             * expected. Requeue as much as the queue can hold.
             */
            const capacity =
                Math.max(
                    0,
                    this.options.MAX_QUEUE_SIZE -
                        this._queueSize
                );

            const requeue =
                batch.slice(
                    0,
                    capacity
                );

            const dropped =
                batch.slice(
                    capacity
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
                "batchError",
                error,
                batch
            );

            if (
                dropped.length
            ) {
                this.emit(
                    "batchDropped",
                    dropped
                );
            }

            this.logger.error(
                `${DEFAULTS.LOG_PREFIX} batch write failed`,
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
        const operation =
            async () => {
                await this._writeBatch(
                    batch
                );

                for (
                    const event
                    of batch
                ) {
                    await this._setIdempotent(
                        event.idempotency_key,
                        {
                            internal_id:
                                event.internal_id,

                            tenant_id:
                                event.tenant_id,

                            member_id:
                                event.member_id,

                            event_type:
                                event.event_type,

                            timestamp:
                                nowIso()
                        }
                    );
                }
            };

        if (
            pRetry
        ) {
            return pRetry(
                operation,
                {
                    retries:
                        Math.max(
                            0,
                            this.options
                                .WRITE_RETRY_ATTEMPTS -
                            1
                        ),

                    minTimeout:
                        this.options
                            .WRITE_RETRY_MIN_TIMEOUT,

                    maxTimeout:
                        this.options
                            .WRITE_RETRY_MAX_TIMEOUT,

                    factor:
                        2,

                    randomize:
                        true,

                    onFailedAttempt:
                        (error) => {
                            this.logger.warn(
                                `${DEFAULTS.LOG_PREFIX} retrying batch write`,
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
            operation,
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
            !Array.isArray(
                batch
            ) ||
            !batch.length
        ) {
            return;
        }

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

        /**
         * Event-driven deployment mode.
         *
         * A consumer may listen to:
         *
         *   repository.on("batch", handler)
         */
        this.emit(
            "batch",
            batch
        );
    }

    /**
     * =========================================================================
     * SQL WRITER
     * =========================================================================
     */

    async _writeToSql(
        batch = []
    ) {
        if (
            !this.knex
        ) {
            throw new Error(
                "Knex client is not configured."
            );
        }

        const mode =
            tenantConstants.getTenancyMode();

        const groups =
            groupByTenant(
                batch
            );

        for (
            const [
                tenantId,
                events
            ] of Object.entries(
                groups
            )
        ) {
            const table =
                resolveMemberEventsTable(
                    tenantId,
                    mode
                );

            const rows =
                events.map(
                    (event) => ({
                        internal_id:
                            event.internal_id,

                        tenant_id:
                            event.tenant_id,

                        member_id:
                            event.member_id,

                        user_id:
                            event.user_id,

                        session_id:
                            event.session_id,

                        event_type:
                            event.event_type,

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
                    this.options.BATCH_SIZE,
                    rows.length
                )
            );
        }
    }

    /**
     * =========================================================================
     * CLICKHOUSE WRITER
     * =========================================================================
     */

    async _writeToClickHouse(
        batch = []
    ) {
        if (
            !this.clickhouseClient
        ) {
            throw new Error(
                "ClickHouse client is not configured."
            );
        }

        const rows =
            batch.map(
                (event) => ({
                    internal_id:
                        event.internal_id,

                    tenant_id:
                        event.tenant_id,

                    member_id:
                        event.member_id,

                    user_id:
                        event.user_id,

                    session_id:
                        event.session_id,

                    event_type:
                        event.event_type,

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
            "function"
        ) {
            await this.clickhouseClient.insert(
                "member_events",
                rows
            );

            return;
        }

        if (
            typeof this.clickhouseClient.write ===
            "function"
        ) {
            await this.clickhouseClient.write(
                rows
            );

            return;
        }

        throw new Error(
            "Unsupported ClickHouse client interface."
        );
    }

    /**
     * =========================================================================
     * QUERY
     * =========================================================================
     */

    async queryMemberEvents(
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
                "Knex is required for queryMemberEvents."
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

        const order =
            normalizeOrder(
                opts.order
            );

        const direction =
            normalizeDirection(
                opts.direction
            );

        const mode =
            tenantConstants.getTenancyMode();

        const table =
            resolveMemberEventsTable(
                tenantId,
                mode
            );

        const query =
            db
                .select("*")
                .from(table)
                .where(
                    "tenant_id",
                    tenantId
                );

        if (
            filters.memberId
        ) {
            query.where(
                "member_id",
                normalizeIdentifier(
                    filters.memberId,
                    "memberId",
                    DEFAULTS.MAX_MEMBER_ID_LENGTH
                )
            );
        }

        if (
            filters.userId
        ) {
            query.where(
                "user_id",
                normalizeIdentifier(
                    filters.userId,
                    "userId",
                    DEFAULTS.MAX_USER_ID_LENGTH
                )
            );
        }

        if (
            filters.sessionId
        ) {
            query.where(
                "session_id",
                normalizeIdentifier(
                    filters.sessionId,
                    "sessionId",
                    DEFAULTS.MAX_SESSION_ID_LENGTH
                )
            );
        }

        if (
            filters.eventType
        ) {
            query.where(
                "event_type",
                normalizeEventType(
                    filters.eventType
                )
            );
        }

        const from =
            parseDate(
                filters.from,
                "from"
            );

        const to =
            parseDate(
                filters.to,
                "to"
            );

        validateDateRange(
            from,
            to
        );

        if (
            from
        ) {
            query.where(
                "created_at",
                ">=",
                from
            );
        }

        if (
            to
        ) {
            query.where(
                "created_at",
                "<=",
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
                        "\\$&"
                    );

            query.whereRaw(
                "(" +
                "CAST(payload AS TEXT) ILIKE ? " +
                "OR CAST(metadata AS TEXT) ILIKE ?" +
                ")",
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
                        "*"
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
                        order,
                        direction
                    )
                    .offset(
                        offset
                    )
                    .limit(
                        pageSize
                    )
            ]);

        const total =
            toSafeInteger(
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

            items:
                rows.map(
                    (row) =>
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
        type = "count",
        groupBy = ["event_type"],
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
                "Knex is required for aggregate."
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

        const mode =
            tenantConstants.getTenancyMode();

        const table =
            resolveMemberEventsTable(
                tenantId,
                mode
            );

        const query =
            db
                .from(table)
                .where(
                    "tenant_id",
                    tenantId
                );

        if (
            filters.eventType
        ) {
            query.where(
                "event_type",
                normalizeEventType(
                    filters.eventType
                )
            );
        }

        const from =
            parseDate(
                filters.from,
                "from"
            );

        const to =
            parseDate(
                filters.to,
                "to"
            );

        validateDateRange(
            from,
            to
        );

        if (
            from
        ) {
            query.where(
                "created_at",
                ">=",
                from
            );
        }

        if (
            to
        ) {
            query.where(
                "created_at",
                "<=",
                to
            );
        }

        if (
            type ===
            "activity_by_event"
        ) {
            return query
                .select(
                    "event_type"
                )
                .select(
                    db.raw(
                        "date_trunc('day', created_at) AS date"
                    )
                )
                .count(
                    {
                        count:
                            "*"
                    }
                )
                .groupBy(
                    "event_type"
                )
                .groupBy(
                    db.raw(
                        "date_trunc('day', created_at)"
                    )
                )
                .orderBy(
                    "date",
                    "desc"
                );
        }

        if (
            type ===
            "unique_members"
        ) {
            const selectGroups =
                groups
                    .filter(
                        (group) =>
                            group !==
                            "date"
                    );

            if (
                !selectGroups.includes(
                    "event_type"
                ) &&
                groups.includes(
                    "date"
                )
            ) {
                selectGroups.push(
                    "event_type"
                );
            }

            const selected =
                selectGroups.map(
                    (group) =>
                        group ===
                        "date"
                            ? db.raw(
                                "date_trunc('day', created_at) AS date"
                            )
                            : group
                );

            const builder =
                query
                    .select(
                        selected
                    )
                    .countDistinct(
                        {
                            unique_members:
                                "member_id"
                        }
                    );

            if (
                groups.includes(
                    "date"
                )
            ) {
                builder.groupBy(
                    db.raw(
                        "date_trunc('day', created_at)"
                    )
                );
            }

            for (
                const group
                of selectGroups
            ) {
                if (
                    group !==
                    "date"
                ) {
                    builder.groupBy(
                        group
                    );
                }
            }

            return builder;
        }

        if (
            type ===
            "count"
        ) {
            const selects =
                groups.map(
                    (group) =>
                        group ===
                        "date"
                            ? db.raw(
                                "date_trunc('day', created_at) AS date"
                            )
                            : group
                );

            const builder =
                query
                    .select(
                        selects
                    )
                    .count(
                        {
                            count:
                                "*"
                        }
                    );

            for (
                const group
                of groups
            ) {
                if (
                    group ===
                    "date"
                ) {
                    builder.groupBy(
                        db.raw(
                            "date_trunc('day', created_at)"
                        )
                    );
                } else {
                    builder.groupBy(
                        group
                    );
                }
            }

            return builder;
        }

        if (
            type ===
            "member_activity"
        ) {
            return query
                .select(
                    "member_id"
                )
                .count({
                    events:
                        "*"
                })
                .max({
                    last_activity:
                        "created_at"
                })
                .groupBy(
                    "member_id"
                )
                .orderBy(
                    "last_activity",
                    "desc"
                );
        }

        throw repositoryError(
            `Unsupported aggregation type: ${type}.`,
            "MEMBER_ANALYTICS_UNSUPPORTED_AGGREGATION",
            400
        );
    }

    /**
     * =========================================================================
     * MEMBER ENGAGEMENT SUMMARY
     * =========================================================================
     */

    async getMemberEngagementSummary({
        tenantId,
        memberId,
        from = null,
        to = null,
        opts = {}
    } = {}) {

        const normalizedTenant =
            normalizeTenantId(
                tenantId
            );

        const normalizedMember =
            normalizeIdentifier(
                memberId,
                "memberId",
                DEFAULTS.MAX_MEMBER_ID_LENGTH
            );

        const db =
            opts.knex ||
            this.knex;

        if (
            !db
        ) {
            throw new Error(
                "Knex is required for getMemberEngagementSummary."
            );
        }

        const mode =
            tenantConstants.getTenancyMode();

        const table =
            resolveMemberEventsTable(
                normalizedTenant,
                mode
            );

        const query =
            db(table)
                .where(
                    "tenant_id",
                    normalizedTenant
                )
                .where(
                    "member_id",
                    normalizedMember
                );

        const fromDate =
            parseDate(
                from,
                "from"
            );

        const toDate =
            parseDate(
                to,
                "to"
            );

        validateDateRange(
            fromDate,
            toDate
        );

        if (
            fromDate
        ) {
            query.where(
                "created_at",
                ">=",
                fromDate
            );
        }

        if (
            toDate
        ) {
            query.where(
                "created_at",
                "<=",
                toDate
            );
        }

        const [
            totalEvents,
            distinctSessions,
            distinctEventTypes,
            firstActivity,
            lastActivity
        ] =
            await Promise.all([
                query
                    .clone()
                    .count({
                        count:
                            "*"
                    })
                    .first(),

                query
                    .clone()
                    .countDistinct({
                        sessions:
                            "session_id"
                    })
                    .first(),

                query
                    .clone()
                    .countDistinct({
                        event_types:
                            "event_type"
                    })
                    .first(),

                query
                    .clone()
                    .min({
                        first_activity:
                            "created_at"
                    })
                    .first(),

                query
                    .clone()
                    .max({
                        last_activity:
                            "created_at"
                    })
                    .first()
            ]);

        return {
            tenantId:
                normalizedTenant,

            memberId:
                normalizedMember,

            totalEvents:
                toSafeInteger(
                    totalEvents?.count
                ),

            distinctSessions:
                toSafeInteger(
                    distinctSessions?.sessions
                ),

            distinctEventTypes:
                toSafeInteger(
                    distinctEventTypes?.event_types
                ),

            firstActivity:
                firstActivity?.first_activity ||
                null,

            lastActivity:
                lastActivity?.last_activity ||
                null
        };
    }

    /**
     * =========================================================================
     * DAILY ACTIVE MEMBERS
     * =========================================================================
     */

    async getDailyActiveMembers({
        tenantId,
        from,
        to,
        opts = {}
    } = {}) {

        const normalizedTenant =
            normalizeTenantId(
                tenantId
            );

        const db =
            opts.knex ||
            this.knex;

        if (
            !db
        ) {
            throw new Error(
                "Knex is required for getDailyActiveMembers."
            );
        }

        const fromDate =
            parseDate(
                from,
                "from"
            );

        const toDate =
            parseDate(
                to,
                "to"
            );

        if (
            !fromDate ||
            !toDate
        ) {
            throw repositoryError(
                "from and to dates are required.",
                "MEMBER_ANALYTICS_DATE_RANGE_REQUIRED",
                400
            );
        }

        validateDateRange(
            fromDate,
            toDate
        );

        const mode =
            tenantConstants.getTenancyMode();

        const table =
            resolveMemberEventsTable(
                normalizedTenant,
                mode
            );

        return db(table)
            .select(
                db.raw(
                    "date_trunc('day', created_at) AS date"
                )
            )
            .countDistinct({
                active_members:
                    "member_id"
            })
            .where(
                "tenant_id",
                normalizedTenant
            )
            .where(
                "created_at",
                ">=",
                fromDate
            )
            .where(
                "created_at",
                "<=",
                toDate
            )
            .whereNotNull(
                "member_id"
            )
            .groupBy(
                db.raw(
                    "date_trunc('day', created_at)"
                )
            )
            .orderBy(
                "date",
                "asc"
            );
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
                "Knex is required for exportEvents."
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
                "function"
        ) {
            throw repositoryError(
                "A writable stream is required.",
                "MEMBER_ANALYTICS_EXPORT_STREAM_REQUIRED",
                400
            );
        }

        const format =
            String(
                opts.format ||
                "jsonl"
            ).toLowerCase();

        if (
            ![
                "jsonl",
                "csv"
            ].includes(
                format
            )
        ) {
            throw repositoryError(
                "Export format must be jsonl or csv.",
                "MEMBER_ANALYTICS_EXPORT_FORMAT_INVALID",
                400
            );
        }

        const mode =
            tenantConstants.getTenancyMode();

        const table =
            resolveMemberEventsTable(
                tenantId,
                mode
            );

        const query =
            db
                .select("*")
                .from(
                    table
                )
                .where(
                    "tenant_id",
                    tenantId
                )
                .orderBy(
                    "created_at",
                    "asc"
                );

        const from =
            parseDate(
                opts.from,
                "from"
            );

        const to =
            parseDate(
                opts.to,
                "to"
            );

        validateDateRange(
            from,
            to
        );

        if (
            from
        ) {
            query.where(
                "created_at",
                ">=",
                from
            );
        }

        if (
            to
        ) {
            query.where(
                "created_at",
                "<=",
                to
            );
        }

        const source =
            query.stream();

        let csvHeaderWritten =
            false;

        const headers =
            [
                "internal_id",
                "tenant_id",
                "member_id",
                "user_id",
                "session_id",
                "event_type",
                "timestamp",
                "payload",
                "metadata",
                "idempotency_key"
            ];

        return new Promise(
            (
                resolve,
                reject
            ) => {

                source.on(
                    "data",
                    (row) => {
                        try {
                            const parsed =
                                this._parseRow(
                                    row
                                );

                            if (
                                format ===
                                "jsonl"
                            ) {
                                stream.write(
                                    JSON.stringify(
                                        parsed
                                    ) +
                                    "\n"
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
                                        parsed.member_id,
                                        parsed.user_id,
                                        parsed.session_id,
                                        parsed.event_type,
                                        parsed.created_at,
                                        safeStringify(
                                            parsed.payload
                                        ),
                                        safeStringify(
                                            parsed.metadata
                                        ),
                                        parsed.idempotency_key
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
                    "end",
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
                    "error",
                    (error) => {
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
                "Knex is required for purgeOldEvents."
            );
        }

        const days =
            positiveInteger(
                opts.olderThanDays,
                this.options.RETENTION_DAYS
            );

        const cutoff =
            new Date(
                Date.now() -
                days *
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
            const registryTable =
                `${this.options.TABLE_PREFIX}tenants`;

            const tenants =
                await db
                    .select(
                        "tenant_id"
                    )
                    .from(
                        registryTable
                    )
                    .whereNull(
                        "deleted_at"
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
                    resolveMemberEventsTable(
                        tenantId,
                        mode
                    );

                if (
                    opts.dryRun
                ) {
                    const count =
                        await db(
                            table
                        )
                            .where(
                                "created_at",
                                "<",
                                cutoff
                            )
                            .count({
                                count:
                                    "*"
                            })
                            .first();

                    affected +=
                        toSafeInteger(
                            count?.count
                        );
                } else {
                    const deleted =
                        await db(
                            table
                        )
                            .where(
                                "created_at",
                                "<",
                                cutoff
                            )
                            .del();

                    affected +=
                        toSafeInteger(
                            deleted
                        );
                }
            }
        } else {
            const table =
                DEFAULTS.GLOBAL_TABLE;

            if (
                opts.dryRun
            ) {
                const count =
                    await db(table)
                        .where(
                            "created_at",
                            "<",
                            cutoff
                        )
                        .count({
                            count:
                                "*"
                        })
                        .first();

                affected =
                    toSafeInteger(
                        count?.count
                    );
            } else {
                affected =
                    toSafeInteger(
                        await db(table)
                            .where(
                                "created_at",
                                "<",
                                cutoff
                            )
                            .del()
                    );
            }
        }

        return {
            dryRun:
                Boolean(
                    opts.dryRun
                ),

            olderThanDays:
                days,

            cutoff:
                cutoff.toISOString(),

            affected
        };
    }

    /**
     * =========================================================================
     * STREAMING
     * =========================================================================
     */

    async publishMemberEvent(
        topic,
        event
    ) {

        if (
            !this.streamProducer ||
            typeof this.streamProducer.produce !==
                "function"
        ) {
            throw repositoryError(
                "streamProducer is not configured.",
                "MEMBER_ANALYTICS_STREAM_NOT_CONFIGURED"
            );
        }

        const validated =
            this._validateEvent(
                event
            );

        await this.streamProducer.produce(
            topic,
            Buffer.from(
                JSON.stringify(
                    validated
                )
            )
        );

        this._safeMetric(
            "titech.member.analytics.published_total",
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

            event:
                validated
        };
    }

    /**
     * =========================================================================
     * HEALTH CHECK
     * =========================================================================
     */

    async healthcheck() {

        const checks =
            {
                ok:
                    true,

                details:
                    {},

                queueSize:
                    this._queueSize,

                shuttingDown:
                    this._shuttingDown
            };

        if (
            this.knex
        ) {
            try {
                await this.knex.raw(
                    "SELECT 1"
                );

                checks.details.knex =
                    "ok";
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
                "function"
        ) {
            try {
                await this.clickhouseClient.ping();

                checks.details.clickhouse =
                    "ok";
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
                "function"
        ) {
            try {
                await this.cacheClient.ping();

                checks.details.cache =
                    "ok";
            } catch (
                error
            ) {
                checks.ok =
                    false;

                checks.details.cache =
                    `error: ${error.message}`;
            }
        }

        return checks;
    }

    /**
     * =========================================================================
     * OPERATIONAL STATS
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

            options:
                {
                    batchSize:
                        this.options.BATCH_SIZE,

                    batchIntervalMs:
                        this.options.BATCH_INTERVAL_MS,

                    maxQueueSize:
                        this.options.MAX_QUEUE_SIZE,

                    retentionDays:
                        this.options.RETENTION_DAYS
                }
        };
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

        this.logger.info(
            `${DEFAULTS.LOG_PREFIX} shutdown completed`,
            {
                complete,

                remaining:
                    this._queueSize
            }
        );

        return {
            complete,

            remaining:
                this._queueSize
        };
    }

    /**
     * =========================================================================
     * METRICS
     * =========================================================================
     */

    _safeMetric(
        metricName,
        value = 1,
        labels = {}
    ) {
        try {
            this.metrics.increment(
                metricName,
                value,
                labels
            );
        } catch {
            // Metrics must never break analytics processing.
        }
    }
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
        attempt++
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
                attempts -
                1
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
 * CSV
 * ============================================================================
 */

function csvEscape(
    value
) {
    if (
        value ===
            undefined ||
        value ===
            null
    ) {
        return "";
    }

    const text =
        String(
            value
        );

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
            .map(
                csvEscape
            )
            .join(
                ","
            ) +
        "\n"
    );
}

/**
 * ============================================================================
 * FACTORY
 * ============================================================================
 */

function createMemberAnalyticsRepository(
    deps = {}
) {
    return new MemberAnalyticsRepository(
        deps
    );
}

/**
 * ============================================================================
 * EXPORT
 * ============================================================================
 */

module.exports = {
    MemberAnalyticsRepository,
    createMemberAnalyticsRepository,
    DEFAULTS,
    validateMemberEvent,
};