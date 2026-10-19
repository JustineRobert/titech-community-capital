import mongoose from 'mongoose';
const { Schema } = mongoose;
const schema = new Schema({
  tenantId: { type: String, required: true, trim: true, lowercase: true, immutable: true, maxlength: 100 },
  legalName: { type: String, required: true, trim: true, minlength: 2, maxlength: 200 },
  organisationType: { type: String, required: true, enum: ['REFUGEE_SERVING_ORGANISATION', 'COMMUNITY_SUPPORT_ORGANISATION', 'HUMANITARIAN_PARTNER', 'OTHER_APPROVED_PARTNER'] },
  registrationReference: { type: String, required: true, trim: true, maxlength: 128 },
  jurisdiction: { type: String, required: true, trim: true, uppercase: true, maxlength: 80 },
  competentAuthority: { type: String, required: true, trim: true, maxlength: 200 },
  programmeScopes: { type: [{ type: String, trim: true, maxlength: 120 }], default: [] },
  evidenceReference: { type: String, required: true, trim: true, maxlength: 80, select: false },
  verificationStatus: { type: String, enum: ['PENDING_SUBMISSION', 'SUBMITTED', 'PENDING_REVIEW', 'NEEDS_MORE_INFORMATION', 'VERIFIED', 'SUSPENDED', 'REJECTED'], default: 'SUBMITTED', required: true, index: true },
  dataSharingAgreementReference: { type: String, trim: true, maxlength: 128, default: null },
  verifiedBy: { type: String, trim: true, maxlength: 128, default: null },
  verifiedAt: { type: Date, default: null },
  verificationSource: { type: String, trim: true, maxlength: 500, default: null },
  reviewReason: { type: String, trim: true, maxlength: 1000, default: null },
  createdBy: { type: String, required: true, trim: true, immutable: true, maxlength: 128 },
  updatedBy: { type: String, required: true, trim: true, maxlength: 128 },
  history: { type: [{ fromStatus: String, toStatus: String, actorId: String, reason: String, sourceReference: String, at: { type: Date, default: Date.now } }], default: [] },
}, {
  timestamps: true,
  versionKey: '__v',
  strict: 'throw',
  minimize: true,
  toJSON: {
    transform(_doc, ret) {
      delete ret._id;
      delete ret.__v;
      delete ret.evidenceReference;
      ret.id = String(_doc._id);
      return ret;
    },
  },
});
schema.index({ tenantId: 1 }, { unique: true, name: 'uniq_refugee_partner_tenant' });
schema.pre('validate', function validateVerifiedPartner(next) {
  if (this.verificationStatus === 'VERIFIED' && (!this.verifiedBy || !this.verifiedAt || !this.verificationSource)) return next(new Error('Verified refugee-serving organisation requires reviewer, timestamp and evidence source.'));
  if (this.verificationStatus === 'SUSPENDED' && !this.reviewReason) return next(new Error('Suspended organisation requires a reason.'));
  next();
});
export default mongoose.models.RefugeeServingOrganisationProfile || mongoose.model('RefugeeServingOrganisationProfile', schema);
