import mongoose from 'mongoose';
import { CONTRACT_STATUSES, OFFLINE_SYNC_STATUSES, PRICING_METHODS } from '../constants.js';
const { Schema } = mongoose;
const contractSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, immutable: true, index: true },
  buyerId: { type: Schema.Types.ObjectId, ref: 'AgricultureBuyer', required: true, index: true },
  producerId: { type: Schema.Types.ObjectId, ref: 'AgricultureProducer', default: null, index: true },
  groupId: { type: Schema.Types.ObjectId, ref: 'Group', default: null, index: true },
  commodityId: { type: Schema.Types.ObjectId, ref: 'AgricultureCommodity', required: true, index: true },
  expectedQuantity: { type: Schema.Types.Decimal128, required: true, min: 0 },
  unit: { type: String, required: true, trim: true, maxlength: 32 },
  pricingMethod: { type: String, enum: PRICING_METHODS, required: true },
  price: { type: Schema.Types.Decimal128, required: true, min: 0 },
  currency: { type: String, required: true, uppercase: true, trim: true, maxlength: 16 },
  qualityRequirements: { type: Schema.Types.Mixed, default: null },
  deliveryWindow: { type: Schema.Types.Mixed, default: null },
  paymentTerms: { type: Schema.Types.Mixed, default: null },
  deductions: { type: [Schema.Types.Mixed], default: [] },
  financingLink: { type: Schema.Types.Mixed, default: null },
  status: { type: String, enum: CONTRACT_STATUSES, default: 'DRAFT', index: true },
  version: { type: Number, default: 1 },
  deviceId: { type: String, trim: true, maxlength: 128, default: null },
  clientOperationId: { type: String, trim: true, maxlength: 255, default: null },
  payloadHash: { type: String, trim: true, maxlength: 128, default: null },
  syncStatus: { type: String, enum: OFFLINE_SYNC_STATUSES, default: 'SERVER_ACCEPTED' },
  idempotencyKey: { type: String, trim: true, maxlength: 255, default: null },
  idempotencyFingerprint: { type: String, trim: true, maxlength: 128, default: null },
}, { timestamps: true, collection: 'agriculture_offtake_contracts', minimize: false });
contractSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });
export default mongoose.models.AgricultureOfftakeContract || mongoose.model('AgricultureOfftakeContract', contractSchema);
