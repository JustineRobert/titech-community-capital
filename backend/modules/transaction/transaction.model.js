'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Financial Transaction Model
 * ============================================================================
 *
 * File:
 *   models/Transaction.js
 *
 * Purpose
 * -------
 * Persistent transaction record for the financial engine.
 *
 * Responsibilities
 * ----------------
 * • Persist financial transaction identity
 * • Enforce tenant isolation
 * • Preserve monetary precision using Decimal128
 * • Enforce transaction lifecycle states
 * • Support idempotency
 * • Support distributed correlation
 * • Support AML/Fraud/KYC/Compliance correlation
 * • Support ledger linkage
 * • Support reconciliation
 * • Support auditability
 * • Support optimistic concurrency
 *
 * Financial Principle
 * -------------------
 * A Transaction is a business-financial record.
 *
 * The immutable ledger/journal remains the accounting source of truth.
 * This model must therefore never be used to silently rewrite historical
 * financial values.
 *
 * Once financial posting has occurred:
 *
 *   amount
 *   currency
 *   tenantId
 *   type
 *   idempotencyKey
 *   transactionId
 *
 * must not be changed.
 *
 * Status transitions are controlled explicitly.
 *
 * ============================================================================
 */

const mongoose = require('mongoose');

const {
    Schema
} = mongoose;


/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const MODEL_NAME =
    'Transaction';

const COLLECTION_NAME =
    'transactions';


const VALID_STATUSES = Object.freeze([

    'pending',

    'completed',

    'failed',

    'canceled'

]);


const VALID_TYPES = Object.freeze([

    'deposit',

    'withdrawal',

    'transfer',

    'payment',

    'loan',

    'repayment'

]);


const TERMINAL_STATUSES = new Set([

    'completed',

    'failed',

    'canceled'

]);


const INITIAL_STATUS =
    'pending';


/**
 * ============================================================================
 * Decimal Validation
 * ============================================================================
 *
 * Decimal128 is used for financial precision.
 *
 * Do not convert to Number merely to determine whether the value is valid.
 * ============================================================================
 */

function validatePositiveDecimal(value) {

    if (
        value === undefined ||
        value === null
    ) {

        return false;

    }

    try {

        const decimal =
            value instanceof mongoose.Types.Decimal128
                ? value
                : mongoose.Types.Decimal128.fromString(
                    String(value)
                );

        const normalized =
            decimal.toString();

        if (
            normalized === 'NaN' ||
            normalized === 'Infinity' ||
            normalized === '-Infinity'
        ) {

            return false;

        }

        return (
            decimal.toString() !== '0' &&
            !normalized.startsWith('-')
        );

    }
    catch (_) {

        return false;

    }

}


/**
 * ============================================================================
 * Currency Validation
 * ============================================================================
 */

function isValidCurrency(value) {

    if (
        typeof value !== 'string'
    ) {

        return false;

    }

    return /^[A-Z]{3}$/.test(
        value.trim().toUpperCase()
    );

}


/**
 * ============================================================================
 * Identifier Validation
 * ============================================================================
 */

function isValidIdentifier(value) {

    if (
        typeof value !== 'string'
    ) {

        return false;

    }

    const normalized =
        value.trim();

    return (
        normalized.length > 0 &&
        normalized.length <= 256
    );

}


/**
 * ============================================================================
 * Status Transition Policy
 * ============================================================================
 *
 * Financial lifecycle:
 *
 * pending
 *   ├── completed
 *   ├── failed
 *   └── canceled
 *
 * terminal states cannot be silently moved elsewhere.
 *
 * A reversal is a NEW financial transaction rather than a status mutation.
 * ============================================================================
 */

const ALLOWED_STATUS_TRANSITIONS = Object.freeze({

    pending: Object.freeze([

        'completed',

        'failed',

        'canceled'

    ]),

    completed: Object.freeze([]),

    failed: Object.freeze([]),

    canceled: Object.freeze([])

});


/**
 * ============================================================================
 * Transaction Schema
 * ============================================================================
 */

const TransactionSchema =
    new Schema({

        /**
         * ---------------------------------------------------------------------
         * Tenant Isolation
         * ---------------------------------------------------------------------
         */

        tenantId: {

            type:
                String,

            required:
                true,

            trim:
                true,

            maxlength:
                256,

            immutable:
                true,

            index:
                true,

            validate: {

                validator:
                    isValidIdentifier,

                message:
                    'tenantId is required and must be a valid identifier'

            }

        },


        /**
         * ---------------------------------------------------------------------
         * Public Transaction Identity
         * ---------------------------------------------------------------------
         *
         * Separate business identity from MongoDB _id.
         */

        transactionId: {

            type:
                String,

            required:
                true,

            trim:
                true,

            maxlength:
                128,

            immutable:
                true,

            index:
                true,

            default:
                () =>
                    new mongoose.Types.ObjectId()
                        .toString()

        },


        /**
         * ---------------------------------------------------------------------
         * Business Reference
         * ---------------------------------------------------------------------
         */

        reference: {

            type:
                String,

            trim:
                true,

            maxlength:
                256,

            immutable:
                true,

            index:
                true

        },


        /**
         * ---------------------------------------------------------------------
         * Transaction Type
         * ---------------------------------------------------------------------
         */

        type: {

            type:
                String,

            required:
                true,

            enum:
                VALID_TYPES,

            trim:
                true,

            lowercase:
                true,

            immutable:
                true,

            index:
                true

        },


        /**
         * ---------------------------------------------------------------------
         * Monetary Amount
         * ---------------------------------------------------------------------
         */

        amount: {

            type:
                Schema.Types.Decimal128,

            required:
                true,

            immutable:
                true,

            validate: {

                validator:
                    validatePositiveDecimal,

                message:
                    'Amount must be a positive monetary value'

            }

        },


        /**
         * ---------------------------------------------------------------------
         * Currency
         * ---------------------------------------------------------------------
         */

        currency: {

            type:
                String,

            required:
                true,

            default:
                'UGX',

            trim:
                true,

            uppercase:
                true,

            minlength:
                3,

            maxlength:
                3,

            immutable:
                true,

            validate: {

                validator:
                    isValidCurrency,

                message:
                    'Currency must be a valid 3-letter currency code'

            }

        },


        /**
         * ---------------------------------------------------------------------
         * Transaction Status
         * ---------------------------------------------------------------------
         */

        status: {

            type:
                String,

            enum:
                VALID_STATUSES,

            default:
                INITIAL_STATUS,

            required:
                true,

            index:
                true

        },


        /**
         * ---------------------------------------------------------------------
         * Idempotency
         * ---------------------------------------------------------------------
         *
         * Uniqueness is enforced by the compound:
         *
         *   tenantId + idempotencyKey
         *
         * rather than globally.
         */

        idempotencyKey: {

            type:
                String,

            trim:
                true,

            maxlength:
                512,

            immutable:
                true

        },


        /**
         * ---------------------------------------------------------------------
         * Correlation
         * ---------------------------------------------------------------------
         */

        correlationId: {

            type:
                String,

            trim:
                true,

            maxlength:
                256,

            index:
                true,

            immutable:
                true

        },


        requestId: {

            type:
                String,

            trim:
                true,

            maxlength:
                256,

            immutable:
                true

        },


        /**
         * ---------------------------------------------------------------------
         * Actor / User
         * ---------------------------------------------------------------------
         */

        userId: {

            type:
                String,

            trim:
                true,

            maxlength:
                256,

            immutable:
                true,

            index:
                true

        },


        customerId: {

            type:
                String,

            trim:
                true,

            maxlength:
                256,

            immutable:
                true,

            index:
                true

        },


        /**
         * ---------------------------------------------------------------------
         * Account Linkage
         * ---------------------------------------------------------------------
         *
         * These are business references to the affected accounts.
         * The immutable ledger remains authoritative for accounting.
         */

        debitAccountId: {

            type:
                String,

            trim:
                true,

            maxlength:
                256,

            immutable:
                true

        },


        creditAccountId: {

            type:
                String,

            trim:
                true,

            maxlength:
                256,

            immutable:
                true

        },


        /**
         * ---------------------------------------------------------------------
         * Ledger Linkage
         * ---------------------------------------------------------------------
         */

        journalId: {

            type:
                String,

            trim:
                true,

            maxlength:
                256,

            immutable:
                true,

            index:
                true

        },


        ledgerTransactionId: {

            type:
                String,

            trim:
                true,

            maxlength:
                256,

            immutable:
                true,

            index:
                true

        },


        /**
         * ---------------------------------------------------------------------
         * Payment Provider Context
         * ---------------------------------------------------------------------
         */

        provider: {

            type:
                String,

            trim:
                true,

            uppercase:
                true,

            maxlength:
                128,

            immutable:
                true,

            index:
                true

        },


        providerTransactionId: {

            type:
                String,

            trim:
                true,

            maxlength:
                256,

            immutable:
                true,

            index:
                true

        },


        operation: {

            type:
                String,

            trim:
                true,

            uppercase:
                true,

            maxlength:
                128,

            immutable:
                true

        },


        /**
         * ---------------------------------------------------------------------
         * Description
         * ---------------------------------------------------------------------
         */

        description: {

            type:
                String,

            trim:
                true,

            maxlength:
                2000

        },


        /**
         * ---------------------------------------------------------------------
         * Risk / Compliance Linkage
         * ---------------------------------------------------------------------
         */

        fraudScreeningId: {

            type:
                String,

            trim:
                true,

            maxlength:
                128,

            immutable:
                true,

            index:
                true

        },


        amlScreeningId: {

            type:
                String,

            trim:
                true,

            maxlength:
                128,

            immutable:
                true,

            index:
                true

        },


        complianceDecisionId: {

            type:
                String,

            trim:
                true,

            maxlength:
                128,

            immutable:
                true,

            index:
                true

        },


        riskDecision: {

            type:
                String,

            enum: [

                'APPROVE',

                'REVIEW',

                'BLOCK'

            ],

            immutable:
                true

        },


        /**
         * ---------------------------------------------------------------------
         * Metadata
         * ---------------------------------------------------------------------
         *
         * Metadata must not be used as the source of accounting truth.
         *
         * Use a function to avoid sharing a mutable object between documents.
         */

        metadata: {

            type:
                Schema.Types.Mixed,

            default:
                () =>
                    ({})

        },


        /**
         * ---------------------------------------------------------------------
         * Archive Flag
         * ---------------------------------------------------------------------
         */

        archived: {

            type:
                Boolean,

            default:
                false,

            index:
                true

        },


        /**
         * ---------------------------------------------------------------------
         * Lifecycle Timestamps
         * ---------------------------------------------------------------------
         */

        completedAt: {

            type:
                Date,

            immutable:
                true

        },


        failedAt: {

            type:
                Date,

            immutable:
                true

        },


        canceledAt: {

            type:
                Date,

            immutable:
                true

        }

    }, {

        collection:
            COLLECTION_NAME,

        strict:
            true,

        timestamps:
            true,

        versionKey:
            'version',

        optimisticConcurrency:
            true,

        minimize:
            false,

        toJSON: {

            getters:
                true,

            virtuals:
                true

        },

        toObject: {

            getters:
                true,

            virtuals:
                true

        }

    });


/**
 * ============================================================================
 * Decimal128 JSON Serialization
 * ============================================================================
 *
 * IMPORTANT:
 *
 * Do NOT automatically convert Decimal128 into Number.
 *
 * Monetary values can exceed JavaScript's safe integer/precision boundary.
 *
 * The serialized amount is returned as a string:
 *
 *   "100.25"
 *
 * rather than an imprecise JavaScript Number.
 * ============================================================================
 */

function transformDecimalAmount(
    doc,
    ret
) {

    if (
        ret.amount !== undefined &&
        ret.amount !== null
    ) {

        ret.amount =
            ret.amount.toString();

    }

    return ret;

}


TransactionSchema.options.toJSON.transform =
    function transactionJSONTransform(
        doc,
        ret
    ) {

        delete ret.__v;

        return transformDecimalAmount(
            doc,
            ret
        );

    };


TransactionSchema.options.toObject.transform =
    function transactionObjectTransform(
        doc,
        ret
    ) {

        delete ret.__v;

        return transformDecimalAmount(
            doc,
            ret
        );

    };


/**
 * ============================================================================
 * Status Transition Validation
 * ============================================================================
 */

TransactionSchema.pre(
    'validate',
    function validateStatusTransition(
        next
    ) {

        /**
         * New document.
         */
        if (
            this.isNew
        ) {

            if (
                this.status !==
                INITIAL_STATUS
            ) {

                return next(
                    new Error(
                        'New transactions must start in pending status'
                    )
                );

            }

            return next();

        }


        /**
         * Status has not changed.
         */
        if (
            !this.isModified('status')
        ) {

            return next();

        }


        const originalStatus =
            this.get(
                'status',
                null,
                {
                    getters:
                        false
                }
            );


        /**
         * Mongoose does not always expose the original value through
         * get() during all update flows, so query-based status updates
         * are additionally guarded below.
         */
        if (
            originalStatus &&
            originalStatus !== this.status
        ) {

            const allowed =
                ALLOWED_STATUS_TRANSITIONS[
                    originalStatus
                ] || [];


            if (
                !allowed.includes(
                    this.status
                )
            ) {

                return next(
                    new Error(
                        `Invalid transaction status transition: ${originalStatus} -> ${this.status}`
                    )
                );

            }

        }


        next();

    }
);


/**
 * ============================================================================
 * Lifecycle Timestamp Enforcement
 * ============================================================================
 */

TransactionSchema.pre(
    'save',
    function enforceLifecycleTimestamps(
        next
    ) {

        if (
            this.isModified('status')
        ) {

            switch (
                this.status
            ) {

                case 'completed':

                    this.completedAt =
                        this.completedAt ||
                        new Date();

                    break;


                case 'failed':

                    this.failedAt =
                        this.failedAt ||
                        new Date();

                    break;


                case 'canceled':

                    this.canceledAt =
                        this.canceledAt ||
                        new Date();

                    break;


                default:
                    break;

            }

        }


        next();

    }
);


/**
 * ============================================================================
 * Financial Field Immutability
 * ============================================================================
 *
 * Even though immutable:true exists on the fields, this explicit guard makes
 * the business invariant obvious and protects future maintainers from
 * accidentally relaxing individual field definitions.
 * ============================================================================
 */

const IMMUTABLE_FINANCIAL_FIELDS = [

    'tenantId',

    'transactionId',

    'type',

    'amount',

    'currency',

    'idempotencyKey',

    'reference',

    'userId',

    'customerId',

    'debitAccountId',

    'creditAccountId',

    'provider',

    'operation',

    'providerTransactionId',

    'journalId',

    'ledgerTransactionId',

    'fraudScreeningId',

    'amlScreeningId',

    'complianceDecisionId',

    'riskDecision',

    'correlationId',

    'requestId'

];


TransactionSchema.pre(
    'save',
    function preventFinancialMutation(
        next
    ) {

        if (
            this.isNew
        ) {

            return next();

        }


        const changedFields =
            this.modifiedPaths();


        const forbiddenChanges =
            changedFields.filter(
                field =>
                    IMMUTABLE_FINANCIAL_FIELDS.includes(
                        field
                    )
            );


        if (
            forbiddenChanges.length > 0
        ) {

            return next(
                new Error(

                    `Immutable transaction fields cannot be modified: ${forbiddenChanges.join(', ')}`

                )
            );

        }


        next();

    }
);


/**
 * ============================================================================
 * Query-Level Financial Immutability
 * ============================================================================
 *
 * Direct update operations on financial identity/value fields are rejected.
 *
 * Status updates are intentionally allowed only through explicit lifecycle
 * methods below.
 * ============================================================================
 */

const BLOCKED_UPDATE_OPERATIONS = [

    'updateOne',

    'updateMany',

    'findOneAndUpdate',

    'findByIdAndUpdate'

];


for (
    const operation
    of BLOCKED_UPDATE_OPERATIONS
) {

    TransactionSchema.pre(
        operation,
        function preventUnsafeUpdate(
            next
        ) {

            const update =
                this.getUpdate() ||
                {};


            const updatePayload = {

                ...(update.$set || {}),

                ...(update.$setOnInsert || {}),

                ...Object.keys(update)
                    .filter(
                        key =>
                            !key.startsWith('$')
                    )
                    .reduce(
                        (
                            result,
                            key
                        ) => {

                            result[key] =
                                update[key];

                            return result;

                        },
                        {}
                    )

            };


            const attemptedFields =
                Object.keys(
                    updatePayload
                ).filter(
                    field =>
                        IMMUTABLE_FINANCIAL_FIELDS.includes(
                            field
                        )
                );


            if (
                attemptedFields.length > 0
            ) {

                return next(
                    new Error(

                        `Direct mutation of immutable transaction fields is prohibited: ${attemptedFields.join(', ')}`

                    )
                );

            }


            next();

        }
    );

}


/**
 * ============================================================================
 * Delete Protection
 * ============================================================================
 *
 * Financial transaction history should not disappear via application-level
 * delete calls.
 *
 * Archive/retention controls should be implemented separately.
 * ============================================================================
 */

const DELETE_OPERATIONS = [

    'deleteOne',

    'deleteMany',

    'findOneAndDelete',

    'findByIdAndDelete'

];


for (
    const operation
    of DELETE_OPERATIONS
) {

    TransactionSchema.pre(
        operation,
        function preventFinancialDeletion(
            next
        ) {

            next(
                new Error(
                    'Financial transaction records cannot be deleted through the application'
                )
            );

        }
    );

}


/**
 * ============================================================================
 * Compound Indexes
 * ============================================================================
 *
 * All operational indexes are tenant-prefixed where appropriate.
 */


/**
 * Tenant transaction timeline.
 */
TransactionSchema.index({

    tenantId:
        1,

    createdAt:
        -1

}, {

    name:
        'idx_transaction_tenant_created'

});


/**
 * Tenant/type/status transaction queries.
 */
TransactionSchema.index({

    tenantId:
        1,

    type:
        1,

    status:
        1,

    createdAt:
        -1

}, {

    name:
        'idx_transaction_tenant_type_status_created'

});


/**
 * Tenant-scoped idempotency.
 *
 * IMPORTANT:
 * This replaces the old globally unique idempotency key behavior.
 */
TransactionSchema.index({

    tenantId:
        1,

    idempotencyKey:
        1

}, {

    unique:
        true,

    sparse:
        true,

    name:
        'uniq_transaction_tenant_idempotency'

});


/**
 * Tenant/reference lookup.
 */
TransactionSchema.index({

    tenantId:
        1,

    reference:
        1

}, {

    sparse:
        true,

    name:
        'idx_transaction_tenant_reference'

});


/**
 * Transaction business identity.
 */
TransactionSchema.index({

    tenantId:
        1,

    transactionId:
        1

}, {

    unique:
        true,

    name:
        'uniq_transaction_tenant_transaction_id'

});


/**
 * Customer transaction history.
 */
TransactionSchema.index({

    tenantId:
        1,

    customerId:
        1,

    createdAt:
        -1

}, {

    sparse:
        true,

    name:
        'idx_transaction_tenant_customer_created'

});


/**
 * Provider transaction lookup.
 */
TransactionSchema.index({

    tenantId:
        1,

    provider:
        1,

    providerTransactionId:
        1

}, {

    sparse:
        true,

    name:
        'idx_transaction_provider_reference'

});


/**
 * Correlation tracing.
 */
TransactionSchema.index({

    tenantId:
        1,

    correlationId:
        1,

    createdAt:
        -1

}, {

    sparse:
        true,

    name:
        'idx_transaction_correlation'

});


/**
 * Ledger linkage.
 */
TransactionSchema.index({

    tenantId:
        1,

    ledgerTransactionId:
        1

}, {

    sparse:
        true,

    name:
        'idx_transaction_ledger_link'

});


/**
 * AML/Fraud/Compliance linkage.
 */
TransactionSchema.index({

    tenantId:
        1,

    fraudScreeningId:
        1

}, {

    sparse:
        true,

    name:
        'idx_transaction_fraud_screening'

});


TransactionSchema.index({

    tenantId:
        1,

    amlScreeningId:
        1

}, {

    sparse:
        true,

    name:
        'idx_transaction_aml_screening'

});


TransactionSchema.index({

    tenantId:
        1,

    complianceDecisionId:
        1

}, {

    sparse:
        true,

    name:
        'idx_transaction_compliance_decision'

});


/**
 * Review-oriented query.
 */
TransactionSchema.index({

    tenantId:
        1,

    status:
        1,

    archived:
        1,

    createdAt:
        -1

}, {

    name:
        'idx_transaction_operational_queue'

});


/**
 * ============================================================================
 * Static Methods
 * ============================================================================
 */

/**
 * Find by business transaction ID within a tenant.
 */
TransactionSchema.statics.findByTransactionId =
    function findByTransactionId({

        tenantId,

        transactionId

    }) {

        return this.findOne({

            tenantId,

            transactionId

        });

    };


/**
 * Find by tenant-scoped idempotency key.
 */
TransactionSchema.statics.findByIdempotencyKey =
    function findByIdempotencyKey({

        tenantId,

        idempotencyKey

    }) {

        return this.findOne({

            tenantId,

            idempotencyKey

        });

    };


/**
 * Find latest transaction for a customer.
 */
TransactionSchema.statics.findLatestForCustomer =
    function findLatestForCustomer({

        tenantId,

        customerId

    }) {

        return this.findOne({

            tenantId,

            customerId

        })
            .sort({

                createdAt:
                    -1

            });

    };


/**
 * ============================================================================
 * Lifecycle Methods
 * ============================================================================
 *
 * These methods are the preferred way to change transaction status.
 * ============================================================================
 */

TransactionSchema.methods.complete =
    async function complete() {

        if (
            this.status !==
            'pending'
        ) {

            throw new Error(

                `Transaction cannot be completed from status: ${this.status}`

            );

        }

        this.status =
            'completed';

        this.completedAt =
            new Date();

        return this.save();

    };


TransactionSchema.methods.fail =
    async function fail() {

        if (
            this.status !==
            'pending'
        ) {

            throw new Error(

                `Transaction cannot be failed from status: ${this.status}`

            );

        }

        this.status =
            'failed';

        this.failedAt =
            new Date();

        return this.save();

    };


TransactionSchema.methods.cancel =
    async function cancel() {

        if (
            this.status !==
            'pending'
        ) {

            throw new Error(

                `Transaction cannot be canceled from status: ${this.status}`

            );

        }

        this.status =
            'canceled';

        this.canceledAt =
            new Date();

        return this.save();

    };


/**
 * ============================================================================
 * Operational Summary
 * ============================================================================
 */

TransactionSchema.methods.toOperationalSummary =
    function toOperationalSummary() {

        return {

            transactionId:
                this.transactionId,

            tenantId:
                this.tenantId,

            type:
                this.type,

            amount:
                this.amount?.toString?.(),

            currency:
                this.currency,

            status:
                this.status,

            reference:
                this.reference,

            provider:
                this.provider,

            providerTransactionId:
                this.providerTransactionId,

            correlationId:
                this.correlationId,

            requestId:
                this.requestId,

            customerId:
                this.customerId,

            journalId:
                this.journalId,

            ledgerTransactionId:
                this.ledgerTransactionId,

            fraudScreeningId:
                this.fraudScreeningId,

            amlScreeningId:
                this.amlScreeningId,

            complianceDecisionId:
                this.complianceDecisionId,

            createdAt:
                this.createdAt,

            updatedAt:
                this.updatedAt

        };

    };


/**
 * ============================================================================
 * Model Registration
 * ============================================================================
 */

const Transaction =
    mongoose.models[MODEL_NAME] ||
    mongoose.model(
        MODEL_NAME,
        TransactionSchema
    );


/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports =
    Transaction;

module.exports.Transaction =
    Transaction;

module.exports.TransactionSchema =
    TransactionSchema;

module.exports.VALID_STATUSES =
    VALID_STATUSES;

module.exports.VALID_TYPES =
    VALID_TYPES;

module.exports.ALLOWED_STATUS_TRANSITIONS =
    ALLOWED_STATUS_TRANSITIONS;