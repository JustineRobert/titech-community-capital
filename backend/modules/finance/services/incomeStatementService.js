// backend/modules/finance/services/incomeStatementService.js
'use strict';

const trialBalanceService = require('./trialBalanceService');

/**
 * -------------------------------------------------------
 * CONFIGURATION
 * -------------------------------------------------------
 */

const REVENUE_TYPES = [
  'REVENUE'
];

const EXPENSE_TYPES = [
  'EXPENSE'
];

/**
 * -------------------------------------------------------
 * HELPERS
 * -------------------------------------------------------
 */

function round(value) {
  return Number(Number(value || 0).toFixed(2));
}

/**
 * -------------------------------------------------------
 * BUILD ACCOUNT GROUP
 * -------------------------------------------------------
 */

function buildSection(accounts = []) {
  let total = 0;

  const rows = accounts.map(account => {
    const amount =
      Number(account.credit || 0) -
      Number(account.debit || 0);

    total += amount;

    return {
      accountId: account.accountId,
      accountCode: account.accountCode,
      accountName: account.accountName,
      accountType: account.accountType,
      amount: round(amount)
    };
  });

  return {
    accounts: rows,
    total: round(total)
  };
}

/**
 * -------------------------------------------------------
 * CALCULATE EBITDA
 * -------------------------------------------------------
 */

function calculateEBITDA({
  revenue,
  operatingExpenses
}) {
  return round(
    revenue - operatingExpenses
  );
}

/**
 * -------------------------------------------------------
 * GENERATE INCOME STATEMENT
 * -------------------------------------------------------
 */

async function generateIncomeStatement({
  tenantId,
  startDate = null,
  endDate = null
}) {
  if (!tenantId) {
    throw new Error(
      'tenantId is required'
    );
  }

  const trialBalance =
    await trialBalanceService.generateTrialBalance({
      tenantId,
      startDate,
      endDate
    });

  const revenueAccounts =
    trialBalance.accounts.filter(
      account =>
        REVENUE_TYPES.includes(
          account.accountType
        )
    );

  const expenseAccounts =
    trialBalance.accounts.filter(
      account =>
        EXPENSE_TYPES.includes(
          account.accountType
        )
    );

  const revenueSection =
    buildSection(
      revenueAccounts
    );

  const expenseSection =
    {
      accounts:
        expenseAccounts.map(
          account => {
            const amount =
              Number(
                account.debit || 0
              ) -
              Number(
                account.credit || 0
              );

            return {
              accountId:
                account.accountId,
              accountCode:
                account.accountCode,
              accountName:
                account.accountName,
              accountType:
                account.accountType,
              amount:
                round(amount)
            };
          }
        ),

      total: round(
        expenseAccounts.reduce(
          (sum, account) =>
            sum +
            (
              Number(
                account.debit || 0
              ) -
              Number(
                account.credit || 0
              )
            ),
          0
        )
      )
    };

  const totalRevenue =
    revenueSection.total;

  const totalExpenses =
    expenseSection.total;

  const netIncome =
    round(
      totalRevenue -
      totalExpenses
    );

  const operatingMargin =
    totalRevenue > 0
      ? round(
          (
            netIncome /
            totalRevenue
          ) *
            100
        )
      : 0;

  const costToIncomeRatio =
    totalRevenue > 0
      ? round(
          (
            totalExpenses /
            totalRevenue
          ) *
            100
        )
      : 0;

  const ebitda =
    calculateEBITDA({
      revenue:
        totalRevenue,
      operatingExpenses:
        totalExpenses
    });

  return {
    reportType:
      'INCOME_STATEMENT',

    tenantId,

    generatedAt:
      new Date(),

    reportingPeriod: {
      startDate,
      endDate
    },

    revenue:
      revenueSection,

    expenses:
      expenseSection,

    summary: {
      totalRevenue,
      totalExpenses,
      netIncome,
      ebitda,
      operatingMargin,
      costToIncomeRatio
    }
  };
}

/**
 * -------------------------------------------------------
 * PROFITABILITY METRICS
 * -------------------------------------------------------
 */

async function calculateProfitabilityMetrics({
  tenantId,
  startDate,
  endDate
}) {
  const report =
    await generateIncomeStatement({
      tenantId,
      startDate,
      endDate
    });

  return {
    revenue:
      report.summary
        .totalRevenue,

    expenses:
      report.summary
        .totalExpenses,

    netIncome:
      report.summary
        .netIncome,

    operatingMargin:
      report.summary
        .operatingMargin,

    costToIncomeRatio:
      report.summary
        .costToIncomeRatio,

    ebitda:
      report.summary
        .ebitda
  };
}

/**
 * -------------------------------------------------------
 * PERIOD COMPARISON
 * -------------------------------------------------------
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
    generateIncomeStatement({
      tenantId,
      startDate:
        currentStart,
      endDate:
        currentEnd
    }),

    generateIncomeStatement({
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

    variances: {
      revenue:
        round(
          current.summary
            .totalRevenue -
          previous.summary
            .totalRevenue
        ),

      expenses:
        round(
          current.summary
            .totalExpenses -
          previous.summary
            .totalExpenses
        ),

      netIncome:
        round(
          current.summary
            .netIncome -
          previous.summary
            .netIncome
        )
    }
  };
}

/**
 * -------------------------------------------------------
 * FINANCIAL HEALTH SCORE
 * -------------------------------------------------------
 */

async function calculateIncomeHealthScore(
  tenantId
) {
  const report =
    await generateIncomeStatement({
      tenantId
    });

  let score = 100;

  if (
    report.summary.netIncome < 0
  ) {
    score -= 40;
  }

  if (
    report.summary.costToIncomeRatio >
    80
  ) {
    score -= 20;
  }

  if (
    report.summary.operatingMargin <
    10
  ) {
    score -= 20;
  }

  return {
    score:
      Math.max(
        0,
        round(score)
      ),

    netIncome:
      report.summary
        .netIncome,

    operatingMargin:
      report.summary
        .operatingMargin,

    costToIncomeRatio:
      report.summary
        .costToIncomeRatio
  };
}

/**
 * -------------------------------------------------------
 * EXPORT REPORT
 * -------------------------------------------------------
 */

async function exportIncomeStatement({
  tenantId,
  format = 'JSON'
}) {
  const report =
    await generateIncomeStatement({
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
 * -------------------------------------------------------
 * FORECAST PROFITABILITY
 * -------------------------------------------------------
 */

async function forecastIncomeTrend(
  tenantId
) {
  const report =
    await generateIncomeStatement({
      tenantId
    });

  const revenueGrowthProjection =
    round(
      report.summary
        .totalRevenue *
        1.15
    );

  const profitProjection =
    round(
      report.summary
        .netIncome *
        1.10
    );

  return {
    currentRevenue:
      report.summary
        .totalRevenue,

    projectedRevenue:
      revenueGrowthProjection,

    currentProfit:
      report.summary
        .netIncome,

    projectedProfit:
      profitProjection
  };
}

/**
 * -------------------------------------------------------
 * EXPORTS
 * -------------------------------------------------------
 */

module.exports = {
  generateIncomeStatement,
  calculateProfitabilityMetrics,
  comparePeriods,
  calculateIncomeHealthScore,
  exportIncomeStatement,
  forecastIncomeTrend
};