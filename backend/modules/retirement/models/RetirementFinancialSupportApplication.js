import mongoose from 'mongoose';
const { Schema } = mongoose;
const schema = new Schema({
  tenantId: { type: String, required: true, trim: true, immutable: true, maxlength: 100 },
  applicationReference: { type: String, required: true, unique: true, immutable: true, maxlength: 50 },
  subjectUserId: { type: String, required: true, immutable: true, maxlength: 128, index: true },
  supportType: { type: String, required: true, enum: ['EMERGENCY_ASSISTANCE', 'REGULATED_LOAN', 'EMPLOYER_FINANCE', 'SAVINGS_REFERRAL', 'INSURANCE_REFERRAL', 'FINANCIAL_COUNSELLING'] },
  providerReference: { type: String, trim: true, maxlength: 128, default: null },
  requestedAmountMinor: { type: Number, min: 0, validate: (value) => value == null || Number.isSafeInteger(value), default: null },
  currency: { type: String, uppercase: true, match: /^[A-Z]{3}$/, default: 'UGX' },
  privacyNoticeVersion: { type: String, required: true, trim: true, maxlength: 100 },
  processingBasis: { type: String, required: true, enum: ['CONSENT', 'CONTRACT', 'LEGAL_OBLIGATION', 'LEGITIMATE_INTEREST', 'PUBLIC_TASK', 'VITAL_INTEREST'] },
  noticeLanguage: { type: String, required: true, lowercase: true, enum: ['en', 'sw', 'fr', 'ar'] },
  noticeAcknowledgedAt: { type: Date, required: true },
  status: { type: String, required: true, enum: ['SUBMITTED', 'NEEDS_MORE_INFORMATION', 'REFERRED_TO_PROVIDER', 'PROVIDER_DECISION_PENDING', 'PROVIDER_APPROVED', 'PROVIDER_REJECTED', 'CANCELLED'], default: 'SUBMITTED', index: true },
  providerDecisionSource: { type: String, trim: true, maxlength: 200, default: null },
  externalDecisionReference: { type: String, trim: true, maxlength: 200, default: null },
  providerDecisionAt: { type: Date, default: null },
  providerDecisionRecordedBy: { type: String, maxlength: 128, default: null },
  disclosureVersion: { type: String, trim: true, maxlength: 100, default: null },
  createdBy: { type: String, required: true, immutable: true, maxlength: 128 },
  updatedBy: { type: String, required: true, maxlength: 128 },
}, { timestamps: true, strict: 'throw', versionKey: '__v', minimize: true, toJSON: { transform(_doc, ret) { delete ret.__v; ret.id = String(_doc._id); delete ret._id; return ret; } } });
schema.index({ tenantId: 1, subjectUserId: 1, updatedAt: -1 }, { name: 'idx_retirement_support_application_subject' });
schema.pre('validate', function validateProviderDecision(next) {
  if (['PROVIDER_APPROVED', 'PROVIDER_REJECTED'].includes(this.status) && (!this.providerDecisionSource || !this.externalDecisionReference || !this.providerDecisionAt || !this.providerDecisionRecordedBy)) {
    return next(new Error('Provider outcomes require an external decision source, reference, timestamp and attributed reviewer.'));
  }
  next();
});
export default mongoose.models.RetirementFinancialSupportApplication || mongoose.model('RetirementFinancialSupportApplication', schema);
