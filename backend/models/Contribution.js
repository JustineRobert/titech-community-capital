// models/Contribution.js
'use strict';

const mongoose = require('mongoose');

const ContributionSchema = new mongoose.Schema(
  {
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Group',
      required: [true, 'Group ID is required'],
      index: true,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },

    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: false,
      index: true,
    },

    // Use Decimal128 for money to avoid floating point issues
    amount: {
      type: mongoose.Schema.Types.Decimal128,
      required: [true, 'Contribution amount is required'],
      min: [0, 'Amount must be non-negative'],
      get: (v) => (v ? parseFloat(v.toString()) : 0),
      set: (v) => mongoose.Types.Decimal128.fromString(Number(v || 0).toFixed(2)),
    },

    currency: {
      type: String,
      default: 'UGX',
      uppercase: true,
      trim: true,
      maxlength: 3,
    },

    date: {
      type: Date,
      default: Date.now,
      index: true,
    },

    reference: {
      type: String,
      trim: true,
      index: true,
      sparse: true,
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: { getters: true, virtuals: true },
    toObject: { getters: true, virtuals: true },
  }
);

// Compound index for fast queries and to prevent duplicate contribution references per group/user
ContributionSchema.index({ groupId: 1, userId: 1, createdAt: -1 });
ContributionSchema.index({ tenantId: 1, groupId: 1, userId: 1, createdAt: -1 });
ContributionSchema.index({ groupId: 1, reference: 1 }, { unique: true, sparse: true, name: 'group_reference_unique' });

// Virtual id
ContributionSchema.virtual('id').get(function () {
  return this._id.toString();
});

// Static: add contribution with atomic upsert pattern if needed
ContributionSchema.statics.addContribution = async function (payload) {
  const Contribution = this;
  const doc = new Contribution(payload);
  return doc.save();
};

// Static: sum contributions for a group (optionally by tenant and date range)
ContributionSchema.statics.sumForGroup = async function (groupId, opts = {}) {
  const match = { groupId: mongoose.Types.ObjectId(groupId), isDeleted: false };
  if (opts.tenantId) match.tenantId = mongoose.Types.ObjectId(opts.tenantId);
  if (opts.from || opts.to) match.date = {};
  if (opts.from) match.date.$gte = new Date(opts.from);
  if (opts.to) match.date.$lte = new Date(opts.to);

  const res = await this.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        total: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
  ]);

  if (!res || !res[0]) return { total: 0, count: 0 };
  // amount is Decimal128; convert to number
  return { total: parseFloat(res[0].total.toString()), count: res[0].count };
};

// Static: user summary in a group
ContributionSchema.statics.userSummary = async function (groupId, userId) {
  const res = await this.aggregate([
    { $match: { groupId: mongoose.Types.ObjectId(groupId), userId: mongoose.Types.ObjectId(userId), isDeleted: false } },
    {
      $group: {
        _id: '$userId',
        total: { $sum: '$amount' },
        count: { $sum: 1 },
        lastContribution: { $max: '$date' },
      },
    },
  ]);

  if (!res || !res[0]) return { total: 0, count: 0, lastContribution: null };
  return { total: parseFloat(res[0].total.toString()), count: res[0].count, lastContribution: res[0].lastContribution };
};

// Instance: soft delete
ContributionSchema.methods.softDelete = function (deletedBy = null) {
  this.isDeleted = true;
  if (!this.metadata) this.metadata = {};
  this.metadata.deletedBy = deletedBy;
  this.metadata.deletedAt = new Date();
  return this.save();
};

// Pre-save validation: ensure amount is Decimal128
ContributionSchema.pre('validate', function (next) {
  if (this.amount == null) return next(new Error('Contribution amount is required'));
  // ensure amount is Decimal128
  if (!(this.amount instanceof mongoose.Types.Decimal128)) {
    this.amount = mongoose.Types.Decimal128.fromString(Number(this.amount).toFixed(2));
  }
  next();
});

module.exports = mongoose.model('Contribution', ContributionSchema);
