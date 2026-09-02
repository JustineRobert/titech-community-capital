// models/EmailAudit.js
'use strict';

const mongoose = require('mongoose');

const EmailAuditSchema = new mongoose.Schema(
  {
    event: {
      type: String,
      enum: [
        'SEND_VERIFICATION_EMAIL',
        'VERIFY_EMAIL',
        'REQUEST_PASSWORD_RESET',
        'RESET_PASSWORD',
        'CHANGE_PASSWORD',
        'RESEND_VERIFICATION_EMAIL',
      ],
      required: true,
      uppercase: true,
      trim: true,
      index: true,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
      sparse: true,
    },

    email: {
      type: String,
      lowercase: true,
      trim: true,
      index: true,
      sparse: true,
    },

    ipAddress: {
      type: String,
      trim: true,
      maxlength: 64,
      index: true,
      sparse: true,
    },

    userAgent: {
      type: String,
      trim: true,
      maxlength: 512,
      sparse: true,
    },

    status: {
      type: String,
      enum: ['SUCCESS', 'FAILED'],
      default: 'SUCCESS',
      uppercase: true,
      trim: true,
      index: true,
    },

    reason: {
      type: String,
      trim: true,
      maxlength: 500,
      sparse: true,
    },

    metadata: {
      providerResponse: { type: mongoose.Schema.Types.Mixed },
      requestId: { type: String, trim: true },
    },

    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
      expires: 60 * 60 * 24 * 90, // 90 days
    },

    isArchived: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    collection: 'email_audits',
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for common queries
EmailAuditSchema.index({ userId: 1, event: 1, timestamp: -1 });
EmailAuditSchema.index({ email: 1, event: 1, timestamp: -1 });
EmailAuditSchema.index({ status: 1, timestamp: -1 });

// Static helper to record an audit entry
EmailAuditSchema.statics.record = async function (entry = {}) {
  const payload = {
    event: entry.event,
    userId: entry.userId || null,
    email: entry.email || null,
    ipAddress: entry.ipAddress || null,
    userAgent: entry.userAgent || null,
    status: entry.status || 'SUCCESS',
    reason: entry.reason || null,
    metadata: entry.metadata || {},
    timestamp: new Date(),
  };
  return this.create(payload);
};

// Instance method to summarize
EmailAuditSchema.methods.summary = function () {
  return {
    id: this._id.toString(),
    event: this.event,
    email: this.email,
    status: this.status,
    timestamp: this.timestamp,
  };
};

module.exports = mongoose.model('EmailAudit', EmailAuditSchema);
