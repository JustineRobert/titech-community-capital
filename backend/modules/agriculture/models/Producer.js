import mongoose from 'mongoose';
import { OFFLINE_SYNC_STATUSES, PRODUCER_TYPES, RECORD_STATUSES, VERIFICATION_STATUSES, AGRICULTURE_SCHEMA_VERSION } from '../constants.js';

const { Schema } = mongoose;
const producerSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, immutable: true, index: true },
  memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true, immutable: true, index: true },
  groupId: { type: Schema.Types.ObjectId, ref: 'Group', default: null, index: true },
  producerType: { type: String, enum: PRODUCER_TYPES, required: true, default: 'INDIVIDUAL_FARMER' },
  organizationId: { type: String, trim: true, maxlength: 128, default: null },
  verificationStatus: { type: String, enum: VERIFICATION_STATUSES, default: 'PENDING', index: true },
  primaryLocation: { type: Schema.Types.Mixed, default: null },
  farmCount: { type: Number, min: 0, default: 0 },
  totalProductionArea: { type: Schema.Types.Decimal128, min: 0, default: '0' },
  preferredLanguage: { type: String, trim: true, maxlength: 16, default: 'en' },
  contactChannels: { type: Schema.Types.Mixed, default: () => ({}) },
  onboardingStatus: { type: String, enum: ['NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'VERIFICATION_REQUIRED', 'APPROVED', 'REJECTED', 'SUSPENDED', 'WITHDRAWN', 'COMPLETED'], default: 'NOT_STARTED', index: true },
  status: { type: String, enum: ['PENDING_REVIEW', 'ACTIVE', 'INACTIVE', 'SUSPENDED', 'ARCHIVED'], default: 'PENDING_REVIEW', index: true },
  createdBy: { type: String, trim: true, maxlength: 128, default: null, immutable: true },
  submittedBy: { type: String, trim: true, maxlength: 128, default: null },
  submittedAt: { type: Date, default: null },
  reviewedBy: { type: String, trim: true, maxlength: 128, default: null },
  reviewedAt: { type: Date, default: null },
  reviewReason: { type: String, trim: true, maxlength: 1000, default: null },
  onboardingHistory: { type: [{ fromStatus: { type: String, maxlength: 32, default: null }, toStatus: { type: String, required: true, maxlength: 32 }, actorId: { type: String, required: true, maxlength: 128 }, reason: { type: String, maxlength: 1000, default: null }, at: { type: Date, default: Date.now } }], default: [] },
  schemaVersion: { type: Number, default: AGRICULTURE_SCHEMA_VERSION, immutable: true },
  deviceId: { type: String, trim: true, maxlength: 128, default: null },
  clientOperationId: { type: String, trim: true, maxlength: 255, default: null },
  payloadHash: { type: String, trim: true, maxlength: 128, default: null },
  syncStatus: { type: String, enum: OFFLINE_SYNC_STATUSES, default: 'SERVER_ACCEPTED', index: true },
  idempotencyKey: { type: String, trim: true, maxlength: 255, default: null },
  idempotencyFingerprint: { type: String, trim: true, maxlength: 128, default: null },
  metadata: { type: Schema.Types.Mixed, default: () => ({}) },
}, { timestamps: true, versionKey: 'version', optimisticConcurrency: true, collection: 'agriculture_producers', minimize: false });
producerSchema.index({ tenantId: 1, memberId: 1 }, { unique: true, name: 'uq_agri_producer_tenant_member' });
producerSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true, sparse: true, name: 'uq_agri_producer_tenant_idempotency' });
producerSchema.index({ tenantId: 1, groupId: 1, status: 1 });
export default mongoose.models.AgricultureProducer || mongoose.model('AgricultureProducer', producerSchema);
