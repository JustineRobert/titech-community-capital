/**
 * ============================================================================
 * TITech Community Capital — Permissioned Capital Data Share Request
 * ============================================================================
 * Role: controlled interface between governed community financial data and an
 * approved capital partner. It does not create a loan or transfer funds.
 * ============================================================================
 */
import mongoose from 'mongoose';
const { Schema } = mongoose;

export const CAPITAL_SHARE_STATUS = Object.freeze({
  REQUESTED: 'REQUESTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
  SHARED: 'SHARED',
});

const CapitalShareRequestSchema = new Schema({
  tenantId: { type: String, required: true, index: true, immutable: true },
  subjectType: { type: String, required: true, enum: ['MEMBER', 'GROUP', 'INSTITUTION'] },
  subjectId: { type: String, required: true, index: true },
  recipientPartnerId: { type: String, required: true, index: true },
  purpose: { type: String, required: true, trim: true },
  dataCategories: { type: [{ type: String, trim: true }], required: true },
  consentId: { type: String, required: true, index: true },
  status: { type: String, enum: Object.values(CAPITAL_SHARE_STATUS), default: CAPITAL_SHARE_STATUS.REQUESTED, index: true },
  requestedBy: { type: String, required: true, immutable: true },
  approvedBy: { type: String, default: null },
  rejectedBy: { type: String, default: null },
  decisionReason: { type: String, default: null, maxlength: 500 },
  requestedAt: { type: Date, default: Date.now },
  approvedAt: { type: Date, default: null },
  sharedAt: { type: Date, default: null },
  expiresAt: { type: Date, default: null },
  payloadHash: { type: String, default: null },
  metadata: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true, strict: 'throw' });

CapitalShareRequestSchema.index({ tenantId: 1, recipientPartnerId: 1, subjectId: 1, status: 1 });

export default mongoose.models.CapitalShareRequest || mongoose.model('CapitalShareRequest', CapitalShareRequestSchema);
