/** Tenant-scoped UbuntuFloat agent/network identity; not a payment account. */
import mongoose from 'mongoose';

const { Schema } = mongoose;
const AgentSchema = new Schema({
  tenantId: { type: String, required: true, immutable: true, index: true },
  externalAgentRef: { type: String, required: true, trim: true, maxlength: 100 },
  displayName: { type: String, required: true, trim: true, maxlength: 160 },
  level: { type: String, required: true, enum: ['HEAD_OFFICE', 'SUPER_AGENT', 'SUB_AGENT', 'AGENT', 'OUTLET'] },
  parentAgentId: { type: Schema.Types.ObjectId, ref: 'UbuntuFloatAgent', default: null },
  countryCode: { type: String, required: true, enum: ['UG'], default: 'UG' },
  status: { type: String, required: true, enum: ['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'INACTIVE'], default: 'PENDING_VERIFICATION', index: true },
  providerEnrollments: { type: [String], default: [] },
  createdBy: { type: String, required: true, immutable: true },
  verificationReference: { type: String, default: null, select: false },
}, { timestamps: true, strict: 'throw' });

AgentSchema.index({ tenantId: 1, externalAgentRef: 1 }, { unique: true, name: 'ubuntu_float_agent_ref_per_tenant' });
AgentSchema.index({ tenantId: 1, parentAgentId: 1, level: 1 }, { name: 'ubuntu_float_hierarchy_lookup' });

export default mongoose.models.UbuntuFloatAgent || mongoose.model('UbuntuFloatAgent', AgentSchema);
