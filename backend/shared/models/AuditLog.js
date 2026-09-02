// backend/shared/models/AuditLog.js
'use strict';

const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      index: true
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true
    },

    role: String,

    action: {
      type: String,
      required: true,
      index: true
    },

    method: String,
    path: String,

    ip: String,
    userAgent: String,

    query: mongoose.Schema.Types.Mixed,
    params: mongoose.Schema.Types.Mixed,
    body: mongoose.Schema.Types.Mixed,

    statusCode: Number,

    durationMs: Number,

    previousHash: {
      type: String,
      index: true
    },

    hash: {
      type: String,
      required: true,
      unique: true,
      index: true
    },

    timestamp: {
      type: Date,
      default: Date.now,
      index: true
    }
  },
  {
    timestamps: true
  }
);

AuditLogSchema.index({
  tenantId: 1,
  timestamp: -1
});

AuditLogSchema.index({
  action: 1,
  timestamp: -1
});

module.exports = mongoose.model(
  'AuditLog',
  AuditLogSchema
);