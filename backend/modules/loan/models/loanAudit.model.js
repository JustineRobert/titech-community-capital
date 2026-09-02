"use strict";

const mongoose = require("mongoose");
const crypto = require("crypto");

const { Schema } = mongoose;

/**
 * ============================================================================
 * TITech Community Capital LTD
 * African Community Finance Operating System (ACFOS)
 * ============================================================================
 *
 * File:
 *   backend/modules/loans/models/loanAudit.model.js
 *
 * Purpose:
 *   Enterprise immutable, tenant-isolated, tamper-evident loan audit
 *   evidence model.
 *
 * Architectural boundary:
 *
 *   Loan Service
 *        │
 *        ├── Authorization
 *        ├── Workflow
 *        ├── Financial Posting
 *        ├── Payment Execution
 *        └── External Side Effects
 *                    │
 *                    ▼
 *              LoanAudit.recordEvent()
 *                    │
 *                    ▼
 *             Immutable Evidence
 *
 * This model records evidence.
 *
 * It does NOT:
 *
 *   - authorize loans
 *   - approve transactions
 *   - mutate loan balances
 *   - post ledger entries
 *   - execute mobile-money payments
 *   - perform external side effects
 *   - resolve business workflow
 *
 * Enterprise guarantees:
 *
 *   ✓ Multi-tenant isolation
 *   ✓ Append-only persistence
 *   ✓ Query mutation protection
 *   ✓ insertMany protection
 *   ✓ bulkWrite protection
 *   ✓ Delete protection
 *   ✓ Idempotent event recording
 *   ✓ Idempotency payload conflict detection
 *   ✓ Duplicate-key race recovery
 *   ✓ Deterministic canonical hashing
 *   ✓ SHA-256 integrity verification
 *   ✓ Per-loan hash chain
 *   ✓ Monotonic per-loan sequence
 *   ✓ Decimal128 financial snapshots
 *   ✓ Metadata size/depth protection
 *   ✓ MongoDB field/operator protection
 *   ✓ Tenant-safe queries
 *   ✓ Bounded pagination
 *   ✓ Cursor pagination
 *   ✓ Correlation tracing
 *   ✓ Regulatory reporting indexes
 *
 * Important:
 *
 *   Application-level immutability is NOT equivalent to database-level WORM.
 *   Production compliance should additionally use:
 *
 *   - database RBAC
 *   - restricted administrative privileges
 *   - backups
 *   - immutable/WORM retention
 *   - external integrity anchoring
 *   - security monitoring
 *
 * ============================================================================
 */

const ACTOR_TYPES = Object.freeze([
    "USER",
    "ADMIN",
    "SYSTEM",
    "API",
    "SERVICE"
]);

const EVENT_TYPES = Object.freeze([
    "ELIGIBILITY_ASSESSMENT",
    "LOAN_APPLICATION_CREATED",
    "LOAN_APPLICATION_UPDATED",
    "LOAN_APPROVED",
    "LOAN_REJECTED",
    "LOAN_CANCELLED",
    "LOAN_DISBURSED",
    "LOAN_REPAYMENT",
    "LOAN_DEFAULTED",
    "LOAN_WRITTEN_OFF",
    "LOAN_RESTRUCTURED",
    "ADMIN_OVERRIDE",
    "CUSTOM_EVENT"
]);

const PROVIDERS = Object.freeze([
    "MTN_MOMO",
    "AIRTEL_MONEY",
    "BANK",
    "CASH",
    "MANUAL",
    "OTHER"
]);

const DEFAULT_CURRENCY = "UGX";

const HASH_ALGORITHM = "sha256";

const INTEGRITY_VERSION = 1;

const MAX_PAGE_SIZE = 500;

const DEFAULT_PAGE_SIZE = 100;

const MAX_SKIP = 100000;

const MAX_SEQUENCE_RETRIES = 8;

const MAX_METADATA_BYTES = 256 * 1024;

const MAX_METADATA_DEPTH = 20;

const MAX_REASON_LENGTH = 5000;

const MAX_REMARKS_LENGTH = 5000;

const MAX_TRANSACTION_ID_LENGTH = 512;

const MAX_CORRELATION_ID_LENGTH = 256;

const MAX_IDEMPOTENCY_KEY_LENGTH = 256;

const IMMUTABLE_ERROR =
    "Loan audit records are immutable and cannot be modified or deleted";

const INSERT_MANY_ERROR =
    "Direct insertMany() is prohibited; use LoanAudit.recordEvent()";

const BULK_WRITE_ERROR =
    "Direct bulkWrite() is prohibited; use LoanAudit.recordEvent()";

const IDEMPOTENCY_CONFLICT_ERROR =
    "Idempotency key already exists for a different audit event payload";

const INVALID_OBJECT_ID_ERROR =
    "Invalid MongoDB ObjectId";

const ALLOWED_COUNT_FILTER_FIELDS = Object.freeze([
    "loanId",
    "memberId",
    "groupId",
    "actorId",
    "actorType",
    "eventType",
    "transactionId",
    "provider",
    "correlationId",
    "idempotencyKey",
    "previousStatus",
    "currentStatus",
    "createdAt"
]);

/**
 * ============================================================================
 * Utility helpers
 * ============================================================================
 */

function requireNonEmptyString(value, fieldName) {
    if (
        typeof value !== "string" ||
        !value.trim()
    ) {
        throw new Error(`${fieldName} is required`);
    }

    return value.trim();
}

function normalizeOptionalString(
    value,
    fieldName,
    maxLength
) {
    if (
        value === undefined ||
        value === null ||
        value === ""
    ) {
        return null;
    }

    const normalized =
        requireNonEmptyString(
            value,
            fieldName
        );

    if (
        maxLength &&
        normalized.length > maxLength
    ) {
        throw new Error(
            `${fieldName} exceeds maximum length of ${maxLength}`
        );
    }

    return normalized;
}

function requireObjectId(
    value,
    fieldName
) {
    if (
        !mongoose.isValidObjectId(value)
    ) {
        throw new Error(
            `${fieldName}: ${INVALID_OBJECT_ID_ERROR}`
        );
    }

    return new mongoose.Types.ObjectId(
        value
    );
}

function normalizeOptionalObjectId(
    value,
    fieldName
) {
    if (
        value === undefined ||
        value === null ||
        value === ""
    ) {
        return null;
    }

    return requireObjectId(
        value,
        fieldName
    );
}

function requirePlainObject(
    value,
    fieldName
) {
    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value)
    ) {
        throw new Error(
            `${fieldName} must be a plain object`
        );
    }

    const prototype =
        Object.getPrototypeOf(value);

    if (
        prototype !== Object.prototype &&
        prototype !== null
    ) {
        throw new Error(
            `${fieldName} must be a plain object`
        );
    }

    return value;
}

/**
 * Protect metadata from:
 *
 *   - excessive nesting
 *   - MongoDB operators
 *   - dotted paths
 *   - unsupported values
 *   - non-finite numbers
 */
function validateSafeObject(
    value,
    depth = 0,
    path = "metadata"
) {
    if (
        depth > MAX_METADATA_DEPTH
    ) {
        throw new Error(
            `${path} exceeds maximum nesting depth`
        );
    }

    if (
        value === null ||
        value === undefined
    ) {
        return;
    }

    if (
        typeof value === "string" ||
        typeof value === "boolean"
    ) {
        return;
    }

    if (
        typeof value === "number"
    ) {
        if (
            !Number.isFinite(value)
        ) {
            throw new Error(
                `${path} contains a non-finite number`
            );
        }

        return;
    }

    if (
        typeof value === "bigint"
    ) {
        return;
    }

    if (
        value instanceof Date
    ) {
        if (
            Number.isNaN(
                value.getTime()
            )
        ) {
            throw new Error(
                `${path} contains an invalid date`
            );
        }

        return;
    }

    if (
        Buffer.isBuffer(value)
    ) {
        return;
    }

    if (
        Array.isArray(value)
    ) {
        value.forEach(
            (item, index) => {
                validateSafeObject(
                    item,
                    depth + 1,
                    `${path}[${index}]`
                );
            }
        );

        return;
    }

    if (
        typeof value === "object"
    ) {
        requirePlainObject(
            value,
            path
        );

        Object.keys(value)
            .forEach((key) => {
                if (
                    key.startsWith("$") ||
                    key.includes(".")
                ) {
                    throw new Error(
                        `${path}.${key} contains a prohibited MongoDB field name`
                    );
                }

                validateSafeObject(
                    value[key],
                    depth + 1,
                    `${path}.${key}`
                );
            });

        return;
    }

    throw new Error(
        `${path} contains an unsupported value type`
    );
}

function canonicalize(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return null;
    }

    if (
        typeof value === "string" ||
        typeof value === "boolean"
    ) {
        return value;
    }

    if (
        typeof value === "number"
    ) {
        if (
            !Number.isFinite(value)
        ) {
            throw new Error(
                "Integrity payload contains a non-finite number"
            );
        }

        return value;
    }

    if (
        typeof value === "bigint"
    ) {
        return {
            __type: "bigint",
            value: value.toString()
        };
    }

    if (
        value instanceof Date
    ) {
        if (
            Number.isNaN(
                value.getTime()
            )
        ) {
            throw new Error(
                "Integrity payload contains an invalid date"
            );
        }

        return {
            __type: "date",
            value: value.toISOString()
        };
    }

    if (
        value instanceof mongoose.Types.ObjectId
    ) {
        return {
            __type: "objectId",
            value: value.toString()
        };
    }

    if (
        value instanceof mongoose.Types.Decimal128
    ) {
        return {
            __type: "decimal128",
            value: value.toString()
        };
    }

    if (
        Buffer.isBuffer(value)
    ) {
        return {
            __type: "buffer",
            value: value.toString("base64")
        };
    }

    if (
        Array.isArray(value)
    ) {
        return value.map(
            canonicalize
        );
    }

    if (
        typeof value === "object"
    ) {
        const normalized = {};

        Object.keys(value)
            .sort()
            .forEach((key) => {
                normalized[key] =
                    canonicalize(
                        value[key]
                    );
            });

        return normalized;
    }

    return String(value);
}

function stableStringify(value) {
    return JSON.stringify(
        canonicalize(value)
    );
}

function serializedByteLength(value) {
    return Buffer.byteLength(
        stableStringify(value),
        "utf8"
    );
}

function validateMetadata(metadata) {
    if (
        metadata === null ||
        metadata === undefined
    ) {
        return;
    }

    requirePlainObject(
        metadata,
        "metadata"
    );

    validateSafeObject(
        metadata,
        0,
        "metadata"
    );

    const size =
        serializedByteLength(
            metadata
        );

    if (
        size > MAX_METADATA_BYTES
    ) {
        throw new Error(
            `metadata exceeds maximum size of ${MAX_METADATA_BYTES} bytes`
        );
    }
}

function normalizePagination(
    options = {}
) {
    const requestedLimit =
        Number(
            options.limit ??
            DEFAULT_PAGE_SIZE
        );

    const requestedSkip =
        Number(
            options.skip ?? 0
        );

    const limit =
        Number.isFinite(
            requestedLimit
        )
            ? Math.max(
                1,
                Math.min(
                    Math.floor(
                        requestedLimit
                    ),
                    MAX_PAGE_SIZE
                )
            )
            : DEFAULT_PAGE_SIZE;

    const skip =
        Number.isFinite(
            requestedSkip
        )
            ? Math.max(
                0,
                Math.min(
                    Math.floor(
                        requestedSkip
                    ),
                    MAX_SKIP
                )
            )
            : 0;

    return {
        limit,
        skip
    };
}

function normalizeSequence(
    value
) {
    const sequence =
        Number(value);

    if (
        !Number.isSafeInteger(
            sequence
        ) ||
        sequence < 1
    ) {
        throw new Error(
            "Sequence must be a positive safe integer"
        );
    }

    return sequence;
}

function isDuplicateKey(error) {
    return Boolean(
        error &&
        error.code === 11000
    );
}

function duplicateIndexName(error) {
    if (!error) {
        return "";
    }

    return String(
        error.index ||
        error.message ||
        ""
    );
}

function isDuplicateSequenceError(
    error
) {
    if (
        !isDuplicateKey(error)
    ) {
        return false;
    }

    const index =
        duplicateIndexName(error);

    return (
        index.includes(
            "uq_loan_audit_tenant_loan_sequence"
        ) ||
        index.includes(
            "tenantId_1_loanId_1_sequence_1"
        )
    );
}

function isDuplicateIdempotencyError(
    error
) {
    if (
        !isDuplicateKey(error)
    ) {
        return false;
    }

    const index =
        duplicateIndexName(error);

    return (
        index.includes(
            "uq_loan_audit_idempotency"
        ) ||
        index.includes(
            "tenantId_1_idempotencyKey_1"
        )
    );
}

function timingSafeEqual(
    expected,
    actual
) {
    const expectedBuffer =
        Buffer.from(
            String(expected),
            "utf8"
        );

    const actualBuffer =
        Buffer.from(
            String(actual),
            "utf8"
        );

    if (
        expectedBuffer.length !==
        actualBuffer.length
    ) {
        return false;
    }

    return crypto.timingSafeEqual(
        expectedBuffer,
        actualBuffer
    );
}

/**
 * ============================================================================
 * Schema
 * ============================================================================
 */

const LoanAuditSchema =
    new Schema(
        {
            tenantId: {
                type: String,
                required: true,
                trim: true,
                immutable: true,
                index: true,
                maxlength: 256
            },

            groupId: {
                type: Schema.Types.ObjectId,
                ref: "Group",
                default: null,
                immutable: true
            },

            memberId: {
                type: Schema.Types.ObjectId,
                ref: "User",
                required: true,
                immutable: true,
                index: true
            },

            loanId: {
                type: Schema.Types.ObjectId,
                ref: "Loan",
                required: true,
                immutable: true,
                index: true
            },

            actorId: {
                type: Schema.Types.ObjectId,
                ref: "User",
                default: null,
                immutable: true
            },

            actorType: {
                type: String,
                enum: ACTOR_TYPES,
                default: "SYSTEM",
                immutable: true
            },

            eventType: {
                type: String,
                required: true,
                enum: EVENT_TYPES,
                immutable: true,
                index: true
            },

            score: {
                type: Number,
                default: null,
                min: 0,
                immutable: true,
                validate: {
                    validator(value) {
                        return (
                            value === null ||
                            value === undefined ||
                            Number.isFinite(value)
                        );
                    },
                    message:
                        "Audit score must be finite"
                }
            },

            eligible: {
                type: Boolean,
                default: null,
                immutable: true
            },

            breakdown: {
                type: Schema.Types.Mixed,
                default: null,
                immutable: true,
                validate: {
                    validator(value) {
                        if (
                            value === null ||
                            value === undefined
                        ) {
                            return true;
                        }

                        try {
                            validateSafeObject(
                                value,
                                0,
                                "breakdown"
                            );

                            return true;
                        } catch (_) {
                            return false;
                        }
                    },
                    message:
                        "Audit breakdown is invalid"
                }
            },

            /**
             * Decimal128 is deliberately used for monetary values.
             *
             * Financial amounts should not be represented with JavaScript
             * floating-point Number values.
             */
            amount: {
                type: Schema.Types.Decimal128,
                default: null,
                min: 0,
                immutable: true
            },

            currency: {
                type: String,
                default: DEFAULT_CURRENCY,
                uppercase: true,
                trim: true,
                minlength: 3,
                maxlength: 3,
                match: /^[A-Z]{3}$/,
                immutable: true
            },

            interestRate: {
                type: Schema.Types.Decimal128,
                default: null,
                min: 0,
                immutable: true
            },

            transactionId: {
                type: String,
                trim: true,
                default: null,
                immutable: true,
                maxlength: MAX_TRANSACTION_ID_LENGTH,
                index: true
            },

            provider: {
                type: String,
                enum: PROVIDERS,
                default: "OTHER",
                immutable: true
            },

            previousStatus: {
                type: String,
                trim: true,
                default: null,
                immutable: true,
                maxlength: 256
            },

            currentStatus: {
                type: String,
                trim: true,
                default: null,
                immutable: true,
                maxlength: 256
            },

            reason: {
                type: String,
                trim: true,
                default: null,
                maxlength: MAX_REASON_LENGTH,
                immutable: true
            },

            remarks: {
                type: String,
                trim: true,
                default: null,
                maxlength: MAX_REMARKS_LENGTH,
                immutable: true
            },

            ipAddress: {
                type: String,
                trim: true,
                default: null,
                maxlength: 128,
                immutable: true
            },

            userAgent: {
                type: String,
                trim: true,
                default: null,
                maxlength: 2048,
                immutable: true
            },

            correlationId: {
                type: String,
                trim: true,
                default: null,
                maxlength: MAX_CORRELATION_ID_LENGTH,
                immutable: true,
                index: true
            },

            idempotencyKey: {
                type: String,
                trim: true,
                default: null,
                maxlength: MAX_IDEMPOTENCY_KEY_LENGTH,
                immutable: true
            },

            /**
             * Fingerprint of the logical business/audit request.
             *
             * This allows the same idempotency key to safely return the
             * original event while rejecting reuse with different data.
             */
            idempotencyFingerprint: {
                type: String,
                trim: true,
                default: null,
                immutable: true,
                minlength: 64,
                maxlength: 64,
                match: /^[a-f0-9]{64}$/
            },

            metadata: {
                type: Schema.Types.Mixed,
                default: () => ({}),
                immutable: true,
                validate: {
                    validator(value) {
                        try {
                            validateMetadata(value);
                            return true;
                        } catch (_) {
                            return false;
                        }
                    },
                    message:
                        "Audit metadata is invalid or exceeds limits"
                }
            },

            /**
             * Monotonic sequence per tenant + loan.
             */
            sequence: {
                type: Number,
                required: true,
                immutable: true,
                min: 1,
                validate: {
                    validator(value) {
                        return (
                            Number.isSafeInteger(
                                value
                            ) &&
                            value >= 1
                        );
                    },
                    message:
                        "Audit sequence must be a positive safe integer"
                }
            },

            /**
             * SHA-256 hash of immediately preceding event.
             */
            previousHash: {
                type: String,
                default: null,
                immutable: true,
                minlength: 64,
                maxlength: 64,
                match: /^[a-f0-9]{64}$/
            },

            integrityVersion: {
                type: Number,
                required: true,
                immutable: true,
                enum: [
                    INTEGRITY_VERSION
                ]
            },

            hashAlgorithm: {
                type: String,
                required: true,
                immutable: true,
                enum: [
                    HASH_ALGORITHM
                ]
            },

            /**
             * Deterministic SHA-256 hash of the immutable audit payload.
             */
            immutableHash: {
                type: String,
                required: true,
                trim: true,
                immutable: true,
                minlength: 64,
                maxlength: 64,
                match: /^[a-f0-9]{64}$/
            },

            /**
             * Business event time.
             */
            eventOccurredAt: {
                type: Date,
                default: Date.now,
                immutable: true,
                index: true
            }
        },
        {
            timestamps: true,

            versionKey: false,

            collection: "loan_audits",

            minimize: false,

            strict: true
        }
    );

/**
 * ============================================================================
 * Compound indexes
 * ============================================================================
 */

LoanAuditSchema.index(
    {
        tenantId: 1,
        loanId: 1,
        sequence: 1
    },
    {
        unique: true,
        name:
            "uq_loan_audit_tenant_loan_sequence"
    }
);

LoanAuditSchema.index(
    {
        tenantId: 1,
        loanId: 1,
        createdAt: -1
    },
    {
        name:
            "idx_loan_audit_tenant_loan_timeline"
    }
);

LoanAuditSchema.index(
    {
        tenantId: 1,
        loanId: 1,
        eventOccurredAt: -1
    },
    {
        name:
            "idx_loan_audit_tenant_loan_event_time"
    }
);

LoanAuditSchema.index(
    {
        tenantId: 1,
        memberId: 1,
        createdAt: -1
    },
    {
        name:
            "idx_loan_audit_tenant_member_timeline"
    }
);

LoanAuditSchema.index(
    {
        tenantId: 1,
        eventType: 1,
        createdAt: -1
    },
    {
        name:
            "idx_loan_audit_tenant_event_timeline"
    }
);

LoanAuditSchema.index(
    {
        tenantId: 1,
        currentStatus: 1,
        eventOccurredAt: -1
    },
    {
        name:
            "idx_loan_audit_tenant_status_event"
    }
);

LoanAuditSchema.index(
    {
        tenantId: 1,
        transactionId: 1,
        createdAt: -1
    },
    {
        name:
            "idx_loan_audit_tenant_transaction"
    }
);

LoanAuditSchema.index(
    {
        tenantId: 1,
        provider: 1,
        transactionId: 1
    },
    {
        name:
            "idx_loan_audit_provider_transaction"
    }
);

LoanAuditSchema.index(
    {
        tenantId: 1,
        correlationId: 1,
        createdAt: 1
    },
    {
        name:
            "idx_loan_audit_correlation"
    }
);

LoanAuditSchema.index(
    {
        tenantId: 1,
        createdAt: -1
    },
    {
        name:
            "idx_loan_audit_tenant_created"
    }
);

/**
 * Tenant-scoped idempotency uniqueness.
 *
 * Partial index means multiple records may have null/missing idempotencyKey.
 */
LoanAuditSchema.index(
    {
        tenantId: 1,
        idempotencyKey: 1
    },
    {
        unique: true,
        name:
            "uq_loan_audit_idempotency",
        partialFilterExpression: {
            idempotencyKey: {
                $type: "string"
            }
        }
    }
);

/**
 * ============================================================================
 * Integrity payload
 * ============================================================================
 */

function buildIntegrityPayload(doc) {
    return {
        integrityVersion:
            doc.integrityVersion ??
            INTEGRITY_VERSION,

        hashAlgorithm:
            doc.hashAlgorithm ||
            HASH_ALGORITHM,

        tenantId:
            doc.tenantId || null,

        groupId:
            doc.groupId
                ? String(doc.groupId)
                : null,

        memberId:
            doc.memberId
                ? String(doc.memberId)
                : null,

        loanId:
            doc.loanId
                ? String(doc.loanId)
                : null,

        actorId:
            doc.actorId
                ? String(doc.actorId)
                : null,

        actorType:
            doc.actorType || null,

        eventType:
            doc.eventType || null,

        score:
            doc.score ?? null,

        eligible:
            doc.eligible ?? null,

        breakdown:
            doc.breakdown ?? null,

        amount:
            doc.amount ?? null,

        currency:
            doc.currency || null,

        interestRate:
            doc.interestRate ?? null,

        transactionId:
            doc.transactionId || null,

        provider:
            doc.provider || null,

        previousStatus:
            doc.previousStatus || null,

        currentStatus:
            doc.currentStatus || null,

        reason:
            doc.reason || null,

        remarks:
            doc.remarks || null,

        ipAddress:
            doc.ipAddress || null,

        userAgent:
            doc.userAgent || null,

        correlationId:
            doc.correlationId || null,

        idempotencyKey:
            doc.idempotencyKey || null,

        idempotencyFingerprint:
            doc.idempotencyFingerprint || null,

        metadata:
            doc.metadata || {},

        sequence:
            doc.sequence ?? null,

        previousHash:
            doc.previousHash || null,

        eventOccurredAt:
            doc.eventOccurredAt
                ? new Date(
                    doc.eventOccurredAt
                ).toISOString()
                : null,

        createdAt:
            doc.createdAt
                ? new Date(
                    doc.createdAt
                ).toISOString()
                : null
    };
}

function generateIntegrityHash(doc) {
    return crypto
        .createHash(
            HASH_ALGORITHM
        )
        .update(
            stableStringify(
                buildIntegrityPayload(
                    doc
                )
            ),
            "utf8"
        )
        .digest("hex");
}

/**
 * ============================================================================
 * Idempotency fingerprint
 * ============================================================================
 *
 * Persistence-generated values are deliberately excluded:
 *
 *   - sequence
 *   - previousHash
 *   - immutableHash
 *   - integrityVersion
 *   - hashAlgorithm
 *   - createdAt
 *   - updatedAt
 *
 * The fingerprint represents the logical request.
 */

function buildIdempotencyPayload(
    payload
) {
    return {
        tenantId:
            payload.tenantId || null,

        groupId:
            payload.groupId
                ? String(
                    payload.groupId
                )
                : null,

        memberId:
            payload.memberId
                ? String(
                    payload.memberId
                )
                : null,

        loanId:
            payload.loanId
                ? String(
                    payload.loanId
                )
                : null,

        actorId:
            payload.actorId
                ? String(
                    payload.actorId
                )
                : null,

        actorType:
            payload.actorType ||
            "SYSTEM",

        eventType:
            payload.eventType ||
            null,

        score:
            payload.score ?? null,

        eligible:
            payload.eligible ?? null,

        breakdown:
            payload.breakdown ?? null,

        amount:
            payload.amount ?? null,

        currency:
            payload.currency ||
            DEFAULT_CURRENCY,

        interestRate:
            payload.interestRate ??
            null,

        transactionId:
            payload.transactionId ||
            null,

        provider:
            payload.provider ||
            "OTHER",

        previousStatus:
            payload.previousStatus ||
            null,

        currentStatus:
            payload.currentStatus ||
            null,

        reason:
            payload.reason ||
            null,

        remarks:
            payload.remarks ||
            null,

        ipAddress:
            payload.ipAddress ||
            null,

        userAgent:
            payload.userAgent ||
            null,

        correlationId:
            payload.correlationId ||
            null,

        idempotencyKey:
            payload.idempotencyKey ||
            null,

        metadata:
            payload.metadata ||
            {}
    };
}

function generateIdempotencyFingerprint(
    payload
) {
    return crypto
        .createHash(
            HASH_ALGORITHM
        )
        .update(
            stableStringify(
                buildIdempotencyPayload(
                    payload
                )
            ),
            "utf8"
        )
        .digest("hex");
}

/**
 * ============================================================================
 * Creation validation
 * ============================================================================
 */

LoanAuditSchema.pre(
    "validate",
    function () {
        if (!this.isNew) {
            return;
        }

        requireNonEmptyString(
            this.tenantId,
            "tenantId"
        );

        requireObjectId(
            this.loanId,
            "loanId"
        );

        requireObjectId(
            this.memberId,
            "memberId"
        );

        normalizeOptionalObjectId(
            this.groupId,
            "groupId"
        );

        normalizeOptionalObjectId(
            this.actorId,
            "actorId"
        );

        if (
            !EVENT_TYPES.includes(
                this.eventType
            )
        ) {
            throw new Error(
                "eventType is invalid"
            );
        }

        if (
            !ACTOR_TYPES.includes(
                this.actorType
            )
        ) {
            throw new Error(
                "actorType is invalid"
            );
        }

        if (
            !PROVIDERS.includes(
                this.provider
            )
        ) {
            throw new Error(
                "provider is invalid"
            );
        }

        if (
            this.actorType !== "SYSTEM" &&
            !this.actorId
        ) {
            throw new Error(
                "actorId is required for non-SYSTEM actors"
            );
        }

        validateMetadata(
            this.metadata
        );

        if (
            this.breakdown !== null &&
            this.breakdown !== undefined
        ) {
            validateSafeObject(
                this.breakdown,
                0,
                "breakdown"
            );
        }

        if (
            this.idempotencyKey
        ) {
            normalizeOptionalString(
                this.idempotencyKey,
                "idempotencyKey",
                MAX_IDEMPOTENCY_KEY_LENGTH
            );
        }
    }
);

/**
 * ============================================================================
 * Sequence + previous hash allocation
 * ============================================================================
 *
 * The unique database index remains the final concurrency authority.
 *
 * Two concurrent writers may temporarily observe the same previous sequence.
 * One wins. The losing writer receives E11000 and recordEvent() retries.
 * ============================================================================
 */

LoanAuditSchema.pre(
    "save",
    async function () {
        if (!this.isNew) {
            return;
        }

        if (
            this.sequence &&
            this.sequence >= 1
        ) {
            return;
        }

        const previous =
            await this.constructor
                .findOne({
                    tenantId:
                        this.tenantId,

                    loanId:
                        this.loanId
                })
                .sort({
                    sequence: -1
                })
                .select({
                    sequence: 1,
                    immutableHash: 1
                })
                .lean();

        this.sequence =
            previous
                ? normalizeSequence(
                    previous.sequence + 1
                )
                : 1;

        this.previousHash =
            previous
                ? previous.immutableHash
                : null;
    }
);

/**
 * ============================================================================
 * Pre-save integrity generation
 * ============================================================================
 *
 * Mongoose validation executes before save middleware. Timestamps are applied
 * by Mongoose's save lifecycle. We explicitly guarantee all integrity metadata
 * before hashing.
 * ============================================================================
 */

LoanAuditSchema.pre(
    "save",
    function () {
        if (!this.isNew) {
            return;
        }

        this.integrityVersion =
            INTEGRITY_VERSION;

        this.hashAlgorithm =
            HASH_ALGORITHM;

        if (
            this.idempotencyKey &&
            !this.idempotencyFingerprint
        ) {
            this.idempotencyFingerprint =
                generateIdempotencyFingerprint(
                    this.toObject()
                );
        }

        if (
            !this.immutableHash
        ) {
            this.immutableHash =
                generateIntegrityHash(
                    this
                );
        }
    }
);

/**
 * ============================================================================
 * Existing document save protection
 * ============================================================================
 */

LoanAuditSchema.pre(
    "save",
    function () {
        if (
            !this.isNew &&
            this.isModified()
        ) {
            throw new Error(
                IMMUTABLE_ERROR
            );
        }
    }
);

/**
 * ============================================================================
 * Query mutation protection
 * ============================================================================
 */

[
    "update",
    "updateOne",
    "updateMany",
    "findOneAndUpdate",
    "findByIdAndUpdate",
    "replaceOne",
    "findOneAndReplace",
    "findOneAndDelete",
    "findByIdAndDelete",
    "deleteOne",
    "deleteMany"
].forEach(
    (method) => {
        LoanAuditSchema.pre(
            method,
            function () {
                throw new Error(
                    IMMUTABLE_ERROR
                );
            }
        );
    }
);

/**
 * Document delete protection.
 */
LoanAuditSchema.pre(
    "deleteOne",
    {
        document: true,
        query: false
    },
    function () {
        throw new Error(
            IMMUTABLE_ERROR
        );
    }
);

/**
 * ============================================================================
 * Model-level direct insertion protection
 * ============================================================================
 *
 * insertMany() and bulkWrite() can bypass save middleware. Current Mongoose
 * exposes model middleware for these operations, so block them explicitly.
 * ============================================================================
 */

LoanAuditSchema.pre(
    "insertMany",
    function () {
        throw new Error(
            INSERT_MANY_ERROR
        );
    }
);

LoanAuditSchema.pre(
    "bulkWrite",
    function () {
        throw new Error(
            BULK_WRITE_ERROR
        );
    }
);

/**
 * ============================================================================
 * Integrity verification
 * ============================================================================
 */

LoanAuditSchema.statics.verifyIntegrity =
    function verifyIntegrity(
        auditDocument
    ) {
        if (
            !auditDocument ||
            !auditDocument.immutableHash
        ) {
            return false;
        }

        try {
            if (
                Number(
                    auditDocument.integrityVersion
                ) !== INTEGRITY_VERSION
            ) {
                return false;
            }

            if (
                String(
                    auditDocument.hashAlgorithm
                ) !== HASH_ALGORITHM
            ) {
                return false;
            }

            const expectedHash =
                generateIntegrityHash(
                    auditDocument
                );

            return timingSafeEqual(
                expectedHash,
                auditDocument.immutableHash
            );
        } catch (_) {
            return false;
        }
    };

/**
 * ============================================================================
 * Verify complete loan hash chain
 * ============================================================================
 */

LoanAuditSchema.statics.verifyLoanHashChain =
    async function verifyLoanHashChain(
        loanId,
        tenantId
    ) {
        const normalizedTenantId =
            requireNonEmptyString(
                tenantId,
                "tenantId"
            );

        const normalizedLoanId =
            requireObjectId(
                loanId,
                "loanId"
            );

        const events =
            await this.find({
                tenantId:
                    normalizedTenantId,

                loanId:
                    normalizedLoanId
            })
                .sort({
                    sequence: 1
                })
                .lean();

        let previousHash = null;

        for (
            let index = 0;
            index < events.length;
            index += 1
        ) {
            const event =
                events[index];

            const expectedSequence =
                index + 1;

            if (
                event.sequence !==
                expectedSequence
            ) {
                return {
                    valid: false,

                    checked: index,

                    failure: {
                        reason:
                            "SEQUENCE_MISMATCH",

                        expected:
                            expectedSequence,

                        actual:
                            event.sequence,

                        auditId:
                            String(
                                event._id
                            )
                    }
                };
            }

            if (
                event.previousHash !==
                previousHash
            ) {
                return {
                    valid: false,

                    checked: index,

                    failure: {
                        reason:
                            "PREVIOUS_HASH_MISMATCH",

                        expected:
                            previousHash,

                        actual:
                            event.previousHash,

                        auditId:
                            String(
                                event._id
                            )
                    }
                };
            }

            if (
                !this.verifyIntegrity(
                    event
                )
            ) {
                return {
                    valid: false,

                    checked: index,

                    failure: {
                        reason:
                            "INTEGRITY_HASH_MISMATCH",

                        auditId:
                            String(
                                event._id
                            )
                    }
                };
            }

            previousHash =
                event.immutableHash;
        }

        return {
            valid: true,
            checked: events.length,
            failure: null
        };
    };

/**
 * ============================================================================
 * Loan timeline - offset pagination
 * ============================================================================
 */

LoanAuditSchema.statics.getLoanTimeline =
    function getLoanTimeline(
        loanId,
        tenantId,
        options = {}
    ) {
        const normalizedTenantId =
            requireNonEmptyString(
                tenantId,
                "tenantId"
            );

        const normalizedLoanId =
            requireObjectId(
                loanId,
                "loanId"
            );

        const {
            limit,
            skip
        } =
            normalizePagination(
                options
            );

        return this.find({
            tenantId:
                normalizedTenantId,

            loanId:
                normalizedLoanId
        })
            .sort({
                sequence: 1
            })
            .skip(skip)
            .limit(limit)
            .lean();
    };

/**
 * ============================================================================
 * Loan timeline - cursor pagination
 * ============================================================================
 *
 * Cursor is sequence-based and therefore stable for an immutable chain.
 */

LoanAuditSchema.statics.getLoanTimelineAfterSequence =
    async function getLoanTimelineAfterSequence(
        loanId,
        tenantId,
        afterSequence = 0,
        options = {}
    ) {
        const normalizedTenantId =
            requireNonEmptyString(
                tenantId,
                "tenantId"
            );

        const normalizedLoanId =
            requireObjectId(
                loanId,
                "loanId"
            );

        const normalizedSequence =
            Number(afterSequence);

        if (
            !Number.isSafeInteger(
                normalizedSequence
            ) ||
            normalizedSequence < 0
        ) {
            throw new Error(
                "afterSequence must be a non-negative safe integer"
            );
        }

        const requestedLimit =
            Number(
                options.limit ??
                DEFAULT_PAGE_SIZE
            );

        const limit =
            Number.isFinite(
                requestedLimit
            )
                ? Math.max(
                    1,
                    Math.min(
                        Math.floor(
                            requestedLimit
                        ),
                        MAX_PAGE_SIZE
                    )
                )
                : DEFAULT_PAGE_SIZE;

        const events =
            await this.find({
                tenantId:
                    normalizedTenantId,

                loanId:
                    normalizedLoanId,

                sequence: {
                    $gt:
                        normalizedSequence
                }
            })
                .sort({
                    sequence: 1
                })
                .limit(
                    limit + 1
                )
                .lean();

        const hasMore =
            events.length >
            limit;

        const items =
            hasMore
                ? events.slice(
                    0,
                    limit
                )
                : events;

        return {
            items,

            hasMore,

            nextSequence:
                items.length > 0
                    ? items[
                        items.length - 1
                    ].sequence
                    : normalizedSequence
        };
    };

/**
 * ============================================================================
 * Member history
 * ============================================================================
 */

LoanAuditSchema.statics.getMemberHistory =
    function getMemberHistory(
        memberId,
        tenantId,
        options = {}
    ) {
        const normalizedTenantId =
            requireNonEmptyString(
                tenantId,
                "tenantId"
            );

        const normalizedMemberId =
            requireObjectId(
                memberId,
                "memberId"
            );

        const {
            limit,
            skip
        } =
            normalizePagination(
                options
            );

        return this.find({
            tenantId:
                normalizedTenantId,

            memberId:
                normalizedMemberId
        })
            .sort({
                createdAt: -1
            })
            .skip(skip)
            .limit(limit)
            .lean();
    };

/**
 * ============================================================================
 * Event summary
 * ============================================================================
 */

LoanAuditSchema.statics.getEventSummary =
    function getEventSummary(
        tenantId
    ) {
        const normalizedTenantId =
            requireNonEmptyString(
                tenantId,
                "tenantId"
            );

        return this.aggregate([
            {
                $match: {
                    tenantId:
                        normalizedTenantId
                }
            },

            {
                $group: {
                    _id:
                        "$eventType",

                    total: {
                        $sum: 1
                    }
                }
            },

            {
                $sort: {
                    total: -1,
                    _id: 1
                }
            }
        ]);
    };

/**
 * ============================================================================
 * Transaction lookup
 * ============================================================================
 */

LoanAuditSchema.statics.findByTransaction =
    function findByTransaction(
        transactionId,
        tenantId,
        options = {}
    ) {
        const normalizedTransactionId =
            requireNonEmptyString(
                transactionId,
                "transactionId"
            );

        const normalizedTenantId =
            requireNonEmptyString(
                tenantId,
                "tenantId"
            );

        const {
            limit,
            skip
        } =
            normalizePagination(
                options
            );

        return this.find({
            tenantId:
                normalizedTenantId,

            transactionId:
                normalizedTransactionId
        })
            .sort({
                createdAt: -1
            })
            .skip(skip)
            .limit(limit)
            .lean();
    };

/**
 * ============================================================================
 * Correlation lookup
 * ============================================================================
 */

LoanAuditSchema.statics.findByCorrelation =
    function findByCorrelation(
        correlationId,
        tenantId,
        options = {}
    ) {
        const normalizedCorrelationId =
            requireNonEmptyString(
                correlationId,
                "correlationId"
            );

        const normalizedTenantId =
            requireNonEmptyString(
                tenantId,
                "tenantId"
            );

        const {
            limit,
            skip
        } =
            normalizePagination(
                options
            );

        return this.find({
            tenantId:
                normalizedTenantId,

            correlationId:
                normalizedCorrelationId
        })
            .sort({
                sequence: 1
            })
            .skip(skip)
            .limit(limit)
            .lean();
    };

/**
 * ============================================================================
 * Idempotency lookup
 * ============================================================================
 */

LoanAuditSchema.statics.findByIdempotencyKey =
    function findByIdempotencyKey(
        idempotencyKey,
        tenantId
    ) {
        const normalizedKey =
            requireNonEmptyString(
                idempotencyKey,
                "idempotencyKey"
            );

        const normalizedTenantId =
            requireNonEmptyString(
                tenantId,
                "tenantId"
            );

        return this.findOne({
            tenantId:
                normalizedTenantId,

            idempotencyKey:
                normalizedKey
        }).lean();
    };

/**
 * ============================================================================
 * Record audit event
 * ============================================================================
 *
 * This is the PRIMARY write API.
 *
 * It provides:
 *
 *   1. Tenant normalization
 *   2. ObjectId normalization
 *   3. Event validation
 *   4. Metadata validation
 *   5. Idempotency lookup
 *   6. Idempotency fingerprint protection
 *   7. Sequence allocation
 *   8. Hash-chain creation
 *   9. Duplicate-key race recovery
 *
 * IMPORTANT:
 *
 * This method is NOT a substitute for a database transaction around the
 * financial business operation itself.
 *
 * The financial transaction boundary should live in the service/repository
 * layer that performs the business operation and writes the corresponding
 * ledger state.
 */

LoanAuditSchema.statics.recordEvent =
    async function recordEvent(
        payload
    ) {
        if (
            !payload ||
            typeof payload !== "object" ||
            Array.isArray(payload)
        ) {
            throw new Error(
                "Audit event payload is required"
            );
        }

        const normalizedPayload = {
            ...payload
        };

        normalizedPayload.tenantId =
            requireNonEmptyString(
                normalizedPayload.tenantId,
                "tenantId"
            );

        normalizedPayload.loanId =
            requireObjectId(
                normalizedPayload.loanId,
                "loanId"
            );

        normalizedPayload.memberId =
            requireObjectId(
                normalizedPayload.memberId,
                "memberId"
            );

        normalizedPayload.groupId =
            normalizeOptionalObjectId(
                normalizedPayload.groupId,
                "groupId"
            );

        normalizedPayload.actorId =
            normalizeOptionalObjectId(
                normalizedPayload.actorId,
                "actorId"
            );

        normalizedPayload.actorType =
            normalizedPayload.actorType ||
            "SYSTEM";

        normalizedPayload.provider =
            normalizedPayload.provider ||
            "OTHER";

        if (
            !EVENT_TYPES.includes(
                normalizedPayload.eventType
            )
        ) {
            throw new Error(
                "eventType is required and must be valid"
            );
        }

        if (
            !ACTOR_TYPES.includes(
                normalizedPayload.actorType
            )
        ) {
            throw new Error(
                "actorType is invalid"
            );
        }

        if (
            !PROVIDERS.includes(
                normalizedPayload.provider
            )
        ) {
            throw new Error(
                "provider is invalid"
            );
        }

        if (
            normalizedPayload.actorType !==
                "SYSTEM" &&
            !normalizedPayload.actorId
        ) {
            throw new Error(
                "actorId is required for non-SYSTEM actors"
            );
        }

        validateMetadata(
            normalizedPayload.metadata ??
            {}
        );

        if (
            normalizedPayload.breakdown !==
                null &&
            normalizedPayload.breakdown !==
                undefined
        ) {
            validateSafeObject(
                normalizedPayload.breakdown,
                0,
                "breakdown"
            );
        }

        if (
            normalizedPayload.transactionId !==
                undefined &&
            normalizedPayload.transactionId !==
                null
        ) {
            normalizedPayload.transactionId =
                normalizeOptionalString(
                    normalizedPayload.transactionId,
                    "transactionId",
                    MAX_TRANSACTION_ID_LENGTH
                );
        }

        if (
            normalizedPayload.correlationId !==
                undefined &&
            normalizedPayload.correlationId !==
                null
        ) {
            normalizedPayload.correlationId =
                normalizeOptionalString(
                    normalizedPayload.correlationId,
                    "correlationId",
                    MAX_CORRELATION_ID_LENGTH
                );
        }

        if (
            normalizedPayload.idempotencyKey !==
                undefined &&
            normalizedPayload.idempotencyKey !==
                null
        ) {
            normalizedPayload.idempotencyKey =
                normalizeOptionalString(
                    normalizedPayload.idempotencyKey,
                    "idempotencyKey",
                    MAX_IDEMPOTENCY_KEY_LENGTH
                );
        }

        const requestedFingerprint =
            normalizedPayload.idempotencyKey
                ? generateIdempotencyFingerprint(
                    normalizedPayload
                )
                : null;

        /**
         * Fast idempotency path.
         */
        if (
            normalizedPayload.idempotencyKey
        ) {
            const existing =
                await this.findOne({
                    tenantId:
                        normalizedPayload.tenantId,

                    idempotencyKey:
                        normalizedPayload.idempotencyKey
                }).lean();

            if (existing) {
                if (
                    existing.idempotencyFingerprint !==
                    requestedFingerprint
                ) {
                    throw new Error(
                        IDEMPOTENCY_CONFLICT_ERROR
                    );
                }

                return existing;
            }
        }

        /**
         * These fields belong exclusively to the audit model.
         *
         * Never allow external callers to manufacture chain state.
         */
        delete normalizedPayload._id;

        delete normalizedPayload.sequence;

        delete normalizedPayload.previousHash;

        delete normalizedPayload.immutableHash;

        delete normalizedPayload.integrityVersion;

        delete normalizedPayload.hashAlgorithm;

        delete normalizedPayload.idempotencyFingerprint;

        delete normalizedPayload.createdAt;

        delete normalizedPayload.updatedAt;

        for (
            let attempt = 1;
            attempt <= MAX_SEQUENCE_RETRIES;
            attempt += 1
        ) {
            try {
                const document =
                    new this(
                        normalizedPayload
                    );

                return await document.save();
            } catch (error) {
                /**
                 * Idempotency race:
                 *
                 * Another request won the unique idempotency index.
                 */
                if (
                    normalizedPayload.idempotencyKey &&
                    isDuplicateIdempotencyError(
                        error
                    )
                ) {
                    const existing =
                        await this.findOne({
                            tenantId:
                                normalizedPayload.tenantId,

                            idempotencyKey:
                                normalizedPayload.idempotencyKey
                        }).lean();

                    if (existing) {
                        if (
                            existing.idempotencyFingerprint !==
                            requestedFingerprint
                        ) {
                            throw new Error(
                                IDEMPOTENCY_CONFLICT_ERROR
                            );
                        }

                        return existing;
                    }
                }

                /**
                 * Sequence race:
                 *
                 * Concurrent audit writers for the same loan may have read the
                 * same previous sequence. The unique index rejects the loser.
                 * Retry causes a fresh previous-event lookup.
                 */
                if (
                    isDuplicateSequenceError(
                        error
                    ) &&
                    attempt <
                        MAX_SEQUENCE_RETRIES
                ) {
                    continue;
                }

                throw error;
            }
        }

        throw new Error(
            "Unable to allocate a unique audit sequence"
        );
    };

/**
 * ============================================================================
 * Count tenant events
 * ============================================================================
 */

function sanitizeCountFilter(
    filter = {}
) {
    if (
        !filter ||
        typeof filter !== "object" ||
        Array.isArray(filter)
    ) {
        return {};
    }

    const sanitized = {};

    for (
        const field of
        ALLOWED_COUNT_FILTER_FIELDS
    ) {
        if (
            !Object.prototype.hasOwnProperty.call(
                filter,
                field
            )
        ) {
            continue;
        }

        const value =
            filter[field];

        switch (field) {
            case "loanId":
            case "memberId":
            case "groupId":
            case "actorId":
                sanitized[field] =
                    normalizeOptionalObjectId(
                        value,
                        field
                    );
                break;

            case "actorType":
                if (
                    !ACTOR_TYPES.includes(
                        value
                    )
                ) {
                    throw new Error(
                        `${field} is invalid`
                    );
                }

                sanitized[field] =
                    value;

                break;

            case "eventType":
                if (
                    !EVENT_TYPES.includes(
                        value
                    )
                ) {
                    throw new Error(
                        `${field} is invalid`
                    );
                }

                sanitized[field] =
                    value;

                break;

            case "provider":
                if (
                    !PROVIDERS.includes(
                        value
                    )
                ) {
                    throw new Error(
                        `${field} is invalid`
                    );
                }

                sanitized[field] =
                    value;

                break;

            case "transactionId":
            case "correlationId":
            case "idempotencyKey":
            case "previousStatus":
            case "currentStatus":
                sanitized[field] =
                    requireNonEmptyString(
                        value,
                        field
                    );
                break;

            case "createdAt": {
                const date =
                    value instanceof Date
                        ? value
                        : new Date(
                            value
                        );

                if (
                    Number.isNaN(
                        date.getTime()
                    )
                ) {
                    throw new Error(
                        "createdAt is invalid"
                    );
                }

                sanitized.createdAt =
                    date;

                break;
            }

            default:
                break;
        }
    }

    return sanitized;
}

LoanAuditSchema.statics.countTenantEvents =
    function countTenantEvents(
        tenantId,
        filter = {}
    ) {
        const normalizedTenantId =
            requireNonEmptyString(
                tenantId,
                "tenantId"
            );

        const sanitizedFilter =
            sanitizeCountFilter(
                filter
            );

        return this.countDocuments({
            tenantId:
                normalizedTenantId,

            ...sanitizedFilter
        });
    };

/**
 * ============================================================================
 * Assert integrity
 * ============================================================================
 */

LoanAuditSchema.statics.assertIntegrity =
    function assertIntegrity(
        auditDocument
    ) {
        if (
            !this.verifyIntegrity(
                auditDocument
            )
        ) {
            throw new Error(
                "Loan audit integrity verification failed"
            );
        }

        return true;
    };

/**
 * ============================================================================
 * Verify a single event against the chain predecessor
 * ============================================================================
 */

LoanAuditSchema.statics.assertChainPosition =
    function assertChainPosition(
        auditDocument,
        previousDocument = null
    ) {
        if (
            !auditDocument
        ) {
            throw new Error(
                "Audit document is required"
            );
        }

        if (
            !this.verifyIntegrity(
                auditDocument
            )
        ) {
            throw new Error(
                "Loan audit integrity verification failed"
            );
        }

        const expectedSequence =
            previousDocument
                ? Number(
                    previousDocument.sequence
                ) + 1
                : 1;

        const expectedPreviousHash =
            previousDocument
                ? previousDocument.immutableHash
                : null;

        if (
            Number(
                auditDocument.sequence
            ) !== expectedSequence
        ) {
            throw new Error(
                "Loan audit sequence verification failed"
            );
        }

        if (
            auditDocument.previousHash !==
            expectedPreviousHash
        ) {
            throw new Error(
                "Loan audit previous-hash verification failed"
            );
        }

        return true;
    };

/**
 * ============================================================================
 * JSON serialization
 * ============================================================================
 */

LoanAuditSchema.set(
    "toJSON",
    {
        virtuals: true,

        transform(
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
 * Model export
 * ============================================================================
 */

const LoanAudit =
    mongoose.models.LoanAudit ||
    mongoose.model(
        "LoanAudit",
        LoanAuditSchema
    );

module.exports = LoanAudit.model;

/**
 * ============================================================================
 * Domain vocabulary exports
 * ============================================================================
 */

module.exports.ACTOR_TYPES =
    ACTOR_TYPES;

module.exports.EVENT_TYPES =
    EVENT_TYPES;

module.exports.PROVIDERS =
    PROVIDERS;

/**
 * ============================================================================
 * Integrity/testing helpers
 * ============================================================================
 */

module.exports.buildIntegrityPayload =
    buildIntegrityPayload;

module.exports.generateIntegrityHash =
    generateIntegrityHash;

module.exports.buildIdempotencyPayload =
    buildIdempotencyPayload;

module.exports.generateIdempotencyFingerprint =
    generateIdempotencyFingerprint;

module.exports.stableStringify =
    stableStringify;

module.exports.MAX_PAGE_SIZE =
    MAX_PAGE_SIZE;

module.exports.DEFAULT_PAGE_SIZE =
    DEFAULT_PAGE_SIZE;

module.exports.MAX_METADATA_BYTES =
    MAX_METADATA_BYTES;

module.exports.MAX_METADATA_DEPTH =
    MAX_METADATA_DEPTH;

module.exports.INTEGRITY_VERSION =
    INTEGRITY_VERSION;

module.exports.HASH_ALGORITHM =
    HASH_ALGORITHM;