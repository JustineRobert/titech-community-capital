// ============================================================================
// backend/models/Entry.js
// TITech Community Capital LTD
// Enterprise Ledger Entry / Journal Line
// ============================================================================
//
// Architectural role
//   One document = one immutable accounting journal line.
//
// IMPORTANT
//   Entry does NOT independently constitute a balanced journal.
//
//   The journal/transaction service must enforce:
//
//       SUM(DEBIT) == SUM(CREDIT)
//
//   before the accounting transaction is posted.
//
// Financial authority
//   Transaction / Journal = accounting event
//   Entry               = individual immutable accounting line
//
// Correction policy
//   NEVER delete or edit a posted accounting line.
//   Financial corrections must use a reversal journal.
//
// Module format
//   ESM.
//
// ============================================================================

import mongoose from "mongoose";
import { randomUUID } from "node:crypto";

const { Schema } = mongoose;

// =============================================================================
// Constants
// =============================================================================

const DIRECTIONS = Object.freeze([
  "debit",
  "credit",
]);

const ENTRY_STATUSES = Object.freeze([
  "POSTED",
  "REVERSED",
]);

const MAX_TRANSACTION_ID_LENGTH = 128;
const MAX_ACCOUNT_ID_LENGTH = 128;
const MAX_EXTERNAL_REFERENCE_LENGTH = 256;
const MAX_REQUEST_ID_LENGTH = 128;
const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_NOTES_LENGTH = 2000;
const MAX_EXTRA_KEYS = 30;
const MAX_EXTRA_BYTES = 16 * 1024;

// =============================================================================
// Utilities
// =============================================================================

function normalizeRequiredString(
  value,
  fieldName,
  maxLength
) {
  if (typeof value !== "string") {
    throw new TypeError(
      `${fieldName} must be a string.`
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new Error(
      `${fieldName} is required.`
    );
  }

  if (normalized.length > maxLength) {
    throw new RangeError(
      `${fieldName} exceeds maximum length of ${maxLength}.`
    );
  }

  return normalized;
}

function normalizeOptionalString(
  value,
  fieldName,
  maxLength
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  return normalizeRequiredString(
    value,
    fieldName,
    maxLength
  );
}

/**
 * Convert a monetary value directly to Decimal128 without passing through
 * floating-point arithmetic.
 *
 * Preferred:
 *   "100000.00"
 *
 * Also accepted:
 *   Decimal128
 *   safe integer number
 */
function normalizeDecimal(
  value,
  fieldName = "amount"
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  if (
    value instanceof
    mongoose.Types.Decimal128
  ) {
    return value;
  }

  if (typeof value === "number") {
    if (
      !Number.isSafeInteger(value) ||
      value <= 0
    ) {
      throw new TypeError(
        `${fieldName} must be a positive safe integer or decimal string.`
      );
    }

    return mongoose.Types.Decimal128.fromString(
      String(value)
    );
  }

  if (typeof value === "string") {
    const normalized =
      value.trim();

    if (
      !/^\d+(\.\d+)?$/.test(
        normalized
      )
    ) {
      throw new TypeError(
        `${fieldName} must be a positive non-negative decimal.`
      );
    }

    const decimal =
      mongoose.Types.Decimal128.fromString(
        normalized
      );

    if (
      decimal.toString() ===
      "0"
    ) {
      throw new RangeError(
        `${fieldName} must be greater than zero.`
      );
    }

    return decimal;
  }

  throw new TypeError(
    `${fieldName} must be Decimal128, a decimal string, or a positive safe integer.`
  );
}

function decimalToString(
  value
) {
  return value
    ? value.toString()
    : "0.00";
}

function estimateBytes(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return 0;
  }

  try {
    return Buffer.byteLength(
      JSON.stringify(value),
      "utf8"
    );
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

// =============================================================================
// Metadata
// =============================================================================

const metadataSchema =
  new Schema(
    {
      source: {
        type: String,
        trim: true,
        maxlength: 100,
      },

      requestId: {
        type: String,
        trim: true,
        maxlength:
          MAX_REQUEST_ID_LENGTH,
      },

      externalReference: {
        type: String,
        trim: true,
        maxlength:
          MAX_EXTERNAL_REFERENCE_LENGTH,
      },

      /**
       * Reversal linkage.
       */
      originalEntryId: {
        type: String,
        trim: true,
        maxlength:
          128,
      },

      reversalReason: {
        type: String,
        trim: true,
        maxlength:
          500,
      },

      /**
       * Strictly bounded auxiliary metadata.
       */
      extra: {
        type: Schema.Types.Mixed,
        default: undefined,
      },
    },
    {
      _id: false,
      id: false,
      strict: true,
      minimize: false,
    }
  );

// =============================================================================
// Schema
// =============================================================================

const entrySchema =
  new Schema(
    {
      // -----------------------------------------------------------------------
      // Entry identity
      // -----------------------------------------------------------------------

      _id: {
        type: String,
        default: randomUUID,
        immutable: true,
      },

      entryId: {
        type: String,
        required: true,
        immutable: true,
        unique: true,
        trim: true,
        maxlength: 128,
        default: randomUUID,
        index: true,
      },

      // -----------------------------------------------------------------------
      // Tenant
      // -----------------------------------------------------------------------

      tenantId: {
        type: String,
        required: true,
        immutable: true,
        trim: true,
        maxlength: 128,
        index: true,
      },

      // -----------------------------------------------------------------------
      // Journal / transaction
      // -----------------------------------------------------------------------

      /**
       * Kept as String for compatibility with the current Entry model.
       *
       * IMPORTANT:
       * The repository should eventually standardize whether the canonical
       * transaction identity is String or ObjectId.
       */
      transactionId: {
        type: String,
        required: true,
        immutable: true,
        trim: true,
        maxlength:
          MAX_TRANSACTION_ID_LENGTH,
        index: true,
      },

      /**
       * Position within the journal.
       */
      lineNumber: {
        type: Number,
        required: true,
        immutable: true,
        min: 1,
        validate: {
          validator:
            Number.isInteger,
          message:
            "lineNumber must be an integer.",
        },
      },

      // -----------------------------------------------------------------------
      // Account
      // -----------------------------------------------------------------------

      accountId: {
        type: String,
        required: true,
        immutable: true,
        trim: true,
        maxlength:
          MAX_ACCOUNT_ID_LENGTH,
        index: true,
      },

      // -----------------------------------------------------------------------
      // Amount / direction
      // -----------------------------------------------------------------------

      amount: {
        type:
          Schema.Types.Decimal128,
        required: true,
        immutable: true,
        validate: {
          validator(value) {
            if (
              value === null ||
              value === undefined
            ) {
              return false;
            }

            const raw =
              value.toString();

            return (
              /^\d+(\.\d+)?$/.test(
                raw
              ) &&
              raw !== "0"
            );
          },

          message:
            "Amount must be a positive Decimal128 value.",
        },
      },

      direction: {
        type: String,
        required: true,
        enum: DIRECTIONS,
        lowercase: true,
        trim: true,
        immutable: true,
        index: true,
      },

      currency: {
        type: String,
        required: true,
        default: "UGX",
        uppercase: true,
        trim: true,
        immutable: true,
        match:
          /^[A-Z]{3}$/,
        index: true,
      },

      // -----------------------------------------------------------------------
      // Entry status
      // -----------------------------------------------------------------------

      status: {
        type: String,
        required: true,
        enum: ENTRY_STATUSES,
        default: "POSTED",
        uppercase: true,
        trim: true,
        index: true,
      },

      reversedAt: {
        type: Date,
        default: null,
      },

      reversalEntryId: {
        type: String,
        default: null,
        trim: true,
        maxlength: 128,
        index: true,
      },

      // -----------------------------------------------------------------------
      // References
      // -----------------------------------------------------------------------

      referenceId: {
        type: String,
        trim: true,
        maxlength:
          MAX_EXTERNAL_REFERENCE_LENGTH,
        immutable: true,
        index: true,
      },

      providerReference: {
        type: String,
        trim: true,
        maxlength:
          MAX_EXTERNAL_REFERENCE_LENGTH,
        immutable: true,
        index: true,
      },

      // -----------------------------------------------------------------------
      // Domain context
      // -----------------------------------------------------------------------

      userId: {
        type: Schema.Types.ObjectId,
        ref: "User",
        default: null,
        immutable: true,
        index: true,
      },

      groupId: {
        type: Schema.Types.ObjectId,
        ref: "Group",
        default: null,
        immutable: true,
        index: true,
      },

      loanId: {
        type: Schema.Types.ObjectId,
        ref: "Loan",
        default: null,
        immutable: true,
        index: true,
      },

      walletId: {
        type: Schema.Types.ObjectId,
        ref: "Wallet",
        default: null,
        immutable: true,
        index: true,
      },

      savingsAccountId: {
        type: Schema.Types.ObjectId,
        ref: "SavingsAccount",
        default: null,
        immutable: true,
        index: true,
      },

      // -----------------------------------------------------------------------
      // Description
      // -----------------------------------------------------------------------

      description: {
        type: String,
        trim: true,
        maxlength:
          MAX_DESCRIPTION_LENGTH,
        immutable: true,
      },

      notes: {
        type: String,
        trim: true,
        maxlength:
          MAX_NOTES_LENGTH,
        immutable: true,
      },

      // -----------------------------------------------------------------------
      // Metadata
      // -----------------------------------------------------------------------

      metadata: {
        type: metadataSchema,
        default: undefined,
        immutable: true,
      },

      // -----------------------------------------------------------------------
      // Audit
      // -----------------------------------------------------------------------

      createdBy: {
        type: Schema.Types.ObjectId,
        ref: "User",
        default: null,
        immutable: true,
        index: true,
      },

      postedAt: {
        type: Date,
        required: true,
        default: Date.now,
        immutable: true,
        index: true,
      },
    },
    {
      timestamps: true,

      /**
       * No document version is necessary because posted ledger lines are
       * immutable.
       */
      versionKey: false,

      strict: true,
      strictQuery: true,
      minimize: false,

      collection:
        "ledger_entries",

      toJSON: {
        getters: true,

        transform(
          doc,
          ret
        ) {
          ret.id =
            ret.entryId ||
            ret._id;

          if (
            ret.amount
          ) {
            ret.amount =
              ret.amount.toString();
          }

          delete ret._id;

          return ret;
        },
      },

      toObject: {
        getters: true,
      },
    }
  );

// =============================================================================
// Indexes
// =============================================================================

/**
 * A journal cannot contain two lines with the same line number.
 */
entrySchema.index(
  {
    tenantId: 1,
    transactionId: 1,
    lineNumber: 1,
  },
  {
    unique: true,
    name:
      "uq_entry_tenant_transaction_line",
  }
);

/**
 * Prevent duplicate account/direction/line combinations.
 */
entrySchema.index(
  {
    tenantId: 1,
    transactionId: 1,
    accountId: 1,
    direction: 1,
    lineNumber: 1,
  },
  {
    name:
      "idx_entry_journal_account_direction",
  }
);

entrySchema.index(
  {
    tenantId: 1,
    accountId: 1,
    postedAt: -1,
  },
  {
    name:
      "idx_entry_tenant_account_posted",
  }
);

entrySchema.index(
  {
    tenantId: 1,
    userId: 1,
    postedAt: -1,
  },
  {
    sparse: true,
    name:
      "idx_entry_tenant_user_posted",
  }
);

entrySchema.index(
  {
    tenantId: 1,
    loanId: 1,
    postedAt: -1,
  },
  {
    sparse: true,
    name:
      "idx_entry_tenant_loan_posted",
  }
);

entrySchema.index(
  {
    tenantId: 1,
    walletId: 1,
    postedAt: -1,
  },
  {
    sparse: true,
    name:
      "idx_entry_tenant_wallet_posted",
  }
);

entrySchema.index(
  {
    tenantId: 1,
    transactionId: 1,
    postedAt: 1,
  },
  {
    name:
      "idx_entry_tenant_transaction_posted",
  }
);

entrySchema.index(
  {
    tenantId: 1,
    providerReference: 1,
  },
  {
    sparse: true,
    name:
      "idx_entry_tenant_provider_reference",
  }
);

entrySchema.index(
  {
    tenantId: 1,
    status: 1,
    postedAt: -1,
  },
  {
    name:
      "idx_entry_tenant_status_posted",
  }
);

// =============================================================================
// Validation
// =============================================================================

entrySchema.pre(
  "validate",
  function validateEntry(
    next
  ) {
    try {
      if (
        !this.tenantId?.trim()
      ) {
        throw new Error(
          "tenantId is required."
        );
      }

      if (
        !this.transactionId?.trim()
      ) {
        throw new Error(
          "transactionId is required."
        );
      }

      if (
        !this.accountId?.trim()
      ) {
        throw new Error(
          "accountId is required."
        );
      }

      if (
        !Number.isInteger(
          this.lineNumber
        ) ||
        this.lineNumber < 1
      ) {
        throw new Error(
          "lineNumber must be a positive integer."
        );
      }

      if (
        !DIRECTIONS.includes(
          this.direction
        )
      ) {
        throw new Error(
          `Unsupported direction: ${this.direction}`
        );
      }

      if (
        !ENTRY_STATUSES.includes(
          this.status
        )
      ) {
        throw new Error(
          `Unsupported status: ${this.status}`
        );
      }

      normalizeDecimal(
        this.amount,
        "amount"
      );

      // -----------------------------------------------------------------------
      // Reversal integrity
      // -----------------------------------------------------------------------

      if (
        this.status ===
        "REVERSED"
      ) {
        if (
          !this.reversedAt
        ) {
          throw new Error(
            "A REVERSED entry requires reversedAt."
          );
        }

        if (
          !this.reversalEntryId
        ) {
          throw new Error(
            "A REVERSED entry requires reversalEntryId."
          );
        }
      }

      if (
        this.status ===
          "POSTED" &&
        (
          this.reversedAt ||
          this.reversalEntryId
        )
      ) {
        throw new Error(
          "A POSTED entry cannot contain reversal state."
        );
      }

      // -----------------------------------------------------------------------
      // Metadata safety
      // -----------------------------------------------------------------------

      if (
        this.metadata?.extra
      ) {
        const keys =
          Object.keys(
            this.metadata.extra
          );

        if (
          keys.length >
          MAX_EXTRA_KEYS
        ) {
          throw new RangeError(
            `metadata.extra cannot contain more than ${MAX_EXTRA_KEYS} keys.`
          );
        }

        if (
          estimateBytes(
            this.metadata.extra
          ) >
          MAX_EXTRA_BYTES
        ) {
          throw new RangeError(
            "metadata.extra exceeds the permitted size."
          );
        }
      }

      return next();
    } catch (error) {
      return next(error);
    }
  }
);

// =============================================================================
// Append-only protection
// =============================================================================
//
// Accounting corrections must be represented by reversal journals.
//
// =============================================================================

const immutableEntryError =
  () => {
    const error =
      new Error(
        "Ledger entries are immutable. " +
          "Create a reversal journal instead."
      );

    error.code =
      "LEDGER_ENTRY_IMMUTABLE";

    error.statusCode =
      409;

    return error;
  };

entrySchema.pre(
  "updateOne",
  function rejectUpdate() {
    throw immutableEntryError();
  }
);

entrySchema.pre(
  "updateMany",
  function rejectUpdate() {
    throw immutableEntryError();
  }
);

entrySchema.pre(
  "findOneAndUpdate",
  function rejectUpdate() {
    throw immutableEntryError();
  }
);

entrySchema.pre(
  "replaceOne",
  function rejectUpdate() {
    throw immutableEntryError();
  }
);

entrySchema.pre(
  "findOneAndReplace",
  function rejectUpdate() {
    throw immutableEntryError();
  }
);

entrySchema.pre(
  "deleteOne",
  function rejectDelete() {
    throw immutableEntryError();
  }
);

entrySchema.pre(
  "deleteMany",
  function rejectDelete() {
    throw immutableEntryError();
  }
);

entrySchema.pre(
  "findOneAndDelete",
  function rejectDelete() {
    throw immutableEntryError();
  }
);

entrySchema.pre(
  "findOneAndRemove",
  function rejectRemove() {
    throw immutableEntryError();
  }
);

entrySchema.pre(
  "remove",
  function rejectRemove() {
    throw immutableEntryError();
  }
);

// =============================================================================
// Static creation helpers
// =============================================================================

entrySchema.statics.createDebit =
  async function (
    payload,
    {
      session = null,
    } = {}
  ) {
    return this.createLine(
      {
        ...payload,
        direction: "debit",
      },
      {
        session,
      }
    );
  };

entrySchema.statics.createCredit =
  async function (
    payload,
    {
      session = null,
    } = {}
  ) {
    return this.createLine(
      {
        ...payload,
        direction: "credit",
      },
      {
        session,
      }
    );
  };

entrySchema.statics.createLine =
  async function (
    payload,
    {
      session = null,
    } = {}
  ) {
    if (!payload) {
      throw new Error(
        "Ledger entry payload is required."
      );
    }

    const normalizedAmount =
      normalizeDecimal(
        payload.amount,
        "amount"
      );

    const entry =
      new this({
        ...payload,
        amount:
          normalizedAmount,
      });

    await entry.save(
      session
        ? { session }
        : undefined
    );

    return entry;
  };

// =============================================================================
// Query helpers
// =============================================================================

entrySchema.statics.findJournal =
  async function (
    tenantId,
    transactionId,
    {
      session = null,
    } = {}
  ) {
    const query =
      this.find({
        tenantId,
        transactionId,
      }).sort({
        lineNumber: 1,
        _id: 1,
      });

    if (session) {
      query.session(
        session
      );
    }

    return query.exec();
  };

entrySchema.statics.findByAccount =
  async function (
    tenantId,
    accountId,
    {
      limit = 100,
      session = null,
    } = {}
  ) {
    const normalizedLimit =
      Math.min(
        500,
        Math.max(
          1,
          Number(limit) ||
            100
        )
      );

    const query =
      this.find({
        tenantId,
        accountId,
        status: "POSTED",
      })
        .sort({
          postedAt: -1,
          _id: -1,
        })
        .limit(
          normalizedLimit
        );

    if (session) {
      query.session(
        session
      );
    }

    return query.exec();
  };

entrySchema.statics.findByLoan =
  async function (
    tenantId,
    loanId,
    {
      limit = 100,
      session = null,
    } = {}
  ) {
    const normalizedLimit =
      Math.min(
        500,
        Math.max(
          1,
          Number(limit) ||
            100
        )
      );

    const query =
      this.find({
        tenantId,
        loanId,
      })
        .sort({
          postedAt: -1,
          _id: -1,
        })
        .limit(
          normalizedLimit
        );

    if (session) {
      query.session(
        session
      );
    }

    return query.exec();
  };

/**
 * Calculate journal totals without modifying persisted records.
 *
 * NOTE:
 * The authoritative posting service should perform exact Decimal128/decimal
 * arithmetic before commit. This helper is intended as a validation/read
 * helper.
 */
entrySchema.statics.getJournalTotals =
  function (
    entries
  ) {
    if (
      !Array.isArray(
        entries
      )
    ) {
      throw new TypeError(
        "entries must be an array."
      );
    }

    let debitTotal =
      0;

    let creditTotal =
      0;

    for (
      const entry
      of entries
    ) {
      const amount =
        Number(
          decimalToString(
            entry.amount
          )
        );

      if (
        !Number.isFinite(
          amount
        )
      ) {
        throw new Error(
          "Invalid ledger entry amount."
        );
      }

      if (
        entry.direction ===
        "debit"
      ) {
        debitTotal +=
          amount;
      } else if (
        entry.direction ===
        "credit"
      ) {
        creditTotal +=
          amount;
      } else {
        throw new Error(
          `Invalid ledger direction: ${entry.direction}`
        );
      }
    }

    return {
      debitTotal:
        debitTotal.toFixed(2),

      creditTotal:
        creditTotal.toFixed(2),

      balanced:
        debitTotal.toFixed(2) ===
        creditTotal.toFixed(2),
    };
  };

// =============================================================================
// Model
// =============================================================================

const Entry =
  mongoose.models.Entry ||
  mongoose.model(
    "Entry",
    entrySchema
  );

export default Entry;

export {
  DIRECTIONS,
  ENTRY_STATUSES,
};