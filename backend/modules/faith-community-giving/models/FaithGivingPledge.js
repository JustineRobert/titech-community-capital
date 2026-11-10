import mongoose from 'mongoose';
import { FAITH_GIVING_CURRENCIES, FAITH_GIVING_PLEDGE_STATES } from '../faithGiving.policy.js';

const { Schema } = mongoose;
const schema = new Schema({
  tenantId: { type: String, required: true, trim: true, lowercase: true, immutable: true, maxlength: 100 },
  campaignId: { type: Schema.Types.ObjectId, ref: 'FaithGivingCampaign', required: true, immutable: true },
  publicReference: { type: String, required: true, immutable: true, trim: true, maxlength: 64 },
  idempotencyKey: { type: String, required: true, immutable: true, trim: true, maxlength: 128 },
  amountMinor: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  currency: { type: String, required: true, enum: FAITH_GIVING_CURRENCIES },
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

export default mongoose.models.FaithGivingPledge || mongoose.model('FaithGivingPledge', schema);
