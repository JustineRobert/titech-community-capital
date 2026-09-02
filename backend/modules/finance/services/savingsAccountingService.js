// backend/modules/finance/services/savingsAccountingService.js

'use strict';

const mongoose = require('mongoose');

const Account = require('../models/Account');
const JournalEntry = require('../models/JournalEntry');

const ledgerService = require('./ledgerService');

/**
 * ---------------------------------------------------------
 * SAVINGS ACCOUNTING EVENTS
 * ---------------------------------------------------------
 */
const SAVINGS_EVENTS = {
  DEPOSIT: 'DEPOSIT',
  WITHDRAWAL: 'WITHDRAWAL',
  INTEREST_ACCRUAL: 'INTEREST_ACCRUAL',
  DIVIDEND_ACCRUAL: 'DIVIDEND_ACCRUAL',
  DIVIDEND_PAYMENT: 'DIVIDEND_PAYMENT',
  PENALTY: 'PENALTY',
  SHARE_PURCHASE: 'SHARE_PURCHASE',
  DORMANCY_FEE: 'DORMANCY_FEE',
  LOCKED_SAVINGS: 'LOCKED_SAVINGS'
};

/**
 * ---------------------------------------------------------
 * ACCOUNT RESOLUTION
 * ---------------------------------------------------------
 */
async function getAccountByCode(
  tenantId,
  code
) {
  const account =
    await Account.findOne({
      tenantId,
      code,
      isDeleted: false
    });

  if (!account) {
    throw new Error(
      `Account not found: ${code}`
    );
  }

  return account;
}

/**
 * ---------------------------------------------------------
 * MEMBER SAVINGS DEPOSIT
 * ---------------------------------------------------------
 *
 * DR CASH
 * CR MEMBER SAVINGS
 */
exports.recordSavingsDeposit =
  async ({
    tenantId,
    memberId,
    amount,
    reference,
    channel = 'CASH',
    metadata = {}
  }) => {

    const cashAccount =
      await getAccountByCode(
        tenantId,
        'CASH'
      );

    const savingsAccount =
      await getAccountByCode(
        tenantId,
        'MEMBER_SAVINGS'
      );

    return ledgerService.postTransaction({
      tenantId,
      debitAccountId:
        cashAccount._id,
      creditAccountId:
        savingsAccount._id,
      amount,
      reference,
      description:
        'Member savings deposit',
      metadata: {
        memberId,
        channel,
        event:
          SAVINGS_EVENTS.DEPOSIT,
        ...metadata
      }
    });
  };

/**
 * ---------------------------------------------------------
 * SAVINGS WITHDRAWAL
 * ---------------------------------------------------------
 *
 * DR MEMBER SAVINGS
 * CR CASH
 */
exports.recordSavingsWithdrawal =
  async ({
    tenantId,
    memberId,
    amount,
    reference,
    metadata = {}
  }) => {

    const savingsAccount =
      await getAccountByCode(
        tenantId,
        'MEMBER_SAVINGS'
      );

    const cashAccount =
      await getAccountByCode(
        tenantId,
        'CASH'
      );

    return ledgerService.postTransaction({
      tenantId,
      debitAccountId:
        savingsAccount._id,
      creditAccountId:
        cashAccount._id,
      amount,
      reference,
      description:
        'Member savings withdrawal',
      metadata: {
        memberId,
        event:
          SAVINGS_EVENTS.WITHDRAWAL,
        ...metadata
      }
    });
  };

/**
 * ---------------------------------------------------------
 * SHARE CAPITAL PURCHASE
 * ---------------------------------------------------------
 *
 * DR CASH
 * CR SHARE CAPITAL
 */
exports.recordSharePurchase =
  async ({
    tenantId,
    memberId,
    amount,
    reference
  }) => {

    const cashAccount =
      await getAccountByCode(
        tenantId,
        'CASH'
      );

    const shareCapital =
      await getAccountByCode(
        tenantId,
        'SHARE_CAPITAL'
      );

    return ledgerService.postTransaction({
      tenantId,
      debitAccountId:
        cashAccount._id,
      creditAccountId:
        shareCapital._id,
      amount,
      reference,
      description:
        'Share capital purchase',
      metadata: {
        memberId,
        event:
          SAVINGS_EVENTS.SHARE_PURCHASE
      }
    });
  };

/**
 * ---------------------------------------------------------
 * SAVINGS INTEREST ACCRUAL
 * ---------------------------------------------------------
 *
 * DR INTEREST EXPENSE
 * CR SAVINGS INTEREST PAYABLE
 */
exports.recordInterestAccrual =
  async ({
    tenantId,
    memberId,
    amount,
    reference
  }) => {

    const interestExpense =
      await getAccountByCode(
        tenantId,
        'SAVINGS_INTEREST_EXPENSE'
      );

    const payable =
      await getAccountByCode(
        tenantId,
        'SAVINGS_INTEREST_PAYABLE'
      );

    return ledgerService.postTransaction({
      tenantId,
      debitAccountId:
        interestExpense._id,
      creditAccountId:
        payable._id,
      amount,
      reference,
      description:
        'Savings interest accrual',
      metadata: {
        memberId,
        event:
          SAVINGS_EVENTS.INTEREST_ACCRUAL
      }
    });
  };

/**
 * ---------------------------------------------------------
 * DIVIDEND ACCRUAL
 * ---------------------------------------------------------
 *
 * DR DIVIDEND EXPENSE
 * CR DIVIDEND PAYABLE
 */
exports.recordDividendAccrual =
  async ({
    tenantId,
    memberId,
    amount,
    reference
  }) => {

    const expense =
      await getAccountByCode(
        tenantId,
        'DIVIDEND_EXPENSE'
      );

    const payable =
      await getAccountByCode(
        tenantId,
        'DIVIDEND_PAYABLE'
      );

    return ledgerService.postTransaction({
      tenantId,
      debitAccountId:
        expense._id,
      creditAccountId:
        payable._id,
      amount,
      reference,
      description:
        'Dividend accrual',
      metadata: {
        memberId,
        event:
          SAVINGS_EVENTS.DIVIDEND_ACCRUAL
      }
    });
  };

/**
 * ---------------------------------------------------------
 * DIVIDEND PAYMENT
 * ---------------------------------------------------------
 *
 * DR DIVIDEND PAYABLE
 * CR CASH
 */
exports.recordDividendPayment =
  async ({
    tenantId,
    memberId,
    amount,
    reference
  }) => {

    const payable =
      await getAccountByCode(
        tenantId,
        'DIVIDEND_PAYABLE'
      );

    const cash =
      await getAccountByCode(
        tenantId,
        'CASH'
      );

    return ledgerService.postTransaction({
      tenantId,
      debitAccountId:
        payable._id,
      creditAccountId:
        cash._id,
      amount,
      reference,
      description:
        'Dividend payment',
      metadata: {
        memberId,
        event:
          SAVINGS_EVENTS.DIVIDEND_PAYMENT
      }
    });
  };

/**
 * ---------------------------------------------------------
 * DORMANCY FEE
 * ---------------------------------------------------------
 *
 * DR MEMBER SAVINGS
 * CR DORMANCY INCOME
 */
exports.recordDormancyFee =
  async ({
    tenantId,
    memberId,
    amount,
    reference
  }) => {

    const savings =
      await getAccountByCode(
        tenantId,
        'MEMBER_SAVINGS'
      );

    const income =
      await getAccountByCode(
        tenantId,
        'DORMANCY_INCOME'
      );

    return ledgerService.postTransaction({
      tenantId,
      debitAccountId:
        savings._id,
      creditAccountId:
        income._id,
      amount,
      reference,
      description:
        'Dormancy fee',
      metadata: {
        memberId,
        event:
          SAVINGS_EVENTS.DORMANCY_FEE
      }
    });
  };

/**
 * ---------------------------------------------------------
 * SAVINGS PENALTY
 * ---------------------------------------------------------
 *
 * DR MEMBER SAVINGS
 * CR PENALTY INCOME
 */
exports.recordPenalty =
  async ({
    tenantId,
    memberId,
    amount,
    reference
  }) => {

    const savings =
      await getAccountByCode(
        tenantId,
        'MEMBER_SAVINGS'
      );

    const income =
      await getAccountByCode(
        tenantId,
        'PENALTY_INCOME'
      );

    return ledgerService.postTransaction({
      tenantId,
      debitAccountId:
        savings._id,
      creditAccountId:
        income._id,
      amount,
      reference,
      description:
        'Savings penalty',
      metadata: {
        memberId,
        event:
          SAVINGS_EVENTS.PENALTY
      }
    });
  };

/**
 * ---------------------------------------------------------
 * LOCKED SAVINGS TRANSFER
 * ---------------------------------------------------------
 *
 * DR MEMBER SAVINGS
 * CR LOCKED SAVINGS
 */
exports.recordLockedSavings =
  async ({
    tenantId,
    memberId,
    amount,
    reference
  }) => {

    const savings =
      await getAccountByCode(
        tenantId,
        'MEMBER_SAVINGS'
      );

    const locked =
      await getAccountByCode(
        tenantId,
        'LOCKED_SAVINGS'
      );

    return ledgerService.postTransaction({
      tenantId,
      debitAccountId:
        savings._id,
      creditAccountId:
        locked._id,
      amount,
      reference,
      description:
        'Locked savings transfer',
      metadata: {
        memberId,
        event:
          SAVINGS_EVENTS.LOCKED_SAVINGS
      }
    });
  };

/**
 * ---------------------------------------------------------
 * MEMBER SAVINGS ANALYTICS
 * ---------------------------------------------------------
 */
exports.getMemberSavingsAnalytics =
  async (
    tenantId,
    memberId,
    startDate,
    endDate
  ) => {

    return JournalEntry.aggregate([
      {
        $match: {
          tenantId:
            new mongoose.Types.ObjectId(
              tenantId
            ),
          'metadata.memberId':
            memberId,
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
          _id:
            '$metadata.event',
          totalAmount: {
            $sum: '$amount'
          },
          transactions: {
            $sum: 1
          }
        }
      }
    ]);
  };

/**
 * ---------------------------------------------------------
 * SAVINGS LEDGER VALIDATION
 * ---------------------------------------------------------
 */
exports.validateSavingsLedger =
  async (
    tenantId,
    memberId
  ) => {

    const entries =
      await JournalEntry.find({
        tenantId,
        'metadata.memberId':
          memberId
      });

    let debits = 0;
    let credits = 0;

    for (const entry of entries) {

      if (
        entry.direction ===
        'debit'
      ) {
        debits += entry.amount;
      }

      if (
        entry.direction ===
        'credit'
      ) {
        credits += entry.amount;
      }
    }

    return {
      balanced:
        debits === credits,
      totalDebits: debits,
      totalCredits: credits,
      variance:
        debits - credits
    };
  };

