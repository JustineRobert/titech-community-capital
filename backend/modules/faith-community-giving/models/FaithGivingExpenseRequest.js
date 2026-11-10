import mongoose from 'mongoose';
import { FAITH_GIVING_BUDGET_CATEGORIES, FAITH_GIVING_CURRENCIES, FAITH_GIVING_EXPENSE_STATES } from '../faithGiving.policy.js';

const { Schema } = mongoose;
const historySchema = new Schema({
  fromStatus: { type: String, enum: FAITH_GIVING_EXPENSE_STATES, default: null },
  toStatus: { type: String, enum: FAITH_GIVING_EXPENSE_STATES, required: true },
  actorId: { type: String, required: true, maxlength: 128 },
  reason: { type: String, trim: true, maxlength: 1000, default: null },
  at: { type: Date, default: Date.now },
}, { _id: false, strict: 'throw' });

const schema = new Schema({
  tenantId: { type: String, required: true, trim: true, lowercase: true, immutable: true, maxlength: 100 },
  campaignId: { type: Schema.Types.ObjectId, ref: 'FaithGivingCampaign', required: true, immutable: true },
  publicReference: { type: String, required: true, immutable: true, trim: true, maxlength: 64 },
  category: { type: String, enum: FAITH_GIVING_BUDGET_CATEGORIES, required: true },
  description: { type: String, required: true, trim: true, minlength: 5, maxlength: 500 },
  payeeLabel: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
  evidenceReference: { type: String, required: true, trim: true, maxlength: 128 },
  amountMinor: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  currency: { type: String, required: true, enum: FAITH_GIVING_CURRENCIES },
  status: { type: String, enum: FAITH_GIVING_EXPENSE_STATES, required: true, default: 'PENDING_APPROVAL' },
  requestedBy: { type: String, required: true, immutable: true, trim: true, maxlength: 128 },
  reviewerId: { type: String, default: null, trim: true, maxlength: 128 },
  reviewReason: { type: String, default: null, trim: true, maxlength: 1000 },
  history: { type: [historySchema], default: [] },
}, { timestamps: true, strict: 'throw', optimisticConcurrency: true });

schema.index({ tenantId: 1, campaignId: 1, createdAt: -1 }, { name: 'faith_giving_expense_campaign_created' });
schema.index({ publicReference: 1 }, { unique: true, name: 'uniq_faith_giving_expense_public_reference' });

export default mongoose.models.FaithGivingExpenseRequest || mongoose.model('FaithGivingExpenseRequest', schema);
