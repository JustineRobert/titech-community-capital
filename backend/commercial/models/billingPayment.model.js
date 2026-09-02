"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Canonical SaaS Billing Payment Model
 * =============================================================================
 *
 * File:
 *   backend/commercial/models/billingPayment.model.js
 *
 * Purpose:
 *   Persistent commercial record for payments applied to TITech SaaS billing
 *   invoices/subscriptions.
 *
 * Financial authority boundary:
 *
 *   BillingPayment is NOT the source of truth for customer money.
 *
 *   BillingPayment records commercial/payment orchestration state and the
 *   reference to the authoritative TITech Financial Core transaction created
 *   after successful settlement.
 *
 *   Customer financial authority remains with the existing TITech Financial
 *   Transaction / Ledger / Wallet / Payment architecture.
 *
 * Enterprise invariants:
 *   - Every payment belongs to exactly one tenant and invoice.
 *   - Monetary values use Decimal128, never JavaScript floating-point numbers.
 *   - Amount must be strictly greater than zero.
 *   - Currency is immutable after creation.
 *   - Tenant and invoice ownership are immutable after creation.
 *   - Provider identity is immutable after creation.
 *   - Idempotency is tenant-scoped and enforced by a unique index.
 *   - Provider payment IDs are unique only when actually present.
 *   - Financial transaction linkage is immutable once established.
 *   - Successful payments require authoritative financial-core linkage.
 *   - Successful payments require postedAt.
 *   - Failed payments must expose a failure reason/code.
 *   - Provider references are normalized consistently before persistence.
 *   - Sensitive provider payloads/secrets must not be stored in metadata.
 *
 * Index contract:
 *   This model intentionally mirrors:
 *
 *   backend/migrations/20260830_130000_add_saas_billing_payment.js
 *
 *   The provider-payment uniqueness index uses a partial filter instead of
 *   sparse uniqueness so documents with an explicit null providerPaymentId
 *   cannot collide.
 *
 * =============================================================================
 */

const mongoose = require("mongoose");

const {
    PAYMENT_STATUS,
    BILLING_CURRENCIES,
} = require("../constants/billing.constants");

const PAYMENT_STATUS_VALUES = Object.freeze(
    Object.values(PAYMENT_STATUS)
);

const BILLING_CURRENCY_VALUES = Object.freeze(
    Object.values(BILLING_CURRENCIES)
);

const PAYMENT_FINAL_STATUSES = new Set([
    PAYMENT_STATUS.SUCCESS,
    PAYMENT_STATUS.FAILED,
    PAYMENT_STATUS.REVERSED,
    PAYMENT_STATUS.REFUNDED,
]);

const PAYMENT_SUCCESS_STATUSES = new Set([
    PAYMENT_STATUS.SUCCESS,
]);

const PAYMENT_PROCESSING_STATUSES = new Set([
    PAYMENT_STATUS.PENDING,
    PAYMENT_STATUS.PROCESSING,
]);

const PAYMENT_PROVIDER_MAX_LENGTH = 80;
const PAYMENT_REFERENCE_MAX_LENGTH = 255;
const IDEMPOTENCY_KEY_MAX_LENGTH = 255;
const FAILURE_CODE_MAX_LENGTH = 120;
const FAILURE_REASON_MAX_LENGTH = 1000;
const FINANCIAL_TRANSACTION_ID_MAX_LENGTH = 128;


/**
 * =============================================================================
 * Utility Functions
 * =============================================================================
 */

function decimalToString(value) {
    if (value == null) {
        return null;
    }

    if (value?._bsontype === "Decimal128") {
        return value.toString();
    }

    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            return String(value);
        }

        return value.toString();
    }

    return String(value).trim();
}


/**
 * Validate a decimal value without converting it through floating point.
 *
 * The model deliberately treats:
 *   0
 *   0.0
 *   0.00
 *
 * as invalid because payment amounts must be strictly positive.
 */
function isStrictlyPositiveDecimal(value) {
    const normalized =
        decimalToString(value);

    if (!normalized) {
        return false;
    }

    if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
        return false;
    }

    const [
        whole = "0",
        fraction = "",
    ] =
        normalized.split(".");

    const allZero =
        `${whole}${fraction}`
            .replace(/^0+/, "");

    return allZero.length > 0;
}


function normalizeOptionalString(value) {
    if (value == null) {
        return null;
    }

    const normalized =
        String(value).trim();

    return normalized.length > 0
        ? normalized
        : null;
}


/**
 * Metadata is intentionally restricted to plain objects.
 *
 * The model does not attempt to recursively sanitize arbitrary provider
 * payloads. Callers must never persist secrets, credentials, PAN, CVV,
 * access tokens, authorization headers, or raw provider responses here.
 */
function normalizeMetadata(value) {
    if (value == null) {
        return {};
    }

    if (
        typeof value !== "object" ||
        Array.isArray(value) ||
        value instanceof Date ||
        value instanceof mongoose.Types.ObjectId
    ) {
        throw new Error(
            "Billing payment metadata must be a plain object."
        );
    }

    return value;
}


/**
 * =============================================================================
 * Schema
 * =============================================================================
 */

const billingPaymentSchema =
    new mongoose.Schema(
        {
            /**
             * Tenant isolation boundary.
             */
            tenantId: {
                type:
                    mongoose.Schema.Types.ObjectId,

                ref:
                    "Tenant",

                required:
                    true,

                immutable:
                    true,

                index:
                    true,
            },


            /**
             * Commercial invoice being paid.
             */
            invoiceId: {
                type:
                    mongoose.Schema.Types.ObjectId,

                ref:
                    "BillingInvoice",

                required:
                    true,

                immutable:
                    true,

                index:
                    true,
            },


            /**
             * Optional subscription context.
             */
            subscriptionId: {
                type:
                    mongoose.Schema.Types.ObjectId,

                ref:
                    "TitechSubscription",

                default:
                    null,

                immutable:
                    true,

                index:
                    true,
            },


            /**
             * Amount denominated in invoice currency.
             *
             * Decimal128 is mandatory for financial precision.
             */
            amount: {
                type:
                    mongoose.Schema.Types.Decimal128,

                required:
                    true,

                min:
                    0,
            },


            /**
             * Currency cannot change once the payment exists.
             */
            currency: {
                type:
                    String,

                required:
                    true,

                uppercase:
                    true,

                trim:
                    true,

                enum:
                    BILLING_CURRENCY_VALUES,

                immutable:
                    true,
            },


            /**
             * Commercial payment lifecycle.
             */
            status: {
                type:
                    String,

                enum:
                    PAYMENT_STATUS_VALUES,

                required:
                    true,

                default:
                    PAYMENT_STATUS.PENDING,

                index:
                    true,
            },


            /**
             * Payment provider.
             *
             * Examples:
             *   mobile_money
             *   bank
             *   stripe
             *   flutterwave
             *   internal
             */
            provider: {
                type:
                    String,

                required:
                    true,

                trim:
                    true,

                lowercase:
                    true,

                maxlength:
                    PAYMENT_PROVIDER_MAX_LENGTH,

                immutable:
                    true,
            },


            /**
             * Provider-assigned payment identifier.
             *
             * This may remain null while a payment is pending or provider
             * processing has not yet produced an external identifier.
             */
            providerPaymentId: {
                type:
                    String,

                trim:
                    true,

                maxlength:
                    PAYMENT_REFERENCE_MAX_LENGTH,

                default:
                    null,

                immutable:
                    true,

                set:
                    normalizeOptionalString,
            },


            /**
             * Merchant/provider reference.
             *
             * Not globally unique because providers can scope references
             * independently.
             */
            providerReference: {
                type:
                    String,

                trim:
                    true,

                maxlength:
                    PAYMENT_REFERENCE_MAX_LENGTH,

                default:
                    null,

                set:
                    normalizeOptionalString,
            },


            /**
             * Optional existing TITech payment-intent context.
             */
            paymentIntentId: {
                type:
                    mongoose.Schema.Types.ObjectId,

                ref:
                    "PaymentIntent",

                default:
                    null,

                index:
                    true,

                immutable:
                    true,
            },


            /**
             * Tenant-scoped idempotency boundary.
             *
             * The compound unique index below prevents duplicate payment
             * creation for the same tenant/idempotency key.
             */
            idempotencyKey: {
                type:
                    String,

                required:
                    true,

                trim:
                    true,

                maxlength:
                    IDEMPOTENCY_KEY_MAX_LENGTH,

                immutable:
                    true,
            },


            /**
             * Authoritative financial-core transaction linkage.
             *
             * This remains immutable because changing the linked transaction
             * after posting would break audit and reconciliation integrity.
             */
            financialTransactionId: {
                type:
                    String,

                trim:
                    true,

                maxlength:
                    FINANCIAL_TRANSACTION_ID_MAX_LENGTH,

                default:
                    null,

                immutable:
                    true,

                set:
                    normalizeOptionalString,
            },


            /**
             * Timestamp at which the financial-core posting completed.
             */
            postedAt: {
                type:
                    Date,

                default:
                    null,
            },


            /**
             * Provider/system failure classification.
             */
            failureCode: {
                type:
                    String,

                trim:
                    true,

                maxlength:
                    FAILURE_CODE_MAX_LENGTH,

                default:
                    null,

                set:
                    normalizeOptionalString,
            },


            /**
             * Human-readable operational failure reason.
             */
            failureReason: {
                type:
                    String,

                trim:
                    true,

                maxlength:
                    FAILURE_REASON_MAX_LENGTH,

                default:
                    null,

                set:
                    normalizeOptionalString,
            },


            /**
             * Operational metadata only.
             *
             * Never store secrets, credentials, card data, PINs, OTPs,
             * authorization tokens, raw payment-provider payloads, or other
             * sensitive payment data here.
             */
            metadata: {
                type:
                    mongoose.Schema.Types.Mixed,

                default:
                    () => ({}),

                set:
                    normalizeMetadata,
            },
        },
        {
            timestamps:
                true,

            collection:
                "titech_billing_payments",

            strict:
                true,

            minimize:
                false,

            optimisticConcurrency:
                true,

            versionKey:
                "__v",

            toJSON: {
                getters:
                    true,

                transform:
                    (_doc, ret) => {
                        delete ret.__v;

                        if (
                            ret.metadata &&
                            typeof ret.metadata === "object"
                        ) {
                            delete ret.metadata.internalSecrets;
                        }

                        return ret;
                    },
            },

            toObject: {
                getters:
                    true,
            },
        }
    );


/**
 * =============================================================================
 * Indexes
 * =============================================================================
 *
 * Production index lifecycle is controlled by TITech migrations.
 *
 * Do NOT enable schema-level autoIndex globally in production.
 */


/**
 * Tenant-scoped idempotency.
 */
billingPaymentSchema.index(
    {
        tenantId:
            1,

        idempotencyKey:
            1,
    },
    {
        unique:
            true,

        name:
            "uniq_titech_billing_payment_tenant_idempotency",
    }
);


/**
 * Provider payment uniqueness.
 *
 * Partial unique indexing is intentional.
 *
 * Multiple pending payments may legitimately contain:
 *
 *   providerPaymentId: null
 *
 * but an actual provider-assigned ID must never be duplicated for the same
 * provider.
 */
billingPaymentSchema.index(
    {
        provider:
            1,

        providerPaymentId:
            1,
    },
    {
        unique:
            true,

        name:
            "uniq_titech_billing_payment_provider_reference",

        partialFilterExpression: {
            providerPaymentId: {
                $type:
                    "string",
            },
        },
    }
);


/**
 * Invoice payment history queries.
 */
billingPaymentSchema.index(
    {
        invoiceId:
            1,

        status:
            1,

        createdAt:
            -1,
    },
    {
        name:
            "idx_titech_billing_payment_invoice_status",
    }
);


/**
 * Tenant operational dashboard / reconciliation queries.
 */
billingPaymentSchema.index(
    {
        tenantId:
            1,

        status:
            1,

        createdAt:
            -1,
    },
    {
        name:
            "idx_titech_billing_payment_tenant_status_created",
    }
);


/**
 * Tenant/invoice payment timeline.
 */
billingPaymentSchema.index(
    {
        tenantId:
            1,

        invoiceId:
            1,

        createdAt:
            -1,
    },
    {
        name:
            "idx_titech_billing_payment_tenant_invoice_created",
    }
);


/**
 * Financial-core reconciliation lookup.
 *
 * Sparse because pending payments do not yet have a financial transaction.
 */
billingPaymentSchema.index(
    {
        financialTransactionId:
            1,
    },
    {
        name:
            "idx_titech_billing_payment_financial_transaction",

        sparse:
            true,
    }
);


/**
 * =============================================================================
 * Document Validation
 * =============================================================================
 */

billingPaymentSchema.pre(
    "validate",
    function validateBillingPayment(next) {
        try {
            if (!this.tenantId) {
                return next(
                    new Error(
                        "Billing payment tenantId is required."
                    )
                );
            }

            if (!this.invoiceId) {
                return next(
                    new Error(
                        "Billing payment invoiceId is required."
                    )
                );
            }

            if (!this.idempotencyKey) {
                return next(
                    new Error(
                        "Billing payment idempotencyKey is required."
                    )
                );
            }

            if (
                !isStrictlyPositiveDecimal(
                    this.amount
                )
            ) {
                return next(
                    new Error(
                        "Billing payment amount must be a valid decimal value greater than zero."
                    )
                );
            }

            if (!this.provider) {
                return next(
                    new Error(
                        "Billing payment provider is required."
                    )
                );
            }

            if (
                !PAYMENT_STATUS_VALUES.includes(
                    this.status
                )
            ) {
                return next(
                    new Error(
                        `Unsupported TITech billing payment status: ${this.status}`
                    )
                );
            }


            /**
             * SUCCESS is only valid when the financial core has confirmed
             * the authoritative transaction.
             */
            if (
                this.status ===
                    PAYMENT_STATUS.SUCCESS &&
                !this.financialTransactionId
            ) {
                return next(
                    new Error(
                        "A successful TITech billing payment requires a financialTransactionId."
                    )
                );
            }

            if (
                PAYMENT_SUCCESS_STATUSES.has(
                    this.status
                ) &&
                !this.postedAt
            ) {
                return next(
                    new Error(
                        "A successful TITech billing payment requires postedAt."
                    )
                );
            }


            /**
             * Reversed/refunded/failed payments must not pretend to have an
             * authoritative successful posting.
             */
            if (
                PAYMENT_FINAL_STATUSES.has(
                    this.status
                ) &&
                this.status !==
                    PAYMENT_STATUS.SUCCESS
            ) {
                if (this.financialTransactionId) {
                    return next(
                        new Error(
                            "Only a successful TITech billing payment may establish a financialTransactionId."
                        )
                    );
                }

                if (this.postedAt) {
                    return next(
                        new Error(
                            "Only a successfully posted TITech billing payment may have postedAt."
                        )
                    );
                }
            }


            /**
             * FAILED payments require diagnostic context.
             */
            if (
                this.status ===
                    PAYMENT_STATUS.FAILED &&
                !this.failureCode &&
                !this.failureReason
            ) {
                return next(
                    new Error(
                        "A failed TITech billing payment requires failureCode or failureReason."
                    )
                );
            }


            /**
             * Business-level rule:
             *
             * pending/processing payments should not already have a financial
             * posting.
             */
            if (
                PAYMENT_PROCESSING_STATUSES.has(
                    this.status
                ) &&
                (this.financialTransactionId ||
                    this.postedAt)
            ) {
                return next(
                    new Error(
                        "A pending or processing TITech billing payment cannot have a completed financial posting."
                    )
                );
            }


            return next();
        } catch (error) {
            return next(error);
        }
    }
);


/**
 * =============================================================================
 * Query Helpers
 * =============================================================================
 */

billingPaymentSchema.query.byTenant =
    function byTenant(tenantId) {
        return this.where({
            tenantId,
        });
    };


billingPaymentSchema.query.byInvoice =
    function byInvoice(invoiceId) {
        return this.where({
            invoiceId,
        });
    };


billingPaymentSchema.query.pendingOrProcessing =
    function pendingOrProcessing() {
        return this.where({
            status: {
                $in:
                    Array.from(
                        PAYMENT_PROCESSING_STATUSES
                    ),
            },
        });
    };


billingPaymentSchema.query.successful =
    function successful() {
        return this.where({
            status:
                PAYMENT_STATUS.SUCCESS,
        });
    };


billingPaymentSchema.query.failed =
    function failed() {
        return this.where({
            status:
                PAYMENT_STATUS.FAILED,
        });
    };


/**
 * =============================================================================
 * Instance Helpers
 * =============================================================================
 */

billingPaymentSchema.methods.isSuccessful =
    function isSuccessful() {
        return (
            this.status ===
            PAYMENT_STATUS.SUCCESS
        );
    };


billingPaymentSchema.methods.isFinal =
    function isFinal() {
        return PAYMENT_FINAL_STATUSES.has(
            this.status
        );
    };


billingPaymentSchema.methods.hasFinancialPosting =
    function hasFinancialPosting() {
        return Boolean(
            this.financialTransactionId &&
            this.postedAt
        );
    };


billingPaymentSchema.methods.toPublicJSON =
    function toPublicJSON() {
        const output =
            this.toObject({
                getters:
                    true,
            });

        delete output.__v;

        if (
            output.metadata &&
            typeof output.metadata === "object"
        ) {
            delete output.metadata.internalSecrets;
        }

        return output;
    };


/**
 * =============================================================================
 * Static Helpers
 * =============================================================================
 */

billingPaymentSchema.statics.findByTenantAndIdempotencyKey =
    function findByTenantAndIdempotencyKey(
        tenantId,
        idempotencyKey
    ) {
        return this.findOne({
            tenantId,
            idempotencyKey,
        });
    };


billingPaymentSchema.statics.findByProviderPayment =
    function findByProviderPayment(
        provider,
        providerPaymentId
    ) {
        const normalizedProvider =
            String(provider || "")
                .trim()
                .toLowerCase();

        const normalizedProviderPaymentId =
            normalizeOptionalString(
                providerPaymentId
            );

        if (
            !normalizedProvider ||
            !normalizedProviderPaymentId
        ) {
            return this.findOne({
                provider:
                    normalizedProvider,

                providerPaymentId:
                    null,
            });
        }

        return this.findOne({
            provider:
                normalizedProvider,

            providerPaymentId:
                normalizedProviderPaymentId,
        });
    };


/**
 * =============================================================================
 * Model Registration
 * =============================================================================
 *
 * Reuse the existing registered model during hot reloads, workers, tests, and
 * multi-import application bootstrapping.
 */

const BillingPayment =
    mongoose.models.BillingPayment ||
    mongoose.model(
        "BillingPayment",
        billingPaymentSchema
    );


module.exports =
    BillingPayment;

module.exports.billingPaymentSchema =
    billingPaymentSchema;

module.exports.PAYMENT_STATUS_VALUES =
    PAYMENT_STATUS_VALUES;

module.exports.BILLING_CURRENCY_VALUES =
    BILLING_CURRENCY_VALUES;