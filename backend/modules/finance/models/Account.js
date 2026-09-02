// backend/modules/finance/models/Account.js

'use strict';

const mongoose = require('mongoose');
const uniqueValidator = require('mongoose-unique-validator');
const crypto = require('crypto');

const ACCOUNT_TYPES = [
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'REVENUE',
  'EXPENSE'
];

const NORMAL_BALANCES = [
  'DEBIT',
  'CREDIT'
];

const ACCOUNT_STATUS = [
  'ACTIVE',
  'INACTIVE',
  'FROZEN',
  'CLOSED',
  'DORMANT'
];

const ACCOUNT_CATEGORIES = [
  'CASH',
  'BANK',
  'MOBILE_MONEY',
  'SAVINGS',
  'LOAN_RECEIVABLE',
  'LOAN_INTEREST',
  'PENALTY',
  'MEMBER_SHARE',
  'EQUITY',
  'EXPENSE',
  'REVENUE',
  'SUSPENSE',
  'CLEARING',
  'WRITE_OFF',
  'PROVISION'
];

const AccountSchema = new mongoose.Schema(
  {
    /**
     * Multi-Tenant Isolation
     */
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true
    },

    /**
     * Chart Of Accounts
     */
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true
    },

    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128
    },

    description: {
      type: String,
      trim: true,
      maxlength: 500
    },

    /**
     * Accounting Type
     */
    type: {
      type: String,
      enum: ACCOUNT_TYPES,
      required: true,
      uppercase: true
    },

    /**
     * Normal Accounting Balance
     *
     * Assets/Expenses => DEBIT
     * Liabilities/Equity/Revenue => CREDIT
     */
    normalBalance: {
      type: String,
      enum: NORMAL_BALANCES,
      required: true
    },

    /**
     * Financial Category
     */
    category: {
      type: String,
      enum: ACCOUNT_CATEGORIES,
      required: true,
      index: true
    },

    /**
     * Hierarchy
     */
    parentAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      default: null,
      index: true
    },

    level: {
      type: Number,
      default: 1
    },

    /**
     * Currency
     */
    currency: {
      type: String,
      default: 'UGX',
      uppercase: true,
      trim: true
    },

    /**
     * Ledger Balance
     *
     * Cached only.
     * JournalEntries remain source of truth.
     */
    balance: {
      type: mongoose.Schema.Types.Decimal128,
      default: mongoose.Types.Decimal128.fromString('0.00'),
      get: v => v ? parseFloat(v.toString()) : 0,
      set: v =>
        mongoose.Types.Decimal128.fromString(
          Number(v || 0).toFixed(2)
        )
    },

    /**
     * Reporting Balances
     */
    openingBalance: {
      type: mongoose.Schema.Types.Decimal128,
      default: mongoose.Types.Decimal128.fromString('0.00')
    },

    closingBalance: {
      type: mongoose.Schema.Types.Decimal128,
      default: mongoose.Types.Decimal128.fromString('0.00')
    },

    /**
     * External Mapping
     */
    accountNumber: {
      type: String,
      trim: true,
      sparse: true
    },

    bankCode: {
      type: String,
      trim: true
    },

    momoProvider: {
      type: String,
      enum: [
        'MTN',
        'AIRTEL',
        null
      ],
      default: null
    },

    /**
     * Regulatory Reporting
     */
    reportingCode: {
      type: String,
      trim: true,
      index: true
    },

    financialStatementSection: {
      type: String,
      enum: [
        'BALANCE_SHEET',
        'INCOME_STATEMENT',
        'CASH_FLOW'
      ],
      default: 'BALANCE_SHEET'
    },

    /**
     * Reconciliation
     */
    reconciliationRequired: {
      type: Boolean,
      default: false
    },

    lastReconciledAt: {
      type: Date,
      default: null
    },

    /**
     * Operational Controls
     */
    allowManualPosting: {
      type: Boolean,
      default: true
    },

    allowNegativeBalance: {
      type: Boolean,
      default: false
    },

    status: {
      type: String,
      enum: ACCOUNT_STATUS,
      default: 'ACTIVE',
      index: true
    },

    /**
     * Freeze Controls
     */
    frozenAt: Date,

    frozenReason: String,

    /**
     * Dormancy
     */
    dormantSince: Date,

    /**
     * Audit Metadata
     */
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
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
      index: true
    },

    /**
     * Extensible Metadata
     */
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: true,
    toJSON: {
      getters: true
    },
    toObject: {
      getters: true
    }
  }
);

/**
 * Indexes
 */

AccountSchema.index(
  {
    tenantId: 1,
    code: 1
  },
  {
    unique: true,
    name: 'tenant_account_code_unique'
  }
);

AccountSchema.index({
  tenantId: 1,
  category: 1
});

AccountSchema.index({
  tenantId: 1,
  status: 1
});

AccountSchema.index({
  tenantId: 1,
  parentAccountId: 1
});

AccountSchema.index({
  tenantId: 1,
  reportingCode: 1
});

/**
 * Generate Integrity Hash
 */

AccountSchema.pre('save', function(next) {

  const payload = JSON.stringify({
    tenantId: this.tenantId,
    code: this.code,
    type: this.type,
    category: this.category,
    balance: this.balance?.toString()
  });

  this.hash = crypto
    .createHash('sha256')
    .update(payload)
    .digest('hex');

  next();
});

/**
 * Soft Delete
 */

AccountSchema.methods.softDelete =
  async function(userId) {

    this.status = 'CLOSED';

    this.metadata.deletedBy = userId;
    this.metadata.deletedAt = new Date();

    return this.save();
  };

/**
 * Freeze Account
 */

AccountSchema.methods.freeze =
  async function(reason) {

    this.status = 'FROZEN';
    this.frozenAt = new Date();
    this.frozenReason = reason;

    return this.save();
  };

/**
 * Unfreeze Account
 */

AccountSchema.methods.unfreeze =
  async function() {

    this.status = 'ACTIVE';

    this.frozenAt = null;
    this.frozenReason = null;

    return this.save();
  };

/**
 * Credit Account
 */

AccountSchema.methods.credit =
  async function(amount) {

    const current =
      parseFloat(this.balance || 0);

    this.balance =
      current + Number(amount);

    return this.save();
  };

/**
 * Debit Account
 */

AccountSchema.methods.debit =
  async function(amount) {

    const current =
      parseFloat(this.balance || 0);

    if (
      !this.allowNegativeBalance &&
      current < amount
    ) {
      throw new Error(
        'Insufficient balance'
      );
    }

    this.balance =
      current - Number(amount);

    return this.save();
  };

/**
 * Statics
 */

AccountSchema.statics.getByCode =
  function(tenantId, code) {

    return this.findOne({
      tenantId,
      code: code.toUpperCase()
    });
  };

AccountSchema.statics.getActiveAccounts =
  function(tenantId) {

    return this.find({
      tenantId,
      status: 'ACTIVE'
    });
  };

AccountSchema.plugin(uniqueValidator);

module.exports =
  mongoose.model(
    'Account',
    AccountSchema
  );