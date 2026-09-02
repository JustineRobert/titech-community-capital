"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * African Community Finance Operating System (ACFOS)
 * =============================================================================
 *
 * File:
 *   backend/models/idempotencyRecord.model.js
 *
 * Purpose:
 *   Durable persistence model for financial idempotency records.
 *
 * Financial correctness boundary:
 *
 *   tenant
 *      +
 *   principal
 *      +
 *   device
 *      +
 *   idempotency key
 *      +
 *   request fingerprint
 *      +
 *   operation
 *      +
 *   resource
 *      +
 *   transaction identity
 *      +
 *   persistent operation state
 *      +
 *   final response
 *
 * A duplicate request must NEVER execute the underlying financial mutation
 * more than once.
 *
 * =============================================================================
 */

const mongoose =
    require("mongoose");

const {
    Schema
} = mongoose;

// =============================================================================
// Lifecycle Statuses
// =============================================================================

const IDEMPOTENCY_STATUSES =
    Object.freeze([

        /*
         * Operation has been acquired and is currently executing.
         */
        "PROCESSING",

        /*
         * Financial operation completed successfully.
         */
        "COMPLETED",

        /*
         * Financial operation definitively failed.
         */
        "FAILED",

        /*
         * Processing lease expired and the outcome must be reconciled.
         *
         * IMPORTANT:
         *
         * RECOVERY_REQUIRED does NOT mean FAILED.
         *
         * The underlying financial mutation may already have committed before
         * the application process crashed.
         */
        "RECOVERY_REQUIRED"

    ]);

// =============================================================================
// Result Types
// =============================================================================

const IDEMPOTENCY_RESULT_TYPES =
    Object.freeze([

        "SUCCESS",

        "CLIENT_ERROR",

        "SERVER_ERROR",

        /*
         * Operation was successfully reconciled after recovery.
         */
        "RECOVERED_SUCCESS",

        /*
         * Recovery proved that the financial mutation did not commit.
         */
        "RECOVERED_FAILURE",

        /*
         * The operation requires reconciliation and does not yet have a
         * definitive financial outcome.
         */
        "RECOVERY_REQUIRED"

    ]);

// =============================================================================
// Schema
// =============================================================================

const idempotencyRecordSchema =
    new Schema(

        {

            // =================================================================
            // Tenant Identity
            // =================================================================

            tenantId: {

                type:
                    String,

                required:
                    true,

                immutable:
                    true,

                trim:
                    true,

                maxlength:
                    128,

                index:
                    true

            },

            // =================================================================
            // Authenticated Principal
            // =================================================================

            principalId: {

                type:
                    String,

                required:
                    true,

                immutable:
                    true,

                trim:
                    true,

                maxlength:
                    128,

                index:
                    true

            },

            // =================================================================
            // Originating Device
            // =================================================================

            deviceId: {

                type:
                    String,

                default:
                    null,

                immutable:
                    true,

                trim:
                    true,

                maxlength:
                    128

            },

            // =================================================================
            // Idempotency Identity
            // =================================================================

            idempotencyKey: {

                type:
                    String,

                required:
                    true,

                immutable:
                    true,

                trim:
                    true,

                maxlength:
                    255

            },

            // =================================================================
            // Request Fingerprint
            // =================================================================

            requestFingerprint: {

                type:
                    String,

                required:
                    true,

                immutable:
                    true,

                trim:
                    true,

                maxlength:
                    128

            },

            // =================================================================
            // Financial Operation
            // =================================================================

            operation: {

                type:
                    String,

                required:
                    true,

                immutable:
                    true,

                trim:
                    true,

                maxlength:
                    150

            },

            // =================================================================
            // Financial Resource
            // =================================================================

            resource: {

                type:
                    String,

                required:
                    true,

                immutable:
                    true,

                trim:
                    true,

                maxlength:
                    255

            },

            // =================================================================
            // Financial Transaction Identity
            // =================================================================

            transactionId: {

                type:
                    String,

                default:
                    null,

                trim:
                    true,

                maxlength:
                    128,

                index:
                    true

            },

            // =================================================================
            // Lifecycle State
            // =================================================================

            status: {

                type:
                    String,

                required:
                    true,

                enum:
                    IDEMPOTENCY_STATUSES,

                default:
                    "PROCESSING",

                index:
                    true

            },

            // =================================================================
            // Operation Result
            // =================================================================

            resultType: {

                type:
                    String,

                enum:
                    IDEMPOTENCY_RESULT_TYPES,

                default:
                    null

            },

            // =================================================================
            // HTTP Response
            // =================================================================

            httpStatus: {

                type:
                    Number,

                default:
                    null,

                min:
                    100,

                max:
                    599

            },

            // =================================================================
            // Persisted Response
            // =================================================================
            //
            // This is replayed for duplicate requests.
            //
            // IMPORTANT:
            //
            // Do not place sensitive secrets, credentials, access tokens,
            // passwords, or unnecessary PII into this field.
            //
            // =================================================================

            responseBody: {

                type:
                    Schema.Types.Mixed,

                default:
                    null

            },

            // =================================================================
            // Error Identity
            // =================================================================

            errorCode: {

                type:
                    String,

                default:
                    null,

                trim:
                    true,

                maxlength:
                    128

            },

            // =================================================================
            // Processing Lifecycle
            // =================================================================

            processingStartedAt: {

                type:
                    Date,

                required:
                    true,

                default:
                    Date.now,

                index:
                    true

            },

            /**
             * Last server-side processing heartbeat.
             *
             * Used to distinguish an active long-running operation from a
             * genuinely abandoned operation.
             */
            lastProcessingHeartbeatAt: {

                type:
                    Date,

                default:
                    null,

                index:
                    true

            },

            // =================================================================
            // Completion
            // =================================================================

            completedAt: {

                type:
                    Date,

                default:
                    null

            },

            // =================================================================
            // Recovery
            // =================================================================

            recoveryRequiredAt: {

                type:
                    Date,

                default:
                    null

            },

            recoveryResolvedAt: {

                type:
                    Date,

                default:
                    null

            },

            // =================================================================
            // Retention
            // =================================================================

            expiresAt: {

                type:
                    Date,

                required:
                    true,

                index:
                    true

            }

        },

        {

            timestamps:
                true,

            versionKey:
                false,

            minimize:
                false

        }

    );

// =============================================================================
// Unique Business Identity
// =============================================================================
//
// The uniqueness boundary is:
//
//     tenantId
//        +
//     principalId
//        +
//     idempotencyKey
//
// This prevents:
//
//     same tenant
//       +
//     same principal
//       +
//     same idempotency key
//
// from creating multiple operations.
//
// The same key may legitimately exist for:
//
//     Tenant A / Principal A
//     Tenant B / Principal A
//     Tenant A / Principal B
//
// =============================================================================

idempotencyRecordSchema.index(

    {

        tenantId:
            1,

        principalId:
            1,

        idempotencyKey:
            1

    },

    {

        unique:
            true,

        name:
            "uq_idempotency_tenant_principal_key"

    }

);

// =============================================================================
// Tenant Operational Lookup
// =============================================================================

idempotencyRecordSchema.index(

    {

        tenantId:
            1,

        status:
            1,

        createdAt:
            -1

    },

    {

        name:
            "idx_idempotency_tenant_status_created"

    }

);

// =============================================================================
// Recovery Operations
// =============================================================================
//
// Supports:
//
//     RECOVERY_REQUIRED records
//     reconciliation queues
//     operational dashboards
//
// =============================================================================

idempotencyRecordSchema.index(

    {

        status:
            1,

        lastProcessingHeartbeatAt:
            1

    },

    {

        name:
            "idx_idempotency_status_heartbeat"

    }

);

idempotencyRecordSchema.index(

    {

        status:
            1,

        recoveryRequiredAt:
            1

    },

    {

        name:
            "idx_idempotency_recovery_queue"

    }

);

// =============================================================================
// Transaction Lookup
// =============================================================================
//
// Useful when reconciling:
//
//     idempotency record
//             ↕
//     financial transaction
//             ↕
//     ledger entry
//
// =============================================================================

idempotencyRecordSchema.index(

    {

        tenantId:
            1,

        transactionId:
            1

    },

    {

        name:
            "idx_idempotency_tenant_transaction"

    }

);

// =============================================================================
// TTL Retention
// =============================================================================
//
// MongoDB automatically removes records after expiresAt.
//
// IMPORTANT:
//
// TTL deletion is asynchronous.
//
// Therefore:
//
//     correctness != record existence
//
// Financial correctness must always be determined by the persistent state
// machine and transaction/ledger records, not by whether the idempotency
// record happens to have been deleted.
//
// =============================================================================

idempotencyRecordSchema.index(

    {

        expiresAt:
            1

    },

    {

        expireAfterSeconds:
            0,

        name:
            "ttl_idempotency_expires_at"

    }

);

// =============================================================================
// Validation Hooks
// =============================================================================

/**
 * Prevent accidental lifecycle corruption through direct document saves.
 *
 * State transitions should normally happen through the idempotency store,
 * where atomic status predicates are used.
 */
idempotencyRecordSchema.pre(
    "save",
    function(next) {

        if (
            this.status ===
            "COMPLETED"
        ) {

            if (
                !this.completedAt
            ) {

                this.completedAt =
                    new Date();
            }
        }

        if (
            this.status ===
            "RECOVERY_REQUIRED"
        ) {

            if (
                !this.recoveryRequiredAt
            ) {

                this.recoveryRequiredAt =
                    new Date();
            }
        }

        next();

    }
);

// =============================================================================
// JSON Transformation
// =============================================================================
//
// Keep MongoDB internals out of API responses if the model is ever serialized
// directly.
//
// =============================================================================

idempotencyRecordSchema.set(
    "toJSON",
    {

        transform:
            (
                doc,
                ret
            ) => {

                delete ret.__v;

                return ret;
            }

    }
);

// =============================================================================
// Model
// =============================================================================

const IdempotencyRecord =
    mongoose.model(
        "IdempotencyRecord",
        idempotencyRecordSchema
    );

// =============================================================================
// Exports
// =============================================================================

module.exports = {

    IdempotencyRecord,

    IDEMPOTENCY_STATUSES,

    IDEMPOTENCY_RESULT_TYPES

};