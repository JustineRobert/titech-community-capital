import mongoose from 'mongoose';
const { Schema } = mongoose;
const schema = new Schema({
  tenantId: { type: String, required: true, trim: true, immutable: true, maxlength: 100 },
  insurerProfileId: { type: Schema.Types.ObjectId, ref: 'InsuranceInstitutionProfile', required: true, immutable: true },
  productId: { type: Schema.Types.ObjectId, ref: 'InsuranceProduct', required: true, immutable: true },
  participantTenantReference: { type: String, required: true, trim: true, maxlength: 100 },
  participantReference: { type: String, required: true, trim: true, maxlength: 128 },
  groupReference: { type: String, trim: true, maxlength: 128, default: null },
  productReference: { type: String, required: true, trim: true, maxlength: 128 },
  coverageReference: { type: String, required: true, trim: true, maxlength: 128 },
  participantVerificationReference: { type: String, required: true, trim: true, maxlength: 200 },
  consentReference: { type: String, required: true, trim: true, maxlength: 200 },
  termsAndConditionsVersion: { type: String, required: true, trim: true, maxlength: 80 },
  status: { type: String, enum: ['DRAFT', 'SUBMITTED', 'PENDING_ELIGIBILITY', 'NEEDS_MORE_INFORMATION', 'ELIGIBLE', 'INELIGIBLE', 'POLICY_ISSUED', 'COVERAGE_ACTIVE', 'COVERAGE_ENDED', 'CANCELLED'], default: 'SUBMITTED', required: true, index: true },
  insurerDecisionSource: { type: String, trim: true, maxlength: 200, default: null },
  insurerDecisionReference: { type: String, trim: true, maxlength: 200, default: null },
  policyReference: { type: String, trim: true, maxlength: 128, default: null },
  coverageStartsAt: { type: Date, default: null },
  coverageEndsAt: { type: Date, default: null },
  createdBy: { type: String, required: true, trim: true, immutable: true, maxlength: 128 },
  updatedBy: { type: String, required: true, trim: true, maxlength: 128 },
  history: { type: [{ fromStatus: String, toStatus: String, actorId: String, externalReference: String, reason: String, at: { type: Date, default: Date.now } }], default: [] },
}, { timestamps: true, versionKey: '__v', strict: 'throw', minimize: true });
schema.index({ tenantId: 1, participantTenantReference: 1, participantReference: 1, productReference: 1 }, { name: 'idx_insurance_enrolment_participant' });
schema.index({ tenantId: 1, policyReference: 1 }, { sparse: true, name: 'idx_insurance_policy_reference' });
schema.pre('validate', function validateCoverage(next) {
  if (['POLICY_ISSUED', 'COVERAGE_ACTIVE', 'COVERAGE_ENDED'].includes(this.status) && (!this.policyReference || !this.insurerDecisionSource || !this.insurerDecisionReference)) return next(new Error('Issued policy/coverage state requires authoritative insurer decision references.'));
  if (this.coverageStartsAt && this.coverageEndsAt && this.coverageEndsAt <= this.coverageStartsAt) return next(new Error('Coverage end must be later than coverage start.'));
  if (this.status === 'COVERAGE_ACTIVE' && !this.coverageStartsAt) return next(new Error('Active coverage must contain a coverage start timestamp.'));
  next();
});
export default mongoose.models.InsuranceEnrolment || mongoose.model('InsuranceEnrolment', schema);
