import mongoose from 'mongoose';
import { DELIVERY_STATUSES, OFFLINE_SYNC_STATUSES, VERIFICATION_STATUSES } from '../constants.js';
const { Schema } = mongoose;
const deliverySchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, immutable: true, index: true },
  contractId: { type: Schema.Types.ObjectId, ref: 'AgricultureOfftakeContract', required: true, index: true },
  producerId: { type: Schema.Types.ObjectId, ref: 'AgricultureProducer', required: true, index: true },
  buyerId: { type: Schema.Types.ObjectId, ref: 'AgricultureBuyer', required: true, index: true },
  productionCycleId: { type: Schema.Types.ObjectId, ref: 'AgricultureProductionCycle', required: true, index: true },
  quantity: { type: Schema.Types.Decimal128, required: true, min: 0 },
  unit: { type: String, required: true, trim: true, maxlength: 32 },
  qualityGrade: { type: String, trim: true, maxlength: 64, default: null },
  warehouse: { type: String, trim: true, maxlength: 200, default: null },
  deliveryDate: { type: Date, required: true, default: Date.now },
  receivingParty: { type: Schema.Types.Mixed, default: null },
  supportingEvidence: { type: [Schema.Types.Mixed], default: [] },
  verificationStatus: { type: String, enum: VERIFICATION_STATUSES, default: 'PENDING', index: true },
  status: { type: String, enum: DELIVERY_STATUSES, default: 'PENDING_VERIFICATION', index: true },
  idempotencyKey: { type: String, trim: true, maxlength: 255, default: null },
  idempotencyFingerprint: { type: String, trim: true, maxlength: 128, default: null },
  deviceId: { type: String, trim: true, maxlength: 128, default: null },
  clientOperationId: { type: String, trim: true, maxlength: 255, default: null },
  payloadHash: { type: String, trim: true, maxlength: 128, default: null },
  syncStatus: { type: String, enum: OFFLINE_SYNC_STATUSES, default: 'SERVER_ACCEPTED' },
  metadata: { type: Schema.Types.Mixed, default: () => ({}) },
}, { timestamps: true, collection: 'agriculture_deliveries', minimize: false });
deliverySchema.index({ tenantId: 1, contractId: 1, status: 1 });
deliverySchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });
export default mongoose.models.AgricultureDelivery || mongoose.model('AgricultureDelivery', deliverySchema);
