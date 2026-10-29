/**
 * Public institutional conversion-request aggregate.
 * Stores only data voluntarily supplied for a demo or business enquiry.
 * It is not a tenant financial record, customer account, or chat transcript.
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

const ConsentSchema = new Schema({
  accepted: { type: Boolean, required: true, enum: [true] },
  purpose: { type: String, required: true, maxlength: 200 },
  policyVersion: { type: String, required: true, maxlength: 40 },
  recordedAt: { type: Date, required: true },
}, { _id: false, strict: true });

const StatusHistorySchema = new Schema({
  status: {
    type: String,
    required: true,
    enum: ['NEW', 'TRIAGED', 'ASSIGNED', 'IN_PROGRESS', 'RESPONDED', 'RESOLVED'],
  },
  changedAt: { type: Date, required: true, default: Date.now },
  actorUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  note: { type: String, maxlength: 1000, default: '' },
}, { _id: false, strict: true });

const InstitutionalLeadSchema = new Schema({
  referenceNumber: { type: String, required: true, unique: true, immutable: true, maxlength: 40 },
  submissionKey: { type: String, required: true, unique: true, immutable: true, maxlength: 128 },
  payloadFingerprint: { type: String, required: true, immutable: true, select: false, match: /^[a-f0-9]{64}$/ },
  type: { type: String, required: true, enum: ['DEMO', 'CONTACT', 'CHAT_FOLLOW_UP'], index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
  organization: { type: String, trim: true, maxlength: 180, default: '' },
  role: { type: String, trim: true, maxlength: 120, default: '' },
  organizationType: { type: String, enum: ['SACCO', 'COOPERATIVE', 'MFI', 'NGO_PROGRAMME', 'FINANCIAL_SOFTWARE_PROVIDER', 'PAYMENT_PROVIDER', 'OTHER'], default: undefined },
  country: { type: String, trim: true, maxlength: 80, default: '' },
  primaryInterest: { type: String, maxlength: 80, default: undefined },
  monthlyVolume: { type: String, maxlength: 40, default: undefined },
  preferredDate: { type: String, maxlength: 10, default: undefined },
  timezone: { type: String, required: true, maxlength: 80, default: 'Africa/Kampala' },
  category: { type: String, maxlength: 80, default: undefined },
  subject: { type: String, trim: true, maxlength: 180, default: '' },
  message: { type: String, trim: true, maxlength: 2500, default: '' },
  consent: { type: ConsentSchema, required: true },
  source: { type: String, required: true, enum: ['PUBLIC_WEBSITE'], immutable: true },
  status: { type: String, required: true, enum: ['NEW', 'TRIAGED', 'ASSIGNED', 'IN_PROGRESS', 'RESPONDED', 'RESOLVED'], default: 'NEW', index: true },
  assignedToUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  statusHistory: { type: [StatusHistorySchema], required: true, default: [] },
  auditState: { type: String, enum: ['PENDING', 'RECORDED'], default: 'PENDING', index: true },
  auditLastErrorCode: { type: String, maxlength: 80, select: false, default: undefined },
}, {
  collection: 'institutional_leads',
  timestamps: true,
  versionKey: '__v',
  optimisticConcurrency: true,
  strict: 'throw',
  minimize: true,
});

InstitutionalLeadSchema.index({ status: 1, createdAt: -1 });
InstitutionalLeadSchema.index({ type: 1, createdAt: -1 });

const InstitutionalLead = mongoose.models.InstitutionalLead
  || mongoose.model('InstitutionalLead', InstitutionalLeadSchema);

export default InstitutionalLead;
export { InstitutionalLeadSchema };
