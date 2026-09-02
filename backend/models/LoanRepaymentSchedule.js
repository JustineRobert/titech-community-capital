// models/LoanRepaymentSchedule.js
// ============================================================================
// Loan Repayment Schedule Model
// Manages installments, penalties, and repayment tracking
// ============================================================================

const mongoose = require('mongoose');

const loanRepaymentScheduleSchema = new mongoose.Schema(
  {
    loan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Loan',
      required: true,
      index: true,
    },

    installments: [
      {
        number: {
          type: Number,
          required: true,
        },
        dueDate: {
          type: Date,
          required: true,
          index: true,
        },
        principal: {
          type: Number,
          required: true,
          min: 0,
        },
        interest: {
          type: Number,
          required: true,
          min: 0,
        },
        totalAmount: {
          type: Number,
          required: true,
          min: 0,
        },
        paidAmount: {
          type: Number,
          default: 0,
          min: 0,
        },
        penalties: {
          type: Number,
          default: 0,
          min: 0,
        },
        status: {
          type: String,
          enum: ['pending', 'paid', 'partially_paid', 'overdue', 'forgiven'],
          default: 'pending',
          index: true,
        },
        paidAt: {
          type: Date,
          sparse: true,
        },
        payments: [
          {
            amount: Number,
            paidAt: Date,
            method: String,
            reference: String,
          },
        ],
      },
    ],

    // Summary fields
    totalPrincipal: {
      type: Number,
      required: true,
      min: 0,
    },
    totalInterest: {
      type: Number,
      required: true,
      min: 0,
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    totalPaid: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalPenalties: {
      type: Number,
      default: 0,
      min: 0,
    },
    outstandingAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    // Status tracking
    status: {
      type: String,
      enum: ['active', 'completed', 'defaulted', 'suspended'],
      default: 'active',
      index: true,
    },
    completedAt: {
      type: Date,
      sparse: true,
    },
    defaultedAt: {
      type: Date,
      sparse: true,
    },

    // Penalty configuration
    penaltyConfig: {
      lateFeePercent: {
        type: Number,
        default: 2, // 2% of outstanding amount
        min: 0,
        max: 100,
      },
      lateFeeFixed: {
        type: Number,
        default: 0,
        min: 0,
      },
      penaltyGraceDays: {
        type: Number,
        default: 5, // Grace period before penalty applies
        min: 0,
      },
      maxPenaltyPercent: {
        type: Number,
        default: 10, // Cap penalties at 10% of principal
        min: 0,
      },
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Index for common queries
loanRepaymentScheduleSchema.index({ loan: 1, status: 1 });
loanRepaymentScheduleSchema.index({ 'installments.dueDate': 1, 'installments.status': 1 });

/**
 * Calculate penalties for overdue installments
 */
loanRepaymentScheduleSchema.methods.calculatePenalties = function () {
  const now = new Date();
  let totalNewPenalties = 0;

  for (const installment of this.installments) {
    if (['paid', 'forgiven'].includes(installment.status)) {
      continue;
    }

    const daysOverdue = Math.floor((now - installment.dueDate) / (1000 * 60 * 60 * 24));

    if (daysOverdue > this.penaltyConfig.penaltyGraceDays) {
      const outstandingOnInstallment = installment.totalAmount - installment.paidAmount;

      // Calculate penalty
      let newPenalty = 0;
      if (this.penaltyConfig.lateFeePercent > 0) {
        newPenalty += (outstandingOnInstallment * this.penaltyConfig.lateFeePercent) / 100;
      }
      if (this.penaltyConfig.lateFeeFixed > 0) {
        newPenalty += this.penaltyConfig.lateFeeFixed;
      }

      // Cap penalty
      const maxPenalty = (this.totalPrincipal * this.penaltyConfig.maxPenaltyPercent) / 100;
      newPenalty = Math.min(newPenalty, maxPenalty);

      const addedPenalty = Math.max(0, newPenalty - installment.penalties);
      installment.penalties = newPenalty;
      totalNewPenalties += addedPenalty;
    }
  }

  this.totalPenalties += totalNewPenalties;
  this.outstandingAmount = this.totalAmount - this.totalPaid + this.totalPenalties;

  return totalNewPenalties;
};

/**
 * Record payment for an installment
 */
loanRepaymentScheduleSchema.methods.recordPayment = function (
  installmentNumber,
  amount,
  paymentMethod,
  reference
) {
  const installment = this.installments.find((i) => i.number === installmentNumber);

  if (!installment) {
    throw new Error(`Installment ${installmentNumber} not found`);
  }

  installment.paidAmount += amount;
  installment.payments.push({
    amount,
    paidAt: new Date(),
    method: paymentMethod,
    reference,
  });

  this.totalPaid += amount;
  this.outstandingAmount = this.totalAmount - this.totalPaid + this.totalPenalties;

  // Update installment status
  if (installment.paidAmount >= installment.totalAmount) {
    installment.status = 'paid';
    installment.paidAt = new Date();
  } else if (installment.paidAmount > 0) {
    installment.status = 'partially_paid';
  }

  // Check if schedule is complete
  if (this.installments.every((i) => ['paid', 'forgiven'].includes(i.status))) {
    this.status = 'completed';
    this.completedAt = new Date();
  }

  return installment;
};

/**
 * Get next due installment
 */
loanRepaymentScheduleSchema.methods.getNextDueInstallment = function () {
  return this.installments.find(
    (i) => !['paid', 'forgiven'].includes(i.status) && i.dueDate <= new Date()
  );
};

/**
 * Get upcoming installments
 */
loanRepaymentScheduleSchema.methods.getUpcomingInstallments = function (days = 30) {
  const endDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return this.installments.filter(
    (i) =>
      !['paid', 'forgiven'].includes(i.status) && i.dueDate > new Date() && i.dueDate <= endDate
  );
};

/**
 * Get payment summary
 */
loanRepaymentScheduleSchema.methods.getPaymentSummary = function () {
  return {
    totalAmount: this.totalAmount,
    totalPaid: this.totalPaid,
    outstandingAmount: this.outstandingAmount,
    totalPenalties: this.totalPenalties,
    paymentPercentage: Math.round((this.totalPaid / this.totalAmount) * 100),
    status: this.status,
    nextDueDate: this.installments.find((i) => i.status === 'pending')?.dueDate,
  };
};

module.exports = mongoose.model('LoanRepaymentSchedule', loanRepaymentScheduleSchema);
