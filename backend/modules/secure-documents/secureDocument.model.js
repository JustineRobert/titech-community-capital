import mongoose from 'mongoose';

const { Schema } = mongoose;

export const SECURE_DOCUMENT_PURPOSES = Object.freeze([
  'IDENTITY_CREDENTIAL',
  'INSURANCE_LICENCE',
  'INSURANCE_CLAIM',
  'CONSENT_EVIDENCE',
  'OTHER_COMPLIANCE_EVIDENCE',
  'RETIREMENT_SUPPORT_EVIDENCE',
]);

const secureDocumentSchema = new Schema({
  tenantId: { type: String, required: true, trim: true, immutable: true, maxlength: 100 },
  documentReference: { type: String, required: true, trim: true, immutable: true, match: /^doc_[0-9a-f-]{36}$/i, maxlength: 40 },
  subjectId: { type: String, required: true, trim: true, immutable: true, maxlength: 128 },
  createdBy: { type: String, required: true, trim: true, immutable: true, maxlength: 128 },
  purpose: { type: String, required: true, enum: SECURE_DOCUMENT_PURPOSES, immutable: true },
  mimeType: { type: String, required: true, enum: ['application/pdf', 'image/jpeg', 'image/png'], immutable: true },
  sizeBytes: { type: Number, required: true, min: 1, max: 10 * 1024 * 1024, immutable: true },
  sha256: { type: String, required: true, match: /^[a-f0-9]{64}$/i, select: false, immutable: true },
  storageKey: { type: String, required: true, select: false, immutable: true, maxlength: 100 },
  encryptionVersion: { type: String, required: true, enum: ['AES-256-GCM-v1'], immutable: true },
  uploadedAt: { type: Date, required: true, default: Date.now, immutable: true },
  retentionUntil: { type: Date, default: null },
  deletedAt: { type: Date, default: null },
}, {
  timestamps: true,
  versionKey: '__v',
  strict: 'throw',
  minimize: true,
});

secureDocumentSchema.index({ tenantId: 1, documentReference: 1 }, { unique: true, name: 'uniq_secure_document_tenant_reference' });
secureDocumentSchema.index({ tenantId: 1, subjectId: 1, purpose: 1, uploadedAt: -1 }, { name: 'idx_secure_document_subject_purpose' });

export default mongoose.models.SecureDocument || mongoose.model('SecureDocument', secureDocumentSchema);
