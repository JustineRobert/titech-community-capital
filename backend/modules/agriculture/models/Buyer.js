import mongoose from 'mongoose';
import { BUYER_TYPES, RECORD_STATUSES, VERIFICATION_STATUSES } from '../constants.js';
const { Schema } = mongoose;
const buyerSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, immutable: true, index: true },
  organizationId: { type: String, trim: true, maxlength: 128, default: null },
  name: { type: String, required: true, trim: true, maxlength: 200 },
  buyerType: { type: String, enum: BUYER_TYPES, required: true, default: 'OTHER', index: true },
  registration: { type: Schema.Types.Mixed, default: null },
  contact: { type: Schema.Types.Mixed, default: null },
  commodities: [{ type: Schema.Types.ObjectId, ref: 'AgricultureCommodity' }],
  locations: { type: [Schema.Types.Mixed], default: [] },
  contractPreferences: { type: Schema.Types.Mixed, default: () => ({}) },
  settlementMethods: { type: [String], default: [] },
  verificationStatus: { type: String, enum: VERIFICATION_STATUSES, default: 'PENDING', index: true },
  complianceStatus: { type: String, enum: ['PENDING', 'CLEARED', 'REVIEW', 'BLOCKED'], default: 'PENDING', index: true },
  status: { type: String, enum: RECORD_STATUSES, default: 'ACTIVE', index: true },
  idempotencyKey: { type: String, trim: true, maxlength: 255, default: null },
  idempotencyFingerprint: { type: String, trim: true, maxlength: 128, default: null },
}, { timestamps: true, collection: 'agriculture_buyers', minimize: false });
buyerSchema.index({ tenantId: 1, organizationId: 1, name: 1 });
buyerSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });
export default mongoose.models.AgricultureBuyer || mongoose.model('AgricultureBuyer', buyerSchema);
