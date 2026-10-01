'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;

const PayrollTransactionSchema = new Schema({
  transactionId: { type: String, required: true, unique: true, immutable: true, index: true },
  tenantId: { type: String, required: true, immutable: true, index: true },
  employerId: { type: String, required: true, immutable: true, index: true },
  batchId: { type: String, required: true, immutable: true, index: true },
  employeeId: { type: String, required: true, immutable: true },
  employeeName: { type: String, required: true, trim: true, maxlength: 200, immutable: true },
  phoneNumber: { type: String, required: true, trim: true, maxlength: 32, immutable: true },
  amount: { type: Schema.Types.Decimal128, required: true },
  currency: { type: String, required: true, uppercase: true, match: /^[A-Z]{3}$/, immutable: true },
  provider: { type: String, required: true, enum: ['MTN_MOMO', 'AIRTEL_MONEY'], immutable: true },
  status: { type: String, required: true, enum: ['PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'UNKNOWN', 'RETRYING'], index: true },
  financialPostingStatus: { type: String, required: true, enum: ['PENDING', 'POSTED', 'REQUIRES_REVIEW'], default: 'PENDING' },
  paymentIntentId: { type: String, default: null, index: true },
  settlementStatus: { type: String, enum: ['PENDING', 'SETTLED', 'UNKNOWN', 'EXCEPTION'], default: 'PENDING' },
  providerTransactionId: { type: String, default: null, index: true },
  providerRef: { type: String, default: null },
  errorCode: { type: String, default: null, maxlength: 128 },
  message: { type: String, default: null, maxlength: 500 },
  attemptCount: { type: Number, default: 0, min: 0 },
  idempotencyKey: { type: String, required: true, immutable: true },
  retryOf: { type: String, default: null },
  lastAttemptIdempotencyKey: { type: String, default: null },
  metadata: { type: Schema.Types.Mixed, default: {} },
  lastProviderUpdateAt: { type: Date, default: null },
  reconciledAt: { type: Date, default: null },
}, { timestamps: true, strict: 'throw' });

PayrollTransactionSchema.index({ tenantId: 1, batchId: 1, status: 1 });
PayrollTransactionSchema.index({ tenantId: 1, employeeId: 1, batchId: 1 }, { unique: true });
PayrollTransactionSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
PayrollTransactionSchema.index({ tenantId: 1, provider: 1, providerTransactionId: 1 });

module.exports = mongoose.models.PayrollTransaction || mongoose.model('PayrollTransaction', PayrollTransactionSchema);
