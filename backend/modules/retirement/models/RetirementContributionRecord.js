import mongoose from 'mongoose';
import { RETIREMENT_SCHEME_TYPES } from '../retirement.policy.js';
const { Schema } = mongoose;
const schema = new Schema({
  tenantId: { type: String, required: true, trim: true, immutable: true, maxlength: 100 },
  caseId: { type: Schema.Types.ObjectId, ref: 'RetirementSupportCase', required: true, immutable: true },
  subjectUserId: { type: String, required: true, immutable: true, maxlength: 128 },
  schemeType: { type: String, required: true, enum: RETIREMENT_SCHEME_TYPES },
  employerReference: { type: String, required: true, trim: true, maxlength: 128 },
  contributionPeriod: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
  currency: { type: String, required: true, uppercase: true, match: /^[A-Z]{3}$/ },
  expectedEmployeeAmountMinor: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  expectedEmployerAmountMinor: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  reportedEmployeeAmountMinor: { type: Number, min: 0, validate: (value) => value == null || Number.isSafeInteger(value), default: null },
  reportedEmployerAmountMinor: { type: Number, min: 0, validate: (value) => value == null || Number.isSafeInteger(value), default: null },
  remittanceSourceReference: { type: String, trim: true, maxlength: 200, default: null },
  evidenceReferences: { type: [{ type: String, trim: true, maxlength: 40 }], default: [] },
  matchingStatus: { type: String, enum: ['RECORDED', 'MATCHED', 'MISMATCH', 'REVIEW_REQUIRED'], default: 'RECORDED', required: true, index: true },
  schemeCreditStatus: { type: String, enum: ['UNKNOWN', 'CONFIRMED', 'NOT_CONFIRMED'], default: 'UNKNOWN', required: true },
  schemeCreditSourceName: { type: String, trim: true, maxlength: 200, default: null },
  schemeCreditSourceReference: { type: String, trim: true, maxlength: 200, default: null },
  schemeCreditConfirmedAt: { type: Date, default: null },
  schemeCreditConfirmedBy: { type: String, maxlength: 128, default: null },
  createdBy: { type: String, required: true, immutable: true, maxlength: 128 },
  updatedBy: { type: String, required: true, maxlength: 128 },
}, { timestamps: true, strict: 'throw', versionKey: '__v', minimize: true });
schema.index({ tenantId: 1, caseId: 1, contributionPeriod: 1 }, { unique: true, name: 'uniq_retirement_contribution_case_period' });
schema.index({ tenantId: 1, subjectUserId: 1, contributionPeriod: 1 }, { name: 'idx_retirement_contribution_subject_period' });
schema.pre('validate', function validateSchemeCredit(next) {
  if (this.schemeCreditStatus === 'CONFIRMED' && (!this.schemeCreditSourceName || !this.schemeCreditSourceReference || !this.schemeCreditConfirmedAt || !this.schemeCreditConfirmedBy)) {
    return next(new Error('Official scheme-credit confirmation requires attributable authority evidence.'));
  }
  next();
});
export default mongoose.models.RetirementContributionRecord || mongoose.model('RetirementContributionRecord', schema);
