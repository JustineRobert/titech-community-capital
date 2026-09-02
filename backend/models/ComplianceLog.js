// models/ComplianceLog.js
const mongoose = require('mongoose');

const ComplianceLogSchema = new mongoose.Schema({
  tenantId: {
    type: String,
    required: true,
    trim: true
  },

  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  activity: {
    type: String,
    required: true,
    trim: true
  },

  flagged: {
    type: Boolean,
    required: true,
    default: false
  },

  reportId: {
    type: String,
    required: true,
    trim: true
  },

  reason: {
    type: String,
    trim: true,
    default: null
  },

  details: {
    type: Object,
    default: {}
  },

  fraudLogId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FraudLog',
    default: null,
    index: true // keep if you frequently query by fraudLogId alone
  },

  reporter: {
    type: String,
    trim: true,
    default: 'system'
  },

  resolved: {
    type: Boolean,
    default: false,
    index: true // keep if you query unresolved/resolved frequently
  },

  resolvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },

  resolvedAt: {
    type: Date,
    default: null
  },

  externalReportRef: {
    type: String,
    default: null,
    index: true // keep if you query by externalReportRef
  },

  archived: {
    type: Boolean,
    default: false,
    index: true // keep if you query archived state frequently
  }
}, {
  timestamps: true,
  versionKey: 'version'
});

// Compound indexes (canonical definitions)
ComplianceLogSchema.index({ tenantId: 1, userId: 1, activity: 1, createdAt: -1 }, { background: true });
ComplianceLogSchema.index({ tenantId: 1, reportId: 1 }, { unique: true, background: true });
ComplianceLogSchema.index({ tenantId: 1, flagged: 1, createdAt: -1 }, { background: true });

module.exports = mongoose.model('ComplianceLog', ComplianceLogSchema);
