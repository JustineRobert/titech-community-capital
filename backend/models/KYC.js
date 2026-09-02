const mongoose = require('mongoose');

const KYCSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  fullName: { type: String },
  nationalId: { type: String },
  phoneVerified: { type: Boolean, default: false },
  documents: [{ type: String }],
  status: { type: String, enum: ['PENDING','VERIFIED','REJECTED'], default: 'PENDING' },
  riskLevel: { type: String, enum: ['LOW','MEDIUM','HIGH'], default: 'LOW' },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: false },
}, { timestamps: true });

module.exports = mongoose.model('KYC', KYCSchema);
