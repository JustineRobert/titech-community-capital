// backend/modules/finance/services/loanAccountingService.js
'use strict';

const mongoose = require('mongoose');

const Loan = require('../models/Loan');
const Journal = require('../models/Journal');
const JournalEntry = require('../models/JournalEntry');
const Account = require('../models/Account');

const ledgerService = require('./ledgerService');

const LOAN_EVENTS = {
  DISBURSEMENT: 'DISBURSEMENT',
  REPAYMENT: 'REPAYMENT',
  INTEREST_ACCRUAL: 'INTEREST_ACCRUAL',
  PENALTY_ACCRUAL: 'PENALTY_ACCRUAL',
  WRITE_OFF: 'WRITE_OFF',
  RECOVERY: 'RECOVERY',
  PROVISION: 'PROVISION'
};

/**
 * ---------------------------------------------------------
 * ACCOUNT RESOLUTION
 * ---------------------------------------------------------
 */

async function getAccountByCode(tenantId, code) {
  const account = await Account.findOne({
    tenantId,
    code,
    isDeleted: false
  });

  if (!account) {
    throw new Error(`Account not found: ${code}`);
  }

  return account;
}

/**
 * ---------------------------------------------------------
 * LOAN DISBURSEMENT
 * ---------------------------------------------------------
 *
 * DR Loan Receivable
 * CR Cash / MoMo Settlement
 */

exports.recordLoanDisbursement = async ({
  tenantId,
  loanId,
  amount,
  reference,
  disbursedBy
}) => {
  const loan = await Loan.findById(loanId);

  if (!loan) {
    throw new Error('Loan not found');
  }

  const receivableAccount =
    await getAccountByCode(
      tenantId,
      'LOAN_RECEIVABLE'
    );

  const cashAccount =
    await getAccountByCode(
      tenantId,
      'CASH'
    );

  return ledgerService.postTransaction({
    tenantId,
    debitAccountId:
      receivableAccount._id,
    creditAccountId:
      cashAccount._id,
    amount,
    reference,
    description:
      `Loan disbursement ${loan.loanNumber}`,
    metadata: {
      event:
        LOAN_EVENTS.DISBURSEMENT,
      loanId,
      disbursedBy
    }
  });
};

/**
 * ---------------------------------------------------------
 * LOAN REPAYMENT
 * ---------------------------------------------------------
 *
 * DR Cash
 * CR Loan Receivable
 */

exports.recordLoanRepayment = async ({
  tenantId,
  loanId,
  amount,
  reference,
  paidBy
}) => {
  const loan = await Loan.findById(loanId);

  if (!loan) {
    throw new Error('Loan not found');
  }

  const cashAccount =
    await getAccountByCode(
      tenantId,
      'CASH'
    );

  const receivableAccount =
    await getAccountByCode(
      tenantId,
      'LOAN_RECEIVABLE'
    );

  return ledgerService.postTransaction({
    tenantId,
    debitAccountId:
      cashAccount._id,
    creditAccountId:
      receivableAccount._id,
    amount,
    reference,
    description:
      `Loan repayment ${loan.loanNumber}`,
    metadata: {
      event:
        LOAN_EVENTS.REPAYMENT,
      loanId,
      paidBy
    }
  });
};

/**
 * ---------------------------------------------------------
 * INTEREST ACCRUAL
 * ---------------------------------------------------------
 *
 * DR Interest Receivable
 * CR Interest Income
 */

exports.recordInterestAccrual = async ({
  tenantId,
  loanId,
  amount,
  reference
}) => {
  const interestReceivable =
    await getAccountByCode(
      tenantId,
      'INTEREST_RECEIVABLE'
    );

  const interestIncome =
    await getAccountByCode(
      tenantId,
      'INTEREST_INCOME'
    );

  return ledgerService.postTransaction({
    tenantId,
    debitAccountId:
      interestReceivable._id,
    creditAccountId:
      interestIncome._id,
    amount,
    reference,
    description:
      `Interest accrual for loan ${loanId}`,
    metadata: {
      event:
        LOAN_EVENTS.INTEREST_ACCRUAL,
      loanId
    }
  });
};

/**
 * ---------------------------------------------------------
 * PENALTY ACCRUAL
 * ---------------------------------------------------------
 *
 * DR Penalty Receivable
 * CR Penalty Income
 */

exports.recordPenaltyAccrual = async ({
  tenantId,
  loanId,
  amount,
  reference
}) => {
  const penaltyReceivable =
    await getAccountByCode(
      tenantId,
      'PENALTY_RECEIVABLE'
    );

  const penaltyIncome =
    await getAccountByCode(
      tenantId,
      'PENALTY_INCOME'
    );

  return ledgerService.postTransaction({
    tenantId,
    debitAccountId:
      penaltyReceivable._id,
    creditAccountId:
      penaltyIncome._id,
    amount,
    reference,
    description:
      `Penalty accrual ${loanId}`,
    metadata: {
      event:
        LOAN_EVENTS.PENALTY_ACCRUAL,
      loanId
    }
  });
};

/**
 * ---------------------------------------------------------
 * IFRS9 PROVISIONING
 * ---------------------------------------------------------
 *
 * DR Impairment Expense
 * CR Loan Loss Provision
 */

exports.recordProvision = async ({
  tenantId,
  loanId,
  amount,
  reference,
  stage
}) => {
  const impairmentExpense =
    await getAccountByCode(
      tenantId,
      'IMPAIRMENT_EXPENSE'
    );

  const provisionAccount =
    await getAccountByCode(
      tenantId,
      'LOAN_LOSS_PROVISION'
    );

  return ledgerService.postTransaction({
    tenantId,
    debitAccountId:
      impairmentExpense._id,
    creditAccountId:
      provisionAccount._id,
    amount,
    reference,
    description:
      `Provision stage ${stage}`,
    metadata: {
      event:
        LOAN_EVENTS.PROVISION,
      loanId,
      stage
    }
  });
};

/**
 * ---------------------------------------------------------
 * LOAN WRITE OFF
 * ---------------------------------------------------------
 *
 * DR Loan Loss Provision
 * CR Loan Receivable
 */

exports.recordWriteOff = async ({
  tenantId,
  loanId,
  amount,
  reference
}) => {
  const provision =
    await getAccountByCode(
      tenantId,
      'LOAN_LOSS_PROVISION'
    );

  const receivable =
    await getAccountByCode(
      tenantId,
      'LOAN_RECEIVABLE'
    );

  return ledgerService.postTransaction({
    tenantId,
    debitAccountId:
      provision._id,
    creditAccountId:
      receivable._id,
    amount,
    reference,
    description:
      `Loan write-off ${loanId}`,
    metadata: {
      event:
        LOAN_EVENTS.WRITE_OFF,
      loanId
    }
  });
};

/**
 * ---------------------------------------------------------
 * RECOVERY AFTER WRITE-OFF
 * ---------------------------------------------------------
 *
 * DR Cash
 * CR Recovery Income
 */

exports.recordRecovery = async ({
  tenantId,
  loanId,
  amount,
  reference
}) => {
  const cash =
    await getAccountByCode(
      tenantId,
      'CASH'
    );

  const recoveryIncome =
    await getAccountByCode(
      tenantId,
      'RECOVERY_INCOME'
    );

  return ledgerService.postTransaction({
    tenantId,
    debitAccountId:
      cash._id,
    creditAccountId:
      recoveryIncome._id,
    amount,
    reference,
    description:
      `Recovery of written-off loan`,
    metadata: {
      event:
        LOAN_EVENTS.RECOVERY,
      loanId
    }
  });
};

/**
 * ---------------------------------------------------------
 * PORTFOLIO SUMMARY
 * ---------------------------------------------------------
 */

exports.getLoanAccountingSummary =
  async (
    tenantId,
    startDate,
    endDate
  ) => {
    const summary =
      await JournalEntry.aggregate([
        {
          $match: {
            tenantId:
              new mongoose.Types.ObjectId(
                tenantId
              ),
            createdAt: {
              $gte:
                new Date(
                  startDate
                ),
              $lte:
                new Date(
                  endDate
                )
            }
          }
        },
        {
          $group: {
            _id: '$entryType',
            totalAmount: {
              $sum:
                '$amount'
            },
            count: {
              $sum: 1
            }
          }
        }
      ]);

    return summary;
  };

/**
 * ---------------------------------------------------------
 * LOAN GL VALIDATION
 * ---------------------------------------------------------
 */

exports.validateLoanLedger =
  async (loanId) => {
    const entries =
      await JournalEntry.find({
        'metadata.loanId':
          loanId
      });

    let debitTotal = 0;
    let creditTotal = 0;

    entries.forEach(
      (entry) => {
        if (
          entry.direction ===
          'debit'
        ) {
          debitTotal +=
            entry.amount;
        } else {
          creditTotal +=
            entry.amount;
        }
      }
    );

    return {
      balanced:
        debitTotal ===
        creditTotal,
      debitTotal,
      creditTotal,
      variance:
        debitTotal -
        creditTotal
    };
  };