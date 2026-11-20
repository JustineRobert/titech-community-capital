'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

const PayrollBatchSchema = new Schema({
  batchId: { type: String, required: true, unique: true, immutable: true, index: true },
  tenantId: { type: String, required: true, immutable: true, index: true },
  employerId: { type: String, required: true, immutable: true, index: true },
  uploadedBy: { type: String, required: true, immutable: true },
  uploadIdempotencyKey: { type: String, required: true, immutable: true },
  fileName: { type: String, required: true, trim: true, maxlength: 255 },
  rowCount: { type: Number, required: true, min: 1, max: 5000 },
  totalAmount: { type: Schema.Types.Decimal128, required: true, default: '0' },
  currency: { type: String, required: true, uppercase: true, trim: true, maxlength: 3, default: 'UGX' },
  uploadFingerprint: { type: String, required: true, maxlength: 64, immutable: true },
  submittedBy: { type: String, default: null },
  submittedAt: { type: Date, default: null },
  approvedBy: { type: String, default: null },
  approvedAt: { type: Date, default: null },
  rejectedBy: { type: String, default: null },
  rejectedAt: { type: Date, default: null },
  approvalReason: { type: String, maxlength: 1000, default: null },
  status: { type: String, required: true, enum: ['UPLOADED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PROCESSING', 'PROCESSED', 'PARTIALLY_PROCESSED', 'RECONCILED', 'FAILED'], index: true },
  processedCount: { type: Number, default: 0, min: 0 },
  successCount: { type: Number, default: 0, min: 0 },
  failedCount: { type: Number, default: 0, min: 0 },
  unknownCount: { type: Number, default: 0, min: 0 },
  reconciledCount: { type: Number, default: 0, min: 0 },
  validationErrors: { type: [String], default: [] },
  processedAt: { type: Date, default: null },
  reconciledAt: { type: Date, default: null },
}, { timestamps: true, strict: 'throw' });

PayrollBatchSchema.index({ tenantId: 1, uploadIdempotencyKey: 1 }, { unique: true });
PayrollBatchSchema.index({ tenantId: 1, createdAt: -1 });
PayrollBatchSchema.index({ tenantId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.models.PayrollBatch || mongoose.model('PayrollBatch', PayrollBatchSchema);
