import mongoose from 'mongoose';

const { Schema } = mongoose;

const TENANT_STATUSES = Object.freeze(['ACTIVE', 'SUSPENDED', 'DISABLED', 'ARCHIVED']);
const ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,99}$/;

const tenantSchema = new Schema(
  {
    tenantId: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 100,
      match: ID_PATTERN,
      immutable: true,
      unique: true,
      index: true,
    },
    institutionId: {
      type: String,
      trim: true,
      maxlength: 128,
      index: true,
      default: null,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 200,
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 100,
      match: ID_PATTERN,
      immutable: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: TENANT_STATUSES,
      required: true,
      default: 'ACTIVE',
      index: true,
    },
    countryCode: {
      type: String,
      uppercase: true,
      trim: true,
      minlength: 2,
      maxlength: 2,
      default: 'UG',
    },
    defaultCurrency: {
      type: String,
      uppercase: true,
      trim: true,
      match: /^[A-Z]{3}$/,
      default: 'UGX',
    },
    settings: {
      type: Schema.Types.Mixed,
      default: {},
    },
    createdBy: {
      type: String,
      trim: true,
      maxlength: 128,
      default: null,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    strict: 'throw',
    minimize: true,
  },
);

tenantSchema.index({ status: 1, tenantId: 1 });
tenantSchema.index({ status: 1, institutionId: 1 });

tenantSchema.pre('save', function normalizeTenant(next) {
  this.tenantId = String(this.tenantId).trim().toLowerCase();
  this.slug = String(this.slug).trim().toLowerCase();
  if (this.institutionId) this.institutionId = String(this.institutionId).trim();
  next();
});

export { TENANT_STATUSES };
export default mongoose.models.Tenant || mongoose.model('Tenant', tenantSchema);
