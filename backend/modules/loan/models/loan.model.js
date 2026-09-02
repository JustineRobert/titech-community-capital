"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * African Community Finance Operating System (ACFOS)
 * =============================================================================
 *
 * File:
 *   backend/models/loan.model.js
 *
 * Purpose:
 *   Enterprise-grade MongoDB/Mongoose loan aggregate for ACFOS.
 *
 * Financial invariants:
 *
 *   ✓ All monetary fields use Decimal128.
 *   ✓ principalAmount must be strictly positive.
 *   ✓ disbursedAmount defaults to Decimal128("0").
 *   ✓ outstandingAmount defaults to Decimal128("0").
 *   ✓ repaidAmount defaults to Decimal128("0").
 *   ✓ Monetary values cannot be negative.
 *   ✓ Tenant ownership is immutable.
 *   ✓ Currency is immutable and normalized.
 *   ✓ Loan identity fields are immutable.
 *   ✓ Financial transaction references are persisted.
 *   ✓ Repository mutations remain transaction/session aware.
 *
 * IMPORTANT:
 *
 * This model does NOT:
 *
 *   ✗ start transactions
 *   ✗ commit transactions
 *   ✗ abort transactions
 *   ✗ perform authorization
 *   ✗ perform idempotency
 *   ✗ mutate balances
 *   ✗ create ledger entries
 *
 * Those responsibilities belong to the service/repository layers.
 * =============================================================================
 */

const mongoose =
    require("mongoose");

// =============================================================================
// Constants
// =============================================================================

const LOAN_STATUSES = Object.freeze([

    "PENDING",

    "APPROVED",

    "DISBURSED",

    "ACTIVE",

    "PARTIALLY_REPAID",

    "REPAID",

    "DEFAULTED",

    "WRITTEN_OFF",

    "CANCELLED"

]);

const LOAN_INTEREST_TYPES = Object.freeze([

    "NONE",

    "FLAT",

    "REDUCING_BALANCE",

    "COMPOUND"

]);

const LOAN_TERM_UNITS = Object.freeze([

    "DAYS",

    "WEEKS",

    "MONTHS",

    "YEARS"

]);

const CURRENCIES_MAX_LENGTH =
    16;

const IDENTIFIER_MAX_LENGTH =
    128;

const TRANSACTION_ID_MAX_LENGTH =
    128;

const LOAN_NUMBER_MAX_LENGTH =
    64;

const PURPOSE_MAX_LENGTH =
    1000;

// =============================================================================
// Decimal Helpers
// =============================================================================

function decimalZero() {

    return mongoose.Types.Decimal128
        .fromString("0");
}

function decimalFromString(
    value
) {

    return mongoose.Types.Decimal128
        .fromString(
            String(value)
        );
}

// =============================================================================
// Decimal Validation
// =============================================================================
//
// IMPORTANT:
//
// Never convert Decimal128 to Number.
//
// Validation operates directly against the Decimal128 string representation.
//
// =============================================================================

function parseDecimal128(
    value
) {

    if (
        value === undefined ||
        value === null
    ) {

        return null;
    }

    try {

        return mongoose.Types.Decimal128
            .fromString(
                value.toString()
            );

    } catch (
        error
    ) {

        return null;
    }
}

function isValidDecimal128(
    value
) {

    return Boolean(
        parseDecimal128(
            value
        )
    );
}

function isNonNegativeDecimal(
    value
) {

    const decimal =
        parseDecimal128(
            value
        );

    if (
        !decimal
    ) {

        return false;
    }

    return !decimal
        .toString()
        .startsWith("-");
}

function isPositiveDecimal(
    value
) {

    const decimal =
        parseDecimal128(
            value
        );

    if (
        !decimal
    ) {

        return false;
    }

    const normalized =
        decimal
            .toString()
            .replace(
                /^0+$/,
                "0"
            );

    if (
        normalized === "0"
    ) {

        return false;
    }

    /*
     * Reject values numerically equal to zero such as:
     *
     *   0.0
     *   0.00
     *   000.000
     */

    return !/^0(?:\.0+)?$/.test(
        normalized
    );
}

// =============================================================================
// Decimal JSON Serialization
// =============================================================================

function transformDecimal128(
    value
) {

    if (
        value === null ||
        value === undefined
    ) {

        return value;
    }

    if (
        value._bsontype ===
        "Decimal128"
    ) {

        return value.toString();
    }

    return value;
}

// =============================================================================
// Decimal Field Names
// =============================================================================

const DECIMAL_FIELDS = Object.freeze([

    "principalAmount",

    "disbursedAmount",

    "outstandingAmount",

    "repaidAmount",

    "interestRate"

]);

// =============================================================================
// Schema
// =============================================================================

const loanSchema =
    new mongoose.Schema(

        {

            // =================================================================
            // Tenant
            // =================================================================

            tenantId: {

                type:
                    String,

                required:
                    [
                        true,
                        "Tenant ID is required."
                    ],

                trim:
                    true,

                maxlength:
                    IDENTIFIER_MAX_LENGTH,

                immutable:
                    true,

                index:
                    true

            },

            // =================================================================
            // Borrower
            // =================================================================

            borrowerId: {

                type:
                    mongoose.Schema.Types.ObjectId,

                required:
                    [
                        true,
                        "Borrower ID is required."
                    ],

                immutable:
                    true,

                index:
                    true

            },

            // =================================================================
            // Loan Product
            // =================================================================

            productId: {

                type:
                    mongoose.Schema.Types.ObjectId,

                required:
                    false,

                immutable:
                    true,

                index:
                    true

            },

            // =================================================================
            // Currency
            // =================================================================

            currency: {

                type:
                    String,

                required:
                    [
                        true,
                        "Loan currency is required."
                    ],

                trim:
                    true,

                uppercase:
                    true,

                maxlength:
                    CURRENCIES_MAX_LENGTH,

                match:
                    [
                        /^[A-Z]{3,16}$/,

                        "Currency must contain 3-16 uppercase alphabetic characters."

                    ],

                immutable:
                    true,

                index:
                    true

            },

            // =================================================================
            // Lifecycle
            // =================================================================

            status: {

                type:
                    String,

                enum:
                    {

                        values:
                            LOAN_STATUSES,

                        message:
                            "Invalid loan status."

                    },

                required:
                    [
                        true,
                        "Loan status is required."
                    ],

                default:
                    "PENDING",

                index:
                    true

            },

            // =================================================================
            // Principal Amount
            // =================================================================
            //
            // Principal is the contractual loan amount.
            //
            // It MUST be positive.
            //
            // =================================================================

            principalAmount: {

                type:
                    mongoose.Schema.Types.Decimal128,

                required:
                    [
                        true,
                        "Principal amount is required."
                    ],

                validate: [

                    {

                        validator:
                            isValidDecimal128,

                        message:
                            "Principal amount must be a valid Decimal128 value."

                    },

                    {

                        validator:
                            isPositiveDecimal,

                        message:
                            "Principal amount must be greater than zero."

                    }

                ]

            },

            // =================================================================
            // Disbursed Amount
            // =================================================================
            //
            // MUST always exist as Decimal128.
            //
            // This is important because the repository performs:
            //
            //     $inc: {
            //         disbursedAmount: amount
            //     }
            //
            // =================================================================

            disbursedAmount: {

                type:
                    mongoose.Schema.Types.Decimal128,

                required:
                    true,

                default:
                    decimalZero,

                validate: {

                    validator:
                        isNonNegativeDecimal,

                    message:
                        "Disbursed amount cannot be negative."

                }

            },

            // =================================================================
            // Outstanding Amount
            // =================================================================
            //
            // Represents outstanding principal.
            //
            // Repository repayment logic atomically performs:
            //
            //     outstandingAmount >= repayment
            //
            // and:
            //
            //     outstandingAmount -= repayment
            //
            // =================================================================

            outstandingAmount: {

                type:
                    mongoose.Schema.Types.Decimal128,

                required:
                    true,

                default:
                    decimalZero,

                validate: {

                    validator:
                        isNonNegativeDecimal,

                    message:
                        "Outstanding amount cannot be negative."

                },

                index:
                    true

            },

            // =================================================================
            // Repaid Amount
            // =================================================================

            repaidAmount: {

                type:
                    mongoose.Schema.Types.Decimal128,

                required:
                    true,

                default:
                    decimalZero,

                validate: {

                    validator:
                        isNonNegativeDecimal,

                    message:
                        "Repaid amount cannot be negative."

                }

            },

            // =================================================================
            // Loan Term
            // =================================================================

            term: {

                value: {

                    type:
                        Number,

                    required:
                        false,

                    min:
                        1

                },

                unit: {

                    type:
                        String,

                    enum:
                        LOAN_TERM_UNITS,

                    required:
                        false

                }

            },

            // =================================================================
            // Interest
            // =================================================================

            interestRate: {

                type:
                    mongoose.Schema.Types.Decimal128,

                required:
                    false,

                validate: {

                    validator:
                        isNonNegativeDecimal,

                    message:
                        "Interest rate cannot be negative."

                }

            },

            interestType: {

                type:
                    String,

                enum:
                    LOAN_INTEREST_TYPES,

                default:
                    "NONE"

            },

            // =================================================================
            // Dates
            // =================================================================

            applicationDate: {

                type:
                    Date,

                default:
                    Date.now,

                immutable:
                    true

            },

            approvedAt: {

                type:
                    Date

            },

            disbursedAt: {

                type:
                    Date

            },

            maturityDate: {

                type:
                    Date

            },

            lastRepaymentAt: {

                type:
                    Date

            },

            repaidAt: {

                type:
                    Date

            },

            // =================================================================
            // Financial Transaction Identity
            // =================================================================

            lastTransactionId: {

                type:
                    String,

                trim:
                    true,

                maxlength:
                    TRANSACTION_ID_MAX_LENGTH,

                index:
                    true

            },

            lastFinancialMutationAt: {

                type:
                    Date,

                index:
                    true

            },

            // =================================================================
            // Human-readable Loan Number
            // =================================================================

            loanNumber: {

                type:
                    String,

                trim:
                    true,

                uppercase:
                    true,

                maxlength:
                    LOAN_NUMBER_MAX_LENGTH,

                immutable:
                    true,

                index:
                    true

            },

            // =================================================================
            // Purpose
            // =================================================================

            purpose: {

                type:
                    String,

                trim:
                    true,

                maxlength:
                    PURPOSE_MAX_LENGTH

            },

            // =================================================================
            // Metadata
            // =================================================================

            metadata: {

                type:
                    mongoose.Schema.Types.Mixed,

                default:
                    () => ({})

            },

            // =================================================================
            // Financial Version
            // =================================================================
            //
            // Incremented by financial repository mutations.
            //
            // This provides an additional mutation sequence for audit and
            // reconciliation purposes.
            //
            // =================================================================

            financialVersion: {

                type:
                    Number,

                required:
                    true,

                default:
                    0,

                min:
                    0

            },

            // =================================================================
            // Audit Identity
            // =================================================================

            createdBy: {

                type:
                    mongoose.Schema.Types.ObjectId,

                required:
                    false,

                immutable:
                    true

            },

            approvedBy: {

                type:
                    mongoose.Schema.Types.ObjectId,

                required:
                    false

            },

            lastModifiedBy: {

                type:
                    mongoose.Schema.Types.ObjectId,

                required:
                    false

            }

        },

        {

            collection:
                "loans",

            timestamps:
                true,

            strict:
                true,

            strictQuery:
                true,

            minimize:
                false,

            optimisticConcurrency:
                false,

            versionKey:
                "__v"

        }
    );

// =============================================================================
// Schema Indexes
// =============================================================================

loanSchema.index(

    {
        tenantId: 1,
        _id: 1
    },

    {
        name:
            "idx_loans_tenant_id"
    }

);

loanSchema.index(

    {
        tenantId: 1,
        borrowerId: 1,
        status: 1
    },

    {
        name:
            "idx_loans_tenant_borrower_status"
    }

);

loanSchema.index(

    {
        tenantId: 1,
        currency: 1,
        status: 1
    },

    {
        name:
            "idx_loans_tenant_currency_status"
    }

);

loanSchema.index(

    {
        tenantId: 1,
        loanNumber: 1
    },

    {
        unique:
            true,

        sparse:
            true,

        name:
            "uniq_loans_tenant_loan_number"
    }

);

loanSchema.index(

    {
        tenantId: 1,
        lastTransactionId: 1
    },

    {
        sparse:
            true,

        name:
            "idx_loans_tenant_transaction"
    }

);

loanSchema.index(

    {
        tenantId: 1,
        status: 1,
        maturityDate: 1
    },

    {
        name:
            "idx_loans_tenant_status_maturity"
    }

);

loanSchema.index(

    {
        tenantId: 1,
        currency: 1,
        outstandingAmount: 1
    },

    {
        name:
            "idx_loans_tenant_currency_outstanding"
    }

);

// =============================================================================
// Document Validation
// =============================================================================
//
// These checks protect normal document creation/save operations.
//
// Critical financial mutation constraints must ALSO be encoded into atomic
// repository query predicates.
//
// =============================================================================

loanSchema.pre(

    "validate",

    function validateLoan(
        next
    ) {

        try {

            // -----------------------------------------------------------------
            // Monetary field existence
            // -----------------------------------------------------------------

            if (
                !this.principalAmount
            ) {

                this.invalidate(
                    "principalAmount",
                    "Principal amount is required."
                );

            }

            if (
                !this.disbursedAmount
            ) {

                this.invalidate(
                    "disbursedAmount",
                    "Disbursed amount must be initialized."
                );

            }

            if (
                !this.outstandingAmount
            ) {

                this.invalidate(
                    "outstandingAmount",
                    "Outstanding amount must be initialized."
                );

            }

            if (
                !this.repaidAmount
            ) {

                this.invalidate(
                    "repaidAmount",
                    "Repaid amount must be initialized."
                );

            }

            // -----------------------------------------------------------------
            // Date consistency
            // -----------------------------------------------------------------

            if (
                this.repaidAt &&
                this.disbursedAt &&
                this.repaidAt <
                    this.disbursedAt
            ) {

                this.invalidate(

                    "repaidAt",

                    "Loan repayment cannot occur before disbursement."

                );

            }

            if (
                this.maturityDate &&
                this.disbursedAt &&
                this.maturityDate <
                    this.disbursedAt
            ) {

                this.invalidate(

                    "maturityDate",

                    "Loan maturity date cannot precede disbursement date."

                );

            }

            // -----------------------------------------------------------------
            // Disbursement state
            // -----------------------------------------------------------------

            const disbursedStatuses = [

                "DISBURSED",

                "ACTIVE",

                "PARTIALLY_REPAID",

                "REPAID"

            ];

            if (
                disbursedStatuses.includes(
                    this.status
                ) &&
                !this.disbursedAt
            ) {

                this.invalidate(

                    "disbursedAt",

                    "Disbursed loans must have a disbursement date."

                );

            }

            // -----------------------------------------------------------------
            // Repaid state
            // -----------------------------------------------------------------

            if (
                this.status ===
                "REPAID"
            ) {

                if (
                    !this.repaidAt
                ) {

                    this.invalidate(

                        "repaidAt",

                        "Repaid loans must have a repayment completion date."

                    );

                }

            }

            next();

        } catch (
            error
        ) {

            next(error);

        }

    }

);

// =============================================================================
// Immutable Financial Identity Protection
// =============================================================================
//
// Generic findOneAndUpdate() operations must not be able to change the
// contractual identity of a loan.
//
// Financial repositories may update operational monetary fields and lifecycle
// fields, but not these identity fields.
//
// =============================================================================

loanSchema.pre(

    "findOneAndUpdate",

    function protectFinancialIdentity(
        next
    ) {

        const update =
            this.getUpdate() || {};

        const blockedFields = [

            "tenantId",

            "borrowerId",

            "currency",

            "loanNumber",

            "productId",

            "principalAmount"

        ];

        const operators = [

            "$set",

            "$setOnInsert",

            "$inc",

            "$unset",

            "$push",

            "$pull",

            "$addToSet"

        ];

        for (
            const operator
            of operators
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
                const field
                of blockedFields
            ) {

                if (
                    Object.prototype.hasOwnProperty.call(
                        payload,
                        field
                    )
                ) {

                    return next(

                        new Error(

                            `Immutable loan field cannot be modified: ${field}`

                        )

                    );

                }

            }

        }

        next();

    }

);

// =============================================================================
// JSON Serialization
// =============================================================================

function serializeDecimalFields(
    ret
) {

    for (
        const field
        of DECIMAL_FIELDS
    ) {

        if (
            ret[field] !==
                undefined &&
            ret[field] !==
                null
        ) {

            ret[field] =
                transformDecimal128(
                    ret[field]
                );

        }

    }

    return ret;
}

loanSchema.set(

    "toJSON",

    {

        transform:
            function transformLoan(
                doc,
                ret
            ) {

                return serializeDecimalFields(
                    ret
                );

            }

    }

);

loanSchema.set(

    "toObject",

    {

        transform:
            function transformLoanObject(
                doc,
                ret
            ) {

                return serializeDecimalFields(
                    ret
                );

            }

    }

);

// =============================================================================
// Model
// =============================================================================

const Loan =
    mongoose.models.Loan ||
    mongoose.model(
        "Loan",
        loanSchema
    );

// =============================================================================
// Exports
// =============================================================================

module.exports = {

    Loan,

    loanSchema,

    LOAN_STATUSES,

    LOAN_INTEREST_TYPES,

    LOAN_TERM_UNITS,

    decimalZero,

    decimalFromString,

    isNonNegativeDecimal,

    isPositiveDecimal

};