'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;

const PayrollPaymentAttemptSchema = new Schema({
  attemptId: { type: String, required: true, unique: true, immutable: true, index: true },
  tenantId: { type: String, required: true, immutable: true, index: true },
  batchId: { type: String, required: true, immutable: true, index: true },
  transactionId: { type: String, required: true, immutable: true, index: true },
  attemptNumber: { type: Number, required: true, min: 1 },
  idempotencyKey: { type: String, required: true, immutable: true },
  provider: { type: String, required: true },
  outcome: { type: String, enum: ['ACCEPTED', 'SUCCESS', 'FAILED', 'UNKNOWN', 'TIMEOUT'], required: true },
  providerTransactionId: { type: String, default: null },
  providerRef: { type: String, default: null },
  errorCode: { type: String, default: null },
  occurredAt: { type: Date, required: true },
  metadata: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true, strict: 'throw' });

PayrollPaymentAttemptSchema.index({ tenantId: 1, transactionId: 1, attemptNumber: 1 }, { unique: true });
PayrollPaymentAttemptSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });

module.exports = mongoose.models.PayrollPaymentAttempt || mongoose.model('PayrollPaymentAttempt', PayrollPaymentAttemptSchema);
