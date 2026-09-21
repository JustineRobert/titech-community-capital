// ============================================================================
// backend/models/FinancialTransaction.js
// ============================================================================
// TITech Community Capital LTD
// Canonical Financial Transaction Record
//
// This model is deliberately separate from Transaction.js. Transaction.js is
// the business/payment lifecycle record; this model is the append-only record
// used by the atomic financial operation service and its repositories.
// ============================================================================

import mongoose from 'mongoose';

const { Schema } = mongoose;

export const FINANCIAL_TRANSACTION_STATUSES = Object.freeze([
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'REVERSED',
  'CANCELLED',
]);

const IDENTIFIER_PATTERN = /^[a-zA-Z0-9._:-]+$/;
const CURRENCY_PATTERN = /^[A-Z]{3,16}$/;
const DECIMAL_PATTERN = /^(?:\d+(?:\.\d+)?|\.\d+)$/;

function normalizeIdentifier(value, field, maxLength) {
  if (value === undefined || value === null) {
    throw new TypeError(`${field} is required.`);
  }
  const normalized = String(value).trim();
  if (!normalized || normalized.length > maxLength || !IDENTIFIER_PATTERN.test(normalized)) {
    throw new TypeError(`${field} is invalid.`);
  }
  return normalized;
}

function normalizePositiveDecimal(value) {
  if (value instanceof mongoose.Types.Decimal128) {
    const text = value.toString();
    if (!DECIMAL_PATTERN.test(text) || /^0+(?:\.0+)?$/.test(text)) {
      throw new TypeError('Amount must be a positive canonical decimal.');
    }
    return value;
  }

  if (value === undefined || value === null) {
    throw new TypeError('Amount is required.');
  }

  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new TypeError('Financial amounts must use Decimal128 or exact decimal strings.');
  }

  const text = String(value).trim();
  if (!DECIMAL_PATTERN.test(text) || /^0+(?:\.0+)?$/.test(text)) {
    throw new TypeError('Amount must be a positive canonical decimal.');
  }

  return mongoose.Types.Decimal128.fromString(text);
}

const metadataSchema = new Schema(
  {},
  {
    _id: false,
    strict: false,
  },
);

const financialTransactionSchema = new Schema(
  {
    transactionId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
      immutable: true,
      index: true,
    },

    tenantId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 64,
      immutable: true,
      index: true,
    },

    principalId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
      immutable: true,
      index: true,
    },

    operation: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
      immutable: true,
      index: true,
    },

    resource: {
      type: String,
      required: true,
      trim: true,
      maxlength: 256,
      immutable: true,
      index: true,
    },

    amount: {
      type: Schema.Types.Decimal128,
      required: true,
      immutable: true,
      validate: {
        validator: (value) => {
          try {
            normalizePositiveDecimal(value);
            return true;
          } catch {
            return false;
          }
        },
        message: 'Amount must be a positive monetary Decimal128 value.',
      },
    },

    currency: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      minlength: 3,
      maxlength: 16,
      immutable: true,
      index: true,
      validate: {
        validator: (value) => CURRENCY_PATTERN.test(String(value || '').toUpperCase()),
        message: 'Currency must be a valid uppercase currency code.',
      },
    },

    status: {
      type: String,
      required: true,
      enum: FINANCIAL_TRANSACTION_STATUSES,
      default: 'PENDING',
      trim: true,
      uppercase: true,
      index: true,
    },

    metadata: {
      type: metadataSchema,
      default: () => ({}),
      immutable: true,
    },

    completionMetadata: {
      type: metadataSchema,
      default: undefined,
    },

    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    collection: 'financial_transactions',
    timestamps: true,
    strict: 'throw',
    optimisticConcurrency: true,
    minimize: false,
  },
);

financialTransactionSchema.pre('validate', function validateFinancialTransaction(next) {
  try {
    normalizeIdentifier(this.transactionId, 'transactionId', 128);
    normalizeIdentifier(this.tenantId, 'tenantId', 64);
    normalizeIdentifier(this.principalId, 'principalId', 128);
    normalizeIdentifier(this.operation, 'operation', 128);
    normalizeIdentifier(this.resource, 'resource', 256);
    normalizePositiveDecimal(this.amount);

    const currency = String(this.currency || '').trim().toUpperCase();
    if (!CURRENCY_PATTERN.test(currency)) {
      throw new TypeError('currency is invalid.');
    }
    this.currency = currency;
    next();
  } catch (error) {
    next(error);
  }
});

financialTransactionSchema.index(
  { tenantId: 1, transactionId: 1 },
  { unique: true, name: 'uq_financial_transactions_tenant_transaction_id' },
);

financialTransactionSchema.index(
  { tenantId: 1, principalId: 1, operation: 1, createdAt: -1 },
  { name: 'idx_financial_transactions_tenant_principal_operation' },
);

financialTransactionSchema.index(
  { tenantId: 1, status: 1, createdAt: -1 },
  { name: 'idx_financial_transactions_tenant_status_created' },
);

financialTransactionSchema.index(
  { tenantId: 1, resource: 1, createdAt: -1 },
  { name: 'idx_financial_transactions_tenant_resource_created' },
);

financialTransactionSchema.pre('save', function protectImmutableFinancialIdentity(next) {
  if (!this.isNew) {
    const protectedPaths = [
      'transactionId',
      'tenantId',
      'principalId',
      'operation',
      'resource',
      'amount',
      'currency',
      'metadata',
    ];

    const changed = protectedPaths.find((path) => this.isModified(path));
    if (changed) {
      return next(new Error(`Financial transaction field "${changed}" is immutable.`));
    }
  }

  return next();
});

financialTransactionSchema.methods.toSafeJSON = function toSafeJSON() {
  const value = this.toObject({ versionKey: false });
  if (value.amount) {
    value.amount = value.amount.toString();
  }
  return value;
};

const FinancialTransaction =
  mongoose.models.FinancialTransaction ||
  mongoose.model('FinancialTransaction', financialTransactionSchema);

export { financialTransactionSchema };
export default FinancialTransaction;
