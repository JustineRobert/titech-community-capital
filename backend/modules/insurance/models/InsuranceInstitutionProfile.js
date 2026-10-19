import mongoose from 'mongoose';
const { Schema } = mongoose;
const LicenceStatus = Object.freeze(['PENDING_SUBMISSION', 'SUBMITTED', 'PENDING_VERIFICATION', 'VERIFIED', 'NEEDS_MORE_INFORMATION', 'EXPIRED', 'SUSPENDED', 'REJECTED']);
const OnboardingStatus = Object.freeze(['DRAFT', 'SUBMITTED', 'PENDING_COMPLIANCE', 'NEEDS_MORE_INFORMATION', 'APPROVED_FOR_CONFIGURATION', 'READY_FOR_CONTROLLED_TEST', 'ACTIVE', 'SUSPENDED', 'REJECTED']);
const schema = new Schema({
  tenantId: { type: String, required: true, trim: true, immutable: true, maxlength: 100 },
  organisationType: { type: String, required: true, enum: ['INSURER', 'INSURANCE_BROKER', 'INSURANCE_AGENT', 'MICROINSURANCE_DISTRIBUTION_PARTNER', 'THIRD_PARTY_ADMINISTRATOR'] },
  legalName: { type: String, required: true, trim: true, minlength: 2, maxlength: 200 },
  tradingName: { type: String, trim: true, maxlength: 200, default: null },
  registrationReference: { type: String, required: true, trim: true, maxlength: 128 },
  jurisdiction: { type: String, required: true, trim: true, uppercase: true, maxlength: 80 },
  competentAuthority: { type: String, required: true, trim: true, maxlength: 200 },
  registeredContactEmail: { type: String, trim: true, lowercase: true, maxlength: 254, default: null },
  registeredContactPhone: { type: String, trim: true, maxlength: 32, default: null },
  approvedTerritories: { type: [{ type: String, trim: true, uppercase: true, maxlength: 80 }], default: [] },
  licenceReference: { type: String, trim: true, maxlength: 128, default: null },
  licenceActivities: { type: [{ type: String, trim: true, maxlength: 100 }], default: [] },
  licenceIssuedAt: { type: Date, default: null },
  licenceExpiresAt: { type: Date, default: null },
  licenceEvidenceReference: { type: String, trim: true, maxlength: 80, default: null, select: false },
  licenceStatus: { type: String, enum: LicenceStatus, default: 'PENDING_SUBMISSION', required: true, index: true },
  verificationSource: { type: String, trim: true, maxlength: 500, default: null },
  verifiedAt: { type: Date, default: null },
  verifiedBy: { type: String, trim: true, maxlength: 128, default: null },
  verificationReason: { type: String, trim: true, maxlength: 1000, default: null },
  onboardingStatus: { type: String, enum: OnboardingStatus, default: 'DRAFT', required: true, index: true },
  agreementReference: { type: String, trim: true, maxlength: 128, default: null },
  dataProcessingAgreementReference: { type: String, trim: true, maxlength: 128, default: null },
  integrationStatus: { type: String, enum: ['NOT_CONFIGURED', 'CONFIGURED_TEST_ONLY', 'TESTS_PASSED', 'LIVE_APPROVED', 'SUSPENDED'], default: 'NOT_CONFIGURED', required: true },
  suspensionReason: { type: String, trim: true, maxlength: 1000, default: null },
  approvalHistory: { type: [{ fromStatus: String, toStatus: String, actorId: String, reason: String, sourceReference: String, at: { type: Date, default: Date.now } }], default: [] },
  createdBy: { type: String, required: true, trim: true, immutable: true, maxlength: 128 },
  updatedBy: { type: String, required: true, trim: true, maxlength: 128 },
  approvedBy: { type: String, trim: true, maxlength: 128, default: null },
  approvedAt: { type: Date, default: null },
}, {
  timestamps: true,
  versionKey: '__v',
  strict: 'throw',
  minimize: true,
  toJSON: {
    transform(_doc, ret) {
      delete ret._id;
      delete ret.__v;
      delete ret.licenceEvidenceReference;
      ret.id = String(_doc._id);
      return ret;
    },
  },
});
schema.index({ tenantId: 1 }, { unique: true, name: 'uniq_insurance_profile_tenant' });
schema.index({ jurisdiction: 1, competentAuthority: 1, licenceReference: 1 }, { sparse: true, name: 'idx_insurance_licence_lookup' });
schema.pre('validate', function validateLicence(next) {
  if (this.licenceExpiresAt && this.licenceIssuedAt && this.licenceExpiresAt <= this.licenceIssuedAt) return next(new Error('Licence expiry must be later than issue date.'));
  if (this.licenceStatus === 'VERIFIED' && (!this.verifiedAt || !this.verifiedBy || !this.verificationSource)) return next(new Error('Verified licence requires reviewer, timestamp and verification source.'));
  if (this.licenceStatus === 'SUSPENDED' && !this.suspensionReason) return next(new Error('Suspended licence must include a reason.'));
  next();
});
export default mongoose.models.InsuranceInstitutionProfile || mongoose.model('InsuranceInstitutionProfile', schema);
