import mongoose from 'mongoose';

const { Schema } = mongoose;

const historySchema = new Schema({
  fromStatus: { type: String, trim: true, maxlength: 40, default: null },
  toStatus: { type: String, required: true, trim: true, maxlength: 40 },
  actorId: { type: String, required: true, trim: true, maxlength: 128 },
  reasonCode: { type: String, required: true, trim: true, maxlength: 100 },
  at: { type: Date, required: true, default: Date.now },
}, { _id: false, strict: 'throw' });

const schema = new Schema({
  tenantId: { type: String, required: true, trim: true, lowercase: true, immutable: true, maxlength: 100 },
  applicantUserId: { type: String, required: true, trim: true, immutable: true, maxlength: 128 },
  schoolTenantId: { type: String, required: true, trim: true, lowercase: true, immutable: true, maxlength: 100 },
  schoolReference: { type: String, required: true, trim: true, immutable: true, maxlength: 128 },
  studentBeneficiaryReference: { type: String, required: true, trim: true, immutable: true, maxlength: 128, select: false },
  guardianRelationship: { type: String, required: true, enum: ['PARENT', 'LEGAL_GUARDIAN', 'AUTHORIZED_CAREGIVER'], immutable: true },
  guardianAuthorityReference: { type: String, required: true, trim: true, maxlength: 128, select: false },
  guardianConsentReference: { type: String, required: true, trim: true, maxlength: 128, select: false },
  applicationType: { type: String, required: true, enum: ['TUITION_FEES', 'EXAMINATION_FEES', 'BOARDING_FEES', 'VOCATIONAL_TUITION'], immutable: true },
  academicYearReference: { type: String, required: true, trim: true, maxlength: 80, immutable: true },
  academicTermReference: { type: String, required: true, trim: true, maxlength: 80, immutable: true },
  invoiceReference: { type: String, required: true, trim: true, maxlength: 128, immutable: true },
  invoiceVersion: { type: Number, required: true, min: 1, immutable: true },
  currency: { type: String, required: true, enum: ['UGX'], immutable: true },
  invoiceAmountMinor: { type: Number, required: true, min: 1, immutable: true },
  alreadyPaidAmountMinor: { type: Number, required: true, min: 0, immutable: true },
  declaredOutstandingAmountMinor: { type: Number, required: true, min: 1, immutable: true },
  requestedAmountMinor: { type: Number, required: true, min: 1, immutable: true },
  idempotencyKey: { type: String, required: true, trim: true, maxlength: 160, select: false },
  requestFingerprint: { type: String, required: true, trim: true, minlength: 64, maxlength: 64, select: false },
  duplicateFingerprint: { type: String, required: true, trim: true, minlength: 64, maxlength: 64, select: false },
  status: { type: String, required: true, enum: ['SUBMITTED', 'NEEDS_MORE_INFORMATION', 'WITHDRAWN', 'CANCELLED', 'EXPIRED'], default: 'SUBMITTED', index: true },
  schoolVerificationStatus: { type: String, required: true, enum: ['PENDING_PARTNER_VERIFICATION', 'NEEDS_MORE_INFORMATION'], default: 'PENDING_PARTNER_VERIFICATION' },
  invoiceVerificationStatus: { type: String, required: true, enum: ['PENDING_PARTNER_VERIFICATION', 'NEEDS_MORE_INFORMATION'], default: 'PENDING_PARTNER_VERIFICATION' },
  guardianAuthorityVerificationStatus: { type: String, required: true, enum: ['PENDING_REVIEW', 'VERIFIED', 'NEEDS_MORE_INFORMATION'], default: 'PENDING_REVIEW' },
  lenderDecisionStatus: { type: String, required: true, enum: ['NOT_REQUESTED'], default: 'NOT_REQUESTED' },
  loanAccountStatus: { type: String, required: true, enum: ['NOT_CREATED'], default: 'NOT_CREATED' },
  disbursementStatus: { type: String, required: true, enum: ['NOT_STARTED'], default: 'NOT_STARTED' },
  repaymentStatus: { type: String, required: true, enum: ['NOT_STARTED'], default: 'NOT_STARTED' },
  submittedAt: { type: Date, required: true, default: Date.now, immutable: true },
  history: { type: [historySchema], default: [] },
}, {
  timestamps: true,
  versionKey: '__v',
  strict: 'throw',
  minimize: true,
  toJSON: {
    transform(_doc, ret) {
      delete ret._id;
      delete ret.__v;
      delete ret.tenantId;
      delete ret.applicantUserId;
      delete ret.studentBeneficiaryReference;
      delete ret.guardianAuthorityReference;
      delete ret.guardianConsentReference;
      delete ret.idempotencyKey;
      delete ret.requestFingerprint;
      delete ret.duplicateFingerprint;
      ret.id = String(_doc._id);
      return ret;
    },
  },
});

schema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true, name: 'uniq_edufinance_tenant_idempotency' });
schema.index({ duplicateFingerprint: 1 }, { unique: true, name: 'uniq_edufinance_duplicate_invoice_beneficiary' });
schema.index({ tenantId: 1, applicantUserId: 1, createdAt: -1 }, { name: 'idx_edufinance_applicant_history' });
schema.index({ tenantId: 1, status: 1, createdAt: -1 }, { name: 'idx_edufinance_tenant_queue' });

schema.pre('validate', function validateDeclaredAmounts(next) {
  if (this.alreadyPaidAmountMinor > this.invoiceAmountMinor) return next(new Error('Declared school payments cannot exceed the invoice amount.'));
  if (this.declaredOutstandingAmountMinor !== this.invoiceAmountMinor - this.alreadyPaidAmountMinor) return next(new Error('Declared outstanding amount does not reconcile to the declared invoice and payment amounts.'));
  if (this.requestedAmountMinor > this.declaredOutstandingAmountMinor) return next(new Error('Requested financing cannot exceed declared outstanding fees.'));
  next();
});

export default mongoose.models.EduFinanceApplication || mongoose.model('EduFinanceApplication', schema);
