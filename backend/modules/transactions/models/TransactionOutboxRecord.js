'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Transaction Outbox Record
 * ============================================================================
 *
 * File:
 *   backend/modules/transactions/models/TransactionOutboxRecord.js
 *
 * Purpose
 * -------
 * Durable transactional outbox record for immutable transaction-domain events.
 *
 * Responsibilities
 * ----------------
 * • Tenant-isolated event persistence
 * • Immutable event identity
 * • Event versioning
 * • Deterministic event key / fingerprint
 * • Routing metadata persistence
 * • Delivery lifecycle state
 * • Retry state
 * • Worker lease state
 * • Replay support
 * • Dead-letter support
 * • Optimistic concurrency
 *
 * IMPORTANT
 * ---------
 * The event envelope is immutable.
 *
 * Delivery metadata is mutable:
 * • status
 * • attempts
 * • lease
 * • retry timestamps
 * • publishedAt
 * • failure information
 *
 * Financial truth remains in the ledger.
 * The outbox is a durable publication boundary.
 * ============================================================================
 */

const mongoose = require('mongoose');

const {
    Schema
} = mongoose;


/**
 * ============================================================================
 * Status
 * ============================================================================
 */

const OUTBOX_STATUS = Object.freeze({

    PENDING:
        'PENDING',

    PROCESSING:
        'PROCESSING',

    PUBLISHED:
        'PUBLISHED',

    FAILED:
        'FAILED',

    DEAD_LETTERED:
        'DEAD_LETTERED',

    CANCELLED:
        'CANCELLED'

});


const VALID_STATUSES =
    Object.freeze(
        Object.values(
            OUTBOX_STATUS
        )
    );


/**
 * ============================================================================
 * Helpers
 * ============================================================================
 */

function normalizeDecimalDate(value) {

    if (!value) {
        return null;
    }

    const date =
        value instanceof Date
            ? value
            : new Date(value);

    return Number.isFinite(
        date.getTime()
    )
        ? date
        : null;
}


/**
 * ============================================================================
 * Aggregate Schema
 * ============================================================================
 */

const AggregateSchema =
    new Schema(

        {
            type: {
                type: String,
                trim: true,
                maxlength: 256,
                immutable: true
            },

            id: {
                type: String,
                trim: true,
                maxlength: 512,
                immutable: true
            },

            version: {
                type: Schema.Types.Mixed,
                immutable: true
            }

        },
        {
            _id: false,
            id: false
        }

    );


/**
 * ============================================================================
 * Trace Schema
 * ============================================================================
 */

const TraceSchema =
    new Schema(

        {
            traceId: {
                type: String,
                trim: true,
                maxlength: 256,
                immutable: true
            },

            spanId: {
                type: String,
                trim: true,
                maxlength: 256,
                immutable: true
            },

            parentSpanId: {
                type: String,
                trim: true,
                maxlength: 256,
                immutable: true
            }

        },
        {
            _id: false
        }

    );


/**
 * ============================================================================
 * Routing Schema
 * ============================================================================
 */

const RoutingSchema =
    new Schema(

        {
            topic: {
                type: String,
                trim: true,
                maxlength: 512,
                immutable: true
            },

            route: {
                type: String,
                trim: true,
                maxlength: 512,
                immutable: true
            },

            routingKey: {
                type: String,
                trim: true,
                maxlength: 512,
                immutable: true
            },

            partitionKey: {
                type: String,
                trim: true,
                maxlength: 512,
                immutable: true
            },

            tenantRoutingKey: {
                type: String,
                trim: true,
                maxlength: 512,
                immutable: true
            },

            aggregateRoutingKey: {
                type: String,
                trim: true,
                maxlength: 512,
                immutable: true
            },

            providerRoutingKey: {
                type: String,
                trim: true,
                maxlength: 512,
                immutable: true
            }

        },
        {
            _id: false
        }

    );


/**
 * ============================================================================
 * Error Schema
 * ============================================================================
 */

const OutboxErrorSchema =
    new Schema(

        {
            name: {
                type: String,
                maxlength: 256
            },

            code: {
                type: String,
                maxlength: 256
            },

            category: {
                type: String,
                maxlength: 128
            },

            message: {
                type: String,
                maxlength: 2000
            },

            retryable: {
                type: Boolean
            },

            statusCode: {
                type: Number
            },

            provider: {
                type: String,
                maxlength: 128
            },

            providerCode: {
                type: String,
                maxlength: 256
            },

            at: {
                type: Date,
                default: Date.now
            }

        },
        {
            _id: false
        }

    );


/**
 * ============================================================================
 * Schema
 * ============================================================================
 */

const TransactionOutboxRecordSchema =
    new Schema(

        {
            /**
             * -----------------------------------------------------------------
             * Tenant / identity
             * -----------------------------------------------------------------
             */

            tenantId: {
                type: String,
                required: true,
                trim: true,
                maxlength: 256,
                immutable: true,
                index: true
            },

            organizationId: {
                type: String,
                trim: true,
                maxlength: 256,
                immutable: true
            },

            eventId: {
                type: String,
                required: true,
                trim: true,
                maxlength: 512,
                immutable: true
            },

            eventKey: {
                type: String,
                required: true,
                trim: true,
                maxlength: 512,
                immutable: true
            },

            eventType: {
                type: String,
                required: true,
                trim: true,
                lowercase: true,
                maxlength: 256,
                immutable: true,
                index: true
            },

            eventVersion: {
                type: String,
                required: true,
                trim: true,
                maxlength: 64,
                immutable: true
            },

            schemaVersion: {
                type: String,
                required: true,
                trim: true,
                maxlength: 64,
                immutable: true
            },

            category: {
                type: String,
                required: true,
                trim: true,
                maxlength: 128,
                immutable: true,
                index: true
            },

            fingerprint: {
                type: String,
                required: true,
                trim: true,
                lowercase: true,
                maxlength: 128,
                immutable: true
            },

            /**
             * -----------------------------------------------------------------
             * Correlation
             * -----------------------------------------------------------------
             */

            transactionId: {
                type: String,
                trim: true,
                maxlength: 512,
                immutable: true,
                index: true
            },

            parentTransactionId: {
                type: String,
                trim: true,
                maxlength: 512,
                immutable: true
            },

            correlationId: {
                type: String,
                trim: true,
                maxlength: 512,
                immutable: true,
                index: true
            },

            requestId: {
                type: String,
                trim: true,
                maxlength: 512,
                immutable: true
            },

            idempotencyKey: {
                type: String,
                trim: true,
                maxlength: 512,
                immutable: true
            },

            userId: {
                type: String,
                trim: true,
                maxlength: 256,
                immutable: true
            },

            customerId: {
                type: String,
                trim: true,
                maxlength: 256,
                immutable: true
            },

            provider: {
                type: String,
                trim: true,
                uppercase: true,
                maxlength: 128,
                immutable: true,
                index: true
            },

            operation: {
                type: String,
                trim: true,
                uppercase: true,
                maxlength: 256,
                immutable: true
            },

            source: {
                type: String,
                trim: true,
                maxlength: 256,
                immutable: true
            },

            aggregate: {
                type: AggregateSchema,
                immutable: true
            },

            trace: {
                type: TraceSchema,
                immutable: true
            },

            /**
             * -----------------------------------------------------------------
             * Event data
             * -----------------------------------------------------------------
             *
             * These are immutable after creation.
             */

            payload: {
                type: Schema.Types.Mixed,
                required: true,
                immutable: true
            },

            metadata: {
                type: Schema.Types.Mixed,
                default: {},
                immutable: true
            },

            occurredAt: {
                type: Date,
                required: true,
                immutable: true
            },

            /**
             * -----------------------------------------------------------------
             * Routing
             * -----------------------------------------------------------------
             */

            routing: {
                type: RoutingSchema,
                required: true,
                immutable: true
            },

            /**
             * -----------------------------------------------------------------
             * Delivery lifecycle
             * -----------------------------------------------------------------
             */

            status: {
                type: String,
                required: true,
                enum: VALID_STATUSES,
                default: OUTBOX_STATUS.PENDING,
                index: true
            },

            publishedAt: {
                type: Date,
                default: null
            },

            failedAt: {
                type: Date,
                default: null
            },

            deadLetteredAt: {
                type: Date,
                default: null
            },

            cancelledAt: {
                type: Date,
                default: null
            },

            /**
             * -----------------------------------------------------------------
             * Retry state
             * -----------------------------------------------------------------
             */

            attemptCount: {
                type: Number,
                default: 0,
                min: 0
            },

            maxAttempts: {
                type: Number,
                default: 10,
                min: 0
            },

            nextAttemptAt: {
                type: Date,
                default: null,
                index: true
            },

            lastAttemptAt: {
                type: Date,
                default: null
            },

            /**
             * -----------------------------------------------------------------
             * Worker lease
             * -----------------------------------------------------------------
             */

            claimedBy: {
                type: String,
                trim: true,
                maxlength: 256,
                default: null,
                index: true
            },

            leaseExpiresAt: {
                type: Date,
                default: null,
                index: true
            },

            lastHeartbeatAt: {
                type: Date,
                default: null
            },

            /**
             * -----------------------------------------------------------------
             * Delivery diagnostics
             * -----------------------------------------------------------------
             */

            lastError: {
                type: OutboxErrorSchema,
                default: null
            },

            publishCount: {
                type: Number,
                default: 0,
                min: 0
            },

            deliveryVersion: {
                type: Number,
                default: 0,
                min: 0
            },

            /**
             * -----------------------------------------------------------------
             * Retention / replay
             * -----------------------------------------------------------------
             */

            replayCount: {
                type: Number,
                default: 0,
                min: 0
            },

            lastReplayedAt: {
                type: Date,
                default: null
            },

            /**
             * -----------------------------------------------------------------
             * Optimistic concurrency
             * -----------------------------------------------------------------
             */

            version: {
                type: Number,
                default: 0,
                min: 0
            }

        },

        {
            timestamps: true,

            versionKey: false,

            strict: true,

            minimize: false,

            toJSON: {
                getters: true,
                virtuals: true
            },

            toObject: {
                getters: true,
                virtuals: true
            }

        }

    );


/**
 * ============================================================================
 * Validation
 * ============================================================================
 */

TransactionOutboxRecordSchema.pre(
    'validate',
    function validateOutboxRecord(next) {

        try {

            if (
                this.status === OUTBOX_STATUS.PUBLISHED &&
                !this.publishedAt
            ) {

                this.publishedAt =
                    new Date();

            }


            if (
                this.status === OUTBOX_STATUS.DEAD_LETTERED &&
                !this.deadLetteredAt
            ) {

                this.deadLetteredAt =
                    new Date();

            }


            if (
                this.status === OUTBOX_STATUS.FAILED &&
                !this.failedAt
            ) {

                this.failedAt =
                    new Date();

            }


            if (
                this.status === OUTBOX_STATUS.CANCELLED &&
                !this.cancelledAt
            ) {

                this.cancelledAt =
                    new Date();

            }


            if (
                this.nextAttemptAt &&
                !normalizeDecimalDate(
                    this.nextAttemptAt
                )
            ) {

                throw new Error(
                    'Invalid nextAttemptAt'
                );

            }


            next();

        }
        catch (error) {

            next(error);

        }

    }
);


/**
 * ============================================================================
 * Immutable Envelope Protection
 * ============================================================================
 *
 * Repository operations intentionally update only delivery fields.
 *
 * This additional hook makes accidental direct mutation through save()
 * fail when a persisted immutable envelope is modified.
 * ============================================================================
 */

TransactionOutboxRecordSchema.pre(
    'save',
    function protectImmutableEnvelope(next) {

        if (
            !this.isNew
        ) {

            const immutablePaths = [

                'tenantId',
                'organizationId',
                'eventId',
                'eventKey',
                'eventType',
                'eventVersion',
                'schemaVersion',
                'category',
                'fingerprint',
                'transactionId',
                'parentTransactionId',
                'correlationId',
                'requestId',
                'idempotencyKey',
                'userId',
                'customerId',
                'provider',
                'operation',
                'source',
                'aggregate',
                'trace',
                'payload',
                'metadata',
                'occurredAt',
                'routing'

            ];


            const modified =
                this.modifiedPaths();


            const illegalModification =
                modified.find(
                    path =>
                        immutablePaths.some(
                            immutablePath =>
                                path === immutablePath ||
                                path.startsWith(
                                    `${immutablePath}.`
                                )
                        )
                );


            if (
                illegalModification
            ) {

                return next(
                    new Error(

                        `Immutable outbox field cannot be modified: ${illegalModification}`

                    )
                );

            }

        }


        return next();

    }
);


/**
 * ============================================================================
 * Indexes
 * ============================================================================
 *
 * The tenant boundary is included in every business-facing uniqueness/index
 * where appropriate.
 * ============================================================================
 */

TransactionOutboxRecordSchema.index(

    {
        tenantId: 1,
        eventId: 1

    },

    {
        unique: true,
        name:
            'uq_outbox_tenant_event_id'
    }

);


TransactionOutboxRecordSchema.index(

    {
        tenantId: 1,
        eventKey: 1

    },

    {
        unique: true,
        name:
            'uq_outbox_tenant_event_key'
    }

);


TransactionOutboxRecordSchema.index(

    {
        tenantId: 1,
        status: 1,
        nextAttemptAt: 1,
        createdAt: 1

    },

    {
        name:
            'ix_outbox_delivery_queue'
    }

);


TransactionOutboxRecordSchema.index(

    {
        tenantId: 1,
        status: 1,
        leaseExpiresAt: 1

    },

    {
        name:
            'ix_outbox_expired_leases'
    }

);


TransactionOutboxRecordSchema.index(

    {
        tenantId: 1,
        transactionId: 1,
        createdAt: -1

    },

    {
        name:
            'ix_outbox_transaction_history'
    }

);


TransactionOutboxRecordSchema.index(

    {
        tenantId: 1,
        correlationId: 1,
        createdAt: -1

    },

    {
        name:
            'ix_outbox_correlation_history'
    }

);


TransactionOutboxRecordSchema.index(

    {
        tenantId: 1,
        provider: 1,
        status: 1,
        nextAttemptAt: 1

    },

    {
        name:
            'ix_outbox_provider_queue'
    }

);


TransactionOutboxRecordSchema.index(

    {
        tenantId: 1,
        eventType: 1,
        createdAt: -1

    },

    {
        name:
            'ix_outbox_event_type_history'
    }

);


TransactionOutboxRecordSchema.index(

    {
        status: 1,
        nextAttemptAt: 1,
        leaseExpiresAt: 1

    },

    {
        name:
            'ix_outbox_global_due_work'
    }

);


/**
 * ============================================================================
 * Virtuals
 * ============================================================================
 */

TransactionOutboxRecordSchema.virtual(
    'isTerminal'
)
    .get(
        function isTerminal() {

            return [

                OUTBOX_STATUS.PUBLISHED,

                OUTBOX_STATUS.DEAD_LETTERED,

                OUTBOX_STATUS.CANCELLED

            ].includes(
                this.status
            );

        }
    );


TransactionOutboxRecordSchema.virtual(
    'isClaimable'
)
    .get(
        function isClaimable() {

            const now =
                new Date();

            return (

                this.status ===
                    OUTBOX_STATUS.PENDING ||

                (
                    this.status ===
                        OUTBOX_STATUS.PROCESSING &&

                    this.leaseExpiresAt &&

                    this.leaseExpiresAt <=
                        now
                )

            );

        }
    );


/**
 * ============================================================================
 * JSON Transformation
 * ============================================================================
 */

TransactionOutboxRecordSchema.options.toJSON.transform =
    function transform(
        doc,
        ret
    ) {

        delete ret._id;
        delete ret.__v;

        return ret;

    };


TransactionOutboxRecordSchema.options.toObject.transform =
    function transform(
        doc,
        ret
    ) {

        delete ret._id;
        delete ret.__v;

        return ret;

    };


/**
 * ============================================================================
 * Model
 * ============================================================================
 */

const TransactionOutboxRecord =
    mongoose.models.TransactionOutboxRecord ||
    mongoose.model(
        'TransactionOutboxRecord',
        TransactionOutboxRecordSchema
    );


/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports =
    TransactionOutboxRecord;


module.exports.TransactionOutboxRecord =
    TransactionOutboxRecord;


module.exports.TransactionOutboxRecordSchema =
    TransactionOutboxRecordSchema;


module.exports.OUTBOX_STATUS =
    OUTBOX_STATUS;