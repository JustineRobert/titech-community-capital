/**
 * =============================================================================
 * TITech Community Capital Ltd
 * Canonical Financial Ledger Entry
 * =============================================================================
 *
 * Architectural role
 * -----------------------------------------------------------------------------
 * One persisted journal line for the canonical financial-infrastructure path.
 * This model is intentionally aligned with the FinancialLedgerRepository
 * contract: string tenant identity, string financial transaction identity and
 * explicit account identity. It is separate from the legacy LedgerEntry model
 * while migration/consolidation evidence is still incomplete.
 *
 * Source-of-truth boundary
 * -----------------------------------------------------------------------------
 * FinancialTransaction      = canonical business transaction
 * FinancialLedgerEntry      = immutable accounting journal line
 * Account                   = operational balance projection
 *
 * A posted financial operation MUST contain a balanced batch of these lines.
 * Individual controllers/services MUST NOT persist entries directly.
 *
 * Module format: native ESM.
 * =============================================================================
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

const DIRECTIONS = Object.freeze(['DEBIT', 'CREDIT']);

const ENTRY_TYPE_PATTERN = /^[A-Z][A-Z0-9_.:-]{0,127}$/;

const SOURCE_PATTERN = /^[A-Z][A-Z0-9_.:-]{0,63}$/;

function validateObject(value, fieldName) {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8') <= 32 * 1024;
  } catch {
    throw new Error(`${fieldName} must be JSON serializable.`);
  }
}

const financialLedgerEntrySchema = new Schema(
  {
    tenantId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      minlength: 1,
      maxlength: 128,
      index: true,
    },

    financialTransactionId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      minlength: 1,
      maxlength: 256,
      index: true,
    },

    journalId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      minlength: 1,
      maxlength: 256,
      index: true,
    },

    lineNumber: {
      type: Number,
      required: true,
      immutable: true,
      min: 1,
      validate: {
        validator: Number.isSafeInteger,
        message: 'lineNumber must be a safe integer greater than zero.',
      },
      index: true,
    },

    accountId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      minlength: 1,
      maxlength: 256,
      index: true,
    },

    accountCode: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 128,
      immutable: true,
      default: null,
    },

    accountName: {
      type: String,
      trim: true,
      maxlength: 256,
      immutable: true,
      default: null,
    },

    accountType: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 64,
      immutable: true,
      default: null,
    },

    amount: {
      type: Schema.Types.Decimal128,
      required: true,
      immutable: true,
      validate: {
        validator(value) {
          const raw = value?.toString?.();
          return typeof raw === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw) && raw !== '0';
        },
        message: 'Ledger amount must be a positive exact decimal.',
      },
    },

    currency: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
      match: /^[A-Z]{3}$/,
      index: true,
    },

    entryType: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
      maxlength: 128,
      validate: {
        validator(value) {
          return ENTRY_TYPE_PATTERN.test(value);
        },
        message: 'Invalid financial ledger entry type.',
      },
      index: true,
    },

    direction: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
      enum: DIRECTIONS,
      index: true,
    },

    source: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      uppercase: true,
      maxlength: 64,
      default: 'SYSTEM',
      validate: {
        validator(value) {
          return SOURCE_PATTERN.test(value);
        },
        message: 'Invalid ledger source.',
      },
      index: true,
    },

    sourceId: {
      type: String,
      immutable: true,
      trim: true,
      maxlength: 256,
      default: null,
      index: true,
    },

    providerReference: {
      type: String,
      immutable: true,
      trim: true,
      maxlength: 256,
      default: null,
      index: true,
    },

    externalId: {
      type: String,
      immutable: true,
      trim: true,
      maxlength: 256,
      default: null,
      index: true,
    },

    userId: {
      type: String,
      immutable: true,
      trim: true,
      maxlength: 256,
      default: null,
      index: true,
    },

    groupId: {
      type: String,
      immutable: true,
      trim: true,
      maxlength: 256,
      default: null,
      index: true,
    },

    loanId: {
      type: String,
      immutable: true,
      trim: true,
      maxlength: 256,
      default: null,
      index: true,
    },

    savingsAccountId: {
      type: String,
      immutable: true,
      trim: true,
      maxlength: 256,
      default: null,
      index: true,
    },

    walletId: {
      type: String,
      immutable: true,
      trim: true,
      maxlength: 256,
      default: null,
      index: true,
    },

    posted: {
      type: Boolean,
      required: true,
      immutable: true,
      default: true,
      index: true,
    },

    reversed: {
      type: Boolean,
      required: true,
      immutable: true,
      default: false,
      index: true,
    },

    reversalEntryId: {
      type: Schema.Types.ObjectId,
      immutable: true,
      default: null,
      index: true,
    },

    description: {
      type: String,
      immutable: true,
      trim: true,
      maxlength: 2000,
      default: null,
    },

    notes: {
      type: String,
      immutable: true,
      trim: true,
      maxlength: 5000,
      default: null,
    },

    correlationId: {
      type: String,
      immutable: true,
      trim: true,
      maxlength: 256,
      default: null,
      index: true,
    },

    metadata: {
      type: Schema.Types.Mixed,
      immutable: true,
      default: {},
      validate: {
        validator(value) {
          return validateObject(value, 'metadata');
        },
        message: 'Ledger metadata must be a JSON object no larger than 32KB.',
      },
    },
  },
  {
    collection: 'financial_ledger_entries',
    timestamps: true,
    strict: 'throw',
    optimisticConcurrency: true,
    minimize: false,
  },
);

financialLedgerEntrySchema.index(
  { tenantId: 1, financialTransactionId: 1, lineNumber: 1 },
  {
    unique: true,
    name: 'uq_financial_ledger_transaction_line',
  },
);

financialLedgerEntrySchema.index(
  { tenantId: 1, accountId: 1, createdAt: -1 },
  { name: 'ix_financial_ledger_account_time' },
);

financialLedgerEntrySchema.index(
  { tenantId: 1, providerReference: 1 },
  { sparse: true, name: 'uq_financial_ledger_provider_reference' },
);

financialLedgerEntrySchema.pre('save', function immutableGuard(next) {
  if (!this.isNew) {
    const immutablePaths = [
      'tenantId',
      'financialTransactionId',
      'journalId',
      'lineNumber',
      'accountId',
      'amount',
      'currency',
      'entryType',
      'direction',
      'source',
      'sourceId',
      'providerReference',
      'externalId',
      'posted',
      'reversed',
      'reversalEntryId',
      'metadata',
    ];
    for (const field of immutablePaths) {
      if (this.isModified(field)) {
        return next(new Error(`Posted financial ledger field is immutable: ${field}`));
      }
    }
  }
  return next();
});

const FinancialLedgerEntry = mongoose.model(
  'FinancialLedgerEntry',
  financialLedgerEntrySchema,
);

export { DIRECTIONS };
export default FinancialLedgerEntry;
