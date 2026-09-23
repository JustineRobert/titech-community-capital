'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Analytics Repository
 * ============================================================================
 *
 * File:
 *   backend/repositories/analytics/analytics.repository.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Durable analytics/event repository for the TITech Community Capital
 * multi-tenant platform.
 *
 * Supported storage strategies
 * ----------------------------------------------------------------------------
 * - Custom writer
 * - PostgreSQL / Knex
 * - ClickHouse-compatible clients
 * - Event-stream producer
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - Validate analytics events.
 * - Enforce tenant identity boundaries.
 * - Queue and batch analytics writes.
 * - Apply bounded backpressure.
 * - Retry transient writes.
 * - Preserve failed batches for retry/dead-letter handling.
 * - Query tenant-scoped analytics.
 * - Aggregate analytics safely.
 * - Export analytics in JSONL/CSV.
 * - Perform retention cleanup.
 * - Publish events to streaming infrastructure.
 * - Expose operational health/statistics.
 *
 * Non-responsibilities
 * ----------------------------------------------------------------------------
 * - Authentication.
 * - Tenant authorization.
 * - Financial ledger mutations.
 * - Financial transaction truth.
 *
 * Analytics must never become the authoritative financial ledger.
 *
 * TITech terminology
 * ----------------------------------------------------------------------------
 * All legacy ACFOS references are replaced with TITech Community Capital.
 *
 * ============================================================================
 */

const {
    EventEmitter,
} = require('node:events');

const crypto =
    require('node:crypto');

const AjvModule =
    require('ajv');

const Ajv =
    AjvModule.default ||
    AjvModule;

const addFormatsModule =
    require('ajv-formats');

const addFormats =
    addFormatsModule.default ||
    addFormatsModule;

const tenantConstants =
    require('../../tenancy/tenant.constants');

/**
 * ============================================================================
 * Configuration
 * ============================================================================
 */

function envNumber(
    name,
    fallback,
    min,
    max
) {
    const value =
        Number(
            process.env[name]
        );

    if (
        !Number.isFinite(
            value
        ) ||
        value < min ||
        value > max
    ) {
        return fallback;
    }

    return value;
}

const DEFAULTS =
    Object.freeze({
        BATCH_SIZE:
            envNumber(
                'ANALYTICS_BATCH_SIZE',
                500,
                1,
                10_000
            ),

        BATCH_INTERVAL_MS:
            envNumber(
                'ANALYTICS_BATCH_INTERVAL_MS',
                2_000,
                100,
                60_000
            ),

        MAX_QUEUE_SIZE:
            envNumber(
                'ANALYTICS_MAX_QUEUE_SIZE',
                50_000,
                100,
                1_000_000
            ),

        MAX_RETRY_QUEUE_SIZE:
            envNumber(
                'ANALYTICS_MAX_RETRY_QUEUE_SIZE',
                100_000,
                100,
                2_000_000
            ),

        WRITE_RETRY_ATTEMPTS:
            envNumber(
                'ANALYTICS_WRITE_RETRY_ATTEMPTS',
                3,
                1,
                10
            ),

        WRITE_RETRY_MIN_TIMEOUT:
            envNumber(
                'ANALYTICS_WRITE_RETRY_MIN_TIMEOUT',
                250,
                25,
                30_000
            ),

        WRITE_RETRY_MAX_TIMEOUT:
            envNumber(
                'ANALYTICS_WRITE_RETRY_MAX_TIMEOUT',
                5_000,
                100,
                120_000
            ),

        RETENTION_DAYS:
            envNumber(
                'ANALYTICS_RETENTION_DAYS',
                365,
                1,
                3_650
            ),

        ARCHIVE_AFTER_DAYS:
            envNumber(
                'ANALYTICS_ARCHIVE_AFTER_DAYS',
                90,
                1,
                3_650
            ),

        MAX_PAGE_SIZE:
            envNumber(
                'ANALYTICS_MAX_PAGE_SIZE',
                500,
                1,
                5_000
            ),

        MAX_EXPORT_ROWS:
            envNumber(
                'ANALYTICS_MAX_EXPORT_ROWS',
                500_000,
                1,
                10_000_000
            ),

        MAX_EVENT_TYPE_LENGTH:
            envNumber(
                'ANALYTICS_MAX_EVENT_TYPE_LENGTH',
                128,
                8,
                512
            ),

        MAX_PAYLOAD_BYTES:
            envNumber(
                'ANALYTICS_MAX_PAYLOAD_BYTES',
                64 * 1024,
                1_024,
                5 * 1024 * 1024
            ),

        MAX_METADATA_BYTES:
            envNumber(
                'ANALYTICS_MAX_METADATA_BYTES',
                32 * 1024,
                1_024,
                2 * 1024 * 1024
            ),

        MAX_OBJECT_DEPTH:
            envNumber(
                'ANALYTICS_MAX_OBJECT_DEPTH',
                8,
                1,
                32
            ),

        TABLE_PREFIX:
            tenantConstants
                .ENV
                .DB_TABLE_PREFIX ||
            'titech_',

        GLOBAL_TABLE:
            `${tenantConstants.ENV.DB_TABLE_PREFIX || 'titech_'}analytics_events`,

        LOG_PREFIX:
            'TITech.Analytics',

        DEFAULT_ORDER:
            'timestamp',

        DEFAULT_DIRECTION:
            'desc',
    });

/**
 * ============================================================================
 * Errors
 * ============================================================================
 */

class AnalyticsRepositoryError extends Error {
    constructor(
        message,
        code = 'ANALYTICS_REPOSITORY_ERROR',
        {
            statusCode = 500,
            cause = undefined,
            details = undefined,
        } = {}
    ) {
        super(
            message
        );

        this.name =
            'AnalyticsRepositoryError';

        this.code =
            code;

        this.statusCode =
            statusCode;

        if (
            cause
        ) {
            this.cause =
                cause;
        }

        if (
            details
        ) {
            this.details =
                details;
        }

        Error.captureStackTrace?.(
            this,
            AnalyticsRepositoryError
        );
    }
}

/**
 * ============================================================================
 * AJV Validation
 * ============================================================================
 */

const ajv =
    new Ajv({
        allErrors:
            true,

        strict:
            true,

        coerceTypes:
            false,

        removeAdditional:
            false,

        useDefaults:
            false,
    });

addFormats(
    ajv
);

const eventSchema =
    {
        type:
            'object',

        additionalProperties:
            false,

        required:
            [
                'tenant_id',
                'event_type',
                'timestamp',
                'payload',
            ],

        properties:
            {
                tenant_id:
                    {
                        type:
                            'string',

                        minLength:
                            3,

                        maxLength:
                            64,

                        pattern:
                            '^[a-z0-9-]{3,64}$',
                    },

                event_type:
                    {
                        type:
                            'string',

                        minLength:
                            1,

                        maxLength:
                            DEFAULTS.MAX_EVENT_TYPE_LENGTH,

                        pattern:
                            '^[A-Za-z0-9_.:-]+$',
                    },

                timestamp:
                    {
                        type:
                            'string',

                        format:
                            'date-time',
                    },

                user_id:
                    {
                        type:
                            [
                                'string',
                                'null',
                            ],
                    },

                session_id:
                    {
                        type:
                            [
                                'string',
                                'null',
                            ],
                    },

                payload:
                    {
                        type:
                            'object',
                    },

                metadata:
                    {
                        type:
                            'object',
                    },

                event_id:
                    {
                        type:
                            [
                                'string',
                                'null',
                            ],

                        maxLength:
                            128,
                    },
            },
    };

const validateEventSchema =
    ajv.compile(
        eventSchema
    );

/**
 * ============================================================================
 * Constants / Helpers
 * ============================================================================
 */

const TENANCY_MODES =
    tenantConstants.TENANCY_MODES;

const GLOBAL_TABLE =
    DEFAULTS.GLOBAL_TABLE;

const EVENT_COLUMNS =
    Object.freeze([
        'event_id',
        'tenant_id',
        'event_type',
        'timestamp',
        'user_id',
        'session_id',
        'payload',
        'metadata',
        'created_at',
    ]);

const ALLOWED_QUERY_ORDER_COLUMNS =
    Object.freeze([
        'timestamp',
        'created_at',
        'event_type',
        'tenant_id',
        'user_id',
    ]);

const ALLOWED_QUERY_DIRECTIONS =
    Object.freeze([
        'asc',
        'desc',
    ]);

/**
 * ============================================================================
 * Repository
 * ============================================================================
 */

class AnalyticsRepository extends EventEmitter {
    constructor({
        knex = null,
        clickhouseClient = null,
        writer = null,
        cacheClient = null,
        streamProducer = null,
        logger = console,
        metrics = null,
        options = {},
    } = {}) {
        super();

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

        this.logger =
            logger ||
            console;

        this.metrics =
            metrics || {
                increment:
                    () => {},

                gauge:
                    () => {},

                timing:
                    () => {},
            };

        this.options =
            Object.freeze({
                ...DEFAULTS,
                ...options,
            });

        this._queue = [];

        this._retryQueue = [];

        this._queueSize =
            0;

        this._retryQueueSize =
            0;

        this._batchTimer =
            null;

        this._running =
            false;

        this._shuttingDown =
            false;

        this._flushPromise =
            null;

        this._stats = {
            enqueued:
                0,

            accepted:
                0,

            rejected:
                0,

            flushed:
                0,

            failed:
                0,

            retried:
                0,

            dropped:
                0,

            published:
                0,

            queryCount:
                0,
        };

        this.recordEvent =
            this.recordEvent.bind(
                this
            );

        this.bulkRecordEvents =
            this.bulkRecordEvents.bind(
                this
            );

        this.shutdown =
            this.shutdown.bind(
                this
            );

        this._flushBatch =
            this._flushBatch.bind(
                this
            );

        this._startBatchTimer =
            this._startBatchTimer.bind(
                this
            );

        this._stopBatchTimer =
            this._stopBatchTimer.bind(
                this
            );

        this._logInfo(
            'TITech AnalyticsRepository initialized',
            {
                tenancyMode:
                    tenantConstants
                        .getTenancyMode(),

                batchSize:
                    this.options.BATCH_SIZE,

                maxQueueSize:
                    this.options.MAX_QUEUE_SIZE,
            }
        );
    }

    /**
     * ------------------------------------------------------------------------
     * Event validation
     * ------------------------------------------------------------------------
     */

    _validateEvent(
        rawEvent
    ) {
        if (
            !isPlainObject(
                rawEvent
            )
        ) {
            throw new AnalyticsRepositoryError(
                'Analytics event must be an object.',
                'ANALYTICS_EVENT_OBJECT_REQUIRED',
                {
                    statusCode:
                        400,
                }
            );
        }

        const event =
            cloneJsonSafe(
                rawEvent
            );

        const tenantId =
            validateTenantIdStrict(
                event.tenant_id
            );

        event.tenant_id =
            tenantId;

        event.event_type =
            normalizeEventType(
                event.event_type
            );

        event.timestamp =
            normalizeTimestamp(
                event.timestamp
            );

        event.user_id =
            normalizeNullableString(
                event.user_id,
                255
            );

        event.session_id =
            normalizeNullableString(
                event.session_id,
                255
            );

        event.payload =
            validateJsonObject(
                event.payload,
                'payload',
                {
                    maxBytes:
                        this.options
                            .MAX_PAYLOAD_BYTES,

                    maxDepth:
                        this.options
                            .MAX_OBJECT_DEPTH,
                }
            );

        event.metadata =
            validateJsonObject(
                event.metadata ||
                    {},
                'metadata',
                {
                    maxBytes:
                        this.options
                            .MAX_METADATA_BYTES,

                    maxDepth:
                        this.options
                            .MAX_OBJECT_DEPTH,
                }
            );

        event.event_id =
            normalizeNullableString(
                event.event_id,
                128
            ) ||
            generateEventId();

        const valid =
            validateEventSchema(
                event
            );

        if (
            !valid
        ) {
            throw new AnalyticsRepositoryError(
                'Invalid analytics event payload.',
                'INVALID_ANALYTICS_EVENT',
                {
                    statusCode:
                        400,

                    details:
                        formatAjvErrors(
                            validateEventSchema.errors
                        ),
                }
            );
        }

        return Object.freeze(
            event
        );
    }

    /**
     * ------------------------------------------------------------------------
     * Queue operations
     * ------------------------------------------------------------------------
     */

    async recordEvent(
        event,
        options = {}
    ) {
        if (
            this._shuttingDown
        ) {
            const error =
                new AnalyticsRepositoryError(
                    'AnalyticsRepository is shutting down.',
                    'ANALYTICS_REPOSITORY_SHUTTING_DOWN',
                    {
                        statusCode:
                            503,
                    }
                );

            this._stats.rejected += 1;

            this._metric(
                'analytics.rejected_total',
                1,
                {
                    reason:
                        'shutdown',
                }
            );

            throw error;
        }

        let validated;

        try {
            validated =
                this._validateEvent(
                    event
                );
        } catch (
            error
        ) {
            this._stats.rejected += 1;

            this._metric(
                'analytics.invalid_event_total',
                1,
                {
                    tenant:
                        safeTenantMetric(
                            event?.tenant_id
                        ),
                }
            );

            this._logWarn(
                'Analytics event validation failed',
                {
                    error:
                        error.message,

                    code:
                        error.code,
                }
            );

            throw error;
        }

        if (
            this._queueSize >=
            this.options.MAX_QUEUE_SIZE
        ) {
            const error =
                new AnalyticsRepositoryError(
                    'Analytics queue is full.',
                    'ANALYTICS_QUEUE_FULL',
                    {
                        statusCode:
                            503,
                    }
                );

            this._stats.rejected += 1;

            this._metric(
                'analytics.queue_full_total',
                1
            );

            this.emit(
                'backpressure',
                {
                    queueSize:
                        this._queueSize,
                }
            );

            throw error;
        }

        this._queue.push(
            validated
        );

        this._queueSize += 1;

        this._stats.enqueued += 1;

        this._stats.accepted += 1;

        this._metric(
            'analytics.enqueued_total',
            1,
            {
                tenant:
                    safeTenantMetric(
                        validated.tenant_id
                    ),

                event_type:
                    validated.event_type,
            }
        );

        this._setQueueGauge();

        this._startBatchTimer();

        const threshold =
            options.flushThreshold ||
            this.options.BATCH_SIZE;

        if (
            options.immediate ||
            this._queueSize >=
                threshold
        ) {
            /**
             * Do not block the record caller unnecessarily.
             * The flush is tracked through _flushPromise.
             */
            void this._scheduleFlush();
        }

        return {
            accepted:
                true,

            eventId:
                validated.event_id,

            queued:
                this._queueSize,
        };
    }

    async bulkRecordEvents(
        events = [],
        options = {}
    ) {
        if (
            !Array.isArray(
                events
            )
        ) {
            throw new AnalyticsRepositoryError(
                'events must be an array.',
                'ANALYTICS_EVENTS_ARRAY_REQUIRED',
                {
                    statusCode:
                        400,
                }
            );
        }

        if (
            events.length >
            this.options.MAX_QUEUE_SIZE
        ) {
            throw new AnalyticsRepositoryError(
                'Bulk analytics request exceeds the configured limit.',
                'ANALYTICS_BULK_TOO_LARGE',
                {
                    statusCode:
                        413,
                }
            );
        }

        const summary = {
            accepted:
                0,

            rejected:
                0,

            eventIds:
                [],

            errors:
                [],
        };

        for (
            const event of events
        ) {
            try {
                const result =
                    await this.recordEvent(
                        event,
                        options
                    );

                summary.accepted +=
                    1;

                summary.eventIds.push(
                    result.eventId
                );
            } catch (
                error
            ) {
                summary.rejected +=
                    1;

                summary.errors.push(
                    {
                        code:
                            error.code ||
                            'ANALYTICS_EVENT_REJECTED',

                        message:
                            error.message,
                    }
                );

                if (
                    options.failFast
                ) {
                    break;
                }
            }
        }

        return summary;
    }

    /**
     * ------------------------------------------------------------------------
     * Flush scheduling
     * ------------------------------------------------------------------------
     */

    _scheduleFlush() {
        if (
            this._flushPromise
        ) {
            return this._flushPromise;
        }

        this._flushPromise =
            Promise.resolve()
                .then(
                    () =>
                        this._flushBatch()
                )
                .catch(
                    error => {
                        this._logError(
                            'Scheduled analytics flush failed',
                            {
                                error:
                                    error.message,
                            }
                        );

                        this.emit(
                            'flushError',
                            error
                        );

                        return null;
                    }
                )
                .finally(
                    () => {
                        this._flushPromise =
                            null;
                    }
                );

        return this._flushPromise;
    }

    _startBatchTimer() {
        if (
            this._batchTimer ||
            this._shuttingDown
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
            !this._batchTimer
        ) {
            return;
        }

        clearInterval(
            this._batchTimer
        );

        this._batchTimer =
            null;
    }

    /**
     * ------------------------------------------------------------------------
     * Batch flush
     * ------------------------------------------------------------------------
     */

    async _flushBatch() {
        if (
            this._running
        ) {
            return {
                flushed:
                    false,

                reason:
                    'already_running',
            };
        }

        if (
            this._queueSize ===
            0
        ) {
            return {
                flushed:
                    false,

                reason:
                    'queue_empty',
            };
        }

        this._running =
            true;

        const batch =
            this._queue.splice(
                0,
                Math.min(
                    this.options
                        .BATCH_SIZE,
                    this._queueSize
                )
            );

        this._queueSize -=
            batch.length;

        this._setQueueGauge();

        try {
            await this._writeBatchWithRetry(
                batch
            );

            this._stats.flushed +=
                batch.length;

            this._metric(
                'analytics.flushed_total',
                batch.length
            );

            this.emit(
                'batchFlushed',
                {
                    count:
                        batch.length,
                }
            );

            return {
                flushed:
                    true,

                count:
                    batch.length,
            };
        } catch (
            error
        ) {
            this._stats.failed +=
                batch.length;

            this._metric(
                'analytics.flush_failed_total',
                1,
                {
                    batch_size:
                        String(
                            batch.length
                        ),
            });

            await this._handleFailedBatch(
                batch,
                error
            );

            return {
                flushed:
                    false,

                failed:
                    batch.length,

                error,
            };
        } finally {
            this._running =
                false;

            if (
                this._queueSize ===
                    0 &&
                this._retryQueueSize ===
                    0
            ) {
                this._stopBatchTimer();
            }
        }
    }

    async _writeBatchWithRetry(
        batch
    ) {
        let lastError =
            null;

        for (
            let attempt = 0;
            attempt <
            this.options
                .WRITE_RETRY_ATTEMPTS;
            attempt += 1
        ) {
            try {
                await this._writeBatch(
                    batch
                );

                return;
            } catch (
                error
            ) {
                lastError =
                    error;

                const retryable =
                    isRetryableAnalyticsError(
                        error
                    );

                if (
                    !retryable ||
                    attempt >=
                        this.options
                            .WRITE_RETRY_ATTEMPTS -
                            1
                ) {
                    break;
                }

                this._stats.retried +=
                    1;

                this._metric(
                    'analytics.write_retries_total',
                    1,
                    {
                        attempt:
                            String(
                                attempt + 1
                            ),
                    }
                );

                const delay =
                    computeBackoff(
                        attempt,
                        this.options
                            .WRITE_RETRY_MIN_TIMEOUT,
                        this.options
                            .WRITE_RETRY_MAX_TIMEOUT
                    );

                this._logWarn(
                    'Analytics batch write failed; retrying',
                    {
                        attempt:
                            attempt + 1,

                        delay,

                        error:
                            error.message,
                    }
                );

                await sleep(
                    delay
                );
            }
        }

        throw (
            lastError ||
            new Error(
                'Analytics batch write failed.'
            )
        );
    }

    async _writeBatch(
        batch
    ) {
        if (
            !Array.isArray(
                batch
            ) ||
            batch.length ===
                0
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
         * If no persistent backend exists, emit the batch as an integration
         * event rather than pretending it was durably persisted.
         */
        if (
            this.listenerCount(
                'batch'
            ) > 0
        ) {
            this.emit(
                'batch',
                batch
            );

            return;
        }

        throw new AnalyticsRepositoryError(
            'No analytics persistence backend is configured.',
            'ANALYTICS_WRITER_NOT_CONFIGURED',
            {
                statusCode:
                    503,
            }
        );
    }

    async _handleFailedBatch(
        batch,
        error
    ) {
        if (
            this._retryQueueSize +
                batch.length <=
            this.options
                .MAX_RETRY_QUEUE_SIZE
        ) {
            this._retryQueue.push(
                {
                    batch,

                    firstFailedAt:
                        new Date()
                            .toISOString(),

                    error:
                        error.message,

                    attempts:
                        1,
                }
            );

            this._retryQueueSize +=
                batch.length;

            this._metric(
                'analytics.retry_queue_total',
                batch.length
            );

            this._logWarn(
                'Analytics batch moved to retry queue',
                {
                    count:
                        batch.length,

                    error:
                        error.message,
                }
            );

            return;
        }

        /**
         * Do not silently drop analytics. Emit a dead-letter event.
         */
        this._stats.dropped +=
            batch.length;

        this._metric(
            'analytics.dropped_total',
            batch.length
        );

        this.emit(
            'deadLetter',
            {
                batch,

                error,

                timestamp:
                    new Date()
                        .toISOString(),
            }
        );

        this._logError(
            'Analytics batch moved to dead-letter handling',
            {
                count:
                    batch.length,

                error:
                    error.message,
            }
        );
    }

    /**
     * ------------------------------------------------------------------------
     * Retry queue processing
     * ------------------------------------------------------------------------
     */

    async retryFailedBatches(
        {
            limit =
                this.options.BATCH_SIZE,
        } = {}
    ) {
        if (
            this._retryQueueSize ===
            0
        ) {
            return {
                processed:
                    0,

                remaining:
                    0,
            };
        }

        let processed =
            0;

        while (
            this._retryQueue.length >
                0 &&
            processed <
                limit
        ) {
            const item =
                this._retryQueue.shift();

            this._retryQueueSize -=
                item.batch.length;

            try {
                await this._writeBatchWithRetry(
                    item.batch
                );

                this._stats.flushed +=
                    item.batch.length;

                processed +=
                    item.batch.length;
            } catch (
                error
            ) {
                await this._handleFailedBatch(
                    item.batch,
                    error
                );

                processed +=
                    item.batch.length;
            }
        }

        this._setQueueGauge();

        return {
            processed,

            remaining:
                this._retryQueueSize,
        };
    }

    /**
     * ------------------------------------------------------------------------
     * SQL writer
     * ------------------------------------------------------------------------
     */

    async _writeToSql(
        batch
    ) {
        if (
            !this.knex
        ) {
            throw new AnalyticsRepositoryError(
                'Knex is not configured.',
                'ANALYTICS_KNEX_NOT_CONFIGURED'
            );
        }

        const mode =
            tenantConstants
                .getTenancyMode();

        const groups =
            groupByTenant(
                batch
            );

        for (
            const [
                tenantId,
                events,
            ] of Object.entries(
                groups
            )
        ) {
            const target =
                this._resolveSqlTarget(
                    tenantId,
                    mode
                );

            const rows =
                events.map(
                    event =>
                        this._eventToSqlRow(
                            event
                        )
                );

            if (
                typeof this.knex
                    .batchInsert ===
                'function'
            ) {
                await this.knex.batchInsert(
                    target,
                    rows,
                    Math.min(
                        1_000,
                        rows.length
                    )
                );
            } else {
                await this.knex(
                    target
                ).insert(
                    rows
                );
            }
        }
    }

    _resolveSqlTarget(
        tenantId,
        mode
    ) {
        const id =
            validateTenantIdStrict(
                tenantId
            );

        switch (
            mode
        ) {
            case TENANCY_MODES.SCHEMA: {
                const schema =
                    tenantConstants
                        .schemaNameForTenant(
                            id
                        );

                assertSafeIdentifier(
                    schema
                );

                return `${schema}.analytics_events`;
            }

            case TENANCY_MODES.DATABASE:
            case TENANCY_MODES.HYBRID:
            case TENANCY_MODES.SINGLE:
            case TENANCY_MODES.ISOLATED:
            default:
                /**
                 * DATABASE mode normally requires a tenant-specific Knex
                 * connection. A single shared connection must not pretend to
                 * route to another database.
                 */
                if (
                    mode ===
                        TENANCY_MODES.DATABASE &&
                    !this.options
                        .allowSharedDatabaseFallback
                ) {
                    throw new AnalyticsRepositoryError(
                        'DATABASE tenancy requires a tenant-scoped Knex connection or explicit shared-database routing.',
                        'ANALYTICS_DATABASE_ROUTING_REQUIRED'
                    );
                }

                assertSafeIdentifier(
                    GLOBAL_TABLE
                );

                return GLOBAL_TABLE;
        }
    }

    _eventToSqlRow(
        event
    ) {
        return {
            event_id:
                event.event_id,

            tenant_id:
                event.tenant_id,

            event_type:
                event.event_type,

            timestamp:
                event.timestamp,

            user_id:
                event.user_id ||
                null,

            session_id:
                event.session_id ||
                null,

            payload:
                event.payload,

            metadata:
                event.metadata,

            created_at:
                new Date()
                    .toISOString(),
        };
    }

    /**
     * ------------------------------------------------------------------------
     * ClickHouse writer
     * ------------------------------------------------------------------------
     */

    async _writeToClickHouse(
        batch
    ) {
        if (
            !this.clickhouseClient
        ) {
            throw new AnalyticsRepositoryError(
                'ClickHouse client is not configured.',
                'ANALYTICS_CLICKHOUSE_NOT_CONFIGURED'
            );
        }

        const rows =
            batch.map(
                event =>
                    ({
                        event_id:
                            event.event_id,

                        tenant_id:
                            event.tenant_id,

                        event_type:
                            event.event_type,

                        timestamp:
                            event.timestamp,

                        user_id:
                            event.user_id ||
                            null,

                        session_id:
                            event.session_id ||
                            null,

                        payload:
                            JSON.stringify(
                                event.payload
                            ),

                        metadata:
                            JSON.stringify(
                                event.metadata ||
                                    {}
                            ),

                        created_at:
                            new Date()
                                .toISOString(),
                    })
            );

        if (
            typeof this
                .clickhouseClient
                .insert ===
            'function'
        ) {
            /**
             * Support clients accepting either:
             *
             *   insert(table, rows)
             *   insert({table, values, format})
             */
            try {
                await this
                    .clickhouseClient
                    .insert(
                        GLOBAL_TABLE,
                        rows
                    );

                return;
            } catch (
                firstError
            ) {
                try {
                    await this
                        .clickhouseClient
                        .insert({
                            table:
                                GLOBAL_TABLE,

                            values:
                                rows,

                            format:
                                'JSONEachRow',
                        });

                    return;
                } catch (
                    secondError
                ) {
                    secondError.cause =
                        firstError;

                    throw secondError;
                }
            }
        }

        if (
            typeof this
                .clickhouseClient
                .write ===
            'function'
        ) {
            await this
                .clickhouseClient
                .write(
                    rows
                );

            return;
        }

        throw new AnalyticsRepositoryError(
            'Unsupported ClickHouse client interface.',
            'ANALYTICS_CLICKHOUSE_INTERFACE_UNSUPPORTED'
        );
    }

    /**
     * ------------------------------------------------------------------------
     * Query helpers
     * ------------------------------------------------------------------------
     */

    async queryEvents(
        filters = {},
        options = {}
    ) {
        if (
            !this.knex
        ) {
            throw new AnalyticsRepositoryError(
                'Knex is required for analytics queries.',
                'ANALYTICS_KNEX_REQUIRED'
            );
        }

        const page =
            parsePositiveInteger(
                options.page,
                1,
                1,
                1_000_000
            );

        const pageSize =
            parsePositiveInteger(
                options.pageSize,
                100,
                1,
                this.options
                    .MAX_PAGE_SIZE
            );

        const order =
            normalizeOrderColumn(
                options.order ||
                    this.options.DEFAULT_ORDER
            );

        const direction =
            normalizeDirection(
                options.direction ||
                    this.options
                        .DEFAULT_DIRECTION
            );

        const tenantId =
            requireTenantFilter(
                filters.tenantId,
                options
            );

        const mode =
            tenantConstants
                .getTenancyMode();

        const target =
            this._resolveQueryTarget(
                tenantId,
                mode
            );

        const base =
            this.knex
                .select(
                    EVENT_COLUMNS
                )
                .from(
                    target.table
                );

        this._applyCommonFilters(
            base,
            filters,
            {
                tenantId,

                schemaScoped:
                    target
                        .schemaScoped,
            }
        );

        const countQuery =
            base
                .clone()
                .clearSelect()
                .clearOrder()
                .count({
                    count:
                        '*',
                })
                .first();

        const [countRow, rows] =
            await Promise.all([
                countQuery,

                base
                    .clone()
                    .orderBy(
                        order,
                        direction
                    )
                    .offset(
                        (
                            page -
                            1
                        ) *
                            pageSize
                    )
                    .limit(
                        pageSize
                    ),
            ]);

        const total =
            parseDatabaseCount(
                countRow?.count
            );

        this._stats.queryCount +=
            1;

        this._metric(
            'analytics.query_total',
            1,
            {
                tenant:
                    safeTenantMetric(
                        tenantId
                    ),
            }
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

            items:
                rows.map(
                    row =>
                        parseAnalyticsRow(
                            row
                        )
                ),
        };
    }

    _resolveQueryTarget(
        tenantId,
        mode
    ) {
        if (
            mode ===
                TENANCY_MODES.SCHEMA
        ) {
            if (
                !tenantId
            ) {
                throw new AnalyticsRepositoryError(
                    'A tenantId is required for schema-scoped analytics queries.',
                    'ANALYTICS_TENANT_REQUIRED'
                );
            }

            const schema =
                tenantConstants
                    .schemaNameForTenant(
                        tenantId
                    );

            assertSafeIdentifier(
                schema
            );

            return {
                table:
                    `${schema}.analytics_events`,

                schemaScoped:
                    true,
            };
        }

        assertSafeIdentifier(
            GLOBAL_TABLE
        );

        return {
            table:
                GLOBAL_TABLE,

            schemaScoped:
                false,
        };
    }

    _applyCommonFilters(
        query,
        filters,
        {
            tenantId,
            schemaScoped,
        }
    ) {
        if (
            !schemaScoped &&
            tenantId
        ) {
            query.where(
                'tenant_id',
                tenantId
            );
        }

        if (
            filters.eventType
        ) {
            query.where(
                'event_type',
                normalizeEventType(
                    filters.eventType
                )
            );
        }

        if (
            filters.userId
        ) {
            query.where(
                'user_id',
                normalizeNullableString(
                    filters.userId,
                    255
                )
            );
        }

        if (
            filters.sessionId
        ) {
            query.where(
                'session_id',
                normalizeNullableString(
                    filters.sessionId,
                    255
                )
            );
        }

        if (
            filters.from
        ) {
            query.where(
                'timestamp',
                '>=',
                normalizeTimestamp(
                    filters.from
                )
            );
        }

        if (
            filters.to
        ) {
            query.where(
                'timestamp',
                '<=',
                normalizeTimestamp(
                    filters.to
                )
            );
        }

        if (
            filters.q
        ) {
            const search =
                String(
                    filters.q
                ).trim();

            if (
                search
            ) {
                /**
                 * PostgreSQL JSONB search.
                 *
                 * Value is parameterized; JSON structure is not interpolated.
                 */
                query.whereRaw(
                    `(payload::text ILIKE ? OR metadata::text ILIKE ?)`,
                    [
                        `%${escapeLikePattern(
                            search
                        )}%`,

                        `%${escapeLikePattern(
                            search
                        )}%`,
                    ]
                );
            }
        }
    }

    /**
     * ------------------------------------------------------------------------
     * Aggregation
     * ------------------------------------------------------------------------
     */

    async aggregate({
        type =
            'count',

        groupBy =
            [
                'event_type',
            ],

        filters =
            {},

        options =
            {},
    } = {}) {
        if (
            !this.knex
        ) {
            throw new AnalyticsRepositoryError(
                'Knex is required for analytics aggregation.',
                'ANALYTICS_KNEX_REQUIRED'
            );
        }

        const tenantId =
            requireTenantFilter(
                filters.tenantId,
                options
            );

        const mode =
            tenantConstants
                .getTenancyMode();

        const target =
            this._resolveQueryTarget(
                tenantId,
                mode
            );

        const safeGroupBy =
            normalizeGroupBy(
                groupBy
            );

        const query =
            this.knex
                .queryBuilder()
                .from(
                    target.table
                );

        this._applyCommonFilters(
            query,
            filters,
            {
                tenantId,

                schemaScoped:
                    target
                        .schemaScoped,
            }
        );

        switch (
            type
        ) {
            case 'count':
                return this._aggregateCount(
                    query,
                    safeGroupBy
                );

            case 'unique_users':
                return this._aggregateUniqueUsers(
                    query,
                    safeGroupBy
                );

            case 'sum':
                return this._aggregatePayloadSum(
                    query,
                    safeGroupBy,
                    options.payloadPath
                );

            default:
                throw new AnalyticsRepositoryError(
                    `Unsupported aggregate type "${type}".`,
                    'ANALYTICS_AGGREGATE_UNSUPPORTED',
                    {
                        statusCode:
                            400,
                    }
                );
        }
    }

    async _aggregateCount(
        query,
        groupBy
    ) {
        const grouping =
            groupBy.map(
                group =>
                    this._groupExpression(
                        group
                    )
            );

        const selects =
            grouping.map(
                expression =>
                    expression.select
            );

        const groupExpressions =
            grouping.map(
                expression =>
                    expression.group
            );

        selects.push(
            this.knex.raw(
                'COUNT(*)::bigint AS count'
            )
        );

        return query
            .select(
                selects
            )
            .groupBy(
                groupExpressions
            )
            .orderBy(
                groupExpressions[0]
            );
    }

    async _aggregateUniqueUsers(
        query,
        groupBy
    ) {
        const grouping =
            groupBy.map(
                group =>
                    this._groupExpression(
                        group
                    )
            );

        return query
            .select(
                grouping.map(
                    expression =>
                        expression.select
                )
            )
            .countDistinct({
                unique_users:
                    'user_id',
            })
            .groupBy(
                grouping.map(
                    expression =>
                        expression.group
                )
            );
    }

    async _aggregatePayloadSum(
        query,
        groupBy,
        payloadPath
    ) {
        const path =
            normalizePayloadPath(
                payloadPath
            );

        if (
            !path
        ) {
            throw new AnalyticsRepositoryError(
                'payloadPath is required for sum aggregation.',
                'ANALYTICS_PAYLOAD_PATH_REQUIRED',
                {
                    statusCode:
                        400,
                }
            );
        }

        const grouping =
            groupBy.map(
                group =>
                    this._groupExpression(
                        group
                    )
            );

        /**
         * JSON key path is converted into a parameterized PostgreSQL text
         * array rather than interpolated directly into SQL.
         */
        const pathArray =
            `{${path.join(
                ','
            )}}`;

        return query
            .select(
                grouping.map(
                    expression =>
                        expression.select
                )
            )
            .select(
                this.knex.raw(
                    `SUM(
                        COALESCE(
                            NULLIF(
                                jsonb_extract_path_text(
                                    payload,
                                    ?
                                ),
                                ''
                            )::numeric,
                            0
                        )
                    ) AS sum`,
                    [
                        pathArray,
                    ]
                )
            )
            .groupBy(
                grouping.map(
                    expression =>
                        expression.group
                )
            );
    }

    _groupExpression(
        group
    ) {
        switch (
            group
        ) {
            case 'event_type':
                return {
                    select:
                        this.knex
                            .raw(
                                'event_type'
                            ),

                    group:
                        'event_type',
                };

            case 'tenant_id':
                return {
                    select:
                        this.knex
                            .raw(
                                'tenant_id'
                            ),

                    group:
                        'tenant_id',
                };

            case 'user_id':
                return {
                    select:
                        this.knex
                            .raw(
                                'user_id'
                            ),

                    group:
                        'user_id',
                };

            case 'date':
                return {
                    select:
                        this.knex.raw(
                            `DATE_TRUNC(
                                'day',
                                timestamp
                            ) AS date`
                        ),

                    group:
                        this.knex.raw(
                            `DATE_TRUNC(
                                'day',
                                timestamp
                            )`
                        ),
                };

            case 'hour':
                return {
                    select:
                        this.knex.raw(
                            `DATE_TRUNC(
                                'hour',
                                timestamp
                            ) AS hour`
                        ),

                    group:
                        this.knex.raw(
                            `DATE_TRUNC(
                                'hour',
                                timestamp
                            )`
                        ),
                };

            default:
                throw new AnalyticsRepositoryError(
                    `Unsupported analytics groupBy field "${group}".`,
                    'ANALYTICS_GROUP_BY_UNSUPPORTED',
                    {
                        statusCode:
                            400,
                    }
                );
        }
    }

    /**
     * ------------------------------------------------------------------------
     * Retention
     * ------------------------------------------------------------------------
     */

    async purgeOldEvents(
        options = {}
    ) {
        if (
            !this.knex
        ) {
            throw new AnalyticsRepositoryError(
                'Knex is required for analytics retention.',
                'ANALYTICS_KNEX_REQUIRED'
            );
        }

        const days =
            Number(
                options.olderThanDays ||
                this.options
                    .RETENTION_DAYS
            );

        if (
            !Number.isInteger(
                days
            ) ||
            days <=
                0
        ) {
            throw new AnalyticsRepositoryError(
                'olderThanDays must be a positive integer.',
                'ANALYTICS_RETENTION_INVALID',
                {
                    statusCode:
                        400,
                }
            );
        }

        const cutoff =
            new Date(
                Date.now() -
                    days *
                        24 *
                        60 *
                        60 *
                        1000
            );

        const mode =
            tenantConstants
                .getTenancyMode();

        const tenants =
            await this._resolveRetentionTenants(
                options
            );

        let total =
            0;

        for (
            const tenantId of
            tenants
        ) {
            const target =
                this._resolveSqlTarget(
                    tenantId,
                    mode
                );

            const query =
                this.knex(
                    target
                )
                    .where(
                        'timestamp',
                        '<',
                        cutoff
                    );

            if (
                options.dryRun
            ) {
                const result =
                    await query
                        .clone()
                        .count({
                            count:
                                '*',
                        })
                        .first();

                const count =
                    parseDatabaseCount(
                        result?.count
                    );

                total +=
                    count;

                this._logInfo(
                    'Analytics retention dry-run',
                    {
                        tenant:
                            tenantId,

                        count,

                        cutoff:
                            cutoff.toISOString(),
                    }
                );

                continue;
            }

            /**
             * Delete in batches where supported to reduce long-running
             * transactions. PostgreSQL does not support DELETE LIMIT directly,
             * so we select IDs first.
             */
            const deleted =
                await this._deleteInBatches(
                    target,
                    cutoff,
                    options.batchSize ||
                        10_000
                );

            total +=
                deleted;

            this._logInfo(
                'Analytics retention completed',
                {
                    tenant:
                        tenantId,

                    deleted,

                    cutoff:
                        cutoff.toISOString(),
                }
            );
        }

        this._metric(
            'analytics.retention_deleted_total',
            total
        );

        return {
            deleted:
                total,

            cutoff:
                cutoff.toISOString(),

            dryRun:
                Boolean(
                    options.dryRun
                ),
        };
    }

    async _resolveRetentionTenants(
        options
    ) {
        const mode =
            tenantConstants
                .getTenancyMode();

        if (
            options.tenantId
        ) {
            return [
                validateTenantIdStrict(
                    options.tenantId
                ),
            ];
        }

        if (
            mode !==
            TENANCY_MODES.SCHEMA
        ) {
            return [
                tenantConstants
                    .DEFAULTS
                    .DEFAULT_TENANT,
            ];
        }

        /**
         * Schema tenancy requires tenant registry traversal.
         */
        const registryTable =
            `${this.options
                .TABLE_PREFIX}tenants`;

        const rows =
            await this.knex(
                registryTable
            )
                .select(
                    'tenant_id'
                )
                .whereNull(
                    'deleted_at'
                );

        return rows
            .map(
                row =>
                    validateTenantIdStrict(
                        row.tenant_id
                    )
            );
    }

    async _deleteInBatches(
        table,
        cutoff,
        batchSize
    ) {
        let deleted =
            0;

        while (
            true
        ) {
            const ids =
                await this.knex(
                    table
                )
                    .select(
                        'event_id'
                    )
                    .where(
                        'timestamp',
                        '<',
                        cutoff
                    )
                    .orderBy(
                        'timestamp',
                        'asc'
                    )
                    .limit(
                        batchSize
                    );

            if (
                ids.length ===
                0
            ) {
                break;
            }

            const eventIds =
                ids.map(
                    row =>
                        row.event_id
                );

            const count =
                await this.knex(
                    table
                )
                    .whereIn(
                        'event_id',
                        eventIds
                    )
                    .del();

            deleted +=
                Number(
                    count
                );
        }

        return deleted;
    }

    /**
     * ------------------------------------------------------------------------
     * Export
     * ------------------------------------------------------------------------
     */

    async exportEvents(
        options = {}
    ) {
        if (
            !this.knex
        ) {
            throw new AnalyticsRepositoryError(
                'Knex is required for analytics export.',
                'ANALYTICS_KNEX_REQUIRED'
            );
        }

        const writable =
            options.stream;

        if (
            !writable ||
            typeof writable.write !==
                'function'
        ) {
            throw new AnalyticsRepositoryError(
                'A writable stream is required.',
                'ANALYTICS_EXPORT_STREAM_REQUIRED',
                {
                    statusCode:
                        400,
                }
            );
        }

        const format =
            String(
                options.format ||
                    'jsonl'
            ).toLowerCase();

        if (
            ![
                'jsonl',
                'csv',
            ].includes(
                format
            )
        ) {
            throw new AnalyticsRepositoryError(
                'Unsupported export format.',
                'ANALYTICS_EXPORT_FORMAT_UNSUPPORTED',
                {
                    statusCode:
                        400,
                }
            );
        }

        const tenantId =
            options.tenantId
                ? validateTenantIdStrict(
                    options.tenantId
                )
                : requireTenantFilter(
                    null,
                    {
                        requireTenant:
                            true,
                    }
                );

        const target =
            this._resolveQueryTarget(
                tenantId,
                tenantConstants
                    .getTenancyMode()
            );

        const query =
            this.knex
                .select(
                    EVENT_COLUMNS
                )
                .from(
                    target.table
                );

        this._applyCommonFilters(
            query,
            {
                tenantId,

                from:
                    options.from,

                to:
                    options.to,

                eventType:
                    options.eventType,
            },
            {
                tenantId,

                schemaScoped:
                    target
                        .schemaScoped,
            }
        );

        const limit =
            Math.min(
                parsePositiveInteger(
                    options.limit,
                    this.options
                        .MAX_EXPORT_ROWS,
                    1,
                    this.options
                        .MAX_EXPORT_ROWS
                ),
                this.options
                    .MAX_EXPORT_ROWS
            );

        query
            .orderBy(
                'timestamp',
                'asc'
            )
            .limit(
                limit
            );

        return new Promise(
            (
                resolve,
                reject
            ) => {
                let rowCount =
                    0;

                const streamQuery =
                    query.stream();

                if (
                    format ===
                    'csv'
                ) {
                    writable.write(
                        `${CSV_HEADERS.join(
                            ','
                        )}\n`
                    );
                }

                const handleRow =
                    row => {
                        try {
                            if (
                                rowCount >=
                                limit
                            ) {
                                return;
                            }

                            const parsed =
                                parseAnalyticsRow(
                                    row
                                );

                            if (
                                format ===
                                'jsonl'
                            ) {
                                writable.write(
                                    `${JSON.stringify(
                                        parsed
                                    )}\n`
                                );
                            } else {
                                writable.write(
                                    `${serializeCsvRow(
                                        parsed
                                    )}\n`
                                );
                            }

                            rowCount +=
                                1;
                        } catch (
                            error
                        ) {
                            streamQuery.destroy(
                                error
                            );
                        }
                    };

                streamQuery.on(
                    'data',
                    handleRow
                );

                streamQuery.on(
                    'end',
                    () => {
                        writable.end(
                            () => {
                                resolve({
                                    exported:
                                        rowCount,

                                    format,
                                });
                            }
                        );
                    }
                );

                streamQuery.on(
                    'error',
                    error => {
                        writable.destroy?.(
                            error
                        );

                        reject(
                            error
                        );
                    }
                );
            }
        );
    }

    /**
     * ------------------------------------------------------------------------
     * Stream publication
     * ------------------------------------------------------------------------
     */

    async publishEvent(
        topic,
        event
    ) {
        if (
            !this.streamProducer ||
            typeof this.streamProducer.produce !==
                'function'
        ) {
            throw new AnalyticsRepositoryError(
                'Analytics stream producer is not configured.',
                'ANALYTICS_STREAM_PRODUCER_NOT_CONFIGURED'
            );
        }

        const validated =
            this._validateEvent(
                event
            );

        const topicName =
            validateTopicName(
                topic
            );

        const payload =
            Buffer.from(
                JSON.stringify(
                    validated
                ),
                'utf8'
            );

        await this.streamProducer.produce(
            topicName,
            payload
        );

        this._stats.published +=
            1;

        this._metric(
            'analytics.published_total',
            1,
            {
                tenant:
                    safeTenantMetric(
                        validated.tenant_id
                    ),

                event_type:
                    validated.event_type,
            }
        );

        this.emit(
            'published',
            validated
        );

        return {
            published:
                true,

            eventId:
                validated.event_id,

            topic:
                topicName,
        };
    }

    /**
     * ------------------------------------------------------------------------
     * Health check
     * ------------------------------------------------------------------------
     */

    async healthcheck() {
        const details =
            {};

        let healthy =
            true;

        if (
            this.knex
        ) {
            try {
                await this.knex
                    .raw(
                        'SELECT 1'
                    );

                details.knex =
                    'ok';
            } catch (
                error
            ) {
                healthy =
                    false;

                details.knex =
                    {
                        status:
                            'error',

                        message:
                            error.message,
                    };
            }
        } else {
            details.knex =
                'not_configured';
        }

        if (
            this.clickhouseClient
        ) {
            try {
                if (
                    typeof this
                        .clickhouseClient
                        .ping ===
                    'function'
                ) {
                    await this
                        .clickhouseClient
                        .ping();

                    details.clickhouse =
                        'ok';
                } else {
                    details.clickhouse =
                        'configured';
                }
            } catch (
                error
            ) {
                healthy =
                    false;

                details.clickhouse =
                    {
                        status:
                            'error',

                        message:
                            error.message,
                    };
            }
        }

        if (
            this.cacheClient
        ) {
            try {
                if (
                    typeof this
                        .cacheClient
                        .ping ===
                    'function'
                ) {
                    await this
                        .cacheClient
                        .ping();

                    details.cache =
                        'ok';
                } else {
                    details.cache =
                        'configured';
                }
            } catch (
                error
            ) {
                details.cache =
                    {
                        status:
                            'error',

                        message:
                            error.message,
                    };
            }
        }

        if (
            this.streamProducer
        ) {
            details.stream =
                'configured';
        }

        details.queueSize =
            this._queueSize;

        details.retryQueueSize =
            this._retryQueueSize;

        details.shuttingDown =
            this._shuttingDown;

        return {
            ok:
                healthy,

            status:
                healthy
                    ? 'healthy'
                    : 'degraded',

            details,

            timestamp:
                new Date()
                    .toISOString(),
        };
    }

    /**
     * ------------------------------------------------------------------------
     * Shutdown
     * ------------------------------------------------------------------------
     */

    async shutdown(
        {
            timeoutMs =
                30_000,

            retryFailed =
                true,

            failOnPending =
                false,
        } = {}
    ) {
        this._shuttingDown =
            true;

        this._stopBatchTimer();

        const started =
            Date.now();

        this._logInfo(
            'TITech AnalyticsRepository shutdown initiated',
            {
                queueSize:
                    this._queueSize,

                retryQueueSize:
                    this._retryQueueSize,
            }
        );

        while (
            (
                this._queueSize >
                    0 ||
                (
                    retryFailed &&
                    this._retryQueueSize >
                        0
                )
            ) &&
            Date.now() -
                started <
                timeoutMs
        ) {
            if (
                this._queueSize >
                0
            ) {
                await this._scheduleFlush();
            }

            if (
                retryFailed &&
                this._retryQueueSize >
                0
            ) {
                await this.retryFailedBatches(
                    {
                        limit:
                            this.options
                                .BATCH_SIZE,
                    }
                );
            }

            if (
                this._queueSize >
                    0 ||
                (
                    retryFailed &&
                    this._retryQueueSize >
                        0
                )
            ) {
                await sleep(
                    100
                );
            }
        }

        const pending =
            this._queueSize +
            this._retryQueueSize;

        if (
            pending > 0
        ) {
            this._logWarn(
                'Analytics shutdown completed with pending events',
                {
                    pending,
                }
            );

            if (
                failOnPending
            ) {
                throw new AnalyticsRepositoryError(
                    'Analytics repository shutdown timed out with pending events.',
                    'ANALYTICS_SHUTDOWN_PENDING',
                    {
                        statusCode:
                            503,

                        details:
                            {
                                pending,
                            },
                    }
                );
            }

            return {
                complete:
                    false,

                pending,
            };
        }

        this._logInfo(
            'TITech AnalyticsRepository shutdown complete'
        );

        return {
            complete:
                true,

            pending:
                0,
        };
    }

    /**
     * ------------------------------------------------------------------------
     * Statistics
     * ------------------------------------------------------------------------
     */

    stats() {
        return {
            queueSize:
                this._queueSize,

            retryQueueSize:
                this._retryQueueSize,

            running:
                this._running,

            shuttingDown:
                this._shuttingDown,

            ...this._stats,

            options:
                {
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
                            .RETENTION_DAYS,
                },
        };
    }

    /**
     * ------------------------------------------------------------------------
     * Metrics
     * ------------------------------------------------------------------------
     */

    _metric(
        name,
        value = 1,
        labels = {}
    ) {
        try {
            if (
                typeof this.metrics
                    .increment ===
                'function'
            ) {
                this.metrics.increment(
                    name,
                    value,
                    sanitizeMetricLabels(
                        labels
                    )
                );
            }
        } catch {
            // Metrics must never break analytics operations.
        }
    }

    _setQueueGauge() {
        try {
            if (
                typeof this.metrics
                    .gauge ===
                'function'
            ) {
                this.metrics.gauge(
                    'titech.analytics.queue_size',
                    this._queueSize
                );

                this.metrics.gauge(
                    'titech.analytics.retry_queue_size',
                    this._retryQueueSize
                );
            }
        } catch {
            // Metrics must never break analytics operations.
        }
    }

    /**
     * ------------------------------------------------------------------------
     * Logging
     * ------------------------------------------------------------------------
     */

    _logInfo(
        message,
        metadata = {}
    ) {
        try {
            this.logger?.info?.(
                `${DEFAULTS.LOG_PREFIX} ${message}`,
                sanitizeLogMetadata(
                    metadata
                )
            );
        } catch {
            // Logging must never break repository operations.
        }
    }

    _logWarn(
        message,
        metadata = {}
    ) {
        try {
            this.logger?.warn?.(
                `${DEFAULTS.LOG_PREFIX} ${message}`,
                sanitizeLogMetadata(
                    metadata
                )
            );
        } catch {
            // Logging must never break repository operations.
        }
    }

    _logError(
        message,
        metadata = {}
    ) {
        try {
            this.logger?.error?.(
                `${DEFAULTS.LOG_PREFIX} ${message}`,
                sanitizeLogMetadata(
                    metadata
                )
            );
        } catch {
            // Logging must never break repository operations.
        }
    }
}

/**
 * ============================================================================
 * Factory
 * ============================================================================
 */

function createAnalyticsRepository(
    dependencies = {}
) {
    return new AnalyticsRepository(
        dependencies
    );
}

/**
 * ============================================================================
 * Validation / Utility Helpers
 * ============================================================================
 */

function validateTenantIdStrict(
    value
) {
    const normalized =
        String(
            value ??
                ''
        )
            .trim()
            .toLowerCase();

    if (
        !normalized ||
        !tenantConstants.isValidTenantId(
            normalized
        )
    ) {
        throw new AnalyticsRepositoryError(
            'Invalid tenant identifier.',
            'ANALYTICS_INVALID_TENANT_ID',
            {
                statusCode:
                    400,
            }
        );
    }

    return normalized;
}

function safeTenantMetric(
    value
) {
    try {
        return validateTenantIdStrict(
            value
        );
    } catch {
        return 'unknown';
    }
}

function normalizeEventType(
    value
) {
    const eventType =
        String(
            value ??
                ''
        ).trim();

    if (
        !eventType
    ) {
        throw new AnalyticsRepositoryError(
            'event_type is required.',
            'ANALYTICS_EVENT_TYPE_REQUIRED',
            {
                statusCode:
                    400,
            }
        );
    }

    if (
        eventType.length >
        DEFAULTS.MAX_EVENT_TYPE_LENGTH
    ) {
        throw new AnalyticsRepositoryError(
            'event_type exceeds the maximum length.',
            'ANALYTICS_EVENT_TYPE_TOO_LONG',
            {
                statusCode:
                    400,
            }
        );
    }

    if (
        !/^[A-Za-z0-9_.:-]+$/.test(
            eventType
        )
    ) {
        throw new AnalyticsRepositoryError(
            'event_type contains unsupported characters.',
            'ANALYTICS_EVENT_TYPE_INVALID',
            {
                statusCode:
                    400,
            }
        );
    }

    return eventType;
}

function normalizeTimestamp(
    value
) {
    const date =
        new Date(
            value
        );

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        throw new AnalyticsRepositoryError(
            'Invalid analytics timestamp.',
            'ANALYTICS_TIMESTAMP_INVALID',
            {
                statusCode:
                    400,
            }
        );
    }

    return date.toISOString();
}

function normalizeNullableString(
    value,
    maxLength
) {
    if (
        value ===
            undefined ||
        value ===
            null ||
        String(
            value
        ).trim() ===
            ''
    ) {
        return null;
    }

    const result =
        String(
            value
        ).trim();

    if (
        maxLength &&
        result.length >
            maxLength
    ) {
        throw new AnalyticsRepositoryError(
            'String field exceeds the maximum length.',
            'ANALYTICS_STRING_TOO_LONG',
            {
                statusCode:
                    400,
            }
        );
    }

    return result;
}

function validateJsonObject(
    value,
    field,
    {
        maxBytes,
        maxDepth,
    }
) {
    if (
        value ===
            undefined ||
        value ===
            null
    ) {
        return {};
    }

    if (
        !isPlainObject(
            value
        )
    ) {
        throw new AnalyticsRepositoryError(
            `${field} must be a JSON object.`,
            'ANALYTICS_JSON_OBJECT_REQUIRED',
            {
                statusCode:
                    400,
            }
        );
    }

    assertJsonSafe(
        value,
        field,
        0,
        maxDepth
    );

    const serialized =
        JSON.stringify(
            value
        );

    const bytes =
        Buffer.byteLength(
            serialized,
            'utf8'
        );

    if (
        bytes >
        maxBytes
    ) {
        throw new AnalyticsRepositoryError(
            `${field} exceeds the maximum size.`,
            'ANALYTICS_JSON_TOO_LARGE',
            {
                statusCode:
                    413,
            }
        );
    }

    return value;
}

function assertJsonSafe(
    value,
    field,
    depth,
    maxDepth
) {
    if (
        depth >
        maxDepth
    ) {
        throw new AnalyticsRepositoryError(
            `${field} exceeds the maximum object depth.`,
            'ANALYTICS_JSON_DEPTH_EXCEEDED',
            {
                statusCode:
                    400,
            }
        );
    }

    if (
        value ===
            null ||
        typeof value ===
            'string' ||
        typeof value ===
            'boolean'
    ) {
        return;
    }

    if (
        typeof value ===
            'number'
    ) {
        if (
            !Number.isFinite(
                value
            )
        ) {
            throw new AnalyticsRepositoryError(
                `${field} contains a non-finite number.`,
                'ANALYTICS_JSON_NUMBER_INVALID',
                {
                    statusCode:
                        400,
                }
            );
        }

        return;
    }

    if (
        Array.isArray(
            value
        )
    ) {
        for (
            const item of
            value
        ) {
            assertJsonSafe(
                item,
                field,
                depth + 1,
                maxDepth
            );
        }

        return;
    }

    if (
        typeof value ===
        'object'
    ) {
        for (
            const [
                key,
                child,
            ] of Object.entries(
                value
            )
        ) {
            if (
                key.length >
                255
            ) {
                throw new AnalyticsRepositoryError(
                    `${field} contains an oversized property name.`,
                    'ANALYTICS_JSON_KEY_TOO_LONG',
                    {
                        statusCode:
                            400,
                    }
                );
            }

            assertJsonSafe(
                child,
                field,
                depth + 1,
                maxDepth
            );
        }

        return;
    }

    throw new AnalyticsRepositoryError(
        `${field} contains an unsupported value type.`,
        'ANALYTICS_JSON_VALUE_INVALID',
        {
            statusCode:
                400,
        }
    );
}

function cloneJsonSafe(
    value
) {
    return JSON.parse(
        JSON.stringify(
            value
        )
    );
}

function generateEventId() {
    return crypto.randomUUID();
}

function groupByTenant(
    events
) {
    return events.reduce(
        (
            groups,
            event
        ) => {
            const tenantId =
                validateTenantIdStrict(
                    event.tenant_id
                );

            if (
                !groups[
                    tenantId
                ]
            ) {
                groups[
                    tenantId
                ] = [];
            }

            groups[
                tenantId
            ].push(
                event
            );

            return groups;
        },
        {}
    );
}

function parseAnalyticsRow(
    row
) {
    const result =
        {
            ...row,
        };

    if (
        typeof result.payload ===
            'string'
    ) {
        try {
            result.payload =
                JSON.parse(
                    result.payload
                );
        } catch {
            // Preserve original value if legacy/non-JSON data exists.
        }
    }

    if (
        typeof result.metadata ===
            'string'
    ) {
        try {
            result.metadata =
                JSON.parse(
                    result.metadata
                );
        } catch {
            // Preserve original value.
        }
    }

    return result;
}

function parseDatabaseCount(
    count
) {
    if (
        typeof count ===
            'number'
    ) {
        return count;
    }

    const result =
        Number(
            count
        );

    return Number.isFinite(
        result
    )
        ? result
        : 0;
}

function parsePositiveInteger(
    value,
    fallback,
    min,
    max
) {
    const parsed =
        Number(
            value
        );

    if (
        !Number.isInteger(
            parsed
        ) ||
        parsed <
            min ||
        parsed >
            max
    ) {
        return fallback;
    }

    return parsed;
}

function normalizeOrderColumn(
    value
) {
    const normalized =
        String(
            value ??
                ''
        )
            .trim();

    if (
        !ALLOWED_QUERY_ORDER_COLUMNS.includes(
            normalized
        )
    ) {
        return DEFAULTS.DEFAULT_ORDER;
    }

    return normalized;
}

function normalizeDirection(
    value
) {
    const normalized =
        String(
            value ??
                ''
        )
            .trim()
            .toLowerCase();

    return ALLOWED_QUERY_DIRECTIONS.includes(
        normalized
    )
        ? normalized
        : DEFAULTS.DEFAULT_DIRECTION;
}

function normalizeGroupBy(
    groupBy
) {
    if (
        !Array.isArray(
            groupBy
        ) ||
        groupBy.length ===
            0
    ) {
        return [
            'event_type',
        ];
    }

    const uniqueGroups =
        Array.from(
            new Set(
                groupBy.map(
                    value =>
                        String(
                            value
                        ).trim()
                )
            )
        );

    return uniqueGroups;
}

function normalizePayloadPath(
    value
) {
    if (
        !value
    ) {
        return null;
    }

    const parts =
        Array.isArray(
            value
        )
            ? value
            : String(
                value
            ).split(
                '.'
            );

    const normalized =
        parts
            .map(
                part =>
                    String(
                        part
                    ).trim()
            )
            .filter(
                Boolean
            );

    if (
        normalized.length ===
            0 ||
        normalized.some(
            part =>
                !/^[A-Za-z0-9_-]+$/.test(
                    part
                )
        )
    ) {
        throw new AnalyticsRepositoryError(
            'Invalid analytics payload path.',
            'ANALYTICS_PAYLOAD_PATH_INVALID',
            {
                statusCode:
                    400,
            }
        );
    }

    return normalized;
}

function requireTenantFilter(
    tenantId,
    options = {}
) {
    if (
        tenantId
    ) {
        return validateTenantIdStrict(
            tenantId
        );
    }

    if (
        options.requireTenant ===
        true
    ) {
        throw new AnalyticsRepositoryError(
            'Tenant identifier is required for this analytics operation.',
            'ANALYTICS_TENANT_REQUIRED',
            {
                statusCode:
                    400,
            }
        );
    }

    return null;
}

function assertSafeIdentifier(
    identifier
) {
    const value =
        String(
            identifier ??
                ''
        );

    /**
     * SQL identifiers constructed dynamically must be generated exclusively
     * from trusted TITech naming helpers.
     */
    if (
        !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(
            value
        )
    ) {
        throw new AnalyticsRepositoryError(
            'Unsafe analytics SQL identifier.',
            'ANALYTICS_UNSAFE_IDENTIFIER'
        );
    }

    return value;
}

function escapeLikePattern(
    value
) {
    return String(
        value
    ).replace(
        /[%_\\]/g,
        match =>
            `\\${match}`
    );
}

function validateTopicName(
    topic
) {
    const value =
        String(
            topic ??
                ''
        ).trim();

    if (
        !value ||
        value.length >
            255 ||
        !/^[A-Za-z0-9._:-]+$/.test(
            value
        )
    ) {
        throw new AnalyticsRepositoryError(
            'Invalid analytics stream topic.',
            'ANALYTICS_TOPIC_INVALID',
            {
                statusCode:
                    400,
            }
        );
    }

    return value;
}

function computeBackoff(
    attempt,
    base,
    cap
) {
    const exponential =
        Math.min(
            cap,
            base *
                Math.pow(
                    2,
                    attempt
                )
        );

    const jitter =
        Math.floor(
            Math.random() *
                Math.max(
                    1,
                    base
                )
        );

    return (
        exponential +
        jitter
    );
}

function isRetryableAnalyticsError(
    error
) {
    if (
        !error
    ) {
        return true;
    }

    const nonRetryableCodes =
        new Set([
            'INVALID_ANALYTICS_EVENT',
            'ANALYTICS_INVALID_TENANT_ID',
            'ANALYTICS_EVENT_TYPE_INVALID',
            'ANALYTICS_JSON_TOO_LARGE',
            'ANALYTICS_JSON_DEPTH_EXCEEDED',
            'ANALYTICS_UNSAFE_IDENTIFIER',
        ]);

    if (
        nonRetryableCodes.has(
            error.code
        )
    ) {
        return false;
    }

    if (
        [
            '40001',
            '40P01',
            '08000',
            '08003',
            '08006',
            '08007',
            '57P01',
            '53300',
        ].includes(
            error.code
        )
    ) {
        return true;
    }

    if (
        typeof error.statusCode ===
        'number'
    ) {
        return (
            error.statusCode >=
                500 ||
            error.statusCode ===
                429
        );
    }

    return true;
}

function sanitizeMetricLabels(
    labels = {}
) {
    if (
        !isPlainObject(
            labels
        )
    ) {
        return {};
    }

    const allowed =
        new Set([
            'tenant',
            'event_type',
            'reason',
            'status',
            'batch_size',
            'attempt',
        ]);

    const result =
        {};

    for (
        const [
            key,
            value,
        ] of Object.entries(
            labels
        )
    ) {
        if (
            !allowed.has(
                key
            )
        ) {
            continue;
        }

        result[key] =
            String(
                value ??
                    ''
            ).slice(
                0,
                128
            );
    }

    return result;
}

function sanitizeLogMetadata(
    metadata = {}
) {
    if (
        !isPlainObject(
            metadata
        )
    ) {
        return {};
    }

    const result =
        {};

    const sensitive =
        /password|secret|token|authorization|cookie|credential|private.?key|api.?key/i;

    for (
        const [
            key,
            value,
        ] of Object.entries(
            metadata
        )
    ) {
        if (
            sensitive.test(
                key
            )
        ) {
            result[key] =
                '[REDACTED]';

            continue;
        }

        if (
            key ===
                'batch' ||
            key ===
                'payload'
        ) {
            result[key] =
                '[OMITTED]';

            continue;
        }

        result[key] =
            value;
    }

    return result;
}

function formatAjvErrors(
    errors
) {
    if (
        !Array.isArray(
            errors
        )
    ) {
        return [];
    }

    return errors.map(
        error => ({
            message:
                error.message,

            path:
                error.instancePath ||
                error.dataPath ||
                '',

            keyword:
                error.keyword,

            params:
                error.params,
        })
    );
}

function isPlainObject(
    value
) {
    return (
        value !==
            null &&
        typeof value ===
            'object' &&
        !Array.isArray(
            value
        )
    );
}

function sleep(
    milliseconds
) {
    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                milliseconds
            )
    );
}

/**
 * ============================================================================
 * CSV
 * ============================================================================
 */

const CSV_HEADERS =
    Object.freeze([
        'event_id',
        'tenant_id',
        'event_type',
        'timestamp',
        'user_id',
        'session_id',
        'payload',
        'metadata',
        'created_at',
    ]);

function serializeCsvRow(
    row
) {
    return CSV_HEADERS
        .map(
            column =>
                csvEscape(
                    csvValue(
                        row[
                            column
                        ]
                    )
                )
        )
        .join(
            ','
        );
}

function csvValue(
    value
) {
    if (
        value ===
            undefined ||
        value ===
            null
    ) {
        return '';
    }

    if (
        typeof value ===
            'object'
    ) {
        return JSON.stringify(
            value
        );
    }

    return String(
        value
    );
}

function csvEscape(
    value
) {
    const stringValue =
        String(
            value
        );

    if (
        /[",\n\r]/.test(
            stringValue
        )
    ) {
        return `"${stringValue.replace(
            /"/g,
            '""'
        )}"`;
    }

    return stringValue;
}
