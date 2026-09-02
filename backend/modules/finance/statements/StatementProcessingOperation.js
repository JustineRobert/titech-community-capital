"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Statement Processing Operation Model
 * ============================================================================
 *
 * File:
 * backend/modules/finance/statements/StatementProcessingOperation.js
 *
 * Purpose:
 * ----------------------------------------------------------------------------
 * Durable distributed idempotency + worker ownership coordination record for
 * statement processing.
 *
 * This model does NOT contain the financial statement itself.
 *
 * It stores:
 * - immutable operation identity
 * - idempotency identity
 * - current processing state
 * - current worker lease
 * - current claim token
 * - processing attempts
 * - completion/failure/release timestamps
 * - result correlation
 * - operational error metadata
 *
 * Design:
 * ----------------------------------------------------------------------------
 *
 *             ┌──────────────┐
 *             │    CLAIM     │
 *             └──────┬───────┘
 *                    │
 *                    ▼
 *             ┌──────────────┐
 *             │   CLAIMED    │
 *             └──────┬───────┘
 *                    │
 *                    ▼
 *             ┌──────────────┐
 *             │  PROCESSING  │
 *             └───┬──────┬───┘
 *                 │      │
 *            complete   fail
 *                 │      │
 *                 ▼      ▼
 *          ┌──────────┐ ┌────────┐
 *          │COMPLETED │ │ FAILED │
 *          └──────────┘ └───┬────┘
 *                           │
 *                      retry/reclaim
 *                           │
 *                           ▼
 *                       CLAIMED
 *
 * Release:
 * ----------------------------------------------------------------------------
 *
 * CLAIMED / PROCESSING / FAILED
 *              │
 *              ▼
 *          RELEASED
 *              │
 *              ▼
 *          CLAIMED
 *
 * Worker ownership rules:
 * ----------------------------------------------------------------------------
 * - A worker must possess the active claimToken.
 * - A stale worker cannot complete/fail/release a newer claim.
 * - Expired leases can be reclaimed atomically.
 * - Claim tokens rotate on every new ownership claim.
 * - Financial operation identity never changes.
 *
 * IMPORTANT:
 * ----------------------------------------------------------------------------
 * Financial state belongs to the ledger / statement processing services.
 *
 * This model only coordinates processing.
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

const OPERATION_STATUS = Object.freeze({
    CLAIMED: "CLAIMED",
    PROCESSING: "PROCESSING",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
    RELEASED: "RELEASED"
});

const TERMINAL_STATUS =
    Object.freeze({
        COMPLETED:
            OPERATION_STATUS.COMPLETED
    });

const ALLOWED_TRANSITIONS =
    Object.freeze({
        [OPERATION_STATUS.CLAIMED]:
            new Set([
                OPERATION_STATUS.PROCESSING,
                OPERATION_STATUS.COMPLETED,
                OPERATION_STATUS.FAILED,
                OPERATION_STATUS.RELEASED
            ]),

        [OPERATION_STATUS.PROCESSING]:
            new Set([
                OPERATION_STATUS.COMPLETED,
                OPERATION_STATUS.FAILED,
                OPERATION_STATUS.RELEASED
            ]),

        [OPERATION_STATUS.COMPLETED]:
            new Set(),

        [OPERATION_STATUS.FAILED]:
            new Set([
                OPERATION_STATUS.PROCESSING,
                OPERATION_STATUS.RELEASED
            ]),

        [OPERATION_STATUS.RELEASED]:
            new Set([
                OPERATION_STATUS.CLAIMED
            ])
    });

const DEFAULT_LEASE_MS = 5 * 60 * 1000;

const MAX_LEASE_MS =
    24 * 60 * 60 * 1000;

const MAX_KEY_LENGTH = 512;

const MAX_ID_LENGTH = 256;

const MAX_ERROR_MESSAGE_LENGTH = 2000;

/**
 * ============================================================================
 * Errors
 * ============================================================================
 */

class StatementProcessingOperationError
    extends Error {

    constructor(
        message,
        {
            code =
                "STATEMENT_OPERATION_ERROR",
            status = 409,
            operation = null
        } = {}
    ) {

        super(message);

        this.name =
            "StatementProcessingOperationError";

        this.code = code;
        this.status = status;
        this.operation = operation;

        this.isOperational = true;
    }
}

/**
 * ============================================================================
 * Utility Functions
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

function normalizeLeaseMs(
    leaseMs
) {

    const value =
        leaseMs === undefined
            ? DEFAULT_LEASE_MS
            : Number(leaseMs);

    if (
        !Number.isFinite(value) ||
        value <= 0
    ) {
        throw new TypeError(
            "leaseMs must be a positive finite number"
        );
    }

    return Math.min(
        value,
        MAX_LEASE_MS
    );
}

function generateClaimToken() {

    return crypto
        .randomBytes(32)
        .toString("hex");
}

function assertTransition(
    from,
    to
) {

    if (
        !Object.values(
            OPERATION_STATUS
        ).includes(from)
    ) {
        throw new StatementProcessingOperationError(
            `Unknown source status: ${from}`,
            {
                code:
                    "INVALID_OPERATION_STATUS"
            }
        );
    }

    if (
        !Object.values(
            OPERATION_STATUS
        ).includes(to)
    ) {
        throw new StatementProcessingOperationError(
            `Unknown target status: ${to}`,
            {
                code:
                    "INVALID_OPERATION_STATUS"
            }
        );
    }

    if (
        !ALLOWED_TRANSITIONS[from]?.has(
            to
        )
    ) {
        throw new StatementProcessingOperationError(
            `Invalid statement operation transition: ${from} -> ${to}`,
            {
                code:
                    "INVALID_OPERATION_TRANSITION"
            }
        );
    }

    return true;
}

function buildLeaseExpiry(
    now,
    leaseMs
) {

    return new Date(
        now.getTime() +
        normalizeLeaseMs(
            leaseMs
        )
    );
}

function buildOwnershipFilter({
    tenantId,
    operationKey,
    claimToken
}) {

    return {
        tenantId,
        operationKey,
        claimToken
    };
}

function extractOperationContext(
    document
) {

    if (!document) {
        return null;
    }

    return {
        id:
            document._id?.toString?.() ??
            null,

        tenantId:
            document.tenantId,

        operationKey:
            document.operationKey,

        idempotencyKey:
            document.idempotencyKey,

        status:
            document.status,

        claimToken:
            document.claimToken,

        leaseExpiresAt:
            document.leaseExpiresAt
    };
}

/**
 * ============================================================================
 * Schema
 * ============================================================================
 */

const ErrorSchema =
    new Schema(
        {
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
        {
            _id: false,
            id: false,
            strict: true
        }
    );

const StatementProcessingOperationSchema =
    new Schema(
        {
            /**
             * ----------------------------------------------------------------
             * Immutable operation identity
             * ----------------------------------------------------------------
             */

            tenantId: {
                type: String,
                required: true,
                trim: true,
                immutable: true,
                maxlength: 256,
                index: true
            },

            operationKey: {
                type: String,
                required: true,
                trim: true,
                immutable: true,
                maxlength:
                    MAX_KEY_LENGTH
            },

            idempotencyKey: {
                type: String,
                required: true,
                trim: true,
                immutable: true,
                maxlength:
                    MAX_KEY_LENGTH
            },

            statementId: {
                type: String,
                trim: true,
                immutable: true,
                maxlength:
                    MAX_ID_LENGTH
            },

            provider: {
                type: String,
                trim: true,
                uppercase: true,
                immutable: true,
                maxlength: 128
            },

            providerStatementId: {
                type: String,
                trim: true,
                immutable: true,
                maxlength:
                    MAX_ID_LENGTH
            },

            correlationId: {
                type: String,
                trim: true,
                immutable: true,
                maxlength:
                    MAX_ID_LENGTH
            },

            requestId: {
                type: String,
                trim: true,
                immutable: true,
                maxlength:
                    MAX_ID_LENGTH
            },

            /**
             * ----------------------------------------------------------------
             * Processing state
             * ----------------------------------------------------------------
             */

            status: {
                type: String,
                enum:
                    Object.values(
                        OPERATION_STATUS
                    ),
                default:
                    OPERATION_STATUS.CLAIMED,
                required: true,
                index: true
            },

            /**
             * ----------------------------------------------------------------
             * Current lease ownership token.
             *
             * IMPORTANT:
             * This is intentionally NOT immutable.
             *
             * A released or expired operation must receive a new ownership
             * token when another worker claims it.
             * ----------------------------------------------------------------
             */

            claimToken: {
                type: String,
                required: true,
                select: false,
                trim: true,
                maxlength: 256
            },

            leaseExpiresAt: {
                type: Date,
                required: true,
                index: true
            },

            attemptCount: {
                type: Number,
                default: 1,
                min: 1,
                max: 100000
            },

            lastHeartbeatAt: {
                type: Date
            },

            /**
             * ----------------------------------------------------------------
             * Lifecycle timestamps
             * ----------------------------------------------------------------
             */

            completedAt: {
                type: Date
            },

            failedAt: {
                type: Date
            },

            releasedAt: {
                type: Date
            },

            /**
             * ----------------------------------------------------------------
             * Processing result
             * ----------------------------------------------------------------
             */

            resultId: {
                type: String,
                trim: true,
                maxlength:
                    MAX_ID_LENGTH
            },

            error: {
                type: ErrorSchema,
                default: undefined
            },

            /**
             * ----------------------------------------------------------------
             * Controlled operational metadata
             * ----------------------------------------------------------------
             *
             * This is coordination metadata only.
             *
             * It MUST NOT contain secrets, credentials, raw statements,
             * authentication tokens, or financial journal payloads.
             * ----------------------------------------------------------------
             */

            metadata: {
                type: Schema.Types.Mixed,
                default: () => ({})
            }
        },
        {
            timestamps: true,

            strict: "throw",

            minimize: false,

            optimisticConcurrency: true,

            versionKey: "__v",

            toJSON: {
                transform:
                    function (
                        doc,
                        ret
                    ) {
                        delete ret.claimToken;
                        delete ret.__v;
                        return ret;
                    }
            }
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
StatementProcessingOperationSchema.index(
    {
        tenantId: 1,
        operationKey: 1
    },
    {
        unique: true,
        name:
            "uq_statement_operation_tenant_key"
    }
);

/**
 * Canonical idempotency identity.
 */
StatementProcessingOperationSchema.index(
    {
        tenantId: 1,
        idempotencyKey: 1
    },
    {
        unique: true,
        name:
            "uq_statement_operation_tenant_idempotency"
    }
);

/**
 * Expired lease scanning / recovery.
 */
StatementProcessingOperationSchema.index(
    {
        status: 1,
        leaseExpiresAt: 1
    },
    {
        name:
            "ix_statement_operation_lease"
    }
);

/**
 * Tenant operational history.
 */
StatementProcessingOperationSchema.index(
    {
        tenantId: 1,
        createdAt: -1
    },
    {
        name:
            "ix_statement_operation_created"
    }
);

/**
 * Provider reconciliation / tracing.
 */
StatementProcessingOperationSchema.index(
    {
        tenantId: 1,
        provider: 1,
        providerStatementId: 1
    },
    {
        sparse: true,
        name:
            "ix_statement_operation_provider_statement"
    }
);

/**
 * Correlation lookup.
 */
StatementProcessingOperationSchema.index(
    {
        tenantId: 1,
        correlationId: 1
    },
    {
        sparse: true,
        name:
            "ix_statement_operation_correlation"
    }
);

/**
 * ============================================================================
 * Schema Validation
 * ============================================================================
 */

StatementProcessingOperationSchema.pre(
    "validate",
    function validateStatementOperation(
        next
    ) {

        const operation =
            this;

        try {

            if (
                !operation.tenantId
            ) {
                throw new TypeError(
                    "tenantId is required"
                );
            }

            if (
                !operation.operationKey
            ) {
                throw new TypeError(
                    "operationKey is required"
                );
            }

            if (
                !operation.idempotencyKey
            ) {
                throw new TypeError(
                    "idempotencyKey is required"
                );
            }

            if (
                !operation.claimToken
            ) {
                throw new TypeError(
                    "claimToken is required"
                );
            }

            if (
                !operation.leaseExpiresAt
            ) {
                throw new TypeError(
                    "leaseExpiresAt is required"
                );
            }

            if (
                operation.attemptCount < 1
            ) {
                throw new TypeError(
                    "attemptCount must be >= 1"
                );
            }

            /**
             * Completed timestamp consistency.
             */
            if (
                operation.status ===
                    OPERATION_STATUS.COMPLETED &&
                !operation.completedAt
            ) {
                throw new TypeError(
                    "completedAt is required when status is COMPLETED"
                );
            }

            /**
             * Failed timestamp consistency.
             */
            if (
                operation.status ===
                    OPERATION_STATUS.FAILED &&
                !operation.failedAt
            ) {
                throw new TypeError(
                    "failedAt is required when status is FAILED"
                );
            }

            /**
             * Released timestamp consistency.
             */
            if (
                operation.status ===
                    OPERATION_STATUS.RELEASED &&
                !operation.releasedAt
            ) {
                throw new TypeError(
                    "releasedAt is required when status is RELEASED"
                );
            }

            return next();

        } catch (error) {

            return next(error);
        }
    }
);

/**
 * ============================================================================
 * State Transition Methods
 * ============================================================================
 */

StatementProcessingOperationSchema.statics
    .isValidTransition =
    function isValidTransition(
        from,
        to
    ) {

        return Boolean(
            ALLOWED_TRANSITIONS[
                from
            ]?.has(to)
        );
    };

/**
 * ============================================================================
 * Basic Repository Compatibility
 * ============================================================================
 */

StatementProcessingOperationSchema.statics.createOperation =
    async function createOperation(
        payload,
        options = {}
    ) {

        return this.create(
            payload,
            options
        );
    };

StatementProcessingOperationSchema.statics.findOperation =
    function findOperation(
        filter,
        projection,
        options
    ) {

        return this.findOne(
            filter,
            projection,
            options
        );
    };

StatementProcessingOperationSchema.statics.findOperationById =
    function findOperationById(
        id,
        projection,
        options
    ) {

        return this.findById(
            id,
            projection,
            options
        );
    };

/**
 * ============================================================================
 * CLAIM
 * ============================================================================
 *
 * Claim semantics:
 *
 * 1. Existing active lease => no takeover.
 * 2. Completed operation => never reclaimed.
 * 3. Expired CLAIMED / PROCESSING => reclaimable.
 * 4. FAILED / RELEASED => reclaimable.
 * 5. Every new ownership claim receives a fresh claim token.
 *
 * The first worker wins through MongoDB's atomic conditional update.
 * ============================================================================
 */

StatementProcessingOperationSchema.statics.claim =
    async function claim({
        tenantId,
        operationKey,
        idempotencyKey,
        statementId,
        provider,
        providerStatementId,
        correlationId,
        requestId,
        leaseMs = DEFAULT_LEASE_MS,
        metadata
    }) {

        tenantId =
            normalizeRequiredString(
                tenantId,
                "tenantId",
                256
            );

        operationKey =
            normalizeRequiredString(
                operationKey,
                "operationKey",
                MAX_KEY_LENGTH
            );

        idempotencyKey =
            normalizeRequiredString(
                idempotencyKey,
                "idempotencyKey",
                MAX_KEY_LENGTH
            );

        const now =
            new Date();

        const leaseExpiresAt =
            buildLeaseExpiry(
                now,
                leaseMs
            );

        const newClaimToken =
            generateClaimToken();

        /**
         * Try to create the operation first.
         *
         * The unique operation/idempotency indexes provide the final
         * duplicate protection under concurrent creators.
         */
        try {

            return await this.create({
                tenantId,
                operationKey,
                idempotencyKey,

                statementId:
                    normalizeOptionalString(
                        statementId,
                        "statementId",
                        MAX_ID_LENGTH
                    ),

                provider:
                    provider
                        ? normalizeRequiredString(
                            provider,
                            "provider",
                            128
                        ).toUpperCase()
                        : undefined,

                providerStatementId:
                    normalizeOptionalString(
                        providerStatementId,
                        "providerStatementId",
                        MAX_ID_LENGTH
                    ),

                correlationId:
                    normalizeOptionalString(
                        correlationId,
                        "correlationId",
                        MAX_ID_LENGTH
                    ),

                requestId:
                    normalizeOptionalString(
                        requestId,
                        "requestId",
                        MAX_ID_LENGTH
                    ),

                status:
                    OPERATION_STATUS.CLAIMED,

                claimToken:
                    newClaimToken,

                leaseExpiresAt,

                attemptCount: 1,

                lastHeartbeatAt:
                    now,

                metadata:
                    metadata &&
                    typeof metadata ===
                        "object"
                        ? metadata
                        : {}
            });

        } catch (error) {

            /**
             * Duplicate-key race is expected when another worker created
             * the same operation concurrently.
             *
             * Re-read the operation and attempt an atomic takeover only if
             * its existing lease is reclaimable.
             */
            if (
                error?.code !== 11000
            ) {
                throw error;
            }
        }

        /**
         * --------------------------------------------------------------------
         * Existing operation.
         * --------------------------------------------------------------------
         */

        const existing =
            await this.findOne({
                tenantId,
                operationKey
            })
                .select(
                    "+claimToken"
                )
                .lean();

        if (!existing) {
            /**
             * Extremely unlikely index/race window.
             */
            throw new StatementProcessingOperationError(
                "Statement operation could not be located after duplicate claim.",
                {
                    code:
                        "STATEMENT_OPERATION_RACE",
                    status: 409
                }
            );
        }

        if (
            existing.status ===
            OPERATION_STATUS.COMPLETED
        ) {

            return this.findById(
                existing._id
            );
        }

        const activeLease =
            existing.leaseExpiresAt &&
            existing.leaseExpiresAt >
                now;

        /**
         * Active CLAIMED / PROCESSING operation:
         * another worker currently owns it.
         */
        if (
            activeLease &&
            (
                existing.status ===
                    OPERATION_STATUS.CLAIMED ||
                existing.status ===
                    OPERATION_STATUS.PROCESSING
            )
        ) {

            throw new StatementProcessingOperationError(
                "Statement operation is currently owned by another worker.",
                {
                    code:
                        "STATEMENT_OPERATION_ALREADY_CLAIMED",
                    status: 409
                }
            );
        }

        /**
         * Only reclaim legal states.
         */
        const reclaimable =
            existing.status ===
                OPERATION_STATUS.RELEASED ||
            existing.status ===
                OPERATION_STATUS.FAILED ||
            (
                (
                    existing.status ===
                        OPERATION_STATUS.CLAIMED ||
                    existing.status ===
                        OPERATION_STATUS.PROCESSING
                ) &&
                (
                    !existing.leaseExpiresAt ||
                    existing.leaseExpiresAt <=
                        now
                )
            );

        if (!reclaimable) {

            throw new StatementProcessingOperationError(
                "Statement operation cannot currently be reclaimed.",
                {
                    code:
                        "STATEMENT_OPERATION_NOT_RECLAIMABLE",
                    status: 409
                }
            );
        }

        /**
         * --------------------------------------------------------------------
         * Atomic reclaim.
         *
         * The old claim token is included when available. That prevents a
         * stale worker from racing a new claimant.
         * --------------------------------------------------------------------
         */

        const reclaimFilter = {
            tenantId,
            operationKey,

            status:
                existing.status,

            ...(existing.claimToken
                ? {
                    claimToken:
                        existing.claimToken
                }
                : {}),

            $or: [
                {
                    status:
                        OPERATION_STATUS.RELEASED
                },
                {
                    status:
                        OPERATION_STATUS.FAILED
                },
                {
                    status: {
                        $in: [
                            OPERATION_STATUS.CLAIMED,
                            OPERATION_STATUS.PROCESSING
                        ]
                    },

                    leaseExpiresAt: {
                        $lte: now
                    }
                }
            ]
        };

        const reclaimed =
            await this.findOneAndUpdate(
                reclaimFilter,
                {
                    $set: {
                        status:
                            OPERATION_STATUS.CLAIMED,

                        claimToken:
                            newClaimToken,

                        leaseExpiresAt,

                        lastHeartbeatAt:
                            now,

                        releasedAt:
                            null,

                        failedAt:
                            null,

                        completedAt:
                            null,

                        error:
                            null
                    },

                    $inc: {
                        attemptCount: 1
                    }
                },
                {
                    new: true,

                    runValidators:
                        true
                }
            )
                .select(
                    "+claimToken"
                );

        if (!reclaimed) {

            throw new StatementProcessingOperationError(
                "Statement operation was claimed by another worker.",
                {
                    code:
                        "STATEMENT_OPERATION_CLAIM_LOST",
                    status: 409
                }
            );
        }

        return reclaimed;
    };

/**
 * ============================================================================
 * BEGIN PROCESSING
 * ============================================================================
 *
 * CLAIMED -> PROCESSING
 *
 * Requires current worker ownership.
 * ============================================================================
 */

StatementProcessingOperationSchema.statics
    .startProcessing =
    async function startProcessing({
        tenantId,
        operationKey,
        claimToken,
        leaseMs = DEFAULT_LEASE_MS
    }) {

        tenantId =
            normalizeRequiredString(
                tenantId,
                "tenantId",
                256
            );

        operationKey =
            normalizeRequiredString(
                operationKey,
                "operationKey",
                MAX_KEY_LENGTH
            );

        claimToken =
            normalizeRequiredString(
                claimToken,
                "claimToken",
                256
            );

        assertTransition(
            OPERATION_STATUS.CLAIMED,
            OPERATION_STATUS.PROCESSING
        );

        const now =
            new Date();

        const leaseExpiresAt =
            buildLeaseExpiry(
                now,
                leaseMs
            );

        const updated =
            await this.findOneAndUpdate(
                {
                    tenantId,
                    operationKey,
                    claimToken,

                    status:
                        OPERATION_STATUS.CLAIMED,

                    leaseExpiresAt: {
                        $gt: now
                    }
                },
                {
                    $set: {
                        status:
                            OPERATION_STATUS.PROCESSING,

                        lastHeartbeatAt:
                            now,

                        leaseExpiresAt
                    }
                },
                {
                    new: true,
                    runValidators: true
                }
            )
                .select(
                    "+claimToken"
                );

        if (!updated) {

            throw new StatementProcessingOperationError(
                "Statement processing claim is invalid, expired, or no longer owned by this worker.",
                {
                    code:
                        "STATEMENT_PROCESSING_OWNERSHIP_LOST",
                    status: 409
                }
            );
        }

        return updated;
    };

/**
 * ============================================================================
 * HEARTBEAT
 * ============================================================================
 *
 * Extends the active lease while preserving ownership.
 * ============================================================================
 */

StatementProcessingOperationSchema.statics
    .heartbeat =
    async function heartbeat({
        tenantId,
        operationKey,
        claimToken,
        leaseMs = DEFAULT_LEASE_MS
    }) {

        tenantId =
            normalizeRequiredString(
                tenantId,
                "tenantId",
                256
            );

        operationKey =
            normalizeRequiredString(
                operationKey,
                "operationKey",
                MAX_KEY_LENGTH
            );

        claimToken =
            normalizeRequiredString(
                claimToken,
                "claimToken",
                256
            );

        const now =
            new Date();

        const leaseExpiresAt =
            buildLeaseExpiry(
                now,
                leaseMs
            );

        const updated =
            await this.findOneAndUpdate(
                {
                    tenantId,
                    operationKey,
                    claimToken,

                    status: {
                        $in: [
                            OPERATION_STATUS.CLAIMED,
                            OPERATION_STATUS.PROCESSING
                        ]
                    },

                    leaseExpiresAt: {
                        $gt: now
                    }
                },
                {
                    $set: {
                        lastHeartbeatAt:
                            now,

                        leaseExpiresAt
                    }
                },
                {
                    new: true,
                    runValidators: true
                }
            )
                .select(
                    "+claimToken"
                );

        if (!updated) {

            throw new StatementProcessingOperationError(
                "Statement processing lease is no longer owned by this worker.",
                {
                    code:
                        "STATEMENT_LEASE_LOST",
                    status: 409
                }
            );
        }

        return updated;
    };

/**
 * ============================================================================
 * COMPLETE
 * ============================================================================
 *
 * CLAIMED / PROCESSING -> COMPLETED
 * ============================================================================
 */

StatementProcessingOperationSchema.statics
    .complete =
    async function complete({
        tenantId,
        operationKey,
        claimToken,
        resultId = null,
        metadata
    }) {

        tenantId =
            normalizeRequiredString(
                tenantId,
                "tenantId",
                256
            );

        operationKey =
            normalizeRequiredString(
                operationKey,
                "operationKey",
                MAX_KEY_LENGTH
            );

        claimToken =
            normalizeRequiredString(
                claimToken,
                "claimToken",
                256
            );

        const now =
            new Date();

        const update = {
            $set: {
                status:
                    OPERATION_STATUS.COMPLETED,

                completedAt:
                    now,

                leaseExpiresAt:
                    now,

                ...(resultId !== null &&
                resultId !== undefined
                    ? {
                        resultId:
                            normalizeRequiredString(
                                resultId,
                                "resultId",
                                MAX_ID_LENGTH
                            )
                    }
                    : {}),

                ...(metadata !== undefined
                    ? {
                        metadata
                    }
                    : {})
            },

            $unset: {
                error: 1
            }
        };

        const updated =
            await this.findOneAndUpdate(
                {
                    tenantId,
                    operationKey,
                    claimToken,

                    status: {
                        $in: [
                            OPERATION_STATUS.CLAIMED,
                            OPERATION_STATUS.PROCESSING
                        ]
                    },

                    leaseExpiresAt: {
                        $gt: now
                    }
                },
                update,
                {
                    new: true,
                    runValidators: true
                }
            )
                .select(
                    "+claimToken"
                );

        if (!updated) {

            /**
             * Safe idempotent replay:
             *
             * A retry after successful completion should be able to retrieve
             * the completed result rather than pretending ownership remains.
             */
            const completed =
                await this.findOne({
                    tenantId,
                    operationKey,
                    status:
                        OPERATION_STATUS.COMPLETED
                });

            if (completed) {
                return completed;
            }

            throw new StatementProcessingOperationError(
                "Statement operation cannot be completed because the worker no longer owns the active lease.",
                {
                    code:
                        "STATEMENT_COMPLETION_OWNERSHIP_LOST",
                    status: 409
                }
            );
        }

        return updated;
    };

/**
 * ============================================================================
 * FAIL
 * ============================================================================
 *
 * CLAIMED / PROCESSING -> FAILED
 * ============================================================================
 */

StatementProcessingOperationSchema.statics
    .fail =
    async function fail({
        tenantId,
        operationKey,
        claimToken,
        error,
        retryable = false
    }) {

        tenantId =
            normalizeRequiredString(
                tenantId,
                "tenantId",
                256
            );

        operationKey =
            normalizeRequiredString(
                operationKey,
                "operationKey",
                MAX_KEY_LENGTH
            );

        claimToken =
            normalizeRequiredString(
                claimToken,
                "claimToken",
                256
            );

        const now =
            new Date();

        const normalizedError = {
            code:
                normalizeOptionalString(
                    error?.code,
                    "error.code",
                    256
                ),

            message:
                normalizeOptionalString(
                    error?.message,
                    "error.message",
                    MAX_ERROR_MESSAGE_LENGTH
                ),

            stage:
                normalizeOptionalString(
                    error?.stage,
                    "error.stage",
                    128
                ),

            retryable:
                Boolean(
                    error?.retryable ??
                    retryable
                )
        };

        const updated =
            await this.findOneAndUpdate(
                {
                    tenantId,
                    operationKey,
                    claimToken,

                    status: {
                        $in: [
                            OPERATION_STATUS.CLAIMED,
                            OPERATION_STATUS.PROCESSING
                        ]
                    },

                    leaseExpiresAt: {
                        $gt: now
                    }
                },
                {
                    $set: {
                        status:
                            OPERATION_STATUS.FAILED,

                        failedAt:
                            now,

                        leaseExpiresAt:
                            now,

                        error:
                            normalizedError
                    }
                },
                {
                    new: true,
                    runValidators: true
                }
            )
                .select(
                    "+claimToken"
                );

        if (!updated) {

            throw new StatementProcessingOperationError(
                "Statement operation cannot be failed because the worker no longer owns the active lease.",
                {
                    code:
                        "STATEMENT_FAILURE_OWNERSHIP_LOST",
                    status: 409
                }
            );
        }

        return updated;
    };

/**
 * ============================================================================
 * RELEASE
 * ============================================================================
 *
 * CLAIMED / PROCESSING / FAILED -> RELEASED
 *
 * Release is used when a worker intentionally relinquishes ownership.
 * ============================================================================
 */

StatementProcessingOperationSchema.statics
    .release =
    async function release({
        tenantId,
        operationKey,
        claimToken
    }) {

        tenantId =
            normalizeRequiredString(
                tenantId,
                "tenantId",
                256
            );

        operationKey =
            normalizeRequiredString(
                operationKey,
                "operationKey",
                MAX_KEY_LENGTH
            );

        claimToken =
            normalizeRequiredString(
                claimToken,
                "claimToken",
                256
            );

        const now =
            new Date();

        const updated =
            await this.findOneAndUpdate(
                {
                    tenantId,
                    operationKey,
                    claimToken,

                    status: {
                        $in: [
                            OPERATION_STATUS.CLAIMED,
                            OPERATION_STATUS.PROCESSING,
                            OPERATION_STATUS.FAILED
                        ]
                    }
                },
                {
                    $set: {
                        status:
                            OPERATION_STATUS.RELEASED,

                        releasedAt:
                            now,

                        leaseExpiresAt:
                            now
                    }
                },
                {
                    new: true,
                    runValidators: true
                }
            )
                .select(
                    "+claimToken"
                );

        if (!updated) {

            throw new StatementProcessingOperationError(
                "Statement operation cannot be released because the worker no longer owns it or it is already terminal.",
                {
                    code:
                        "STATEMENT_RELEASE_OWNERSHIP_LOST",
                    status: 409
                }
            );
        }

        return updated;
    };

/**
 * ============================================================================
 * RELEASE EXPIRED CLAIMS
 * ============================================================================
 *
 * Recovery operation for workers / schedulers.
 *
 * This operation does NOT assign ownership to another worker.
 *
 * It only converts expired active claims into RELEASED, after which a later
 * claim() operation can acquire the operation with a fresh claim token.
 * ============================================================================
 */

StatementProcessingOperationSchema.statics
    .releaseExpiredClaims =
    async function releaseExpiredClaims({
        tenantId = null,
        limit = 100
    } = {}) {

        const normalizedLimit =
            Math.min(
                Math.max(
                    Number(limit) || 100,
                    1
                ),
                1000
            );

        const now =
            new Date();

        const filter = {
            status: {
                $in: [
                    OPERATION_STATUS.CLAIMED,
                    OPERATION_STATUS.PROCESSING
                ]
            },

            leaseExpiresAt: {
                $lte: now
            }
        };

        if (
            tenantId !== null &&
            tenantId !== undefined
        ) {
            filter.tenantId =
                normalizeRequiredString(
                    tenantId,
                    "tenantId",
                    256
                );
        }

        const candidates =
            await this.find(
                filter
            )
                .select(
                    "_id tenantId operationKey status leaseExpiresAt"
                )
                .sort({
                    leaseExpiresAt: 1
                })
                .limit(
                    normalizedLimit
                )
                .lean();

        if (
            candidates.length === 0
        ) {
            return {
                matchedCount: 0,
                releasedCount: 0,
                operations: []
            };
        }

        const released =
            [];

        for (
            const candidate of candidates
        ) {

            /**
             * Include the candidate's current state and lease timestamp.
             *
             * If another worker reclaimed it between the read and this
             * update, MongoDB will simply update zero documents.
             */
            const result =
                await this.updateOne(
                    {
                        _id:
                            candidate._id,

                        status:
                            candidate.status,

                        leaseExpiresAt: {
                            $lte: now
                        }
                    },
                    {
                        $set: {
                            status:
                                OPERATION_STATUS.RELEASED,

                            releasedAt:
                                now,

                            leaseExpiresAt:
                                now
                        }
                    }
                );

            if (
                result.modifiedCount === 1
            ) {

                released.push(
                    candidate
                );
            }
        }

        return {
            matchedCount:
                candidates.length,

            releasedCount:
                released.length,

            operations:
                released.map(
                    extractOperationContext
                )
        };
    };

/**
 * ============================================================================
 * GENERIC UPDATE GUARD
 * ============================================================================
 *
 * Prevents callers from accidentally changing operation identity through
 * generic update helpers.
 *
 * Lifecycle operations should use:
 * - claim()
 * - startProcessing()
 * - heartbeat()
 * - complete()
 * - fail()
 * - release()
 *
 * rather than arbitrary updateOne/findOneAndUpdate calls.
 * ============================================================================
 */

const IMMUTABLE_OPERATION_FIELDS =
    new Set([
        "tenantId",
        "operationKey",
        "idempotencyKey",
        "statementId",
        "provider",
        "providerStatementId",
        "correlationId",
        "requestId"
    ]);

function assertNoIdentityMutation(
    update
) {

    if (
        !update ||
        typeof update !==
            "object"
    ) {
        return;
    }

    const operators =
        [
            "$set",
            "$setOnInsert",
            "$unset",
            "$inc",
            "$push",
            "$addToSet",
            "$pull",
            "$rename",
            "$replaceWith"
        ];

    for (
        const operator of operators
    ) {

        const payload =
            update[operator];

        if (
            !payload ||
            typeof payload !==
                "object"
        ) {
            continue;
        }

        for (
            const field of Object.keys(
                payload
            )
        ) {

            const normalizedField =
                field.includes(".")
                    ? field.split(
                        "."
                    )[0]
                    : field;

            if (
                IMMUTABLE_OPERATION_FIELDS.has(
                    normalizedField
                )
            ) {

                throw new StatementProcessingOperationError(
                    `Operation identity field "${normalizedField}" cannot be modified.`,
                    {
                        code:
                            "IMMUTABLE_OPERATION_FIELD"
                    }
                );
            }
        }
    }
}

/**
 * ============================================================================
 * QUERY MIDDLEWARE
 * ============================================================================
 *
 * Protect generic findOneAndUpdate usage from identity mutation.
 *
 * Lifecycle statics above intentionally perform their own controlled atomic
 * updates.
 * ============================================================================
 */

StatementProcessingOperationSchema.pre(
    [
        "findOneAndUpdate",
        "findByIdAndUpdate",
        "updateOne",
        "updateMany"
    ],
    function protectIdentityFields(
        next
    ) {

        try {

            assertNoIdentityMutation(
                this.getUpdate()
            );

            return next();

        } catch (error) {

            return next(error);
        }
    }
);

/**
 * ============================================================================
 * MODEL
 * ============================================================================
 */

const StatementProcessingOperation =
    mongoose.models
        .StatementProcessingOperation ||
    mongoose.model(
        "StatementProcessingOperation",
        StatementProcessingOperationSchema
    );

/**
 * ============================================================================
 * Public Constants / Errors
 * ============================================================================
 */

StatementProcessingOperation.OPERATION_STATUS =
    OPERATION_STATUS;

StatementProcessingOperation.TERMINAL_STATUS =
    TERMINAL_STATUS;

StatementProcessingOperation.ALLOWED_TRANSITIONS =
    ALLOWED_TRANSITIONS;

StatementProcessingOperation.StatementProcessingOperationError =
    StatementProcessingOperationError;

/**
 * ============================================================================
 * Export
 * ============================================================================
 */

module.exports =
    StatementProcessingOperation;