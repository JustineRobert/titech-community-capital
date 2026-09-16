// ============================================================================
// backend/models/LedgerEntry.js
// Enterprise Ledger Entry Model
// TITech Community Capital LTD
// Double-Entry Accounting Foundation
// ============================================================================
//
// Architectural role
//   One document = one immutable journal line.
//
// IMPORTANT
//   This model does NOT by itself guarantee that a journal balances.
//   A journal/batch must contain at least one DEBIT and one CREDIT and:
//
//       totalDebits === totalCredits
//
//   The financial/journal service is responsible for creating and posting
//   balanced journal batches atomically.
//
// Financial source-of-truth boundary
//   Transaction     = canonical financial/business transaction
//   Journal         = accounting event/batch
//   LedgerEntry     = immutable journal line
//
// No controller should directly mutate ledger entries.
//
// Module format
//   ESM.
//
// ============================================================================

import mongoose from 'mongoose';

const { Schema } = mongoose;

// =============================================================================
// ENUMS
// =============================================================================

const ENTRY_TYPES = Object.freeze([
  'DEBIT',
  'CREDIT',
]);

const ACCOUNT_TYPES = Object.freeze([
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'INCOME',
  'EXPENSE',
]);

const SOURCES = Object.freeze([
  'SAVINGS',
  'LOAN',
  'MOMO_COLLECTION',
  'MOMO_DISBURSEMENT',
  'SETTLEMENT',
  'INTEREST',
  'FEE',
  'ADJUSTMENT',
  'REVERSAL',
  'MANUAL',
  'SYSTEM',
]);

const JOURNAL_STATUSES = Object.freeze([
  'DRAFT',
  'POSTED',
  'REVERSED',
]);

const MAX_CODE_LENGTH = 64;
const MAX_NAME_LENGTH = 200;
const MAX_REFERENCE_LENGTH = 256;
const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_NOTES_LENGTH = 5000;
const MAX_METADATA_KEYS = 50;

// =============================================================================
// Utilities
// =============================================================================

function normalizeDecimal(value, fieldName = 'amount') {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return null;
  }

  if (value instanceof mongoose.Types.Decimal128) {
    const raw = value.toString();

    if (!/^\d+(\.\d+)?$/.test(raw)) {
      throw new TypeError(
        `${fieldName} must be a non-negative decimal value.`
      );
    }

    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new TypeError(
        `${fieldName} must be supplied as Decimal128 or a safe integer.`
      );
    }

    return mongoose.Types.Decimal128.fromString(String(value));
  }

  if (typeof value === 'string') {
    const normalized = value.trim();

    if (!/^\d+(\.\d+)?$/.test(normalized)) {
      throw new TypeError(
        `${fieldName} must be a non-negative decimal value.`
      );
    }

    return mongoose.Types.Decimal128.fromString(normalized);
  }

  throw new TypeError(
    `${fieldName} must be Decimal128, a decimal string, or a safe integer.`
  );
}

function requireNonEmptyString(value, fieldName, maxLength) {
  if (typeof value !== 'string') {
    throw new TypeError(`${fieldName} must be a string.`);
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }

  if (normalized.length > maxLength) {
    throw new RangeError(
      `${fieldName} exceeds maximum length of ${maxLength}.`
    );
  }

  return normalized;
}

function optionalString(value, fieldName, maxLength) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return undefined;
  }

  return requireNonEmptyString(
    value,
    fieldName,
    maxLength
  );
}

function normalizeObjectId(value, fieldName) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return undefined;
  }

  if (!mongoose.isValidObjectId(value)) {
    throw new TypeError(
      `${fieldName} must be a valid ObjectId.`
    );
  }

  return value;
}

// =============================================================================
// Metadata
// =============================================================================

const metadataSchema = new Schema(
  {
    /**
     * Strictly structured common financial metadata.
     *
     * Do not place passwords, tokens, KYC documents, raw payment credentials,
     * or unrestricted request bodies here.
     */
    paymentMethod: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 64,
      immutable: true,
    },

    provider: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 64,
      immutable: true,
    },

    providerReference: {
      type: String,
      trim: true,
      maxlength: MAX_REFERENCE_LENGTH,
      immutable: true,
    },

    idempotencyKey: {
      type: String,
      trim: true,
      maxlength: MAX_REFERENCE_LENGTH,
      immutable: true,
    },

    originalEntryId: {
      type: Schema.Types.ObjectId,
      ref: 'LedgerEntry',
      immutable: true,
    },

    reversalReason: {
      type: String,
      trim: true,
      maxlength: 1000,
      immutable: true,
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

const ledgerEntrySchema = new Schema(
  {
    // -------------------------------------------------------------------------
    // Tenant isolation
    // -------------------------------------------------------------------------

    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      immutable: true,
      index: true,
    },

    // -------------------------------------------------------------------------
    // Journal identity
    // -------------------------------------------------------------------------

    journalId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      minlength: 1,
      maxlength: MAX_REFERENCE_LENGTH,
      index: true,
    },

    /**
     * Explicit line number makes journal ordering deterministic and allows
     * the journal service to refer to a specific line.
     */
    lineNumber: {
      type: Number,
      required: true,
      immutable: true,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: 'lineNumber must be an integer.',
      },
    },

    journalStatus: {
      type: String,
      required: true,
      enum: JOURNAL_STATUSES,
      default: 'POSTED',
      immutable: true,
      index: true,
    },

    // -------------------------------------------------------------------------
    // Canonical transaction link
    // -------------------------------------------------------------------------

    transactionId: {
      type: Schema.Types.ObjectId,
      ref: 'Transaction',
      required: false,
      immutable: true,
      index: true,
    },

    externalId: {
      type: String,
      trim: true,
      maxlength: MAX_REFERENCE_LENGTH,
      immutable: true,
      index: true,
    },

    referenceId: {
      type: String,
      trim: true,
      maxlength: MAX_REFERENCE_LENGTH,
      immutable: true,
      index: true,
    },

    providerReference: {
      type: String,
      trim: true,
      maxlength: MAX_REFERENCE_LENGTH,
      immutable: true,
      index: true,
    },

    // -------------------------------------------------------------------------
    // Account
    // -------------------------------------------------------------------------

    accountCode: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
      minlength: 1,
      maxlength: MAX_CODE_LENGTH,
      index: true,
    },

    accountName: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      minlength: 1,
      maxlength: MAX_NAME_LENGTH,
    },

    accountType: {
      type: String,
      enum: ACCOUNT_TYPES,
      required: true,
      immutable: true,
      uppercase: true,
      trim: true,
      index: true,
    },

    // -------------------------------------------------------------------------
    // Entry
    // -------------------------------------------------------------------------

    entryType: {
      type: String,
      enum: ENTRY_TYPES,
      required: true,
      immutable: true,
      uppercase: true,
      trim: true,
      index: true,
    },

    /**
     * Decimal128 prevents floating-point representation errors in the
     * persisted accounting amount.
     *
     * IMPORTANT:
     *   This is always a positive line amount.
     *   Debit/Credit direction is represented by entryType.
     */
    amount: {
      type: Schema.Types.Decimal128,
      required: true,
      immutable: true,
      validate: {
        validator(value) {
          if (value === null || value === undefined) {
            return false;
          }

          const raw = value.toString();

          return (
            /^\d+(\.\d+)?$/.test(raw) &&
            raw !== '0'
          );
        },
        message: 'Ledger amount must be a positive decimal.',
      },
    },

    currency: {
      type: String,
      required: true,
      default: 'UGX',
      uppercase: true,
      trim: true,
      match: /^[A-Z]{3}$/,
      immutable: true,
      index: true,
    },

    // -------------------------------------------------------------------------
    // Source
    // -------------------------------------------------------------------------

    source: {
      type: String,
      enum: SOURCES,
      required: true,
      default: 'SYSTEM',
      uppercase: true,
      trim: true,
      immutable: true,
      index: true,
    },

    sourceId: {
      type: String,
      trim: true,
      maxlength: MAX_REFERENCE_LENGTH,
      immutable: true,
      index: true,
    },

    // -------------------------------------------------------------------------
    // Domain context
    // -------------------------------------------------------------------------

    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      immutable: true,
      index: true,
    },

    groupId: {
      type: Schema.Types.ObjectId,
      ref: 'Group',
      immutable: true,
      index: true,
    },

    loanId: {
      type: Schema.Types.ObjectId,
      ref: 'Loan',
      immutable: true,
      index: true,
    },

    savingsAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'SavingsAccount',
      immutable: true,
      index: true,
    },

    walletId: {
      type: Schema.Types.ObjectId,
      ref: 'Wallet',
      immutable: true,
      index: true,
    },

    // -------------------------------------------------------------------------
    // Posting / reversal
    // -------------------------------------------------------------------------

    posted: {
      type: Boolean,
      required: true,
      default: true,
      immutable: true,
      index: true,
    },

    reversed: {
      type: Boolean,
      required: true,
      default: false,
      immutable: true,
      index: true,
    },

    reversalEntryId: {
      type: Schema.Types.ObjectId,
      ref: 'LedgerEntry',
      default: null,
      immutable: true,
      index: true,
    },

    // -------------------------------------------------------------------------
    // Description
    // -------------------------------------------------------------------------

    description: {
      type: String,
      trim: true,
      maxlength: MAX_DESCRIPTION_LENGTH,
      immutable: true,
    },

    notes: {
      type: String,
      trim: true,
      maxlength: MAX_NOTES_LENGTH,
      immutable: true,
    },

    // -------------------------------------------------------------------------
    // Metadata
    // -------------------------------------------------------------------------

    metadata: {
      type: metadataSchema,
      default: undefined,
      immutable: true,
    },

    // -------------------------------------------------------------------------
    // Audit actor
    // -------------------------------------------------------------------------

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: false,
      immutable: true,
      index: true,
    },

    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: false,
      default: null,
      immutable: true,
    },

    approvedAt: {
      type: Date,
      default: null,
      immutable: true,
    },
  },
  {
    timestamps: true,

    /**
     * Ledger entries are immutable, so a version counter is unnecessary.
     */
    versionKey: false,

    strict: true,
    strictQuery: true,
    minimize: false,

    collection: 'ledger_entries',

    toJSON: {
      transform(doc, ret) {
        ret.id = doc._id.toString();

        if (ret.amount) {
          ret.amount = ret.amount.toString();
        }

        delete ret._id;
      },
    },
  }
);

// =============================================================================
// Indexes
// =============================================================================

/**
 * One line number can occur only once in a given tenant/journal.
 */
ledgerEntrySchema.index(
  {
    tenantId: 1,
    journalId: 1,
    lineNumber: 1,
  },
  {
    unique: true,
    name: 'uniq_tenant_journal_line',
  }
);

/**
 * Efficient retrieval of a journal in accounting order.
 */
ledgerEntrySchema.index(
  {
    tenantId: 1,
    journalId: 1,
    lineNumber: 1,
  },
  {
    name: 'idx_tenant_journal_lines',
  }
);

ledgerEntrySchema.index(
  {
    tenantId: 1,
    accountCode: 1,
    createdAt: -1,
  },
  {
    name: 'idx_tenant_account_created',
  }
);

ledgerEntrySchema.index(
  {
    tenantId: 1,
    transactionId: 1,
    createdAt: -1,
  },
  {
    name: 'idx_tenant_transaction_created',
  }
);

ledgerEntrySchema.index(
  {
    tenantId: 1,
    loanId: 1,
    createdAt: -1,
  },
  {
    name: 'idx_tenant_loan_created',
  }
);

ledgerEntrySchema.index(
  {
    tenantId: 1,
    userId: 1,
    createdAt: -1,
  },
  {
    name: 'idx_tenant_user_created',
  }
);

ledgerEntrySchema.index(
  {
    tenantId: 1,
    source: 1,
    createdAt: -1,
  },
  {
    name: 'idx_tenant_source_created',
  }
);

ledgerEntrySchema.index(
  {
    tenantId: 1,
    providerReference: 1,
  },
  {
    sparse: true,
    name: 'idx_tenant_provider_reference',
  }
);

// =============================================================================
// Validation
// =============================================================================

ledgerEntrySchema.pre(
  'validate',
  function validateLedgerEntry(next) {
    try {
      if (!this.tenantId) {
        throw new Error(
          'tenantId is required for ledger entries.'
        );
      }

      if (!this.journalId) {
        throw new Error(
          'journalId is required for ledger entries.'
        );
      }

      if (!this.lineNumber) {
        throw new Error(
          'lineNumber is required for ledger entries.'
        );
      }

      if (!ENTRY_TYPES.includes(this.entryType)) {
        throw new Error(
          `Unsupported entryType: ${this.entryType}`
        );
      }

      if (!ACCOUNT_TYPES.includes(this.accountType)) {
        throw new Error(
          `Unsupported accountType: ${this.accountType}`
        );
      }

      if (!SOURCES.includes(this.source)) {
        throw new Error(
          `Unsupported ledger source: ${this.source}`
        );
      }

      if (!JOURNAL_STATUSES.includes(this.journalStatus)) {
        throw new Error(
          `Unsupported journalStatus: ${this.journalStatus}`
        );
      }

      normalizeDecimal(
        this.amount,
        'amount'
      );

      if (this.amount?.toString() === '0') {
        throw new Error(
          'Ledger entries cannot have zero amount.'
        );
      }

      if (
        this.reversed &&
        !this.reversalEntryId
      ) {
        throw new Error(
          'A reversed ledger entry must reference its reversal entry.'
        );
      }

      if (
        !this.reversed &&
        this.reversalEntryId
      ) {
        throw new Error(
          'A non-reversed ledger entry cannot have reversalEntryId.'
        );
      }

      if (
        this.journalStatus === 'POSTED' &&
        this.posted !== true
      ) {
        throw new Error(
          'A POSTED journal line must have posted=true.'
        );
      }

      if (
        this.journalStatus !== 'POSTED' &&
        this.posted === true
      ) {
        throw new Error(
          'Only POSTED journal lines may have posted=true.'
        );
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
// All financial correction should happen through reversal journals.
// Existing ledger lines are never edited in place.
//
// =============================================================================

const immutableLedgerError = () => {
  const error = new Error(
    'Ledger entries are immutable and cannot be modified or deleted. ' +
      'Create a reversal journal instead.'
  );

  error.code = 'LEDGER_ENTRY_IMMUTABLE';
  error.statusCode = 409;

  return error;
};

ledgerEntrySchema.pre(
  'updateOne',
  function rejectUpdate() {
    throw immutableLedgerError();
  }
);

ledgerEntrySchema.pre(
  'updateMany',
  function rejectUpdate() {
    throw immutableLedgerError();
  }
);

ledgerEntrySchema.pre(
  'findOneAndUpdate',
  function rejectUpdate() {
    throw immutableLedgerError();
  }
);

ledgerEntrySchema.pre(
  'replaceOne',
  function rejectUpdate() {
    throw immutableLedgerError();
  }
);

ledgerEntrySchema.pre(
  'findOneAndReplace',
  function rejectUpdate() {
    throw immutableLedgerError();
  }
);

ledgerEntrySchema.pre(
  'deleteOne',
  function rejectDelete() {
    throw immutableLedgerError();
  }
);

ledgerEntrySchema.pre(
  'deleteMany',
  function rejectDelete() {
    throw immutableLedgerError();
  }
);

ledgerEntrySchema.pre(
  'findOneAndDelete',
  function rejectDelete() {
    throw immutableLedgerError();
  }
);

ledgerEntrySchema.pre(
  'findOneAndRemove',
  function rejectDelete() {
    throw immutableLedgerError();
  }
);

ledgerEntrySchema.pre(
  'remove',
  function rejectDelete() {
    throw immutableLedgerError();
  }
);

// =============================================================================
// Virtuals
// =============================================================================

ledgerEntrySchema.virtual('isDebit').get(
  function isDebit() {
    return this.entryType === 'DEBIT';
  }
);

ledgerEntrySchema.virtual('isCredit').get(
  function isCredit() {
    return this.entryType === 'CREDIT';
  }
);

// =============================================================================
// Static creation helpers
// =============================================================================

/**
 * Create one journal line.
 *
 * The caller must pass a MongoDB session when this entry belongs to a
 * transactional journal posting.
 */
ledgerEntrySchema.statics.createLine = async function (
  payload,
  {
    session = null,
  } = {}
) {
  if (!payload) {
    throw new Error(
      'Ledger entry payload is required.'
    );
  }

  const entry = new this({
    ...payload,
  });

  await entry.save(
    session
      ? { session }
      : undefined
  );

  return entry;
};

ledgerEntrySchema.statics.createDebit =
  function (
    payload,
    options = {}
  ) {
    return this.createLine(
      {
        ...payload,
        entryType: 'DEBIT',
      },
      options
    );
  };

ledgerEntrySchema.statics.createCredit =
  function (
    payload,
    options = {}
  ) {
    return this.createLine(
      {
        ...payload,
        entryType: 'CREDIT',
      },
      options
    );
  };

// =============================================================================
// Journal queries
// =============================================================================

/**
 * Retrieve one complete journal in deterministic line order.
 */
ledgerEntrySchema.statics.findJournal =
  async function (
    tenantId,
    journalId,
    {
      session = null,
    } = {}
  ) {
    if (!tenantId) {
      throw new Error(
        'tenantId is required.'
      );
    }

    if (!journalId) {
      throw new Error(
        'journalId is required.'
      );
    }

    const query = this.find({
      tenantId,
      journalId,
    })
      .sort({
        lineNumber: 1,
        _id: 1,
      });

    if (session) {
      query.session(session);
    }

    return query.exec();
  };

/**
 * Retrieve all ledger lines belonging to a canonical Transaction.
 */
ledgerEntrySchema.statics.findByTransaction =
  async function (
    tenantId,
    transactionId,
    {
      session = null,
    } = {}
  ) {
    if (!tenantId) {
      throw new Error(
        'tenantId is required.'
      );
    }

    if (!transactionId) {
      throw new Error(
        'transactionId is required.'
      );
    }

    const query = this.find({
      tenantId,
      transactionId,
    })
      .sort({
        journalId: 1,
        lineNumber: 1,
      });

    if (session) {
      query.session(session);
    }

    return query.exec();
  };

/**
 * Retrieve account activity.
 */
ledgerEntrySchema.statics.findAccountEntries =
  async function (
    tenantId,
    accountCode,
    {
      limit = 100,
      session = null,
    } = {}
  ) {
    const numericLimit = Math.min(
      Math.max(Number(limit) || 100, 1),
      500
    );

    const query = this.find({
      tenantId,
      accountCode: String(accountCode)
        .trim()
        .toUpperCase(),
      posted: true,
    })
      .sort({
        createdAt: -1,
        _id: -1,
      })
      .limit(numericLimit);

    if (session) {
      query.session(session);
    }

    return query.exec();
  };

/**
 * Basic journal-balance validator.
 *
 * This is a validation helper, NOT a replacement for the journal service.
 */
ledgerEntrySchema.statics.validateJournalBalance =
  function (entries) {
    if (
      !Array.isArray(entries) ||
      entries.length < 2
    ) {
      return {
        balanced: false,
        reason:
          'A double-entry journal requires at least two lines.',
        debitTotal: '0.00',
        creditTotal: '0.00',
      };
    }

    let debitTotal =
      mongoose.Types.Decimal128.fromString('0');
    let creditTotal =
      mongoose.Types.Decimal128.fromString('0');

    for (const entry of entries) {
      const amount = Number(
        entry.amount?.toString()
      );

      if (!Number.isFinite(amount)) {
        return {
          balanced: false,
          reason:
            `Invalid ledger amount on line ${entry.lineNumber}.`,
        };
      }

      if (entry.entryType === 'DEBIT') {
        debitTotal =
          mongoose.Types.Decimal128.fromString(
            (
              Number(debitTotal.toString()) +
              amount
            ).toFixed(2)
          );
      } else if (entry.entryType === 'CREDIT') {
        creditTotal =
          mongoose.Types.Decimal128.fromString(
            (
              Number(creditTotal.toString()) +
              amount
            ).toFixed(2)
          );
      } else {
        return {
          balanced: false,
          reason:
            `Invalid entry type on line ${entry.lineNumber}.`,
        };
      }
    }

    const debit =
      Number(debitTotal.toString());

    const credit =
      Number(creditTotal.toString());

    return {
      balanced:
        Math.abs(debit - credit) < 0.000001,

      debitTotal:
        debitTotal.toString(),

      creditTotal:
        creditTotal.toString(),

      difference:
        Math.abs(debit - credit).toFixed(2),
    };
  };

// =============================================================================
// Model
// =============================================================================

const LedgerEntry =
  mongoose.models.LedgerEntry ||
  mongoose.model(
    'LedgerEntry',
    ledgerEntrySchema
  );

export default LedgerEntry;

export {
  ENTRY_TYPES,
  ACCOUNT_TYPES,
  SOURCES,
  JOURNAL_STATUSES,
};