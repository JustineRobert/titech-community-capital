'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;

const PayrollApprovalSchema = new Schema({
  approvalId: { type: String, required: true, unique: true, immutable: true, index: true },
  tenantId: { type: String, required: true, immutable: true, index: true },
  batchId: { type: String, required: true, immutable: true, index: true },
  action: { type: String, enum: ['SUBMITTED', 'APPROVED', 'REJECTED'], required: true },
  actorId: { type: String, required: true, immutable: true },
  actorRole: { type: String, required: true, immutable: true },
  reason: { type: String, maxlength: 1000, default: null },
  previousState: { type: String, required: true, immutable: true },
  nextState: { type: String, required: true, immutable: true },
  requestId: { type: String, default: null, immutable: true },
  correlationId: { type: String, default: null, immutable: true },
}, { timestamps: true, strict: 'throw' });

PayrollApprovalSchema.index({ tenantId: 1, batchId: 1, createdAt: -1 });

module.exports = mongoose.models.PayrollApproval || mongoose.model('PayrollApproval', PayrollApprovalSchema);
