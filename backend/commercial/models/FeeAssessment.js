/** Immutable commercial fee assessment; no payment or ledger authority. */
import mongoose from 'mongoose';

const { Schema } = mongoose;
const MINOR_PATTERN = /^(0|[1-9]\d{0,29})$/;

const auditSchema = new Schema({
  eventType: { type: String, required: true, immutable: true },
  actorId: { type: String, required: true, immutable: true },
  occurredAt: { type: Date, required: true, immutable: true },
  sourceModule: { type: String, required: true, immutable: true },
  correlationId: { type: String, default: null, immutable: true },
}, { _id: false, strict: 'throw' });

const feeAssessmentSchema = new Schema({
  tenantId: { type: String, required: true, immutable: true, trim: true },
  institutionId: { type: String, default: null, immutable: true },
  contractId: { type: String, default: null, immutable: true },
  serviceId: { type: String, required: true, immutable: true },
  sourceEventId: { type: String, required: true, immutable: true },
  sourceModule: { type: String, required: true, immutable: true },
  eventType: { type: String, default: null, immutable: true },
  payerId: { type: String, required: true, immutable: true },
  payerType: { type: String, default: null, immutable: true },
  beneficiaryId: { type: String, default: null, immutable: true },
  principalMinor: { type: String, required: true, match: MINOR_PATTERN, immutable: true },
  feeMinor: { type: String, required: true, match: MINOR_PATTERN, immutable: true },
  currency: { type: String, required: true, uppercase: true, match: /^[A-Z]{3}$/, immutable: true },
  feeRuleId: { type: String, required: true, immutable: true },
  feeRuleVersion: { type: Number, default: null, immutable: true },
  pricingSnapshot: { type: Schema.Types.Mixed, required: true, immutable: true },
  eventFingerprint: { type: String, required: true, immutable: true, match: /^[a-f0-9]{64}$/ },
  idempotencyKey: { type: String, required: true, immutable: true, maxlength: 255 },
  status: { type: String, enum: ['ASSESSED', 'INVOICED', 'COLLECTION_PENDING', 'PAID', 'PARTIALLY_PAID', 'WAIVED', 'EXEMPTED', 'CANCELLED', 'REVERSED', 'REFUNDED', 'DISPUTED'], default: 'ASSESSED' },
  assessedAt: { type: Date, required: true, immutable: true },
  occurredAt: { type: Date, required: true, immutable: true },
  correlationId: { type: String, default: null, immutable: true },
  audit: { type: auditSchema, required: true, immutable: true },
}, {
  collection: 'commercial_fee_assessments',
  timestamps: true,
  strict: 'throw',
  versionKey: 'versionKey',
});

feeAssessmentSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true, name: 'uniq_tenant_fee_assessment_idempotency' });
feeAssessmentSchema.index({ tenantId: 1, sourceEventId: 1, serviceId: 1 }, { name: 'idx_tenant_fee_assessment_source' });
feeAssessmentSchema.index({ tenantId: 1, status: 1, assessedAt: -1 }, { name: 'idx_tenant_fee_assessment_status_date' });
feeAssessmentSchema.index({ tenantId: 1, feeRuleId: 1, feeRuleVersion: 1 });

const FeeAssessment = mongoose.models.FeeAssessment || mongoose.model('FeeAssessment', feeAssessmentSchema);
export { feeAssessmentSchema, FeeAssessment };
export default FeeAssessment;
