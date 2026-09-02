// backend/modules/finance/services/LoanService.js
'use strict';

const Loan = require('../models/Loan');
const LedgerEntry = require('../models/LedgerEntry');

class LoanService {
  /**
   * ✅ Approve Loan
   */
  static async approveLoan(loanId) {
    const loan = await Loan.findById(loanId);

    loan.status = 'APPROVED';
    loan.approvedAt = new Date();

    return loan.save();
  }

  /**
   * ✅ Disburse Loan (CRITICAL FLOW)
   */
  static async disburseLoan(loanId, cashAccountId, loanAccountId) {
    const loan = await Loan.findById(loanId);

    loan.status = 'ACTIVE';
    loan.disbursedAt = new Date();
    loan.balance = loan.principal;

    await loan.save();

    // ✅ Ledger entry
    await LedgerEntry.postTransaction({
      tenantId: loan.tenantId,
      transactionId: loan._id,
      debitAccountId: loanAccountId,  // Loan asset
      creditAccountId: cashAccountId, // Cash leaving SACCO
      amount: loan.principal,
      description: 'Loan disbursement'
    });

    return loan;
  }

  /**
   * ✅ Repayment
   */
  static async repayLoan(loanId, amount, cashAccountId, loanAccountId) {
    const loan = await Loan.findById(loanId);

    loan.balance = Number(loan.balance) - Number(amount);

    if (loan.balance <= 0) {
      loan.status = 'COMPLETED';
    }

    await loan.save();

    // Ledger
    await LedgerEntry.postTransaction({
      tenantId: loan.tenantId,
      transactionId: loan._id,
      debitAccountId: cashAccountId,
      creditAccountId: loanAccountId,
      amount,
      description: 'Loan repayment'
    });

    return loan;
  }
}

module.exports = LoanService;