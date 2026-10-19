import mongoose from 'mongoose';
const { Schema } = mongoose;
const coverageSchema = new Schema({
  coverageReference: { type: String, required: true, trim: true, maxlength: 128 },
  coverageName: { type: String, required: true, trim: true, maxlength: 200 },
  termsVersion: { type: String, required: true, trim: true, maxlength: 80 },
  sourceSystemReference: { type: String, required: true, trim: true, maxlength: 200 },
}, { _id: false, strict: 'throw' });
const schema = new Schema({
  tenantId: { type: String, required: true, trim: true, immutable: true, maxlength: 100 },
  insurerProfileId: { type: Schema.Types.ObjectId, ref: 'InsuranceInstitutionProfile', required: true, immutable: true },
  productReference: { type: String, required: true, trim: true, maxlength: 128 },
  productName: { type: String, required: true, trim: true, maxlength: 200 },
  productVersion: { type: String, required: true, trim: true, maxlength: 80 },
  currency: { type: String, required: true, trim: true, uppercase: true, match: /^[A-Z]{3}$/ },
  productStatus: { type: String, enum: ['DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'ARCHIVED'], default: 'DRAFT', required: true, index: true },
  coverageReferences: { type: [coverageSchema], default: [] },
  sourceSystemReference: { type: String, required: true, trim: true, maxlength: 200 },
  termsAndConditionsVersion: { type: String, required: true, trim: true, maxlength: 80 },
  eligibilityRuleReference: { type: String, trim: true, maxlength: 200, default: null },
  submittedBy: { type: String, required: true, trim: true, maxlength: 128, immutable: true },
  activatedBy: { type: String, trim: true, maxlength: 128, default: null },
  activatedAt: { type: Date, default: null },
  activationEvidenceReference: { type: String, trim: true, maxlength: 200, default: null, select: false },
}, {
  timestamps: true,
  versionKey: '__v',
  strict: 'throw',
  minimize: true,
  toJSON: {
    transform(_doc, ret) {
      delete ret._id;
      delete ret.__v;
      delete ret.activationEvidenceReference;
      ret.id = String(_doc._id);
      return ret;
    },
  },
});
schema.index({ tenantId: 1, productReference: 1, productVersion: 1 }, { unique: true, name: 'uniq_insurance_product_version' });
schema.index({ tenantId: 1, productStatus: 1, productReference: 1 }, { name: 'idx_insurance_product_status' });
schema.pre('validate', function validateActiveProduct(next) {
  if (this.productStatus === 'ACTIVE' && (!this.activatedBy || !this.activatedAt || !this.activationEvidenceReference)) return next(new Error('Active insurance product requires an authorised activation evidence reference.'));
  next();
});
export default mongoose.models.InsuranceProduct || mongoose.model('InsuranceProduct', schema);
