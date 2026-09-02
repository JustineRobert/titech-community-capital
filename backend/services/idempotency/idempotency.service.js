"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * ACFOS Idempotency Service
 * =============================================================================
 *
 * File:
 *   backend/services/idempotency/idempotency.service.js
 *
 * Purpose:
 *   Enforce financial idempotency semantics independently from HTTP middleware.
 *
 * Responsibilities:
 *
 *   ✓ Validate financial operation context
 *   ✓ Normalize idempotency identity
 *   ✓ Generate deterministic request fingerprints
 *   ✓ Create persistent PROCESSING records
 *   ✓ Detect duplicate requests
 *   ✓ Detect idempotency-key reuse with different payloads
 *   ✓ Replay completed operations
 *   ✓ Replay deterministic failures
 *   ✓ Detect stale processing operations
 *   ✓ Expose explicit recovery semantics
 *   ✓ Complete persistent operations
 *   ✓ Fail persistent operations
 *   ✓ Support MongoDB transaction sessions
 *
 * IMPORTANT:
 *
 *   This service does NOT mutate balances or ledgers.
 *
 *   Financial mutations belong to:
 *
 *       financialTransaction.service.js
 *
 * Transaction boundary:
 *
 *   beginOperation()
 *        ↓
 *   MongoDB financial transaction
 *        ↓
 *   ledger mutation
 *        ↓
 *   balance mutation
 *        ↓
 *   completeOperation({ session })
 *        ↓
 *   COMMIT
 *
 * =============================================================================
 */

const {
    createRequestFingerprint,
    createProcessingRecord,
    recoverStaleRecord,
    completeRecord,
    failRecord
} = require(
    "./idempotency.store"
);

// =============================================================================
// Constants
// =============================================================================

const IDEMPOTENCY_KEY_MAX_LENGTH =
    255;

const OPERATION_MAX_LENGTH =
    150;

const RESOURCE_MAX_LENGTH =
    255;

const VALID_HTTP_STATUS_MIN =
    100;

const VALID_HTTP_STATUS_MAX =
    599;

// =============================================================================
// Statuses
// =============================================================================

const IDEMPOTENCY_STATUS =
    Object.freeze({

        PROCESSING:
            "PROCESSING",

        COMPLETED:
            "COMPLETED",

        FAILED:
            "FAILED"

    });

// =============================================================================
// Result Types
// =============================================================================

const IDEMPOTENCY_RESULT_TYPE =
    Object.freeze({

        SUCCESS:
            "SUCCESS",

        CLIENT_ERROR:
            "CLIENT_ERROR",

        SERVER_ERROR:
            "SERVER_ERROR"

    });

// =============================================================================
// Errors
// =============================================================================

class IdempotencyError
    extends Error {

    constructor(
        message,
        code,
        statusCode = 409,
        details = null
    ) {

        super(
            message
        );

        this.name =
            "IdempotencyError";

        this.code =
            code;

        this.statusCode =
            statusCode;

        this.details =
            details;

        if (
            Error.captureStackTrace
        ) {

            Error.captureStackTrace(
                this,
                IdempotencyError
            );
        }
    }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Normalize an identifier.
 */
function normalizeIdentifier(
    value
) {

    if (
        value === null ||
        value === undefined
    ) {

        return null;
    }

    const normalized =
        String(
            value
        ).trim();

    return normalized ||
        null;
}

/**
 * Normalize idempotency key.
 *
 * The key is opaque and client-generated.
 */
function normalizeIdempotencyKey(
    value
) {

    const key =
        normalizeIdentifier(
            value
        );

    if (!key) {

        throw new IdempotencyError(

            "Idempotency-Key is required.",

            "IDEMPOTENCY_KEY_REQUIRED",

            400

        );
    }

    if (
        key.length >
        IDEMPOTENCY_KEY_MAX_LENGTH
    ) {

        throw new IdempotencyError(

            `Idempotency-Key must not exceed ${IDEMPOTENCY_KEY_MAX_LENGTH} characters.`,

            "IDEMPOTENCY_KEY_TOO_LONG",

            400

        );
    }

    return key;
}

/**
 * Normalize operation.
 */
function normalizeOperation(
    value
) {

    const operation =
        normalizeIdentifier(
            value
        );

    if (!operation) {

        throw new IdempotencyError(

            "Financial operation is required.",

            "FINANCIAL_OPERATION_REQUIRED",

            400

        );
    }

    if (
        operation.length >
        OPERATION_MAX_LENGTH
    ) {

        throw new IdempotencyError(

            `Financial operation must not exceed ${OPERATION_MAX_LENGTH} characters.`,

            "FINANCIAL_OPERATION_TOO_LONG",

            400

        );
    }

    return operation;
}

/**
 * Normalize resource.
 */
function normalizeResource(
    value
) {

    const resource =
        normalizeIdentifier(
            value
        );

    if (!resource) {

        throw new IdempotencyError(

            "Financial resource is required.",

            "FINANCIAL_RESOURCE_REQUIRED",

            400

        );
    }

    if (
        resource.length >
        RESOURCE_MAX_LENGTH
    ) {

        throw new IdempotencyError(

            `Financial resource must not exceed ${RESOURCE_MAX_LENGTH} characters.`,

            "FINANCIAL_RESOURCE_TOO_LONG",

            400

        );
    }

    return resource;
}

/**
 * Normalize HTTP status.
 */
function normalizeHttpStatus(
    value,
    fallback = 200
) {

    const status =
        Number(
            value ??
            fallback
        );

    if (
        !Number.isInteger(
            status
        ) ||
        status <
            VALID_HTTP_STATUS_MIN ||
        status >
            VALID_HTTP_STATUS_MAX
    ) {

        throw new IdempotencyError(

            "Invalid HTTP status code.",

            "IDEMPOTENCY_INVALID_HTTP_STATUS",

            500

        );
    }

    return status;
}

/**
 * Normalize result type.
 */
function normalizeResultType(
    value,
    fallback = IDEMPOTENCY_RESULT_TYPE.SUCCESS
) {

    const resultType =
        String(
            value ||
            fallback
        )
        .trim()
        .toUpperCase();

    if (
        !Object.values(
            IDEMPOTENCY_RESULT_TYPE
        ).includes(
            resultType
        )
    ) {

        throw new IdempotencyError(

            "Invalid idempotency result type.",

            "IDEMPOTENCY_INVALID_RESULT_TYPE",

            500,

            {
                resultType
            }

        );
    }

    return resultType;
}

/**
 * Validate MongoDB session when one is supplied.
 *
 * We intentionally do not require a session for all operations because:
 *
 *   - beginOperation() creates the PROCESSING record before the financial
 *     transaction begins.
 *   - failOperation() is normally persisted after transaction rollback.
 *
 * A session is specifically required when the caller wants an idempotency
 * mutation to participate in an existing MongoDB transaction.
 */
function validateSession(
    session
) {

    if (
        session === null ||
        session === undefined
    ) {

        return null;
    }

    if (
        typeof session !==
        "object"
    ) {

        throw new IdempotencyError(

            "Invalid MongoDB transaction session.",

            "IDEMPOTENCY_INVALID_SESSION",

            500

        );
    }

    return session;
}

// =============================================================================
// Request Context Validation
// =============================================================================

function validateContext({

    tenantId,

    principalId,

    idempotencyKey,

    operation,

    resource

}) {

    if (!tenantId) {

        throw new IdempotencyError(

            "Tenant context is required.",

            "TENANT_CONTEXT_REQUIRED",

            400

        );
    }

    if (!principalId) {

        throw new IdempotencyError(

            "Authenticated principal is required.",

            "AUTHENTICATED_PRINCIPAL_REQUIRED",

            401

        );
    }

    if (!idempotencyKey) {

        throw new IdempotencyError(

            "Idempotency-Key is required.",

            "IDEMPOTENCY_KEY_REQUIRED",

            400

        );
    }

    if (!operation) {

        throw new IdempotencyError(

            "Financial operation is required.",

            "FINANCIAL_OPERATION_REQUIRED",

            400

        );
    }

    if (!resource) {

        throw new IdempotencyError(

            "Financial resource is required.",

            "FINANCIAL_RESOURCE_REQUIRED",

            400

        );
    }
}

// =============================================================================
// Request Fingerprint
// =============================================================================

function buildRequestFingerprint({

    tenantId,

    principalId,

    operation,

    resource,

    body

}) {

    const fingerprint =
        createRequestFingerprint({

            tenantId,

            principalId,

            operation,

            resource,

            body:
                body || {}

        });

    if (!fingerprint) {

        throw new IdempotencyError(

            "Unable to create request fingerprint.",

            "IDEMPOTENCY_FINGERPRINT_FAILED",

            500

        );
    }

    return fingerprint;
}

// =============================================================================
// Begin Operation
// =============================================================================

async function beginOperation({

    tenantId,

    principalId,

    deviceId =
        null,

    idempotencyKey,

    operation,

    resource,

    transactionId =
        null,

    body =
        {}

}) {

    const normalizedTenantId =
        normalizeIdentifier(
            tenantId
        );

    const normalizedPrincipalId =
        normalizeIdentifier(
            principalId
        );

    const normalizedDeviceId =
        normalizeIdentifier(
            deviceId
        );

    const normalizedTransactionId =
        normalizeIdentifier(
            transactionId
        );

    const normalizedKey =
        normalizeIdempotencyKey(
            idempotencyKey
        );

    const normalizedOperation =
        normalizeOperation(
            operation
        );

    const normalizedResource =
        normalizeResource(
            resource
        );

    validateContext({

        tenantId:
            normalizedTenantId,

        principalId:
            normalizedPrincipalId,

        idempotencyKey:
            normalizedKey,

        operation:
            normalizedOperation,

        resource:
            normalizedResource

    });

    // =========================================================================
    // Request fingerprint
    // =========================================================================

    const requestFingerprint =
        buildRequestFingerprint({

            tenantId:
                normalizedTenantId,

            principalId:
                normalizedPrincipalId,

            operation:
                normalizedOperation,

            resource:
                normalizedResource,

            body

        });

    // =========================================================================
    // Persistent operation acquisition
    // =========================================================================

    const result =
        await createProcessingRecord({

            tenantId:
                normalizedTenantId,

            principalId:
                normalizedPrincipalId,

            deviceId:
                normalizedDeviceId,

            idempotencyKey:
                normalizedKey,

            operation:
                normalizedOperation,

            resource:
                normalizedResource,

            transactionId:
                normalizedTransactionId,

            requestFingerprint

        });

    // =========================================================================
    // First request
    // =========================================================================

    if (
        result &&
        result.created
    ) {

        if (
            !result.record
        ) {

            throw new IdempotencyError(

                "Idempotency operation was created without a persistent record.",

                "IDEMPOTENCY_RECORD_MISSING_AFTER_CREATE",

                503

            );
        }

        return {

            state:
                "NEW",

            record:
                result.record,

            requestFingerprint

        };
    }

    // =========================================================================
    // Existing operation
    // =========================================================================

    const existing =
        result &&
        result.record;

    if (
        !existing
    ) {

        throw new IdempotencyError(

            "Unable to resolve idempotency state.",

            "IDEMPOTENCY_STATE_UNAVAILABLE",

            503

        );
    }

    // =========================================================================
    // Tenant isolation
    // =========================================================================

    if (
        String(
            existing.tenantId
        ) !==
        normalizedTenantId
    ) {

        throw new IdempotencyError(

            "The idempotency operation cannot be resolved for this tenant.",

            "IDEMPOTENCY_TENANT_CONFLICT",

            409

        );
    }

    // =========================================================================
    // Principal isolation
    // =========================================================================

    if (
        String(
            existing.principalId
        ) !==
        normalizedPrincipalId
    ) {

        throw new IdempotencyError(

            "The idempotency operation cannot be resolved for this principal.",

            "IDEMPOTENCY_PRINCIPAL_CONFLICT",

            409

        );
    }

    // =========================================================================
    // Fingerprint mismatch
    // =========================================================================

    if (
        existing.requestFingerprint !==
        requestFingerprint
    ) {

        throw new IdempotencyError(

            "The Idempotency-Key has already been used with a different request.",

            "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",

            409

        );
    }

    // =========================================================================
    // Completed
    // =========================================================================

    if (
        existing.status ===
        IDEMPOTENCY_STATUS.COMPLETED
    ) {

        return {

            state:
                "REPLAY",

            record:
                existing,

            requestFingerprint

        };
    }

    // =========================================================================
    // Failed
    // =========================================================================

    if (
        existing.status ===
        IDEMPOTENCY_STATUS.FAILED
    ) {

        return {

            state:
                "REPLAY",

            record:
                existing,

            requestFingerprint

        };
    }

    // =========================================================================
    // Processing
    // =========================================================================

    if (
        existing.status ===
        IDEMPOTENCY_STATUS.PROCESSING
    ) {

        const recovered =
            await recoverStaleRecord({

                recordId:
                    existing._id

            });

        if (
            recovered
        ) {

            return {

                state:
                    "RETRY_AFTER_RECOVERY",

                record:
                    recovered,

                requestFingerprint

            };
        }

        throw new IdempotencyError(

            "This financial operation is already being processed.",

            "IDEMPOTENCY_OPERATION_IN_PROGRESS",

            409

        );
    }

    // =========================================================================
    // Unknown state
    // =========================================================================

    throw new IdempotencyError(

        "Unknown idempotency state.",

        "IDEMPOTENCY_UNKNOWN_STATE",

        500,

        {
            status:
                existing.status
        }

    );
}

// =============================================================================
// Complete Operation
// =============================================================================

/**
 * Mark an idempotency operation as COMPLETED.
 *
 * `session` is critical when this method is called from the financial
 * transaction service.
 *
 * Example:
 *
 *     await completeOperation({
 *
 *         recordId,
 *
 *         httpStatus: 201,
 *
 *         responseBody,
 *
 *         resultType: "SUCCESS",
 *
 *         session
 *
 *     });
 *
 * When a session is supplied, the idempotency update participates in the
 * caller's MongoDB transaction.
 */
async function completeOperation({

    recordId,

    httpStatus =
        200,

    responseBody =
        {},

    resultType =
        IDEMPOTENCY_RESULT_TYPE.SUCCESS,

    errorCode =
        null,

    session =
        null

}) {

    if (
        !recordId
    ) {

        throw new IdempotencyError(

            "Idempotency record identifier is required.",

            "IDEMPOTENCY_RECORD_ID_REQUIRED",

            500

        );
    }

    const normalizedStatus =
        normalizeHttpStatus(

            httpStatus,

            200

        );

    const normalizedResultType =
        normalizeResultType(

            resultType,

            IDEMPOTENCY_RESULT_TYPE.SUCCESS

        );

    const normalizedSession =
        validateSession(
            session
        );

    const completed =
        await completeRecord({

            recordId,

            httpStatus:
                normalizedStatus,

            responseBody:
                responseBody || {},

            resultType:
                normalizedResultType,

            errorCode:
                errorCode ||
                null,

            session:
                normalizedSession

        });

    if (
        !completed
    ) {

        throw new IdempotencyError(

            "Unable to complete idempotency operation because the record is no longer PROCESSING.",

            "IDEMPOTENCY_COMPLETION_STATE_CONFLICT",

            409

        );
    }

    return completed;
}

// =============================================================================
// Fail Operation
// =============================================================================

/**
 * Mark an idempotency operation as FAILED.
 *
 * This method accepts an optional session.
 *
 * Normal financial failure path:
 *
 *     execute()
 *        ↓
 *     ERROR
 *        ↓
 *     abortTransaction()
 *        ↓
 *     failOperation()
 *
 * Therefore failure persistence normally occurs AFTER rollback.
 *
 * The session parameter is nevertheless supported for callers that explicitly
 * need failure state inside a larger transaction boundary.
 */
async function failOperation({

    recordId,

    httpStatus =
        500,

    responseBody =
        {},

    errorCode =
        "FINANCIAL_OPERATION_FAILED",

    session =
        null

}) {

    if (
        !recordId
    ) {

        throw new IdempotencyError(

            "Idempotency record identifier is required.",

            "IDEMPOTENCY_RECORD_ID_REQUIRED",

            500

        );
    }

    const normalizedStatus =
        normalizeHttpStatus(

            httpStatus,

            500

        );

    const normalizedSession =
        validateSession(
            session
        );

    const normalizedErrorCode =
        normalizeIdentifier(
            errorCode
        ) ||
        "FINANCIAL_OPERATION_FAILED";

    const failed =
        await failRecord({

            recordId,

            httpStatus:
                normalizedStatus,

            responseBody:
                responseBody || {},

            errorCode:
                normalizedErrorCode,

            session:
                normalizedSession

        });

    if (
        !failed
    ) {

        throw new IdempotencyError(

            "Unable to fail idempotency operation because the record is no longer PROCESSING.",

            "IDEMPOTENCY_FAILURE_STATE_CONFLICT",

            409

        );
    }

    return failed;
}

// =============================================================================
// Exports
// =============================================================================

module.exports = {

    IdempotencyError,

    IDEMPOTENCY_STATUS,

    IDEMPOTENCY_RESULT_TYPE,

    beginOperation,

    completeOperation,

    failOperation,

    normalizeIdentifier,

    normalizeIdempotencyKey,

    normalizeOperation,

    normalizeResource,

    normalizeHttpStatus,

    normalizeResultType,

    buildRequestFingerprint

};