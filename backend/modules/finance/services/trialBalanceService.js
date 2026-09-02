// backend/modules/finance/services/trialBalanceService.js
'use strict';

const mongoose = require('mongoose');

const Account = require('../models/Account');
const JournalEntry = require('../models/JournalEntry');

/**
 * ----------------------------------------------------
 * ACCOUNT NORMAL BALANCES
 * ----------------------------------------------------
 */

const NORMAL_BALANCE = {
  ASSET: 'debit',
  EXPENSE: 'debit',
  LIABILITY: 'credit',
  EQUITY: 'credit',
  REVENUE: 'credit'
};

/**
 * ----------------------------------------------------
 * HELPERS
 * ----------------------------------------------------
 */

function round(value) {
  return Number(Number(value || 0).toFixed(2));
}

function toDate(date) {
  return date ? new Date(date) : null;
}

/**
 * ----------------------------------------------------
 * BUILD ACCOUNT BALANCE
 * ----------------------------------------------------
 */

async function calculateAccountBalance({
  tenantId,
  accountId,
  startDate,
  endDate
}) {
  const filter = {
    tenantId,
    accountId,
    posted: true,
    reversed: false
  };

  if (startDate || endDate) {
    filter.createdAt = {};

    if (startDate) {
      filter.createdAt.$gte = toDate(startDate);
    }

    if (endDate) {
      filter.createdAt.$lte = toDate(endDate);
    }
  }

  const entries = await JournalEntry.find(filter);

  let debits = 0;
  let credits = 0;

  for (const entry of entries) {
    if (entry.direction === 'debit') {
      debits += Number(entry.amount || 0);
    }

    if (entry.direction === 'credit') {
      credits += Number(entry.amount || 0);
    }
  }

  return {
    debits: round(debits),
    credits: round(credits)
  };
}

/**
 * ----------------------------------------------------
 * GENERATE TRIAL BALANCE
 * ----------------------------------------------------
 */

async function generateTrialBalance({
  tenantId,
  startDate = null,
  endDate = null
}) {
  if (!tenantId) {
    throw new Error('tenantId is required');
  }

  const accounts = await Account.find({
    tenantId,
    isDeleted: false
  })
    .sort({
      code: 1
    })
    .lean();

  const rows = [];

  let totalDebits = 0;
  let totalCredits = 0;

  for (const account of accounts) {
    const balances =
      await calculateAccountBalance({
        tenantId,
        accountId: account._id,
        startDate,
        endDate
      });

    const normalBalance =
      NORMAL_BALANCE[
        account.type
      ] || 'debit';

    let balance = 0;

    if (normalBalance === 'debit') {
      balance =
        balances.debits -
        balances.credits;
    } else {
      balance =
        balances.credits -
        balances.debits;
    }

    let debitColumn = 0;
    let creditColumn = 0;

    if (balance >= 0) {
      if (
        normalBalance === 'debit'
      ) {
        debitColumn =
          balance;
      } else {
        creditColumn =
          balance;
      }
    } else {
      if (
        normalBalance === 'debit'
      ) {
        creditColumn =
          Math.abs(balance);
      } else {
        debitColumn =
          Math.abs(balance);
      }
    }

    totalDebits += debitColumn;
    totalCredits += creditColumn;

    rows.push({
      accountId:
        account._id,

      accountCode:
        account.code,

      accountName:
        account.name,

      accountType:
        account.type,

      debit:
        round(
          debitColumn
        ),

      credit:
        round(
          creditColumn
        ),

      rawDebits:
        balances.debits,

      rawCredits:
        balances.credits
    });
  }

  const difference =
    round(
      totalDebits -
      totalCredits
    );

  return {
    tenantId,

    generatedAt:
      new Date(),

    period: {
      startDate,
      endDate
    },

    totalDebits:
      round(
        totalDebits
      ),

    totalCredits:
      round(
        totalCredits
      ),

    difference,

    balanced:
      difference === 0,

    accounts:
      rows
  };
}

/**
 * ----------------------------------------------------
 * VERIFY TRIAL BALANCE
 * ----------------------------------------------------
 */

async function verifyTrialBalance(
  tenantId,
  startDate,
  endDate
) {
  const trialBalance =
    await generateTrialBalance({
      tenantId,
      startDate,
      endDate
    });

  return {
    balanced:
      trialBalance.balanced,

    difference:
      trialBalance.difference,

    totalDebits:
      trialBalance.totalDebits,

    totalCredits:
      trialBalance.totalCredits
  };
}

/**
 * ----------------------------------------------------
 * FIND IMBALANCED ACCOUNTS
 * ----------------------------------------------------
 */

async function findImbalances(
  tenantId,
  startDate,
  endDate
) {
  const trialBalance =
    await generateTrialBalance({
      tenantId,
      startDate,
      endDate
    });

  return trialBalance.accounts.filter(
    account =>
      account.rawDebits !==
      account.rawCredits
  );
}

/**
 * ----------------------------------------------------
 * LEDGER HEALTH SCORE
 * ----------------------------------------------------
 */

async function calculateLedgerHealthScore(
  tenantId
) {
  const trialBalance =
    await generateTrialBalance({
      tenantId
    });

  const accountCount =
    trialBalance.accounts.length;

  const balancedAccounts =
    trialBalance.accounts.filter(
      account =>
        account.rawDebits > 0 ||
        account.rawCredits > 0
    ).length;

  let score = 100;

  if (
    !trialBalance.balanced
  ) {
    score -= 50;
  }

  if (
    accountCount > 0
  ) {
    score += Math.min(
      20,
      (
        balancedAccounts /
        accountCount
      ) *
        20
    );
  }

  return {
    score:
      Math.min(
        100,
        round(score)
      ),

    ledgerBalanced:
      trialBalance.balanced,

    accountsReviewed:
      accountCount
  };
}

/**
 * ----------------------------------------------------
 * PERIOD COMPARISON
 * ----------------------------------------------------
 */

async function comparePeriods({
  tenantId,
  currentStart,
  currentEnd,
  previousStart,
  previousEnd
}) {
  const [
    current,
    previous
  ] = await Promise.all([
    generateTrialBalance({
      tenantId,
      startDate:
        currentStart,
      endDate:
        currentEnd
    }),

    generateTrialBalance({
      tenantId,
      startDate:
        previousStart,
      endDate:
        previousEnd
    })
  ]);

  return {
    currentPeriod:
      current,

    previousPeriod:
      previous,

    debitVariance:
      round(
        current.totalDebits -
          previous.totalDebits
      ),

    creditVariance:
      round(
        current.totalCredits -
          previous.totalCredits
      )
  };
}

/**
 * ----------------------------------------------------
 * EXPORT TRIAL BALANCE
 * ----------------------------------------------------
 */

async function exportTrialBalance(
  tenantId,
  format = 'JSON'
) {
  const report =
    await generateTrialBalance({
      tenantId
    });

  return {
    format:
      String(
        format
      ).toUpperCase(),

    exportedAt:
      new Date(),

    report
  };
}

/**
 * ----------------------------------------------------
 * YEAR END VALIDATION
 * ----------------------------------------------------
 */

async function validateYearEndClose(
  tenantId
) {
  const trialBalance =
    await generateTrialBalance({
      tenantId
    });

  if (
    !trialBalance.balanced
  ) {
    throw new Error(
      'Year-end closing blocked. Trial balance is not balanced.'
    );
  }

  return {
    success: true,

    validatedAt:
      new Date(),

    totalDebits:
      trialBalance.totalDebits,

    totalCredits:
      trialBalance.totalCredits
  };
}

/**
 * ----------------------------------------------------
 * EXPORTS
 * ----------------------------------------------------
 */

module.exports = {
  calculateAccountBalance,
  generateTrialBalance,
  verifyTrialBalance,
  findImbalances,
  calculateLedgerHealthScore,
  comparePeriods,
  exportTrialBalance,
  validateYearEndClose
};