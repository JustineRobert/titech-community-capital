// backend/modules/finance/services/cashFlowService.js
'use strict';

const JournalEntry = require('../models/JournalEntry');
const Account = require('../models/Account');

const CASH_EQUIVALENT_TYPES = [
  'CASH',
  'BANK',
  'MOBILE_MONEY'
];

const OPERATING_EVENTS = [
  'SAVINGS_DEPOSIT',
  'SAVINGS_WITHDRAWAL',
  'LOAN_REPAYMENT',
  'INTEREST_ACCRUAL',
  'FEE',
  'PENALTY'
];

const INVESTING_EVENTS = [
  'ASSET_PURCHASE',
  'ASSET_DISPOSAL',
  'INVESTMENT_PURCHASE',
  'INVESTMENT_SALE'
];

const FINANCING_EVENTS = [
  'LOAN_DISBURSEMENT',
  'CAPITAL_CONTRIBUTION',
  'DIVIDEND_PAYMENT',
  'BORROWING',
  'DEBT_REPAYMENT'
];

function round(value) {
  return Number(Number(value || 0).toFixed(2));
}

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
 * ---------------------------------------------------
 * CALCULATE CASH MOVEMENT
 * ---------------------------------------------------
 */

async function calculateCashMovement({
  tenantId,
  entryTypes = [],
  startDate,
  endDate
}) {
  const entries =
    await JournalEntry.find({
      tenantId,
      posted: true,
      reversed: false,
      entryType: {
        $in: entryTypes
      },
      ...buildDateFilter(
        startDate,
        endDate
      )
    }).lean();

  let inflow = 0;
  let outflow = 0;

  for (const entry of entries) {
    const amount =
      Number(entry.amount || 0);

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
    inflow: round(inflow),
    outflow: round(outflow),
    netCashFlow: round(
      inflow - outflow
    )
  };
}

/**
 * ---------------------------------------------------
 * OPENING CASH BALANCE
 * ---------------------------------------------------
 */

async function getOpeningCashBalance(
  tenantId
) {
  const accounts =
    await Account.find({
      tenantId,
      category: {
        $in:
          CASH_EQUIVALENT_TYPES
      },
      isActive: true
    }).lean();

  let balance = 0;

  for (const account of accounts) {
    balance += Number(
      account.balance || 0
    );
  }

  return round(balance);
}

/**
 * ---------------------------------------------------
 * OPERATING ACTIVITIES
 * ---------------------------------------------------
 */

async function calculateOperatingActivities({
  tenantId,
  startDate,
  endDate
}) {
  return calculateCashMovement({
    tenantId,
    entryTypes:
      OPERATING_EVENTS,
    startDate,
    endDate
  });
}

/**
 * ---------------------------------------------------
 * INVESTING ACTIVITIES
 * ---------------------------------------------------
 */

async function calculateInvestingActivities({
  tenantId,
  startDate,
  endDate
}) {
  return calculateCashMovement({
    tenantId,
    entryTypes:
      INVESTING_EVENTS,
    startDate,
    endDate
  });
}

/**
 * ---------------------------------------------------
 * FINANCING ACTIVITIES
 * ---------------------------------------------------
 */

async function calculateFinancingActivities({
  tenantId,
  startDate,
  endDate
}) {
  return calculateCashMovement({
    tenantId,
    entryTypes:
      FINANCING_EVENTS,
    startDate,
    endDate
  });
}

/**
 * ---------------------------------------------------
 * GENERATE CASH FLOW STATEMENT
 * ---------------------------------------------------
 */

async function generateCashFlowStatement({
  tenantId,
  startDate = null,
  endDate = null
}) {
  if (!tenantId) {
    throw new Error(
      'tenantId is required'
    );
  }

  const openingBalance =
    await getOpeningCashBalance(
      tenantId
    );

  const [
    operating,
    investing,
    financing
  ] = await Promise.all([
    calculateOperatingActivities({
      tenantId,
      startDate,
      endDate
    }),

    calculateInvestingActivities({
      tenantId,
      startDate,
      endDate
    }),

    calculateFinancingActivities({
      tenantId,
      startDate,
      endDate
    })
  ]);

  const netCashFlow =
    round(
      operating.netCashFlow +
      investing.netCashFlow +
      financing.netCashFlow
    );

  const closingBalance =
    round(
      openingBalance +
      netCashFlow
    );

  return {
    reportType:
      'CASH_FLOW_STATEMENT',

    tenantId,

    generatedAt:
      new Date(),

    reportingPeriod: {
      startDate,
      endDate
    },

    openingCashBalance:
      openingBalance,

    operatingActivities:
      operating,

    investingActivities:
      investing,

    financingActivities:
      financing,

    netCashFlow,

    closingCashBalance:
      closingBalance
  };
}

/**
 * ---------------------------------------------------
 * LIQUIDITY ANALYSIS
 * ---------------------------------------------------
 */

async function calculateLiquidityMetrics(
  tenantId
) {
  const report =
    await generateCashFlowStatement({
      tenantId
    });

  let liquidityScore = 100;

  if (
    report.netCashFlow < 0
  ) {
    liquidityScore -= 30;
  }

  if (
    report.closingCashBalance <
    report.openingCashBalance
  ) {
    liquidityScore -= 20;
  }

  return {
    score:
      Math.max(
        0,
        liquidityScore
      ),

    netCashFlow:
      report.netCashFlow,

    openingCashBalance:
      report.openingCashBalance,

    closingCashBalance:
      report.closingCashBalance
  };
}

/**
 * ---------------------------------------------------
 * CASH FORECAST
 * ---------------------------------------------------
 */

async function forecastCashPosition(
  tenantId,
  months = 6
) {
  const report =
    await generateCashFlowStatement({
      tenantId
    });

  const projected =
    round(
      report.closingCashBalance +
      (
        report.netCashFlow *
        months
      )
    );

  return {
    currentCash:
      report.closingCashBalance,

    projectedCash:
      projected,

    forecastMonths:
      months
  };
}

/**
 * ---------------------------------------------------
 * PERIOD COMPARISON
 * ---------------------------------------------------
 */

async function compareCashFlowPeriods({
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
    generateCashFlowStatement({
      tenantId,
      startDate:
        currentStart,
      endDate:
        currentEnd
    }),

    generateCashFlowStatement({
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
      operating:
        round(
          current
            .operatingActivities
            .netCashFlow -
          previous
            .operatingActivities
            .netCashFlow
        ),

      investing:
        round(
          current
            .investingActivities
            .netCashFlow -
          previous
            .investingActivities
            .netCashFlow
        ),

      financing:
        round(
          current
            .financingActivities
            .netCashFlow -
          previous
            .financingActivities
            .netCashFlow
        ),

      total:
        round(
          current.netCashFlow -
          previous.netCashFlow
        )
    }
  };
}

/**
 * ---------------------------------------------------
 * EXPORT
 * ---------------------------------------------------
 */

async function exportCashFlowStatement({
  tenantId,
  format = 'JSON'
}) {
  const report =
    await generateCashFlowStatement({
      tenantId
    });

  return {
    format:
      format.toUpperCase(),

    exportedAt:
      new Date(),

    report
  };
}

/**
 * ---------------------------------------------------
 * EXECUTIVE KPI SUMMARY
 * ---------------------------------------------------
 */

async function getExecutiveCashKPIs(
  tenantId
) {
  const report =
    await generateCashFlowStatement({
      tenantId
    });

  return {
    operatingCashFlow:
      report
        .operatingActivities
        .netCashFlow,

    financingCashFlow:
      report
        .financingActivities
        .netCashFlow,

    investingCashFlow:
      report
        .investingActivities
        .netCashFlow,

    netCashFlow:
      report.netCashFlow,

    closingCash:
      report.closingCashBalance
  };
}

/**
 * ---------------------------------------------------
 * EXPORTS
 * ---------------------------------------------------
 */

module.exports = {
  generateCashFlowStatement,
  calculateOperatingActivities,
  calculateInvestingActivities,
  calculateFinancingActivities,
  calculateLiquidityMetrics,
  forecastCashPosition,
  compareCashFlowPeriods,
  exportCashFlowStatement,
  getExecutiveCashKPIs
};