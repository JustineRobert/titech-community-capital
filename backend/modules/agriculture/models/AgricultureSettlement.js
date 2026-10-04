import mongoose from 'mongoose';
import { ALLOCATION_PURPOSES, ALLOCATION_RULES, RECONCILIATION_STATUSES, SETTLEMENT_STATUSES } from '../constants.js';
const { Schema } = mongoose;
const allocationSchema = new Schema({
  accountId: { type: Schema.Types.ObjectId, required: true },
  purpose: { type: String, enum: ALLOCATION_PURPOSES, required: true },
  amount: { type: Schema.Types.Decimal128, required: true, min: 0 },
  weight: { type: String, default: null },
}, { _id: false });
const settlementSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, immutable: true, index: true },
  deliveryId: { type: Schema.Types.ObjectId, ref: 'AgricultureDelivery', required: true, immutable: true, index: true },
  buyerId: { type: Schema.Types.ObjectId, ref: 'AgricultureBuyer', required: true, immutable: true },
  producerId: { type: Schema.Types.ObjectId, ref: 'AgricultureProducer', required: true, immutable: true },
  groupId: { type: Schema.Types.ObjectId, ref: 'Group', default: null, immutable: true },
  productionCycleId: { type: Schema.Types.ObjectId, ref: 'AgricultureProductionCycle', required: true, immutable: true },
  invoiceReference: { type: String, trim: true, maxlength: 200, default: null },
  grossAmount: { type: Schema.Types.Decimal128, required: true, min: 0, immutable: true },
  currency: { type: String, required: true, uppercase: true, trim: true, maxlength: 16, immutable: true },
  sourceAccountId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  allocationRule: { type: String, enum: ALLOCATION_RULES, required: true, immutable: true },
  allocationFormulaVersion: { type: String, required: true, maxlength: 32, immutable: true },
  allocations: { type: [allocationSchema], required: true, immutable: true },
  providerName: { type: String, trim: true, maxlength: 128, default: null },
  providerReference: { type: String, trim: true, maxlength: 256, default: null, index: true },
  paymentEvidence: { type: [Schema.Types.Mixed], default: [] },
  status: { type: String, enum: SETTLEMENT_STATUSES, default: 'PENDING_PAYMENT', index: true },
  reconciliationStatus: { type: String, enum: RECONCILIATION_STATUSES, default: 'UNMATCHED', index: true },
  financialTransactionId: { type: String, default: null, index: true },
  confirmedAt: { type: Date, default: null },
  idempotencyKey: { type: String, trim: true, maxlength: 255, required: true, immutable: true },
  idempotencyFingerprint: { type: String, trim: true, maxlength: 128, default: null, immutable: true },
  actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  metadata: { type: Schema.Types.Mixed, default: () => ({}) },
}, { timestamps: true, collection: 'agriculture_settlements', minimize: false, optimisticConcurrency: true });
settlementSchema.index({ tenantId: 1, deliveryId: 1 }, { unique: true });
settlementSchema.index({ tenantId: 1, providerReference: 1 }, { unique: true, sparse: true });
settlementSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
export default mongoose.models.AgricultureSettlement || mongoose.model('AgricultureSettlement', settlementSchema);
