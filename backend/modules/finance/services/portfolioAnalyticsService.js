// backend/modules/finance/services/portfolioAnalyticsService.js

'use strict';

const Loan = require('../../loans/models/Loan');
const Transaction = require('../models/Transaction');
const Account = require('../models/Account');

const DAYS = {
  PAR30: 30,
  PAR60: 60,
  PAR90: 90
};

/**
 * -----------------------------------------------------
 * HELPERS
 * -----------------------------------------------------
 */

function percentage(part, total) {
  if (!total || total <= 0) return 0;
  return Number(((part / total) * 100).toFixed(2));
}

function round(value) {
  return Number(Number(value || 0).toFixed(2));
}

function daysBetween(date) {
  const now = new Date();

  return Math.floor(
    (now - new Date(date)) /
      (1000 * 60 * 60 * 24)
  );
}

/**
 * -----------------------------------------------------
 * LOAN PORTFOLIO SUMMARY
 * -----------------------------------------------------
 */

async function getLoanPortfolioSummary(
  tenantId
) {
  const loans =
    await Loan.find({
      tenantId
    });

  const totalLoans =
    loans.length;

  const totalOutstanding =
    loans.reduce(
      (sum, loan) =>
        sum +
        Number(
          loan.outstandingBalance || 0
        ),
      0
    );

  const totalDisbursed =
    loans.reduce(
      (sum, loan) =>
        sum +
        Number(
          loan.amount || 0
        ),
      0
    );

  const activeLoans =
    loans.filter(
      loan =>
        loan.status === 'ACTIVE'
    ).length;

  const closedLoans =
    loans.filter(
      loan =>
        loan.status === 'CLOSED'
    ).length;

  return {
    totalLoans,
    activeLoans,
    closedLoans,
    totalOutstanding:
      round(totalOutstanding),
    totalDisbursed:
      round(totalDisbursed)
  };
}

/**
 * -----------------------------------------------------
 * PORTFOLIO AT RISK
 * -----------------------------------------------------
 */

async function getPortfolioAtRisk(
  tenantId
) {
  const loans =
    await Loan.find({
      tenantId,
      status: 'ACTIVE'
    });

  let outstanding = 0;

  let par30 = 0;
  let par60 = 0;
  let par90 = 0;

  for (const loan of loans) {
    const balance =
      Number(
        loan.outstandingBalance || 0
      );

    outstanding += balance;

    const overdueDays =
      daysBetween(
        loan.nextDueDate
      );

    if (
      overdueDays >=
      DAYS.PAR30
    ) {
      par30 += balance;
    }

    if (
      overdueDays >=
      DAYS.PAR60
    ) {
      par60 += balance;
    }

    if (
      overdueDays >=
      DAYS.PAR90
    ) {
      par90 += balance;
    }
  }

  return {
    outstanding:
      round(outstanding),

    par30Amount:
      round(par30),

    par60Amount:
      round(par60),

    par90Amount:
      round(par90),

    par30Percent:
      percentage(
        par30,
        outstanding
      ),

    par60Percent:
      percentage(
        par60,
        outstanding
      ),

    par90Percent:
      percentage(
        par90,
        outstanding
      )
  };
}

/**
 * -----------------------------------------------------
 * COLLECTION RATE
 * -----------------------------------------------------
 */

async function getCollectionEfficiency(
  tenantId
) {
  const loans =
    await Loan.find({
      tenantId
    });

  let expected = 0;
  let collected = 0;

  for (const loan of loans) {
    expected += Number(
      loan.expectedRepayment || 0
    );

    collected += Number(
      loan.totalRepaid || 0
    );
  }

  return {
    expected:
      round(expected),

    collected:
      round(collected),

    efficiency:
      percentage(
        collected,
        expected
      )
  };
}

/**
 * -----------------------------------------------------
 * SAVINGS ANALYTICS
 * -----------------------------------------------------
 */

async function getSavingsAnalytics(
  tenantId
) {
  const deposits =
    await Transaction.find({
      tenantId,
      type: 'DEPOSIT',
      status: 'POSTED'
    });

  const withdrawals =
    await Transaction.find({
      tenantId,
      type: 'WITHDRAWAL',
      status: 'POSTED'
    });

  const totalDeposits =
    deposits.reduce(
      (sum, tx) =>
        sum +
        Number(
          tx.amount || 0
        ),
      0
    );

  const totalWithdrawals =
    withdrawals.reduce(
      (sum, tx) =>
        sum +
        Number(
          tx.amount || 0
        ),
      0
    );

  return {
    deposits:
      round(totalDeposits),

    withdrawals:
      round(totalWithdrawals),

    netSavings:
      round(
        totalDeposits -
          totalWithdrawals
      )
  };
}

/**
 * -----------------------------------------------------
 * LIQUIDITY RATIO
 * -----------------------------------------------------
 */

async function getLiquidityMetrics(
  tenantId
) {
  const assets =
    await Account.find({
      tenantId,
      type: 'ASSET'
    });

  const liabilities =
    await Account.find({
      tenantId,
      type: 'LIABILITY'
    });

  const totalAssets =
    assets.reduce(
      (sum, account) =>
        sum +
        Number(
          account.balance || 0
        ),
      0
    );

  const totalLiabilities =
    liabilities.reduce(
      (sum, account) =>
        sum +
        Number(
          account.balance || 0
        ),
      0
    );

  return {
    totalAssets:
      round(totalAssets),

    totalLiabilities:
      round(totalLiabilities),

    liquidityRatio:
      totalLiabilities
        ? round(
            totalAssets /
              totalLiabilities
          )
        : 0
  };
}

/**
 * -----------------------------------------------------
 * LOAN CONCENTRATION
 * -----------------------------------------------------
 */

async function getConcentrationRisk(
  tenantId
) {
  const loans =
    await Loan.find({
      tenantId,
      status: 'ACTIVE'
    });

  const totalPortfolio =
    loans.reduce(
      (sum, loan) =>
        sum +
        Number(
          loan.outstandingBalance || 0
        ),
      0
    );

  const top10 =
    [...loans]
      .sort(
        (a, b) =>
          Number(
            b.outstandingBalance || 0
          ) -
          Number(
            a.outstandingBalance || 0
          )
      )
      .slice(0, 10);

  const topExposure =
    top10.reduce(
      (sum, loan) =>
        sum +
        Number(
          loan.outstandingBalance || 0
        ),
      0
    );

  return {
    top10Exposure:
      round(topExposure),

    portfolio:
      round(totalPortfolio),

    concentrationPercent:
      percentage(
        topExposure,
        totalPortfolio
      )
  };
}

/**
 * -----------------------------------------------------
 * SACCO HEALTH SCORE
 * -----------------------------------------------------
 */

async function getHealthScore(
  tenantId
) {
  const par =
    await getPortfolioAtRisk(
      tenantId
    );

  const collection =
    await getCollectionEfficiency(
      tenantId
    );

  const liquidity =
    await getLiquidityMetrics(
      tenantId
    );

  let score = 100;

  score -=
    par.par30Percent *
    0.40;

  score +=
    collection.efficiency *
    0.20;

  score +=
    liquidity.liquidityRatio *
    5;

  score = Math.min(
    100,
    Math.max(0, score)
  );

  let rating =
    'CRITICAL';

  if (score >= 80)
    rating = 'EXCELLENT';
  else if (score >= 70)
    rating = 'GOOD';
  else if (score >= 60)
    rating = 'FAIR';
  else if (score >= 50)
    rating = 'WATCHLIST';

  return {
    score:
      round(score),

    rating
  };
}

/**
 * -----------------------------------------------------
 * EXECUTIVE DASHBOARD
 * -----------------------------------------------------
 */

async function getExecutiveDashboard(
  tenantId
) {
  const [
    portfolio,
    par,
    collections,
    savings,
    liquidity,
    concentration,
    health
  ] = await Promise.all([
    getLoanPortfolioSummary(
      tenantId
    ),
    getPortfolioAtRisk(
      tenantId
    ),
    getCollectionEfficiency(
      tenantId
    ),
    getSavingsAnalytics(
      tenantId
    ),
    getLiquidityMetrics(
      tenantId
    ),
    getConcentrationRisk(
      tenantId
    ),
    getHealthScore(
      tenantId
    )
  ]);

  return {
    generatedAt:
      new Date(),

    portfolio,
    par,
    collections,
    savings,
    liquidity,
    concentration,
    health
  };
}

/**
 * -----------------------------------------------------
 * EXPORTS
 * -----------------------------------------------------
 */

module.exports = {
  getLoanPortfolioSummary,
  getPortfolioAtRisk,
  getCollectionEfficiency,
  getSavingsAnalytics,
  getLiquidityMetrics,
  getConcentrationRisk,
  getHealthScore,
  getExecutiveDashboard
};