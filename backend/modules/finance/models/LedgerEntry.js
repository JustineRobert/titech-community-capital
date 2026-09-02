// ============================================================================
// TITech Community Capital – LedgerEntry Model
// File: backend/modules/finance/models/LedgerEntry.js
// Production-grade
// ============================================================================

'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Helpers for Decimal128
 */
function toDecimal128(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return mongoose.Types.Decimal128.fromString('0.00');
  return mongoose.Types.Decimal128.fromString(n.toFixed(2));
}
function fromDecimal128(value) {
  return value ? parseFloat(value.toString()) : 0;
}

/**
 * Schema
 */
const LedgerEntrySchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: [true, 'tenantId is required'],
      index: true,
    },

    journalId: {
      type: Schema.Types.ObjectId,
      ref: 'Journal',
      default: null,
      index: true,
    },

    entryDate: {
      type: Date,
      default: Date.now,
      index: true,
    },

    // GL account reference (use accountCode for human readable mapping)
    accountCode: {
      type: String,
      required: [true, 'accountCode is required'],
      trim: true,
      index: true,
    },

    // Amounts stored as Decimal128 for precision
    debit: {
      type: Schema.Types.Decimal128,
      default: mongoose.Types.Decimal128.fromString('0.00'),
      get: fromDecimal128,
      set: toDecimal128,
    },
    credit: {
      type: Schema.Types.Decimal128,
      default: mongoose.Types.Decimal128.fromString('0.00'),
      get: fromDecimal128,
      set: toDecimal128,
    },

    // Business references
    referenceType: { type: String, trim: true, maxlength: 128, index: true },
    referenceId: { type: Schema.Types.ObjectId, index: true },

    currency: {
      type: String,
      default: 'UGX',
      uppercase: true,
      trim: true,
      maxlength: 3,
      index: true,
    },

    description: { type: String, trim: true, maxlength: 1024 },

    // External integration fields
    momoTransactionId: { type: String, trim: true, maxlength: 128, index: true },
    provider: { type: String, trim: true, uppercase: true },

    // Distributed tracing / request correlation
    requestId: { type: String, trim: true, index: true },

    // Soft delete
    deletedAt: { type: Date, default: null, index: true },

    // Audit metadata
    metadata: { type: Schema.Types.Mixed, default: {} },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    versionKey: 'version',
    toJSON: { getters: true },
    toObject: { getters: true },
    autoIndex: process.env.NODE_ENV !== 'production',
  }
);

/**
 * Indexes
 */
LedgerEntrySchema.index({ tenantId: 1, referenceType: 1, referenceId: 1 });
LedgerEntrySchema.index({ tenantId: 1, accountCode: 1, entryDate: -1 });
LedgerEntrySchema.index({ tenantId: 1, currency: 1, deletedAt: 1 });

/**
 * Hooks
 */
LedgerEntrySchema.pre('save', function (next) {
  if (this.currency) this.currency = String(this.currency).toUpperCase();
  if (this.accountCode) this.accountCode = String(this.accountCode).trim();
  // Ensure only one of debit/credit is positive (or both zero for adjustments)
  const debit = fromDecimal128(this.debit);
  const credit = fromDecimal128(this.credit);
  if (debit < 0 || credit < 0) {
    return next(new Error('Debit and credit must be non-negative'));
  }
  next();
});

/**
 * Instance methods
 */
LedgerEntrySchema.methods.isDeleted = function () {
  return !!this.deletedAt;
};

LedgerEntrySchema.methods.softDelete = async function () {
  if (!this.deletedAt) {
    this.deletedAt = new Date();
    await this.save();
  }
  return this;
};

/**
 * Static helpers
 */

/**
 * Validate that a set of entries balances (debits == credits).
 * Uses Decimal128 -> Number conversion; for extremely large/precise systems
 * consider using a dedicated decimal library.
 */
LedgerEntrySchema.statics.validateDoubleEntry = function (entries) {
  const sum = (arr, key) =>
    arr.reduce((acc, e) => acc + Number((e[key] && e[key].toString) ? parseFloat(e[key].toString()) : Number(e[key] || 0)), 0);

  const debitTotal = sum(entries, 'debit');
  const creditTotal = sum(entries, 'credit');

  // Use a tolerance for floating rounding safety (should be zero with Decimal128)
  const EPS = 1e-8;
  if (Math.abs(debitTotal - creditTotal) > EPS) {
    throw new Error(`Ledger imbalance: debit (${debitTotal}) !== credit (${creditTotal})`);
  }
};

/**
 * Post a balanced transaction (creates two or more ledger lines) within an optional session.
 * Accepts an array of entry objects:
 *  [{ tenantId, accountCode, debit, credit, currency, referenceType, referenceId, description, requestId, provider, momoTransactionId, metadata }]
 *
 * If session is provided, the writes will be executed in that session (transaction).
 */
LedgerEntrySchema.statics.postEntries = async function (entries, opts = {}) {
  if (!Array.isArray(entries) || entries.length < 2) {
    throw new Error('At least two ledger entries are required for double-entry posting');
  }

  // Normalize amounts to Decimal128 and ensure structure
  const normalized = entries.map((e) => ({
    tenantId: e.tenantId,
    journalId: e.journalId || null,
    entryDate: e.entryDate || new Date(),
    accountCode: e.accountCode,
    debit: toDecimal128(e.debit || 0),
    credit: toDecimal128(e.credit || 0),
    currency: (e.currency || 'UGX').toUpperCase(),
    referenceType: e.referenceType || null,
    referenceId: e.referenceId || null,
    description: e.description || null,
    requestId: e.requestId || null,
    provider: e.provider || null,
    momoTransactionId: e.momoTransactionId || null,
    metadata: e.metadata || {},
    createdBy: e.createdBy || null,
  }));

  // Validate double-entry
  this.validateDoubleEntry(normalized);

  // Insert within session if provided
  const session = opts.session || null;
  return this.insertMany(normalized, { session });
};

/**
 * Convenience: postTransaction - common two-line debit/credit helper
 *
 * params:
 *  - tenantId
 *  - debitAccountCode
 *  - creditAccountCode
 *  - amount
 *  - currency
 *  - referenceType
 *  - referenceId
 *  - description
 *  - requestId
 *  - metadata
 *  - session (optional)
 */
LedgerEntrySchema.statics.postTransaction = async function ({
  tenantId,
  debitAccountCode,
  creditAccountCode,
  amount,
  currency = 'UGX',
  referenceType = null,
  referenceId = null,
  description = null,
  requestId = null,
  provider = null,
  momoTransactionId = null,
  metadata = {},
  journalId = null,
  session = null,
}) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('Amount must be a positive number');

  const entries = [
    {
      tenantId,
      journalId,
      accountCode: debitAccountCode,
      debit: amt,
      credit: 0,
      currency,
      referenceType,
      referenceId,
      description,
      requestId,
      provider,
      momoTransactionId,
      metadata,
    },
    {
      tenantId,
      journalId,
      accountCode: creditAccountCode,
      debit: 0,
      credit: amt,
      currency,
      referenceType,
      referenceId,
      description,
      requestId,
      provider,
      momoTransactionId,
      metadata,
    },
  ];

  return this.postEntries(entries, { session });
};

/**
 * Reporting helpers
 */

// Trial balance grouped by accountCode
LedgerEntrySchema.statics.getTrialBalance = async function (tenantId) {
  return this.aggregate([
    { $match: { tenantId: mongoose.Types.ObjectId(tenantId), deletedAt: null } },
    {
      $group: {
        _id: '$accountCode',
        totalDebit: { $sum: { $toDouble: '$debit' } },
        totalCredit: { $sum: { $toDouble: '$credit' } },
      },
    },
    {
      $project: {
        accountCode: '$_id',
        _id: 0,
        totalDebit: 1,
        totalCredit: 1,
        balance: { $subtract: ['$totalDebit', '$totalCredit'] },
      },
    },
  ]);
};

// Account balance (debit - credit)
LedgerEntrySchema.statics.getAccountBalance = async function (tenantId, accountCode) {
  const result = await this.aggregate([
    {
      $match: {
        tenantId: mongoose.Types.ObjectId(tenantId),
        accountCode,
        deletedAt: null,
      },
    },
    {
      $group: {
        _id: '$accountCode',
        totalDebit: { $sum: { $toDouble: '$debit' } },
        totalCredit: { $sum: { $toDouble: '$credit' } },
      },
    },
    {
      $project: {
        _id: 0,
        accountCode: '$_id',
        balance: { $subtract: ['$totalDebit', '$totalCredit'] },
      },
    },
  ]);

  return result.length ? result[0].balance : 0;
};

/**
 * Export model
 */
const LedgerEntry = mongoose.models.LedgerEntry || mongoose.model('LedgerEntry', LedgerEntrySchema);

module.exports = LedgerEntry;
