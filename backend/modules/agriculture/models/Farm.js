import mongoose from 'mongoose';
import { OFFLINE_SYNC_STATUSES, RECORD_STATUSES, VERIFICATION_STATUSES, AGRICULTURE_SCHEMA_VERSION } from '../constants.js';
const { Schema } = mongoose;
const farmSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, immutable: true, index: true },
  producerId: { type: Schema.Types.ObjectId, ref: 'AgricultureProducer', required: true, index: true },
  groupId: { type: Schema.Types.ObjectId, ref: 'Group', default: null, index: true },
  location: { type: Schema.Types.Mixed, default: null },
  acreage: { type: Schema.Types.Decimal128, required: true, min: 0 },
  landTenureType: { type: String, trim: true, maxlength: 64, default: 'UNKNOWN' },
  irrigationStatus: { type: String, trim: true, maxlength: 64, default: 'UNKNOWN' },
  soilInformation: { type: Schema.Types.Mixed, default: null },
  productionSystems: { type: [String], default: [] },
  verificationStatus: { type: String, enum: VERIFICATION_STATUSES, default: 'PENDING', index: true },
  status: { type: String, enum: RECORD_STATUSES, default: 'ACTIVE', index: true },
  schemaVersion: { type: Number, default: AGRICULTURE_SCHEMA_VERSION, immutable: true },
  deviceId: { type: String, trim: true, maxlength: 128, default: null },
  clientOperationId: { type: String, trim: true, maxlength: 255, default: null },
  payloadHash: { type: String, trim: true, maxlength: 128, default: null },
  syncStatus: { type: String, enum: OFFLINE_SYNC_STATUSES, default: 'SERVER_ACCEPTED' },
  idempotencyKey: { type: String, trim: true, maxlength: 255, default: null },
  idempotencyFingerprint: { type: String, trim: true, maxlength: 128, default: null },
  metadata: { type: Schema.Types.Mixed, default: () => ({}) },
}, { timestamps: true, versionKey: 'version', optimisticConcurrency: true, collection: 'agriculture_farms', minimize: false });
farmSchema.index({ tenantId: 1, producerId: 1, status: 1 });
farmSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });
export default mongoose.models.AgricultureFarm || mongoose.model('AgricultureFarm', farmSchema);
