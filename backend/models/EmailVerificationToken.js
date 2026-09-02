// models/EmailVerificationToken.js
'use strict';

const mongoose = require('mongoose');

const EmailVerificationTokenSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    tokenHash: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },

    expiresAt: {
      type: Date,
      required: true,
      index: true,
      // TTL index: auto-delete expired tokens
      expires: 0,
    },

    used: {
      type: Boolean,
      default: false,
      index: true,
    },

    usedAt: {
      type: Date,
    },

    requestIp: {
      type: String,
      trim: true,
      maxlength: 64,
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Compound index for fast lookups
EmailVerificationTokenSchema.index({ user: 1, tokenHash: 1 }, { unique: true });

// Helper: mark token as used
EmailVerificationTokenSchema.methods.markUsed = function () {
  this.used = true;
  this.usedAt = new Date();
  return this.save();
};

module.exports = mongoose.model('EmailVerificationToken', EmailVerificationTokenSchema);
