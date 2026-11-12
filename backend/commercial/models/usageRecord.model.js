/** Durable, tenant-scoped evidence of a delivered service usage event. */
import mongoose from 'mongoose';

const { Schema } = mongoose;
const QUANTITY_PATTERN = /^(0|[1-9]\d{0,29})$/;

const usageRecordSchema = new Schema({
  tenantId: { type: String, required: true, immutable: true, index: true },
  institutionId: { type: String, default: null, immutable: true },
  commercialAccountId: { type: String, default: null, immutable: true },
  serviceId: { type: String, required: true, immutable: true },
  eventType: { type: String, required: true, immutable: true },
  sourceModule: { type: String, required: true, immutable: true },
  sourceEventId: { type: String, required: true, immutable: true },
  sourceTransactionId: { type: String, default: null, immutable: true },
  quantity: { type: String, required: true, match: QUANTITY_PATTERN, immutable: true },
  unit: { type: String, required: true, immutable: true },
  outcome: { type: String, enum: ['SUCCEEDED', 'FAILED', 'PARTIALLY_SUCCEEDED', 'CANCELLED'], required: true, immutable: true },
  classification: { type: String, enum: ['BILLABLE', 'INCLUDED_IN_PLAN', 'NON_BILLABLE', 'SPONSORED', 'CONTRACT_BILLED', 'FREE_TRIAL', 'PENDING_COMMERCIAL_APPROVAL', 'UNPRICED', 'DISABLED', 'RESTRICTED'], required: true, immutable: true },
  payerId: { type: String, default: null, immutable: true },
  payerType: { type: String, default: null, immutable: true },
  contractId: { type: String, default: null, immutable: true },
  currency: { type: String, default: null, uppercase: true, immutable: true, match: /^[A-Z]{3}$/ },
  principalMinor: { type: String, default: null, immutable: true, match: QUANTITY_PATTERN },
  idempotencyKey: { type: String, required: true, immutable: true, maxlength: 255 },
  eventFingerprint: { type: String, required: true, immutable: true, match: /^[a-f0-9]{64}$/ },
  occurredAt: { type: Date, required: true, immutable: true },
  correlationId: { type: String, default: null, immutable: true },
  status: { type: String, enum: ['RECORDED', 'ASSESSED', 'INCLUDED', 'NOT_BILLABLE', 'BLOCKED'], default: 'RECORDED' },
  feeAssessmentId: { type: String, default: null },
  processingReason: { type: String, default: null, maxlength: 500 },
  processedAt: { type: Date, default: null },
}, {
  collection: 'commercial_usage_records',
  timestamps: true,
  strict: 'throw',
  versionKey: 'versionKey',
});

usageRecordSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true, name: 'uniq_tenant_usage_idempotency' });
usageRecordSchema.index({ tenantId: 1, serviceId: 1, occurredAt: -1 });
usageRecordSchema.index({ tenantId: 1, status: 1, occurredAt: -1 });
usageRecordSchema.index({ tenantId: 1, sourceEventId: 1, sourceModule: 1 }, { unique: true, name: 'uniq_tenant_usage_source_event' });

const UsageRecord = mongoose.models.UsageRecord || mongoose.model('UsageRecord', usageRecordSchema);
export { usageRecordSchema, UsageRecord };
export default UsageRecord;
