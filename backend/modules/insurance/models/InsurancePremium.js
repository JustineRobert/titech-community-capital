import mongoose from 'mongoose';
const { Schema } = mongoose;
const schema = new Schema({
  tenantId: { type: String, required: true, trim: true, immutable: true, maxlength: 100 },
  insurerProfileId: { type: Schema.Types.ObjectId, ref: 'InsuranceInstitutionProfile', required: true, immutable: true },
  enrolmentId: { type: Schema.Types.ObjectId, ref: 'InsuranceEnrolment', required: true, immutable: true },
  premiumReference: { type: String, required: true, trim: true, maxlength: 128 },
  idempotencyKey: { type: String, required: true, trim: true, maxlength: 160, immutable: true },
  expectedAmountMinor: { type: Number, required: true, min: 1, validate: { validator: Number.isSafeInteger, message: 'Amount must be a safe integer in minor units.' } },
  currency: { type: String, required: true, trim: true, uppercase: true, match: /^[A-Z]{3}$/ },
  dueAt: { type: Date, default: null },
  status: { type: String, enum: ['DUE', 'PAYMENT_INITIATED', 'PENDING_PROVIDER', 'SETTLEMENT_PENDING_RECONCILIATION', 'SETTLED', 'FAILED', 'REVERSED', 'REFUNDED', 'RECONCILIATION_EXCEPTION'], default: 'DUE', required: true, index: true },
  providerName: { type: String, trim: true, maxlength: 100, default: null },
  providerTransactionReference: { type: String, trim: true, maxlength: 200, default: null },
  financialTransactionReference: { type: String, trim: true, maxlength: 200, default: null },
  ledgerPostingReference: { type: String, trim: true, maxlength: 200, default: null },
  settlementEvidenceReference: { type: String, trim: true, maxlength: 200, default: null },
  reconciliationReference: { type: String, trim: true, maxlength: 200, default: null },
  reconciledAt: { type: Date, default: null },
  exceptionReason: { type: String, trim: true, maxlength: 1000, default: null },
  createdBy: { type: String, required: true, trim: true, immutable: true, maxlength: 128 },
}, { timestamps: true, versionKey: '__v', strict: 'throw', minimize: true });
schema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true, name: 'uniq_insurance_premium_idempotency' });
schema.index({ tenantId: 1, premiumReference: 1 }, { unique: true, name: 'uniq_insurance_premium_reference' });
schema.index({ tenantId: 1, status: 1, dueAt: 1 }, { name: 'idx_insurance_premium_exceptions' });
schema.pre('validate', function protectSettlementClaims(next) {
  if (this.status === 'SETTLED' && (!this.providerTransactionReference || !this.financialTransactionReference || !this.ledgerPostingReference || !this.settlementEvidenceReference || !this.reconciliationReference || !this.reconciledAt)) return next(new Error('A settled premium requires provider, financial transaction, ledger, settlement and reconciliation evidence.'));
  if (['REVERSED', 'REFUNDED'].includes(this.status) && !this.exceptionReason) return next(new Error('A reversed or refunded premium requires an auditable reason.'));
  if (this.status === 'RECONCILIATION_EXCEPTION' && !this.exceptionReason) return next(new Error('A reconciliation exception requires a reason.'));
  next();
});
export default mongoose.models.InsurancePremium || mongoose.model('InsurancePremium', schema);
