/**
 * Loan Workflow Service
 * Implements loan state machine with validated transitions, repayment schedules, and audit trail
 * Handles full loan lifecycle: request → approval → disbursement → repayment → closure
 */

const Loan = require('../models/Loan');
const LoanRepaymentSchedule = require('../models/LoanRepaymentSchedule');
const LoanAudit = require('../models/LoanAudit');
const logger = require('../utils/logger');

/**
 * Loan status state machine
 * Defines valid transitions between states
 */
const LOAN_STATUS_MACHINE = {
  pending_application: {
    // User submitted loan request, awaiting admin review
    allowedTransitions: ['approved', 'rejected', 'canceled'],
    description: 'Awaiting initial review',
    isPending: true,
  },
  approved: {
    // Admin approved the loan request
    allowedTransitions: ['disbursed', 'canceled'],
    description: 'Loan approved, awaiting disbursement',
    isPending: false,
  },
  rejected: {
    // Admin rejected the loan request
    allowedTransitions: ['pending_application'], // User can reapply
    description: 'Loan application rejected',
    isPending: false,
    isFinal: true,
  },
  disbursed: {
    // Money transferred to borrower account
    allowedTransitions: ['active', 'canceled'],
    description: 'Funds disbursed to borrower',
    isPending: false,
  },
  active: {
    // Repayment schedule in progress
    allowedTransitions: ['overdue', 'defaulted', 'closed', 'canceled'],
    description: 'Repayment schedule active',
    isPending: false,
    isActive: true,
  },
  overdue: {
    // Repayment is late
    allowedTransitions: ['active', 'defaulted', 'closed'],
    description: 'Payment overdue',
    isPending: false,
    isActive: true,
    isOverdue: true,
  },
  defaulted: {
    // Loan defaulted (unpaid for extended period)
    allowedTransitions: ['closed'],
    description: 'Loan in default',
    isPending: false,
    isFinal: true,
    isOverdue: true,
  },
  closed: {
    // Loan fully repaid or write-off
    allowedTransitions: [],
    description: 'Loan closed',
    isPending: false,
    isFinal: true,
  },
  canceled: {
    // Loan canceled before completion
    allowedTransitions: [],
    description: 'Loan canceled',
    isPending: false,
    isFinal: true,
  },
};

class LoanWorkflowService {
  constructor(config = {}) {
    this.statusMachine = LOAN_STATUS_MACHINE;
    this.defaultInterestRate = config.defaultInterestRate || 0.15; // 15% annual
    this.defaultTerm = config.defaultTerm || 12; // 12 months
    this.overdueDaysThreshold = config.overdueDaysThreshold || 7;
    this.defaultDaysThreshold = config.defaultDaysThreshold || 30;
  }

  /**
   * Create loan application
   * @param {Object} params - { borrowerId, groupId, amount, term, description, purpose }
   * @returns {Object} - Created loan document
   */
  async createLoanApplication(params) {
    try {
      const { borrowerId, groupId, amount, term = this.defaultTerm, description, purpose } = params;

      if (!borrowerId || !amount || amount <= 0) {
        throw new Error('Invalid loan parameters: borrowerId and positive amount required');
      }

      const loan = await Loan.create({
        borrower: borrowerId,
        group: groupId,
        amount,
        term,
        interestRate: this.defaultInterestRate,
        description,
        purpose,
        status: 'pending_application',
        metadata: {
          applicationDate: new Date(),
          applicantNotes: description,
        },
      });

      logger.info('[LoanWorkflowService] Loan application created', {
        loanId: loan._id,
        borrowerId,
        amount,
        status: loan.status,
      });

      return loan;
    } catch (error) {
      logger.error('[LoanWorkflowService] Error creating loan application', {
        error: error.message,
        borrowerId: params.borrowerId,
        amount: params.amount,
      });
      throw error;
    }
  }

  /**
   * Change loan status with validation and audit trail
   * @param {string} loanId - Loan ID
   * @param {string} newStatus - Target status
   * @param {Object} actor - { id, role } User making change
   * @param {string} reason - Reason for status change
   * @returns {Object} - Updated loan document
   */
  async changeLoanStatus(loanId, newStatus, actor, reason = '') {
    try {
      const loan = await Loan.findById(loanId);
      if (!loan) {
        throw new Error('Loan not found');
      }

      const currentStatus = loan.status;
      const statusConfig = this.statusMachine[currentStatus];

      // Validate status machine rules
      if (!statusConfig) {
        throw new Error(`Invalid current status: ${currentStatus}`);
      }

      if (!statusConfig.allowedTransitions.includes(newStatus)) {
        throw new Error(
          `Invalid transition: cannot change from '${currentStatus}' to '${newStatus}'. ` +
            `Allowed: ${statusConfig.allowedTransitions.join(', ')}`
        );
      }

      // Validate new status exists
      if (!this.statusMachine[newStatus]) {
        throw new Error(`Invalid new status: ${newStatus}`);
      }

      // Store before state
      const before = loan.toObject();

      // Update loan
      loan.status = newStatus;
      loan.lastStatusChange = new Date();
      if (loan.metadata) {
        loan.metadata.lastStatusChangeReason = reason;
      }

      // Handle special status changes
      if (newStatus === 'approved') {
        loan.approvedAt = new Date();
        loan.approvedBy = actor.id;
      } else if (newStatus === 'disbursed') {
        loan.disbursedAt = new Date();
        loan.disbursedBy = actor.id;
      } else if (newStatus === 'active') {
        // Generate repayment schedule when transitioning to active
        if (!loan.repaymentScheduleGenerated) {
          await this.generateRepaymentSchedule(loan);
          loan.repaymentScheduleGenerated = true;
        }
      } else if (newStatus === 'closed') {
        loan.closedAt = new Date();
      }

      await loan.save();

      // Create audit trail entry
      await LoanAudit.create({
        loan: loan._id,
        action: `status_change`,
        oldStatus: currentStatus,
        newStatus,
        actor: actor.id,
        actorRole: actor.role,
        reason,
        before,
        after: loan.toObject(),
      });

      logger.info('[LoanWorkflowService] Loan status changed', {
        loanId: loan._id,
        oldStatus: currentStatus,
        newStatus,
        actor: actor.id,
        timestamp: new Date(),
      });

      return loan;
    } catch (error) {
      logger.error('[LoanWorkflowService] Error changing loan status', {
        error: error.message,
        loanId,
        newStatus,
        actor: actor?.id,
      });
      throw error;
    }
  }

  /**
   * Generate repayment schedule with installments
   * @param {Object} loan - Loan document
   * @returns {Object} - Repayment schedule document
   */
  async generateRepaymentSchedule(loan) {
    try {
      const installments = [];
      const monthlyRate = loan.interestRate / 12;
      const monthlyPayment = this.calculateMonthlyPayment(loan.amount, monthlyRate, loan.term);

      let outstandingBalance = loan.amount;
      const startDate = new Date();

      for (let i = 1; i <= loan.term; i++) {
        const dueDate = new Date(startDate);
        dueDate.setMonth(dueDate.getMonth() + i);

        const interestPayment = outstandingBalance * monthlyRate;
        const principalPayment = monthlyPayment - interestPayment;
        outstandingBalance -= principalPayment;

        installments.push({
          installmentNumber: i,
          dueDate,
          principalAmount: Math.round(principalPayment * 100) / 100,
          interestAmount: Math.round(interestPayment * 100) / 100,
          totalAmount: monthlyPayment,
          status: 'pending',
          paidAmount: 0,
          paidDate: null,
          daysOverdue: 0,
        });
      }

      const schedule = await LoanRepaymentSchedule.create({
        loan: loan._id,
        totalInstallments: loan.term,
        monthlyPayment,
        totalAmount: installments.reduce((sum, inst) => sum + inst.totalAmount, 0),
        totalInterest: installments.reduce((sum, inst) => sum + inst.interestAmount, 0),
        installments,
        generatedAt: new Date(),
      });

      logger.info('[LoanWorkflowService] Repayment schedule generated', {
        loanId: loan._id,
        installments: loan.term,
        monthlyPayment,
        totalAmount: schedule.totalAmount,
      });

      return schedule;
    } catch (error) {
      logger.error('[LoanWorkflowService] Error generating repayment schedule', {
        error: error.message,
        loanId: loan._id,
        term: loan.term,
      });
      throw error;
    }
  }

  /**
   * Record repayment against loan
   * @param {string} loanId - Loan ID
   * @param {number} amount - Payment amount
   * @param {string} transactionId - Reference to payment transaction
   * @returns {Object} - Updated loan and schedule
   */
  async recordRepayment(loanId, amount, transactionId) {
    try {
      const loan = await Loan.findById(loanId);
      if (!loan) {
        throw new Error('Loan not found');
      }

      const schedule = await LoanRepaymentSchedule.findOne({ loan: loanId });
      if (!schedule) {
        throw new Error('Repayment schedule not found');
      }

      // Find next pending installment
      const pendingInstallment = schedule.installments.find((inst) => inst.status === 'pending');
      if (!pendingInstallment) {
        throw new Error('No pending installments found');
      }

      if (amount < pendingInstallment.totalAmount) {
        throw new Error(
          `Insufficient payment. Expected: ${pendingInstallment.totalAmount}, Received: ${amount}`
        );
      }

      // Mark installment as paid
      pendingInstallment.status = 'paid';
      pendingInstallment.paidAmount = amount;
      pendingInstallment.paidDate = new Date();
      pendingInstallment.daysOverdue = Math.max(
        0,
        Math.floor(
          (pendingInstallment.paidDate - pendingInstallment.dueDate) / (1000 * 60 * 60 * 24)
        )
      );

      // Update loan balance
      loan.outstandingBalance -= amount;
      loan.totalPaid = (loan.totalPaid || 0) + amount;
      loan.lastPaymentDate = new Date();

      // Check if loan is fully paid
      const paidInstallments = schedule.installments.filter(
        (inst) => inst.status === 'paid'
      ).length;
      if (paidInstallments === schedule.totalInstallments) {
        await this.changeLoanStatus(
          loanId,
          'closed',
          { id: 'system', role: 'system' },
          'Loan fully repaid'
        );
      }

      // Update status if was overdue but now current
      const nextInstallment = schedule.installments.find((inst) => inst.status === 'pending');
      if (loan.status === 'overdue' && nextInstallment && nextInstallment.dueDate > new Date()) {
        await this.changeLoanStatus(
          loanId,
          'active',
          { id: 'system', role: 'system' },
          'Payment received, no longer overdue'
        );
      }

      // Create audit entry
      await LoanAudit.create({
        loan: loan._id,
        action: 'repayment_recorded',
        amount,
        transactionId,
        installmentNumber: pendingInstallment.installmentNumber,
        daysOverdue: pendingInstallment.daysOverdue,
        actor: 'system',
      });

      await schedule.save();
      await loan.save();

      logger.info('[LoanWorkflowService] Repayment recorded', {
        loanId,
        amount,
        outstandingBalance: loan.outstandingBalance,
        transactionId,
      });

      return { loan, schedule };
    } catch (error) {
      logger.error('[LoanWorkflowService] Error recording repayment', {
        error: error.message,
        loanId,
        amount,
      });
      throw error;
    }
  }

  /**
   * Check and update loan status for overdue payments
   * Should be called by scheduled job daily
   * @returns {Object} - { checked, updated, overdue, defaulted }
   */
  async checkAndUpdateOverdueStatus() {
    try {
      const activeLoanss = await Loan.find({ status: 'active' });
      const stats = { checked: 0, updated: 0, overdue: 0, defaulted: 0 };

      for (const loan of activeLoanss) {
        stats.checked += 1;
        const schedule = await LoanRepaymentSchedule.findOne({ loan: loan._id });
        if (!schedule) continue;

        const now = new Date();
        let needsUpdate = false;
        let newStatus = loan.status;

        for (const installment of schedule.installments) {
          if (installment.status === 'pending') {
            const daysOverdue = Math.floor((now - installment.dueDate) / (1000 * 60 * 60 * 24));

            if (daysOverdue > this.defaultDaysThreshold) {
              // Mark as defaulted
              newStatus = 'defaulted';
              needsUpdate = true;
              stats.defaulted += 1;
              break;
            } else if (daysOverdue > this.overdueDaysThreshold && loan.status === 'active') {
              // Mark as overdue
              newStatus = 'overdue';
              needsUpdate = true;
              stats.overdue += 1;
              break;
            }
          }
        }

        if (needsUpdate && newStatus !== loan.status) {
          await this.changeLoanStatus(
            loan._id,
            newStatus,
            { id: 'system', role: 'system' },
            `Automated status update: ${newStatus}`
          );
          stats.updated += 1;
        }
      }

      logger.info('[LoanWorkflowService] Overdue check completed', stats);
      return stats;
    } catch (error) {
      logger.error('[LoanWorkflowService] Error checking overdue status', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get loan summary with repayment progress
   * @param {string} loanId - Loan ID
   * @returns {Object} - Loan summary with progress
   */
  async getLoanSummary(loanId) {
    try {
      const loan = await Loan.findById(loanId);
      if (!loan) {
        throw new Error('Loan not found');
      }

      const schedule = await LoanRepaymentSchedule.findOne({ loan: loanId });
      if (!schedule) {
        throw new Error('Repayment schedule not found');
      }

      const pendingInstallments = schedule.installments.filter((inst) => inst.status === 'pending');
      const paidInstallments = schedule.installments.filter((inst) => inst.status === 'paid');

      return {
        loanId: loan._id,
        borrower: loan.borrower,
        amount: loan.amount,
        term: loan.term,
        status: loan.status,
        interestRate: loan.interestRate,
        appliedAt: loan.createdAt,
        approvedAt: loan.approvedAt,
        disbursedAt: loan.disbursedAt,
        repaymentSchedule: {
          monthlyPayment: schedule.monthlyPayment,
          totalPayable: schedule.totalAmount,
          totalInterest: schedule.totalInterest,
          totalInstallments: schedule.totalInstallments,
          paidInstallments: paidInstallments.length,
          pendingInstallments: pendingInstallments.length,
          nextInstallmentDue: pendingInstallments[0]?.dueDate,
          outstandingBalance: loan.outstandingBalance,
        },
        progress: {
          percentComplete: ((paidInstallments.length / schedule.totalInstallments) * 100).toFixed(
            1
          ),
          amountPaid: loan.totalPaid || 0,
          amountRemaining: loan.outstandingBalance,
        },
      };
    } catch (error) {
      logger.error('[LoanWorkflowService] Error getting loan summary', {
        error: error.message,
        loanId,
      });
      throw error;
    }
  }

  /**
   * Calculate monthly payment using amortization formula
   * @param {number} principal - Loan amount
   * @param {number} monthlyRate - Monthly interest rate (annual / 12)
   * @param {number} term - Number of months
   * @returns {number} - Monthly payment amount
   */
  calculateMonthlyPayment(principal, monthlyRate, term) {
    if (monthlyRate === 0) {
      return principal / term;
    }
    return (
      (principal * (monthlyRate * Math.pow(1 + monthlyRate, term))) /
      (Math.pow(1 + monthlyRate, term) - 1)
    );
  }
}

module.exports = LoanWorkflowService;
