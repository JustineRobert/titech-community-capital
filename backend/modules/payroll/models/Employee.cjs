'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;

const EmployeeSchema = new Schema({
  employeeId: { type: String, required: true, immutable: true, index: true },
  tenantId: { type: String, required: true, immutable: true, index: true },
  employerId: { type: String, required: true, immutable: true, index: true },
  memberId: { type: String, default: null, immutable: true, index: true },
  fullName: { type: String, required: true, trim: true, maxlength: 200 },
  phoneNumber: { type: String, required: true, trim: true, maxlength: 32 },
  paymentRail: { type: String, enum: ['MTN_MOMO', 'AIRTEL_MONEY'], default: 'MTN_MOMO' },
  currency: { type: String, uppercase: true, match: /^[A-Z]{3}$/, default: 'UGX' },
  consentStatus: { type: String, enum: ['PENDING', 'GRANTED', 'WITHDRAWN'], default: 'PENDING' },
  verificationStatus: { type: String, enum: ['PENDING', 'VERIFIED', 'REJECTED'], default: 'PENDING' },
  employmentStatus: { type: String, enum: ['ACTIVE', 'SUSPENDED', 'TERMINATED'], default: 'ACTIVE', index: true },
  effectiveFrom: { type: Date, default: null },
  effectiveTo: { type: Date, default: null },
  metadata: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true, strict: 'throw' });

EmployeeSchema.index({ tenantId: 1, employerId: 1, employeeId: 1 }, { unique: true });
EmployeeSchema.index({ tenantId: 1, employerId: 1, employmentStatus: 1 });

module.exports = mongoose.models.PayrollEmployee || mongoose.model('PayrollEmployee', EmployeeSchema);
