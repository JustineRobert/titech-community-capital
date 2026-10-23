/** Credit-origination record only. This model does not authorize lending or disbursement. */
import mongoose from 'mongoose';
import { ADVANCE_APPLICATION_STATUS } from '../domain/ubuntuFloatRules.js';

const { Schema } = mongoose;
const AdvanceApplicationSchema = new Schema({
  tenantId: { type: String, required: true, immutable: true, index: true },
  applicationReference: { type: String, required: true, immutable: true, unique: true },
  applicantActorId: { type: String, required: true, immutable: true, index: true },
  agentId: { type: Schema.Types.ObjectId, ref: 'UbuntuFloatAgent', required: true, immutable: true, index: true },
  requestedAmountMinorUnits: { type: String, required: true, match: /^[1-9]\d{0,17}$/ },
  currency: { type: String, required: true, uppercase: true, match: /^[A-Z]{3}$/ },
  purpose: { type: String, required: true, trim: true, maxlength: 500 },
  noticeVersion: { type: String, required: true, trim: true, maxlength: 80 },
  noticeAcknowledgedAt: { type: Date, required: true, immutable: true },
  status: { type: String, enum: Object.values(ADVANCE_APPLICATION_STATUS), default: ADVANCE_APPLICATION_STATUS.SUBMITTED, required: true, index: true },
  decision: { type: String, default: null },
  decisionReasonCodes: { type: [String], default: [] },
  fundingPartnerId: { type: String, default: null },
}, { timestamps: true, strict: 'throw' });

AdvanceApplicationSchema.index({ tenantId: 1, applicantActorId: 1, createdAt: -1 }, { name: 'ubuntu_float_application_own_list' });
AdvanceApplicationSchema.index({ tenantId: 1, status: 1, createdAt: 1 }, { name: 'ubuntu_float_application_review_queue' });
export default mongoose.models.UbuntuFloatAdvanceApplication || mongoose.model('UbuntuFloatAdvanceApplication', AdvanceApplicationSchema);
