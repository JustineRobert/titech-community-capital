// backend/modules/finance/services/FinancialReportsService.js
'use strict';

const LedgerEntry = require('../models/LedgerEntry');
const Account = require('../models/Account');

/**
 * FINANCIAL REPORTS ENGINE
 * - Balance Sheet
 * - Income Statement
 * - Trial Balance
 */

class FinancialReportsService {
  /**
   * ✅ Trial Balance
   */
  static async getTrialBalance(tenantId) {
    return LedgerEntry.getTrialBalance(tenantId);
  }

  /**
   * ✅ Income Statement
   * Revenue - Expenses
   */
  static async getIncomeStatement(tenantId) {
    const accounts = await Account.find({ tenantId, isDeleted: false });

    const result = {
      revenue: 0,
      expense: 0,
      netIncome: 0,
    };

    for (const account of accounts) {
      const balance = await LedgerEntry.getAccountBalance(
        tenantId,
        account._id
      );

      if (account.type === 'REVENUE') {
        result.revenue += balance;
      }

      if (account.type === 'EXPENSE') {
        result.expense += balance;
      }
    }

    result.netIncome = result.revenue - result.expense;

    return result;
  }

  /**
   * ✅ Balance Sheet
   * Assets = Liabilities + Equity
   */
  static async getBalanceSheet(tenantId) {
    const accounts = await Account.find({ tenantId, isDeleted: false });

    const sheet = {
      assets: 0,
      liabilities: 0,
      equity: 0,
    };

    for (const account of accounts) {
      const balance = await LedgerEntry.getAccountBalance(
        tenantId,
        account._id
      );

      if (account.type === 'ASSET') sheet.assets += balance;
      if (account.type === 'LIABILITY') sheet.liabilities += balance;
      if (account.type === 'EQUITY') sheet.equity += balance;
    }

    return {
      ...sheet,
      check: sheet.assets - (sheet.liabilities + sheet.equity),
    };
  }

  /**
   * ✅ SACCO KPI REPORT
   */
  static async getKPI(tenantId) {
    const transactions = await require('../models/Transaction').find({
      tenantId,
    });

    const totalTransactions = transactions.length;

    const posted = transactions.filter(
      (t) => t.status === 'POSTED'
    ).length;

    const failed = transactions.filter(
      (t) => t.status === 'FAILED'
    ).length;

    return {
      totalTransactions,
      posted,
      failed,
      successRate:
        totalTransactions > 0
          ? ((posted / totalTransactions) * 100).toFixed(2) + '%'
          : '0%',
    };
  }
}

module.exports = FinancialReportsService;