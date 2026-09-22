/**
 * ============================================================================
 * TITech Community Capital — Tamper-Evident Audit Model
 * ============================================================================
 * Architectural role: append-only tenant-scoped audit evidence with chained
 * SHA-256 hashes for tamper detection.
 * Non-responsibilities: authorization, financial posting, reconciliation or
 * workflow execution.
 * Security principles: no secrets, no destructive updates, deterministic hash
 * input, tenant scoping and verification support.
 * ============================================================================
 */

import crypto from 'node:crypto';
import mongoose from 'mongoose';

const { Schema } = mongoose;

const AuditSchema = new Schema({
  tenantId: { type: String, required: true, index: true, immutable: true },
  action: { type: String, required: true, trim: true, immutable: true },
  data: { type: Schema.Types.Mixed, required: true, immutable: true },
  previousHash: { type: String, required: true, immutable: true },
  hash: { type: String, required: true, unique: true, immutable: true },
  actorId: { type: String, default: null, immutable: true },
  requestId: { type: String, default: null, immutable: true },
  correlationId: { type: String, default: null, immutable: true },
}, { timestamps: true, versionKey: '__v', strict: 'throw' });

AuditSchema.index({ tenantId: 1, createdAt: 1 });

AuditSchema.pre('save', function protectIntegrity(next) {
  if (!this.isNew) return next(new Error('Audit records are append-only and cannot be updated.'));
  next();
});

AuditSchema.statics.computeHash = function computeHash(previousHash, action, data) {
  return crypto.createHash('sha256').update(`${previousHash}${JSON.stringify(data)}${action}`).digest('hex');
};

AuditSchema.statics.verifyChain = async function verifyChain(tenantId) {
  if (!tenantId) throw new Error('TenantId is required for audit verification.');
  const logs = await this.find({ tenantId: String(tenantId) }).sort({ createdAt: 1, _id: 1 }).lean();
  let previousHash = 'GENESIS';
  const errors = [];
  for (const log of logs) {
    const recomputedHash = this.computeHash(previousHash, log.action, log.data);
    if (log.previousHash !== previousHash) errors.push({ id: log._id, issue: 'Previous hash mismatch', expected: previousHash, found: log.previousHash });
    if (log.hash !== recomputedHash) errors.push({ id: log._id, issue: 'Hash mismatch', expected: recomputedHash, found: log.hash });
    previousHash = log.hash;
  }
  return { valid: errors.length === 0, errors, count: logs.length };
};

export default mongoose.models.PlatformAudit || mongoose.model('PlatformAudit', AuditSchema);
