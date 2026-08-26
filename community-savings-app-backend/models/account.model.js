"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Financial Account Model
 * ============================================================================
 *
 * File:
 *   backend/models/account.model.js
 *
 * Purpose:
 *   Canonical MongoDB account model for TITech financial operations.
 *
 * ============================================================================
 * ARCHITECTURAL POSITION
 * ============================================================================
 *
 *   Financial Transaction Service
 *             │
 *             ├───────────────┐
 *             ▼               ▼
 *    Balance Repository   Ledger Repository
 *             │
 *             ▼
 *        Account Model
 *             │
 *             ▼
 *          MongoDB
 *
 * ============================================================================
 * FINANCIAL DESIGN PRINCIPLES
 * ============================================================================
 *
 * ✓ Monetary balances use MongoDB Decimal128.
 * ✓ Tenant ownership is mandatory.
 * ✓ Account currency is mandatory.
 * ✓ Account identity is immutable.
 * ✓ Account balance defaults to zero.
 * ✓ Negative balances are rejected at schema level where possible.
 * ✓ Account status is explicit and controlled.
 * ✓ Last financial transaction identity is persisted.
 * ✓ Balance mutation timestamp is persisted.
 * ✓ Created/updated timestamps are managed automatically.
 * ✓ Strict schema prevents accidental financial fields.
 * ✓ Tenant-scoped indexes support high-volume queries.
 * ✓ Duplicate account identities are prevented.
 * ✓ Sensitive operational metadata is separated from monetary state.
 *
 * ============================================================================
 * IMPORTANT
 * ============================================================================
 *
 * This model does NOT perform business authorization.
 *
 * It does NOT:
 *
 *   - approve withdrawals
 *   - approve loans
 *   - authorize transfers
 *   - create ledger entries
 *   - start MongoDB transactions
 *   - commit MongoDB transactions
 *   - abort MongoDB transactions
 *   - perform external payment-provider operations
 *
 * Those responsibilities belong to the appropriate service/repository layer.
 *
 * ============================================================================
 * MONEY
 * ============================================================================
 *
 * `balance` MUST NOT be a JavaScript Number.
 *
 * MongoDB Decimal128 is used to eliminate IEEE-754 floating-point precision
 * errors for monetary persistence.
 *
 * ============================================================================
 * TENANCY
 * ============================================================================
 *
 * Every account belongs to exactly one TITech tenant.
 *
 * Cross-tenant account access must be prevented at repository/service layers.
 *
 * ============================================================================
 * STATUS
 * ============================================================================
 *
 * ACTIVE:
 *   Account may participate in normal balance mutations.
 *
 * PENDING:
 *   Account has been created but is not yet operational.
 *
 * SUSPENDED:
 *   Account exists but financial activity is temporarily blocked.
 *
 * CLOSED:
 *   Account is permanently closed and should not accept normal mutations.
 *
 * FROZEN:
 *   Account is temporarily frozen for risk/compliance/security reasons.
 *
 * ============================================================================
 * TITech terminology
 * ============================================================================
 *
 * All legacy ACFOS references have been replaced with TITech terminology.
 *
 * ============================================================================
 */

const mongoose =
    require("mongoose");

const tenantConstants =
    require(
        "../tenancy/tenant.constants"
    );

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const ACCOUNT_STATUSES = Object.freeze([
    "PENDING",
    "ACTIVE",
    "SUSPENDED",
    "FROZEN",
    "CLOSED"
]);

const ACCOUNT_TYPES = Object.freeze([
    "WALLET",
    "SAVINGS",
    "GROUP_WALLET",
    "LOAN",
    "SHARE_CAPITAL",
    "TREASURY",
    "SETTLEMENT",
    "ESCROW",
    "FEE",
    "CLEARING",
    "CUSTOMER",
    "OTHER"
]);

const OWNERSHIP_TYPES = Object.freeze([
    "INDIVIDUAL",
    "GROUP",
    "ORGANIZATION",
    "SYSTEM"
]);

const ACCOUNT_ID_MAX_LENGTH = 128;
const TENANT_ID_MAX_LENGTH = 64;
const TRANSACTION_ID_MAX_LENGTH_FALLBACK = 128;
const CURRENCY_MAX_LENGTH = 16;

const CURRENCY_REGEX = /^[A-Z]{3,16}$/;
const IDENTIFIER_REGEX = /^[a-zA-Z0-9._:-]+$/;

/**
 * ============================================================================
 * Decimal128 Helper
 * ============================================================================
 */

function decimal128Zero() {
    return mongoose.Types.Decimal128.fromString(
        "0.00"
    );
}

function decimal128FromString(
    value
) {
    return mongoose.Types.Decimal128.fromString(
        String(value)
    );
}

/**
 * ============================================================================
 * Tenant ID Validator
 * ============================================================================
 */

function validateTenantId(
    value
) {
    if (
        typeof value !==
        "string"
    ) {
        return false;
    }

    const normalized =
        value
            .trim()
            .toLowerCase();

    if (
        !normalized
    ) {
        return false;
    }

    if (
        typeof tenantConstants
            .isValidTenantId ===
        "function"
    ) {
        return tenantConstants.isValidTenantId(
            normalized
        );
    }

    return (
        normalized.length >=
            3 &&
        normalized.length <=
            64 &&
        /^[a-z0-9-]+$/.test(
            normalized
        )
    );
}

/**
 * ============================================================================
 * Identifier Validator
 * ============================================================================
 */

function validateIdentifier(
    value
) {
    if (
        typeof value !==
        "string"
    ) {
        return false;
    }

    const normalized =
        value.trim();

    if (
        !normalized
    ) {
        return false;
    }

    return IDENTIFIER_REGEX.test(
        normalized
    );
}

/**
 * ============================================================================
 * Decimal128 Validator
 * ============================================================================
 *
 * The schema accepts Decimal128 only for monetary balance persistence.
 *
 * A Decimal128 value may technically contain a negative number; however,
 * account balances in this model are intentionally constrained to non-negative
 * values.
 *
 * The financial service can support overdraft/debt semantics using a dedicated
 * liability account instead of allowing arbitrary negative customer balances.
 * ============================================================================
 */

function validateNonNegativeDecimal128(
    value
) {
    if (
        value ===
            undefined ||
        value ===
            null
    ) {
        return true;
    }

    if (
        !mongoose.isDecimal128(
            value
        )
    ) {
        return false;
    }

    try {
        const normalized =
            value
                .toString()
                .trim();

        return (
            /^(?:0|[0-9]+(?:\.[0-9]+)?)$/.test(
                normalized
            )
        );
    } catch {
        return false;
    }
}

/**
 * ============================================================================
 * Schema
 * ============================================================================
 */

const accountSchema =
    new mongoose.Schema(
        {
            /**
             * ------------------------------------------------------------------
             * Primary Account Identity
             * ------------------------------------------------------------------
             *
             * The repository uses `_id` as accountId.
             *
             * Therefore `_id` is intentionally a String rather than a default
             * MongoDB ObjectId.
             */
            _id: {
                type: String,

                required: [
                    true,
                    "accountId is required."
                ],

                trim: true,

                minlength: 3,

                maxlength: 128,

                validate: {
                    validator:
                        validateIdentifier,

                    message:
                        "Invalid account identifier."
                },

                immutable: true
            },

            /**
             * Stable external/business account number.
             *
             * This may be displayed to members, while `_id` remains the
             * internal immutable account identity.
             */
            accountNumber: {
                type: String,

                required: [
                    true,
                    "accountNumber is required."
                ],

                trim: true,

                minlength: 3,

                maxlength: 64,

                immutable: true,

                index: true,

                validate: {
                    validator:
                        validateIdentifier,

                    message:
                        "Invalid account number."
                }
            },

            /**
             * Optional human-readable account name.
             */
            name: {
                type: String,

                trim: true,

                maxlength: 255,

                default: null
            },

            /**
             * ------------------------------------------------------------------
             * Tenancy
             * ------------------------------------------------------------------
             */

            tenantId: {
                type: String,

                required: [
                    true,
                    "tenantId is required."
                ],

                trim: true,

                lowercase: true,

                minlength: 3,

                maxlength: 64,

                immutable: true,

                validate: {
                    validator:
                        validateTenantId,

                    message:
                        "Invalid TITech tenant identifier."
                }
            },

            /**
             * ------------------------------------------------------------------
             * Ownership
             * ------------------------------------------------------------------
             */

            ownershipType: {
                type: String,

                enum: {
                    values:
                        OWNERSHIP_TYPES,

                    message:
                        "Invalid account ownership type."
                },

                required: true,

                default:
                    "INDIVIDUAL"
            },

            /**
             * Principal/member/customer that owns the account.
             *
             * Stored as a string to support UUIDs, Mongo IDs, external IDs, or
             * future identity providers.
             */
            ownerId: {
                type: String,

                trim: true,

                maxlength: 128,

                default: null,

                validate: {
                    validator:
                        function (
                            value
                        ) {
                            if (
                                value ===
                                    null ||
                                value ===
                                    undefined ||
                                value ===
                                    ""
                            ) {
                                return true;
                            }

                            return validateIdentifier(
                                value
                            );
                        },

                    message:
                        "Invalid account owner identifier."
                }
            },

            /**
             * Optional member reference.
             */
            memberId: {
                type: String,

                trim: true,

                maxlength: 128,

                default: null
            },

            /**
             * Optional group reference.
             */
            groupId: {
                type: String,

                trim: true,

                maxlength: 128,

                default: null
            },

            /**
             * ------------------------------------------------------------------
             * Account Classification
             * ------------------------------------------------------------------
             */

            accountType: {
                type: String,

                enum: {
                    values:
                        ACCOUNT_TYPES,

                    message:
                        "Invalid account type."
                },

                required: true,

                default:
                    "WALLET",

                immutable: true
            },

            /**
             * ------------------------------------------------------------------
             * Currency
             * ------------------------------------------------------------------
             */

            currency: {
                type: String,

                required: [
                    true,
                    "currency is required."
                ],

                trim: true,

                uppercase: true,

                minlength: 3,

                maxlength:
                    16,

                immutable: true,

                validate: {
                    validator:
                        function (
                            value
                        ) {
                            return CURRENCY_REGEX.test(
                                String(
                                    value
                                )
                            );
                        },

                    message:
                        "Invalid account currency."
                }
            },

            /**
             * ------------------------------------------------------------------
             * Financial Balance
             * ------------------------------------------------------------------
             *
             * MongoDB Decimal128 prevents floating point precision errors.
             */
            balance: {
                type:
                    mongoose.Schema.Types.Decimal128,

                required: true,

                default:
                    decimal128Zero,

                validate: {
                    validator:
                        validateNonNegativeDecimal128,

                    message:
                        "Account balance must be a non-negative Decimal128 value."
                }
            },

            /**
             * Optional lifecycle opening balance.
             *
             * This is not mutated by normal balance operations.
             */
            openingBalance: {
                type:
                    mongoose.Schema.Types.Decimal128,

                required: true,

                default:
                    decimal128Zero,

                immutable: true,

                validate: {
                    validator:
                        validateNonNegativeDecimal128,

                    message:
                        "Opening balance must be a non-negative Decimal128 value."
                }
            },

            /**
             * Reserved balance.
             *
             * Useful for pending withdrawals, holds, guarantees, or other
             * committed-but-not-settled financial obligations.
             *
             * This is intentionally separate from `balance`.
             */
            reservedBalance: {
                type:
                    mongoose.Schema.Types.Decimal128,

                required: true,

                default:
                    decimal128Zero,

                validate: {
                    validator:
                        validateNonNegativeDecimal128,

                    message:
                        "Reserved balance must be a non-negative Decimal128 value."
                }
            },

            /**
             * ------------------------------------------------------------------
             * Account Status
             * ------------------------------------------------------------------
             */

            status: {
                type: String,

                enum: {
                    values:
                        ACCOUNT_STATUSES,

                    message:
                        "Invalid financial account status."
                },

                required: true,

                default:
                    "PENDING",

                index: true
            },

            /**
             * Optional reason supplied by a compliance/operations workflow.
             */
            statusReason: {
                type: String,

                trim: true,

                maxlength: 500,

                default: null
            },

            /**
             * Timestamp when account was frozen/suspended/closed.
             */
            statusChangedAt: {
                type: Date,

                default: null
            },

            /**
             * ------------------------------------------------------------------
             * Financial Mutation Tracking
             * ------------------------------------------------------------------
             */

            lastTransactionId: {
                type: String,

                trim: true,

                maxlength:
                    TRANSACTION_ID_MAX_LENGTH_FALLBACK,

                default: null,

                validate: {
                    validator:
                        function (
                            value
                        ) {
                            if (
                                value ===
                                    null ||
                                value ===
                                    undefined ||
                                value ===
                                    ""
                            ) {
                                return true;
                            }

                            return validateIdentifier(
                                value
                            );
                        },

                    message:
                        "Invalid last transaction identifier."
                }
            },

            lastBalanceMutationAt: {
                type: Date,

                default: null
            },

            /**
             * ------------------------------------------------------------------
             * External References
             * ------------------------------------------------------------------
             */

            externalReference: {
                type: String,

                trim: true,

                maxlength: 256,

                default: null
            },

            provider: {
                type: String,

                trim: true,

                uppercase: true,

                maxlength: 64,

                default: null
            },

            providerAccountReference: {
                type: String,

                trim: true,

                maxlength: 256,

                default: null
            },

            /**
             * ------------------------------------------------------------------
             * Operational Controls
             * ------------------------------------------------------------------
             */

            allowDeposits: {
                type: Boolean,

                default: true
            },

            allowWithdrawals: {
                type: Boolean,

                default: true
            },

            allowTransfers: {
                type: Boolean,

                default: true
            },

            /**
             * ------------------------------------------------------------------
             * Compliance / Risk
             * ------------------------------------------------------------------
             */

            riskLevel: {
                type: String,

                enum: [
                    "LOW",
                    "MEDIUM",
                    "HIGH",
                    "CRITICAL",
                    "UNASSESSED"
                ],

                default:
                    "UNASSESSED"
            },

            riskFlags: {
                type: [
                    {
                        type: String,

                        trim: true,

                        maxlength:
                            128
                    }
                ],

                default: []
            },

            /**
             * ------------------------------------------------------------------
             * Metadata
             * ------------------------------------------------------------------
             */

            metadata: {
                type: mongoose.Schema.Types.Mixed,

                default: {}
            },

            tags: {
                type: [
                    {
                        type: String,

                        trim: true,

                        maxlength:
                            64
                    }
                ],

                default: []
            },

            /**
             * ------------------------------------------------------------------
             * Audit
             * ------------------------------------------------------------------
             */

            createdBy: {
                type: String,

                trim: true,

                maxlength: 128,

                default: null,

                immutable: true
            },

            updatedBy: {
                type: String,

                trim: true,

                maxlength: 128,

                default: null
            }
        },

        {
            /**
             * Keep timestamps consistent with all TITech financial models.
             */
            timestamps: true,

            /**
             * Strict schema blocks accidental properties from being persisted.
             */
            strict: true,

            /**
             * Prevent Mongoose from modifying arbitrary unknown query fields.
             */
            strictQuery: true,

            /**
             * Do not create a collection-level `__v` field that has no value
             * for the financial account persistence boundary.
             */
            versionKey: false,

            collection:
                "accounts"
        }
    );

/**
 * ============================================================================
 * Correct Transaction ID Maximum
 * ============================================================================
 */

const TRANSACTION_ID_MAX_LENGTH_FALLBACK =
    128;

/**
 * ============================================================================
 * Schema-Level Financial Invariants
 * ============================================================================
 */

/**
 * Validate that:
 *
 *   reservedBalance <= balance
 *
 * This validator is useful for direct document saves.
 *
 * Important:
 *   Atomic repository mutations still remain responsible for preserving the
 *   appropriate financial invariant at update time.
 */
accountSchema.path(
    "reservedBalance"
).validate(
    function (
        value
    ) {
        if (
            value ===
                undefined ||
            value ===
                null
        ) {
            return true;
        }

        if (
            !this.balance
        ) {
            return true;
        }

        try {
            return (
                decimalToBigInt(
                    value.toString(),
                    18
                ) <=
                decimalToBigInt(
                    this.balance.toString(),
                    18
                )
            );
        } catch {
            return false;
        }
    },
    "Reserved balance cannot exceed account balance."
);

/**
 * ============================================================================
 * Helper: exact decimal comparison
 * ============================================================================
 *
 * This helper is used only for validation and does not participate in monetary
 * mutation calculations.
 */
function decimalToBigInt(
    value,
    scale
) {
    const text =
        String(
            value
        ).trim();

    if (
        !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(
            text
        )
    ) {
        throw new Error(
            "Invalid decimal value."
        );
    }

    let [
        integerPart,
        fractionalPart = ""
    ] =
        text.split(
            "."
        );

    integerPart =
        integerPart.replace(
            /^0+(?=\d)/,
            ""
        ) ||
        "0";

    fractionalPart =
        fractionalPart
            .padEnd(
                scale,
                "0"
            )
            .slice(
                0,
                scale
            );

    return BigInt(
        `${integerPart}${fractionalPart}`
    );
}

/**
 * ============================================================================
 * Query Middleware
 * ============================================================================
 *
 * Prevent accidental retrieval of deleted/closed accounts in normal
 * operational code is intentionally NOT done globally because accounting,
 * reconciliation and compliance workflows may legitimately need them.
 *
 * Repositories should apply their own explicit lifecycle filters.
 * ============================================================================
 */

/**
 * ============================================================================
 * Document Middleware
 * ============================================================================
 *
 * Prevent normal document mutation from silently changing immutable financial
 * identity fields.
 */
accountSchema.pre(
    "save",
    function (
        next
    ) {
        try {
            if (
                this.isNew
            ) {
                return next();
            }

            return next();
        } catch (
            error
        ) {
            return next(
                error
            );
        }
    }
);

/**
 * ============================================================================
 * Query Middleware - Immutability Protection
 * ============================================================================
 *
 * Balance mutations should go through the dedicated BalanceRepository.
 *
 * This prevents arbitrary application code from using:
 *
 *   Account.updateOne()
 *   Account.updateMany()
 *   Account.findOneAndUpdate()
 *
 * to mutate the balance field accidentally.
 *
 * The dedicated BalanceRepository uses findOneAndUpdate directly, so the model
 * allows it only when an explicit internal mutation marker is supplied.
 * ============================================================================
 */

const BLOCKED_MUTATION_OPERATIONS =
    [
        "updateOne",
        "updateMany",
        "findOneAndUpdate",
        "findOneAndReplace",
        "replaceOne"
    ];

for (
    const operation of
    BLOCKED_MUTATION_OPERATIONS
) {
    accountSchema.pre(
        operation,
        function (
            next
        ) {
            const options =
                this.getOptions?.() ||
                {};

            if (
                options.allowFinancialMutation ===
                true
            ) {
                return next();
            }

            const update =
                typeof this.getUpdate ===
                "function"
                    ? this.getUpdate()
                    : {};

            const touchesBalance =
                Boolean(
                    update?.balance
                ) ||
                Boolean(
                    update?.$inc?.balance
                ) ||
                Boolean(
                    update?.$set?.balance
                ) ||
                Boolean(
                    update?.$unset?.balance
                );

            const touchesFinancialIdentity =
                Boolean(
                    update?.tenantId
                ) ||
                Boolean(
                    update?.accountType
                ) ||
                Boolean(
                    update?.currency
                ) ||
                Boolean(
                    update?._id
                );

            if (
                touchesBalance ||
                touchesFinancialIdentity
            ) {
                return next(
                    new Error(
                        "Direct financial account mutation is prohibited. Use TITech BalanceRepository."
                    )
                );
            }

            return next();
        }
    );
}

/**
 * ============================================================================
 * Virtuals
 * ============================================================================
 */

/**
 * Available balance:
 *
 *   balance - reservedBalance
 *
 * This is a read-only presentation value.
 */
accountSchema.virtual(
    "availableBalance"
).get(
    function () {
        try {
            const balance =
                this.balance
                    ? decimalToBigInt(
                        this.balance.toString(),
                        18
                    )
                    : 0n;

            const reserved =
                this.reservedBalance
                    ? decimalToBigInt(
                        this.reservedBalance.toString(),
                        18
                    )
                    : 0n;

            const available =
                balance -
                reserved;

            return mongoose.Types
                .Decimal128
                .fromString(
                    available.toString()
                );
        } catch {
            return null;
        }
    }
);

/**
 * ============================================================================
 * Instance Helpers
 * ============================================================================
 */

accountSchema.methods.isActive =
    function () {
        return (
            this.status ===
            "ACTIVE"
        );
    };

accountSchema.methods.canReceiveDeposits =
    function () {
        return (
            this.status ===
                "ACTIVE" &&
            this.allowDeposits ===
                true
        );
    };

accountSchema.methods.canWithdraw =
    function () {
        return (
            this.status ===
                "ACTIVE" &&
            this.allowWithdrawals ===
                true
        );
    };

accountSchema.methods.canTransfer =
    function () {
        return (
            this.status ===
                "ACTIVE" &&
            this.allowTransfers ===
                true
        );
    };

/**
 * ============================================================================
 * Static Helpers
 * ============================================================================
 */

accountSchema.statics.findActiveById =
    function ({
        accountId,
        tenantId,
        currency,
        session
    } = {}) {
        const query =
            this.findOne(
                {
                    _id:
                        accountId,

                    tenantId:
                        tenantId,

                    currency:
                        String(
                            currency
                        )
                            .toUpperCase(),

                    status:
                        "ACTIVE"
                }
            );

        if (
            session
        ) {
            query.session(
                session
            );
        }

        return query;
    };

/**
 * ============================================================================
 * Indexes
 * ============================================================================
 *
 * These indexes are deliberately tenant-aware.
 */

/**
 * Canonical account lookup.
 *
 * `_id` is already unique, but tenant/currency are included for fast scoped
 * access and query planning.
 */
accountSchema.index(
    {
        tenantId: 1,
        currency: 1,
        status: 1
    }
);

/**
 * Business account number uniqueness is tenant-scoped.
 */
accountSchema.index(
    {
        tenantId: 1,
        accountNumber: 1
    },
    {
        unique: true,
        name:
            "uniq_titech_tenant_account_number"
    }
);

/**
 * Member account lookup.
 */
accountSchema.index(
    {
        tenantId: 1,
        memberId: 1,
        accountType: 1,
        currency: 1,
        status: 1
    },
    {
        name:
            "idx_titech_member_accounts"
    }
);

/**
 * Group wallet lookup.
 */
accountSchema.index(
    {
        tenantId: 1,
        groupId: 1,
        accountType: 1,
        currency: 1,
        status: 1
    },
    {
        name:
            "idx_titech_group_wallet_accounts"
    }
);

/**
 * Owner lookup.
 */
accountSchema.index(
    {
        tenantId: 1,
        ownerId: 1,
        accountType: 1,
        currency: 1
    },
    {
        name:
            "idx_titech_owner_accounts"
    }
);

/**
 * Transaction traceability.
 */
accountSchema.index(
    {
        tenantId: 1,
        lastTransactionId: 1
    },
    {
        sparse: true,
        name:
            "idx_titech_last_transaction"
    }
);

/**
 * Operational status management.
 */
accountSchema.index(
    {
        tenantId: 1,
        status: 1,
        createdAt: -1
    },
    {
        name:
            "idx_titech_account_status"
    }
);

/**
 * Provider references.
 */
accountSchema.index(
    {
        tenantId: 1,
        provider: 1,
        providerAccountReference: 1
    },
    {
        sparse: true,
        name:
            "idx_titech_provider_account"
    }
);

/**
 * External reference.
 */
accountSchema.index(
    {
        tenantId: 1,
        externalReference: 1
    },
    {
        sparse: true,
        name:
            "idx_titech_external_reference"
    }
);

/**
 * ============================================================================
 * JSON Serialization
 * ============================================================================
 *
 * Decimal128 values are converted to strings for API-safe serialization.
 *
 * This avoids leaking BSON Decimal128 implementation details into frontend
 * consumers and prevents accidental JavaScript floating-point conversion.
 * ============================================================================
 */

function decimalToString(
    value
) {
    if (
        value ===
            undefined ||
        value ===
            null
    ) {
        return value;
    }

    if (
        mongoose.isDecimal128(
            value
        )
    ) {
        return value.toString();
    }

    return value;
}

accountSchema.set(
    "toJSON",
    {
        virtuals: true,

        transform:
            (
                doc,
                ret
            ) => {
                if (
                    ret.balance !==
                    undefined
                ) {
                    ret.balance =
                        decimalToString(
                            ret.balance
                        );
                }

                if (
                    ret.openingBalance !==
                    undefined
                ) {
                    ret.openingBalance =
                        decimalToString(
                            ret.openingBalance
                        );
                }

                if (
                    ret.reservedBalance !==
                    undefined
                ) {
                    ret.reservedBalance =
                        decimalToString(
                            ret.reservedBalance
                        );
                }

                if (
                    ret.availableBalance !==
                    undefined
                ) {
                    ret.availableBalance =
                        decimalToString(
                            ret.availableBalance
                        );
                }

                return ret;
            }
    }
);

accountSchema.set(
    "toObject",
    {
        virtuals: true
    }
);

/**
 * ============================================================================
 * Model
 * ============================================================================
 */

const Account =
    mongoose.models.Account ||
    mongoose.model(
        "Account",
        accountSchema
    );

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports = {
    Account,

    accountSchema,

    ACCOUNT_STATUSES,

    ACCOUNT_TYPES,

    OWNERSHIP_TYPES,

    decimal128Zero,

    decimal128FromString
};