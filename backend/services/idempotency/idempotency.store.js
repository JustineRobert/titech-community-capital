"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * African Community Finance Operating System (ACFOS)
 * =============================================================================
 *
 * File:
 *   backend/services/idempotency/idempotency.store.js
 *
 * Purpose:
 *   Transaction-aware persistence boundary for ACFOS idempotency records.
 *
 * Architecture:
 *
 *   HTTP Middleware
 *          │
 *          ▼
 *   Idempotency Service
 *          │
 *          ▼
 *   Idempotency Store
 *          │
 *          │ MongoDB session
 *          ▼
 *   MongoDB
 *
 * Financial command invariant:
 *
 *   Idempotency acquisition
 *          +
 *   Financial mutation
 *          +
 *   Idempotency completion
 *          =
 *   ONE MongoDB TRANSACTION
 *
 * Therefore:
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ MongoDB Transaction                                           │
 *   │                                                              │
 *   │  1. Acquire idempotency record                               │
 *   │  2. Create financial transaction                             │
 *   │  3. Mutate balance                                            │
 *   │  4. Create ledger entries                                     │
 *   │  5. Update loan state where applicable                       │
 *   │  6. Mark idempotency record COMPLETED                        │
 *   │                                                              │
 *   │                         COMMIT                               │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * IMPORTANT:
 *
 *   This store NEVER mutates:
 *
 *     - balances
 *     - ledgers
 *     - loans
 *     - external payment providers
 *
 *   It only persists idempotency state.
 *
 * IMPORTANT FAILURE SEMANTICS:
 *
 *   If the financial transaction aborts, the PROCESSING record created inside
 *   that transaction also rolls back.
 *
 *   Therefore this store MUST NOT attempt to write FAILED using an already
 *   aborted MongoDB transaction.
 *
 *   FAILED persistence is only appropriate when the idempotency record exists
 *   outside the aborted transaction or during explicit recovery/reconciliation.
 *
 * =============================================================================
 */

const crypto =
    require("crypto");

const {
    IdempotencyRecord
} = require(
    "../../models/idempotencyRecord.model"
);

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_RETENTION_MS =
    24 * 60 * 60 * 1000;

const MAX_RETENTION_MS =
    7 * 24 * 60 * 60 * 1000;

const PROCESSING_LEASE_MS =
    5 * 60 * 1000;

const STATUS = Object.freeze({

    PROCESSING:
        "PROCESSING",

    COMPLETED:
        "COMPLETED",

    FAILED:
        "FAILED",

    RECOVERY_REQUIRED:
        "RECOVERY_REQUIRED"

});

const RESULT_TYPE = Object.freeze({

    SUCCESS:
        "SUCCESS",

    CLIENT_ERROR:
        "CLIENT_ERROR",

    SERVER_ERROR:
        "SERVER_ERROR",

    RECOVERED_SUCCESS:
        "RECOVERED_SUCCESS",

    RECOVERED_FAILURE:
        "RECOVERED_FAILURE",

    RECOVERY_REQUIRED:
        "RECOVERY_REQUIRED"

});

// =============================================================================
// Error
// =============================================================================

class IdempotencyStoreError
    extends Error {

    constructor(
        message,
        code,
        details = null
    ) {

        super(message);

        this.name =
            "IdempotencyStoreError";

        this.code =
            code;

        this.details =
            details;

        if (
            Error.captureStackTrace
        ) {

            Error.captureStackTrace(
                this,
                IdempotencyStoreError
            );
        }
    }
}

// =============================================================================
// Validation
// =============================================================================

function assertSession(
    session,
    operation
) {

    if (!session) {

        throw new IdempotencyStoreError(

            `MongoDB session is required for ${operation}.`,

            "IDEMPOTENCY_SESSION_REQUIRED"

        );
    }
}

function normalizeRetention(
    retentionMs
) {

    const value =
        Number(
            retentionMs ??
            DEFAULT_RETENTION_MS
        );

    if (
        !Number.isFinite(value) ||
        value <= 0
    ) {

        return DEFAULT_RETENTION_MS;
    }

    return Math.min(
        value,
        MAX_RETENTION_MS
    );
}

// =============================================================================
// Canonical Serialization
// =============================================================================

/**
 * Recursively canonicalize an object so that:
 *
 * {
 *     amount: 100,
 *     currency: "UGX"
 * }
 *
 * and:
 *
 * {
 *     currency: "UGX",
 *     amount: 100
 * }
 *
 * generate the same fingerprint.
 */
function canonicalize(
    value
) {

    if (
        value === null ||
        value === undefined
    ) {

        return null;
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

        return Object.keys(value)
            .sort()
            .reduce(

                (
                    result,
                    key
                ) => {

                    result[key] =
                        canonicalize(
                            value[key]
                        );

                    return result;

                },

                {}

            );
    }

    return value;
}

// =============================================================================
// Request Fingerprint
// =============================================================================

/**
 * SHA-256 deterministic request fingerprint.
 *
 * The fingerprint binds an idempotency key to:
 *
 *   tenant
 *   principal
 *   operation
 *   resource
 *   request body
 *
 * This prevents:
 *
 *   Idempotency-Key: ABC
 *
 * from being reused for a materially different financial command.
 */
function createRequestFingerprint({

    tenantId,

    principalId,

    operation,

    resource,

    body

}) {

    const canonicalPayload =
        canonicalize({

            tenantId:
                tenantId ||
                null,

            principalId:
                principalId ||
                null,

            operation:
                operation ||
                null,

            resource:
                resource ||
                null,

            body:
                body ||
                {}

        });

    const serialized =
        JSON.stringify(
            canonicalPayload
        );

    return crypto
        .createHash("sha256")
        .update(
            serialized,
            "utf8"
        )
        .digest("hex");
}

// =============================================================================
// Acquisition
// =============================================================================

/**
 * Atomically acquire the logical financial command.
 *
 * Database uniqueness:
 *
 *   tenantId
 *   +
 *   principalId
 *   +
 *   idempotencyKey
 *
 * MUST be backed by a unique MongoDB index.
 *
 * Example:
 *
 *   {
 *       tenantId: 1,
 *       principalId: 1,
 *       idempotencyKey: 1
 *   }
 *
 * unique: true
 *
 * IMPORTANT:
 *
 * No upsert is intentionally used here.
 *
 * The unique index is the final concurrency authority.
 */
async function acquireProcessingRecord({

    tenantId,

    principalId,

    deviceId = null,

    idempotencyKey,

    operation,

    resource,

    transactionId,

    requestFingerprint,

    retentionMs =
        DEFAULT_RETENTION_MS,

    expiresAt = null,

    session

}) {

    assertSession(
        session,
        "idempotency acquisition"
    );

    const now =
        new Date();

    const effectiveRetention =
        normalizeRetention(
            retentionMs
        );

    const effectiveExpiresAt =
        expiresAt ||
        new Date(
            now.getTime() +
            effectiveRetention
        );

    try {

        const [record] =
            await IdempotencyRecord.create(

                [

                    {

                        tenantId,

                        principalId,

                        deviceId:
                            deviceId ||
                            null,

                        idempotencyKey,

                        operation,

                        resource,

                        transactionId:
                            transactionId ||
                            null,

                        requestFingerprint,

                        status:
                            STATUS.PROCESSING,

                        processingStartedAt:
                            now,

                        lastProcessingHeartbeatAt:
                            now,

                        expiresAt:
                            effectiveExpiresAt,

                        createdAt:
                            now,

                        updatedAt:
                            now

                    }

                ],

                {
                    session
                }

            );

        return {

            acquired:
                true,

            created:
                true,

            record

        };

    } catch (error) {

        /*
         * Duplicate-key is the expected concurrency signal.
         *
         * DO NOT classify:
         *
         *   write conflicts
         *   transaction aborts
         *   network failures
         *   validation failures
         *
         * as duplicate requests.
         */

        if (
            error &&
            error.code === 11000
        ) {

            const existing =
                await IdempotencyRecord
                    .findOne({

                        tenantId,

                        principalId,

                        idempotencyKey

                    })
                    .session(
                        session
                    )
                    .lean();

            if (!existing) {

                throw new IdempotencyStoreError(

                    "Idempotency record became unavailable after duplicate-key conflict.",

                    "IDEMPOTENCY_RECORD_RACE_UNRESOLVED"

                );
            }

            return {

                acquired:
                    false,

                created:
                    false,

                record:
                    existing

            };
        }

        throw error;
    }
}

// =============================================================================
// Legacy Compatibility
// =============================================================================

/**
 * Existing callers may still use:
 *
 *   createProcessingRecord(...)
 *
 * New code should prefer:
 *
 *   acquireProcessingRecord(...)
 */
const createProcessingRecord =
    acquireProcessingRecord;

// =============================================================================
// Get Record
// =============================================================================

async function getRecord({

    tenantId,

    principalId,

    idempotencyKey,

    session = null

}) {

    const query =
        IdempotencyRecord.findOne({

            tenantId,

            principalId,

            idempotencyKey

        });

    if (session) {

        query.session(
            session
        );
    }

    return query.lean();
}

// =============================================================================
// Get Record By ID
// =============================================================================

async function getRecordById({

    recordId,

    session = null

}) {

    const query =
        IdempotencyRecord.findById(
            recordId
        );

    if (session) {

        query.session(
            session
        );
    }

    return query.lean();
}

// =============================================================================
// Complete
// =============================================================================

/**
 * PROCESSING → COMPLETED
 *
 * This operation MUST execute inside the same MongoDB transaction that
 * performed the financial mutation.
 *
 * Therefore:
 *
 *   financial mutation
 *       +
 *   completion
 *
 * either both commit or both roll back.
 */
async function completeRecord({

    recordId,

    httpStatus = 200,

    responseBody = {},

    resultType =
        RESULT_TYPE.SUCCESS,

    errorCode = null,

    transactionId = null,

    session

}) {

    assertSession(
        session,
        "idempotency completion"
    );

    const now =
        new Date();

    const setFields = {

        status:
            STATUS.COMPLETED,

        resultType,

        httpStatus,

        responseBody:
            responseBody ||
            {},

        errorCode,

        completedAt:
            now,

        updatedAt:
            now

    };

    if (
        transactionId
    ) {

        setFields.transactionId =
            transactionId;
    }

    const record =
        await IdempotencyRecord
            .findOneAndUpdate(

                {

                    _id:
                        recordId,

                    status:
                        STATUS.PROCESSING

                },

                {

                    $set:
                        setFields

                },

                {

                    session,

                    new:
                        true,

                    runValidators:
                        true

                }

            );

    if (!record) {

        throw new IdempotencyStoreError(

            "Unable to transition idempotency record from PROCESSING to COMPLETED.",

            "IDEMPOTENCY_COMPLETION_FAILED"

        );
    }

    return record;
}

// =============================================================================
// Fail
// =============================================================================

/**
 * PROCESSING → FAILED
 *
 * IMPORTANT:
 *
 * This method is session-aware but MUST NOT be called using an already-aborted
 * financial transaction session.
 *
 * If acquisition happened inside the financial transaction, the PROCESSING
 * record itself is rolled back when the transaction aborts.
 *
 * The financial transaction service should therefore only use this method when
 * it has a durable PROCESSING record outside the failed transaction, or during
 * a separate recovery workflow.
 */
async function failRecord({

    recordId,

    httpStatus,

    responseBody = {},

    errorCode =
        "FINANCIAL_OPERATION_FAILED",

    session

}) {

    assertSession(
        session,
        "idempotency failure"
    );

    const numericStatus =
        Number(
            httpStatus
        );

    const resultType =
        numericStatus >= 500
            ? RESULT_TYPE.SERVER_ERROR
            : RESULT_TYPE.CLIENT_ERROR;

    const record =
        await IdempotencyRecord
            .findOneAndUpdate(

                {

                    _id:
                        recordId,

                    status:
                        STATUS.PROCESSING

                },

                {

                    $set: {

                        status:
                            STATUS.FAILED,

                        resultType,

                        httpStatus:
                            numericStatus,

                        responseBody:
                            responseBody ||
                            {},

                        errorCode,

                        completedAt:
                            new Date(),

                        updatedAt:
                            new Date()

                    }

                },

                {

                    session,

                    new:
                        true,

                    runValidators:
                        true

                }

            );

    if (!record) {

        throw new IdempotencyStoreError(

            "Unable to persist failed idempotency operation.",

            "IDEMPOTENCY_FAILURE_PERSIST_FAILED"

        );
    }

    return record;
}

// =============================================================================
// Heartbeat
// =============================================================================

/**
 * Extend the processing lease.
 *
 * This is primarily intended for long-running workflows/recovery operations.
 *
 * A heartbeat inside the same MongoDB transaction does not provide a durable
 * lease until the transaction commits, so external long-running work should
 * use an independent persistence transaction where appropriate.
 */
async function heartbeatRecord({

    recordId,

    session

}) {

    assertSession(
        session,
        "idempotency heartbeat"
    );

    const now =
        new Date();

    const record =
        await IdempotencyRecord
            .findOneAndUpdate(

                {

                    _id:
                        recordId,

                    status:
                        STATUS.PROCESSING

                },

                {

                    $set: {

                        lastProcessingHeartbeatAt:
                            now,

                        updatedAt:
                            now

                    }

                },

                {

                    session,

                    new:
                        true

                }

            );

    return record;
}

// =============================================================================
// Recover Stale Record
// =============================================================================

/**
 * PROCESSING → RECOVERY_REQUIRED
 *
 * NEVER automatically converts a stale financial command into FAILED.
 *
 * A stale process can mean:
 *
 *   A. financial transaction never committed
 *
 * or:
 *
 *   B. financial transaction committed but process crashed before the
 *      idempotency response was persisted.
 *
 * Therefore reconciliation must determine the truth.
 */
async function recoverStaleRecord({

    recordId,

    session

}) {

    assertSession(
        session,
        "stale idempotency recovery"
    );

    const staleBefore =
        new Date(

            Date.now() -
            PROCESSING_LEASE_MS

        );

    const now =
        new Date();

    return IdempotencyRecord
        .findOneAndUpdate(

            {

                _id:
                    recordId,

                status:
                    STATUS.PROCESSING,

                $or: [

                    {

                        lastProcessingHeartbeatAt: {

                            $lt:
                                staleBefore

                        }

                    },

                    {

                        lastProcessingHeartbeatAt:
                            null,

                        processingStartedAt: {

                            $lt:
                                staleBefore

                        }

                    }

                ]

            },

            {

                $set: {

                    status:
                        STATUS.RECOVERY_REQUIRED,

                    resultType:
                        RESULT_TYPE.RECOVERY_REQUIRED,

                    httpStatus:
                        409,

                    errorCode:
                        "IDEMPOTENCY_PROCESSING_EXPIRED",

                    responseBody: {

                        success:
                            false,

                        code:
                            "IDEMPOTENCY_PROCESSING_EXPIRED",

                        message:
                            "The previous financial operation requires reconciliation before it can safely be retried."

                    },

                    recoveryRequiredAt:
                        now,

                    updatedAt:
                        now

                }

            },

            {

                session,

                new:
                    true,

                runValidators:
                    true

            }

        );
}

// =============================================================================
// Resolve Recovery → COMPLETED
// =============================================================================

/**
 * RECOVERY_REQUIRED → COMPLETED
 *
 * Used only after reconciliation proves that the financial mutation
 * committed.
 */
async function resolveRecoveryAsCompleted({

    recordId,

    httpStatus =
        200,

    responseBody = {},

    transactionId = null,

    session

}) {

    assertSession(
        session,
        "idempotency recovery completion"
    );

    const now =
        new Date();

    const setFields = {

        status:
            STATUS.COMPLETED,

        resultType:
            RESULT_TYPE.RECOVERED_SUCCESS,

        httpStatus,

        responseBody:
            responseBody ||
            {},

        completedAt:
            now,

        recoveryResolvedAt:
            now,

        updatedAt:
            now

    };

    if (
        transactionId
    ) {

        setFields.transactionId =
            transactionId;
    }

    const record =
        await IdempotencyRecord
            .findOneAndUpdate(

                {

                    _id:
                        recordId,

                    status:
                        STATUS.RECOVERY_REQUIRED

                },

                {

                    $set:
                        setFields

                },

                {

                    session,

                    new:
                        true,

                    runValidators:
                        true

                }

            );

    if (!record) {

        throw new IdempotencyStoreError(

            "Unable to resolve idempotency recovery as completed.",

            "IDEMPOTENCY_RECOVERY_COMPLETION_FAILED"

        );
    }

    return record;
}

// =============================================================================
// Resolve Recovery → FAILED
// =============================================================================

/**
 * RECOVERY_REQUIRED → FAILED
 *
 * Used only after reconciliation proves that no financial mutation committed.
 */
async function resolveRecoveryAsFailed({

    recordId,

    httpStatus =
        500,

    responseBody = {},

    errorCode =
        "FINANCIAL_OPERATION_FAILED",

    session

}) {

    assertSession(
        session,
        "idempotency recovery failure"
    );

    const now =
        new Date();

    const numericStatus =
        Number(
            httpStatus
        );

    const record =
        await IdempotencyRecord
            .findOneAndUpdate(

                {

                    _id:
                        recordId,

                    status:
                        STATUS.RECOVERY_REQUIRED

                },

                {

                    $set: {

                        status:
                            STATUS.FAILED,

                        resultType:
                            RESULT_TYPE.RECOVERED_FAILURE,

                        httpStatus:
                            numericStatus,

                        responseBody:
                            responseBody ||
                            {},

                        errorCode,

                        completedAt:
                            now,

                        recoveryResolvedAt:
                            now,

                        updatedAt:
                            now

                    }

                },

                {

                    session,

                    new:
                        true,

                    runValidators:
                        true

                }

            );

    if (!record) {

        throw new IdempotencyStoreError(

            "Unable to resolve idempotency recovery as failed.",

            "IDEMPOTENCY_RECOVERY_FAILURE_FAILED"

        );
    }

    return record;
}

// =============================================================================
// Delete Expired Records
// =============================================================================

/**
 * Maintenance operation.
 *
 * MongoDB TTL indexes should remain the primary automatic retention mechanism.
 *
 * This method is useful for controlled cleanup, administrative jobs and
 * environments where explicit deletion is required.
 *
 * Recovery-required records are intentionally excluded.
 */
async function deleteExpiredRecords({

    limit =
        1000,

    session = null

} = {}) {

    const now =
        new Date();

    const query =
        IdempotencyRecord
            .find({

                expiresAt: {

                    $lt:
                        now

                },

                status: {

                    $in: [

                        STATUS.COMPLETED,

                        STATUS.FAILED

                    ]

                }

            })
            .select(
                "_id"
            )
            .limit(
                limit
            );

    if (session) {

        query.session(
            session
        );
    }

    const records =
        await query.lean();

    if (
        !records.length
    ) {

        return {

            deleted:
                0

        };
    }

    const ids =
        records.map(
            record =>
                record._id
        );

    const deleteQuery =
        IdempotencyRecord
            .deleteMany({

                _id: {

                    $in:
                        ids

                }

            });

    if (session) {

        deleteQuery.session(
            session
        );
    }

    const result =
        await deleteQuery;

    return {

        deleted:
            result.deletedCount ||
            0

    };
}

// =============================================================================
// Repository Contract
// =============================================================================

const IDEMPOTENCY_STORE_CONTRACT =
    Object.freeze({

        acquisition: [

            "acquireProcessingRecord"

        ],

        reads: [

            "getRecord",

            "getRecordById"

        ],

        transactionCompletion: [

            "completeRecord"

        ],

        failure: [

            "failRecord"

        ],

        lease: [

            "heartbeatRecord",

            "recoverStaleRecord"

        ],

        recovery: [

            "resolveRecoveryAsCompleted",

            "resolveRecoveryAsFailed"

        ],

        maintenance: [

            "deleteExpiredRecords"

        ]

    });

// =============================================================================
// Exports
// =============================================================================

module.exports = {

    IdempotencyStoreError,

    DEFAULT_RETENTION_MS,

    DEFAULT_IDEMPOTENCY_TTL_MS:
        DEFAULT_RETENTION_MS,

    MAX_RETENTION_MS,

    PROCESSING_LEASE_MS,

    PROCESSING_TIMEOUT_MS:
        PROCESSING_LEASE_MS,

    STATUS,

    RESULT_TYPE,

    IDEMPOTENCY_STORE_CONTRACT,

    createRequestFingerprint,

    acquireProcessingRecord,

    createProcessingRecord,

    getRecord,

    getRecordById,

    completeRecord,

    failRecord,

    heartbeatRecord,

    recoverStaleRecord,

    resolveRecoveryAsCompleted,

    resolveRecoveryAsFailed,

    deleteExpiredRecords

};