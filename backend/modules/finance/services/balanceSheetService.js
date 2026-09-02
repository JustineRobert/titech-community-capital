// backend/modules/finance/services/balanceSheetService.js
'use strict';

const Account = require('../models/Account');
const trialBalanceService = require('./trialBalanceService');

/**
 * -----------------------------------------------------
 * ACCOUNT CLASSIFICATIONS
 * -----------------------------------------------------
 */

const ASSET_TYPES = ['ASSET'];

const LIABILITY_TYPES = ['LIABILITY'];

const EQUITY_TYPES = [
  'EQUITY',
  'REVENUE'
];

/**
 * -----------------------------------------------------
 * HELPERS
 * -----------------------------------------------------
 */

function round(value) {
  return Number(Number(value || 0).toFixed(2));
}

function calculateAccountBalance(account) {
  return round(
    Number(account.debit || 0) -
    Number(account.credit || 0)
  );
}

/**
 * -----------------------------------------------------
 * BUILD SECTION
 * -----------------------------------------------------
 */

function buildSection(accounts = []) {
  const rows = [];
  let total = 0;

  for (const account of accounts) {
    const balance = calculateAccountBalance(account);

    rows.push({
      accountId: account.accountId,
      accountCode: account.accountCode,
      accountName: account.accountName,
      accountType: account.accountType,
      balance
    });

    total += balance;
  }

  return {
    accounts: rows,
    total: round(total)
  };
}

/**
 * -----------------------------------------------------
 * CALCULATE RETAINED EARNINGS
 * -----------------------------------------------------
 */

async function calculateRetainedEarnings(
  tenantId,
  startDate,
  endDate
) {
  const trialBalance =
    await trialBalanceService.generateTrialBalance({
      tenantId,
      startDate,
      endDate
    });

  let revenue = 0;
  let expenses = 0;

  for (const account of trialBalance.accounts) {
    if (
      account.accountType === 'REVENUE'
    ) {
      revenue += Number(account.credit || 0);
    }

    if (
      account.accountType === 'EXPENSE'
    ) {
      expenses += Number(account.debit || 0);
    }
  }

  return round(revenue - expenses);
}

/**
 * -----------------------------------------------------
 * GENERATE BALANCE SHEET
 * -----------------------------------------------------
 */

async function generateBalanceSheet({
  tenantId,
  reportDate = new Date(),
  startDate = null,
  endDate = null
}) {
  if (!tenantId) {
    throw new Error('tenantId is required');
  }

  const trialBalance =
    await trialBalanceService.generateTrialBalance({
      tenantId,
      startDate,
      endDate
    });

  if (!trialBalance.balanced) {
    throw new Error(
      'Cannot generate Balance Sheet. Trial Balance is not balanced.'
    );
  }

  const assets =
    trialBalance.accounts.filter(
      account =>
        ASSET_TYPES.includes(
          account.accountType
        )
    );

  const liabilities =
    trialBalance.accounts.filter(
      account =>
        LIABILITY_TYPES.includes(
          account.accountType
        )
    );

  const equityAccounts =
    trialBalance.accounts.filter(
      account =>
        EQUITY_TYPES.includes(
          account.accountType
        )
    );

  const assetSection =
    buildSection(assets);

  const liabilitySection =
    buildSection(liabilities);

  const equitySection =
    buildSection(equityAccounts);

  const retainedEarnings =
    await calculateRetainedEarnings(
      tenantId,
      startDate,
      endDate
    );

  const totalEquity =
    round(
      equitySection.total +
      retainedEarnings
    );

  const totalLiabilitiesAndEquity =
    round(
      liabilitySection.total +
      totalEquity
    );

  const difference =
    round(
      assetSection.total -
      totalLiabilitiesAndEquity
    );

  return {
    reportType:
      'BALANCE_SHEET',

    generatedAt:
      new Date(),

    reportDate,

    tenantId,

    assets: assetSection,

    liabilities:
      liabilitySection,

    equity: {
      ...equitySection,
      retainedEarnings,
      totalEquity
    },

    totals: {
      totalAssets:
        assetSection.total,

      totalLiabilities:
        liabilitySection.total,

      totalEquity,

      totalLiabilitiesAndEquity
    },

    balanced:
      difference === 0,

    difference
  };
}

/**
 * -----------------------------------------------------
 * VALIDATE BALANCE SHEET
 * -----------------------------------------------------
 */

async function validateBalanceSheet(
  tenantId
) {
  const balanceSheet =
    await generateBalanceSheet({
      tenantId
    });

  return {
    balanced:
      balanceSheet.balanced,

    totalAssets:
      balanceSheet.totals
        .totalAssets,

    totalLiabilities:
      balanceSheet.totals
        .totalLiabilities,

    totalEquity:
      balanceSheet.totals
        .totalEquity,

    difference:
      balanceSheet.difference
  };
}

/**
 * -----------------------------------------------------
 * PERIOD COMPARISON
 * -----------------------------------------------------
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
    generateBalanceSheet({
      tenantId,
      startDate:
        currentStart,
      endDate:
        currentEnd
    }),

    generateBalanceSheet({
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
      assets:
        round(
          current.totals
            .totalAssets -
          previous.totals
            .totalAssets
        ),

      liabilities:
        round(
          current.totals
            .totalLiabilities -
          previous.totals
            .totalLiabilities
        ),

      equity:
        round(
          current.totals
            .totalEquity -
          previous.totals
            .totalEquity
        )
    }
  };
}

/**
 * -----------------------------------------------------
 * EXPORT BALANCE SHEET
 * -----------------------------------------------------
 */

async function exportBalanceSheet({
  tenantId,
  format = 'JSON'
}) {
  const report =
    await generateBalanceSheet({
      tenantId
    });

  return {
    exportedAt:
      new Date(),

    format:
      String(
        format
      ).toUpperCase(),

    report
  };
}

/**
 * -----------------------------------------------------
 * FINANCIAL HEALTH SCORE
 * -----------------------------------------------------
 */

async function calculateFinancialHealth(
  tenantId
) {
  const report =
    await generateBalanceSheet({
      tenantId
    });

  const assets =
    report.totals.totalAssets;

  const liabilities =
    report.totals.totalLiabilities;

  const equity =
    report.totals.totalEquity;

  const debtRatio =
    assets > 0
      ? liabilities / assets
      : 0;

  const equityRatio =
    assets > 0
      ? equity / assets
      : 0;

  let score = 100;

  if (debtRatio > 0.8) {
    score -= 25;
  }

  if (equityRatio < 0.1) {
    score -= 25;
  }

  return {
    score: Math.max(
      0,
      round(score)
    ),

    debtRatio:
      round(
        debtRatio * 100
      ),

    equityRatio:
      round(
        equityRatio * 100
      ),

    assets,
    liabilities,
    equity
  };
}

/**
 * -----------------------------------------------------
 * EXPORTS
 * -----------------------------------------------------
 */

module.exports = {
  generateBalanceSheet,
  validateBalanceSheet,
  comparePeriods,
  exportBalanceSheet,
  calculateRetainedEarnings,
  calculateFinancialHealth
};