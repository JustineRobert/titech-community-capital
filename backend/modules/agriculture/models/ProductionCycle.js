import mongoose from 'mongoose';
import { OFFLINE_SYNC_STATUSES, PRODUCTION_STATUSES, VERIFICATION_STATUSES, AGRICULTURE_SCHEMA_VERSION } from '../constants.js';
const { Schema } = mongoose;
const activitySchema = new Schema({
  type: { type: String, required: true, trim: true, maxlength: 64 },
  date: { type: Date, required: true },
  quantity: { type: Schema.Types.Decimal128, default: null },
  unit: { type: String, trim: true, maxlength: 32, default: null },
  note: { type: String, trim: true, maxlength: 1000, default: null },
  evidenceRefs: { type: [String], default: [] },
  clientOperationId: { type: String, trim: true, maxlength: 255, default: null },
  payloadHash: { type: String, trim: true, maxlength: 128, default: null },
}, { _id: true });
const cycleSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, immutable: true, index: true },
  producerId: { type: Schema.Types.ObjectId, ref: 'AgricultureProducer', required: true, index: true },
  farmId: { type: Schema.Types.ObjectId, ref: 'AgricultureFarm', required: true, index: true },
  groupId: { type: Schema.Types.ObjectId, ref: 'Group', default: null, index: true },
  commodityId: { type: Schema.Types.ObjectId, ref: 'AgricultureCommodity', required: true, index: true },
  season: { type: String, required: true, trim: true, maxlength: 128 },
  plantingDate: { type: Date, default: null },
  expectedHarvestDate: { type: Date, default: null },
  actualHarvestDate: { type: Date, default: null },
  area: { type: Schema.Types.Decimal128, required: true, min: 0 },
  expectedYield: { type: Schema.Types.Decimal128, default: null, min: 0 },
  actualYield: { type: Schema.Types.Decimal128, default: null, min: 0 },
  unitOfMeasure: { type: String, required: true, trim: true, maxlength: 32 },
  productionStatus: { type: String, enum: PRODUCTION_STATUSES, default: 'PLANNED', index: true },
  verificationStatus: { type: String, enum: VERIFICATION_STATUSES, default: 'PENDING', index: true },
  activities: { type: [activitySchema], default: [] },
  version: { type: Number, default: 1 },
  schemaVersion: { type: Number, default: AGRICULTURE_SCHEMA_VERSION, immutable: true },
  deviceId: { type: String, trim: true, maxlength: 128, default: null },
  clientOperationId: { type: String, trim: true, maxlength: 255, default: null },
  payloadHash: { type: String, trim: true, maxlength: 128, default: null },
  syncStatus: { type: String, enum: OFFLINE_SYNC_STATUSES, default: 'SERVER_ACCEPTED' },
  idempotencyKey: { type: String, trim: true, maxlength: 255, default: null },
  idempotencyFingerprint: { type: String, trim: true, maxlength: 128, default: null },
  metadata: { type: Schema.Types.Mixed, default: () => ({}) },
}, { timestamps: true, collection: 'agriculture_production_cycles', minimize: false });
cycleSchema.index({ tenantId: 1, producerId: 1, season: 1, commodityId: 1 });
cycleSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });
export default mongoose.models.AgricultureProductionCycle || mongoose.model('AgricultureProductionCycle', cycleSchema);
