// ============================================================================
// TITech Community Capital – Loan Model
// File: backend/modules/finance/models/Loan.js
// Production-grade
// ============================================================================

'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;

const LOAN_STATUS = ['PENDING', 'APPROVED', 'ACTIVE', 'COMPLETED', 'DEFAULTED'];

// Decimal128 helpers
function toDecimal128(value) {
  return mongoose.Types.Decimal128.fromString(Number(value).toFixed(2));
}
function fromDecimal128(value) {
  return value ? parseFloat(value.toString()) : 0;
}

const LoanSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },

    memberId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    principal: {
      type: Schema.Types.Decimal128,
      required: true,
      get: fromDecimal128,
      set: toDecimal128,
    },

    interestRate: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    }, // % per period

    termMonths: {
      type: Number,
      required: true,
      min: 1,
    },

    balance: {
      type: Schema.Types.Decimal128,
      default: toDecimal128(0),
      get: fromDecimal128,
      set: toDecimal128,
    },

    status: {
      type: String,
      enum: LOAN_STATUS,
      default: 'PENDING',
      index: true,
    },

    approvedAt: { type: Date },
    disbursedAt: { type: Date },

    // Audit fields
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },

    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
    autoIndex: process.env.NODE_ENV !== 'production', // avoid runtime index builds in prod
  }
);

// Compound indexes for analytics and queries
LoanSchema.index({ tenantId: 1, memberId: 1, status: 1 });
LoanSchema.index({ tenantId: 1, createdAt: -1 });
LoanSchema.index({ status: 1, disbursedAt: -1 }); // reporting index

// Static helper: approve loan
LoanSchema.statics.approveLoan = async function (loanId, approverId) {
  const loan = await this.findById(loanId);
  if (!loan) throw new Error('Loan not found');
  loan.status = 'APPROVED';
  loan.approvedAt = new Date();
  loan.metadata = { ...loan.metadata, approvedBy: approverId };
  return loan.save();
};

// Instance helper: mark loan as disbursed
LoanSchema.methods.disburse = async function () {
  if (this.status !== 'APPROVED') throw new Error('Loan must be approved before disbursement');
  this.status = 'ACTIVE';
  this.disbursedAt = new Date();
  this.balance = this.principal;
  return this.save();
};

// Instance helper: apply repayment (graceful edge cases)
LoanSchema.methods.applyRepayment = async function (amount) {
  const repayment = Number(amount);
  if (repayment <= 0) throw new Error('Repayment amount must be positive');
  const newBalance = Math.max(this.balance - repayment, 0);
  this.balance = toDecimal128(newBalance);
  if (newBalance === 0) this.status = 'COMPLETED';
  return this.save();
};

// Validation middleware
LoanSchema.pre('save', function (next) {
  if (this.termMonths <= 0) {
    return next(new Error('Loan term must be greater than zero'));
  }
  if (this.principal <= 0) {
    return next(new Error('Principal must be greater than zero'));
  }
  next();
});

// Lifecycle hook: log status transitions
LoanSchema.post('save', function (doc) {
  if (doc.isModified('status')) {
    console.info(`Loan ${doc._id} status changed to ${doc.status}`);
  }
});

module.exports = mongoose.model('Loan', LoanSchema);
