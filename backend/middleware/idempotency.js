"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * ACFOS Financial Idempotency Middleware
 * =============================================================================
 *
 * File:
 *   backend/middleware/idempotency.js
 *
 * Purpose:
 *   Enforce HTTP idempotency at financial-operation boundaries.
 *
 * Architecture:
 *
 *   Request Context
 *        ↓
 *   Authentication
 *        ↓
 *   Tenant Authorization
 *        ↓
 *   Idempotency Middleware
 *        ↓
 *   Financial Controller
 *        ↓
 *   Financial Transaction Service
 *        ↓
 *   Ledger / Balance Mutation
 *
 * Required upstream middleware:
 *
 *   1. Request context
 *   2. Authentication
 *   3. Tenant authorization
 *
 * Required downstream behavior:
 *
 *   Financial controller/service must call:
 *
 *       await req.idempotency.complete(...)
 *
 *   or:
 *
 *       await req.idempotency.fail(...)
 *
 * IMPORTANT:
 *
 *   This middleware does NOT maintain an in-memory cache.
 *
 *   Persistent idempotency state is delegated to:
 *
 *       backend/services/idempotency/idempotency.service.js
 *
 *   This allows idempotency to survive:
 *
 *       - process restarts
 *       - horizontal scaling
 *       - multiple API instances
 *       - worker execution
 *       - retries
 *       - network failures
 *
 * =============================================================================
 */

const {
    beginOperation,
    completeOperation,
    failOperation,
    IdempotencyError
} = require(
    "../services/idempotency/idempotency.service"
);

// =============================================================================
// Constants
// =============================================================================

const IDEMPOTENT_METHODS =
    new Set([
        "POST",
        "PUT",
        "PATCH",
        "DELETE"
    ]);

const IDEMPOTENCY_HEADER =
    "Idempotency-Key";

const MAX_IDEMPOTENCY_KEY_LENGTH =
    255;

// =============================================================================
// Helpers
// =============================================================================

/**
 * Normalize an incoming idempotency key.
 *
 * We deliberately do NOT generate a key from the request body.
 *
 * Why?
 *
 * Financial operations must have an explicit operation identity.
 *
 * Automatically deriving a key from:
 *
 *     method + path + body
 *
 * can incorrectly merge two legitimate financial operations that happen to
 * contain identical payloads.
 *
 * Example:
 *
 *     POST /savings/deposit
 *     { amount: 10000 }
 *
 * Two legitimate deposits of 10,000 UGX could have identical bodies but
 * represent two completely different business operations.
 */
function getIdempotencyKey(req) {

    const rawKey =
        req.get(
            IDEMPOTENCY_HEADER
        ) ||
        req.get(
            "X-Idempotency-Key"
        ) ||
        req.idempotencyKey ||
        null;

    if (
        rawKey === null ||
        rawKey === undefined
    ) {
        return null;
    }

    const key =
        String(
            rawKey
        ).trim();

    if (!key) {
        return null;
    }

    return key;
}

/**
 * Validate the idempotency key.
 *
 * The persistent service may perform additional validation, but validating
 * here gives the API an early and deterministic failure.
 */
function validateIdempotencyKey(
    key
) {

    if (!key) {

        throw new IdempotencyError(
            "The Idempotency-Key header is required for this financial operation.",
            "IDEMPOTENCY_KEY_REQUIRED",
            400
        );
    }

    if (
        key.length >
        MAX_IDEMPOTENCY_KEY_LENGTH
    ) {

        throw new IdempotencyError(
            `The Idempotency-Key must not exceed ${MAX_IDEMPOTENCY_KEY_LENGTH} characters.`,
            "IDEMPOTENCY_KEY_TOO_LONG",
            400
        );
    }

    return true;
}

/**
 * Resolve the authenticated principal.
 *
 * Supports the current ACFOS authentication shapes while keeping the
 * middleware independent from the authentication implementation.
 */
function resolvePrincipalId(
    req
) {

    const principalId =
        req.user?.id ||
        req.user?._id ||
        req.auth?.userId ||
        req.auth?.principalId ||
        null;

    return principalId
        ? String(
            principalId
        )
        : null;
}

/**
 * Resolve tenant identity.
 */
function resolveTenantId(
    req
) {

    const tenantId =
        req.tenantId ||
        req.auth?.tenantId ||
        req.user?.tenantId ||
        null;

    return tenantId
        ? String(
            tenantId
        )
        : null;
}

/**
 * Resolve device identity.
 *
 * Device identity is useful for offline-first ACFOS workflows because the
 * same logical operation may originate from a specific registered device.
 */
function resolveDeviceId(
    req
) {

    const deviceId =
        req.deviceId ||
        req.headers[
            "x-device-id"
        ] ||
        null;

    return deviceId
        ? String(
            deviceId
        )
        : null;
}

/**
 * Resolve transaction identity when one has already been established by
 * an upstream request/financial transaction layer.
 */
function resolveTransactionId(
    req
) {

    const transactionId =
        req.transactionId ||
        req.headers[
            "x-transaction-id"
        ] ||
        null;

    return transactionId
        ? String(
            transactionId
        )
        : null;
}

/**
 * Resolve a stable operation name.
 */
function resolveOperation(
    req,
    operation
) {

    if (operation) {
        return String(
            operation
        );
    }

    const method =
        String(
            req.method ||
            ""
        ).toUpperCase();

    return (
        `${method}:${req.baseUrl || ""}${req.path || ""}`
    );
}

/**
 * Resolve a stable resource identifier.
 */
function resolveResource(
    req,
    resource
) {

    if (resource) {
        return String(
            resource
        );
    }

    return (
        `${req.baseUrl || ""}${req.path || ""}`
    );
}

// =============================================================================
// Middleware Factory
// =============================================================================

/**
 * Create idempotency middleware.
 *
 * Example:
 *
 *     router.post(
 *         "/deposit",
 *         idempotency({
 *             operation: "SAVINGS_DEPOSIT",
 *             resource: "savings-account"
 *         }),
 *         depositController
 *     );
 *
 * Options:
 *
 *     operation
 *         Stable business-operation name.
 *
 *     resource
 *         Logical resource being mutated.
 *
 *     required
 *         Whether the Idempotency-Key is mandatory.
 *
 *         Defaults to true.
 */
function idempotency(
    options = {}
) {

    const operation =
        options.operation ||
        null;

    const resource =
        options.resource ||
        null;

    const required =
        options.required !== false;

    return async function idempotencyMiddleware(
        req,
        res,
        next
    ) {

        const method =
            String(
                req.method ||
                ""
            ).toUpperCase();

        // =====================================================================
        // Ignore read-only HTTP methods
        // =====================================================================

        if (
            !IDEMPOTENT_METHODS.has(
                method
            )
        ) {

            return next();
        }

        // =====================================================================
        // Extract key
        // =====================================================================

        const idempotencyKey =
            getIdempotencyKey(
                req
            );

        // =====================================================================
        // Optional idempotency
        // =====================================================================

        if (
            !idempotencyKey &&
            !required
        ) {

            return next();
        }

        try {

            // =================================================================
            // Required key validation
            // =================================================================

            validateIdempotencyKey(
                idempotencyKey
            );

            // =================================================================
            // Resolve security / tenancy context
            // =================================================================

            const principalId =
                resolvePrincipalId(
                    req
                );

            const tenantId =
                resolveTenantId(
                    req
                );

            const deviceId =
                resolveDeviceId(
                    req
                );

            const transactionId =
                resolveTransactionId(
                    req
                );

            // =================================================================
            // Persistent idempotency operation
            // =================================================================

            const result =
                await beginOperation({

                    tenantId,

                    principalId,

                    deviceId,

                    idempotencyKey,

                    operation:
                        resolveOperation(
                            req,
                            operation
                        ),

                    resource:
                        resolveResource(
                            req,
                            resource
                        ),

                    transactionId,

                    body:
                        req.body || {}

                });

            // =================================================================
            // NEW OPERATION
            // =================================================================

            if (
                result.state ===
                "NEW"
            ) {

                const recordId =
                    result.record &&
                    result.record._id;

                if (!recordId) {

                    throw new IdempotencyError(
                        "Idempotency operation was created without a persistent record identifier.",
                        "IDEMPOTENCY_RECORD_ID_MISSING",
                        500
                    );
                }

                /**
                 * Expose the operation boundary to the financial controller.
                 *
                 * The controller is responsible for calling complete() or
                 * fail() after the business operation has reached a
                 * deterministic outcome.
                 */
                req.idempotency = {

                    state:
                        "NEW",

                    recordId,

                    key:
                        idempotencyKey,

                    fingerprint:
                        result.requestFingerprint,

                    complete:
                        async ({
                            statusCode = 200,
                            body = {},
                            resultType = "SUCCESS",
                            errorCode = null
                        } = {}) => {

                            return completeOperation({

                                recordId,

                                httpStatus:
                                    statusCode,

                                responseBody:
                                    body,

                                resultType,

                                errorCode

                            });
                        },

                    fail:
                        async ({
                            statusCode = 500,
                            body = {},
                            errorCode =
                                "FINANCIAL_OPERATION_FAILED"
                        } = {}) => {

                            return failOperation({

                                recordId,

                                httpStatus:
                                    statusCode,

                                responseBody:
                                    body,

                                errorCode

                            });
                        }

                };

                // Useful for downstream logging/tracing.
                req.idempotencyKey =
                    idempotencyKey;

                return next();
            }

            // =================================================================
            // REPLAY
            // =================================================================

            if (
                result.state ===
                "REPLAY"
            ) {

                const record =
                    result.record;

                if (!record) {

                    throw new IdempotencyError(
                        "Idempotency replay was requested but no persistent operation record was returned.",
                        "IDEMPOTENCY_REPLAY_RECORD_MISSING",
                        500
                    );
                }

                /**
                 * Tell clients that the response came from a previous
                 * completed operation.
                 */
                res.setHeader(
                    "X-Idempotent-Replay",
                    "true"
                );

                /**
                 * Preserve transaction identity when available.
                 */
                if (
                    record.transactionId
                ) {

                    res.setHeader(
                        "X-Transaction-Id",
                        String(
                            record.transactionId
                        )
                    );
                }

                /**
                 * Preserve the original HTTP response status.
                 */
                res.status(
                    record.httpStatus ||
                    200
                );

                /**
                 * Return the persisted response body.
                 *
                 * The financial controller is NOT executed again.
                 */
                return res.json(
                    record.responseBody || {
                        success:
                            record.status ===
                            "COMPLETED"
                    }
                );
            }

            // =================================================================
            // RECOVERY
            // =================================================================

            if (
                result.state ===
                "RETRY_AFTER_RECOVERY"
            ) {

                /**
                 * A previous process acquired the operation but failed to
                 * complete it.
                 *
                 * We intentionally do not execute the financial operation
                 * automatically.
                 *
                 * Automatic replay of financial mutations can create
                 * double-spend / double-credit / duplicate-ledger-entry
                 * scenarios when the original process actually committed
                 * before crashing.
                 */
                res.status(
                    409
                );

                return res.json({

                    success:
                        false,

                    code:
                        "IDEMPOTENCY_OPERATION_RECOVERED",

                    message:
                        "The previous financial operation did not complete. Please retry the operation.",

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId

                });
            }

            // =================================================================
            // INVALID STATE
            // =================================================================

            throw new IdempotencyError(
                "Invalid idempotency state.",
                "IDEMPOTENCY_INVALID_STATE",
                500
            );

        } catch (error) {

            // ================================================================
            // Expected idempotency errors
            // ================================================================

            if (
                error instanceof
                IdempotencyError
            ) {

                res.status(
                    error.statusCode ||
                    500
                );

                return res.json({

                    success:
                        false,

                    code:
                        error.code,

                    message:
                        error.message,

                    requestId:
                        req.requestId,

                    correlationId:
                        req.correlationId

                });
            }

            // ================================================================
            // Unexpected errors
            // ================================================================

            return next(
                error
            );
        }
    };
}

// =============================================================================
// Exports
// =============================================================================

module.exports = {
    idempotency,
    getIdempotencyKey,
    validateIdempotencyKey
};