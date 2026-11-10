import mongoose from 'mongoose';
import {
  FAITH_GIVING_BUDGET_CATEGORIES,
  FAITH_GIVING_CATEGORIES,
  FAITH_GIVING_COMMUNITY_SCOPES,
  FAITH_GIVING_CURRENCIES,
  FAITH_GIVING_ORGANISATION_TYPES,
  FAITH_GIVING_STATES,
} from '../faithGiving.policy.js';

const { Schema } = mongoose;
const budgetLineSchema = new Schema({
  category: { type: String, enum: FAITH_GIVING_BUDGET_CATEGORIES, required: true },
  description: { type: String, required: true, trim: true, maxlength: 180 },
  amountMinor: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  committedAmountMinor: { type: Number, required: true, default: 0, min: 0, validate: Number.isSafeInteger },
}, { _id: false, strict: 'throw' });

const historySchema = new Schema({
  fromStatus: { type: String, enum: FAITH_GIVING_STATES, default: null },
  toStatus: { type: String, enum: FAITH_GIVING_STATES, required: true },
  actorId: { type: String, required: true, maxlength: 128 },
  reason: { type: String, trim: true, maxlength: 1000, default: null },
  version: { type: Number, required: true, min: 1 },
  at: { type: Date, default: Date.now },
}, { _id: false, strict: 'throw' });

const schema = new Schema({
  tenantId: { type: String, required: true, trim: true, lowercase: true, immutable: true, maxlength: 100, index: true },
  publicReference: { type: String, required: true, immutable: true, trim: true, maxlength: 64 },
  title: { type: String, required: true, trim: true, minlength: 5, maxlength: 120 },
  organisationName: { type: String, required: true, trim: true, minlength: 2, maxlength: 140 },
  organisationType: { type: String, required: true, enum: FAITH_GIVING_ORGANISATION_TYPES },
  category: { type: String, required: true, enum: FAITH_GIVING_CATEGORIES },
  communityScope: { type: String, required: true, enum: FAITH_GIVING_COMMUNITY_SCOPES, default: 'COMMUNITY_WIDE' },
  publicDescription: { type: String, required: true, trim: true, minlength: 30, maxlength: 2400 },
  beneficiarySummary: { type: String, required: true, trim: true, minlength: 10, maxlength: 600 },
  targetAmountMinor: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  currency: { type: String, required: true, enum: FAITH_GIVING_CURRENCIES },
  budgetLines: { type: [budgetLineSchema], required: true, validate: (lines) => Array.isArray(lines) && lines.length >= 1 && lines.length <= 20 },
  startAt: { type: Date, required: true },
  endAt: { type: Date, required: true },
  visibility: { type: String, enum: ['PUBLIC', 'PRIVATE'], default: 'PUBLIC', required: true },
  receivingDestinationReference: { type: String, trim: true, maxlength: 128, default: null },
  organiserVerificationReference: { type: String, trim: true, maxlength: 128, default: null },
  partnerAuthorizationReference: { type: String, trim: true, maxlength: 128, default: null },
  feeDisclosure: { type: String, required: true, trim: true, minlength: 5, maxlength: 600 },
  refundPolicy: { type: String, required: true, trim: true, minlength: 10, maxlength: 1200 },
  surplusPolicy: { type: String, enum: ['REFUND_OR_RETURN', 'DONOR_CONSENT_REQUIRED_REALLOCATION', 'PARTNER_TERMS_REVIEW_REQUIRED'], required: true },
  status: { type: String, enum: FAITH_GIVING_STATES, required: true, default: 'DRAFT', index: true },
  version: { type: Number, required: true, default: 1, min: 1 },
  reviewedVersion: { type: Number, default: null, min: 1 },
  createdBy: { type: String, required: true, immutable: true, trim: true, maxlength: 128 },
  updatedBy: { type: String, required: true, trim: true, maxlength: 128 },
  reviewerId: { type: String, default: null, trim: true, maxlength: 128 },
  reviewReason: { type: String, default: null, trim: true, maxlength: 1000 },
  organiserAuthorityReviewed: { type: Boolean, default: false },
  privacyAndSafeguardingReviewed: { type: Boolean, default: false },
  budgetAndTermsReviewed: { type: Boolean, default: false },
  partnerSafeguardingReviewed: { type: Boolean, default: false },
  history: { type: [historySchema], default: [] },
}, { timestamps: true, strict: 'throw', optimisticConcurrency: true, minimize: true });

schema.index({ tenantId:  1, updatedAt: -1 }, { name: 'faith_giving_campaign_tenant_updated' });
schema.index({ publicReference: 1 }, { unique: true, name: 'uniq_faith_giving_campaign_public_reference' });
schema.index({ status: 1, visibility: 1, startAt: 1, endAt: 1 }, { name: 'faith_giving_campaign_public_window' });

schema.pre('validate', function validateCampaign(next) {
  const total = (this.budgetLines || []).reduce((sum, line) => sum + Number(line.amountMinor || 0), 0);
  if (!Number.isSafeInteger(total) || total > this.targetAmountMinor) return next(new Error('Campaign budget must use safe integer minor units and cannot exceed the target.'));
  for (const line of this.budgetLines || []) {
    if (!Number.isSafeInteger(line.committedAmountMinor) || line.committedAmountMinor < 0 || line.committedAmountMinor > line.amountMinor) {
      return next(new Error('Committed campaign budget reservations must be safe integers between zero and the approved line amount.'));
    }
  }
  if (this.startAt && this.endAt && this.endAt <= this.startAt) return next(new Error('Campaign endAt must be later than startAt.'));
  if (this.status === 'APPROVED' || this.status === 'PUBLISHED' || this.status === 'PAUSED' || this.status === 'CLOSED') {
    if (!this.reviewerId || this.createdBy === this.reviewerId || this.reviewedVersion !== this.version || !this.organiserAuthorityReviewed || !this.privacyAndSafeguardingReviewed || !this.budgetAndTermsReviewed) {
      return next(new Error('Approved campaigns require independent review of the current version, organizer authority, safeguarding, budget and terms.'));
    }
    if (!this.receivingDestinationReference || !this.organiserVerificationReference) return next(new Error('Publication requires reviewed organizer and receiving-destination evidence references.'));
    if (this.communityScope === 'REFUGEE_AND_HOST_COMMUNITIES' && (!this.partnerAuthorizationReference || !this.partnerSafeguardingReviewed)) {
      return next(new Error('Refugee and host-community campaigns require partner authorization and safeguarding review.'));
    }
  }
  next();
});

export default mongoose.models.FaithGivingCampaign || mongoose.model('FaithGivingCampaign', schema);
