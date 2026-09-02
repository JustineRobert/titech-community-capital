// backend/modules/finance/services/financialStatementService.js

'use strict';

const mongoose = require('mongoose');

const Account = require('../models/Account');
const JournalEntry = require('../models/JournalEntry');
const Journal = require('../models/Journal');

/**
 * ============================================================
 * ACCOUNT CATEGORIES
 * ============================================================
 */

const ACCOUNT_TYPES = {
  ASSET: 'ASSET',
  LIABILITY: 'LIABILITY',
  EQUITY: 'EQUITY',
  REVENUE: 'REVENUE',
  EXPENSE: 'EXPENSE'
};

/**
 * ============================================================
 * DATE FILTER
 * ============================================================
 */

function buildDateFilter(startDate, endDate) {
  const filter = {};

  if (startDate || endDate) {
    filter.createdAt = {};

    if (startDate) {
      filter.createdAt.$gte = new Date(startDate);
    }

    if (endDate) {
      filter.createdAt.$lte = new Date(endDate);
    }
  }

  return filter;
}

/**
 * ============================================================
 * TRIAL BALANCE
 * ============================================================
 */

exports.generateTrialBalance = async ({
  tenantId,
  startDate,
  endDate
}) => {

  const dateFilter =
    buildDateFilter(
      startDate,
      endDate
    );

  const accounts =
    await Account.find({
      tenantId,
      isDeleted: false
    });

  const result = [];

  let totalDebits = 0;
  let totalCredits = 0;

  for (const account of accounts) {

    const entries =
      await JournalEntry.find({
        tenantId,
        accountId: account._id,
        posted: true,
        ...dateFilter
      });

    let debit = 0;
    let credit = 0;

    for (const entry of entries) {

      if (
        entry.direction.toLowerCase() ===
        'debit'
      ) {
        debit += Number(
          entry.amount
        );
      }

      if (
        entry.direction.toLowerCase() ===
        'credit'
      ) {
        credit += Number(
          entry.amount
        );
      }
    }

    totalDebits += debit;
    totalCredits += credit;

    result.push({
      accountCode:
        account.code,
      accountName:
        account.name,
      accountType:
        account.type,
      debit,
      credit
    });
  }

  return {
    tenantId,
    generatedAt:
      new Date(),
    balanced:
      totalDebits ===
      totalCredits,
    totalDebits,
    totalCredits,
    accounts: result
  };
};

/**
 * ============================================================
 * INCOME STATEMENT
 * PROFIT & LOSS
 * ============================================================
 */

exports.generateIncomeStatement =
  async ({
    tenantId,
    startDate,
    endDate
  }) => {

    const dateFilter =
      buildDateFilter(
        startDate,
        endDate
      );

    const accounts =
      await Account.find({
        tenantId,
        type: {
          $in: [
            ACCOUNT_TYPES.REVENUE,
            ACCOUNT_TYPES.EXPENSE
          ]
        }
      });

    let totalRevenue = 0;
    let totalExpenses = 0;

    const revenues = [];
    const expenses = [];

    for (const account of accounts) {

      const entries =
        await JournalEntry.find({
          tenantId,
          accountId:
            account._id,
          posted: true,
          ...dateFilter
        });

      let balance = 0;

      for (const entry of entries) {

        if (
          entry.direction ===
          'credit'
        ) {
          balance += Number(
            entry.amount
          );
        }

        if (
          entry.direction ===
          'debit'
        ) {
          balance -= Number(
            entry.amount
          );
        }
      }

      if (
        account.type ===
        ACCOUNT_TYPES.REVENUE
      ) {

        totalRevenue +=
          balance;

        revenues.push({
          code:
            account.code,
          name:
            account.name,
          amount:
            balance
        });

      } else {

        totalExpenses +=
          Math.abs(balance);

        expenses.push({
          code:
            account.code,
          name:
            account.name,
          amount:
            Math.abs(
              balance
            )
        });
      }
    }

    return {
      tenantId,
      generatedAt:
        new Date(),
      revenues,
      expenses,
      totalRevenue,
      totalExpenses,
      netProfit:
        totalRevenue -
        totalExpenses
    };
  };

/**
 * ============================================================
 * BALANCE SHEET
 * ============================================================
 */

exports.generateBalanceSheet =
  async ({
    tenantId
  }) => {

    const accounts =
      await Account.find({
        tenantId,
        isDeleted: false
      });

    const assets = [];
    const liabilities = [];
    const equity = [];

    let totalAssets = 0;
    let totalLiabilities = 0;
    let totalEquity = 0;

    for (const account of accounts) {

      const entries =
        await JournalEntry.find({
          tenantId,
          accountId:
            account._id,
          posted: true
        });

      let balance = 0;

      for (const entry of entries) {

        if (
          entry.direction ===
          'credit'
        ) {
          balance += Number(
            entry.amount
          );
        }

        if (
          entry.direction ===
          'debit'
        ) {
          balance -= Number(
            entry.amount
          );
        }
      }

      const row = {
        code:
          account.code,
        name:
          account.name,
        balance:
          Math.abs(balance)
      };

      switch (
        account.type
      ) {

        case ACCOUNT_TYPES.ASSET:

          totalAssets +=
            Math.abs(balance);

          assets.push(row);

          break;

        case ACCOUNT_TYPES.LIABILITY:

          totalLiabilities +=
            Math.abs(balance);

          liabilities.push(
            row
          );

          break;

        case ACCOUNT_TYPES.EQUITY:

          totalEquity +=
            Math.abs(balance);

          equity.push(row);

          break;
      }
    }

    return {
      tenantId,
      generatedAt:
        new Date(),

      assets,
      liabilities,
      equity,

      totalAssets,
      totalLiabilities,
      totalEquity,

      balanced:
        totalAssets ===
        totalLiabilities +
          totalEquity
    };
  };

/**
 * ============================================================
 * CASH FLOW STATEMENT
 * ============================================================
 */

exports.generateCashFlowStatement =
  async ({
    tenantId,
    startDate,
    endDate
  }) => {

    const dateFilter =
      buildDateFilter(
        startDate,
        endDate
      );

    const entries =
      await JournalEntry.find({
        tenantId,
        posted: true,
        ...dateFilter
      });

    let inflow = 0;
    let outflow = 0;

    for (const entry of entries) {

      const amount =
        Number(
          entry.amount
        );

      if (
        entry.direction ===
        'credit'
      ) {
        inflow += amount;
      }

      if (
        entry.direction ===
        'debit'
      ) {
        outflow += amount;
      }
    }

    return {
      tenantId,
      generatedAt:
        new Date(),

      cashInflows:
        inflow,

      cashOutflows:
        outflow,

      netCashFlow:
        inflow -
        outflow
    };
  };

/**
 * ============================================================
 * GENERAL LEDGER REPORT
 * ============================================================
 */

exports.generateGeneralLedger =
  async ({
    tenantId,
    accountId,
    startDate,
    endDate
  }) => {

    const dateFilter =
      buildDateFilter(
        startDate,
        endDate
      );

    const account =
      await Account.findOne({
        _id: accountId,
        tenantId
      });

    if (!account) {
      throw new Error(
        'Account not found'
      );
    }

    const entries =
      await JournalEntry.find({
        tenantId,
        accountId,
        ...dateFilter
      })
      .sort({
        createdAt: 1
      });

    let runningBalance = 0;

    const ledger =
      entries.map(entry => {

        if (
          entry.direction ===
          'credit'
        ) {
          runningBalance +=
            Number(
              entry.amount
            );
        }

        if (
          entry.direction ===
          'debit'
        ) {
          runningBalance -=
            Number(
              entry.amount
            );
        }

        return {
          date:
            entry.createdAt,
          reference:
            entry.reference,
          description:
            entry.description,
          debit:
            entry.direction ===
            'debit'
              ? entry.amount
              : 0,
          credit:
            entry.direction ===
            'credit'
              ? entry.amount
              : 0,
          balance:
            runningBalance
        };
      });

    return {
      tenantId,
      account:
        account.name,
      accountCode:
        account.code,
      generatedAt:
        new Date(),
      entries: ledger
    };
  };

/**
 * ============================================================
 * REGULATORY FINANCIAL PACKAGE
 * ============================================================
 */

exports.generateFinancialPackage =
  async ({
    tenantId,
    startDate,
    endDate
  }) => {

    const [
      trialBalance,
      incomeStatement,
      balanceSheet,
      cashFlow
    ] = await Promise.all([
      exports.generateTrialBalance({
        tenantId,
        startDate,
        endDate
      }),

      exports.generateIncomeStatement({
        tenantId,
        startDate,
        endDate
      }),

      exports.generateBalanceSheet({
        tenantId
      }),

      exports.generateCashFlowStatement({
        tenantId,
        startDate,
        endDate
      })
    ]);

    return {
      generatedAt:
        new Date(),

      trialBalance,

      incomeStatement,

      balanceSheet,

      cashFlow
    };
  };