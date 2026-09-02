/**
 * LoanAudit.js
 *
 * Tracks all loan-related actions for compliance and troubleshooting
 * Immutable audit trail with full context
 */

const mongoose = require('mongoose');

const loanAuditSchema = new mongoose.Schema(
  {
    // Action identifier
    action: {
      type: String,
      enum: [
        'eligibility_assessed',
        'eligibility_overridden',
        'loan_applied',
        'loan_approved',
        'loan_rejected',
        'loan_disbursed',
        'payment_recorded',
        'penalty_applied',
        'loan_defaulted',
        'loan_restructured',
        'loan_completed',
      ],
      required: true,
      index: true,
    },
    // Loan reference
    loan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Loan',
      index: true,
    },
    // User affected by action
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // Group context
    group: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Group',
      index: true,
    },
    // Actor (admin, group_admin, system, or the user themselves)
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    actorRole: {
      type: String,
      enum: ['user', 'admin', 'group_admin', 'system'],
      required: true,
    },
    // What changed
    changes: {
      before: mongoose.Schema.Types.Mixed,
      after: mongoose.Schema.Types.Mixed,
    },
    // Detailed description
    description: {
      type: String,
      maxlength: 1000,
    },
    // Amount involved (if applicable)
    amount: {
      type: Number,
      default: null,
    },
    // Metadata
    metadata: {
      ipAddress: String,
      userAgent: String,
      reason: String, // for rejections, defaults, etc.
      score: Number, // eligibility or other score
      riskLevel: {
        type: String,
        enum: ['low', 'medium', 'high'],
      },
    },
    // Success/failure
    status: {
      type: String,
      enum: ['success', 'failed', 'pending'],
      default: 'success',
    },
    // Error details if failed
    error: {
      message: String,
      code: String,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    immutable: true, // Prevent modifications after creation
  }
);

// Compound indices for efficient querying
loanAuditSchema.index({ user: 1, createdAt: -1 });
loanAuditSchema.index({ loan: 1, createdAt: -1 });
loanAuditSchema.index({ action: 1, createdAt: -1 });
loanAuditSchema.index({ actor: 1, createdAt: -1 });

/**
 * Create an audit entry
 */
loanAuditSchema.statics.logAction = async function ({
  action,
  loan,
  user,
  group,
  actor,
  actorRole,
  changes,
  description,
  amount,
  metadata = {},
  status = 'success',
  error = null,
} = {}) {
  try {
    const audit = new this({
      action,
      loan,
      user,
      group,
      actor,
      actorRole,
      changes,
      description,
      amount,
      metadata,
      status,
      error,
    });
    await audit.save();
    return audit;
  } catch (err) {
    console.error('Failed to create loan audit entry:', err);
    // Don't throw - audit failures shouldn't break business logic
  }
};

/**
 * Get audit trail for a loan
 */
loanAuditSchema.statics.getLoanTrail = async function (loanId) {
  return this.find({ loan: loanId })
    .populate('actor', 'name email role')
    .populate('user', 'name email')
    .sort({ createdAt: 1 });
};

/**
 * Get user's loan activity
 */
loanAuditSchema.statics.getUserActivity = async function (userId, limit = 50) {
  return this.find({ user: userId })
    .populate('actor', 'name email')
    .populate('loan', 'amount status')
    .sort({ createdAt: -1 })
    .limit(limit);
};

module.exports = mongoose.model('LoanAudit', loanAuditSchema);
