'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise MTN MoMo Callback Model
 * ============================================================================
 *
 * File:
 * backend/modules/payments/mtn/models/MTNCallback.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Durable callback evidence + processing-coordination record for MTN MoMo.
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - Persist callback identity
 * - Persist tenant-scoped idempotency identity
 * - Preserve immutable callback evidence
 * - Track callback processing lifecycle
 * - Track provider references
 * - Track transaction correlation
 * - Track retry / attempt state
 * - Support reconciliation lookup
 * - Support dead-letter lifecycle
 * - Support operational diagnostics
 *
 * Explicitly NOT Responsible For
 * ----------------------------------------------------------------------------
 * - Idempotency cache implementation
 * - HTTP signature verification
 * - Provider API communication
 * - Payment execution
 * - Ledger posting
 * - Transaction state mutation
 * - Retry scheduling
 * - Queue management
 *
 * Architectural Boundary
 * ----------------------------------------------------------------------------
 *
 * MTN HTTP Callback
 *       │
 *       ▼
 * Signature Verification
 *       │
 *       ▼
 * Normalization / Validation
 *       │
 *       ▼
 * MTNCallback
 *       │
 *       ▼
 * Idempotency / Processing Coordinator
 *       │
 *       ├────────► Payment State
 *       ├────────► Ledger Engine
 *       ├────────► Reconciliation
 *       └────────► Dead Letter Queue
 *
 * IMPORTANT:
 * ----------------------------------------------------------------------------
 * This model is persistence state.
 *
 * MTNCallbackIdempotency must be instantiated by the processing subsystem,
 * not from this model file.
 *
 * ============================================================================
 */

const crypto = require('crypto');
const mongoose = require('mongoose');

const {
    Schema
} = mongoose;

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const PROVIDER = 'MTN';

const MAX_TENANT_ID_LENGTH = 256;

const MAX_CALLBACK_ID_LENGTH = 256;

const MAX_IDEMPOTENCY_KEY_LENGTH = 512;

const MAX_REFERENCE_LENGTH = 256;

const MAX_PROVIDER_REFERENCE_LENGTH = 256;

const MAX_TRANSACTION_ID_LENGTH = 256;

const MAX_ERROR_CODE_LENGTH = 256;

const MAX_ERROR_MESSAGE_LENGTH = 2000;

const MAX_METADATA_KEYS = 100;

const MAX_PAYLOAD_DEPTH = 8;

const MAX_PAYLOAD_ARRAY_LENGTH = 500;

const MAX_RETRY_ATTEMPTS = 100000;

/**
 * ============================================================================
 * Callback Status
 * ============================================================================
 *
 * "status" represents the provider/business processing outcome.
 *
 * "state" represents the internal processing lifecycle.
 *
 * Keeping these concepts separate prevents provider status from being
 * confused with worker lifecycle.
 * ============================================================================
 */

const CALLBACK_STATUS = Object.freeze({

    RECEIVED:
        'RECEIVED',

    ACCEPTED:
        'ACCEPTED',

    SUCCESS:
        'SUCCESS',

    FAILED:
        'FAILED',

    DUPLICATE:
        'DUPLICATE',

    REJECTED:
        'REJECTED',

    UNKNOWN:
        'UNKNOWN'

});

const CALLBACK_STATE = Object.freeze({

    RECEIVED:
        'RECEIVED',

    VALIDATING:
        'VALIDATING',

    VERIFIED:
        'VERIFIED',

    PROCESSING:
        'PROCESSING',

    PROCESSED:
        'PROCESSED',

    FAILED:
        'FAILED',

    DEAD_LETTERED:
        'DEAD_LETTERED'

});

const TERMINAL_STATES =
    new Set([
        CALLBACK_STATE.PROCESSED,
        CALLBACK_STATE.DEAD_LETTERED
    ]);

/**
 * ============================================================================
 * Callback Processing Transitions
 * ============================================================================
 */

const ALLOWED_STATE_TRANSITIONS =
    Object.freeze({

        [CALLBACK_STATE.RECEIVED]:
            new Set([
                CALLBACK_STATE.VALIDATING,
                CALLBACK_STATE.FAILED
            ]),

        [CALLBACK_STATE.VALIDATING]:
            new Set([
                CALLBACK_STATE.VERIFIED,
                CALLBACK_STATE.FAILED
            ]),

        [CALLBACK_STATE.VERIFIED]:
            new Set([
                CALLBACK_STATE.PROCESSING,
                CALLBACK_STATE.FAILED
            ]),

        [CALLBACK_STATE.PROCESSING]:
            new Set([
                CALLBACK_STATE.PROCESSED,
                CALLBACK_STATE.FAILED
            ]),

        [CALLBACK_STATE.PROCESSED]:
            new Set(),

        [CALLBACK_STATE.FAILED]:
            new Set([
                CALLBACK_STATE.VALIDATING,
                CALLBACK_STATE.DEAD_LETTERED
            ]),

        [CALLBACK_STATE.DEAD_LETTERED]:
            new Set()

    });

/**
 * ============================================================================
 * Helpers
 * ============================================================================
 */

function normalizeRequiredString(
    value,
    field,
    maxLength
) {
    if (
        typeof value !== 'string' ||
        value.trim() === ''
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
        throw new RangeError(
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
        value === null ||
        value === ''
    ) {
        return undefined;
    }

    if (
        typeof value !== 'string'
    ) {
        throw new TypeError(
            `${field} must be a string`
        );
    }

    const normalized =
        value.trim();

    if (
        normalized.length === 0
    ) {
        return undefined;
    }

    if (
        normalized.length >
        maxLength
    ) {
        throw new RangeError(
            `${field} exceeds maximum length`
        );
    }

    return normalized;
}

function sanitizeMetadata(
    value,
    depth = 0,
    seen = new WeakSet()
) {
    if (
        value === undefined ||
        value === null
    ) {
        return undefined;
    }

    if (
        depth > MAX_PAYLOAD_DEPTH
    ) {
        throw new RangeError(
            'Callback metadata exceeds maximum nesting depth'
        );
    }

    if (
        typeof value !== 'object'
    ) {
        return value;
    }

    if (
        seen.has(value)
    ) {
        throw new TypeError(
            'Circular callback metadata is not permitted'
        );
    }

    seen.add(value);

    if (
        Array.isArray(value)
    ) {
        if (
            value.length >
            MAX_PAYLOAD_ARRAY_LENGTH
        ) {
            throw new RangeError(
                'Callback metadata array exceeds maximum length'
            );
        }

        return value.map(
            item =>
                sanitizeMetadata(
                    item,
                    depth + 1,
                    seen
                )
        );
    }

    const keys =
        Object.keys(value);

    if (
        keys.length >
        MAX_METADATA_KEYS
    ) {
        throw new RangeError(
            `Callback metadata cannot contain more than ${MAX_METADATA_KEYS} keys`
        );
    }

    const result = {};

    for (
        const key of keys
    ) {
        if (
            key === '__proto__' ||
            key === 'prototype' ||
            key === 'constructor'
        ) {
            throw new Error(
                `Unsafe metadata key is not permitted: ${key}`
            );
        }

        result[key] =
            sanitizeMetadata(
                value[key],
                depth + 1,
                seen
            );
    }

    return result;
}

function normalizeAmount(
    value
) {
    if (
        value === undefined ||
        value === null
    ) {
        return undefined;
    }

    try {

        const decimal =
            value instanceof
                mongoose.Types.Decimal128
                ? value
                : mongoose.Types.Decimal128.fromString(
                    String(value)
                );

        if (
            decimal.toString()
                .startsWith('-')
        ) {
            throw new RangeError(
                'Callback amount cannot be negative'
            );
        }

        return decimal;

    } catch (
        error
    ) {

        if (
            error instanceof
                RangeError
        ) {
            throw error;
        }

        throw new TypeError(
            'Callback amount must be a valid decimal value'
        );
    }
}

function normalizeCurrency(
    value
) {
    if (
        value === undefined ||
        value === null
    ) {
        return undefined;
    }

    const currency =
        normalizeRequiredString(
            value,
            'currency',
            3
        ).toUpperCase();

    if (
        !/^[A-Z]{3}$/.test(
            currency
        )
    ) {
        throw new TypeError(
            'currency must be a three-letter ISO-style currency code'
        );
    }

    return currency;
}

function normalizeDate(
    value,
    field
) {
    if (
        value === undefined ||
        value === null
    ) {
        return undefined;
    }

    const date =
        value instanceof Date
            ? new Date(
                value.getTime()
            )
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

/**
 * ============================================================================
 * Callback Payload Schema
 * ============================================================================
 *
 * Payload is retained as provider evidence.
 *
 * It is deliberately strict and should be treated as immutable raw input.
 * ============================================================================
 */

const MTNCallbackPayloadSchema =
    new Schema(
        {},
        {
            strict: false,
            _id: false
        }
    );

/**
 * ============================================================================
 * Error Schema
 * ============================================================================
 */

const CallbackErrorSchema =
    new Schema(
        {
            code: {
                type: String,
                trim: true,
                maxlength:
                    MAX_ERROR_CODE_LENGTH
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

/**
 * ============================================================================
 * MTN Callback Schema
 * ============================================================================
 */

const MTNCallbackSchema =
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
             * Provider identity
             * ----------------------------------------------------------------
             */

            provider: {
                type: String,
                required: true,
                enum: [PROVIDER],
                default: PROVIDER,
                immutable: true,
                uppercase: true,
                trim: true,
                index: true
            },

            /**
             * ----------------------------------------------------------------
             * Stable callback identity
             * ----------------------------------------------------------------
             */

            callbackId: {
                type: String,
                required: true,
                trim: true,
                immutable: true,
                maxlength:
                    MAX_CALLBACK_ID_LENGTH
            },

            /**
             * ----------------------------------------------------------------
             * Tenant-scoped idempotency identity
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
             * Payment references
             * ----------------------------------------------------------------
             */

            reference: {
                type: String,
                trim: true,
                maxlength:
                    MAX_REFERENCE_LENGTH,
                immutable: true
            },

            providerReference: {
                type: String,
                trim: true,
                maxlength:
                    MAX_PROVIDER_REFERENCE_LENGTH,
                immutable: true
            },

            /**
             * ----------------------------------------------------------------
             * Provider/business callback status
             * ----------------------------------------------------------------
             */

            status: {
                type: String,
                enum:
                    Object.values(
                        CALLBACK_STATUS
                    ),
                default:
                    CALLBACK_STATUS.RECEIVED,
                required: true,
                index: true
            },

            /**
             * ----------------------------------------------------------------
             * Internal processing lifecycle
             * ----------------------------------------------------------------
             */

            state: {
                type: String,
                enum:
                    Object.values(
                        CALLBACK_STATE
                    ),
                default:
                    CALLBACK_STATE.RECEIVED,
                required: true,
                index: true
            },

            /**
             * ----------------------------------------------------------------
             * Processing attempt
             * ----------------------------------------------------------------
             */

            attemptCount: {
                type: Number,
                default: 0,
                min: 0,
                max:
                    MAX_RETRY_ATTEMPTS
            },

            /**
             * ----------------------------------------------------------------
             * Payment value
             * ----------------------------------------------------------------
             */

            amount: {
                type:
                    Schema.Types.Decimal128
            },

            currency: {
                type: String,
                uppercase: true,
                trim: true,
                minlength: 3,
                maxlength: 3
            },

            /**
             * ----------------------------------------------------------------
             * Internal payment transaction correlation
             * ----------------------------------------------------------------
             */

            transactionId: {
                type:
                    Schema.Types.ObjectId,
                ref: 'Transaction',
                index: true
            },

            transactionReference: {
                type: String,
                trim: true,
                maxlength:
                    MAX_TRANSACTION_ID_LENGTH
            },

            /**
             * ----------------------------------------------------------------
             * Provider status / result
             * ----------------------------------------------------------------
             */

            providerStatus: {
                type: String,
                trim: true,
                maxlength: 128
            },

            providerCode: {
                type: String,
                trim: true,
                maxlength: 256
            },

            providerMessage: {
                type: String,
                trim: true,
                maxlength:
                    MAX_ERROR_MESSAGE_LENGTH
            },

            /**
             * ----------------------------------------------------------------
             * Signature verification
             * ----------------------------------------------------------------
             */

            signatureVerified: {
                type: Boolean,
                default: false,
                immutable: true
            },

            signatureAlgorithm: {
                type: String,
                trim: true,
                maxlength: 128,
                immutable: true
            },

            payloadFingerprint: {
                type: String,
                trim: true,
                minlength: 64,
                maxlength: 64,
                immutable: true
            },

            /**
             * ----------------------------------------------------------------
             * Processing errors
             * ----------------------------------------------------------------
             */

            lastError: {
                type:
                    CallbackErrorSchema,
                default: undefined
            },

            lastErrorCode: {
                type: String,
                trim: true,
                maxlength:
                    MAX_ERROR_CODE_LENGTH
            },

            lastErrorMessage: {
                type: String,
                trim: true,
                maxlength:
                    MAX_ERROR_MESSAGE_LENGTH
            },

            /**
             * ----------------------------------------------------------------
             * Lifecycle timestamps
             * ----------------------------------------------------------------
             */

            firstReceivedAt: {
                type: Date,
                immutable: true
            },

            verifiedAt: {
                type: Date
            },

            processingStartedAt: {
                type: Date
            },

            lastProcessedAt: {
                type: Date
            },

            completedAt: {
                type: Date
            },

            failedAt: {
                type: Date
            },

            deadLetteredAt: {
                type: Date
            },

            /**
             * ----------------------------------------------------------------
             * Raw provider evidence
             * ----------------------------------------------------------------
             *
             * Immutable after initial receipt.
             *
             * Do not put normalized accounting state into this field.
             */

            payload: {
                type:
                    Schema.Types.Mixed,
                immutable: true
            },

            /**
             * ----------------------------------------------------------------
             * Operational metadata
             * ----------------------------------------------------------------
             */

            metadata: {
                type:
                    Schema.Types.Mixed,
                default: () => ({})
            },

            /**
             * ----------------------------------------------------------------
             * Distributed tracing
             * ----------------------------------------------------------------
             */

            correlationId: {
                type: String,
                trim: true,
                maxlength: 256
            },

            requestId: {
                type: String,
                trim: true,
                maxlength: 256
            },

            operationId: {
                type: String,
                trim: true,
                maxlength: 256
            },

            /**
             * ----------------------------------------------------------------
             * Dead-letter correlation
             * ----------------------------------------------------------------
             */

            deadLetterId: {
                type: String,
                trim: true,
                maxlength: 256
            }
        },
        {
            timestamps: true,

            strict: 'throw',

            minimize: false,

            optimisticConcurrency: true,

            versionKey: '__v'
        }
    );

/**
 * ============================================================================
 * Indexes
 * ============================================================================
 */

/**
 * Callback identity must be unique per tenant.
 */
MTNCallbackSchema.index(
    {
        tenantId: 1,
        callbackId: 1
    },
    {
        unique: true,
        name:
            'uq_mtn_callback_tenant_callback_id'
    }
);

/**
 * Idempotency identity is tenant-scoped.
 *
 * IMPORTANT:
 * Do not use a globally unique idempotencyKey for a multi-tenant system.
 */
MTNCallbackSchema.index(
    {
        tenantId: 1,
        idempotencyKey: 1
    },
    {
        unique: true,
        name:
            'uq_mtn_callback_tenant_idempotency'
    }
);

/**
 * Provider reference lookup.
 */
MTNCallbackSchema.index(
    {
        tenantId: 1,
        providerReference: 1
    },
    {
        sparse: true,
        name:
            'ix_mtn_callback_provider_reference'
    }
);

/**
 * Merchant/internal reference lookup.
 */
MTNCallbackSchema.index(
    {
        tenantId: 1,
        reference: 1
    },
    {
        sparse: true,
        name:
            'ix_mtn_callback_reference'
    }
);

/**
 * Processing queue / recovery lookup.
 */
MTNCallbackSchema.index(
    {
        tenantId: 1,
        state: 1,
        createdAt: -1
    },
    {
        name:
            'ix_mtn_callback_processing_state'
    }
);

/**
 * Provider result search.
 */
MTNCallbackSchema.index(
    {
        tenantId: 1,
        status: 1,
        createdAt: -1
    },
    {
        name:
            'ix_mtn_callback_status'
    }
);

/**
 * Transaction reconciliation lookup.
 */
MTNCallbackSchema.index(
    {
        tenantId: 1,
        transactionId: 1
    },
    {
        sparse: true,
        name:
            'ix_mtn_callback_transaction'
    }
);

/**
 * Correlation lookup.
 */
MTNCallbackSchema.index(
    {
        tenantId: 1,
        correlationId: 1
    },
    {
        sparse: true,
        name:
            'ix_mtn_callback_correlation'
    }
);

/**
 * Dead-letter recovery.
 */
MTNCallbackSchema.index(
    {
        tenantId: 1,
        state: 1,
        deadLetteredAt: -1
    },
    {
        sparse: true,
        name:
            'ix_mtn_callback_dead_letter'
    }
);

/**
 * ============================================================================
 * Pre-Validation
 * ============================================================================
 */

MTNCallbackSchema.pre(
    'validate',
    function validateCallback(
        next
    ) {

        try {

            this.provider =
                PROVIDER;

            this.tenantId =
                normalizeRequiredString(
                    this.tenantId,
                    'tenantId',
                    MAX_TENANT_ID_LENGTH
                );

            this.callbackId =
                normalizeRequiredString(
                    this.callbackId,
                    'callbackId',
                    MAX_CALLBACK_ID_LENGTH
                );

            this.idempotencyKey =
                normalizeRequiredString(
                    this.idempotencyKey,
                    'idempotencyKey',
                    MAX_IDEMPOTENCY_KEY_LENGTH
                );

            this.reference =
                normalizeOptionalString(
                    this.reference,
                    'reference',
                    MAX_REFERENCE_LENGTH
                );

            this.providerReference =
                normalizeOptionalString(
                    this.providerReference,
                    'providerReference',
                    MAX_PROVIDER_REFERENCE_LENGTH
                );

            this.currency =
                normalizeCurrency(
                    this.currency
                );

            this.amount =
                normalizeAmount(
                    this.amount
                );

            this.firstReceivedAt =
                this.firstReceivedAt ||
                new Date();

            this.firstReceivedAt =
                normalizeDate(
                    this.firstReceivedAt,
                    'firstReceivedAt'
                );

            this.verifiedAt =
                normalizeDate(
                    this.verifiedAt,
                    'verifiedAt'
                );

            this.processingStartedAt =
                normalizeDate(
                    this.processingStartedAt,
                    'processingStartedAt'
                );

            this.lastProcessedAt =
                normalizeDate(
                    this.lastProcessedAt,
                    'lastProcessedAt'
                );

            this.completedAt =
                normalizeDate(
                    this.completedAt,
                    'completedAt'
                );

            this.failedAt =
                normalizeDate(
                    this.failedAt,
                    'failedAt'
                );

            this.deadLetteredAt =
                normalizeDate(
                    this.deadLetteredAt,
                    'deadLetteredAt'
                );

            this.metadata =
                sanitizeMetadata(
                    this.metadata ||
                    {}
                );

            if (
                this.payloadFingerprint &&
                !/^[a-f0-9]{64}$/i.test(
                    this.payloadFingerprint
                )
            ) {
                throw new TypeError(
                    'payloadFingerprint must be a SHA-256 hexadecimal fingerprint'
                );
            }

            /**
             * ----------------------------------------------------------------
             * Lifecycle consistency
             * ----------------------------------------------------------------
             */

            validateLifecycleConsistency(
                this
            );

            next();

        } catch (
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
    callback
) {

    if (
        callback.state ===
            CALLBACK_STATE.VERIFIED &&
        !callback.verifiedAt
    ) {
        throw new TypeError(
            'verifiedAt is required when state is VERIFIED'
        );
    }

    if (
        [
            CALLBACK_STATE.PROCESSING,
            CALLBACK_STATE.PROCESSED
        ].includes(
            callback.state
        ) &&
        !callback.verifiedAt
    ) {
        throw new TypeError(
            'verifiedAt is required before callback processing'
        );
    }

    if (
        callback.state ===
            CALLBACK_STATE.PROCESSING &&
        !callback.processingStartedAt
    ) {
        throw new TypeError(
            'processingStartedAt is required when state is PROCESSING'
        );
    }

    if (
        callback.state ===
            CALLBACK_STATE.PROCESSED &&
        !callback.completedAt
    ) {
        throw new TypeError(
            'completedAt is required when state is PROCESSED'
        );
    }

    if (
        callback.state ===
            CALLBACK_STATE.FAILED &&
        !callback.failedAt
    ) {
        throw new TypeError(
            'failedAt is required when state is FAILED'
        );
    }

    if (
        callback.state ===
            CALLBACK_STATE.DEAD_LETTERED &&
        !callback.deadLetteredAt
    ) {
        throw new TypeError(
            'deadLetteredAt is required when state is DEAD_LETTERED'
        );
    }

    if (
        callback.completedAt &&
        callback.failedAt &&
        callback.completedAt >
            callback.failedAt
    ) {
        /**
         * Do not enforce an artificial ordering between historical timestamps
         * because retries may legitimately create complex histories.
         *
         * Actual state remains authoritative.
         */
    }
}

/**
 * ============================================================================
 * State Transition Validation
 * ============================================================================
 */

MTNCallbackSchema.statics
    .isValidStateTransition =
    function isValidStateTransition(
        from,
        to
    ) {

        return Boolean(
            ALLOWED_STATE_TRANSITIONS[
                from
            ]?.has(
                to
            )
        );
    };

/**
 * ============================================================================
 * Tenant-Scoped Lookups
 * ============================================================================
 */

MTNCallbackSchema.statics
    .findByTenantAndCallbackId =
    function findByTenantAndCallbackId(
        tenantId,
        callbackId
    ) {

        tenantId =
            normalizeRequiredString(
                tenantId,
                'tenantId',
                MAX_TENANT_ID_LENGTH
            );

        callbackId =
            normalizeRequiredString(
                callbackId,
                'callbackId',
                MAX_CALLBACK_ID_LENGTH
            );

        return this.findOne({
            tenantId,
            callbackId
        });
    };

MTNCallbackSchema.statics
    .findByTenantAndIdempotencyKey =
    function findByTenantAndIdempotencyKey(
        tenantId,
        idempotencyKey
    ) {

        tenantId =
            normalizeRequiredString(
                tenantId,
                'tenantId',
                MAX_TENANT_ID_LENGTH
            );

        idempotencyKey =
            normalizeRequiredString(
                idempotencyKey,
                'idempotencyKey',
                MAX_IDEMPOTENCY_KEY_LENGTH
            );

        return this.findOne({
            tenantId,
            idempotencyKey
        });
    };

/**
 * ============================================================================
 * Payload Fingerprint
 * ============================================================================
 *
 * Creates a deterministic fingerprint for the raw provider payload.
 *
 * This is useful for:
 * - duplicate callback diagnosis
 * - audit correlation
 * - provider replay detection
 *
 * It is NOT the same as idempotencyKey.
 * ============================================================================
 */

MTNCallbackSchema.statics
    .createPayloadFingerprint =
    function createPayloadFingerprint(
        payload
    ) {

        return crypto
            .createHash(
                'sha256'
            )
            .update(
                stableSerialize(
                    payload
                ),
                'utf8'
            )
            .digest('hex');
    };

/**
 * ============================================================================
 * Atomic State Transition
 * ============================================================================
 *
 * The expected current state is included in the update predicate.
 *
 * This prevents two workers from successfully moving the same callback
 * through the lifecycle at the same time.
 * ============================================================================
 */

MTNCallbackSchema.statics
    .transitionState =
    async function transitionState({
        tenantId,
        callbackId,
        from,
        to,
        error = null,
        status = undefined
    }) {

        tenantId =
            normalizeRequiredString(
                tenantId,
                'tenantId',
                MAX_TENANT_ID_LENGTH
            );

        callbackId =
            normalizeRequiredString(
                callbackId,
                'callbackId',
                MAX_CALLBACK_ID_LENGTH
            );

        if (
            !this.isValidStateTransition(
                from,
                to
            )
        ) {
            const transitionError =
                new Error(
                    `Invalid MTN callback state transition: ${from} -> ${to}`
                );

            transitionError.code =
                'MTN_CALLBACK_INVALID_STATE_TRANSITION';

            throw transitionError;
        }

        const now =
            new Date();

        const $set = {
            state: to,
            lastProcessedAt: now
        };

        const $unset = {};

        if (
            status !== undefined
        ) {
            $set.status =
                status;
        }

        switch (
            to
        ) {

            case CALLBACK_STATE.VALIDATING:

                break;

            case CALLBACK_STATE.VERIFIED:

                $set.verifiedAt =
                    now;

                break;

            case CALLBACK_STATE.PROCESSING:

                $set.processingStartedAt =
                    now;

                $set.lastProcessedAt =
                    now;

                break;

            case CALLBACK_STATE.PROCESSED:

                $set.completedAt =
                    now;

                $set.lastProcessedAt =
                    now;

                $unset.lastError = 1;
                $unset.lastErrorCode = 1;
                $unset.lastErrorMessage = 1;
                $unset.failedAt = 1;

                break;

            case CALLBACK_STATE.FAILED:

                $set.failedAt =
                    now;

                $set.lastError =
                    normalizeError(
                        error
                    );

                $set.lastErrorCode =
                    $set.lastError.code;

                $set.lastErrorMessage =
                    $set.lastError.message;

                break;

            case CALLBACK_STATE.DEAD_LETTERED:

                $set.deadLetteredAt =
                    now;

                $set.lastProcessedAt =
                    now;

                break;

            default:

                break;
        }

        const updated =
            await this.findOneAndUpdate(
                {
                    tenantId,
                    callbackId,
                    state: from
                },
                {
                    $set,

                    ...(Object.keys($unset)
                        .length > 0
                        ? {
                            $unset
                        }
                        : {})
                },
                {
                    new: true,
                    runValidators: true,
                    context: 'query'
                }
            );

        if (
            !updated
        ) {

            const current =
                await this.findOne({
                    tenantId,
                    callbackId
                })
                    .select(
                        'state status callbackId'
                    )
                    .lean();

            if (
                !current
            ) {

                const notFound =
                    new Error(
                        'MTN callback not found'
                    );

                notFound.code =
                    'MTN_CALLBACK_NOT_FOUND';

                throw notFound;
            }

            const conflict =
                new Error(
                    `MTN callback state conflict. Current state: ${current.state}; expected: ${from}`
                );

            conflict.code =
                'MTN_CALLBACK_STATE_CONFLICT';

            throw conflict;
        }

        return updated;
    };

/**
 * ============================================================================
 * Mark Processed
 * ============================================================================
 */

MTNCallbackSchema.statics
    .markProcessed =
    function markProcessed({
        tenantId,
        callbackId,
        status =
            CALLBACK_STATUS.SUCCESS
    }) {

        return this.transitionState({
            tenantId,
            callbackId,

            from:
                CALLBACK_STATE.PROCESSING,

            to:
                CALLBACK_STATE.PROCESSED,

            status
        });
    };

/**
 * ============================================================================
 * Mark Failed
 * ============================================================================
 */

MTNCallbackSchema.statics
    .markFailed =
    function markFailed({
        tenantId,
        callbackId,
        error
    }) {

        return this.transitionState({
            tenantId,
            callbackId,

            from:
                CALLBACK_STATE.PROCESSING,

            to:
                CALLBACK_STATE.FAILED,

            error,

            status:
                CALLBACK_STATUS.FAILED
        });
    };

/**
 * ============================================================================
 * Mark Dead Lettered
 * ============================================================================
 */

MTNCallbackSchema.statics
    .markDeadLettered =
    function markDeadLettered({
        tenantId,
        callbackId
    }) {

        return this.transitionState({
            tenantId,
            callbackId,

            from:
                CALLBACK_STATE.FAILED,

            to:
                CALLBACK_STATE.DEAD_LETTERED,

            status:
                CALLBACK_STATUS.FAILED
        });
    };

/**
 * ============================================================================
 * Direct Update Protection
 * ============================================================================
 *
 * Prevent generic update operations from modifying callback source identity.
 * Processing lifecycle should use transitionState() and explicit methods.
 * ============================================================================
 */

const IMMUTABLE_PATHS =
    new Set([
        'tenantId',
        'provider',
        'callbackId',
        'idempotencyKey',
        'reference',
        'providerReference',
        'signatureVerified',
        'signatureAlgorithm',
        'payloadFingerprint',
        'payload',
        'firstReceivedAt'
    ]);

const GUARDED_LIFECYCLE_PATHS =
    new Set([
        'state',
        'status',
        'attemptCount',
        'verifiedAt',
        'processingStartedAt',
        'lastProcessedAt',
        'completedAt',
        'failedAt',
        'deadLetteredAt',
        'lastError',
        'lastErrorCode',
        'lastErrorMessage',
        'transactionId',
        'deadLetterId'
    ]);

function assertNoDirectMutation(
    update
) {

    if (
        !update ||
        typeof update !== 'object'
    ) {
        return;
    }

    const operators = [
        '$set',
        '$setOnInsert',
        '$unset',
        '$inc',
        '$mul',
        '$min',
        '$max',
        '$push',
        '$addToSet',
        '$pull',
        '$pullAll',
        '$rename'
    ];

    for (
        const operator
        of operators
    ) {

        const payload =
            update[operator];

        if (
            !payload ||
            typeof payload !== 'object'
        ) {
            continue;
        }

        for (
            const path
            of Object.keys(
                payload
            )
        ) {

            const root =
                path.split('.')[0];

            if (
                IMMUTABLE_PATHS.has(
                    root
                )
            ) {

                const error =
                    new Error(
                        `Immutable MTN callback field cannot be modified: ${path}`
                    );

                error.code =
                    'MTN_CALLBACK_IMMUTABLE_FIELD';

                throw error;
            }

            /**
             * Prevent callers from bypassing the lifecycle state machine.
             */
            if (
                GUARDED_LIFECYCLE_PATHS.has(
                    root
                )
            ) {

                const error =
                    new Error(
                        `Direct MTN callback lifecycle mutation is prohibited: ${path}`
                    );

                error.code =
                    'MTN_CALLBACK_DIRECT_STATE_MUTATION';

                throw error;
            }
        }
    }
}

for (
    const hook
    of [
        'updateOne',
        'updateMany',
        'findOneAndUpdate',
        'findByIdAndUpdate'
    ]
) {

    MTNCallbackSchema.pre(
        hook,
        function guardUpdate(
            next
        ) {

            try {

                assertNoDirectMutation(
                    this.getUpdate()
                );

                next();

            } catch (
                error
            ) {

                next(error);
            }
        }
    );
}

/**
 * ============================================================================
 * Create Callback
 * ============================================================================
 */

MTNCallbackSchema.statics
    .createCallback =
    async function createCallback(
        payload,
        options = {}
    ) {

        if (
            !payload ||
            typeof payload !== 'object' ||
            Array.isArray(payload)
        ) {

            throw new TypeError(
                'MTN callback payload must be an object'
            );
        }

        const data = {
            ...payload,

            provider:
                PROVIDER
        };

        data.tenantId =
            normalizeRequiredString(
                data.tenantId,
                'tenantId',
                MAX_TENANT_ID_LENGTH
            );

        data.callbackId =
            normalizeRequiredString(
                data.callbackId,
                'callbackId',
                MAX_CALLBACK_ID_LENGTH
            );

        data.idempotencyKey =
            normalizeRequiredString(
                data.idempotencyKey,
                'idempotencyKey',
                MAX_IDEMPOTENCY_KEY_LENGTH
            );

        data.firstReceivedAt =
            data.firstReceivedAt ||
            new Date();

        /**
         * Generate fingerprint only once from the raw provider payload.
         */
        if (
            !data.payloadFingerprint &&
            data.payload !== undefined
        ) {

            data.payloadFingerprint =
                this.createPayloadFingerprint(
                    data.payload
                );
        }

        return this.create(
            data,
            options
        );
    };

/**
 * ============================================================================
 * Normalize Error
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
                'UNKNOWN_ERROR',

            message:
                'Unknown MTN callback processing error',

            retryable:
                false
        };
    }

    return {
        code:
            normalizeOptionalString(
                error.code,
                'error.code',
                MAX_ERROR_CODE_LENGTH
            ) ||
            'MTN_CALLBACK_PROCESSING_ERROR',

        message:
            normalizeOptionalString(
                error.message,
                'error.message',
                MAX_ERROR_MESSAGE_LENGTH
            ) ||
            'MTN callback processing failed',

        stage:
            normalizeOptionalString(
                error.stage,
                'error.stage',
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
 * Static Constants
 * ============================================================================
 */

MTNCallbackSchema.statics.PROVIDER =
    PROVIDER;

MTNCallbackSchema.statics.CALLBACK_STATUS =
    CALLBACK_STATUS;

MTNCallbackSchema.statics.CALLBACK_STATE =
    CALLBACK_STATE;

MTNCallbackSchema.statics.ALLOWED_STATE_TRANSITIONS =
    ALLOWED_STATE_TRANSITIONS;

MTNCallbackSchema.statics.TERMINAL_STATES =
    TERMINAL_STATES;

/**
 * ============================================================================
 * Model
 * ============================================================================
 */

const MTNCallback =
    mongoose.models.MTNCallback ||
    mongoose.model(
        'MTNCallback',
        MTNCallbackSchema
    );

/**
 * ============================================================================
 * Export
 * ============================================================================
 */

module.exports =
    MTNCallback;