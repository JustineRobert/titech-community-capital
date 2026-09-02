// models/Audit.js
'use strict';

const mongoose = require('mongoose');

const AuditSchema = new mongoose.Schema({
  tenantId: {
    type: String,
    required: true,
    index: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  role: {
    type: String,
    default: 'user',
  },
  action: {
    type: String,
    required: true,
    index: true,
  },
  data: {
    type: Object,
    default: {},
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true,
  },
  hash: {
    type: String,
    required: true,
    index: true,
  },
}, {
  collection: 'audits',
  strict: true,
});

// Optional: add compound index for faster queries
AuditSchema.index({ tenantId: 1, timestamp: -1 });

module.exports = mongoose.model('Audit', AuditSchema);
