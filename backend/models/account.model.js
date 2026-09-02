"use strict";

/**

* ============================================================================
* TITech Community Capital LTD
* Enterprise Financial Account Model
* ============================================================================
*
* File:
* backend/models/account.model.js
*
* Purpose:
* Canonical MongoDB account model for all TITech financial operations.
*
* ============================================================================
* ARCHITECTURAL POSITION
* ============================================================================
*
* Financial Transaction Service
* ```
           │
  ```
* ```
           ├──────────────────────┐
  ```
* ```
           ▼                      ▼
  ```
* ```
    Balance Repository      Ledger Repository
  ```
* ```
           │                      │
  ```
* ```
           └──────────┬───────────┘
  ```
* ```
                      ▼
  ```
* ```
                Account Model
  ```
* ```
                      │
  ```
* ```
                      ▼
  ```
* ```
                   MongoDB
  ```
*
* ============================================================================
* FINANCIAL DESIGN PRINCIPLES
* ============================================================================
*
* ✓ Monetary values use MongoDB Decimal128.
* ✓ JavaScript floating-point numbers are never used for persisted money.
* ✓ Tenant ownership is mandatory and immutable.
* ✓ Account identity is immutable.
* ✓ Account currency is mandatory and immutable.
* ✓ Account type is immutable.
* ✓ Account balance defaults to zero.
* ✓ Opening balance defaults to zero and is immutable.
* ✓ Reserved balance defaults to zero.
* ✓ Monetary balances must be finite and non-negative.
* ✓ reservedBalance must not exceed balance for document-level validation.
* ✓ Account status is explicit and controlled.
* ✓ Financial mutation metadata is persisted.
* ✓ Strict schema prevents accidental financial fields.
* ✓ Tenant-aware indexes support high-volume queries.
* ✓ Tenant-scoped account numbers are unique.
* ✓ External provider references are indexed.
* ✓ Decimal128 values serialize as strings.
* ✓ Financial balance mutation is delegated to BalanceRepository.
*
* ============================================================================
* IMPORTANT ARCHITECTURAL BOUNDARY
* ============================================================================
*
* This model is a persistence boundary.
*
* It does NOT:
*
* * approve withdrawals
* * approve loans
* * authorize transfers
* * create ledger entries
* * start MongoDB transactions
* * commit MongoDB transactions
* * abort MongoDB transactions
* * execute payment-provider operations
* * perform business authorization
* * calculate transaction fees
* * calculate interest
* * perform KYC/AML decisions
*
* Those responsibilities belong to the appropriate service/repository,
* ledger, compliance, or payment-provider layers.
*
* ============================================================================
* MONEY
* ============================================================================
*
* `balance`, `openingBalance`, and `reservedBalance` MUST NOT be JavaScript
* Numbers.
*
* MongoDB Decimal128 is used for exact monetary persistence.
*
* API serialization converts Decimal128 values to strings so that clients
* never accidentally convert financial values into IEEE-754 floating point.
*
* ============================================================================
* TENANCY
* ============================================================================
*
* Every account belongs to exactly one TITech tenant.
*
* Cross-tenant access MUST be enforced by repositories/services.
*
* The model provides tenant-aware indexes and query helpers but does not
* replace authorization middleware.
*
* ============================================================================
* STATUS
* ============================================================================
*
* PENDING:
* Account has been created but is not yet operational.
*
* ACTIVE:
* Account may participate in permitted financial operations.
*
* SUSPENDED:
* Financial activity is temporarily blocked.
*
* FROZEN:
* Account is frozen for risk, compliance, fraud, or security reasons.
*
* CLOSED:
* Account is permanently closed.
*
* ============================================================================
* TITech TERMINOLOGY
* ============================================================================
*
* All legacy ACFOS terminology has been replaced with TITech terminology.
*
* ============================================================================
  */

const mongoose = require("mongoose");

const tenantConstants = require("../tenancy/tenant.constants");

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

const RISK_LEVELS = Object.freeze([
"LOW",
"MEDIUM",
"HIGH",
"CRITICAL",
"UNASSESSED"
]);

const ACCOUNT_ID_MAX_LENGTH = 128;
const TENANT_ID_MAX_LENGTH = 64;
const ACCOUNT_NUMBER_MAX_LENGTH = 64;
const OWNER_ID_MAX_LENGTH = 128;
const TRANSACTION_ID_MAX_LENGTH = 128;
const CURRENCY_MAX_LENGTH = 16;

const CURRENCY_REGEX = /^[A-Z]{3,16}$/;

/**

* Identifiers intentionally permit:
*
* letters
* numbers
* dot
* underscore
* colon
* hyphen
  */
  const IDENTIFIER_REGEX = /^[a-zA-Z0-9._:-]+$/;

/**

* ============================================================================
* Decimal128 Helpers
* ============================================================================
  */

/**

* Return an exact Decimal128 zero.
  */
  function decimal128Zero() {
  return mongoose.Types.Decimal128.fromString("0");
  }

/**

* Convert a value to Decimal128.
*
* This helper is intentionally strict. Callers should normally provide a
* string rather than a JavaScript Number.
  */
  function decimal128FromString(value) {
  if (value === undefined || value === null) {
  throw new TypeError(
  "Decimal128 value is required."
  );
  }

  const normalized = String(value).trim();

  if (!normalized) {
  throw new TypeError(
  "Decimal128 value cannot be empty."
  );
  }

  return mongoose.Types.Decimal128.fromString(
  normalized
  );
  }

/**

* ============================================================================
* Tenant ID Validator
* ============================================================================
  */

function validateTenantId(value) {
if (typeof value !== "string") {
return false;
}


const normalized = value
    .trim()
    .toLowerCase();

if (!normalized) {
    return false;
}

if (
    typeof tenantConstants.isValidTenantId ===
    "function"
) {
    return tenantConstants.isValidTenantId(
        normalized
    );
}

return (
    normalized.length >= 3 &&
    normalized.length <= TENANT_ID_MAX_LENGTH &&
    /^[a-z0-9-]+$/.test(normalized)
);


}

/**

* ============================================================================
* Identifier Validator
* ============================================================================
  */

function validateIdentifier(value) {
if (typeof value !== "string") {
return false;
}


const normalized = value.trim();

if (!normalized) {
    return false;
}

return (
    normalized.length <= ACCOUNT_ID_MAX_LENGTH &&
    IDENTIFIER_REGEX.test(normalized)
);


}

/**

* ============================================================================
* Decimal Parsing / Comparison
* ============================================================================
*
* Decimal128.toString() may return either ordinary decimal notation or
* scientific notation.
*
* Example:
*
* "100.25"
* "1E+3"
* "1.25E-4"
*
* JavaScript Number arithmetic is deliberately avoided.
  */

/**

* Parse a finite non-negative decimal string into:
*
* {
* ```
    coefficient: BigInt,
  ```
* ```
    scale: number
  ```
* }
*
* representing:
*
* coefficient / 10^scale
*
* This is used ONLY for exact validation/comparison.
  */
  function parseDecimalToInteger(value) {
  const text = String(value)
  .trim()
  .toLowerCase();

  if (!text) {
  throw new Error(
  "Invalid decimal value."
  );
  }

  /**

  * Decimal128 special values are not valid monetary values.
    */
    if (
    text === "nan" ||
    text === "+nan" ||
    text === "-nan" ||
    text === "infinity" ||
    text === "+infinity" ||
    text === "-infinity" ||
    text === "inf" ||
    text === "+inf" ||
    text === "-inf"
    ) {
    throw new Error(
    "Non-finite decimal values are not valid monetary values."
    );
    }

  const match = text.match(
  /^([+-]?)(\d+(?:.\d+)?|.\d+)(?:e([+-]?\d+))?$/
  );

  if (!match) {
  throw new Error(
  "Invalid decimal value."
  );
  }

  const sign = match[1];
  const mantissa = match[2];
  const exponent = Number(
  match[3] || "0"
  );

  if (sign === "-") {
  throw new Error(
  "Negative decimal values are not permitted."
  );
  }

  const parts = mantissa.split(".");

  const integerPart = parts[0] || "0";
  const fractionalPart = parts[1] || "";

  const digits = (
  integerPart +
  fractionalPart
  ).replace(/^0+(?=\d)/, "") || "0";

  let scale =
  fractionalPart.length -
  exponent;

  let coefficient = BigInt(digits);

  if (scale < 0) {
  coefficient *=
  10n ** BigInt(-scale);
  scale = 0;
  }

  return {
  coefficient,
  scale
  };
  }

/**

* Compare two non-negative decimal strings exactly.
*
* Returns:
*
* -1 => left < right
* 0 => left === right
* 1 => left > right
  */
  function compareNonNegativeDecimals(
  left,
  right
  ) {
  const a =
  parseDecimalToInteger(left);


const b =



    parseDecimalToInteger(right);

const scale = Math.max(
    a.scale,
    b.scale
);

const leftCoefficient =
    a.coefficient *
    10n ** BigInt(
        scale - a.scale
    );

const rightCoefficient =
    b.coefficient *
    10n ** BigInt(
        scale - b.scale
    );

if (
    leftCoefficient <
    rightCoefficient
) {
    return -1;
}

if (
    leftCoefficient >
    rightCoefficient
) {
    return 1;
}

return 0;


}

/**

* ============================================================================
* Decimal128 Validator
* ============================================================================
  */

function validateNonNegativeDecimal128(
value
) {
if (
value === undefined ||
value === null
) {
return true;
}


if (
    !mongoose.isDecimal128(value)
) {
    return false;
}

try {
    parseDecimalToInteger(
        value.toString()
    );

    return true;
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
* `_id` is the canonical internal account identifier.
*
* It is intentionally a String rather than ObjectId because TITech
* supports stable business/application identifiers.
*/


        _id: {
            type: String,

            required: [
                true,
                "accountId is required."
            ],

            trim: true,

            minlength: 3,

            maxlength:
                ACCOUNT_ID_MAX_LENGTH,

            immutable: true,

            validate: {
                validator:
                    validateIdentifier,

                message:
                    "Invalid account identifier."
            }
        },

        /**
         * ------------------------------------------------------------------
         * External / Business Account Number
         * ------------------------------------------------------------------
         *
         * This is the stable account number that may be displayed to
         * members/customers.
         *
         * `_id` remains the internal immutable account identity.
         */

        accountNumber: {
            type: String,

            required: [
                true,
                "accountNumber is required."
            ],

            trim: true,

            minlength: 3,

            maxlength:
                ACCOUNT_NUMBER_MAX_LENGTH,

            immutable: true,

            validate: {
                validator:
                    validateIdentifier,

                message:
                    "Invalid account number."
            }
        },

        /**
         * Human-readable account name.
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

            maxlength:
                TENANT_ID_MAX_LENGTH,

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

            default: "INDIVIDUAL"
        },

        /**
         * Principal/member/customer owning the account.
         *
         * Stored as String to support:
         *
         *   - UUIDs
         *   - Mongo IDs
         *   - external identity IDs
         *   - future identity providers
         */

        ownerId: {
            type: String,

            trim: true,

            maxlength:
                OWNER_ID_MAX_LENGTH,

            default: null,

            validate: {
                validator:
                    function (value) {
                        if (
                            value === null ||
                            value === undefined ||
                            value === ""
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

            maxlength:
                OWNER_ID_MAX_LENGTH,

            default: null,

            validate: {
                validator:
                    function (value) {
                        if (
                            value === null ||
                            value === undefined ||
                            value === ""
                        ) {
                            return true;
                        }

                        return validateIdentifier(
                            value
                        );
                    },

                message:
                    "Invalid member identifier."
            }
        },

        /**
         * Optional group reference.
         */

        groupId: {
            type: String,

            trim: true,

            maxlength:
                OWNER_ID_MAX_LENGTH,

            default: null,

            validate: {
                validator:
                    function (value) {
                        if (
                            value === null ||
                            value === undefined ||
                            value === ""
                        ) {
                            return true;
                        }

                        return validateIdentifier(
                            value
                        );
                    },

                message:
                    "Invalid group identifier."
            }
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

            default: "WALLET",

            immutable: true
        },

        /**
         * ------------------------------------------------------------------
         * Currency
         * ------------------------------------------------------------------
         *
         * ISO-style alphabetic currency code.
         *
         * The system intentionally does not hard-code a three-letter-only
         * requirement because future TITech settlement/ledger integrations
         * may use extended currency identifiers.
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
                CURRENCY_MAX_LENGTH,

            immutable: true,

            validate: {
                validator:
                    function (value) {
                        return CURRENCY_REGEX.test(
                            String(value)
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
                    "Account balance must be a finite, non-negative Decimal128 value."
            }
        },

        /**
         * Immutable lifecycle opening balance.
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
                    "Opening balance must be a finite, non-negative Decimal128 value."
            }
        },

        /**
         * Reserved funds.
         *
         * Examples:
         *
         *   - pending withdrawals
         *   - payment holds
         *   - guarantees
         *   - committed obligations
         *
         * Available balance:
         *
         *   balance - reservedBalance
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
                    "Reserved balance must be a finite, non-negative Decimal128 value."
            }
        },

        /**
         * ------------------------------------------------------------------
         * Financial Mutation Revision
         * ------------------------------------------------------------------
         *
         * Incremented by BalanceRepository during successful monetary
         * mutations.
         *
         * This provides an inexpensive monotonic mutation sequence that
         * can be used for diagnostics, reconciliation, and optimistic
         * concurrency checks.
         */

        balanceRevision: {
            type: Number,

            required: true,

            default: 0,

            min: [
                0,
                "Balance revision cannot be negative."
            ],

            validate: {
                validator:
                    Number.isSafeInteger,

                message:
                    "Balance revision must be a safe integer."
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

            default: "PENDING",

            index: true
        },

        /**
         * Operational/compliance reason for status changes.
         */

        statusReason: {
            type: String,

            trim: true,

            maxlength: 500,

            default: null
        },

        /**
         * Timestamp of the most recent lifecycle status change.
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
                TRANSACTION_ID_MAX_LENGTH,

            default: null,

            validate: {
                validator:
                    function (value) {
                        if (
                            value === null ||
                            value === undefined ||
                            value === ""
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

            enum: {
                values:
                    RISK_LEVELS,

                message:
                    "Invalid account risk level."
            },

            default: "UNASSESSED"
        },

        riskFlags: {
            type: [
                {
                    type: String,

                    trim: true,

                    maxlength: 128
                }
            ],

            default: []
        },

        /**
         * ------------------------------------------------------------------
         * Metadata
         * ------------------------------------------------------------------
         *
         * Metadata is intentionally non-financial.
         *
         * Monetary/accounting state MUST NOT be stored here.
         */

        metadata: {
            type:
                mongoose.Schema.Types.Mixed,

            default: {}
        },

        tags: {
            type: [
                {
                    type: String,

                    trim: true,

                    maxlength: 64
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

            maxlength:
                OWNER_ID_MAX_LENGTH,

            default: null,

            immutable: true
        },

        updatedBy: {
            type: String,

            trim: true,

            maxlength:
                OWNER_ID_MAX_LENGTH,

            default: null
        }
    },

    {
        /**
         * Consistent TITech timestamps.
         */

        timestamps: true,

        /**
         * Prevent accidental unknown properties from being persisted.
         */

        strict: true,

        /**
         * Prevent unsafe query paths from silently being interpreted as
         * arbitrary document fields.
         */

        strictQuery: true,

        /**
         * Financial account documents do not require Mongoose's default
         * __v field.
         *
         * balanceRevision provides explicit financial mutation sequencing.
         */

        versionKey: false,

        collection: "accounts"
    }
);


/**

* ============================================================================
* Schema-Level Financial Invariants
* ============================================================================
*
* Invariant:
*
* 0 <= reservedBalance <= balance
*
* This protects normal document validation/save operations.
*
* IMPORTANT:
*
* Atomic monetary mutations performed through BalanceRepository MUST enforce
* the invariant in the MongoDB update filter itself.
*
* Mongoose document validators alone cannot guarantee correctness under
* concurrent atomic updates.
* ============================================================================
  */

accountSchema.path(
"reservedBalance"
).validate(
function (value) {
if (
value === undefined ||
value === null
) {
return true;
}


    if (!this.balance) {
        return true;
    }

    try {
        return (
            compareNonNegativeDecimals(
                value.toString(),
                this.balance.toString()
            ) <= 0
        );
    } catch {
        return false;
    }
},
"Reserved balance cannot exceed account balance."


);

/**

* ============================================================================
* Document Middleware
* ============================================================================
*
* The actual immutable fields are also protected by Mongoose's immutable
* schema option.
*
* This middleware intentionally does not attempt to perform authorization.
  */

accountSchema.pre(
"save",
function (next) {
try {
/**
* No financial authorization belongs here.
*
* BalanceRepository is responsible for balance mutations.
*/
return next();
} catch (error) {
return next(error);
}
}
);

/**

* ============================================================================
* Query Middleware - Financial Mutation Boundary
* ============================================================================
*
* Direct application-level balance mutation is prohibited.
*
* BalanceRepository may explicitly opt into financial mutation using:
*
* {
* ```
    allowFinancialMutation: true
  ```
* }
*
* This is an application-level safety boundary, not an authorization system.
*
* MongoDB/database users must still be protected through proper credentials,
* network controls, and least-privilege access.
* ============================================================================
  */

const BLOCKED_MUTATION_OPERATIONS = Object.freeze([
"updateOne",
"updateMany",
"findOneAndUpdate",
"findOneAndReplace",
"replaceOne"
]);

function updateTouchesPath(
update,
path
) {
if (!update || typeof update !== "object") {
return false;
}


if (
    Object.prototype.hasOwnProperty.call(
        update,
        path
    )
) {
    return true;
}

const operators = [
    "$set",
    "$setOnInsert",
    "$inc",
    "$mul",
    "$unset",
    "$min",
    "$max"
];

return operators.some(
    (operator) =>
        Boolean(
            update[operator] &&
            Object.prototype.hasOwnProperty.call(
                update[operator],
                path
            )
        )
);


}

for (
const operation of
BLOCKED_MUTATION_OPERATIONS
) {
accountSchema.pre(
operation,
function (next) {
const options =
typeof this.getOptions ===
"function"
? this.getOptions() || {}
: {};


        /**
         * Internal financial repository operations are explicitly allowed.
         */
        if (
            options.allowFinancialMutation ===
            true
        ) {
            return next();
        }

        const update =
            typeof this.getUpdate ===
            "function"
                ? this.getUpdate() || {}
                : {};

        const touchesBalance =
            updateTouchesPath(
                update,
                "balance"
            ) ||
            updateTouchesPath(
                update,
                "reservedBalance"
            ) ||
            updateTouchesPath(
                update,
                "balanceRevision"
            ) ||
            updateTouchesPath(
                update,
                "lastTransactionId"
            ) ||
            updateTouchesPath(
                update,
                "lastBalanceMutationAt"
            );

        const touchesFinancialIdentity =
            updateTouchesPath(
                update,
                "_id"
            ) ||
            updateTouchesPath(
                update,
                "tenantId"
            ) ||
            updateTouchesPath(
                update,
                "accountType"
            ) ||
            updateTouchesPath(
                update,
                "currency"
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
*
* availableBalance:
*
* balance - reservedBalance
*
* The result is returned as Decimal128.
  */

accountSchema.virtual(
"availableBalance"
).get(
function () {
try {
const balance =
this.balance
? this.balance
: decimal128Zero();


        const reserved =
            this.reservedBalance
                ? this.reservedBalance
                : decimal128Zero();

        const comparison =
            compareNonNegativeDecimals(
                reserved.toString(),
                balance.toString()
            );

        /**
         * A valid document should never reach this state.
         *
         * Return null rather than exposing a negative financial amount
         * if the object has been manually corrupted in memory.
         */
        if (comparison > 0) {
            return null;
        }

        /**
         * Decimal128 arithmetic is intentionally delegated to the
         * Decimal128 implementation rather than JavaScript Number math.
         *
         * MongoDB Decimal128 objects do not expose a portable subtraction
         * API across all supported Mongoose versions, so exact subtraction
         * is performed through decimal component normalization.
         */

        const balanceParts =
            parseDecimalToInteger(
                balance.toString()
            );

        const reservedParts =
            parseDecimalToInteger(
                reserved.toString()
            );

        const scale = Math.max(
            balanceParts.scale,
            reservedParts.scale
        );

        const balanceInteger =
            balanceParts.coefficient *
            10n ** BigInt(
                scale -
                    balanceParts.scale
            );

        const reservedInteger =
            reservedParts.coefficient *
            10n ** BigInt(
                scale -
                    reservedParts.scale
            );

        const availableInteger =
            balanceInteger -
            reservedInteger;

        let result =
            availableInteger.toString();

        if (scale > 0) {
            const negative =
                result.startsWith("-");

            const digits = negative
                ? result.slice(1)
                : result;

            const padded =
                digits.padStart(
                    scale + 1,
                    "0"
                );

            const splitIndex =
                padded.length - scale;

            const integerPart =
                padded.slice(
                    0,
                    splitIndex
                );

            const fractionalPart =
                padded.slice(
                    splitIndex
                );

            result =
                `${negative ? "-" : ""}${integerPart}.${fractionalPart}`;
        }

        return mongoose.Types.Decimal128.fromString(
            result
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

accountSchema.methods.isOperational =
function () {
return (
this.status ===
"ACTIVE"
);
};

accountSchema.methods.isFrozen =
function () {
return (
this.status ===
"FROZEN"
);
};

accountSchema.methods.isSuspended =
function () {
return (
this.status ===
"SUSPENDED"
);
};

accountSchema.methods.isClosed =
function () {
return (
this.status ===
"CLOSED"
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

* Available balance as a Decimal128 value.
  */
  accountSchema.methods.getAvailableBalance =
  function () {
  return this.availableBalance;
  };

/**

* ============================================================================
* Static Helpers
* ============================================================================
  */

/**

* Find an ACTIVE account within a specific tenant and currency.
*
* Repository/service layers remain responsible for authorization.
  */
  accountSchema.statics.findActiveById =
  function ({
  accountId,
  tenantId,
  currency,
  session
  } = {}) {
  const normalizedCurrency =
  currency === undefined ||
  currency === null
  ? null
  : String(
  currency
  )
  .trim()
  .toUpperCase();

  
   const query =
       this.findOne({
           _id: accountId,
           tenantId: tenantId,
           currency:
               normalizedCurrency,
           status: "ACTIVE"
       });

   if (session) {
       query.session(session);
   }

   return query;
  

  };

/**

* Find an account scoped to tenant.
  */
  accountSchema.statics.findByTenantAndId =
  function ({
  tenantId,
  accountId,
  session
  } = {}) {
  const query =
  this.findOne({
  _id: accountId,
  tenantId
  });

  
   if (session) {
       query.session(session);
   }

   return query;
  

  };

/**

* Find account by tenant-scoped business account number.
  */
  accountSchema.statics.findByAccountNumber =
  function ({
  tenantId,
  accountNumber,
  session
  } = {}) {
  const query =
  this.findOne({
  tenantId,
  accountNumber
  });

  
   if (session) {
       query.session(session);
   }

   return query;
  

  };

/**

* ============================================================================
* Indexes
* ============================================================================
*
* All high-volume operational indexes begin with tenantId wherever practical.
*
* This is important for:
*
* * multi-tenancy
* * query selectivity
* * tenant isolation
* * operational reporting
* * large-account datasets
* ============================================================================
  */

/**

* Tenant + currency + status lookup.
  */
  accountSchema.index(
  {
  tenantId: 1,
  currency: 1,
  status: 1
  },
  {
  name:
  "idx_titech_account_tenant_currency_status"
  }
  );

/**

* Tenant-scoped business account number uniqueness.
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

* Group wallet/account lookup.
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
  "idx_titech_group_accounts"
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

* Provider account reference.
*
* Sparse because not every account is associated with an external provider.
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
* Decimal128 values MUST remain strings outside the persistence layer.
*
* This prevents:
*
* Decimal128 -> JavaScript Number -> precision loss
*
* from occurring accidentally in API responses.
* ============================================================================
  */

function decimalToString(value) {
if (
value === undefined ||
value === null
) {
return value;
}


if (
    mongoose.isDecimal128(value)
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

RISK_LEVELS,

decimal128Zero,

decimal128FromString


};
