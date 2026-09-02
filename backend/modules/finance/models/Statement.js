"use strict";

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Finance Core - Enterprise Statement Model
 * ============================================================================
 *
 * File:
 * backend/modules/finance/models/Statement.js
 *
 * Purpose:
 * ----------------------------------------------------------------------------
 * Immutable financial statement source record.
 *
 * Architectural Rules
 * ----------------------------------------------------------------------------
 *
 * 1. Statement source identity is immutable after creation.
 * 2. Canonical source transactions are immutable after creation.
 * 3. Tenant isolation is mandatory for every repository operation.
 * 4. operationKey is the deterministic processing-coordination key.
 * 5. idempotencyKey uniquely identifies an ingestion request per tenant.
 * 6. Processing lifecycle transitions are atomic and state-controlled.
 * 7. Lifecycle timestamps must correspond to lifecycle state.
 * 8. Batch assignment is controlled and tenant-scoped.
 * 9. No financial balances are modified here.
 * 10. Statement ingestion does NOT post to the ledger.
 * 11. Actual accounting remains the responsibility of the Ledger Engine.
 *
 * Processing Lifecycle
 * ----------------------------------------------------------------------------
 *
 * RECEIVED
 *    │
 *    ├──────────────► DUPLICATE
 *    │
 *    ├──────────────► FAILED
 *    │
 *    ▼
 * PROCESSING
 *    │
 *    ├──────────────► DUPLICATE
 *    │
 *    ├──────────────► FAILED
 *    │
 *    ▼
 * IMPORTED
 *    │
 *    ├──────────────► FAILED
 *    │
 *    ▼
 * NORMALIZED
 *    │
 *    ├──────────────► FAILED
 *    │
 *    ▼
 * VALIDATED
 *    │
 *    ├──────────────► FAILED
 *    │
 *    ▼
 * PERSISTED
 *    │
 *    ├──────────────► BATCHED
 *    ├──────────────► COMPLETED
 *    ├──────────────► PARTIAL
 *    └──────────────► FAILED
 *
 * BATCHED
 *    │
 *    ├──────────────► COMPLETED
 *    ├──────────────► PARTIAL
 *    └──────────────► FAILED
 *
 * PARTIAL
 *    │
 *    ├──────────────► COMPLETED
 *    └──────────────► FAILED
 *
 * FAILED
 *    │
 *    └──────────────► PROCESSING
 *
 * COMPLETED / DUPLICATE
 *    └──────────────► terminal
 *
 * ============================================================================
 */

const crypto = require("crypto");
const mongoose = require("mongoose");

const {
    Schema
} = mongoose;

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const PROCESSING_STATUS =
    Object.freeze({
        RECEIVED: "RECEIVED",

        PROCESSING: "PROCESSING",

        IMPORTED: "IMPORTED",

        NORMALIZED: "NORMALIZED",

        VALIDATED: "VALIDATED",

        PERSISTED: "PERSISTED",

        BATCHED: "BATCHED",

        COMPLETED: "COMPLETED",

        DUPLICATE: "DUPLICATE",

        PARTIAL: "PARTIAL",

        FAILED: "FAILED"
    });

const SOURCE_TYPES =
    Object.freeze({
        BANK: "BANK",

        MTN_MOMO: "MTN_MOMO",

        AIRTEL_MONEY: "AIRTEL_MONEY",

        MANUAL: "MANUAL",

        API: "API",

        FILE: "FILE",

        UNKNOWN: "UNKNOWN"
    });

const TRANSACTION_DIRECTIONS =
    Object.freeze({
        DEBIT: "DEBIT",

        CREDIT: "CREDIT",

        UNKNOWN: "UNKNOWN"
    });

const ALLOWED_STATUS_TRANSITIONS =
    Object.freeze({
        [PROCESSING_STATUS.RECEIVED]:
            new Set([
                PROCESSING_STATUS.PROCESSING,
                PROCESSING_STATUS.DUPLICATE,
                PROCESSING_STATUS.FAILED
            ]),

        [PROCESSING_STATUS.PROCESSING]:
            new Set([
                PROCESSING_STATUS.IMPORTED,
                PROCESSING_STATUS.FAILED,
                PROCESSING_STATUS.DUPLICATE
            ]),

        [PROCESSING_STATUS.IMPORTED]:
            new Set([
                PROCESSING_STATUS.NORMALIZED,
                PROCESSING_STATUS.FAILED
            ]),

        [PROCESSING_STATUS.NORMALIZED]:
            new Set([
                PROCESSING_STATUS.VALIDATED,
                PROCESSING_STATUS.FAILED
            ]),

        [PROCESSING_STATUS.VALIDATED]:
            new Set([
                PROCESSING_STATUS.PERSISTED,
                PROCESSING_STATUS.FAILED
            ]),

        [PROCESSING_STATUS.PERSISTED]:
            new Set([
                PROCESSING_STATUS.BATCHED,
                PROCESSING_STATUS.COMPLETED,
                PROCESSING_STATUS.PARTIAL,
                PROCESSING_STATUS.FAILED
            ]),

        [PROCESSING_STATUS.BATCHED]:
            new Set([
                PROCESSING_STATUS.COMPLETED,
                PROCESSING_STATUS.PARTIAL,
                PROCESSING_STATUS.FAILED
            ]),

        [PROCESSING_STATUS.PARTIAL]:
            new Set([
                PROCESSING_STATUS.COMPLETED,
                PROCESSING_STATUS.FAILED
            ]),

        [PROCESSING_STATUS.COMPLETED]:
            new Set(),

        [PROCESSING_STATUS.DUPLICATE]:
            new Set(),

        [PROCESSING_STATUS.FAILED]:
            new Set([
                PROCESSING_STATUS.PROCESSING
            ])
    });

const TERMINAL_STATUSES =
    new Set([
        PROCESSING_STATUS.COMPLETED,
        PROCESSING_STATUS.DUPLICATE
    ]);

const IMMUTABLE_ROOT_PATHS =
    Object.freeze([
        "tenantId",

        "statementId",

        "operationKey",

        "idempotencyKey",

        "provider",

        "providerStatementId",

        "providerBatchId",

        "providerReference",

        "externalReference",

        "source",

        "currency",

        "statementDate",

        "periodStart",

        "periodEnd",

        "transactions",

        "inputFingerprint",

        "pipelineId",

        "statementTraceId",

        "correlationId",

        "requestId",

        "operationId",

        "receivedAt"
    ]);

const MAX_TENANT_ID_LENGTH = 256;

const MAX_STATEMENT_ID_LENGTH = 256;

const MAX_OPERATION_KEY_LENGTH = 512;

const MAX_IDEMPOTENCY_KEY_LENGTH = 512;

const MAX_REFERENCE_LENGTH = 256;

const MAX_DESCRIPTION_LENGTH = 2000;

const MAX_ERROR_MESSAGE_LENGTH = 2000;

const MAX_TRANSACTION_COUNT = 500000;

const MAX_METADATA_KEYS = 100;

const SHA256_LENGTH = 64;

/**
 * ============================================================================
 * Errors
 * ============================================================================
 */

class StatementError extends Error {

    constructor(
        message,
        {
            code =
                "STATEMENT_ERROR",

            status = 409,

            statementId = null,

            currentStatus = null,

            requestedStatus = null
        } = {}
    ) {

        super(message);

        this.name =
            "StatementError";

        this.code =
            code;

        this.status =
            status;

        this.statementId =
            statementId;

        this.currentStatus =
            currentStatus;

        this.requestedStatus =
            requestedStatus;

        this.isOperational =
            true;
    }
}

/**
 * ============================================================================
 * Utility Helpers
 * ============================================================================
 */

function normalizeRequiredString(
    value,
    field,
    maxLength
) {

    if (
        typeof value !== "string" ||
        value.trim().length === 0
    ) {

        throw new TypeError(
            `${field} is required`
        );
    }

    const normalized =
        value.trim();

    if (
        normalized.length >
        maxLength
    ) {

        throw new TypeError(
            `${field} exceeds maximum length`
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

        return undefined;
    }

    if (
        typeof value !== "string"
    ) {

        throw new TypeError(
            `${field} must be a string`
        );
    }

    const normalized =
        value.trim();

    if (
        normalized.length >
        maxLength
    ) {

        throw new TypeError(
            `${field} exceeds maximum length`
        );
    }

    return normalized;
}

function normalizeCurrency(
    value,
    field = "currency"
) {

    const normalized =
        normalizeRequiredString(
            value,
            field,
            3
        ).toUpperCase();

    if (
        !/^[A-Z]{3}$/.test(
            normalized
        )
    ) {

        throw new TypeError(
            `${field} must be a valid three-letter currency code`
        );
    }

    return normalized;
}

function normalizeDecimal(
    value,
    field
) {

    if (
        value === undefined ||
        value === null
    ) {

        return value;
    }

    try {

        const decimal =
            value instanceof mongoose.Types.Decimal128
                ? value
                : mongoose.Types.Decimal128.fromString(
                    String(value)
                );

        if (
            decimal.toString()
                .startsWith("-")
        ) {

            /**
             * Statement transaction amounts represent transaction magnitude.
             * Direction determines debit/credit semantics.
             */
            throw new TypeError(
                `${field} cannot be negative`
            );
        }

        return decimal;

    }
    catch (error) {

        if (
            error instanceof TypeError
        ) {

            throw error;
        }

        throw new TypeError(
            `${field} must be a valid decimal number`
        );
    }
}

function assertValidDate(
    value,
    field
) {

    if (
        value === undefined ||
        value === null
    ) {

        return;
    }

    const date =
        value instanceof Date
            ? value
            : new Date(value);

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {

        throw new TypeError(
            `${field} must be a valid date`
        );
    }

    return date;
}

function assertNoPrototypePollutionKeys(
    value,
    path = "metadata"
) {

    if (
        !value ||
        typeof value !== "object"
    ) {

        return;
    }

    const forbidden =
        new Set([
            "__proto__",
            "prototype",
            "constructor"
        ]);

    for (
        const key of Object.keys(value)
    ) {

        if (
            forbidden.has(key)
        ) {

            throw new TypeError(
                `${path}.${key} is not permitted`
            );
        }

        const child =
            value[key];

        if (
            child &&
            typeof child === "object"
        ) {

            assertNoPrototypePollutionKeys(
                child,
                `${path}.${key}`
            );
        }
    }
}

function validateMetadata(
    metadata
) {

    if (
        metadata === undefined ||
        metadata === null
    ) {

        return {};
    }

    if (
        typeof metadata !== "object" ||
        Array.isArray(metadata)
    ) {

        throw new TypeError(
            "processingMetadata must be an object"
        );
    }

    const keys =
        Object.keys(metadata);

    if (
        keys.length >
        MAX_METADATA_KEYS
    ) {

        throw new TypeError(
            "processingMetadata contains too many keys"
        );
    }

    assertNoPrototypePollutionKeys(
        metadata,
        "processingMetadata"
    );

    return metadata;
}

function createFingerprint(
    value
) {

    return crypto
        .createHash("sha256")
        .update(
            stableSerialize(
                value
            )
        )
        .digest("hex");
}

function stableSerialize(
    value
) {

    if (
        value === null ||
        value === undefined
    ) {

        return JSON.stringify(
            value
        );
    }

    if (
        value instanceof Date
    ) {

        return JSON.stringify(
            value.toISOString()
        );
    }

    if (
        value instanceof mongoose.Types.Decimal128
    ) {

        return JSON.stringify(
            value.toString()
        );
    }

    if (
        Array.isArray(value)
    ) {

        return `[${value
            .map(
                stableSerialize
            )
            .join(",")}]`;
    }

    if (
        typeof value === "object"
    ) {

        return `{${Object.keys(
            value
        )
            .sort()
            .map(
                key =>
                    `${JSON.stringify(
                        key
                    )}:${stableSerialize(
                        value[key]
                    )}`
            )
            .join(",")}}`;
    }

    return JSON.stringify(
        value
    );
}

/**
 * ============================================================================
 * Statement Transaction Schema
 * ============================================================================
 */

const StatementTransactionSchema =
    new Schema(
        {
            externalId: {
                type: String,
                required: true,
                immutable: true,
                trim: true,
                maxlength:
                    MAX_REFERENCE_LENGTH
            },

            reference: {
                type: String,
                trim: true,
                maxlength:
                    MAX_REFERENCE_LENGTH,
                immutable: true
            },

            amount: {
                type:
                    Schema.Types.Decimal128,
                required: true,
                immutable: true
            },

            currency: {
                type: String,
                required: true,
                immutable: true,
                uppercase: true,
                trim: true,
                minlength: 3,
                maxlength: 3
            },

            transactionDate: {
                type: Date,
                required: true,
                immutable: true
            },

            valueDate: {
                type: Date,
                immutable: true
            },

            description: {
                type: String,
                trim: true,
                maxlength:
                    MAX_DESCRIPTION_LENGTH,
                immutable: true
            },

            direction: {
                type: String,
                enum:
                    Object.values(
                        TRANSACTION_DIRECTIONS
                    ),
                default:
                    TRANSACTION_DIRECTIONS.UNKNOWN,
                immutable: true
            },

            balanceAfter: {
                type:
                    Schema.Types.Decimal128,
                immutable: true
            },

            providerReference: {
                type: String,
                trim: true,
                maxlength:
                    MAX_REFERENCE_LENGTH,
                immutable: true
            },

            metadata: {
                type:
                    Schema.Types.Mixed,
                immutable: true,
                default: undefined
            }
        },
        {
            _id: false,

            strict: "throw",

            minimize: false
        }
    );

/**
 * ============================================================================
 * Transaction Validation
 * ============================================================================
 */

StatementTransactionSchema.pre(
    "validate",
    function validateStatementTransaction(
        next
    ) {

        try {

            if (
                !this.externalId
            ) {

                throw new TypeError(
                    "transaction.externalId is required"
                );
            }

            this.amount =
                normalizeDecimal(
                    this.amount,
                    "transaction.amount"
                );

            if (
                this.amount ===
                undefined
            ) {

                throw new TypeError(
                    "transaction.amount is required"
                );
            }

            this.currency =
                normalizeCurrency(
                    this.currency,
                    "transaction.currency"
                );

            this.transactionDate =
                assertValidDate(
                    this.transactionDate,
                    "transaction.transactionDate"
                );

            this.valueDate =
                assertValidDate(
                    this.valueDate,
                    "transaction.valueDate"
                );

            this.balanceAfter =
                normalizeDecimal(
                    this.balanceAfter,
                    "transaction.balanceAfter"
                );

            if (
                this.metadata !==
                    undefined
            ) {

                assertNoPrototypePollutionKeys(
                    this.metadata,
                    "transaction.metadata"
                );
            }

            next();

        }
        catch (
            error
        ) {

            next(error);
        }
    }
);

/**
 * ============================================================================
 * Statement Schema
 * ============================================================================
 */

const StatementSchema =
    new Schema(
        {
            /**
             * ----------------------------------------------------------------
             * Tenant boundary
             * ----------------------------------------------------------------
             */

            tenantId: {
                type: String,
                required: true,
                trim: true,
                immutable: true,
                maxlength:
                    MAX_TENANT_ID_LENGTH,
                index: true
            },

            /**
             * ----------------------------------------------------------------
             * Stable statement identity
             * ----------------------------------------------------------------
             */

            statementId: {
                type: String,
                required: true,
                trim: true,
                immutable: true,
                maxlength:
                    MAX_STATEMENT_ID_LENGTH
            },

            /**
             * ----------------------------------------------------------------
             * Deterministic processing coordination key
             * ----------------------------------------------------------------
             */

            operationKey: {
                type: String,
                required: true,
                trim: true,
                immutable: true,
                maxlength:
                    MAX_OPERATION_KEY_LENGTH
            },

            /**
             * ----------------------------------------------------------------
             * Upstream idempotency identity
             * ----------------------------------------------------------------
             */

            idempotencyKey: {
                type: String,
                required: true,
                trim: true,
                immutable: true,
                maxlength:
                    MAX_IDEMPOTENCY_KEY_LENGTH
            },

            /**
             * ----------------------------------------------------------------
             * Provider identity
             * ----------------------------------------------------------------
             */

            provider: {
                type: String,
                enum:
                    Object.values(
                        SOURCE_TYPES
                    ),
                default:
                    SOURCE_TYPES.UNKNOWN,
                immutable: true,
                uppercase: true,
                trim: true
            },

            providerStatementId: {
                type: String,
                trim: true,
                immutable: true,
                maxlength:
                    MAX_STATEMENT_ID_LENGTH
            },

            providerBatchId: {
                type: String,
                trim: true,
                immutable: true,
                maxlength:
                    MAX_STATEMENT_ID_LENGTH
            },

            providerReference: {
                type: String,
                trim: true,
                immutable: true,
                maxlength:
                    MAX_REFERENCE_LENGTH
            },

            externalReference: {
                type: String,
                trim: true,
                immutable: true,
                maxlength:
                    MAX_REFERENCE_LENGTH
            },

            /**
             * ----------------------------------------------------------------
             * Source classification
             * ----------------------------------------------------------------
             */

            source: {
                type: String,
                enum:
                    Object.values(
                        SOURCE_TYPES
                    ),
                default:
                    SOURCE_TYPES.UNKNOWN,
                immutable: true,
                uppercase: true,
                trim: true
            },

            /**
             * ----------------------------------------------------------------
             * Statement accounting context
             * ----------------------------------------------------------------
             */

            currency: {
                type: String,
                uppercase: true,
                trim: true,
                minlength: 3,
                maxlength: 3,
                immutable: true
            },

            statementDate: {
                type: Date,
                immutable: true
            },

            periodStart: {
                type: Date,
                immutable: true
            },

            periodEnd: {
                type: Date,
                immutable: true
            },

            /**
             * ----------------------------------------------------------------
             * Immutable canonical source transactions
             * ----------------------------------------------------------------
             */

            transactions: {
                type:
                    [StatementTransactionSchema],

                default: undefined
            },

            /**
             * ----------------------------------------------------------------
             * Processing lifecycle
             * ----------------------------------------------------------------
             */

            processingStatus: {
                type: String,
                enum:
                    Object.values(
                        PROCESSING_STATUS
                    ),
                default:
                    PROCESSING_STATUS.RECEIVED,
                required: true,
                index: true
            },

            /**
             * ----------------------------------------------------------------
             * Operational processing metadata
             * ----------------------------------------------------------------
             */

            processingMetadata: {
                type:
                    Schema.Types.Mixed,

                default: () => ({})
            },

            /**
             * ----------------------------------------------------------------
             * Immutable canonical source fingerprint
             * ----------------------------------------------------------------
             */

            inputFingerprint: {
                type: String,
                trim: true,
                immutable: true,
                minlength:
                    SHA256_LENGTH,
                maxlength:
                    SHA256_LENGTH
            },

            /**
             * ----------------------------------------------------------------
             * Distributed correlation identity
             * ----------------------------------------------------------------
             */

            pipelineId: {
                type: String,
                trim: true,
                immutable: true,
                maxlength: 256
            },

            statementTraceId: {
                type: String,
                trim: true,
                immutable: true,
                maxlength: 256
            },

            correlationId: {
                type: String,
                trim: true,
                immutable: true,
                maxlength: 256
            },

            requestId: {
                type: String,
                trim: true,
                immutable: true,
                maxlength: 256
            },

            operationId: {
                type: String,
                trim: true,
                immutable: true,
                maxlength: 256
            },

            /**
             * ----------------------------------------------------------------
             * Batch reference
             *
             * This is operational state, not source data.
             * ----------------------------------------------------------------
             */

            batchId: {
                type: String,
                trim: true,
                maxlength: 256,
                index: true
            },

            /**
             * ----------------------------------------------------------------
             * Lifecycle timestamps
             * ----------------------------------------------------------------
             */

            receivedAt: {
                type: Date,
                default: Date.now,
                immutable: true
            },

            importedAt: {
                type: Date,
                immutable: true
            },

            normalizedAt: {
                type: Date,
                immutable: true
            },

            validatedAt: {
                type: Date,
                immutable: true
            },

            persistedAt: {
                type: Date,
                immutable: true
            },

            completedAt: {
                type: Date
            },

            failedAt: {
                type: Date
            },

            /**
             * ----------------------------------------------------------------
             * Last processing failure
             * ----------------------------------------------------------------
             */

            lastError: {
                code: {
                    type: String,
                    trim: true,
                    maxlength: 256
                },

                message: {
                    type: String,
                    trim: true,
                    maxlength:
                        MAX_ERROR_MESSAGE_LENGTH
                },

                stage: {
                    type: String,
                    trim: true,
                    maxlength: 128
                },

                retryable: {
                    type: Boolean,
                    default: false
                }
            },

            /**
             * ----------------------------------------------------------------
             * Processing attempt count
             * ----------------------------------------------------------------
             */

            attemptCount: {
                type: Number,
                default: 0,
                min: 0,
                max: 100000
            },

            /**
             * ----------------------------------------------------------------
             * Application lifecycle version
             * ----------------------------------------------------------------
             *
             * This version is advanced only through controlled lifecycle
             * operations.
             * ----------------------------------------------------------------
             */

            version: {
                type: Number,
                default: 1,
                min: 1
            }
        },
        {
            timestamps: true,

            strict: "throw",

            minimize: false,

            optimisticConcurrency: true,

            versionKey: "__v"
        }
    );

/**
 * ============================================================================
 * Indexes
 * ============================================================================
 */

/**
 * Canonical operation identity.
 */
StatementSchema.index(
    {
        tenantId: 1,
        operationKey: 1
    },
    {
        unique: true,
        name:
            "uq_statement_tenant_operation_key"
    }
);

/**
 * Canonical idempotency identity.
 */
StatementSchema.index(
    {
        tenantId: 1,
        idempotencyKey: 1
    },
    {
        unique: true,
        name:
            "uq_statement_tenant_idempotency_key"
    }
);

/**
 * Provider statement identity.
 */
StatementSchema.index(
    {
        tenantId: 1,
        provider: 1,
        providerStatementId: 1
    },
    {
        unique: true,
        sparse: true,
        name:
            "uq_statement_provider_statement"
    }
);

/**
 * Provider reference.
 */
StatementSchema.index(
    {
        tenantId: 1,
        provider: 1,
        providerReference: 1
    },
    {
        unique: true,
        sparse: true,
        name:
            "uq_statement_provider_reference"
    }
);

/**
 * Processing queue lookup.
 */
StatementSchema.index(
    {
        tenantId: 1,
        processingStatus: 1,
        receivedAt: -1
    },
    {
        name:
            "ix_statement_processing_status"
    }
);

/**
 * Batch processing.
 */
StatementSchema.index(
    {
        tenantId: 1,
        batchId: 1,
        receivedAt: 1
    },
    {
        name:
            "ix_statement_batch"
    }
);

/**
 * Statement date reporting.
 */
StatementSchema.index(
    {
        tenantId: 1,
        statementDate: -1
    },
    {
        name:
            "ix_statement_date"
    }
);

/**
 * General tenant history.
 */
StatementSchema.index(
    {
        tenantId: 1,
        createdAt: -1
    },
    {
        name:
            "ix_statement_created_at"
    }
);

/**
 * Correlation lookup.
 */
StatementSchema.index(
    {
        tenantId: 1,
        correlationId: 1
    },
    {
        sparse: true,
        name:
            "ix_statement_correlation"
    }
);

/**
 * ============================================================================
 * Statement Validation
 * ============================================================================
 */

StatementSchema.pre(
    "validate",
    function validateStatement(
        next
    ) {

        try {

            /**
             * --------------------------------------------------------------
             * Identity
             * --------------------------------------------------------------
             */

            this.tenantId =
                normalizeRequiredString(
                    this.tenantId,
                    "tenantId",
                    MAX_TENANT_ID_LENGTH
                );

            this.statementId =
                normalizeRequiredString(
                    this.statementId,
                    "statementId",
                    MAX_STATEMENT_ID_LENGTH
                );

            this.operationKey =
                normalizeRequiredString(
                    this.operationKey,
                    "operationKey",
                    MAX_OPERATION_KEY_LENGTH
                );

            this.idempotencyKey =
                normalizeRequiredString(
                    this.idempotencyKey,
                    "idempotencyKey",
                    MAX_IDEMPOTENCY_KEY_LENGTH
                );

            /**
             * --------------------------------------------------------------
             * Provider/source
             * --------------------------------------------------------------
             */

            if (
                this.provider
            ) {

                this.provider =
                    normalizeRequiredString(
                        this.provider,
                        "provider",
                        128
                    ).toUpperCase();
            }

            if (
                this.source
            ) {

                this.source =
                    normalizeRequiredString(
                        this.source,
                        "source",
                        128
                    ).toUpperCase();
            }

            /**
             * --------------------------------------------------------------
             * Currency
             * --------------------------------------------------------------
             */

            if (
                this.currency
            ) {

                this.currency =
                    normalizeCurrency(
                        this.currency
                    );
            }

            /**
             * --------------------------------------------------------------
             * Dates
             * --------------------------------------------------------------
             */

            this.statementDate =
                assertValidDate(
                    this.statementDate,
                    "statementDate"
                );

            this.periodStart =
                assertValidDate(
                    this.periodStart,
                    "periodStart"
                );

            this.periodEnd =
                assertValidDate(
                    this.periodEnd,
                    "periodEnd"
                );

            if (
                this.periodStart &&
                this.periodEnd &&
                this.periodEnd <
                    this.periodStart
            ) {

                throw new TypeError(
                    "periodEnd cannot be earlier than periodStart"
                );
            }

            /**
             * --------------------------------------------------------------
             * Transactions
             * --------------------------------------------------------------
             */

            if (
                this.transactions !==
                    undefined
            ) {

                if (
                    !Array.isArray(
                        this.transactions
                    )
                ) {

                    throw new TypeError(
                        "transactions must be an array"
                    );
                }

                if (
                    this.transactions.length >
                    MAX_TRANSACTION_COUNT
                ) {

                    throw new TypeError(
                        `transactions cannot exceed ${MAX_TRANSACTION_COUNT} records`
                    );
                }

                const externalIds =
                    new Set();

                for (
                    const transaction
                    of this.transactions
                ) {

                    if (
                        externalIds.has(
                            transaction.externalId
                        )
                    ) {

                        throw new TypeError(
                            `Duplicate transaction externalId: ${transaction.externalId}`
                        );
                    }

                    externalIds.add(
                        transaction.externalId
                    );

                    if (
                        this.currency &&
                        transaction.currency !==
                            this.currency
                    ) {

                        throw new TypeError(
                            "Statement transaction currencies must match statement currency"
                        );
                    }
                }
            }

            /**
             * --------------------------------------------------------------
             * Input fingerprint
             * --------------------------------------------------------------
             *
             * If supplied, it must look like SHA-256.
             */
            if (
                this.inputFingerprint &&
                !/^[a-fA-F0-9]{64}$/.test(
                    this.inputFingerprint
                )
            ) {

                throw new TypeError(
                    "inputFingerprint must be a SHA-256 hexadecimal fingerprint"
                );
            }

            /**
             * --------------------------------------------------------------
             * Processing metadata
             * --------------------------------------------------------------
             */

            this.processingMetadata =
                validateMetadata(
                    this.processingMetadata
                );

            /**
             * --------------------------------------------------------------
             * Lifecycle timestamp consistency
             * --------------------------------------------------------------
             */

            validateLifecycleConsistency(
                this
            );

            next();

        }
        catch (
            error
        ) {

            next(error);
        }
    }
);

/**
 * ============================================================================
 * Lifecycle Consistency
 * ============================================================================
 */

function validateLifecycleConsistency(
    statement
) {

    const status =
        statement.processingStatus;

    if (
        status ===
            PROCESSING_STATUS.IMPORTED &&
        !statement.importedAt
    ) {

        throw new TypeError(
            "importedAt is required when processingStatus is IMPORTED"
        );
    }

    if (
        [
            PROCESSING_STATUS.NORMALIZED,
            PROCESSING_STATUS.VALIDATED,
            PROCESSING_STATUS.PERSISTED,
            PROCESSING_STATUS.BATCHED,
            PROCESSING_STATUS.PARTIAL,
            PROCESSING_STATUS.COMPLETED
        ].includes(status) &&
        !statement.importedAt
    ) {

        throw new TypeError(
            "importedAt is required for this lifecycle state"
        );
    }

    if (
        [
            PROCESSING_STATUS.VALIDATED,
            PROCESSING_STATUS.PERSISTED,
            PROCESSING_STATUS.BATCHED,
            PROCESSING_STATUS.PARTIAL,
            PROCESSING_STATUS.COMPLETED
        ].includes(status) &&
        !statement.normalizedAt
    ) {

        throw new TypeError(
            "normalizedAt is required for this lifecycle state"
        );
    }

    if (
        [
            PROCESSING_STATUS.PERSISTED,
            PROCESSING_STATUS.BATCHED,
            PROCESSING_STATUS.PARTIAL,
            PROCESSING_STATUS.COMPLETED
        ].includes(status) &&
        !statement.validatedAt
    ) {

        throw new TypeError(
            "validatedAt is required for this lifecycle state"
        );
    }

    if (
        [
            PROCESSING_STATUS.BATCHED,
            PROCESSING_STATUS.COMPLETED,
            PROCESSING_STATUS.PARTIAL
        ].includes(status) &&
        !statement.persistedAt
    ) {

        throw new TypeError(
            "persistedAt is required for this lifecycle state"
        );
    }

    if (
        status ===
            PROCESSING_STATUS.BATCHED &&
        !statement.batchId
    ) {

        throw new TypeError(
            "batchId is required when processingStatus is BATCHED"
        );
    }

    if (
        status ===
            PROCESSING_STATUS.COMPLETED &&
        !statement.completedAt
    ) {

        throw new TypeError(
            "completedAt is required when processingStatus is COMPLETED"
        );
    }

    if (
        status ===
            PROCESSING_STATUS.FAILED &&
        !statement.failedAt
    ) {

        throw new TypeError(
            "failedAt is required when processingStatus is FAILED"
        );
    }
}

/**
 * ============================================================================
 * Immutable Update Guard
 * ============================================================================
 *
 * The model deliberately prevents generic update operations from mutating
 * source identity or source transactions.
 *
 * Lifecycle fields are also protected from arbitrary updates.
 *
 * Callers should use the explicit static lifecycle methods below.
 * ============================================================================
 */

const GUARDED_PATHS =
    new Set([
        ...IMMUTABLE_ROOT_PATHS,

        "processingStatus",

        "processingMetadata",

        "batchId",

        "importedAt",

        "normalizedAt",

        "validatedAt",

        "persistedAt",

        "completedAt",

        "failedAt",

        "lastError",

        "attemptCount",

        "version"
    ]);

function collectChangedPaths(
    update
) {

    const changed =
        new Set();

    if (
        !update ||
        typeof update !== "object"
    ) {

        return changed;
    }

    const directOperators = [
        "$set",
        "$setOnInsert",
        "$unset",
        "$inc",
        "$mul",
        "$min",
        "$max",
        "$push",
        "$pushAll",
        "$addToSet",
        "$pop",
        "$pull",
        "$pullAll",
        "$rename"
    ];

    for (
        const operator
        of directOperators
    ) {

        const payload =
            update[operator];

        if (
            !payload ||
            typeof payload !== "object"
        ) {

            continue;
        }

        for (
            const path
            of Object.keys(
                payload
            )
        ) {

            changed.add(
                path
            );
        }
    }

    return changed;
}

function assertGuardedUpdate(
    update
) {

    const changed =
        collectChangedPaths(
            update
        );

    const forbidden =
        [];

    for (
        const path
        of changed
    ) {

        const root =
            path.split(".")[0];

        if (
            GUARDED_PATHS.has(
                root
            )
        ) {

            forbidden.push(
                path
            );
        }
    }

    if (
        forbidden.length > 0
    ) {

        throw new StatementError(
            `Direct statement field mutation is prohibited: ${forbidden.join(", ")}`,
            {
                code:
                    "DIRECT_STATEMENT_MUTATION_FORBIDDEN"
            }
        );
    }
}

/**
 * ============================================================================
 * Generic Update Protection
 * ============================================================================
 */

for (
    const hookName
    of [
        "updateOne",
        "updateMany",
        "findOneAndUpdate",
        "findByIdAndUpdate"
    ]
) {

    StatementSchema.pre(
        hookName,
        function protectDirectMutation(
            next
        ) {

            try {

                assertGuardedUpdate(
                    this.getUpdate()
                );

                next();

            }
            catch (
                error
            ) {

                next(error);
            }
        }
    );
}

/**
 * ============================================================================
 * Query Safety
 * ============================================================================
 *
 * A caller should not be able to accidentally retrieve a statement from
 * another tenant using the generic repository methods.
 *
 * These helpers do not override arbitrary Mongoose queries; tenant-safe
 * statics below are preferred for application code.
 * ============================================================================
 */

StatementSchema.statics.findByTenantAndId =
    async function findByTenantAndId(
        tenantId,
        statementId,
        options = {}
    ) {

        tenantId =
            normalizeRequiredString(
                tenantId,
                "tenantId",
                MAX_TENANT_ID_LENGTH
            );

        statementId =
            normalizeRequiredString(
                statementId,
                "statementId",
                MAX_STATEMENT_ID_LENGTH
            );

        return this.findOne(
            {
                tenantId,
                statementId
            },
            null,
            options
        );
    };

StatementSchema.statics.findByOperationKey =
    async function findByOperationKey(
        tenantId,
        operationKey,
        options = {}
    ) {

        tenantId =
            normalizeRequiredString(
                tenantId,
                "tenantId",
                MAX_TENANT_ID_LENGTH
            );

        operationKey =
            normalizeRequiredString(
                operationKey,
                "operationKey",
                MAX_OPERATION_KEY_LENGTH
            );

        return this.findOne(
            {
                tenantId,
                operationKey
            },
            null,
            options
        );
    };

StatementSchema.statics.findByIdempotencyKey =
    async function findByIdempotencyKey(
        tenantId,
        idempotencyKey,
        options = {}
    ) {

        tenantId =
            normalizeRequiredString(
                tenantId,
                "tenantId",
                MAX_TENANT_ID_LENGTH
            );

        idempotencyKey =
            normalizeRequiredString(
                idempotencyKey,
                "idempotencyKey",
                MAX_IDEMPOTENCY_KEY_LENGTH
            );

        return this.findOne(
            {
                tenantId,
                idempotencyKey
            },
            null,
            options
        );
    };

/**
 * ============================================================================
 * CREATE
 * ============================================================================
 *
 * Creates the immutable source record.
 *
 * inputFingerprint is generated when not supplied.
 * ============================================================================
 */

StatementSchema.statics.createStatement =
    async function createStatement(
        payload,
        options = {}
    ) {

        if (
            !payload ||
            typeof payload !== "object" ||
            Array.isArray(payload)
        ) {

            throw new TypeError(
                "Statement payload must be an object"
            );
        }

        const data = {
            ...payload
        };

        data.tenantId =
            normalizeRequiredString(
                data.tenantId,
                "tenantId",
                MAX_TENANT_ID_LENGTH
            );

        data.statementId =
            normalizeRequiredString(
                data.statementId,
                "statementId",
                MAX_STATEMENT_ID_LENGTH
            );

        data.operationKey =
            normalizeRequiredString(
                data.operationKey,
                "operationKey",
                MAX_OPERATION_KEY_LENGTH
            );

        data.idempotencyKey =
            normalizeRequiredString(
                data.idempotencyKey,
                "idempotencyKey",
                MAX_IDEMPOTENCY_KEY_LENGTH
            );

        if (
            data.currency
        ) {

            data.currency =
                normalizeCurrency(
                    data.currency
                );
        }

        if (
            data.transactions &&
            Array.isArray(
                data.transactions
            )
        ) {

            data.transactions =
                data.transactions.map(
                    transaction => ({
                        ...transaction,

                        amount:
                            normalizeDecimal(
                                transaction.amount,
                                "transaction.amount"
                            ),

                        balanceAfter:
                            normalizeDecimal(
                                transaction.balanceAfter,
                                "transaction.balanceAfter"
                            ),

                        currency:
                            normalizeCurrency(
                                transaction.currency,
                                "transaction.currency"
                            ),

                        transactionDate:
                            assertValidDate(
                                transaction.transactionDate,
                                "transaction.transactionDate"
                            ),

                        valueDate:
                            assertValidDate(
                                transaction.valueDate,
                                "transaction.valueDate"
                            )
                    })
                );
        }

        if (
            !data.inputFingerprint
        ) {

            data.inputFingerprint =
                createFingerprint({
                    tenantId:
                        data.tenantId,

                    statementId:
                        data.statementId,

                    operationKey:
                        data.operationKey,

                    idempotencyKey:
                        data.idempotencyKey,

                    provider:
                        data.provider,

                    providerStatementId:
                        data.providerStatementId,

                    providerBatchId:
                        data.providerBatchId,

                    providerReference:
                        data.providerReference,

                    externalReference:
                        data.externalReference,

                    source:
                        data.source,

                    currency:
                        data.currency,

                    statementDate:
                        data.statementDate,

                    periodStart:
                        data.periodStart,

                    periodEnd:
                        data.periodEnd,

                    transactions:
                        data.transactions
                });
        }

        const statement =
            new this(data);

        return statement.save(
            options
        );
    };

/**
 * ============================================================================
 * ATOMIC STATUS TRANSITION
 * ============================================================================
 *
 * This is the primary lifecycle API.
 *
 * IMPORTANT:
 * ----------------------------------------------------------------------------
 * The expected status must be supplied by the caller.
 *
 * MongoDB therefore performs:
 *
 * WHERE tenantId = X
 *   AND statementId = Y
 *   AND processingStatus = expectedStatus
 *
 * SET processingStatus = nextStatus
 *
 * This closes the read/modify/write race.
 * ============================================================================
 */

StatementSchema.statics.transitionStatus =
    async function transitionStatus(
        {
            tenantId,

            statementId,

            from,

            to,

            metadata = undefined,

            error = undefined,

            batchId = undefined,

            result = undefined
        }
    ) {

        tenantId =
            normalizeRequiredString(
                tenantId,
                "tenantId",
                MAX_TENANT_ID_LENGTH
            );

        statementId =
            normalizeRequiredString(
                statementId,
                "statementId",
                MAX_STATEMENT_ID_LENGTH
            );

        if (
            !this.isValidStatusTransition(
                from,
                to
            )
        ) {

            throw new StatementError(
                `Invalid statement status transition: ${from} -> ${to}`,
                {
                    code:
                        "INVALID_STATEMENT_STATUS_TRANSITION",
                    currentStatus:
                        from,
                    requestedStatus:
                        to,
                    statementId
                }
            );
        }

        const now =
            new Date();

        const update = {
            $set: {
                processingStatus:
                    to,

                version:
                    1
            },

            $inc: {
                attemptCount:
                    to ===
                    PROCESSING_STATUS.PROCESSING
                        ? 1
                        : 0
            }
        };

        /**
         * Increment application version based on the current stored value.
         */
        delete update.$set.version;

        update.$set.version =
            1;

        /**
         * Lifecycle timestamp handling.
         */
        switch (to) {

            case PROCESSING_STATUS.IMPORTED:

                update.$set.importedAt =
                    now;

                break;

            case PROCESSING_STATUS.NORMALIZED:

                update.$set.normalizedAt =
                    now;

                break;

            case PROCESSING_STATUS.VALIDATED:

                update.$set.validatedAt =
                    now;

                break;

            case PROCESSING_STATUS.PERSISTED:

                update.$set.persistedAt =
                    now;

                break;

            case PROCESSING_STATUS.BATCHED:

                if (
                    !batchId
                ) {

                    throw new StatementError(
                        "batchId is required for BATCHED state.",
                        {
                            code:
                                "BATCH_ID_REQUIRED",
                            statementId
                        }
                    );
                }

                update.$set.batchId =
                    normalizeRequiredString(
                        batchId,
                        "batchId",
                        256
                    );

                break;

            case PROCESSING_STATUS.COMPLETED:

                update.$set.completedAt =
                    now;

                break;

            case PROCESSING_STATUS.PARTIAL:

                break;

            case PROCESSING_STATUS.FAILED:

                update.$set.failedAt =
                    now;

                if (
                    error !== undefined
                ) {

                    update.$set.lastError =
                        normalizeError(
                            error
                        );
                }

                break;

            case PROCESSING_STATUS.DUPLICATE:

                break;

            default:

                break;
        }

        /**
         * Metadata is explicitly controlled.
         */
        if (
            metadata !== undefined
        ) {

            update.$set.processingMetadata =
                validateMetadata(
                    metadata
                );
        }

        /**
         * Clear failure metadata when processing successfully progresses.
         */
        if (
            to !==
                PROCESSING_STATUS.FAILED &&
            to !==
                PROCESSING_STATUS.PARTIAL
        ) {

            update.$unset = {
                lastError: 1,
                failedAt: 1
            };
        }

        /**
         * Bump application version atomically.
         *
         * version itself is not blindly assigned here; it is incremented.
         */
        update.$inc.version = 1;

        const updated =
            await this.findOneAndUpdate(
                {
                    tenantId,
                    statementId,

                    processingStatus:
                        from
                },

                update,

                {
                    new: true,

                    runValidators:
                        true,

                    context: "query"
                }
            );

        if (!updated) {

            const current =
                await this.findOne(
                    {
                        tenantId,
                        statementId
                    }
                )
                    .select(
                        "processingStatus statementId tenantId"
                    )
                    .lean();

            if (
                !current
            ) {

                throw new StatementError(
                    "Statement not found.",
                    {
                        code:
                            "STATEMENT_NOT_FOUND",
                        status: 404,
                        statementId
                    }
                );
            }

            throw new StatementError(
                `Statement transition rejected because the current status is ${current.processingStatus}. Expected ${from}.`,
                {
                    code:
                        "STATEMENT_STATUS_CONFLICT",
                    status: 409,
                    statementId,
                    currentStatus:
                        current.processingStatus,
                    requestedStatus:
                        to
                }
            );
        }

        /**
         * If a result object is needed for the upper layer, merge it here
         * without storing arbitrary financial data in this model.
         */
        return result !== undefined
            ? {
                statement:
                    updated,

                result
            }
            : updated;
    };

/**
 * ============================================================================
 * START PROCESSING
 * ============================================================================
 */

StatementSchema.statics.startProcessing =
    async function startProcessing(
        {
            tenantId,
            statementId
        }
    ) {

        return this.transitionStatus({
            tenantId,
            statementId,

            from:
                PROCESSING_STATUS.RECEIVED,

            to:
                PROCESSING_STATUS.PROCESSING
        });
    };

/**
 * ============================================================================
 * IMPORT
 * ============================================================================
 */

StatementSchema.statics.markImported =
    async function markImported(
        {
            tenantId,
            statementId
        }
    ) {

        return this.transitionStatus({
            tenantId,
            statementId,

            from:
                PROCESSING_STATUS.PROCESSING,

            to:
                PROCESSING_STATUS.IMPORTED
        });
    };

/**
 * ============================================================================
 * NORMALIZE
 * ============================================================================
 */

StatementSchema.statics.markNormalized =
    async function markNormalized(
        {
            tenantId,
            statementId
        }
    ) {

        return this.transitionStatus({
            tenantId,
            statementId,

            from:
                PROCESSING_STATUS.IMPORTED,

            to:
                PROCESSING_STATUS.NORMALIZED
        });
    };

/**
 * ============================================================================
 * VALIDATE
 * ============================================================================
 */

StatementSchema.statics.markValidated =
    async function markValidated(
        {
            tenantId,
            statementId
        }
    ) {

        return this.transitionStatus({
            tenantId,
            statementId,

            from:
                PROCESSING_STATUS.NORMALIZED,

            to:
                PROCESSING_STATUS.VALIDATED
        });
    };

/**
 * ============================================================================
 * PERSIST
 * ============================================================================
 */

StatementSchema.statics.markPersisted =
    async function markPersisted(
        {
            tenantId,
            statementId
        }
    ) {

        return this.transitionStatus({
            tenantId,
            statementId,

            from:
                PROCESSING_STATUS.VALIDATED,

            to:
                PROCESSING_STATUS.PERSISTED
        });
    };

/**
 * ============================================================================
 * BATCH
 * ============================================================================
 */

StatementSchema.statics.markBatched =
    async function markBatched(
        {
            tenantId,
            statementId,
            batchId
        }
    ) {

        return this.transitionStatus({
            tenantId,
            statementId,

            from:
                PROCESSING_STATUS.PERSISTED,

            to:
                PROCESSING_STATUS.BATCHED,

            batchId
        });
    };

/**
 * ============================================================================
 * COMPLETE
 * ============================================================================
 */

StatementSchema.statics.complete =
    async function complete(
        {
            tenantId,
            statementId
        }
    ) {

        const current =
            await this.findOne({
                tenantId,
                statementId
            })
                .select(
                    "processingStatus"
                )
                .lean();

        if (
            !current
        ) {

            throw new StatementError(
                "Statement not found.",
                {
                    code:
                        "STATEMENT_NOT_FOUND",
                    status: 404,
                    statementId
                }
            );
        }

        if (
            TERMINAL_STATUSES.has(
                current.processingStatus
            )
        ) {

            return this.findOne({
                tenantId,
                statementId
            });
        }

        return this.transitionStatus({
            tenantId,
            statementId,

            from:
                current.processingStatus,

            to:
                PROCESSING_STATUS.COMPLETED
        });
    };

/**
 * ============================================================================
 * MARK PARTIAL
 * ============================================================================
 */

StatementSchema.statics.markPartial =
    async function markPartial(
        {
            tenantId,
            statementId,
            error = undefined
        }
    ) {

        const current =
            await this.findOne({
                tenantId,
                statementId
            })
                .select(
                    "processingStatus"
                )
                .lean();

        if (
            !current
        ) {

            throw new StatementError(
                "Statement not found.",
                {
                    code:
                        "STATEMENT_NOT_FOUND",
                    status: 404,
                    statementId
                }
            );
        }

        return this.transitionStatus({
            tenantId,
            statementId,

            from:
                current.processingStatus,

            to:
                PROCESSING_STATUS.PARTIAL,

            error
        });
    };

/**
 * ============================================================================
 * MARK DUPLICATE
 * ============================================================================
 */

StatementSchema.statics.markDuplicate =
    async function markDuplicate(
        {
            tenantId,
            statementId,
            duplicateOf = undefined
        }
    ) {

        return this.transitionStatus({
            tenantId,
            statementId,

            from:
                PROCESSING_STATUS.RECEIVED,

            to:
                PROCESSING_STATUS.DUPLICATE,

            metadata:
                duplicateOf
                    ? {
                        duplicateOf
                    }
                    : undefined
        });
    };

/**
 * ============================================================================
 * MARK FAILED
 * ============================================================================
 */

StatementSchema.statics.fail =
    async function fail(
        {
            tenantId,
            statementId,
            error
        }
    ) {

        const current =
            await this.findOne({
                tenantId,
                statementId
            })
                .select(
                    "processingStatus"
                )
                .lean();

        if (
            !current
        ) {

            throw new StatementError(
                "Statement not found.",
                {
                    code:
                        "STATEMENT_NOT_FOUND",
                    status: 404,
                    statementId
                }
            );
        }

        if (
            TERMINAL_STATUSES.has(
                current.processingStatus
            )
        ) {

            throw new StatementError(
                "A terminal statement cannot be failed.",
                {
                    code:
                        "TERMINAL_STATEMENT_IMMUTABLE",
                    statementId,
                    currentStatus:
                        current.processingStatus
                }
            );
        }

        return this.transitionStatus({
            tenantId,
            statementId,

            from:
                current.processingStatus,

            to:
                PROCESSING_STATUS.FAILED,

            error
        });
    };

/**
 * ============================================================================
 * RETRY FAILED STATEMENT
 * ============================================================================
 */

StatementSchema.statics.retry =
    async function retry(
        {
            tenantId,
            statementId
        }
    ) {

        return this.transitionStatus({
            tenantId,
            statementId,

            from:
                PROCESSING_STATUS.FAILED,

            to:
                PROCESSING_STATUS.PROCESSING
        });
    };

/**
 * ============================================================================
 * BATCH OWNERSHIP HELPER
 * ============================================================================
 *
 * Assigns a batch only when the statement is in PERSISTED.
 *
 * This should normally be invoked by StatementBatchManager / Statement
 * Processing Service rather than controllers.
 * ============================================================================
 */

StatementSchema.statics.claimForBatch =
    async function claimForBatch(
        {
            tenantId,
            statementId,
            batchId
        }
    ) {

        return this.markBatched({
            tenantId,
            statementId,
            batchId
        });
    };

/**
 * ============================================================================
 * ERROR NORMALIZATION
 * ============================================================================
 */

function normalizeError(
    error
) {

    if (
        !error
    ) {

        return {
            code:
                "UNKNOWN_ERROR",

            message:
                "Unknown statement processing error",

            retryable:
                false
        };
    }

    return {
        code:
            normalizeOptionalString(
                error.code,
                "error.code",
                256
            ),

        message:
            normalizeOptionalString(
                error.message,
                "error.message",
                MAX_ERROR_MESSAGE_LENGTH
            ),

        stage:
            normalizeOptionalString(
                error.stage,
                "error.stage",
                128
            ),

        retryable:
            Boolean(
                error.retryable
            )
    };
}

/**
 * ============================================================================
 * Safe Serialization
 * ============================================================================
 *
 * Prevents claim-like operational secrets from leaking if future fields are
 * added to the statement document.
 * ============================================================================
 */

StatementSchema.set(
    "toJSON",
    {
        transform:
            function transform(
                doc,
                ret
            ) {

                delete ret.__v;

                return ret;
            }
    }
);

/**
 * ============================================================================
 * Static API
 * ============================================================================
 */

StatementSchema.statics.PROCESSING_STATUS =
    PROCESSING_STATUS;

StatementSchema.statics.SOURCE_TYPES =
    SOURCE_TYPES;

StatementSchema.statics.TRANSACTION_DIRECTIONS =
    TRANSACTION_DIRECTIONS;

StatementSchema.statics.ALLOWED_STATUS_TRANSITIONS =
    ALLOWED_STATUS_TRANSITIONS;

StatementSchema.statics.TERMINAL_STATUSES =
    TERMINAL_STATUSES;

StatementSchema.statics.StatementError =
    StatementError;

/**
 * ============================================================================
 * Model
 * ============================================================================
 */

const Statement =
    mongoose.models.Statement ||
    mongoose.model(
        "Statement",
        StatementSchema
    );

module.exports =
    Statement;