/** Approved, versioned commercial pricing rule. */
import mongoose from 'mongoose';

const { Schema } = mongoose;
const MINOR_PATTERN = /^(0|[1-9]\d{0,29})$/;

const tierSchema = new Schema({
  upToMinor: { type: String, default: null, validate: { validator: (value) => value == null || MINOR_PATTERN.test(value), message: 'upToMinor must be integer minor units.' } },
  rateBps: { type: Number, required: true, min: 0, max: 1_000_000, validate: Number.isSafeInteger },
  fixedMinor: { type: String, default: '0', match: MINOR_PATTERN },
}, { _id: false, strict: 'throw' });

const feeRuleSchema = new Schema({
  tenantId: { type: String, required: true, immutable: true, trim: true, index: true },
  institutionId: { type: String, default: null, immutable: true, trim: true },
  contractId: { type: String, default: null, immutable: true, trim: true },
  ruleCode: { type: String, required: true, trim: true, immutable: true, maxlength: 128 },
  version: { type: Number, required: true, min: 1, validate: Number.isSafeInteger, immutable: true },
  serviceId: { type: String, required: true, trim: true, immutable: true, maxlength: 128 },
  eventType: { type: String, default: null, trim: true, immutable: true, maxlength: 128 },
  payerType: { type: String, default: null, trim: true, immutable: true, maxlength: 64 },
  currency: { type: String, required: true, uppercase: true, trim: true, immutable: true, match: /^[A-Z]{3}$/ },
  type: { type: String, required: true, enum: ['FIXED', 'PERCENTAGE', 'FIXED_PLUS_PERCENTAGE', 'TIERED'], immutable: true },
  calculation: {
    fixedMinor: { type: String, default: undefined, match: MINOR_PATTERN },
    amountMinor: { type: String, default: undefined, match: MINOR_PATTERN },
    rateBps: { type: Number, default: undefined, min: 0, max: 1_000_000, validate: { validator: (value) => value == null || Number.isSafeInteger(value) } },
    minimumFeeMinor: { type: String, default: undefined, match: MINOR_PATTERN },
    maximumFeeMinor: { type: String, default: undefined, match: MINOR_PATTERN },
    rounding: { type: String, enum: ['HALF_UP', 'DOWN'], default: 'HALF_UP' },
    tierMode: { type: String, enum: ['WHOLE_VOLUME', 'PROGRESSIVE'] },
    tiers: { type: [tierSchema], default: undefined },
  },
  priority: { type: Number, default: 0, min: -10_000, max: 10_000, validate: Number.isSafeInteger },
  status: { type: String, enum: ['DRAFT', 'ACTIVE', 'SUSPENDED', 'EXPIRED'], default: 'DRAFT', index: true },
  approvalStatus: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING', index: true },
  effectiveFrom: { type: Date, required: true, immutable: true },
  effectiveTo: { type: Date, default: null, immutable: true },
  createdBy: { type: String, required: true, immutable: true },
  approvedBy: { type: String, default: null },
  approvedAt: { type: Date, default: null },
  approvalReason: { type: String, default: null, maxlength: 1000 },
  changeReason: { type: String, required: true, maxlength: 1000, immutable: true },
}, {
  collection: 'commercial_fee_rules',
  timestamps: true,
  strict: 'throw',
  versionKey: 'versionKey',
  optimisticConcurrency: true,
});

feeRuleSchema.pre('validate', function validateCommercialFeeRule() {
  if (this.effectiveTo && this.effectiveFrom && this.effectiveTo <= this.effectiveFrom) {
    this.invalidate('effectiveTo', 'effectiveTo must be later than effectiveFrom.');
  }
  const calculation = this.calculation ?? {};
  if (this.type === 'FIXED' && calculation.fixedMinor == null && calculation.amountMinor == null) {
    this.invalidate('calculation.fixedMinor', 'A fixed fee must specify fixedMinor or amountMinor.');
  }
  if (this.type === 'PERCENTAGE' && calculation.rateBps == null) {
    this.invalidate('calculation.rateBps', 'A percentage fee must specify rateBps.');
  }
  if (this.type === 'FIXED_PLUS_PERCENTAGE' && (calculation.fixedMinor == null || calculation.rateBps == null)) {
    this.invalidate('calculation', 'A fixed-plus-percentage fee requires fixedMinor and rateBps.');
  }
  if (this.type === 'TIERED' && (!calculation.tierMode || !Array.isArray(calculation.tiers) || calculation.tiers.length === 0)) {
    this.invalidate('calculation', 'A tiered fee requires tierMode and at least one tier.');
  }
  if (this.status === 'ACTIVE' && (
    this.approvalStatus !== 'APPROVED' || !this.approvedBy || !this.approvedAt || this.approvedBy === this.createdBy
  )) {
    this.invalidate('status', 'An active fee rule requires a distinct maker and approved checker with timestamp.');
  }
});

feeRuleSchema.index({ tenantId: 1, serviceId: 1, currency: 1, status: 1, approvalStatus: 1, effectiveFrom: -1 });
feeRuleSchema.index({ tenantId: 1, ruleCode: 1, version: 1 }, { unique: true, name: 'uniq_tenant_fee_rule_version' });
feeRuleSchema.index({ tenantId: 1, institutionId: 1, contractId: 1, serviceId: 1, currency: 1, priority: -1 });

const FeeRule = mongoose.models.FeeRule || mongoose.model('FeeRule', feeRuleSchema);
export { feeRuleSchema, FeeRule };
export default FeeRule;
