import mongoose from 'mongoose';
const { Schema } = mongoose;
const commoditySchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, immutable: true, index: true },
  code: { type: String, required: true, trim: true, uppercase: true, maxlength: 64 },
  name: { type: String, required: true, trim: true, maxlength: 128 },
  variety: { type: String, trim: true, maxlength: 128, default: null },
  units: { type: [String], default: [] },
  qualityGrades: { type: [String], default: [] },
  pricingModels: { type: [String], default: [] },
  seasonality: { type: Schema.Types.Mixed, default: null },
  productionMetrics: { type: [String], default: [] },
  status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE', index: true },
  idempotencyKey: { type: String, trim: true, maxlength: 255, default: null },
  idempotencyFingerprint: { type: String, trim: true, maxlength: 128, default: null },
}, { timestamps: true, collection: 'agriculture_commodities', minimize: false });
commoditySchema.index({ tenantId: 1, code: 1 }, { unique: true });
export default mongoose.models.AgricultureCommodity || mongoose.model('AgricultureCommodity', commoditySchema);
