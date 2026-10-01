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
  status: { type: String, required: true, enum: ['DRAFT', 'UPLOADED', 'VALIDATING', 'VALIDATED', 'PENDING_APPROVAL', 'APPROVED', 'PROCESSING', 'PARTIALLY_PROCESSED', 'PROCESSED', 'SUBMITTED', 'SETTLEMENT_PENDING', 'SETTLED', 'RECONCILING', 'RECONCILED', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED'], index: true },
  submittedBy: { type: String, default: null, immutable: true },
  submittedAt: { type: Date, default: null, immutable: true },
  approvedBy: { type: String, default: null, immutable: true },
  approvedAt: { type: Date, default: null, immutable: true },
  rejectedBy: { type: String, default: null, immutable: true },
  rejectedAt: { type: Date, default: null, immutable: true },
  rejectionReason: { type: String, maxlength: 1000, default: null },
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
