/**
 * ============================================================================
 * TITech Community Capital — Support / Incident Case
 * ============================================================================
 * Role: tenant-scoped operational case linking customer support to financial and
 * provider evidence without permitting support agents to mutate financial truth.
 * ============================================================================
 */
import mongoose from 'mongoose';
const { Schema } = mongoose;

export const CASE_STATUS = Object.freeze({ OPEN: 'OPEN', IN_PROGRESS: 'IN_PROGRESS', PENDING_EXTERNAL: 'PENDING_EXTERNAL', RESOLVED: 'RESOLVED', CLOSED: 'CLOSED' });
export const CASE_PRIORITY = Object.freeze({ LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', CRITICAL: 'CRITICAL' });

const CaseEventSchema = new Schema({
  type: { type: String, required: true },
  actorId: { type: String, required: true },
  occurredAt: { type: Date, default: Date.now },
  note: { type: String, maxlength: 2000 },
  evidenceRefs: { type: [String], default: [] },
}, { _id: false, strict: 'throw' });

const SupportCaseSchema = new Schema({
  tenantId: { type: String, required: true, index: true, immutable: true },
  type: { type: String, required: true, trim: true },
  priority: { type: String, enum: Object.values(CASE_PRIORITY), default: CASE_PRIORITY.MEDIUM, index: true },
  status: { type: String, enum: Object.values(CASE_STATUS), default: CASE_STATUS.OPEN, index: true },
  subject: { type: String, required: true, maxlength: 300 },
  description: { type: String, required: true, maxlength: 10000 },
  assignedTo: { type: String, default: null },
  createdBy: { type: String, required: true, immutable: true },
  requestId: { type: String, default: null },
  correlationId: { type: String, default: null },
  linked: {
    memberId: String,
    groupId: String,
    paymentId: String,
    ledgerTransactionId: String,
    providerTransactionId: String,
    reconciliationExceptionId: String,
  },
  sla: {
    policy: { type: String, default: null },
    dueAt: { type: Date, default: null },
    breachedAt: { type: Date, default: null },
  },
  events: { type: [CaseEventSchema], default: [] },
  resolution: { type: String, default: null, maxlength: 5000 },
  resolutionEvidenceRefs: { type: [String], default: [] },
}, { timestamps: true, strict: 'throw' });

SupportCaseSchema.index({ tenantId: 1, status: 1, priority: 1, createdAt: -1 });
SupportCaseSchema.index({ tenantId: 1, 'linked.paymentId': 1 });
SupportCaseSchema.index({ tenantId: 1, 'linked.ledgerTransactionId': 1 });

export default mongoose.models.SupportCase || mongoose.model('SupportCase', SupportCaseSchema);
