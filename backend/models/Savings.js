/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Savings Model
 * ============================================================================
 *
 * File:
 *   backend/models/Savings.js
 *
 * Purpose:
 *   Enterprise-grade savings account / savings portfolio aggregate.
 *
 * Architectural position:
 *
 *   Tenant
 *      │
 *      └── Member
 *           │
 *           └── Savings
 *                │
 *                ├── Transaction Service
 *                │      │
 *                │      └── Ledger
 *                │
 *                ├── Interest Engine
 *                ├── Dividend Engine
 *                ├── Mobile Money
 *                ├── Risk / Fraud
 *                ├── Compliance
 *                └── Reporting
 *
 * IMPORTANT FINANCIAL DESIGN
 * ----------------------------------------------------------------------------
 * Savings is a financial account aggregate / reporting snapshot.
 *
 * It is NOT an independent accounting engine.
 *
 * Monetary movements MUST be performed through the canonical transaction /
 * ledger service boundary.
 *
 * Example:
 *
 *   Payment / Deposit / Withdrawal
 *         ↓
 *   Transaction Service
 *         ↓
 *   Transaction / Ledger
 *         ↓
 *   Savings aggregate update
 *         ↓
 *   Reconciliation / Outbox / Audit / Receipt
 *
 * Savings MUST NOT:
 *   - create a second ledger
 *   - mutate unrelated accounts
 *   - bypass idempotency
 *   - perform unaudited transfers
 *   - become the source of truth for transaction history
 *
 * FINANCIAL PRECISION
 * ----------------------------------------------------------------------------
 * Monetary fields use MongoDB Decimal128.
 *
 * Decimal128 values are deliberately NOT converted to JavaScript Number for
 * financial calculations inside the model.
 *
 * The authoritative transaction service should perform financial arithmetic
 * with deterministic decimal arithmetic and then persist Decimal128 values.
 *
 * TENANCY
 * ----------------------------------------------------------------------------
 * tenantId is a MongoDB ObjectId referencing Tenant.
 *
 * Every operational query must be tenant-scoped.
 *
 * ESM
 * ----------------------------------------------------------------------------
 * The TITech repository uses package.json "type": "module".
 *
 * Consumers should use:
 *
 *   import Savings from "../models/Savings.js";
 *
 * ============================================================================
 */

import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * ============================================================================
 * ENUMS
 * ============================================================================
 */

export const SAVINGS_TYPES = Object.freeze([
  "REGULAR",
  "GOAL",
  "FIXED",
  "CHILD",
  "GROUP",
  "INVESTMENT",
]);

export const SAVINGS_STATUSES = Object.freeze([
  "PENDING",
  "ACTIVE",
  "DORMANT",
  "BLOCKED",
  "CLOSED",
]);

export const ACTIVITY_TYPES = Object.freeze([
  "DEPOSIT",
  "WITHDRAWAL",
  "INTEREST",
  "DIVIDEND",
  "ADJUSTMENT",
  "REVERSAL",
  "FEE",
  "REFUND",
  "TRANSFER_IN",
  "TRANSFER_OUT",
]);

export const MOMO_PROVIDERS = Object.freeze([
  "MTN",
  "AIRTEL",
]);

export const BLOCK_REASONS = Object.freeze([
  "COMPLIANCE",
  "FRAUD",
  "AML",
  "KYC",
  "COURT_ORDER",
  "OPERATIONAL",
  "MEMBER_REQUEST",
  "RISK",
  "OTHER",
]);

export const INTEREST_RATE_TYPES =
  Object.freeze([
    "NONE",
    "FLAT",
    "ANNUAL",
    "MONTHLY",
    "DAILY",
    "TIERED",
  ]);

export const MATURITY_INSTRUCTIONS =
  Object.freeze([
    "PAYOUT",
    "RENEW",
    "TRANSFER_TO_REGULAR",
    "HOLD",
  ]);

export const RECONCILIATION_STATUSES =
  Object.freeze([
    "PENDING",
    "MATCHED",
    "MISMATCH",
    "UNDER_REVIEW",
  ]);

export const RISK_LEVELS =
  Object.freeze([
    "LOW",
    "MEDIUM",
    "HIGH",
    "CRITICAL",
  ]);

/**
 * ============================================================================
 * CONFIGURATION
 * ============================================================================
 */

const MAX_SAVINGS_NUMBER_LENGTH = 100;
const MAX_SAVINGS_NAME_LENGTH = 150;
const MAX_REFERENCE_LENGTH = 200;
const MAX_RECENT_ACTIVITIES = 100;

/**
 * Score thresholds retained from the supplied model.
 */
const RISK_CRITICAL_THRESHOLD = 800;
const RISK_HIGH_THRESHOLD = 600;
const RISK_MEDIUM_THRESHOLD = 350;

/**
 * ============================================================================
 * OBJECT ID / NORMALIZATION HELPERS
 * ============================================================================
 */

export function toObjectId(value) {
  if (
    value instanceof
    mongoose.Types.ObjectId
  ) {
    return value;
  }

  if (
    !value ||
    !mongoose.Types.ObjectId.isValid(
      value
    )
  ) {
    return null;
  }

  return new mongoose.Types.ObjectId(
    value
  );
}

export function isValidObjectId(
  value
) {
  return Boolean(
    value &&
      mongoose.Types.ObjectId.isValid(
        value
      )
  );
}

function normalizeString(value) {
  if (typeof value !== "string") {
    return value;
  }

  return value
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeUppercase(value) {
  if (typeof value !== "string") {
    return value;
  }

  return value
    .trim()
    .toUpperCase();
}

/**
 * ============================================================================
 * DECIMAL128 HELPERS
 * ============================================================================
 *
 * These helpers deliberately operate on Decimal128 string representations.
 *
 * They are intended for model invariants, not for replacing the canonical
 * financial decimal arithmetic implementation used by the transaction layer.
 * ============================================================================
 */

function decimal128Zero() {
  return mongoose.Types.Decimal128
    .fromString("0.00");
}

function decimal128FromValue(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return decimal128Zero();
  }

  if (
    value instanceof
    mongoose.Types.Decimal128
  ) {
    return value;
  }

  const stringValue =
    String(value).trim();

  if (!stringValue) {
    return decimal128Zero();
  }

  try {
    return mongoose.Types.Decimal128
      .fromString(stringValue);
  } catch {
    return decimal128Zero();
  }
}

/**
 * Exact Decimal128 addition/subtraction helper for the limited invariant
 * calculations performed in this model.
 *
 * This intentionally uses decimal strings rather than Number.
 *
 * Supported:
 *   - ordinary decimal numbers
 *   - positive values
 *   - negative intermediate results
 */
function decimalToParts(value) {
  const normalized =
    decimal128FromValue(value)
      .toString()
      .trim();

  const negative =
    normalized.startsWith("-");

  const unsigned =
    negative
      ? normalized.slice(1)
      : normalized;

  const [wholePart = "0", fractionPart = ""] =
    unsigned.split(".");

  return {
    negative,
    whole:
      wholePart.replace(
        /^0+(?=\d)/,
        ""
      ) || "0",
    fraction:
      fractionPart || "",
  };
}

function compareUnsignedParts(
  left,
  right
) {
  if (
    left.whole.length !==
    right.whole.length
  ) {
    return left.whole.length >
      right.whole.length
      ? 1
      : -1;
  }

  if (left.whole !== right.whole) {
    return left.whole > right.whole
      ? 1
      : -1;
  }

  const maxFractionLength =
    Math.max(
      left.fraction.length,
      right.fraction.length
    );

  const leftFraction =
    left.fraction.padEnd(
      maxFractionLength,
      "0"
    );

  const rightFraction =
    right.fraction.padEnd(
      maxFractionLength,
      "0"
    );

  if (leftFraction === rightFraction) {
    return 0;
  }

  return leftFraction > rightFraction
    ? 1
    : -1;
}

function addUnsignedStrings(
  left,
  right
) {
  const decimalPlaces =
    Math.max(
      left.fraction.length,
      right.fraction.length
    );

  const leftFraction =
    left.fraction.padEnd(
      decimalPlaces,
      "0"
    );

  const rightFraction =
    right.fraction.padEnd(
      decimalPlaces,
      "0"
    );

  const leftDigits =
    `${left.whole}${leftFraction}`;

  const rightDigits =
    `${right.whole}${rightFraction}`;

  let carry = 0;
  let result = "";

  const maxLength =
    Math.max(
      leftDigits.length,
      rightDigits.length
    );

  for (
    let index = 0;
    index < maxLength;
    index += 1
  ) {
    const leftIndex =
      leftDigits.length -
      1 -
      index;

    const rightIndex =
      rightDigits.length -
      1 -
      index;

    const leftDigit =
      leftIndex >= 0
        ? Number(leftDigits[leftIndex])
        : 0;

    const rightDigit =
      rightIndex >= 0
        ? Number(
            rightDigits[rightIndex]
          )
        : 0;

    const total =
      leftDigit +
      rightDigit +
      carry;

    result =
      String(total % 10) +
      result;

    carry =
      Math.floor(total / 10);
  }

  if (carry > 0) {
    result =
      String(carry) +
      result;
  }

  if (decimalPlaces === 0) {
    return {
      whole: result || "0",
      fraction: "",
    };
  }

  const split =
    result.length -
    decimalPlaces;

  const whole =
    result.slice(0, split) || "0";

  const fraction =
    result.slice(split)
      .padStart(
        decimalPlaces,
        "0"
      );

  return {
    whole,
    fraction,
  };
}

function subtractUnsignedStrings(
  larger,
  smaller
) {
  const decimalPlaces =
    Math.max(
      larger.fraction.length,
      smaller.fraction.length
    );

  const largerFraction =
    larger.fraction.padEnd(
      decimalPlaces,
      "0"
    );

  const smallerFraction =
    smaller.fraction.padEnd(
      decimalPlaces,
      "0"
    );

  const largerDigits =
    `${larger.whole}${largerFraction}`;

  const smallerDigits =
    `${smaller.whole}${smallerFraction}`;

  let borrow = 0;
  let result = "";

  for (
    let index = 0;
    index < largerDigits.length;
    index += 1
  ) {
    const largerIndex =
      largerDigits.length -
      1 -
      index;

    const smallerIndex =
      smallerDigits.length -
      1 -
      index;

    let left =
      Number(
        largerDigits[largerIndex]
      ) - borrow;

    const right =
      smallerIndex >= 0
        ? Number(
            smallerDigits[
              smallerIndex
            ]
          )
        : 0;

    if (left < right) {
      left += 10;
      borrow = 1;
    } else {
      borrow = 0;
    }

    result =
      String(left - right) +
      result;
  }

  result =
    result.replace(
      /^0+(?=\d)/,
      ""
    );

  if (decimalPlaces === 0) {
    return {
      whole: result || "0",
      fraction: "",
    };
  }

  const split =
    result.length -
    decimalPlaces;

  return {
    whole:
      result.slice(0, split) || "0",
    fraction:
      result
        .slice(split)
        .padStart(
          decimalPlaces,
          "0"
        ),
  };
}

function partsToString(
  parts,
  negative = false
) {
  const fraction =
    parts.fraction.replace(
      /0+$/,
      ""
    );

  const unsigned =
    fraction.length > 0
      ? `${parts.whole}.${fraction}`
      : parts.whole;

  if (
    negative &&
    unsigned !== "0"
  ) {
    return `-${unsigned}`;
  }

  return unsigned;
}

export function decimalAdd(
  left,
  right
) {
  const leftParts =
    decimalToParts(left);

  const rightParts =
    decimalToParts(right);

  if (
    leftParts.negative ===
    rightParts.negative
  ) {
    return decimal128FromValue(
      partsToString(
        addUnsignedStrings(
          leftParts,
          rightParts
        ),
        leftParts.negative
      )
    );
  }

  const comparison =
    compareUnsignedParts(
      leftParts,
      rightParts
    );

  if (comparison === 0) {
    return decimal128Zero();
  }

  const larger =
    comparison > 0
      ? leftParts
      : rightParts;

  const smaller =
    comparison > 0
      ? rightParts
      : leftParts;

  const difference =
    subtractUnsignedStrings(
      larger,
      smaller
    );

  const negative =
    comparison > 0
      ? leftParts.negative
      : rightParts.negative;

  return decimal128FromValue(
    partsToString(
      difference,
      negative
    )
  );
}

export function decimalSubtract(
  left,
  right
) {
  const rightParts =
    decimalToParts(right);

  return decimalAdd(
    left,
    decimal128FromValue(
      partsToString(
        rightParts,
        !rightParts.negative
      )
    )
  );
}

export function decimalCompare(
  left,
  right
) {
  const leftDecimal =
    decimal128FromValue(left);

  const rightDecimal =
    decimal128FromValue(right);

  const leftParts =
    decimalToParts(
      leftDecimal
    );

  const rightParts =
    decimalToParts(
      rightDecimal
    );

  if (
    leftParts.negative &&
    !rightParts.negative
  ) {
    return -1;
  }

  if (
    !leftParts.negative &&
    rightParts.negative
  ) {
    return 1;
  }

  const comparison =
    compareUnsignedParts(
      leftParts,
      rightParts
    );

  return leftParts.negative
    ? comparison * -1
    : comparison;
}

/**
 * Convert a Decimal128 value to a plain string.
 *
 * This is safe for API transport and avoids Number precision loss.
 */
export function decimalToString(
  value
) {
  return decimal128FromValue(
    value
  ).toString();
}

/**
 * ============================================================================
 * MONEY FIELD
 * ============================================================================
 */

const moneyField = Object.freeze({
  type: Schema.Types.Decimal128,
  default: "0.00",
});

/**
 * ============================================================================
 * SAVINGS ACTIVITY SNAPSHOT
 * ============================================================================
 *
 * Lightweight operational snapshot only.
 *
 * Historical financial truth remains in Transaction / Ledger.
 */

const SavingsActivitySchema =
  new Schema(
    {
      transactionId: {
        type: Schema.Types.ObjectId,
        ref: "Transaction",
        index: true,
      },

      ledgerEntryId: {
        type: Schema.Types.ObjectId,
        ref: "LedgerEntry",
        index: true,
      },

      type: {
        type: String,
        enum: ACTIVITY_TYPES,
        required: true,
        uppercase: true,
        trim: true,
      },

      amount: {
        ...moneyField,
        required: true,
      },

      transactionDate: {
        type: Date,
        required: true,
        default: Date.now,
      },

      reference: {
        type: String,
        trim: true,
        maxlength: 150,
        set: normalizeString,
      },

      externalReference: {
        type: String,
        trim: true,
        maxlength: MAX_REFERENCE_LENGTH,
        set: normalizeString,
      },

      /**
       * Idempotency key from originating financial operation.
       */
      idempotencyKey: {
        type: String,
        trim: true,
        maxlength: MAX_REFERENCE_LENGTH,
        set: normalizeString,
      },
    },
    {
      _id: false,
    }
  );

/**
 * ============================================================================
 * SAVINGS SCHEMA
 * ============================================================================
 */

const SavingsSchema =
  new Schema(
    {
      /**
       * ========================================================================
       * TENANCY
       * ========================================================================
       */

      tenantId: {
        type: Schema.Types.ObjectId,
        ref: "Tenant",
        required: true,
        index: true,
      },

      /**
       * ========================================================================
       * MEMBER OWNERSHIP
       * ========================================================================
       */

      member: {
        type: Schema.Types.ObjectId,
        ref: "Member",
        required: true,
        index: true,
      },

      account: {
        type: Schema.Types.ObjectId,
        ref: "Account",
        default: null,
        index: true,
      },

      /**
       * ========================================================================
       * IDENTIFICATION
       * ========================================================================
       */

      savingsNumber: {
        type: String,
        required: true,
        trim: true,
        uppercase: true,
        minlength: 3,
        maxlength: MAX_SAVINGS_NUMBER_LENGTH,
        set: normalizeUppercase,
      },

      savingsName: {
        type: String,
        default: "Regular Savings",
        trim: true,
        maxlength: MAX_SAVINGS_NAME_LENGTH,
        set: normalizeString,
      },

      savingsType: {
        type: String,
        enum: SAVINGS_TYPES,
        default: "REGULAR",
        uppercase: true,
        trim: true,
        index: true,
      },

      /**
       * ========================================================================
       * CURRENCY
       * ========================================================================
       *
       * Currency should be treated as immutable after financial activity
       * begins. Enforce this at the service layer using financialVersion /
       * transaction state.
       */

      currency: {
        type: String,
        default: "UGX",
        required: true,
        uppercase: true,
        trim: true,
        minlength: 3,
        maxlength: 3,
        match: /^[A-Z]{3}$/,
      },

      /**
       * ========================================================================
       * ACCOUNT BALANCES
       * ========================================================================
       *
       * These are account aggregate values.
       *
       * They are not an alternative to the transaction / ledger history.
       */

      balance: {
        ...moneyField,
      },

      availableBalance: {
        ...moneyField,
      },

      blockedBalance: {
        ...moneyField,
      },

      /**
       * ========================================================================
       * FINANCIAL AGGREGATES
       * ========================================================================
       */

      totalDeposits: {
        ...moneyField,
      },

      totalWithdrawals: {
        ...moneyField,
      },

      totalInterestEarned: {
        ...moneyField,
      },

      totalDividendsEarned: {
        ...moneyField,
      },

      totalFeesCharged: {
        ...moneyField,
      },

      totalReversals: {
        ...moneyField,
      },

      /**
       * Reporting aggregate.
       *
       * This value is derived and must never be treated as ledger authority.
       */
      netSavings: {
        ...moneyField,
      },

      totalTransactions: {
        type: Number,
        default: 0,
        min: 0,
        max: Number.MAX_SAFE_INTEGER,
      },

      /**
       * ========================================================================
       * INTEREST MANAGEMENT
       * ========================================================================
       */

      interestRate: {
        type: Number,
        default: 0,
        min: 0,
        max: 100,
      },

      interestRateType: {
        type: String,
        enum: INTEREST_RATE_TYPES,
        default: "ANNUAL",
        uppercase: true,
        trim: true,
      },

      accruedInterest: {
        ...moneyField,
      },

      interestLastCalculatedAt: {
        type: Date,
        default: null,
      },

      interestLastPostedAt: {
        type: Date,
        default: null,
      },

      interestCalculationVersion: {
        type: Number,
        default: 1,
        min: 1,
      },

      /**
       * ========================================================================
       * DIVIDENDS
       * ========================================================================
       */

      dividendEligible: {
        type: Boolean,
        default: true,
      },

      lastDividendPostedAt: {
        type: Date,
        default: null,
      },

      /**
       * ========================================================================
       * GOAL / MATURITY
       * ========================================================================
       */

      targetAmount: {
        ...moneyField,
      },

      targetDate: {
        type: Date,
        default: null,
      },

      maturityDate: {
        type: Date,
        default: null,
      },

      maturityInstruction: {
        type: String,
        enum: MATURITY_INSTRUCTIONS,
        default: "PAYOUT",
        uppercase: true,
        trim: true,
      },

      /**
       * ========================================================================
       * MOBILE MONEY
       * ========================================================================
       */

      momoEnabled: {
        type: Boolean,
        default: false,
      },

      momoProvider: {
        type: String,
        enum: MOMO_PROVIDERS,
        default: null,
        uppercase: true,
        trim: true,
      },

      momoPhoneNumber: {
        type: String,
        trim: true,
        maxlength: 30,
      },

      momoLastTransactionAt: {
        type: Date,
        default: null,
      },

      /**
       * ========================================================================
       * COMPLIANCE
       * ========================================================================
       */

      kycVerified: {
        type: Boolean,
        default: false,
        index: true,
      },

      kycVerifiedAt: {
        type: Date,
        default: null,
      },

      amlChecked: {
        type: Boolean,
        default: false,
        index: true,
      },

      amlCheckedAt: {
        type: Date,
        default: null,
      },

      complianceReviewRequired: {
        type: Boolean,
        default: false,
        index: true,
      },

      complianceReviewAt: {
        type: Date,
        default: null,
      },

      /**
       * ========================================================================
       * STATUS / LIFECYCLE
       * ========================================================================
       */

      status: {
        type: String,
        enum: SAVINGS_STATUSES,
        default: "ACTIVE",
        uppercase: true,
        trim: true,
        index: true,
      },

      activatedAt: {
        type: Date,
        default: null,
      },

      dormantAt: {
        type: Date,
        default: null,
      },

      closedAt: {
        type: Date,
        default: null,
      },

      closureReason: {
        type: String,
        trim: true,
        maxlength: 500,
        set: normalizeString,
      },

      /**
       * ========================================================================
       * BLOCKING
       * ========================================================================
       */

      blocked: {
        type: Boolean,
        default: false,
        index: true,
      },

      blockReason: {
        type: String,
        enum: BLOCK_REASONS,
        default: null,
        uppercase: true,
        trim: true,
      },

      blockedAt: {
        type: Date,
        default: null,
      },

      blockedBy: {
        type: Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },

      blockReference: {
        type: String,
        trim: true,
        maxlength: MAX_REFERENCE_LENGTH,
        set: normalizeString,
      },

      /**
       * ========================================================================
       * RISK / FRAUD
       * ========================================================================
       */

      fraudFlagged: {
        type: Boolean,
        default: false,
        index: true,
      },

      fraudFlaggedAt: {
        type: Date,
        default: null,
      },

      fraudFlagReason: {
        type: String,
        trim: true,
        maxlength: 500,
        set: normalizeString,
      },

      riskScore: {
        type: Number,
        default: 0,
        min: 0,
        max: 1000,
      },

      riskLevel: {
        type: String,
        enum: RISK_LEVELS,
        default: "LOW",
        uppercase: true,
        index: true,
      },

      /**
       * ========================================================================
       * TRANSACTION STATISTICS
       * ========================================================================
       */

      lastTransactionAt: {
        type: Date,
        default: null,
      },

      lastDepositAt: {
        type: Date,
        default: null,
      },

      lastWithdrawalAt: {
        type: Date,
        default: null,
      },

      lastInterestAt: {
        type: Date,
        default: null,
      },

      /**
       * ========================================================================
       * RECENT ACTIVITY
       * ========================================================================
       *
       * Deliberately bounded.
       *
       * Never use this array as the historical ledger.
       */

      recentActivities: {
        type: [SavingsActivitySchema],
        default: [],
      },

      /**
       * ========================================================================
       * IDEMPOTENCY / RECONCILIATION
       * ========================================================================
       */

      lastTransactionId: {
        type: Schema.Types.ObjectId,
        ref: "Transaction",
        default: null,
      },

      lastLedgerEntryId: {
        type: Schema.Types.ObjectId,
        ref: "LedgerEntry",
        default: null,
      },

      reconciliationStatus: {
        type: String,
        enum: RECONCILIATION_STATUSES,
        default: "MATCHED",
        index: true,
      },

      lastReconciledAt: {
        type: Date,
        default: null,
      },

      reconciliationReference: {
        type: String,
        trim: true,
        maxlength: MAX_REFERENCE_LENGTH,
        set: normalizeString,
      },

      /**
       * ========================================================================
       * AUDIT
       * ========================================================================
       */

      createdBy: {
        type: Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },

      updatedBy: {
        type: Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },

      auditReference: {
        type: String,
        trim: true,
        maxlength: MAX_REFERENCE_LENGTH,
        set: normalizeString,
      },

      lastAuditAt: {
        type: Date,
        default: null,
      },

      /**
       * ========================================================================
       * WORKFLOW / CONCURRENCY
       * ========================================================================
       */

      workflowVersion: {
        type: Number,
        default: 1,
        min: 1,
      },

      /**
       * Version of the aggregate financial state.
       *
       * Transaction services may use this in optimistic-concurrency predicates.
       */
      financialVersion: {
        type: Number,
        default: 0,
        min: 0,
      },

      schemaVersion: {
        type: Number,
        default: 2,
        min: 1,
      },
    },
    {
      timestamps: true,

      versionKey: "__v",

      optimisticConcurrency: true,

      minimize: false,

      strict: true,

      toJSON: {
        virtuals: true,

        transform(doc, ret) {
          if (ret._id) {
            ret.id =
              ret._id.toString();
          }

          delete ret._id;
          delete ret.__v;

          return ret;
        },
      },

      toObject: {
        virtuals: true,

        transform(doc, ret) {
          if (ret._id) {
            ret.id =
              ret._id.toString();
          }

          delete ret._id;
          delete ret.__v;

          return ret;
        },
      },
    }
  );

/**
 * ============================================================================
 * VIRTUALS
 * ============================================================================
 */

SavingsSchema.virtual(
  "isActive"
).get(function isActive() {
  return (
    this.status === "ACTIVE" &&
    this.blocked !== true
  );
});

SavingsSchema.virtual(
  "isDormant"
).get(function isDormant() {
  return this.status === "DORMANT";
});

SavingsSchema.virtual(
  "isBlocked"
).get(function isBlocked() {
  return (
    this.status === "BLOCKED" ||
    this.blocked === true
  );
});

SavingsSchema.virtual(
  "isClosed"
).get(function isClosed() {
  return this.status === "CLOSED";
});

SavingsSchema.virtual(
  "goalAchievementPercentage"
).get(
  function goalAchievementPercentage() {
    const target =
      decimal128FromValue(
        this.targetAmount
      );

    const balance =
      decimal128FromValue(
        this.balance
      );

    if (
      decimalCompare(
        target,
        decimal128Zero()
      ) <= 0
    ) {
      return 0;
    }

    /**
     * This percentage is an analytics representation.
     *
     * A small conversion to Number is acceptable only after the exact
     * Decimal128 comparison has already occurred, because this is UI
     * percentage output rather than a monetary persistence calculation.
     */
    const targetNumber =
      Number(
        target.toString()
      );

    const balanceNumber =
      Number(
        balance.toString()
      );

    if (
      !Number.isFinite(
        targetNumber
      ) ||
      !Number.isFinite(
        balanceNumber
      )
    ) {
      return 0;
    }

    return Math.min(
      100,
      Number(
        (
          (balanceNumber /
            targetNumber) *
          100
        ).toFixed(2)
      )
    );
  }
);

SavingsSchema.virtual(
  "utilizedBlockedPercentage"
).get(
  function utilizedBlockedPercentage() {
    const balance =
      decimal128FromValue(
        this.balance
      );

    const blocked =
      decimal128FromValue(
        this.blockedBalance
      );

    if (
      decimalCompare(
        balance,
        decimal128Zero()
      ) <= 0
    ) {
      return 0;
    }

    const balanceNumber =
      Number(
        balance.toString()
      );

    const blockedNumber =
      Number(
        blocked.toString()
      );

    if (
      !Number.isFinite(
        balanceNumber
      ) ||
      !Number.isFinite(
        blockedNumber
      )
    ) {
      return 0;
    }

    return Number(
      (
        (blockedNumber /
          balanceNumber) *
        100
      ).toFixed(2)
    );
  }
);

SavingsSchema.virtual(
  "availableAfterBlocked"
).get(
  function availableAfterBlocked() {
    return decimalToString(
      this.availableBalance
    );
  }
);

/**
 * ============================================================================
 * RISK CALCULATION
 * ============================================================================
 */

export function calculateRiskLevel(
  score
) {
  const normalized =
    Math.max(
      0,
      Math.min(
        1000,
        Math.round(
          Number(score) || 0
        )
      )
    );

  if (
    normalized >=
    RISK_CRITICAL_THRESHOLD
  ) {
    return "CRITICAL";
  }

  if (
    normalized >=
    RISK_HIGH_THRESHOLD
  ) {
    return "HIGH";
  }

  if (
    normalized >=
    RISK_MEDIUM_THRESHOLD
  ) {
    return "MEDIUM";
  }

  return "LOW";
}

/**
 * ============================================================================
 * VALIDATION
 * ============================================================================
 */

SavingsSchema.pre(
  "validate",
  function savingsValidation(next) {
    /**
     * ------------------------------------------------------------------------
     * TENANT
     * ------------------------------------------------------------------------
     */

    const tenantObjectId =
      toObjectId(
        this.tenantId
      );

    if (!tenantObjectId) {
      return next(
        new Error(
          "A valid tenantId is required for Savings."
        )
      );
    }

    this.tenantId =
      tenantObjectId;

    /**
     * ------------------------------------------------------------------------
     * MEMBER
     * ------------------------------------------------------------------------
     */

    if (
      !toObjectId(
        this.member
      )
    ) {
      return next(
        new Error(
          "A valid member reference is required for Savings."
        )
      );
    }

    /**
     * ------------------------------------------------------------------------
     * BALANCE INVARIANTS
     * ------------------------------------------------------------------------
     */

    const balance =
      decimal128FromValue(
        this.balance
      );

    const availableBalance =
      decimal128FromValue(
        this.availableBalance
      );

    const blockedBalance =
      decimal128FromValue(
        this.blockedBalance
      );

    if (
      decimalCompare(
        availableBalance,
        balance
      ) > 0
    ) {
      return next(
        new Error(
          "Savings available balance cannot exceed total balance."
        )
      );
    }

    if (
      decimalCompare(
        blockedBalance,
        balance
      ) > 0
    ) {
      return next(
        new Error(
          "Savings blocked balance cannot exceed total balance."
        )
      );
    }

    const availablePlusBlocked =
      decimalAdd(
        availableBalance,
        blockedBalance
      );

    if (
      decimalCompare(
        availablePlusBlocked,
        balance
      ) > 0
    ) {
      return next(
        new Error(
          "Savings available balance plus blocked balance cannot exceed total balance."
        )
      );
    }

    /**
     * ------------------------------------------------------------------------
     * NON-NEGATIVE MONEY
     * ------------------------------------------------------------------------
     */

    const monetaryFields = [
      "balance",
      "availableBalance",
      "blockedBalance",
      "totalDeposits",
      "totalWithdrawals",
      "totalInterestEarned",
      "totalDividendsEarned",
      "totalFeesCharged",
      "totalReversals",
      "accruedInterest",
      "targetAmount",
    ];

    for (
      const field of monetaryFields
    ) {
      const value =
        decimal128FromValue(
          this[field]
        );

      if (
        decimalCompare(
          value,
          decimal128Zero()
        ) < 0
      ) {
        return next(
          new Error(
            `Savings ${field} cannot be negative.`
          )
        );
      }

      this[field] = value;
    }

    /**
     * ------------------------------------------------------------------------
     * GOAL SAVINGS
     * ------------------------------------------------------------------------
     */

    if (
      this.savingsType === "GOAL" &&
      decimalCompare(
        this.targetAmount,
        decimal128Zero()
      ) <= 0
    ) {
      return next(
        new Error(
          "Goal savings accounts must have a positive target amount."
        )
      );
    }

    /**
     * ------------------------------------------------------------------------
     * FIXED SAVINGS
     * ------------------------------------------------------------------------
     */

    if (
      this.savingsType === "FIXED" &&
      !this.maturityDate
    ) {
      return next(
        new Error(
          "Fixed savings accounts must have a maturity date."
        )
      );
    }

    if (
      this.maturityDate &&
      !(
        this.maturityDate instanceof
        Date
      )
    ) {
      this.maturityDate =
        new Date(
          this.maturityDate
        );
    }

    /**
     * ------------------------------------------------------------------------
     * MOBILE MONEY
     * ------------------------------------------------------------------------
     */

    if (
      this.momoEnabled &&
      !this.momoProvider
    ) {
      return next(
        new Error(
          "A mobile money provider is required when mobile money is enabled."
        )
      );
    }

    /**
     * ------------------------------------------------------------------------
     * COMPLIANCE
     * ------------------------------------------------------------------------
     */

    if (
      this.kycVerified &&
      !this.kycVerifiedAt
    ) {
      this.kycVerifiedAt =
        new Date();
    }

    if (
      this.amlChecked &&
      !this.amlCheckedAt
    ) {
      this.amlCheckedAt =
        new Date();
    }

    /**
     * ------------------------------------------------------------------------
     * BLOCKING
     * ------------------------------------------------------------------------
     */

    if (
      this.blocked &&
      !this.blockedAt
    ) {
      this.blockedAt =
        new Date();
    }

    if (
      this.blocked &&
      !this.blockReason
    ) {
      this.blockReason =
        "OTHER";
    }

    if (
      this.status === "BLOCKED"
    ) {
      this.blocked = true;

      if (!this.blockedAt) {
        this.blockedAt =
          new Date();
      }

      if (!this.blockReason) {
        this.blockReason =
          "OPERATIONAL";
      }
    }

    /**
     * ------------------------------------------------------------------------
     * CLOSED
     * ------------------------------------------------------------------------
     */

    if (
      this.status === "CLOSED" &&
      !this.closedAt
    ) {
      this.closedAt =
        new Date();
    }

    /**
     * ------------------------------------------------------------------------
     * RISK LEVEL
     * ------------------------------------------------------------------------
     */

    this.riskLevel =
      calculateRiskLevel(
        this.riskScore
      );

    /**
     * ------------------------------------------------------------------------
     * RECENT ACTIVITY BOUND
     * ------------------------------------------------------------------------
     */

    if (
      Array.isArray(
        this.recentActivities
      ) &&
      this.recentActivities.length >
        MAX_RECENT_ACTIVITIES
    ) {
      this.recentActivities =
        this.recentActivities.slice(
          -MAX_RECENT_ACTIVITIES
        );
    }

    return next();
  }
);

/**
 * ============================================================================
 * PRE-SAVE DERIVED AGGREGATE NORMALIZATION
 * ============================================================================
 *
 * This hook computes reporting metadata only.
 *
 * It does not initiate, reverse or settle a financial transaction.
 *
 * The authoritative account balance must be supplied by the financial
 * transaction service / repository boundary.
 * ============================================================================
 */

SavingsSchema.pre(
  "save",
  function savingsPreSave(next) {
    /**
     * ------------------------------------------------------------------------
     * NET SAVINGS
     * ------------------------------------------------------------------------
     *
     * netSavings is a reporting aggregate:
     *
     *   deposits
     * + interest
     * + dividends
     * + reversals
     * - withdrawals
     * - fees
     *
     * This must not be interpreted as the authoritative ledger balance.
     */

    const deposits =
      this.totalDeposits;

    const withdrawals =
      this.totalWithdrawals;

    const interest =
      this.totalInterestEarned;

    const dividends =
      this.totalDividendsEarned;

    const fees =
      this.totalFeesCharged;

    const reversals =
      this.totalReversals;

    let net =
      decimalAdd(
        deposits,
        interest
      );

    net =
      decimalAdd(
        net,
        dividends
      );

    net =
      decimalAdd(
        net,
        reversals
      );

    net =
      decimalSubtract(
        net,
        withdrawals
      );

    net =
      decimalSubtract(
        net,
        fees
      );

    /**
     * Reporting snapshot should not become negative.
     *
     * Importantly, we do not alter `balance` here.
     */
    if (
      decimalCompare(
        net,
        decimal128Zero()
      ) < 0
    ) {
      net =
        decimal128Zero();
    }

    this.netSavings = net;

    /**
     * ------------------------------------------------------------------------
     * STATUS TIMESTAMPS
     * ------------------------------------------------------------------------
     */

    if (
      this.isModified(
        "status"
      )
    ) {
      if (
        this.status === "ACTIVE" &&
        !this.activatedAt
      ) {
        this.activatedAt =
          new Date();
      }

      if (
        this.status === "DORMANT" &&
        !this.dormantAt
      ) {
        this.dormantAt =
          new Date();
      }

      if (
        this.status === "CLOSED" &&
        !this.closedAt
      ) {
        this.closedAt =
          new Date();
      }

      if (
        this.status === "BLOCKED"
      ) {
        this.blocked = true;

        if (!this.blockedAt) {
          this.blockedAt =
            new Date();
        }
      }
    }

    /**
     * ------------------------------------------------------------------------
     * FINANCIAL VERSION
     * ------------------------------------------------------------------------
     *
     * The version changes whenever core account aggregates change through a
     * document save. Financial services should still use an atomic query
     * predicate on this value where concurrent writes matter.
     */

    const financialFields = [
      "balance",
      "availableBalance",
      "blockedBalance",
      "totalDeposits",
      "totalWithdrawals",
      "totalInterestEarned",
      "totalDividendsEarned",
      "totalFeesCharged",
      "totalReversals",
      "accruedInterest",
      "totalTransactions",
    ];

    if (
      financialFields.some(
        (field) =>
          this.isModified(field)
      )
    ) {
      this.financialVersion =
        Number(
          this.financialVersion || 0
        ) + 1;
    }

    return next();
  }
);

/**
 * ============================================================================
 * TENANT QUERY HELPERS
 * ============================================================================
 */

SavingsSchema.statics.buildTenantQuery =
  function buildTenantQuery({
    tenantId,
    ...criteria
  } = {}) {
    const tenantObjectId =
      toObjectId(tenantId);

    if (!tenantObjectId) {
      throw new Error(
        "A valid tenantId is required for Savings tenant-scoped queries."
      );
    }

    return {
      tenantId:
        tenantObjectId,
      ...criteria,
    };
  };

SavingsSchema.statics.findTenantSavings =
  function findTenantSavings(
    tenantId,
    savingsId,
    {
      includeClosed = true,
    } = {}
  ) {
    const tenantObjectId =
      toObjectId(tenantId);

    const savingsObjectId =
      toObjectId(savingsId);

    if (
      !tenantObjectId ||
      !savingsObjectId
    ) {
      return this.findOne({
        _id: null,
      });
    }

    const query = {
      _id: savingsObjectId,
      tenantId: tenantObjectId,
    };

    if (!includeClosed) {
      query.status = {
        $ne: "CLOSED",
      };
    }

    return this.findOne(
      query
    );
  };

SavingsSchema.statics.activeAccountQuery =
  function activeAccountQuery(
    tenantId,
    savingsId
  ) {
    const tenantObjectId =
      toObjectId(tenantId);

    const savingsObjectId =
      toObjectId(savingsId);

    if (
      !tenantObjectId ||
      !savingsObjectId
    ) {
      throw new Error(
        "Valid tenantId and savingsId are required."
      );
    }

    return {
      _id: savingsObjectId,
      tenantId: tenantObjectId,
      status: "ACTIVE",
      blocked: false,
      reconciliationStatus: {
        $nin: [
          "MISMATCH",
          "UNDER_REVIEW",
        ],
      },
    };
  };

/**
 * ============================================================================
 * FINANCIAL MUTATION QUERY
 * ============================================================================
 *
 * This helper DOES NOT mutate the account.
 *
 * It builds an atomic predicate suitable for the canonical financial service.
 *
 * Example conceptual usage:
 *
 *   const filter =
 *     Savings.buildFinancialMutationQuery({
 *       tenantId,
 *       savingsId,
 *       financialVersion,
 *     });
 *
 *   await Savings.updateOne(
 *     filter,
 *     update,
 *     { session }
 *   );
 *
 * Actual transaction/idempotency/ledger semantics remain outside the model.
 * ============================================================================
 */

SavingsSchema.statics.buildFinancialMutationQuery =
  function buildFinancialMutationQuery({
    tenantId,
    savingsId,
    financialVersion,
  } = {}) {
    const tenantObjectId =
      toObjectId(tenantId);

    const savingsObjectId =
      toObjectId(savingsId);

    if (
      !tenantObjectId ||
      !savingsObjectId
    ) {
      throw new Error(
        "Valid tenantId and savingsId are required for financial mutation."
      );
    }

    const query = {
      _id: savingsObjectId,
      tenantId: tenantObjectId,
      status: "ACTIVE",
      blocked: false,
      reconciliationStatus: {
        $nin: [
          "MISMATCH",
          "UNDER_REVIEW",
        ],
      },
    };

    if (
      Number.isInteger(
        financialVersion
      )
    ) {
      query.financialVersion =
        financialVersion;
    }

    return query;
  };

/**
 * ============================================================================
 * ACTIVE / PORTFOLIO QUERIES
 * ============================================================================
 */

SavingsSchema.statics.findMemberSavings =
  function findMemberSavings(
    tenantId,
    memberId,
    {
      status = null,
      limit = 100,
    } = {}
  ) {
    const tenantObjectId =
      toObjectId(tenantId);

    const memberObjectId =
      toObjectId(memberId);

    if (
      !tenantObjectId ||
      !memberObjectId
    ) {
      return this.findOne({
        _id: null,
      });
    }

    const query = {
      tenantId:
        tenantObjectId,
      member:
        memberObjectId,
    };

    if (status) {
      query.status = status;
    }

    return this.find(query)
      .sort({
        createdAt: -1,
      })
      .limit(
        Math.min(
          100,
          Math.max(
            1,
            Number.parseInt(
              limit,
              10
            ) || 100
          )
        )
      );
  };

/**
 * ============================================================================
 * INSTANCE METHODS
 * ============================================================================
 */

SavingsSchema.methods.belongsToTenant =
  function belongsToTenant(
    tenantId
  ) {
    return Boolean(
      this.tenantId &&
        tenantId &&
        String(
          this.tenantId
        ) ===
          String(tenantId)
    );
  };

SavingsSchema.methods.canTransact =
  function canTransact() {
    return (
      this.status === "ACTIVE" &&
      this.blocked !== true &&
      this.reconciliationStatus !==
        "MISMATCH" &&
      this.reconciliationStatus !==
        "UNDER_REVIEW"
    );
  };

SavingsSchema.methods.isMature =
  function isMature(
    referenceDate = new Date()
  ) {
    if (
      !this.maturityDate
    ) {
      return false;
    }

    const maturity =
      this.maturityDate instanceof
      Date
        ? this.maturityDate
        : new Date(
            this.maturityDate
          );

    return (
      !Number.isNaN(
        maturity.getTime()
      ) &&
      maturity <=
        referenceDate
    );
  };

SavingsSchema.methods.isGoalReached =
  function isGoalReached() {
    if (
      this.savingsType !==
      "GOAL"
    ) {
      return false;
    }

    return (
      decimalCompare(
        this.balance,
        this.targetAmount
      ) >= 0
    );
  };

/**
 * Return the financial aggregate snapshot.
 *
 * Decimal128 values are deliberately retained as strings for safe application
 * transport rather than converted to Number.
 */
SavingsSchema.methods.getFinancialSnapshot =
  function getFinancialSnapshot() {
    return {
      savingsId:
        this._id,

      tenantId:
        this.tenantId,

      member:
        this.member,

      account:
        this.account,

      savingsNumber:
        this.savingsNumber,

      currency:
        this.currency,

      balance:
        decimalToString(
          this.balance
        ),

      availableBalance:
        decimalToString(
          this.availableBalance
        ),

      blockedBalance:
        decimalToString(
          this.blockedBalance
        ),

      totalDeposits:
        decimalToString(
          this.totalDeposits
        ),

      totalWithdrawals:
        decimalToString(
          this.totalWithdrawals
        ),

      totalInterestEarned:
        decimalToString(
          this.totalInterestEarned
        ),

      totalDividendsEarned:
        decimalToString(
          this.totalDividendsEarned
        ),

      totalFeesCharged:
        decimalToString(
          this.totalFeesCharged
        ),

      totalReversals:
        decimalToString(
          this.totalReversals
        ),

      accruedInterest:
        decimalToString(
          this.accruedInterest
        ),

      netSavings:
        decimalToString(
          this.netSavings
        ),

      financialVersion:
        this.financialVersion,

      reconciliationStatus:
        this.reconciliationStatus,
    };
  };

/**
 * Add a bounded operational activity snapshot.
 *
 * This is intentionally not a transaction-posting method.
 */
SavingsSchema.methods.appendRecentActivity =
  function appendRecentActivity(
    activity
  ) {
    if (
      !activity ||
      typeof activity !==
        "object"
    ) {
      throw new Error(
        "Savings activity must be an object."
      );
    }

    if (
      !ACTIVITY_TYPES.includes(
        activity.type
      )
    ) {
      throw new Error(
        `Unsupported savings activity type: ${activity.type}`
      );
    }

    const amount =
      decimal128FromValue(
        activity.amount
      );

    if (
      decimalCompare(
        amount,
        decimal128Zero()
      ) < 0
    ) {
      throw new Error(
        "Savings activity amount cannot be negative."
      );
    }

    this.recentActivities =
      this.recentActivities || [];

    this.recentActivities.push({
      ...activity,
      amount,
    });

    if (
      this.recentActivities.length >
      MAX_RECENT_ACTIVITIES
    ) {
      this.recentActivities =
        this.recentActivities.slice(
          -MAX_RECENT_ACTIVITIES
        );
    }

    return this;
  };

/**
 * ============================================================================
 * MODEL INDEXES
 * ============================================================================
 */

/**
 * One savings account number per tenant.
 */
SavingsSchema.index(
  {
    tenantId: 1,
    savingsNumber: 1,
  },
  {
    unique: true,
    name:
      "uq_savings_tenant_number",
  }
);

/**
 * Member savings portfolio.
 */
SavingsSchema.index(
  {
    tenantId: 1,
    member: 1,
    status: 1,
  },
  {
    name:
      "idx_savings_tenant_member_status",
  }
);

/**
 * Account lookup.
 */
SavingsSchema.index(
  {
    tenantId: 1,
    account: 1,
  },
  {
    sparse: true,
    name:
      "idx_savings_tenant_account",
  }
);

/**
 * Savings type / portfolio reporting.
 */
SavingsSchema.index(
  {
    tenantId: 1,
    savingsType: 1,
    status: 1,
  },
  {
    name:
      "idx_savings_type_status",
  }
);

/**
 * Operational status queue.
 */
SavingsSchema.index(
  {
    tenantId: 1,
    status: 1,
    updatedAt: -1,
  },
  {
    name:
      "idx_savings_status_updated",
  }
);

/**
 * Balance reporting.
 */
SavingsSchema.index(
  {
    tenantId: 1,
    balance: -1,
  },
  {
    name:
      "idx_savings_balance",
  }
);

/**
 * Risk operations.
 */
SavingsSchema.index(
  {
    tenantId: 1,
    fraudFlagged: 1,
    riskLevel: 1,
  },
  {
    name:
      "idx_savings_risk_operations",
  }
);

/**
 * Compliance queue.
 */
SavingsSchema.index(
  {
    tenantId: 1,
    complianceReviewRequired: 1,
    updatedAt: -1,
  },
  {
    name:
      "idx_savings_compliance_review",
  }
);

/**
 * Reconciliation queue.
 */
SavingsSchema.index(
  {
    tenantId: 1,
    reconciliationStatus: 1,
    updatedAt: -1,
  },
  {
    name:
      "idx_savings_reconciliation",
  }
);

/**
 * Dormancy detection.
 */
SavingsSchema.index(
  {
    tenantId: 1,
    status: 1,
    lastTransactionAt: 1,
  },
  {
    name:
      "idx_savings_dormancy",
  }
);

/**
 * Maturity processing.
 */
SavingsSchema.index(
  {
    tenantId: 1,
    savingsType: 1,
    maturityDate: 1,
    status: 1,
  },
  {
    sparse: true,
    name:
      "idx_savings_maturity",
  }
);

/**
 * Goal reporting.
 */
SavingsSchema.index(
  {
    tenantId: 1,
    savingsType: 1,
    targetDate: 1,
  },
  {
    sparse: true,
    name:
      "idx_savings_goals",
  }
);

/**
 * Recent creation/reporting.
 */
SavingsSchema.index(
  {
    tenantId: 1,
    createdAt: -1,
  },
  {
    name:
      "idx_savings_created",
  }
);

/**
 * Transaction reference lookup.
 */
SavingsSchema.index({
  tenantId: 1,
  lastTransactionId: 1,
});

/**
 * Reconciliation reference lookup.
 */
SavingsSchema.index({
  tenantId: 1,
  reconciliationReference: 1,
});

/**
 * ============================================================================
 * MODEL METADATA
 * ============================================================================
 */

export const SAVINGS_MODEL_METADATA =
  Object.freeze({
    modelName: "Savings",

    schemaVersion: 2,

    tenantField:
      "tenantId",

    tenantFieldType:
      "ObjectId",

    memberField:
      "member",

    financialAggregate:
      true,

    financialLedgerAuthority:
      false,

    financialPostingAuthority:
      "TransactionService",

    ledgerAuthority:
      "Transaction/Ledger",

    monetaryType:
      "Decimal128",

    financialMutationGuard:
      "financialVersion",

    transactionHistoryAuthority:
      "Transaction",

    recentActivityPurpose:
      "operational snapshot",

    reconciliationRequired:
      true,

    supportedCurrencies:
      "ISO-4217 3-letter code",
  });

/**
 * ============================================================================
 * MODEL EXPORT
 * ============================================================================
 */

export const Savings =
  mongoose.models.Savings ||
  mongoose.model(
    "Savings",
    SavingsSchema
  );

export default Savings;

/**
 * Export the schema for tests/migrations/introspection.
 */
export {
  SavingsSchema,
  SavingsActivitySchema,
};