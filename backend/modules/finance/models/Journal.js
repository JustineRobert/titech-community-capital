// ============================================================================
// TITech Community Capital – Journal Model
// File: backend/modules/finance/models/Journal.js
// Production-grade
// ============================================================================

'use strict';

const mongoose = require('mongoose');
const crypto = require('crypto');

const { Schema } = mongoose;

/**
 * Helpers
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
 * Journal Schema
 *
 * - Lightweight audit record that groups ledger entries for a single business event
 * - Supports idempotency via paymentId and links to ledger entries for reconciliation
 */
const JournalSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },

    // Business reference (e.g., LoanRepayment)
    referenceType: { type: String, trim: true, maxlength: 128, index: true },
    referenceId: { type: Schema.Types.ObjectId, index: true },

    // Human readable description
    description: { type: String, trim: true, maxlength: 1024 },

    // Amount and currency for quick queries
    amount: {
      type: Schema.Types.Decimal128,
      required: true,
      get: fromDecimal128,
      set: toDecimal128,
    },
    currency: { type: String, default: 'UGX', uppercase: true, trim: true, maxlength: 3, index: true },

    // Idempotency key (payment/gateway id)
    paymentId: { type: String, trim: true, index: true },

    // Links to created ledger entries (array of ObjectId)
    ledgerEntryIds: [{ type: Schema.Types.ObjectId, ref: 'LedgerEntry' }],

    // Optional external provider info
    provider: { type: String, trim: true, uppercase: true },
    momoTransactionId: { type: String, trim: true },

    // Audit
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    metadata: { type: Schema.Types.Mixed, default: {} },

    // Soft delete
    deletedAt: { type: Date, default: null, index: true },

    // Posting lifecycle
    journalId: { type: String, required: true, unique: true, index: true },
    journalType: {
      type: String,
      enum: [
        'SAVINGS_DEPOSIT',
        'SAVINGS_WITHDRAWAL',
        'LOAN_DISBURSEMENT',
        'LOAN_REPAYMENT',
        'INTEREST_ACCRUAL',
        'PENALTY',
        'FEE',
        'MOMO_SETTLEMENT',
        'AIRTEL_SETTLEMENT',
        'ADJUSTMENT',
        'REVERSAL',
        'WRITE_OFF'
      ],
      required: true,
      index: true
    },
    status: {
      type: String,
      enum: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'REVERSED', 'CANCELLED'],
      default: 'DRAFT',
      index: true
    },
    reconciliationStatus: {
      type: String,
      enum: ['PENDING', 'MATCHED', 'DISPUTED', 'RECONCILED'],
      default: 'PENDING',
      index: true
    },
    reconciledAt: Date,
    reconciledBy: { type: Schema.Types.ObjectId, ref: 'User' },

    reversed: { type: Boolean, default: false },
    reversalJournalId: { type: String, default: null },

    workflowHistoryId: { type: Schema.Types.ObjectId, ref: 'LoanWorkflowHistory', default: null },

    // Blockchain-style integrity
    previousHash: { type: String, default: null, index: true },
    hash: { type: String, required: true, index: true },

    reportingPeriod: { type: String, default: null }
  },
  {
    timestamps: true,
    toJSON: { getters: true, virtuals: true },
    toObject: { getters: true, virtuals: true },
    autoIndex: process.env.NODE_ENV !== 'production'
  }
);

/**
 * Indexes
 */
JournalSchema.index({ tenantId: 1, paymentId: 1 }, { unique: true, partialFilterExpression: { paymentId: { $exists: true } } });
JournalSchema.index({ tenantId: 1, journalType: 1, createdAt: -1 });
JournalSchema.index({ tenantId: 1, reconciliationStatus: 1 });
JournalSchema.index({ tenantId: 1, status: 1 });
JournalSchema.index({ tenantId: 1, referenceType: 1, referenceId: 1 });

/**
 * Pre-save hook
 *
 * - Ensure journalId exists
 * - Compute a content hash for integrity (includes tenantId, reference, amount, currency, paymentId, createdAt)
 */
JournalSchema.pre('validate', function (next) {
  if (!this.journalId) {
    // Simple unique id: prefix + timestamp + random hex
    this.journalId = `JNL-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  }
  next();
});

JournalSchema.pre('save', async function (next) {
  try {
    // Normalize currency
    if (this.currency) this.currency = String(this.currency).toUpperCase();

    // Compute hash of core fields for tamper-evidence
    const hashPayload = {
      tenantId: String(this.tenantId || ''),
      journalId: this.journalId,
      referenceType: this.referenceType || '',
      referenceId: String(this.referenceId || ''),
      amount: this.amount ? this.amount.toString() : '0.00',
      currency: this.currency || 'UGX',
      paymentId: this.paymentId || '',
      createdAt: this.createdAt ? this.createdAt.toISOString() : new Date().toISOString(),
      previousHash: this.previousHash || ''
    };
    const h = crypto.createHash('sha256');
    h.update(JSON.stringify(hashPayload));
    this.hash = h.digest('hex');
    next();
  } catch (err) {
    next(err);
  }
});

/**
 * Instance methods
 */

// Soft delete
JournalSchema.methods.softDelete = async function () {
  if (!this.deletedAt) {
    this.deletedAt = new Date();
    await this.save();
  }
  return this;
};

// Mark as posted (idempotent)
JournalSchema.methods.markPosted = async function (postedBy) {
  if (this.status === 'POSTED') return this;
  this.status = 'POSTED';
  this.postedBy = postedBy || this.postedBy;
  this.postedAt = new Date();
  await this.save();
  return this;
};

// Mark as reconciled
JournalSchema.methods.markReconciled = async function (reconciledBy) {
  this.reconciliationStatus = 'RECONCILED';
  this.reconciledAt = new Date();
  this.reconciledBy = reconciledBy || this.reconciledBy;
  await this.save();
  return this;
};

/**
 * Static helpers
 */

// Create a journal with ledger links in a session-safe way
JournalSchema.statics.createWithLedger = async function (doc, ledgerEntryIds = [], opts = {}) {
  const session = opts.session || null;
  const journalDoc = await this.create([{
    ...doc,
    ledgerEntryIds
  }], { session });
  return journalDoc[0];
};

// Verify that linked ledger entries sum to the journal amount (requires LedgerEntry model)
JournalSchema.statics.verifyLedgerBalance = async function (journalId, opts = {}) {
  const session = opts.session || null;
  const Journal = this;
  const journal = await Journal.findOne({ _id: journalId }).session(session);
  if (!journal) throw new Error('Journal not found');

  if (!journal.ledgerEntryIds || !journal.ledgerEntryIds.length) {
    throw new Error('No ledger entries linked to journal');
  }

  // Lazy require to avoid circular deps at module load time
  const LedgerEntry = require('./LedgerEntry');

  const agg = await LedgerEntry.aggregate([
    { $match: { _id: { $in: journal.ledgerEntryIds.map((id) => mongoose.Types.ObjectId(id)) }, deletedAt: null } },
    {
      $group: {
        _id: null,
        totalDebit: { $sum: { $toDouble: '$debit' } },
        totalCredit: { $sum: { $toDouble: '$credit' } }
      }
    }
  ]).session(session);

  const totals = agg && agg.length ? agg[0] : { totalDebit: 0, totalCredit: 0 };
  const balance = Number(totals.totalDebit || 0) - Number(totals.totalCredit || 0);
  const journalAmount = journal.amount ? parseFloat(journal.amount.toString()) : 0;

  return {
    balanced: Math.abs(balance - journalAmount) < 1e-8,
    debit: totals.totalDebit || 0,
    credit: totals.totalCredit || 0,
    journalAmount
  };
};

/**
 * Export model
 */
const Journal = mongoose.models.Journal || mongoose.model('Journal', JournalSchema);
module.exports = Journal;
