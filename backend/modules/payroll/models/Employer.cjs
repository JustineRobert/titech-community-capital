'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;

const EmployerSchema = new Schema({
  employerId: { type: String, required: true, unique: true, immutable: true, index: true },
  tenantId: { type: String, required: true, immutable: true, index: true },
  legalName: { type: String, required: true, trim: true, maxlength: 255 },
  tradingName: { type: String, trim: true, maxlength: 255, default: null },
  registrationNumber: { type: String, trim: true, maxlength: 128, default: null },
  taxIdentifier: { type: String, trim: true, maxlength: 128, default: null },
  status: { type: String, enum: ['EMPLOYER_CREATED', 'KYC_PENDING', 'KYC_VERIFIED', 'SUBSCRIPTION_PENDING', 'ACTIVE', 'SUSPENDED', 'OFFBOARDED'], default: 'EMPLOYER_CREATED', index: true },
  kycStatus: { type: String, enum: ['PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED'], default: 'PENDING' },
  complianceStatus: { type: String, enum: ['PENDING', 'CLEAR', 'REVIEW', 'BLOCKED'], default: 'PENDING' },
  riskStatus: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'REVIEW'], default: 'LOW' },
  settlementCurrency: { type: String, uppercase: true, match: /^[A-Z]{3}$/, default: 'UGX' },
  paymentRails: { type: [String], default: ['MTN_MOMO', 'AIRTEL_MONEY'] },
  createdBy: { type: String, required: true, immutable: true },
  metadata: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true, strict: 'throw' });

EmployerSchema.index({ tenantId: 1, legalName: 1 });

module.exports = mongoose.models.PayrollEmployer || mongoose.model('PayrollEmployer', EmployerSchema);
