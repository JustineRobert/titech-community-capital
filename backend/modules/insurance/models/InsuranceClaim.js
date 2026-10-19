import mongoose from 'mongoose';
const { Schema } = mongoose;
const insurerDecisionSchema = new Schema({
  decision: { type: String, enum: ['APPROVED', 'REJECTED', 'NEEDS_MORE_INFORMATION'], required: true },
  sourceSystem: { type: String, required: true, trim: true, maxlength: 200 },
  externalDecisionReference: { type: String, required: true, trim: true, maxlength: 200 },
  decidedAt: { type: Date, required: true },
  recordedBy: { type: String, required: true, trim: true, maxlength: 128 },
  reasonReference: { type: String, trim: true, maxlength: 200, default: null },
}, { _id: false, strict: 'throw' });
const schema = new Schema({
  tenantId: { type: String, required: true, trim: true, immutable: true, maxlength: 100 },
  insurerProfileId: { type: Schema.Types.ObjectId, ref: 'InsuranceInstitutionProfile', required: true, immutable: true },
  enrolmentId: { type: Schema.Types.ObjectId, ref: 'InsuranceEnrolment', required: true, immutable: true },
  claimReference: { type: String, required: true, trim: true, maxlength: 128 },
  policyReference: { type: String, required: true, trim: true, maxlength: 128 },
  claimantReference: { type: String, required: true, trim: true, maxlength: 128 },
  claimCategory: { type: String, required: true, trim: true, maxlength: 100 },
  submittedAt: { type: Date, required: true, default: Date.now },
  evidenceReferences: { type: [{ type: String, trim: true, maxlength: 80 }], default: [] },
  status: { type: String, enum: ['SUBMITTED', 'IN_REVIEW', 'NEEDS_MORE_INFORMATION', 'DECISION_RECORDED', 'PAYOUT_PENDING', 'PAID', 'REJECTED', 'CLOSED', 'RECONCILIATION_EXCEPTION'], default: 'SUBMITTED', required: true, index: true },
  additionalInformationRequest: { type: String, trim: true, maxlength: 1000, default: null },
  insurerDecision: { type: insurerDecisionSchema, default: null },
  payoutReference: { type: String, trim: true, maxlength: 200, default: null },
  payoutSettlementReference: { type: String, trim: true, maxlength: 200, default: null },
  payoutReconciliationReference: { type: String, trim: true, maxlength: 200, default: null },
  payoutSettledAt: { type: Date, default: null },
  createdBy: { type: String, required: true, trim: true, immutable: true, maxlength: 128 },
  updatedBy: { type: String, required: true, trim: true, maxlength: 128 },
  history: { type: [{ fromStatus: String, toStatus: String, actorId: String, externalReference: String, reason: String, at: { type: Date, default: Date.now } }], default: [] },
}, { timestamps: true, versionKey: '__v', strict: 'throw', minimize: true });
schema.index({ tenantId: 1, claimReference: 1 }, { unique: true, name: 'uniq_insurance_claim_reference' });
schema.index({ tenantId: 1, policyReference: 1, status: 1 }, { name: 'idx_insurance_claim_policy_status' });
schema.pre('validate', function protectClaimState(next) {
  if (['DECISION_RECORDED', 'PAYOUT_PENDING', 'PAID', 'REJECTED'].includes(this.status) && !this.insurerDecision) return next(new Error('A claim decision status requires an attributable insurer decision reference.'));
  if (this.status === 'PAID' && (!this.payoutReference || !this.payoutSettlementReference || !this.payoutReconciliationReference || !this.payoutSettledAt)) return next(new Error('Paid status requires payout, settlement and reconciliation evidence.'));
  if (this.status === 'NEEDS_MORE_INFORMATION' && !this.additionalInformationRequest) return next(new Error('Request for additional information must include a safe reason.'));
  next();
});
export default mongoose.models.InsuranceClaim || mongoose.model('InsuranceClaim', schema);
