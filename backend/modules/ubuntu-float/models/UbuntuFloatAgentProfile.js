import mongoose from 'mongoose';

const { Schema } = mongoose;
const schema = new Schema({
  tenantId: { type: String, required: true, trim: true, lowercase: true, immutable: true, maxlength: 100 },
  agentCode: { type: String, required: true, trim: true, uppercase: true, immutable: true, minlength: 3, maxlength: 40 },
  displayName: { type: String, required: true, trim: true, minlength: 2, maxlength: 200 },
  hierarchyRole: { type: String, required: true, enum: ['HEAD_OFFICE', 'SUPER_AGENT', 'SUB_AGENT', 'AGENT', 'OUTLET'] },
  parentAgentId: { type: Schema.Types.ObjectId, ref: 'UbuntuFloatAgentProfile', default: null },
  status: { type: String, required: true, enum: ['PENDING_REVIEW', 'NEEDS_MORE_INFORMATION', 'ACTIVE', 'SUSPENDED', 'REJECTED'], default: 'PENDING_REVIEW', index: true },
  verificationReference: { type: String, trim: true, maxlength: 160, default: null, select: false },
  reviewReason: { type: String, trim: true, maxlength: 1000, default: null },
  reviewedBy: { type: String, trim: true, maxlength: 128, default: null },
  reviewedAt: { type: Date, default: null },
  createdBy: { type: String, required: true, trim: true, immutable: true, maxlength: 128 },
  updatedBy: { type: String, required: true, trim: true, maxlength: 128 },
  history: { type: [{ fromStatus: String, toStatus: String, actorId: String, reason: String, evidenceReference: String, at: { type: Date, default: Date.now } }], default: [] },
}, {
  timestamps: true,
  strict: 'throw',
  minimize: true,
  toJSON: {
    transform(_doc, ret) {
      delete ret._id;
      delete ret.__v;
      delete ret.verificationReference;
      ret.id = String(_doc._id);
      return ret;
    },
  },
});

schema.index({ tenantId: 1, agentCode: 1 }, { unique: true, name: 'uniq_ubuntufloat_agent_code_per_tenant' });
schema.index({ tenantId: 1, parentAgentId: 1, status: 1 }, { name: 'ubuntufloat_agent_hierarchy_lookup' });
schema.pre('validate', function validateReviewEvidence(next) {
  if (this.status === 'ACTIVE' && (!this.reviewedBy || !this.reviewedAt || !this.verificationReference)) {
    return next(new Error('An active UbuntuFloat agent requires independent review and a verification evidence reference.'));
  }
  if (['SUSPENDED', 'REJECTED', 'NEEDS_MORE_INFORMATION'].includes(this.status) && !this.reviewReason) {
    return next(new Error('A reason is required for the selected UbuntuFloat agent review state.'));
  }
  if (this.parentAgentId && this._id && String(this.parentAgentId) === String(this._id)) {
    return next(new Error('An UbuntuFloat agent cannot be its own parent.'));
  }
  return next();
});

export default mongoose.models.UbuntuFloatAgentProfile
  || mongoose.model('UbuntuFloatAgentProfile', schema);
