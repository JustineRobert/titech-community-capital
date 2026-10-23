import mongoose from 'mongoose';

const { Schema } = mongoose;
const schema = new Schema({
  tenantId: { type: String, required: true, trim: true, lowercase: true, immutable: true, maxlength: 100, index: true },
  agentId: { type: Schema.Types.ObjectId, ref: 'UbuntuFloatAgentProfile', required: true, immutable: true },
  provider: { type: String, required: true, enum: ['MTN_MOMO', 'AIRTEL_MONEY', 'MPESA', 'BANK', 'OTHER'], immutable: true },
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3, immutable: true },
  reportedAmountMinor: { type: Number, required: true, min: 0, validate: { validator: Number.isSafeInteger, message: 'Reported amount must be an exact safe integer.' }, immutable: true },
  observedAt: { type: Date, required: true, immutable: true },
  attestationReference: { type: String, required: true, trim: true, maxlength: 160, immutable: true },
  notes: { type: String, trim: true, maxlength: 500, default: null, immutable: true },
  sourceType: { type: String, enum: ['MANUAL_ATTESTATION'], default: 'MANUAL_ATTESTATION', immutable: true },
  verificationStatus: { type: String, enum: ['UNVERIFIED_MANUAL_ATTESTATION'], default: 'UNVERIFIED_MANUAL_ATTESTATION', immutable: true },
  recordedBy: { type: String, required: true, trim: true, immutable: true, maxlength: 128 },
}, {
  timestamps: true,
  strict: 'throw',
  versionKey: '__v',
  toJSON: { transform(_doc, ret) { delete ret._id; delete ret.__v; ret.id = String(_doc._id); return ret; } },
});

schema.index({ tenantId: 1, agentId: 1, provider: 1, observedAt: -1 }, { name: 'ubuntufloat_position_observation_timeline' });
schema.index({ tenantId: 1, attestationReference: 1 }, { unique: true, name: 'uniq_ubuntufloat_attestation_per_tenant' });

export default mongoose.models.UbuntuFloatPositionObservation
  || mongoose.model('UbuntuFloatPositionObservation', schema);
