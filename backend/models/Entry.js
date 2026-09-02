// server/models/Entry.js
'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const { randomUUID } = require('crypto');

const EntrySchema = new Schema(
  {
    _id: { type: String, default: () => randomUUID() },

    transactionId: {
      type: String,
      required: true,
      ref: 'LedgerTransaction',
      index: true,
    },

    accountId: {
      type: String,
      required: true,
      ref: 'Account',
      index: true,
    },

    amount: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
      min: [0, 'Amount must be non-negative'],
      get: (v) => (v ? parseFloat(v.toString()) : 0),
      set: (v) => mongoose.Types.Decimal128.fromString(Number(v || 0).toFixed(2)),
    },

    direction: {
      type: String,
      required: true,
      enum: ['debit', 'credit'],
      lowercase: true,
      trim: true,
    },

    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    metadata: {
      source: { type: String, trim: true },
      requestId: { type: String, trim: true },
      extra: { type: Schema.Types.Mixed, default: {} },
    },

    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    versionKey: false,
    toJSON: { getters: true },
    toObject: { getters: true },
  }
);

// Compound index for validation and queries
EntrySchema.index({ transactionId: 1, accountId: 1, direction: 1 });

// Pre-save validation
EntrySchema.pre('save', function (next) {
  if (this.amount <= 0) {
    return next(new Error('Amount must be greater than zero'));
  }
  next();
});

// Instance method: soft delete
EntrySchema.methods.softDelete = function (deletedBy = null) {
  this.isDeleted = true;
  if (!this.metadata) this.metadata = {};
  this.metadata.deletedBy = deletedBy;
  this.metadata.deletedAt = new Date();
  return this.save();
};

module.exports = mongoose.model('Entry', EntrySchema);
