import mongoose from 'mongoose';
import { EDUCATION_BUDGET_CATEGORIES, EDUCATION_CAMPAIGN_CATEGORIES, EDUCATION_CAMPAIGN_STATES, EDUCATION_COMMUNITY_SCOPES, EDUCATION_CURRENCIES } from '../educationCampaign.policy.js';

const { Schema } = mongoose;
const budgetLineSchema = new Schema({
  category: { type: String, enum: EDUCATION_BUDGET_CATEGORIES, required: true },
  description: { type: String, required: true, trim: true, maxlength: 180 },
  amountMinor: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
}, { _id: false, strict: 'throw' });

const historySchema = new Schema({
  fromStatus: { type: String, enum: EDUCATION_CAMPAIGN_STATES, default: null },
  toStatus: { type: String, enum: EDUCATION_CAMPAIGN_STATES, required: true },
  actorId: { type: String, required: true, maxlength: 128 },
  reason: { type: String, trim: true, maxlength: 1000, default: null },
  version: { type: Number, required: true, min: 1 },
  at: { type: Date, default: Date.now },
}, { _id: false, strict: 'throw' });

const schema = new Schema({
  tenantId: { type: String, required: true, trim: true, lowercase: true, immutable: true, maxlength: 100, index: true },
  publicReference: { type: String, required: true, immutable: true, trim: true, maxlength: 64 },
  title: { type: String, required: true, trim: true, minlength: 5, maxlength: 120 },
  publicDescription: { type: String, required: true, trim: true, minlength: 30, maxlength: 2400 },
  category: { type: String, required: true, enum: EDUCATION_CAMPAIGN_CATEGORIES },
  communityScope: { type: String, required: true, enum: EDUCATION_COMMUNITY_SCOPES, default: 'COMMUNITY_WIDE' },
  eligibilitySummary: { type: String, required: true, trim: true, minlength: 10, maxlength: 1200 },
  selectionMethod: { type: String, required: true, trim: true, minlength: 10, maxlength: 1200 },
  targetAmountMinor: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  currency: { type: String, required: true, enum: EDUCATION_CURRENCIES },
  budgetLines: { type: [budgetLineSchema], required: true, validate: (lines) => Array.isArray(lines) && lines.length >= 1 && lines.length <= 20 },
  startAt: { type: Date, required: true },
  endAt: { type: Date, required: true },
  feeDisclosure: { type: String, required: true, trim: true, minlength: 5, maxlength: 600 },
  refundPolicy: { type: String, required: true, trim: true, minlength: 10, maxlength: 1200 },
  surplusPolicy: { type: String, required: true, enum: ['REFUND_OR_RETURN', 'DONOR_CONSENT_REQUIRED_REALLOCATION', 'PARTNER_TERMS_REVIEW_REQUIRED'] },
  status: { type: String, enum: EDUCATION_CAMPAIGN_STATES, required: true, default: 'DRAFT', index: true },
  version: { type: Number, required: true, default: 1, min: 1 },
  reviewedVersion: { type: Number, default: null, min: 1 },
  createdBy: { type: String, required: true, immutable: true, trim: true, maxlength: 128 },
  updatedBy: { type: String, required: true, trim: true, maxlength: 128 },
  reviewerId: { type: String, default: null, trim: true, maxlength: 128 },
  reviewReason: { type: String, default: null, trim: true, maxlength: 1000 },
  privacyAndSafeguardingReviewed: { type: Boolean, default: false },
  budgetAndTermsReviewed: { type: Boolean, default: false },
  history: { type: [historySchema], default: [] },
}, { timestamps: true, strict: 'throw', optimisticConcurrency: true, minimize: true });

schema.index({ tenantId: 1, updatedAt: -1 }, { name: 'education_campaign_tenant_updated' });
schema.index({ publicReference: 1 }, { unique: true, name: 'uniq_education_campaign_public_reference' });
schema.index({ status: 1, startAt: 1, endAt: 1 }, { name: 'education_campaign_public_window' });
schema.pre('validate', function validateBudgetAndDates(next) {
  const sum = (this.budgetLines || []).reduce((total, line) => total + Number(line.amountMinor || 0), 0);
  if (!Number.isSafeInteger(sum) || sum > this.targetAmountMinor) return next(new Error('Education campaign budget must be safe integer amounts and cannot exceed the target.'));
  if (this.startAt && this.endAt && this.endAt <= this.startAt) return next(new Error('Education campaign endAt must be later than startAt.'));
  if (this.status === 'APPROVED' || this.status === 'PUBLISHED' || this.status === 'PAUSED' || this.status === 'CLOSED') {
    if (!this.reviewerId || this.reviewedVersion !== this.version || this.privacyAndSafeguardingReviewed !== true || this.budgetAndTermsReviewed !== true) {
      return next(new Error('Approved education campaigns require independent review of the current version, budget, terms and safeguarding.'));
    }
  }
  next();
});

export default mongoose.models.EducationCampaign || mongoose.model('EducationCampaign', schema);
