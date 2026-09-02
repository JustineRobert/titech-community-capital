"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Loan Analytics Repository
 * ============================================================================
 *
 * File:
 *   backend/repositories/analytics/loanAnalytics.repository.js
 *
 * Purpose:
 *   Enterprise analytics persistence and portfolio-intelligence boundary for
 *   TITech Community Capital.
 *
 * ============================================================================
 * CAPABILITIES
 * ============================================================================
 *
 * ✓ Tenant-aware loan event ingestion
 * ✓ Strict event validation
 * ✓ Deterministic event identity / idempotency
 * ✓ Backpressure-aware batching
 * ✓ Retry with exponential backoff
 * ✓ Durable failure handling / requeue
 * ✓ SQL / ClickHouse / custom writer support
 * ✓ Loan event querying
 * ✓ Portfolio aggregation
 * ✓ Delinquency analysis
 * ✓ Fixed-rate amortization schedule generation
 * ✓ Payment reconciliation
 * ✓ Streaming export
 * ✓ Data retention
 * ✓ Health checks
 * ✓ Operational metrics
 * ✓ Graceful shutdown
 *
 * ============================================================================
 * FINANCIAL DATA RULES
 * ============================================================================
 *
 * Monetary values are NEVER calculated using JavaScript Number.
 *
 * Analytics financial arithmetic uses Big.js internally and returns:
 *
 *   - integer minor units where appropriate
 *   - exact decimal strings for presentation
 *
 * ============================================================================
 * TENANCY RULES
 * ============================================================================
 *
 * tenant_id is mandatory for analytics writes.
 *
 * Tenant scope cannot be silently replaced by:
 *
 *   - public
 *   - fallback tenant
 *   - arbitrary caller input
 *
 * ============================================================================
 * ARCHITECTURAL NON-RESPONSIBILITIES
 * ============================================================================
 *
 * ✗ Does not approve loans.
 * ✗ Does not disburse loans.
 * ✗ Does not mutate loan balances.
 * ✗ Does not mutate wallets.
 * ✗ Does not create ledger entries.
 * ✗ Does not make credit decisions.
 * ✗ Does not authorize users.
 *
 * ============================================================================
 * TITech terminology
 * ============================================================================
 *
 * Legacy ACFOS references have been removed in favor of TITech terminology.
 * ============================================================================
 */

const EventEmitter =
    require("events");

const crypto =
    require("crypto");

const Big =
    require("big.js");

let Ajv;
let addFormats;

try {
    const ajvModule =
        require("ajv");

    Ajv =
        ajvModule.default ||
        ajvModule;
} catch (error) {
    throw new Error(
        "TITech LoanAnalyticsRepository requires the 'ajv' package."
    );
}

try {
    const formatsModule =
        require("ajv-formats");

    addFormats =
        formatsModule.default ||
        formatsModule;
} catch (error) {
    throw new Error(
        "TITech LoanAnalyticsRepository requires the 'ajv-formats' package."
    );
}

let pRetry;

try {
    const pRetryModule =
        require("p-retry");

    pRetry =
        pRetryModule.default ||
        pRetryModule;
} catch {
    pRetry =
        null;
}

const tenantConstants =
    require(
        "../../tenancy/tenant.constants"
    );

/**
 * ============================================================================
 * Defaults
 * ============================================================================
 */

const DEFAULTS =
    Object.freeze({

        BATCH_SIZE:
            positiveInteger(
                process.env.LOAN_ANALYTICS_BATCH_SIZE,
                200
            ),

        BATCH_INTERVAL_MS:
            positiveInteger(
                process.env.LOAN_ANALYTICS_BATCH_INTERVAL_MS,
                2000
            ),

        MAX_QUEUE_SIZE:
            positiveInteger(
                process.env.LOAN_ANALYTICS_MAX_QUEUE_SIZE,
                25000
            ),

        WRITE_RETRY_ATTEMPTS:
            positiveInteger(
                process.env.LOAN_ANALYTICS_WRITE_RETRY_ATTEMPTS,
                3
            ),

        WRITE_RETRY_MIN_TIMEOUT:
            positiveInteger(
                process.env.LOAN_ANALYTICS_WRITE_RETRY_MIN_TIMEOUT,
                100
            ),

        WRITE_RETRY_MAX_TIMEOUT:
            positiveInteger(
                process.env.LOAN_ANALYTICS_WRITE_RETRY_MAX_TIMEOUT,
                5000
            ),

        TABLE_PREFIX:
            tenantConstants.ENV.DB_TABLE_PREFIX ||
            "titech_",

        GLOBAL_TABLE:
            `${tenantConstants.ENV.DB_TABLE_PREFIX || "titech_"}loan_events`,

        LOG_PREFIX:
            "TITech.LoanAnalytics",

        IDEMPOTENCY_TTL:
            positiveInteger(
                process.env.LOAN_ANALYTICS_IDEMPOTENCY_TTL,
                86400
            ),

        RETENTION_DAYS:
            positiveInteger(
                process.env.LOAN_ANALYTICS_RETENTION_DAYS,
                3650
            ),

        MAX_PAGE_SIZE:
            positiveInteger(
                process.env.LOAN_ANALYTICS_MAX_PAGE_SIZE,
                1000
            ),

        EXPORT_BATCH_SIZE:
            positiveInteger(
                process.env.LOAN_ANALYTICS_EXPORT_BATCH_SIZE,
                1000
            ),

        MAX_EVENT_TYPE_LENGTH:
            128,

        MAX_LOAN_ID_LENGTH:
            128,

        MAX_TRANSACTION_ID_LENGTH:
            128,

        MAX_IDEMPOTENCY_KEY_LENGTH:
            256,

        MAX_CURRENCY_LENGTH:
            16,

        DEFAULT_CURRENCY:
            String(
                process.env.DEFAULT_CURRENCY ||
                "UGX"
            )
                .trim()
                .toUpperCase(),

        SUPPORTED_CURRENCIES:
            parseCurrencies(
                process.env.SUPPORTED_CURRENCIES ||
                "UGX,USD,EUR,GBP,TZS,KES,RWF"
            )
    });

/**
 * ============================================================================
 * AJV
 * ============================================================================
 */

const ajv =
    new Ajv({
        allErrors:
            true,

        coerceTypes:
            false,

        removeAdditional:
            false,

        useDefaults:
            false,

        strict:
            true
    });

addFormats(
    ajv
);

const loanEventSchema =
    {
        type:
            "object",

        required:
            [
                "tenant_id",
                "event_type",
                "timestamp",
                "loan_id",
                "payload"
            ],

        properties:
            {
                internal_id:
                    {
                        type:
                            "string",

                        minLength:
                            1,

                        maxLength:
                            128
                    },

                tenant_id:
                    {
                        type:
                            "string",

                        minLength:
                            3,

                        maxLength:
                            64
                    },

                event_type:
                    {
                        type:
                            "string",

                        minLength:
                            1,

                        maxLength:
                            DEFAULTS.MAX_EVENT_TYPE_LENGTH,

                        pattern:
                            "^[a-zA-Z0-9._:-]+$"
                    },

                timestamp:
                    {
                        type:
                            "string",

                        format:
                            "date-time"
                    },

                loan_id:
                    {
                        type:
                            "string",

                        minLength:
                            1,

                        maxLength:
                            DEFAULTS.MAX_LOAN_ID_LENGTH
                    },

                transaction_id:
                    {
                        type:
                            [
                                "string",
                                "null"
                            ],

                        maxLength:
                            DEFAULTS.MAX_TRANSACTION_ID_LENGTH
                    },

                amount_minor:
                    {
                        type:
                            [
                                "integer",
                                "null"
                            ]
                    },

                currency:
                    {
                        type:
                            [
                                "string",
                                "null"
                            ],

                        minLength:
                            3,

                        maxLength:
                            DEFAULTS.MAX_CURRENCY_LENGTH
                    },

                idempotency_key:
                    {
                        type:
                            [
                                "string",
                                "null"
                            ],

                        minLength:
                            1,

                        maxLength:
                            DEFAULTS.MAX_IDEMPOTENCY_KEY_LENGTH
                    },

                payload:
                    {
                        type:
                            "object",

                        additionalProperties:
                            true
                    },

                metadata:
                    {
                        type:
                            "object",

                        additionalProperties:
                            true
                    }
            },

        additionalProperties:
            false
    };

const validateLoanEvent =
    ajv.compile(
        loanEventSchema
    );

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const LOAN_EVENT_TYPES =
    Object.freeze(
        [
            "loan_created",
            "application_submitted",
            "application_approved",
            "application_rejected",
            "disbursement",
            "repayment",
            "interest_accrual",
            "fee_accrual",
            "penalty_accrual",
            "writeoff",
            "chargeoff",
            "restructure",
            "reschedule",
            "settlement",
            "schedule",
            "adjustment",
            "reversal",
            "loan_closed"
        ]
    );

const PORTFOLIO_EVENT_TYPES =
    Object.freeze(
        [
            "disbursement",
            "repayment",
            "interest_accrual",
            "fee_accrual",
            "penalty_accrual",
            "writeoff",
            "chargeoff",
            "adjustment",
            "reversal"
        ]
    );

const POSITIVE_AMOUNT_EVENTS =
    Object.freeze(
        [
            "disbursement",
            "interest_accrual",
            "fee_accrual",
            "penalty_accrual",
            "adjustment"
        ]
    );

const NEGATIVE_AMOUNT_EVENTS =
    Object.freeze(
        [
            "repayment",
            "writeoff",
            "chargeoff",
            "reversal"
        ]
    );

/**
 * Database-safe field whitelist for ORDER BY.
 */
const ALLOWED_ORDER_FIELDS =
    Object.freeze(
        [
            "created_at",
            "timestamp",
            "loan_id",
            "event_type",
            "currency",
            "amount_minor"
        ]
    );

/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

function positiveInteger(
    value,
    fallback
) {
    const parsed =
        Number(
            value
        );

    if (
        Number.isInteger(
            parsed
        ) &&
        parsed > 0
    ) {
        return parsed;
    }

    return fallback;
}

function parseCurrencies(
    value
) {
    return Array.from(
        new Set(
            String(
                value
            )
                .split(",")
                .map(
                    item =>
                        item
                            .trim()
                            .toUpperCase()
                )
                .filter(Boolean)
        )
    );
}

function nowIso() {
    return new Date()
        .toISOString();
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
        .randomBytes(
            16
        )
        .toString(
            "hex"
        );
}

function generateDeterministicKey(
    event
) {
    return crypto
        .createHash(
            "sha256"
        )
        .update(
            [
                event.tenant_id,
                event.loan_id,
                event.event_type,
                event.transaction_id || "",
                event.timestamp,
                event.amount_minor ??
                    ""
            ].join("|")
        )
        .digest(
            "hex"
        );
}

function isPlainObject(
    value
) {
    return Boolean(
        value &&
        typeof value ===
            "object" &&
        !Array.isArray(
            value
        )
    );
}

function parseDate(
    value,
    field
) {
    if (
        value ===
            undefined ||
        value ===
            null
    ) {
        return null;
    }

    const date =
        value instanceof Date
            ? new Date(
                value.getTime()
            )
            : new Date(
                value
            );

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
            "LOAN_ANALYTICS_INVALID_DATE";

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
            "LOAN_ANALYTICS_INVALID_DATE_RANGE";

        throw error;
    }
}

function normalizeTenantId(
    tenantId
) {
    if (
        tenantId ===
            undefined ||
        tenantId ===
            null
    ) {
        throw createRepositoryError(
            "tenantId is required.",
            "LOAN_ANALYTICS_TENANT_REQUIRED",
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
        "function"
    ) {
        if (
            !tenantConstants.isValidTenantId(
                normalized
            )
        ) {
            throw createRepositoryError(
                "Invalid TITech tenant identifier.",
                "LOAN_ANALYTICS_INVALID_TENANT",
                400
            );
        }
    }

    return normalized;
}

function normalizeIdentifier(
    value,
    field,
    maxLength
) {
    if (
        value ===
            undefined ||
        value ===
            null
    ) {
        throw createRepositoryError(
            `${field} is required.`,
            "LOAN_ANALYTICS_FIELD_REQUIRED",
            400,
            {
                field
            }
        );
    }

    const normalized =
        String(
            value
        )
            .trim();

    if (
        !normalized
    ) {
        throw createRepositoryError(
            `${field} is required.`,
            "LOAN_ANALYTICS_FIELD_REQUIRED",
            400,
            {
                field
            }
        );
    }

    if (
        normalized.length >
        maxLength
    ) {
        throw createRepositoryError(
            `${field} exceeds the maximum permitted length.`,
            "LOAN_ANALYTICS_FIELD_TOO_LONG",
            400,
            {
                field,
                maxLength
            }
        );
    }

    if (
        !/^[a-zA-Z0-9._:-]+$/.test(
            normalized
        )
    ) {
        throw createRepositoryError(
            `${field} contains invalid characters.`,
            "LOAN_ANALYTICS_INVALID_IDENTIFIER",
            400,
            {
                field
            }
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

    return normalized;
}

function normalizeCurrency(
    currency
) {
    const normalized =
        String(
            currency ||
            DEFAULTS.DEFAULT_CURRENCY
        )
            .trim()
            .toUpperCase();

    if (
        !/^[A-Z]{3,16}$/.test(
            normalized
        )
    ) {
        throw createRepositoryError(
            "Invalid currency code.",
            "LOAN_ANALYTICS_INVALID_CURRENCY",
            400,
            {
                currency:
                    normalized
            }
        );
    }

    if (
        DEFAULTS.SUPPORTED_CURRENCIES.length >
            0 &&
        !DEFAULTS.SUPPORTED_CURRENCIES.includes(
            normalized
        )
    ) {
        throw createRepositoryError(
            `Unsupported currency: ${normalized}.`,
            "LOAN_ANALYTICS_UNSUPPORTED_CURRENCY",
            400,
            {
                currency:
                    normalized
            }
        );
    }

    return normalized;
}

/**
 * Exact decimal -> minor units.
 *
 * This intentionally returns a string because JavaScript Number cannot safely
 * represent arbitrarily large monetary integers.
 */
function decimalToMinorUnits(
    amount,
    currency
) {
    const normalizedCurrency =
        normalizeCurrency(
            currency
        );

    const decimals =
        currencyDecimals(
            normalizedCurrency
        );

    const value =
        new Big(
            String(
                amount
            )
        );

    const factor =
        new Big(
            10
        ).pow(
            decimals
        );

    return value
        .times(
            factor
        )
        .round(
            0,
            Big.roundHalfUp
        )
        .toFixed(
            0
        );
}

function minorUnitsToDecimal(
    amountMinor,
    currency
) {
    const normalizedCurrency =
        normalizeCurrency(
            currency
        );

    const decimals =
        currencyDecimals(
            normalizedCurrency
        );

    const value =
        new Big(
            String(
                amountMinor ||
                0
            )
        );

    return value
        .div(
            new Big(
                10
            ).pow(
                decimals
            )
        )
        .toFixed(
            decimals
        );
}

function currencyDecimals(
    currency
) {
    switch (
        currency
    ) {
        case "JPY":
        case "UGX":
        case "RWF":
            return 0;

        default:
            return 2;
    }
}

function normalizeAmountMinor(
    value
) {
    if (
        value ===
            undefined ||
        value ===
            null
    ) {
        return null;
    }

    const text =
        String(
            value
        )
            .trim();

    if (
        !/^-?\d+$/.test(
            text
        )
    ) {
        throw createRepositoryError(
            "amount_minor must be an integer minor-unit value.",
            "LOAN_ANALYTICS_INVALID_AMOUNT_MINOR",
            400
        );
    }

    return text;
}

function validateNonNegativeMinor(
    amountMinor
) {
    if (
        amountMinor ===
            null
    ) {
        return;
    }

    if (
        String(
            amountMinor
        ).startsWith(
            "-"
        )
    ) {
        throw createRepositoryError(
            "amount_minor cannot be negative.",
            "LOAN_ANALYTICS_NEGATIVE_AMOUNT_MINOR",
            400
        );
    }
}

function normalizePage(
    value,
    fallback = 1
) {
    const parsed =
        Number(
            value
        );

    return Number.isInteger(
        parsed
    ) &&
        parsed > 0
        ? parsed
        : fallback;
}

function normalizePageSize(
    value,
    max = DEFAULTS.MAX_PAGE_SIZE
) {
    const parsed =
        Number(
            value
        );

    if (
        !Number.isInteger(
            parsed
        ) ||
        parsed <= 0
    ) {
        return 100;
    }

    return Math.min(
        parsed,
        max
    );
}

function normalizeOrder(
    order
) {
    const normalized =
        String(
            order ||
                "created_at"
        )
            .trim();

    return ALLOWED_ORDER_FIELDS.includes(
        normalized
    )
        ? normalized
        : "created_at";
}

function normalizeDirection(
    direction
) {
    return String(
        direction ||
            "desc"
    )
        .toLowerCase() ===
        "asc"
        ? "asc"
        : "desc";
}

/**
 * Prevent SQL identifier injection by allowing only known group fields.
 */
const GROUP_FIELD_MAP =
    Object.freeze(
        {
            product:
                "product",

            branch:
                "branch",

            currency:
                "currency",

            status:
                "status",

            loan_id:
                "loan_id",

            event_type:
                "event_type",

            date:
                "date"
        }
    );

function normalizeGroupBy(
    groupBy
) {
    const values =
        Array.isArray(
            groupBy
        )
            ? groupBy
            : [
                "currency"
            ];

    const normalized =
        [];

    for (
        const field
        of values
    ) {
        const value =
            String(
                field
            )
                .trim();

        if (
            GROUP_FIELD_MAP[
                value
            ]
        ) {
            normalized.push(
                value
            );
        }
    }

    const unique =
        Array.from(
            new Set(
                normalized
            )
        );

    return unique.length
        ? unique
        : [
            "currency"
        ];
}

function createRepositoryError(
    message,
    code,
    statusCode = 500,
    details = undefined
) {
    const error =
        new Error(
            message
        );

    error.name =
        "LoanAnalyticsRepositoryError";

    error.code =
        code;

    error.statusCode =
        statusCode;

    if (
        details !==
        undefined
    ) {
        error.details =
            details;
    }

    return error;
}

/**
 * ============================================================================
 * LoanAnalyticsRepository
 * ============================================================================
 */

class LoanAnalyticsRepository
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

        if (
            !logger
        ) {
            throw createRepositoryError(
                "logger is required.",
                "LOAN_ANALYTICS_LOGGER_REQUIRED",
                500
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
            Object.freeze(
                {
                    ...DEFAULTS,
                    ...options
                }
            );

        this._queue =
            [];

        this._queueSize =
            0;

        this._batchTimer =
            null;

        this._running =
            false;

        this._shuttingDown =
            false;

        this._stats =
            {
                enqueued:
                    0,

                flushed:
                    0,

                failed:
                    0,

                requeued:
                    0,

                rejected:
                    0
            };

        this._flushPromise =
            null;

        this.recordLoanEvent =
            this.recordLoanEvent.bind(
                this
            );

        this.bulkRecordLoanEvents =
            this.bulkRecordLoanEvents.bind(
                this
            );

        this.shutdown =
            this.shutdown.bind(
                this
            );

        this.logger.info(
            `${DEFAULTS.LOG_PREFIX} initialized`,
            {
                tenancyMode:
                    tenantConstants.getTenancyMode?.(),

                batchSize:
                    this.options.BATCH_SIZE,

                retentionDays:
                    this.options.RETENTION_DAYS
            }
        );
    }

    /**
     * =========================================================================
     * EVENT VALIDATION
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
                "Loan analytics event must be an object.",
                "LOAN_ANALYTICS_INVALID_EVENT",
                400
            );
        }

        const event =
            {
                ...rawEvent
            };

        event.tenant_id =
            normalizeTenantId(
                event.tenant_id
            );

        event.loan_id =
            normalizeIdentifier(
                event.loan_id,
                "loan_id",
                DEFAULTS.MAX_LOAN_ID_LENGTH
            );

        event.event_type =
            normalizeEventType(
                event.event_type
            );

        if (
            !LOAN_EVENT_TYPES.includes(
                event.event_type
            )
        ) {
            throw createRepositoryError(
                `Unsupported loan event type: ${event.event_type}.`,
                "LOAN_ANALYTICS_UNSUPPORTED_EVENT_TYPE",
                400,
                {
                    eventType:
                        event.event_type
                }
            );
        }

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
            event.transaction_id !==
                undefined &&
            event.transaction_id !==
                null
        ) {
            event.transaction_id =
                normalizeIdentifier(
                    event.transaction_id,
                    "transaction_id",
                    DEFAULTS.MAX_TRANSACTION_ID_LENGTH
                );
        } else {
            event.transaction_id =
                null;
        }

        event.currency =
            event.currency
                ? normalizeCurrency(
                    event.currency
                )
                : null;

        if (
            event.amount_minor !==
                undefined &&
            event.amount_minor !==
                null
        ) {
            event.amount_minor =
                normalizeAmountMinor(
                    event.amount_minor
                );

            validateNonNegativeMinor(
                event.amount_minor
            );
        } else {
            event.amount_minor =
                null;
        }

        if (
            event.payload ===
                undefined ||
            event.payload ===
                null
        ) {
            event.payload =
                {};
        }

        if (
            !isPlainObject(
                event.payload
            )
        ) {
            throw createRepositoryError(
                "event.payload must be an object.",
                "LOAN_ANALYTICS_INVALID_PAYLOAD",
                400
            );
        }

        if (
            event.metadata ===
                undefined ||
            event.metadata ===
                null
        ) {
            event.metadata =
                {};
        }

        if (
            !isPlainObject(
                event.metadata
            )
        ) {
            throw createRepositoryError(
                "event.metadata must be an object.",
                "LOAN_ANALYTICS_INVALID_METADATA",
                400
            );
        }

        /**
         * Optional conversion from payload.amount to amount_minor.
         *
         * This conversion uses Big.js and never JavaScript Number.
         */
        if (
            event.amount_minor ===
                null &&
            event.payload.amount !==
                undefined &&
            event.payload.amount !==
                null
        ) {
            const currency =
                event.currency ||
                normalizeCurrency(
                    event.payload.currency ||
                    DEFAULTS.DEFAULT_CURRENCY
                );

            event.currency =
                currency;

            event.amount_minor =
                decimalToMinorUnits(
                    event.payload.amount,
                    currency
                );

            validateNonNegativeMinor(
                event.amount_minor
            );
        }

        /**
         * Ensure currency exists when a monetary event contains an amount.
         */
        if (
            event.amount_minor !==
                null &&
            !event.currency
        ) {
            event.currency =
                normalizeCurrency(
                    event.payload.currency ||
                    DEFAULTS.DEFAULT_CURRENCY
                );
        }

        event.idempotency_key =
            event.idempotency_key
                ? String(
                    event.idempotency_key
                ).trim()
                : generateDeterministicKey(
                    event
                );

        if (
            event.idempotency_key.length >
            DEFAULTS.MAX_IDEMPOTENCY_KEY_LENGTH
        ) {
            throw createRepositoryError(
                "idempotency_key exceeds the maximum permitted length.",
                "LOAN_ANALYTICS_IDEMPOTENCY_KEY_TOO_LONG",
                400
            );
        }

        event.internal_id =
            event.internal_id ||
            generateInternalId();

        /**
         * Event-specific amount semantics.
         */
        if (
            event.event_type ===
            "repayment"
        ) {
            validateNonNegativeMinor(
                event.amount_minor
            );
        }

        const valid =
            validateLoanEvent(
                event
            );

        if (
            !valid
        ) {
            throw createRepositoryError(
                "Invalid loan analytics event payload.",
                "LOAN_ANALYTICS_EVENT_VALIDATION_FAILED",
                400,
                {
                    errors:
                        validateLoanEvent.errors
                }
            );
        }

        return deepFreezeSafe(
            event
        );
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
            `titech:loan-analytics:${key}`;

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
     * IDEMPOTENCY
     * =========================================================================
     */

    _idempotencyKey(
        key
    ) {
        return (
            "titech:loan:analytics:idempotency:" +
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
                ? JSON.parse(
                    raw
                )
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
            const serialized =
                JSON.stringify(
                    value
                );

            /**
             * Redis clients vary:
             *
             * set(key, value, { EX })
             * set(key, value, "EX", ttl)
             *
             * Try modern first, then legacy.
             */
            try {
                await this.cacheClient.set(
                    this._idempotencyKey(
                        key
                    ),
                    serialized,
                    {
                        EX:
                            this.options.IDEMPOTENCY_TTL
                    }
                );
            } catch {
                await this.cacheClient.set(
                    this._idempotencyKey(
                        key
                    ),
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
     * CACHE
     * =========================================================================
     */

    _cacheKey(
        tenantId,
        suffix
    ) {
        return tenantConstants.tenantCacheKey(
            tenantId,
            `loan-analytics:${suffix}`
        );
    }

    async _getCache(
        key
    ) {
        if (
            !this.cacheClient ||
            typeof this.cacheClient.get !==
                "function"
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

            return typeof raw ===
                "string"
                ? JSON.parse(
                    raw
                )
                : raw;
        } catch {
            return null;
        }
    }

    async _setCache(
        key,
        value,
        ttl
    ) {
        if (
            !this.cacheClient ||
            typeof this.cacheClient.set !==
                "function"
        ) {
            return;
        }

        try {
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
                            ttl
                    }
                );
            } catch {
                await this.cacheClient.set(
                    key,
                    serialized,
                    "EX",
                    ttl
                );
            }
        } catch (
            error
        ) {
            this.logger.warn(
                `${DEFAULTS.LOG_PREFIX} cache write failed`,
                {
                    error:
                        error.message
                }
            );
        }
    }

    async invalidateTenantCache(
        tenantId
    ) {
        if (
            !this.cacheClient ||
            typeof this.cacheClient.del !==
                "function"
        ) {
            return false;
        }

        try {
            /**
             * We intentionally do not use a wildcard DEL because that can be
             * expensive or unsupported depending on Redis implementation.
             *
             * Higher-level cache versioning can invalidate related keys.
             */
            const versionKey =
                this._cacheKey(
                    normalizeTenantId(
                        tenantId
                    ),
                    "version"
                );

            await this.cacheClient.del(
                versionKey
            );

            return true;
        } catch (
            error
        ) {
            this.logger.warn(
                `${DEFAULTS.LOG_PREFIX} cache invalidation failed`,
                {
                    error:
                        error.message
                }
            );

            return false;
        }
    }

    /**
     * =========================================================================
     * RECORD EVENT
     * =========================================================================
     */

    async recordLoanEvent(
        rawEvent,
        options = {}
    ) {
        if (
            this._shuttingDown
        ) {
            throw createRepositoryError(
                "LoanAnalyticsRepository is shutting down.",
                "LOAN_ANALYTICS_SHUTTING_DOWN",
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
                "titech.loan.analytics.invalid_event",
                1,
                {
                    tenant:
                        rawEvent?.tenant_id ||
                        "unknown"
                }
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
                "titech.loan.analytics.idempotent_hit",
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
                "titech.loan.analytics.queue_full",
                1,
                {
                    tenant:
                        event.tenant_id
                }
            );

            throw createRepositoryError(
                "Loan analytics queue is full.",
                "LOAN_ANALYTICS_QUEUE_FULL",
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
            "titech.loan.analytics.enqueued_total",
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

    /**
     * =========================================================================
     * BULK RECORD
     * =========================================================================
     */

    async bulkRecordLoanEvents(
        events = [],
        options = {}
    ) {
        if (
            !Array.isArray(
                events
            )
        ) {
            throw createRepositoryError(
                "events must be an array.",
                "LOAN_ANALYTICS_EVENTS_ARRAY_REQUIRED",
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
                const result =
                    await this.recordLoanEvent(
                        event,
                        options
                    );

                accepted.push(
                    result
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
     * FLUSH SCHEDULING
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

    /**
     * =========================================================================
     * FLUSH
     * =========================================================================
     */

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

            this._safeMetric(
                "titech.loan.analytics.flushed_total",
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
                "titech.loan.analytics.flush_failed",
                1
            );

            /**
             * Requeue rather than silently dropping financial analytics.
             *
             * Reinsert failed events at the front while respecting queue size.
             */
            const available =
                Math.max(
                    0,
                    this.options.MAX_QUEUE_SIZE -
                        this._queueSize
                );

            const requeue =
                batch.slice(
                    0,
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

            this.emit(
                "batchError",
                error,
                batch
            );

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
                        batch.length -
                        requeue.length
                }
            );

            if (
                batch.length !==
                requeue.length
            ) {
                this.emit(
                    "batchDropped",
                    batch.slice(
                        requeue.length
                    )
                );
            }
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

    /**
     * =========================================================================
     * WRITE WITH RETRY
     * =========================================================================
     */

    async _writeBatchWithRetry(
        batch
    ) {
        const operation =
            async () => {
                await this._writeBatch(
                    batch
                );

                /**
                 * Only mark idempotency after the writer successfully accepts
                 * the complete batch.
                 */
                for (
                    const event
                    of batch
                ) {
                    await this._setIdempotent(
                        event.idempotency_key,
                        {
                            internal_id:
                                event.internal_id,

                            loan_id:
                                event.loan_id,

                            tenant_id:
                                event.tenant_id,

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
                            this.options.WRITE_RETRY_ATTEMPTS -
                                1
                        ),

                    minTimeout:
                        this.options.WRITE_RETRY_MIN_TIMEOUT,

                    maxTimeout:
                        this.options.WRITE_RETRY_MAX_TIMEOUT,

                    factor:
                        2,

                    randomize:
                        true,

                    onFailedAttempt:
                        error => {
                            this.logger.warn(
                                `${DEFAULTS.LOG_PREFIX} write retry`,
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
                    this.options.WRITE_RETRY_ATTEMPTS,

                minTimeout:
                    this.options.WRITE_RETRY_MIN_TIMEOUT,

                maxTimeout:
                    this.options.WRITE_RETRY_MAX_TIMEOUT
            }
        );
    }

    /**
     * =========================================================================
     * WRITE BATCH
     * =========================================================================
     */

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
         * Event-driven integration fallback.
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
                "Knex client not configured."
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
                resolveLoanEventsTable(
                    tenantId,
                    mode
                );

            const rows =
                events.map(
                    event => ({
                        internal_id:
                            event.internal_id,

                        tenant_id:
                            event.tenant_id,

                        loan_id:
                            event.loan_id,

                        transaction_id:
                            event.transaction_id,

                        event_type:
                            event.event_type,

                        amount_minor:
                            event.amount_minor,

                        currency:
                            event.currency,

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

            /**
             * Prefer insert ignore semantics where supported only when the
             * schema's idempotency constraint guarantees uniqueness.
             *
             * Plain batchInsert remains the safest portable Knex behavior.
             */
            await this.knex.batchInsert(
                table,
                rows,
                Math.min(
                    500,
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
                event => ({
                    internal_id:
                        event.internal_id,

                    tenant_id:
                        event.tenant_id,

                    loan_id:
                        event.loan_id,

                    transaction_id:
                        event.transaction_id,

                    event_type:
                        event.event_type,

                    amount_minor:
                        event.amount_minor,

                    currency:
                        event.currency,

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
                "loan_events",
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
     * QUERY LOAN EVENTS
     * =========================================================================
     */

    async queryLoanEvents(
        filters = {},
        opts = {}
    ) {
        if (
            !this.knex
        ) {
            throw new Error(
                "Knex is required for queryLoanEvents."
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
            resolveLoanEventsTable(
                tenantId,
                mode
            );

        const query =
            this.knex
                .select(
                    "*"
                )
                .from(
                    table
                )
                .where(
                    "tenant_id",
                    tenantId
                );

        if (
            filters.loanId
        ) {
            query.where(
                "loan_id",
                normalizeIdentifier(
                    filters.loanId,
                    "loanId",
                    DEFAULTS.MAX_LOAN_ID_LENGTH
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

        if (
            filters.transactionId
        ) {
            query.where(
                "transaction_id",
                normalizeIdentifier(
                    filters.transactionId,
                    "transactionId",
                    DEFAULTS.MAX_TRANSACTION_ID_LENGTH
                )
            );
        }

        if (
            filters.currency
        ) {
            query.where(
                "currency",
                normalizeCurrency(
                    filters.currency
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
            filters.minAmountMinor !==
                undefined
        ) {
            query.where(
                "amount_minor",
                ">=",
                normalizeAmountMinor(
                    filters.minAmountMinor
                )
            );
        }

        if (
            filters.maxAmountMinor !==
                undefined
        ) {
            query.where(
                "amount_minor",
                "<=",
                normalizeAmountMinor(
                    filters.maxAmountMinor
                )
            );
        }

        if (
            filters.q
        ) {
            const q =
                `%${String(
                    filters.q
                )
                    .slice(
                        0,
                        200
                    )
                    .replace(
                        /[%_]/g,
                        "\\$&"
                    )}%`;

            query.whereRaw(
                "(" +
                "CAST(payload AS TEXT) ILIKE ? " +
                "OR CAST(metadata AS TEXT) ILIKE ?" +
                ")",
                [
                    q,
                    q
                ]
            );
        }

        const countQuery =
            query
                .clone()
                .clearSelect()
                .clearOrder()
                .count(
                    {
                        count:
                            "*"
                    }
                )
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

        const items =
            rows.map(
                row =>
                    this._parseSqlEvent(
                        row
                    )
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
                (
                    offset +
                    items.length
                ) <
                total,

            items
        };
    }

    /**
     * =========================================================================
     * PARSE SQL EVENT
     * =========================================================================
     */

    _parseSqlEvent(
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
                ),

            amount:
                row.amount_minor !==
                    null &&
                row.amount_minor !==
                    undefined &&
                row.currency
                    ? minorUnitsToDecimal(
                        row.amount_minor,
                        row.currency
                    )
                    : null
        };
    }

    /**
     * =========================================================================
     * AMORTIZATION
     * =========================================================================
     *
     * Fixed-rate monthly amortization.
     *
     * annualRate may be supplied as:
     *
     *   "0.12"  => 12%
     *
     * or:
     *
     *   "12"    => 12%
     *
     * Set annualRateFormat explicitly when integrating external rate systems.
     */

    computeAmortizationSchedule({
        principal,
        annualRate,
        termMonths,
        startDate,
        currency = DEFAULTS.DEFAULT_CURRENCY,
        annualRateFormat = "decimal"
    } = {}) {

        if (
            principal ===
                undefined ||
            principal ===
                null ||
            annualRate ===
                undefined ||
            annualRate ===
                null ||
            termMonths ===
                undefined ||
            termMonths ===
                null
        ) {
            throw createRepositoryError(
                "principal, annualRate and termMonths are required.",
                "LOAN_ANALYTICS_AMORTIZATION_ARGUMENTS_REQUIRED",
                400
            );
        }

        const normalizedCurrency =
            normalizeCurrency(
                currency
            );

        const P =
            new Big(
                String(
                    principal
                )
            );

        if (
            P.lte(
                0
            )
        ) {
            throw createRepositoryError(
                "principal must be greater than zero.",
                "LOAN_ANALYTICS_INVALID_PRINCIPAL",
                400
            );
        }

        const months =
            Number(
                termMonths
            );

        if (
            !Number.isInteger(
                months
            ) ||
            months <=
                0 ||
            months >
                1200
        ) {
            throw createRepositoryError(
                "termMonths must be a positive integer not exceeding 1200.",
                "LOAN_ANALYTICS_INVALID_TERM",
                400
            );
        }

        let rate =
            new Big(
                String(
                    annualRate
                )
            );

        if (
            annualRateFormat ===
            "percent"
        ) {
            rate =
                rate.div(
                    100
                );
        }

        if (
            rate.lt(
                0
            )
        ) {
            throw createRepositoryError(
                "annualRate cannot be negative.",
                "LOAN_ANALYTICS_INVALID_RATE",
                400
            );
        }

        const monthlyRate =
            rate.div(
                12
            );

        const schedule =
            [];

        let balance =
            P;

        const start =
            parseDate(
                startDate || new Date(),
                "startDate"
            );

        let payment;

        if (
            monthlyRate.eq(
                0
            )
        ) {
            payment =
                P.div(
                    months
                );
        } else {
            const one =
                new Big(
                    1
                );

            const denominator =
                one.minus(
                    one.plus(
                        monthlyRate
                    ).pow(
                        -months
                    )
                );

            payment =
                P.times(
                    monthlyRate
                ).div(
                    denominator
                );
        }

        const decimals =
            currencyDecimals(
                normalizedCurrency
            );

        for (
            let period = 1;
            period <= months;
            period++
        ) {
            const interest =
                balance.times(
                    monthlyRate
                );

            let principalPart =
                payment.minus(
                    interest
                );

            /**
             * Last-payment normalization prevents a tiny residual caused by
             * decimal rounding.
             */
            if (
                period ===
                months
            ) {
                principalPart =
                    balance;
            }

            const installment =
                principalPart.plus(
                    interest
                );

            balance =
                balance.minus(
                    principalPart
                );

            if (
                balance.lt(
                    0
                )
            ) {
                balance =
                    new Big(
                        0
                    );
            }

            const dueDate =
                new Date(
                    start.getTime()
                );

            dueDate.setMonth(
                dueDate.getMonth() +
                period
            );

            schedule.push(
                {
                    period,

                    dueDate:
                        dueDate.toISOString(),

                    principal:
                        principalPart.toFixed(
                            decimals
                        ),

                    interest:
                        interest.toFixed(
                            decimals
                        ),

                    installment:
                        installment.toFixed(
                            decimals
                        ),

                    balance:
                        balance.toFixed(
                            decimals
                        ),

                    principal_minor:
                        decimalToMinorUnits(
                            principalPart,
                            normalizedCurrency
                        ),

                    interest_minor:
                        decimalToMinorUnits(
                            interest,
                            normalizedCurrency
                        ),

                    installment_minor:
                        decimalToMinorUnits(
                            installment,
                            normalizedCurrency
                        ),

                    balance_minor:
                        decimalToMinorUnits(
                            balance,
                            normalizedCurrency
                        ),

                    currency:
                        normalizedCurrency
                }
            );
        }

        return schedule;
    }

    /**
     * =========================================================================
     * DELINQUENCY
     * =========================================================================
     *
     * Preferred event model:
     *
     * schedule event payload:
     *
     *   {
     *      dueDate,
     *      installment_minor,
     *      principal_minor
     *   }
     *
     * repayment event:
     *
     *   amount_minor
     *
     * The method determines actual days past due from the oldest unpaid due
     * installment rather than deriving an artificial number from grace days.
     */

    async detectDelinquency({
        loanId,
        tenantId,
        asOf = null,
        graceDays = 0,
        currency = null,
        knex = null
    } = {}) {

        const db =
            knex ||
            this.knex;

        if (
            !db
        ) {
            throw new Error(
                "Knex is required for detectDelinquency."
            );
        }

        const normalizedTenantId =
            normalizeTenantId(
                tenantId
            );

        const normalizedLoanId =
            normalizeIdentifier(
                loanId,
                "loanId",
                DEFAULTS.MAX_LOAN_ID_LENGTH
            );

        const effectiveAsOf =
            parseDate(
                asOf || new Date(),
                "asOf"
            );

        const normalizedGraceDays =
            Number(
                graceDays
            );

        if (
            !Number.isInteger(
                normalizedGraceDays
            ) ||
            normalizedGraceDays <
                0 ||
            normalizedGraceDays >
                365
        ) {
            throw createRepositoryError(
                "graceDays must be an integer between 0 and 365.",
                "LOAN_ANALYTICS_INVALID_GRACE_DAYS",
                400
            );
        }

        const mode =
            tenantConstants.getTenancyMode();

        const table =
            resolveLoanEventsTable(
                normalizedTenantId,
                mode
            );

        const events =
            await db
                .select(
                    [
                        "event_type",
                        "amount_minor",
                        "currency",
                        "payload",
                        "created_at"
                    ]
                )
                .from(
                    table
                )
                .where(
                    {
                        tenant_id:
                            normalizedTenantId,

                        loan_id:
                            normalizedLoanId
                    }
                )
                .andWhere(
                    "created_at",
                    "<=",
                    effectiveAsOf
                )
                .orderBy(
                    "created_at",
                    "asc"
                );

        const schedule =
            [];

        let repaidMinor =
            createZeroBigIntMap();

        for (
            const event
            of events
        ) {
            const payload =
                parseJson(
                    event.payload,
                    {}
                );

            if (
                event.event_type ===
                "schedule"
            ) {
                const dueDate =
                    payload.dueDate ||
                    payload.due_date;

                const dueDateValue =
                    parseDate(
                        dueDate,
                        "payload.dueDate"
                    );

                if (
                    dueDateValue &&
                    dueDateValue <=
                        effectiveAsOf
                ) {
                    const installmentMinor =
                        payload.installment_minor ??
                        payload.total_minor ??
                        payload.amount_minor ??
                        null;

                    if (
                        installmentMinor !==
                            null &&
                        installmentMinor !==
                            undefined
                    ) {
                        const currencyCode =
                            normalizeCurrency(
                                payload.currency ||
                                event.currency ||
                                currency ||
                                DEFAULTS.DEFAULT_CURRENCY
                            );

                        schedule.push(
                            {
                                dueDate:
                                    dueDateValue,

                                installmentMinor:
                                    new BigIntSafe(
                                        String(
                                            installmentMinor
                                        )
                                    ),

                                currency:
                                    currencyCode
                            }
                        );
                    }
                }
            }

            if (
                event.event_type ===
                    "repayment" &&
                event.amount_minor !==
                    null &&
                event.amount_minor !==
                    undefined
            ) {
                const repaymentCurrency =
                    normalizeCurrency(
                        event.currency ||
                        currency ||
                        DEFAULTS.DEFAULT_CURRENCY
                    );

                const amount =
                    new BigIntSafe(
                        String(
                            event.amount_minor
                        )
                    );

                repaidMinor[
                    repaymentCurrency
                ] =
                    addBigIntSafe(
                        repaidMinor[
                            repaymentCurrency
                        ],
                        amount
                    );
            }
        }

        /**
         * Sort schedules by due date.
         */
        schedule.sort(
            (
                a,
                b
            ) =>
                a.dueDate -
                b.dueDate
        );

        const now =
            effectiveAsOf.getTime();

        let earliestOutstanding =
            null;

        const remainingByCurrency =
            {
                ...repaidMinor
            };

        /**
         * Consume repayments against installments in chronological order.
         */
        for (
            const installment
            of schedule
        ) {
            const currencyCode =
                installment.currency;

            const available =
                remainingByCurrency[
                    currencyCode
                ] ||
                new BigIntSafe(
                    "0"
                );

            const due =
                installment.installmentMinor;

            if (
                available.compare(
                    due
                ) >= 0
            ) {
                remainingByCurrency[
                    currencyCode
                ] =
                    subtractBigIntSafe(
                        available,
                        due
                    );

                continue;
            }

            const outstanding =
                subtractBigIntSafe(
                    due,
                    available
                );

            remainingByCurrency[
                currencyCode
            ] =
                new BigIntSafe(
                    "0"
                );

            if (
                !earliestOutstanding
            ) {
                earliestOutstanding =
                    {
                        ...installment,

                        outstandingMinor:
                            outstanding
                    };
            }
        }

        if (
            !earliestOutstanding
        ) {
            return {
                loanId:
                    normalizedLoanId,

                tenantId:
                    normalizedTenantId,

                status:
                    "current",

                daysPastDue:
                    0,

                outstandingMinor:
                    "0",

                outstanding:
                    currency
                        ? minorUnitsToDecimal(
                            "0",
                            normalizeCurrency(
                                currency
                            )
                        )
                        : "0",

                asOf:
                    effectiveAsOf.toISOString(),

                graceDays:
                    normalizedGraceDays
            };
        }

        const dueWithGrace =
            new Date(
                earliestOutstanding.dueDate.getTime()
            );

        dueWithGrace.setDate(
            dueWithGrace.getDate() +
            normalizedGraceDays
        );

        const daysPastDue =
            Math.max(
                0,
                Math.floor(
                    (
                        now -
                        dueWithGrace.getTime()
                    ) /
                    86400000
                )
            );

        let status =
            "past_due";

        if (
            daysPastDue ===
            0
        ) {
            status =
                "grace";
        } else if (
            daysPastDue >
            90
        ) {
            status =
                "non_performing";
        } else if (
            daysPastDue >
            30
        ) {
            status =
                "delinquent";
        }

        return {
            loanId:
                normalizedLoanId,

            tenantId:
                normalizedTenantId,

            status,

            daysPastDue,

            dueDate:
                earliestOutstanding
                    .dueDate
                    .toISOString(),

            outstandingMinor:
                earliestOutstanding
                    .outstandingMinor
                    .toString(),

            outstanding:
                minorUnitsToDecimal(
                    earliestOutstanding
                        .outstandingMinor
                        .toString(),
                    earliestOutstanding.currency
                ),

            currency:
                earliestOutstanding.currency,

            asOf:
                effectiveAsOf.toISOString(),

            graceDays:
                normalizedGraceDays
        };
    }

    /**
     * =========================================================================
     * PORTFOLIO AGGREGATION
     * =========================================================================
     */

    async aggregatePortfolio({
        groupBy = [
            "currency"
        ],
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
                "Knex is required for aggregatePortfolio."
            );
        }

        const normalizedTenantId =
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
            resolveLoanEventsTable(
                normalizedTenantId,
                mode
            );

        const query =
            db
                .from(
                    table
                )
                .where(
                    "tenant_id",
                    normalizedTenantId
                )
                .whereIn(
                    "event_type",
                    PORTFOLIO_EVENT_TYPES
                );

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
            filters.currency
        ) {
            query.where(
                "currency",
                normalizeCurrency(
                    filters.currency
                )
            );
        }

        if (
            filters.loanId
        ) {
            query.where(
                "loan_id",
                normalizeIdentifier(
                    filters.loanId,
                    "loanId",
                    DEFAULTS.MAX_LOAN_ID_LENGTH
                )
            );
        }

        /**
         * Cross-database portable implementation:
         *
         * retrieve grouped financial events and calculate exact results in
         * Big.js. This avoids database-specific numeric casting assumptions.
         *
         * For very large production warehouses, this method should be backed
         * by ClickHouse/Timescale materialized views.
         */
        const selected =
            await query.select(
                [
                    "loan_id",
                    "event_type",
                    "amount_minor",
                    "currency",
                    "created_at"
                ]
            );

        const aggregation =
            new Map();

        for (
            const row
            of selected
        ) {
            const keyParts =
                groups.map(
                    group => {
                        if (
                            group ===
                            "date"
                        ) {
                            return new Date(
                                row.created_at
                            )
                                .toISOString()
                                .slice(
                                    0,
                                    10
                                );
                        }

                        if (
                            group ===
                            "loan_id"
                        ) {
                            return row.loan_id;
                        }

                        if (
                            group ===
                            "event_type"
                        ) {
                            return row.event_type;
                        }

                        return row[
                            group
                        ];
                    }
                );

            const currencyCode =
                normalizeCurrency(
                    row.currency
                );

            keyParts.push(
                currencyCode
            );

            const key =
                keyParts.join(
                    "|"
                );

            if (
                !aggregation.has(
                    key
                )
            ) {
                const initial =
                    {
                        currency:
                            currencyCode,

                        events:
                            0,

                        disbursementsMinor:
                            new Big(
                                0
                            ),

                        repaymentsMinor:
                            new Big(
                                0
                            ),

                        chargesMinor:
                            new Big(
                                0
                            ),

                        writeoffsMinor:
                            new Big(
                                0
                            )
                    };

                for (
                    const group
                    of groups
                ) {
                    if (
                        group ===
                        "date"
                    ) {
                        initial.date =
                            keyParts[
                                groups.indexOf(
                                    group
                                )
                            ];
                    } else if (
                        group !==
                        "currency"
                    ) {
                        initial[
                            group
                        ] =
                            row[
                                group
                            ];
                    }
                }

                aggregation.set(
                    key,
                    initial
                );
            }

            const current =
                aggregation.get(
                    key
                );

            current.events++;

            const amount =
                new Big(
                    String(
                        row.amount_minor ||
                        0
                    )
                );

            switch (
                row.event_type
            ) {
                case "disbursement":
                    current.disbursementsMinor =
                        current
                            .disbursementsMinor
                            .plus(
                                amount
                            );
                    break;

                case "repayment":
                    current.repaymentsMinor =
                        current
                            .repaymentsMinor
                            .plus(
                                amount
                            );
                    break;

                case "interest_accrual":
                case "fee_accrual":
                case "penalty_accrual":
                    current.chargesMinor =
                        current
                            .chargesMinor
                            .plus(
                                amount
                            );
                    break;

                case "writeoff":
                case "chargeoff":
                    current.writeoffsMinor =
                        current
                            .writeoffsMinor
                            .plus(
                                amount
                            );
                    break;

                default:
                    break;
            }
        }

        return Array.from(
            aggregation.values()
        ).map(
            item => {
                const netOutstanding =
                    item.disbursementsMinor
                        .minus(
                            item.repaymentsMinor
                        )
                        .minus(
                            item.writeoffsMinor
                        );

                return {
                    ...item,

                    disbursementsMinor:
                        item
                            .disbursementsMinor
                            .toFixed(
                                0
                            ),

                    repaymentsMinor:
                        item
                            .repaymentsMinor
                            .toFixed(
                                0
                            ),

                    chargesMinor:
                        item
                            .chargesMinor
                            .toFixed(
                                0
                            ),

                    writeoffsMinor:
                        item
                            .writeoffsMinor
                            .toFixed(
                                0
                            ),

                    outstandingMinor:
                        netOutstanding
                            .toFixed(
                                0
                            ),

                    disbursements:
                        minorUnitsToDecimal(
                            item
                                .disbursementsMinor
                                .toFixed(
                                    0
                                ),
                            item.currency
                        ),

                    repayments:
                        minorUnitsToDecimal(
                            item
                                .repaymentsMinor
                                .toFixed(
                                    0
                                ),
                            item.currency
                        ),

                    charges:
                        minorUnitsToDecimal(
                            item
                                .chargesMinor
                                .toFixed(
                                    0
                                ),
                            item.currency
                        ),

                    writeoffs:
                        minorUnitsToDecimal(
                            item
                                .writeoffsMinor
                                .toFixed(
                                    0
                                ),
                            item.currency
                        ),

                    outstanding:
                        minorUnitsToDecimal(
                            netOutstanding
                                .toFixed(
                                    0
                                ),
                            item.currency
                        )
                };
            }
        );
    }

    /**
     * =========================================================================
     * PAYMENT RECONCILIATION
     * =========================================================================
     */

    async reconcilePayments(
        settlementReport = [],
        opts = {}
    ) {
        if (
            !Array.isArray(
                settlementReport
            )
        ) {
            throw createRepositoryError(
                "settlementReport must be an array.",
                "LOAN_ANALYTICS_SETTLEMENT_REPORT_INVALID",
                400
            );
        }

        const db =
            opts.knex ||
            this.knex;

        if (
            !db
        ) {
            throw new Error(
                "Knex is required for reconcilePayments."
            );
        }

        const tenantId =
            normalizeTenantId(
                opts.tenantId
            );

        const mode =
            tenantConstants.getTenancyMode();

        const table =
            resolveLoanEventsTable(
                tenantId,
                mode
            );

        const normalizedReport =
            settlementReport.map(
                item => {
                    if (
                        !item ||
                        !item.transaction_id
                    ) {
                        throw createRepositoryError(
                            "Every settlement record requires transaction_id.",
                            "LOAN_ANALYTICS_TRANSACTION_ID_REQUIRED",
                            400
                        );
                    }

                    return {
                        ...item,

                        transaction_id:
                            normalizeIdentifier(
                                item.transaction_id,
                                "transaction_id",
                                DEFAULTS.MAX_TRANSACTION_ID_LENGTH
                            ),

                        amount_minor:
                            normalizeAmountMinor(
                                item.amount_minor
                            ),

                        currency:
                            normalizeCurrency(
                                item.currency
                            )
                    };
                }
            );

        const transactionIds =
            Array.from(
                new Set(
                    normalizedReport.map(
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
                matched: [],
                missing: [],
                mismatched: []
            };
        }

        const stored =
            await db
                .select(
                    [
                        "transaction_id",
                        "amount_minor",
                        "currency",
                        "loan_id",
                        "event_type",
                        "tenant_id"
                    ]
                )
                .from(
                    table
                )
                .where(
                    "tenant_id",
                    tenantId
                )
                .whereIn(
                    "transaction_id",
                    transactionIds
                )
                .where(
                    "event_type",
                    "repayment"
                );

        const storedMap =
            new Map();

        for (
            const row
            of stored
        ) {
            if (
                !storedMap.has(
                    row.transaction_id
                )
            ) {
                storedMap.set(
                    row.transaction_id,
                    row
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
            of normalizedReport
        ) {
            const current =
                storedMap.get(
                    report.transaction_id
                );

            if (
                !current
            ) {
                missing.push(
                    {
                        transaction_id:
                            report.transaction_id,

                        report
                    }
                );

                continue;
            }

            const amountMatches =
                String(
                    current.amount_minor
                ) ===
                String(
                    report.amount_minor
                );

            const currencyMatches =
                String(
                    current.currency
                )
                    .toUpperCase() ===
                report.currency;

            if (
                amountMatches &&
                currencyMatches
            ) {
                matched.push(
                    {
                        transaction_id:
                            report.transaction_id,

                        report,

                        stored:
                            current
                    }
                );
            } else {
                mismatched.push(
                    {
                        transaction_id:
                            report.transaction_id,

                        report,

                        stored:
                            current
                    }
                );
            }
        }

        return {
            matched,
            missing,
            mismatched,

            summary:
                {
                    total:
                        normalizedReport.length,

                    matched:
                        matched.length,

                    missing:
                        missing.length,

                    mismatched:
                        mismatched.length
                }
        };
    }

    /**
     * =========================================================================
     * EXPORT LOAN EVENTS
     * =========================================================================
     */

    async exportLoanEvents(
        opts = {}
    ) {
        const db =
            opts.knex ||
            this.knex;

        if (
            !db
        ) {
            throw new Error(
                "Knex is required for exportLoanEvents."
            );
        }

        if (
            !opts.stream ||
            typeof opts.stream.write !==
                "function"
        ) {
            throw createRepositoryError(
                "A writable stream is required.",
                "LOAN_ANALYTICS_EXPORT_STREAM_REQUIRED",
                400
            );
        }

        const tenantId =
            normalizeTenantId(
                opts.tenantId
            );

        const format =
            String(
                opts.format ||
                "jsonl"
            )
                .toLowerCase();

        if (
            ![
                "jsonl",
                "csv"
            ].includes(
                format
            )
        ) {
            throw createRepositoryError(
                "Export format must be jsonl or csv.",
                "LOAN_ANALYTICS_EXPORT_FORMAT_INVALID",
                400
            );
        }

        const mode =
            tenantConstants.getTenancyMode();

        const table =
            resolveLoanEventsTable(
                tenantId,
                mode
            );

        const query =
            db
                .select(
                    "*"
                )
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

        const stream =
            query.stream();

        let headersWritten =
            false;

        const headers =
            [
                "internal_id",
                "tenant_id",
                "loan_id",
                "transaction_id",
                "event_type",
                "amount_minor",
                "currency",
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

                stream.on(
                    "data",
                    row => {
                        try {
                            if (
                                format ===
                                    "jsonl"
                            ) {
                                opts.stream.write(
                                    JSON.stringify(
                                        this._parseSqlEvent(
                                            row
                                        )
                                    ) +
                                    "\n"
                                );

                                return;
                            }

                            if (
                                !headersWritten
                            ) {
                                opts.stream.write(
                                    csvLine(
                                        headers
                                    )
                                );

                                headersWritten =
                                    true;
                            }

                            opts.stream.write(
                                csvLine(
                                    headers.map(
                                        header =>
                                            row[
                                                mapCsvHeader(
                                                    header
                                                )
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

                stream.on(
                    "end",
                    () => {
                        opts.stream.end();

                        resolve(
                            true
                        );
                    }
                );

                stream.on(
                    "error",
                    error => {
                        try {
                            opts.stream.destroy?.(
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
     * PURGE RETENTION DATA
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

        let deleted =
            0;

        /**
         * Schema-per-tenant mode.
         */
        if (
            mode ===
            tenantConstants.TENANCY_MODES.SCHEMA
        ) {
            const tenantRegistry =
                `${this.options.TABLE_PREFIX}tenants`;

            const tenants =
                await db
                    .select(
                        "tenant_id"
                    )
                    .from(
                        tenantRegistry
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
                    resolveLoanEventsTable(
                        tenantId,
                        mode
                    );

                if (
                    opts.dryRun
                ) {
                    const row =
                        await db(
                            table
                        )
                            .where(
                                "created_at",
                                "<",
                                cutoff
                            )
                            .count(
                                {
                                    count:
                                        "*"
                                }
                            )
                            .first();

                    deleted +=
                        toSafeInteger(
                            row?.count
                        );

                    continue;
                }

                const affected =
                    await db(
                        table
                    )
                        .where(
                            "created_at",
                            "<",
                            cutoff
                        )
                        .del();

                deleted +=
                    toSafeInteger(
                        affected
                    );
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

                affected:
                    deleted
            };
        }

        const table =
            this.options.GLOBAL_TABLE;

        if (
            opts.dryRun
        ) {
            const row =
                await db(
                    table
                )
                    .where(
                        "created_at",
                        "<",
                        cutoff
                    )
                    .count(
                        {
                            count:
                                "*"
                        }
                    )
                    .first();

            return {
                dryRun:
                    true,

                olderThanDays:
                    days,

                cutoff:
                    cutoff.toISOString(),

                affected:
                    toSafeInteger(
                        row?.count
                    )
            };
        }

        deleted =
            await db(
                table
            )
                .where(
                    "created_at",
                    "<",
                    cutoff
                )
                .del();

        return {
            dryRun:
                false,

            olderThanDays:
                days,

            cutoff:
                cutoff.toISOString(),

            affected:
                toSafeInteger(
                    deleted
                )
        };
    }

    /**
     * =========================================================================
     * PUBLISH TO STREAM
     * =========================================================================
     */

    async publishLoanEvent(
        topic,
        event
    ) {
        if (
            !this.streamProducer ||
            typeof this.streamProducer.produce !==
                "function"
        ) {
            throw createRepositoryError(
                "streamProducer is not configured.",
                "LOAN_ANALYTICS_STREAM_NOT_CONFIGURED",
                500
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
            "titech.loan.analytics.published_total",
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
        const result =
            {
                ok:
                    true,

                details:
                    {},

                queueSize:
                    this._queueSize
            };

        if (
            this.knex
        ) {
            try {
                await this.knex.raw(
                    "SELECT 1"
                );

                result.details.knex =
                    "ok";
            } catch (
                error
            ) {
                result.ok =
                    false;

                result.details.knex =
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

                result.details.clickhouse =
                    "ok";
            } catch (
                error
            ) {
                result.ok =
                    false;

                result.details.clickhouse =
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

                result.details.cache =
                    "ok";
            } catch (
                error
            ) {
                result.ok =
                    false;

                result.details.cache =
                    `error: ${error.message}`;
            }
        }

        return result;
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

            requeued:
                this._stats.requeued,

            rejected:
                this._stats.rejected,

            shuttingDown:
                this._shuttingDown,

            running:
                this._running,

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
     * GRACEFUL SHUTDOWN
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
        method,
        value = 1,
        labels = {}
    ) {
        try {
            if (
                typeof this.metrics.increment ===
                "function"
            ) {
                this.metrics.increment(
                    method,
                    value,
                    labels
                );
            }
        } catch {
            // Metrics failures must never affect financial analytics flow.
        }
    }
}

/**
 * ============================================================================
 * Tenant Table Resolution
 * ============================================================================
 */

function resolveLoanEventsTable(
    tenantId,
    mode
) {
    const normalizedTenantId =
        normalizeTenantId(
            tenantId
        );

    if (
        mode ===
        tenantConstants.TENANCY_MODES.SCHEMA
    ) {
        const schema =
            tenantConstants.schemaNameForTenant(
                normalizedTenantId
            );

        /**
         * Both schema and table are generated from trusted tenant constants.
         */
        return `${schema}.loan_events`;
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
                ] =
                    [];
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
 * Retry Fallback
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
 * Safe Metrics Client
 * ============================================================================
 */

function normalizeMetricsClient(
    metrics
) {
    if (
        !metrics ||
        typeof metrics !==
            "object"
    ) {
        return {
            increment:
                () => {},

            gauge:
                () => {},

            timing:
                () => {}
        };
    }

    return {
        increment:
            typeof metrics.increment ===
                "function"
                ? metrics.increment.bind(
                    metrics
                )
                : () => {},

        gauge:
            typeof metrics.gauge ===
                "function"
                ? metrics.gauge.bind(
                    metrics
                )
                : () => {},

        timing:
            typeof metrics.timing ===
                "function"
                ? metrics.timing.bind(
                    metrics
                )
                : () => {}
    };
}

/**
 * ============================================================================
 * BigInt-safe helpers
 * ============================================================================
 *
 * Used for exact integer minor-unit calculations.
 */

class BigIntSafe {

    constructor(
        value
    ) {
        const normalized =
            String(
                value
            );

        if (
            !/^-?\d+$/.test(
                normalized
            )
        ) {
            throw new Error(
                "Invalid integer value."
            );
        }

        this.value =
            BigInt(
                normalized
            );
    }

    compare(
        other
    ) {
        const rhs =
            other instanceof
            BigIntSafe
                ? other.value
                : BigInt(
                    String(
                        other
                    )
                );

        if (
            this.value <
            rhs
        ) {
            return -1;
        }

        if (
            this.value >
            rhs
        ) {
            return 1;
        }

        return 0;
    }

    plus(
        other
    ) {
        const rhs =
            other instanceof
            BigIntSafe
                ? other.value
                : BigInt(
                    String(
                        other
                    )
                );

        return new BigIntSafe(
            (
                this.value +
                rhs
            ).toString()
        );
    }

    minus(
        other
    ) {
        const rhs =
            other instanceof
            BigIntSafe
                ? other.value
                : BigInt(
                    String(
                        other
                    )
                );

        return new BigIntSafe(
            (
                this.value -
                rhs
            ).toString()
        );
    }

    toString() {
        return this.value.toString();
    }
}

function createZeroBigIntMap() {
    return {};
}

function addBigIntSafe(
    left,
    right
) {
    return new BigIntSafe(
        (
            left ||
            new BigIntSafe(
                "0"
            )
        ).plus(
            right ||
            new BigIntSafe(
                "0"
            )
        ).toString()
    );
}

function subtractBigIntSafe(
    left,
    right
) {
    return new BigIntSafe(
        (
            left ||
            new BigIntSafe(
                "0"
            )
        ).minus(
            right ||
            new BigIntSafe(
                "0"
            )
        ).toString()
    );
}

/**
 * ============================================================================
 * Generic helpers
 * ============================================================================
 */

function parseJson(
    value,
    fallback
) {
    if (
        value ===
            null ||
        value ===
            undefined
    ) {
        return fallback;
    }

    if (
        typeof value ===
        "object"
    ) {
        return value;
    }

    try {
        return JSON.parse(
            value
        );
    } catch {
        return fallback;
    }
}

function toSafeInteger(
    value
) {
    if (
        value ===
            undefined ||
        value ===
            null
    ) {
        return 0;
    }

    const text =
        String(
            value
        );

    if (
        !/^\d+$/.test(
            text
        )
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
        bigint >
            max
            ? max
            : bigint
    );
}

function deepFreezeSafe(
    object
) {
    if (
        !object ||
        typeof object !==
            "object" ||
        Object.isFrozen(
            object
        )
    ) {
        return object;
    }

    Object.freeze(
        object
    );

    for (
        const value
        of Object.values(
            object
        )
    ) {
        deepFreezeSafe(
            value
        );
    }

    return object;
}

function sleep(
    ms
) {
    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                ms
            )
    );
}

/**
 * ============================================================================
 * CSV helpers
 * ============================================================================
 */

function csvEscape(
    value
) {
    if (
        value ===
            null ||
        value ===
            undefined
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

function mapCsvHeader(
    header
) {
    const mapping =
        {
            internal_id:
                "internal_id",

            tenant_id:
                "tenant_id",

            loan_id:
                "loan_id",

            transaction_id:
                "transaction_id",

            event_type:
                "event_type",

            amount_minor:
                "amount_minor",

            currency:
                "currency",

            timestamp:
                "created_at",

            payload:
                "payload",

            metadata:
                "metadata",

            idempotency_key:
                "idempotency_key"
        };

    return mapping[
        header
    ];
}

/**
 * ============================================================================
 * Factory
 * ============================================================================
 */

function createLoanAnalyticsRepository(
    deps = {}
) {
    return new LoanAnalyticsRepository(
        deps
    );
}

/**
 * ============================================================================
 * Export
 * ============================================================================
 */

module.exports =
    {
        LoanAnalyticsRepository,

        createLoanAnalyticsRepository,

        DEFAULTS,

        LOAN_EVENT_TYPES,

        PORTFOLIO_EVENT_TYPES,

        decimalToMinorUnits,

        minorUnitsToDecimal,

        currencyDecimals
    };