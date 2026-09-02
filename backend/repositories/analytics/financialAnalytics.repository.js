'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Financial Analytics Repository
 * ============================================================================
 *
 * File:
 *   backend/repositories/analytics/financialAnalytics.repository.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Enterprise persistence/query layer for TITech financial analytics.
 *
 * Architectural rule
 * ----------------------------------------------------------------------------
 * Financial analytics NEVER becomes the authoritative financial ledger.
 *
 * Source of truth:
 *
 *   Financial Transaction Service
 *          ↓
 *   Double-entry Ledger
 *          ↓
 *   Authoritative balances
 *
 * Analytics:
 *
 *   Financial Transaction / Ledger Event
 *          ↓
 *   FinancialAnalyticsRepository
 *          ↓
 *   Reporting / reconciliation / risk / dashboards
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - Strict tenant isolation.
 * - Financial event validation.
 * - Integer minor-unit money representation.
 * - ISO currency validation.
 * - Deterministic idempotency.
 * - Bounded batching and backpressure.
 * - Retry/recovery/dead-letter handling.
 * - PostgreSQL/Knex persistence.
 * - ClickHouse/custom-writer integration.
 * - Tenant-scoped queries.
 * - Currency-safe aggregation.
 * - Settlement reconciliation.
 * - Refund/chargeback analytics.
 * - Financial transaction summaries.
 * - Retention management.
 * - Streaming publication.
 * - Optional aggregate caching.
 * - Operational health and metrics.
 *
 * Non-responsibilities
 * ----------------------------------------------------------------------------
 * - Authentication.
 * - Authorization.
 * - Wallet mutations.
 * - Ledger mutations.
 * - Loan balance mutations.
 * - Payment execution.
 *
 * TITech terminology
 * ----------------------------------------------------------------------------
 * All legacy ACFOS terminology has been replaced with TITech Community
 * Capital terminology.
 *
 * ============================================================================
 */

const EventEmitter =
    require('node:events');

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

const Big =
    require('big.js');

const tenantConstants =
    require('../../tenancy/tenant.constants');

/**
 * ============================================================================
 * Constants / Configuration
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

function envBoolean(
    name,
    fallback
) {
    const value =
        process.env[name];

    if (
        value ===
            undefined
    ) {
        return fallback;
    }

    return [
        'true',
        '1',
        'yes',
        'on',
    ].includes(
        String(
            value
        )
            .trim()
            .toLowerCase()
    );
}

const DEFAULT_CURRENCY =
    (
        process.env.DEFAULT_CURRENCY ||
        'UGX'
    )
        .trim()
        .toUpperCase();

const DEFAULT_SUPPORTED_CURRENCIES =
    (
        process.env.SUPPORTED_CURRENCIES ||
        'UGX,USD,EUR,GBP,KES,TZS,JPY'
    )
        .split(',')
        .map(
            value =>
                value
                    .trim()
                    .toUpperCase()
        )
        .filter(
            Boolean
        );

const CURRENCY_DECIMALS =
    Object.freeze({
        BIF: 0,
        CLP: 0,
        DJF: 0,
        GNF: 0,
        ISK: 0,
        JPY: 0,
        KMF: 0,
        KRW: 0,
        PYG: 0,
        RWF: 0,
        UGX: 0,
        VND: 0,
        VUV: 0,
        XAF: 0,
        XOF: 0,
        XPF: 0,

        BHD: 3,
        IQD: 3,
        JOD: 3,
        KWD: 3,
        LYD: 3,
        OMR: 3,
        TND: 3,

        AED: 2,
        AFN: 2,
        ALL: 2,
        AUD: 2,
        BGN: 2,
        BRL: 2,
        CAD: 2,
        CHF: 2,
        CNY: 2,
        CZK: 2,
        DKK: 2,
        EGP: 2,
        EUR: 2,
        GBP: 2,
        GEL: 2,
        GHS: 2,
        HKD: 2,
        HNL: 2,
        HRK: 2,
        HUF: 2,
        IDR: 2,
        ILS: 2,
        INR: 2,
        KES: 2,
        LKR: 2,
        MAD: 2,
        MUR: 2,
        MXN: 2,
        MYR: 2,
        NGN: 2,
        NOK: 2,
        NZD: 2,
        PEN: 2,
        PHP: 2,
        PKR: 2,
        PLN: 2,
        QAR: 2,
        RON: 2,
        RSD: 2,
        RUB: 2,
        SAR: 2,
        SEK: 2,
        SGD: 2,
        THB: 2,
        TRY: 2,
        TZS: 2,
        UAH: 2,
        USD: 2,
        UYU: 2,
        ZAR: 2,
    });

const DEFAULTS =
    Object.freeze({
        BATCH_SIZE:
            envNumber(
                'FIN_ANALYTICS_BATCH_SIZE',
                250,
                1,
                10_000
            ),

        BATCH_INTERVAL_MS:
            envNumber(
                'FIN_ANALYTICS_BATCH_INTERVAL_MS',
                1_500,
                100,
                60_000
            ),

        MAX_QUEUE_SIZE:
            envNumber(
                'FIN_ANALYTICS_MAX_QUEUE_SIZE',
                25_000,
                100,
                1_000_000
            ),

        MAX_RETRY_QUEUE_SIZE:
            envNumber(
                'FIN_ANALYTICS_MAX_RETRY_QUEUE_SIZE',
                100_000,
                100,
                2_000_000
            ),

        WRITE_RETRY_ATTEMPTS:
            envNumber(
                'FIN_ANALYTICS_WRITE_RETRY_ATTEMPTS',
                3,
                1,
                10
            ),

        WRITE_RETRY_MIN_TIMEOUT:
            envNumber(
                'FIN_ANALYTICS_WRITE_RETRY_MIN_TIMEOUT',
                150,
                25,
                30_000
            ),

        WRITE_RETRY_MAX_TIMEOUT:
            envNumber(
                'FIN_ANALYTICS_WRITE_RETRY_MAX_TIMEOUT',
                5_000,
                100,
                120_000
            ),

        LOCK_TTL:
            envNumber(
                'FIN_ANALYTICS_LOCK_TTL',
                30_000,
                1_000,
                300_000
            ),

        LOCK_ATTEMPTS:
            envNumber(
                'FIN_ANALYTICS_LOCK_ATTEMPTS',
                5,
                1,
                20
            ),

        LOCK_RETRY_DELAY:
            envNumber(
                'FIN_ANALYTICS_LOCK_RETRY_DELAY',
                200,
                25,
                10_000
            ),

        IDEMPOTENCY_TTL:
            envNumber(
                'FIN_ANALYTICS_IDEMPOTENCY_TTL',
                86_400,
                60,
                31_536_000
            ),

        RETENTION_DAYS:
            envNumber(
                'FIN_ANALYTICS_RETENTION_DAYS',
                1_095,
                1,
                3_650
            ),

        MAX_PAGE_SIZE:
            envNumber(
                'FIN_ANALYTICS_MAX_PAGE_SIZE',
                500,
                1,
                5_000
            ),

        MAX_RECONCILIATION_IDS:
            envNumber(
                'FIN_ANALYTICS_MAX_RECONCILIATION_IDS',
                10_000,
                1,
                100_000
            ),

        MAX_EXPORT_ROWS:
            envNumber(
                'FIN_ANALYTICS_MAX_EXPORT_ROWS',
                500_000,
                1,
                10_000_000
            ),

        MAX_PAYLOAD_BYTES:
            envNumber(
                'FIN_ANALYTICS_MAX_PAYLOAD_BYTES',
                64 * 1024,
                1_024,
                5 * 1024 * 1024
            ),

        MAX_METADATA_BYTES:
            envNumber(
                'FIN_ANALYTICS_MAX_METADATA_BYTES',
                32 * 1024,
                1_024,
                2 * 1024 * 1024
            ),

        MAX_JSON_DEPTH:
            envNumber(
                'FIN_ANALYTICS_MAX_JSON_DEPTH',
                8,
                1,
                32
            ),

        MAX_EVENT_TYPE_LENGTH:
            envNumber(
                'FIN_ANALYTICS_MAX_EVENT_TYPE_LENGTH',
                128,
                16,
                512
            ),

        TABLE_PREFIX:
            tenantConstants
                .ENV
                .DB_TABLE_PREFIX ||
            'titech_',

        GLOBAL_TABLE:
            `${tenantConstants.ENV.DB_TABLE_PREFIX || 'titech_'}financial_events`,

        CACHE_PREFIX:
            process.env.FIN_ANALYTICS_CACHE_PREFIX ||
            'titech:financial-analytics:',

        CACHE_TTL:
            envNumber(
                'FIN_ANALYTICS_CACHE_TTL',
                60,
                5,
                3_600
            ),

        DEFAULT_CURRENCY,

        SUPPORTED_CURRENCIES:
            Object.freeze(
                Array.from(
                    new Set(
                        DEFAULT_SUPPORTED_CURRENCIES
                    )
                )
            ),

        STRICT_AMOUNT_PRECISION:
            envBoolean(
                'FIN_ANALYTICS_STRICT_AMOUNT_PRECISION',
                true
            ),

        REQUIRE_TENANT_FOR_READS:
            envBoolean(
                'FIN_ANALYTICS_REQUIRE_TENANT_FOR_READS',
                true
            ),

        ENABLE_AGGREGATE_CACHE:
            envBoolean(
                'FIN_ANALYTICS_ENABLE_AGGREGATE_CACHE',
                true
            ),

        LOG_PREFIX:
            'TITech.FinancialAnalytics',
    });

const TENANCY_MODES =
    tenantConstants
        .TENANCY_MODES;

const EVENT_TYPES =
    Object.freeze([
        'payment',
        'refund',
        'chargeback',
        'fee',
        'settlement',
        'adjustment',
    ]);

const EVENT_STATUSES =
    Object.freeze([
        'pending',
        'processing',
        'succeeded',
        'failed',
        'cancelled',
        'reversed',
        'settled',
        'disputed',
    ]);

const ALLOWED_PAYMENT_METHODS =
    Object.freeze([
        'cash',
        'bank',
        'bank_transfer',
        'mobile_money',
        'card',
        'mtn_momo',
        'airtel_money',
        'mpesa',
        'wallet',
        'internal',
        'other',
    ]);

const QUERY_ORDER_FIELDS =
    Object.freeze([
        'created_at',
        'timestamp',
        'amount_minor',
        'event_type',
        'currency',
        'transaction_id',
    ]);

const QUERY_DIRECTIONS =
    Object.freeze([
        'asc',
        'desc',
    ]);

const EVENT_COLUMNS =
    Object.freeze([
        'internal_id',
        'tenant_id',
        'transaction_id',
        'event_type',
        'timestamp',
        'amount_minor',
        'currency',
        'user_id',
        'payment_method',
        'status',
        'payload',
        'metadata',
        'idempotency_key',
        'created_at',
    ]);

/**
 * ============================================================================
 * Errors
 * ============================================================================
 */

class FinancialAnalyticsRepositoryError extends Error {
    constructor(
        message,
        code = 'FINANCIAL_ANALYTICS_REPOSITORY_ERROR',
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
            'FinancialAnalyticsRepositoryError';

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
            FinancialAnalyticsRepositoryError
        );
    }
}

/**
 * ============================================================================
 * AJV
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

const financialEventSchema =
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
                'amount_minor',
                'currency',
                'transaction_id',
                'payload',
            ],

        properties:
            {
                internal_id:
                    {
                        type:
                            'string',

                        minLength:
                            16,

                        maxLength:
                            128,
                    },

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

                transaction_id:
                    {
                        type:
                            'string',

                        minLength:
                            1,

                        maxLength:
                            255,
                    },

                event_type:
                    {
                        type:
                            'string',

                        enum:
                            EVENT_TYPES,
                    },

                timestamp:
                    {
                        type:
                            'string',

                        format:
                            'date-time',
                    },

                amount_minor:
                    {
                        type:
                            'integer',

                        minimum:
                            -9007199254740991,

                        maximum:
                            9007199254740991,
                    },

                currency:
                    {
                        type:
                            'string',

                        pattern:
                            '^[A-Z]{3}$',
                    },

                user_id:
                    {
                        type:
                            [
                                'string',
                                'null',
                            ],

                        maxLength:
                            255,
                    },

                payment_method:
                    {
                        type:
                            [
                                'string',
                                'null',
                            ],

                        maxLength:
                            64,
                    },

                status:
                    {
                        type:
                            [
                                'string',
                                'null',
                            ],

                        maxLength:
                            32,
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

                idempotency_key:
                    {
                        type:
                            [
                                'string',
                                'null',
                            ],

                        minLength:
                            8,

                        maxLength:
                            255,
                    },
            },
    };

const validateFinancialEvent =
    ajv.compile(
        financialEventSchema
    );

/**
 * ============================================================================
 * Financial Analytics Repository
 * ============================================================================
 */

class FinancialAnalyticsRepository
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
        encryption = null,
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

        this.lockClient =
            lockClient;

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

        this.encryption =
            encryption;

        this.options =
            Object.freeze({
                ...DEFAULTS,
                ...options,

                SUPPORTED_CURRENCIES:
                    Object.freeze(
                        (
                            options
                                .SUPPORTED_CURRENCIES ||
                            DEFAULTS
                                .SUPPORTED_CURRENCIES
                        )
                            .map(
                                currency =>
                                    String(
                                        currency
                                    )
                                        .trim()
                                        .toUpperCase()
                            )
                            .filter(
                                Boolean
                            )
                    ),
            });

        this._queue =
            [];

        this._retryQueue =
            [];

        this._queueSize =
            0;

        this._retryQueueSize =
            0;

        this._batchTimer =
            null;

        this._running =
            false;

        this._flushPromise =
            null;

        this._shuttingDown =
            false;

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

            queries:
                0,

            reconciliations:
                0,
        };

        this._logInfo(
            'TITech FinancialAnalyticsRepository initialized',
            {
                tenancyMode:
                    tenantConstants
                        .getTenancyMode(),

                defaultCurrency:
                    this.options
                        .DEFAULT_CURRENCY,
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
            throw new FinancialAnalyticsRepositoryError(
                'Financial event must be an object.',
                'FINANCIAL_EVENT_OBJECT_REQUIRED',
                {
                    statusCode:
                        400,
                }
            );
        }

        const event =
            cloneJson(
                rawEvent
            );

        event.tenant_id =
            validateTenantIdStrict(
                event.tenant_id
            );

        event.event_type =
            normalizeEventType(
                event.event_type
            );

        event.currency =
            normalizeCurrency(
                event.currency ||
                this.options
                    .DEFAULT_CURRENCY,
                this.options
                    .SUPPORTED_CURRENCIES
            );

        event.transaction_id =
            normalizeRequiredString(
                event.transaction_id,
                255,
                'transaction_id'
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

        event.payment_method =
            normalizeNullableString(
                event.payment_method,
                64
            );

        if (
            event.payment_method
        ) {
            event.payment_method =
                normalizePaymentMethod(
                    event.payment_method
                );
        }

        event.status =
            normalizeStatus(
                event.status
            );

        event.payload =
            validateJsonObject(
                event.payload,
                'payload',
                this.options
                    .MAX_PAYLOAD_BYTES,
                this.options
                    .MAX_JSON_DEPTH
            );

        event.metadata =
            validateJsonObject(
                event.metadata ||
                    {},
                'metadata',
                this.options
                    .MAX_METADATA_BYTES,
                this.options
                    .MAX_JSON_DEPTH
            );

        /**
         * Prefer explicit minor units.
         *
         * Decimal amount is accepted only as an ingestion convenience.
         */
        if (
            event.amount_minor ===
                undefined ||
            event.amount_minor ===
                null
        ) {
            if (
                event.amount ===
                    undefined ||
                event.amount ===
                    null
            ) {
                throw new FinancialAnalyticsRepositoryError(
                    'amount_minor is required when amount is not supplied.',
                    'FINANCIAL_AMOUNT_REQUIRED',
                    {
                        statusCode:
                            400,
                    }
                );
            }

            event.amount_minor =
                toMinorUnits(
                    event.amount,
                    event.currency,
                    {
                        strictPrecision:
                            this.options
                                .STRICT_AMOUNT_PRECISION,
                    }
                );

            delete event.amount;
        } else {
            event.amount_minor =
                normalizeMinorUnits(
                    event.amount_minor
                );

            if (
                event.amount !==
                    undefined
            ) {
                delete event.amount;
            }
        }

        validateAmountSemantics(
            event.event_type,
            event.amount_minor
        );

        /**
         * Idempotency is deterministic.
         *
         * For a supplied key, internal_id is deterministic and stable.
         */
        event.idempotency_key =
            normalizeNullableString(
                event.idempotency_key,
                255
            );

        if (
            !event.idempotency_key
        ) {
            event.idempotency_key =
                generateDeterministicIdempotencyKey(
                    event
                );
        }

        event.internal_id =
            normalizeNullableString(
                event.internal_id,
                128
            ) ||
            generateDeterministicInternalId(
                event
            );

        const valid =
            validateFinancialEvent(
                event
            );

        if (
            !valid
        ) {
            throw new FinancialAnalyticsRepositoryError(
                'Invalid financial event payload.',
                'INVALID_FINANCIAL_EVENT',
                {
                    statusCode:
                        400,

                    details:
                        validateFinancialEvent.errors,
                }
            );
        }

        return Object.freeze(
            event
        );
    }

    /**
     * ------------------------------------------------------------------------
     * Queue / batching
     * ------------------------------------------------------------------------
     */

    async recordFinancialEvent(
        rawEvent,
        options = {}
    ) {
        if (
            this._shuttingDown
        ) {
            throw new FinancialAnalyticsRepositoryError(
                'Financial analytics repository is shutting down.',
                'FINANCIAL_ANALYTICS_SHUTTING_DOWN',
                {
                    statusCode:
                        503,
                }
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
                'titech.financial.invalid_event_total',
                1,
                {
                    reason:
                        error.code ||
                        'validation',
                }
            );

            this._logWarn(
                'Financial event validation failed',
                {
                    error:
                        error.message,

                    code:
                        error.code,
                }
            );

            throw error;
        }

        /**
         * Idempotency cache is an optimization; authoritative uniqueness
         * still belongs in persistent storage.
         */
        const cached =
            await this._getIdempotency(
                event.tenant_id,
                event.idempotency_key
            );

        if (
            cached
        ) {
            return {
                accepted:
                    true,

                replay:
                    true,

                idempotency_key:
                    event.idempotency_key,

                result:
                    cached,
            };
        }

        if (
            this._queueSize >=
            this.options
                .MAX_QUEUE_SIZE
        ) {
            this._stats.rejected +=
                1;

            this._metric(
                'titech.financial.queue_full_total'
            );

            throw new FinancialAnalyticsRepositoryError(
                'Financial analytics queue is full.',
                'FINANCIAL_ANALYTICS_QUEUE_FULL',
                {
                    statusCode:
                        503,
                }
            );
        }

        /**
         * Optional application-level encryption hook.
         *
         * The repository never logs encrypted/decrypted values.
         */
        if (
            this.encryption &&
            typeof this
                .encryption
                .encryptFinancialPayload ===
                'function'
        ) {
            event =
                {
                    ...event,

                    payload:
                        await this
                            .encryption
                            .encryptFinancialPayload(
                                event.payload
                            ),
                };
        }

        this._queue.push(
            event
        );

        this._queueSize +=
            1;

        this._stats.enqueued +=
            1;

        this._stats.accepted +=
            1;

        this._setQueueGauges();

        this._metric(
            'titech.financial.enqueued_total',
            1,
            {
                tenant:
                    safeTenantMetric(
                        event.tenant_id
                    ),

                event_type:
                    event.event_type,

                currency:
                    event.currency,
            }
        );

        this._startBatchTimer();

        if (
            options.immediate ||
            this._queueSize >=
                this.options
                    .BATCH_SIZE
        ) {
            void this._scheduleFlush();
        }

        return {
            accepted:
                true,

            replay:
                false,

            internal_id:
                event.internal_id,

            idempotency_key:
                event.idempotency_key,

            queued:
                this._queueSize,
        };
    }

    async bulkRecordFinancialEvents(
        events = [],
        options = {}
    ) {
        if (
            !Array.isArray(
                events
            )
        ) {
            throw new FinancialAnalyticsRepositoryError(
                'events must be an array.',
                'FINANCIAL_EVENTS_ARRAY_REQUIRED',
                {
                    statusCode:
                        400,
                }
            );
        }

        if (
            events.length >
            this.options
                .MAX_QUEUE_SIZE
        ) {
            throw new FinancialAnalyticsRepositoryError(
                'Financial analytics bulk request is too large.',
                'FINANCIAL_EVENTS_BULK_TOO_LARGE',
                {
                    statusCode:
                        413,
                }
            );
        }

        const result = {
            accepted:
                0,

            rejected:
                0,

            replayed:
                0,

            items:
                [],

            errors:
                [],
        };

        for (
            const event of
            events
        ) {
            try {
                const response =
                    await this.recordFinancialEvent(
                        event,
                        options
                    );

                result.accepted +=
                    1;

                if (
                    response.replay
                ) {
                    result.replayed +=
                        1;
                }

                result.items.push(
                    {
                        internal_id:
                            response
                                .internal_id,

                        idempotency_key:
                            response
                                .idempotency_key,

                        replay:
                            response
                                .replay,
                    }
                );
            } catch (
                error
            ) {
                result.rejected +=
                    1;

                result.errors.push(
                    {
                        code:
                            error.code ||
                            'FINANCIAL_EVENT_REJECTED',

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

        return result;
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
                        void this
                            ._scheduleFlush();
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
                            'Financial analytics scheduled flush failed',
                            {
                                error:
                                    error.message,
                            }
                        );
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

    async _flushBatch() {
        if (
            this._running
        ) {
            return {
                running:
                    true,
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
                    'empty',
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

        this._setQueueGauges();

        try {
            await this._writeBatchWithRetry(
                batch
            );

            const results =
                await this._markIdempotencyBatch(
                    batch
                );

            this._stats.flushed +=
                batch.length;

            this._metric(
                'titech.financial.flushed_total',
                batch.length
            );

            this.emit(
                'batchFlushed',
                {
                    count:
                        batch.length,

                    idempotency:
                        results,
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
                'titech.financial.flush_failed_total',
                1,
                {
                    batch_size:
                        String(
                            batch.length
                        ),
                }
            );

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

                if (
                    !isRetryableError(
                        error
                    ) ||
                    attempt >=
                        this.options
                            .WRITE_RETRY_ATTEMPTS -
                        1
                ) {
                    break;
                }

                this._stats.retried +=
                    1;

                const delay =
                    computeBackoff(
                        attempt,
                        this.options
                            .WRITE_RETRY_MIN_TIMEOUT,
                        this.options
                            .WRITE_RETRY_MAX_TIMEOUT
                    );

                this._metric(
                    'titech.financial.write_retry_total',
                    1,
                    {
                        attempt:
                            String(
                                attempt + 1
                            ),
                    }
                );

                this._logWarn(
                    'Financial analytics write failed; retrying',
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
            new FinancialAnalyticsRepositoryError(
                'Financial analytics batch write failed.'
            )
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

        throw new FinancialAnalyticsRepositoryError(
            'No financial analytics writer is configured.',
            'FINANCIAL_ANALYTICS_WRITER_NOT_CONFIGURED',
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

                    failedAt:
                        new Date()
                            .toISOString(),

                    error:
                        error.message,
                }
            );

            this._retryQueueSize +=
                batch.length;

            this._setQueueGauges();

            this._logWarn(
                'Financial analytics batch moved to retry queue',
                {
                    batchSize:
                        batch.length,

                    error:
                        error.message,
                }
            );

            return;
        }

        this._stats.dropped +=
            batch.length;

        this._metric(
            'titech.financial.dead_letter_total',
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
            'Financial analytics batch moved to dead-letter handling',
            {
                batchSize:
                    batch.length,

                error:
                    error.message,
            }
        );
    }

    async retryFailedBatches(
        {
            limit =
                this.options
                    .BATCH_SIZE,
        } = {}
    ) {
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

                await this._markIdempotencyBatch(
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

        this._setQueueGauges();

        return {
            processed,

            remaining:
                this._retryQueueSize,
        };
    }

    /**
     * ------------------------------------------------------------------------
     * Idempotency
     * ------------------------------------------------------------------------
     */

    async _getIdempotency(
        tenantId,
        key
    ) {
        if (
            !this.cacheClient ||
            typeof this.cacheClient.get !==
                'function'
        ) {
            return null;
        }

        const cacheKey =
            buildIdempotencyCacheKey(
                tenantId,
                key
            );

        try {
            const raw =
                await this.cacheClient.get(
                    cacheKey
                );

            if (
                !raw
            ) {
                return null;
            }

            if (
                typeof raw ===
                'string'
            ) {
                try {
                    return JSON.parse(
                        raw
                    );
                } catch {
                    return {
                        value:
                            raw,
                    };
                }
            }

            return raw;
        } catch (
            error
        ) {
            this._logWarn(
                'Financial idempotency cache read failed',
                {
                    error:
                        error.message,
                }
            );

            return null;
        }
    }

    async _setIdempotency(
        tenantId,
        key,
        value
    ) {
        if (
            !this.cacheClient ||
            typeof this.cacheClient.set !==
                'function'
        ) {
            return false;
        }

        const cacheKey =
            buildIdempotencyCacheKey(
                tenantId,
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
                        this.options
                            .IDEMPOTENCY_TTL,
                }
            );

            return true;
        } catch {
            try {
                await this.cacheClient.set(
                    cacheKey,
                    serialized,
                    'EX',
                    this.options
                        .IDEMPOTENCY_TTL
                );

                return true;
            } catch (
                error
            ) {
                this._logWarn(
                    'Financial idempotency cache write failed',
                    {
                        error:
                            error.message,
                    }
                );

                return false;
            }
        }
    }

    async _markIdempotencyBatch(
        batch
    ) {
        let marked =
            0;

        for (
            const event of
            batch
        ) {
            const success =
                await this._setIdempotency(
                    event.tenant_id,
                    event.idempotency_key,
                    {
                        internal_id:
                            event.internal_id,

                        transaction_id:
                            event.transaction_id,

                        event_type:
                            event.event_type,

                        amount_minor:
                            String(
                                event.amount_minor
                            ),

                        currency:
                            event.currency,

                        recorded_at:
                            new Date()
                                .toISOString(),
                    }
                );

            if (
                success
            ) {
                marked +=
                    1;
            }
        }

        return {
            requested:
                batch.length,

            marked,
        };
    }

    /**
     * ------------------------------------------------------------------------
     * Locking
     * ------------------------------------------------------------------------
     */

    async _acquireLock(
        key,
        options = {}
    ) {
        if (
            !this.lockClient ||
            typeof this.lockClient.acquire !==
                'function'
        ) {
            if (
                options.required
            ) {
                throw new FinancialAnalyticsRepositoryError(
                    'Distributed lock service is required but unavailable.',
                    'FINANCIAL_ANALYTICS_LOCK_UNAVAILABLE',
                    {
                        statusCode:
                            503,
                    }
                );
            }

            return null;
        }

        const lockKey =
            `titech:financial-analytics-lock:${key}`;

        for (
            let attempt = 0;
            attempt <
                this.options
                    .LOCK_ATTEMPTS;
            attempt +=
                1
        ) {
            try {
                const lock =
                    await this
                        .lockClient
                        .acquire(
                            lockKey,
                            options.ttl ||
                                this.options
                                    .LOCK_TTL
                        );

                if (
                    lock
                ) {
                    return lock;
                }
            } catch (
                error
            ) {
                this._logWarn(
                    'Financial analytics lock acquisition failed',
                    {
                        attempt:
                            attempt + 1,

                        error:
                            error.message,
                    }
                );
            }

            await sleep(
                computeBackoff(
                    attempt,
                    this.options
                        .LOCK_RETRY_DELAY,
                    2_000
                )
            );
        }

        if (
            options.required
        ) {
            throw new FinancialAnalyticsRepositoryError(
                'Unable to acquire financial analytics operation lock.',
                'FINANCIAL_ANALYTICS_LOCK_FAILED',
                {
                    statusCode:
                        409,
                }
            );
        }

        return null;
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
            this._logWarn(
                'Financial analytics lock release failed',
                {
                    error:
                        error.message,
                }
            );
        }
    }

    /**
     * ------------------------------------------------------------------------
     * SQL Writer
     * ------------------------------------------------------------------------
     */

    async _writeToSql(
        batch
    ) {
        const groups =
            groupEventsByTenant(
                batch
            );

        const mode =
            tenantConstants
                .getTenancyMode();

        for (
            const [
                tenantId,
                events,
            ] of Object.entries(
                groups
            )
        ) {
            const table =
                this._resolveSqlTable(
                    tenantId,
                    mode
                );

            const rows =
                events.map(
                    event =>
                        financialEventToSqlRow(
                            event
                        )
                );

            await this._insertSqlRows(
                table,
                rows
            );
        }
    }

    _resolveSqlTable(
        tenantId,
        mode
    ) {
        const safeTenantId =
            validateTenantIdStrict(
                tenantId
            );

        if (
            mode ===
                TENANCY_MODES.SCHEMA
        ) {
            const schema =
                tenantConstants
                    .schemaNameForTenant(
                        safeTenantId
                    );

            assertSafeSqlIdentifier(
                schema
            );

            return `${schema}.financial_events`;
        }

        if (
            mode ===
                TENANCY_MODES.DATABASE
        ) {
            /**
             * DATABASE mode requires a tenant-scoped database connection.
             *
             * A single shared Knex instance cannot safely be assumed to point
             * at the correct tenant database.
             */
            if (
                !this.options
                    .allowSharedDatabaseFallback
            ) {
                throw new FinancialAnalyticsRepositoryError(
                    'DATABASE tenancy requires a tenant-scoped Knex connection.',
                    'FINANCIAL_ANALYTICS_DATABASE_ROUTING_REQUIRED'
                );
            }
        }

        assertSafeSqlIdentifier(
            DEFAULTS.GLOBAL_TABLE
        );

        return DEFAULTS.GLOBAL_TABLE;
    }

    async _insertSqlRows(
        table,
        rows
    ) {
        if (
            typeof this.knex
                .batchInsert ===
            'function'
        ) {
            /**
             * Financial idempotency must be backed by a database-level unique
             * constraint. Recommended:
             *
             * UNIQUE(tenant_id, idempotency_key)
             * UNIQUE(internal_id)
             */
            const query =
                this.knex(
                    table
                )
                    .insert(
                        rows
                    );

            if (
                typeof query
                    .onConflict ===
                'function'
            ) {
                await query
                    .onConflict([
                        'tenant_id',
                        'idempotency_key',
                    ])
                    .ignore();

                return;
            }

            /**
             * Conservative fallback for database engines that do not expose
             * onConflict through the configured Knex dialect.
             */
            await this.knex
                .batchInsert(
                    table,
                    rows,
                    Math.min(
                        500,
                        rows.length
                    )
                );

            return;
        }

        const query =
            this.knex(
                table
            )
                .insert(
                    rows
                );

        if (
            typeof query
                .onConflict ===
            'function'
        ) {
            await query
                .onConflict([
                    'tenant_id',
                    'idempotency_key',
                ])
                .ignore();

            return;
        }

        await query;
    }

    /**
     * ------------------------------------------------------------------------
     * ClickHouse
     * ------------------------------------------------------------------------
     */

    async _writeToClickHouse(
        batch
    ) {
        if (
            !this.clickhouseClient
        ) {
            throw new FinancialAnalyticsRepositoryError(
                'ClickHouse client is not configured.',
                'FINANCIAL_ANALYTICS_CLICKHOUSE_NOT_CONFIGURED'
            );
        }

        const rows =
            batch.map(
                financialEventToClickHouseRow
            );

        if (
            typeof this
                .clickhouseClient
                .insert ===
            'function'
        ) {
            try {
                await this
                    .clickhouseClient
                    .insert(
                        DEFAULTS.GLOBAL_TABLE,
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
                                DEFAULTS.GLOBAL_TABLE,

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

        throw new FinancialAnalyticsRepositoryError(
            'Unsupported ClickHouse client interface.',
            'FINANCIAL_ANALYTICS_CLICKHOUSE_INTERFACE_UNSUPPORTED'
        );
    }

    /**
     * ------------------------------------------------------------------------
     * Query financial events
     * ------------------------------------------------------------------------
     */

    async queryFinancialEvents(
        filters = {},
        options = {}
    ) {
        if (
            !this.knex
        ) {
            throw new FinancialAnalyticsRepositoryError(
                'Knex is required for financial analytics queries.',
                'FINANCIAL_ANALYTICS_KNEX_REQUIRED'
            );
        }

        const tenantId =
            requireTenantScope(
                filters.tenantId,
                options
            );

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
            normalizeQueryOrder(
                options.order
            );

        const direction =
            normalizeQueryDirection(
                options.direction
            );

        const target =
            this._resolveQueryTarget(
                tenantId
            );

        const query =
            this.knex
                .select(
                    EVENT_COLUMNS
                )
                .from(
                    target
                );

        this._applyFinancialFilters(
            query,
            filters,
            tenantId,
            target.schemaScoped
        );

        const totalPromise =
            query
                .clone()
                .clearSelect()
                .clearOrder()
                .count({
                    count:
                        '*',
                })
                .first();

        const rowsPromise =
            query
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
                );

        const [
            totalRow,
            rows,
        ] =
            await Promise.all([
                totalPromise,
                rowsPromise,
            ]);

        const total =
            parseCount(
                totalRow?.count
            );

        this._stats.queries +=
            1;

        this._metric(
            'titech.financial.query_total',
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
                    normalizeStoredFinancialEvent
                ),
        };
    }

    _resolveQueryTarget(
        tenantId
    ) {
        const mode =
            tenantConstants
                .getTenancyMode();

        if (
            mode ===
                TENANCY_MODES.SCHEMA
        ) {
            const schema =
                tenantConstants
                    .schemaNameForTenant(
                        tenantId
                    );

            assertSafeSqlIdentifier(
                schema
            );

            return {
                value:
                    `${schema}.financial_events`,

                schemaScoped:
                    true,
            };
        }

        assertSafeSqlIdentifier(
            DEFAULTS.GLOBAL_TABLE
        );

        return {
            value:
                DEFAULTS.GLOBAL_TABLE,

            schemaScoped:
                false,
        };
    }

    _applyFinancialFilters(
        query,
        filters,
        tenantId,
        schemaScoped
    ) {
        if (
            !schemaScoped
        ) {
            query.where(
                'tenant_id',
                tenantId
            );
        }

        if (
            filters.transactionId
        ) {
            query.where(
                'transaction_id',
                normalizeRequiredString(
                    filters.transactionId,
                    255,
                    'transactionId'
                )
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
            filters.currency
        ) {
            query.where(
                'currency',
                normalizeCurrency(
                    filters.currency,
                    this.options
                        .SUPPORTED_CURRENCIES
                )
            );
        }

        if (
            filters.status
        ) {
            query.where(
                'status',
                normalizeStatus(
                    filters.status
                )
            );
        }

        if (
            filters.paymentMethod
        ) {
            query.where(
                'payment_method',
                normalizePaymentMethod(
                    filters.paymentMethod
                )
            );
        }

        if (
            filters.minAmountMinor !==
                undefined
        ) {
            query.where(
                'amount_minor',
                '>=',
                normalizeMinorUnits(
                    filters.minAmountMinor
                )
            );
        }

        if (
            filters.maxAmountMinor !==
                undefined
        ) {
            query.where(
                'amount_minor',
                '<=',
                normalizeMinorUnits(
                    filters.maxAmountMinor
                )
            );
        }

        if (
            filters.from
        ) {
            query.where(
                'created_at',
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
                'created_at',
                '<=',
                normalizeTimestamp(
                    filters.to
                )
            );
        }
    }

    /**
     * ------------------------------------------------------------------------
     * Transaction financial summary
     * ------------------------------------------------------------------------
     */

    async getTransactionFinancialSummary(
        tenantId,
        transactionId,
        options = {}
    ) {
        const safeTenant =
            validateTenantIdStrict(
                tenantId
            );

        const safeTransaction =
            normalizeRequiredString(
                transactionId,
                255,
                'transactionId'
            );

        const target =
            this._resolveQueryTarget(
                safeTenant
            );

        const query =
            this.knex
                .select(
                    [
                        'transaction_id',
                        'event_type',
                        'amount_minor',
                        'currency',
                        'status',
                        'created_at',
                    ]
                )
                .from(
                    target.value
                );

        if (
            !target.schemaScoped
        ) {
            query.where(
                'tenant_id',
                safeTenant
            );
        }

        query.where(
            'transaction_id',
            safeTransaction
        );

        if (
            options.lockForReconciliation &&
            this.knex
                .client
                .config
                ?.client
        ) {
            /**
             * Optional integration point. Read locking should normally be
             * performed within an external transaction.
             */
        }

        const rows =
            await query
                .orderBy(
                    'created_at',
                    'asc'
                );

        if (
            rows.length ===
            0
        ) {
            return {
                tenantId:
                    safeTenant,

                transactionId:
                    safeTransaction,

                eventCount:
                    0,

                currencies:
                    {},

                totals:
                    {},
            };
        }

        const currencies =
            {};

        for (
            const row of
            rows
        ) {
            const currency =
                normalizeCurrency(
                    row.currency,
                    this.options
                        .SUPPORTED_CURRENCIES
                );

            const current =
                currencies[
                    currency
                ] ||
                createCurrencyAccumulator();

            current.events +=
                1;

            applySignedEventToAccumulator(
                current,
                row
            );

            currencies[
                currency
            ] =
                current;
        }

        return {
            tenantId:
                safeTenant,

            transactionId:
                safeTransaction,

            eventCount:
                rows.length,

            currencies:
                formatCurrencyAccumulators(
                    currencies
                ),

            events:
                options.includeEvents
                    ? rows.map(
                        normalizeStoredFinancialEvent
                    )
                    : undefined,
        };
    }

    /**
     * ------------------------------------------------------------------------
     * Financial aggregation
     * ------------------------------------------------------------------------
     */

    async aggregateFinancials({
        type =
            'sum',

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
            throw new FinancialAnalyticsRepositoryError(
                'Knex is required for financial analytics aggregation.',
                'FINANCIAL_ANALYTICS_KNEX_REQUIRED'
            );
        }

        const tenantId =
            requireTenantScope(
                filters.tenantId,
                options
            );

        const safeGroupBy =
            normalizeFinancialGroupBy(
                groupBy
            );

        const cacheKey =
            await this._aggregateCacheKey(
                type,
                safeGroupBy,
                filters,
                tenantId
            );

        if (
            this.options
                .ENABLE_AGGREGATE_CACHE &&
            options.cache !==
                false
        ) {
            const cached =
                await this._cacheGet(
                    cacheKey
                );

            if (
                cached
            ) {
                return {
                    ...cached,

                    cached:
                        true,
                };
            }
        }

        const target =
            this._resolveQueryTarget(
                tenantId
            );

        const query =
            this.knex
                .queryBuilder()
                .from(
                    target.value
                );

        this._applyFinancialFilters(
            query,
            filters,
            tenantId,
            target.schemaScoped
        );

        const groups =
            safeGroupBy.map(
                group =>
                    financialGroupExpression(
                        this.knex,
                        group
                    )
            );

        let rows;

        switch (
            type
        ) {
            case 'count':
                rows =
                    await this._aggregateCount(
                        query,
                        groups
                    );
                break;

            case 'sum':
                rows =
                    await this._aggregateSum(
                        query,
                        groups
                    );
                break;

            case 'net':
                rows =
                    await this._aggregateNet(
                        query,
                        groups
                    );
                break;

            case 'volume':
                rows =
                    await this._aggregateVolume(
                        query,
                        groups
                    );
                break;

            default:
                throw new FinancialAnalyticsRepositoryError(
                    `Unsupported financial aggregate "${type}".`,
                    'FINANCIAL_ANALYTICS_AGGREGATE_UNSUPPORTED',
                    {
                        statusCode:
                            400,
                    }
                );
        }

        const result =
            {
                tenantId,

                type,

                groupBy:
                    safeGroupBy,

                rows,

                cached:
                    false,
            };

        if (
            this.options
                .ENABLE_AGGREGATE_CACHE &&
            options.cache !==
                false
        ) {
            await this._cacheSet(
                cacheKey,
                result,
                options.cacheTtl ||
                    this.options
                        .CACHE_TTL
            );
        }

        return result;
    }

    async _aggregateCount(
        query,
        groups
    ) {
        return query
            .select(
                groups.map(
                    group =>
                        group.select
                )
            )
            .count({
                count:
                    '*',
            })
            .groupBy(
                groups.map(
                    group =>
                        group.group
                )
            );
    }

    async _aggregateSum(
        query,
        groups
    ) {
        const rows =
            await query
                .select(
                    [
                        ...groups.map(
                            group =>
                                group.select
                        ),

                        this.knex.raw(
                            'currency'
                        ),

                        this.knex.raw(
                            'SUM(amount_minor)::bigint AS amount_minor'
                        ),
                    ]
                )
                .groupBy(
                    [
                        ...groups.map(
                            group =>
                                group.group
                        ),

                        'currency',
                    ]
                );

        return rows.map(
            row => ({
                ...row,

                amount_minor:
                    String(
                        row.amount_minor ||
                            0
                    ),

                amount:
                    fromMinorUnits(
                        row.amount_minor,
                        row.currency
                    ),
            })
        );
    }

    async _aggregateNet(
        query,
        groups
    ) {
        const rows =
            await query
                .select(
                    [
                        ...groups.map(
                            group =>
                                group.select
                        ),

                        this.knex.raw(
                            'currency'
                        ),

                        this.knex.raw(
                            `
                            SUM(
                                CASE
                                    WHEN event_type = 'payment'
                                    THEN amount_minor
                                    WHEN event_type = 'settlement'
                                    THEN amount_minor
                                    WHEN event_type = 'refund'
                                    THEN -amount_minor
                                    WHEN event_type = 'chargeback'
                                    THEN -amount_minor
                                    WHEN event_type = 'fee'
                                    THEN -amount_minor
                                    WHEN event_type = 'adjustment'
                                    THEN amount_minor
                                    ELSE 0
                                END
                            )::bigint AS net_minor
                            `
                        ),

                        this.knex.raw(
                            `
                            SUM(
                                CASE
                                    WHEN event_type = 'payment'
                                    THEN amount_minor
                                    WHEN event_type = 'settlement'
                                    THEN amount_minor
                                    ELSE 0
                                END
                            )::bigint AS positive_minor
                            `
                        ),

                        this.knex.raw(
                            `
                            SUM(
                                CASE
                                    WHEN event_type IN (
                                        'refund',
                                        'chargeback',
                                        'fee'
                                    )
                                    THEN amount_minor
                                    ELSE 0
                                END
                            )::bigint AS negative_minor
                            `
                        ),
                    ]
                )
                .groupBy(
                    [
                        ...groups.map(
                            group =>
                                group.group
                        ),

                        'currency',
                    ]
                );

        return rows.map(
            row => ({
                ...row,

                net_minor:
                    String(
                        row.net_minor ||
                            0
                    ),

                positive_minor:
                    String(
                        row.positive_minor ||
                            0
                    ),

                negative_minor:
                    String(
                        row.negative_minor ||
                            0
                    ),

                net:
                    fromMinorUnits(
                        row.net_minor,
                        row.currency
                    ),

                positive:
                    fromMinorUnits(
                        row.positive_minor,
                        row.currency
                    ),

                negative:
                    fromMinorUnits(
                        row.negative_minor,
                        row.currency
                    ),
            })
        );
    }

    async _aggregateVolume(
        query,
        groups
    ) {
        const rows =
            await query
                .select(
                    [
                        ...groups.map(
                            group =>
                                group.select
                        ),

                        'currency',

                        this.knex.raw(
                            'COUNT(*)::bigint AS transaction_count'
                        ),

                        this.knex.raw(
                            'SUM(amount_minor)::bigint AS amount_minor',
                        ),
                    ]
                )
                .groupBy(
                    [
                        ...groups.map(
                            group =>
                                group.group
                        ),

                        'currency',
                    ]
                );

        return rows.map(
            row => ({
                ...row,

                transaction_count:
                    String(
                        row.transaction_count ||
                            0
                    ),

                amount_minor:
                    String(
                        row.amount_minor ||
                            0
                    ),

                amount:
                    fromMinorUnits(
                        row.amount_minor,
                        row.currency
                    ),
            })
        );
    }

    /**
     * ------------------------------------------------------------------------
     * Reconciliation
     * ------------------------------------------------------------------------
     */

    async reconcileSettlements(
        settlementReport = [],
        options = {}
    ) {
        if (
            !this.knex
        ) {
            throw new FinancialAnalyticsRepositoryError(
                'Knex is required for settlement reconciliation.',
                'FINANCIAL_ANALYTICS_KNEX_REQUIRED'
            );
        }

        if (
            !Array.isArray(
                settlementReport
            )
        ) {
            throw new FinancialAnalyticsRepositoryError(
                'settlementReport must be an array.',
                'SETTLEMENT_REPORT_ARRAY_REQUIRED',
                {
                    statusCode:
                        400,
                }
            );
        }

        const tenantId =
            requireTenantScope(
                options.tenantId,
                {
                    ...options,

                    requireTenant:
                        true,
                }
            );

        const report =
            settlementReport.map(
                normalizeSettlementReportItem
            );

        if (
            report.length >
            this.options
                .MAX_RECONCILIATION_IDS
        ) {
            throw new FinancialAnalyticsRepositoryError(
                'Settlement report exceeds the reconciliation limit.',
                'SETTLEMENT_REPORT_TOO_LARGE',
                {
                    statusCode:
                        413,
                }
            );
        }

        const transactionIds =
            Array.from(
                new Set(
                    report.map(
                        item =>
                            item.transaction_id
                    )
                )
            );

        if (
            transactionIds.length ===
            0
        ) {
            return {
                tenantId,

                matched:
                    [],

                missing:
                    [],

                mismatched:
                    [],

                duplicates:
                    [],

                totals:
                    createReconciliationTotals(),
            };
        }

        const lock =
            await this._acquireLock(
                `reconcile:${tenantId}`,
                {
                    required:
                        options.requireLock ===
                        true,

                    ttl:
                        options.lockTtl,
                }
            );

        try {
            const target =
                this._resolveQueryTarget(
                    tenantId
                );

            const internalRows =
                await this._querySettlementRows(
                    target,
                    tenantId,
                    transactionIds,
                    options
                );

            const internalMap =
                buildSettlementMap(
                    internalRows,
                    options
                        .eventTypes ||
                    [
                        'settlement',
                    ]
                );

            const matched =
                [];

            const missing =
                [];

            const mismatched =
                [];

            const duplicates =
                findDuplicateTransactionIds(
                    report
                );

            for (
                const expected of
                report
            ) {
                const actual =
                    internalMap.get(
                        expected.transaction_id
                    );

                if (
                    !actual
                ) {
                    missing.push(
                        {
                            transaction_id:
                                expected
                                    .transaction_id,

                            report:
                                expected,
                        }
                    );

                    continue;
                }

                const currencyMatches =
                    actual.currency ===
                    expected.currency;

                const amountMatches =
                    String(
                        actual.amount_minor
                    ) ===
                    String(
                        expected.amount_minor
                    );

                const statusMatches =
                    !expected.status ||
                    actual.status ===
                        expected.status;

                if (
                    currencyMatches &&
                    amountMatches &&
                    statusMatches
                ) {
                    matched.push(
                        {
                            transaction_id:
                                expected
                                    .transaction_id,

                            report:
                                expected,

                            stored:
                                actual,
                        }
                    );
                } else {
                    mismatched.push(
                        {
                            transaction_id:
                                expected
                                    .transaction_id,

                            report:
                                expected,

                            stored:
                                actual,

                            differences:
                                {
                                    currency:
                                        !currencyMatches,

                                    amount:
                                        !amountMatches,

                                    status:
                                        !statusMatches,
                                },
                        }
                    );
                }
            }

            this._stats.reconciliations +=
                1;

            const totals =
                createReconciliationTotals();

            totals.expected =
                report.length;

            totals.matched =
                matched.length;

            totals.missing =
                missing.length;

            totals.mismatched =
                mismatched.length;

            totals.duplicates =
                duplicates.length;

            totals.varianceMinor =
                calculateReconciliationVariance(
                    report,
                    internalMap
                );

            return {
                tenantId,

                matched,

                missing,

                mismatched,

                duplicates,

                totals,
            };
        } finally {
            await this._releaseLock(
                lock
            );
        }
    }

    async _querySettlementRows(
        target,
        tenantId,
        transactionIds,
        options
    ) {
        const chunks =
            chunkArray(
                transactionIds,
                1_000
            );

        const rows =
            [];

        for (
            const chunk of
            chunks
        ) {
            const query =
                this.knex
                    .select(
                        [
                            'transaction_id',
                            'event_type',
                            'amount_minor',
                            'currency',
                            'status',
                            'created_at',
                            'idempotency_key',
                        ]
                    )
                    .from(
                        target.value
                    );

            if (
                !target.schemaScoped
            ) {
                query.where(
                    'tenant_id',
                    tenantId
                );
            }

            query.whereIn(
                'transaction_id',
                chunk
            );

            if (
                options.from
            ) {
                query.where(
                    'created_at',
                    '>=',
                    normalizeTimestamp(
                        options.from
                    )
                );
            }

            if (
                options.to
            ) {
                query.where(
                    'created_at',
                    '<=',
                    normalizeTimestamp(
                        options.to
                    )
                );
            }

            rows.push(
                ...(
                    await query
                )
            );
        }

        return rows;
    }

    /**
     * ------------------------------------------------------------------------
     * Refund / chargeback / dispute helpers
     * ------------------------------------------------------------------------
     */

    async getChargebacks(
        tenantId,
        options = {}
    ) {
        return this.queryFinancialEvents(
            {
                tenantId,

                eventType:
                    'chargeback',

                from:
                    options.from,

                to:
                    options.to,

                currency:
                    options.currency,

                userId:
                    options.userId,
            },
            options
        );
    }

    async getRefunds(
        tenantId,
        options = {}
    ) {
        return this.queryFinancialEvents(
            {
                tenantId,

                eventType:
                    'refund',

                from:
                    options.from,

                to:
                    options.to,

                currency:
                    options.currency,

                userId:
                    options.userId,
            },
            options
        );
    }

    async getDisputeSummary(
        tenantId,
        options = {}
    ) {
        return this.aggregateFinancials({
            type:
                'sum',

            groupBy:
                [
                    'event_type',
                    'date',
                ],

            filters:
                {
                    tenantId,

                    from:
                        options.from,

                    to:
                        options.to,
                },

            options,
        });
    }

    /**
     * ------------------------------------------------------------------------
     * Export
     * ------------------------------------------------------------------------
     */

    async exportFinancialEvents(
        options = {}
    ) {
        if (
            !this.knex
        ) {
            throw new FinancialAnalyticsRepositoryError(
                'Knex is required for financial analytics export.',
                'FINANCIAL_ANALYTICS_KNEX_REQUIRED'
            );
        }

        const tenantId =
            requireTenantScope(
                options.tenantId,
                {
                    ...options,

                    requireTenant:
                        true,
                }
            );

        const stream =
            options.stream;

        if (
            !stream ||
            typeof stream.write !==
                'function'
        ) {
            throw new FinancialAnalyticsRepositoryError(
                'A writable stream is required.',
                'FINANCIAL_ANALYTICS_EXPORT_STREAM_REQUIRED',
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
            )
                .trim()
                .toLowerCase();

        if (
            ![
                'jsonl',
                'csv',
            ].includes(
                format
            )
        ) {
            throw new FinancialAnalyticsRepositoryError(
                'Unsupported financial export format.',
                'FINANCIAL_ANALYTICS_EXPORT_FORMAT_UNSUPPORTED',
                {
                    statusCode:
                        400,
                }
            );
        }

        const target =
            this._resolveQueryTarget(
                tenantId
            );

        const query =
            this.knex
                .select(
                    EVENT_COLUMNS
                )
                .from(
                    target.value
                );

        this._applyFinancialFilters(
            query,
            {
                tenantId,

                from:
                    options.from,

                to:
                    options.to,

                eventType:
                    options.eventType,

                currency:
                    options.currency,

                status:
                    options.status,

                paymentMethod:
                    options.paymentMethod,
            },
            tenantId,
            target.schemaScoped
        );

        query
            .orderBy(
                'created_at',
                'asc'
            )
            .limit(
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
                )
            );

        return new Promise(
            (
                resolve,
                reject
            ) => {
                let count =
                    0;

                const rowStream =
                    query.stream();

                if (
                    format ===
                    'csv'
                ) {
                    stream.write(
                        `${FINANCIAL_CSV_HEADERS.join(
                            ','
                        )}\n`
                    );
                }

                rowStream.on(
                    'data',
                    row => {
                        try {
                            const normalized =
                                normalizeStoredFinancialEvent(
                                    row
                                );

                            if (
                                format ===
                                'jsonl'
                            ) {
                                stream.write(
                                    `${JSON.stringify(
                                        normalized
                                    )}\n`
                                );
                            } else {
                                stream.write(
                                    `${serializeFinancialCsvRow(
                                        normalized
                                    )}\n`
                                );
                            }

                            count +=
                                1;
                        } catch (
                            error
                        ) {
                            rowStream.destroy(
                                error
                            );
                        }
                    }
                );

                rowStream.on(
                    'end',
                    () => {
                        stream.end(
                            () =>
                                resolve(
                                    {
                                        exported:
                                            count,

                                        format,
                                    }
                                )
                        );
                    }
                );

                rowStream.on(
                    'error',
                    error => {
                        stream.destroy?.(
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
     * Streaming
     * ------------------------------------------------------------------------
     */

    async publishFinancialEvent(
        topic,
        event,
        options = {}
    ) {
        if (
            !this.streamProducer ||
            typeof this.streamProducer.produce !==
                'function'
        ) {
            throw new FinancialAnalyticsRepositoryError(
                'Financial analytics stream producer is not configured.',
                'FINANCIAL_ANALYTICS_STREAM_NOT_CONFIGURED'
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

        /**
         * Support common producer signatures:
         *
         *   produce(topic, payload)
         *   produce({ topic, key, value })
         */
        if (
            options.producerStyle ===
            'object'
        ) {
            await this.streamProducer.produce(
                {
                    topic:
                        topicName,

                    key:
                        validated
                            .transaction_id,

                    value:
                        payload,
                }
            );
        } else {
            await this.streamProducer.produce(
                topicName,
                payload
            );
        }

        this._stats.published +=
            1;

        this._metric(
            'titech.financial.published_total',
            1,
            {
                tenant:
                    safeTenantMetric(
                        validated
                            .tenant_id
                    ),

                event_type:
                    validated
                        .event_type,

                currency:
                    validated
                        .currency,
            }
        );

        return {
            published:
                true,

            internal_id:
                validated
                    .internal_id,

            topic:
                topicName,
        };
    }

    /**
     * ------------------------------------------------------------------------
     * Retention
     * ------------------------------------------------------------------------
     */

    async purgeOldFinancialEvents(
        options = {}
    ) {
        if (
            !this.knex
        ) {
            throw new FinancialAnalyticsRepositoryError(
                'Knex is required for financial analytics retention.',
                'FINANCIAL_ANALYTICS_KNEX_REQUIRED'
            );
        }

        const days =
            parsePositiveInteger(
                options.olderThanDays,
                this.options
                    .RETENTION_DAYS,
                1,
                3_650
            );

        const cutoff =
            new Date(
                Date.now() -
                    days *
                        24 *
                        60 *
                        60 *
                        1000
            );

        const tenantId =
            options.tenantId
                ? validateTenantIdStrict(
                    options.tenantId
                )
                : null;

        if (
            !tenantId &&
            !options.systemScope
        ) {
            throw new FinancialAnalyticsRepositoryError(
                'systemScope is required for cross-tenant financial analytics retention.',
                'FINANCIAL_ANALYTICS_SYSTEM_SCOPE_REQUIRED',
                {
                    statusCode:
                        403,
                }
            );
        }

        const mode =
            tenantConstants
                .getTenancyMode();

        const tenants =
            await this._resolveRetentionTenants(
                tenantId,
                mode,
                options
            );

        let totalDeleted =
            0;

        for (
            const currentTenant of
            tenants
        ) {
            const target =
                this._resolveSqlTable(
                    currentTenant,
                    mode
                );

            if (
                options.dryRun
            ) {
                const row =
                    await this.knex(
                        target
                    )
                        .where(
                            'created_at',
                            '<',
                            cutoff
                        )
                        .count({
                            count:
                                '*',
                        })
                        .first();

                const count =
                    parseCount(
                        row?.count
                    );

                totalDeleted +=
                    count;

                this._logInfo(
                    'Financial analytics retention dry-run',
                    {
                        tenant:
                            currentTenant,

                        count,

                        cutoff:
                            cutoff.toISOString(),
                    }
                );

                continue;
            }

            const deleted =
                await this._deleteInBatches(
                    target,
                    cutoff,
                    options.batchSize ||
                        5_000
                );

            totalDeleted +=
                deleted;
        }

        this._metric(
            'titech.financial.retention_deleted_total',
            totalDeleted
        );

        return {
            deleted:
                totalDeleted,

            cutoff:
                cutoff.toISOString(),

            dryRun:
                Boolean(
                    options.dryRun
                ),
        };
    }

    async _resolveRetentionTenants(
        tenantId,
        mode,
        options
    ) {
        if (
            tenantId
        ) {
            return [
                tenantId,
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

        const registry =
            `${this.options
                .TABLE_PREFIX}tenants`;

        const rows =
            await this.knex(
                registry
            )
                .select(
                    'tenant_id'
                )
                .whereNull(
                    'deleted_at'
                );

        return rows.map(
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
        let total =
            0;

        while (
            true
        ) {
            const ids =
                await this.knex(
                    table
                )
                    .select(
                        'internal_id'
                    )
                    .where(
                        'created_at',
                        '<',
                        cutoff
                    )
                    .orderBy(
                        'created_at',
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

            const internalIds =
                ids.map(
                    item =>
                        item.internal_id
                );

            const deleted =
                await this.knex(
                    table
                )
                    .whereIn(
                        'internal_id',
                        internalIds
                    )
                    .del();

            total +=
                Number(
                    deleted
                );
        }

        return total;
    }

    /**
     * ------------------------------------------------------------------------
     * Cache
     * ------------------------------------------------------------------------
     */

    async _aggregateCacheKey(
        type,
        groupBy,
        filters,
        tenantId
    ) {
        const normalized =
            {
                tenantId,

                type,

                groupBy:
                    [...groupBy].sort(),

                filters:
                    sanitizeCacheObject(
                        filters
                    ),
            };

        const hash =
            crypto
                .createHash(
                    'sha256'
                )
                .update(
                    JSON.stringify(
                        normalized
                    )
                )
                .digest(
                    'hex'
                );

        return `${this.options.CACHE_PREFIX}aggregate:${tenantId}:${hash}`;
    }

    async _cacheGet(
        key
    ) {
        if (
            !this.cacheClient ||
            typeof this.cacheClient.get !==
                'function'
        ) {
            return null;
        }

        try {
            const raw =
                await this.cacheClient.get(
                    key
                );

            if (
                !raw
            ) {
                return null;
            }

            if (
                typeof raw ===
                'string'
            ) {
                return JSON.parse(
                    raw
                );
            }

            return raw;
        } catch (
            error
        ) {
            this._logWarn(
                'Financial analytics cache read failed',
                {
                    error:
                        error.message,
                }
            );

            return null;
        }
    }

    async _cacheSet(
        key,
        value,
        ttl
    ) {
        if (
            !this.cacheClient ||
            typeof this.cacheClient.set !==
                'function'
        ) {
            return false;
        }

        const serialized =
            JSON.stringify(
                value
            );

        try {
            await this.cacheClient.set(
                key,
                serialized,
                {
                    EX:
                        ttl,
                }
            );

            return true;
        } catch {
            try {
                await this.cacheClient.set(
                    key,
                    serialized,
                    'EX',
                    ttl
                );

                return true;
            } catch (
                error
            ) {
                this._logWarn(
                    'Financial analytics cache write failed',
                    {
                        error:
                            error.message,
                    }
                );

                return false;
            }
        }
    }

    async invalidateTenantAggregateCache(
        tenantId
    ) {
        /**
         * Deliberately conservative.
         *
         * If Redis SCAN is not available, TTL handles eventual invalidation.
         * Services performing strict real-time dashboards should supply a
         * versioned cache namespace.
         */
        if (
            !this.cacheClient
        ) {
            return false;
        }

        return false;
    }

    /**
     * ------------------------------------------------------------------------
     * Health
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
                await this.knex.raw(
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
                healthy =
                    false;

                details.cache =
                    {
                        status:
                            'error',

                        message:
                            error.message,
                    };
            }
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
            'Financial analytics shutdown initiated',
            {
                queueSize:
                    this._queueSize,

                retryQueueSize:
                    this._retryQueueSize,
            }
        );

        while (
            Date.now() -
                started <
                timeoutMs &&
            (
                this._queueSize >
                    0 ||
                (
                    retryFailed &&
                    this._retryQueueSize >
                        0
                )
            )
        ) {
            if (
                this._queueSize >
                0
            ) {
                await this
                    ._scheduleFlush();
            }

            if (
                retryFailed &&
                this._retryQueueSize >
                0
            ) {
                await this
                    .retryFailedBatches();
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
            pending >
            0
        ) {
            this._logWarn(
                'Financial analytics shutdown completed with pending events',
                {
                    pending,
                }
            );

            if (
                failOnPending
            ) {
                throw new FinancialAnalyticsRepositoryError(
                    'Financial analytics shutdown timed out with pending events.',
                    'FINANCIAL_ANALYTICS_SHUTDOWN_PENDING',
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
        }

        return {
            complete:
                pending ===
                0,

            pending,
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

                    supportedCurrencies:
                        [
                            ...this.options
                                .SUPPORTED_CURRENCIES,
                        ],
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
            this.metrics
                ?.increment?.(
                    name,
                    value,
                    sanitizeMetricLabels(
                        labels
                    )
                );
        } catch {
            // Metrics never break financial analytics processing.
        }
    }

    _setQueueGauges() {
        try {
            this.metrics
                ?.gauge?.(
                    'titech.financial.queue_size',
                    this._queueSize
                );

            this.metrics
                ?.gauge?.(
                    'titech.financial.retry_queue_size',
                    this._retryQueueSize
                );
        } catch {
            // Metrics never break financial analytics processing.
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
            // Logging failure must never alter financial processing.
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
            // Logging failure must never alter financial processing.
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
            // Logging failure must never alter financial processing.
        }
    }
}

/**
 * ============================================================================
 * Money Helpers
 * ============================================================================
 */

/**
 * Convert a decimal amount to currency minor units.
 *
 * Example:
 *
 *   toMinorUnits('1250.50', 'USD') -> 125050
 *   toMinorUnits('1250', 'UGX')     -> 1250
 *
 * Strict precision is enabled by default. Therefore:
 *
 *   toMinorUnits('10.999', 'UGX')
 *
 * is rejected rather than silently rounded.
 */
function toMinorUnits(
    amount,
    currency = DEFAULT_CURRENCY,
    {
        strictPrecision =
            DEFAULTS
                .STRICT_AMOUNT_PRECISION,
    } = {}
) {
    const cur =
        normalizeCurrency(
            currency,
            DEFAULT_SUPPORTED_CURRENCIES
        );

    const decimals =
        getCurrencyDecimals(
            cur
        );

    if (
        amount ===
            undefined ||
        amount ===
            null ||
        String(
            amount
        ).trim() ===
            ''
    ) {
        throw new FinancialAnalyticsRepositoryError(
            'Monetary amount is required.',
            'FINANCIAL_AMOUNT_REQUIRED',
            {
                statusCode:
                    400,
            }
        );
    }

    let decimal;

    try {
        decimal =
            new Big(
                String(
                    amount
                )
            );
    } catch (
        error
    ) {
        throw new FinancialAnalyticsRepositoryError(
            'Invalid monetary amount.',
            'FINANCIAL_AMOUNT_INVALID',
            {
                statusCode:
                    400,

                cause:
                    error,
            }
        );
    }

    if (
        !decimal
            .finite()
    ) {
        throw new FinancialAnalyticsRepositoryError(
            'Monetary amount must be finite.',
            'FINANCIAL_AMOUNT_NOT_FINITE',
            {
                statusCode:
                    400,
            }
        );
    }

    if (
        decimal.lt(
            0
        )
    ) {
        throw new FinancialAnalyticsRepositoryError(
            'Monetary amount cannot be negative in this conversion helper.',
            'FINANCIAL_AMOUNT_NEGATIVE',
            {
                statusCode:
                    400,
            }
        );
    }

    const factor =
        new Big(
            10
        ).pow(
            decimals
        );

    const scaled =
        decimal.times(
            factor
        );

    const truncated =
        scaled.round(
            0,
            0
        );

    const difference =
        scaled.minus(
            truncated
        );

    if (
        strictPrecision &&
        !difference.eq(
            0
        )
    ) {
        throw new FinancialAnalyticsRepositoryError(
            `Amount has more than ${decimals} decimal places for ${cur}.`,
            'FINANCIAL_AMOUNT_PRECISION_EXCEEDED',
            {
                statusCode:
                    400,
            }
        );
    }

    /**
     * When strict precision is disabled, use half-up rounding.
     */
    const result =
        strictPrecision
            ? truncated
            : scaled.round(
                0,
                1
            );

    const value =
        result.toString();

    const number =
        Number(
            value
        );

    if (
        !Number.isSafeInteger(
            number
        )
    ) {
        throw new FinancialAnalyticsRepositoryError(
            'Minor-unit amount exceeds JavaScript safe integer range.',
            'FINANCIAL_AMOUNT_OUT_OF_RANGE',
            {
                statusCode:
                    400,
            }
        );
    }

    return number;
}

function fromMinorUnits(
    minor,
    currency = DEFAULT_CURRENCY
) {
    const cur =
        normalizeCurrency(
            currency,
            DEFAULT_SUPPORTED_CURRENCIES
        );

    const decimals =
        getCurrencyDecimals(
            cur
        );

    const value =
        normalizeMinorUnits(
            minor
        );

    const factor =
        new Big(
            10
        ).pow(
            decimals
        );

    return new Big(
        String(
            value
        )
    )
        .div(
            factor
        )
        .toFixed(
            decimals
        );
}

/**
 * ============================================================================
 * Financial Semantics
 * ============================================================================
 */

function applySignedEventToAccumulator(
    accumulator,
    row
) {
    const amount =
        Big(
            String(
                row.amount_minor ||
                    0
            )
        );

    switch (
        row.event_type
    ) {
        case 'payment':
        case 'settlement':
            accumulator.inflow =
                accumulator.inflow.plus(
                    amount
                );
            break;

        case 'refund':
        case 'chargeback':
        case 'fee':
            accumulator.outflow =
                accumulator.outflow.plus(
                    amount
                );
            break;

        case 'adjustment':
            accumulator.net =
                accumulator.net.plus(
                    amount
                );
            break;

        default:
            break;
    }

    accumulator.net =
        accumulator.inflow
            .minus(
                accumulator.outflow
            )
            .plus(
                accumulator.net
            );

    return accumulator;
}

function createCurrencyAccumulator() {
    return {
        events:
            0,

        inflow:
            new Big(
                0
            ),

        outflow:
            new Big(
                0
            ),

        net:
            new Big(
                0
            ),
    };
}

function formatCurrencyAccumulators(
    values
) {
    const result =
        {};

    for (
        const [
            currency,
            accumulator,
        ] of Object.entries(
            values
        )
    ) {
        result[
            currency
        ] =
            {
                events:
                    accumulator
                        .events,

                inflow_minor:
                    accumulator
                        .inflow
                        .toString(),

                outflow_minor:
                    accumulator
                        .outflow
                        .toString(),

                net_minor:
                    accumulator
                        .net
                        .toString(),

                inflow:
                    fromMinorUnits(
                        accumulator
                            .inflow
                            .toString(),
                        currency
                    ),

                outflow:
                    fromMinorUnits(
                        accumulator
                            .outflow
                            .toString(),
                        currency
                    ),

                net:
                    fromMinorUnits(
                        accumulator
                            .net
                            .toString(),
                        currency
                    ),
            };
    }

    return result;
}

/**
 * ============================================================================
 * Reconciliation Helpers
 * ============================================================================
 */

function normalizeSettlementReportItem(
    item
) {
    if (
        !isPlainObject(
            item
        )
    ) {
        throw new FinancialAnalyticsRepositoryError(
            'Settlement report item must be an object.',
            'SETTLEMENT_REPORT_ITEM_INVALID',
            {
                statusCode:
                    400,
            }
        );
    }

    return {
        transaction_id:
            normalizeRequiredString(
                item.transaction_id,
                255,
                'transaction_id'
            ),

        amount_minor:
            normalizeMinorUnits(
                item.amount_minor !==
                    undefined
                    ? item.amount_minor
                    : toMinorUnits(
                        item.amount,
                        item.currency,
                        {
                            strictPrecision:
                                true,
                        }
                    )
            ),

        currency:
            normalizeCurrency(
                item.currency,
                DEFAULT_SUPPORTED_CURRENCIES
            ),

        status:
            item.status
                ? normalizeStatus(
                    item.status
                )
                : null,

        external_reference:
            normalizeNullableString(
                item.external_reference,
                255
            ),
    };
}

function buildSettlementMap(
    rows,
    eventTypes
) {
    const allowed =
        new Set(
            eventTypes.map(
                normalizeEventType
            )
        );

    const map =
        new Map();

    for (
        const row of
        rows
    ) {
        if (
            !allowed.has(
                row.event_type
            )
        ) {
            continue;
        }

        const transactionId =
            row.transaction_id;

        const existing =
            map.get(
                transactionId
            );

        if (
            !existing
        ) {
            map.set(
                transactionId,
                {
                    transaction_id:
                        transactionId,

                    amount_minor:
                        String(
                            row.amount_minor ||
                                0
                        ),

                    currency:
                        String(
                            row.currency
                        )
                            .toUpperCase(),

                    status:
                        row.status ||
                        null,

                    event_count:
                        1,
                }
            );

            continue;
        }

        /**
         * If multiple settlement events exist for the same transaction, sum
         * them rather than silently overwriting one with another.
         */
        const currency =
            String(
                row.currency
            )
                .toUpperCase();

        if (
            existing.currency !==
            currency
        ) {
            existing.currency =
                'MIXED';
        }

        existing.amount_minor =
            Big(
                existing.amount_minor
            )
                .plus(
                    String(
                        row.amount_minor ||
                            0
                    )
                )
                .toString();

        existing.event_count +=
            1;

        existing.status =
            row.status ||
            existing.status;
    }

    return map;
}

function findDuplicateTransactionIds(
    report
) {
    const counts =
        new Map();

    for (
        const item of
        report
    ) {
        counts.set(
            item.transaction_id,
            (
                counts.get(
                    item.transaction_id
                ) ||
                0
            ) + 1
        );
    }

    return Array.from(
        counts.entries()
    )
        .filter(
            (
                [
                    ,
                    count,
                ]
            ) =>
                count >
                1
        )
        .map(
            (
                [
                    transaction_id,
                    count,
                ]
            ) => ({
                transaction_id,

                count,
            })
        );
}

function createReconciliationTotals() {
    return {
        expected:
            0,

        matched:
            0,

        missing:
            0,

        mismatched:
            0,

        duplicates:
            0,

        varianceMinor:
            {},
    };
}

function calculateReconciliationVariance(
    report,
    internalMap
) {
    const variance =
        {};

    for (
        const item of
        report
    ) {
        const actual =
            internalMap.get(
                item.transaction_id
            );

        if (
            !actual
        ) {
            continue;
        }

        const currency =
            item.currency;

        const difference =
            Big(
                String(
                    actual.amount_minor
                )
            )
                .minus(
                    String(
                        item.amount_minor
                    )
                );

        variance[
            currency
        ] =
            Big(
                variance[
                    currency
                ] ||
                    0
            )
                .plus(
                    difference
                )
                .toString();
    }

    return variance;
}

/**
 * ============================================================================
 * Aggregation Helpers
 * ============================================================================
 */

function normalizeFinancialGroupBy(
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

    const allowed =
        new Set([
            'event_type',
            'currency',
            'user_id',
            'payment_method',
            'status',
            'date',
            'hour',
            'tenant_id',
        ]);

    const result =
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

    for (
        const field of
        result
    ) {
        if (
            !allowed.has(
                field
            )
        ) {
            throw new FinancialAnalyticsRepositoryError(
                `Unsupported financial groupBy field "${field}".`,
                'FINANCIAL_ANALYTICS_GROUP_BY_UNSUPPORTED',
                {
                    statusCode:
                        400,
                }
            );
        }
    }

    return result;
}

function financialGroupExpression(
    knex,
    field
) {
    switch (
        field
    ) {
        case 'event_type':
        case 'currency':
        case 'user_id':
        case 'payment_method':
        case 'status':
        case 'tenant_id':
            return {
                select:
                    knex.raw(
                        field
                    ),

                group:
                    field,
            };

        case 'date':
            return {
                select:
                    knex.raw(
                        `
                        DATE_TRUNC(
                            'day',
                            created_at
                        ) AS date
                        `
                    ),

                group:
                    knex.raw(
                        `
                        DATE_TRUNC(
                            'day',
                            created_at
                        )
                        `
                    ),
            };

        case 'hour':
            return {
                select:
                    knex.raw(
                        `
                        DATE_TRUNC(
                            'hour',
                            created_at
                        ) AS hour
                        `
                    ),

                group:
                    knex.raw(
                        `
                        DATE_TRUNC(
                            'hour',
                            created_at
                        )
                        `
                    ),
            };

        default:
            throw new FinancialAnalyticsRepositoryError(
                `Unsupported financial group field "${field}".`,
                'FINANCIAL_ANALYTICS_GROUP_BY_UNSUPPORTED'
            );
    }
}

/**
 * ============================================================================
 * Tenant / Currency / Event Validation
 * ============================================================================
 */

function validateTenantIdStrict(
    value
) {
    const tenantId =
        String(
            value ??
                ''
        )
            .trim()
            .toLowerCase();

    if (
        !tenantId ||
        !tenantConstants.isValidTenantId(
            tenantId
        )
    ) {
        throw new FinancialAnalyticsRepositoryError(
            'Invalid tenant identifier.',
            'FINANCIAL_ANALYTICS_INVALID_TENANT_ID',
            {
                statusCode:
                    400,
            }
        );
    }

    return tenantId;
}

function requireTenantScope(
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
        false ||
        options.allowCrossTenant ===
        true
    ) {
        return tenantConstants
            .DEFAULTS
            .DEFAULT_TENANT;
    }

    if (
        options.systemScope
    ) {
        return tenantConstants
            .DEFAULTS
            .DEFAULT_TENANT;
    }

    if (
        DEFAULTS
            .REQUIRE_TENANT_FOR_READS
    ) {
        throw new FinancialAnalyticsRepositoryError(
            'Tenant identifier is required for this financial analytics operation.',
            'FINANCIAL_ANALYTICS_TENANT_REQUIRED',
            {
                statusCode:
                    400,
            }
        );
    }

    return tenantConstants
        .DEFAULTS
        .DEFAULT_TENANT;
}

function normalizeCurrency(
    currency,
    supportedCurrencies =
        DEFAULT_SUPPORTED_CURRENCIES
) {
    const value =
        String(
            currency ??
                ''
        )
            .trim()
            .toUpperCase();

    if (
        !/^[A-Z]{3}$/.test(
            value
        )
    ) {
        throw new FinancialAnalyticsRepositoryError(
            'Currency must be an ISO 4217 three-letter code.',
            'FINANCIAL_CURRENCY_INVALID',
            {
                statusCode:
                    400,
            }
        );
    }

    if (
        !supportedCurrencies.includes(
            value
        )
    ) {
        throw new FinancialAnalyticsRepositoryError(
            `Unsupported currency ${value}.`,
            'UNSUPPORTED_CURRENCY',
            {
                statusCode:
                    400,
            }
        );
    }

    return value;
}

function getCurrencyDecimals(
    currency
) {
    const decimals =
        CURRENCY_DECIMALS[
            currency
        ];

    if (
        decimals ===
            undefined
    ) {
        return 2;
    }

    return decimals;
}

function normalizeMinorUnits(
    value
) {
    if (
        typeof value ===
            'number'
    ) {
        if (
            !Number.isSafeInteger(
                value
            )
        ) {
            throw new FinancialAnalyticsRepositoryError(
                'amount_minor must be a safe integer.',
                'FINANCIAL_MINOR_UNITS_INVALID',
                {
                    statusCode:
                        400,
                }
            );
        }

        return value;
    }

    const text =
        String(
            value ??
                ''
        )
            .trim();

    if (
        !/^-?\d+$/.test(
            text
        )
    ) {
        throw new FinancialAnalyticsRepositoryError(
            'amount_minor must be an integer.',
            'FINANCIAL_MINOR_UNITS_INVALID',
            {
                statusCode:
                    400,
            }
        );
    }

    const number =
        Number(
            text
        );

    if (
        !Number.isSafeInteger(
            number
        )
    ) {
        throw new FinancialAnalyticsRepositoryError(
            'amount_minor exceeds the JavaScript safe integer range.',
            'FINANCIAL_MINOR_UNITS_OUT_OF_RANGE',
            {
                statusCode:
                    400,
            }
        );
    }

    return number;
}

function validateAmountSemantics(
    eventType,
    amountMinor
) {
    if (
        eventType !==
            'adjustment' &&
        amountMinor <
            0
    ) {
        throw new FinancialAnalyticsRepositoryError(
            `${eventType} amount_minor cannot be negative.`,
            'FINANCIAL_AMOUNT_NEGATIVE',
            {
                statusCode:
                    400,
            }
        );
    }

    if (
        eventType !==
            'adjustment' &&
        amountMinor ===
            0
    ) {
        throw new FinancialAnalyticsRepositoryError(
            `${eventType} amount_minor must be greater than zero.`,
            'FINANCIAL_AMOUNT_ZERO',
            {
                statusCode:
                    400,
            }
        );
    }
}

function normalizeEventType(
    value
) {
    const eventType =
        String(
            value ??
                ''
        )
            .trim()
            .toLowerCase();

    if (
        !EVENT_TYPES.includes(
            eventType
        )
    ) {
        throw new FinancialAnalyticsRepositoryError(
            `Unsupported financial event type "${eventType}".`,
            'FINANCIAL_EVENT_TYPE_INVALID',
            {
                statusCode:
                    400,
            }
        );
    }

    return eventType;
}

function normalizePaymentMethod(
    value
) {
    const normalized =
        String(
            value
        )
            .trim()
            .toLowerCase();

    if (
        !ALLOWED_PAYMENT_METHODS.includes(
            normalized
        )
    ) {
        /**
         * Do not reject future providers unnecessarily. Persist a normalized
         * method but enforce a bounded identifier.
         */
        if (
            !/^[a-z0-9_-]{1,64}$/.test(
                normalized
            )
        ) {
            throw new FinancialAnalyticsRepositoryError(
                'Invalid payment method.',
                'FINANCIAL_PAYMENT_METHOD_INVALID',
                {
                    statusCode:
                        400,
                }
            );
        }
    }

    return normalized;
}

function normalizeStatus(
    value
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

    const normalized =
        String(
            value
        )
            .trim()
            .toLowerCase();

    if (
        !EVENT_STATUSES.includes(
            normalized
        )
    ) {
        throw new FinancialAnalyticsRepositoryError(
            'Invalid financial event status.',
            'FINANCIAL_STATUS_INVALID',
            {
                statusCode:
                    400,
            }
        );
    }

    return normalized;
}

/**
 * ============================================================================
 * Persistence Helpers
 * ============================================================================
 */

function financialEventToSqlRow(
    event
) {
    return {
        internal_id:
            event.internal_id,

        tenant_id:
            event.tenant_id,

        transaction_id:
            event.transaction_id,

        event_type:
            event.event_type,

        timestamp:
            event.timestamp,

        amount_minor:
            event.amount_minor,

        currency:
            event.currency,

        user_id:
            event.user_id,

        payment_method:
            event.payment_method,

        status:
            event.status,

        payload:
            event.payload,

        metadata:
            event.metadata,

        idempotency_key:
            event.idempotency_key,

        created_at:
            new Date()
                .toISOString(),
    };
}

function financialEventToClickHouseRow(
    event
) {
    return {
        internal_id:
            event.internal_id,

        tenant_id:
            event.tenant_id,

        transaction_id:
            event.transaction_id,

        event_type:
            event.event_type,

        timestamp:
            event.timestamp,

        amount_minor:
            event.amount_minor,

        currency:
            event.currency,

        user_id:
            event.user_id,

        payment_method:
            event.payment_method,

        status:
            event.status,

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
            new Date()
                .toISOString(),
    };
}

function normalizeStoredFinancialEvent(
    row
) {
    const result =
        {
            ...row,
        };

    result.amount_minor =
        String(
            result.amount_minor ??
                0
        );

    if (
        result.currency
    ) {
        try {
            result.amount =
                fromMinorUnits(
                    result.amount_minor,
                    result.currency
                );
        } catch {
            result.amount =
                null;
        }
    }

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
            // Preserve legacy invalid JSON.
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
            // Preserve legacy invalid JSON.
        }
    }

    return result;
}

/**
 * ============================================================================
 * Idempotency / identifiers
 * ============================================================================
 */

function generateDeterministicIdempotencyKey(
    event
) {
    return crypto
        .createHash(
            'sha256'
        )
        .update(
            [
                event.tenant_id,
                event.transaction_id,
                event.event_type,
                event.amount_minor,
                event.currency,
            ].join(
                '|'
            )
        )
        .digest(
            'hex'
        );
}

function generateDeterministicInternalId(
    event
) {
    return crypto
        .createHash(
            'sha256'
        )
        .update(
            [
                event.tenant_id,
                event.idempotency_key,
            ].join(
                '|'
            )
        )
        .digest(
            'hex'
        );
}

function buildIdempotencyCacheKey(
    tenantId,
    idempotencyKey
) {
    return [
        DEFAULTS.CACHE_PREFIX,
        'idempotency',
        validateTenantIdStrict(
            tenantId
        ),
        sha256(
            String(
                idempotencyKey
            )
        ),
    ].join(
        ':'
    );
}

function sha256(
    value
) {
    return crypto
        .createHash(
            'sha256'
        )
        .update(
            value
        )
        .digest(
            'hex'
        );
}

/**
 * ============================================================================
 * General utilities
 * ============================================================================
 */

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
        throw new FinancialAnalyticsRepositoryError(
            'Invalid timestamp.',
            'FINANCIAL_TIMESTAMP_INVALID',
            {
                statusCode:
                    400,
            }
        );
    }

    return date.toISOString();
}

function normalizeRequiredString(
    value,
    maxLength,
    fieldName
) {
    const result =
        String(
            value ??
                ''
        )
            .trim();

    if (
        !result
    ) {
        throw new FinancialAnalyticsRepositoryError(
            `${fieldName} is required.`,
            `FINANCIAL_${fieldName
                .toUpperCase()
                .replace(
                    /[^A-Z0-9]/g,
                    '_'
                )}_REQUIRED`,
            {
                statusCode:
                    400,
            }
        );
    }

    if (
        result.length >
        maxLength
    ) {
        throw new FinancialAnalyticsRepositoryError(
            `${fieldName} exceeds the maximum length.`,
            'FINANCIAL_STRING_TOO_LONG',
            {
                statusCode:
                    400,
            }
        );
    }

    return result;
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
        )
            .trim();

    if (
        result.length >
        maxLength
    ) {
        throw new FinancialAnalyticsRepositoryError(
            'String value exceeds the maximum length.',
            'FINANCIAL_STRING_TOO_LONG',
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
    maxBytes,
    maxDepth
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
        throw new FinancialAnalyticsRepositoryError(
            `${field} must be an object.`,
            'FINANCIAL_JSON_OBJECT_REQUIRED',
            {
                statusCode:
                    400,
            }
        );
    }

    validateJsonValue(
        value,
        field,
        0,
        maxDepth
    );

    const serialized =
        JSON.stringify(
            value
        );

    if (
        Buffer.byteLength(
            serialized,
            'utf8'
        ) >
        maxBytes
    ) {
        throw new FinancialAnalyticsRepositoryError(
            `${field} exceeds the maximum allowed size.`,
            'FINANCIAL_JSON_TOO_LARGE',
            {
                statusCode:
                    413,
            }
        );
    }

    return value;
}

function validateJsonValue(
    value,
    field,
    depth,
    maxDepth
) {
    if (
        depth >
        maxDepth
    ) {
        throw new FinancialAnalyticsRepositoryError(
            `${field} exceeds the maximum JSON depth.`,
            'FINANCIAL_JSON_DEPTH_EXCEEDED',
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
            throw new FinancialAnalyticsRepositoryError(
                `${field} contains a non-finite number.`,
                'FINANCIAL_JSON_NUMBER_INVALID',
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
            validateJsonValue(
                item,
                field,
                depth + 1,
                maxDepth
            );
        }

        return;
    }

    if (
        isPlainObject(
            value
        )
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
                throw new FinancialAnalyticsRepositoryError(
                    `${field} contains an oversized key.`,
                    'FINANCIAL_JSON_KEY_TOO_LONG',
                    {
                        statusCode:
                            400,
                    }
                );
            }

            validateJsonValue(
                child,
                field,
                depth + 1,
                maxDepth
            );
        }

        return;
    }

    throw new FinancialAnalyticsRepositoryError(
        `${field} contains an unsupported JSON value.`,
        'FINANCIAL_JSON_VALUE_INVALID',
        {
            statusCode:
                400,
        }
    );
}

function cloneJson(
    value
) {
    return JSON.parse(
        JSON.stringify(
            value
        )
    );
}

function groupEventsByTenant(
    events
) {
    return events.reduce(
        (
            groups,
            event
        ) => {
            const tenant =
                validateTenantIdStrict(
                    event.tenant_id
                );

            if (
                !groups[
                    tenant
                ]
            ) {
                groups[
                    tenant
                ] = [];
            }

            groups[
                tenant
            ].push(
                event
            );

            return groups;
        },
        {}
    );
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

function parseCount(
    value
) {
    const number =
        Number(
            value
        );

    return Number.isFinite(
        number
    )
        ? number
        : 0;
}

function normalizeQueryOrder(
    value
) {
    const order =
        String(
            value ||
                'created_at'
        ).trim();

    if (
        !QUERY_ORDER_FIELDS.includes(
            order
        )
    ) {
        return 'created_at';
    }

    return order;
}

function normalizeQueryDirection(
    value
) {
    const direction =
        String(
            value ||
                'desc'
        )
            .trim()
            .toLowerCase();

    return QUERY_DIRECTIONS.includes(
        direction
    )
        ? direction
        : 'desc';
}

function assertSafeSqlIdentifier(
    identifier
) {
    const value =
        String(
            identifier ||
                ''
        );

    if (
        !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(
            value
        )
    ) {
        throw new FinancialAnalyticsRepositoryError(
            'Unsafe SQL identifier generated for financial analytics.',
            'FINANCIAL_ANALYTICS_UNSAFE_IDENTIFIER'
        );
    }

    return value;
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

function chunkArray(
    array,
    size
) {
    const result =
        [];

    for (
        let index = 0;
        index <
        array.length;
        index += size
    ) {
        result.push(
            array.slice(
                index,
                index + size
            )
        );
    }

    return result;
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

function isRetryableError(
    error
) {
    if (
        !error
    ) {
        return true;
    }

    const nonRetryable =
        new Set([
            'INVALID_FINANCIAL_EVENT',
            'FINANCIAL_ANALYTICS_INVALID_TENANT_ID',
            'FINANCIAL_CURRENCY_INVALID',
            'UNSUPPORTED_CURRENCY',
            'FINANCIAL_AMOUNT_INVALID',
            'FINANCIAL_AMOUNT_PRECISION_EXCEEDED',
            'FINANCIAL_AMOUNT_OUT_OF_RANGE',
            'FINANCIAL_AMOUNT_NEGATIVE',
            'FINANCIAL_AMOUNT_ZERO',
            'FINANCIAL_EVENT_TYPE_INVALID',
            'FINANCIAL_PAYMENT_METHOD_INVALID',
            'FINANCIAL_STATUS_INVALID',
            'FINANCIAL_ANALYTICS_UNSAFE_IDENTIFIER',
        ]);

    if (
        nonRetryable.has(
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

function safeTenantMetric(
    tenantId
) {
    try {
        return validateTenantIdStrict(
            tenantId
        );
    } catch {
        return 'unknown';
    }
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
            'currency',
            'reason',
            'attempt',
            'batch_size',
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
        /password|secret|token|authorization|cookie|credential|private.?key|api.?key|idempotency/i;

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
                'payload' ||
            key ===
                'batch'
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

function sanitizeCacheObject(
    value
) {
    if (
        !isPlainObject(
            value
        )
    ) {
        return value;
    }

    const result =
        {};

    for (
        const [
            key,
            child,
        ] of Object.entries(
            value
        )
    ) {
        if (
            /password|secret|token|authorization|cookie|credential|idempotency/i.test(
                key
            )
        ) {
            result[key] =
                '[REDACTED]';

            continue;
        }

        result[key] =
            child;
    }

    return result;
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
        throw new FinancialAnalyticsRepositoryError(
            'Invalid financial analytics topic.',
            'FINANCIAL_ANALYTICS_TOPIC_INVALID',
            {
                statusCode:
                    400,
            }
        );
    }

    return value;
}

function serializeFinancialCsvRow(
    row
) {
    return FINANCIAL_CSV_HEADERS
        .map(
            field =>
                csvEscape(
                    csvValue(
                        row[
                            field
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
    const text =
        String(
            value
        );

    if (
        /[",\n\r]/.test(
            text
        )
    ) {
        return `"${text.replace(
            /"/g,
            '""'
        )}"`;
    }

    return text;
}

const FINANCIAL_CSV_HEADERS =
    Object.freeze([
        'internal_id',
        'tenant_id',
        'transaction_id',
        'event_type',
        'timestamp',
        'amount_minor',
        'currency',
        'amount',
        'user_id',
        'payment_method',
        'status',
        'payload',
        'metadata',
        'idempotency_key',
        'created_at',
    ]);

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
 * Export
 * ============================================================================
 */

function createFinancialAnalyticsRepository(
    dependencies = {}
) {
    return new FinancialAnalyticsRepository(
        dependencies
    );
}

module.exports =
    Object.freeze({
        FinancialAnalyticsRepository,

        FinancialAnalyticsRepositoryError,

        createFinancialAnalyticsRepository,

        DEFAULTS,

        CURRENCY_DECIMALS,

        EVENT_TYPES,

        EVENT_STATUSES,

        toMinorUnits,

        fromMinorUnits,
    });