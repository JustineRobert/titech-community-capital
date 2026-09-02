/**
 * LoanEligibility.js
 *
 * Tracks loan eligibility assessments with scoring history
 * Enables audit trails and recalculation for appeals/updates
 */

const mongoose = require('mongoose');

const loanEligibilitySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User is required'],
      index: true,
    },
    group: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Group',
      required: [true, 'Group is required'],
      index: true,
    },
    // Overall eligibility score (0-100)
    overallScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    // Individual scoring components
    components: {
      contributionScore: {
        type: Number,
        default: 0,
        min: 0,
        max: 40,
      },
      participationScore: {
        type: Number,
        default: 0,
        min: 0,
        max: 30,
      },
      repaymentScore: {
        type: Number,
        default: 0,
        min: 0,
        max: 20,
      },
      riskScore: {
        type: Number,
        default: 0,
        min: 0,
        max: 10,
      },
    },
    // Raw data used in scoring
    metadata: {
      monthsActive: {
        type: Number,
        default: 0,
      },
      totalContributed: {
        type: Number,
        default: 0,
      },
      contributionCount: {
        type: Number,
        default: 0,
      },
      averageContribution: {
        type: Number,
        default: 0,
      },
      completedLoans: {
        type: Number,
        default: 0,
      },
      defaultedLoans: {
        type: Number,
        default: 0,
      },
      onTimeRepaymentRate: {
        type: Number,
        default: 0,
        min: 0,
        max: 100,
      },
      activeLoans: {
        type: Number,
        default: 0,
      },
      totalOutstanding: {
        type: Number,
        default: 0,
      },
    },
    // Eligibility determination
    isEligible: {
      type: Boolean,
      required: true,
    },
    // Maximum loan amount allowed
    maxLoanAmount: {
      type: Number,
      required: true,
      default: 0,
    },
    // Rejection reason if not eligible
    rejectionReason: {
      type: String,
      enum: [
        'insufficient_contribution',
        'insufficient_participation',
        'poor_repayment_history',
        'excessive_outstanding_loans',
        'insufficient_group_membership',
        'recent_default',
        'account_not_verified',
        'account_suspended',
        null,
      ],
      default: null,
    },
    // Assessment timestamp
    assessedAt: {
      type: Date,
      default: Date.now,
    },
    // Expiry for re-assessment
    expiresAt: {
      type: Date,
      required: true,
    },
    // Admin notes
    notes: {
      type: String,
      maxlength: 500,
    },
    // Admin override
    overriddenBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    overriddenAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform(doc, ret) {
        ret.id = doc._id.toString();
        delete ret._id;
      },
    },
  }
);

// Index for efficient lookups
loanEligibilitySchema.index({ user: 1, group: 1, expiresAt: 1 });
loanEligibilitySchema.index({ isEligible: 1, expiresAt: 1 });

/**
 * Find active eligibility assessment
 * Auto-expires after configurable period (default 30 days)
 */
loanEligibilitySchema.statics.findActiveAssessment = async function (userId, groupId) {
  return this.findOne({
    user: userId,
    group: groupId,
    expiresAt: { $gt: new Date() },
  });
};

/**
 * Check if assessment needs refresh
 */
loanEligibilitySchema.methods.needsRefresh = function () {
  return new Date() > this.expiresAt;
};

module.exports = mongoose.model('LoanEligibility', loanEligibilitySchema);
