// backend/modules/finance/models/Transaction.js

'use strict';

const mongoose = require('mongoose');
const crypto = require('crypto');
const uniqueValidator = require('mongoose-unique-validator');

const { Schema } = mongoose;

/**
 * ENUMS
 */

const TRANSACTION_STATUS = [
  'PENDING',
  'POSTED',
  'FAILED',
  'REVERSED'
];

const TRANSACTION_TYPES = [
  'TRANSFER',
  'DEPOSIT',
  'WITHDRAWAL',
  'ADJUSTMENT',
  'LOAN_DISBURSEMENT',
  'LOAN_REPAYMENT',
  'INTEREST_ACCRUAL',
  'SAVINGS_CONTRIBUTION',
  'SHARE_PURCHASE',
  'PENALTY',
  'WRITE_OFF',
  'RECOVERY'
];

const RECONCILIATION_STATUS = [
  'PENDING',
  'MATCHED',
  'DISPUTED',
  'RECONCILED'
];

const SETTLEMENT_STATUS = [
  'PENDING',
  'PROCESSING',
  'SETTLED',
  'FAILED'
];

const APPROVAL_STATUS = [
  'NOT_REQUIRED',
  'PENDING',
  'APPROVED',
  'REJECTED'
];

const AML_RISK_LEVELS = [
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL'
];

const PROVIDER_STATUS = [
  'INITIATED',
  'PENDING',
  'SUCCESSFUL',
  'FAILED',
  'REVERSED'
];

/**
 * SCHEMA
 */

const TransactionSchema = new Schema(
  {
    /**
     * Multi-Tenant Isolation
     */
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true
    },

    /**
     * Identity
     */
    reference: {
      type: String,
      required: true,
      trim: true,
      uppercase: true
    },

    transactionId: {
      type: String,
      trim: true,
      index: true
    },

    /**
     * Idempotency Key
     */
    idempotencyKey: {
      type: String,
      trim: true,
      sparse: true,
      index: true
    },

    /**
     * Classification
     */
    type: {
      type: String,
      enum: TRANSACTION_TYPES,
      required: true,
      uppercase: true
    },

    /**
     * Wallet Layer
     */
    fromWallet: {
      type: Schema.Types.ObjectId,
      ref: 'Wallet',
      index: true,
      default: null
    },

    toWallet: {
      type: Schema.Types.ObjectId,
      ref: 'Wallet',
      index: true,
      default: null
    },

    /**
     * Ledger Layer
     */
    debitAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'Account',
      index: true
    },

    creditAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'Account',
      index: true
    },

    /**
     * Journal Integration
     */
    journalId: {
      type: Schema.Types.ObjectId,
      ref: 'Journal',
      default: null,
      index: true
    },

    /**
     * Loan Integration
     */
    loanId: {
      type: Schema.Types.ObjectId,
      ref: 'Loan',
      default: null,
      index: true
    },

    /**
     * Savings Integration
     */
    savingsAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'SavingsAccount',
      default: null,
      index: true
    },

    /**
     * Workflow Integration
     */
    workflowHistoryId: {
      type: Schema.Types.ObjectId,
      ref: 'LoanWorkflowHistory',
      default: null
    },

    /**
     * Amounts
     */
    amount: {
      type: Schema.Types.Decimal128,
      required: true,
      get: v => (v ? parseFloat(v.toString()) : 0),
      set: v =>
        mongoose.Types.Decimal128.fromString(
          Number(v || 0).toFixed(2)
        )
    },

    fee: {
      type: Schema.Types.Decimal128,
      default: mongoose.Types.Decimal128.fromString('0.00'),
      get: v => (v ? parseFloat(v.toString()) : 0),
      set: v =>
        mongoose.Types.Decimal128.fromString(
          Number(v || 0).toFixed(2)
        )
    },

    taxAmount: {
      type: Schema.Types.Decimal128,
      default: mongoose.Types.Decimal128.fromString('0.00')
    },

    currency: {
      type: String,
      default: 'UGX',
      uppercase: true,
      trim: true
    },

    /**
     * Lifecycle
     */
    status: {
      type: String,
      enum: TRANSACTION_STATUS,
      default: 'PENDING',
      index: true
    },

    /**
     * Reconciliation
     */
    reconciliationStatus: {
      type: String,
      enum: RECONCILIATION_STATUS,
      default: 'PENDING',
      index: true
    },

    reconciledAt: {
      type: Date,
      default: null
    },

    reconciledBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },

    /**
     * Settlement
     */
    settlementStatus: {
      type: String,
      enum: SETTLEMENT_STATUS,
      default: 'PENDING',
      index: true
    },

    settledAt: {
      type: Date,
      default: null
    },

    /**
     * Approval Workflow
     */
    approvalStatus: {
      type: String,
      enum: APPROVAL_STATUS,
      default: 'NOT_REQUIRED'
    },

    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },

    approvedAt: {
      type: Date,
      default: null
    },

    /**
     * Mobile Money / Bank
     */
    provider: {
      type: String,
      uppercase: true,
      trim: true
    },

    providerTransactionId: {
      type: String,
      trim: true,
      index: true
    },

    externalReference: {
      type: String,
      trim: true
    },

    providerStatus: {
      type: String,
      enum: PROVIDER_STATUS,
      default: 'INITIATED'
    },

    providerResponse: {
      type: Schema.Types.Mixed,
      default: {}
    },

    callbackReceivedAt: {
      type: Date,
      default: null
    },

    /**
     * AML
     */
    amlFlagged: {
      type: Boolean,
      default: false,
      index: true
    },

    amlRiskLevel: {
      type: String,
      enum: AML_RISK_LEVELS,
      default: 'LOW'
    },

    amlReason: String,

    /**
     * Fraud
     */
    fraudFlagged: {
      type: Boolean,
      default: false,
      index: true
    },

    fraudScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },

    /**
     * Distributed Tracing
     */
    requestId: {
      type: String,
      index: true
    },

    correlationId: {
      type: String,
      index: true
    },

    /**
     * Reversal
     */
    isReversed: {
      type: Boolean,
      default: false,
      index: true
    },

    reversedTransactionId: {
      type: Schema.Types.ObjectId,
      ref: 'Transaction',
      default: null
    },

    /**
     * Description
     */
    description: {
      type: String,
      trim: true,
      maxlength: 512
    },

    /**
     * Blockchain-style Integrity
     */
    previousHash: {
      type: String,
      default: null,
      index: true
    },

    hash: {
      type: String,
      default: null,
      index: true
    },

    /**
     * Metadata
     */
    metadata: {
      type: Schema.Types.Mixed,
      default: {}
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },

    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    }
  },
  {
    timestamps: true,
    versionKey: 'version',
    toJSON: { getters: true },
    toObject: { getters: true }
  }
);

/**
 * INDEXES
 */

TransactionSchema.index(
  { tenantId: 1, reference: 1 },
  { unique: true, name: 'tenant_reference_unique' }
);

TransactionSchema.index(
  { tenantId: 1, idempotencyKey: 1 },
  {
    unique: true,
    sparse: true,
    name: 'tenant_idempotency_unique'
  }
);

TransactionSchema.index({ tenantId: 1, status: 1 });
TransactionSchema.index({ tenantId: 1, type: 1 });
TransactionSchema.index({ tenantId: 1, journalId: 1 });
TransactionSchema.index({ tenantId: 1, loanId: 1 });
TransactionSchema.index({ tenantId: 1, savingsAccountId: 1 });

TransactionSchema.index({
  tenantId: 1,
  reconciliationStatus: 1
});

TransactionSchema.index({
  tenantId: 1,
  settlementStatus: 1
});

TransactionSchema.index({
  tenantId: 1,
  amlFlagged: 1
});

TransactionSchema.index({
  tenantId: 1,
  fraudFlagged: 1
});

/**
 * HASH INTEGRITY
 */

TransactionSchema.pre('save', function(next) {

  if (this.status)
    this.status = this.status.toUpperCase();

  if (this.type)
    this.type = this.type.toUpperCase();

  if (this.currency)
    this.currency = this.currency.toUpperCase();

  const payload = JSON.stringify({
    tenantId: this.tenantId,
    reference: this.reference,
    amount: this.amount?.toString(),
    status: this.status,
    type: this.type,
    previousHash: this.previousHash
  });

  this.hash = crypto
    .createHash('sha256')
    .update(payload)
    .digest('hex');

  next();
});

/**
 * INSTANCE METHODS
 */

TransactionSchema.methods.markPosted =
  async function() {

    this.status = 'POSTED';

    return this.save();
  };

TransactionSchema.methods.markFailed =
  async function(reason = null) {

    this.status = 'FAILED';

    this.metadata = {
      ...this.metadata,
      failureReason: reason
    };

    return this.save();
  };

TransactionSchema.methods.reverse =
  async function(reversalTxId) {

    this.status = 'REVERSED';
    this.isReversed = true;
    this.reversedTransactionId = reversalTxId;

    this.metadata = {
      ...this.metadata,
      reversedAt: new Date()
    };

    return this.save();
  };

TransactionSchema.methods.markReconciled =
  async function(userId) {

    this.reconciliationStatus = 'RECONCILED';
    this.reconciledAt = new Date();
    this.reconciledBy = userId;

    return this.save();
  };

TransactionSchema.methods.flagAML =
  async function(reason, level = 'HIGH') {

    this.amlFlagged = true;
    this.amlReason = reason;
    this.amlRiskLevel = level;

    return this.save();
  };

TransactionSchema.methods.flagFraud =
  async function(score = 100) {

    this.fraudFlagged = true;
    this.fraudScore = score;

    return this.save();
  };

/**
 * STATIC METHODS
 */

TransactionSchema.statics.getTenantTransactions =
  function(tenantId) {

    return this.find({ tenantId })
      .sort({ createdAt: -1 });
  };

TransactionSchema.statics.getPending =
  function(tenantId) {

    return this.find({
      tenantId,
      status: 'PENDING'
    });
  };

TransactionSchema.statics.getWalletTransactions =
  function(tenantId, walletId) {

    return this.find({
      tenantId,
      $or: [
        { fromWallet: walletId },
        { toWallet: walletId }
      ]
    }).sort({ createdAt: -1 });
  };

/**
 * PLUGINS
 */

TransactionSchema.plugin(uniqueValidator, {
  message: '{PATH} must be unique.'
});

/**
 * EXPORT
 */

module.exports =
  mongoose.models.Transaction ||
  mongoose.model(
    'Transaction',
    TransactionSchema
  );