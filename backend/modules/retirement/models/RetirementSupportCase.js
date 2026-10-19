import mongoose from 'mongoose';
import { RETIREMENT_CASE_STATES, RETIREMENT_CASE_TYPES, RETIREMENT_SCHEME_TYPES } from '../retirement.policy.js';

const { Schema } = mongoose;
const historySchema = new Schema({
  fromStatus: { type: String, maxlength: 40, default: null },
  toStatus: { type: String, required: true, enum: RETIREMENT_CASE_STATES },
  actorId: { type: String, required: true, maxlength: 128 },
  reasonCode: { type: String, required: true, maxlength: 100 },
  note: { type: String, trim: true, maxlength: 1000, default: null },
  sourceReference: { type: String, maxlength: 200, default: null },
  at: { type: Date, default: Date.now, required: true },
}, { _id: false, strict: 'throw' });

const schema = new Schema({
  tenantId: { type: String, required: true, trim: true, immutable: true, maxlength: 100, index: true },
  caseReference: { type: String, required: true, unique: true, immutable: true, maxlength: 50 },
  subjectUserId: { type: String, required: true, immutable: true, maxlength: 128, index: true },
  schemeType: { type: String, required: true, enum: RETIREMENT_SCHEME_TYPES, index: true },
  caseType: { type: String, required: true, enum: RETIREMENT_CASE_TYPES, index: true },
  jurisdiction: { type: String, required: true, trim: true, uppercase: true, maxlength: 80, default: 'UG' },
  employerReference: { type: String, trim: true, maxlength: 128, default: null },
  schemeReferenceFingerprint: { type: String, trim: true, maxlength: 64, select: false, default: null },
  activeDuplicateKey: { type: String, trim: true, maxlength: 64, select: false, default: null },
  evidenceReferences: { type: [{ type: String, trim: true, maxlength: 40 }], default: [], validate: [(value) => value.length <= 20, 'A maximum of 20 evidence references is allowed.'] },
  privacyNoticeVersion: { type: String, trim: true, maxlength: 100, default: null },
  processingBasis: { type: String, enum: ['CONSENT', 'CONTRACT', 'LEGAL_OBLIGATION', 'LEGITIMATE_INTEREST', 'PUBLIC_TASK', 'VITAL_INTEREST'], default: null },
  noticeLanguage: { type: String, lowercase: true, enum: ['en', 'sw', 'fr', 'ar'], default: null },
  noticeAcknowledgedAt: { type: Date, default: null },
  status: { type: String, required: true, enum: RETIREMENT_CASE_STATES, default: 'DRAFT', index: true },
  schemeVerificationStatus: { type: String, required: true, enum: ['NOT_REQUESTED', 'PENDING', 'CONFIRMED', 'INCONCLUSIVE', 'NOT_FOUND'], default: 'NOT_REQUESTED' },
  verificationSourceType: { type: String, enum: ['AUTHORIZED_PROVIDER', 'AUTHORIZED_INSTITUTION_REVIEW'], default: null },
  verificationSourceName: { type: String, trim: true, maxlength: 200, default: null },
  verificationSourceReference: { type: String, trim: true, maxlength: 200, default: null },
  schemeVerifiedAt: { type: Date, default: null },
  schemeVerifiedBy: { type: String, maxlength: 128, default: null },
  schemeValidUntil: { type: Date, default: null },
  assignedOfficerId: { type: String, trim: true, maxlength: 128, default: null },
  dueAt: { type: Date, default: null },
  createdBy: { type: String, required: true, immutable: true, maxlength: 128 },
  updatedBy: { type: String, required: true, maxlength: 128 },
  history: { type: [historySchema], default: [], validate: [(value) => value.length <= 100, 'Case history is limited to 100 entries.'] },
}, {
  timestamps: true,
  versionKey: '__v',
  strict: 'throw',
  minimize: true,
  toJSON: { transform(_doc, ret) { delete ret.__v; delete ret.schemeReferenceFingerprint; delete ret.activeDuplicateKey; ret.id = String(_doc._id); delete ret._id; return ret; } },
});

schema.index({ tenantId: 1, subjectUserId: 1, updatedAt: -1 }, { name: 'idx_retirement_case_subject' });
schema.index({ tenantId: 1, schemeType: 1, schemeReferenceFingerprint: 1 }, { partialFilterExpression: { schemeReferenceFingerprint: { $type: 'string' } }, name: 'idx_retirement_case_scheme_fingerprint' });
schema.index({ tenantId: 1, subjectUserId: 1, schemeType: 1, activeDuplicateKey: 1 }, { unique: true, partialFilterExpression: { activeDuplicateKey: { $type: 'string' } }, name: 'uniq_retirement_active_scheme_reference' });
schema.index({ tenantId: 1, status: 1, updatedAt: -1 }, { name: 'idx_retirement_case_queue' });
schema.pre('validate', function validateAuthorityOutcome(next) {
  if (!['DRAFT', 'WITHDRAWN'].includes(this.status) && (!this.privacyNoticeVersion || !this.processingBasis || !this.noticeLanguage || !this.noticeAcknowledgedAt)) {
    return next(new Error('Submitted retirement cases require a versioned privacy notice acknowledgement and a server-configured processing basis.'));
  }
  if (this.status === 'SCHEME_VERIFIED') {
    if (this.schemeVerificationStatus !== 'CONFIRMED' || !this.verificationSourceType || !this.verificationSourceName || !this.verificationSourceReference || !this.schemeVerifiedAt || !this.schemeVerifiedBy) {
      return next(new Error('Scheme verification can only be confirmed with an attributable authorized-source result.'));
    }
  }
  next();
});

export default mongoose.models.RetirementSupportCase || mongoose.model('RetirementSupportCase', schema);
