/**
 * ============================================================================
 * TITech Community Capital — Consent Record
 * ============================================================================
 * Architectural role: durable, tenant-scoped evidence for permissioned use of
 * community financial data.
 * Responsibilities: consent scope, purpose, recipient, lifecycle and evidence.
 * Non-responsibilities: identity verification, risk scoring, data extraction or
 * financial ledger mutation.
 * Security principles: deny-by-default, purpose limitation, expiry, withdrawal,
 * provenance and immutable history through versioned records.
 * ============================================================================
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

export const CONSENT_STATUS = Object.freeze({
  GRANTED: 'GRANTED',
  DENIED: 'DENIED',
  WITHDRAWN: 'WITHDRAWN',
  EXPIRED: 'EXPIRED',
});

const ConsentRecordSchema = new Schema(
  {
    tenantId: { type: String, required: true, index: true, immutable: true },
    subjectType: { type: String, required: true, enum: ['MEMBER', 'GROUP', 'INSTITUTION'] },
    subjectId: { type: String, required: true, index: true, immutable: true },
    dataCategories: {
      type: [{ type: String, trim: true }],
      required: true,
      validate: {
        validator: (values) => Array.isArray(values) && values.length > 0 && new Set(values).size === values.length,
        message: 'At least one unique data category is required.',
      },
    },
    purpose: { type: String, required: true, trim: true, maxlength: 300 },
    recipient: { type: String, required: true, trim: true, maxlength: 200 },
    legalBasis: { type: String, required: true, trim: true, maxlength: 120 },
    sourceChannel: { type: String, required: true, trim: true, maxlength: 80 },
    evidenceRef: { type: String, required: true, trim: true, maxlength: 300 },
    startsAt: { type: Date, required: true },
    expiresAt: { type: Date, default: null },
    status: { type: String, required: true, enum: Object.values(CONSENT_STATUS), default: CONSENT_STATUS.GRANTED, index: true },
    grantedAt: { type: Date, default: null },
    withdrawnAt: { type: Date, default: null },
    withdrawnBy: { type: String, default: null },
    version: { type: Number, required: true, min: 1, default: 1 },
    metadata: { type: Schema.Types.Mixed, default: {} },
    createdBy: { type: String, required: true, immutable: true },
    updatedBy: { type: String, required: true },
  },
  {
    timestamps: true,
    versionKey: '__v',
    strict: 'throw',
  },
);

ConsentRecordSchema.index({ tenantId: 1, subjectId: 1, status: 1, expiresAt: 1 });
ConsentRecordSchema.index({ tenantId: 1, recipient: 1, purpose: 1, subjectId: 1 });

ConsentRecordSchema.pre('validate', function validateDates(next) {
  if (this.expiresAt && this.expiresAt <= this.startsAt) {
    return next(new Error('Consent expiry must be later than start time.'));
  }
  if (this.status === CONSENT_STATUS.GRANTED && !this.grantedAt) {
    this.grantedAt = this.startsAt;
  }
  next();
});

export default mongoose.models.ConsentRecord || mongoose.model('ConsentRecord', ConsentRecordSchema);
