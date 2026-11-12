import mongoose from 'mongoose';
import {
  FAITH_GIVING_CURRENCIES, FAITH_GIVING_PLEDGE_STATES,
  FAITH_GIVING_PLEDGE_TYPES, FAITH_GIVING_IN_KIND_CATEGORIES,
  FAITH_GIVING_IN_KIND_UNITS, FAITH_GIVING_ITEM_CONDITIONS,
} from '../faithGiving.policy.js';

const { Schema } = mongoose;
const itemSchema = new Schema({
  category: { type: String, enum: FAITH_GIVING_IN_KIND_CATEGORIES, required: true },
  description: { type: String, required: true, trim: true, maxlength: 140 },
  quantity: { type: Number, required: true, min: 1, max: 100000, validate: Number.isSafeInteger },
  unit: { type: String, enum: FAITH_GIVING_IN_KIND_UNITS, required: true },
  condition: { type: String, enum: FAITH_GIVING_ITEM_CONDITIONS, required: true },
  notes: { type: String, trim: true, maxlength: 300, default: null },
}, { _id: false, strict: 'throw' });
const schema = new Schema({
  tenantId: { type: String, required: true, trim: true, lowercase: true, immutable: true, maxlength: 100 },
  campaignId: { type: Schema.Types.ObjectId, ref: 'FaithGivingCampaign', required: true, immutable: true },
  publicReference: { type: String, required: true, immutable: true, trim: true, maxlength: 64 },
  idempotencyKey: { type: String, required: true, immutable: true, trim: true, maxlength: 128 },
  pledgeType: { type: String, enum: FAITH_GIVING_PLEDGE_TYPES, required: true, default: 'CASH' },
  amountMinor: { type: Number, default: null, min: 1, validate: (value) => value === null || Number.isSafeInteger(value) },
  currency: { type: String, enum: FAITH_GIVING_CURRENCIES, default: null },
  items: { type: [itemSchema], default: [] },
  contributorLabel: { type: String, trim: true, maxlength: 80, default: null },
  anonymous: { type: Boolean, default: false },
  status: { type: String, enum: FAITH_GIVING_PLEDGE_STATES, default: 'PLEDGED', required: true },
  createdBy: { type: String, required: true, immutable: true, trim: true, maxlength: 128 },
  cancelledBy: { type: String, default: null, trim: true, maxlength: 128 },
  cancelledAt: { type: Date, default: null },
}, { timestamps: true, strict: 'throw', optimisticConcurrency: true });

schema.index({ tenantId: 1, campaignId: 1, createdAt: -1 }, { name: 'faith_giving_pledge_campaign_created' });
schema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true, name: 'uniq_faith_giving_pledge_idempotency' });
schema.index({ publicReference: 1 }, { unique: true, name: 'uniq_faith_giving_pledge_public_reference' });

schema.pre('validate', function validatePledge(next) {
  if (this.pledgeType === 'CASH') {
    if (!Number.isSafeInteger(this.amountMinor) || this.amountMinor < 1 || !FAITH_GIVING_CURRENCIES.includes(this.currency)) return next(new Error('Cash pledges require a positive safe-integer amount and enabled currency.'));
    if (this.items?.length) return next(new Error('Cash pledges cannot contain in-kind items.'));
  } else if (this.pledgeType === 'IN_KIND') {
    if (this.amountMinor !== null || this.currency !== null || !Array.isArray(this.items) || this.items.length < 1 || this.items.length > 10) return next(new Error('In-kind pledges require one to ten items and cannot contain monetary amounts.'));
  }
  next();
});

export default mongoose.models.FaithGivingPledge || mongoose.model('FaithGivingPledge', schema);
